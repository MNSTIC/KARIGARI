import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getListingPrice } from '@/lib/pricing';
import {
  GEMINI_CONFIGURED,
  classifyGeminiError,
  generateContentWithFallback,
} from '@/lib/gemini';

/**
 * Find real listed stock for one buyer demand.
 *
 * The buyer board used to "match" with a 1.5s `setTimeout` and then quote the
 * demand's own `targetPriceMax` back at the buyer — so the artisan was
 * invented and the price was just the buyer's own ceiling echoed. This returns
 * actual `CraftItem` rows that are on the marketplace, with the artisan who
 * made them and the price they are genuinely listed at.
 *
 * Ranking is layered, and every layer is optional:
 *
 *   1. craft keywords        — always
 *   2. material and colour   — when the buyer supplied them
 *   3. Gemini vision         — when the buyer attached a reference photo AND a
 *                              key is configured
 *
 * Each layer only ever *refines* the order. If Gemini is unconfigured, rate
 * limited or errors, the route returns the keyword+material+colour ranking and
 * says so in `scoredBy`; it never fails the request and never invents a score.
 *
 * Public: the demand board is a shopfront and needs no account, same as
 * `/api/items/market`.
 */
export const dynamic = 'force-dynamic';

/**
 * Give the model a bounded slice of time; the board must stay responsive.
 *
 * Deliberately short. The text ranking is already computed and good, so waiting
 * longer only ever buys a refinement — and on a rate-limited key the wait is
 * spent on a request that was never going to answer. Twelve seconds is long
 * enough for a fast multimodal reply and short enough that a buyer who hits the
 * daily quota does not sit staring at a spinner.
 */
const VISION_TIMEOUT_MS = 12_000;
/**
 * Ranking a long list by image would be slow and pointless — and every extra
 * candidate is another ~250 KB of base64 on the request, which is what pushed
 * the first version past its own timeout.
 */
const VISION_CANDIDATES = 3;

/**
 * Latency-first model order, the same reasoning as the insights route: the
 * shared fallback list leads with gemini-3.7-flash, which is the slowest to
 * first token and pushes a multi-image request past the deadline.
 */
const VISION_MODELS = ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite'];

/**
 * Craft names rarely match a demand string exactly — a demand for
 * "Sambalpuri Ikat Silk Saree" should still find "Sambalpuri Cotton Saree —
 * Pasapali Check". Matching on the significant words finds those; requiring the
 * whole phrase would return nothing for almost every demand.
 */
const STOPWORDS = new Set([
  'and', 'the', 'with', 'for', 'set', 'of', 'pair', 'inch', 'piece', 'work',
]);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

/** Everything about an item a text match can legitimately read. */
function haystack(row: {
  craftType: string;
  tags: string[];
  descriptionEnglish: string | null;
  aiSuggestedCategory: string | null;
}): string {
  return [row.craftType, row.aiSuggestedCategory ?? '', row.descriptionEnglish ?? '', ...row.tags]
    .join(' ')
    .toLowerCase();
}

/**
 * A 0–1 text score: how much of what the buyer asked for this item actually
 * mentions. Craft is weighted heaviest because it is the only field that is
 * always present; material and colour refine within that.
 */
function textScore(
  hay: string,
  craftTerms: string[],
  materialTerms: string[],
  colorTerms: string[]
): number {
  const hit = (terms: string[]) =>
    terms.length === 0 ? null : terms.filter((term) => hay.includes(term)).length / terms.length;

  const craft = hit(craftTerms) ?? 0;
  const material = hit(materialTerms);
  const color = hit(colorTerms);

  // Weights renormalise over the dimensions the buyer actually filled in, so a
  // demand with no material specified is not penalised for it.
  let total = craft * 0.6;
  let weight = 0.6;
  if (material !== null) {
    total += material * 0.25;
    weight += 0.25;
  }
  if (color !== null) {
    total += color * 0.15;
    weight += 0.15;
  }
  return weight > 0 ? total / weight : 0;
}

interface VisionScore {
  id: string;
  similarity: number;
}

/** Distinguishes "we gave up waiting" from "the model said no". */
class VisionTimeout extends Error {
  constructor() {
    super('vision-timeout');
    this.name = 'VisionTimeout';
  }
}

interface InlineImage {
  data: string;
  mimeType: string;
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Turn a stored image reference into something the model can actually see.
 *
 * Craft photos in this app come in two shapes: a `data:` URL from a phone
 * capture, and a `/seed/...` path for the seeded catalogue. Handling only the
 * first meant every seeded item was invisible to the vision pass and the whole
 * feature silently fell back to text — the worst kind of failure, because it
 * still returns a sensible-looking answer.
 *
 * Returns null rather than throwing: an unreadable image is one fewer
 * candidate, never a failed request.
 */
async function inlineImage(src: string | null): Promise<InlineImage | null> {
  if (!src) return null;

  if (src.startsWith('data:image')) {
    const [meta, data] = src.split(',');
    if (!data) return null;
    return { data, mimeType: meta.match(/^data:([^;]+)/)?.[1] || 'image/jpeg' };
  }

  // Public assets only, and no traversal out of it.
  if (!src.startsWith('/') || src.includes('..')) return null;
  const mimeType = MIME_BY_EXT[path.extname(src).toLowerCase()];
  if (!mimeType) return null;

  try {
    const file = await readFile(path.join(process.cwd(), 'public', src));
    // Big enough for a similarity judgement, small enough to keep the request sane.
    if (file.byteLength > 4 * 1024 * 1024) return null;
    return { data: file.toString('base64'), mimeType };
  } catch {
    return null;
  }
}

/**
 * Ask the model how close each shortlisted craft looks to the buyer's
 * reference. Returns null on any failure — the caller then keeps the text
 * ranking rather than showing a made-up number.
 */
async function scoreByReference(
  referenceImageUrl: string,
  candidates: { id: string; craftType: string; image: string | null }[]
): Promise<VisionScore[] | null> {
  if (!GEMINI_CONFIGURED) return null;

  const reference = await inlineImage(referenceImageUrl);
  if (!reference) return null;

  const resolved = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      image: await inlineImage(candidate.image),
    }))
  );
  const withImages = resolved.filter(
    (entry): entry is { candidate: (typeof candidates)[number]; image: InlineImage } =>
      entry.image !== null
  );
  if (withImages.length === 0) return null;

  const parts: Record<string, unknown>[] = [
    {
      text:
        'The FIRST image is a reference photo from a buyer. Each image after it is a craft ' +
        'listed by an artisan, given in the same order as the ids below.\n' +
        `Ids in order: ${withImages.map((entry) => entry.candidate.id).join(', ')}\n` +
        'For every listed craft, judge how visually similar it is to the buyer reference — ' +
        'form, material, motif and colour. Return a similarity from 0 to 1 for each id. ' +
        'Do not invent ids and do not omit any.',
    },
    { inlineData: { data: reference.data, mimeType: reference.mimeType } },
  ];

  for (const entry of withImages) {
    parts.push({ inlineData: { data: entry.image.data, mimeType: entry.image.mimeType } });
  }

  try {
    const raw = await Promise.race([
      generateContentWithFallback(parts, {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            scores: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  id: { type: 'STRING' },
                  similarity: { type: 'NUMBER' },
                },
                required: ['id', 'similarity'],
              },
            },
          },
          required: ['scores'],
        },
      }, VISION_MODELS),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new VisionTimeout()), VISION_TIMEOUT_MS)
      ),
    ]);

    const text = typeof raw === 'string' ? raw : (raw as { text?: string })?.text;
    if (!text) return null;

    const parsed = JSON.parse(text) as { scores?: { id?: string; similarity?: number }[] };
    const allowed = new Set(withImages.map((entry) => entry.candidate.id));
    const scores = (parsed.scores ?? [])
      .filter((s): s is { id: string; similarity: number } =>
        typeof s?.id === 'string' && allowed.has(s.id) && Number.isFinite(s?.similarity)
      )
      .map((s) => ({ id: s.id, similarity: Math.max(0, Math.min(1, s.similarity)) }));

    return scores.length > 0 ? scores : null;
  } catch (error) {
    // Deliberately non-fatal. The reason is logged plainly so a silent fallback
    // to text ranking is never mistaken for the vision pass having run.
    console.warn(
      'Demand vision match unavailable:',
      error instanceof VisionTimeout ? 'timeout' : classifyGeminiError(error)
    );
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const demandId = url.searchParams.get('demandId');
    if (!demandId) {
      return NextResponse.json({ error: 'demandId is required' }, { status: 400 });
    }

    const demand = await prisma.demand.findUnique({
      where: { id: demandId },
      select: {
        id: true,
        craftType: true,
        quantity: true,
        location: true,
        material: true,
        color: true,
        description: true,
        referenceImageUrl: true,
      },
    });
    if (!demand) {
      return NextResponse.json({ error: 'Demand not found' }, { status: 404 });
    }

    const craftTerms = keywords(demand.craftType);
    const materialTerms = keywords(demand.material ?? '');
    const colorTerms = keywords(demand.color ?? '');
    // Free-text specifics widen the net without being allowed to dominate it.
    const detailTerms = keywords(demand.description ?? '').slice(0, 6);
    const searchTerms = [...new Set([...craftTerms, ...materialTerms, ...detailTerms])];

    const rows = await prisma.craftItem.findMany({
      where: {
        isListedOnMarketplace: true,
        ...(searchTerms.length
          ? {
              OR: searchTerms.flatMap((term) => [
                { craftType: { contains: term, mode: 'insensitive' as const } },
                { descriptionEnglish: { contains: term, mode: 'insensitive' as const } },
                { tags: { has: term } },
              ]),
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      // A wider read than the six that ship, so ranking has something to sort.
      take: 24,
      select: {
        id: true,
        craftType: true,
        patchId: true,
        images: true,
        tags: true,
        descriptionEnglish: true,
        aiSuggestedCategory: true,
        askingPrice: true,
        salePrice: true,
        standardMarketPrice: true,
        fairWageFloor: true,
        artisan: {
          select: {
            name: true,
            artisanProfile: {
              select: { clusterName: true, location: true, photoUrl: true, experienceYears: true },
            },
          },
        },
      },
    });

    const priced = rows
      .map((row) => {
        const price = row.salePrice ?? getListingPrice(row);
        // An item with no resolvable price cannot be quoted honestly.
        if (price === null) return null;
        return {
          row,
          price: Math.round(price),
          score: textScore(haystack(row), craftTerms, materialTerms, colorTerms),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.score - a.score);

    let scoredBy: 'text' | 'reference' = 'text';
    const visionById = new Map<string, number>();

    if (demand.referenceImageUrl) {
      const vision = await scoreByReference(
        demand.referenceImageUrl,
        priced.slice(0, VISION_CANDIDATES).map((entry) => ({
          id: entry.row.id,
          craftType: entry.row.craftType,
          image: entry.row.images?.[0] ?? null,
        }))
      );
      if (vision) {
        scoredBy = 'reference';
        for (const score of vision) visionById.set(score.id, score.similarity);
      }
    }

    const ranked = priced
      .map((entry) => {
        const visual = visionById.get(entry.row.id);
        // Half text, half picture when there is a picture to go on; otherwise
        // the text score stands alone rather than being diluted by a zero.
        const combined = visual === undefined ? entry.score : entry.score * 0.5 + visual * 0.5;
        return { ...entry, matchScore: Number(combined.toFixed(3)) };
      })
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 6);

    // Record the best confidence on the demand so the buyer board and the
    // artisan's view agree on one number. Never fatal.
    if (ranked.length > 0) {
      prisma.demand
        .update({ where: { id: demand.id }, data: { matchScore: ranked[0].matchScore } })
        .catch((e) => console.warn('Could not store matchScore:', (e as Error)?.message));
    }

    const matches = ranked.map(({ row, price, matchScore }) => ({
      id: row.id,
      craftType: row.craftType,
      patchId: row.patchId,
      image: row.images?.[0] ?? null,
      price,
      fairWageFloor: row.fairWageFloor,
      matchScore,
      artisanName: row.artisan.name,
      clusterName: row.artisan.artisanProfile?.clusterName ?? null,
      location: row.artisan.artisanProfile?.location ?? null,
      photoUrl: row.artisan.artisanProfile?.photoUrl ?? null,
      experienceYears: row.artisan.artisanProfile?.experienceYears ?? null,
    }));

    return NextResponse.json({
      success: true,
      demandId: demand.id,
      craftType: demand.craftType,
      quantity: demand.quantity,
      /** 'reference' when a vision pass actually ran; 'text' otherwise. */
      scoredBy,
      matches,
    });
  } catch (error) {
    console.error('Demand match error:', error);
    return NextResponse.json({ error: 'Failed to find matches' }, { status: 500 });
  }
}
