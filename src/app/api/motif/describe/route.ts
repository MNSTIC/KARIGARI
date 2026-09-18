import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { GEMINI_CONFIGURED, generateContentWithFallback } from '@/lib/gemini';
import { normaliseDescriptors, type DescriptorSource } from '@/lib/motifLicence';

/**
 * POST /api/motif/describe — what a model sees in a motif crop.
 *
 * Optional, and labelled. When Gemini answers, the record carries
 * `source: 'AI'` and whatever confidence the model itself stated. When there is
 * no key, no answer or a timeout, this returns nothing and the page falls back
 * to a colour histogram it computed in the browser, which is stored as
 * `source: 'HEURISTIC'`.
 *
 * The distinction is the point: a k-bucket histogram is arithmetic, and
 * presenting it as a model's reading would be a lie about where the description
 * came from. Nor does a heuristic ever carry a confidence figure — there is no
 * confidence to report about counting pixels.
 *
 * The prompt forbids the claims this whole feature is careful about. Anything
 * that comes back saying them is dropped by `normaliseDescriptors` anyway, which
 * is the guard that actually holds.
 */
export const dynamic = 'force-dynamic';

/**
 * A vision call on a small crop, with room for a cold route to compile. The
 * page never waits on this to register — a reading that does not arrive becomes
 * the browser's own colour histogram, labelled as one.
 */
const AI_BUDGET_MS = 20_000;
const MAX_IMAGE_BYTES = 400 * 1024;

const PROMPT = [
  'Describe the repeating pattern in this craft photograph, for a register of village motifs.',
  '',
  'Answer with JSON only:',
  '{ "motifs": ["the shapes you can see, 1-5 short terms"],',
  '  "symmetry": "one sentence on how the pattern repeats about an axis",',
  '  "repeatUnit": "one sentence on what a single tile of the repeat contains",',
  '  "palette": ["#rrggbb", "…"],',
  '  "confidence": 0-1 }',
  '',
  'Describe only what is visible. Do NOT name a community, village, caste or registered craft.',
  'Do NOT say the pattern is traditional, authentic, certified, trademarked, patented, copyrighted,',
  'GI-tagged, legally protected or on a blockchain — none of those is something this record grants.',
].join('\n');

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const image = typeof body.referenceImageUrl === 'string' ? body.referenceImageUrl : '';
    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);

    if (!match || image.length > MAX_IMAGE_BYTES) {
      return NextResponse.json({ success: true, descriptors: null, source: null, reason: 'NO_IMAGE' });
    }
    if (!GEMINI_CONFIGURED) {
      // Not an error: the page has its own histogram and says so.
      return NextResponse.json({ success: true, descriptors: null, source: null, reason: 'NO_KEY' });
    }

    const answer = await Promise.race([
      generateContentWithFallback(
        [{ text: PROMPT }, { inlineData: { data: match[2], mimeType: match[1] } }],
        { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } }
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI budget exceeded')), AI_BUDGET_MS)),
    ]);

    const raw = JSON.parse(((answer as { text?: string })?.text || '{}').trim()) as Record<string, unknown>;
    const source: DescriptorSource = 'AI';
    const descriptors = normaliseDescriptors(raw, source);

    return NextResponse.json({ success: true, descriptors, source });
  } catch (error) {
    console.warn('[motif/describe] unavailable:', (error as Error)?.message);
    // A failed reading is not a failed registration: answer 200 with nothing,
    // and let the page register with its own histogram instead.
    return NextResponse.json({ success: true, descriptors: null, source: null, reason: 'AI_FAILED' });
  }
}
