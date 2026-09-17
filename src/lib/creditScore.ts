import { HEALTH_MAX, clampHealth } from '@/lib/artisanHealth';

/**
 * Production credit score — a pure, deterministic function over real counts.
 *
 * WHAT THIS IS: a summary of what an artisan has verifiably done on Karigari —
 * pieces verified with a QR patch, money that settled, demand orders delivered,
 * months of activity and buyer trust — on a 300–900 scale a loan officer can
 * read at a glance.
 *
 * WHAT THIS IS NOT: a credit rating. Karigari is not a credit bureau, no bank
 * has endorsed this formula, and Karigari does not lend or decide loans. Every
 * surface that renders a profile says so in words that are never collapsed.
 *
 * No AI, no randomness, no hidden constants. Every weight below is exported,
 * printed verbatim in the "How this is calculated" panel, and covered by
 * src/lib/__tests__/creditScore.test.mjs. Changing any of them changes what an
 * already-shared snapshot means, so bump CREDIT_ALGO_VERSION with it.
 */

/** Bump on ANY change to a weight, a saturation point or a rule below. */
export const CREDIT_ALGO_VERSION = 1;
export const SCORE_MIN = 300;
export const SCORE_MAX = 900;
/** Below this many recorded events the score is withheld entirely. */
export const MIN_EVENTS_FOR_SCORE = 5;

// ---- production · 150 -------------------------------------------------------
// The largest share with revenue, because a verified piece is the one record
// here that Karigari itself checked: a QR patch matched to the original capture
// photo. Saturates at 20 so a bulk uploader cannot out-score a steady weaver.
export const PRODUCTION_WEIGHT = 150;
export const PRODUCTION_SATURATION_PIECES = 20;

// ---- revenue · 150 ----------------------------------------------------------
// Equal to production: repayment ability is what a lender asks about first.
// Platform money (released escrow tranches + settled demand credits) counts in
// full; self-logged offline cash counts at half, because nobody but the artisan
// confirmed it. Linear and saturating at ₹1,00,000, so one large sale cannot
// max the component and the arithmetic stays checkable by hand.
export const REVENUE_WEIGHT = 150;
export const REVENUE_SATURATION_RUPEES = 100_000;
export const OFFLINE_REVENUE_WEIGHT = 0.5;

// ---- fulfilment · 120 -------------------------------------------------------
// Delivering what was promised is the closest thing on the platform to a
// repayment record. Needs at least 3 accepted demand orders: one late order out
// of one is 0 %, and that is noise, not a track record. Delivery rate carries
// twice the on-time rate, because a late delivery is still a kept promise.
export const FULFILMENT_WEIGHT = 120;
export const FULFILMENT_DELIVERY_POINTS = 80;
export const FULFILMENT_ON_TIME_POINTS = 40;
export const MIN_ORDERS_FOR_FULFILMENT = 3;

// ---- consistency · 80 -------------------------------------------------------
// Smaller than the money components: regular activity lowers risk, but a year
// of tiny sales is not a year of income. Saturates at 12 active months.
export const CONSISTENCY_WEIGHT = 80;
export const CONSISTENCY_SATURATION_MONTHS = 12;

// ---- trust · 100 ------------------------------------------------------------
// The platform health score (moved only by verified buyer scans and upheld
// complaints — src/lib/artisanHealth.ts) plus how many buyers independently
// verified a piece. Each upheld complaint then costs 25 points on top of its
// health penalty: a lender should see a dispute plainly, not averaged away.
// Floored at 0, never negative.
export const TRUST_WEIGHT = 100;
export const TRUST_HEALTH_POINTS = 60;
export const TRUST_SCAN_POINTS = 40;
export const TRUST_SCAN_SATURATION = 10;
export const TRUST_GUILTY_PENALTY = 25;

/** Lower bounds of each band; below BAND_FAIR_MIN is BUILDING. */
export const BAND_FAIR_MIN = 450;
export const BAND_GOOD_MIN = 600;
export const BAND_STRONG_MIN = 750;

export type CreditBand = 'BUILDING' | 'FAIR' | 'GOOD' | 'STRONG';
export type CreditComponentKey = 'production' | 'revenue' | 'fulfilment' | 'consistency' | 'trust';

export interface CreditInputs {
  verifiedListings: number;       // CraftItem qrVerified === true
  totalListings: number;
  realisedEarnings: number;       // escrow advance + final, whole rupees
  demandEarnings: number;         // ArtisanOrder.settledAmount sum
  offlineEarnings: number;        // OfflineSale.amount sum (weighted lower — unverified)
  ordersAccepted: number;         // ArtisanOrder count
  ordersDelivered: number;        // ArtisanOrder settledAt set, or status DELIVERED | COMPLETED
  ordersOnTime: number;           // delivered where deadline == null || settledAt <= deadline
  activeMonths: number;           // distinct IST YYYY-MM with any listing/sale/order event
  accountAgeMonths: number;       // shown for context; not scored
  buyerVerifiedScans: number;     // ArtisanProfile.verifiedGenuineCount
  guiltyTickets: number;          // Ticket RESOLVED_GUILTY
  healthScore: number;            // ArtisanProfile.healthScore, 0..HEALTH_MAX
  soldCount: number;              // storefront pieces sold (event count only)
  offlineSalesCount: number;      // OfflineSale rows (event count only)
}

export const CREDIT_INPUT_KEYS: readonly (keyof CreditInputs)[] = [
  'verifiedListings',
  'totalListings',
  'realisedEarnings',
  'demandEarnings',
  'offlineEarnings',
  'ordersAccepted',
  'ordersDelivered',
  'ordersOnTime',
  'activeMonths',
  'accountAgeMonths',
  'buyerVerifiedScans',
  'guiltyTickets',
  'healthScore',
  'soldCount',
  'offlineSalesCount',
];

export interface CreditComponent {
  key: CreditComponentKey;
  labelKey: string;
  /** 0..weight, to one decimal. Never above weight, never below 0. */
  points: number;
  weight: number;
  /** The real figures behind the points, for the "how this is calculated" panel. */
  basis: Record<string, number>;
  /** True when this component had too little data and scored 0 by absence. */
  insufficient: boolean;
}

export interface CreditProfile {
  eligible: boolean;              // false when events < MIN_EVENTS_FOR_SCORE
  eventCount: number;
  score: number | null;           // null when !eligible — NEVER a default 300
  band: CreditBand | null;
  components: CreditComponent[];
  inputs: CreditInputs;
  version: number;
  computedAt: string;
}

/** A finite, non-negative number; anything else (NaN, -3, "12") reads as 0. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** One decimal place. Monotone, so rounding can never make a better input score lower. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function creditBand(score: number): CreditBand {
  if (score >= BAND_STRONG_MIN) return 'STRONG';
  if (score >= BAND_GOOD_MIN) return 'GOOD';
  if (score >= BAND_FAIR_MIN) return 'FAIR';
  return 'BUILDING';
}

/** Offline cash at half weight plus platform money in full, before saturation. */
export function weightedRevenue(inputs: Pick<CreditInputs, 'realisedEarnings' | 'demandEarnings' | 'offlineEarnings'>): number {
  return count(inputs.realisedEarnings) + count(inputs.demandEarnings) + OFFLINE_REVENUE_WEIGHT * count(inputs.offlineEarnings);
}

/**
 * Whole calendar months from `from` to `to` in IST — "account age". A month is
 * only counted once its day-of-month has come round again.
 */
export function wholeMonthsBetween(from: Date, to: Date): number {
  const ist = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return { y: get('year'), m: get('month'), d: get('day') };
  };
  if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(+from) || Number.isNaN(+to) || to <= from) return 0;
  const a = ist(from);
  const b = ist(to);
  const months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
  return Math.max(0, months);
}

/** Sanitise every input once, so the components below never see NaN or a negative. */
export function normaliseCreditInputs(raw: Partial<CreditInputs>): CreditInputs {
  const accepted = count(raw.ordersAccepted);
  const delivered = Math.min(count(raw.ordersDelivered), accepted);
  return {
    verifiedListings: count(raw.verifiedListings),
    totalListings: Math.max(count(raw.totalListings), count(raw.verifiedListings)),
    realisedEarnings: Math.round(count(raw.realisedEarnings)),
    demandEarnings: Math.round(count(raw.demandEarnings)),
    offlineEarnings: Math.round(count(raw.offlineEarnings)),
    ordersAccepted: accepted,
    ordersDelivered: delivered,
    ordersOnTime: Math.min(count(raw.ordersOnTime), delivered),
    activeMonths: count(raw.activeMonths),
    accountAgeMonths: count(raw.accountAgeMonths),
    buyerVerifiedScans: count(raw.buyerVerifiedScans),
    guiltyTickets: count(raw.guiltyTickets),
    // A missing health score is not a perfect one: absent reads as 0 here.
    healthScore: clampHealth(count(raw.healthScore)),
    soldCount: count(raw.soldCount),
    offlineSalesCount: count(raw.offlineSalesCount),
  };
}

export function eventCountOf(inputs: CreditInputs): number {
  return inputs.verifiedListings + inputs.ordersAccepted + inputs.soldCount + inputs.offlineSalesCount;
}

export function computeCreditProfile(raw: Partial<CreditInputs>, now: Date = new Date()): CreditProfile {
  const inputs = normaliseCreditInputs(raw);

  const production: CreditComponent = {
    key: 'production',
    labelKey: 'credit_component_production',
    weight: PRODUCTION_WEIGHT,
    points: tenth(PRODUCTION_WEIGHT * Math.min(1, inputs.verifiedListings / PRODUCTION_SATURATION_PIECES)),
    basis: { verifiedListings: inputs.verifiedListings, totalListings: inputs.totalListings },
    insufficient: inputs.verifiedListings === 0,
  };

  const weighted = weightedRevenue(inputs);
  const revenue: CreditComponent = {
    key: 'revenue',
    labelKey: 'credit_component_revenue',
    weight: REVENUE_WEIGHT,
    points: tenth(REVENUE_WEIGHT * Math.min(1, weighted / REVENUE_SATURATION_RUPEES)),
    basis: {
      realisedEarnings: inputs.realisedEarnings,
      demandEarnings: inputs.demandEarnings,
      offlineEarnings: inputs.offlineEarnings,
      weightedRevenue: weighted,
    },
    insufficient: weighted === 0,
  };

  const fulfilmentEnough = inputs.ordersAccepted >= MIN_ORDERS_FOR_FULFILMENT;
  const deliveryRate = inputs.ordersAccepted > 0 ? inputs.ordersDelivered / inputs.ordersAccepted : 0;
  const onTimeRate = inputs.ordersDelivered > 0 ? inputs.ordersOnTime / inputs.ordersDelivered : 0;
  const fulfilment: CreditComponent = {
    key: 'fulfilment',
    labelKey: 'credit_component_fulfilment',
    weight: FULFILMENT_WEIGHT,
    points: fulfilmentEnough
      ? tenth(FULFILMENT_DELIVERY_POINTS * deliveryRate + FULFILMENT_ON_TIME_POINTS * onTimeRate)
      : 0,
    basis: {
      ordersAccepted: inputs.ordersAccepted,
      ordersDelivered: inputs.ordersDelivered,
      ordersOnTime: inputs.ordersOnTime,
    },
    insufficient: !fulfilmentEnough,
  };

  const consistency: CreditComponent = {
    key: 'consistency',
    labelKey: 'credit_component_consistency',
    weight: CONSISTENCY_WEIGHT,
    points: tenth(CONSISTENCY_WEIGHT * Math.min(1, inputs.activeMonths / CONSISTENCY_SATURATION_MONTHS)),
    basis: { activeMonths: inputs.activeMonths, accountAgeMonths: inputs.accountAgeMonths },
    insufficient: inputs.activeMonths === 0,
  };

  const trustRaw =
    TRUST_HEALTH_POINTS * (inputs.healthScore / HEALTH_MAX) +
    TRUST_SCAN_POINTS * Math.min(1, inputs.buyerVerifiedScans / TRUST_SCAN_SATURATION) -
    TRUST_GUILTY_PENALTY * inputs.guiltyTickets;
  const trust: CreditComponent = {
    key: 'trust',
    labelKey: 'credit_component_trust',
    weight: TRUST_WEIGHT,
    points: tenth(Math.min(TRUST_WEIGHT, Math.max(0, trustRaw))),
    basis: {
      healthScore: inputs.healthScore,
      buyerVerifiedScans: inputs.buyerVerifiedScans,
      guiltyTickets: inputs.guiltyTickets,
    },
    // The health record always exists, so trust is never empty by absence.
    insufficient: false,
  };

  const components = [production, revenue, fulfilment, consistency, trust];
  const eventCount = eventCountOf(inputs);
  const eligible = eventCount >= MIN_EVENTS_FOR_SCORE;
  const score = eligible ? Math.round(SCORE_MIN + components.reduce((sum, c) => sum + c.points, 0)) : null;

  return {
    eligible,
    eventCount,
    score,
    band: score === null ? null : creditBand(score),
    components,
    inputs,
    version: CREDIT_ALGO_VERSION,
    computedAt: now.toISOString(),
  };
}

const COMPONENT_KEYS: readonly CreditComponentKey[] = ['production', 'revenue', 'fulfilment', 'consistency', 'trust'];
const BANDS: readonly CreditBand[] = ['BUILDING', 'FAIR', 'GOOD', 'STRONG'];

/** The only basis figures each component may carry — matches `computeCreditProfile` exactly. */
const BASIS_KEYS: Record<CreditComponentKey, readonly string[]> = {
  production: ['verifiedListings', 'totalListings'],
  revenue: ['realisedEarnings', 'demandEarnings', 'offlineEarnings', 'weightedRevenue'],
  fulfilment: ['ordersAccepted', 'ordersDelivered', 'ordersOnTime'],
  consistency: ['activeMonths', 'accountAgeMonths'],
  trust: ['healthScore', 'buyerVerifiedScans', 'guiltyTickets'],
};

/**
 * Read a stored snapshot back through an allow-list.
 *
 * The public page renders whatever this returns, so it copies only the known
 * fields, only as numbers/booleans, and drops everything else — a snapshot that
 * somehow carried an extra field can never leak it. Null when the shape is not
 * a profile at all.
 */
export function readCreditSnapshot(value: unknown): CreditProfile | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.components) || !v.inputs || typeof v.inputs !== 'object') return null;

  const rawInputs = v.inputs as Record<string, unknown>;
  const inputs = {} as CreditInputs;
  for (const key of CREDIT_INPUT_KEYS) inputs[key] = count(rawInputs[key]);

  const components: CreditComponent[] = [];
  for (const key of COMPONENT_KEYS) {
    const found = (v.components as unknown[]).find(
      (c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object' && (c as Record<string, unknown>).key === key
    );
    if (!found) return null;
    const storedBasis = (found.basis && typeof found.basis === 'object' ? found.basis : {}) as Record<string, unknown>;
    const basis: Record<string, number> = {};
    for (const name of BASIS_KEYS[key]) basis[name] = count(storedBasis[name]);
    components.push({
      key,
      labelKey: `credit_component_${key}`,
      points: count(found.points),
      weight: count(found.weight),
      basis,
      insufficient: found.insufficient === true,
    });
  }

  const score = typeof v.score === 'number' && Number.isFinite(v.score) ? v.score : null;
  const band = BANDS.includes(v.band as CreditBand) ? (v.band as CreditBand) : null;
  const computedAt = typeof v.computedAt === 'string' && !Number.isNaN(Date.parse(v.computedAt)) ? v.computedAt : '';
  return {
    eligible: v.eligible === true && score !== null,
    eventCount: count(v.eventCount),
    score,
    band,
    components,
    inputs,
    version: count(v.version) || 1,
    computedAt,
  };
}
