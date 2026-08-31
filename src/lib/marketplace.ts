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
