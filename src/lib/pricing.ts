/**
 * Anti-exploitation pricing rule (new_admin.md, Tier 1.1).
 *
 * The AI Pricing Assistant computes a `fairWageFloor` from labour days plus raw
 * material cost. If the price the artisan actually accepts falls more than 30%
 * below that floor, a middleman is very likely squeezing them, so the listing is
 * flagged for a facilitator to phone the artisan before it goes live.
 *
 * This is the single source of truth for the rule. `simulate-sale` persists the
 * verdict onto the row; the facilitator queue also recomputes it on the fly so
 * legacy rows written before `pricingFlag` existed still surface.
 */

/** An accepted price below this fraction of the fair wage floor is exploitative. */
export const FAIR_WAGE_TOLERANCE = 0.7;

/** Percentage drop that trips the flag, for display in the UI. */
export const FAIR_WAGE_DROP_THRESHOLD_PCT = Math.round((1 - FAIR_WAGE_TOLERANCE) * 100);

export interface PricingDiscrepancyInput {
  fairWageFloor?: number | null;
  salePrice?: number | null;
  /** The artisan's own listing price, used before a sale has happened. */
  askingPrice?: number | null;
  pricingFlag?: boolean | null;
  flagReason?: string | null;
}

export interface PricingDiscrepancy {
  /** True when the accepted price is more than 30% below the AI fair wage floor. */
  flagged: boolean;
  /** How far below the floor the accepted price sits, in whole percent. 0 when not below. */
  pctBelow: number;
  /** Human-readable explanation, or null when there is nothing to explain. */
  reason: string | null;
  /** AI-suggested fair price, or null when the AI never produced one. */
  fairPrice: number | null;
  /** The price actually accepted, or null when the item has not sold yet. */
  acceptedPrice: number | null;
  /** Rupees the artisan lost against the fair floor. 0 when not below. */
  shortfall: number;
}

/**
 * Compare an item's accepted price against its AI fair wage floor.
 * Safe on partial rows: missing prices yield an unflagged, zeroed result rather
 * than NaN, so a legacy item never breaks the queue.
 */
export function getPricingDiscrepancy(item: PricingDiscrepancyInput): PricingDiscrepancy {
  const fairPrice = numberOrNull(item.fairWageFloor);
  // Before a sale, the artisan's own asking price is the price being tested:
  // an underpriced listing is exactly the squeeze this rule exists to catch.
  const sold = numberOrNull(item.salePrice);
  const acceptedPrice = sold ?? numberOrNull(item.askingPrice);

  // Nothing to compare against — fall back to whatever was persisted on the row.
  if (fairPrice === null || fairPrice <= 0 || acceptedPrice === null) {
    return {
      flagged: Boolean(item.pricingFlag),
      pctBelow: 0,
      reason: item.flagReason ?? null,
      fairPrice,
      acceptedPrice,
      shortfall: 0,
    };
  }

  const shortfall = Math.max(0, fairPrice - acceptedPrice);
  const pctBelow = Math.round((shortfall / fairPrice) * 100);
  const flagged = acceptedPrice < fairPrice * FAIR_WAGE_TOLERANCE;

  return {
    flagged: flagged || Boolean(item.pricingFlag),
    pctBelow,
    reason: flagged
      ? `${sold === null ? 'Artisan set price' : 'Accepted price'} ${pctBelow}% below AI fair wage floor`
      : item.flagReason ?? null,
    fairPrice,
    acceptedPrice,
    shortfall,
  };
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
