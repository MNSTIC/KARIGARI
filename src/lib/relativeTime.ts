/**
 * "2 min ago", in whichever language the artisan reads.
 *
 * Returns an i18n key and a number, never a formatted English string and never
 * `Intl.RelativeTimeFormat` with an implicit locale: the four dictionaries own
 * the wording, and a locale the server guesses would differ from the one the
 * browser picks and throw a hydration mismatch.
 *
 * Pure, and deliberately coarse. Seconds are not shown — an artisan does not
 * need to know their work synced 43 seconds ago, and a ticking counter would be
 * a reason to re-render every second on a phone that is trying to save battery.
 */

export const REL_JUST_NOW = 'rel_just_now';
export const REL_MINUTES = 'rel_minutes';
export const REL_HOURS = 'rel_hours';
export const REL_DAYS = 'rel_days';

export interface RelativeTime {
  key: string;
  /** The number to interpolate. Zero for "just now", which takes no number. */
  value: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Under a minute — and anything in the future — reads as "just now". */
export const JUST_NOW_MS = MINUTE_MS;

/**
 * How long ago `then` was, as a key and a number.
 *
 * A timestamp in the future is a clock that disagrees with the server's, not a
 * sync that has not happened yet, so it clamps to "just now" rather than
 * rendering a negative age.
 */
export function relativeKeyAndValue(elapsedMs: number): RelativeTime {
  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  if (elapsed < JUST_NOW_MS) return { key: REL_JUST_NOW, value: 0 };
  if (elapsed < HOUR_MS) return { key: REL_MINUTES, value: Math.floor(elapsed / MINUTE_MS) };
  if (elapsed < DAY_MS) return { key: REL_HOURS, value: Math.floor(elapsed / HOUR_MS) };
  return { key: REL_DAYS, value: Math.floor(elapsed / DAY_MS) };
}

/** The same thing from two instants, for callers holding a timestamp. */
export function relativeSince(then: number, now: number = Date.now()): RelativeTime {
  return relativeKeyAndValue(now - then);
}
