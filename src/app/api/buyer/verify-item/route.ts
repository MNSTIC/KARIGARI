import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  base64Bytes,
  IMAGE_DATA_URL_RE,
  MAX_IMAGE_BYTES,
  verifyBuyerImage,
} from '@/lib/buyerVerify';

/**
 * Scan-anywhere buyer verification.
 *
 * Distinct from `/api/buyer/orders/verify`, which is scoped to one Demand and
 * mutates that Demand's delivery fields. This flow starts from a QR scan or a
 * hand-typed patch ID and works for any purchased piece, so it looks the item
 * up by `patchId` alone.
 *
 * The comparison, the similarity threshold and the artisan health reward are
 * the SAME code path both routes call — `verifyBuyerImage()` in
 * `src/lib/buyerVerify.ts`. When a `demandId` is supplied AND it belongs to
 * this buyer, the Demand is updated too, so a scan started from a delivered
 * order still records delivery verification exactly as the older route does.
 *
 * `craftItemId` and `artisanImageUrl` come back because a failed check feeds
 * straight into `POST /api/buyer/tickets`, which needs both.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      patchId?: unknown;
      buyerName?: unknown;
      scannedImageBase64?: unknown;
      demandId?: unknown;
      scannedPatchId?: unknown;
    };

    const patchId = typeof body.patchId === 'string' ? body.patchId.trim() : '';
    const buyerName = typeof body.buyerName === 'string' ? body.buyerName.trim() : '';
    const scannedImageBase64 =
      typeof body.scannedImageBase64 === 'string' ? body.scannedImageBase64 : '';
    const demandId = typeof body.demandId === 'string' ? body.demandId.trim() : '';
    const scannedPatchId =
      typeof body.scannedPatchId === 'string' && body.scannedPatchId.trim()
        ? body.scannedPatchId.trim()
        : null;

    if (!patchId || !buyerName || !scannedImageBase64) {
      return NextResponse.json(
        { error: 'patchId, buyerName and scannedImageBase64 are required.' },
        { status: 400 }
      );
    }
    if (!IMAGE_DATA_URL_RE.test(scannedImageBase64)) {
      return NextResponse.json({ error: 'Photo must be an image.' }, { status: 400 });
    }
    if (base64Bytes(scannedImageBase64) > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Photo is larger than 2 MB.' }, { status: 400 });
    }

    // A demand is optional here. When one is supplied it only counts if this
    // buyer actually posted it — otherwise it is ignored rather than rejected,
    // because the scan itself is still a legitimate thing to run.
    let ownedDemandId: string | null = null;
    if (demandId) {
      const demand = await prisma.demand.findUnique({
        where: { id: demandId },
        select: { id: true, buyerName: true },
      });
      if (demand && (demand.buyerName || '').toLowerCase() === buyerName.toLowerCase()) {
        ownedDemandId = demand.id;
      }
    }

    const result = await verifyBuyerImage({
      patchId,
      scannedImageBase64,
      demandId: ownedDemandId,
      scannedPatchId,
    });

    // Mirror the demand-scoped route: record the delivery verification when the
    // scan was run against the buyer's own demand and the patch resolved.
    if (ownedDemandId && result.patchIdValid) {
      await prisma.demand.update({
        where: { id: ownedDemandId },
        data: {
          deliveryVerified: result.productMatch && result.artisanMatch && result.qrValid,
          deliveryVerifiedAt: new Date(),
          deliveryScanPatchId: patchId,
          deliveryScanScore: result.similarityScore,
        },
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Buyer verify-item error:', error);
    return NextResponse.json({ error: 'Failed to verify product.' }, { status: 500 });
  }
}
