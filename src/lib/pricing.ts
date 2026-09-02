/**
 * Anti-exploitation pricing rule (new_admin.md, Tier 1.1).
 *
 * The AI Pricing Assistant computes a `fairWageFloor` from labour days plus raw
 * material cost, and a market band around it. A price that lands far outside
 * that estimate is a signal in BOTH directions:
 *
 *  - far **below** the floor → a middleman is very likely squeezing the artisan;
 *  - far **above** the market band → the buyer is being gouged, and the listing
 *    will either not sell or will sell once and burn the channel. Either way a
 *    facilitator should phone the artisan before it goes live.
 *
 * This is the single source of truth for the rule. `simulate-sale` persists the
 * verdict onto the row; the facilitator queue also recomputes it on the fly so
 * legacy rows written before `pricingFlag` existed still surface.
 */

/** An accepted price below this fraction of the fair wage floor is exploitative. */
export const FAIR_WAGE_TOLERANCE = 0.7;

/** Percentage drop that trips the flag, for display in the UI. */
export const FAIR_WAGE_DROP_THRESHOLD_PCT = Math.round((1 - FAIR_WAGE_TOLERANCE) * 100);

/**
 * An accepted price above this multiple of the market reference is over-priced.
 *
 * Deliberately looser than the floor tolerance. Underpricing is a wage the
 * artisan will never get back, so 30% is already too much; a high price is a
 * judgement call that a rare piece may well justify, so it takes 60% over the
 * top of the estimated band before the queue asks a human about it.
 */
export const FAIR_PRICE_CEILING_TOLERANCE = 1.6;

/** Percentage overshoot that trips the flag, for display in the UI. */
export const FAIR_PRICE_RISE_THRESHOLD_PCT = Math.round((FAIR_PRICE_CEILING_TOLERANCE - 1) * 100);

export interface PricingDiscrepancyInput {
  fairWageFloor?: number | null;
  salePrice?: number | null;
  /** The artisan's own listing price, used before a sale has happened. */
  askingPrice?: number | null;
  /** Top of the AI market band — the reference the ceiling is measured against. */
  marketPriceMax?: number | null;
  /** Mid-point of the AI market band; the ceiling's second choice of reference. */
  standardMarketPrice?: number | null;
  pricingFlag?: boolean | null;
  flagReason?: string | null;
}

/** Which side of the estimate the price fell on. `null` when it is inside the band. */
export type PricingDirection = 'below' | 'above';

export interface PricingDiscrepancy {
  /** True when the accepted price sits far outside the estimate, either way. */
  flagged: boolean;
  /** Which side tripped the flag, or null when nothing did. */
  direction: PricingDirection | null;
  /** How far below the floor the accepted price sits, in whole percent. 0 when not below. */
  pctBelow: number;
  /** How far above the market reference it sits, in whole percent. 0 when not above. */
  pctAbove: number;
  /** Human-readable explanation, or null when there is nothing to explain. */
  reason: string | null;
  /** AI-suggested fair price (the floor), or null when the AI never produced one. */
  fairPrice: number | null;
  /** Top of the market band the ceiling was tested against, or null. */
  marketReference: number | null;
  /** The price actually accepted, or null when the item has not sold yet. */
  acceptedPrice: number | null;
  /** Rupees the artisan lost against the fair floor. 0 when not below. */
  shortfall: number;
  /** Rupees the price sits above the market reference. 0 when not above. */
  overshoot: number;
}

/** The zeroed result, so every early return agrees on the shape. */
function emptyDiscrepancy(item: PricingDiscrepancyInput): PricingDiscrepancy {
  return {
    flagged: Boolean(item.pricingFlag),
    direction: null,
    pctBelow: 0,
    pctAbove: 0,
    reason: item.flagReason ?? null,
    fairPrice: numberOrNull(item.fairWageFloor),
    marketReference: null,
    acceptedPrice: numberOrNull(item.salePrice) ?? numberOrNull(item.askingPrice),
    shortfall: 0,
    overshoot: 0,
  };
}

/**
 * Compare an item's accepted price against its AI estimate, in both directions.
 *
 * Safe on partial rows: missing prices yield an unflagged, zeroed result rather
 * than NaN, so a legacy item never breaks the queue, and a row that carries a
 * stored `pricingFlag`/`flagReason` but no numbers still surfaces with its
 * persisted verdict intact.
 */
export function getPricingDiscrepancy(item: PricingDiscrepancyInput): PricingDiscrepancy {
  const fairPrice = numberOrNull(item.fairWageFloor);
  // Before a sale, the artisan's own asking price is the price being tested:
  // an underpriced listing is exactly the squeeze this rule exists to catch.
  const sold = numberOrNull(item.salePrice);
  const acceptedPrice = sold ?? numberOrNull(item.askingPrice);

  // The ceiling is measured against the top of the market band where the AI
  // produced one, because the band is what a buyer would actually pay. Falling
  // back to the floor would flag every healthy margin as gouging.
  const marketReference =
    positiveOrNull(item.marketPriceMax) ??
    positiveOrNull(item.standardMarketPrice) ??
    (fairPrice !== null && fairPrice > 0 ? fairPrice * FAIR_PRICE_CEILING_TOLERANCE : null);

  if (acceptedPrice === null) return emptyDiscrepancy(item);

  const hasFloor = fairPrice !== null && fairPrice > 0;
  const hasCeiling = marketReference !== null && marketReference > 0;
  if (!hasFloor && !hasCeiling) return emptyDiscrepancy(item);

  const shortfall = hasFloor ? Math.max(0, fairPrice! - acceptedPrice) : 0;
  const pctBelow = hasFloor ? Math.round((shortfall / fairPrice!) * 100) : 0;

  const overshoot = hasCeiling ? Math.max(0, acceptedPrice - marketReference!) : 0;
  const pctAbove = hasCeiling ? Math.round((overshoot / marketReference!) * 100) : 0;

  const underpriced = hasFloor && acceptedPrice < fairPrice! * FAIR_WAGE_TOLERANCE;
  // Never both: a price cannot be under the floor and over the band at once,
  // and underpricing is checked first because it is the graver of the two.
  const overpriced =
    !underpriced && hasCeiling && acceptedPrice > marketReference! * FAIR_PRICE_CEILING_TOLERANCE;

  const setBy = sold === null ? 'Artisan set price' : 'Accepted price';
  const direction: PricingDirection | null = underpriced
    ? 'below'
    : overpriced
      ? 'above'
      : null;

  const reason = underpriced
    ? `${setBy} ${pctBelow}% below AI fair wage floor`
    : overpriced
      ? `${setBy} ${pctAbove}% above fair market range — possible over-pricing / buyer-gouging risk`
      : item.flagReason ?? null;

  return {
    flagged: underpriced || overpriced || Boolean(item.pricingFlag),
    direction,
    pctBelow,
    pctAbove,
    reason,
    fairPrice,
    marketReference,
    acceptedPrice,
    shortfall,
    overshoot,
  };
}

function positiveOrNull(value: number | null | undefined): number | null {
  const n = numberOrNull(value);
  return n !== null && n > 0 ? n : null;
}

function numberOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Format rupees for display without ever rendering NaN. */
export function formatRupees(value: number | null | undefined): string {
  const n = numberOrNull(value ?? null);
  if (n === null) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export interface ListingPriceInput {
  askingPrice?: number | null;
  standardMarketPrice?: number | null;
  fairWageFloor?: number | null;
}

/**
 * The price an item is actually listed at.
 *
 * The artisan's own `askingPrice` always wins — they choose what to sell for.
 * Rows captured before price-setting existed fall back to the AI market price,
 * then to the fair wage floor. Null when the row carries no price at all, so a
 * caller can render "—" instead of inventing a number.
 */
export function getListingPrice(item: ListingPriceInput): number | null {
  return (
    numberOrNull(item.askingPrice) ??
    numberOrNull(item.standardMarketPrice) ??
    numberOrNull(item.fairWageFloor)
  );
}

export interface CraftValuation {
  /** Per-day wage the floor was built from, so the UI can explain the number. */
  baseWage: number;
  fairWageFloor: number;
  standardMarketPrice: number;
  marketPriceMin: number;
  marketPriceMax: number;
  seasonalBump: number;
  /** Multiplier applied to the market band from the stated technique. 1 = none. */
  techniqueFactor: number;
}

/**
 * How the stated technique moves the MARKET BAND — never the fair wage floor.
 *
 * The floor is labour + material + overhead: it is what the artisan must be
 * paid for the hours they worked, and no production method reduces that. What
 * technique legitimately changes is what a buyer will pay above it. Hand
 * processes carry a premium; machine work does not, so its band sits closer to
 * the floor rather than the floor being cut.
 */
function techniqueFactorFor(technique?: string | null): number {
  const text = (technique || '').toLowerCase();
  if (!text) return 1;

  // Checked first: "machine-made on a handloom" is not a thing, but
  // "not machine made" is — so an explicit hand signal wins.
  if (/hand[- ]?loom|handmade|hand[- ]?made|hand[- ]?woven|hand[- ]?painted|hand[- ]?spun|natural dye|vegetable dye|organic/.test(text)) {
    return 1.08;
  }
  if (/machine|power[- ]?loom|powerloom|mill[- ]?made|synthetic|chemical dye/.test(text)) {
    return 0.9;
  }
  return 1;
}

/** Per-day wage by fibre. Silk is the most skilled, cotton the least. */
function baseWageFor(craftType: string): number {
  const craft = craftType.toLowerCase();
  if (craft.includes('silk')) return 650;
  if (craft.includes('cotton')) return 450;
  if (craft.includes('wool')) return 550;
  return 500;
}

/**
 * The AI valuation engine, shared by the capture API and the artisan's
 * price-setting UI so the artisan is quoted exactly the numbers that get
 * persisted. Labour + material + 10% overhead is the fair wage floor; the
 * market band is 1.2x-1.6x that floor, with a festival-season bump on silk.
 */
export function estimateCraftValuation(
  craftType: string,
  laborDays: number,
  rawMaterialCost: number,
  /**
   * Free-text technique the artisan volunteered ("handloom, pure silk thread").
   * Optional and additive: no existing caller passes it, and omitting it
   * reproduces the previous numbers exactly.
   */
  technique?: string | null,
  now: Date = new Date()
): CraftValuation {
  const days = Math.max(0, Number(laborDays) || 0);
  const material = Math.max(0, Number(rawMaterialCost) || 0);
  const baseWage = baseWageFor(craftType || '');

  const laborCost = days * baseWage;
  const overhead = (laborCost + material) * 0.1;
  const fairWageFloor = laborCost + material + overhead;

  // October/November is Diwali: silk demand spikes.
  const month = now.getMonth();
  const seasonalBump =
    (month === 9 || month === 10) && (craftType || '').toLowerCase().includes('silk') ? 1.15 : 1.0;

  // Technique moves the band, not the floor — and the band is clamped so it can
  // never dip beneath the floor, whatever the technique says.
  const techniqueFactor = techniqueFactorFor(technique);
  const band = (multiplier: number) =>
    Math.max(fairWageFloor, fairWageFloor * multiplier * seasonalBump * techniqueFactor);

  return {
    baseWage,
    fairWageFloor,
    standardMarketPrice: band(1.4),
    marketPriceMin: band(1.2),
    marketPriceMax: band(1.6),
    seasonalBump,
    techniqueFactor,
  };
}
