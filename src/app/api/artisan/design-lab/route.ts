import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { GEMINI_CONFIGURED, generateContentWithFallback, promptDigest } from '@/lib/gemini';
import { groqChatJSON, isGroqConfigured, languageInstruction } from '@/lib/groq';
import { transcribeAudio } from '@/lib/voiceParse';
import { familiesForCraft } from '@/lib/craftFamilies';
import {
  BORDERS,
  MOTIFS,
  REPEATS,
  defaultSpec,
  renderMotifSvg,
  validateSpec,
  type MotifSpec,
} from '@/lib/motifSpec';
import { MAX_THUMB_BYTES, cleanLabNotes, type LabNotes } from '@/lib/designLab';

/**
 * The Design Lab: an artisan's words → a pattern grammar they can manipulate.
 *
 * The model never draws anything. It answers with a small structured spec —
 * which motif, which repeat, how dense, which colours — and our own pure
 * renderer turns that into SVG. Two consequences the rest of this file is built
 * around:
 *
 *   - **A malformed answer cannot break the page.** Every response goes through
 *     `validateSpec()`, which clamps each field and substitutes the nearest
 *     allowed value, so `motif: "elephant"` or `grid: 400` degrades rather than
 *     throwing.
 *   - **Nothing generated here is a photograph.** A concept is a sketch and is
 *     never written into `CraftItem.images`, `originalImageUrl`, or anything the
 *     buyer's authenticity comparison reads. The only thing a concept hands to a
 *     listing is WORDS.
 *
 * With no AI key at all the whole feature still works: `defaultSpec()` seeds a
 * spec deterministically from the artisan's own prompt, and the response says
 * `source: 'FALLBACK'` so the page can label it.
 */
export const dynamic = 'force-dynamic';

const LANGUAGES = new Set(['en', 'hi', 'or', 'te']);
const MAX_PROMPT = 400;
const MAX_TITLE = 80;
const PAGE_SIZE = 12;
const MAX_CONCEPTS = 200;
const AI_BUDGET_MS = 12_000;
const AI_TEMPERATURE = 0.4;

function lang(value: unknown): string {
  return typeof value === 'string' && LANGUAGES.has(value) ? value : 'en';
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status });
}

/** The craft's material family, which decides the fallback motif. */
function familyFor(craftType: string | null): string {
  return familiesForCraft(craftType || '')[0] ?? 'cotton-yarn';
}

async function withBudget<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('AI budget exceeded')), AI_BUDGET_MS)),
  ]);
}

/**
 * The prompt. It lists every allowed value, because a model that is told the
 * vocabulary returns one of its words far more often than one that is told to
 * be creative — and the ones that still do not are caught by `validateSpec`.
 */
function buildPrompt(prompt: string, craftType: string, language: string): string {
  return [
    'You are helping an Indian craft artisan sketch a textile or surface pattern before they cut cloth.',
    `Their craft: ${craftType || 'unspecified'}.`,
    `What they asked for, in their own words: "${prompt}"`,
    '',
    'Answer with JSON only, exactly this shape:',
    '{',
    '  "title": "a short name for this pattern, 2-5 words",',
    `  "spec": { "motif": one of ${JSON.stringify([...MOTIFS])},`,
    `            "repeat": one of ${JSON.stringify([...REPEATS])},`,
    '            "grid": whole number 2-16, "scale": 0.2-1.0, "rotation": 0-359,',
    '            "palette": 2-5 colours as "#rrggbb" strings,',
    '            "strokeWidth": 0-4,',
    `            "border": one of ${JSON.stringify([...BORDERS])},`,
    '            "background": "#rrggbb" },',
    '  "motifNotes": "one or two sentences on what the shapes are and how they sit together",',
    '  "paletteNames": ["plain colour names, one per palette colour"],',
    '  "materialNote": "one sentence on yarn, dye or surface this would suit",',
    '  "laborDaysEstimate": a whole number of days, or null if you cannot say',
    '}',
    '',
    'Rules: use ONLY the listed motif, repeat and border values. Colours must be six-digit hex.',
    'Do not name a community, a village, a registered craft or a GI tag, and do not claim the',
    'pattern is traditional or authentic — it is a starting point the artisan will change.',
    'Do not include any URL, phone number or email.',
    languageInstruction(language),
  ].join('\n');
}

interface LabResult {
  title: string;
  spec: MotifSpec;
  notes: LabNotes;
  source: 'AI' | 'FALLBACK';
}

/** Groq first, then Gemini, then the deterministic composer. Never throws. */
async function composeSpec(prompt: string, craftType: string, language: string): Promise<LabResult> {
  const body = buildPrompt(prompt, craftType, language);
  const failures: string[] = [];

  const fromRaw = (raw: Record<string, unknown>): LabResult | null => {
    const spec = validateSpec(raw.spec);
    const title = text(raw.title, MAX_TITLE);
    if (!title) return null;
    return { title, spec, notes: cleanLabNotes(raw), source: 'AI' };
  };

  if (isGroqConfigured()) {
    try {
      const raw = await withBudget(
        groqChatJSON<Record<string, unknown>>(body, {
          system: 'You are a JSON-only API. You output raw, valid JSON with no markdown.',
          temperature: AI_TEMPERATURE,
        })
      );
      const result = fromRaw(raw);
      if (result) return result;
      failures.push('Groq returned no usable title');
    } catch (error) {
      failures.push(`Groq: ${(error as Error)?.message}`);
    }
  }

  if (GEMINI_CONFIGURED) {
    try {
      const answer = await withBudget(
        generateContentWithFallback(
          [{ text: body }],
          { responseMimeType: 'application/json', temperature: AI_TEMPERATURE, thinkingConfig: { thinkingBudget: 0 } },
          { cacheKey: promptDigest('design-lab', body) }
        )
      );
      const raw = JSON.parse(((answer as { text?: string })?.text || '{}').trim()) as Record<string, unknown>;
      const result = fromRaw(raw);
      if (result) return result;
      failures.push('Gemini returned no usable title');
    } catch (error) {
      failures.push(`Gemini: ${(error as Error)?.message}`);
    }
  }

  if (failures.length) console.warn('[design-lab] falling back:', failures.join(' | '));

  // The deterministic composer. Same words always give the same cloth, which is
  // what makes this a tool rather than a dice roll.
  return {
    title: '',
    spec: defaultSpec(familyFor(craftType), prompt),
    notes: { motifNotes: '', paletteNames: [], materialNote: '', laborDaysEstimate: null },
    source: 'FALLBACK',
  };
}

/** The stored shape, with the spec re-validated on the way out. */
function toConcept(row: {
  id: string;
  prompt: string;
  promptLanguage: string | null;
  title: string;
  spec: unknown;
  source: string;
  svgThumb: string | null;
  usedForItemId: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    prompt: row.prompt,
    promptLanguage: row.promptLanguage,
    title: row.title,
    spec: validateSpec(row.spec),
    source: row.source === 'FALLBACK' ? 'FALLBACK' : 'AI',
    svgThumb: row.svgThumb,
    usedForItemId: row.usedForItemId,
    createdAt: row.createdAt.toISOString(),
  };
}

const CONCEPT_FIELDS = {
  id: true,
  prompt: true,
  promptLanguage: true,
  title: true,
  spec: true,
  source: true,
  svgThumb: true,
  usedForItemId: true,
  createdAt: true,
} as const;

/**
 * Render the thumbnail here rather than trusting one from the client: the
 * column must only ever hold a string our own renderer produced.
 */
function thumbFor(spec: MotifSpec): string | null {
  const svg = renderMotifSvg(spec, 240);
  return Buffer.byteLength(svg, 'utf8') <= MAX_THUMB_BYTES ? svg : null;
}

/**
 * A validated spec as Prisma's `Json` input.
 *
 * `MotifSpec` is a closed interface, which Prisma's `InputJsonObject` (an index
 * signature) will not accept directly. Spreading it produces the same fields as
 * a plain object; nothing is added, removed or re-ordered, and the value has
 * already been through `validateSpec()`.
 */
function specAsJson(spec: MotifSpec): Prisma.InputJsonObject {
  return { ...spec } as unknown as Prisma.InputJsonObject;
}

// --------------------------------------------------------------------- POST

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    let prompt = '';
    let language = 'en';
    let craftType = '';

    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      // The recorded-clip path, for Odia and for browsers with no recognizer —
      // the same `transcribeAudio()` the capture flow uses.
      const form = await req.formData();
      language = lang(form.get('language'));
      craftType = text(form.get('craftType'), 80);
      const file = form.get('file');
      if (file instanceof Blob) {
        prompt = text(await transcribeAudio(file, language), MAX_PROMPT);
      }
      if (!prompt) prompt = text(form.get('prompt'), MAX_PROMPT);
    } else {
      const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      prompt = text(raw.prompt, MAX_PROMPT);
      language = lang(raw.language);
      craftType = text(raw.craftType, 80);
    }

    if (!craftType) {
      const profile = await prisma.artisanProfile.findUnique({
        where: { userId: artisanId },
        select: { craftType: true },
      });
      craftType = text(profile?.craftType, 80);
    }

    // An empty prompt still gets cloth — the composer seeds from the craft
    // family alone — and the page says more detail would do better.
    const result = await composeSpec(prompt, craftType, language);

    return NextResponse.json({
      success: true,
      prompt,
      language,
      craftType,
      title: result.title,
      spec: result.spec,
      notes: result.notes,
      source: result.source,
      /** True when there was too little to work from; the page says so. */
      thin: prompt.split(' ').filter(Boolean).length < 2,
    });
  } catch (error) {
    console.error('[design-lab] compose failed:', error);
    return fail(500, 'COMPOSE_FAILED', 'Could not sketch that. Try describing it again.');
  }
}

// ---------------------------------------------------------------------- GET

export async function GET(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const params = new URL(req.url).searchParams;
    const id = params.get('id');

    if (id) {
      const row = await prisma.designConcept.findFirst({
        where: { id, artisanId },
        select: CONCEPT_FIELDS,
      });
      if (!row) return fail(404, 'NOT_FOUND', 'That concept is not yours, or no longer exists.');
      return NextResponse.json({ success: true, concept: toConcept(row) });
    }

    const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
    const [rows, total] = await Promise.all([
      prisma.designConcept.findMany({
        where: { artisanId },
        orderBy: { createdAt: 'desc' },
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        select: CONCEPT_FIELDS,
      }),
      prisma.designConcept.count({ where: { artisanId } }),
    ]);

    return NextResponse.json({
      success: true,
      concepts: rows.map(toConcept),
      page,
      pageSize: PAGE_SIZE,
      total,
      hasMore: (page + 1) * PAGE_SIZE < total,
    });
  } catch (error) {
    console.error('[design-lab] list failed:', error);
    return fail(500, 'LIST_FAILED', 'Could not load your concepts.');
  }
}

// -------------------------------------------------------------------- PATCH
// Creates a concept when no id is given, updates one when there is.

export async function PATCH(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : null;
    const spec = raw.spec === undefined ? null : validateSpec(raw.spec);
    const title = text(raw.title, MAX_TITLE);

    if (id) {
      const existing = await prisma.designConcept.findFirst({
        where: { id, artisanId },
        select: { id: true, spec: true },
      });
      if (!existing) return fail(404, 'NOT_FOUND', 'That concept is not yours, or no longer exists.');

      const nextSpec = spec ?? validateSpec(existing.spec);
      const thumb = thumbFor(nextSpec);
      const usedForItemId = text(raw.usedForItemId, 64);

      const row = await prisma.designConcept.update({
        where: { id },
        data: {
          ...(spec ? { spec: specAsJson(nextSpec), svgThumb: thumb } : {}),
          ...(title ? { title } : {}),
          ...(usedForItemId ? { usedForItemId } : {}),
        },
        select: CONCEPT_FIELDS,
      });
      return NextResponse.json({ success: true, concept: toConcept(row) });
    }

    // A new concept. Deliberately capped: a runaway client cannot fill the
    // table, and the artisan is told rather than silently losing a save.
    const held = await prisma.designConcept.count({ where: { artisanId } });
    if (held >= MAX_CONCEPTS) {
      return fail(409, 'TOO_MANY', 'You have reached the saved-concept limit. Delete one to save another.');
    }

    if (!spec) return fail(400, 'NO_SPEC', 'Nothing to save.');
    const row = await prisma.designConcept.create({
      data: {
        artisanId,
        prompt: text(raw.prompt, MAX_PROMPT),
        promptLanguage: lang(raw.language),
        title: title || 'Untitled pattern',
        spec: specAsJson(spec),
        source: raw.source === 'FALLBACK' ? 'FALLBACK' : 'AI',
        svgThumb: thumbFor(spec),
      },
      select: CONCEPT_FIELDS,
    });
    return NextResponse.json({ success: true, concept: toConcept(row) }, { status: 201 });
  } catch (error) {
    console.error('[design-lab] save failed:', error);
    return fail(500, 'SAVE_FAILED', 'Could not save that concept.');
  }
}

// ------------------------------------------------------------------- DELETE

export async function DELETE(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return fail(400, 'NO_ID', 'Nothing to delete.');
    // Owner only, enforced in the predicate rather than after a read.
    const removed = await prisma.designConcept.deleteMany({ where: { id, artisanId } });
    if (removed.count === 0) return fail(404, 'NOT_FOUND', 'That concept is not yours, or no longer exists.');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[design-lab] delete failed:', error);
    return fail(500, 'DELETE_FAILED', 'Could not delete that concept.');
  }
}
