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

/** Same latency-first order as the other capture-flow routes. */
const CAPTURE_MODELS = ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite'];

/**
 * Groq is tried before Gemini for text structuring, and is the only option for
 * audio. On a rural 3G connection the round-trip time is what decides whether
 * the capture flow feels usable, and Groq answers in a fraction of the time.
 *
 * Both ids are Groq *production* models. The upstream implementation used
 * `qwen/qwen3.8-27b`, which Groq classifies as Preview — "not for production,
 * may be discontinued at short notice" — so it is deliberately not used here.
 */
const GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile';
const GROQ_WHISPER_MODEL = 'whisper-large-v3';
const GROQ_BASE = 'https://api.groq.com/openai/v1';

function groqKey(): string | null {
  const key = process.env.GROQ_API_KEY?.trim();
  return key ? key : null;
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
export async function transcribeAudio(audio: Blob): Promise<string | null> {
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
async function parseWithGroq(transcript: string): Promise<Record<string, unknown> | null> {
  const key = groqKey();
  if (!key) return null;

  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_CHAT_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a JSON-only API. You output raw, valid JSON with no markdown formatting.',
          },
          { role: 'user', content: buildPrompt(transcript) },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      console.warn('[voiceParse] Groq chat failed:', (await res.text()).slice(0, 300));
      return null;
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    return typeof raw === 'string' ? JSON.parse(raw.trim()) : null;
  } catch (e) {
    console.warn('[voiceParse] Groq chat error:', (e as Error)?.message);
    return null;
  }
}

export interface ParsedCraftSpeech {
  sourceLanguage: string;
  originalTranscript: string;
  englishDescription: string;
  craftType: string;
  laborDays: number;
  rawMaterialCost: number;
  /** False when every model was unreachable and the numbers are placeholders. */
  aiParsed: boolean;
  /** Which provider answered: 'groq', 'gemini', or 'rules' on full fallback. */
  provider: string;
}

/** Used when the model cannot be reached; deliberately conservative. */
const FALLBACK_LABOR_DAYS = 7;
const FALLBACK_MATERIAL_COST = 1500;
const FALLBACK_CRAFT_TYPE = 'Handmade Craft';

function buildPrompt(transcript: string): string {
  return `You are an expert linguistic and craft-valuation assistant for Indian artisan cooperatives.
The user will provide a voice transcript spoken in either Hindi, Odia, or Telugu describing a handmade craft.
Translate the text into clear professional English, detect the source language, and extract the estimated labor days (number) and raw material cost (in INR numbers if mentioned, otherwise estimate based on standard regional craft pricing).

Ensure the response format is strictly JSON exactly matching this structure (do not wrap in markdown blocks, just return raw JSON):
{
  "sourceLanguage": "Hindi | Odia | Telugu",
  "originalTranscript": "...",
  "englishDescription": "...",
  "craftType": "Short category name e.g., Banarasi Silk Saree, Terracotta Pot",
  "laborDays": 12,
  "rawMaterialCost": 3200
}

Transcript:
"${transcript}"`;
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
function shape(parsed: Record<string, unknown>, spoken: string, provider: string): ParsedCraftSpeech {
  return {
    sourceLanguage: String(parsed.sourceLanguage || 'Unknown'),
    originalTranscript: spoken || String(parsed.originalTranscript || ''),
    englishDescription: String(parsed.englishDescription || '').trim() || spoken,
    craftType: String(parsed.craftType || '').trim() || FALLBACK_CRAFT_TYPE,
    laborDays: toPositiveNumber(parsed.laborDays, FALLBACK_LABOR_DAYS),
    rawMaterialCost: toPositiveNumber(parsed.rawMaterialCost, FALLBACK_MATERIAL_COST),
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
export async function parseCraftSpeech(transcript: string): Promise<ParsedCraftSpeech> {
  const spoken = (transcript ?? '').trim();

  // Groq first: same output shape, a fraction of the latency.
  const groq = await parseWithGroq(spoken);
  if (groq) {
    return shape(groq, spoken, 'groq');
  }

  try {
    const response = await generateContentWithFallback(
      buildPrompt(spoken),
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
    console.warn('Craft speech parse fell back to rules:', (error as Error)?.message);

    return {
      sourceLanguage: 'Unknown',
      originalTranscript: spoken,
      englishDescription: spoken
        ? spoken
        : 'Beautiful handcrafted item. (Fallback description due to AI service disruption)',
      craftType: FALLBACK_CRAFT_TYPE,
      laborDays: FALLBACK_LABOR_DAYS,
      rawMaterialCost: FALLBACK_MATERIAL_COST,
      aiParsed: false,
      provider: 'rules',
    };
  }
}
