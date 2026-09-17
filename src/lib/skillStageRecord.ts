import { prisma } from '@/lib/prisma';
import { gatherCreditInputs } from '@/lib/creditRecord';
import { resolveSkillStage, type StageEarnings, type StageInputs, type StageResult } from '@/lib/skillStage';

/**
 * The database side of the skill stage.
 *
 * Server-only (it imports Prisma). The counts are the credit record's own
 * (`gatherCreditInputs`), so "verified listings" and "sales" mean exactly what
 * they mean on the Credit record tab and the two screens can never disagree;
 * the only extra read is how many lessons the artisan marked done.
 */

export interface StageRecord {
  inputs: StageInputs;
  earnings: StageEarnings;
  result: StageResult;
}

/** STARTED | COMPLETED, as stored on LearningProgress.status. */
export const LEARNING_STATUS_STARTED = 'STARTED';
export const LEARNING_STATUS_COMPLETED = 'COMPLETED';

export async function gatherStageRecord(artisanId: string, now: Date = new Date()): Promise<StageRecord> {
  const [credit, modulesCompleted] = await Promise.all([
    gatherCreditInputs(artisanId, now),
    prisma.learningProgress.count({ where: { artisanId, status: LEARNING_STATUS_COMPLETED } }),
  ]);

  const earnings: StageEarnings = {
    platform: credit.realisedEarnings,
    demand: credit.demandEarnings,
    offline: Math.round(credit.offlineEarnings),
  };

  const inputs: StageInputs = {
    verifiedListings: credit.verifiedListings,
    itemsSold: credit.soldCount + credit.offlineSalesCount,
    realisedEarnings: earnings.platform + earnings.demand + earnings.offline,
    ordersDelivered: credit.ordersDelivered,
    modulesCompleted,
  };

  return { inputs, earnings, result: resolveSkillStage(inputs) };
}
