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
  // V9 structured capture. All optional so every existing caller — the
  // insights engine, the SMS replay — keeps compiling and simply scores on
  // fewer signals.
  material?: string | null;
  color?: string | null;
  category?: string | null;
  sizeSpec?: string | null;
  purchaseType?: string | null;
}

/** One artisan, as much of them as the matcher can legitimately read. */
export interface MatchProfile {
  craftType: string | null;
  location: string | null;
  clusterName: string | null;
  tags?: string[];
  /** How many pieces this artisan has captured. Feeds the capacity signal. */
  recentListingCount?: number;
}

export interface MatchBreakdown {
  /** 0-100, normalised over the signals the demand actually carries. */
  total: number;
  /**
   * Why this artisan was reached, in weight order. A signal the buyer left
   * blank produces no phrase, and neither does one that was present but did
   * not match — the artisan is never shown a reason that was not a reason.
   */
  reasons: string[];
}

/** Overlap of `needle`'s tokens found in `hay`, as 0-1. Null when nothing to test. */
function tokenOverlap(needle: string | null | undefined, hay: string): number | null {
  const terms = tokenize(needle);
  if (terms.length === 0) return null;
  const found = terms.filter((term) => hay.includes(term)).length;
  return found / terms.length;
}

/**
 * How near two place names are, as 0-1. Null when either side is missing.
 *
 * Deliberately crude: `ArtisanProfile.location` and `Demand.location` are both
 * free text ("Sambalpur", "Delhi NCR", "Bargarh, Odisha"), and there is no
 * geocoding anywhere in this app. An exact name is a full match, a substring
 * either way is a half — anything cleverer would be inventing precision the
 * data does not have.
 */
function placeProximity(demandPlace: string | null | undefined, profile: MatchProfile): number | null {
  const want = (demandPlace ?? '').toLowerCase().trim();
  if (!want) return null;
  const candidates = [profile.location, profile.clusterName]
    .map((v) => (v ?? '').toLowerCase().trim())
    .filter(Boolean);
  if (candidates.length === 0) return 0;
  if (candidates.some((c) => c === want)) return 1;
  if (candidates.some((c) => c.includes(want) || want.includes(c))) return 0.5;
  return 0;
}

/**
 * Multi-signal match between one artisan and one demand.
 *
 * Craft dominates at half the weight and is the only mandatory signal: an
 * artisan who scores zero on craft is not a match however well their colours
 * line up, so the caller drops them before the rest is even computed. That is
 * what stops a Dhokra caster being alerted to a saree request.
 *
 * Weights renormalise over the signals the buyer ACTUALLY filled in. A demand
 * with no colour specified must not rank a colour-tagged artisan above one who
 * simply has no tags, so an absent signal leaves both the numerator and the
 * denominator rather than scoring zero — the same rule `textScore()` in
 * /api/demand/match already follows.
 */
export function scoreArtisanForDemand(profile: MatchProfile, demand: DemandLike): MatchBreakdown {
  const craftRaw = craftMatchScore(profile.craftType, demand.craftType);
  if (craftRaw <= 0) return { total: 0, reasons: [] };

  const haystack = [profile.craftType ?? '', ...(profile.tags ?? [])].join(' ').toLowerCase();
  const tagsOnly = (profile.tags ?? []).join(' ').toLowerCase();

  const reasons: string[] = [];
  let earned = 0;
  let available = 0;

  /** Fold one signal in, skipping it entirely when the buyer left it blank. */
  const add = (weight: number, value: number | null, reason: string) => {
    if (value === null) return;
    available += weight;
    earned += weight * value;
    // Only a signal that actually contributed earns a phrase. A material the
    // artisan does not work in is not a reason they were matched.
    if (value > 0) reasons.push(reason);
  };

  add(50, Math.min(1, craftRaw / 100), `Your craft: ${profile.craftType ?? demand.craftType}`);
  add(15, tokenOverlap(demand.material, haystack), `Works in ${demand.material}`);
  add(10, tokenOverlap(demand.category, haystack), `Category: ${demand.category}`);
  add(10, tokenOverlap(demand.color, tagsOnly), `Has worked in ${demand.color}`);
  add(10, placeProximity(demand.location, profile), `Near ${demand.location}`);

  // Capacity. An individual purchase is one piece and every artisan can take
  // it, so it scores full marks rather than punishing a new maker for having a
  // short catalogue. A bulk request compares their output against roughly one
  // listing per ten units asked for.
  const individual = (demand.purchaseType ?? 'INDIVIDUAL') === 'INDIVIDUAL';
  const needed = Math.max(1, Math.ceil(demand.quantity / 10));
  const capacity = individual ? 1 : Math.min(1, (profile.recentListingCount ?? 0) / needed);
  add(5, capacity, `Capacity for ${demand.quantity} pieces`);

  return {
    total: available > 0 ? Math.round((earned / available) * 100) : 0,
    reasons,
  };
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
    select: {
      userId: true,
      craftType: true,
      clusterName: true,
      location: true,
      tags: true,
      mobileNumber: true,
    },
  });

  // Craft first, on its own, so the capacity lookup below only ever runs for
  // artisans who could plausibly take the job. Scoring the whole platform's
  // catalogue to rank people who were never candidates would be a query for
  // nothing.
  const craftEligible = profiles.filter((p) => craftMatchScore(p.craftType, demand.craftType) > 0);
  if (craftEligible.length === 0) return { created: 0, smsSent: 0 };

  // One grouped query rather than a count per artisan.
  const listingCounts = await prisma.craftItem.groupBy({
    by: ['artisanId'],
    where: { artisanId: { in: craftEligible.map((p) => p.userId) } },
    _count: { _all: true },
  });
  const countByArtisan = new Map(listingCounts.map((row) => [row.artisanId, row._count._all]));

  const matched = craftEligible
    .map((p) => {
      const breakdown = scoreArtisanForDemand(
        { ...p, recentListingCount: countByArtisan.get(p.userId) ?? 0 },
        demand
      );
      return { ...p, score: breakdown.total, reasons: breakdown.reasons };
    })
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
      // The match reason rides on `message` rather than a column of its own:
      // the bell and the notifications page both already render this field
      // verbatim, and the SMS body is built separately by buildDemandSms(), so
      // a new column would mean a second render path on both surfaces for no
      // gain. Omitted entirely when craft was the only thing that matched —
      // "Why you: your craft" tells the artisan nothing.
      message:
        m.reasons.length > 1
          ? `${demandAlertMessage(demand)}\nWhy you: ${m.reasons.join(' · ')}`
          : demandAlertMessage(demand),
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
    // The one V9 field worth 160 characters. Category, purchase type and the
    // flexibility matrix change nothing about whether an artisan replies "1",
    // and each costs room the price band cannot afford to lose.
    sizeSpec: demand.sizeSpec,
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
