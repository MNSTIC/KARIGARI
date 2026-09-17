import { findGiLabel } from '@/lib/giLabels';
import { DEMAND_MATERIALS, DEMAND_PRODUCT_TYPES, type DemandCategory, type DemandDraft } from '@/lib/demandDraft';

/**
 * Everything the buyer passport SAYS about a piece, derived from real columns
 * and real AuditLog rows — pure, so every rule below is unit-tested
 * (src/lib/__tests__/passportFacts.test.mjs) and the page can only render what
 * this module returns.
 *
 * The rule throughout: a step, a claim or a figure with nothing behind it is
 * shown as not recorded, never as done, never with a guessed date.
 */

// ---- materials and colours -------------------------------------------------

/**
 * Materials the passport can name, longest first so "mulberry silk" wins over
 * "silk". Matched as whole words in the artisan's own tags, then the catalogue
 * tags, then the English description — whichever is actually populated.
 */
export const MATERIAL_TERMS = [
  'mulberry silk', 'tussar silk', 'muga silk', 'eri silk', 'bell metal', 'zinc alloy', 'pashmina',
  'silk', 'cotton', 'khadi', 'wool', 'jute', 'linen', 'terracotta', 'clay', 'ceramic', 'porcelain',
  'brass', 'bronze', 'copper', 'silver', 'wood', 'sandalwood', 'walnut', 'teak', 'bamboo', 'cane',
  'leather', 'paper', 'papier-mache', 'lac', 'stone', 'marble', 'glass',
] as const;

/** Which demand-form chip a named material belongs to. Anything else is "Other". */
const MATERIAL_CHIP: Record<string, string> = {
  'mulberry silk': 'Silk', 'tussar silk': 'Silk', 'muga silk': 'Silk', 'eri silk': 'Silk', silk: 'Silk',
  cotton: 'Cotton', khadi: 'Cotton',
  wool: 'Wool', pashmina: 'Wool',
  wood: 'Wood', sandalwood: 'Wood', walnut: 'Wood', teak: 'Wood',
  clay: 'Clay', terracotta: 'Clay', ceramic: 'Clay', porcelain: 'Clay',
  brass: 'Metal', bronze: 'Metal', copper: 'Metal', silver: 'Metal', 'bell metal': 'Metal', 'zinc alloy': 'Metal',
  leather: 'Leather',
  bamboo: 'Bamboo', cane: 'Bamboo',
};

export const COLOR_TERMS = [
  'maroon', 'red', 'crimson', 'blue', 'indigo', 'navy', 'turquoise', 'black', 'white', 'ivory', 'cream',
  'beige', 'green', 'yellow', 'mustard', 'orange', 'saffron', 'pink', 'magenta', 'purple', 'gold',
  'golden', 'silver', 'brown', 'grey', 'gray',
] as const;

export type FactSource = 'TAGS' | 'CATALOGUE' | 'DESCRIPTION';

export interface TextSources {
  tags?: string[] | null;
  /** `aiCatalog.tags`, when the capture produced a catalogue. */
  catalogTags?: string[] | null;
  descriptionEnglish?: string | null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The first term found as a whole word, source by source in priority order. */
function findTerm(sources: TextSources, terms: readonly string[]): { value: string; source: FactSource } | null {
  const ordered: [FactSource, string][] = [
    ['TAGS', (sources.tags ?? []).join(' | ')],
    ['CATALOGUE', (sources.catalogTags ?? []).join(' | ')],
    ['DESCRIPTION', sources.descriptionEnglish ?? ''],
  ];
  for (const [source, text] of ordered) {
    if (!text.trim()) continue;
    for (const term of terms) {
      if (new RegExp(`(^|[^a-z])${escapeRegExp(term)}([^a-z]|$)`, 'i').test(text)) {
        return { value: term, source };
      }
    }
  }
  return null;
}

export function materialFrom(sources: TextSources): { value: string; source: FactSource } | null {
  return findTerm(sources, MATERIAL_TERMS);
}

export function colorFrom(sources: TextSources): { value: string; source: FactSource } | null {
  return findTerm(sources, COLOR_TERMS);
}

/** `aiCatalog.tags` out of the stored JSON, or an empty list for any other shape. */
export function catalogTagsOf(aiCatalog: unknown): string[] {
  if (!aiCatalog || typeof aiCatalog !== 'object') return [];
  const tags = (aiCatalog as Record<string, unknown>).tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
}

// ---- GI --------------------------------------------------------------------

/**
 * The GI designation to print, or null. Null unless the profile is actually
 * certified: a GI claim on a non-certified profile is the most damaging thing
 * the passport could say. The name comes from the certified `giTagName`,
 * normalised through the GI label list when it matches one.
 */
export function giLabelFor(profile: { giTagCertified?: boolean | null; giTagName?: string | null } | null): string | null {
  if (!profile?.giTagCertified) return null;
  const name = (profile.giTagName ?? '').trim();
  if (!name) return null;
  return findGiLabel(name)?.label ?? name;
}

// ---- fair pay --------------------------------------------------------------

export type ReceivedState = 'NOT_SOLD' | 'HELD' | 'RELEASED';

export interface ReceivedFigure {
  state: ReceivedState;
  advance: number;
  final: number;
  total: number;
  /**
   * True unless a real payout rail recorded it. No rail is wired in this
   * deployment (see src/lib/escrow.ts), so a released tranche is a ledger
   * record, and the passport must say so rather than imply a bank credit.
   */
  simulated: boolean;
}

/**
 * What the artisan has actually received for this piece. Before a sale it is
 * ₹0 and NOT_SOLD — never an expected payout. After a sale with no tranche
 * released it is HELD.
 */
export function receivedFor(item: {
  sold: boolean;
  advancePaid?: number | null;
  finalPayoutQueued?: number | null;
  payoutMode?: string | null;
}): ReceivedFigure {
  const advance = Math.max(0, Math.round(Number(item.advancePaid) || 0));
  const final = Math.max(0, Math.round(Number(item.finalPayoutQueued) || 0));
  const total = advance + final;
  const simulated = item.payoutMode !== 'RAZORPAYX';
  if (!item.sold) return { state: 'NOT_SOLD', advance: 0, final: 0, total: 0, simulated };
  return { state: total > 0 ? 'RELEASED' : 'HELD', advance, final, total, simulated };
}

// ---- timeline --------------------------------------------------------------

export type TimelineStepKey =
  | 'material_sourced'
  | 'crafted'
  | 'ai_quality'
  | 'admin_verified'
  | 'qr_attached'
  | 'listed'
  | 'paid'
  | 'packed'
  | 'dispatched'
  | 'delivered';

export type StepState = 'DONE' | 'PENDING' | 'WAIVED';

export interface TimelineStep {
  key: TimelineStepKey;
  state: StepState;
  /** ISO timestamp from a real column or AuditLog row. Null means no date is shown. */
  at: string | null;
  /** Step-specific real facts: capture method, quality score, listing channels. */
  detail: Record<string, string | number | null>;
}

/** Audit actions the timeline and trust layers read. Nothing else from the log is used. */
export const PASSPORT_AUDIT_ACTIONS = [
  'ITEM_CAPTURED',
  'UPLOAD_CREATED',
  'ADMIN_VERIFIED',
  'MULTI_CHANNEL_SYNDICATE',
] as const;

export interface PassportAuditRow {
  action: string;
  actorRole: string;
  createdAt: Date | string;
}

export interface ProvenanceInput {
  createdAt: Date | string;
  catalogMethod: string | null;
  voiceLanguage: string | null;
  hasMaterialBill: boolean;
  photoQualityScore: number | null;
  photoQualitySource: string | null;
  qrVerified: boolean;
  qrVerifiedAt: Date | string | null;
  qrExemptAt: Date | string | null;
  isListedOnMarketplace: boolean;
  syndicatedAt: Date | string | null;
  shopifyPublishedAt: Date | string | null;
  syndicatedChannels: string[];
  paidAt: Date | string | null;
  packedAt: Date | string | null;
  dispatchedAt: Date | string | null;
  deliveredAt: Date | string | null;
  auditLogs: PassportAuditRow[];
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The earliest row with this action, or null. */
function firstLog(rows: PassportAuditRow[], actions: readonly string[]): PassportAuditRow | null {
  return (
    rows
      .filter((row) => actions.includes(row.action) && iso(row.createdAt))
      .sort((a, b) => Date.parse(iso(a.createdAt)!) - Date.parse(iso(b.createdAt)!))[0] ?? null
  );
}

function step(key: TimelineStepKey, done: boolean, at: Date | string | null, detail: TimelineStep['detail'] = {}): TimelineStep {
  return { key, state: done ? 'DONE' : 'PENDING', at: done ? iso(at) : null, detail };
}

export function buildTimeline(input: ProvenanceInput): TimelineStep[] {
  const admin = firstLog(input.auditLogs, ['ADMIN_VERIFIED']);
  const listingLog = firstLog(input.auditLogs, ['MULTI_CHANNEL_SYNDICATE']);

  let qr: TimelineStep;
  if (input.qrVerified) {
    qr = step('qr_attached', true, input.qrVerifiedAt);
  } else if (input.qrExemptAt) {
    // A waiver is its own state: never rendered as a pass.
    qr = { key: 'qr_attached', state: 'WAIVED', at: iso(input.qrExemptAt), detail: {} };
  } else {
    qr = step('qr_attached', false, null);
  }

  const channels = [...input.syndicatedChannels];
  if (input.shopifyPublishedAt) channels.push('SHOPIFY');

  return [
    // The bill has no date of its own, so a DONE step here carries none.
    { key: 'material_sourced', state: input.hasMaterialBill ? 'DONE' : 'PENDING', at: null, detail: {} },
    step('crafted', true, input.createdAt, {
      method: input.catalogMethod,
      language: input.catalogMethod === 'VOICE' || input.catalogMethod === 'IVR' ? input.voiceLanguage : null,
    }),
    {
      key: 'ai_quality',
      state: input.photoQualitySource === 'AI' ? 'DONE' : 'PENDING',
      at: null,
      detail: { score: input.photoQualitySource === 'AI' ? input.photoQualityScore : null },
    },
    step('admin_verified', Boolean(admin), admin?.createdAt ?? null),
    qr,
    step('listed', input.isListedOnMarketplace, input.syndicatedAt ?? input.shopifyPublishedAt ?? listingLog?.createdAt ?? null, {
      channels: input.isListedOnMarketplace ? channels.length : null,
    }),
    step('paid', Boolean(input.paidAt), input.paidAt),
    step('packed', Boolean(input.packedAt), input.packedAt),
    step('dispatched', Boolean(input.dispatchedAt), input.dispatchedAt),
    step('delivered', Boolean(input.deliveredAt), input.deliveredAt),
  ];
}

// ---- the three trust layers --------------------------------------------------

export type SimilaritySource = 'DELIVERY_SCAN' | 'READY_CHECK';

export interface SimilarityRecord {
  score: number;
  source: SimilaritySource;
  at: Date | string | null;
}

export interface TrustLayers {
  human: { at: string | null; method: string | null; language: string | null };
  admin: { at: string | null };
  ai: {
    /** When the artisan's photo with the patch was matched to the original capture. */
    patchMatchedAt: string | null;
    /** Set instead when the QR rule was waived for the demo catalogue. */
    waivedAt: string | null;
    /** The latest real image-similarity score on record, or null. */
    similarity: { score: number; source: SimilaritySource; at: string | null } | null;
  };
}

/**
 * Human capture → admin review → AI consistency check. Layer 3 is an image
 * similarity between photos of this piece and its original capture — which is
 * what it actually is — and the score is the stored one, never a model
 * accuracy figure.
 */
export function buildTrustLayers(input: ProvenanceInput, similarities: SimilarityRecord[]): TrustLayers {
  const capture = firstLog(input.auditLogs, ['ITEM_CAPTURED', 'UPLOAD_CREATED']);
  const admin = firstLog(input.auditLogs, ['ADMIN_VERIFIED']);
  const valid = similarities
    .filter((s) => Number.isFinite(s.score) && s.score >= 0 && s.score <= 100)
    // A buyer's delivery scan outranks the artisan's own ready check; within a
    // source, the latest wins.
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === 'DELIVERY_SCAN' ? -1 : 1;
      return Date.parse(iso(b.at) ?? '0') - Date.parse(iso(a.at) ?? '0');
    });
  const best = valid[0] ?? null;
  return {
    human: {
      at: iso(capture?.createdAt ?? input.createdAt),
      method: input.catalogMethod,
      language: input.catalogMethod === 'VOICE' || input.catalogMethod === 'IVR' ? input.voiceLanguage : null,
    },
    admin: { at: iso(admin?.createdAt ?? null) },
    ai: {
      patchMatchedAt: input.qrVerified ? iso(input.qrVerifiedAt) : null,
      waivedAt: !input.qrVerified && input.qrExemptAt ? iso(input.qrExemptAt) : null,
      similarity: best ? { score: Math.round(best.score), source: best.source, at: iso(best.at) } : null,
    },
  };
}

// ---- "Want something similar?" -----------------------------------------------

/** Keyword rules from what the piece is to the demand form's fixed category list. */
const DEMAND_CATEGORY_RULES: { category: DemandCategory; test: RegExp }[] = [
  { category: 'Saree & Textile', test: /saree|sari|silk|cotton|ikat|weav|textile|loom|fabric|dupatta|shawl|stole|embroider|kantha|bandhani|pashmina|odhani|handloom|rumal|bedcover/i },
  { category: 'Pottery & Ceramics', test: /pottery|ceramic|porcelain|terracotta|clay|earthen/i },
  { category: 'Jewellery', test: /jewel|necklace|bangle|earring|filigree/i },
  { category: 'Metalwork', test: /dhokra|dokra|brass|bronze|bell metal|metal|bidri/i },
  { category: 'Painting & Art', test: /pattachitra|patachitra|madhubani|warli|cheriyal|paint|scroll|miniature|canvas/i },
  { category: 'Leather', test: /leather|jutti|mojari/i },
  { category: 'Furniture', test: /chair|stool|table|cabinet|furniture/i },
  { category: 'Handicraft', test: /toy|wood|carv|bamboo|cane|basket|mask|figurine|chakla|wall hanging/i },
];

export function demandCategoryFor(item: { craftType: string; category?: string | null; tags?: string[] | null }): DemandCategory {
  const haystack = [item.category ?? '', item.craftType, ...(item.tags ?? [])].join(' ');
  return DEMAND_CATEGORY_RULES.find((rule) => rule.test.test(haystack))?.category ?? 'Other';
}

/** A product type from the form's own suggestions when the craft name contains one, else empty. */
export function productTypeFor(category: string, craftType: string): string {
  const options = DEMAND_PRODUCT_TYPES[category] ?? [];
  return options.find((option) => new RegExp(`(^|[^a-z])${escapeRegExp(option)}s?([^a-z]|$)`, 'i').test(craftType)) ?? '';
}

/**
 * The prefill for a demand modelled on this piece: craft, category, product
 * type, material and colour, each only when it can be read off the piece. The
 * reference photo is added on the client, which has to turn it into a data URL.
 */
export function demandDraftFor(item: {
  craftType: string;
  category?: string | null;
  tags?: string[] | null;
  material: string | null;
  color: string | null;
}): Partial<DemandDraft> {
  const category = demandCategoryFor(item);
  const draft: Partial<DemandDraft> = {
    craftType: item.craftType,
    category,
    productType: productTypeFor(category, item.craftType),
  };
  if (item.material) {
    const chip = MATERIAL_CHIP[item.material.toLowerCase()];
    if (chip && DEMAND_MATERIALS.includes(chip)) {
      draft.material = chip;
    } else {
      draft.material = 'Other';
      draft.materialOther = item.material;
    }
  }
  if (item.color) draft.color = item.color;
  return draft;
}
