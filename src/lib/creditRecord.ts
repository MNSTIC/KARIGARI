import { prisma } from '@/lib/prisma';
import { STOREFRONT_SOLD_STATUSES } from '@/lib/buyers';
import {
  readCreditSnapshot,
  wholeMonthsBetween,
  type CreditInputs,
  type CreditProfile,
} from '@/lib/creditScore';
import { creditSharePath, isShareToken } from '@/lib/creditShare';

/**
 * The database side of the production record: gathering the real counts the
 * score is computed from, listing an artisan's live share links, and the one
 * public read a loan officer's link performs.
 *
 * Server-only (it imports Prisma). The arithmetic lives in the pure
 * src/lib/creditScore.ts, so it can be tested without a database.
 */

/** Demand-order statuses that mean the promise was kept, alongside a settled credit. */
const DELIVERED_ORDER_STATUSES = ['DELIVERED', 'COMPLETED'];

/**
 * Every input to `computeCreditProfile`, in one round trip of aggregate queries
 * — counts, sums and one `COUNT(DISTINCT month)` — and no row-by-row loop.
 *
 * Each figure uses the same basis as the screen that already shows it, so the
 * record reconciles with what the artisan sees elsewhere:
 *   realisedEarnings — the Money tab's escrow stream (`onlineEarnings`)
 *   demandEarnings   — the Money tab's demand stream (`settledAt` set)
 *   offlineEarnings  — the offline ledger total
 *   soldCount        — My Buyers' storefront source
 */
export async function gatherCreditInputs(artisanId: string, now: Date = new Date()): Promise<CreditInputs> {
  const delivered = {
    OR: [{ settledAt: { not: null } }, { status: { in: DELIVERED_ORDER_STATUSES } }],
  };

  const [
    verifiedListings,
    totalListings,
    advances,
    finals,
    demand,
    offline,
    ordersAccepted,
    ordersDelivered,
    ordersOnTime,
    soldCount,
    profile,
    guiltyTickets,
    user,
    months,
  ] = await Promise.all([
    prisma.craftItem.count({ where: { artisanId, qrVerified: true } }),
    prisma.craftItem.count({ where: { artisanId } }),
    prisma.craftItem.aggregate({
      _sum: { advancePaid: true },
      where: { artisanId, status: { in: ['ADVANCE_PAID', 'SOLD_FINAL'] } },
    }),
    prisma.craftItem.aggregate({
      _sum: { finalPayoutQueued: true },
      where: { artisanId, status: 'SOLD_FINAL' },
    }),
    prisma.artisanOrder.aggregate({
      _sum: { settledAmount: true },
      where: { artisanId, settledAt: { not: null } },
    }),
    prisma.offlineSale.aggregate({ _sum: { amount: true }, _count: { _all: true }, where: { artisanId } }),
    prisma.artisanOrder.count({ where: { artisanId } }),
    prisma.artisanOrder.count({ where: { artisanId, ...delivered } }),
    // On time: no deadline was set, or the buyer's delivery confirmation
    // (`settledAt`, the only delivery timestamp an order has) landed on or before
    // it. A delivered order with a deadline but no settlement cannot be shown to
    // be on time, so it is not counted as such.
    prisma.artisanOrder.count({
      where: {
        artisanId,
        AND: [
          delivered,
          { OR: [{ deadline: null }, { settledAt: { lte: prisma.artisanOrder.fields.deadline } }] },
        ],
      },
    }),
    prisma.craftItem.count({
      where: { artisanId, OR: [{ paidAt: { not: null } }, { status: { in: STOREFRONT_SOLD_STATUSES } }] },
    }),
    prisma.artisanProfile.findUnique({
      where: { userId: artisanId },
      select: { healthScore: true, verifiedGenuineCount: true },
    }),
    prisma.ticket.count({ where: { craftItem: { artisanId }, status: 'RESOLVED_GUILTY' } }),
    prisma.user.findUnique({ where: { id: artisanId }, select: { createdAt: true } }),
    // A month is active when anything was recorded in it, in IST: a piece
    // catalogued, a piece paid for, an offline sale, a demand order accepted or
    // settled. Columns are `timestamp without time zone` holding UTC.
    prisma.$queryRaw<{ months: number }[]>`
      SELECT COUNT(DISTINCT month)::int AS months FROM (
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month
          FROM "CraftItem" WHERE "artisanId" = ${artisanId}
        UNION ALL
        SELECT to_char(("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')
          FROM "CraftItem" WHERE "artisanId" = ${artisanId} AND "paidAt" IS NOT NULL
        UNION ALL
        SELECT to_char(("soldAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')
          FROM "OfflineSale" WHERE "artisanId" = ${artisanId}
        UNION ALL
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')
          FROM "ArtisanOrder" WHERE "artisanId" = ${artisanId}
        UNION ALL
        SELECT to_char(("settledAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')
          FROM "ArtisanOrder" WHERE "artisanId" = ${artisanId} AND "settledAt" IS NOT NULL
      ) AS events
    `,
  ]);

  return {
    verifiedListings,
    totalListings,
    realisedEarnings: Math.round((advances._sum.advancePaid ?? 0) + (finals._sum.finalPayoutQueued ?? 0)),
    demandEarnings: Math.round(demand._sum.settledAmount ?? 0),
    offlineEarnings: offline._sum.amount ?? 0,
    ordersAccepted,
    ordersDelivered,
    ordersOnTime,
    activeMonths: Number(months[0]?.months ?? 0),
    accountAgeMonths: user ? wholeMonthsBetween(user.createdAt, now) : 0,
    buyerVerifiedScans: profile?.verifiedGenuineCount ?? 0,
    guiltyTickets,
    // No profile row means no health record, which is not a perfect one.
    healthScore: profile?.healthScore ?? 0,
    soldCount,
    offlineSalesCount: offline._count._all,
  };
}

export interface ActiveCreditShare {
  id: string;
  url: string;
  sharedWith: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

/** The artisan's live links, newest first. Revoked and expired ones are not "active". */
export async function listActiveShares(artisanId: string, origin: string, now: Date = new Date()): Promise<ActiveCreditShare[]> {
  const rows = await prisma.creditProfileShare.findMany({
    where: { artisanId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      token: true,
      sharedWith: true,
      viewCount: true,
      lastViewedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    url: `${origin}${creditSharePath(row.token)}`,
    sharedWith: row.sharedWith,
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Exactly what a share link may show. Built field by field from an explicit
 * allow-list: never the mobile number, UPI id, bank account, Aadhaar digits,
 * income, social category, gender or any buyer's name.
 */
export interface PublicCreditRecord {
  artisan: {
    name: string;
    location: string | null;
    craftType: string | null;
    photoUrl: string | null;
  };
  sharedWith: string | null;
  createdAt: string;
  expiresAt: string;
  version: number;
  profile: CreditProfile;
}

export type CreditShareLookup =
  | { state: 'FOUND'; record: PublicCreditRecord }
  | { state: 'GONE' }
  | { state: 'NOT_FOUND' };

/**
 * Open a share link: count the view and return the frozen record.
 *
 * The view is counted by a conditional `updateMany` first, so a revoked or
 * expired link is never counted and the "is it live" check and the increment
 * cannot race. Only after that is the row read, through the allow-list above.
 * A malformed token never reaches the database.
 */
export async function openCreditShare(token: string, now: Date = new Date()): Promise<CreditShareLookup> {
  if (!isShareToken(token)) return { state: 'NOT_FOUND' };

  const counted = await prisma.creditProfileShare.updateMany({
    where: { token, revokedAt: null, expiresAt: { gt: now } },
    data: { viewCount: { increment: 1 }, lastViewedAt: now },
  });
  if (counted.count === 0) {
    const exists = await prisma.creditProfileShare.findUnique({ where: { token }, select: { id: true } });
    return exists ? { state: 'GONE' } : { state: 'NOT_FOUND' };
  }

  const row = await prisma.creditProfileShare.findUnique({
    where: { token },
    select: {
      snapshot: true,
      version: true,
      sharedWith: true,
      createdAt: true,
      expiresAt: true,
      artisan: {
        select: {
          name: true,
          artisanProfile: { select: { location: true, craftType: true, photoUrl: true } },
        },
      },
    },
  });
  const profile = row ? readCreditSnapshot(row.snapshot) : null;
  if (!row || !profile) return { state: 'GONE' };

  return {
    state: 'FOUND',
    record: {
      artisan: {
        name: row.artisan.name,
        location: row.artisan.artisanProfile?.location ?? null,
        craftType: row.artisan.artisanProfile?.craftType ?? null,
        photoUrl: row.artisan.artisanProfile?.photoUrl ?? null,
      },
      sharedWith: row.sharedWith,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      version: row.version,
      profile,
    },
  };
}
