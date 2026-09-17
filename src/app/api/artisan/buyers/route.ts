import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { craftMatchScore } from '@/lib/notifications';
import {
  B2B_PURCHASE_TYPES,
  MIN_BUYERS_FOR_REPEAT_RATE,
  MIN_SEARCHES_FOR_SIGNAL,
  MIN_TERM_SEARCHES,
  SIGNAL_WINDOW_DAYS,
  UNMET_SHARE_THRESHOLD,
  aggregateBuyers,
  buildDemandSignals,
  type PurchaseRow,
  type SearchTermStat,
} from '@/lib/buyers';

export const dynamic = 'force-dynamic';

/**
 * "My Buyers" for the signed-in artisan, built from sales that already
 * happened — the artisan types nothing.
 *
 * Three sources, one query each, aggregated in `src/lib/buyers.ts`:
 *   1. storefront — CraftItems a buyer paid for, or that reached a sold status
 *      through the escrow ledger;
 *   2. demand     — ArtisanOrders whose credit has SETTLED (an accepted order is
 *      a promise, not a buyer yet);
 *   3. offline    — the artisan's own OfflineSale rows.
 *
 * Money is what reached the artisan, per line: released escrow tranches
 * (`advancePaid + finalPayoutQueued`), `settledAmount`, or the logged cash
 * `amount`. Never `salePrice` on an unsettled row, never a valuation. Every
 * line's money is counted in `revenueByChannel` whether or not a buyer name was
 * recorded, so the totals here reconcile with the Money tab.
 */

/** Pieces sold through the storefront or the escrow ledger. SOLD_OFFLINE is the offline source's. */
const STOREFRONT_SOLD = ['SOLD_FINAL', 'SOLD_MIDDLEMAN', 'PAYOUT_COMPLETED'];

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const since = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 86_400_000);

    const [storefront, orders, offline, profile, catalogue, searchCounts, zeroCounts, openDemands] =
      await Promise.all([
        prisma.craftItem.findMany({
          where: {
            artisanId,
            OR: [{ paidAt: { not: null } }, { status: { in: STOREFRONT_SOLD } }],
          },
          select: {
            id: true,
            craftType: true,
            buyerName: true,
            paidAt: true,
            createdAt: true,
            advancePaid: true,
            finalPayoutQueued: true,
            relatedDemandId: true,
          },
        }),
        prisma.artisanOrder.findMany({
          where: { artisanId, settledAt: { not: null } },
          select: {
            id: true,
            settledAt: true,
            settledAmount: true,
            demand: { select: { buyerName: true, purchaseType: true, craftType: true, productType: true } },
          },
        }),
        prisma.offlineSale.findMany({
          where: { artisanId },
          select: { id: true, craftItemId: true, craftTypeLabel: true, buyerName: true, amount: true, soldAt: true },
        }),
        prisma.artisanProfile.findUnique({ where: { userId: artisanId }, select: { craftType: true } }),
        prisma.craftItem.findMany({
          where: { artisanId },
          distinct: ['craftType'],
          take: 20,
          select: { craftType: true },
        }),
        prisma.marketplaceSearch.groupBy({
          by: ['term'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
          orderBy: { _count: { term: 'desc' } },
          take: 200,
        }),
        prisma.marketplaceSearch.groupBy({
          by: ['term'],
          where: { createdAt: { gte: since }, resultCount: 0 },
          _count: { _all: true },
        }),
        prisma.demand.findMany({
          where: { status: 'OPEN', createdAt: { gte: since } },
          select: { craftType: true, category: true },
        }),
      ]);

    // A storefront purchase made against a bulk or wholesale demand is a B2B
    // buyer too, not only a demand-order one.
    const relatedIds = [...new Set(storefront.map((s) => s.relatedDemandId).filter(Boolean))] as string[];
    const relatedDemands = relatedIds.length
      ? await prisma.demand.findMany({ where: { id: { in: relatedIds } }, select: { id: true, purchaseType: true } })
      : [];
    const b2bDemandIds = new Set(
      relatedDemands.filter((d) => B2B_PURCHASE_TYPES.includes(d.purchaseType)).map((d) => d.id)
    );

    const rows: PurchaseRow[] = [
      ...storefront.map((item) => ({
        buyerName: item.buyerName,
        channel: 'STOREFRONT' as const,
        amount: (item.advancePaid || 0) + (item.finalPayoutQueued || 0),
        at: item.paidAt ?? item.createdAt,
        title: item.craftType,
        itemId: item.id,
        b2b: item.relatedDemandId ? b2bDemandIds.has(item.relatedDemandId) : false,
      })),
      ...orders.map((order) => ({
        buyerName: order.demand.buyerName,
        channel: 'DEMAND' as const,
        amount: order.settledAmount ?? 0,
        at: order.settledAt as Date,
        title: order.demand.productType || order.demand.craftType,
        itemId: order.id,
        b2b: B2B_PURCHASE_TYPES.includes(order.demand.purchaseType),
      })),
      ...offline.map((sale) => ({
        buyerName: sale.buyerName,
        channel: 'OFFLINE' as const,
        amount: sale.amount,
        at: sale.soldAt,
        title: sale.craftTypeLabel,
        itemId: sale.craftItemId ?? sale.id,
      })),
    ];

    const { buyers, summary } = aggregateBuyers(rows);

    // "This artisan's craft" is their profile craft and what they actually
    // make: a weaver whose profile says "Sambalpuri Ikat" still sells dupattas.
    const crafts = [profile?.craftType, ...catalogue.map((c) => c.craftType)].filter(
      (c): c is string => Boolean(c && c.trim())
    );
    const matchesCraft = (term: string) => crafts.some((craft) => craftMatchScore(craft, term) > 0);

    const zeroByTerm = new Map(zeroCounts.map((row) => [row.term, row._count._all]));
    const searchStats: SearchTermStat[] = searchCounts.map((row) => ({
      term: row.term,
      count: row._count._all,
      zeroResultCount: zeroByTerm.get(row.term) ?? 0,
    }));
    const openRequestTerms = openDemands
      .filter((demand) => matchesCraft(demand.craftType))
      .map((demand) => demand.category || demand.craftType);

    return NextResponse.json({
      success: true,
      buyers,
      summary,
      demandSignals: buildDemandSignals(searchStats, openRequestTerms, matchesCraft),
      thresholds: {
        minBuyersForRepeatRate: MIN_BUYERS_FOR_REPEAT_RATE,
        minSearchesForSignal: MIN_SEARCHES_FOR_SIGNAL,
        minTermSearches: MIN_TERM_SEARCHES,
        unmetShare: UNMET_SHARE_THRESHOLD,
      },
    });
  } catch (error) {
    console.error('[buyers] GET failed:', error);
    return NextResponse.json({ success: false, error: 'Could not load your buyers.' }, { status: 500 });
  }
}
