import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
    const pendingCredits = await prisma.artisanOrder.findMany({
      where: {
        demandId,
        settledAt: null,
        status: { in: ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'] },
      },
      select: { id: true, artisanId: true, negotiatedPrice: true },
    });

    const priceFor = (negotiated: number | null): number => {
      const candidate =
        typeof negotiated === 'number' && negotiated > 0
          ? negotiated
          : demand.targetPriceMax ?? demand.targetPriceMin ?? 0;
      return candidate > 0 ? Math.round(candidate) : 0;
    };

    const results = await prisma.$transaction(async (tx) => {
      await tx.demand.update({
        where: { id: demandId },
        data: { deliveredAt: now, status: 'FULFILLED' },
      });

      let credited = 0;
      const perOrder: { orderId: string; artisanId: string; amount: number }[] = [];
      for (const order of pendingCredits) {
        const amount = priceFor(order.negotiatedPrice);
        // updateMany with the same settledAt-null predicate is the concurrency
        // guard: two overlapping requests cannot both apply the credit.
        const outcome = await tx.artisanOrder.updateMany({
          where: { id: order.id, settledAt: null },
          data: {
            settledAmount: amount,
            settledAt: now,
            status: 'COMPLETED',
          },
        });
        if (outcome.count > 0) {
          credited += amount;
          perOrder.push({ orderId: order.id, artisanId: order.artisanId, amount });
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
