import { prisma } from '@/lib/prisma';

/**
 * The database side of the motif register.
 *
 * Server-only (it imports Prisma). The fingerprint arithmetic is in the pure
 * src/lib/motifHash.ts and the licensing arithmetic in src/lib/motifLicence.ts,
 * so both can be tested without a database.
 *
 * The rule this file exists to hold: **a registration belongs to the cluster.**
 * Every read here is keyed on `clusterKey`, never on the artisan who filed it,
 * and every payout splits across the cluster's registered artisans. Attributing
 * a village's motif to whoever photographed it first would be the appropriation
 * the feature is built to resist.
 */

/** The app-wide cluster key (§2.10 rule 9) — the same expression as /api/artisan/resource-request. */
export function clusterKeyOf(profile: { shgGroupLink: string | null; location: string | null }): string | null {
  const shg = profile.shgGroupLink?.trim() || null;
  const location = profile.location?.trim() || null;
  return shg ? shg : location ? `auto:${location.toLowerCase()}` : null;
}

export async function clusterKeyFor(artisanId: string): Promise<string | null> {
  const profile = await prisma.artisanProfile.findUnique({
    where: { userId: artisanId },
    select: { shgGroupLink: true, location: true },
  });
  return profile ? clusterKeyOf(profile) : null;
}

/** Ceiling on the profiles one cluster lookup will read. */
const MAX_CLUSTER = 500;

/**
 * Every artisan whose resolved key is this cluster's.
 *
 * A coarse filter in SQL, then the key recomputed in JS so membership is
 * byte-for-byte the rule every other screen applies.
 */
export async function clusterArtisanIds(clusterKey: string): Promise<string[]> {
  const isShg = !clusterKey.startsWith('auto:');
  const rows = await prisma.artisanProfile.findMany({
    where: isShg ? { shgGroupLink: clusterKey } : { shgGroupLink: null },
    select: { userId: true, shgGroupLink: true, location: true },
    take: MAX_CLUSTER,
  });
  return rows.filter((row) => clusterKeyOf(row) === clusterKey).map((row) => row.userId);
}

/**
 * The artisans a licence fee is split across: those holding a REGISTERED motif
 * in this cluster, earliest registration first.
 *
 * Earliest first is what makes `splitFee`'s remainder rule ("the extra rupees go
 * to the earliest registrants") mean something stable rather than whatever order
 * the database happened to return.
 *
 * A FLAGGED_DUPLICATE or PENDING registration does not qualify: money must not
 * be paid out on a record a human has not confirmed.
 */
export async function payableArtisanIds(clusterKey: string): Promise<string[]> {
  const rows = await prisma.motifRegistration.findMany({
    where: { clusterKey, status: 'REGISTERED' },
    orderBy: { registeredAt: 'asc' },
    select: { submittedById: true },
  });
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of rows) {
    if (seen.has(row.submittedById)) continue;
    seen.add(row.submittedById);
    ordered.push(row.submittedById);
  }
  return ordered;
}

/**
 * Tell a cluster something, once per artisan.
 *
 * Deduped on the stored English title within the window, the same belt-and-
 * braces the restock reminder uses: the point is that a second enquiry about the
 * same motif does not produce a second identical alert.
 */
export async function notifyCluster(
  artisanIds: readonly string[],
  title: string,
  message: string,
  withinMs = 60 * 60 * 1000
): Promise<number> {
  if (artisanIds.length === 0) return 0;
  const since = new Date(Date.now() - withinMs);

  const already = await prisma.notification.findMany({
    where: { userId: { in: [...artisanIds] }, type: 'SYSTEM', title, createdAt: { gte: since } },
    select: { userId: true },
  });
  const seen = new Set(already.map((row) => row.userId));
  const fresh = artisanIds.filter((id) => !seen.has(id));
  if (fresh.length === 0) return 0;

  const written = await prisma.notification.createMany({
    data: fresh.map((userId) => ({ userId, type: 'SYSTEM', title, message, channel: 'IN_APP' })),
  });
  return written.count;
}

/** The English title a licence enquiry is stored under, and its parser. */
export const LICENCE_TITLE_PREFIX = 'Licence enquiry: ';

export function licenceEnquiryTitle(motifName: string): string {
  return `${LICENCE_TITLE_PREFIX}${motifName}`;
}

export function parseLicenceEnquiry(title: string): string | null {
  return title.startsWith(LICENCE_TITLE_PREFIX) ? title.slice(LICENCE_TITLE_PREFIX.length) : null;
}

/** The English title a paid licence is stored under. */
export const PAYOUT_TITLE_PREFIX = 'Motif licence paid: ';

export function licencePaidTitle(motifName: string): string {
  return `${PAYOUT_TITLE_PREFIX}${motifName}`;
}

export function parseLicencePaid(title: string): string | null {
  return title.startsWith(PAYOUT_TITLE_PREFIX) ? title.slice(PAYOUT_TITLE_PREFIX.length) : null;
}

/** What the cluster has actually been paid, and this artisan's part of it. */
export interface TrustLedger {
  /** Rupees the cluster has received across all settled licences. */
  clusterTotal: number;
  /** This artisan's own frozen shares. */
  yourTotal: number;
  /** How much of the total was a real bank payout rather than a recorded one. */
  realTotal: number;
  simulatedTotal: number;
  rows: {
    licenceId: string;
    motifName: string;
    amount: number;
    payoutMode: string;
    paidAt: string;
  }[];
}

/**
 * The village trust view.
 *
 * Reports only money that a payout actually ran for. There is no projected
 * figure and no "potential earnings": an empty ledger says it is empty.
 */
export async function readTrustLedger(artisanId: string, clusterKey: string): Promise<TrustLedger> {
  const shares = await prisma.motifPayoutShare.findMany({
    where: { licence: { motif: { clusterKey } } },
    orderBy: { createdAt: 'desc' },
    select: {
      licenceId: true,
      artisanId: true,
      amount: true,
      payoutMode: true,
      createdAt: true,
      licence: { select: { motif: { select: { name: true } } } },
    },
  });

  let clusterTotal = 0;
  let yourTotal = 0;
  let realTotal = 0;
  let simulatedTotal = 0;
  const rows: TrustLedger['rows'] = [];

  for (const share of shares) {
    clusterTotal += share.amount;
    if (share.payoutMode === 'RAZORPAYX') realTotal += share.amount;
    else simulatedTotal += share.amount;
    if (share.artisanId === artisanId) {
      yourTotal += share.amount;
      rows.push({
        licenceId: share.licenceId,
        motifName: share.licence.motif.name,
        amount: share.amount,
        payoutMode: share.payoutMode,
        paidAt: share.createdAt.toISOString(),
      });
    }
  }

  return { clusterTotal, yourTotal, realTotal, simulatedTotal, rows };
}
