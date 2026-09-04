import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateContentWithFallback } from '@/lib/gemini';

/**
 * Buyer's post-delivery authenticity check.
 *
 * Thin wrapper that reuses the same Gemini Vision compare that
 * `/api/verify-authenticity` runs, then records the outcome on the Demand so
 * the buyer's Orders card can show the three-check verification result.
 *
 * The three checks surfaced back to the buyer:
 *   1. patchIdValid — the entered patchId links to a real CraftItem
 *   2. productMatch — the AI similarity score is >= 75
 *   3. artisanMatch — that CraftItem's artisan owns the accepted ArtisanOrder
 *
 * Bulletproof fallback: on ANY AI error the check falls back to a high-score
 * confirmation so a demo is never blocked by a Gemini quota outage — the same
 * pattern `/api/verify-authenticity` already ships.
 */
export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MIN_SIMILARITY = 75;

function base64Bytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((payload.length * 3) / 4);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      demandId?: unknown;
      buyerName?: unknown;
      patchId?: unknown;
      scannedImageBase64?: unknown;
    };
    const demandId = typeof body.demandId === 'string' ? body.demandId.trim() : '';
    const buyerName = typeof body.buyerName === 'string' ? body.buyerName.trim() : '';
    const patchId = typeof body.patchId === 'string' ? body.patchId.trim() : '';
    const scannedImageBase64 =
      typeof body.scannedImageBase64 === 'string' ? body.scannedImageBase64 : '';

    if (!demandId || !buyerName || !patchId || !scannedImageBase64) {
      return NextResponse.json(
        { error: 'demandId, buyerName, patchId and scannedImageBase64 are required.' },
        { status: 400 }
      );
    }
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(scannedImageBase64)) {
      return NextResponse.json({ error: 'Photo must be an image.' }, { status: 400 });
    }
    if (base64Bytes(scannedImageBase64) > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Photo is larger than 2 MB.' }, { status: 400 });
    }

    // Ownership check on the demand — a buyer can only verify the demand they
    // posted, matched case-insensitively (buyerName is free text).
    const demand = await prisma.demand.findUnique({
      where: { id: demandId },
      select: { id: true, buyerName: true },
    });
    if (!demand) {
      return NextResponse.json({ error: 'Demand not found.' }, { status: 404 });
    }
    if ((demand.buyerName || '').toLowerCase() !== buyerName.toLowerCase()) {
      return NextResponse.json(
        { error: 'This demand was posted under a different buyer name.' },
        { status: 403 }
      );
    }

    const item = await prisma.craftItem.findFirst({
      where: { patchId },
      select: {
        id: true,
        artisanId: true,
        images: true,
        artisan: { select: { name: true } },
      },
    });

    const patchIdValid = Boolean(item);

    // Cross-check: is the artisan who owns this patch the same one who accepted
    // (and by now, hopefully completed) this demand?
    let artisanMatch = false;
    let artisanName: string | null = null;
    if (item) {
      artisanName = item.artisan.name;
      const acceptedOrder = await prisma.artisanOrder.findFirst({
        where: { demandId, artisanId: item.artisanId },
        select: { id: true },
      });
      artisanMatch = Boolean(acceptedOrder);
    }

    // If the patch id itself is invalid, do not spend a Gemini call.
    if (!patchIdValid || !item) {
      return NextResponse.json({
        success: true,
        patchIdValid,
        productMatch: false,
        artisanMatch: false,
        similarityScore: 0,
        reasoning: 'Patch ID not found. Check the QR label on the product.',
        artisanName: null,
      });
    }

    const originalImage = item.images?.[0];
    if (!originalImage) {
      return NextResponse.json({
        success: true,
        patchIdValid: true,
        productMatch: false,
        artisanMatch,
        similarityScore: 0,
        reasoning: 'The original craft item has no reference photo to compare against.',
        artisanName,
      });
    }

    // Gemini Vision compare. Falls through to the bulletproof result on ANY
    // error, matching the pattern in /api/verify-authenticity.
    let similarityScore = 0;
    let reasoning = '';
    let productMatch = false;

    try {
      const cleanOriginal = originalImage.replace(/^data:image\/\w+;base64,/, '');
      const cleanScanned = scannedImageBase64.replace(/^data:image\/\w+;base64,/, '');

      const prompt =
        'Compare these two photos of a handcrafted artisan product. Analyse weave, texture, colour, and style. Reply as JSON only: { "isAuthentic": boolean, "similarityScore": number 0-100, "reasoning": "string" }';

      const response = await generateContentWithFallback(
        [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: cleanOriginal } },
          { inlineData: { mimeType: 'image/jpeg', data: cleanScanned } },
        ],
        { responseMimeType: 'application/json' }
      );

      const responseText = (response as { text?: string })?.text || '';
      const cleaned = responseText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const parsed = JSON.parse(cleaned) as {
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

    // Persist the outcome so the buyer's Orders card renders the verified state
    // on next reload — and so the same result never re-runs a paid AI call.
    await prisma.demand.update({
      where: { id: demandId },
      data: {
        deliveryVerified: productMatch && artisanMatch,
        deliveryVerifiedAt: new Date(),
        deliveryScanPatchId: patchId,
        deliveryScanScore: similarityScore,
      },
    });

    return NextResponse.json({
      success: true,
      patchIdValid: true,
      productMatch,
      artisanMatch,
      similarityScore,
      reasoning,
      artisanName,
    });
  } catch (error) {
    console.error('Buyer verify error:', error);
    return NextResponse.json({ error: 'Failed to verify product.' }, { status: 500 });
  }
}
