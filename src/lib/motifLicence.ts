import { isMotifHash, type LicenceStatus, type MotifStatus } from '@/lib/motifHash';

/**
 * Licensing arithmetic and the descriptions a motif record may carry.
 *
 * Pure: no Prisma, no React. The reads and writes live in
 * src/lib/motifRecord.ts.
 *
 * Two things this file exists to keep honest:
 *
 *   1. **No money rounds away.** A fee of ₹1,000 across three artisans is
 *      334 + 333 + 333, not three lots of ₹333 with a rupee lost in the gap.
 *      `splitFee` distributes the remainder rupee by rupee to the earliest
 *      registrants and asserts the total.
 *   2. **A description says where it came from.** `source` is AI or HEURISTIC,
 *      it is always carried, and a confidence figure survives only when a model
 *      actually gave one — a colour histogram has no confidence to report.
 */

// ------------------------------------------------------------- descriptors

export type DescriptorSource = 'AI' | 'HEURISTIC';

export interface MotifDescriptors {
  /** Shapes the description names: "fish", "temple spire", "diamond". */
  motifs: string[];
  /** How the pattern repeats about an axis, in plain words. */
  symmetry: string;
  /** What one tile of the repeat contains. */
  repeatUnit: string;
  /** Hex colours, validated. */
  palette: string[];
  /** 0–1, and only ever a figure the model itself stated. Null otherwise. */
  confidence: number | null;
  source: DescriptorSource;
}

export const MAX_DESCRIPTOR_TEXT = 160;
export const MAX_MOTIF_TERMS = 6;
export const MAX_PALETTE = 6;
export const MAX_MOTIF_NAME = 60;

/**
 * How many licensing enquiries one address may file per hour.
 *
 * These live here rather than in the route because a Next.js route module may
 * only export its handlers and its route config — anything else fails the
 * build's own type check on the generated route types. Phase 10 hit the same
 * wall with a thumbnail size cap.
 */
export const LICENCE_RATE_LIMIT = 5;
export const LICENCE_RATE_WINDOW_MS = 60 * 60 * 1000;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Claims this app does not get to make about a registered motif. */
const FORBIDDEN_CLAIMS = [
  /\bGI\b/i,
  /geographical indication/i,
  /\btrademark(ed)?\b/i,
  /\bpatent(ed)?\b/i,
  /\bcopyright(ed)?\b/i,
  /\blegally protected\b/i,
  /\bintellectual property\b/i,
  /\bblockchain\b/i,
  /\bauthenticat(e|ed|ion)\b/i,
  /\bcertified\b/i,
];

function cleanText(value: unknown, max = MAX_DESCRIPTOR_TEXT): string {
  if (typeof value !== 'string') return '';
  const stripped = [...value]
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp < 32) return false;
      if (cp >= 127 && cp < 160) return false;
      if (cp >= 0x202a && cp <= 0x202e) return false;
      return true;
    })
    .join('')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...stripped].slice(0, max).join('').trim();
}

/**
 * True when a sentence claims a legal status this registration does not have.
 *
 * Such a sentence is dropped whole rather than softened: "this motif is
 * GI-protected" edited into "this motif is protected" still says the thing the
 * disclaimer spends a paragraph denying.
 */
export function claimsLegalStatus(text: string): boolean {
  return FORBIDDEN_CLAIMS.some((rule) => rule.test(text));
}

function dropClaims(value: string): string {
  return value
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !claimsLegalStatus(sentence))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTerm(value: unknown): string {
  const text = cleanText(value, 32);
  return claimsLegalStatus(text) ? '' : text;
}

/**
 * Anything a model or a histogram said about a motif, reduced to what may be
 * shown. Never throws; a hopeless input becomes an empty HEURISTIC record.
 */
export function normaliseDescriptors(raw: unknown, source: DescriptorSource): MotifDescriptors {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

  const motifs: string[] = [];
  if (Array.isArray(input.motifs)) {
    for (const entry of input.motifs) {
      const term = cleanTerm(entry);
      if (term && !motifs.includes(term)) motifs.push(term);
      if (motifs.length === MAX_MOTIF_TERMS) break;
    }
  }

  const palette: string[] = [];
  if (Array.isArray(input.palette)) {
    for (const entry of input.palette) {
      const colour = typeof entry === 'string' && HEX.test(entry.trim()) ? entry.trim().toLowerCase() : null;
      if (colour && !palette.includes(colour)) palette.push(colour);
      if (palette.length === MAX_PALETTE) break;
    }
  }

  // A confidence figure only survives on the AI path, and only inside 0–1.
  // A histogram has no confidence, and inventing one would be a number nobody
  // computed.
  let confidence: number | null = null;
  if (source === 'AI') {
    const raw = typeof input.confidence === 'number' ? input.confidence : Number(input.confidence);
    if (Number.isFinite(raw) && raw > 0 && raw <= 1) confidence = Math.round(raw * 100) / 100;
  }

  return {
    motifs,
    symmetry: dropClaims(cleanText(input.symmetry)),
    repeatUnit: dropClaims(cleanText(input.repeatUnit)),
    palette,
    confidence,
    source,
  };
}

/** True when there is anything worth rendering a descriptor panel for. */
export function descriptorsAreUsable(d: MotifDescriptors): boolean {
  return Boolean(d.motifs.length || d.symmetry || d.repeatUnit || d.palette.length);
}

/** A motif name the cluster typed: trimmed, capped, and claiming nothing. */
export function cleanMotifName(value: unknown): string | null {
  const name = cleanText(value, MAX_MOTIF_NAME);
  if (!name || claimsLegalStatus(name)) return null;
  return name;
}

// ---------------------------------------------------------------- the split

export interface FeeShare {
  artisanId: string;
  amount: number;
}

/**
 * Split a fee equally, and give the remainder away rather than losing it.
 *
 * ₹1,000 across three artisans is 334 / 333 / 333. The extra rupees go to the
 * earliest registrants — an arbitrary but stated rule, and the alternative
 * (rounding each share down) quietly keeps the difference, which is the one
 * outcome a payout ledger must never produce.
 *
 * Throws when the arithmetic would not add up, because a caller that has
 * already written a `paidAt` cannot recover from a bad split afterwards.
 */
export function splitFee(total: number, artisanIds: readonly string[]): FeeShare[] {
  if (!Number.isInteger(total) || total <= 0) {
    throw new Error(`motifLicence: a fee must be a positive whole number of rupees, got ${total}`);
  }
  if (artisanIds.length === 0) {
    throw new Error('motifLicence: no artisan to pay');
  }

  const base = Math.floor(total / artisanIds.length);
  let remainder = total - base * artisanIds.length;

  const shares = artisanIds.map((artisanId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { artisanId, amount: base + extra };
  });

  const sum = shares.reduce((running, share) => running + share.amount, 0);
  if (sum !== total) {
    throw new Error(`motifLicence: shares summed to ${sum}, not ${total}`);
  }
  return shares;
}

// ------------------------------------------------------------ transitions

/**
 * Where a licence may go next. Every terminal state is a dead end on purpose:
 * a declined enquiry is not re-opened behind the cluster's back, and a paid one
 * is never re-decided.
 */
export const LICENCE_TRANSITIONS: Record<LicenceStatus, readonly LicenceStatus[]> = {
  REQUESTED: ['ACCEPTED', 'DECLINED', 'WITHDRAWN'],
  ACCEPTED: ['PAID', 'WITHDRAWN'],
  DECLINED: [],
  PAID: [],
  WITHDRAWN: [],
};

export function canMoveLicence(from: LicenceStatus, to: LicenceStatus): boolean {
  return LICENCE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** A licence is payable only once a human agreed a figure. */
export function payoutRefusal(licence: {
  status: LicenceStatus;
  feeAmount: number | null;
  paidAt: Date | string | null;
}): 'ALREADY_PAID' | 'NOT_ACCEPTED' | 'NO_FEE' | null {
  if (licence.paidAt) return 'ALREADY_PAID';
  if (licence.status !== 'ACCEPTED') return 'NOT_ACCEPTED';
  if (!licence.feeAmount || licence.feeAmount <= 0) return 'NO_FEE';
  return null;
}

// --------------------------------------------------------- the public shape

/**
 * Exactly what a motif record may show a visitor with no session.
 *
 * Built field by field from an allow-list, never by deleting from a row: the
 * submitting artisan's contact details, their id, their mobile number and the
 * cluster's raw key are all absent because they were never put in, not because
 * something remembered to remove them.
 */
export interface PublicMotif {
  id: string;
  name: string;
  hash: string;
  /** The cluster's readable name, never the raw `auto:<location>` key. */
  clusterName: string;
  /** The artisan's display name, for credit. No contact, no id. */
  submittedBy: string;
  descriptors: MotifDescriptors;
  referenceImageUrl: string | null;
  status: MotifStatus;
  licensable: boolean;
  registeredAt: string;
}

/** `auto:bargarh, odisha` → `Bargarh, Odisha`; an SHG name passes through. */
export function clusterDisplayName(key: string): string {
  const raw = key.startsWith('auto:') ? key.slice(5) : key;
  return raw
    .split(/(\s|,)/)
    .map((part) => (/^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part))
    .join('');
}

export function toPublicMotif(row: {
  id: string;
  name: string;
  hash: string;
  clusterKey: string;
  submittedBy: { name: string } | null;
  descriptors: unknown;
  referenceImageUrl: string | null;
  status: string;
  licensable: boolean;
  registeredAt: Date;
}): PublicMotif {
  const descriptors = row.descriptors as { source?: unknown } | null;
  const source: DescriptorSource = descriptors?.source === 'AI' ? 'AI' : 'HEURISTIC';
  return {
    id: row.id,
    name: row.name,
    hash: isMotifHash(row.hash) ? row.hash : '',
    clusterName: clusterDisplayName(row.clusterKey),
    submittedBy: row.submittedBy?.name ?? '',
    descriptors: normaliseDescriptors(row.descriptors, source),
    referenceImageUrl: row.referenceImageUrl,
    status: (row.status as MotifStatus) ?? 'PENDING',
    licensable: row.licensable,
    registeredAt: row.registeredAt.toISOString(),
  };
}
