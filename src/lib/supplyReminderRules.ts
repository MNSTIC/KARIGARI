/**
 * When an idle artisan should be nudged about raw material and credit — and
 * what that nudge says.
 *
 * Pure: no database, no clock of its own, no AI. Every decision is a function
 * of dates that already exist (their newest catalogue entry, offline sale or
 * demand order, when they joined, when they were last reminded, whether they
 * asked for quiet), so the same facts always give the same answer and
 * src/lib/__tests__/supplyReminder.test.mjs can check the edges without a
 * database. The queries and the writes live in src/lib/supplyReminder.ts.
 *
 * The tone this encodes matters as much as the arithmetic: it fires at most
 * once a fortnight, never for a new account, never while snoozed, and never for
 * someone who is selling at haats but not listing online. A nudge that arrives
 * when the artisan is in fact working is worse than no nudge at all.
 */

/** Days of no new catalogue entry, offline sale or demand order before a nudge. */
export const SUPPLY_IDLE_DAYS = 20;
/** Never nudge an account younger than this — a new artisan is not "idle". */
export const MIN_ACCOUNT_AGE_DAYS = 21;
/** Minimum gap between two reminders, so this can never become nagging. */
export const REMINDER_COOLDOWN_DAYS = 14;
/** How long "remind me later" lasts. */
export const SNOOZE_DAYS = 7;

/** The Notification.type these rows carry. */
export const SUPPLY_NOTIFICATION_TYPE = 'SUPPLY_REMINDER';

export type SupplyReason = 'CREATED' | 'ACTIVE' | 'TOO_NEW' | 'COOLDOWN' | 'SNOOZED' | 'NO_PROFILE';

export interface SupplyCheckResult {
  created: boolean;
  reason: SupplyReason;
  /** Days since the artisan last did anything; null when it cannot be known. */
  idleDays: number | null;
  lastActivityAt: Date | null;
  /** Set while a "remind me later" is still running. */
  snoozedUntil: Date | null;
}

/** Everything the decision needs, gathered by the caller in one round trip. */
export interface ReminderFacts {
  now: Date;
  accountCreatedAt: Date | null;
  hasProfile: boolean;
  /** Newest of: a catalogue entry, an offline sale, a demand order. */
  lastActivityAt: Date | null;
  lastRemindedAt: Date | null;
  snoozedUntil: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two instants, floored, never negative. */
export function wholeDaysBetween(from: Date | string | number, to: Date | string | number): number {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/**
 * How long this artisan has been quiet.
 *
 * With no activity at all, the count runs from the day they joined: someone who
 * signed up two months ago and has never catalogued anything is exactly who this
 * feature is for. Null only when neither date exists.
 */
export function idleDaysFrom(facts: Pick<ReminderFacts, 'now' | 'lastActivityAt' | 'accountCreatedAt'>): number | null {
  const since = facts.lastActivityAt ?? facts.accountCreatedAt;
  return since ? wholeDaysBetween(since, facts.now) : null;
}

/**
 * Should a reminder be written right now, and if not, why not.
 *
 * Order matters and is deliberate: an artisan with no profile is mid-registration,
 * a young account is not idle, a snooze is a direct request, real activity beats
 * everything, and the cooldown is the last guard before writing.
 */
export function decideReminder(facts: ReminderFacts): SupplyCheckResult {
  const idleDays = idleDaysFrom(facts);
  const base = { created: false, idleDays, lastActivityAt: facts.lastActivityAt, snoozedUntil: facts.snoozedUntil };

  if (!facts.hasProfile) return { ...base, reason: 'NO_PROFILE' };

  const accountAge = facts.accountCreatedAt ? wholeDaysBetween(facts.accountCreatedAt, facts.now) : 0;
  if (accountAge < MIN_ACCOUNT_AGE_DAYS) return { ...base, reason: 'TOO_NEW' };

  if (facts.snoozedUntil && facts.snoozedUntil.getTime() > facts.now.getTime()) {
    return { ...base, reason: 'SNOOZED' };
  }

  if (idleDays === null || idleDays < SUPPLY_IDLE_DAYS) return { ...base, reason: 'ACTIVE' };

  if (facts.lastRemindedAt && wholeDaysBetween(facts.lastRemindedAt, facts.now) < REMINDER_COOLDOWN_DAYS) {
    return { ...base, reason: 'COOLDOWN' };
  }

  return { ...base, created: true, reason: 'CREATED' };
}

/** The instant a reminder written now may next be repeated. */
export function cooldownCutoff(now: Date): Date {
  return new Date(now.getTime() - REMINDER_COOLDOWN_DAYS * DAY_MS);
}

export function snoozeUntil(now: Date): Date {
  return new Date(now.getTime() + SNOOZE_DAYS * DAY_MS);
}

/**
 * Stored notification text is English, like every other row in this table.
 *
 * `Notification` has no params column, so the day count travels inside the
 * title and the clients parse it back out to render the sentence in the
 * artisan's own language (see src/lib/supplyNotice.ts). The format below and
 * `parseIdleDays` are therefore one contract: change one and you change the
 * other. A row whose title does not parse still renders — as the English it
 * was stored as.
 */
export function supplyReminderTitle(idleDays: number): string {
  return `No new listing in ${idleDays} days`;
}

export function supplyReminderMessage(idleDays: number): string {
  return `Nothing new has been catalogued in ${idleDays} days. Browse verified raw material, or check the credit schemes you qualify for.`;
}

/** The day count back out of a stored title, or null when it is not one of ours. */
export function parseIdleDays(title: string): number | null {
  const match = /(\d{1,5})\s+days?\b/i.exec(title || '');
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isFinite(days) ? days : null;
}
