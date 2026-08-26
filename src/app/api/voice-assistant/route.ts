import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import {
  GEMINI_CONFIGURED,
  classifyGeminiError,
  generateContentWithFallback,
  geminiErrorStatus,
  type GeminiFailure,
} from '@/lib/gemini';
import { SCHEMES, evaluateScheme } from '@/lib/schemes';
import { loadEligibilitySnapshot } from '@/lib/artisanEligibility';
import { buildRulesReply, type RulesContext } from '@/lib/voiceRules';

export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

/**
 * Latency-first model order. The shared FALLBACK_MODELS list leads with
 * gemini-3.7-flash, which is fine for background work but has been answering in
 * tens of seconds — far too slow for something the artisan is waiting to hear
 * spoken back. Thinking is disabled too: transcribe-and-reply needs no reasoning
 * budget, and leaving it on roughly doubled the round trip in testing.
 */
const VOICE_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.7-flash',
  'gemini-flash-latest',
  // Verified to resolve and answer on this account, so a 503/404 on the newer
  // names still lands on a model that works instead of on the apology.
  'gemini-3.1-flash-lite',
];
const VOICE_CONFIG = {
  responseMimeType: 'application/json',
  thinkingConfig: { thinkingBudget: 0 },
};

/** Give up rather than leave the artisan holding a phone to their ear. */
const GEMINI_TIMEOUT_MS = 20_000;

/** Base64 audio ceiling (~6 MB of raw audio). The client caps recordings well below this. */
const MAX_AUDIO_CHARS = 8_000_000;

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  or: 'Odia',
  te: 'Telugu',
};

/**
 * Why the AI is unavailable, one map per failure kind. These are *notices*: the
 * client shows them beside the answer rather than speaking them, because the
 * spoken answer now comes from the rules engine. Telling an artisan to "speak
 * more clearly" when the real problem is an exhausted model quota sends them
 * round a loop that can never succeed.
 *
 * FALLBACK_REPLY is still spoken in one case only — audio came in, Gemini never
 * transcribed it, and we genuinely do not know what was said.
 */
const FALLBACK_REPLY: Record<string, string> = {
  en: 'Sorry, I could not hear that clearly. Please tap the microphone and try again.',
  hi: 'Maaf kijiye, main theek se sun nahi paayi. Kripya microphone dabakar dobara boliye.',
  or: 'Khyama karantu, mu bhala bhabare suni pari nahin. Daya kari microphone tipi punarbara kuhantu.',
  te: 'Kshaminchandi, nenu spashtanga vinaledu. Dayachesi microphone nokki malli cheppandi.',
};

/** The AI credential is missing or rejected. Nothing the artisan does fixes this. */
const UNCONFIGURED_REPLY: Record<string, string> = {
  en: "The voice assistant isn't set up yet. Ask the KARIGARI team to add a Gemini API key.",
  hi: 'Voice assistant abhi set up nahi hua hai. KARIGARI team se Gemini API key jodne ko kahiye.',
  or: 'Voice assistant ehi paryanta set up heini. KARIGARI team ku Gemini API key jodibaku kuhantu.',
  te: 'Voice assistant inka set up kaledu. KARIGARI team ni Gemini API key cheyyamani adagandi.',
};

/** Every model was busy or out of quota. Retrying later genuinely helps. */
const BUSY_REPLY: Record<string, string> = {
  en: 'The AI is busy right now. Please tap the microphone and try again in a minute.',
  hi: 'AI abhi vyast hai. Kripya ek minute baad microphone dabakar dobara boliye.',
  or: 'AI ebe byasta achi. Daya kari eka minute pare microphone tipi punarbara kuhantu.',
  te: 'AI ippudu bizy ga undi. Dayachesi oka nimisham taruvata microphone nokkandi.',
};

function replyFor(kind: 'unconfigured' | 'busy' | 'unknown', languageCode: string): string {
  const map =
    kind === 'unconfigured' ? UNCONFIGURED_REPLY : kind === 'busy' ? BUSY_REPLY : FALLBACK_REPLY;
  return map[languageCode] || map.en;
}

/** Audio containers MediaRecorder actually produces, all accepted by Gemini. */
const ALLOWED_AUDIO_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];

function normalizeMime(raw: unknown): string {
  // MediaRecorder reports things like "audio/webm;codecs=opus".
  const base = String(raw || '').split(';')[0].trim().toLowerCase();
  return ALLOWED_AUDIO_MIME.includes(base) ? base : 'audio/webm';
}

/**
 * Models occasionally ignore responseMimeType and wrap the object in a markdown
 * fence. Parsing that naively fed the entire raw JSON string to text-to-speech,
 * so peel the fence and, failing that, carve out the first {...} block.
 */
function parseModelJson(raw: string): { transcript?: string; reply?: string; language?: string } {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  for (const candidate of [unfenced, sliceFirstObject(unfenced)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try the next candidate */
    }
  }

  // Plain prose is still usable; a mangled JSON blob is not — never speak that.
  return unfenced.includes('"reply"') || unfenced.startsWith('{') ? {} : { reply: unfenced };
}

function sliceFirstObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start !== -1 && end > start ? text.slice(start, end + 1) : null;
}

/**
 * The real scheme catalogue, compressed to one line each.
 *
 * Without this the model answered "tell me about PM Vishwakarma" from generic
 * app copy and hedged. These are the same published facts the schemes page
 * shows, so the spoken answer and the screen can never disagree.
 */
function schemeFacts(eligibleKeys: Set<string>, blockedReasons: Map<string, string>): string {
  return SCHEMES.map((scheme) => {
    const verdict = eligibleKeys.has(scheme.key)
      ? 'THIS ARTISAN QUALIFIES'
      : blockedReasons.get(scheme.key) || 'eligibility not established';
    return `- ${scheme.name}: ${scheme.benefit}. Official portal: ${scheme.officialUrl}. Status for this artisan: ${verdict}.`;
  }).join('\n');
}

function buildPrompt(opts: {
  hasAudio: boolean;
  transcript?: string;
  languageName: string;
  artisanName: string;
  currentRoute: string;
  schemeBlock: string;
}) {
  const { hasAudio, transcript, languageName, artisanName, currentRoute, schemeBlock } = opts;

  const task = hasAudio
    ? `The attached audio is the artisan speaking. Do both of these:
1. "transcript" — what they said, written out verbatim in the language they actually spoke (native script is correct here).
2. "reply" — your spoken answer to them.`
    : `The artisan typed or dictated this: "${transcript}"
Set "transcript" to exactly that text, and write your spoken answer in "reply".`;

  return `You are the voice assistant inside KARIGARI, an app used by marginalized Indian handloom and handicraft artisans. Many of them cannot read.

The artisan is ${artisanName}. They are on the page "${currentRoute}". Their chosen app language is ${languageName}.

${task}

What the app can do, so your answer is never vague:
- Capture a craft by voice: they speak, the AI writes the listing and estimates a fair price
- Government schemes: the app shows which ones they qualify for and exactly what is blocking the rest. They apply themselves on the official portal — KARIGARI never submits on their behalf
- Insights: a market demand map for their craft
- Dashboard: their uploaded items, advances paid, and earnings
- ONDC: listing on the open commerce network to sell without a middleman

Government schemes — these are the real, published facts. If they ask about a scheme, its benefit, or what they qualify for, answer from THIS list and name the actual benefit. Never invent a scheme, an amount or a deadline that is not here:
${schemeBlock}

Rules for "reply":
- One or two short sentences. It will be read aloud, not displayed.
- Answer the actual question. Point at the specific screen or button when there is one.
- Write it in ${languageName}, but ROMANIZED into the plain English alphabet — for example "Namaste, aap Schemes page par jaakar dekh sakti hain".
- Never use Devanagari, Odia or Telugu script in "reply". Browser text-to-speech cannot pronounce them.
- Never promise to submit a government application for them. You can tell them which screen to open and which portal to apply on.
- When they ask about a scheme they do NOT qualify for, say so plainly and name what blocks them.

Return raw JSON only, no markdown fence:
{"transcript": "...", "reply": "...", "language": "Hindi | Odia | Telugu | English"}`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const languageCode = typeof body?.language === 'string' ? body.language : 'en';
  const languageName = LANGUAGE_NAMES[languageCode] || 'English';

  /**
   * Populated as soon as the artisan's real data is loaded, so a Gemini failure
   * further down can still be answered from it instead of apologising.
   */
  let rules: RulesContext | null = null;

  /**
   * The single degraded-answer builder. If we know what the artisan asked, the
   * rules engine answers it from the live scheme catalogue; only when we never
   * got a transcript at all do we fall back to "I could not hear that".
   */
  const degrade = (kind: GeminiFailure) => {
    const noticeKind = kind === 'timeout' ? 'busy' : kind === 'unknown' ? 'unknown' : kind;
    const notice = replyFor(noticeKind, languageCode);
    return NextResponse.json({
      success: true,
      degraded: true,
      reason: kind,
      transcript: rules?.transcript || null,
      reply: rules ? buildRulesReply(rules) : notice,
      // Shown, never spoken: the spoken text above is the useful answer.
      notice,
      language: languageName,
      engine: rules ? 'rules' : 'fallback',
    });
  };

  try {
    // This endpoint spends Gemini quota on every call, so it is behind the same
    // cookie every other route uses rather than being open to the internet.
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let decoded: AuthToken;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { audio, transcript, currentRoute } = body ?? {};
    const hasAudio = typeof audio === 'string' && audio.length > 0;
    const hasTranscript = typeof transcript === 'string' && transcript.trim().length > 0;

    if (!hasAudio && !hasTranscript) {
      return NextResponse.json({ error: 'Provide either audio or transcript' }, { status: 400 });
    }

    // Strip the data-URL prefix the browser's FileReader adds.
    const base64 = hasAudio ? String(audio).replace(/^data:[^;]+;base64,/, '') : '';
    if (base64.length > MAX_AUDIO_CHARS) {
      return NextResponse.json(
        { error: 'Recording is too long. Keep it under about 30 seconds.' },
        { status: 413 }
      );
    }

    // Trust the signed-in identity over whatever the client claims. The same
    // snapshot also feeds the personalised scheme verdicts below, so this is
    // one query rather than two.
    const snapshot = await loadEligibilitySnapshot(decoded.userId).catch(() => null);

    const eligibleKeys = new Set<string>();
    /** Third person — this feeds the model prompt, which talks *about* the artisan. */
    const blockedReasons = new Map<string, string>();
    /**
     * Second person — this is spoken *to* the artisan by the rules engine.
     * Kept as a separate map rather than rewritten from the prompt strings:
     * "blocked only because their profile is missing" read as nonsense when
     * spliced into a sentence addressed to them.
     */
    const artisanBlockers = new Map<string, string>();
    if (snapshot?.found) {
      for (const scheme of SCHEMES) {
        const verdict = evaluateScheme(scheme, snapshot.ctx);
        if (verdict.status === 'ELIGIBLE') {
          eligibleKeys.add(scheme.key);
        } else {
          const blocker = verdict.failed[0];
          const criterion = blocker?.needed || blocker?.label || 'the criteria are not met yet';
          blockedReasons.set(
            scheme.key,
            verdict.status === 'INFO_NEEDED'
              ? `blocked only because their profile is missing ${verdict.missing.join(', ')}`
              : `not eligible — ${criterion}`
          );
          artisanBlockers.set(
            scheme.key,
            verdict.status === 'INFO_NEEDED'
              ? `your profile is still missing ${verdict.missing.join(', ')}`
              // The criterion is a noun phrase ("One of the 18 notified trades"),
              // so it needs a lead-in to read as a spoken reason.
              : `it needs: ${criterion}`
          );
        }
      }
    }

    // Everything the rules engine needs is now known. Capture it before the
    // network call, so a 429/503/timeout below still yields a real answer.
    if (hasTranscript) {
      rules = {
        transcript: String(transcript).slice(0, 2000),
        languageCode,
        artisanName: snapshot?.artisanName || 'Artisan',
        eligibleKeys,
        blockedReasons: artisanBlockers,
      };
    }

    // No usable credential: answer from the rules engine rather than spending a
    // round trip we know will fail.
    if (!GEMINI_CONFIGURED) {
      console.error(
        'Voice Assistant: GEMINI_API_KEY is missing or a placeholder — answering from rules.'
      );
      return degrade('unconfigured');
    }

    const prompt = buildPrompt({
      hasAudio,
      transcript: hasTranscript ? String(transcript).slice(0, 2000) : undefined,
      languageName,
      artisanName: snapshot?.artisanName || 'the artisan',
      currentRoute: typeof currentRoute === 'string' ? currentRoute : '/artisan/dashboard',
      schemeBlock: schemeFacts(eligibleKeys, blockedReasons),
    });

    const contents = hasAudio
      ? [{ text: prompt }, { inlineData: { mimeType: normalizeMime(body?.mimeType), data: base64 } }]
      : [{ text: prompt }];

    const result = await Promise.race([
      generateContentWithFallback(contents, VOICE_CONFIG, VOICE_MODELS),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini timed out')), GEMINI_TIMEOUT_MS)
      ),
    ]);

    const parsed = parseModelJson(result?.text || '');
    const reply = (parsed.reply || '').trim();
    if (!reply) throw new Error('Empty reply from Gemini');

    return NextResponse.json({
      success: true,
      transcript: (parsed.transcript || (hasTranscript ? String(transcript) : '')).trim() || null,
      reply,
      language: parsed.language || languageName,
      engine: 'gemini',
    });
  } catch (error) {
    // Degrade to a rules answer rather than showing a broken UI. Deliberately
    // no invented transcript — claiming to have heard something we did not is
    // worse than admitting the miss.
    //
    // The log carries the real cause (status + message) so the terminal names
    // an invalid key, a 404 model and rejected audio differently instead of
    // collapsing all three into one apology.
    const kind = classifyGeminiError(error);
    console.error(
      `Voice Assistant API error [${kind}] status=${geminiErrorStatus(error) ?? 'n/a'}:`,
      (error as { message?: unknown })?.message ?? error
    );

    return degrade(kind);
  }
}
