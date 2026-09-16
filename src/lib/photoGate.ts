/**
 * Should we ask the artisan to retake this photo?
 *
 * The ONE implementation of the quality gate's decision table
 * (docs/PHOTO_STUDIO_SHOPIFY_V11_PLAN.md §2). The server derives `retakeAdvice`
 * with it and the capture modal re-applies it with the artisan's retake count,
 * so the two can never disagree about what counts as unusable.
 *
 * LENIENT BY INSTRUCTION. Marginal artisans often own poor cameras, and a photo
 * they cannot improve must never be a wall. So:
 *   - RETAKE is reserved for a photo that is genuinely unusable;
 *   - even then "Use this photo anyway" is always offered, as an equal choice;
 *   - after ONE retake the gate never prompts again, whatever the score;
 *   - a check that did not actually run can never produce RETAKE.
 *
 * Pure: no React, no Prisma, no fetch. Safe on the server and in the browser.
 */

export type Blur = 'none' | 'mild' | 'severe';
export type Exposure = 'ok' | 'dark' | 'blown';
export type RetakeAdvice = 'PASS' | 'SOFT' | 'RETAKE';
/** AI = Gemini actually scored the frame. FALLBACK = it did not (unreadable reply). */
export type ScoreSource = 'AI' | 'FALLBACK';

export interface GateInput {
  scoreSource: ScoreSource;
  match: boolean;
  /** 1-10. */
  score: number;
  blur: Blur;
  exposure: Exposure;
  /** How many times the artisan has already retaken this photo. */
  retakeCount?: number;
}

export interface GateVerdict {
  advice: RetakeAdvice;
  /**
   * An i18n KEY explaining the verdict, or '' for a silent pass. Kept as a key
   * so the server never has to know the artisan's language.
   */
  reasonKey: string;
}

/**
 * The specific reason for a photo that needs attention.
 *
 * Ordered so the most fixable, most concrete cause is named. Exposure outranks
 * blur because a dark frame also reads as soft, and "find more light" fixes
 * both while "hold still" fixes neither.
 */
function reasonFor(input: GateInput, severity: 'retake' | 'soft'): string {
  if (severity === 'retake') {
    if (!input.match) return 'photo_retake_mismatch';
    if (input.exposure === 'dark') return 'photo_retake_dark';
    if (input.exposure === 'blown') return 'photo_retake_blown';
    if (input.blur === 'severe') return 'photo_retake_blurry';
    return 'photo_retake_unclear';
  }
  if (input.exposure === 'dark') return 'photo_soft_dark';
  if (input.exposure === 'blown') return 'photo_soft_blown';
  if (input.blur !== 'none') return 'photo_soft_blurry';
  return 'photo_soft_generic';
}

/** True for a photo that is genuinely unusable — rule 3 of the table. */
function isUnusable(input: GateInput): boolean {
  return (
    !input.match ||
    input.blur === 'severe' ||
    input.score <= 3 ||
    (input.exposure !== 'ok' && input.score <= 4)
  );
}

export function adviseRetake(input: GateInput): GateVerdict {
  // Rule 1. A fallback is not a verdict, so it cannot refuse a photo. The
  // caller surfaces the on-device heuristic's hint instead, as advice only.
  if (input.scoreSource === 'FALLBACK') return { advice: 'PASS', reasonKey: '' };

  if (isUnusable(input)) {
    // Rule 2. One retake is the whole of the nagging. Past it the same concern
    // is still shown, but as advice the artisan does not have to act on.
    if ((input.retakeCount ?? 0) >= 1) {
      return { advice: 'SOFT', reasonKey: reasonFor(input, 'retake') };
    }
    // Rule 3.
    return { advice: 'RETAKE', reasonKey: reasonFor(input, 'retake') };
  }

  // Rule 4. Mild blur at a good score is a cheap sensor, not a problem worth
  // mentioning — which is why `blur` is only required not to be severe here.
  if (input.score >= 7 && input.exposure === 'ok') {
    return { advice: 'PASS', reasonKey: '' };
  }

  // Rule 5. The common case for an ordinary phone photo: usable, with a tip.
  return { advice: 'SOFT', reasonKey: reasonFor(input, 'soft') };
}

export function coerceBlur(value: unknown): Blur {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v === 'mild' || v === 'severe' ? v : 'none';
}

export function coerceExposure(value: unknown): Exposure {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v === 'dark' || v === 'blown' ? v : 'ok';
}
