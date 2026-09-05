import { NextRequest, NextResponse } from "next/server";
import { generateContentWithFallback } from '@/lib/gemini';
import { describeSaving, prepareForVision } from '@/lib/imagePrep';

/**
 * Combined photo-description match + quality/background assessment.
 *
 * ONE Gemini Vision call per capture, per the revised CAPTURE MODEL spec
 * (Step 1). Previously this route asked three tasks (verify, describe,
 * translate); the new pipeline moves catalog copy to Groq and keeps this
 * call cheap — under free-tier daily quota an artisan can capture ~20 pieces
 * without exhausting Gemini.
 *
 * Response is the union of the new spec fields AND legacy fields the current
 * CaptureModal + IVR completion flow still read. Old callers keep working
 * because `descriptionEnglish`/`descriptionLocal`/`isVerified`/
 * `qualityCheckPassed`/`qualityCheckNotes` are all derived from the new
 * fields (or from the artisan's own description).
 */

const CAPTURE_MODELS = ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite'];

/** Score at or above which we skip the enhancement pass. */
const QUALITY_SKIP_ENHANCE = 7;

interface CombinedResult {
  // New spec ---------------------------------------------------------------
  match: boolean;
  score: number;               // 1-10
  display: 'packed' | 'draped' | '3d_object' | 'other';
  bg_ok: boolean;
  recommended_bg: string;      // Empty when bg_ok is true.
  enhance: boolean;            // True when score < 7 OR !bg_ok.
  craft_details: string;       // Material, colors, technique, dimensions.
  reasoning: string;

  // Legacy — derived, kept so CaptureModal etc. keep working ---------------
  isVerified: boolean;
  qualityCheckPassed: boolean;
  qualityCheckNotes: string;
  descriptionEnglish: string;
  descriptionLocal: string;
}

function bounded(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function coerceDisplay(value: unknown): CombinedResult['display'] {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'packed' || v === 'draped' || v === '3d_object') return v;
  return 'other';
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, description, targetLanguage, craftType } = await req.json();

    if (!imageBase64 || !description) {
      return NextResponse.json(
        { error: "Image and description are required for verification" },
        { status: 400 }
      );
    }

    const langName = targetLanguage === 'hi' ? 'Hindi' :
                     targetLanguage === 'te' ? 'Telugu' :
                     targetLanguage === 'or' ? 'Odia' : 'English';

    // Downscale + re-encode before the model call: the upload leg to Google is
    // on the request the artisan is waiting for, so shipping a 2 MB capture
    // costs them seconds on a weak link for no gain in match accuracy.
    const prepared = await prepareForVision(imageBase64);
    console.log(`[vision-verify] image ${describeSaving(prepared)}`);
    const base64Data = prepared.base64;

    const prompt = `Product described as: "${description}"
Craft type: "${craftType || 'not specified'}"

You are an ONDC listing assistant. Analyse ONE product photo and reply
with the strict JSON schema.

Task 1 — MATCH. Does the photo actually show this product? Be lenient — a
handloom saree draped on a stand still counts. Reject only obvious mismatches
(random object, screenshot, selfie).

Task 2 — QUALITY. Rate the photo 1-10 for a marketplace listing. Judge
lighting, sharpness/blur, clutter, product visibility.

Task 3 — BACKGROUND. Classify the display type — one of packed, draped,
3d_object. Then decide whether the current background works. If it does
not, write ONE short sentence recommending the background this piece needs.

Task 4 — CRAFT DETAILS. Extract material, colour palette, visible technique
markers, and rough dimensions in a short comma-separated string. This string
is what the Groq catalog step reads, so keep it factual and concise.

Task 5 — REASONING. One sentence explaining the match verdict.

Reply strictly in JSON:
{
  "match": true,
  "score": 8,
  "display": "packed",
  "bg_ok": true,
  "recommended_bg": "",
  "craft_details": "Muga silk, deep ochre, plain weave, ~5.5m",
  "reasoning": "Handloom saree matches the artisan's description."
}`;

    const result = await generateContentWithFallback(
      [
        { text: prompt },
        { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
      ],
      {
        responseMimeType: "application/json",
        // Photo/description match is a classification, not a reasoning task.
        // Deliberately NOT cached: every capture must be judged on its own frame.
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: "OBJECT",
          properties: {
            match: { type: "BOOLEAN" },
            score: { type: "NUMBER" },
            display: { type: "STRING" },
            bg_ok: { type: "BOOLEAN" },
            recommended_bg: { type: "STRING" },
            craft_details: { type: "STRING" },
            reasoning: { type: "STRING" }
          },
          required: ["match", "score", "display", "bg_ok", "craft_details", "reasoning"]
        }
      },
      CAPTURE_MODELS
    );

    const rawText =
      typeof result === 'string' ? result : (result as { text?: string })?.text || '';

    let parsedRaw: Record<string, unknown> = {};
    try {
      parsedRaw = JSON.parse(
        rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
      );
    } catch (e) {
      console.error("Failed to parse Gemini response", e);
      // Bulletproof fallback — accept the photo so capture is never blocked by
      // a malformed model response. The tier logic downstream still catches
      // exorbitant prices even if the AI produced nothing useful here.
      parsedRaw = {
        match: true,
        score: 8,
        display: 'other',
        bg_ok: true,
        recommended_bg: '',
        craft_details: description,
        reasoning: 'Vision service returned an unreadable response; accepted without an AI check.',
      };
    }

    const score = bounded(parsedRaw.score, 1, 10, 8);
    const bgOk = Boolean(parsedRaw.bg_ok);
    const match = Boolean(parsedRaw.match);
    const recommendedBg =
      typeof parsedRaw.recommended_bg === 'string' ? parsedRaw.recommended_bg.slice(0, 240) : '';
    const craftDetails =
      typeof parsedRaw.craft_details === 'string'
        ? parsedRaw.craft_details.slice(0, 500)
        : description;
    const reasoning =
      typeof parsedRaw.reasoning === 'string' ? parsedRaw.reasoning.slice(0, 500) : '';
    const enhance = !bgOk || score < QUALITY_SKIP_ENHANCE;

    // Derive legacy fields so the existing CaptureModal keeps rendering. The
    // localised description used to be a translation of a 150-word listing
    // that this route no longer generates — the catalog step (Groq) now owns
    // that. Until the client is fully cut over, echo the artisan's own text.
    const legacy = {
      isVerified: match,
      qualityCheckPassed: score >= QUALITY_SKIP_ENHANCE,
      qualityCheckNotes:
        score >= QUALITY_SKIP_ENHANCE
          ? `Photo quality score ${score}/10 — ready for listing.`
          : `Photo quality score ${score}/10 — ${recommendedBg || 'enhancement recommended'}.`,
      descriptionEnglish: description,
      descriptionLocal: langName === 'English' ? description : description,
    };

    const data: CombinedResult = {
      match,
      score,
      display: coerceDisplay(parsedRaw.display),
      bg_ok: bgOk,
      recommended_bg: recommendedBg,
      enhance,
      craft_details: craftDetails,
      reasoning,
      ...legacy,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Vision Verify Error:", error);
    return NextResponse.json(
      { error: "Failed to verify image using AI", details: (error as Error)?.message },
      { status: 500 }
    );
  }
}
