/**
 * Matching + notification writing shared by the demand board and the market
 * insights engine.
 *
 * Both entry points create the SAME `Notification` rows, so an alert an artisan
 * sees in the bell dropdown is the same row the WhatsApp/SMS simulation replays
 * — there is no second, cosmetic notion of "alert" anywhere in the app.
 */

import { prisma } from '@/lib/prisma';
import type { Festival } from '@/lib/festivals';
import { buildDemandSms, sendSms, toE164 } from '@/lib/sms';

/** Words too generic to identify a craft on their own. */
const WEAK_TOKENS = new Set([
  'silk',
  'cotton',
  'wool',
  'saree',
  'sarees',
  'set',
  'sets',
  'craft',
  'crafts',
  'handmade',
  'handloom',
  'traditional',
  'item',
  'items',
]);

function tokenize(value?: string | null): string[] {
  return (value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 3);
}

/**
 * How well an artisan's craft matches a demand's craft.
 * 0 = no match. Strong tokens (e.g. "sambalpuri") outrank weak ones ("silk"),
 * so a Sambalpuri weaver ranks above every other silk weaver on a Sambalpuri
 * demand instead of the whole silk cluster being alerted equally.
 */
export function craftMatchScore(artisanCraft?: string | null, demandCraft?: string | null): number {
  const a = (artisanCraft ?? '').toLowerCase().trim();
  const d = (demandCraft ?? '').toLowerCase().trim();
  if (!a || !d) return 0;
  if (a === d) return 100;
  if (a.includes(d) || d.includes(a)) return 50;

  const artisanTokens = new Set(tokenize(a));
  let score = 0;
  for (const tok of tokenize(d)) {
    if (!artisanTokens.has(tok)) continue;
    score += WEAK_TOKENS.has(tok) ? 1 : 10;
  }
  return score;
}

export interface DemandLike {
  id: string;
  craftType: string;
  quantity: number;
  targetPriceMin: number | null;
  targetPriceMax: number | null;
  location: string | null;
  festival: string | null;
  buyerName: string | null;
}

function priceBand(demand: DemandLike): string {
  const { targetPriceMin: min, targetPriceMax: max } = demand;
  if (min && max) return `Rs ${min.toLocaleString('en-IN')}-${max.toLocaleString('en-IN')} per unit`;
  if (max) return `up to Rs ${max.toLocaleString('en-IN')} per unit`;
  if (min) return `from Rs ${min.toLocaleString('en-IN')} per unit`;
  return 'price open to quote';
}

/** The exact line the bell, the SMS Auto-Pilot card and the simulation all show. */
export function demandAlertMessage(demand: DemandLike): string {
  const buyer = demand.buyerName || 'A verified buyer';
  const where = demand.location ? ` in ${demand.location}` : '';
  const when = demand.festival ? ` for ${demand.festival}` : '';
  return `${buyer} wants ${demand.quantity} ${demand.craftType} pieces${where} at ${priceBand(
    demand
  )}${when}. Reply YES to list your stock.`;
}

export interface DemandFanoutResult {
  /** Notification rows written. */
  created: number;
  /** Of those, how many also went out as a real SMS. */
  smsSent: number;
}

/**
 * Create a DEMAND_ALERT for every artisan whose craft matches this demand, and
 * text the ones who have a mobile number on file.
 *
 * Idempotent: an artisan who already has a notification for this demand is
 * skipped, so re-posting or re-opening insights never double-alerts anyone and
 * never sends a second SMS.
 *
 * The SMS half is best-effort. It runs after the rows are committed and every
 * failure is swallowed, because reaching an artisan is worth attempting but
 * never worth failing the buyer's demand post over.
 */
export async function notifyArtisansForDemand(
  demand: DemandLike,
  opts: { channel?: string; maxRecipients?: number; sendSms?: boolean } = {}
): Promise<DemandFanoutResult> {
  const { channel = 'WHATSAPP', maxRecipients = 25, sendSms: withSms = true } = opts;

  const profiles = await prisma.artisanProfile.findMany({
    select: { userId: true, craftType: true, clusterName: true, mobileNumber: true },
  });

  const matched = profiles
    .map((p) => ({ ...p, score: craftMatchScore(p.craftType, demand.craftType) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRecipients);

  if (matched.length === 0) return { created: 0, smsSent: 0 };

  const already = await prisma.notification.findMany({
    where: { relatedDemandId: demand.id, userId: { in: matched.map((m) => m.userId) } },
    select: { userId: true },
  });
  const alreadyIds = new Set(already.map((n) => n.userId));

  const rows = matched
    .filter((m) => !alreadyIds.has(m.userId))
    .map((m) => ({
      userId: m.userId,
      type: 'DEMAND_ALERT',
      title: `Demand spike: ${demand.craftType}`,
      message: demandAlertMessage(demand),
      relatedDemandId: demand.id,
      // Provisional: an artisan with a number is expected to be reached on
      // `channel`, and the row is corrected to 'SMS' below once one actually
      // goes out. Without a number the only route is the in-app bell.
      channel: m.mobileNumber ? channel : 'IN_APP',
    }));

  if (rows.length === 0) return { created: 0, smsSent: 0 };
  const created = await prisma.notification.createMany({ data: rows });

  if (!withSms) return { created: created.count, smsSent: 0 };

  // Only the artisans who were newly notified on this call, so a re-post never
  // texts someone twice.
  const freshRecipients = matched.filter(
    (m) => !alreadyIds.has(m.userId) && m.mobileNumber
  );

  const body = buildDemandSms({
    buyerName: demand.buyerName,
    quantity: demand.quantity,
    craftType: demand.craftType,
    location: demand.location,
    priceLabel: priceBand(demand),
  });

  let smsSent = 0;
  for (const recipient of freshRecipients) {
    try {
      const result = await sendSms(toE164(recipient.mobileNumber), body);
      if (!('sid' in result)) continue;

      smsSent += 1;
      // Record the delivery against the row the artisan will see in the bell,
      // so an SMS reply can be traced back to the alert that prompted it.
      await prisma.notification.updateMany({
        where: { userId: recipient.userId, relatedDemandId: demand.id },
        data: { outboundSid: result.sid, channel: 'SMS' },
      });
    } catch (e) {
      // Deliberately swallowed: see the note on this function.
      console.warn('[sms] demand alert failed for', recipient.userId, (e as Error)?.message);
    }
  }

  return { created: created.count, smsSent };
}

/**
 * Create a FESTIVAL nudge for one artisan, at most once per festival.
 * Returns true when a row was written.
 */
export async function notifyArtisanOfFestival(
  userId: string,
  festival: Festival & { daysAway: number },
  craftType?: string | null
): Promise<boolean> {
  const title = `${festival.name} is ${festival.daysAway === 0 ? 'today' : `${festival.daysAway} days away`}`;

  const existing = await prisma.notification.findFirst({
    where: { userId, type: 'FESTIVAL', title },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.notification.create({
    data: {
      userId,
      type: 'FESTIVAL',
      title,
      message: `${festival.demandNote}${craftType ? ` Your ${craftType} stock is in demand — list it now.` : ''}`,
      channel: 'IN_APP',
    },
  });
  return true;
}
