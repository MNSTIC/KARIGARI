import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { gatherCreditInputs } from '@/lib/creditRecord';
import { readBadgeRecord } from '@/lib/badgeRecord';
import { resolveSkillStage } from '@/lib/skillStage';
import { LEARNING_STATUS_COMPLETED } from '@/lib/skillStageRecord';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/artisan/recognition
 *
 * "Where I stand": the Phase 5 skill stage, the badges this artisan has earned
 * from their own record, and the real gap on the ones they have not.
 *
 * Evaluating is a write — a newly true criterion awards the badge and writes the
 * bell alert — so this is deliberately a GET the artisan makes about themselves
 * and nobody else. There is no path here that takes a badge key from the caller:
 * `readBadgeRecord` reads rows and decides for itself.
 *
 * The credit inputs are gathered once and handed to both halves, so the stage
 * and the badges cannot disagree about how many pieces were sold, and the
 * fourteen aggregate queries behind them run once per request rather than twice.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const now = new Date();
    const [credit, modulesCompleted] = await Promise.all([
      gatherCreditInputs(artisanId, now),
      prisma.learningProgress.count({ where: { artisanId, status: LEARNING_STATUS_COMPLETED } }),
    ]);

    const earnings = {
      platform: credit.realisedEarnings,
      demand: credit.demandEarnings,
      offline: Math.round(credit.offlineEarnings),
    };
    const stageInputs = {
      verifiedListings: credit.verifiedListings,
      itemsSold: credit.soldCount + credit.offlineSalesCount,
      realisedEarnings: earnings.platform + earnings.demand + earnings.offline,
      ordersDelivered: credit.ordersDelivered,
      modulesCompleted,
    };

    const badges = await readBadgeRecord(artisanId, now, credit);

    return NextResponse.json({
      success: true,
      stage: { inputs: stageInputs, earnings, result: resolveSkillStage(stageInputs) },
      badges: { earned: badges.earned, locked: badges.locked },
    });
  } catch (error) {
    console.error('[recognition] failed:', error);
    return NextResponse.json({ success: false, error: 'Could not load your recognition.' }, { status: 500 });
  }
}
