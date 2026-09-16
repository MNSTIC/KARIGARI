/**
 * An instant, offline read on whether a product photo is usable.
 *
 * Runs in the browser the moment a photo is taken, before the Gemini call, so
 * an artisan gets feedback while the network is still working — and gets it at
 * all when the network is not. It costs one small canvas and no request.
 *
 * IT ONLY EVER WARNS. The authoritative verdict is the server's
 * (`/api/items/vision-verify` + `adviseRetake()` in src/lib/photoGate.ts). A
 * local `unusable` never produces a retake prompt on its own: this is a
 * heuristic over a 256-pixel thumbnail, and a heuristic that stopped a capture
 * would be exactly the wall the product owner asked us not to build.
 *
 * Pure and dependency-free. Everything is computed on a thumbnail for the reason
 * `STATS_MAX_EDGE` documents in imageEnhance.ts: blur and exposure are
 * image-wide aggregates that barely move between 65 thousand and 1.4 million
 * pixels, and the full-size walk is ~20x the main-thread time.
 */

export type LocalExposure = 'ok' | 'dark' | 'blown';
export type LocalVerdict = 'good' | 'borderline' | 'unusable';

export interface LocalQuality {
  /** Variance of the Laplacian over luma. Higher is sharper. */
  blurScore: number;
  exposure: LocalExposure;
  verdict: LocalVerdict;
  /**
   * An i18n KEY, not a sentence — the caller translates it. Empty when the
   * photo is good and there is nothing to say.
   */
  hint: string;
}

/** Long edge of the analysis thumbnail. Same value, same reasoning, as STATS_MAX_EDGE. */
const ANALYSIS_MAX_EDGE = 256;

/*
 * THE THRESHOLDS — measured, not picked.
 *
 * Calibrated on 80 seeded product photos from public/seed, each measured as-is
 * and synthetically degraded, computing exactly what `assessPhotoLocally` does
 * (256 px long edge, luma, 4-neighbour Laplacian). Percentiles:
 *
 *   Laplacian variance      p05    p25    p50    p95
 *     sharp originals        656   1237   3073  12012
 *     mild softness          409    856   2052   8001   (a cheap sensor at arm's length)
 *     severe blur             14     28     74    209
 *
 *   Mean luma               p05    p50    p95
 *     normal                  59    116    150
 *     underexposed            10     20     27
 *     overexposed            184    223    249
 *
 *   Fraction of pixels >=240  normal p95 = 0.299   overexposed p50 = 0.575
 *
 * Full method and numbers: docs/PHOTO_STUDIO_SHOPIFY_V11_PLAN.md §3.
 */

/**
 * Below this, blur makes the craft genuinely hard to see.
 *
 * Above the median of severe blur (74), and 3.4x below the 5th percentile of
 * mild softness (409) — so it catches most truly blurred frames and none of the
 * soft ones a cheap phone produces.
 */
const BLUR_UNUSABLE = 120;

/**
 * Below this, the photo is soft enough to mention. Sits between severe blur's
 * 95th percentile (209) and mild softness's 5th (409), so a slightly soft photo
 * from a ₹6,000 phone still reads as `good` — the brief is explicit that it must.
 */
const BLUR_BORDERLINE = 300;

/** Normal photos never average below 59 (p05); every underexposed one is below 27 (p95). */
const DARK_MEAN_LUMA = 40;
/** …and a genuinely dark frame has most of itself crushed to black. */
const DARK_CRUSHED_FRACTION = 0.25;
/** Past this the frame is so dark there is nothing to recover. */
const UNUSABLE_MEAN_LUMA_DARK = 22;

/**
 * Blown highlights need BOTH a high mean and a large clipped area.
 *
 * Normal photos reach 30% clipped pixels at the 95th percentile — that is a
 * craft on a white seamless, which is exactly the look this studio produces. A
 * clipped-fraction rule alone would tell those artisans their photo was
 * overexposed.
 */
const BLOWN_MEAN_LUMA = 215;
const BLOWN_CLIPPED_FRACTION = 0.6;
const UNUSABLE_MEAN_LUMA_BLOWN = 235;
const UNUSABLE_CLIPPED_FRACTION = 0.8;

/** Luma at or below this counts as crushed shadow. */
const CRUSHED_LEVEL = 16;
/** Luma at or above this counts as a clipped highlight. */
const CLIPPED_LEVEL = 240;

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the image'));
    image.src = src;
  });
}

/** What a failed analysis reports: nothing measured, so nothing claimed. */
const UNMEASURED: LocalQuality = { blurScore: 0, exposure: 'ok', verdict: 'good', hint: '' };

/**
 * Blur and exposure for one photo. Never rejects.
 *
 * On any failure — an undecodable image, a canvas the browser will not read —
 * this reports `good` with no hint rather than inventing a problem. The caller
 * records that as `HEURISTIC` only when a measurement actually happened.
 */
export async function assessPhotoLocally(dataUrl: string): Promise<LocalQuality & { measured: boolean }> {
  if (typeof window === 'undefined' || !dataUrl) return { ...UNMEASURED, measured: false };

  try {
    const image = await loadImage(dataUrl);
    await yieldToBrowser();

    const scale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(image.width, image.height));
    const w = Math.max(3, Math.round(image.width * scale));
    const h = Math.max(3, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ...UNMEASURED, measured: false };

    // White ground so a transparent PNG measures as it will be seen, not as black.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0, w, h);

    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch {
      return { ...UNMEASURED, measured: false };
    }

    // ---- Pass 1: luma, exposure histogram ----------------------------------
    const luma = new Float32Array(w * h);
    let lumaSum = 0;
    let crushed = 0;
    let clipped = 0;
    for (let i = 0, p = 0; p < luma.length; i += 4, p += 1) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      luma[p] = y;
      lumaSum += y;
      if (y <= CRUSHED_LEVEL) crushed += 1;
      if (y >= CLIPPED_LEVEL) clipped += 1;
    }
    await yieldToBrowser();

    // ---- Pass 2: Laplacian variance ----------------------------------------
    // A sharp edge makes a large second derivative; blur flattens it. The
    // variance of the response over the frame is the classic focus measure.
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        const lap = luma[i - 1] + luma[i + 1] + luma[i - w] + luma[i + w] - 4 * luma[i];
        sum += lap;
        sumSq += lap * lap;
        n += 1;
      }
    }

    const pixels = luma.length;
    const meanLuma = lumaSum / pixels;
    const crushedFraction = crushed / pixels;
    const clippedFraction = clipped / pixels;
    const blurScore = n > 0 ? Math.max(0, sumSq / n - (sum / n) ** 2) : 0;

    const exposure: LocalExposure =
      meanLuma < DARK_MEAN_LUMA && crushedFraction > DARK_CRUSHED_FRACTION
        ? 'dark'
        : meanLuma > BLOWN_MEAN_LUMA && clippedFraction > BLOWN_CLIPPED_FRACTION
          ? 'blown'
          : 'ok';

    const unusable =
      blurScore < BLUR_UNUSABLE ||
      meanLuma < UNUSABLE_MEAN_LUMA_DARK ||
      (meanLuma > UNUSABLE_MEAN_LUMA_BLOWN && clippedFraction > UNUSABLE_CLIPPED_FRACTION);

    const verdict: LocalVerdict = unusable
      ? 'unusable'
      : blurScore < BLUR_BORDERLINE || exposure !== 'ok'
        ? 'borderline'
        : 'good';

    // Exposure first when both are wrong: a dark photo also measures as soft,
    // and "find more light" fixes both, whereas "hold still" fixes neither.
    const hint =
      verdict === 'good'
        ? ''
        : exposure === 'dark'
          ? 'photo_retake_dark'
          : exposure === 'blown'
            ? 'photo_retake_blown'
            : verdict === 'unusable'
              ? 'photo_retake_blurry'
              : 'photo_soft_blurry';

    return { blurScore: Math.round(blurScore), exposure, verdict, hint, measured: true };
  } catch {
    return { ...UNMEASURED, measured: false };
  }
}
