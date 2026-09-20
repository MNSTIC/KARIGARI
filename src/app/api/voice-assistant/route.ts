import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import {
  groqChatJSON,
  groqKey,
  isGroqConfigured,
  groqWhisperTranscribe,
  GroqError,
} from '@/lib/groq';
import { prisma } from '@/lib/prisma';
import { SCHEMES, evaluateScheme } from '@/lib/schemes';
import { loadEligibilitySnapshot } from '@/lib/artisanEligibility';
import { buildRulesReply, type RulesContext } from '@/lib/voiceRules';

export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

/** Give up rather than leave the artisan holding a phone to their ear. */
const GROQ_TIMEOUT_MS = 20_000;

/**
 * The discriminated shape the client dispatches.
 *
 * Kept on the server so keyword fallback and future structured output
 * agree on names. `NONE` is deliberately a first-class value rather than
 * `undefined`, so the client never has to distinguish "no action" from "action
 * missing from response".
 */
export type AssistantAction =
  | { type: 'OPEN_CAPTURE' }
  | { type: 'OPEN_PROFILE' }
  | { type: 'NAVIGATE'; path: string }
  | { type: 'OPEN_DEMAND' }
  | { type: 'FILL_FIELD'; field: string; value: string }
  | { type: 'SUBMIT_FORM' }
  | { type: 'NONE' };

/** Where a page name maps to. Read below by both intent branches. */
const NAV_PATHS: Record<string, string> = {
  dashboard: '/artisan/dashboard',
  home: '/artisan/dashboard',
  orders: '/artisan/orders',
  cluster: '/artisan/cluster',
  schemes: '/artisan/schemes',
  earnings: '/artisan/earnings',
  learn: '/artisan/learn',
  insights: '/artisan/insights',
  materials: '/artisan/workshop',
  marketing: '/artisan/marketing',
  notifications: '/artisan/notifications',
  market: '/artisan/market',
  marketplace: '/artisan/market',
  news: '/artisan/news',
};

/**
 * Cheap keyword intent extractor. Runs on the raw transcript, so it works with
 * or without Groq. Deliberately conservative: unrecognised speech becomes
 * `NONE`, and the client keeps the assistant open for another turn.
 */
function deriveAction(rawTranscript: string): AssistantAction {
  const text = rawTranscript.trim().toLowerCase();
  if (!text) return { type: 'NONE' };

  // Capture-modal shortcuts. Handled first because "new item" also contains
  // "item" which could false-match a marketplace intent.
  if (/(capture|draft|new item|new listing|upload.*(craft|product)|add.*(item|craft))/.test(text)) {
    return { type: 'OPEN_CAPTURE' };
  }

  if (/(profile|my profile|edit profile|my account)/.test(text)) {
    return { type: 'OPEN_PROFILE' };
  }

  if (/(post.*demand|new demand|create.*demand|buy.*request|raise.*demand)/.test(text)) {
    return { type: 'OPEN_DEMAND' };
  }

  // "take me to <page>" / "open <page>" / "go to <page>".
  const nav = text.match(/(?:take me to|go to|open|show|navigate to|show me)\s+(?:the\s+)?([a-z]+)/);
  const targetWord = nav?.[1] || text.match(/^(?:my\s+)?([a-z]+)\s+page$/)?.[1];
  if (targetWord && NAV_PATHS[targetWord]) {
    return { type: 'NAVIGATE', path: NAV_PATHS[targetWord] };
  }

  // A bare page word ("orders", "cluster") still counts as intent when the
  // artisan is on a different route — the caller decides via `currentRoute`
  // whether to act.
  for (const [word, path] of Object.entries(NAV_PATHS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return { type: 'NAVIGATE', path };
  }

  return { type: 'NONE' };
}

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
 * spoken answer now comes from the rules engine.
 */
const FALLBACK_REPLY: Record<string, string> = {
  en: 'Sorry, I could not hear that clearly. Please tap the microphone and try again.',
  hi: 'Maaf kijiye, main theek se sun nahi paayi. Kripya microphone dabakar dobara boliye.',
  or: 'Khyama karantu, mu bhala bhabare suni pari nahin. Daya kari microphone tipi punarbara kuhantu.',
  te: 'Kshaminchandi, nenu spashtanga vinaledu. Dayachesi microphone nokki malli cheppandi.',
};

/** The AI credential is missing or rejected. */
const UNCONFIGURED_REPLY: Record<string, string> = {
  en: "The voice assistant isn't set up yet. Ask the KARIGARI team to add a Groq API key.",
  hi: 'Voice assistant abhi set up nahi hua hai. KARIGARI team se Groq API key jodne ko kahiye.',
  or: 'Voice assistant ehi paryanta set up heini. KARIGARI team ku Groq API key jodibaku kuhantu.',
  te: 'Voice assistant inka set up kaledu. KARIGARI team ni Groq API key cheyyamani adagandi.',
};

/** Every model was busy or out of quota. */
const BUSY_REPLY: Record<string, string> = {
  en: 'The AI is busy right now. Please tap the microphone and try again in a minute.',
  hi: 'AI abhi vyast hai. Kripya ek minute baad microphone dabakar dobara boliye.',
  or: 'AI ebe byasta achi. Daya kari eka minute pare microphone tipi punarbara kuhantu.',
  te: 'AI ippudu bizy ga undi. Dayachesi oka nimisham taruvata microphone nokkandi.',
};

type FailureKind = 'unconfigured' | 'busy' | 'unknown';

function replyFor(kind: FailureKind, languageCode: string): string {
  const map =
    kind === 'unconfigured' ? UNCONFIGURED_REPLY : kind === 'busy' ? BUSY_REPLY : FALLBACK_REPLY;
  return map[languageCode] || map.en;
}

/** Classify a Groq error into a failure kind. */
function classifyGroqError(error: unknown): FailureKind {
  if (!isGroqConfigured()) return 'unconfigured';
  const err = error as { status?: number; message?: string } | null;
  if (err?.status === 401 || err?.status === 403) return 'unconfigured';
  if (err?.status === 429 || err?.status === 503 || err?.status === 500) return 'busy';
  if (/timed? ?out|abort/i.test(String(err?.message ?? ''))) return 'busy';
  return 'unknown';
}

/** Audio containers MediaRecorder actually produces, all accepted by Groq Whisper. */
const ALLOWED_AUDIO_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];

function normalizeMime(raw: unknown): string {
  // MediaRecorder reports things like "audio/webm;codecs=opus".
  const base = String(raw || '').split(';')[0].trim().toLowerCase();
  return ALLOWED_AUDIO_MIME.includes(base) ? base : 'audio/webm';
}

/**
 * Models occasionally ignore the JSON instruction and wrap the object in a
 * markdown fence. Parse defensively.
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
 */
function schemeFacts(eligibleKeys: Set<string>, blockedReasons: Map<string, string>): string {
  return SCHEMES.map((scheme) => {
    const verdict = eligibleKeys.has(scheme.key)
      ? 'THIS ARTISAN QUALIFIES'
      : blockedReasons.get(scheme.key) || 'eligibility not established';
    return `- ${scheme.name}: ${scheme.benefit}. Official portal: ${scheme.officialUrl}. Status for this artisan: ${verdict}.`;
  }).join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Account data loading                                                       */
/* -------------------------------------------------------------------------- */

interface AccountSummary {
  profile: string;
  items: string;
  earnings: string;
  orders: string;
  offlineSales: string;
  recentNotifications: string;
  schemeApplications: string;
}

/**
 * Load the artisan's full account data and summarize it as compact text blocks
 * that fit in a system prompt. Every query runs in parallel.
 */
async function loadAccountSummary(userId: string): Promise<AccountSummary> {
  const [
    user,
    craftItems,
    artisanOrders,
    offlineSales,
    recentNotifs,
    schemeApps,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { artisanProfile: true },
    }),
    prisma.craftItem.findMany({
      where: { artisanId: userId },
      select: {
        id: true,
        craftType: true,
        status: true,
        askingPrice: true,
        salePrice: true,
        advancePaid: true,
        finalPayoutQueued: true,
        paidAt: true,
        escrowStatus: true,
        advanceAmount: true,
        finalSettlementAmount: true,
        createdAt: true,
        buyerName: true,
        isListedOnMarketplace: true,
        isOndcLive: true,
        patchId: true,
        descriptionEnglish: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.artisanOrder.findMany({
      where: { artisanId: userId },
      include: {
        demand: {
          select: {
            craftType: true,
            quantity: true,
            buyerName: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.offlineSale.findMany({
      where: { artisanId: userId },
      select: {
        craftTypeLabel: true,
        amount: true,
        quantity: true,
        channel: true,
        buyerName: true,
        soldAt: true,
      },
      orderBy: { soldAt: 'desc' },
      take: 20,
    }),
    prisma.notification.findMany({
      where: { userId },
      select: { type: true, title: true, message: true, read: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.schemeApplication.findMany({
      where: { userId },
      select: { schemeName: true, status: true, appliedAt: true, notes: true },
    }),
  ]);

  // Profile summary
  const p = user?.artisanProfile;
  const profile = p
    ? `Name: ${user?.name || 'Unknown'}. Craft: ${p.craftType}. Location: ${p.location}. Experience: ${p.experienceYears} years. Mobile: ${p.mobileNumber || 'not set'}. UPI ID: ${p.upiId || 'not set'}. GI Tag: ${p.giTagCertified ? (p.giTagName || 'Yes') : 'No'}. Gender: ${p.gender || 'not set'}. Cluster: ${p.clusterName || 'none'}. Health Score: ${p.healthScore}/100.`
    : `Name: ${user?.name || 'Unknown'}. No artisan profile set up yet.`;

  // Items summary
  const totalItems = craftItems.length;
  const soldItems = craftItems.filter(i => ['SOLD_FINAL', 'SOLD_MIDDLEMAN', 'SOLD_OFFLINE'].includes(i.status));
  const pendingItems = craftItems.filter(i => i.status === 'PENDING_VERIFICATION');
  const listedItems = craftItems.filter(i => i.isListedOnMarketplace);
  const ondcItems = craftItems.filter(i => i.isOndcLive);

  const itemLines = craftItems.slice(0, 15).map(i => {
    const price = i.askingPrice || i.salePrice || 0;
    return `  - ${i.craftType} (${i.status}, ₹${Math.round(price)}, ${i.paidAt ? 'paid' : 'not paid'}, patch: ${i.patchId || 'none'})`;
  });

  const items = `Total items uploaded: ${totalItems}. Sold: ${soldItems.length}. Pending verification: ${pendingItems.length}. Listed on marketplace: ${listedItems.length}. On ONDC: ${ondcItems.length}.\nRecent items:\n${itemLines.join('\n')}`;

  // Earnings summary
  const totalAdvances = craftItems.reduce((sum, i) => sum + (Number(i.advancePaid) || 0), 0);
  const totalFinalPayouts = craftItems.reduce((sum, i) => sum + (Number(i.finalPayoutQueued) || 0), 0);
  const totalSaleValue = soldItems.reduce((sum, i) => sum + (Number(i.salePrice) || Number(i.askingPrice) || 0), 0);
  const escrowHeld = craftItems.filter(i => i.escrowStatus === 'ESCROW_HELD');
  const escrowAdvancePaid = craftItems.filter(i => i.escrowStatus === 'STAGE1_ADVANCE_PAID_40');
  const escrowSettled = craftItems.filter(i => i.escrowStatus === 'STAGE2_SETTLED_89');
  const offlineTotal = offlineSales.reduce((sum, s) => sum + (s.amount * s.quantity), 0);

  const earnings = `Platform earnings: Total gross sales value ₹${Math.round(totalSaleValue)}. Advances received: ₹${Math.round(totalAdvances)}. Final payouts: ₹${Math.round(totalFinalPayouts)}. Total platform income: ₹${Math.round(totalAdvances + totalFinalPayouts)}.\nEscrow: ${escrowHeld.length} held, ${escrowAdvancePaid.length} advance paid (40%), ${escrowSettled.length} fully settled.\nOffline sales total: ₹${offlineTotal} across ${offlineSales.length} sales.`;

  // Orders summary
  const orderLines = artisanOrders.slice(0, 10).map(o => {
    const price = o.negotiatedPrice || o.demand?.quantity || 0;
    return `  - ${o.demand?.craftType || 'Unknown'} for ${o.demand?.buyerName || 'buyer'}: status ${o.status}, ${o.demand?.quantity || '?'} units${o.settledAmount ? `, settled ₹${Math.round(o.settledAmount)}` : ''}`;
  });

  const activeOrders = artisanOrders.filter(o => !['COMPLETED', 'CANCELLED', 'DELIVERED'].includes(o.status));
  const completedOrders = artisanOrders.filter(o => ['COMPLETED', 'DELIVERED'].includes(o.status));

  const orders = `Total demand orders: ${artisanOrders.length}. Active: ${activeOrders.length}. Completed/Delivered: ${completedOrders.length}.\n${orderLines.length ? `Recent orders:\n${orderLines.join('\n')}` : 'No orders yet.'}`;

  // Offline sales summary
  const offlineLines = offlineSales.slice(0, 10).map(s => {
    const date = new Date(s.soldAt).toLocaleDateString('en-IN');
    return `  - ${s.craftTypeLabel}: ₹${s.amount} x${s.quantity} via ${s.channel} on ${date}${s.buyerName ? ` to ${s.buyerName}` : ''}`;
  });

  const offlineSalesSummary = offlineSales.length > 0
    ? `Offline sales: ${offlineSales.length} logged, total ₹${offlineTotal}.\n${offlineLines.join('\n')}`
    : 'No offline sales logged yet.';

  // Recent notifications
  const notifLines = recentNotifs.map(n => {
    const date = new Date(n.createdAt).toLocaleDateString('en-IN');
    return `  - [${n.type}${n.read ? '' : ' UNREAD'}] ${n.title} (${date})`;
  });

  const recentNotifications = recentNotifs.length > 0
    ? `Recent notifications:\n${notifLines.join('\n')}`
    : 'No recent notifications.';

  // Scheme applications
  const schemeLines = schemeApps.map(s =>
    `  - ${s.schemeName}: ${s.status}${s.appliedAt ? ` (applied ${new Date(s.appliedAt).toLocaleDateString('en-IN')})` : ''}`
  );

  const schemeApplications = schemeApps.length > 0
    ? `Scheme applications:\n${schemeLines.join('\n')}`
    : 'No scheme applications yet.';

  return { profile, items, earnings, orders, offlineSales: offlineSalesSummary, recentNotifications, schemeApplications };
}

/* -------------------------------------------------------------------------- */
/*  Prompt builder                                                             */
/* -------------------------------------------------------------------------- */

function buildPrompt(opts: {
  transcript: string;
  languageName: string;
  artisanName: string;
  currentRoute: string;
  schemeBlock: string;
  accountData: AccountSummary;
}) {
  const { transcript, languageName, artisanName, currentRoute, schemeBlock, accountData } = opts;

  return `The artisan typed or dictated this: "${transcript}"
Set "transcript" to exactly that text, and write your spoken answer in "reply".

Return raw JSON only, no markdown fence:
{"transcript": "...", "reply": "...", "language": "Hindi | Odia | Telugu | English"}`;
}

function buildSystemPrompt(opts: {
  languageName: string;
  artisanName: string;
  currentRoute: string;
  schemeBlock: string;
  accountData: AccountSummary;
}) {
  const { languageName, artisanName, currentRoute, schemeBlock, accountData } = opts;

  return `You are the KARIGARI voice assistant — a warm, knowledgeable helper inside an app used by marginalized Indian handloom and handicraft artisans. Many of them cannot read. You have FULL access to this artisan's account data. Answer their questions accurately using the real data below.

The artisan is ${artisanName}. They are on the page "${currentRoute}". Their chosen app language is ${languageName}.

=== ARTISAN'S ACCOUNT DATA ===

${accountData.profile}

${accountData.items}

${accountData.earnings}

${accountData.orders}

${accountData.offlineSales}

${accountData.recentNotifications}

${accountData.schemeApplications}

=== END ACCOUNT DATA ===

What the app can do, so your answer is never vague:
- Capture a craft by voice: they speak, the AI writes the listing and estimates a fair price
- Government schemes: the app shows which ones they qualify for and exactly what is blocking the rest. They apply themselves on the official portal — KARIGARI never submits on their behalf
- Insights: a market demand map for their craft
- Dashboard: their uploaded items, advances paid, and earnings
- ONDC: listing on the open commerce network to sell without a middleman
- Orders: demand orders from buyers that the artisan has accepted
- Earnings: settlement tracking for advances and final payouts

Government schemes — these are the real, published facts. If they ask about a scheme, its benefit, or what they qualify for, answer from THIS list and name the actual benefit. Never invent a scheme, an amount or a deadline that is not here:
${schemeBlock}

Rules for "reply":
- One to three short sentences. It will be read aloud, not displayed.
- Answer the actual question with REAL DATA from the account above. Name real numbers — rupees earned, items sold, order counts.
- Point at the specific screen or button when there is one.
- Write it in ${languageName}, but ROMANIZED into the plain English alphabet — for example "Namaste, aap Schemes page par jaakar dekh sakti hain".
- Never use Devanagari, Odia or Telugu script in "reply". Browser text-to-speech cannot pronounce them.
- Never promise to submit a government application for them. You can tell them which screen to open and which portal to apply on.
- When they ask about a scheme they do NOT qualify for, say so plainly and name what blocks them.
- Be warm and encouraging. Address them by name when natural.

You are a JSON-only API. You output raw, valid JSON with no markdown formatting.`;
}

/* -------------------------------------------------------------------------- */
/*  POST handler                                                               */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const languageCode = typeof body?.language === 'string' ? body.language : 'en';
  const languageName = LANGUAGE_NAMES[languageCode] || 'English';

  /**
   * Populated as soon as the artisan's real data is loaded, so a Groq failure
   * further down can still be answered from it instead of apologising.
   */
  let rules: RulesContext | null = null;

  /**
   * The single degraded-answer builder. If we know what the artisan asked, the
   * rules engine answers it from the live scheme catalogue; only when we never
   * got a transcript at all do we fall back to "I could not hear that".
   */
  const degrade = (kind: FailureKind) => {
    const notice = replyFor(kind, languageCode);
    return NextResponse.json({
      success: true,
      degraded: true,
      reason: kind,
      transcript: rules?.transcript || null,
      reply: rules ? buildRulesReply(rules) : notice,
      notice: rules ? undefined : notice,
      language: languageName,
      engine: rules ? 'rules' : 'fallback',
      action: deriveAction(rules?.transcript || ''),
    });
  };

  try {
    // This endpoint spends Groq quota on every call, so it is behind the same
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
    const blockedReasons = new Map<string, string>();
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
              : `it needs: ${criterion}`
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // Audio transcription: use Groq Whisper
    // -----------------------------------------------------------------------
    let resolvedTranscript = hasTranscript ? String(transcript).trim() : '';

    if (hasAudio && !resolvedTranscript) {
      // No usable Groq key: cannot transcribe.
      if (!isGroqConfigured()) {
        console.error('Voice Assistant: GROQ_API_KEY is missing — cannot transcribe audio.');
        return degrade('unconfigured');
      }

      const whisperResult = await groqWhisperTranscribe(
        base64,
        normalizeMime(body?.mimeType),
        languageCode
      );

      if (whisperResult) {
        resolvedTranscript = whisperResult;
      } else {
        // Whisper couldn't transcribe — fall back
        console.warn('Voice Assistant: Whisper transcription returned empty.');
        return degrade('unknown');
      }
    }

    // Everything the rules engine needs is now known. Capture it before the
    // network call, so a timeout below still yields a real answer.
    if (resolvedTranscript) {
      rules = {
        transcript: resolvedTranscript.slice(0, 2000),
        languageCode,
        artisanName: snapshot?.artisanName || 'Artisan',
        eligibleKeys,
        blockedReasons: artisanBlockers,
      };
    }

    // No usable credential: answer from the rules engine rather than spending a
    // round trip we know will fail.
    if (!isGroqConfigured()) {
      console.error(
        'Voice Assistant: GROQ_API_KEY is missing — answering from rules.'
      );
      return degrade('unconfigured');
    }

    // -----------------------------------------------------------------------
    // Load the artisan's full account data for the prompt
    // -----------------------------------------------------------------------
    const accountData = await loadAccountSummary(decoded.userId).catch((err) => {
      console.warn('Voice Assistant: failed to load account data:', (err as Error)?.message);
      return {
        profile: `Name: ${snapshot?.artisanName || 'Unknown'}.`,
        items: 'Could not load items data.',
        earnings: 'Could not load earnings data.',
        orders: 'Could not load orders data.',
        offlineSales: 'Could not load offline sales data.',
        recentNotifications: 'Could not load notifications.',
        schemeApplications: 'Could not load scheme applications.',
      } as AccountSummary;
    });

    // -----------------------------------------------------------------------
    // Ask Groq for the reply
    // -----------------------------------------------------------------------
    const systemPrompt = buildSystemPrompt({
      languageName,
      artisanName: snapshot?.artisanName || 'the artisan',
      currentRoute: typeof currentRoute === 'string' ? currentRoute : '/artisan/dashboard',
      schemeBlock: schemeFacts(eligibleKeys, blockedReasons),
      accountData,
    });

    const userMessage = buildPrompt({
      transcript: resolvedTranscript.slice(0, 2000),
      languageName,
      artisanName: snapshot?.artisanName || 'the artisan',
      currentRoute: typeof currentRoute === 'string' ? currentRoute : '/artisan/dashboard',
      schemeBlock: schemeFacts(eligibleKeys, blockedReasons),
      accountData,
    });

    const parsed = await groqChatJSON<{ transcript?: string; reply?: string; language?: string }>(
      userMessage,
      {
        system: systemPrompt,
        temperature: 0.3,
      }
    );

    const reply = (parsed.reply || '').trim();
    if (!reply) throw new Error('Empty reply from Groq');

    const finalTranscript = (
      parsed.transcript || resolvedTranscript
    ).trim();

    return NextResponse.json({
      success: true,
      transcript: finalTranscript || null,
      reply,
      language: parsed.language || languageName,
      engine: 'groq',
      // Derived from what the artisan actually said, not what Groq replied —
      // an intent to open the capture form does not depend on Groq having
      // named the modal in its answer.
      action: deriveAction(finalTranscript),
    });
  } catch (error) {
    // Degrade to a rules answer rather than showing a broken UI.
    const kind = classifyGroqError(error);
    console.error(
      `Voice Assistant API error [${kind}]:`,
      (error as { message?: unknown })?.message ?? error
    );

    return degrade(kind);
  }
}
