/**
 * The words that ride alongside a Design Lab concept.
 *
 * Pure: no Prisma, no React. The spec and the drawing live in
 * src/lib/motifSpec.ts; this file is only about the model's prose, and it
 * exists so that prose is cleaned in one place with one set of rules.
 *
 * What gets removed, and why:
 *   - **Contact details and links.** A pattern note has no business carrying a
 *     phone number or a shop URL, and a model that volunteers one must not be
 *     able to put it on screen.
 *   - **Claims of authenticity or ownership.** The app never says a generated
 *     pattern is a community's traditional motif, is GI-tagged, or is
 *     "authentic". A sentence that says so is dropped whole rather than edited
 *     into something that still implies it.
 *   - **Control characters and runaway length**, so a note cannot break the
 *     layout or hide text in the middle of a line.
 */

export interface LabNotes {
  motifNotes: string;
  paletteNames: string[];
  materialNote: string;
  /** Whole days, or null when the model would not say. */
  laborDaysEstimate: number | null;
}

export const MAX_NOTE = 240;
export const MAX_PALETTE_NAME = 28;
export const MAX_PALETTE_NAMES = 6;
/** Beyond this a "days of work" figure is not an estimate, it is a guess. */
export const MAX_LABOR_DAYS = 180;

/**
 * The `DesignConcept.svgThumb` ceiling, in bytes of UTF-8.
 *
 * It lives here rather than in the route because a Next.js route module may
 * only export its handlers and its route config — anything else fails the
 * build's own type check on the generated route types.
 */
export const MAX_THUMB_BYTES = 40_000;

/**
 * Sentences that claim the pattern belongs to someone, or is the real
 * traditional thing. The whole sentence goes; softening it would leave the
 * claim standing in a quieter voice.
 */
const CLAIM_PATTERNS = [
  /\bauthentic\b/i,
  /\btraditional(ly)?\b/i,
  /\bGI[- ]?tag/i,
  /\bgeographical indication\b/i,
  /\bheritage of\b/i,
  /\bsacred\b/i,
  /\bbelongs? to the\b/i,
  /\bancestral\b/i,
  /\bcenturies[- ]old\b/i,
  /\b(community|tribe|caste|village)\b/i,
];

/** Anything that looks like a way to reach somebody. */
export function stripContacts(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/gi, ' ')
    .replace(/\b[a-z0-9-]+\.(com|in|org|net|co|shop|store)\b/gi, ' ')
    .replace(/(?:\+?\d[\d\s-]{5,}\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trim, collapse, strip control and bidi characters, cap by code points. */
export function cleanNote(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const stripped = [...value]
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp < 32) return false;
      if (cp >= 127 && cp < 160) return false;
      // Bidi overrides and isolates, which can reverse what a line reads as.
      if (cp >= 0x202a && cp <= 0x202e) return false;
      if (cp >= 0x2066 && cp <= 0x2069) return false;
      return true;
    })
    .join('');
  const clean = stripContacts(stripped);
  return [...clean].slice(0, max).join('').trim();
}

/** Drop any sentence that claims the pattern is authentic or belongs to a group. */
export function dropClaims(value: string): string {
  const sentences = value.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => !CLAIM_PATTERNS.some((rule) => rule.test(sentence)));
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

function labourDays(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const whole = Math.round(n);
  return whole >= 1 && whole <= MAX_LABOR_DAYS ? whole : null;
}

/** Everything a model said about a concept, reduced to what may be shown. */
export function cleanLabNotes(raw: unknown): LabNotes {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

  const names: string[] = [];
  if (Array.isArray(input.paletteNames)) {
    for (const entry of input.paletteNames) {
      const name = dropClaims(cleanNote(entry, MAX_PALETTE_NAME));
      if (name && !names.includes(name)) names.push(name);
      if (names.length === MAX_PALETTE_NAMES) break;
    }
  }

  return {
    motifNotes: dropClaims(cleanNote(input.motifNotes, MAX_NOTE)),
    paletteNames: names,
    materialNote: dropClaims(cleanNote(input.materialNote, MAX_NOTE)),
    laborDaysEstimate: labourDays(input.laborDaysEstimate),
  };
}

/** True when there is anything worth rendering a notes panel for. */
export function notesAreUsable(notes: LabNotes): boolean {
  return Boolean(
    notes.motifNotes || notes.materialNote || notes.paletteNames.length || notes.laborDaysEstimate !== null
  );
}
