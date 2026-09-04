import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { GROQ_CHAT_MODELS, groqChatJSON, isGroqConfigured } from '@/lib/groq';
import { validateArtisanClaim } from '@/lib/benchmarkData';

/**
 * Step 6 — validate the artisan's labour + raw-material claims against
 * craft-type benchmarks.
 *
 * Uses the smallest Groq model — this is a simple lookup, not a reasoning
 * task. Deterministic `validateArtisanClaim` from src/lib/benchmarkData is
 * the ground truth: the Groq answer only fills in a `flag` refinement when
 * the deterministic check passes but the LLM still spots an unusual claim.
 * A hard reject from the deterministic layer wins; Groq cannot overrule it.
 */
export const dynamic = 'force-dynamic';

type ClaimsFlag = 'none' | 'exorbitant_labor' | 'exorbitant_material' | 'both';

interface ClaimsResult {
  labor_reasonable: boolean;
  material_reasonable: boolean;
  flag: ClaimsFlag;
  reasoning?: string;
}

const FAST_MODEL = GROQ_CHAT_MODELS[GROQ_CHAT_MODELS.length - 1];

function coerceFlag(value: unknown): ClaimsFlag {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'exorbitant_labor' || v === 'exorbitant_material' || v === 'both') return v;
  return 'none';
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const craftType =
    typeof body?.craftType === 'string' ? body.craftType.trim().slice(0, 120) : '';
  const laborDays = Number(body?.laborDays);
  const materialCost = Number(body?.materialCost ?? body?.rawMaterialCost);

  if (!craftType || !Number.isFinite(laborDays) || !Number.isFinite(materialCost)) {
    return NextResponse.json(
      { success: false, error: 'craftType, laborDays and materialCost are required.' },
      { status: 400 }
    );
  }

  // Deterministic gate first — this is what /api/items/capture also runs, so
  // the two agree on hard rejections. Any AI answer only supplements it.
  const hard = validateArtisanClaim(craftType, laborDays, materialCost);
  if (!hard.isValid) {
    return NextResponse.json({
      success: true,
      hardRejected: true,
      reason: hard.reason,
      claims: {
        labor_reasonable: false,
        material_reasonable: false,
        flag: 'both',
        reasoning: hard.reason,
      } satisfies ClaimsResult,
    });
  }

  if (!isGroqConfigured()) {
    return NextResponse.json({
      success: true,
      degraded: true,
      claims: {
        labor_reasonable: true,
        material_reasonable: true,
        flag: 'none',
      } satisfies ClaimsResult,
    });
  }

  const prompt = `Validate the artisan's claims for a "${craftType}".
Claimed labour: ${laborDays} days.
Claimed raw material cost: ₹${materialCost}.

Standard Indian handicraft benchmarks:
- Cotton saree: 3-7 days, ₹500-2000 material
- Silk saree: 15-30 days, ₹2000-8000 material
- Pottery / terracotta: 1-3 days, ₹100-500 material
- Pattachitra painting: 7-20 days, ₹300-1500 material
- Dhokra / metal casting: 5-14 days, ₹800-4000 material
- Wood carving: 4-15 days, ₹500-6000 material
- Block printing (per piece): 1-3 days, ₹200-1500 material

Reply strict JSON:
{
  "labor_reasonable": true,
  "material_reasonable": true,
  "flag": "none",
  "reasoning": "one short sentence"
}
Where flag is one of: none, exorbitant_labor, exorbitant_material, both.`;

  try {
    const parsed = await groqChatJSON<Partial<ClaimsResult>>(prompt, {
      temperature: 0.1,
      model: FAST_MODEL,
    });

    return NextResponse.json({
      success: true,
      claims: {
        labor_reasonable: Boolean(parsed.labor_reasonable ?? true),
        material_reasonable: Boolean(parsed.material_reasonable ?? true),
        flag: coerceFlag(parsed.flag),
        reasoning:
          typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 300) : undefined,
      } satisfies ClaimsResult,
    });
  } catch (error) {
    console.warn('[claims-check] Groq failed:', (error as Error)?.message);
    // Bulletproof: on any Groq failure, defer to the deterministic layer
    // which already said "valid" — do not flag over an infra outage.
    return NextResponse.json({
      success: true,
      degraded: true,
      claims: {
        labor_reasonable: true,
        material_reasonable: true,
        flag: 'none',
      } satisfies ClaimsResult,
    });
  }
}
