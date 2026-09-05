/**
 * Artisan health-score arithmetic — the single source of truth.
 *
 * The score lives on `ArtisanProfile.healthScore`. Exactly two events move it:
 *
 *   +HEALTH_REWARD_VERIFIED  a buyer scanned a delivered piece and the AI
 *                            confirmed it genuine (src/lib/buyerVerify.ts)
 *   -HEALTH_PENALTY_GUILTY   an admin resolved a buyer's ticket GUILTY
 *                            (src/app/api/admin/tickets/[id]/resolve/route.ts)
 *
 * Every reader and writer imports these constants. A literal `15` or `2.5`
 * anywhere else is a bug: the two call sites would drift the moment one of them
 * is tuned, and the artisan-facing copy that quotes the numbers would start
 * lying about what actually happened to their account.
 */

/** Deducted from `healthScore` on each GUILTY verdict. */
export const HEALTH_PENALTY_GUILTY = 15;

/** Added to `healthScore` on each verified-genuine buyer scan. */
export const HEALTH_REWARD_VERIFIED = 2.5;

/** Hard ceiling. A perfect record never exceeds this. */
export const HEALTH_MAX = 100;

/** Hard floor. The score never goes negative, however many verdicts land. */
export const HEALTH_MIN = 0;

/** Clamp any candidate score into [HEALTH_MIN, HEALTH_MAX]. */
export function clampHealth(score: number): number {
  if (!Number.isFinite(score)) return HEALTH_MIN;
  return Math.min(HEALTH_MAX, Math.max(HEALTH_MIN, score));
}

/**
 * The score after one verified-genuine scan. Capped, so an artisan sitting at
 * 99 lands on 100 rather than 101.5.
 */
export function healthAfterVerified(current: number): number {
  return clampHealth(current + HEALTH_REWARD_VERIFIED);
}

/**
 * The score after one GUILTY verdict. Floored, so an artisan sitting at 5 lands
 * on 0 rather than -10.
 */
export function healthAfterGuilty(current: number): number {
  return clampHealth(current - HEALTH_PENALTY_GUILTY);
}
