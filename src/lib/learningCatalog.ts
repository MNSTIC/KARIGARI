import { familiesForCraft, type MaterialFamily } from '@/lib/craftFamilies';
import { LEARNING_LEVELS, LEVEL_FOR_STAGE, type LearningLevel, type SkillStage } from '@/lib/skillStage';

/**
 * The curated learning catalogue — the suggestions every artisan gets when the
 * AI is unavailable, and the padding under an AI answer that came back thin.
 *
 * HONESTY NOTE. Every entry is a topic and a YouTube *search* written by hand
 * for this catalogue. There is no video ID, channel, duration, view count or
 * thumbnail anywhere in it, and there must never be one: the card links to a
 * live search results page, so what the artisan sees is whatever YouTube has
 * today, not a claim about a specific video that may have been taken down.
 *
 * Titles, "why this helps" lines and the search phrases are i18n keys
 * (`learn_cat_<track>_<slug>`, `…_why`, `…_q`), so a Hindi-speaking artisan
 * searches in Hindi. A `{craft}` placeholder in a search phrase is filled with
 * the artisan's own craft name, or the generic word for handicraft when they
 * have not set one.
 *
 * Pure and client-safe: the learn page builds these on the phone when it has
 * neither a network nor a saved copy, so the page is never blank.
 */

export type LearningTrack = 'business' | 'design' | 'digital';

export const LEARNING_TRACKS: readonly LearningTrack[] = ['business', 'design', 'digital'];

/** Cards per track section, and the fewest a section may show. */
export const TRACK_SIZE = 4;
export const MIN_TRACK_ITEMS = 3;

/** How many of the craft's material families get their own design lesson. */
export const DESIGN_FAMILIES_MATCHED = 2;

/** Profile fields the scheme engine checks, as the learn page names them. */
export type ProfileGap = 'socialCategory' | 'annualIncome' | 'aadhaar' | 'upi';

/**
 * The artisan's real outstanding work — the same four signals the learn page's
 * Active Assignments read. They move a relevant lesson to the front.
 */
export interface LearningGaps {
  /** IVR_DRAFT captures waiting for photos and a price. */
  draftsUnfinished: number;
  /** VERIFIED pieces with a patch id that have not passed the QR photo check. */
  patchesToAttach: number;
  /** SELLABLE pieces not yet on the marketplace. */
  sellableUnlisted: number;
  profileMissing: ProfileGap[];
}

export const NO_GAPS: LearningGaps = {
  draftsUnfinished: 0,
  patchesToAttach: 0,
  sellableUnlisted: 0,
  profileMissing: [],
};

type GapKey = 'photos' | 'upi' | 'profile' | 'listing';

function hasGap(gaps: LearningGaps, gap: GapKey): boolean {
  switch (gap) {
    case 'photos':
      return gaps.draftsUnfinished > 0 || gaps.patchesToAttach > 0;
    case 'upi':
      return gaps.profileMissing.includes('upi');
    case 'profile':
      return gaps.profileMissing.some((field) => field !== 'upi');
    case 'listing':
      return gaps.sellableUnlisted > 0;
  }
}

export interface CatalogEntry {
  track: LearningTrack;
  slug: string;
  level: LearningLevel;
  /** Design lessons tied to what the craft is made of. Absent = any craft. */
  families?: MaterialFamily[];
  /** Brought to the front of its track while the artisan has this gap. */
  gap?: GapKey;
}

export const LEARNING_CATALOG: readonly CatalogEntry[] = [
  // ---- business: pricing, packaging, customer handling, bulk orders --------
  { track: 'business', slug: 'pricing-basics', level: 'basic' },
  { track: 'business', slug: 'record-keeping', level: 'basic' },
  { track: 'business', slug: 'customer-care', level: 'basic' },
  { track: 'business', slug: 'packaging', level: 'growing' },
  { track: 'business', slug: 'bulk-orders', level: 'growing' },
  { track: 'business', slug: 'export-basics', level: 'advanced' },

  // ---- design: motifs, colour, finishing, fusion -----------------------------
  { track: 'design', slug: 'natural-dyes', level: 'growing', families: ['natural-dye'] },
  { track: 'design', slug: 'weave-patterns', level: 'growing', families: ['silk-yarn', 'cotton-yarn', 'pashmina-wool'] },
  { track: 'design', slug: 'embroidery-layout', level: 'growing', families: ['mirror-thread'] },
  { track: 'design', slug: 'metal-finish', level: 'growing', families: ['brass-bell-metal', 'silver-inlay'] },
  { track: 'design', slug: 'glaze-firing', level: 'growing', families: ['clay-quartz-glaze'] },
  { track: 'design', slug: 'natural-pigments', level: 'growing', families: ['stone-pigment', 'palm-leaf-paper'] },
  { track: 'design', slug: 'lacquer-finish', level: 'growing', families: ['lac-wood'] },
  { track: 'design', slug: 'colour', level: 'basic' },
  { track: 'design', slug: 'finishing', level: 'basic' },
  { track: 'design', slug: 'motifs', level: 'growing' },
  { track: 'design', slug: 'fusion', level: 'advanced' },

  // ---- digital: the phone, UPI, reading an order, answering a buyer ----------
  { track: 'digital', slug: 'phone-photos', level: 'basic', gap: 'photos' },
  { track: 'digital', slug: 'upi-safety', level: 'basic', gap: 'upi' },
  { track: 'digital', slug: 'reading-orders', level: 'basic' },
  { track: 'digital', slug: 'documents-on-phone', level: 'basic', gap: 'profile' },
  { track: 'digital', slug: 'buyer-messages', level: 'growing' },
  { track: 'digital', slug: 'online-listing', level: 'growing', gap: 'listing' },
];

/** `business:pricing-basics` — the LearningProgress key for a catalogue entry. */
export function catalogModuleKey(entry: Pick<CatalogEntry, 'track' | 'slug'>): string {
  return `${entry.track}:${entry.slug}`;
}

export function catalogKeys(entry: Pick<CatalogEntry, 'track' | 'slug'>) {
  const base = `learn_cat_${entry.track}_${entry.slug.replace(/-/g, '_')}`;
  return { titleKey: base, whyKey: `${base}_why`, queryKey: `${base}_q` };
}

/** A suggestion from this catalogue, as the route and the page carry it. */
export interface CuratedLearningItem {
  source: 'CURATED';
  key: string;
  track: LearningTrack;
  level: LearningLevel;
  titleKey: string;
  whyKey: string;
  queryKey: string;
}

export interface CuratedContext {
  craftType: string | null | undefined;
  stage: SkillStage | null;
  gaps?: LearningGaps;
  completed?: readonly string[];
}

/**
 * Up to TRACK_SIZE catalogue suggestions for one track, best first:
 * not yet done → answers a real gap → matches the craft's materials → nearest
 * the artisan's level → catalogue order. Without a known stage (offline, first
 * visit) the basic level is assumed.
 */
export function curatedTrack(track: LearningTrack, context: CuratedContext): CuratedLearningItem[] {
  const gaps = context.gaps ?? NO_GAPS;
  const completed = new Set(context.completed ?? []);
  const families = familiesForCraft(context.craftType ?? '').slice(0, DESIGN_FAMILIES_MATCHED);
  const target = LEARNING_LEVELS.indexOf(LEVEL_FOR_STAGE[context.stage ?? 'BEGINNER']);

  return LEARNING_CATALOG.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.track === track)
    .filter(({ entry }) => !entry.families || entry.families.some((family) => families.includes(family)))
    .map(({ entry, index }) => ({
      entry,
      rank: [
        completed.has(catalogModuleKey(entry)) ? 1 : 0,
        entry.gap && hasGap(gaps, entry.gap) ? 0 : 1,
        entry.families ? 0 : 1,
        Math.abs(LEARNING_LEVELS.indexOf(entry.level) - target),
        index,
      ],
    }))
    .sort((a, b) => {
      for (let i = 0; i < a.rank.length; i += 1) {
        if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
      }
      return 0;
    })
    .slice(0, TRACK_SIZE)
    .map(({ entry }) => ({
      source: 'CURATED' as const,
      key: catalogModuleKey(entry),
      track: entry.track,
      level: entry.level,
      ...catalogKeys(entry),
    }));
}
