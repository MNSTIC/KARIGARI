import { GEMINI_CONFIGURED, ai } from '@/lib/gemini';

/**
 * Generated BACKDROPS for the photo studio — never generated products.
 *
 * SERVER-ONLY: it holds the Gemini client, and the key must never reach a
 * browser. The capture flow calls it through POST /api/items/backdrop.
 *
 * WHAT IT ASKS FOR, AND WHAT IT NEVER DOES. The prompt is text only, and it asks
 * for an EMPTY surface — no objects, no product, no hands. The artisan's photo is
 * never sent to an image model, and nothing returned here is ever treated as the
 * product: the client draws the artisan's own cutout OVER this image, last, in
 * `composeOnBackdrop()` (src/lib/imageEnhance.ts).
 *
 * WHY THAT IS A HARD RULE AND NOT A STYLE CHOICE. This app sells provenance.
 * `compareProductPhotos()` in src/lib/buyerVerify.ts later judges a delivered
 * piece against the artisan's camera frame, and the QR attach check and the
 * fair-pay proof rest on the same frame. A product an AI had redrawn — a
 * "cleaned up" weave, a truer red — would fail a genuine buyer's scan, or pass a
 * fake one, and the fair-pay record would describe a piece that never existed.
 *
 * QUOTA. Every call spends a budget shared with every other AI feature. This is
 * capped at MAX_BACKDROPS per capture, and a free-tier key has NO image
 * generation quota at all (measured: `limit: 0`), so on such a key this reports
 * `no_quota` once and the client stops asking for the rest of the session.
 */

/** Hard ceiling per capture. */
const MAX_BACKDROPS = 2;

/** An image model that is slow is a spinner the artisan did not ask for. */
const TIMEOUT_MS = 15_000;

/**
 * Image-capable models, cheapest first. Names verified against this project's
 * key with `ai.models.list()` — on a billed key the first that answers wins.
 */
const BACKDROP_MODELS = ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

export type BackdropFailure = 'unconfigured' | 'no_quota' | 'busy' | 'timeout' | 'failed';

export type BackdropResult =
  | { ok: true; backdrops: string[] }
  | { ok: false; reason: BackdropFailure };

/** Display type from vision-verify, mapped to a surface that suits it. */
function surfaceFor(display: string): string {
  switch (display) {
    case 'draped':
      return 'a softly lit plain wall with a gentle gradient, suitable for hanging textiles';
    case 'packed':
      return 'a clean tabletop of pale natural wood seen from slightly above';
    case '3d_object':
      return 'a seamless studio sweep in warm neutral tones with soft shadows';
    default:
      return 'a calm, warm neutral studio surface';
  }
}

function buildPrompt(craftDetails: string, display: string, variant: number): string {
  // Craft details only steer the MOOD of the ground (warm or cool, rustic or
  // clean). They are capped and stated as context, and the instruction is
  // explicit that nothing is to be drawn on the surface.
  const context = craftDetails.replace(/\s+/g, ' ').slice(0, 240);
  const mood = variant === 0 ? 'soft daylight from a window' : 'warm, low, even studio light';
  return [
    `Photograph ${surfaceFor(display)}, lit with ${mood}.`,
    `It is the empty background for a handcrafted product described as: "${context}". Choose colours that complement it.`,
    'The surface must be COMPLETELY EMPTY: no products, no objects, no fabric, no props, no hands, no people, no text, no logos, no watermark.',
    'Fill the whole frame with the surface. Shallow depth of field is fine. Photorealistic.',
  ].join(' ');
}

function isNoQuota(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? '');
  return /limit:\s*0/.test(message) || /free_tier/i.test(message);
}

function isBusy(error: unknown): boolean {
  const status = Number((error as { status?: unknown })?.status);
  return status === 429 || status === 503;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One backdrop from the first model that will produce one. */
async function oneBackdrop(prompt: string): Promise<string | BackdropFailure> {
  let lastFailure: BackdropFailure = 'failed';
  for (const model of BACKDROP_MODELS) {
    try {
      const result = await withTimeout(
        ai.models.generateContent({
          model,
          contents: [{ text: prompt }],
          config: { responseModalities: ['IMAGE'] },
        })
      );
      if (result === 'timeout') return 'timeout';

      const part = result.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const data = part?.inlineData?.data;
      if (data) return `data:${part?.inlineData?.mimeType || 'image/png'};base64,${data}`;
      lastFailure = 'failed';
    } catch (error) {
      if (isNoQuota(error)) {
        // Every model on a free-tier key reports this. No point trying the next.
        lastFailure = 'no_quota';
        continue;
      }
      lastFailure = isBusy(error) ? 'busy' : 'failed';
      console.warn(`[backdropGen] ${model} failed:`, (error as Error)?.message?.slice(0, 160));
    }
  }
  return lastFailure;
}

export async function generateBackdrops(input: {
  craftDetails: string;
  display: string;
  count?: number;
}): Promise<BackdropResult> {
  if (!GEMINI_CONFIGURED) return { ok: false, reason: 'unconfigured' };

  const count = Math.max(1, Math.min(MAX_BACKDROPS, input.count ?? MAX_BACKDROPS));
  const backdrops: string[] = [];
  let failure: BackdropFailure = 'failed';

  // Sequential, not parallel: on a quota-limited key the first failure tells us
  // not to spend a second request.
  for (let i = 0; i < count; i += 1) {
    const outcome = await oneBackdrop(buildPrompt(input.craftDetails, input.display, i));
    if (outcome.startsWith('data:')) {
      backdrops.push(outcome);
    } else {
      failure = outcome as BackdropFailure;
      if (failure === 'no_quota' || failure === 'unconfigured') break;
    }
  }

  return backdrops.length > 0 ? { ok: true, backdrops } : { ok: false, reason: failure };
}
