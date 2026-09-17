import {
  LEARNING_TRACKS,
  MIN_TRACK_ITEMS,
  TRACK_SIZE,
  curatedTrack,
  type CuratedContext,
  type CuratedLearningItem,
  type LearningGaps,
  type LearningTrack,
} from '@/lib/learningCatalog';
import {
  LEARNING_LEVELS,
  LEVEL_FOR_STAGE,
  type LearningLevel,
  type SkillStage,
  type StageEarnings,
  type StageInputs,
  type StageResult,
} from '@/lib/skillStage';

/**
 * Turning an AI answer (or no answer) into the three learning tracks.
 *
 * Pure and client-safe. The route runs `normaliseAiItems` + `buildTracks` on the
 * server; the page runs `buildTracks` with no AI items when it has neither a
 * network nor a saved copy.
 *
 * The AI is asked for a title, a reason and a YouTube search phrase — nothing
 * else — and anything that looks like a link is stripped from all three before
 * they reach the phone. The card only ever links to a search results page built
 * here, so a hallucinated video can never become a dead embed.
 */

/** A suggestion the AI wrote, in the language the artisan asked in. */
export interface AiLearningItem {
  source: 'AI';
  key: string;
  track: LearningTrack;
  level: LearningLevel;
  title: string;
  whyItHelps: string;
  searchQuery: string;
}

export type LearningItem = CuratedLearningItem | AiLearningItem;
export type LearningTracks = Record<LearningTrack, LearningItem[]>;
export type LearningSource = 'AI' | 'CURATED';

/** What GET /api/artisan/learning-recommendations returns, and what the phone saves. */
export interface LearningPayload {
  success: true;
  /** Which artisan this belongs to, so a saved copy is never shown to another. */
  artisanId: string;
  language: string;
  /** AI when any card came from the AI; CURATED when every card is catalogue. */
  source: LearningSource;
  /** True when an AI answer was padded with catalogue cards. */
  mixed: boolean;
  /** When the suggestions were generated — the AI call, or this request for curated. */
  generatedAt: string;
  craftType: string | null;
  stage: StageResult;
  inputs: StageInputs;
  earnings: StageEarnings;
  gaps: LearningGaps;
  /** Module keys the artisan marked done. */
  completed: string[];
  tracks: LearningTracks;
}

export const MAX_SEARCH_QUERY_LENGTH = 120;
export const MAX_TITLE_LENGTH = 100;
export const MAX_WHY_LENGTH = 220;

/** `track:slug` — lower-case letters, digits and hyphens after a known track. */
export const MODULE_KEY_PATTERN = /^(business|design|digital):[a-z0-9-]{1,48}$/;

export function isModuleKey(value: unknown): value is string {
  return typeof value === 'string' && MODULE_KEY_PATTERN.test(value);
}

export function isLearningTrack(value: unknown): value is LearningTrack {
  return typeof value === 'string' && (LEARNING_TRACKS as readonly string[]).includes(value);
}

/**
 * C0/C1 control characters and the bidi overrides that can make a string
 * render differently from what it says.
 */
function isInvisible(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint < 0xa0) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/**
 * Plain, single-line, link-free text of at most `max` characters.
 * Counts code points, so a Devanagari or Telugu string is never cut mid-letter
 * at a surrogate pair.
 */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const visible = Array.from(value)
    .map((char) => (isInvisible(char.codePointAt(0) ?? 0) ? ' ' : char))
    .join('');
  const text = visible
    .replace(/\b(?:https?:\/\/|www\.)\S*/gi, ' ')
    .replace(/\b(?:youtube\.com|youtu\.be)\S*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, max).join('').trim();
}

export function cleanSearchQuery(value: unknown): string {
  return cleanText(value, MAX_SEARCH_QUERY_LENGTH);
}

/** A YouTube search results link, or null when there is nothing to search for. */
export function youtubeSearchUrl(query: unknown): string | null {
  const clean = cleanSearchQuery(query);
  return clean ? `https://www.youtube.com/results?search_query=${encodeURIComponent(clean)}` : null;
}

/** FNV-1a, 32-bit, as 8 hex characters. Stable across server and phone. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    hash ^= code;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The LearningProgress key for an AI suggestion: its track and search phrase. */
export function aiModuleKey(track: LearningTrack, searchQuery: string): string {
  return `${track}:ai-${shortHash(searchQuery.toLowerCase())}`;
}

/** The array inside whatever wrapper key the model chose. */
function itemsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

/**
 * Validate an AI answer item by item. Anything without a known track, a title
 * or a search phrase is dropped; an unknown level falls back to the artisan's
 * own; duplicates (same track and search) keep the first.
 */
export function normaliseAiItems(raw: unknown, stage: SkillStage): AiLearningItem[] {
  const seen = new Set<string>();
  const out: AiLearningItem[] = [];
  for (const row of itemsOf(raw)) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const track = typeof record.track === 'string' ? record.track.trim().toLowerCase() : '';
    if (!isLearningTrack(track)) continue;
    const title = cleanText(record.title, MAX_TITLE_LENGTH);
    const searchQuery = cleanSearchQuery(record.searchQuery);
    if (!title || !searchQuery) continue;
    const levelRaw = typeof record.level === 'string' ? record.level.trim().toLowerCase() : '';
    const level = (LEARNING_LEVELS as readonly string[]).includes(levelRaw)
      ? (levelRaw as LearningLevel)
      : LEVEL_FOR_STAGE[stage];
    const key = aiModuleKey(track, searchQuery);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: 'AI',
      key,
      track,
      level,
      title,
      whyItHelps: cleanText(record.whyItHelps, MAX_WHY_LENGTH),
      searchQuery,
    });
  }
  return out;
}

/**
 * The three tracks: the AI's cards first (at most TRACK_SIZE per track), padded
 * from the catalogue up to MIN_TRACK_ITEMS, so no section is ever empty. With no
 * AI items at all, each track is the catalogue's best TRACK_SIZE.
 */
export function buildTracks(
  aiItems: readonly AiLearningItem[],
  context: CuratedContext
): { tracks: LearningTracks; source: LearningSource; mixed: boolean } {
  const tracks = {} as LearningTracks;
  let aiCount = 0;
  let curatedCount = 0;

  for (const track of LEARNING_TRACKS) {
    const ai = aiItems.filter((item) => item.track === track).slice(0, TRACK_SIZE);
    const want = ai.length === 0 ? TRACK_SIZE : MIN_TRACK_ITEMS;
    const padding = curatedTrack(track, context)
      .filter((item) => !ai.some((existing) => existing.key === item.key))
      .slice(0, Math.max(0, want - ai.length));
    tracks[track] = [...ai, ...padding];
    aiCount += ai.length;
    curatedCount += padding.length;
  }

  return {
    tracks,
    source: aiCount > 0 ? 'AI' : 'CURATED',
    mixed: aiCount > 0 && curatedCount > 0,
  };
}
