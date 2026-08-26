import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { generateContentWithFallback } from '@/lib/gemini';
import { upcomingFestivals } from '@/lib/festivals';
import { craftMatchScore, notifyArtisanOfFestival, notifyArtisansForDemand } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

/** How far ahead a festival still counts as "coming up". */
const FESTIVAL_HORIZON_DAYS = 45;
/** Give up rather than block the insights page on a slow model. */
const GEMINI_TIMEOUT_MS = 20_000;

/**
 * Latency-first order, same reasoning as the voice assistant: the shared
 * FALLBACK_MODELS list leads with gemini-3.7-flash, which has been answering
 * 503 and pushing this past its timeout. 3.5-flash answers in time.
 */
const INSIGHTS_MODELS = ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite'];

interface Recommendation {
  trigger: string;
  headline: string;
  action: string;
  priceMin: number | null;
  priceMax: number | null;
  /** 'gemini' when the model answered, 'rules' when we fell back to the raw facts. */
  source: 'gemini' | 'rules';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let decoded: AuthToken;
  try {
    decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  if (decoded.role !== 'ARTISAN') {
    return NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 });
  }

  try {
    const [profile, openDemands, myItems, listedCount] = await Promise.all([
      prisma.artisanProfile.findUnique({
        where: { userId: decoded.userId },
        select: { craftType: true, clusterName: true, location: true, mobileNumber: true },
      }),
      prisma.demand.findMany({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.craftItem.findMany({
        where: { artisanId: decoded.userId },
        select: { marketPriceMin: true, marketPriceMax: true, fairWageFloor: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      // The number shown beside the artisan's own pin: their real published
      // supply, not "the 20 rows we happened to read for the price band".
      prisma.craftItem.count({
        where: { artisanId: decoded.userId, isListedOnMarketplace: true },
      }),
    ]);

    const craftType = profile?.craftType || null;

    // ---- Fact 1: demand pressure on this artisan's craft ------------------
    const matching = openDemands
      .map((d) => ({ demand: d, score: craftMatchScore(craftType, d.craftType) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || b.demand.createdAt.getTime() - a.demand.createdAt.getTime())
      .map((m) => m.demand);

    const totalQuantity = matching.reduce((sum, d) => sum + d.quantity, 0);
    const buyerCeilings = matching.map((d) => d.targetPriceMax).filter((v): v is number => !!v);
    const buyerFloors = matching.map((d) => d.targetPriceMin).filter((v): v is number => !!v);

    // ---- Fact 2: festivals close enough to matter ------------------------
    const festivals = upcomingFestivals({ withinDays: FESTIVAL_HORIZON_DAYS, craftType });
    const festival = festivals[0] ?? null;

    // ---- Fact 3: this artisan's own valuation band -----------------------
    // The AI's price suggestion is clamped into this, so it can never invent a
    // number detached from what their own items have actually been valued at.
    const priced = myItems.filter((i) => i.marketPriceMin && i.marketPriceMax);
    const ownMin = priced.length
      ? Math.round(priced.reduce((s, i) => s + (i.marketPriceMin || 0), 0) / priced.length)
      : null;
    const ownMax = priced.length
      ? Math.round(priced.reduce((s, i) => s + (i.marketPriceMax || 0), 0) / priced.length)
      : null;

    const floorCandidates = [ownMin, ...buyerFloors].filter((v): v is number => !!v && v > 0);
    const ceilingCandidates = [ownMax, ...buyerCeilings].filter((v): v is number => !!v && v > 0);
    const hasBand = floorCandidates.length > 0 && ceilingCandidates.length > 0;
    const bandFloor = hasBand ? Math.round(Math.min(...floorCandidates) * 0.8) : 0;
    const bandCeiling = hasBand ? Math.round(Math.max(...ceilingCandidates) * 1.25) : 0;

    // ---- Notify the matched artisans (real rows, not a toast) ------------
    let notificationsCreated = 0;
    try {
      for (const demand of matching.slice(0, 5)) {
        notificationsCreated += await notifyArtisansForDemand(demand);
      }
      if (festival && craftType) {
        const wrote = await notifyArtisanOfFestival(decoded.userId, festival, craftType);
        if (wrote) notificationsCreated += 1;
      }
    } catch (notifyError) {
      console.error('Insights notification write failed:', notifyError);
    }

    // ---- The recommendation ---------------------------------------------
    const factSheet = [
      `Artisan craft: ${craftType || 'unspecified'}`,
      `Cluster: ${profile?.clusterName || profile?.location || 'unspecified'}`,
      festival
        ? `Upcoming festival: ${festival.name} in ${festival.daysAway} days. ${festival.demandNote}`
        : 'Upcoming festival: none inside the next 45 days.',
      matching.length
        ? `Open buyer demands matching this craft: ${matching.length}, totalling ${totalQuantity} units. ` +
          matching
            .slice(0, 4)
            .map(
              (d) =>
                `${d.quantity}x ${d.craftType} in ${d.location || 'unspecified location'} at ` +
                `${d.targetPriceMin ?? '?'}-${d.targetPriceMax ?? '?'} per unit` +
                `${d.festival ? ` for ${d.festival}` : ''}`
            )
            .join('; ')
        : 'Open buyer demands matching this craft: none right now.',
      hasBand
        ? `This artisan's own items are valued between Rs ${ownMin ?? bandFloor} and Rs ${ownMax ?? bandCeiling} per unit. Any price you suggest must stay between Rs ${bandFloor} and Rs ${bandCeiling}.`
        : 'No valuation history for this artisan yet — leave the price band null.',
    ].join('\n');

    // Built from the DB facts alone. It is the answer whenever the model is
    // slow, rate-limited or unreachable — never a placeholder or invented copy.
    const fallbackRecommendation = (): Recommendation => {
      if (matching.length > 0) {
        const top = matching[0];
        return {
          trigger: `${matching.length} open buyer demand${matching.length === 1 ? '' : 's'} for ${craftType || 'your craft'}`,
          headline: `Buyers are asking for ${totalQuantity} units of ${craftType || 'your craft'} right now — the largest is ${top.quantity} units in ${top.location || 'an unnamed city'}${top.festival ? ` for ${top.festival}` : ''}.`,
          action: 'List your finished stock on ONDC before quoting a middleman.',
          priceMin: top.targetPriceMin ?? null,
          priceMax: top.targetPriceMax ?? null,
          source: 'rules',
        };
      }
      if (festival) {
        return {
          trigger: `${festival.name} in ${festival.daysAway} days`,
          headline: `${festival.name} is ${festival.daysAway} days away. ${festival.demandNote}`,
          action: 'Capture and list your stock now so buyers can find it.',
          priceMin: ownMin,
          priceMax: ownMax,
          source: 'rules',
        };
      }
      return {
        trigger: 'No live demand signal',
        headline: `No buyer is asking for ${craftType || 'your craft'} today, and no festival falls inside the next ${FESTIVAL_HORIZON_DAYS} days.`,
        action: 'List an item on ONDC to start building a buyer history.',
        priceMin: ownMin,
        priceMax: ownMax,
        source: 'rules',
      };
    };

    let recommendation = fallbackRecommendation();

    try {
      const result = await Promise.race([
        generateContentWithFallback(
          [
            {
              text: `You advise a marginalized Indian handloom/handicraft artisan inside the KARIGARI app.

Here are the ONLY facts you may use. Do not invent buyers, cities, percentages or festivals that are not listed.

${factSheet}

Write a short market recommendation as raw JSON:
{"trigger": "the one signal that drives this, e.g. 'Diwali in 21 days' or 'No live demand'",
 "headline": "one sentence, max 30 words, plain language, no percentages you were not given",
 "action": "one concrete next step the artisan can take inside this app, max 20 words",
 "priceMin": number or null,
 "priceMax": number or null}

Rules: if there is no matching demand and no near festival, say so honestly and suggest listing on ONDC to build a buyer history. Never promise a sale.`,
            },
          ],
          {
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 },
          },
          INSIGHTS_MODELS
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini timed out')), GEMINI_TIMEOUT_MS)
        ),
      ]);

      const raw = (result as { text?: string })?.text || '';
      const parsed = JSON.parse(
        raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
      );

      if (parsed?.headline) {
        const min = Number(parsed.priceMin);
        const max = Number(parsed.priceMax);
        recommendation = {
          trigger: String(parsed.trigger || recommendation.trigger).slice(0, 120),
          headline: String(parsed.headline).slice(0, 400),
          action: String(parsed.action || recommendation.action).slice(0, 200),
          priceMin: hasBand && Number.isFinite(min) && min > 0 ? clamp(Math.round(min), bandFloor, bandCeiling) : null,
          priceMax: hasBand && Number.isFinite(max) && max > 0 ? clamp(Math.round(max), bandFloor, bandCeiling) : null,
          source: 'gemini',
        };
      }
    } catch (aiError) {
      // Deliberately non-fatal: the facts below are real either way, so the
      // card still shows a DB-derived recommendation rather than an error.
      console.warn('Insights AI unavailable, using rule-based recommendation:', aiError);
    }

    return NextResponse.json({
      success: true,
      craftType,
      cluster: profile?.clusterName || profile?.location || null,
      profileLocation: profile?.location || null,
      hasMobileNumber: Boolean(profile?.mobileNumber),
      festival,
      upcomingFestivals: festivals,
      demand: {
        matchingCount: matching.length,
        totalQuantity,
        openCount: openDemands.length,
        topDemands: matching.slice(0, 5),
      },
      ownSupply: listedCount,
      priceBand: hasBand ? { floor: bandFloor, ceiling: bandCeiling } : null,
      recommendation,
      notificationsCreated,
    });
  } catch (error) {
    console.error('Artisan insights API error:', error);
    return NextResponse.json({ error: 'Failed to build market insights' }, { status: 500 });
  }
}
