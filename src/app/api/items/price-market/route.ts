import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { GROQ_CHAT_MODELS, groqChatJSON, isGroqConfigured } from '@/lib/groq';
import { estimateCraftValuation } from '@/lib/pricing';

/**
 * Step 5 — cross-validation lookup against typical Indian marketplaces.
 *
 * Uses the SMALLEST Groq chat model available on this account (see
 * GROQ_CHAT_MODELS). Deliberately a cheap call: this step exists to give
 * Step 4's price band a sanity check, not to invent new numbers.
 *
 * Never returns absolute figures without confidence: the client should treat
 * "low" as a hint, not a fact, and the tier logic downstream uses the
 * combined ceiling of Step 4 + Step 5 to protect the artisan from an
 * over-priced listing sinking under-verified into Tier B.
 */
export const dynamic = 'force-dynamic';

interface MarketResult {
  market_low: number;
  market_avg: number;
  market_high: number;
  confidence: 'high' | 'medium' | 'low';
}

/** The last name in GROQ_CHAT_MODELS is smallest on this account. */
const FAST_MODEL = GROQ_CHAT_MODELS[GROQ_CHAT_MODELS.length - 1];

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function coerceConfidence(value: unknown): MarketResult['confidence'] {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return 'low';
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : '';
  const craftType =
    typeof body?.craftType === 'string' ? body.craftType.trim().slice(0, 120) : '';
  const laborDays = Number(body?.laborDays) || 0;
  const rawMaterialCost = Number(body?.rawMaterialCost) || 0;

  if (!title && !craftType) {
    return NextResponse.json(
      { success: false, error: 'title or craftType is required.' },
      { status: 400 }
    );
  }

  const anchor = estimateCraftValuation(craftType || title, laborDays, rawMaterialCost);
  const anchorLow = Math.round(anchor.marketPriceMin);
  const anchorAvg = Math.round(anchor.standardMarketPrice);
  const anchorHigh = Math.round(anchor.marketPriceMax);

  if (!isGroqConfigured()) {
    return NextResponse.json({
      success: true,
      degraded: true,
      market: {
        market_low: anchorLow,
        market_avg: anchorAvg,
        market_high: anchorHigh,
        confidence: 'low',
      } satisfies MarketResult,
    });
  }

  const prompt = `Estimate the typical Indian retail price band for "${title || craftType}"
across Amazon India, Flipkart, GoCoop, and state handloom emporiums.

Return three whole-rupee integers (low, average, high) plus a confidence
level (high | medium | low). Use general knowledge — never invent specific
seller names or SKUs.

Anchor (do not return values below this band's low):
  low = ₹${anchorLow}, avg = ₹${anchorAvg}, high = ₹${anchorHigh}

Return strict JSON:
{ "market_low": 0, "market_avg": 0, "market_high": 0, "confidence": "medium" }`;

  try {
    const parsed = await groqChatJSON<Partial<MarketResult>>(prompt, {
      temperature: 0.15,
      model: FAST_MODEL,
    });

    const low = toNumber(parsed.market_low) ?? anchorLow;
    let avg = toNumber(parsed.market_avg) ?? anchorAvg;
    let high = toNumber(parsed.market_high) ?? anchorHigh;

    const safeLow = Math.max(low, Math.round(anchor.fairWageFloor));
    avg = Math.max(avg, safeLow);
    high = Math.max(high, avg);

    return NextResponse.json({
      success: true,
      market: {
        market_low: safeLow,
        market_avg: avg,
        market_high: high,
        confidence: coerceConfidence(parsed.confidence),
      } satisfies MarketResult,
    });
  } catch (error) {
    console.warn('[price-market] Groq failed:', (error as Error)?.message);
    return NextResponse.json({
      success: true,
      degraded: true,
      market: {
        market_low: anchorLow,
        market_avg: anchorAvg,
        market_high: anchorHigh,
        confidence: 'low',
      } satisfies MarketResult,
    });
  }
}
