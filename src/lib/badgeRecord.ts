import { prisma } from '@/lib/prisma';
import { STOREFRONT_SOLD_STATUSES, normaliseBuyerKey } from '@/lib/buyers';
import { gatherCreditInputs } from '@/lib/creditRecord';
import type { CreditInputs } from '@/lib/creditScore';
import {
  BADGE_NOTIFICATION_TYPE,
  REPEAT_PURCHASES,
  badgeMessage,
  badgeProgress,
  badgeTitle,
  evaluateBadges,
  isBadgeKey,
  type BadgeAward,
  type BadgeGap,
  type BadgeInputs,
  type BadgeKey,
} from '@/lib/badges';

/**
 * The database side of recognition badges.
 *
 * Server-only (it imports Prisma). The criteria live in the pure
 * src/lib/badges.ts, so they can be tested without a database.
 *
 * This module is the ONLY writer of `ArtisanBadge`. There is no admin action
 * that grants a badge and no endpoint that takes a badge key from a request
 * body: `awardBadges` reads the artisan's own rows, asks `evaluateBadges` what
 * is true, and inserts. A caller cannot ask for a badge, only for the truth to
 * be re-checked.
 *
 * Idempotency is the `@@unique([artisanId, key])` constraint rather than a
 * read-then-write: ten dashboard loads at once all try the same insert and
 * Postgres lets exactly one through, so exactly one bell notification is
 * written. The others see P2002 and stop.
 *
 * The counts that overlap the production record come from `gatherCreditInputs`,
 * so "sales" means on this panel exactly what it means on the Credit record tab.
 */

/** Counts a badge needs that the credit record does not already gather. */
async function gatherExtras(artisanId: string) {
  const [settledDemandOrders, listingsBelowFloor, requestsAccepted, voiceCatalogued, storefront, demand, offline] =
    await Promise.all([
      prisma.artisanOrder.count({ where: { artisanId, settledAt: { not: null } } }),
      // A piece the artisan priced under the floor calculated for it. Only rows
      // that have both numbers can be judged; a piece with no asking price has
      // not been priced at all, and is neither a keeper nor a breach.
      prisma.craftItem.count({
        where: {
          artisanId,
          fairWageFloor: { not: null },
          askingPrice: { not: null, lt: prisma.craftItem.fields.fairWageFloor },
        },
      }),
      prisma.resourceRequest.count({ where: { acceptedById: artisanId } }),
      prisma.craftItem.count({ where: { artisanId, catalogMethod: { in: ['VOICE', 'IVR'] } } }),
      // The three purchase sources My Buyers aggregates, reduced to the only
      // column a repeat buyer is decided on.
      prisma.craftItem.findMany({
        where: { artisanId, OR: [{ paidAt: { not: null } }, { status: { in: STOREFRONT_SOLD_STATUSES } }] },
        select: { buyerName: true },
      }),
      prisma.artisanOrder.findMany({
        where: { artisanId, settledAt: { not: null } },
        select: { demand: { select: { buyerName: true } } },
      }),
      prisma.offlineSale.findMany({ where: { artisanId }, select: { buyerName: true } }),
    ]);

  // Same identity rule as My Buyers (`normaliseBuyerKey`), so the two screens
  // cannot disagree about who came back. An unnamed purchase belongs to nobody
  // and is counted for no buyer.
  const purchases = new Map<string, number>();
  for (const name of [
    ...storefront.map((row) => row.buyerName),
    ...demand.map((row) => row.demand?.buyerName ?? null),
    ...offline.map((row) => row.buyerName),
  ]) {
    const key = normaliseBuyerKey(name);
    if (!key) continue;
    purchases.set(key, (purchases.get(key) ?? 0) + 1);
  }
  const repeatBuyers = [...purchases.values()].filter((count) => count >= REPEAT_PURCHASES).length;

  return { settledDemandOrders, listingsBelowFloor, requestsAccepted, voiceCatalogued, repeatBuyers };
}

/**
 * Every count a badge is decided on.
 *
 * `credit` may be passed in by a caller that already has it (the recognition
 * route computes the skill stage from the same gather), so one request does not
 * run the fourteen credit aggregates twice.
 */
export async function gatherBadgeInputs(
  artisanId: string,
  now: Date = new Date(),
  credit?: CreditInputs
): Promise<BadgeInputs> {
  const [base, extras] = await Promise.all([
    credit ? Promise.resolve(credit) : gatherCreditInputs(artisanId, now),
    gatherExtras(artisanId),
  ]);

  return {
    // All three streams. An offline sale is still a sale the artisan made, and
    // the first one is exactly the moment this feature exists to notice.
    settledSales: base.soldCount + extras.settledDemandOrders + base.offlineSalesCount,
    repeatBuyers: extras.repeatBuyers,
    listings: base.totalListings,
    listingsBelowFloor: extras.listingsBelowFloor,
    verifiedScans: base.buyerVerifiedScans,
    ordersDelivered: base.ordersDelivered,
    ordersOnTime: base.ordersOnTime,
    requestsAccepted: extras.requestsAccepted,
    voiceCatalogued: extras.voiceCatalogued,
  };
}

/** One badge as the panel and the bell read it. */
export interface EarnedBadge {
  key: BadgeKey;
  awardedAt: string;
  /** The figures frozen at award time — not today's, which may be higher. */
  basis: Record<string, number>;
}

/** Only numbers survive the round trip through `Json`; anything else is dropped. */
function readBasis(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) out[name] = raw;
  }
  return out;
}

/** What this artisan already holds, newest first. Read-only. */
export async function listBadges(artisanId: string): Promise<EarnedBadge[]> {
  const rows = await prisma.artisanBadge.findMany({
    where: { artisanId },
    orderBy: { awardedAt: 'desc' },
    select: { key: true, basis: true, awardedAt: true },
  });
  return rows
    .filter((row) => isBadgeKey(row.key))
    .map((row) => ({
      key: row.key as BadgeKey,
      awardedAt: row.awardedAt.toISOString(),
      basis: readBasis(row.basis),
    }));
}

/**
 * Write the bell alert for a badge that was just earned.
 *
 * Best-effort: a badge that landed must not be reported as a failure because an
 * alert could not be written. The title check is belt and braces for rows
 * written before `ArtisanBadge` existed — the unique constraint on the badge
 * itself is what actually prevents a second alert.
 */
async function notifyBadge(artisanId: string, award: BadgeAward): Promise<void> {
  const title = badgeTitle(award.key);
  try {
    const existing = await prisma.notification.findFirst({
      where: { userId: artisanId, type: BADGE_NOTIFICATION_TYPE, title },
      select: { id: true },
    });
    if (existing) return;

    await prisma.notification.create({
      data: {
        userId: artisanId,
        type: BADGE_NOTIFICATION_TYPE,
        // English in the row and translated at render, the convention every
        // other notification in this table follows.
        title,
        message: badgeMessage(award),
        channel: 'IN_APP',
      },
    });
  } catch (error) {
    console.warn('[badges] notification failed:', (error as Error)?.message);
  }
}

/**
 * Award everything currently earned. Idempotent, and safe to call ten times at
 * once: the unique constraint decides who wins each insert, and only the winner
 * writes a notification.
 *
 * Returns the badges that were NEW on this call — an empty array is the normal
 * case and is not an error.
 */
export async function awardBadges(
  artisanId: string,
  now: Date = new Date(),
  credit?: CreditInputs
): Promise<BadgeAward[]> {
  const inputs = await gatherBadgeInputs(artisanId, now, credit);
  const earned = evaluateBadges(inputs);
  if (earned.length === 0) return [];

  // One read to skip the ones already held, so the common path writes nothing
  // at all. The insert below still assumes it can lose a race.
  const held = new Set((await listBadges(artisanId)).map((badge) => badge.key));
  const fresh: BadgeAward[] = [];

  for (const award of earned) {
    if (held.has(award.key)) continue;
    try {
      await prisma.artisanBadge.create({
        data: { artisanId, key: award.key, basis: award.basis, awardedAt: now },
        select: { id: true },
      });
      fresh.push(award);
    } catch (error) {
      // P2002: somebody else awarded it between the read and the insert. That
      // is the constraint doing its job, not a failure.
      if ((error as { code?: string })?.code !== 'P2002') throw error;
    }
  }

  for (const award of fresh) await notifyBadge(artisanId, award);
  return fresh;
}

/** Everything the recognition panel needs about badges, after awarding. */
export interface BadgeRecord {
  earned: EarnedBadge[];
  locked: BadgeGap[];
  inputs: BadgeInputs;
}

/**
 * Evaluate, award what is new, and report both halves.
 *
 * The locked list is recomputed from today's figures and then filtered against
 * what is held, so a badge that was earned and would no longer be earned stays
 * on the shelf without reappearing in "how to earn" — see the note on
 * `evaluateBadges` about why badges are never revoked.
 */
export async function readBadgeRecord(
  artisanId: string,
  now: Date = new Date(),
  credit?: CreditInputs
): Promise<BadgeRecord> {
  const inputs = await gatherBadgeInputs(artisanId, now, credit);
  const earnedNow = evaluateBadges(inputs);
  const held = new Set((await listBadges(artisanId)).map((badge) => badge.key));

  for (const award of earnedNow) {
    if (held.has(award.key)) continue;
    try {
      await prisma.artisanBadge.create({
        data: { artisanId, key: award.key, basis: award.basis, awardedAt: now },
        select: { id: true },
      });
      held.add(award.key);
      await notifyBadge(artisanId, award);
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      held.add(award.key);
    }
  }

  const earned = await listBadges(artisanId);
  const locked = badgeProgress(inputs).filter((gap) => !held.has(gap.key));
  return { earned, locked, inputs };
}
