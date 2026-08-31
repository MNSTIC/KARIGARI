import { NextResponse } from 'next/server';
import { GroqError, firstArray, groqChatJSON, languageInstruction } from '@/lib/groq';
import { estimateCraftValuation } from '@/lib/pricing';

/**
 * Dynamic Pricing Assistant.
 *
 * Answers "what do comparable pieces sell for, and what should I ask?".
 *
 * HONESTY — read before changing this. These are **estimated market
 * comparables**, not live listings. Scraping Amazon/Flipkart/Myntra from a
 * server is unreliable (bot walls, layout churn) and presenting a fabricated
 * product row as a real scraped listing would be worse than useless to an
 * artisan pricing their work. So the model is asked for typical price *bands*
 * per platform for this craft category, and the UI labels them as estimates.
 * No product titles are presented as real listings you can click through to.
 *
 * The recommendation is reconciled against `estimateCraftValuation` — the same
 * function the capture API persists from — and is never allowed below the fair
 * wage floor, whatever the model says.
 */
export const dynamic = 'force-dynamic';

interface Comparable {
  platform: string;
  title: string;
  priceMin: number;
  priceMax: number;
  note: string;
}

const PLATFORMS = ['Amazon Karigar', 'Flipkart Samarth', 'Myntra', 'Local retail / exhibition'];

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const craftType = typeof body?.craftType === 'string' ? body.craftType.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const language = typeof body?.language === 'string' ? body.language : 'en';
  const laborDays = Number(body?.laborDays) || 0;
  const rawMaterialCost = Number(body?.rawMaterialCost) || 0;

  if (!craftType) {
    return NextResponse.json({ success: false, error: 'craftType is required' }, { status: 400 });
  }

  // The artisan's own valuation is the anchor, not the model's imagination.
  const valuation = estimateCraftValuation(craftType, laborDays, rawMaterialCost);
  const floor = Math.round(valuation.fairWageFloor);
  const bandMin = Math.round(valuation.marketPriceMin);
  const bandMax = Math.round(valuation.marketPriceMax);

  const prompt = `You are a pricing analyst for Indian handicrafts.

CRAFT: "${craftType}"
ARTISAN'S DESCRIPTION: "${description || 'not provided'}"
COMPUTED FAIR-WAGE FLOOR: ₹${floor}
COMPUTED MARKET BAND: ₹${bandMin} – ₹${bandMax}

For each of these platforms — ${PLATFORMS.join(', ')} — estimate the typical selling price RANGE in INR that comparable "${craftType}" pieces of this quality fetch. Use your general knowledge of Indian handicraft retail pricing. Do NOT invent specific product listings, URLs, seller names or review counts; describe the typical comparable item in a few words instead.

Then recommend ONE asking price for this artisan, inside or near the computed market band, and never below ₹${floor}.

${languageInstruction(language)}
Keep the "platform" values exactly as given in English.

Return strict JSON:
{
  "recommendedPrice": 0,
  "rationale": "one short sentence",
  "comparables": [
    { "platform": "Amazon Karigar", "title": "typical comparable item, a few words", "priceMin": 0, "priceMax": 0, "note": "why it differs from the artisan's piece" }
  ]
}`;

  try {
    const parsed = await groqChatJSON<Record<string, unknown>>(prompt, {
      system: 'You are a JSON-only API. You output raw, valid JSON with no markdown formatting.',
      temperature: 0.3,
    });

    const rows = firstArray(parsed.comparables ?? parsed) as Record<string, unknown>[];
    const comparables: Comparable[] = rows
      .map((row) => {
        const priceMin = toNumber(row.priceMin);
        const priceMax = toNumber(row.priceMax);
        if (priceMin === null || priceMax === null) return null;
        return {
          platform: String(row.platform || 'Marketplace'),
          title: String(row.title || craftType),
          priceMin: Math.min(priceMin, priceMax),
          priceMax: Math.max(priceMin, priceMax),
          note: String(row.note || ''),
        };
      })
      .filter((row): row is Comparable => row !== null);

    if (comparables.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No comparable prices could be estimated. Please retry.' },
        { status: 502 }
      );
    }

    // Reconcile: the model's figure is a suggestion, the floor is a rule.
    const suggested = toNumber(parsed.recommendedPrice) ?? Math.round(valuation.standardMarketPrice);
    const recommendedPrice = Math.max(floor, suggested);

    return NextResponse.json({
      success: true,
      recommendedPrice,
      floor,
      band: { min: bandMin, max: bandMax },
      clampedToFloor: recommendedPrice !== suggested,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : null,
      comparables,
    });
  } catch (error) {
    const err = error as GroqError;
    console.error('Price research error:', err?.message);
    return NextResponse.json(
      {
        success: false,
        error:
          err?.name === 'GroqError' && err.status === 503
            ? 'AI service not configured.'
            : 'Could not estimate comparable prices right now.',
        // The deterministic valuation still works without the model, so hand it
        // back — the artisan is not left with nothing.
        recommendedPrice: Math.round(valuation.standardMarketPrice),
        floor,
        band: { min: bandMin, max: bandMax },
      },
      { status: err?.status ?? 502 }
    );
  }
}
