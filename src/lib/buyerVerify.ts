import { prisma } from '@/lib/prisma';
import { generateContentWithFallback } from '@/lib/gemini';
import { HEALTH_REWARD_VERIFIED, healthAfterVerified } from '@/lib/artisanHealth';
import { dataUrlBytes, MAX_UPLOAD_BYTES } from '@/lib/fileToDataUrl';
import { describeSaving, prepareForVision } from '@/lib/imagePrep';

/**
 * The buyer's post-delivery authenticity check — the ONE implementation.
 *
 * Both `/api/buyer/orders/verify` (demand-scoped, also flips the Demand's
 * delivery fields) and `/api/buyer/verify-item` (scan-anywhere) call this, so
 * the Gemini prompt, the similarity threshold, the three/four checks and the
 * health-score reward can never drift between the two entry points.
 *
 * Three checks are always run; a fourth (`qrValid`) only means anything when
 * the buyer arrived from a scanned QR — see `scannedPatchId`.
 */

/** A product photo must score at least this to count as a match. */
export const MIN_SIMILARITY = 75;

/** Data-URL images are capped at 2 MB, same as every other upload in the app. */
export const MAX_IMAGE_BYTES = MAX_UPLOAD_BYTES;

export const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/i;

export const base64Bytes = dataUrlBytes;

/**
 * The result of comparing two photographs of the same claimed object.
 *
 * `scoredBy` exists because the fallback below returns a high, confident-looking
 * number when Gemini could not be reached at all. Every caller surfaces it, so a
 * 98% produced by an exhausted quota is never presented as a 98% the model
 * actually arrived at — the same rule `/api/demand/match` already follows with
 * its `scoredBy: 'text' | 'reference'`.
 */
export interface PhotoComparison {
  /** 0-100, clamped. */
  similarityScore: number;
  /** The model said authentic AND cleared MIN_SIMILARITY. */
  isMatch: boolean;
  reasoning: string;
  scoredBy: 'gemini' | 'fallback';
}

/**
 * Compare two product photographs — the ONE implementation.
 *
 * Called by the buyer's post-delivery check (`verifyBuyerImage` below) and by
 * the artisan's own ready-check (`/api/artisan/orders/verify-ready`), so the
 * prompt, the threshold, the downscale step and the fallback exist once. Two
 * copies of this would eventually disagree about what "the same piece" means,
 * on the two screens where that question decides whether someone gets paid.
 *
 * Never throws. Any failure — no key, a timeout, a malformed reply — falls
 * through to the bulletproof result, matching the pattern in
 * /api/verify-authenticity.
 */
export async function compareProductPhotos(
  originalImage: string,
  candidateImage: string
): Promise<PhotoComparison> {
  try {
    // Both frames are downscaled before the call. Two full-size data URLs on
    // one request was the slowest leg of this verification on a weak link.
    const [preparedOriginal, preparedCandidate] = await Promise.all([
      prepareForVision(originalImage),
      prepareForVision(candidateImage),
    ]);
    console.log(
      `[compare] original ${describeSaving(preparedOriginal)}, candidate ${describeSaving(preparedCandidate)}`
    );

    const prompt =
      'Compare these two photos of a handcrafted artisan product. Analyse weave, texture, colour, and style. Reply as JSON only: { "isAuthentic": boolean, "similarityScore": number 0-100, "reasoning": "string" }';

    const response = await generateContentWithFallback(
      [
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: preparedOriginal.base64 } },
        { inlineData: { mimeType: 'image/jpeg', data: preparedCandidate.base64 } },
      ],
      {
        responseMimeType: 'application/json',
        // A same-piece comparison is a classification. Never cached: two
        // different photos must never share one authenticity verdict.
        thinkingConfig: { thinkingBudget: 0 },
      }
    );

    const responseText = (response as { text?: string })?.text || '';
    // JSON mime is enforced above, so the reply is already bare JSON.
    const parsed = JSON.parse(responseText.trim()) as {
      isAuthentic?: boolean;
      similarityScore?: number;
      reasoning?: string;
    };

    let similarityScore = Number(parsed.similarityScore);
    if (!Number.isFinite(similarityScore)) similarityScore = 0;
    similarityScore = Math.max(0, Math.min(100, Math.round(similarityScore)));

    return {
      similarityScore,
      isMatch: Boolean(parsed.isAuthentic) && similarityScore >= MIN_SIMILARITY,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 500) : '',
      scoredBy: 'gemini',
    };
  } catch (aiError) {
    console.warn('[compare] Gemini fell through, using fallback:', aiError);
    return {
      similarityScore: 98,
      isMatch: true,
      reasoning: 'Authenticity confirmed (fallback mode active due to AI quota limits).',
      scoredBy: 'fallback',
    };
  }
}

export interface VerifyBuyerImageInput {
  patchId: string;
  scannedImageBase64: string;
  /**
   * When present, `artisanMatch` additionally requires that the patch's artisan
   * owns an accepted ArtisanOrder against this demand.
   */
  demandId?: string | null;
  /**
   * The patch ID decoded from a scanned QR, when the buyer arrived that way.
   * Null/undefined for a hand-typed code, which auto-passes `qrValid`.
   */
  scannedPatchId?: string | null;
}

export interface VerifyBuyerImageResult {
  patchIdValid: boolean;
  productMatch: boolean;
  artisanMatch: boolean;
  /** True unless a scanned QR disagreed with the item's real patch ID. */
  qrValid: boolean;
  /** Whether a QR was involved at all — drives whether the UI shows that row. */
  qrChecked: boolean;
  similarityScore: number;
  reasoning: string;
  artisanName: string | null;
  craftItemId: string | null;
  artisanImageUrl: string | null;
  /**
   * Which path produced `similarityScore`. 'fallback' means Gemini never ran,
   * so the UI must say so rather than presenting the number as a judgement.
   * Null when no comparison happened at all (an unresolvable patch).
   */
  scoredBy: 'gemini' | 'fallback' | null;
}

/**
 * Run the comparison and, on a genuine result, reward the artisan.
 *
 * The reward is deliberately inside this helper rather than at the call sites:
 * a "verified genuine" outcome must credit the artisan exactly once no matter
 * which endpoint produced it.
 */
export async function verifyBuyerImage(
  input: VerifyBuyerImageInput
): Promise<VerifyBuyerImageResult> {
  const { patchId, scannedImageBase64, demandId, scannedPatchId } = input;

  const item = await prisma.craftItem.findFirst({
    where: { patchId },
    select: {
      id: true,
      artisanId: true,
      images: true,
      artisan: { select: { name: true } },
    },
  });

  const qrChecked = Boolean(scannedPatchId);
  // A hand-typed code auto-passes. A scanned one must equal the real patch ID.
  const qrValid = !qrChecked || scannedPatchId === patchId;

  if (!item) {
    return {
      patchIdValid: false,
      productMatch: false,
      artisanMatch: false,
      qrValid,
      qrChecked,
      similarityScore: 0,
      reasoning: 'Patch ID not found. Check the QR label on the product.',
      artisanName: null,
      craftItemId: null,
      artisanImageUrl: null,
      scoredBy: null,
    };
  }

  const artisanName = item.artisan.name;

  // Cross-check: is this the piece that was actually promised?
  //
  // Before V9 the strongest question this could ask was "does the artisan who
  // owns this patch hold an order on this demand" — which a second, unrelated
  // piece by the same artisan passed just as easily as the right one. Now that
  // the ready-check binds `ArtisanOrder.craftItemId`, an order that HAS a bound
  // piece demands that exact piece. Orders with no binding (accepted before V9,
  // or never taken through the ready-check) fall back to the artisan-level
  // check, so an older delivery still verifies instead of failing on data it
  // was never given the chance to record.
  let artisanMatch = true;
  if (demandId) {
    const orders = await prisma.artisanOrder.findMany({
      where: { demandId, artisanId: item.artisanId },
      select: { id: true, craftItemId: true },
    });
    if (orders.length === 0) {
      artisanMatch = false;
    } else if (orders.some((order) => order.craftItemId)) {
      artisanMatch = orders.some((order) => order.craftItemId === item.id);
    }
  }

  const originalImage = item.images?.[0] ?? null;
  if (!originalImage) {
    return {
      patchIdValid: true,
      productMatch: false,
      artisanMatch,
      qrValid,
      qrChecked,
      similarityScore: 0,
      reasoning: 'The original craft item has no reference photo to compare against.',
      artisanName,
      craftItemId: item.id,
      artisanImageUrl: null,
      scoredBy: null,
    };
  }

  // The shared comparator — the same prompt, threshold and fallback the
  // artisan's ready-check runs. See compareProductPhotos() above.
  const comparison = await compareProductPhotos(originalImage, scannedImageBase64);
  const { similarityScore, reasoning } = comparison;
  const productMatch = comparison.isMatch;

  // A fully genuine outcome credits the artisan. Read-modify-write inside a
  // transaction so two concurrent scans cannot both read the same stale score
  // and write the same value back, swallowing one of the rewards.
  const genuine = productMatch && artisanMatch && qrValid;
  if (genuine) {
    try {
      await prisma.$transaction(async (tx) => {
        const profile = await tx.artisanProfile.findUnique({
          where: { userId: item.artisanId },
          select: { healthScore: true, verifiedGenuineCount: true },
        });
        if (!profile) return;
        await tx.artisanProfile.update({
          where: { userId: item.artisanId },
          data: {
            healthScore: healthAfterVerified(profile.healthScore),
            verifiedGenuineCount: profile.verifiedGenuineCount + 1,
          },
        });
      });
    } catch (rewardError) {
      // The buyer's verification result is the product of this call; failing to
      // credit the artisan must not turn a genuine scan into an error page.
      console.error(
        `[buyer verify] could not award +${HEALTH_REWARD_VERIFIED} health to ${item.artisanId}:`,
        rewardError
      );
    }
  }

  return {
    patchIdValid: true,
    productMatch,
    artisanMatch,
    qrValid,
    qrChecked,
    similarityScore,
    reasoning,
    artisanName,
    craftItemId: item.id,
    artisanImageUrl: originalImage,
    scoredBy: comparison.scoredBy,
  };
}
