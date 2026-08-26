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

/**
 * Create a DEMAND_ALERT for every artisan whose craft matches this demand.
 *
 * Idempotent: an artisan who already has a notification for this demand is
 * skipped, so re-posting or re-opening insights never double-alerts anyone.
 * Returns the number of rows actually written.
 */
export async function notifyArtisansForDemand(
  demand: DemandLike,
  opts: { channel?: string; maxRecipients?: number } = {}
): Promise<number> {
  const { channel = 'WHATSAPP', maxRecipients = 25 } = opts;

  const profiles = await prisma.artisanProfile.findMany({
    select: { userId: true, craftType: true, clusterName: true, mobileNumber: true },
  });

  const matched = profiles
    .map((p) => ({ ...p, score: craftMatchScore(p.craftType, demand.craftType) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRecipients);

  if (matched.length === 0) return 0;

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
      // No message is actually sent anywhere — the channel records how the
      // artisan would be reached, and drives the simulation's header.
      channel: m.mobileNumber ? channel : 'IN_APP',
    }));

  if (rows.length === 0) return 0;
  const created = await prisma.notification.createMany({ data: rows });
  return created.count;
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
