import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  base64Bytes,
  IMAGE_DATA_URL_RE,
  MAX_IMAGE_BYTES,
  verifyBuyerImage,
} from '@/lib/buyerVerify';

/**
 * Buyer's post-delivery authenticity check, scoped to one Demand.
 *
 * The comparison itself lives in `src/lib/buyerVerify.ts` and is shared with
 * `/api/buyer/verify-item` (the scan-anywhere flow), so the prompt, the
 * similarity threshold and the artisan health reward exist in exactly one
 * place. What is unique to THIS route is the demand ownership check and the
 * write-back onto `Demand.deliveryVerified` / `deliveryScanScore`.
 *
 * The three checks surfaced back to the buyer:
 *   1. patchIdValid — the entered patchId links to a real CraftItem
 *   2. productMatch — the AI similarity score is >= MIN_SIMILARITY
 *   3. artisanMatch — that CraftItem's artisan owns the accepted ArtisanOrder
 */
export const dynamic = 'force-dynamic';

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
    if (!IMAGE_DATA_URL_RE.test(scannedImageBase64)) {
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

    const result = await verifyBuyerImage({
      patchId,
      scannedImageBase64,
      demandId,
    });

    // A patch that does not resolve never touches the Demand — there is nothing
    // truthful to record against it.
    if (!result.patchIdValid) {
      return NextResponse.json({ success: true, ...result });
    }

    // Persist the outcome so the buyer's Orders card renders the verified state
    // on next reload — and so the same result never re-runs a paid AI call.
    await prisma.demand.update({
      where: { id: demandId },
      data: {
        deliveryVerified: result.productMatch && result.artisanMatch,
        deliveryVerifiedAt: new Date(),
        deliveryScanPatchId: patchId,
        deliveryScanScore: result.similarityScore,
      },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Buyer verify error:', error);
    return NextResponse.json({ error: 'Failed to verify product.' }, { status: 500 });
  }
}
