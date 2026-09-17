import crypto from 'crypto';

/**
 * Anonymous visit analytics: the one salted-IP digest, and the search-term
 * normaliser behind `MarketplaceSearch`.
 *
 * Server-only — it imports `crypto`. The storefront decides on its own side
 * whether a term is long enough to log; the route re-checks with the rules
 * below, which are the ones that count.
 */

/** Shorter terms are keystrokes on the way to a word, not searches. */
export const MIN_SEARCH_TERM_LENGTH = 3;

/** Anything longer is not a product search, and is never stored whole. */
export const MAX_SEARCH_TERM_LENGTH = 80;

/** The same term from the same visitor inside this window is one search, not a trend. */
export const SEARCH_REPEAT_WINDOW_MINUTES = 10;

/**
 * A search box's text as the one form it is stored in: control characters
 * removed, trimmed, lower-cased, internal whitespace collapsed, clamped to 80
 * characters. Null when too short to count. Non-Latin scripts are kept as they
 * are — "दुपट्टा" is a real search.
 */
export function normaliseSearchTerm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const term = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_SEARCH_TERM_LENGTH)
    .trim();
  return term.length >= MIN_SEARCH_TERM_LENGTH ? term : null;
}

/** The caller's address as the platform reports it, or null. */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  return ip || null;
}

/**
 * Salted digest of the caller's IP.
 *
 * The only question these digests answer is "was this the same visitor twice",
 * and a raw address would be collecting far more than that needs. Salted with
 * `JWT_SECRET` so they are not reversible with a rainbow table of the IPv4
 * space. The output is byte-for-byte what `AffiliateClick.ipHash` has always
 * stored, so existing rows still compare.
 */
export function saltedIpHash(req: Request): string | null {
  const ip = clientIp(req);
  if (!ip) return null;
  const salt = process.env.JWT_SECRET || 'karigari-affiliate';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}
