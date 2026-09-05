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
/**
 * Fastest-first. Measured on this account (median of 5, dev server, Sept 2026):
 * the old order led with `gemini-3.7-flash`, which answers 503 "high demand" on
 * every single call, then `gemini-3.5-flash` answers 429 (free-tier daily quota),
 * then `gemini-flash-latest` answers 503 again — three failed round trips before
 * `gemini-3.1-flash-lite` finally serves the request. That cost 18-24s of pure
 * waiting on EVERY Gemini route. Leading with the model that actually answers
 * removes all three.
 */
export const FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.7-flash',
];

/**
 * For callers that genuinely need the strongest reasoning and can pay the
 * latency: smart-draft's domain questioning, claims validation, insights.
 * Same members, strongest-first.
 */
export const FALLBACK_MODELS_QUALITY = [
  'gemini-3.5-flash',
  'gemini-3.7-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
];

/**
 * Per-attempt ceilings. Google's own default is ~60s, which is what let a
 * single stalled model hold a whole request open. A classification that has not
 * answered in 6s is not going to; fall through to the next model instead.
 */
export const TIMEOUT_FAST_MS = 6_000;
export const TIMEOUT_THINKING_MS = 15_000;

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

/** True when the caller explicitly asked for zero thinking budget. */
function isThinkingDisabled(config?: GenerateContentConfig): boolean {
  const budget = (config?.thinkingConfig as { thinkingBudget?: number } | undefined)?.thinkingBudget;
  return budget === 0;
}

/** An aborted attempt is retryable — same class as a 503, not a hard failure. */
function isAbortError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return name === 'AbortError' || /abort|timed? ?out/i.test(message);
}

/* -------------------------------------------------------------------------- */
/*  Response cache                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Small in-memory LRU for IDEMPOTENT prompts.
 *
 * Opt-in per call (`cacheKey`), because most of this app's Gemini traffic must
 * never be cached: a vision authenticity check has to run fresh against the
 * photo in front of it, or two different products could share one verdict.
 * Only pricing/catalog/parse style calls — where the same input genuinely means
 * the same answer — pass a key.
 *
 * Process-local by design. This is a latency cache, not a source of truth; a
 * cold lambda simply pays the model call once more.
 */
const CACHE_MAX = 200;
const CACHE_TTL_MS = 5 * 60 * 1000;
const responseCache = new Map<string, { at: number; value: unknown }>();

function cacheGet(key: string): unknown | undefined {
  const hit = responseCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    responseCache.delete(key);
    return undefined;
  }
  // Refresh recency — Map preserves insertion order, so re-inserting moves it
  // to the end and keeps the eviction below honest about what is actually cold.
  responseCache.delete(key);
  responseCache.set(key, hit);
  return hit.value;
}

function cacheSet(key: string, value: unknown): void {
  if (responseCache.size >= CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, { at: Date.now(), value });
}

/** Stable digest for a cache key. Cheap, non-cryptographic use of SHA-1. */
export function promptDigest(...parts: (string | undefined | null)[]): string {
  // Imported lazily so the browser bundle never pulls node:crypto through a
  // stray client import of this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const hash = createHash('sha1');
  for (const part of parts) hash.update(String(part ?? ''), 'utf8');
  return hash.digest('hex');
}

/**
 * Utility function to attempt generating content with multiple models.
 * If a model fails because THAT model is the problem (503 high demand, 404
 * unknown model, 429 per-model quota) it automatically tries the next model in
 * the fallback list.
 *
 * The third argument accepts either a bare model array (legacy call sites) or
 * an options object with `models`, a per-attempt `timeoutMs`, and a `cacheKey`
 * for idempotent prompts.
 */
export interface GenerateOptions {
  /** Model order to walk. Defaults to the fastest-first FALLBACK_MODELS. */
  models?: string[];
  /** Per-attempt ceiling. Defaults by whether thinking is disabled. */
  timeoutMs?: number;
  /**
   * Opt in to the 5-minute response cache. Only pass this when the same key
   * genuinely implies the same answer — never for vision/authenticity work.
   */
  cacheKey?: string;
}

export async function generateContentWithFallback(
  contents: ContentListUnion,
  config?: GenerateContentConfig,
  modelsOrOptions: string[] | GenerateOptions = FALLBACK_MODELS
) {
  // Back-compat: callers that already pass a bare model array keep working.
  const options: GenerateOptions = Array.isArray(modelsOrOptions)
    ? { models: modelsOrOptions }
    : modelsOrOptions;
  const models = options.models ?? FALLBACK_MODELS;
  const timeoutMs =
    options.timeoutMs ?? (isThinkingDisabled(config) ? TIMEOUT_FAST_MS : TIMEOUT_THINKING_MS);

  if (!GEMINI_CONFIGURED) {
    const error = new Error('GEMINI_API_KEY is not configured') as Error & { status: number };
    error.status = 401;
    throw error;
  }

  if (options.cacheKey) {
    const cached = cacheGet(options.cacheKey);
    if (cached !== undefined) {
      console.log('[Gemini] cache hit');
      return cached as Awaited<ReturnType<typeof ai.models.generateContent>>;
    }
  }

  let lastError: unknown;

  /** One attempt, bounded by its own AbortController. */
  const attempt = async (model: string, cfg?: GenerateContentConfig) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await ai.models.generateContent({
        model,
        contents,
        config: { ...(cfg ?? {}), abortSignal: controller.signal },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  for (const model of models) {
    try {
      console.log(`[Gemini] Attempting to use model: ${model}...`);
      const response = await attempt(model, config);
      if (options.cacheKey) cacheSet(options.cacheKey, response);
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
          const retried = await attempt(model, rest);
          if (options.cacheKey) cacheSet(options.cacheKey, retried);
          return retried;
        } catch (retryError) {
          console.warn(`[Gemini] Model ${model} retry failed: ${describe(retryError)}`);
          lastError = retryError;
        }
      }

      // Continue to the next model when THIS model is the problem:
      // 503 (high demand), 500, 404 (unknown model), 429 (per-model quota —
      // the free tier meters each model separately, so the next one usually
      // still has budget), or our own per-attempt timeout.
      if (
        isGeminiBusyError(error) ||
        isAbortError(error) ||
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
