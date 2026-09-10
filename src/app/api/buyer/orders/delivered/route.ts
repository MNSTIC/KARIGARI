import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buyerNotificationCopy, createBuyerNotification } from '@/lib/buyerNotify';
import { advanceDemandStatus, advanceOrderStatus } from '@/lib/orderStage';

/**
 * Buyer confirms a demand's goods reached them.
 *
 * Two effects, in one transaction:
 *   1. Demand → status='FULFILLED', deliveredAt = now.
 *   2. Every accepted ArtisanOrder on that demand that has NOT yet been
 *      credited is credited the on-screen agreed price:
 *         settledAmount = negotiatedPrice ?? targetPriceMax ?? targetPriceMin ?? 0
 *         settledAt     = now
 *         status        = 'COMPLETED'
 *
 * Public, like the buyer board — buyers have no JWT, so identity is the same
 * free-text `buyerName` the demand was posted under; we check it matches
 * (case-insensitive) so one buyer cannot mark another's demand delivered.
 *
 * Idempotent: a second "delivered" click short-circuits on `deliveredAt`;
 * credits guarded on `settledAt IS NULL` so re-entrant paths cannot
 * double-credit either.
 *
 * NEVER writes an AuditLog row here — AuditLog.craftItemId is a required FK
 * and a demand order has no natural CraftItem link. Console log only.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      demandId?: unknown;
      buyerName?: unknown;
    };
    const demandId = typeof body.demandId === 'string' ? body.demandId.trim() : '';
    const buyerName = typeof body.buyerName === 'string' ? body.buyerName.trim() : '';

    if (!demandId || !buyerName) {
      return NextResponse.json(
        { error: 'demandId and buyerName are required.' },
        { status: 400 }
      );
    }

    const demand = await prisma.demand.findUnique({
      where: { id: demandId },
      select: {
        id: true,
        buyerName: true,
        craftType: true,
        status: true,
        deliveredAt: true,
        targetPriceMin: true,
        targetPriceMax: true,
      },
    });
    if (!demand) {
      return NextResponse.json({ error: 'Demand not found.' }, { status: 404 });
    }
    if ((demand.buyerName || '').toLowerCase() !== buyerName.toLowerCase()) {
      return NextResponse.json(
        { error: 'This demand was posted under a different buyer name.' },
        { status: 403 }
      );
    }

    // Already-delivered short-circuit. `settledAt` is the credit guard; a
    // second click on this branch will not re-credit either.
    if (demand.deliveredAt) {
      return NextResponse.json({
        success: true,
        alreadyDelivered: true,
        deliveredAt: demand.deliveredAt.toISOString(),
        creditedAmount: 0,
      });
    }

    const now = new Date();

    // Pull the accepted orders BEFORE the transaction so we know per-artisan
    // fallbacks (a demand may have several accepters at different negotiated
    // prices). Only rows without a prior credit are eligible.
    //
    // The status list must cover the WHOLE vocabulary. V9 added READY, PACKED,
    // DISPATCHED and DELIVERED between ACCEPTED and COMPLETED, and an order
    // sitting in any of them is exactly the order most likely to be the one the
    // buyer is confirming — leaving them out of this predicate would have meant
    // the artisans furthest along were the ones who never got paid.
    const pendingCredits = await prisma.artisanOrder.findMany({
      where: {
        demandId,
        settledAt: null,
        status: {
          in: [
            'ACCEPTED',
            'IN_PROGRESS',
            'READY',
            'PACKED',
            'DISPATCHED',
            'DELIVERED',
            'COMPLETED',
          ],
        },
      },
      select: {
        id: true,
        artisanId: true,
        negotiatedPrice: true,
        status: true,
        advanceStatus: true,
        advanceDueAmount: true,
        balanceDueAmount: true,
        artisan: { select: { name: true } },
      },
    });

    const priceFor = (negotiated: number | null): number => {
      const candidate =
        typeof negotiated === 'number' && negotiated > 0
          ? negotiated
          : demand.targetPriceMax ?? demand.targetPriceMin ?? 0;
      return candidate > 0 ? Math.round(candidate) : 0;
    };

    /**
     * What lands on delivery.
     *
     * When the buyer already paid the 40% advance, only the balance is left —
     * crediting the full agreed price here would pay the artisan 140% of it.
     * When the advance was waived (no price resolved at acceptance) or simply
     * never paid, the whole agreed price settles now, which is the pre-V10
     * behaviour and stays correct.
     */
    const creditFor = (order: (typeof pendingCredits)[number]): number => {
      const agreed = priceFor(order.negotiatedPrice);
      if (order.advanceStatus !== 'ADVANCE_PAID') return agreed;

      const advance = order.advanceDueAmount ?? 0;
      const balance = order.balanceDueAmount ?? Math.round(agreed - advance);

      // The two halves must reconstruct the agreed price exactly. They are
      // computed once at acceptance from the price agreed THEN, so a
      // renegotiation afterwards would make them disagree with `agreed` here.
      // Warned rather than corrected: the recorded halves are what both sides
      // were shown, and silently paying a different number would be worse.
      if (Math.round(advance + balance) !== agreed) {
        console.warn(
          `[buyer/orders/delivered] advance + balance does not equal the agreed price on ArtisanOrder ${order.id}: ${advance} + ${balance} != ${agreed}. Crediting the recorded balance.`
        );
      }
      return balance;
    };

    const results = await prisma.$transaction(async (tx) => {
      await tx.demand.update({
        where: { id: demandId },
        data: { deliveredAt: now, status: advanceDemandStatus(demand.status, 'FULFILLED') },
      });

      let credited = 0;
      const perOrder: {
        orderId: string;
        artisanId: string;
        artisanName: string;
        amount: number;
      }[] = [];
      for (const order of pendingCredits) {
        const amount = creditFor(order);
        // updateMany with the same settledAt-null predicate is the concurrency
        // guard: two overlapping requests cannot both apply the credit.
        const outcome = await tx.artisanOrder.updateMany({
          where: { id: order.id, settledAt: null },
          data: {
            settledAmount: amount,
            settledAt: now,
            // DELIVERED, not COMPLETED: this is the BUYER acknowledging
            // receipt. COMPLETED is the artisan's own closing acknowledgement
            // and has exactly one writer, the `complete` action on
            // /api/artisan/orders. An order already closed by the artisan stays
            // closed — advanceOrderStatus refuses to walk it back.
            status: advanceOrderStatus(order.status, 'DELIVERED'),
          },
        });
        if (outcome.count > 0) {
          credited += amount;
          perOrder.push({
            orderId: order.id,
            artisanId: order.artisanId,
            artisanName: order.artisan.name,
            amount,
          });
        }
      }
      return { credited, perOrder };
    });

    if (results.perOrder.length > 0) {
      console.log(
        `[buyer/orders/delivered] Demand ${demandId} credited ₹${results.credited} across ${results.perOrder.length} order(s): ${results.perOrder
          .map((r) => `${r.orderId}=₹${r.amount}`)
          .join(', ')}`
      );
    }

    // Tell each credited artisan, and the buyer. Best-effort and after the
    // transaction: a credit that landed must not be reported as a failure
    // because an alert could not be written. Only orders that were ACTUALLY
    // credited on this call are notified, so a second click tells nobody.
    for (const credit of results.perOrder) {
      try {
        await prisma.notification.create({
          data: {
            userId: credit.artisanId,
            type: 'ORDER_DELIVERED',
            title: `Delivered: ${demand.craftType}`,
            // The agreed price, and named as a credit rather than a bank
            // transfer — the payout rail is not wired on this deployment and
            // this copy must not imply it is. See src/lib/escrow.ts.
            message: `${buyerName} has confirmed delivery. ₹${credit.amount.toLocaleString('en-IN')} has been credited to your earnings at the agreed price.`,
            relatedDemandId: demandId,
            channel: 'IN_APP',
          },
        });
      } catch (notifyError) {
        console.error('Delivery notification failed:', notifyError);
      }
    }

    await createBuyerNotification({
      buyerName: demand.buyerName,
      demandId,
      type: 'ORDER_DELIVERED',
      ...buyerNotificationCopy.orderDelivered(demand.craftType, results.credited),
    });

    return NextResponse.json({
      success: true,
      deliveredAt: now.toISOString(),
      creditedAmount: results.credited,
      creditedOrders: results.perOrder.length,
    });
  } catch (error) {
    console.error('Buyer delivered error:', error);
    return NextResponse.json({ error: 'Failed to mark delivered.' }, { status: 500 });
  }
}
