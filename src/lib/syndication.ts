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
 * Honest scope: publishing here marks an item broadcast-ready and produces the
 * ONDC / GeM payloads. It does not transmit to Paytm, Magicpin, gem.gov.in or
 * Amazon — exactly the framing `/api/ondc/catalog` and `gem-export` already use.
 */

export interface SyndicationPlatform {
  key: string;
  label: string;
  /** One line of honest copy about what publishing to this channel actually does. */
  note: string;
}

/** The channels the master switch publishes to. Persisted in `syndicatedChannels`. */
export const SYNDICATION_PLATFORMS: SyndicationPlatform[] = [
  {
    key: 'ONDC_PAYTM',
    label: 'Paytm (ONDC)',
    note: 'Beckn on_search payload, broadcast-ready for any ONDC buyer app.',
  },
  {
    key: 'ONDC_MAGICPIN',
    label: 'Magicpin (ONDC)',
    note: 'Same Beckn catalogue — one listing, many buyer apps.',
  },
  {
    key: 'GEM',
    label: 'GeM (Govt B2G)',
    note: 'Upload-ready bulk-catalog file for gem.gov.in.',
  },
  {
    key: 'AMAZON_KARIGAR',
    label: 'Amazon Karigar',
    note: 'Export-ready feed. Listed here for price comparison, not auto-pushed.',
  },
];

export const SYNDICATION_PLATFORM_KEYS: string[] = SYNDICATION_PLATFORMS.map((p) => p.key);

const PLATFORM_BY_KEY = new Map(SYNDICATION_PLATFORMS.map((p) => [p.key, p]));

export function platformLabel(key: string): string {
  return PLATFORM_BY_KEY.get(key)?.label ?? key;
}

/** Keep only channels this app actually knows how to serialize. */
export function normalizePlatforms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const key = value.trim().toUpperCase();
    if (SYNDICATION_PLATFORM_KEYS.includes(key)) seen.add(key);
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
 */
export function buildPriceComparison(base: number): PriceComparison[] {
  return [
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
