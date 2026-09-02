import { getListingPrice } from '@/lib/pricing';

/**
 * The shape `/api/items/market` returns to the public storefront, shared by the
 * grid and the product page so the two can never disagree about a field.
 */
export interface MarketItem {
  id: string;
  patchId: string | null;
  craftType: string;
  descriptionOriginal: string | null;
  descriptionEnglish: string | null;
  aiGeneratedListing: string | null;
  aiSuggestedCategory: string | null;
  giTagApplied: string | null;
  tags: string[];
  images: string[];
  laborDays: number | null;
  fairWageFloor: number | null;
  marketPriceMin: number | null;
  marketPriceMax: number | null;
  standardMarketPrice: number | null;
  askingPrice: number | null;
  salePrice: number | null;
  status: string;
  isListedOnMarketplace: boolean;
  isOndcLive: boolean;
  syndicatedChannels: string[];
  escrowStatus: string | null;
  createdAt: string;
  artisan: {
    id: string;
    name: string;
    clusterName: string;
    location: string | null;
    craftType: string | null;
    photoUrl: string | null;
    giTagCertified: boolean;
    giTagName: string | null;
  };
}

/** What the consumer is asked to pay: a sold price if there is one, else the list price. */
export function marketPrice(item: {
  salePrice?: number | null;
  askingPrice?: number | null;
  standardMarketPrice?: number | null;
  fairWageFloor?: number | null;
}): number | null {
  return item.salePrice ?? getListingPrice(item);
}

/**
 * Craft photos are stored as base64 data URIs, which the Next image optimizer
 * cannot fetch. Same guard the facilitator queue already uses.
 */
export function imageProps(src: string) {
  return { src, unoptimized: src.startsWith('data:') };
}

/**
 * The category a craft belongs to, for the storefront's filter rail.
 *
 * The AI's own `aiSuggestedCategory` wins when the capture produced one. Where
 * it did not, the craft name is matched against the families the marketplace
 * actually carries — this is a display grouping, not a stored taxonomy, so it
 * is derived here rather than written back onto the row.
 */
const CATEGORY_RULES: { label: string; test: RegExp }[] = [
  { label: 'Textiles & Weaving', test: /saree|silk|cotton|ikat|weav|textile|loom|fabric|dupatta|shawl|embroider|kantha|bandhani/i },
  { label: 'Blue Pottery', test: /blue pottery|blue-pottery/i },
  { label: 'Terracotta', test: /terracotta|clay|earthen/i },
  { label: 'Pottery & Ceramics', test: /pottery|ceramic|porcelain/i },
  { label: 'Metalwork (Dhokra)', test: /dhokra|dokra|brass|bronze|bell metal|metal/i },
  { label: 'Wood Carving', test: /wood|walnut|teak|carv|sandalwood/i },
  { label: 'Painting & Scrolls', test: /pattachitra|patachitra|madhubani|warli|cheriyal|paint|scroll|miniature/i },
  { label: 'Jewellery', test: /jewel|jewell|necklace|bangle|earring|silver filigree|filigree/i },
  { label: 'Bamboo & Cane', test: /bamboo|cane|wicker|basket/i },
  { label: 'Leather', test: /leather|jutti|mojari/i },
];

export function categoryFor(item: {
  aiSuggestedCategory?: string | null;
  craftType?: string | null;
  tags?: string[];
}): string {
  const suggested = (item.aiSuggestedCategory || '').trim();
  if (suggested) return suggested;

  const haystack = [item.craftType || '', ...(item.tags || [])].join(' ');
  const hit = CATEGORY_RULES.find((rule) => rule.test.test(haystack));
  return hit ? hit.label : 'Other Crafts';
}
