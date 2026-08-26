import { GoogleGenAI } from '@google/genai';
import type { ContentListUnion, GenerateContentConfig } from '@google/genai';

const RAW_KEY = (process.env.GEMINI_API_KEY ?? '').trim();

/**
 * Values that get left in `.env` when nobody ever pasted a real key. An empty
 * or placeholder key is a *configuration* problem, and callers need to say so
 * out loud instead of blaming the user's microphone or the network.
 *
 * Deliberately NOT a prefix check. AI Studio keys start with `AIza`, but the
 * same client also accepts other Google-issued credential shapes, and a working
 * key was being rejected by an `AIza`-only rule. Presence is validated here;
 * whether the credential is actually accepted is answered by the API itself and
 * surfaced through `isGeminiAuthError`.
 */
const PLACEHOLDER_KEYS = new Set([
  '',
  'your-api-key',
  'your_api_key',
  'your_api_key_here',
  'your-gemini-api-key',
  'changeme',
  'todo',
  'xxx',
]);

/** False when the key is missing or is an obvious placeholder. */
export const GEMINI_CONFIGURED = !PLACEHOLDER_KEYS.has(RAW_KEY.toLowerCase()) && RAW_KEY.length >= 20;

if (!GEMINI_CONFIGURED) {
  console.warn(
    '[Gemini] GEMINI_API_KEY is missing or a placeholder. AI features will report themselves as unconfigured.'
  );
}

// Initialize the Google Gen AI client
export const ai = new GoogleGenAI({ apiKey: RAW_KEY });

/**
 * Ordered list of models to try.
 *
 * Verified against this account with `ai.models.list()` + a live
 * `generateContent` call — see the report in ONDC_VOICE_MAP notes:
 *   gemini-3.5-flash      answers (~2s with thinking disabled)
 *   gemini-3.7-flash      resolves, currently returning 503 high-demand
 *   gemini-flash-latest   resolves, currently returning 503 high-demand
 *   gemini-3.1-flash-lite answers (~1.3s) — last-resort so a bad day on the
 *                         newer names still lands on something that works
 * `gemini-2.5-flash` is deliberately absent: it now 404s with
 * "no longer available to new users".
 */
export const FALLBACK_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
];

/** An HTTP-ish status pulled off whatever shape the SDK threw. */
export function geminiErrorStatus(error: unknown): number | null {
  const err = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (typeof err?.status === 'number') return err.status;
  if (typeof err?.code === 'number') return err.code;
  // The SDK often stringifies the whole error body into `message`.
  const match = String(err?.message ?? '').match(/"code"\s*:\s*(\d{3})/);
  return match ? Number(match[1]) : null;
}

/**
 * True when Google rejected the credential itself. This is the case that must
 * never be reported to an artisan as "I could not hear you" — nothing they do
 * with the microphone will fix it.
 */
export function isGeminiAuthError(error: unknown): boolean {
  const status = geminiErrorStatus(error);
  if (status === 401 || status === 403) return true;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message);
}

/** True when every model was simply busy or out of quota — a "try again" case. */
export function isGeminiBusyError(error: unknown): boolean {
  const status = geminiErrorStatus(error);
  if (status === 429 || status === 500 || status === 503) return true;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return /RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|overloaded|quota/i.test(message);
}

/**
 * Coarse reason code so an API route can pick honest copy without re-deriving
 * the classification from a raw SDK error.
 */
export type GeminiFailure = 'unconfigured' | 'busy' | 'timeout' | 'unknown';

export function classifyGeminiError(error: unknown): GeminiFailure {
  if (!GEMINI_CONFIGURED) return 'unconfigured';
  if (isGeminiAuthError(error)) return 'unconfigured';
  if (/timed out/i.test(String((error as { message?: unknown } | null)?.message ?? ''))) return 'timeout';
  if (isGeminiBusyError(error)) return 'busy';
  return 'unknown';
}

/** Short, log-safe description of a failure: status + first line of the message. */
function describe(error: unknown): string {
  const status = geminiErrorStatus(error);
  const message = String((error as { message?: unknown } | null)?.message ?? error)
    .replace(/\s+/g, ' ')
    .slice(0, 240);
  return `status=${status ?? 'n/a'} ${message}`;
}

/** Does this config carry a knob that some models reject outright? */
function hasThinkingConfig(config: GenerateContentConfig): boolean {
  return config.thinkingConfig !== undefined;
}

/**
 * Utility function to attempt generating content with multiple models.
 * If a model fails because THAT model is the problem (503 high demand, 404
 * unknown model, 429 per-model quota) it automatically tries the next model in
 * the fallback list.
 *
 * `models` lets a latency-sensitive caller (the voice assistant) choose its own
 * order instead of paying for a slow first choice on every request.
 */
export async function generateContentWithFallback(
  contents: ContentListUnion,
  config?: GenerateContentConfig,
  models: string[] = FALLBACK_MODELS
) {
  if (!GEMINI_CONFIGURED) {
    const error = new Error('GEMINI_API_KEY is not configured') as Error & { status: number };
    error.status = 401;
    throw error;
  }

  let lastError: unknown;

  for (const model of models) {
    try {
      console.log(`[Gemini] Attempting to use model: ${model}...`);
      const response = await ai.models.generateContent({
        model: model,
        contents: contents,
        config: config,
      });
      return response; // Success! Return the response.
    } catch (error) {
      const status = geminiErrorStatus(error);
      const message = String((error as { message?: unknown })?.message ?? '');
      console.warn(`[Gemini] Model ${model} failed: ${describe(error)}`);
      lastError = error;

      // A bad credential fails identically on every model — trying the rest
      // just burns seconds before the same answer. Surface it now.
      if (isGeminiAuthError(error)) throw error;

      // Some models (gemini-3.6-flash, gemini-3.5-flash-lite) reject
      // `thinkingConfig` with a bare 400 INVALID_ARGUMENT. That is a config
      // mismatch, not a broken request, so retry this model once without it
      // before writing the model off.
      if (status === 400 && config && hasThinkingConfig(config)) {
        const rest: GenerateContentConfig = { ...config };
        delete rest.thinkingConfig;
        try {
          console.log(`[Gemini] Retrying ${model} without thinkingConfig...`);
          return await ai.models.generateContent({ model, contents, config: rest });
        } catch (retryError) {
          console.warn(`[Gemini] Model ${model} retry failed: ${describe(retryError)}`);
          lastError = retryError;
        }
      }

      // Continue to the next model when THIS model is the problem:
      // 503 (high demand), 500, 404 (unknown model), or 429 (per-model quota
      // exhausted — the free tier meters each model separately, so the next
      // one in the list usually still has budget).
      if (
        isGeminiBusyError(error) ||
        status === 404 ||
        message.includes('is not found') ||
        message.includes('no longer available')
      ) {
        continue;
      }

      // For any other error (like a 400 Bad Request) throw immediately so we can fix it
      throw error;
    }
  }

  // If we exhaust all models
  console.error(`[Gemini] All models failed (${models.join(', ')}). Last: ${describe(lastError)}`);
  throw lastError;
}
