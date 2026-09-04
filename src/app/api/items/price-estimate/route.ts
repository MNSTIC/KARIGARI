import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { GROQ_CHAT_MODEL, groqChatJSON, isGroqConfigured } from '@/lib/groq';
import { estimateCraftValuation } from '@/lib/pricing';

/**
 * Step 4 — retail price band via Groq (large chat model).
 *
 * Answers "floor, optimal, ceiling" for the piece. Reconciled against the
 * deterministic `estimateCraftValuation` so a model that hallucinates a
 * ceiling below the fair-wage floor can never send that number back to the
 * artisan; every returned value is >= floor and monotonically ordered.
 */
export const dynamic = 'force-dynamic';

interface EstimateResult {
  floor: number;
  optimal: number;
  ceiling: number;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : '';
  const material = typeof body?.material === 'string' ? body.material.trim().slice(0, 200) : '';
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
  const anchorFloor = Math.round(anchor.fairWageFloor);
  const anchorMid = Math.round(anchor.standardMarketPrice);
  const anchorMax = Math.round(anchor.marketPriceMax);

  // Groq outage → deterministic fallback.
  if (!isGroqConfigured()) {
    return NextResponse.json({
      success: true,
      degraded: true,
      estimate: {
        floor: anchorFloor,
        optimal: anchorMid,
        ceiling: anchorMax,
      } satisfies EstimateResult,
    });
  }

  const prompt = `Estimate the Indian retail price range for this handicraft.

Product: "${title || craftType}"
Material: "${material || 'not specified'}"
Craft type: "${craftType || title}"
Artisan claims: ${laborDays} days of labour, ₹${rawMaterialCost} raw material cost.

Anchor from the deterministic valuation engine (never return below floor):
  floor  = ₹${anchorFloor}
  mid    = ₹${anchorMid}
  max    = ₹${anchorMax}

Return strict JSON with three whole-rupee integers:
{ "floor": 0, "optimal": 0, "ceiling": 0 }
Where floor <= optimal <= ceiling, and floor >= ${anchorFloor}.`;

  try {
    const parsed = await groqChatJSON<Partial<EstimateResult>>(prompt, {
      temperature: 0.15,
      model: GROQ_CHAT_MODEL,
    });

    const floor = toNumber(parsed.floor) ?? anchorFloor;
    let optimal = toNumber(parsed.optimal) ?? anchorMid;
    let ceiling = toNumber(parsed.ceiling) ?? anchorMax;

    // Clamp so nothing below the anchor floor is ever returned, and the trio
    // stays monotonically ordered even if the model returned garbage.
    const safeFloor = Math.max(floor, anchorFloor);
    optimal = Math.max(optimal, safeFloor);
    ceiling = Math.max(ceiling, optimal);

    return NextResponse.json({
      success: true,
      estimate: { floor: safeFloor, optimal, ceiling } satisfies EstimateResult,
    });
  } catch (error) {
    console.warn('[price-estimate] Groq failed:', (error as Error)?.message);
    return NextResponse.json({
      success: true,
      degraded: true,
      estimate: {
        floor: anchorFloor,
        optimal: anchorMid,
        ceiling: anchorMax,
      } satisfies EstimateResult,
    });
  }
}
