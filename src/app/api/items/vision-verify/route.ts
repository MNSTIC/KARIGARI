import { NextRequest, NextResponse } from "next/server";
import { requireArtisan } from '@/lib/artisanAuth';
import { generateContentWithFallback } from '@/lib/gemini';
import { describeSaving, prepareForVision } from '@/lib/imagePrep';
import {
  adviseRetake,
  coerceBlur,
  coerceExposure,
  type Blur,
  type Exposure,
  type RetakeAdvice,
  type ScoreSource,
} from '@/lib/photoGate';

/** Reads the auth cookie, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';

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

  // V11 quality gate -------------------------------------------------------
  blur: Blur;
  exposure: Exposure;
  /** PASS | SOFT | RETAKE — from `adviseRetake()` in src/lib/photoGate.ts. */
  retakeAdvice: RetakeAdvice;
  /** i18n key for the reason; '' on a silent pass. The client translates it. */
  retakeReasonKey: string;
  /** The same reason in English, for callers that do not translate. */
  retakeReason: string;
  /**
   * AI when Gemini actually scored this frame; FALLBACK when its reply could not
   * be read and the bulletproof defaults below were used instead. The client
   * must not show an "AI checked your photo" claim for FALLBACK.
   */
  scoreSource: ScoreSource;

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

/**
 * English for each reason key, for API consumers that do not translate. The
 * artisan-facing copy lives in the i18n dictionaries under the same keys.
 */
const REASON_EN: Record<string, string> = {
  photo_retake_blurry: 'This photo is very blurry. Hold the phone still, tap the craft on the screen to focus, then take it again.',
  photo_retake_dark: 'This photo is too dark to see the craft. Move near a window or a bright light and try again.',
  photo_retake_blown: 'Strong light has washed out the colours. Step out of direct sunlight, or turn the craft away from the light.',
  photo_retake_mismatch: 'We could not see the craft you described in this photo. Make sure the whole piece is in the frame.',
  photo_retake_unclear: 'The craft is hard to see clearly. Try a plain background and fill the frame with the piece.',
  photo_soft_blurry: 'A little soft, but fine to use. Holding the phone steadier would make the detail sharper.',
  photo_soft_dark: 'A little dark, but fine to use. More light would show the colours more truly.',
  photo_soft_blown: 'A little bright, but fine to use. Softer light would bring back the colours.',
  photo_soft_generic: 'Usable. Better light would show the colours more truly.',
};

export async function POST(req: NextRequest) {
  // This route spends the shared, free-tier Gemini quota on every call and had
  // no guard at all — anyone could burn the day's budget for every artisan. Its
  // only caller is the artisan capture flow, so nothing legitimate is refused.
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const { imageBase64, description, targetLanguage, craftType, retakeCount } = await req.json();

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
lighting, sharpness/blur, clutter, product visibility. Many sellers use
inexpensive phones: a slightly soft but readable photo is fine, not a defect.
Also report:
  - "blur": "none", "mild" (soft but the craft is readable) or "severe" (the
    weave, pattern or shape genuinely cannot be made out);
  - "exposure": "ok", "dark" (too dark to see the colours) or "blown"
    (washed out by strong light). A plain white background is "ok".

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
  "blur": "none",
  "exposure": "ok",
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
            blur: { type: "STRING", enum: ["none", "mild", "severe"] },
            exposure: { type: "STRING", enum: ["ok", "dark", "blown"] },
            display: { type: "STRING" },
            bg_ok: { type: "BOOLEAN" },
            recommended_bg: { type: "STRING" },
            craft_details: { type: "STRING" },
            reasoning: { type: "STRING" }
          },
          required: ["match", "score", "blur", "exposure", "display", "bg_ok", "craft_details", "reasoning"]
        }
      },
      CAPTURE_MODELS
    );

    const rawText =
      typeof result === 'string' ? result : (result as { text?: string })?.text || '';

    let parsedRaw: Record<string, unknown> = {};
    // Flipped to FALLBACK below when the reply cannot be read. The accept-by-
    // default behaviour is unchanged; what changes is that it now SAYS so.
    let scoreSource: ScoreSource = 'AI';
    try {
      parsedRaw = JSON.parse(
        rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
      );
    } catch (e) {
      console.error("[vision-verify] Failed to parse Gemini response", e);
      scoreSource = 'FALLBACK';
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
    const blur = coerceBlur(parsedRaw.blur);
    const exposure = coerceExposure(parsedRaw.exposure);

    const gate = adviseRetake({
      scoreSource,
      match,
      score,
      blur,
      exposure,
      retakeCount: Number.isFinite(Number(retakeCount)) ? Number(retakeCount) : 0,
    });

    // Derive legacy fields so the existing CaptureModal keeps rendering. The
    // localised description used to be a translation of a 150-word listing
    // that this route no longer generates — the catalog step (Groq) now owns
    // that. Until the client is fully cut over, echo the artisan's own text.
    const legacy = {
      isVerified: match,
      qualityCheckPassed: score >= QUALITY_SKIP_ENHANCE,
      // Same field, same meaning — a human note about quality. On FALLBACK it
      // no longer quotes the placeholder score as if a check had produced it.
      qualityCheckNotes:
        scoreSource === 'FALLBACK'
          ? 'The photo could not be checked automatically this time.'
          : score >= QUALITY_SKIP_ENHANCE
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
      blur,
      exposure,
      retakeAdvice: gate.advice,
      retakeReasonKey: gate.reasonKey,
      retakeReason: gate.reasonKey ? REASON_EN[gate.reasonKey] ?? '' : '',
      scoreSource,
      ...legacy,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[vision-verify] failed:", error);
    return NextResponse.json(
      { error: "Failed to verify image using AI", details: (error as Error)?.message },
      { status: 500 }
    );
  }
}
