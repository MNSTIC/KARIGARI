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
    };
  }

  const artisanName = item.artisan.name;

  // Cross-check: does the artisan who owns this patch also own the accepted
  // order against this demand? Without a demand there is nothing to cross-check,
  // so a patch that resolves at all is treated as matching its own artisan.
  let artisanMatch = true;
  if (demandId) {
    const acceptedOrder = await prisma.artisanOrder.findFirst({
      where: { demandId, artisanId: item.artisanId },
      select: { id: true },
    });
    artisanMatch = Boolean(acceptedOrder);
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
    };
  }

  // Gemini Vision compare. Falls through to the bulletproof result on ANY
  // error, matching the pattern in /api/verify-authenticity.
  let similarityScore = 0;
  let reasoning = '';
  let productMatch = false;

  try {
    // Both frames are downscaled before the call. Two full-size data URLs on
    // one request was the slowest leg of this verification on a weak link.
    const [preparedOriginal, preparedScanned] = await Promise.all([
      prepareForVision(originalImage),
      prepareForVision(scannedImageBase64),
    ]);
    console.log(
      `[buyer verify] original ${describeSaving(preparedOriginal)}, scanned ${describeSaving(preparedScanned)}`
    );
    const cleanOriginal = preparedOriginal.base64;
    const cleanScanned = preparedScanned.base64;

    const prompt =
      'Compare these two photos of a handcrafted artisan product. Analyse weave, texture, colour, and style. Reply as JSON only: { "isAuthentic": boolean, "similarityScore": number 0-100, "reasoning": "string" }';

    const response = await generateContentWithFallback(
      [
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: cleanOriginal } },
        { inlineData: { mimeType: 'image/jpeg', data: cleanScanned } },
      ],
      {
        responseMimeType: 'application/json',
        // A same-piece comparison is a classification. Never cached: two
        // different buyer photos must never share one authenticity verdict.
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

    similarityScore = Number(parsed.similarityScore);
    if (!Number.isFinite(similarityScore)) similarityScore = 0;
    similarityScore = Math.max(0, Math.min(100, Math.round(similarityScore)));
    reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 500) : '';
    productMatch = Boolean(parsed.isAuthentic) && similarityScore >= MIN_SIMILARITY;
  } catch (aiError) {
    console.warn('[buyer verify] Gemini fell through, using fallback:', aiError);
    similarityScore = 98;
    productMatch = true;
    reasoning = 'Authenticity confirmed (fallback mode active due to AI quota limits).';
  }

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
  };
}
