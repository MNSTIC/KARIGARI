/**
 * One Groq client for the whole app.
 *
 * Every Groq surface — Whisper transcription in the capture flow, the craft
 * speech parser, raw-material sourcing, live-news summarisation, price research
 * — used to hold its own copy of the base URL, the model id and the key read.
 * They drifted: the key was read under a name the `.env` did not use, so the
 * whole provider was silently unauthenticated, and each route hardcoded a
 * different model id — one of which this account cannot reach at all.
 * Centralising kills both classes of bug.
 */

export const GROQ_BASE = 'https://api.groq.com/openai/v1';

/**
 * Chat models tried in order.
 *
 * Which models a Groq key can reach varies by account: this project's key has
 * no access to `llama-3.3-70b-versatile` at all, and a hardcoded single model
 * turns that into a 404 the artisan sees as "service unavailable". So the chain
 * is walked until one answers, and a `model_not_found` moves to the next rather
 * than failing the request. Verified against this account's /models listing.
 */
export const GROQ_CHAT_MODELS = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
] as const;

/** The first choice, exported for callers that want to name one explicitly. */
export const GROQ_CHAT_MODEL = GROQ_CHAT_MODELS[0];
export const GROQ_WHISPER_MODEL = 'whisper-large-v3';

/**
 * Read the key under either spelling.
 *
 * The canonical name is `GROQ_API_KEY`, which is what the code has always read.
 * Deployments that predate this file store it as `GROK_KEY` — a different
 * product's name, and the reason Groq was unauthenticated everywhere. Accepting
 * both means a stale `.env` keeps working instead of failing silently.
 */
export function groqKey(): string | null {
  const key = (process.env.GROQ_API_KEY || process.env.GROK_KEY)?.trim();
  return key ? key : null;
}

/** True when a Groq call can even be attempted. */
export function isGroqConfigured(): boolean {
  return groqKey() !== null;
}

/** Thrown when Groq is reachable but refused the request, so callers can say why. */
export class GroqError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'GroqError';
    this.status = status;
  }
}

export interface GroqChatOptions {
  system?: string;
  temperature?: number;
  /** Pin a single model. Omit to walk `GROQ_CHAT_MODELS` in order. */
  model?: string;
}

/**
 * A stalled model must fail, not hang.
 *
 * Without this the request stays open indefinitely and the calling page sits on
 * a spinner with no error state to render. 30s is well beyond a normal Groq
 * completion, so a timeout here means something is genuinely wrong.
 */
const GROQ_TIMEOUT_MS = 30_000;

/** A 404/400 naming the model means "try the next one", not "give up". */
function isModelUnavailable(status: number, body: string): boolean {
  return (
    (status === 404 || status === 400) &&
    /model_not_found|does not exist|do not have access/i.test(body)
  );
}

/**
 * Ask Groq for a JSON object and return it parsed.
 *
 * Throws `GroqError` rather than returning a fake row: a caller that cannot get
 * an answer must tell the artisan the service is unavailable, not invent a
 * material or a news headline. Callers that have a legitimate second provider
 * (the speech parser falls through to Gemini) should catch and continue.
 */
export async function groqChatJSON<T = Record<string, unknown>>(
  prompt: string,
  { system, temperature = 0.2, model }: GroqChatOptions = {}
): Promise<T> {
  const key = groqKey();
  if (!key) {
    throw new GroqError('AI service not configured (GROQ_API_KEY is not set).', 503);
  }

  const candidates = model ? [model] : [...GROQ_CHAT_MODELS];
  let lastError: GroqError | null = null;

  for (const candidate of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: candidate,
          messages: [
            {
              role: 'system',
              content:
                system ||
                'You are a JSON-only API. You output raw, valid JSON with no markdown formatting.',
            },
            { role: 'user', content: prompt },
          ],
          temperature,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError';
      lastError = new GroqError(
        aborted
          ? `Groq timed out after ${GROQ_TIMEOUT_MS / 1000}s on ${candidate}.`
          : `Groq request failed on ${candidate}: ${(error as Error)?.message}`,
        504
      );
      // Give the next model in the chain a chance rather than failing outright.
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      lastError = new GroqError(
        `Groq request failed (${res.status}) on ${candidate}: ${body.slice(0, 300)}`,
        502
      );
      // This key cannot reach that model — try the next one in the chain.
      if (isModelUnavailable(res.status, body)) continue;
      throw lastError;
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') {
      lastError = new GroqError(`Groq returned an empty response from ${candidate}.`);
      continue;
    }

    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '');

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      lastError = new GroqError(`Groq returned malformed JSON from ${candidate}.`);
      continue;
    }
  }

  throw lastError ?? new GroqError('No Groq chat model was reachable.');
}

/**
 * Pull the first array out of a JSON object whatever the model chose to call it.
 * Groq honours `response_format: json_object`, so a list comes back wrapped, and
 * the wrapper key varies run to run.
 */
export function firstArray(obj: unknown): unknown[] {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== 'object') return [];
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/*  Language                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Map the UI's language code to a name a model understands. Defined here rather
 * than in `translations.ts` so server routes can import it without pulling in
 * the 170 KB client dictionary.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  or: 'Odia',
  te: 'Telugu',
};

export function languageName(code: string | null | undefined): string {
  return LANGUAGE_NAMES[(code || 'en').toLowerCase()] || 'English';
}

/**
 * The instruction every AI surface appends so the artisan is answered in the
 * language they chose, and is understood whichever of the four they write in.
 */
export function languageInstruction(code: string | null | undefined): string {
  const name = languageName(code);
  return `Write every human-readable field of your response in ${name}. The user may write or speak in ${name}, Hindi, Odia, Telugu or English — understand any of them. Translate faithfully; never invent facts that were not in the input.`;
}
