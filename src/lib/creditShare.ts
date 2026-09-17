/**
 * Bank share links for the production record — the constants and the pure
 * helpers both the route and the card read, so the form's limits and the
 * server's limits can never disagree.
 */

/** How long a new link works when the artisan does not choose. */
export const SHARE_DEFAULT_DAYS = 30;
/** Longest a link may work. A loan file rarely stays open longer than a quarter. */
export const SHARE_MAX_DAYS = 90;
export const SHARE_MIN_DAYS = 1;
/** The choices the share form offers. Every one lies within MIN..MAX. */
export const SHARE_DAY_OPTIONS: readonly number[] = [7, 30, 90];
/**
 * Live links per artisan. A handful covers every branch they might visit; more
 * than that is a link list nobody is tracking, so the artisan revokes first.
 */
export const MAX_ACTIVE_SHARES = 5;
export const MAX_SHARED_WITH_LENGTH = 80;

/** Two UUIDs, hyphens removed. */
export const SHARE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The capability in the link. Two `crypto.randomUUID()` values concatenated —
 * 244 random bits — and deliberately nothing derived from the artisan's id, so
 * one link says nothing about any other.
 */
export function newShareToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '').toLowerCase();
}

export function isShareToken(value: unknown): value is string {
  return typeof value === 'string' && SHARE_TOKEN_PATTERN.test(value);
}

/**
 * The requested lifetime in whole days. Absent → the default; anything that is
 * not a whole number within MIN..MAX → null, so the route can refuse it instead
 * of quietly handing out a link that lives longer than the artisan asked.
 */
export function parseShareDays(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return SHARE_DEFAULT_DAYS;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  if (n < SHARE_MIN_DAYS || n > SHARE_MAX_DAYS) return null;
  return n;
}

/** Who the link is for, in the artisan's words: control characters out, whitespace collapsed, capped. */
export function cleanSharedWith(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_SHARED_WITH_LENGTH)
    .trim();
  return text || null;
}

export function creditSharePath(token: string): string {
  return `/credit/${token}`;
}

/** A share is live until it is revoked or its expiry passes. */
export function isShareActive(share: { revokedAt: Date | string | null; expiresAt: Date | string }, now: Date = new Date()): boolean {
  return !share.revokedAt && new Date(share.expiresAt).getTime() > now.getTime();
}
