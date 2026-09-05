import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { STAGE1_ADVANCE_PAID_40, STAGE2_SETTLED_89 } from '@/lib/escrow';
import {
  HEALTH_MAX,
  HEALTH_PENALTY_GUILTY,
  HEALTH_REWARD_VERIFIED,
} from '@/lib/artisanHealth';

export const dynamic = 'force-dynamic';

/**
 * A thumbnail every list row can render, without carrying the photo itself.
 *
 * Seeded and hosted photos are already short paths, so they go through as they
 * are. An artisan's own capture is a base64 data URL a few hundred kilobytes
 * long — ten of those is the multi-megabyte payload this route exists to avoid —
 * so it is replaced by the URL that streams it, `GET /api/items/[id]/thumbnail`,
 * which the browser fetches lazily and caches. Null when the row has no photo at
 * all, which is the case the UI answers with a placeholder rather than an
 * `<Image src="">`.
 */
function thumbnailFor(id: string, images: string[] | null | undefined): string | null {
  const first = images?.[0];
  if (!first) return null;
  return first.startsWith('data:') ? `/api/items/${id}/thumbnail` : first;
}

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret');
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 });
    }

    const artisanId = decoded.userId;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Rolling 12-month window for the earnings charts, anchored to the first of
    // the month so the series always has twelve whole buckets.
    const seriesStart = new Date();
    seriesStart.setMonth(seriesStart.getMonth() - 11);
    seriesStart.setDate(1);
    seriesStart.setHours(0, 0, 0, 0);

    // Parallelize all independent DB queries to dramatically improve SSR / API response time
    const [
      user,
      myCapturesCount,
      advancedItems,
      itemsSold,
      queued,
      recentCaptures,
      pastWeekCaptures,
      pastWeekAdvancedItems,
      pastWeekSold,
      pastWeekQueued,
      grossSales,
      escrowAdvances,
      escrowSettlements,
      settledRows,
      soldRows,
      demandSettledAgg,
      pastWeekDemandAgg,
      demandSettledSeries,
      ticketCounts,
      recentGuiltyTicketRows,
    ] = await Promise.all([
      prisma.user.findUnique({ 
        where: { id: artisanId }, 
        include: { artisanProfile: true, schemeApplications: true } 
      }),
      prisma.craftItem.count({ where: { artisanId } }),
      prisma.craftItem.findMany({ where: { artisanId, status: { in: ['ADVANCE_PAID', 'SOLD_FINAL'] } }, select: { advancePaid: true } }),
      prisma.craftItem.count({ where: { artisanId, status: { in: ['SOLD_FINAL', 'SOLD_MIDDLEMAN'] } } }),
      prisma.craftItem.aggregate({ _sum: { finalPayoutQueued: true }, where: { artisanId, status: 'SOLD_FINAL' } }),
      // Only what the captures table and its status/money logic actually read.
      // This used to `include: { auditLogs }` with no select, so every response
      // carried 10 items' base64 `images` plus their whole audit history —
      // multi-megabyte JSON for a table that shows five columns. The timeline is
      // now fetched on demand by GET /api/items/[id] when the artisan opens
      // "View Details", and `images` is reduced to a single `thumbnail` string
      // below — a path where the row already has one, and otherwise a URL that
      // streams the stored photo, so a base64 capture never rides in this JSON.
      prisma.craftItem.findMany({
        where: { artisanId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          images: true,
          craftType: true,
          descriptionEnglish: true,
          patchId: true,
          status: true,
          isListedOnMarketplace: true,
          isOndcLive: true,
          qrVerified: true,
          escrowStatus: true,
          advancePaid: true,
          finalPayoutQueued: true,
          salePrice: true,
          askingPrice: true,
          standardMarketPrice: true,
          fairWageFloor: true,
          marketPriceMin: true,
          marketPriceMax: true,
          laborDays: true,
          rawMaterialCost: true,
          createdAt: true,
        }
      }),
      prisma.craftItem.count({ where: { artisanId, createdAt: { gte: oneWeekAgo } } }),
      prisma.craftItem.findMany({ where: { artisanId, status: { in: ['ADVANCE_PAID', 'SOLD_FINAL'] }, createdAt: { gte: oneWeekAgo } }, select: { advancePaid: true } }),
      prisma.craftItem.count({ where: { artisanId, status: { in: ['SOLD_FINAL', 'SOLD_MIDDLEMAN'] }, createdAt: { gte: oneWeekAgo } } }),
      prisma.craftItem.aggregate({ _sum: { finalPayoutQueued: true }, where: { artisanId, status: 'SOLD_FINAL', createdAt: { gte: oneWeekAgo } } }),
      // --- Non-custodial escrow ledger -------------------------------------
      // Read-only aggregates. Nothing here can move money: the two tranches are
      // written solely by /api/payments/settle-escrow on a dispatch/delivery
      // trigger, straight to the artisan's own VPA.
      prisma.craftItem.aggregate({
        _sum: { salePrice: true },
        where: { artisanId, salePrice: { not: null } }
      }),
      prisma.craftItem.aggregate({
        _sum: { advancePaid: true },
        where: { artisanId, escrowStatus: { in: [STAGE1_ADVANCE_PAID_40, STAGE2_SETTLED_89] } }
      }),
      prisma.craftItem.aggregate({
        _sum: { finalPayoutQueued: true },
        where: { artisanId, escrowStatus: STAGE2_SETTLED_89 }
      }),
      // --- Monthly realised earnings ---------------------------------------
      // Computed server-side so the charts do not have to re-derive it from
      // the ten most recent captures, which would silently undercount anyone
      // with more than ten pieces. Same status basis as `totalEarnings` above,
      // so the series sums back to the headline figure rather than
      // contradicting it.
      prisma.craftItem.findMany({
        where: {
          artisanId,
          status: { in: ['ADVANCE_PAID', 'SOLD_FINAL'] },
          createdAt: { gte: seriesStart },
        },
        select: { createdAt: true, status: true, advancePaid: true, finalPayoutQueued: true },
      }),
      // --- Best sellers -----------------------------------------------------
      // Every settled row, not just the ten most recent captures, because "most
      // sold product" is a lifetime question. Deliberately without `images`:
      // only the winning title needs a photo, and that is one extra tiny query
      // below rather than a base64 blob per row.
      prisma.craftItem.findMany({
        where: {
          artisanId,
          OR: [
            { status: { in: ['SOLD_FINAL', 'PAYOUT_COMPLETED'] } },
            { escrowStatus: STAGE2_SETTLED_89 },
          ],
        },
        select: {
          id: true,
          craftType: true,
          status: true,
          advancePaid: true,
          finalPayoutQueued: true,
          salePrice: true,
          createdAt: true,
        },
      }),
      // --- Demand-order settlements ----------------------------------------
      // Separate income stream from the CraftItem escrow ledger. Written by
      // /api/buyer/orders/delivered on "Mark delivered" — always the on-screen
      // agreed price, never the ₹1 demo charge. Summed lifetime, past-week,
      // and per-month for the 12-month chart.
      prisma.artisanOrder.aggregate({
        _sum: { settledAmount: true },
        where: { artisanId, settledAt: { not: null } },
      }),
      prisma.artisanOrder.aggregate({
        _sum: { settledAmount: true },
        where: { artisanId, settledAt: { gte: oneWeekAgo } },
      }),
      prisma.artisanOrder.findMany({
        where: { artisanId, settledAt: { gte: seriesStart } },
        select: { settledAmount: true, settledAt: true },
      }),
      // --- Buyer dispute tickets against this artisan's own pieces ----------
      // Grouped in one round trip rather than three counts.
      prisma.ticket.groupBy({
        by: ['status'],
        where: { craftItem: { artisanId } },
        _count: { _all: true },
      }),
      prisma.ticket.findMany({
        where: { craftItem: { artisanId }, status: 'RESOLVED_GUILTY' },
        orderBy: { resolvedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          resolvedAt: true,
          craftItem: { select: { craftType: true, images: true, patchId: true } },
        },
      }),
    ]);

    if (!user) {
      return NextResponse.json(
        { error: 'Your session is no longer valid. Please sign in again.', code: 'SESSION_STALE' },
        { status: 401 }
      );
    }

    // Only money actually disbursed counts. The `fairWageFloor` fallback that used
    // to sit here invented an advance for every item that had not been paid yet.
    /** Pull one status out of the grouped ticket counts. Absent status → 0. */
    const ticketCountFor = (status: string) =>
      ticketCounts.find((row) => row.status === status)?._count._all ?? 0;

    const totalAdvances = advancedItems.reduce((sum: number, item: any) => sum + (item.advancePaid || 0), 0);
    // Demand-order stream, denominated in on-screen agreed price. NEVER
    // overlaps the CraftItem escrow ledger — demand orders have no CraftItem
    // escrow row — so summing the two is not a double-count.
    const demandEarnings = demandSettledAgg._sum.settledAmount ?? 0;
    const pastWeekDemandEarnings = pastWeekDemandAgg._sum.settledAmount ?? 0;
    const totalEarnings =
      totalAdvances + (queued._sum.finalPayoutQueued || 0) + demandEarnings;

    const pastWeekAdvances = pastWeekAdvancedItems.reduce((sum: number, item: any) => sum + (item.advancePaid || 0), 0);
    const pastWeekEarnings =
      pastWeekAdvances + (pastWeekQueued._sum.finalPayoutQueued || 0) + pastWeekDemandEarnings;

    /**
     * Twelve whole months, oldest first, with empty months present as zeroes.
     * A chart that silently skips a month with no sales reads as though time
     * itself paused; an explicit zero is the truth.
     */
    const buckets = new Map<string, { month: string; amount: number; units: number }>();
    for (let i = 0; i < 12; i += 1) {
      const cursor = new Date(seriesStart);
      cursor.setMonth(seriesStart.getMonth() + i);
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, { month: key, amount: 0, units: 0 });
    }

    for (const row of settledRows) {
      const key = `${row.createdAt.getFullYear()}-${String(row.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.get(key);
      if (!bucket) continue;
      // Only money actually disbursed. The final tranche exists solely on rows
      // that reached SOLD_FINAL, exactly as `totalEarnings` counts it.
      const realised =
        (row.advancePaid || 0) + (row.status === 'SOLD_FINAL' ? row.finalPayoutQueued || 0 : 0);
      if (realised <= 0) continue;
      bucket.amount += realised;
      bucket.units += 1;
    }

    // Demand-order credits bucketed by `settledAt`, not `createdAt` — the
    // acceptance can precede the credit by weeks, and the chart is about when
    // the money arrived, not when the demand was accepted.
    for (const row of demandSettledSeries) {
      const when = row.settledAt;
      const amount = row.settledAmount ?? 0;
      if (!when || amount <= 0) continue;
      const key = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.amount += amount;
      bucket.units += 1;
    }

    const monthlyEarnings = [...buckets.values()];

    /**
     * Best sellers, aggregated by product title.
     *
     * An artisan weaves the same piece more than once, so "most sold" is a
     * question about a title, not a row — three Pasapali sarees are three units
     * of one product. Revenue is the money that actually reached the artisan
     * (advance + final tranche), on exactly the same basis as `totalEarnings`,
     * so the share this feeds reconciles with the headline figure instead of
     * contradicting it. An AI valuation is never counted: `fairWageFloor` and
     * `askingPrice` do not appear here at all.
     */
    const byTitle = new Map<
      string,
      { title: string; itemId: string; unitsSold: number; revenue: number; grossSales: number; lastSoldAt: Date }
    >();

    for (const row of soldRows) {
      const title = (row.craftType || '').trim() || 'Untitled craft';
      const realised = (row.advancePaid || 0) + (row.finalPayoutQueued || 0);
      const existing = byTitle.get(title);
      if (existing) {
        existing.unitsSold += 1;
        existing.revenue += realised;
        existing.grossSales += row.salePrice || 0;
        if (row.createdAt > existing.lastSoldAt) {
          existing.lastSoldAt = row.createdAt;
          // The photo comes from the most recent sale of that title, which is
          // the one the artisan will recognise.
          existing.itemId = row.id;
        }
      } else {
        byTitle.set(title, {
          title,
          itemId: row.id,
          unitsSold: 1,
          revenue: realised,
          grossSales: row.salePrice || 0,
          lastSoldAt: row.createdAt,
        });
      }
    }

    // Units first — this is the *most sold* product. Revenue breaks the tie, so
    // two titles on one unit each are ordered by which one earned more.
    const bestSellers = [...byTitle.values()]
      .sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue)
      .slice(0, 5)
      .map(({ lastSoldAt, ...rest }) => ({ ...rest, lastSoldAt: lastSoldAt.toISOString() }));

    // One extra query, for one photo, only when there is a winner to show.
    let topProduct: {
      itemId: string;
      title: string;
      image: string | null;
      unitsSold: number;
      revenue: number;
      grossSales: number;
    } | null = null;

    if (bestSellers.length > 0) {
      const top = bestSellers[0];
      const row = await prisma.craftItem.findUnique({
        where: { id: top.itemId },
        select: { images: true },
      });
      topProduct = {
        itemId: top.itemId,
        title: top.title,
        image: thumbnailFor(top.itemId, row?.images),
        unitsSold: top.unitsSold,
        revenue: top.revenue,
        grossSales: top.grossSales,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        artisanName: user?.name,
        artisanProfile: user?.artisanProfile,
        schemeApplications: user?.schemeApplications,
        myCapturesCount,
        totalAdvances,
        itemsSold,
        totalEarnings,
        /** On-screen demand-order credits (separate stream). */
        demandEarnings,
        pastWeekDemandEarnings,
        healthScore: user?.artisanProfile?.healthScore ?? 100,
        /** The bounds the Trust card reads, so it never hard-codes "/100". */
        healthMax: HEALTH_MAX,
        healthRewardVerified: HEALTH_REWARD_VERIFIED,
        healthPenaltyGuilty: HEALTH_PENALTY_GUILTY,
        /** Successful buyer scans; each one awarded HEALTH_REWARD_VERIFIED. */
        verifiedGenuineCount: user?.artisanProfile?.verifiedGenuineCount ?? 0,
        openTickets: ticketCountFor('OPEN'),
        guiltyTickets: ticketCountFor('RESOLVED_GUILTY'),
        notGuiltyTickets: ticketCountFor('RESOLVED_NOT_GUILTY'),
        recentGuiltyTickets: recentGuiltyTicketRows.map((ticket) => ({
          id: ticket.id,
          resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
          craftItem: {
            craftType: ticket.craftItem.craftType,
            image: ticket.craftItem.images?.[0] ?? null,
            patchId: ticket.craftItem.patchId,
          },
        })),
        // Live earnings + direct-UPI settlement tracker. `upiId` is the only
        // payout destination the escrow engine ever writes to.
        totalGrossSales: grossSales._sum.salePrice || 0,
        advancesReceived: escrowAdvances._sum.advancePaid || 0,
        finalSettlementsCleared: escrowSettlements._sum.finalPayoutQueued || 0,
        upiId: user?.artisanProfile?.upiId ?? null,
        /** Last 12 months of realised earnings, for the analytics charts. */
        monthlyEarnings,
        accountStatus: user?.accountStatus ?? 'ACTIVE',
        /** The five best-selling titles, and the single best one with a photo. */
        bestSellers,
        topProduct,
        // `images` is swapped for one `thumbnail` string on the way out, so the
        // list can show a real photo without the payload carrying any.
        recentCaptures: recentCaptures.map(({ images, ...row }) => ({
          ...row,
          thumbnail: thumbnailFor(row.id, images),
        })),
        trends: {
          captures: `+${pastWeekCaptures}`,
          advances: `+₹${pastWeekAdvances.toLocaleString()}`,
          sold: `+${pastWeekSold}`,
          earnings: `+₹${pastWeekEarnings.toLocaleString()}`
        }
      }
    });
  } catch (error: any) {
    console.error('Artisan Dashboard API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
