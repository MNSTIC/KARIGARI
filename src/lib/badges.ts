/**
 * Recognition badges — what the artisan's own record already proves.
 *
 * Pure: no Prisma, no React, no i18n. The database side lives in
 * src/lib/badgeRecord.ts, which gathers the counts and upserts what this file
 * says was earned.
 *
 * Three rules this module exists to hold:
 *
 *   1. **Nothing is awarded for showing up.** Every criterion below is a count
 *      of something the artisan actually did — a sale that settled, a piece
 *      priced at or above its own fair-wage floor, a cluster request they
 *      answered. There is no badge for logging in, opening a page or
 *      completing a profile.
 *   2. **A locked badge states its real gap.** `badgeProgress` returns the
 *      artisan's own numbers, so the UI can say "3 more sales" rather than
 *      hiding the condition behind a silhouette.
 *   3. **A badge is never revoked.** `evaluateBadges` answers "is this true
 *      now", and the caller only ever inserts. An artisan who earned
 *      FAIR_WAGE_KEEPER and later experiments with one low price keeps the
 *      badge: it records that something was true, and silently taking it away
 *      would punish them for trying something. The panel's *locked* list is
 *      recomputed live, so the same artisan simply stops seeing it offered.
 */

// ---------------------------------------------------------------- thresholds
// Named, exported, and read by the UI so no screen hard-codes a number.

/** One settled sale in any stream — escrow, demand credit or self-logged cash. */
export const FIRST_SALE_MIN = 1;
/** Ten settled sales across all three streams. */
export const TEN_SALES_MIN = 10;
/** One buyer who came back: a buyer key with at least two purchases. */
export const REPEAT_MAGNET_MIN_BUYERS = 1;
/** Purchases by one buyer before they count as a repeat buyer. */
export const REPEAT_PURCHASES = 2;
/** Listings needed before "every piece is at or above its floor" means anything. */
export const FAIR_WAGE_MIN_LISTINGS = 5;
/** Successful buyer authenticity scans. */
export const VERIFIED_TEN_MIN = 10;
/** Delivered demand orders, all of them on time. */
export const ON_TIME_MIN_ORDERS = 5;
/** Cluster resource requests this artisan accepted for somebody else. */
export const CLUSTER_HELPER_MIN = 3;
/** Pieces catalogued by speaking rather than typing (VOICE or IVR). */
export const VOICE_PIONEER_MIN = 5;

// -------------------------------------------------------------- the catalogue

/**
 * `english` is the wording stored in the `Notification` row when a badge is
 * newly earned. Notification rows are English in this schema — there is no
 * params column — so the badge is identified by parsing this label back out
 * (`parseBadgeTitle`), exactly as the restock reminder parses its day count.
 * It is never what the artisan reads: the bell and the panel both resolve
 * `labelKey` in their own language.
 */
export const BADGES = [
  { key: 'FIRST_SALE', labelKey: 'badge_first_sale', icon: 'Sparkles', english: 'First sale' },
  { key: 'TEN_SALES', labelKey: 'badge_ten_sales', icon: 'Package', english: 'Ten sales' },
  { key: 'REPEAT_MAGNET', labelKey: 'badge_repeat_magnet', icon: 'Users', english: 'Repeat magnet' },
  { key: 'FAIR_WAGE_KEEPER', labelKey: 'badge_fair_wage_keeper', icon: 'Scale', english: 'Fair wage keeper' },
  { key: 'VERIFIED_TEN', labelKey: 'badge_verified_ten', icon: 'ShieldCheck', english: 'Ten verified scans' },
  { key: 'ON_TIME_FIVE', labelKey: 'badge_on_time_five', icon: 'Clock', english: 'Five on time' },
  { key: 'CLUSTER_HELPER', labelKey: 'badge_cluster_helper', icon: 'HandHeart', english: 'Cluster helper' },
  { key: 'VOICE_PIONEER', labelKey: 'badge_voice_pioneer', icon: 'Mic', english: 'Voice pioneer' },
] as const;

export type BadgeKey = (typeof BADGES)[number]['key'];
export type BadgeDefinition = (typeof BADGES)[number];

export const BADGE_KEYS: readonly BadgeKey[] = BADGES.map((b) => b.key);

export function badgeDefinition(key: string): BadgeDefinition | null {
  return BADGES.find((b) => b.key === key) ?? null;
}

export function isBadgeKey(value: unknown): value is BadgeKey {
  return typeof value === 'string' && BADGES.some((b) => b.key === value);
}

// ------------------------------------------------------------------- inputs

/**
 * Every count a badge is decided on. The names that overlap the production
 * record mean exactly what they mean there (src/lib/creditScore.ts), because
 * `gatherBadgeInputs` reads them from the same `gatherCreditInputs` call — two
 * screens cannot disagree about how many sales an artisan has made.
 */
export interface BadgeInputs {
  /** Settled sales across all three streams: storefront + demand + offline. */
  settledSales: number;
  /** Buyers with at least REPEAT_PURCHASES purchases, by My Buyers' own key. */
  repeatBuyers: number;
  /** Every piece the artisan has catalogued. */
  listings: number;
  /** Of those, how many carry an asking price below their own fair-wage floor. */
  listingsBelowFloor: number;
  /** ArtisanProfile.verifiedGenuineCount — successful buyer scans. */
  verifiedScans: number;
  /** Demand orders that reached delivery. */
  ordersDelivered: number;
  /** Of those, how many landed on or before their deadline (no deadline = on time). */
  ordersOnTime: number;
  /** ResourceRequests this artisan accepted for somebody else. */
  requestsAccepted: number;
  /** CraftItems catalogued with catalogMethod VOICE or IVR. */
  voiceCatalogued: number;
}

export const EMPTY_BADGE_INPUTS: BadgeInputs = {
  settledSales: 0,
  repeatBuyers: 0,
  listings: 0,
  listingsBelowFloor: 0,
  verifiedScans: 0,
  ordersDelivered: 0,
  ordersOnTime: 0,
  requestsAccepted: 0,
  voiceCatalogued: 0,
};

/** One earned badge and the figures that earned it, frozen by the caller. */
export interface BadgeAward {
  key: BadgeKey;
  basis: Record<string, number>;
}

/**
 * One badge not yet earned, with the artisan's real position.
 *
 * `gapKey` is the sentence to render: most badges are a simple count
 * ("{have} of {need}"), but FAIR_WAGE_KEEPER and ON_TIME_FIVE can also be held
 * up by a quality condition rather than a quantity, and saying "4 of 5" there
 * would be a lie about what is missing.
 */
export interface BadgeGap {
  key: BadgeKey;
  have: number;
  need: number;
  gapKey: string;
}

/** The default sentence: "{have} of {need}". */
export const GAP_KEY_COUNT = 'badge_locked_gap';
/** "{have} of your {need} pieces are at or above their fair-wage floor." */
export const GAP_KEY_BELOW_FLOOR = 'badge_gap_below_floor';
/** "{have} of {need} delivered orders arrived on time." */
export const GAP_KEY_LATE = 'badge_gap_late';

// --------------------------------------------------------------- evaluation

/** True when every listed piece is priced at or above its own fair-wage floor. */
function keepsFairWage(i: BadgeInputs): boolean {
  return i.listings >= FAIR_WAGE_MIN_LISTINGS && i.listingsBelowFloor === 0;
}

/** True when enough orders were delivered and none of them was late. */
function deliversOnTime(i: BadgeInputs): boolean {
  return i.ordersDelivered >= ON_TIME_MIN_ORDERS && i.ordersOnTime >= i.ordersDelivered;
}

/**
 * Pure. Every badge currently earned, with the numbers that earned it.
 *
 * The caller inserts; a badge already held is simply re-reported and the unique
 * constraint absorbs it, so this never has to know what is already stored.
 */
export function evaluateBadges(i: BadgeInputs): BadgeAward[] {
  const awards: BadgeAward[] = [];

  if (i.settledSales >= FIRST_SALE_MIN) awards.push({ key: 'FIRST_SALE', basis: { sales: i.settledSales } });
  if (i.settledSales >= TEN_SALES_MIN) awards.push({ key: 'TEN_SALES', basis: { sales: i.settledSales } });
  if (i.repeatBuyers >= REPEAT_MAGNET_MIN_BUYERS) {
    awards.push({ key: 'REPEAT_MAGNET', basis: { repeatBuyers: i.repeatBuyers } });
  }
  if (keepsFairWage(i)) {
    awards.push({ key: 'FAIR_WAGE_KEEPER', basis: { listings: i.listings, belowFloor: 0 } });
  }
  if (i.verifiedScans >= VERIFIED_TEN_MIN) {
    awards.push({ key: 'VERIFIED_TEN', basis: { verifiedScans: i.verifiedScans } });
  }
  if (deliversOnTime(i)) {
    awards.push({ key: 'ON_TIME_FIVE', basis: { delivered: i.ordersDelivered, onTime: i.ordersOnTime } });
  }
  if (i.requestsAccepted >= CLUSTER_HELPER_MIN) {
    awards.push({ key: 'CLUSTER_HELPER', basis: { requestsAccepted: i.requestsAccepted } });
  }
  if (i.voiceCatalogued >= VOICE_PIONEER_MIN) {
    awards.push({ key: 'VOICE_PIONEER', basis: { voiceItems: i.voiceCatalogued } });
  }

  return awards;
}

/**
 * Pure. Every badge NOT currently earned, with the real remaining gap.
 *
 * "Not currently earned" is by the criteria, not by the stored rows: an artisan
 * who holds FAIR_WAGE_KEEPER and later prices a piece below its floor keeps the
 * badge (see the header) but stops seeing it in this list, so the panel filters
 * out anything already held before rendering.
 */
export function badgeProgress(i: BadgeInputs): BadgeGap[] {
  const count = (key: BadgeKey, have: number, need: number): BadgeGap => ({
    key,
    have: Math.min(have, need),
    need,
    gapKey: GAP_KEY_COUNT,
  });

  const gaps: BadgeGap[] = [];

  if (i.settledSales < FIRST_SALE_MIN) gaps.push(count('FIRST_SALE', i.settledSales, FIRST_SALE_MIN));
  if (i.settledSales < TEN_SALES_MIN) gaps.push(count('TEN_SALES', i.settledSales, TEN_SALES_MIN));
  if (i.repeatBuyers < REPEAT_MAGNET_MIN_BUYERS) {
    gaps.push(count('REPEAT_MAGNET', i.repeatBuyers, REPEAT_MAGNET_MIN_BUYERS));
  }

  // Two different things can be missing here, and they need different sentences:
  // too few pieces, or pieces priced under their own floor.
  if (!keepsFairWage(i)) {
    if (i.listings < FAIR_WAGE_MIN_LISTINGS) {
      gaps.push(count('FAIR_WAGE_KEEPER', i.listings, FAIR_WAGE_MIN_LISTINGS));
    } else {
      gaps.push({
        key: 'FAIR_WAGE_KEEPER',
        have: i.listings - i.listingsBelowFloor,
        need: i.listings,
        gapKey: GAP_KEY_BELOW_FLOOR,
      });
    }
  }

  if (i.verifiedScans < VERIFIED_TEN_MIN) gaps.push(count('VERIFIED_TEN', i.verifiedScans, VERIFIED_TEN_MIN));

  if (!deliversOnTime(i)) {
    if (i.ordersDelivered < ON_TIME_MIN_ORDERS) {
      gaps.push(count('ON_TIME_FIVE', i.ordersDelivered, ON_TIME_MIN_ORDERS));
    } else {
      gaps.push({
        key: 'ON_TIME_FIVE',
        have: i.ordersOnTime,
        need: i.ordersDelivered,
        gapKey: GAP_KEY_LATE,
      });
    }
  }

  if (i.requestsAccepted < CLUSTER_HELPER_MIN) {
    gaps.push(count('CLUSTER_HELPER', i.requestsAccepted, CLUSTER_HELPER_MIN));
  }
  if (i.voiceCatalogued < VOICE_PIONEER_MIN) {
    gaps.push(count('VOICE_PIONEER', i.voiceCatalogued, VOICE_PIONEER_MIN));
  }

  return gaps;
}

// ------------------------------------------------------- notification titles

/** `Notification.type` for a newly earned badge. */
export const BADGE_NOTIFICATION_TYPE = 'SYSTEM';
/** The stored English title's prefix; the badge's `english` label follows it. */
export const BADGE_TITLE_PREFIX = 'Badge earned: ';

/** The English row that is written to `Notification.title`. */
export function badgeTitle(key: BadgeKey): string {
  return `${BADGE_TITLE_PREFIX}${badgeDefinition(key)?.english ?? key}`;
}

/** The badge a stored title refers to, or null when it is not a badge alert. */
export function parseBadgeTitle(title: string): BadgeKey | null {
  if (!title.startsWith(BADGE_TITLE_PREFIX)) return null;
  const label = title.slice(BADGE_TITLE_PREFIX.length).trim().toLowerCase();
  return BADGES.find((b) => b.english.toLowerCase() === label)?.key ?? null;
}

/**
 * The English body stored alongside it. The numbers are the artisan's own, so
 * even an untranslated row says what earned the badge.
 */
export function badgeMessage(award: BadgeAward): string {
  const figures = Object.entries(award.basis)
    .map(([name, value]) => `${name} ${value}`)
    .join(', ');
  return `Earned from your own record: ${figures}.`;
}
