import { prisma } from '@/lib/prisma';
import { familiesForCraft } from '@/lib/craftFamilies';
import { distanceKm, locateCity } from '@/lib/indiaGeo';
import {
  BENCHMARK_WINDOW_DAYS,
  MIN_COHORT,
  REGION_RADIUS_KM,
  buildBenchmark,
  fulfilmentRate,
  perMonth,
  type BenchmarkResult,
  type BenchmarkScope,
  type PeerFigures,
} from '@/lib/clusterBenchmark';

/**
 * The database side of the anonymous cluster benchmark.
 *
 * Server-only (it imports Prisma). The medians, the quartiles and the
 * k-anonymity threshold live in the pure src/lib/clusterBenchmark.ts.
 *
 * What this file is careful about:
 *
 *   - **Nothing identifying leaves it.** Ids are used to group aggregates and
 *     are then discarded; the value returned is `BenchmarkResult`, which has no
 *     field that could carry a name, an id, a location or a rank.
 *   - **The comparison basis is the dashboard's.** Escrow income is counted on
 *     rows created inside the window, demand credits on `settledAt` inside it —
 *     exactly how /api/artisan/dashboard buckets its twelve-month series — so a
 *     figure here can be reconciled against the artisan's own charts.
 *   - **Offline income is never in the median.** It is the artisan's own
 *     bookkeeping, unverified by anyone and invisible for every peer, so
 *     folding it in would compare a measured number against a self-reported
 *     one. It is returned separately, labelled, so the artisan's own total is
 *     still the truth about their month.
 */

/** Ceiling on the profiles the widening step will look at in one request. */
const MAX_CANDIDATES = 500;

/** The app-wide cluster key (§2.10 rule 9) — the same expression as /api/artisan/resource-request. */
function clusterKeyOf(profile: { shgGroupLink: string | null; location: string | null }): string | null {
  const shg = profile.shgGroupLink?.trim() || null;
  const location = profile.location?.trim() || null;
  return shg ? shg : location ? `auto:${location.toLowerCase()}` : null;
}

interface Candidate {
  userId: string;
  shgGroupLink: string | null;
  location: string | null;
  craftType: string | null;
}

/** Whether two crafts share a material family, the app's existing grouping. */
function sameCraftFamily(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const mine = new Set(familiesForCraft(a));
  return familiesForCraft(b).some((family) => mine.has(family));
}

/** Artisans whose resolved cluster key is the same as this one's. */
async function clusterPeers(me: Candidate, key: string): Promise<Candidate[]> {
  const shg = me.shgGroupLink?.trim() || null;
  const rows = await prisma.artisanProfile.findMany({
    // A coarse filter in SQL; the key itself is then recomputed in JS so the
    // membership test is byte-for-byte the rule every other screen applies.
    where: shg ? { shgGroupLink: shg } : { location: me.location ?? undefined },
    select: { userId: true, shgGroupLink: true, location: true, craftType: true },
    take: MAX_CANDIDATES,
  });
  return rows.filter((row) => row.userId !== me.userId && clusterKeyOf(row) === key);
}

/**
 * The one widening step: artisans of the same craft family within
 * REGION_RADIUS_KM.
 *
 * `src/lib/indiaGeo.ts` provides coordinates, not a state mapping, so "region"
 * is a radius rather than an administrative boundary. When the artisan's own
 * location cannot be resolved there is no centre to measure from, and this
 * returns nothing rather than falling back to a platform-wide average —
 * comparing a Sambalpuri weaver against a Kutch potter is not information.
 */
async function regionPeers(me: Candidate): Promise<Candidate[]> {
  const centre = locateCity(me.location);
  if (!centre) return [];

  const rows = await prisma.artisanProfile.findMany({
    where: { userId: { not: me.userId } },
    select: { userId: true, shgGroupLink: true, location: true, craftType: true },
    take: MAX_CANDIDATES,
  });

  return rows.filter((row) => {
    const point = locateCity(row.location);
    if (!point) return false;
    if (distanceKm(centre, point) > REGION_RADIUS_KM) return false;
    return sameCraftFamily(me.craftType, row.craftType);
  });
}

type SumRow = { artisanId: string; _sum: Record<string, number | null> };
type CountRow = { artisanId: string; _count: { _all: number }; _avg?: Record<string, number | null> };

const sumBy = (rows: SumRow[], field: string) =>
  new Map(rows.map((row) => [row.artisanId, row._sum[field] ?? 0]));

/**
 * Every figure for a set of artisans, in six grouped queries rather than six
 * per artisan.
 */
async function figuresFor(ids: string[], since: Date): Promise<Map<string, PeerFigures>> {
  if (ids.length === 0) return new Map();
  const where = { artisanId: { in: ids } };

  const [advances, finals, demandCredits, listed, ordersAccepted, ordersDelivered] = await Promise.all([
    prisma.craftItem.groupBy({
      by: ['artisanId'],
      where: { ...where, createdAt: { gte: since }, status: { in: ['ADVANCE_PAID', 'SOLD_FINAL'] } },
      _sum: { advancePaid: true },
    }),
    prisma.craftItem.groupBy({
      by: ['artisanId'],
      where: { ...where, createdAt: { gte: since }, status: 'SOLD_FINAL' },
      _sum: { finalPayoutQueued: true },
    }),
    prisma.artisanOrder.groupBy({
      by: ['artisanId'],
      where: { ...where, settledAt: { gte: since } },
      _sum: { settledAmount: true },
    }),
    prisma.craftItem.groupBy({
      by: ['artisanId'],
      where: { ...where, createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { askingPrice: true },
    }),
    prisma.artisanOrder.groupBy({
      by: ['artisanId'],
      where: { ...where, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.artisanOrder.groupBy({
      by: ['artisanId'],
      where: {
        ...where,
        createdAt: { gte: since },
        OR: [{ settledAt: { not: null } }, { status: { in: ['DELIVERED', 'COMPLETED'] } }],
      },
      _count: { _all: true },
    }),
  ]);

  const advanceSum = sumBy(advances as SumRow[], 'advancePaid');
  const finalSum = sumBy(finals as SumRow[], 'finalPayoutQueued');
  const demandSum = sumBy(demandCredits as SumRow[], 'settledAmount');
  const listedRows = listed as CountRow[];
  const listedCount = new Map(listedRows.map((row) => [row.artisanId, row._count._all]));
  const avgPrice = new Map(listedRows.map((row) => [row.artisanId, row._avg?.askingPrice ?? null]));
  const accepted = new Map((ordersAccepted as CountRow[]).map((row) => [row.artisanId, row._count._all]));
  const delivered = new Map((ordersDelivered as CountRow[]).map((row) => [row.artisanId, row._count._all]));

  const out = new Map<string, PeerFigures>();
  for (const id of ids) {
    const earnings = (advanceSum.get(id) ?? 0) + (finalSum.get(id) ?? 0) + (demandSum.get(id) ?? 0);
    out.set(id, {
      monthlyEarnings: perMonth(earnings),
      listings: perMonth(listedCount.get(id) ?? 0),
      fulfilment: fulfilmentRate(accepted.get(id) ?? 0, delivered.get(id) ?? 0),
      avgPrice: avgPrice.get(id) ?? null,
    });
  }
  return out;
}

/**
 * Cohort membership: at least one rupee of PLATFORM income inside the window.
 *
 * That is deliberately what is being compared — money Karigari can see and
 * measure the same way for every artisan. An artisan whose only income is
 * offline is not in anybody's cohort, and the copy must not call them inactive:
 * their own figures are still shown, with their offline stream named beside the
 * comparison.
 */
function isActive(figures: PeerFigures | undefined): boolean {
  return Boolean(figures && figures.monthlyEarnings > 0);
}

export interface BenchmarkRecord {
  result: BenchmarkResult;
  /** Days the comparison covers, so the screen never hard-codes "90". */
  windowDays: number;
  /**
   * The artisan's own offline income per month over the same window. Not part
   * of any median — see the file header — and rendered as a labelled addition.
   */
  ownOfflineMonthly: number;
  /** True when the artisan themselves has no platform income in the window. */
  ownPlatformIdle: boolean;
  /** Null when `location` could not be resolved, which is why widening was skipped. */
  locationResolved: boolean;
}

/**
 * Build the benchmark for one artisan, or refuse with the real cohort size.
 *
 * Widening happens exactly once, and only when the cluster itself is too small.
 */
export async function readBenchmark(artisanId: string, now: Date = new Date()): Promise<BenchmarkRecord> {
  const since = new Date(now.getTime() - BENCHMARK_WINDOW_DAYS * 86_400_000);

  const profile = await prisma.artisanProfile.findUnique({
    where: { userId: artisanId },
    select: { userId: true, shgGroupLink: true, location: true, craftType: true },
  });

  const me: Candidate = profile ?? {
    userId: artisanId,
    shgGroupLink: null,
    location: null,
    craftType: null,
  };
  const locationResolved = Boolean(locateCity(me.location));

  const [own, offline] = await Promise.all([
    figuresFor([artisanId], since),
    prisma.offlineSale.aggregate({ _sum: { amount: true }, where: { artisanId, soldAt: { gte: since } } }),
  ]);
  const ownFigures = own.get(artisanId) ?? {
    monthlyEarnings: 0,
    listings: 0,
    fulfilment: null,
    avgPrice: null,
  };

  const base: Omit<BenchmarkRecord, 'result'> = {
    windowDays: BENCHMARK_WINDOW_DAYS,
    ownOfflineMonthly: Math.round(perMonth(offline._sum.amount ?? 0)),
    ownPlatformIdle: ownFigures.monthlyEarnings <= 0,
    locationResolved,
  };

  const key = clusterKeyOf(me);
  let scope: BenchmarkScope = 'CLUSTER';
  let peers = key ? await clusterPeers(me, key) : [];
  let active = await activeFigures(peers, since);

  // One widening step, and only when the cluster is too small. An unresolvable
  // location has no centre, so the step is skipped entirely rather than falling
  // back to a platform-wide average.
  if (active.length < MIN_COHORT && locationResolved) {
    const widened = await regionPeers(me);
    const widenedActive = await activeFigures(widened, since);
    if (widenedActive.length > active.length) {
      scope = 'REGION';
      peers = widened;
      active = widenedActive;
    }
  }

  return { ...base, result: buildBenchmark(ownFigures, active, scope) };
}

/** The peers who were actually active in the window, reduced to their figures. */
async function activeFigures(peers: Candidate[], since: Date): Promise<PeerFigures[]> {
  if (peers.length === 0) return [];
  const figures = await figuresFor(
    peers.map((peer) => peer.userId),
    since
  );
  // Ids are dropped here and never travel further: from this line on the cohort
  // is an unordered bag of numbers.
  return peers.map((peer) => figures.get(peer.userId)).filter(isActive) as PeerFigures[];
}
