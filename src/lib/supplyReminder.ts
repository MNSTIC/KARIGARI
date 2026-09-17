import { prisma } from '@/lib/prisma';
import {
  cooldownCutoff,
  decideReminder,
  snoozeUntil,
  supplyReminderMessage,
  supplyReminderTitle,
  SUPPLY_NOTIFICATION_TYPE,
  type ReminderFacts,
  type SupplyCheckResult,
} from '@/lib/supplyReminderRules';

/**
 * The database side of the restock nudge.
 *
 * There is no cron in this repo and this does not add one. The check runs
 * lazily on a request the artisan is already making — the dashboard — exactly
 * as `notifyArtisanOfFestival()` runs on the insights request, and it is
 * idempotent: ten dashboard loads in a minute write one notification.
 *
 * Idempotency is not left to a read-then-write race. The reminder is *claimed*
 * with a conditional `updateMany` on the artisan's own SupplyReminderState row
 * (`lastRemindedAt` null or older than the cooldown). Postgres settles who won;
 * only the winner writes the Notification.
 *
 * The arithmetic and the wording live in the pure src/lib/supplyReminderRules.ts.
 */

/** Demand-order and offline-sale activity count too: this is their real life, not their listings. */
async function gatherFacts(artisanId: string, now: Date): Promise<ReminderFacts> {
  const [user, newestItem, newestOfflineSale, newestOrder, state] = await Promise.all([
    prisma.user.findUnique({
      where: { id: artisanId },
      select: { createdAt: true, artisanProfile: { select: { userId: true } } },
    }),
    prisma.craftItem.findFirst({
      where: { artisanId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.offlineSale.findFirst({
      where: { artisanId },
      orderBy: { soldAt: 'desc' },
      select: { soldAt: true },
    }),
    prisma.artisanOrder.findFirst({
      where: { artisanId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.supplyReminderState.findUnique({
      where: { artisanId },
      select: { lastRemindedAt: true, snoozedUntil: true },
    }),
  ]);

  const activity = [newestItem?.createdAt, newestOfflineSale?.soldAt, newestOrder?.createdAt].filter(
    (date): date is Date => date instanceof Date
  );

  return {
    now,
    accountCreatedAt: user?.createdAt ?? null,
    hasProfile: Boolean(user?.artisanProfile),
    lastActivityAt: activity.length ? new Date(Math.max(...activity.map((d) => d.getTime()))) : null,
    lastRemindedAt: state?.lastRemindedAt ?? null,
    snoozedUntil: state?.snoozedUntil ?? null,
  };
}

/** Create the bookkeeping row if it is missing. A lost race is not an error. */
async function ensureState(artisanId: string): Promise<void> {
  try {
    await prisma.supplyReminderState.upsert({
      where: { artisanId },
      create: { artisanId },
      update: {},
      select: { id: true },
    });
  } catch (error) {
    if ((error as { code?: string })?.code !== 'P2002') throw error;
  }
}

/**
 * Read-only: what the dashboard shows inline, with nothing written.
 *
 * The card and the notification must agree, so this runs the same decision over
 * the same facts; it simply stops before the write.
 */
export async function readSupplyStatus(artisanId: string, now: Date = new Date()): Promise<SupplyCheckResult> {
  return decideReminder(await gatherFacts(artisanId, now));
}

/**
 * Idempotent. Safe to call on every dashboard load, and safe to call ten times
 * at once.
 */
export async function checkSupplyReminder(artisanId: string, now: Date = new Date()): Promise<SupplyCheckResult> {
  const facts = await gatherFacts(artisanId, now);
  const decision = decideReminder(facts);
  if (!decision.created || decision.idleDays === null) return decision;

  await ensureState(artisanId);

  // The claim. Only one caller can move `lastRemindedAt` past the cooldown, so
  // only one caller writes the alert.
  const claimed = await prisma.supplyReminderState.updateMany({
    where: {
      artisanId,
      OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lt: cooldownCutoff(now) } }],
    },
    data: { lastRemindedAt: now, remindCount: { increment: 1 } },
  });
  if (claimed.count === 0) return { ...decision, created: false, reason: 'COOLDOWN' };

  // Belt and braces for rows written before this table existed: an alert inside
  // the cooldown window means the artisan has already been told.
  const recent = await prisma.notification.findFirst({
    where: { userId: artisanId, type: SUPPLY_NOTIFICATION_TYPE, createdAt: { gte: cooldownCutoff(now) } },
    select: { id: true },
  });
  if (recent) return { ...decision, created: false, reason: 'COOLDOWN' };

  await prisma.notification.create({
    data: {
      userId: artisanId,
      type: SUPPLY_NOTIFICATION_TYPE,
      // English in the row, translated at render — the convention every other
      // notification in this table follows.
      title: supplyReminderTitle(decision.idleDays),
      message: supplyReminderMessage(decision.idleDays),
      channel: 'IN_APP',
    },
  });

  return decision;
}

/** "Remind me later": quiet for SNOOZE_DAYS, then this expires by itself. */
export async function snoozeSupplyReminder(artisanId: string, now: Date = new Date()): Promise<Date> {
  const until = snoozeUntil(now);
  await prisma.supplyReminderState.upsert({
    where: { artisanId },
    create: { artisanId, snoozedUntil: until },
    update: { snoozedUntil: until },
    select: { id: true },
  });
  return until;
}
