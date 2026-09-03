import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { getListingPrice } from '@/lib/pricing';
import { ESCROW_HELD, advanceFor, creatorCommissionFor, finalSettlementFor } from '@/lib/escrow';
import { slugifyHandle } from '@/lib/creators';
import {
  DEMO_CHARGE_PAISE,
  RAZORPAY_CONFIGURED,
  RAZORPAY_KEY_ID,
  RAZORPAY_LIVE,
  getRazorpay,
} from '@/lib/razorpay';

/**
 * Direct-to-artisan checkout — step 1 of 2: create the Razorpay order.
 *
 * Public by design: the caller is a consumer on the storefront, not a logged-in
 * user of this app. The artisan's own VPA is snapshotted onto the row as the
 * payout destination before a single rupee moves.
 *
 * MODE. With an `rzp_test_` key nothing is charged. With an `rzp_live_` key the
 * ₹1 below is a REAL debit, and it settles into this deployment's own Razorpay
 * merchant account — it does not reach the artisan's VPA, which is a settlement
 * record rather than a payout rail. Which mode ran is written into the audit
 * trail, so one kind of row can never be mistaken for the other afterwards.
 *
 * This route does NOT mark anything sold. It opens the escrow hold and hands
 * the browser an order id; the sale is only recorded once
 * `/api/payments/verify-payment` has checked Razorpay's own HMAC signature.
 *
 * No admin or facilitator participates. Nothing here queues an approval; the
 * two tranches are released later by `/api/payments/settle-escrow`, which is
 * triggered by dispatch and delivery events.
 *
 * ₹1 FLAT CHARGE. The Razorpay order is for `DEMO_CHARGE_PAISE`, not the
 * listing price — see src/lib/razorpay.ts for why and how to revert it. Every
 * number written to the row below (advance, settlement, commission) is still
 * computed from the real displayed price, so the escrow ladder and the
 * artisan's earnings are unaffected by the charged amount.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const craftItemId = typeof body?.craftItemId === 'string' ? body.craftItemId : null;
    // The creator handle the buyer arrived through, if any. Optional by
    // definition: most sales have no affiliate at all.
    const ref = slugifyHandle(typeof body?.ref === 'string' ? body.ref : '');
    if (!craftItemId) {
      return NextResponse.json({ error: 'craftItemId is required.' }, { status: 400 });
    }

    if (!RAZORPAY_CONFIGURED) {
      // Say so plainly rather than letting Razorpay return an auth error the
      // buyer cannot act on. The rest of the storefront still works.
      return NextResponse.json(
        {
          error:
            'Razorpay test checkout is not configured on this deployment. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable it.',
        },
        { status: 503 }
      );
    }

    const item = await prisma.craftItem.findUnique({
      where: { id: craftItemId },
      select: {
        id: true,
        artisanId: true,
        craftType: true,
        images: true,
        askingPrice: true,
        salePrice: true,
        standardMarketPrice: true,
        fairWageFloor: true,
        artisan: {
          select: {
            name: true,
            artisanProfile: { select: { upiId: true } },
          },
        },
      },
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const price = item.salePrice ?? getListingPrice(item);
    if (price === null || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json(
        { error: 'This item has no price yet, so it cannot be bought.' },
        { status: 409 }
      );
    }

    const artisanUpi = item.artisan.artisanProfile?.upiId ?? '';

    // Resolve the referral before Razorpay, so the handle in the order notes is
    // one that actually exists. An unknown or deactivated handle is simply no
    // affiliate — it never blocks a purchase.
    const creator = ref
      ? await prisma.creator.findUnique({
          where: { handle: ref },
          select: { id: true, handle: true, status: true },
        })
      : null;
    const affiliate = creator && creator.status === 'ACTIVE' ? creator : null;
    // Funded from the platform side of the split (see src/lib/escrow.ts). The
    // artisan's 40% advance and ~49.36% settlement are not reduced by a rupee.
    const affiliateCommission = affiliate ? creatorCommissionFor(price) : null;

    let order;
    try {
      order = await getRazorpay().orders.create({
        // ₹1, deliberately. The displayed price rides along in `notes` so the
        // dashboard shows what the piece is really listed at.
        amount: DEMO_CHARGE_PAISE,
        currency: 'INR',
        // Razorpay caps this at 40 characters; a uuid is 36.
        receipt: item.id,
        notes: {
          craftItemId: item.id,
          artisanId: item.artisanId,
          artisanUpi,
          displayPrice: String(price),
          // Tags the collection as an escrow hold rather than a plain sale, so
          // the Razorpay dashboard reads the same story as the audit trail.
          // Descriptive only — the hold is enforced by `escrowStatus` and
          // /api/payments/settle-escrow, not by this string.
          escrowStage: 'HELD_IN_NODAL_ESCROW',
          ...(affiliate
            ? {
                affiliateHandle: affiliate.handle,
                affiliateCommission: String(affiliateCommission),
              }
            : {}),
        },
      });
    } catch (error) {
      console.error('Razorpay order create failed:', error);
      return NextResponse.json(
        { error: 'Razorpay could not open a payment for this piece. Please try again.' },
        { status: 500 }
      );
    }

    const advanceAmount = advanceFor(price);
    const finalSettlementAmount = finalSettlementFor(price);

    await prisma.craftItem.update({
      where: { id: item.id },
      data: {
        razorpayOrderId: order.id,
        escrowStatus: ESCROW_HELD,
        artisanUpiDestination: artisanUpi || null,
        advanceAmount,
        finalSettlementAmount,
        // Precomputed here so the commission quoted to the creator is the
        // commission settle-escrow releases, even if the listing price changes
        // afterwards.
        affiliateCreatorId: affiliate?.id ?? null,
        affiliateHandle: affiliate?.handle ?? null,
        affiliateCommission,
      },
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: 'RAZORPAY_ORDER',
      actorRole: 'SYSTEM',
      action: 'ESCROW_HELD',
      newState: {
        orderId: order.id,
        price,
        chargedPaise: DEMO_CHARGE_PAISE,
        mode: RAZORPAY_LIVE ? 'LIVE' : 'TEST',
        ...(affiliate ? { affiliateHandle: affiliate.handle, affiliateCommission } : {}),
      },
      comments: RAZORPAY_LIVE
        ? 'Buyer opened a Razorpay LIVE payment — a real ₹1 debit, settling into the platform merchant account rather than the artisan VPA. Funds are held in escrow; the artisan VPA on file is locked in as the settlement destination. No admin can release or redirect this. Every escrow figure is computed from the displayed price.'
        : 'Buyer opened a Razorpay TEST payment. Funds are held in escrow; the artisan VPA on file is locked in as the payout destination. No admin can release or redirect this. The charge is ₹1 — every escrow figure is computed from the displayed price.',
    });

    return NextResponse.json({
      success: true,
      orderId: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      // The PUBLIC key id. The secret stays on the server; see src/lib/razorpay.ts.
      keyId: RAZORPAY_KEY_ID,
      item: {
        id: item.id,
        craftType: item.craftType,
        artisanName: item.artisan.name,
      },
    });
  } catch (error) {
    console.error('Create order error:', error);
    return NextResponse.json({ error: 'Failed to start checkout' }, { status: 500 });
  }
}
