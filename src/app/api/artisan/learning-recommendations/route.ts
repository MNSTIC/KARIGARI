import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { GEMINI_CONFIGURED, generateContentWithFallback, promptDigest } from '@/lib/gemini';
import { groqChatJSON, isGroqConfigured, languageInstruction } from '@/lib/groq';
import { gatherStageRecord, LEARNING_STATUS_COMPLETED } from '@/lib/skillStageRecord';
import { LEVEL_FOR_STAGE, type SkillStage } from '@/lib/skillStage';
import type { LearningGaps, ProfileGap } from '@/lib/learningCatalog';
import {
  buildTracks,
  normaliseAiItems,
  type AiLearningItem,
  type LearningPayload,
} from '@/lib/learningPlan';

/**
 * GET /api/artisan/learning-recommendations?lang=hi
 *
 * The learn page's three tracks, the artisan's derived skill stage, and the
 * lessons they have marked done.
 *
 * The stage and the gaps are read fresh on every call — they are cheap counts
 * and must match the rest of the app. Only the AI answer is cached, in this
 * process's memory, per artisan, language and inputs (craft, cluster, stage,
 * which gaps are open), so reloading the page does not spend a model call.
 * The phone keeps its own copy for offline use (src/lib/learningCache.ts), which
 * is why the service worker is told never to answer this route from its cache.
 *
 * AI path: Groq, then Gemini. Either may be missing or fail; the answer then
 * comes from the curated catalogue and says so (`source: 'CURATED'`). A thin AI
 * answer is padded from the same catalogue (`mixed: true`). This route never
 * returns an empty track and never fails because a model did.
 */
export const dynamic = 'force-dynamic';

const LANGUAGES = new Set(['en', 'hi', 'or', 'te']);

/** A good answer is reused for a day; a failed call is not retried for 10 minutes. */
const AI_TTL_MS = 24 * 60 * 60 * 1000;
const AI_FAILURE_TTL_MS = 10 * 60 * 1000;
/** The page is already showing something; do not hold the request for a slow model. */
const AI_BUDGET_MS = 15_000;
const AI_CACHE_MAX = 500;
const AI_TEMPERATURE = 0.3;

interface CachedAnswer {
  at: number;
  /** null records a failure, so the next load goes straight to the catalogue. */
  items: AiLearningItem[] | null;
}

const aiCache = new Map<string, CachedAnswer>();

function cacheRead(key: string): CachedAnswer | null {
  const hit = aiCache.get(key);
  if (!hit) return null;
  const ttl = hit.items ? AI_TTL_MS : AI_FAILURE_TTL_MS;
  if (Date.now() - hit.at > ttl) {
    aiCache.delete(key);
    return null;
  }
  return hit;
}

function cacheWrite(key: string, items: AiLearningItem[] | null): CachedAnswer {
  if (aiCache.size >= AI_CACHE_MAX) {
    const oldest = aiCache.keys().next().value;
    if (oldest !== undefined) aiCache.delete(oldest);
  }
  const entry = { at: Date.now(), items };
  aiCache.set(key, entry);
  return entry;
}

function withBudget<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`AI budget of ${AI_BUDGET_MS / 1000}s spent`)), AI_BUDGET_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** The gaps, as plain words for the prompt. Counts and field names only — no values. */
function describeGaps(gaps: LearningGaps): string {
  const lines: string[] = [];
  if (gaps.draftsUnfinished > 0) lines.push(`${gaps.draftsUnfinished} voice-captured drafts still need photos and a price`);
  if (gaps.patchesToAttach > 0) lines.push(`${gaps.patchesToAttach} verified pieces still need to be photographed again before they can be listed`);
  if (gaps.sellableUnlisted > 0) lines.push(`${gaps.sellableUnlisted} sellable pieces are not yet listed online`);
  if (gaps.profileMissing.includes('upi')) lines.push('has not added a UPI ID to receive payments');
  if (gaps.profileMissing.some((field) => field !== 'upi')) lines.push('government scheme profile is incomplete');
  return lines.length ? lines.map((line) => `- ${line}`).join('\n') : '- nothing outstanding';
}

function buildPrompt(input: {
  craftType: string | null;
  clusterName: string | null;
  stage: SkillStage;
  gaps: LearningGaps;
  language: string;
}): string {
  return `You plan short self-study for an Indian artisan who learns from YouTube on a basic smartphone.

ARTISAN
- Craft: ${input.craftType ? `"${input.craftType}"` : 'not set (suggest lessons that suit any handicraft)'}
- Cluster: ${input.clusterName ? `"${input.clusterName}"` : 'not set'}
- Skill stage: ${input.stage} (suggest mostly "${LEVEL_FOR_STAGE[input.stage]}" level lessons)
- Outstanding work:
${describeGaps(input.gaps)}

Suggest 9 to 12 lessons across exactly three tracks, 3 or 4 per track:
- "business": pricing, packaging, customer handling, bulk orders
- "design": motifs, colour, finishing, fusion products — specific to the craft
- "digital": using the phone, receiving UPI payments safely, reading an order, answering a buyer
Where a lesson helps with the outstanding work, put it first in the one track it naturally belongs to (taking photos and uploading are digital). Use each outstanding item for at most one lesson in the whole answer; the rest of the lessons are about the craft and the business, not the app.

For each lesson give:
- "track": "business" | "design" | "digital"
- "level": "basic" | "growing" | "advanced"
- "title": at most 8 words
- "whyItHelps": one sentence on what this artisan gains
- "searchQuery": the words to type into YouTube search to find good tutorials, 3 to 8 words

RULES — these are checked, and an answer that breaks them is thrown away:
- Do NOT give video IDs, links, URLs, channel or creator names, video durations, view counts or thumbnails. Only search words.
- Do not promise income, loans or scheme benefits.

${languageInstruction(input.language)}
Keep "track" and "level" values exactly as given in English. Write "searchQuery" in the same language as the title, unless tutorials on the topic are far more common in English or Hindi.

Return strict JSON: { "items": [ { "track": "", "level": "", "title": "", "whyItHelps": "", "searchQuery": "" } ] }`;
}

async function askAi(prompt: string, stage: SkillStage): Promise<AiLearningItem[]> {
  const failures: string[] = [];

  if (isGroqConfigured()) {
    try {
      const raw = await withBudget(
        groqChatJSON<Record<string, unknown>>(prompt, {
          system: "You are a JSON-only API. You output raw, valid JSON. Always wrap the array in an 'items' key.",
          temperature: AI_TEMPERATURE,
        })
      );
      const items = normaliseAiItems(raw, stage);
      if (items.length > 0) return items;
      failures.push('Groq returned no usable lessons');
    } catch (error) {
      failures.push(`Groq: ${(error as Error)?.message}`);
    }
  }

  if (GEMINI_CONFIGURED) {
    try {
      const result = await withBudget(
        generateContentWithFallback(
          [{ text: prompt }],
          {
            responseMimeType: 'application/json',
            temperature: AI_TEMPERATURE,
            // Topic selection is recall, not reasoning.
            thinkingConfig: { thinkingBudget: 0 },
          },
          { cacheKey: promptDigest('learning-recommendations', prompt) }
        )
      );
      const text = (result as { text?: string })?.text || '{}';
      const items = normaliseAiItems(JSON.parse(text.trim()), stage);
      if (items.length > 0) return items;
      failures.push('Gemini returned no usable lessons');
    } catch (error) {
      failures.push(`Gemini: ${(error as Error)?.message}`);
    }
  }

  throw new Error(failures.length ? failures.join(' | ') : 'no AI provider configured');
}

export async function GET(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  const requested = new URL(req.url).searchParams.get('lang') ?? 'en';
  const language = LANGUAGES.has(requested) ? requested : 'en';

  try {
    const [record, profile, draftsUnfinished, patchesToAttach, sellableUnlisted, completedRows] = await Promise.all([
      gatherStageRecord(artisanId),
      prisma.artisanProfile.findUnique({
        where: { userId: artisanId },
        select: {
          craftType: true,
          clusterName: true,
          socialCategory: true,
          annualIncome: true,
          aadhaarLast4: true,
          upiId: true,
        },
      }),
      prisma.craftItem.count({ where: { artisanId, status: 'IVR_DRAFT' } }),
      prisma.craftItem.count({
        where: { artisanId, status: 'VERIFIED', qrVerified: false, patchId: { not: null } },
      }),
      prisma.craftItem.count({ where: { artisanId, status: 'SELLABLE', isListedOnMarketplace: false } }),
      prisma.learningProgress.findMany({
        where: { artisanId, status: LEARNING_STATUS_COMPLETED },
        select: { moduleKey: true },
        orderBy: { updatedAt: 'asc' },
      }),
    ]);

    const profileMissing: ProfileGap[] = [];
    if (!profile?.socialCategory) profileMissing.push('socialCategory');
    if (profile?.annualIncome === null || profile?.annualIncome === undefined) profileMissing.push('annualIncome');
    if (!profile?.aadhaarLast4) profileMissing.push('aadhaar');
    if (!profile?.upiId) profileMissing.push('upi');

    const gaps: LearningGaps = { draftsUnfinished, patchesToAttach, sellableUnlisted, profileMissing };
    const craftType = profile?.craftType?.trim() || null;
    const clusterName = profile?.clusterName?.trim() || null;
    const stage = record.result.stage;
    const completed = completedRows.map((row) => row.moduleKey);

    // The cache key names only what changes the answer — which gaps are open,
    // not how many — so selling one more piece does not buy a fresh model call.
    const gapSignature = [
      gaps.draftsUnfinished > 0,
      gaps.patchesToAttach > 0,
      gaps.sellableUnlisted > 0,
      ...gaps.profileMissing,
    ].join(',');
    const cacheKey = `${artisanId}|${language}|${promptDigest(craftType, clusterName, stage, gapSignature)}`;

    let answer = cacheRead(cacheKey);
    if (!answer) {
      if (!isGroqConfigured() && !GEMINI_CONFIGURED) {
        answer = { at: Date.now(), items: null };
      } else {
        try {
          const items = await askAi(buildPrompt({ craftType, clusterName, stage, gaps, language }), stage);
          answer = cacheWrite(cacheKey, items);
        } catch (error) {
          // A degraded AI path is expected on a free key; the catalogue answers.
          console.warn('[learning-recommendations] AI unavailable, using the catalogue:', (error as Error)?.message);
          answer = cacheWrite(cacheKey, null);
        }
      }
    }

    const built = buildTracks(answer.items ?? [], { craftType, stage, gaps, completed });
    const payload: LearningPayload = {
      success: true,
      artisanId,
      language,
      source: built.source,
      mixed: built.mixed,
      generatedAt: new Date(answer.items ? answer.at : Date.now()).toISOString(),
      craftType,
      stage: record.result,
      inputs: record.inputs,
      earnings: record.earnings,
      gaps,
      completed,
      tracks: built.tracks,
    };

    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[learning-recommendations] failed:', error);
    return NextResponse.json(
      { success: false, error: 'Could not load your learning plan right now.' },
      { status: 500 }
    );
  }
}
