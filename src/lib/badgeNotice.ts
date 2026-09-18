import { BADGE_NOTIFICATION_TYPE, badgeDefinition, parseBadgeTitle, type BadgeKey } from '@/lib/badges';

/**
 * Rendering a stored "badge earned" alert in the artisan's own language.
 *
 * Notification rows are English — every row in that table is, and `Notification`
 * has no params column — so the badge travels inside the English title
 * ("Badge earned: First sale") and is parsed back out here, exactly as the
 * restock reminder parses its day count (src/lib/supplyNotice.ts).
 *
 * A row whose title does not parse, or a dictionary missing the key, falls
 * through to the stored English rather than rendering a blank or a raw key.
 *
 * Used by the header bell and the notifications page, so the two can never
 * drift into wording the same alert differently.
 */

export interface BadgeNoticeText {
  key: BadgeKey;
  title: string;
  message: string;
}

export function badgeNoticeText(
  note: { type: string; title: string; message: string },
  t: (key: string) => string
): BadgeNoticeText | null {
  if (note.type !== BADGE_NOTIFICATION_TYPE) return null;

  const key = parseBadgeTitle(note.title);
  if (!key) return null;

  const definition = badgeDefinition(key);
  // A missing key renders as the key itself; that is a visible bug, so the
  // stored English is shown instead.
  const translate = (dictKey: string, fallback: string) => {
    const value = t(dictKey);
    return value && value !== dictKey ? value : fallback;
  };

  const label = translate(definition?.labelKey ?? '', definition?.english ?? key);
  const heading = translate('notif_badge_earned', note.title);

  return {
    key,
    title: heading.includes('{badge}') ? heading.split('{badge}').join(label) : `${heading}: ${label}`,
    // The stored body carries the figures in English ("sales 12"), which is the
    // row's own record of why it was written. What the artisan reads is the
    // translated sentence, and the frozen figures themselves are on the badge
    // chip in the recognition panel rather than retyped here.
    message: translate('notif_badge_body', note.message),
  };
}
