/**
 * The artisan's skill stage — derived from their production record, never
 * stored, and explained in the same numbers it is computed from.
 *
 * A stage is a label an artisan (and later a buyer) will read as a claim about
 * them, so it is earned on all of its criteria at once, not on an average: a
 * weaver with forty listings and no sale is not "intermediate" at selling. The
 * progress figure follows the same rule — it is the ratio of the criterion
 * furthest from being met, so a bar at 80 % means every requirement is at least
 * 80 % done, not that one strong number is flattering three weak ones.
 *
 * Pure: no database, no clock, no AI. The counts come from
 * src/lib/skillStageRecord.ts (which reuses the credit record's definitions),
 * and every threshold below is exported, printed to the artisan as have/need,
 * and covered by src/lib/__tests__/skillStage.test.mjs. Phase 9 badges and any
 * credibility chip must call `resolveSkillStage` rather than restating these
 * thresholds.
 */

export type SkillStage = 'BEGINNER' | 'INTERMEDIATE' | 'PRO';

export const SKILL_STAGES: readonly SkillStage[] = ['BEGINNER', 'INTERMEDIATE', 'PRO'];

export interface StageInputs {
  /** CraftItem rows with `qrVerified` — pieces Karigari itself matched to a capture. */
  verifiedListings: number;
  /** Storefront pieces sold plus offline sales the artisan logged. */
  itemsSold: number;
  /**
   * Whole rupees that actually moved: released escrow tranches, settled demand
   * credits and logged offline sales. The three streams are summed only for this
   * threshold and are always shown separately beside it.
   */
  realisedEarnings: number;
  /** Demand orders delivered. Shown for context; no stage gates on it yet. */
  ordersDelivered: number;
  /** LearningProgress rows the artisan marked COMPLETED. */
  modulesCompleted: number;
}

/** The three money streams behind `realisedEarnings`, kept apart for display. */
export interface StageEarnings {
  /** Released escrow tranches (advance + final) — the Money tab's platform stream. */
  platform: number;
  /** Settled demand-order credits. */
  demand: number;
  /** Offline sales the artisan logged themselves. */
  offline: number;
}

/** A criterion is met when `have >= need` — thresholds are inclusive. */
export interface StageRequirement {
  key: StageCriterion;
  labelKey: string;
  have: number;
  need: number;
}

export interface StageResult {
  stage: SkillStage;
  /** The stage after this one, or null at PRO. */
  nextStage: SkillStage | null;
  /** 0..1 toward the NEXT stage. 1 when already PRO. */
  progress: number;
  /** The concrete, real gaps — only the unmet criteria, with have/need. */
  nextRequirements: StageRequirement[];
}

export type StageCriterion = 'verifiedListings' | 'itemsSold' | 'realisedEarnings' | 'modulesCompleted';

/** i18n key for each criterion's "have of need" line. */
export const STAGE_CRITERION_LABEL_KEYS: Record<StageCriterion, string> = {
  verifiedListings: 'learn_need_listings',
  itemsSold: 'learn_need_sales',
  realisedEarnings: 'learn_need_earnings',
  modulesCompleted: 'learn_need_modules',
};

// ---- INTERMEDIATE -----------------------------------------------------------
// Enough verified work to be a catalogue, and proof that someone paid for it.
export const INTERMEDIATE_MIN_LISTINGS = 5;
export const INTERMEDIATE_MIN_SALES = 1;

// ---- PRO --------------------------------------------------------------------
// A sustained, paying practice — and the artisan has also invested in learning.
export const PRO_MIN_LISTINGS = 20;
export const PRO_MIN_SALES = 10;
export const PRO_MIN_EARNINGS = 50_000;
export const PRO_MIN_MODULES = 3;

/** What each stage above BEGINNER requires, in the order the artisan sees it. */
export const STAGE_THRESHOLDS: Record<Exclude<SkillStage, 'BEGINNER'>, Partial<Record<StageCriterion, number>>> = {
  INTERMEDIATE: {
    verifiedListings: INTERMEDIATE_MIN_LISTINGS,
    itemsSold: INTERMEDIATE_MIN_SALES,
  },
  PRO: {
    verifiedListings: PRO_MIN_LISTINGS,
    itemsSold: PRO_MIN_SALES,
    realisedEarnings: PRO_MIN_EARNINGS,
    modulesCompleted: PRO_MIN_MODULES,
  },
};

const CRITERIA_ORDER: StageCriterion[] = ['verifiedListings', 'itemsSold', 'realisedEarnings', 'modulesCompleted'];

/** A count that is not a finite, non-negative number reads as zero. */
function count(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Every criterion a stage names, with the artisan's real have/need. */
export function requirementsFor(stage: Exclude<SkillStage, 'BEGINNER'>, inputs: StageInputs): StageRequirement[] {
  const thresholds = STAGE_THRESHOLDS[stage];
  return CRITERIA_ORDER.filter((key) => thresholds[key] !== undefined).map((key) => ({
    key,
    labelKey: STAGE_CRITERION_LABEL_KEYS[key],
    have: count(inputs[key]),
    need: thresholds[key] as number,
  }));
}

/**
 * 0..1 toward a stage: the smallest per-criterion ratio, each capped at 1.
 * Exactly 1 when every criterion is met — `have / need` with `have === need` is
 * 1 in floating point, and nothing here rounds.
 */
export function progressToward(stage: Exclude<SkillStage, 'BEGINNER'>, inputs: StageInputs): number {
  const ratios = requirementsFor(stage, inputs).map(({ have, need }) => (need > 0 ? Math.min(1, have / need) : 1));
  return ratios.length === 0 ? 1 : Math.min(...ratios);
}

function meets(stage: Exclude<SkillStage, 'BEGINNER'>, inputs: StageInputs): boolean {
  return requirementsFor(stage, inputs).every(({ have, need }) => have >= need);
}

export function resolveSkillStage(inputs: StageInputs): StageResult {
  // PRO's thresholds are each at least INTERMEDIATE's, so meeting PRO implies
  // meeting INTERMEDIATE; checking both keeps that true if the numbers change.
  const stage: SkillStage =
    meets('INTERMEDIATE', inputs) && meets('PRO', inputs)
      ? 'PRO'
      : meets('INTERMEDIATE', inputs)
        ? 'INTERMEDIATE'
        : 'BEGINNER';

  if (stage === 'PRO') {
    return { stage, nextStage: null, progress: 1, nextRequirements: [] };
  }

  const nextStage = stage === 'BEGINNER' ? 'INTERMEDIATE' : 'PRO';
  return {
    stage,
    nextStage,
    progress: progressToward(nextStage, inputs),
    nextRequirements: requirementsFor(nextStage, inputs).filter(({ have, need }) => have < need),
  };
}

/** The learning level that suits a stage, used to order suggestions. */
export type LearningLevel = 'basic' | 'growing' | 'advanced';

export const LEARNING_LEVELS: readonly LearningLevel[] = ['basic', 'growing', 'advanced'];

export const LEVEL_FOR_STAGE: Record<SkillStage, LearningLevel> = {
  BEGINNER: 'basic',
  INTERMEDIATE: 'growing',
  PRO: 'advanced',
};

export function isSkillStage(value: unknown): value is SkillStage {
  return typeof value === 'string' && (SKILL_STAGES as readonly string[]).includes(value);
}
