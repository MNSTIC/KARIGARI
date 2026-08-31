import { randomUUID } from 'node:crypto';
import { locateCity } from '@/lib/indiaGeo';
import { getListingPrice } from '@/lib/pricing';

/**
 * Beckn `on_search` serializer for the KARIGARI provider node.
 *
 * Extracted from `/api/ondc/catalog` so the public catalogue route and the
 * artisan's government-export both emit the identical payload shape. There is
 * one implementation: a buyer app and an artisan downloading their own Beckn
 * file can never see two different serializations of the same item.
 *
 * Spec: Beckn core 1.2.0 + ONDC RET1x `on_search`
 *   https://github.com/beckn/protocol-specifications
 *   https://github.com/ONDC-Official/ONDC-RET-Specifications
 */

/**
 * ONDC retail domain.
 *
 * Handloom / handicraft does not have a dedicated ONDC domain code: textile
 * crafts are transacted under RET12 (Fashion) and decor pieces under RET16
 * (Home & Decor). RET12 is the default because the bulk of this catalogue is
 * handloom. `RET1B` is *Hardware & Industrial* in ONDC's domain list, so it is
 * deliberately not used here. Override per deployment with `ONDC_DOMAIN`.
 */
const DOMAIN = process.env.ONDC_DOMAIN || 'ONDC:RET12';

/** Beckn context `city`, an STD code. Overridable because it is deployment data. */
const CITY = process.env.ONDC_CITY || 'std:080';

const CORE_VERSION = '1.2.0';
const COUNTRY = 'IND';

/** One shared fulfillment per provider — KARIGARI ships, buyer does not self-pick. */
const FULFILLMENT_ID = 'F1';
const LOCATION_ID = 'L1';

export type CatalogItem = {
  id: string;
  patchId: string | null;
  craftType: string;
  descriptionEnglish: string | null;
  descriptionOriginal: string | null;
  aiGeneratedListing: string | null;
  aiSuggestedCategory: string | null;
  giTagApplied: string | null;
  images: string[];
  tags: string[];
  salePrice: number | null;
  askingPrice: number | null;
  standardMarketPrice: number | null;
  marketPriceMax: number | null;
  fairWageFloor: number | null;
  createdAt: Date;
  artisan: {
    id: string;
    name: string;
    artisanProfile: {
      craftType: string;
      location: string;
      clusterName: string | null;
      description: string | null;
      photoUrl: string | null;
      giTagCertified: boolean;
      giTagName: string | null;
      socialCategory: string | null;
    } | null;
  };
};

/** The exact row shape the serializer needs. Shared so selects cannot drift. */
export const ONDC_ITEM_SELECT = {
  id: true,
  patchId: true,
  craftType: true,
  descriptionEnglish: true,
  descriptionOriginal: true,
  aiGeneratedListing: true,
  aiSuggestedCategory: true,
  giTagApplied: true,
  images: true,
  tags: true,
  salePrice: true,
  askingPrice: true,
  standardMarketPrice: true,
  marketPriceMax: true,
  fairWageFloor: true,
  createdAt: true,
  artisan: {
    select: {
      id: true,
      name: true,
      artisanProfile: {
        select: {
          craftType: true,
          location: true,
          clusterName: true,
          description: true,
          photoUrl: true,
          giTagCertified: true,
          giTagName: true,
          socialCategory: true,
        },
      },
    },
  },
} as const;

/** "Pochampally Ikat" -> "pochampally-ikat". Stable so category ids don't churn. */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'craft'
  );
}

/**
 * "Bargarh, Odisha" -> { city: "Bargarh", state: "Odisha" }.
 * A single-part location yields no state rather than a guessed one.
 */
export function splitLocation(location: string): { city: string; state?: string } {
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { city: location.trim() };
  if (parts.length === 1) return { city: parts[0] };
  return { city: parts[0], state: parts[parts.length - 1] };
}

/**
 * Beckn wants price as a decimal string.
 *
 * A sold item broadcasts what it actually sold for; everything still on offer
 * broadcasts the artisan's own `askingPrice`. `getListingPrice` carries the
 * legacy fallback for rows captured before artisans could set a price.
 */
export function priceOf(item: CatalogItem): string | null {
  const value = item.salePrice ?? getListingPrice(item);
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}

export function absoluteImages(images: string[], origin: string): string[] {
  return images
    .filter((src) => typeof src === 'string' && src.length > 0)
    // Relative uploads are meaningless to a remote buyer app; make them absolute.
    // Inline data URLs are left as-is — they are already self-contained.
    .map((src) => (/^(https?:|data:)/i.test(src) ? src : new URL(src, origin).toString()));
}

function buildProvider(artisanId: string, items: CatalogItem[], origin: string) {
  const { artisan } = items[0];
  const profile = artisan.artisanProfile;
  const location = profile?.location?.trim() || '';
  const point = locateCity(location);
  const { city, state } = splitLocation(location);

  const categories = new Map<string, { id: string; descriptor: { name: string } }>();
  for (const item of items) {
    const name = item.aiSuggestedCategory?.trim() || item.craftType;
    const id = slugify(name);
    if (!categories.has(id)) categories.set(id, { id, descriptor: { name } });
  }

  return {
    id: artisanId,
    descriptor: {
      name: artisan.name,
      short_desc: profile?.clusterName || profile?.craftType || 'KARIGARI artisan',
      long_desc: profile?.description || undefined,
      images: absoluteImages(profile?.photoUrl ? [profile.photoUrl] : [], origin),
    },
    locations: [
      {
        id: LOCATION_ID,
        // Omitted rather than invented when the gazetteer cannot resolve the town.
        ...(point ? { gps: `${point.lat},${point.lon}` } : {}),
        address: {
          city: city || undefined,
          state: state || undefined,
          country: COUNTRY,
        },
      },
    ],
    categories: Array.from(categories.values()),
    fulfillments: [{ id: FULFILLMENT_ID, type: 'Delivery' }],
    items: items
      .map((item) => {
        const value = priceOf(item);
        if (value === null) return null;

        const categoryId = slugify(item.aiSuggestedCategory?.trim() || item.craftType);
        const attributes = [
          ...(item.patchId ? [{ code: 'patch_id', value: item.patchId }] : []),
          ...(item.fairWageFloor
            ? [{ code: 'fair_wage_floor', value: item.fairWageFloor.toFixed(2) }]
            : []),
          ...(item.giTagApplied || profile?.giTagName
            ? [{ code: 'gi_tag', value: (item.giTagApplied || profile?.giTagName) as string }]
            : []),
        ];

        return {
          id: item.id,
          descriptor: {
            name: item.craftType,
            ...(item.patchId ? { code: item.patchId } : {}),
            short_desc: item.descriptionEnglish || item.aiGeneratedListing || item.craftType,
            long_desc:
              item.aiGeneratedListing || item.descriptionEnglish || item.descriptionOriginal || item.craftType,
            images: absoluteImages(item.images, origin),
          },
          price: { currency: 'INR', value },
          category_id: categoryId,
          location_id: LOCATION_ID,
          fulfillment_id: FULFILLMENT_ID,
          '@ondc/org/returnable': false,
          '@ondc/org/cancellable': true,
          '@ondc/org/available_on_cod': false,
          '@ondc/org/time_to_ship': 'P7D',
          '@ondc/org/seller_pickup_return': false,
          tags: [
            { code: 'origin', list: [{ code: 'country', value: COUNTRY }] },
            ...(attributes.length ? [{ code: 'attribute', list: attributes }] : []),
          ],
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
  };
}

/**
 * Serialize rows into a complete Beckn `on_search` payload.
 *
 * Rows are grouped by artisan into providers; an item with no resolvable price
 * is dropped rather than broadcast at a made-up figure, and the count of
 * dropped rows is logged.
 */
export function buildOndcCatalog(rows: CatalogItem[], origin: string) {
  const bppId = process.env.ONDC_BPP_ID || new URL(origin).host;
  const bppUri = `${origin.replace(/\/$/, '')}/api/ondc`;

  const byArtisan = new Map<string, CatalogItem[]>();
  for (const row of rows) {
    const existing = byArtisan.get(row.artisan.id);
    if (existing) existing.push(row);
    else byArtisan.set(row.artisan.id, [row]);
  }

  const providers = Array.from(byArtisan.entries())
    .map(([artisanId, items]) => buildProvider(artisanId, items, origin))
    .filter((provider) => provider.items.length > 0);

  const emitted = providers.reduce((sum, provider) => sum + provider.items.length, 0);
  if (emitted < rows.length) {
    // Beckn requires a price on every item; one without any of salePrice,
    // askingPrice, standardMarketPrice or fairWageFloor cannot be serialized
    // honestly.
    console.warn(
      `[ONDC] ${rows.length - emitted} published item(s) omitted from the catalog: no resolvable price.`
    );
  }

  return {
    context: {
      domain: DOMAIN,
      action: 'on_search',
      country: COUNTRY,
      city: CITY,
      core_version: CORE_VERSION,
      bpp_id: bppId,
      bpp_uri: bppUri,
      transaction_id: randomUUID(),
      message_id: randomUUID(),
      timestamp: new Date().toISOString(),
      ttl: 'PT30S',
    },
    message: {
      catalog: {
        'bpp/descriptor': {
          name: 'KARIGARI',
          short_desc: 'AI-verified artisan crafts',
          long_desc:
            'Handloom and handicraft from verified Indian artisans. Every item carries a fair-wage floor and a digital passport.',
          images: [] as string[],
        },
        'bpp/fulfillments': [{ id: FULFILLMENT_ID, type: 'Delivery' }],
        'bpp/providers': providers,
      },
    },
  };
}
