import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { getListingPrice } from '@/lib/pricing';
import {
  DEMO_CHARGE_PAISE,
  RAZORPAY_CONFIGURED,
  RAZORPAY_LIVE,
  verifyRazorpaySignature,
} from '@/lib/razorpay';

/**
 * Direct-to-artisan checkout — step 2 of 2: prove the payment happened.
 *
 * THIS IS THE TRUST BOUNDARY. Everything up to here came from the browser and
 * is worth nothing on its own: anyone can POST a made-up payment id. What makes
 * a sale real is the HMAC signature Razorpay computes over
 * `<order_id>|<payment_id>` with the key secret, which only the server holds.
 * Nothing below the signature check writes a single field, and a mismatch is a
 * 400 with the item left exactly as it was.
 *
 * Two further checks, both cheap and both load-bearing:
 *
 *   - the order id must be the one THIS item was checked out with, so a ₹1
 *     payment for a cheap piece cannot be replayed against an expensive one;
 *   - re-verifying a payment already recorded is a no-op success, so a double
 *     submit from the modal handler cannot double-write the sale.
 *
 * The buyer's identity is free text. The storefront is unauthenticated — buyers
 * have no account in this app — so the name captured at the modal is what
 * `/api/buyer/orders` looks their orders up by, exactly as the demand board
 * already does with `Demand.buyerName`.
 */
export const dynamic = 'force-dynamic';

/** Free-text buyer fields, trimmed and length-capped. Null when not supplied. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const orderId = typeof body?.razorpay_order_id === 'string' ? body.razorpay_order_id : '';
    const paymentId = typeof body?.razorpay_payment_id === 'string' ? body.razorpay_payment_id : '';
    const signature = typeof body?.razorpay_signature === 'string' ? body.razorpay_signature : '';
    const craftItemId = typeof body?.craftItemId === 'string' ? body.craftItemId : '';

    if (!orderId || !paymentId || !signature || !craftItemId) {
      return NextResponse.json(
        { error: 'razorpay_order_id, razorpay_payment_id, razorpay_signature and craftItemId are all required.' },
        { status: 400 }
      );
    }

    if (!RAZORPAY_CONFIGURED) {
      return NextResponse.json(
        { error: 'Razorpay is not configured on this deployment, so no payment can be verified.' },
        { status: 503 }
      );
    }

    const item = await prisma.craftItem.findUnique({
      where: { id: craftItemId },
      select: {
        id: true,
        status: true,
        razorpayOrderId: true,
        razorpayPaymentId: true,
        paidAt: true,
        salePrice: true,
        askingPrice: true,
        standardMarketPrice: true,
        fairWageFloor: true,
        buyerName: true,
        relatedDemandId: true,
      },
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Idempotent: the modal handler can fire twice on a flaky network, and a
    // replayed verification must not write a second sale.
    if (item.paidAt && item.razorpayPaymentId === paymentId) {
      return NextResponse.json({ success: true, idempotent: true });
    }

    // The payment has to belong to the order this item was checked out with.
    if (item.razorpayOrderId !== orderId) {
      return NextResponse.json(
        { error: 'This payment does not belong to that piece.' },
        { status: 400 }
      );
    }

    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
      // Deliberately terse, and deliberately not "invalid signature": a caller
      // probing this endpoint learns nothing about why their forgery failed.
      // Nothing has been written — the item is untouched and still unsold.
      return NextResponse.json({ error: 'Payment could not be verified.' }, { status: 400 });
    }

    const buyerName = text(body?.buyerName, 120);
    const buyerContact = text(body?.buyerContact, 60);
    const relatedDemandId = text(body?.relatedDemandId, 64);

    // The DISPLAYED price, not the ₹1 that was actually charged. Every earnings
    // and escrow figure downstream reads `salePrice`, so this is what keeps the
    // artisan's numbers real while the demo charge stays at one rupee.
    const displayPrice = item.salePrice ?? getListingPrice(item);

    await prisma.$transaction(async (tx) => {
      await tx.craftItem.update({
        where: { id: item.id },
        data: {
          razorpayPaymentId: paymentId,
          razorpaySignature: signature,
          paidAt: new Date(),
          paidAmountPaise: DEMO_CHARGE_PAISE,
          status: 'SOLD_FINAL',
          salePrice: displayPrice,
          // The artisan has a committed order to start on. The ladder itself is
          // derived — `escrowStatus` is already ESCROW_HELD, which reads as
          // IN_PRODUCTION — so this only ever moves a piece forward.
          productionStage: 'ACCEPTED',
          buyerName,
          buyerContact,
          relatedDemandId,
        },
      });

      if (relatedDemandId) {
        const demand = await tx.demand.findUnique({
          where: { id: relatedDemandId },
          select: { id: true, quantity: true, status: true },
        });

        if (demand) {
          // Count what has actually been paid for against this request, this
          // purchase included. Nothing is inferred: a demand only reaches
          // FULFILLED when that many pieces carry a verified payment.
          const paidForDemand = await tx.craftItem.count({
            where: { relatedDemandId: demand.id, paidAt: { not: null } },
          });

          const next = paidForDemand >= demand.quantity ? 'FULFILLED' : 'MATCHED';
          // Never walk a demand backwards — a FULFILLED request stays fulfilled.
          if (demand.status !== 'FULFILLED' && demand.status !== next) {
            await tx.demand.update({ where: { id: demand.id }, data: { status: next } });
          }
        }
      }

      await logCraftItemEvent({
        prisma: tx,
        craftItemId: item.id,
        actorId: 'RAZORPAY_PAYMENT',
        actorRole: 'SYSTEM',
        action: 'PAYMENT_VERIFIED',
        previousState: { status: item.status, paidAt: null },
        newState: {
          orderId,
          paymentId,
          chargedPaise: DEMO_CHARGE_PAISE,
          mode: RAZORPAY_LIVE ? 'LIVE' : 'TEST',
          displayPrice,
          buyerName,
          relatedDemandId,
        },
        comments: RAZORPAY_LIVE
          ? "Razorpay LIVE payment verified against the HMAC signature and recorded. A real ₹1 was debited and settles into the platform merchant account; the sale is booked at the displayed price so the artisan's escrow tranches and earnings are unchanged. The artisan payout itself remains a programmatic settlement record, not a bank credit. No admin approved or touched this."
          : "Razorpay TEST payment verified against the HMAC signature and recorded. The charge is the ₹1 flat amount; the sale is booked at the displayed price so the artisan's escrow tranches and earnings are unchanged. No admin approved or touched this.",
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Verify payment error:', error);
    return NextResponse.json({ error: 'Failed to verify the payment' }, { status: 500 });
  }
}
