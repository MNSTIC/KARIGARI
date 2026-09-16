import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { groqChatJSON, isGroqConfigured, languageInstruction } from '@/lib/groq';
import { transcribeAudio } from '@/lib/voiceParse';
import { parseOfflineSaleText, type ParsedOfflineSale } from '@/lib/offlineSaleParse';
import {
  MAX_BUYER_NAME_LENGTH,
  MAX_CRAFT_LABEL_LENGTH,
  MAX_OFFLINE_AMOUNT,
  MAX_OFFLINE_QUANTITY,
  cleanText,
  isOfflineChannel,
  parseAmountInput,
  soldAtFromInput,
  type OfflineChannel,
} from '@/lib/offlineSales';

export const dynamic = 'force-dynamic';

/**
 * What the artisan said about a sale → a DRAFT of the log form.
 *
 * Never saves anything. The page shows the transcript, fills the form from this
 * draft, and the artisan corrects it and taps save themselves.
 *
 * Two readers, always both:
 *   - Groq, when configured, which understands free speech best;
 *   - the rule-based parser (src/lib/offlineSaleParse.ts), which runs every
 *     time — as the whole answer with no AI key, and as a cross-check on the
 *     AI's numbers when there is one. Where the two disagree on the amount or
 *     the quantity, both are returned and the page asks the artisan to check.
 *
 * Accepts `{ transcript, language }` as JSON (the browser heard it), or a
 * multipart `file` + `language` (recorded audio, transcribed by the same
 * `transcribeAudio()` the capture flow uses). Every failure answers 200 with
 * whatever was salvaged — a parse failure must never lose the utterance.
 */

const LANGUAGES = ['en', 'hi', 'or', 'te'] as const;
type Lang = (typeof LANGUAGES)[number];

function asLanguage(value: unknown): Lang {
  return (LANGUAGES as readonly string[]).includes(value as string) ? (value as Lang) : 'en';
}

type Field = 'amount' | 'quantity' | 'craftTypeLabel' | 'buyerName' | 'channel' | 'soldAt';

interface Draft {
  amount: number | null;
  quantity: number | null;
  craftTypeLabel: string | null;
  buyerName: string | null;
  channel: OfflineChannel | null;
  soldAt: string | null;
}

const EMPTY_DRAFT: Draft = {
  amount: null,
  quantity: null,
  craftTypeLabel: null,
  buyerName: null,
  channel: null,
  soldAt: null,
};

/** Coerce whatever the model returned into fields the form can accept, or null. */
function sanitiseAi(raw: Record<string, unknown>): { draft: Draft; confidence: number | null } {
  const amount = parseAmountInput(typeof raw.amount === 'number' ? Math.round(raw.amount) : raw.amount);
  const quantity = parseAmountInput(typeof raw.quantity === 'number' ? Math.round(raw.quantity) : raw.quantity);
  const channel = typeof raw.channel === 'string' ? raw.channel.trim().toUpperCase() : '';
  const soldAt = typeof raw.soldAt === 'string' ? raw.soldAt.trim().slice(0, 10) : '';
  const confidence = Number(raw.confidence);
  return {
    draft: {
      amount: amount !== null && amount >= 1 && amount <= MAX_OFFLINE_AMOUNT ? amount : null,
      quantity: quantity !== null && quantity >= 1 && quantity <= MAX_OFFLINE_QUANTITY ? quantity : null,
      craftTypeLabel: cleanText(raw.craftTypeLabel, MAX_CRAFT_LABEL_LENGTH),
      buyerName: cleanText(raw.buyerName, MAX_BUYER_NAME_LENGTH),
      channel: isOfflineChannel(channel) ? channel : null,
      soldAt: /^\d{4}-\d{2}-\d{2}$/.test(soldAt) && soldAtFromInput(soldAt).ok ? soldAt : null,
    },
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
  };
}

function buildPrompt(transcript: string, language: Lang, knownLabels: string[], today: string): string {
  return `An Indian artisan is describing ONE sale they made outside any website — at a haat, to a walk-in customer, at an exhibition, or to a middleman.

What they said: """${transcript.slice(0, 1000)}"""

Today's date in India is ${today}.
${knownLabels.length ? `Names the artisan already uses for their products: ${knownLabels.slice(0, 30).map((l) => `"${l}"`).join(', ')}.` : ''}

${languageInstruction(language)}
Exception for this task: craftTypeLabel is a short product name in English (for example "Dupatta"), or exactly one of the artisan's own names above when it clearly matches; buyerName is the name as spoken, never translated.

Return strict JSON. Every field is nullable — use null for anything not actually said. Never guess a number.
{
  "amount": whole rupees received for the whole sale, or null,
  "quantity": number of pieces, or null,
  "craftTypeLabel": string or null,
  "buyerName": string or null,
  "channel": "HAAT" | "WALK_IN" | "EXHIBITION" | "MIDDLEMAN" | "OTHER" | null,
  "soldAt": "YYYY-MM-DD" or null,
  "confidence": 0 to 1
}
A phone number is never an amount. "kal" in a sale that already happened means yesterday.`;
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  let transcript: string | null = null;
  let language: Lang = 'en';
  let fromAudio = false;

  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      language = asLanguage(form.get('language'));
      const audio = form.get('file');
      if (audio instanceof Blob && audio.size > 0) {
        fromAudio = true;
        if (audio.size < 4096) {
          return NextResponse.json({
            success: false,
            code: 'TOO_SHORT',
            transcript: null,
            draft: EMPTY_DRAFT,
            error: 'That recording was too short. Hold the button while you speak.',
          });
        }
        transcript = await transcribeAudio(audio, language);
      }
    } else {
      const body = await req.json().catch(() => ({}));
      language = asLanguage(body?.language);
      transcript = typeof body?.transcript === 'string' ? body.transcript : null;
    }
  } catch (error) {
    console.warn('[offline-sales/parse] could not read the request:', (error as Error)?.message);
  }

  transcript = transcript?.trim().slice(0, 1000) || null;
  if (!transcript) {
    return NextResponse.json({
      success: false,
      code: fromAudio ? 'TRANSCRIBE_FAILED' : 'EMPTY',
      transcript: null,
      draft: EMPTY_DRAFT,
      error: fromAudio
        ? 'Could not hear that clearly. Try again, or type the sale below.'
        : 'Nothing was said.',
    });
  }

  // The artisan's own vocabulary makes both readers better.
  let knownLabels: string[] = [];
  try {
    const [labels, crafts] = await Promise.all([
      prisma.offlineSale.findMany({
        where: { artisanId },
        distinct: ['craftTypeLabel'],
        take: 30,
        select: { craftTypeLabel: true },
      }),
      prisma.craftItem.findMany({
        where: { artisanId },
        distinct: ['craftType'],
        take: 30,
        select: { craftType: true },
      }),
    ]);
    knownLabels = [...new Set([...labels.map((l) => l.craftTypeLabel), ...crafts.map((c) => c.craftType)])];
  } catch (error) {
    console.warn('[offline-sales/parse] known labels unavailable:', (error as Error)?.message);
  }

  const rules: ParsedOfflineSale = parseOfflineSaleText(transcript, { knownLabels });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  let ai: Draft | null = null;
  let confidence: number | null = null;
  let aiNotice: string | null = null;
  if (isGroqConfigured()) {
    try {
      const raw = await groqChatJSON<Record<string, unknown>>(buildPrompt(transcript, language, knownLabels, today), {
        temperature: 0,
      });
      const cleaned = sanitiseAi(raw);
      ai = cleaned.draft;
      confidence = cleaned.confidence;
    } catch (error) {
      console.warn('[offline-sales/parse] Groq unavailable, rules only:', (error as Error)?.message);
      aiNotice = 'ai_unavailable';
    }
  } else {
    aiNotice = 'ai_unconfigured';
  }

  // Merge: the AI reading where it produced one, the rules otherwise.
  const draft: Draft = { ...EMPTY_DRAFT };
  const sources: Partial<Record<Field, 'ai' | 'rules'>> = {};
  const fields: Field[] = ['amount', 'quantity', 'craftTypeLabel', 'buyerName', 'channel', 'soldAt'];
  for (const field of fields) {
    const fromAi = ai?.[field] ?? null;
    const fromRules = rules[field] ?? null;
    if (fromAi !== null) {
      (draft[field] as unknown) = fromAi;
      sources[field] = 'ai';
    } else if (fromRules !== null) {
      (draft[field] as unknown) = fromRules;
      sources[field] = 'rules';
    }
  }

  // Where the two readers heard different numbers, the artisan decides.
  const conflicts: { amount?: [number, number]; quantity?: [number, number] } = {};
  if (ai?.amount != null && rules.amount != null && ai.amount !== rules.amount) {
    conflicts.amount = [ai.amount, rules.amount];
  }
  if (ai?.quantity != null && rules.quantity != null && ai.quantity !== rules.quantity) {
    conflicts.quantity = [ai.quantity, rules.quantity];
  }

  return NextResponse.json({
    success: true,
    transcript,
    draft,
    sources,
    conflicts,
    ambiguousAmount: draft.amount === null && rules.ambiguousAmount,
    confidence,
    engine: ai ? 'ai+rules' : 'rules',
    notice: aiNotice,
  });
}
