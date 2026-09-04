import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { GEMINI_CONFIGURED, generateContentWithFallback } from '@/lib/gemini';
import { findGiLabel, locationMatchesGi } from '@/lib/giLabels';

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
  /**
   * Client-supplied cap. Voice callers pass 2; text callers pass 3. Server
   * clamps to [1, 3] so a broken client can never let the model loop forever.
   */
  maxRounds?: unknown;
  /**
   * Optional location snapshot ("Assam", "Cuttack, Odisha"). Used only to spot
   * an obvious mismatch between a claimed regional designation and where the
   * artisan actually is. Never stored.
   */
  artisanLocation?: unknown;
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

const HARD_MAX_ROUNDS = 3;
const MIN_ROUNDS = 1;

function clampRounds(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return HARD_MAX_ROUNDS;
  return Math.max(MIN_ROUNDS, Math.min(HARD_MAX_ROUNDS, Math.round(n)));
}

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
    const maxRounds = clampRounds(body.maxRounds);
    const previousQuestions = stringArray(body.previousQuestions, HARD_MAX_ROUNDS, 300);
    const previousAnswers = stringArray(body.previousAnswers, HARD_MAX_ROUNDS, 500);
    const artisanLocation = trimmed(body.artisanLocation, 120);

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
    if (previousQuestions.length >= maxRounds) {
      return NextResponse.json(proceedResult(craftType, description));
    }

    if (!GEMINI_CONFIGURED) {
      return NextResponse.json(proceedResult(craftType, description));
    }

    const history = previousQuestions
      .map((question, index) => `Q: ${question}\nA: ${previousAnswers[index] ?? ''}`)
      .join('\n\n');

    // GI grounding: only flag a proof note when the artisan's declared craft
    // maps to a GI-tagged designation AND their profile location does not sit
    // in the legitimate region. Default is silence — most captures never trip
    // this and go straight through.
    const giMatch = findGiLabel(`${craftType} ${description}`);
    const giRegionOk = giMatch ? locationMatchesGi(giMatch, artisanLocation) : true;
    const giMismatch = Boolean(giMatch && !giRegionOk);
    const giHint =
      giMatch && giMismatch
        ? [
            '',
            'GI CONTEXT (server-detected — do NOT rewrite this):',
            `  Declared craft matches "${giMatch.label}".`,
            `  Expected region(s): ${giMatch.regions.join(', ') || '(CITES / non-regional)'}.`,
            `  Artisan location on file: "${artisanLocation || 'unknown'}".`,
            '  This is a MISMATCH. If — and only if — the mismatch really looks off, set status="verification_needed"',
            `  and add a gentle, non-blocking verificationNote like: "${giMatch.note} Keep your authorisation handy for buyers who ask — this does not block your listing."`,
            '  If the mismatch has an innocent explanation implied by the description (e.g. an Assam-trained weaver based elsewhere), leave status alone and do NOT add a note.',
            '',
          ].join('\n')
        : '';

    const prompt = [
      'You are a documentation assistant helping an Indian handicraft artisan describe one piece for a marketplace listing. Extract the BARE MINIMUM needed to price fairly: craft type, specific material, technique, rough labour time in days.',
      '',
      'DOMAIN CHEAT-SHEET — use it to figure out which gaps exist for THIS craft. Look at every relevant point at once, not one at a time.',
      '  • Silk sarees → which silk? Muga / Tussar / Mulberry / Eri. And loom type — pit loom, frame loom, powerloom.',
      '  • Dhokra / metal craft → which alloy (brass, bell metal, bronze)? Lost-wax or sand-cast?',
      '  • Pottery / terracotta → wheel-thrown or hand-molded? Glazed or unglazed?',
      '  • Weaving (non-silk) → loom type — pit loom, frame loom, backstrap.',
      '  • Wood carving → wood species (sandalwood, teak, rosewood, sheesham)?',
      '  • Block printing → natural or synthetic dyes? Block material (wood/metal)?',
      '  • Handloom cotton (Sambalpuri, Kotpad, Kanjivaram cotton, etc.) → weave technique — ikat, jamdani, plain.',
      '',
      'RULES:',
      '- When anything bare-minimum is missing, ask ONE warm, plain question that BUNDLES every missing point together in the same sentence (e.g. "Two quick things — which silk did you use, and roughly how many days did it take?"). NEVER drip-feed one detail per turn.',
      `- Voice callers pay a real quota cost per recording — aim to finish in ONE clarifying question (2 messages total). Text callers get at most TWO clarifying questions. Hard cap: ${maxRounds}; you have asked ${previousQuestions.length} so far. When ${maxRounds - previousQuestions.length} <= 0 you MUST set status="complete" and readyToProceed=true.`,
      '- Once you have enough to price a listing, set status="complete" and readyToProceed=true. Err on the side of stopping — this is not an interview.',
      '- Authorization / proof: DO NOT demand it. The DEFAULT is silence. Only follow the GI CONTEXT block below if the server flagged a real regional mismatch. Never block the listing; never accuse.',
      '- Never invent facts. If the artisan did not say a value, leave that field null.',
      '- Reply as JSON ONLY. No markdown, no preamble.',
      giHint,
      `Artisan\'s craft type (as declared): ${craftType || 'unknown'}`,
      artisanLocation ? `Artisan\'s recorded location: ${artisanLocation}` : '',
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

      const rawStatus =
        parsed.status === 'need_more_info' ||
        parsed.status === 'complete' ||
        parsed.status === 'verification_needed'
          ? parsed.status
          : 'complete';

      const question = trimmed(parsed.question, 300);
      const hasQuestion = Boolean(question);

      // A question ALWAYS keeps the artisan in Step 1, whatever label the model
      // stamped it with — the earlier bug forwarded it only under
      // `need_more_info`, so a `verification_needed` question was silently
      // dropped and the gate opened with a dangling question on screen.
      // Conversely, no question means proceed, whatever the status — never trap.
      const status: DraftResponse['status'] = hasQuestion
        ? rawStatus === 'complete'
          ? 'need_more_info'
          : rawStatus
        : rawStatus;

      const response: DraftResponse = {
        success: true,
        status,
        extractedData,
        readyToProceed: !hasQuestion,
      };
      if (hasQuestion) response.question = question;

      // Only surface a verification note when the SERVER actually detected a
      // real GI region mismatch. The model otherwise narrates "no mismatch
      // detected", which is noise the artisan should never see.
      if (giMismatch) {
        const verificationNote = trimmed(parsed.verificationNote, 400);
        if (verificationNote) response.verificationNote = verificationNote;
      }

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
