import { istMonthKey } from '@/lib/offlineSales';

/**
 * "My Buyers": the artisan's buyer network, built only from sales that already
 * happened. The artisan types nothing.
 *
 * Pure — no Prisma, no React — so the aggregation that decides who counts as
 * one buyer, and what counts as money received, is the same code the unit test
 * runs. `GET /api/artisan/buyers` gathers the rows and calls it.
 *
 * Buyers have no account anywhere in this app, so identity is the free-text
 * name they typed, matched the way every other buyer surface matches it:
 * case-insensitively, whitespace collapsed, and nothing else. Letters are never
 * stripped — "राधा" and "Radha" are two different spellings, and merging
 * scripts would silently turn two buyers into one.
 */

export type BuyerChannel = 'STOREFRONT' | 'DEMAND' | 'OFFLINE';

/** Most recent purchases carried per buyer; the counts and totals stay exact. */
export const BUYER_ITEMS_CAP = 10;

export const TOP_BUYERS = 5;

/** Months in the "new vs repeat" series. */
export const BUYER_MONTHS = 12;

/** Below this many buyers a repeat rate is an anecdote, and is not shown. */
export const MIN_BUYERS_FOR_REPEAT_RATE = 3;

/** Demand purchase types that make a buyer a business buyer. */
export const B2B_PURCHASE_TYPES: readonly string[] = ['BULK', 'WHOLESALE'];

/**
 * A storefront piece counts as sold once a buyer paid for it or it reached one
 * of these statuses through the escrow ledger. SOLD_OFFLINE is deliberately
 * absent: those pieces belong to the offline ledger, and counting them here too
 * would count one sale twice. Shared by My Buyers and the production record.
 */
export const STOREFRONT_SOLD_STATUSES: string[] = ['SOLD_FINAL', 'SOLD_MIDDLEMAN', 'PAYOUT_COMPLETED'];

/** How far back "what buyers are looking for" reads. */
export const SIGNAL_WINDOW_DAYS = 30;

/** Matching searches needed before searches, not open requests, are the signal. */
export const MIN_SEARCHES_FOR_SIGNAL = 5;

/** A term searched once is one person; it has to be searched at least this often. */
export const MIN_TERM_SEARCHES = 2;

/** At or above this share of empty results, the UI marks a term "nobody is listing this". */
export const UNMET_SHARE_THRESHOLD = 0.5;

/** Terms returned at most. */
export const MAX_SIGNAL_TERMS = 12;

/** The identity two purchases are compared on. Null for a blank name. */
export function normaliseBuyerKey(name: string | null | undefined): string | null {
  const key = String(name ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return key || null;
}

/** One purchase from any of the three sources, already reduced to what counts. */
export interface PurchaseRow {
  buyerName: string | null;
  channel: BuyerChannel;
  /**
   * Money that actually reached the artisan for this line — released escrow
   * tranches, a settled demand credit, or cash the artisan logged. Never a list
   * price and never a valuation; a paid piece with nothing released yet is 0.
   */
  amount: number;
  at: Date;
  title: string;
  itemId?: string | null;
  /** True when the purchase is tied to a BULK or WHOLESALE demand. */
  b2b?: boolean;
}

export interface BuyerItem {
  id?: string;
  title: string;
  amount: number;
  at: string;
  channel: BuyerChannel;
}

export interface Buyer {
  key: string;
  /** The spelling the buyer used most recently. */
  displayName: string;
  firstPurchaseAt: string;
  lastPurchaseAt: string;
  purchaseCount: number;
  /** Received, not sold — see `PurchaseRow.amount`. */
  totalValue: number;
  channels: BuyerChannel[];
  isRepeat: boolean;
  isB2B: boolean;
  /** Newest first, at most BUYER_ITEMS_CAP. */
  items: BuyerItem[];
}

export interface BuyerMonth {
  /** "2026-09", IST. */
  month: string;
  buyers: number;
  newBuyers: number;
  /** Everything received that month, named buyer or not. */
  revenue: number;
}

export interface BuyersSummary {
  totalBuyers: number;
  repeatBuyers: number;
  b2bBuyers: number;
  /** Null below MIN_BUYERS_FOR_REPEAT_RATE. */
  repeatRatePct: number | null;
  /**
   * Every purchase's money, named buyer or not, so these totals reconcile with
   * the Money tab. Only the buyer list is limited to named buyers.
   */
  revenueByChannel: { storefront: number; demand: number; offline: number };
  monthly: BuyerMonth[];
  topBuyers: Buyer[];
  /** Purchases with no buyer name recorded: counted in revenue, absent from the list. */
  unnamed: { storefront: number; demand: number; offline: number };
}

const CHANNEL_KEY: Record<BuyerChannel, 'storefront' | 'demand' | 'offline'> = {
  STOREFRONT: 'storefront',
  DEMAND: 'demand',
  OFFLINE: 'offline',
};

function money(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The last BUYER_MONTHS IST month keys, oldest first. */
export function buyerMonthKeys(now: Date = new Date()): string[] {
  const current = istMonthKey(now);
  const [year, month] = current.split('-').map(Number);
  const keys: string[] = [];
  for (let i = BUYER_MONTHS - 1; i >= 0; i -= 1) {
    const total = year * 12 + (month - 1) - i;
    keys.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`);
  }
  return keys;
}

export function aggregateBuyers(
  rows: PurchaseRow[],
  now: Date = new Date()
): { buyers: Buyer[]; summary: BuyersSummary } {
  const revenueByChannel = { storefront: 0, demand: 0, offline: 0 };
  const unnamed = { storefront: 0, demand: 0, offline: 0 };

  interface Acc {
    key: string;
    rows: PurchaseRow[];
    channels: Set<BuyerChannel>;
    b2b: boolean;
  }
  const byKey = new Map<string, Acc>();

  for (const row of rows) {
    const channel = CHANNEL_KEY[row.channel];
    revenueByChannel[channel] += money(row.amount);
    const key = normaliseBuyerKey(row.buyerName);
    if (!key) {
      unnamed[channel] += 1;
      continue;
    }
    const acc = byKey.get(key) ?? { key, rows: [], channels: new Set<BuyerChannel>(), b2b: false };
    acc.rows.push(row);
    acc.channels.add(row.channel);
    acc.b2b = acc.b2b || Boolean(row.b2b);
    byKey.set(key, acc);
  }

  const buyers: Buyer[] = [...byKey.values()].map((acc) => {
    const sorted = [...acc.rows].sort((a, b) => b.at.getTime() - a.at.getTime());
    const newest = sorted[0];
    const oldest = sorted[sorted.length - 1];
    return {
      key: acc.key,
      displayName: String(newest.buyerName).trim().replace(/\s+/g, ' '),
      firstPurchaseAt: oldest.at.toISOString(),
      lastPurchaseAt: newest.at.toISOString(),
      purchaseCount: sorted.length,
      totalValue: sorted.reduce((sum, row) => sum + money(row.amount), 0),
      channels: (['STOREFRONT', 'DEMAND', 'OFFLINE'] as BuyerChannel[]).filter((c) => acc.channels.has(c)),
      isRepeat: sorted.length >= 2,
      isB2B: acc.b2b,
      items: sorted.slice(0, BUYER_ITEMS_CAP).map((row) => ({
        ...(row.itemId ? { id: row.itemId } : {}),
        title: row.title,
        amount: money(row.amount),
        at: row.at.toISOString(),
        channel: row.channel,
      })),
    };
  });

  buyers.sort((a, b) => b.lastPurchaseAt.localeCompare(a.lastPurchaseAt));

  // ---- the monthly series -------------------------------------------------
  const keys = buyerMonthKeys(now);
  const monthly = new Map<string, { buyers: Set<string>; newBuyers: Set<string>; revenue: number }>(
    keys.map((k) => [k, { buyers: new Set(), newBuyers: new Set(), revenue: 0 }])
  );
  for (const row of rows) {
    const bucket = monthly.get(istMonthKey(row.at));
    if (bucket) bucket.revenue += money(row.amount);
  }
  for (const buyer of buyers) {
    const firstMonth = istMonthKey(new Date(buyer.firstPurchaseAt));
    for (const row of byKey.get(buyer.key)!.rows) {
      const month = istMonthKey(row.at);
      const bucket = monthly.get(month);
      if (!bucket) continue;
      bucket.buyers.add(buyer.key);
      if (month === firstMonth) bucket.newBuyers.add(buyer.key);
    }
  }

  const totalBuyers = buyers.length;
  const repeatBuyers = buyers.filter((b) => b.isRepeat).length;

  return {
    buyers,
    summary: {
      totalBuyers,
      repeatBuyers,
      b2bBuyers: buyers.filter((b) => b.isB2B).length,
      repeatRatePct:
        totalBuyers >= MIN_BUYERS_FOR_REPEAT_RATE ? Math.round((repeatBuyers / totalBuyers) * 100) : null,
      revenueByChannel,
      monthly: keys.map((month) => {
        const bucket = monthly.get(month)!;
        return { month, buyers: bucket.buyers.size, newBuyers: bucket.newBuyers.size, revenue: bucket.revenue };
      }),
      topBuyers: [...buyers].sort((a, b) => b.totalValue - a.totalValue).slice(0, TOP_BUYERS),
      unnamed,
    },
  };
}

// ---------------------------------------------------------------------------
// What buyers are looking for
// ---------------------------------------------------------------------------

export interface SearchTermStat {
  term: string;
  count: number;
  /** Of `count`, how many returned no listed piece. */
  zeroResultCount: number;
}

export interface SignalTerm {
  term: string;
  count: number;
  /** 0–1, two decimals. Always 0 for open requests, which have no result count. */
  zeroResultShare: number;
}

export interface DemandSignals {
  source: 'SEARCHES' | 'DEMANDS' | 'NONE';
  window: number;
  /** How many searches, or how many open requests, the terms were drawn from. */
  basis: number;
  terms: SignalTerm[];
}

/**
 * The signal, and which kind it is.
 *
 * Searches win when at least MIN_SEARCHES_FOR_SIGNAL searches in the window
 * match this artisan's craft AND at least one term was searched
 * MIN_TERM_SEARCHES times. Otherwise open buyer requests for the craft are the
 * signal. Otherwise there is none. The UI names the source, because "41 buyer
 * searches" and "6 open buyer requests" mean different things.
 */
export function buildDemandSignals(
  searches: SearchTermStat[],
  openRequestTerms: string[],
  matchesCraft: (term: string) => boolean
): DemandSignals {
  const matched = searches.filter((s) => s.count > 0 && matchesCraft(s.term));
  const matchedTotal = matched.reduce((sum, s) => sum + s.count, 0);
  const repeated = matched
    .filter((s) => s.count >= MIN_TERM_SEARCHES)
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, MAX_SIGNAL_TERMS)
    .map((s) => ({
      term: s.term,
      count: s.count,
      zeroResultShare: Math.round((Math.min(s.zeroResultCount, s.count) / s.count) * 100) / 100,
    }));

  if (matchedTotal >= MIN_SEARCHES_FOR_SIGNAL && repeated.length > 0) {
    return { source: 'SEARCHES', window: SIGNAL_WINDOW_DAYS, basis: matchedTotal, terms: repeated };
  }

  const counts = new Map<string, number>();
  for (const raw of openRequestTerms) {
    const term = raw.trim();
    if (term) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  if (counts.size > 0) {
    return {
      source: 'DEMANDS',
      window: SIGNAL_WINDOW_DAYS,
      basis: openRequestTerms.filter((t) => t.trim()).length,
      terms: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_SIGNAL_TERMS)
        .map(([term, count]) => ({ term, count, zeroResultShare: 0 })),
    };
  }

  return { source: 'NONE', window: SIGNAL_WINDOW_DAYS, basis: 0, terms: [] };
}
