import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/authSession';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { STAGE1_ADVANCE_PAID_40 } from '@/lib/escrow';
import { settleEscrow } from '@/lib/escrowSettle';
import { contactsMatch } from '@/lib/storefrontSale';

/**
 * The buyer confirms a storefront piece arrived. Releases the final settlement.
 *
 * The storefront counterpart to /api/buyer/orders/delivered, which only ever
 * handled demand orders — the buyer's Confirm Delivery button was rendered
 * behind `order.demandId &&`, so a storefront buyer had no way to say the piece
 * had arrived, and the artisan's final ~49% was never released.
 *
 * WHO MAY CALL THIS, and how honest that answer is. Buyers have no accounts in
 * this app (see src/lib/buyerIdentity.ts, which says plainly that the buyer's
 * name is "a convenience, not an authentication"). So this cannot prove the
 * caller IS the buyer. What it does instead is make the one party with a motive
 * to confirm falsely — the ARTISAN, whose own payment this releases — unable to:
 *
 *   1. A signed-in artisan cannot confirm delivery of their own sale.
 *   2. When the buyer left a contact at checkout, the same contact is required
 *      here. The artisan sees the buyer's NAME on their Orders page but never
 *      their contact — only admins can see that — so knowing the name is not
 *      enough. Checkout now asks for a contact, so every new sale has one.
 *   3. The piece must already have been dispatched. Nothing can be confirmed
 *      received that the artisan has not recorded sending.
 *
 * A sale from before checkout asked for a contact falls back to the name alone,
 * which is exactly as strong as the existing demand-order confirmation.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      craftItemId?: unknown;
      buyerName?: unknown;
      buyerContact?: unknown;
    };
    const craftItemId = typeof body.craftItemId === 'string' ? body.craftItemId.trim() : '';
    const buyerName = typeof body.buyerName === 'string' ? body.buyerName.trim() : '';
    const buyerContact = typeof body.buyerContact === 'string' ? body.buyerContact.trim() : '';

    if (!craftItemId || !buyerName) {
      return NextResponse.json(
        { error: 'craftItemId and buyerName are required.' },
        { status: 400 }
      );
    }

    const item = await prisma.craftItem.findUnique({
      where: { id: craftItemId },
      select: {
        id: true,
        artisanId: true,
        craftType: true,
        paidAt: true,
        dispatchedAt: true,
        deliveredAt: true,
        escrowStatus: true,
        buyerName: true,
        buyerContact: true,
        _count: { select: { artisanOrders: true } },
      },
    });

    // One message for "no such piece", "not sold" and "not your purchase": a
    // caller guessing ids learns nothing about which pieces have sold, or to whom.
    const notFound = NextResponse.json({ error: 'No purchase of yours matches that.' }, { status: 404 });
    if (!item || !item.paidAt) return notFound;
    if ((item.buyerName || '').toLowerCase() !== buyerName.toLowerCase()) return notFound;
    if (item.buyerContact && !contactsMatch(item.buyerContact, buyerContact)) {
      return NextResponse.json(
        {
          error: 'Enter the phone number or email you gave when you bought this piece.',
          contactRequired: true,
        },
        { status: 403 }
      );
    }

    // The artisan may not release their own final payment.
    const session = await getSession();
    if (session && session.userId === item.artisanId) {
      return NextResponse.json(
        { error: 'The artisan who sold this piece cannot confirm its delivery.' },
        { status: 403 }
      );
    }

    if (item._count.artisanOrders > 0) {
      return NextResponse.json(
        { error: 'This piece was part of a demand order. Confirm delivery from that order.' },
        { status: 409 }
      );
    }
    if (!item.dispatchedAt) {
      return NextResponse.json(
        { error: 'The artisan has not dispatched this piece yet.' },
        { status: 409 }
      );
    }

    const now = new Date();

    // Claim first, then settle — the same shape as dispatch, for the same
    // reason: the conditional update is atomic, so a double tap releases once.
    const claimed = await prisma.craftItem.updateMany({
      where: { id: item.id, dispatchedAt: { not: null }, deliveredAt: null },
      data: { deliveredAt: now, stageUpdatedAt: now },
    });
    const claimedNow = claimed.count > 0;
    let deliveredAt = now;

    if (!claimedNow) {
      // Already confirmed. Recover an interrupted confirmation whose settlement
      // never released (recorded as delivered, escrow still at the advance), so
      // the artisan is not left waiting for money the buyer already released.
      if (item.escrowStatus !== STAGE1_ADVANCE_PAID_40) {
        return NextResponse.json({
          success: true,
          alreadyConfirmed: true,
          deliveredAt: item.deliveredAt?.toISOString() ?? null,
        });
      }
      if (item.deliveredAt) deliveredAt = item.deliveredAt;
    }

    const settlement = await settleEscrow(item.id, 'DELIVERED');

    if (!settlement.ok) {
      if (claimedNow) {
        await prisma.craftItem.updateMany({
          where: { id: item.id, deliveredAt: now },
          data: { deliveredAt: null },
        });
      }
      return NextResponse.json(
        {
          error: `Delivery was not recorded because the artisan's payment could not be released: ${settlement.error}`,
          stage: settlement.stage,
        },
        { status: settlement.status }
      );
    }

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: 'BUYER',
      actorRole: 'BUYER',
      action: 'SALE_DELIVERY_CONFIRMED',
      previousState: { deliveredAt: null },
      newState: {
        deliveredAt: deliveredAt.toISOString(),
        buyerName,
        contactVerified: Boolean(item.buyerContact),
        finalSettlement: settlement.paid,
        recoveredInterruptedConfirmation: !claimedNow,
      },
      comments: item.buyerContact
        ? 'Buyer confirmed receipt, matching the name and contact recorded at checkout. The final settlement was released.'
        : 'Buyer confirmed receipt by name only — this sale predates checkout asking for a contact. The final settlement was released.',
    });

    // Best-effort and after the money moved: an alert that fails to write must
    // never turn a released settlement into an error for the buyer.
    try {
      await prisma.notification.create({
        data: {
          userId: item.artisanId,
          type: 'ORDER_DELIVERED',
          title: `Delivered: ${item.craftType}`,
          message:
            // The name recorded at purchase, not the one typed just now: the
            // match above is case-insensitive, so "kg test buyer" confirming a
            // sale made by "KG Test Buyer" should still read as the buyer.
            `${item.buyerName || buyerName} has confirmed your ${item.craftType} arrived. ` +
            `₹${Math.round(settlement.paid).toLocaleString('en-IN')} final settlement ` +
            (settlement.payoutReal
              ? 'has been sent to your UPI.'
              : 'has been recorded to your earnings.'),
          channel: 'IN_APP',
        },
      });
    } catch (notifyError) {
      console.error('[buyer/sales/delivered] artisan notification failed:', notifyError);
    }

    return NextResponse.json({
      success: true,
      deliveredAt: deliveredAt.toISOString(),
      // Deliberately not the amount: that is between the artisan and the ledger,
      // and this response goes to whoever typed a name.
    });
  } catch (error) {
    console.error('[buyer/sales/delivered] failed:', error);
    return NextResponse.json({ error: 'Could not confirm delivery.' }, { status: 500 });
  }
}
