import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { GEMINI_CONFIGURED, generateContentWithFallback, promptDigest } from '@/lib/gemini';
import { groqChatJSON, isGroqConfigured, languageInstruction } from '@/lib/groq';
import {
  briefIsUsable,
  curatedToolingFor,
  normaliseToolingBrief,
  toolingFamilyFor,
  toolingKeys,
  type ToolingBrief,
} from '@/lib/toolingGuide';

/**
 * GET /api/artisan/tooling?lang=hi
 *
 * Repair and tooling help: who in the artisan's own cluster is already asking
 * for what, plus a brief on what usually breaks and what to ask about it.
 *
 * The one thing this route will not do is name a repair shop. There is no
 * verified directory of loom mechanics or kiln builders to draw on, so the
 * "who" is answered by the cluster — real people the artisan can reach — and
 * every AI field is passed through `stripContactDetails` before it leaves the
 * server, so a model that volunteers a phone number anyway cannot put it on
 * screen.
 */
export const dynamic = 'force-dynamic';

const LANGUAGES = new Set(['en', 'hi', 'or', 'te']);

/** A good brief is reused for a day; a failed call is not retried for 10 minutes. */
const AI_TTL_MS = 24 * 60 * 60 * 1000;
const AI_FAILURE_TTL_MS = 10 * 60 * 1000;
const AI_BUDGET_MS = 15_000;
const AI_CACHE_MAX = 300;
const AI_TEMPERATURE = 0.3;

/** Open requests in the cluster that read as a tool or repair need. */
const TOOLING_TERMS = [
  'repair', 'fix', 'mend', 'service', 'spare', 'part', 'tool', 'loom', 'reed', 'heddle', 'shuttle',
  'wheel', 'kiln', 'furnace', 'lathe', 'chisel', 'anvil', 'hammer', 'blade', 'motor', 'belt',
  'needle', 'frame', 'vat', 'block', 'brush', 'machine', 'sharpen', 'welding',
];
const MAX_CLUSTER_REQUESTS = 8;

interface CachedBrief {
  at: number;
  brief: ToolingBrief | null;
}
const briefCache = new Map<string, CachedBrief>();

function cacheRead(key: string): CachedBrief | null {
  const hit = briefCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > (hit.brief ? AI_TTL_MS : AI_FAILURE_TTL_MS)) {
    briefCache.delete(key);
    return null;
  }
  return hit;
}

function cacheWrite(key: string, brief: ToolingBrief | null): CachedBrief {
  if (briefCache.size >= AI_CACHE_MAX) {
    const oldest = briefCache.keys().next().value;
    if (oldest !== undefined) briefCache.delete(oldest);
  }
  const entry = { at: Date.now(), brief };
  briefCache.set(key, entry);
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

function buildPrompt(craftType: string | null, location: string | null, language: string): string {
  return `An Indian artisan's own equipment has broken and they need to get it repaired locally.

ARTISAN
- Craft: ${craftType ? `"${craftType}"` : 'not set (answer for a general handicraft workshop)'}
- Area: ${location ? `"${location}"` : 'not set'}

Describe what commonly fails on the equipment THIS craft uses, what those parts are called locally,
and what to ask before agreeing a repair.

RULES — these are enforced after your answer and a breach is deleted, not shown:
- NEVER give a shop name, a person's name, a phone number, an address, an email or a website. Not one.
- "whoFixesIt" must be a TRADE, e.g. "the loom mechanic who serves the weaver street", never a name.
- Give "typicalCostBand" ONLY if you can state the basis for it in "note" (what the range covers and
  where it applies). If you cannot, set "typicalCostBand" to null. An invented price costs the artisan money.
- Do not promise a government scheme, a subsidy or a timeline.

${languageInstruction(language)}

Return strict JSON:
{
  "commonFaults": [{ "part": "", "symptom": "", "whoFixesIt": "" }],
  "localTerms": [""],
  "questionsToAsk": [""],
  "typicalCostBand": { "low": 0, "high": 0, "note": "" }
}`;
}

async function askAi(prompt: string): Promise<ToolingBrief> {
  const failures: string[] = [];

  if (isGroqConfigured()) {
    try {
      const raw = await withBudget(
        groqChatJSON<Record<string, unknown>>(prompt, {
          system: 'You are a JSON-only API. You output raw, valid JSON with no markdown.',
          temperature: AI_TEMPERATURE,
        })
      );
      const brief = normaliseToolingBrief(raw);
      if (briefIsUsable(brief)) return brief;
      failures.push('Groq returned nothing usable');
    } catch (error) {
      failures.push(`Groq: ${(error as Error)?.message}`);
    }
  }

  if (GEMINI_CONFIGURED) {
    try {
      const result = await withBudget(
        generateContentWithFallback(
          [{ text: prompt }],
          { responseMimeType: 'application/json', temperature: AI_TEMPERATURE, thinkingConfig: { thinkingBudget: 0 } },
          { cacheKey: promptDigest('tooling-brief', prompt) }
        )
      );
      const brief = normaliseToolingBrief(JSON.parse(((result as { text?: string })?.text || '{}').trim()));
      if (briefIsUsable(brief)) return brief;
      failures.push('Gemini returned nothing usable');
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
    const profile = await prisma.artisanProfile.findUnique({
      where: { userId: artisanId },
      select: { craftType: true, location: true, shgGroupLink: true },
    });

    const shg = profile?.shgGroupLink?.trim() || null;
    const location = profile?.location?.trim() || null;
    // The one cluster rule this app has (src/lib — used by the cluster page and
    // by resource requests). Restating it differently here would split clusters
    // in two.
    const clusterKey = shg ? shg : location ? `auto:${location.toLowerCase()}` : null;

    const [clusterRequests, memberCount] = await Promise.all([
      clusterKey
        ? prisma.resourceRequest.findMany({
            where: {
              clusterName: clusterKey,
              status: 'OPEN',
              OR: TOOLING_TERMS.map((term) => ({ resourceName: { contains: term, mode: 'insensitive' as const } })),
            },
            orderBy: { createdAt: 'desc' },
            take: MAX_CLUSTER_REQUESTS,
            select: {
              id: true,
              resourceName: true,
              description: true,
              quantity: true,
              createdAt: true,
              requesterId: true,
              requester: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      clusterKey
        ? prisma.artisanProfile.count({
            where: shg
              ? { shgGroupLink: shg, NOT: { userId: artisanId } }
              : { shgGroupLink: null, location: profile?.location, NOT: { userId: artisanId } },
          })
        : Promise.resolve(0),
    ]);

    const craftType = profile?.craftType?.trim() || null;
    const cacheKey = `${language}|${promptDigest('tooling', craftType, location)}`;
    let answer = cacheRead(cacheKey);
    if (!answer) {
      if (!isGroqConfigured() && !GEMINI_CONFIGURED) {
        answer = { at: Date.now(), brief: null };
      } else {
        try {
          answer = cacheWrite(cacheKey, await askAi(buildPrompt(craftType, location, language)));
        } catch (error) {
          console.warn('[tooling] AI unavailable, using the curated guide:', (error as Error)?.message);
          answer = cacheWrite(cacheKey, null);
        }
      }
    }

    const curated = curatedToolingFor(craftType).map((entry) => ({ ...entry, ...toolingKeys(entry) }));

    return NextResponse.json(
      {
        success: true,
        source: answer.brief ? 'AI' : 'CURATED',
        generatedAt: new Date(answer.brief ? answer.at : Date.now()).toISOString(),
        craftType,
        family: toolingFamilyFor(craftType),
        cluster: clusterKey ? { key: clusterKey, named: Boolean(shg), memberCount } : null,
        requests: clusterRequests.map((row) => ({
          id: row.id,
          resourceName: row.resourceName,
          description: row.description,
          quantity: row.quantity,
          createdAt: row.createdAt.toISOString(),
          // First name only: the cluster board already shows who, and this is a
          // list of needs, not a directory of people.
          requesterName: (row.requester?.name ?? '').split(' ')[0] || null,
          mine: row.requesterId === artisanId,
        })),
        brief: answer.brief,
        curated,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.error('[tooling] failed:', error);
    return NextResponse.json({ success: false, error: 'Could not load repair help right now.' }, { status: 500 });
  }
}
