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

export interface ParsedCraftSpeech {
  sourceLanguage: string;
  originalTranscript: string;
  englishDescription: string;
  craftType: string;
  laborDays: number;
  rawMaterialCost: number;
  /** False when Gemini was unreachable and the numbers below are placeholders. */
  aiParsed: boolean;
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

    return {
      sourceLanguage: String(parsed.sourceLanguage || 'Unknown'),
      // The model is asked to echo the transcript; prefer what was actually
      // said if it paraphrases or drops it.
      originalTranscript: spoken || String(parsed.originalTranscript || ''),
      englishDescription: String(parsed.englishDescription || '').trim() || spoken,
      craftType: String(parsed.craftType || '').trim() || FALLBACK_CRAFT_TYPE,
      laborDays: toPositiveNumber(parsed.laborDays, FALLBACK_LABOR_DAYS),
      rawMaterialCost: toPositiveNumber(parsed.rawMaterialCost, FALLBACK_MATERIAL_COST),
      aiParsed: true,
    };
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
    };
  }
}
