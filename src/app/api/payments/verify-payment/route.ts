import { NextResponse, after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { getListingPrice } from '@/lib/pricing';
import { buyerNotificationCopy, createBuyerNotification } from '@/lib/buyerNotify';
import { advanceDemandStatus, advanceOrderStatus } from '@/lib/orderStage';
import { ESCROW_HELD, creatorCommissionFor } from '@/lib/escrow';
import { SETTLED_ESCROW, SOLD_STATUSES, unpurchasableReason } from '@/lib/storefrontSale';
import { SHOPIFY_CONFIGURED, withdrawSoldPiece } from '@/lib/shopify';
import {
  DEMO_CHARGE_PAISE,
  RAZORPAY_CONFIGURED,
  RAZORPAY_LIVE,
  getRazorpay,
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
 *   - the order id must be the one THIS item was checked out with, so a ₹10
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

    // The signature FIRST, before a single row is read. It needs nothing but the
    // three values in the body, and until it passes nothing else in this request
    // is worth acting on — in particular, the "already sold" branch below writes
    // an audit row, and a forged request must not be able to spam that trail.
    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
      // Deliberately terse, and deliberately not "invalid signature": a caller
      // probing this endpoint learns nothing about why their forgery failed.
      return NextResponse.json({ error: 'Payment could not be verified.' }, { status: 400 });
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
        affiliateHandle: true,
        escrowStatus: true,
        isListedOnMarketplace: true,
        qrVerified: true,
        // For the artisan's purchase alert, which before V9 was never written
        // at all — the maker had no way of learning a piece had sold.
        artisanId: true,
        craftType: true,
        artisan: { select: { name: true } },
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

    /**
     * Does this payment belong to THIS piece?
     *
     * The stored `razorpayOrderId` is the fast answer, but it is not the whole
     * answer: it is overwritten every time a buyer opens checkout, so two
     * buyers with the modal open at once leave the SECOND one's id on the row.
     * The first buyer then pays, their order id no longer matches, and the old
     * route refused a payment Razorpay had already taken.
     *
     * So a mismatch is not a refusal; it is a question put to Razorpay. The
     * order was created with `receipt` and `notes.craftItemId` set to this
     * piece, and the signature above has already proved this payment belongs to
     * that order. If Razorpay says the order is for this piece, it is.
     *
     * This still stops the attack the original check existed for — replaying a
     * cheap piece's payment against an expensive one — because that order's
     * receipt names the cheap piece.
     */
    let boundOrderNotes: Record<string, string | number> | null = null;
    if (item.razorpayOrderId !== orderId) {
      let belongs = false;
      try {
        const rzpOrder = await getRazorpay().orders.fetch(orderId);
        const notes = (rzpOrder.notes ?? {}) as Record<string, string | number>;
        belongs = rzpOrder.receipt === item.id || String(notes.craftItemId ?? '') === item.id;
        if (belongs) boundOrderNotes = notes;
      } catch (fetchError) {
        console.error('[verify-payment] could not fetch the Razorpay order to bind it:', fetchError);
      }
      if (!belongs) {
        return NextResponse.json(
          { error: 'This payment does not belong to that piece.' },
          { status: 400 }
        );
      }
    }

    const buyerName = text(body?.buyerName, 120);
    const buyerContact = text(body?.buyerContact, 60);
    const relatedDemandId = text(body?.relatedDemandId, 64);

    // The DISPLAYED price, not the ₹10 that was actually charged. Every earnings
    // and escrow figure downstream reads `salePrice`, so this is what keeps the
    // artisan's numbers real while the demo charge stays at the flat demo amount.
    const displayPrice = item.salePrice ?? getListingPrice(item);

    /**
     * A real payment for a piece someone else has already bought.
     *
     * Reachable when two buyers paid within moments of each other. The
     * signature is valid and Razorpay has the money, so this is NOT a forgery
     * and must never be answered like one. It is recorded on the audit trail as
     * needing a refund — by the payment id, which is what a refund is issued
     * against — and the buyer is told plainly, rather than being shown a generic
     * verification failure for money that visibly left their account.
     */
    const alreadySold = async () => {
      console.error(
        `[verify-payment] REFUND REQUIRED: payment ${paymentId} (order ${orderId}) is for piece ${item.id}, which was already sold.`
      );
      try {
        await logCraftItemEvent({
          prisma,
          craftItemId: item.id,
          actorId: 'RAZORPAY_PAYMENT',
          actorRole: 'SYSTEM',
          action: 'DUPLICATE_PAYMENT_REFUND_REQUIRED',
          newState: { orderId, paymentId, chargedPaise: DEMO_CHARGE_PAISE, buyerName },
          comments:
            'A second, genuine payment arrived for a piece that had already been sold to another buyer. The signature verified, so money has moved. This payment was NOT recorded as a sale and must be refunded against the payment id above.',
        });
      } catch (auditError) {
        console.error('[verify-payment] could not record the refund-required entry:', auditError);
      }
      return NextResponse.json(
        {
          error:
            'Someone else bought this piece moments before your payment went through. Your payment was received and will be refunded in full.',
          sold: true,
          refundRequired: true,
          paymentId,
        },
        { status: 409 }
      );
    };

    // `paidAt` is not the only sign of a sale: a piece settled through the
    // escrow engine can carry SOLD_FINAL and STAGE2_SETTLED_89 with no paidAt.
    // Recording a second sale over one of those would reset its ledger to held.
    if (unpurchasableReason(item) === 'sold') return alreadySold();

    /**
     * Attribution, when this payment's order is not the one on the row.
     *
     * A later checkout that overwrote the order id also overwrote the affiliate
     * and payout snapshot. The Razorpay order's notes are the immutable record
     * of what THIS buyer checked out under, and the signature binds the payment
     * to them, so they win.
     */
    const restored: {
      artisanUpiDestination?: string | null;
      affiliateCreatorId?: string | null;
      affiliateHandle?: string | null;
      affiliateCommission?: number | null;
    } = {};
    if (boundOrderNotes) {
      const upi = String(boundOrderNotes.artisanUpi ?? '').trim();
      restored.artisanUpiDestination = upi || null;
      const handle = String(boundOrderNotes.affiliateHandle ?? '').trim();
      if (handle) {
        const creator = await prisma.creator.findUnique({
          where: { handle },
          select: { id: true, handle: true, status: true },
        });
        const active = creator && creator.status === 'ACTIVE' ? creator : null;
        restored.affiliateCreatorId = active?.id ?? null;
        restored.affiliateHandle = active?.handle ?? null;
        restored.affiliateCommission =
          active && displayPrice !== null ? creatorCommissionFor(displayPrice) : null;
      } else {
        restored.affiliateCreatorId = null;
        restored.affiliateHandle = null;
        restored.affiliateCommission = null;
      }
    }

    /** Thrown inside the transaction when another payment won the race. */
    class SoldDuringVerify extends Error {}

    try {
      await prisma.$transaction(async (tx) => {
        // updateMany with `paidAt: null` is the concurrency guard. Two genuine
        // payments verifying at the same instant cannot both record a sale: one
        // write matches, the other matches zero rows and rolls the whole
        // transaction back — demand counts and order bindings included.
        const recorded = await tx.craftItem.updateMany({
          // Not sold by ANY route, checked atomically with the write — see
          // SOLD_STATUSES and the null-safe escrow clause in storefrontSale.ts.
          where: {
            id: item.id,
            paidAt: null,
            status: { notIn: [...SOLD_STATUSES] },
            OR: [{ escrowStatus: null }, { escrowStatus: { notIn: [...SETTLED_ESCROW] } }],
          },
          data: {
            razorpayPaymentId: paymentId,
            razorpaySignature: signature,
            // The order this payment was actually made against. Restores it when
            // a later checkout had overwritten the row.
            razorpayOrderId: orderId,
            paidAt: new Date(),
            paidAmountPaise: DEMO_CHARGE_PAISE,
            status: 'SOLD_FINAL',
            salePrice: displayPrice,
            // HELD NOW, and only now. create-order used to write this when the
            // modal merely opened, so an abandoned checkout read as money in
            // escrow. It is true from this line onwards and not a moment before.
            escrowStatus: ESCROW_HELD,
            // One of a kind: once paid for it comes off the storefront, so no
            // other buyer is offered a checkout for a piece that no longer exists.
            isListedOnMarketplace: false,
            productionStage: 'ACCEPTED',
            buyerName,
            buyerContact,
            relatedDemandId,
            ...restored,
          },
        });
        if (recorded.count === 0) throw new SoldDuringVerify();

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

            const next = advanceDemandStatus(
              demand.status,
              paidForDemand >= demand.quantity ? 'FULFILLED' : 'MATCHED'
            );
            // Never walk a demand backwards — a FULFILLED request stays fulfilled.
            if (next !== demand.status) {
              await tx.demand.update({ where: { id: demand.id }, data: { status: next } });
            }

            // Bind the purchase to the artisan's commitment. Without this the
            // order and the piece stay strangers, and the buyer's later scan can
            // only ask "did this artisan take this demand" rather than "is this
            // the piece". Only an unbound order is touched: a piece already bound
            // by the ready-check is the authoritative answer and is left alone.
            const commitment = await tx.artisanOrder.findFirst({
              where: { demandId: demand.id, artisanId: item.artisanId },
              select: { id: true, status: true, craftItemId: true },
            });
            if (commitment) {
              await tx.artisanOrder.update({
                where: { id: commitment.id },
                data: {
                  ...(commitment.craftItemId ? {} : { craftItemId: item.id }),
                  status: advanceOrderStatus(commitment.status, 'IN_PROGRESS'),
                },
              });
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
            // Escrow is held from this commit onward. This entry is now the
            // record of that, since checkout-open no longer claims it.
            escrowStatus: ESCROW_HELD,
            // True when a later checkout had overwritten the order id and this
            // payment was bound by asking Razorpay rather than by the row.
            reboundFromRazorpayOrder: Boolean(boundOrderNotes),
          },
          comments: RAZORPAY_LIVE
            ? "Razorpay LIVE payment verified against the HMAC signature and recorded. A real ₹10 was debited and settles into the platform merchant account; the sale is booked at the displayed price so the artisan's escrow tranches and earnings are unchanged. The artisan payout itself remains a programmatic settlement record, not a bank credit. No admin approved or touched this."
            : "Razorpay TEST payment verified against the HMAC signature and recorded. The charge is the ₹10 flat amount; the sale is booked at the displayed price so the artisan's escrow tranches and earnings are unchanged. No admin approved or touched this.",
        });
      });
    } catch (error) {
      if (error instanceof SoldDuringVerify) return alreadySold();
      throw error;
    }

    // V11: a one-of-a-kind piece that is also live on the artisan's Shopify shop
    // must come off it now that it has sold here. `after()` runs once the buyer's
    // response is sent, so their confirmation never waits on Shopify, and
    // withdrawSoldPiece() never throws. A no-op for a piece never published.
    if (SHOPIFY_CONFIGURED) after(() => withdrawSoldPiece(item.id));

    // ---- Tell both sides. -------------------------------------------------
    //
    // Before V9 a verified payment wrote the item, the demand and an AuditLog,
    // and told NOBODY: the artisan had no signal that a piece had sold and
    // needed packing, and the buyer had nothing but the confirmation screen.
    //
    // Deliberately outside the transaction and individually guarded. The
    // payment is real and recorded the moment the block above commits; a
    // notification that fails to write must never turn that into an error page
    // for a buyer whose money has already moved. Same rule as the demand
    // fan-out in POST /api/demand.
    try {
      await prisma.notification.create({
        data: {
          userId: item.artisanId,
          type: 'PURCHASE',
          title: `Sold: ${item.craftType}`,
          // The DISPLAYED price. `paidAmountPaise` is the ₹10 demo charge and
          // must never be presented as what the piece went for.
          message:
            `${buyerName || 'A buyer'} has paid for your ${item.craftType}` +
            (displayPrice ? ` at ₹${Math.round(displayPrice).toLocaleString('en-IN')}` : '') +
            '. Pack it and mark it dispatched from your Orders page.',
          relatedDemandId,
          channel: 'IN_APP',
        },
      });
    } catch (notifyError) {
      console.error('Purchase notification failed:', notifyError);
    }

    // The buyer alert needs a demand to hang from — see the note on
    // BuyerNotification.demandId. A plain storefront purchase has none, and
    // gets the confirmation screen it already had rather than a synthetic
    // demand invented to carry a row.
    if (relatedDemandId) {
      await createBuyerNotification({
        buyerName,
        demandId: relatedDemandId,
        type: 'PURCHASE_CONFIRMED',
        ...buyerNotificationCopy.purchaseConfirmed(
          item.craftType,
          item.artisan.name,
          displayPrice
        ),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Verify payment error:', error);
    return NextResponse.json({ error: 'Failed to verify the payment' }, { status: 500 });
  }
}
