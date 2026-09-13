import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { getListingPrice } from '@/lib/pricing';
import { advanceFor, creatorCommissionFor, finalSettlementFor } from '@/lib/escrow';
import { PURCHASABLE_WHERE, unpurchasableReason } from '@/lib/storefrontSale';
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
 * ₹10 below is a REAL debit, and it settles into this deployment's own Razorpay
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
 * ₹10 FLAT CHARGE. The Razorpay order is for `DEMO_CHARGE_PAISE`, not the
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
        // For the availability guard below.
        paidAt: true,
        isListedOnMarketplace: true,
        qrVerified: true,
        qrExemptAt: true,
        status: true,
        escrowStatus: true,
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

    /**
     * Is this piece actually for sale?
     *
     * None of this was checked. Two consequences, both reachable from the
     * ordinary storefront, not just by crafting requests:
     *
     *   - A SOLD piece could be checked out again. That overwrote
     *     `razorpayOrderId` on a completed sale, and if two buyers had the
     *     modal open at once, the SECOND checkout's id replaced the first — so
     *     when the first buyer paid, verify-payment compared their order id to
     *     the stored one, found a mismatch, and refused a payment Razorpay had
     *     already taken. Money gone, sale refused.
     *   - An unlisted or unverified piece could be bought by anyone who had its
     *     id, bypassing the QR-patch check that is the whole point of listing.
     *
     * Every storefront and demand-match route only ever shows pieces that are
     * listed, so requiring it here refuses nothing a real buyer could reach.
     */
    // The same rule the storefront grid filters by (PURCHASABLE_WHERE), so the
    // grid can never offer a piece this refuses. `paidAt` alone missed pieces
    // sold and settled through the escrow engine without it.
    const reason = unpurchasableReason(item);
    if (reason === 'sold') {
      return NextResponse.json(
        { error: 'This piece has already been sold.', sold: true },
        { status: 409 }
      );
    }
    if (reason === 'unavailable') {
      return NextResponse.json(
        {
          error: item.isListedOnMarketplace
            ? 'This piece is waiting for its artisan to finish verifying its QR patch, so it cannot be bought yet.'
            : 'This piece is not available for sale.',
          unavailable: true,
        },
        { status: 409 }
      );
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
        // ₹10, deliberately. The displayed price rides along in `notes` so the
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

    // `paidAt: null` in the predicate: if another buyer's payment was verified
    // in the moments since the guard above ran, this checkout must not overwrite
    // the order id of a completed sale. Zero rows updated means exactly that.
    const staged = await prisma.craftItem.updateMany({
      where: { id: item.id, AND: [PURCHASABLE_WHERE] },
      data: {
        razorpayOrderId: order.id,
        // NOT `escrowStatus: ESCROW_HELD`. This runs when the buyer merely
        // OPENS the Razorpay modal — nothing has been paid. Writing ESCROW_HELD
        // here meant every abandoned checkout left an unpaid piece reading as
        // money held in escrow: the stage ladder showed it IN_PRODUCTION, and
        // the settlement engine's only precondition for releasing a 40%
        // advance was that very value. It is written by verify-payment, in the
        // same transaction that records the verified payment.
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
    if (staged.count === 0) {
      // The Razorpay order exists but points at a piece that just sold. It is
      // never shown to the buyer, so it is never paid; Razorpay expires unpaid
      // orders on its own.
      return NextResponse.json(
        { error: 'This piece has just been sold.', sold: true },
        { status: 409 }
      );
    }

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: 'RAZORPAY_ORDER',
      actorRole: 'SYSTEM',
      // CHECKOUT_OPENED, not ESCROW_HELD: a modal opening moves no money, and
      // an audit trail that says escrow was held when nobody paid is the one
      // record in this app that must never overstate what happened. The
      // ESCROW_HELD entry is written by verify-payment on a proven payment.
      action: 'CHECKOUT_OPENED',
      newState: {
        orderId: order.id,
        price,
        chargedPaise: DEMO_CHARGE_PAISE,
        mode: RAZORPAY_LIVE ? 'LIVE' : 'TEST',
        ...(affiliate ? { affiliateHandle: affiliate.handle, affiliateCommission } : {}),
      },
      comments: RAZORPAY_LIVE
        ? 'Buyer opened a Razorpay LIVE checkout. No money has moved yet — this is the modal opening, and the buyer may still close it. The artisan VPA on file is snapshotted as the settlement destination and the escrow tranches are quoted from the displayed price. Escrow is held only once the payment is verified.'
        : 'Buyer opened a Razorpay TEST checkout. No money has moved yet — this is the modal opening, and the buyer may still close it. The artisan VPA on file is snapshotted as the payout destination and the escrow tranches are quoted from the displayed price. Escrow is held only once the payment is verified.',
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
