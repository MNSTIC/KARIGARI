import { prisma } from '@/lib/prisma';
import { clusterKeyOf } from '@/lib/motifRecord';
import { meetsThreshold, normaliseMaterial, publicAreaLabel, type ScrapPoolStatus } from '@/lib/scrap';
import type { Prisma } from '@prisma/client';

/**
 * The database side of Scrap-to-Wealth.
 *
 * Server-only (it imports Prisma). The arithmetic — thresholds, weights, the
 * pro-rata split, the area rule — is in the pure `src/lib/scrap.ts` so it can be
 * tested under plain Node.
 *
 * The rule this file holds: **a pool's totals are always recomputed, never
 * incremented.** An increment drifts the first time a request is retried, a
 * transaction is replayed or a withdrawal is missed, and a pool total that
 * drifts is a pool that lists on weight nobody logged. Recomputing from the
 * lots is a little more work and cannot be wrong.
 */

/** A transaction client, so the recompute can run inside the caller's transaction. */
type Tx = Prisma.TransactionClient;

/** Lots that still count toward a pool: everything except a withdrawal. */
const ACTIVE_LOT_STATUSES = ['LOGGED', 'POOLED', 'SOLD'] as const;

export interface PoolState {
  id: string;
  clusterKey: string;
  material: string;
  totalGrams: number;
  contributorCount: number;
  status: ScrapPoolStatus;
  /** What the status was before this recompute — the caller notifies on a change. */
  previousStatus: ScrapPoolStatus;
  listedAt: Date | null;
}

/**
 * Recompute one pool from its lots and move it across the threshold if the real
 * weight says so.
 *
 * The promotion and the demotion are the same arithmetic run in both
 * directions. A pool that crosses its threshold lists; a pool that a withdrawal
 * drops back under stops being listed and leaves the public board, because a
 * recycler must not travel for a lot that is no longer there. A SOLD pool is
 * never touched — what was sold is what was sold.
 */
export async function recomputePool(tx: Tx, poolId: string): Promise<PoolState | null> {
  const pool = await tx.scrapPool.findUnique({
    where: { id: poolId },
    select: { id: true, clusterKey: true, material: true, status: true, listedAt: true },
  });
  if (!pool) return null;

  const previousStatus = pool.status as ScrapPoolStatus;

  const lots = await tx.scrapLot.findMany({
    where: { pooledLotId: poolId, status: { in: [...ACTIVE_LOT_STATUSES] } },
    select: { artisanId: true, grams: true },
  });
  const totalGrams = lots.reduce((sum, lot) => sum + lot.grams, 0);
  const contributorCount = new Set(lots.map((lot) => lot.artisanId)).size;

  // A sold pool keeps the figures it was sold on. Everything else follows the
  // weight that is actually in it right now.
  let status = previousStatus;
  let listedAt = pool.listedAt;
  if (previousStatus !== 'SOLD') {
    const listed = meetsThreshold(normaliseMaterial(pool.material), totalGrams);
    status = listed ? 'LISTED' : 'OPEN';
    listedAt = listed ? (pool.listedAt ?? new Date()) : null;
  }

  await tx.scrapPool.update({
    where: { id: poolId },
    data: { totalGrams, contributorCount, status, listedAt },
  });

  return {
    id: pool.id,
    clusterKey: pool.clusterKey,
    material: pool.material,
    totalGrams,
    contributorCount,
    status,
    previousStatus,
    listedAt,
  };
}

/**
 * Serialise everything that touches one cluster's pool of one material.
 *
 * Two artisans in the same village logging offcuts in the same second is the
 * ordinary case, not the exotic one, and without this lock it silently loses
 * weight: both transactions read the lot table before either has committed, so
 * each recomputes a total that is missing the other's lot and the later write
 * wins. The pool then holds less than the cluster actually put in it — and a
 * pool that should have crossed its threshold does not list.
 *
 * A transaction-scoped advisory lock rather than `SELECT … FOR UPDATE`, because
 * the very first writer has no pool row to lock yet: the lock has to cover the
 * create as well as the recompute. It is keyed on the cluster and material, so
 * two different villages — or the same village's cotton and its clay — never
 * wait on each other, and Postgres releases it on commit or rollback.
 */
export async function lockPoolLane(tx: Tx, clusterKey: string, material: string): Promise<void> {
  // `$executeRaw`, not `$queryRaw`: the lock function returns `void`, and the
  // driver adapter cannot deserialize a void column into a result row.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${clusterKey}|${material}`})::bigint)`;
}

/**
 * The one pool a cluster is currently filling for a material, created if there
 * isn't one.
 *
 * `liveKey` is what makes "one live pool" true at the database level; the lane
 * lock above is what makes this read-then-create safe, because it guarantees no
 * second writer is between those two halves. Without the lock the loser of a
 * create race would hit the unique constraint, and a unique violation inside a
 * transaction aborts the whole transaction — so there would be nothing left to
 * recover with.
 *
 * Callers MUST hold `lockPoolLane` for the same cluster and material.
 */
export async function findOrCreateLivePool(
  tx: Tx,
  clusterKey: string,
  material: string
): Promise<{ id: string }> {
  const existing = await tx.scrapPool.findFirst({
    where: { clusterKey, material, liveKey: 'LIVE' },
    select: { id: true },
  });
  if (existing) return existing;

  return await tx.scrapPool.create({
    data: { clusterKey, material, liveKey: 'LIVE' },
    select: { id: true },
  });
}

/**
 * The coarsest area a public board may name for this cluster.
 *
 * For an `auto:` cluster the key already carries the artisan's own location, so
 * `publicAreaLabel` reads it directly. For a named SHG the key is the group's
 * name — publishing THAT would identify the group as precisely as a village
 * would, so the area is resolved from the members' locations instead, and the
 * label most of them share is the one published.
 */
export async function clusterAreaLabel(clusterKey: string): Promise<string | null> {
  if (clusterKey.startsWith('auto:')) return publicAreaLabel(clusterKey.slice(5));

  const rows = await prisma.artisanProfile.findMany({
    where: { shgGroupLink: clusterKey },
    select: { shgGroupLink: true, location: true },
    take: 500,
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (clusterKeyOf(row) !== clusterKey) continue;
    const area = publicAreaLabel(row.location);
    if (!area) continue;
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [area, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && area < best)) {
      best = area;
      bestCount = count;
    }
  }
  return best;
}

// ------------------------------------------------- what a cluster is told

/**
 * Notification titles are stored in English and rendered as written — the same
 * convention every other alert in this app follows. They are prefixed so the
 * bell can group them and so a second identical alert can be deduped.
 */
export const SCRAP_LISTED_PREFIX = 'Scrap pool ready: ';
export const SCRAP_DEMOTED_PREFIX = 'Scrap pool back below the minimum: ';
export const SCRAP_ENQUIRY_PREFIX = 'Scrap enquiry: ';
export const SCRAP_SOLD_PREFIX = 'Scrap pool sold: ';

export function scrapListedTitle(material: string): string {
  return `${SCRAP_LISTED_PREFIX}${material}`;
}
export function scrapDemotedTitle(material: string): string {
  return `${SCRAP_DEMOTED_PREFIX}${material}`;
}
export function scrapEnquiryTitle(material: string): string {
  return `${SCRAP_ENQUIRY_PREFIX}${material}`;
}
export function scrapSoldTitle(material: string): string {
  return `${SCRAP_SOLD_PREFIX}${material}`;
}

/** Everyone who has weight in this pool right now. */
export async function poolContributorIds(poolId: string): Promise<string[]> {
  const rows = await prisma.scrapLot.findMany({
    where: { pooledLotId: poolId, status: { in: [...ACTIVE_LOT_STATUSES] } },
    select: { artisanId: true },
    distinct: ['artisanId'],
  });
  return rows.map((row) => row.artisanId);
}

// --------------------------------------------------------- the money read

export interface ScrapEarnings {
  /** Rupees actually credited to this artisan from sold pools. */
  totalReceived: number;
  /** Of that total, how much was a recorded settlement rather than a bank credit. */
  simulated: number;
  real: number;
  rows: Array<{
    poolId: string;
    material: string;
    grams: number;
    amount: number;
    payoutMode: string;
    payoutRef: string | null;
    createdAt: string;
  }>;
}

/**
 * This artisan's scrap income — deliberately its own read.
 *
 * Scrap is a fourth income stream and is never folded into the craft totals.
 * A number that mixes a saree's settlement with three kilos of offcuts tells an
 * artisan nothing about either, and tells a lender something false about both.
 */
export async function readScrapEarnings(artisanId: string): Promise<ScrapEarnings> {
  const shares = await prisma.scrapPayoutShare.findMany({
    where: { artisanId },
    orderBy: { createdAt: 'desc' },
    select: {
      poolId: true,
      grams: true,
      amount: true,
      payoutMode: true,
      payoutRef: true,
      createdAt: true,
      pool: { select: { material: true } },
    },
    take: 100,
  });

  let simulated = 0;
  let real = 0;
  for (const share of shares) {
    if (share.payoutMode === 'SIMULATED') simulated += share.amount;
    else real += share.amount;
  }

  return {
    totalReceived: simulated + real,
    simulated,
    real,
    rows: shares.map((share) => ({
      poolId: share.poolId,
      material: share.pool.material,
      grams: share.grams,
      amount: share.amount,
      payoutMode: share.payoutMode,
      payoutRef: share.payoutRef,
      createdAt: share.createdAt.toISOString(),
    })),
  };
}
