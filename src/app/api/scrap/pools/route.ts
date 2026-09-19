import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { LOT_THRESHOLD_GRAMS, normaliseMaterial, toPublicPool, type ScrapMaterial } from '@/lib/scrap';
import { clusterAreaLabel } from '@/lib/scrapRecord';

/**
 * GET /api/scrap/pools — the public board of lots a recycler can come for.
 *
 * No session. A scrap buyer has no account here, and requiring one would mean
 * the board only reaches people who already know about this platform.
 *
 * Two things are deliberately NOT in the payload:
 *
 *   · **Anyone's name.** Not the contributors', not the cluster's SHG name.
 *     `toPublicPool` builds each row field by field from an allow-list, so a
 *     column added to `ScrapPool` later cannot leak here by being forgotten.
 *   · **A precise location.** `clusterAreaLabel` gives back district-and-state
 *     at the most precise, and nothing at all when it cannot tell a district
 *     from a hamlet. Publishing a village next to a public note about how much
 *     saleable material its people have on hand is a real risk to them.
 *
 * And no price: a listed pool has no figure until somebody sells it, and this
 * project has no market feed to estimate one from.
 */
export const dynamic = 'force-dynamic';

const MAX_POOLS = 60;

export async function GET() {
  try {
    const rows = await prisma.scrapPool.findMany({
      where: { status: 'LISTED' },
      orderBy: { listedAt: 'desc' },
      take: MAX_POOLS,
      select: {
        id: true,
        clusterKey: true,
        material: true,
        totalGrams: true,
        contributorCount: true,
        listedAt: true,
      },
    });

    // One area lookup per distinct cluster, not one per pool.
    const areas = new Map<string, string | null>();
    for (const key of new Set(rows.map((row) => row.clusterKey))) {
      areas.set(key, await clusterAreaLabel(key));
    }

    const pools = rows.map((row) =>
      toPublicPool({
        id: row.id,
        material: row.material,
        totalGrams: row.totalGrams,
        contributorCount: row.contributorCount,
        area: areas.get(row.clusterKey) ?? null,
        listedAt: row.listedAt,
      })
    );

    return NextResponse.json({
      success: true,
      pools,
      // Published alongside the board so a recycler can see WHY a lot is listed
      // — and see that the minimum is this platform's own, not a market rule.
      thresholds: LOT_THRESHOLD_GRAMS as Record<ScrapMaterial, number>,
      materials: pools.map((pool) => normaliseMaterial(pool.material)),
    });
  } catch (error) {
    console.error('[scrap/pools] failed:', error);
    return NextResponse.json(
      { success: false, code: 'READ_FAILED', error: 'Could not load the scrap board.' },
      { status: 500 }
    );
  }
}
