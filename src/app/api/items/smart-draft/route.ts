import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { GEMINI_CONFIGURED, generateContentWithFallback } from '@/lib/gemini';

/**
 * Conversational craft-documenter for Step 1 of the CaptureModal.
 *
 * Asks at most 2-3 follow-up questions to fill in what the artisan did not
 * spontaneously say — specific material, technique, rough labour time,
 * certifications when they name a protected designation. Refuses to over-ask:
 * once the required fields are known, the response flips to `complete` and the
 * client stops prompting.
 *
 * Graceful default: when Gemini is not configured OR fails, the route returns
 * `readyToProceed: true` immediately, so a missing key never blocks capture.
 */
export const dynamic = 'force-dynamic';

interface DraftRequest {
  craftType?: unknown;
  description?: unknown;
  previousQuestions?: unknown;
  previousAnswers?: unknown;
}

interface ExtractedData {
  craftType?: string | null;
  material?: string | null;
  technique?: string | null;
  estimatedLaborDays?: number | null;
  specialNotes?: string | null;
}

interface DraftResponse {
  success: true;
  status: 'need_more_info' | 'complete' | 'verification_needed';
  question?: string;
  extractedData: ExtractedData;
  verificationNote?: string;
  readyToProceed: boolean;
}

const MAX_ROUNDS = 3;

function trimmed(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function stringArray(value: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, max)
    .map((entry) => (typeof entry === 'string' ? entry.trim().slice(0, itemMax) : ''))
    .filter(Boolean);
}

function proceedResult(craftType: string, description: string): DraftResponse {
  return {
    success: true,
    status: 'complete',
    extractedData: {
      craftType: craftType || null,
      material: null,
      technique: null,
      estimatedLaborDays: null,
      specialNotes: description || null,
    },
    readyToProceed: true,
  };
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as DraftRequest;
    const craftType = trimmed(body.craftType, 200);
    const description = trimmed(body.description, 1500);
    const previousQuestions = stringArray(body.previousQuestions, MAX_ROUNDS, 300);
    const previousAnswers = stringArray(body.previousAnswers, MAX_ROUNDS, 500);

    // Nothing to work with — bail cleanly rather than asking questions in a
    // vacuum. Rare, since the client only calls this once description is typed.
    if (!craftType && !description) {
      return NextResponse.json({
        success: true,
        status: 'complete',
        extractedData: {},
        readyToProceed: true,
      });
    }

    // Hit the round cap: send whatever was collected and let the artisan
    // continue. The prompt itself will not ask, but a client that miscounts
    // must not be able to loop forever.
    if (previousQuestions.length >= MAX_ROUNDS) {
      return NextResponse.json(proceedResult(craftType, description));
    }

    if (!GEMINI_CONFIGURED) {
      return NextResponse.json(proceedResult(craftType, description));
    }

    const history = previousQuestions
      .map((question, index) => `Q: ${question}\nA: ${previousAnswers[index] ?? ''}`)
      .join('\n\n');

    const prompt = [
      'You are a documentation assistant helping an Indian handicraft artisan describe one piece for a marketplace listing. Extract the BARE MINIMUM needed to price it fairly: 1) craft type, 2) specific material, 3) technique (handloom, powerloom, natural dye, machine finish, etc.), 4) rough labour time in days, 5) any protected-designation certification (GI tag, Silk Mark, Handloom Mark).',
      '',
      'RULES:',
      '- Ask at MOST one short follow-up per turn, phrased as a single question in plain English.',
      `- Never ask more than ${MAX_ROUNDS} follow-ups total; you have asked ${previousQuestions.length} so far.`,
      '- Once you have enough to price a listing, set status="complete" and readyToProceed=true.',
      '- Only set status="verification_needed" when the artisan claims a PROTECTED designation (e.g. "Muga silk", "Kanjivaram silk", "GI tag") AND the description or price hints look wrong for it. In that case add a short verificationNote — do not block, just flag.',
      '- Never invent facts. If the artisan did not say a value, leave that field null.',
      '- Reply as JSON ONLY. No markdown, no preamble.',
      '',
      `Artisan\'s craft type (as declared): ${craftType || 'unknown'}`,
      `Artisan\'s initial description:\n${description || '(none)'}`,
      history ? `\nConversation so far:\n${history}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const result = await generateContentWithFallback([{ text: prompt }], {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            status: {
              type: 'STRING',
              enum: ['need_more_info', 'complete', 'verification_needed'],
            },
            question: { type: 'STRING' },
            extractedData: {
              type: 'OBJECT',
              properties: {
                craftType: { type: 'STRING' },
                material: { type: 'STRING' },
                technique: { type: 'STRING' },
                estimatedLaborDays: { type: 'NUMBER' },
                specialNotes: { type: 'STRING' },
              },
            },
            verificationNote: { type: 'STRING' },
            readyToProceed: { type: 'BOOLEAN' },
          },
          required: ['status', 'extractedData', 'readyToProceed'],
        },
      });

      const rawText = typeof result === 'string' ? result : (result as { text?: string })?.text || '';
      const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const parsed = JSON.parse(cleaned) as {
        status?: string;
        question?: string;
        extractedData?: Record<string, unknown>;
        verificationNote?: string;
        readyToProceed?: boolean;
      };

      // Coerce back to the strict shape — Gemini sometimes returns fields the
      // schema did not name, and shipping them onward would be a leak.
      const extractedRaw = parsed.extractedData || {};
      const laborDays = Number(extractedRaw.estimatedLaborDays);
      const extractedData: ExtractedData = {
        craftType: trimmed(extractedRaw.craftType, 200) || null,
        material: trimmed(extractedRaw.material, 200) || null,
        technique: trimmed(extractedRaw.technique, 200) || null,
        estimatedLaborDays:
          Number.isFinite(laborDays) && laborDays > 0 ? Math.round(laborDays) : null,
        specialNotes: trimmed(extractedRaw.specialNotes, 500) || null,
      };

      const status =
        parsed.status === 'need_more_info' ||
        parsed.status === 'complete' ||
        parsed.status === 'verification_needed'
          ? parsed.status
          : 'complete';

      const response: DraftResponse = {
        success: true,
        status,
        extractedData,
        readyToProceed:
          status === 'need_more_info'
            ? Boolean(parsed.readyToProceed) && Boolean(parsed.question) === false
            : true,
      };
      const question = trimmed(parsed.question, 300);
      if (status === 'need_more_info' && question) {
        response.question = question;
        response.readyToProceed = false;
      }
      const verificationNote = trimmed(parsed.verificationNote, 400);
      if (verificationNote) response.verificationNote = verificationNote;

      return NextResponse.json(response);
    } catch (error) {
      console.warn('[smart-draft] Gemini failed, degrading to proceed:', error);
      return NextResponse.json(proceedResult(craftType, description));
    }
  } catch (error) {
    console.error('Smart draft error:', error);
    return NextResponse.json(
      { success: false, error: 'Smart draft is unavailable.' },
      { status: 500 }
    );
  }
}
