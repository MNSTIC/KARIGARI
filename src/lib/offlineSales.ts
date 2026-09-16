import { rupees } from '@/lib/escrow';

/**
 * The offline sale ledger — sales an artisan made away from the platform and
 * logged themselves.
 *
 * Pure on purpose: no Prisma, no React, no `process.env`. The route, the log
 * page, the dashboard and the pricing endpoints all read the same rules from
 * here, and the parse test compiles this file straight into Node.
 *
 * HONESTY BOUNDARY. An offline sale is the artisan's own bookkeeping. Karigari
 * moved no money for it and verified none of it, so every figure derived here
 * is labelled "self-logged" wherever it is shown, and none of it is ever summed
 * into escrow income or demand credits.
 */

// ---------------------------------------------------------------------------
// Channels and statuses
// ---------------------------------------------------------------------------

export const OFFLINE_CHANNELS = ['HAAT', 'WALK_IN', 'EXHIBITION', 'MIDDLEMAN', 'OTHER'] as const;
export type OfflineChannel = (typeof OFFLINE_CHANNELS)[number];

export function isOfflineChannel(v: unknown): v is OfflineChannel {
  return typeof v === 'string' && (OFFLINE_CHANNELS as readonly string[]).includes(v);
}

/** The i18n key for a channel's label — never an English string. */
export function channelLabelKey(c: OfflineChannel): string {
  return `channel_${c.toLowerCase()}`;
}

/**
 * The `CraftItem.status` a catalogued piece takes when the artisan logs it as
 * sold offline.
 *
 * Deliberately not `SOLD_MIDDLEMAN`: that status carries the platform's own
 * middleman-routing meaning, and a weaver who sold directly to a customer at a
 * haat has done the opposite of routing through a middleman. The channel —
 * including MIDDLEMAN — lives on the `OfflineSale` row instead.
 */
export const SOLD_OFFLINE = 'SOLD_OFFLINE';

// ---------------------------------------------------------------------------
// Thresholds. Every one is shown to the artisan when it is not yet met.
// ---------------------------------------------------------------------------

/** Minimum offline rows for a craft before a median is a signal, not an anecdote. */
export const MIN_PRICE_SAMPLES = 3;

/**
 * Minimum online sales of the same craft before the offline/online comparison
 * is drawn. Two, not one: a delta is never computed from a single row on either
 * side.
 */
export const MIN_ONLINE_SAMPLES = 2;

/** Rows older than this stop counting toward the price signal. */
export const PRICE_SIGNAL_WINDOW_DAYS = 180;

/** A typo of ₹1,50,00,000 for ₹1,500 is refused outright above this. */
export const MAX_OFFLINE_AMOUNT = 10_000_000;

export const MAX_OFFLINE_QUANTITY = 999;

/** A sale older than this is not bookkeeping any more, it is archaeology. */
export const MAX_SALE_AGE_DAYS = 730;

/** How long after logging a row the artisan may still undo it. */
export const OFFLINE_SALE_UNDO_HOURS = 24;

/**
 * A per-unit price above this multiple of the artisan's own offline median is
 * questioned before it is saved. Questioned, never refused: their sale, their
 * number.
 */
export const HIGH_AMOUNT_MULTIPLE = 20;

/**
 * The per-unit figure that is questioned when the artisan has too few sales for
 * a median to exist. Without it a first-ever typo would sail straight through.
 */
export const HIGH_AMOUNT_WITHOUT_HISTORY = 100_000;

export const MAX_CRAFT_LABEL_LENGTH = 120;
export const MAX_BUYER_NAME_LENGTH = 120;
export const MAX_NOTES_LENGTH = 500;

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

/** Zero code points of the Devanagari, Odia and Telugu digit blocks. */
const DIGIT_BLOCK_ZEROS = [0x0966, 0x0b66, 0x0c66];

/** "१५००" / "୧୫୦୦" / "౧౫౦౦" → "1500". Everything else passes through. */
export function toAsciiDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const zero = DIGIT_BLOCK_ZEROS.find((start) => code >= start && code <= start + 9);
    out += zero === undefined ? ch : String(code - zero);
  }
  return out;
}

/**
 * The key two craft labels are compared on: trimmed, lower-cased, internal
 * whitespace collapsed. Nothing else is stripped, so labels in Hindi, Odia or
 * Telugu keep their own letters.
 */
export function normaliseCraftLabel(label: string | null | undefined): string {
  return String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Trimmed, whitespace-collapsed display text, or null when nothing is left. */
export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  return text.slice(0, maxLength);
}

/**
 * A typed rupee amount as a whole number, or null when it is not one.
 *
 * Accepts what an artisan actually types: "1,500", "₹ 1500", "Rs. 1500",
 * "१५००", "1500.00". Refuses "1500.50" rather than rounding it — a line in a
 * cash ledger that silently changes is worse than one the artisan re-types.
 */
export function parseAmountInput(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const cleaned = toAsciiDigits(value)
    .toLowerCase()
    .replace(/₹|rs\.?|inr|rupees?/g, '')
    .replace(/[\s,]/g, '');
  if (!/^\d+(\.0+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Dates. The artisan's calendar is IST, whatever the server's clock says.
// ---------------------------------------------------------------------------

const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "2026-09-16", the calendar day in India. */
export function istDateKey(date: Date): string {
  return IST_DATE.format(date);
}

/** "2026-09". */
export function istMonthKey(date: Date): string {
  return istDateKey(date).slice(0, 7);
}

/** The IST calendar day `days` before `now`, as a key. */
export function istDaysAgoKey(days: number, now: Date = new Date()): string {
  return istDateKey(new Date(now.getTime() - days * 86_400_000));
}

/**
 * A day key becomes an instant at noon IST.
 *
 * Noon, not midnight: 12:00 IST is 06:30 UTC, the same calendar day in both
 * zones, so a sale lands in the month it was made whether the month is read
 * on an IST laptop or a UTC server.
 */
export function dateKeyToInstant(key: string): Date {
  return new Date(`${key}T12:00:00+05:30`);
}

export type SoldAtResult =
  | { ok: true; soldAt: Date }
  | { ok: false; reason: 'invalid' | 'future' | 'too_old' };

/**
 * Validate when a sale happened. Accepts a `YYYY-MM-DD` day (what the form
 * sends) or a full ISO timestamp. Compared by IST calendar day, so a sale
 * logged at 9 am for "today" is not refused as being in the future.
 */
export function soldAtFromInput(value: unknown, now: Date = new Date()): SoldAtResult {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, reason: 'invalid' };
  const raw = value.trim();
  let soldAt: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    soldAt = dateKeyToInstant(raw);
    // Reject "2026-02-31", which Date would quietly roll into March.
    if (Number.isNaN(soldAt.getTime()) || istDateKey(soldAt) !== raw) {
      return { ok: false, reason: 'invalid' };
    }
  } else {
    soldAt = new Date(raw);
    if (Number.isNaN(soldAt.getTime())) return { ok: false, reason: 'invalid' };
  }
  if (istDateKey(soldAt) > istDateKey(now)) return { ok: false, reason: 'future' };
  if (istDateKey(soldAt) < istDaysAgoKey(MAX_SALE_AGE_DAYS, now)) {
    return { ok: false, reason: 'too_old' };
  }
  return { ok: true, soldAt };
}

// ---------------------------------------------------------------------------
// Price signal
// ---------------------------------------------------------------------------

export interface OfflineSaleAmountRow {
  amount: number;
  quantity: number;
  soldAt: Date;
}

/** What one unit of a line sold for. Null for a malformed row, never NaN. */
export function unitPrice(row: { amount: number; quantity: number }): number | null {
  const amount = Number(row.amount);
  const quantity = Number(row.quantity);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(quantity) || quantity < 1) return null;
  return amount / quantity;
}

/** Median of the values, rounded to whole rupees. Null for an empty list. */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return rupees(value);
}

function windowStart(now: Date, windowDays: number): number {
  return now.getTime() - windowDays * 86_400_000;
}

export interface OfflinePriceSignal {
  craftTypeLabel: string;
  sampleSize: number;
  /** Per unit: amount / quantity, rounded. */
  median: number;
  min: number;
  max: number;
  windowDays: number;
}

/**
 * The artisan's real local price for one craft.
 *
 * Null when fewer than `MIN_PRICE_SAMPLES` rows fall inside the window — never
 * a number from one row. Median, not mean: one distress sale to a middleman
 * must not drag the signal down.
 */
export function buildPriceSignal(
  rows: OfflineSaleAmountRow[],
  craftTypeLabel = '',
  now: Date = new Date()
): OfflinePriceSignal | null {
  const since = windowStart(now, PRICE_SIGNAL_WINDOW_DAYS);
  const units = rows
    .filter((row) => new Date(row.soldAt).getTime() >= since)
    .map(unitPrice)
    .filter((v): v is number => v !== null);
  if (units.length < MIN_PRICE_SAMPLES) return null;
  const mid = median(units);
  if (mid === null) return null;
  return {
    craftTypeLabel,
    sampleSize: units.length,
    median: mid,
    min: rupees(Math.min(...units)),
    max: rupees(Math.max(...units)),
    windowDays: PRICE_SIGNAL_WINDOW_DAYS,
  };
}

/** Per-unit realised price for a piece sold ONLINE, for the honest comparison. */
export function onlineUnitPrice(item: {
  salePrice?: number | null;
  askingPrice?: number | null;
}): number | null {
  const price = Number(item.salePrice ?? item.askingPrice);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export interface OnlineSaleRow {
  salePrice?: number | null;
  askingPrice?: number | null;
  soldAt: Date;
}

export interface OfflineComparison {
  craftTypeLabel: string;
  offlineMedian: number;
  onlineMedian: number;
  /** How much more (positive) or less (negative) the online median is, in whole percent. */
  deltaPct: number;
  onlineSampleSize: number;
  offlineSampleSize: number;
}

/**
 * The same craft, sold offline and sold online, from the artisan's own rows.
 *
 * Null below either threshold. Both sides use the same window, so an online
 * price from two years ago is never set against a haat price from last week.
 */
export function buildComparison(
  offlineRows: OfflineSaleAmountRow[],
  onlineRows: OnlineSaleRow[],
  craftTypeLabel: string,
  now: Date = new Date()
): OfflineComparison | null {
  const signal = buildPriceSignal(offlineRows, craftTypeLabel, now);
  if (!signal) return null;
  const since = windowStart(now, PRICE_SIGNAL_WINDOW_DAYS);
  const online = onlineRows
    .filter((row) => new Date(row.soldAt).getTime() >= since)
    .map(onlineUnitPrice)
    .filter((v): v is number => v !== null);
  if (online.length < MIN_ONLINE_SAMPLES) return null;
  const onlineMedian = median(online);
  if (onlineMedian === null || signal.median <= 0) return null;
  return {
    craftTypeLabel,
    offlineMedian: signal.median,
    onlineMedian,
    deltaPct: Math.round(((onlineMedian - signal.median) / signal.median) * 100),
    onlineSampleSize: online.length,
    offlineSampleSize: signal.sampleSize,
  };
}

/**
 * The per-unit amount above which a new sale is questioned before saving.
 * Uses the artisan's own median only when one legitimately exists.
 */
export function highAmountThreshold(ownMedianUnit: number | null): number {
  return ownMedianUnit !== null && ownMedianUnit > 0
    ? ownMedianUnit * HIGH_AMOUNT_MULTIPLE
    : HIGH_AMOUNT_WITHOUT_HISTORY;
}

// ---------------------------------------------------------------------------
// The request body, shared by the form, the offline queue and the route.
// ---------------------------------------------------------------------------

export interface OfflineSalePayload {
  craftItemId?: string | null;
  craftTypeLabel: string;
  /** Whole rupees for the whole line. */
  amount: number;
  quantity: number;
  channel: OfflineChannel;
  buyerName?: string | null;
  /** `YYYY-MM-DD`, the IST calendar day of the sale. */
  soldAt: string;
  notes?: string | null;
  captureMethod?: 'MANUAL' | 'VOICE';
  voiceLanguage?: string | null;
  /** The artisan saw the "this looks high" question and said the amount is right. */
  confirmHighAmount?: boolean;
}

/**
 * Error codes the route returns. The client maps each to an i18n key; the
 * English `error` string beside it is for logs and the audit trail.
 */
export type OfflineSaleErrorCode =
  | 'AMOUNT_INVALID'
  | 'AMOUNT_TOO_LARGE'
  | 'AMOUNT_HIGH'
  | 'QUANTITY_INVALID'
  | 'SOLD_AT_INVALID'
  | 'SOLD_AT_FUTURE'
  | 'SOLD_AT_TOO_OLD'
  | 'LABEL_REQUIRED'
  | 'PIECE_NOT_FOUND'
  | 'PIECE_NOT_YOURS'
  | 'PIECE_SOLD_ONLINE'
  | 'PIECE_ALREADY_SOLD'
  | 'PIECE_HAS_PLATFORM_MONEY'
  | 'UNDO_WINDOW_CLOSED'
  | 'NOT_FOUND';

/**
 * Codes that no amount of retrying will clear — the artisan has to change
 * something. The offline queue stops replaying a row that carries one.
 */
export const TERMINAL_OFFLINE_SALE_CODES: readonly OfflineSaleErrorCode[] = [
  'AMOUNT_INVALID',
  'AMOUNT_TOO_LARGE',
  'AMOUNT_HIGH',
  'QUANTITY_INVALID',
  'SOLD_AT_INVALID',
  'SOLD_AT_FUTURE',
  'SOLD_AT_TOO_OLD',
  'LABEL_REQUIRED',
  'PIECE_NOT_FOUND',
  'PIECE_NOT_YOURS',
  'PIECE_SOLD_ONLINE',
  'PIECE_ALREADY_SOLD',
  'PIECE_HAS_PLATFORM_MONEY',
];
