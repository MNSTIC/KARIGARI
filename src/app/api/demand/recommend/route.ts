import { NextResponse } from 'next/server';
import { estimateCraftValuation } from '@/lib/pricing';
import { GEMINI_CONFIGURED, generateContentWithFallback } from '@/lib/gemini';

/**
 * Real-time recommendation for the buyer's demand form.
 *
 * Public by design — buyers have no accounts on this app. The router runs the
 * same fair-wage estimator the artisan capture flow uses, so the answer a
 * buyer sees before posting is the answer the AI would have quoted the artisan
 * afterwards. Gemini, when reachable, only adds a couple of sentences of
 * material-specific colour on top of that rule-based verdict — it never gets
 * to overrule the arithmetic.
 *
 * Never errors. A missing key, a Gemini timeout or a bad response all fall
 * through to the same rule-based reply, because the form does not exist to
 * teach buyers about AI reliability.
 */
export const dynamic = 'force-dynamic';

/** How labour-intensive one piece of this craft looks. Days, honest guess. */
function estimatedLaborDaysFor(craftType: string, material?: string): number {
  const text = `${craftType} ${material ?? ''}`.toLowerCase();
  if (/silk|muga|tussar|mulberry|paithani|kanjivaram|sambalpuri/.test(text)) return 12;
  if (/wool|pashmina|shawl/.test(text)) return 8;
  if (/cotton|khadi|kalamkari/.test(text)) return 5;
  if (/pottery|clay|terracotta|ceramic/.test(text)) return 4;
  if (/metal|dhokra|bidri|bell metal|brass|silver filigree/.test(text)) return 10;
  if (/painting|pattachitra|madhubani|warli|cheriyal/.test(text)) return 7;
  if (/wood|carv|bamboo|cane/.test(text)) return 6;
  if (/leather|jutti|mojari/.test(text)) return 3;
  if (/jewel|jewell|filigree/.test(text)) return 5;
  return 5;
}

/** Rupees of raw material a single piece would consume, per fibre/material. */
function estimatedRawCostFor(craftType: string, material?: string): number {
  const text = `${craftType} ${material ?? ''}`.toLowerCase();
  if (/muga|tussar|mulberry|silk/.test(text)) return 1400;
  if (/pashmina/.test(text)) return 2000;
  if (/wool/.test(text)) return 600;
  if (/cotton|khadi/.test(text)) return 350;
  if (/silver/.test(text)) return 1800;
  if (/brass|bidri|bell metal|dhokra/.test(text)) return 900;
  if (/leather/.test(text)) return 500;
  if (/wood|bamboo/.test(text)) return 400;
  if (/clay|pottery|terracotta/.test(text)) return 250;
  return 300;
}

/** A couple of cheaper materials that could bring an under-priced ask into range. */
function suggestCheaperMaterials(craftType: string): string[] {
  const text = craftType.toLowerCase();
  if (/silk|saree/.test(text)) return ['Tussar silk', 'Cotton silk', 'Handloom cotton'];
  if (/wool|shawl/.test(text)) return ['Sheep wool', 'Blended wool', 'Acrylic-wool mix'];
  if (/metal|brass|bidri|dhokra/.test(text)) return ['Brass', 'Bell metal', 'Aluminium alloy'];
  if (/pottery|clay/.test(text)) return ['Red terracotta', 'Local clay', 'Stoneware'];
  return [];
}

interface RecommendRequest {
  craftType?: unknown;
  quantity?: unknown;
  targetPriceMin?: unknown;
  targetPriceMax?: unknown;
  material?: unknown;
  color?: unknown;
  description?: unknown;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrEmpty(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as RecommendRequest;

    const craftType = stringOrEmpty(body.craftType, 120);
    const quantity = numberOrNull(body.quantity) ?? 0;
    const targetPriceMin = numberOrNull(body.targetPriceMin);
    const targetPriceMax = numberOrNull(body.targetPriceMax);
    const material = stringOrEmpty(body.material, 60);
    const color = stringOrEmpty(body.color, 60);
    const description = stringOrEmpty(body.description, 400);

    // The client only fires when these are filled, but validate anyway so a
    // curious caller cannot crash the route.
    if (!craftType || quantity <= 0 || (targetPriceMin === null && targetPriceMax === null)) {
      return NextResponse.json(
        {
          success: false,
          error: 'craftType, quantity and at least one target price are required.',
        },
        { status: 400 }
      );
    }

    const laborDays = estimatedLaborDaysFor(craftType, material);
    const rawCost = estimatedRawCostFor(craftType, material);
    const valuation = estimateCraftValuation(craftType, laborDays, rawCost, material || null);
    const fairFloor = Math.round(valuation.fairWageFloor);

    // Test against the ceiling of the buyer's range: it is what the artisan
    // would take home if they accepted. Falling back to the floor keeps the
    // logic sane on a single-value target.
    const testPrice = targetPriceMax ?? targetPriceMin ?? 0;
    const underPriced = testPrice < fairFloor * 0.8;

    // Two-line rule-based verdict, ready even if Gemini never runs.
    const suggested = underPriced ? suggestCheaperMaterials(craftType) : [];
    const status: 'good' | 'low_price' | 'suggestion' = underPriced
      ? suggested.length
        ? 'suggestion'
        : 'low_price'
      : 'good';

    let message = underPriced
      ? `Your ceiling (₹${Math.round(testPrice)}) is below the fair-wage floor for ${craftType} in ${material || 'the material you chose'} (~₹${fairFloor}). Raising it — or switching to a lighter material — makes fulfilment much more likely.`
      : `The price looks realistic for ${craftType}${material ? ` in ${material}` : ''}. Artisans should be able to take this on at a fair wage.`;

    // Gemini adds one specific sentence when it is reachable. It never overrides
    // the numeric verdict — a broken model must not turn a bad price good.
    if (GEMINI_CONFIGURED) {
      try {
        const prompt = [
          'You are advising a bulk buyer of Indian handicrafts.',
          `Craft: ${craftType}. Quantity: ${quantity}. Material: ${material || 'unspecified'}. Colour: ${color || 'unspecified'}.`,
          description ? `Buyer note: ${description}` : '',
          `Buyer's price ceiling: ₹${Math.round(testPrice)} per piece.`,
          `AI fair-wage floor for this piece: ₹${fairFloor}.`,
          `Verdict already decided: ${status === 'good' ? 'realistic' : 'below fair wage'}.`,
          'Reply with ONE plain-English sentence (max 30 words) either confirming the demand looks fulfilable, or naming the single most useful lever the buyer could pull. No markdown, no preamble.',
        ]
          .filter(Boolean)
          .join('\n');

        const res = await generateContentWithFallback(prompt);
        const text = (res.text ?? '').trim().replace(/^["“]+|["”]+$/g, '');
        // Only accept a plain, short reply. A verbose one is a signal Gemini
        // wandered off-script — safer to keep the rule-based line.
        if (text && text.length <= 260 && !text.includes('\n')) message = text;
      } catch (error) {
        console.warn('[demand/recommend] Gemini enhancement failed:', error);
      }
    }

    return NextResponse.json({
      success: true,
      status,
      message,
      estimatedFairPrice: fairFloor,
      ...(suggested.length ? { suggestedMaterials: suggested } : {}),
    });
  } catch (error) {
    console.error('Demand recommend error:', error);
    return NextResponse.json(
      { success: false, error: 'Recommendation service is unavailable.' },
      { status: 500 }
    );
  }
}
