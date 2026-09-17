import { parseIdleDays, SUPPLY_NOTIFICATION_TYPE } from '@/lib/supplyReminderRules';

/**
 * Rendering a stored restock reminder in the artisan's own language.
 *
 * Notification rows are stored in English — every row in that table is, and this
 * phase does not change that convention. `Notification` has no params column, so
 * the day count travels inside the English title ("No new listing in 23 days")
 * and is parsed back out here. A row whose title does not parse, or a dictionary
 * missing the key, falls through to the stored English rather than rendering a
 * blank or a raw key.
 *
 * Used by the header bell and the notifications page, so the two can never drift
 * into wording the reminder differently.
 */

export interface SupplyNoticeText {
  title: string;
  message: string;
  /** Null when the stored title could not be parsed; the English text is used then. */
  days: number | null;
}

export function isSupplyNotice(type: string): boolean {
  return type === SUPPLY_NOTIFICATION_TYPE;
}

export function supplyNoticeText(
  note: { type: string; title: string; message: string },
  t: (key: string) => string
): SupplyNoticeText | null {
  if (!isSupplyNotice(note.type)) return null;

  const days = parseIdleDays(note.title);
  if (days === null) return { title: note.title, message: note.message, days: null };

  const fill = (key: string, fallback: string) => {
    const template = t(key);
    // A missing key renders as the key itself; that is a visible bug, so the
    // stored English is shown instead.
    return template && template !== key ? template.split('{days}').join(String(days)) : fallback;
  };

  return {
    title: fill('notif_supply_title', note.title),
    message: fill('notif_supply_body', note.message),
    days,
  };
}
