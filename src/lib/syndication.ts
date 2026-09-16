/**
 * Zero-ID multi-platform syndication.
 *
 * "Zero-ID" means the artisan never opens a seller account on any of these
 * platforms. KARIGARI is the provider node; the `CraftItem` row is the single
 * listing, and every channel below reads the same row. There is no external
 * seller id to reconcile, and no middleman between the buyer and the artisan.
 *
 * Shared by `/api/artisan/syndicate` (which owns the DB writes) and the
 * Syndication Hub tab, so the channel keys can never drift between the button
 * that publishes and the chip that reports what was published.
 *
 * Honest scope: the EXPORT channels mark an item broadcast-ready and produce the
 * ONDC / GeM payloads. They do not transmit to Paytm, Magicpin, gem.gov.in or
 * Amazon — exactly the framing `/api/ondc/catalog` and `gem-export` already use.
 *
 * Shopify (V11) is the one exception, and the difference is structural, not a
 * matter of copy: it is `mode: 'LIVE_PUBLISH'`, `normalizePlatforms()` refuses
 * it, and it is written only by POST /api/artisan/shopify/publish after Shopify
 * confirms the product. The master switch therefore can never stamp SHOPIFY
 * into `syndicatedChannels` without anything having been sent.
 */

export interface SyndicationPlatform {
  key: string;
  label: string;
  /** One line of honest copy about what publishing to this channel actually does. */
  note: string;
  /**
   * EXPORT: a payload is prepared for the channel; nothing is transmitted.
   * LIVE_PUBLISH: a real write to a live consumer storefront, confirmed by it.
   */
  mode: 'EXPORT' | 'LIVE_PUBLISH';
}

/**
 * Every channel the Syndication Hub knows. Only the EXPORT ones are published
 * by the master switch and persisted in `syndicatedChannels`.
 */
export const SYNDICATION_PLATFORMS: SyndicationPlatform[] = [
  {
    key: 'ONDC_PAYTM',
    label: 'Paytm (ONDC)',
    note: 'Beckn on_search payload prepared for ONDC buyer apps. Prepared here, not sent.',
    mode: 'EXPORT',
  },
  {
    key: 'ONDC_MAGICPIN',
    label: 'Magicpin (ONDC)',
    note: 'The same Beckn catalogue, prepared for another buyer app. Not transmitted.',
    mode: 'EXPORT',
  },
  {
    key: 'GEM',
    label: 'GeM (Govt B2G)',
    note: 'A bulk-catalog file you upload to gem.gov.in yourself. Nothing is sent.',
    mode: 'EXPORT',
  },
  {
    key: 'AMAZON_KARIGAR',
    label: 'Amazon Karigar',
    note: 'An export feed, shown for price comparison. Never pushed to Amazon.',
    mode: 'EXPORT',
  },
  {
    key: 'SHOPIFY',
    label: 'Your Shopify shop',
    note: 'A real product on a live storefront buyers can pay on, published only when Shopify confirms it.',
    mode: 'LIVE_PUBLISH',
  },
];

export const SYNDICATION_PLATFORM_KEYS: string[] = SYNDICATION_PLATFORMS.map((p) => p.key);

/** The channels the master switch prepares payloads for. */
export const EXPORT_PLATFORMS: SyndicationPlatform[] = SYNDICATION_PLATFORMS.filter((p) => p.mode === 'EXPORT');
export const EXPORT_PLATFORM_KEYS: string[] = EXPORT_PLATFORMS.map((p) => p.key);

const PLATFORM_BY_KEY = new Map(SYNDICATION_PLATFORMS.map((p) => [p.key, p]));

export function platformLabel(key: string): string {
  return PLATFORM_BY_KEY.get(key)?.label ?? key;
}

/**
 * Keep only EXPORT channels this app knows how to serialize.
 *
 * A LIVE_PUBLISH key (SHOPIFY) is dropped here on purpose: stamping it into
 * `syndicatedChannels` from the master switch would report a publish that never
 * happened. Shopify has its own route and its own columns.
 */
export function normalizePlatforms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const key = value.trim().toUpperCase();
    if (EXPORT_PLATFORM_KEYS.includes(key)) seen.add(key);
  }
  return Array.from(seen);
}

export interface PriceComparison {
  channel: string;
  label: string;
  /** What the consumer pays on that channel, in rupees. */
  buyerPays: number;
  /** What the artisan walks away with, explained in plain words. */
  artisanReceivesNote: string;
  /** Commission the channel takes on top of the artisan's price. */
  commissionPct: number;
  /** True for the one channel that takes nothing. */
  zeroMiddleman: boolean;
}

/**
 * Buyer-side price on each channel, derived from the artisan's own list price.
 *
 * The artisan's take is `base` everywhere: what differs is the markup the buyer
 * pays on top. ONDC buyer apps charge a finder fee (~3.5%) to the buyer, so the
 * artisan is untouched; a marketplace like Amazon Karigar takes ~15% out of the
 * transaction, which is why its buyer price has to rise to leave the artisan
 * whole. Percentages are indicative published rates, not a live rate card.
 *
 * The Shopify row is the platform's OWN store, so there is no marketplace
 * commission to add: the buyer pays the base price. The store does pay its
 * payment gateway and its Shopify plan, and those depend on the plan and
 * gateway chosen — so no percentage is invented for them; the note says so.
 */
export function buildPriceComparison(base: number, options: { shopify?: boolean } = {}): PriceComparison[] {
  const rows: PriceComparison[] = [
    {
      channel: 'KARIGARI_ONDC',
      label: 'Karigari Direct (ONDC)',
      buyerPays: Math.round(base),
      artisanReceivesNote: 'Full fair price — 0% middleman',
      commissionPct: 0,
      zeroMiddleman: true,
    },
    {
      channel: 'ONDC_PAYTM_MAGICPIN',
      label: 'Paytm / Magicpin (ONDC)',
      buyerPays: Math.round(base * 1.035),
      artisanReceivesNote: `Buyer-app finder fee only — you still receive ${Math.round(base)}`,
      commissionPct: 3.5,
      zeroMiddleman: false,
    },
    {
      channel: 'GEM_B2G',
      label: 'GeM (Govt B2G)',
      buyerPays: Math.round(base),
      artisanReceivesNote: 'Bulk government quote — 0% commission',
      commissionPct: 0,
      zeroMiddleman: false,
    },
    {
      channel: 'AMAZON_FLIPKART',
      label: 'Amazon Karigar / Flipkart Samarth',
      buyerPays: Math.round(base * 1.15),
      artisanReceivesNote: 'Platform takes 15% of the transaction',
      commissionPct: 15,
      zeroMiddleman: false,
    },
  ];
  // Only on a deployment that actually has a store — a channel the artisan
  // cannot use has no place in their comparison.
  if (options.shopify) {
    rows.splice(1, 0, {
      channel: 'SHOPIFY',
      label: 'Your Karigari shop on Shopify',
      buyerPays: Math.round(base),
      artisanReceivesNote:
        "No marketplace cut — sold from the platform's own store. Its payment gateway and Shopify plan fees depend on the plan.",
      commissionPct: 0,
      zeroMiddleman: false,
    });
  }
  return rows;
}

/**
 * The headline: rupees a buyer saves — and the artisan keeps — by buying direct
 * instead of through the highest-commission marketplace.
 */
export function middlemanAdvantage(comparisons: PriceComparison[]): number {
  const direct = comparisons.find((row) => row.zeroMiddleman);
  if (!direct) return 0;
  const dearest = comparisons.reduce(
    (max, row) => (row.buyerPays > max ? row.buyerPays : max),
    direct.buyerPays
  );
  return Math.max(0, dearest - direct.buyerPays);
}
