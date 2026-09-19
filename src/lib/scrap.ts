/**
 * Scrap-to-Wealth — the arithmetic, with no database and no network.
 *
 * Offcuts, shavings and clay waste are burned or dumped because one artisan's
 * kilo is not worth a recycler's trip. Pooled across a cluster it is. That is
 * the whole idea, and everything here exists to make the pooling honest:
 *
 *   · **Weight is the unit of account, in grams.** Every total, every threshold
 *     and every share is an integer, so a hundred contributors can be added up
 *     without a float drifting a gram away from what they logged.
 *   · **A threshold is Karigari's own operating minimum, never a market fact.**
 *     There is no scrap price feed available to this project and no recycler
 *     directory, so this file states no price and names no buyer.
 *   · **No rupee rounds away.** `splitProRata` throws before a caller can write
 *     shares that do not sum to exactly the sale price.
 *   · **A public board must not point at a village.** `publicAreaLabel` gives
 *     back the coarsest area it can honestly stand behind, and nothing at all
 *     when it cannot tell a district from a hamlet.
 *
 * Pure: no React, no Prisma, no `fetch`, so `src/lib/__tests__/scrap.test.mjs`
 * can run the arithmetic under plain Node. The database side is in
 * `src/lib/scrapRecord.ts`.
 */

export const SCRAP_MATERIALS = [
  'COTTON_OFFCUT',
  'SILK_OFFCUT',
  'WOOL_YARN',
  'JUTE',
  'WOOD_SHAVING',
  'BAMBOO',
  'CLAY',
  'METAL_SCRAP',
  'LEATHER',
  'PAPER',
  'OTHER',
] as const;

export type ScrapMaterial = (typeof SCRAP_MATERIALS)[number];

/** LOGGED → POOLED on attach, → SOLD with its pool, → WITHDRAWN by the artisan. */
export type ScrapLotStatus = 'LOGGED' | 'POOLED' | 'SOLD' | 'WITHDRAWN';

/** OPEN until the weight crosses the threshold, LISTED until a sale is recorded. */
export type ScrapPoolStatus = 'OPEN' | 'LISTED' | 'SOLD';

/**
 * Minimum pooled weight, in grams, before Karigari will put a lot in front of a
 * recycler.
 *
 * **Every figure here is a judgement call by this project and is documented as
 * one.** No trade body publishes a minimum pickup weight for village craft
 * waste, and inventing a citation for these would be worse than admitting they
 * are ours. They are set by bulk and by density, on one question: how much of
 * this material fills enough of a small tempo to be worth the driver's diesel?
 * Clay and wood are heavy and cheap, so they need a lot. Silk and brass are
 * light or dense and worth more per kilo, so they need less.
 *
 * A cluster that finds a figure wrong should be able to say so and have it
 * changed here, in one place, rather than argue with a number the code presents
 * as a law of the market.
 */
export const LOT_THRESHOLD_GRAMS: Record<ScrapMaterial, number> = {
  COTTON_OFFCUT: 15_000,
  SILK_OFFCUT: 5_000,
  WOOL_YARN: 10_000,
  JUTE: 25_000,
  WOOD_SHAVING: 30_000,
  BAMBOO: 25_000,
  CLAY: 50_000,
  METAL_SCRAP: 8_000,
  LEATHER: 10_000,
  PAPER: 20_000,
  OTHER: 20_000,
};

/** One lot's bounds: a gram is the smallest honest entry, half a tonne the largest. */
export const MIN_LOT_GRAMS = 1;
export const MAX_LOT_GRAMS = 500_000;

/** A recycler enquiry rate limit, per salted address digest. */
export const ENQUIRY_RATE_LIMIT = 5;
export const ENQUIRY_RATE_WINDOW_MS = 60 * 60 * 1000;

/** The longest data URL a scrap photo may be, after the client downscales it. */
export const MAX_SCRAP_PHOTO_BYTES = 120_000;
/** The longest edge a scrap photo is downscaled to before it is sent. */
export const SCRAP_PHOTO_MAX_EDGE = 480;

/**
 * A few spellings an artisan actually types, mapped to the pooling material.
 *
 * Deliberately short. A long synonym table would be a guess at what people say
 * in four languages; anything not listed pools under OTHER, and the screen says
 * "pooled as Other" rather than silently filing cotton under jute.
 */
const MATERIAL_SYNONYMS: Record<string, ScrapMaterial> = {
  COTTON: 'COTTON_OFFCUT',
  COTTON_SCRAP: 'COTTON_OFFCUT',
  SILK: 'SILK_OFFCUT',
  SILK_SCRAP: 'SILK_OFFCUT',
  WOOL: 'WOOL_YARN',
  YARN: 'WOOL_YARN',
  WOOD: 'WOOD_SHAVING',
  SAWDUST: 'WOOD_SHAVING',
  CANE: 'BAMBOO',
  TERRACOTTA: 'CLAY',
  METAL: 'METAL_SCRAP',
  BRASS: 'METAL_SCRAP',
};

/** Free text in, a poolable material out. Never throws; unknown pools under OTHER. */
export function normaliseMaterial(raw: string): ScrapMaterial {
  const key = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!key) return 'OTHER';
  if ((SCRAP_MATERIALS as readonly string[]).includes(key)) return key as ScrapMaterial;
  return MATERIAL_SYNONYMS[key] ?? 'OTHER';
}

/** `SILK_OFFCUT` → `scrap_material_silk_offcut`, the i18n key the screens render. */
export function materialLabelKey(material: ScrapMaterial): string {
  return `scrap_material_${material.toLowerCase()}`;
}

/** `OPEN` → `scrap_pool_status_open`. */
export function poolStatusKey(status: ScrapPoolStatus): string {
  return `scrap_pool_status_${status.toLowerCase()}`;
}

export interface Weight {
  /** Grams under a kilo, otherwise kilos to one decimal place. */
  value: number;
  unitKey: 'scrap_unit_g' | 'scrap_unit_kg';
}

/**
 * Grams for a screen.
 *
 * Under a kilo the figure stays in grams, because "0.4 kg" reads as a rounding
 * of something and "400 g" reads as a weight somebody put on a scale. Above it,
 * one decimal — a pool is tens of kilos and the second decimal is noise.
 */
export function formatWeight(grams: number): Weight {
  const safe = Number.isFinite(grams) ? Math.max(0, Math.round(grams)) : 0;
  if (safe < 1000) return { value: safe, unitKey: 'scrap_unit_g' };
  return { value: Math.round(safe / 100) / 10, unitKey: 'scrap_unit_kg' };
}

/** This artisan's share of a pool, as a percentage to one decimal place. */
export function sharePercent(grams: number, totalGrams: number): number {
  if (!Number.isFinite(grams) || !Number.isFinite(totalGrams) || totalGrams <= 0) return 0;
  return Math.round((Math.max(0, grams) / totalGrams) * 1000) / 10;
}

/** Has this pool earned a listing? Arithmetic, not an editorial decision. */
export function meetsThreshold(material: ScrapMaterial, totalGrams: number): boolean {
  return totalGrams >= LOT_THRESHOLD_GRAMS[material];
}

export interface Contribution {
  artisanId: string;
  grams: number;
  at: Date;
}

export interface ProRataShare {
  artisanId: string;
  grams: number;
  amount: number;
}

/**
 * Split a real sale price across contributors by the grams each actually logged.
 *
 * The remainder — the rupees that integer division leaves behind — goes one at
 * a time to the largest contributors, ties broken by whoever logged first and
 * then by id so the order is stable rather than whatever the database returned.
 * A contributor who somehow has zero grams is never in that queue, so they
 * receive exactly nothing and there is no divide-by-zero to reach.
 *
 * **Throws** on a non-positive price, on an empty list, on a pool with no
 * weight in it, and — the one that matters — if the shares it computed do not
 * sum to exactly the price. A caller that has already marked a pool SOLD cannot
 * recover from a bad split, so the split fails before anything is written.
 */
export function splitProRata(price: number, contributions: readonly Contribution[]): ProRataShare[] {
  if (!Number.isInteger(price) || price <= 0) {
    throw new Error(`splitProRata: a sale price must be a whole number of rupees above zero, got ${price}`);
  }
  if (contributions.length === 0) {
    throw new Error('splitProRata: no contributors to split between');
  }

  const rows = contributions.map((row) => ({
    artisanId: row.artisanId,
    grams: Number.isFinite(row.grams) ? Math.max(0, Math.trunc(row.grams)) : 0,
    at: row.at instanceof Date ? row.at.getTime() : new Date(row.at).getTime(),
  }));

  const totalGrams = rows.reduce((sum, row) => sum + row.grams, 0);
  if (totalGrams <= 0) {
    throw new Error('splitProRata: the pool has no weight in it, so there is nothing to split by');
  }

  const shares: ProRataShare[] = rows.map((row) => ({
    artisanId: row.artisanId,
    grams: row.grams,
    // Integer floor of the exact share. Everyone is short by under a rupee.
    amount: Math.floor((price * row.grams) / totalGrams),
  }));

  let remainder = price - shares.reduce((sum, row) => sum + row.amount, 0);

  const queue = rows
    .map((row, index) => ({ index, grams: row.grams, at: row.at, artisanId: row.artisanId }))
    .filter((row) => row.grams > 0)
    .sort((a, b) => b.grams - a.grams || a.at - b.at || a.artisanId.localeCompare(b.artisanId));

  for (const row of queue) {
    if (remainder <= 0) break;
    shares[row.index].amount += 1;
    remainder -= 1;
  }

  const paid = shares.reduce((sum, row) => sum + row.amount, 0);
  if (paid !== price) {
    throw new Error(`splitProRata: shares sum to ${paid}, not ${price} — refusing to distribute`);
  }
  if (shares.some((row) => row.amount < 0)) {
    throw new Error('splitProRata: a negative share was computed — refusing to distribute');
  }

  return shares;
}

/**
 * The states and union territories, so a single-word location can be told apart
 * from a village.
 *
 * A closed, public list of 36 names — not invented data, and the only way this
 * function can answer "is `Odisha` a state or a hamlet?" without guessing.
 */
const STATES_AND_UTS = new Set(
  [
    'andhra pradesh',
    'arunachal pradesh',
    'assam',
    'bihar',
    'chhattisgarh',
    'goa',
    'gujarat',
    'haryana',
    'himachal pradesh',
    'jharkhand',
    'karnataka',
    'kerala',
    'madhya pradesh',
    'maharashtra',
    'manipur',
    'meghalaya',
    'mizoram',
    'nagaland',
    'odisha',
    'punjab',
    'rajasthan',
    'sikkim',
    'tamil nadu',
    'telangana',
    'tripura',
    'uttar pradesh',
    'uttarakhand',
    'west bengal',
    'andaman and nicobar islands',
    'chandigarh',
    'dadra and nagar haveli and daman and diu',
    'delhi',
    'jammu & kashmir',
    'jammu and kashmir',
    'ladakh',
    'lakshadweep',
    'puducherry',
  ].map((name) => name.toLowerCase())
);

/**
 * The coarsest area a public board may name for a cluster.
 *
 * A profile's `location` is free text and this app cannot tell a village from a
 * district, so the rule is conservative rather than clever:
 *
 *   · **Three or more parts** — `Kanihama, Srinagar, Jammu & Kashmir` — the
 *     first is the precise one, so it is dropped and `Srinagar, Jammu &
 *     Kashmir` is published.
 *   · **Two parts** — `Raghurajpur, Odisha` — the first could be a district or
 *     it could be a weaving village of two hundred people, and there is no way
 *     to know, so only `Odisha` is published.
 *   · **One part** — published only when it is a state or union territory.
 *     Otherwise this returns null, the board says the area is not published,
 *     and the enquiry still reaches the cluster through the platform.
 *
 * Publishing a precise location for a group of low-income people, next to a
 * public note about how much saleable material they have on hand, is a real
 * risk to them and is not worth a slightly more convenient recycler.
 */
export function publicAreaLabel(location: string | null | undefined): string | null {
  const parts = String(location ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;
  if (parts.length === 1) {
    return STATES_AND_UTS.has(parts[0].toLowerCase()) ? titleCase(parts[0]) : null;
  }
  if (parts.length === 2) return titleCase(parts[1]);
  return parts.slice(1).map(titleCase).join(', ');
}

function titleCase(value: string): string {
  return value
    .split(/(\s|&)/)
    .map((part) => (/^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part))
    .join('');
}

// ------------------------------------------------------------- public shapes

/**
 * Exactly what the public scrap board may show a visitor with no session.
 *
 * Built field by field from an allow-list, never by deleting from a row: there
 * is no artisan id, no artisan name, no contact and no cluster key in here
 * because none was ever put in. `area` is what `publicAreaLabel` allowed, and
 * `priceRupees` is absent entirely — a listed pool has no price until somebody
 * sells it, and this project has no feed to estimate one from.
 */
export interface PublicScrapPool {
  id: string;
  material: ScrapMaterial;
  totalGrams: number;
  contributorCount: number;
  /** District-and-state at the most precise, or null when even that is a guess. */
  area: string | null;
  listedAt: string;
}

export function toPublicPool(row: {
  id: string;
  material: string;
  totalGrams: number;
  contributorCount: number;
  area: string | null;
  listedAt: Date | string | null;
}): PublicScrapPool {
  const listed = row.listedAt ? new Date(row.listedAt) : new Date();
  return {
    id: row.id,
    material: normaliseMaterial(row.material),
    totalGrams: Math.max(0, Math.round(row.totalGrams)),
    contributorCount: Math.max(0, Math.round(row.contributorCount)),
    area: row.area,
    listedAt: listed.toISOString(),
  };
}
