/**
 * Shared vocabulary for the creator/influencer affiliate engine.
 *
 * Imported by the API routes and by the two client pages, so a handle typed in
 * the registration form normalises to exactly the string the `?ref=` link and
 * the tracking route look up.
 */

/** Where the creator's audience actually is. */
export const CREATOR_PLATFORMS = ['INSTAGRAM', 'YOUTUBE', 'NIFT_STUDENT'] as const;
export type CreatorPlatform = (typeof CREATOR_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  YOUTUBE: 'YouTube',
  NIFT_STUDENT: 'NIFT Student',
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] || platform;
}

export function isCreatorPlatform(value: unknown): value is CreatorPlatform {
  return typeof value === 'string' && (CREATOR_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Craft families a creator can specialise in.
 *
 * Free text would fragment instantly — "Handloom Saree", "handloom sarees",
 * "Sarees (handloom)" would each be their own niche and the artisan's
 * discovery filter would match none of them.
 */
export const CREATOR_NICHES = [
  'Handloom Sarees',
  'Tribal Jewelry',
  'Pottery & Terracotta',
  'Wood & Stone Carving',
  'Painting & Folk Art',
  'Metalwork & Brass',
  'Textiles & Embroidery',
  'Bamboo & Cane',
  'Leather Craft',
  'General Handicraft',
] as const;

/**
 * An artisan's `craftType` -> the creator niche that covers it.
 *
 * The two vocabularies are different on purpose: an artisan writes what they
 * make ("Sambalpuri Ikat", "Dhokra"), a creator picks the audience they serve
 * ("Handloom Sarees", "Metalwork & Brass"). Matching the raw strings against
 * each other returns nothing, so the artisan's discovery tab would look broken
 * when it is actually just asking the wrong question.
 *
 * Returns null when nothing maps — the caller then drops the niche filter
 * rather than showing an empty list.
 */
export function nicheForCraft(craftType: string): string | null {
  const craft = craftType.toLowerCase();
  const rules: [RegExp, string][] = [
    [/saree|sari|ikat|silk|handloom|weav|pochampally|sambalpuri|patola/, 'Handloom Sarees'],
    [/jewel|jewell|dhokra|filigree|tarakasi|bead|ornament/, 'Tribal Jewelry'],
    [/pott|terracot|clay|ceramic/, 'Pottery & Terracotta'],
    [/wood|stone|carv|sculpt|marble/, 'Wood & Stone Carving'],
    [/paint|pattachitra|madhubani|warli|kalamkari|folk art|miniature/, 'Painting & Folk Art'],
    [/brass|bell metal|metal|bidri|copper/, 'Metalwork & Brass'],
    [/embroid|textile|fabric|block print|applique|kantha|chikan|dupatta|shawl/, 'Textiles & Embroidery'],
    [/bamboo|cane|wicker|basket/, 'Bamboo & Cane'],
    [/leather|jutti|mojari/, 'Leather Craft'],
  ];
  for (const [pattern, niche] of rules) {
    if (pattern.test(craft)) return niche;
  }
  return null;
}

/**
 * "Shreya Styles!!" -> "shreya_styles". The handle is the affiliate link, so it
 * has to survive a URL, a DM and someone reading it aloud.
 */
export function slugifyHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** A VPA, loosely: `name@bank`. Never validated against a bank — nothing here moves real money. */
export function looksLikeUpi(value: string): boolean {
  return /^[\w.\-]{2,64}@[a-zA-Z]{2,64}$/.test(value.trim());
}

/** The link a creator shares. Relative-safe: the caller supplies the origin. */
export function affiliateUrl(origin: string, handle: string): string {
  return `${origin.replace(/\/+$/, '')}/marketplace?ref=${encodeURIComponent(handle)}`;
}

/** Shape returned by `GET /api/creators`, shared by both client pages. */
export interface PublicCreator {
  id: string;
  name: string;
  handle: string;
  platform: string;
  profileUrl: string | null;
  photoUrl: string | null;
  nicheCategory: string;
  location: string | null;
  bio: string | null;
  totalClicks: number;
  totalSales: number;
  earningsTotal: number;
}
