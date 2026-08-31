/**
 * Shared craft-speech parser.
 *
 * One implementation behind both entry points that turn spoken words into a
 * draft: the in-app capture flow (`/api/items/voice-parse`) and the toll-free
 * IVR (`/api/ivr/collect-item`). Keeping it here means a change to the prompt
 * or the fallback cannot leave the phone line and the app disagreeing about
 * what the same sentence means.
 */

import { generateContentWithFallback } from '@/lib/gemini';
import {
  GROQ_BASE,
  GROQ_WHISPER_MODEL,
  groqChatJSON,
  groqKey,
  languageInstruction,
  languageName,
} from '@/lib/groq';

/** Same latency-first order as the other capture-flow routes. */
const CAPTURE_MODELS = ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite'];

/**
 * Groq is tried before Gemini for text structuring, and is the only option for
 * audio. On a rural 3G connection the round-trip time is what decides whether
 * the capture flow feels usable, and Groq answers in a fraction of the time.
 *
 * Base URL, the model fallback chain and the key read all live in `@/lib/groq`
 * so this file and the other Groq surfaces cannot drift apart again.
 */

/**
 * UI language code -> ISO-639-1 hint for Whisper.
 *
 * **Odia is deliberately absent.** `whisper-large-v3` supports 100 languages
 * and Odia is not one of them: sending `language=or` is rejected outright with
 * `unsupported language: or`, which would leave Odia-speaking artisans — a core
 * audience here — with no transcription at all. Omitting the hint lets Whisper
 * auto-detect, which still returns usable text. Verified against the API's own
 * supported-language list, which does include hi/te/bn/ta/ml/kn/mr/gu/pa/as/ur.
 *
 * An unknown code returns null so the hint is simply left off.
 */
const WHISPER_LANGUAGES: Record<string, string> = {
  en: 'en',
  hi: 'hi',
  te: 'te',
};

function whisperLanguageCode(language?: string | null): string | null {
  return WHISPER_LANGUAGES[(language || '').toLowerCase()] ?? null;
}

/**
 * Transcribe recorded audio with Groq Whisper.
 *
 * This is what lets an artisan speak Odia or Telugu into the app at all: the
 * browser's own SpeechRecognition barely supports those languages, while
 * Whisper handles them server-side and works in any browser.
 *
 * Returns null when Groq is unconfigured or the call fails, so callers can fall
 * back to whatever text they already have rather than losing the capture.
 */
export async function transcribeAudio(
  audio: Blob,
  language?: string | null
): Promise<string | null> {
  const key = groqKey();
  if (!key) {
    console.warn('[voiceParse] GROQ_API_KEY not set — cannot transcribe audio');
    return null;
  }

  try {
    const form = new FormData();
    form.append('file', audio, 'recording.webm');
    form.append('model', GROQ_WHISPER_MODEL);
    form.append('response_format', 'json');

    // Without a hint Whisper auto-detects, and on a short clip it routinely
    // picks the wrong language — an Odia sentence comes back as Hindi-ish
    // nonsense. The artisan has already told us which language they speak, so
    // pass it rather than making the model guess.
    const iso = whisperLanguageCode(language);
    if (iso) form.append('language', iso);

    // Deterministic decoding, plus a domain nudge so craft vocabulary
    // ("ikat", "saree", "warp") is transcribed rather than approximated.
    form.append('temperature', '0');
    form.append('prompt', 'Indian handmade craft description');

    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    if (!res.ok) {
      console.warn('[voiceParse] Groq Whisper failed:', (await res.text()).slice(0, 300));
      return null;
    }

    const data = await res.json();
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    return text || null;
  } catch (e) {
    console.warn('[voiceParse] Groq Whisper error:', (e as Error)?.message);
    return null;
  }
}

/** Structure a transcript with Groq. Returns null so the caller can try Gemini. */
async function parseWithGroq(
  transcript: string,
  targetLanguage?: string | null
): Promise<Record<string, unknown> | null> {
  try {
    return await groqChatJSON<Record<string, unknown>>(buildPrompt(transcript, targetLanguage), {
      temperature: 0.1,
    });
  } catch (e) {
    // Not fatal: Gemini is the documented second provider for this path.
    console.warn('[voiceParse] Groq chat unavailable:', (e as Error)?.message);
    return null;
  }
}

/** The three facts an artisan has to state before a draft can be priced. */
export type RequiredFact = 'product' | 'time' | 'materials';

export interface ParsedCraftSpeech {
  sourceLanguage: string;
  originalTranscript: string;
  englishDescription: string;
  /** The same description in the artisan's chosen language, when one was asked for. */
  localDescription: string | null;
  craftType: string;
  laborDays: number;
  rawMaterialCost: number;

  /* --- Completeness -----------------------------------------------------
   * These say what the ARTISAN ACTUALLY SAID, never what the model guessed.
   * `laborDays` and `rawMaterialCost` always carry a number so the valuation
   * has something to work with, but a number derived from an estimate must
   * not let a half-described item through the capture gate.
   */
  statedProduct: boolean;
  statedTime: boolean;
  statedMaterials: boolean;
  /** Whichever of the three were not clearly stated. */
  missing: RequiredFact[];
  /** One short question, in the artisan's language, naming only what is missing. */
  followUpQuestion: string;

  /** Cost-relevant context they volunteered: handmade vs machine, loom, thread, dye. */
  technique: string | null;

  /** False when every model was unreachable and the numbers are placeholders. */
  aiParsed: boolean;
  /** Which provider answered: 'groq', 'gemini', or 'rules' on full fallback. */
  provider: string;
}

/** Used when the model cannot be reached; deliberately conservative. */
const FALLBACK_LABOR_DAYS = 7;
const FALLBACK_MATERIAL_COST = 1500;
const FALLBACK_CRAFT_TYPE = 'Handmade Craft';

function buildPrompt(transcript: string, targetLanguage?: string | null): string {
  // `englishDescription` stays English by contract — it is the ONDC listing
  // copy. When the artisan has chosen another language we additionally ask for
  // `localDescription` in it, so the app can show them their own words back.
  const localised = targetLanguage && targetLanguage !== 'en'
    ? `

${languageInstruction(targetLanguage)}
Keep "englishDescription" in English regardless, and add a "localDescription" field written in ${targetLanguage}.`
    : '';

  const followUpLanguage = languageName(targetLanguage);

  return `You are an expert linguistic and craft-valuation assistant for Indian artisan cooperatives.
The user will provide a voice transcript spoken in English, Hindi, Odia or Telugu describing a handmade craft.
Translate the text into clear professional English and detect the source language.

COMPLETENESS CHECK — this is the important part.
Decide, for each of the three facts below, whether the artisan EXPLICITLY STATED it. Judge only what
the human actually said. Your own estimate NEVER counts as "stated".
  1. product   — what the item is (e.g. "Sambalpuri saree", "terracotta pot").
  2. time      — how long it took (days, weeks, months, "took me a fortnight").
  3. materials — what it is made of (silk, cotton, clay, natural dye, brass...).
Set "statedProduct" / "statedTime" / "statedMaterials" accordingly, and list every fact that was NOT
clearly stated in "missing" using exactly the words "product", "time", "materials".

You must STILL fill "laborDays" and "rawMaterialCost" with your best estimate so downstream pricing
has a number — but that estimate must not change the booleans above.

TECHNIQUE — if the artisan mentioned how it was made (handmade vs machine-made, the loom or tools
used, thread or dye type, thread count or size), summarise it in a short phrase in "technique".
Use null when they said nothing about it.

FOLLOW-UP — if anything is missing, write "followUpQuestion": ONE short, warm sentence written in
${followUpLanguage}, asking only for the missing item(s). Do not ask for anything already stated.
When nothing is missing, "followUpQuestion" must be an empty string.

Ensure the response format is strictly JSON exactly matching this structure (do not wrap in markdown blocks, just return raw JSON):
{
  "sourceLanguage": "English | Hindi | Odia | Telugu",
  "originalTranscript": "...",
  "englishDescription": "...",
  "craftType": "Short category name e.g., Banarasi Silk Saree, Terracotta Pot",
  "laborDays": 12,
  "rawMaterialCost": 3200,
  "statedProduct": true,
  "statedTime": false,
  "statedMaterials": false,
  "missing": ["time", "materials"],
  "followUpQuestion": "...",
  "technique": "handloom, pure silk thread"
}

Transcript:
"${transcript}"${localised}`;
}

function toPositiveNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Normalise whichever provider answered into the one shape callers expect.
 *
 * `spoken` always wins for `originalTranscript`: models paraphrase, drop, or
 * translate the echo, and those words end up on the public product passport as
 * the artisan's own account of their craft.
 */
const REQUIRED_FACTS: RequiredFact[] = ['product', 'time', 'materials'];

/**
 * Trust the model's per-fact booleans, but recompute `missing` from them.
 *
 * A model that returns `statedTime: false` and forgets to list "time" in
 * `missing` would otherwise wave an incomplete draft straight through the gate.
 * Deriving the list here means the two can never disagree.
 */
function completeness(parsed: Record<string, unknown>): {
  statedProduct: boolean;
  statedTime: boolean;
  statedMaterials: boolean;
  missing: RequiredFact[];
} {
  const statedProduct = parsed.statedProduct === true;
  const statedTime = parsed.statedTime === true;
  const statedMaterials = parsed.statedMaterials === true;

  const stated: Record<RequiredFact, boolean> = {
    product: statedProduct,
    time: statedTime,
    materials: statedMaterials,
  };

  return {
    statedProduct,
    statedTime,
    statedMaterials,
    missing: REQUIRED_FACTS.filter((fact) => !stated[fact]),
  };
}

function shape(parsed: Record<string, unknown>, spoken: string, provider: string): ParsedCraftSpeech {
  const facts = completeness(parsed);
  const technique = String(parsed.technique ?? '').trim();

  return {
    sourceLanguage: String(parsed.sourceLanguage || 'Unknown'),
    originalTranscript: spoken || String(parsed.originalTranscript || ''),
    englishDescription: String(parsed.englishDescription || '').trim() || spoken,
    localDescription: String(parsed.localDescription || '').trim() || null,
    craftType: String(parsed.craftType || '').trim() || FALLBACK_CRAFT_TYPE,
    laborDays: toPositiveNumber(parsed.laborDays, FALLBACK_LABOR_DAYS),
    rawMaterialCost: toPositiveNumber(parsed.rawMaterialCost, FALLBACK_MATERIAL_COST),
    ...facts,
    followUpQuestion: String(parsed.followUpQuestion ?? '').trim(),
    technique: technique && technique.toLowerCase() !== 'null' ? technique : null,
    aiParsed: true,
    provider,
  };
}

/**
 * Parse a spoken craft description into draft fields.
 *
 * Never throws and never returns an empty description: when Gemini is
 * unavailable the artisan's own words are still carried through verbatim as
 * `originalTranscript`, because that transcript is the one piece of the call we
 * genuinely captured. Only the derived fields become placeholders, and
 * `aiParsed: false` marks them as such for anything downstream.
 */
export async function parseCraftSpeech(
  transcript: string,
  targetLanguage?: string | null
): Promise<ParsedCraftSpeech> {
  const spoken = (transcript ?? '').trim();

  // Gemini is the primary parser for the capture/draft path: it is the model
  // this project has tuned the craft-valuation prompt against, and the same
  // function backs the toll-free IVR, so both must read a sentence the same
  // way. Groq stays as the fallback for when Gemini is unreachable.
  try {
    const response = await generateContentWithFallback(
      buildPrompt(spoken, targetLanguage),
      { responseMimeType: 'application/json' },
      CAPTURE_MODELS
    );

    const raw = response.text;
    if (!raw) throw new Error('Empty response from Gemini');

    const parsed = JSON.parse(
      raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    );

    return shape(parsed, spoken, 'gemini');
  } catch (error) {
    console.warn('Gemini craft parse failed, trying Groq:', (error as Error)?.message);
  }

  const groq = await parseWithGroq(spoken, targetLanguage);
  if (groq) {
    return shape(groq, spoken, 'groq');
  }

  // Both models were unreachable. The artisan's own words still survive as
  // `originalTranscript`; only the derived numbers become placeholders, and
  // `aiParsed: false` marks them as such for everything downstream.
  console.warn('Craft speech parse fell back to rules.');

  return {
    sourceLanguage: 'Unknown',
    originalTranscript: spoken,
    englishDescription: spoken
      ? spoken
      : 'Beautiful handcrafted item. (Fallback description due to AI service disruption)',
    localDescription: null,
    craftType: FALLBACK_CRAFT_TYPE,
    laborDays: FALLBACK_LABOR_DAYS,
    rawMaterialCost: FALLBACK_MATERIAL_COST,
    // No model answered, so nothing can be claimed as stated. The capture gate
    // reads these; treating a rules fallback as "complete" would let an
    // undescribed item through on the back of placeholder numbers.
    statedProduct: false,
    statedTime: false,
    statedMaterials: false,
    missing: [...REQUIRED_FACTS],
    followUpQuestion: '',
    technique: null,
    aiParsed: false,
    provider: 'rules',
  };
}
