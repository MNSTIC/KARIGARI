import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { formatRupees } from '@/lib/pricing';
import { advanceOrderStatus } from '@/lib/orderStage';
import { createBuyerNotification } from '@/lib/buyerNotify';
import {
  DEMO_ADVANCE_PAISE,
  RAZORPAY_CONFIGURED,
  RAZORPAY_LIVE,
  verifyRazorpaySignature,
} from '@/lib/razorpay';

/**
 * The buyer's 40% advance — step 2 of 2: prove the payment happened.
 *
 * THIS IS THE TRUST BOUNDARY, exactly as in `/api/payments/verify-payment`.
 * Everything up to here came from the browser and is worth nothing on its own:
 * anyone can POST a made-up payment id. What makes an advance real is the HMAC
 * signature Razorpay computes over `<order_id>|<payment_id>` with the key
 * secret, which only the server holds. Nothing below the signature check writes
 * a field, and a mismatch is a 400 with the order left exactly as it was.
 *
 * Three further checks, all load-bearing:
 *
 *   - the buyer name must match the demand's, so buyer Y cannot settle buyer
 *     X's advance;
 *   - `razorpay_order_id` must be the one THIS order was opened with, so a
 *     signature genuinely valid for a different order cannot settle this one;
 *   - `advancePaidAt IS NULL` guards the write, so a double submit records one
 *     advance and not two.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const artisanOrderId = typeof body?.artisanOrderId === 'string' ? body.artisanOrderId.trim() : '';
    const buyerName = typeof body?.buyerName === 'string' ? body.buyerName.trim() : '';
    const orderId = typeof body?.razorpay_order_id === 'string' ? body.razorpay_order_id : '';
    const paymentId = typeof body?.razorpay_payment_id === 'string' ? body.razorpay_payment_id : '';
    const signature = typeof body?.razorpay_signature === 'string' ? body.razorpay_signature : '';

    if (!artisanOrderId || !buyerName || !orderId || !paymentId || !signature) {
      return NextResponse.json(
        {
          error:
            'artisanOrderId, buyerName, razorpay_order_id, razorpay_payment_id and razorpay_signature are all required.',
        },
        { status: 400 }
      );
    }

    if (!RAZORPAY_CONFIGURED) {
      return NextResponse.json(
        { error: 'Razorpay is not configured on this deployment, so no payment can be verified.' },
        { status: 503 }
      );
    }

    const order = await prisma.artisanOrder.findUnique({
      where: { id: artisanOrderId },
      select: {
        id: true,
        artisanId: true,
        status: true,
        advanceStatus: true,
        advanceDueAmount: true,
        advanceRazorpayOrderId: true,
        advanceRazorpayPaymentId: true,
        advancePaidAt: true,
        craftItemId: true,
        demandId: true,
        demand: { select: { buyerName: true, craftType: true } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }

    if ((order.demand.buyerName || '').toLowerCase() !== buyerName.toLowerCase()) {
      return NextResponse.json(
        { error: 'This order was placed under a different buyer name.' },
        { status: 403 }
      );
    }

    // Idempotent: the Razorpay modal handler can fire twice on a flaky network,
    // and a replayed verification must not record a second advance.
    if (order.advancePaidAt && order.advanceRazorpayPaymentId === paymentId) {
      return NextResponse.json({ success: true, idempotent: true });
    }

    // The signature must belong to the order THIS advance was opened with.
    // Without this, a signature genuinely valid for some other Razorpay order —
    // a ₹10 storefront purchase, say — would settle this advance.
    if (!order.advanceRazorpayOrderId || order.advanceRazorpayOrderId !== orderId) {
      return NextResponse.json(
        { error: 'This payment does not belong to that order.' },
        { status: 400 }
      );
    }

    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
      // Deliberately terse, and deliberately not "invalid signature": a caller
      // probing this endpoint learns nothing about why their forgery failed.
      // Nothing has been written.
      return NextResponse.json({ error: 'Payment could not be verified.' }, { status: 400 });
    }

    const now = new Date();

    // `advancePaidAt: null` in the predicate is the concurrency guard: two
    // overlapping verifications cannot both record the advance and both move the
    // order into production.
    const written = await prisma.artisanOrder.updateMany({
      where: { id: order.id, advancePaidAt: null },
      data: {
        advanceRazorpayPaymentId: paymentId,
        advanceRazorpaySignature: signature,
        advancePaidAt: now,
        advanceChargedPaise: DEMO_ADVANCE_PAISE,
        advanceStatus: 'ADVANCE_PAID',
        // The buyer has paid; work may begin. Monotonic — an order already past
        // IN_PROGRESS is not walked back.
        status: advanceOrderStatus(order.status, 'IN_PROGRESS'),
      },
    });

    if (written.count === 0) {
      // Someone else got there first. Not an error for this buyer.
      return NextResponse.json({ success: true, idempotent: true });
    }

    // ---- Tell both sides. Best-effort, after the write. -------------------
    try {
      await prisma.notification.create({
        data: {
          userId: order.artisanId,
          type: 'ADVANCE_PAID',
          title: `Advance received: ${order.demand.craftType}`,
          // The REAL 40%, never the ₹4 that was charged. And never described as
          // money in the artisan's bank: there is no payout rail on this
          // deployment, so this is a recorded settlement — see src/lib/escrow.ts.
          message: order.advanceDueAmount
            ? `${buyerName} has paid the 40% advance of ${formatRupees(order.advanceDueAmount)}. You can begin work. The amount is recorded as a programmatic settlement, not a confirmed bank credit.`
            : `${buyerName} has paid the advance. You can begin work.`,
          relatedDemandId: order.demandId,
          channel: 'IN_APP',
        },
      });
    } catch (notifyError) {
      console.error('[demand-advance/verify] artisan notification failed:', notifyError);
    }

    await createBuyerNotification({
      buyerName,
      demandId: order.demandId,
      artisanOrderId: order.id,
      type: 'ORDER_ACCEPTED',
      title: 'Advance paid',
      message: order.advanceDueAmount
        ? `Your 40% advance of ${formatRupees(order.advanceDueAmount)} is recorded and the artisan can begin. The balance is due when you confirm delivery.`
        : 'Your advance is recorded and the artisan can begin.',
    });

    // An audit row needs a CraftItem: `AuditLog.craftItemId` is a required FK.
    // Most demand orders have no bound piece until the ready-check runs, and
    // inventing a placeholder item to satisfy the constraint would put a fake
    // row in the provenance ledger. When there is no piece, this is a log line.
    if (order.craftItemId) {
      try {
        await logCraftItemEvent({
          prisma,
          craftItemId: order.craftItemId,
          actorId: 'RAZORPAY_PAYMENT',
          actorRole: 'SYSTEM',
          action: 'DEMAND_ADVANCE_PAID',
          newState: {
            artisanOrderId: order.id,
            orderId,
            paymentId,
            chargedPaise: DEMO_ADVANCE_PAISE,
            displayAdvance: order.advanceDueAmount,
            mode: RAZORPAY_LIVE ? 'LIVE' : 'TEST',
          },
          comments: RAZORPAY_LIVE
            ? 'Razorpay LIVE advance verified against the HMAC signature. A real ₹4 was debited and settles into the platform merchant account; the advance is recorded at the real 40% of the agreed price. The artisan settlement remains a programmatic record, not a bank credit. No admin approved or touched this.'
            : 'Razorpay TEST advance verified against the HMAC signature. The charge is the ₹4 flat demo amount; the advance is recorded at the real 40% of the agreed price. No admin approved or touched this.',
        });
      } catch (auditError) {
        console.error('[demand-advance/verify] audit log failed:', auditError);
      }
    } else {
      console.log(
        `[demand-advance/verify] advance recorded for ArtisanOrder ${order.id} (demand ${order.demandId}); no bound CraftItem yet, so no AuditLog row was written.`
      );
    }

    return NextResponse.json({
      success: true,
      advanceStatus: 'ADVANCE_PAID',
      /** The REAL 40%. */
      displayAdvance: order.advanceDueAmount,
      /** What was actually taken, so the UI can be honest about both. */
      chargedPaise: DEMO_ADVANCE_PAISE,
      paidAt: now.toISOString(),
    });
  } catch (error) {
    console.error('[demand-advance/verify] failed:', error);
    return NextResponse.json({ error: 'Failed to verify the advance payment.' }, { status: 500 });
  }
}
