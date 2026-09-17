import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import {
  provenanceReference,
  base64Bytes,
  compareProductPhotos,
  IMAGE_DATA_URL_RE,
  MAX_IMAGE_BYTES,
  MIN_SIMILARITY,
} from '@/lib/buyerVerify';
import { buyerNotificationCopy, createBuyerNotification } from '@/lib/buyerNotify';
import { advanceOrderStatus } from '@/lib/orderStage';
import { ADVANCE_PENDING_MESSAGE, advancePaidOrWaived } from '@/lib/advanceGate';

/**
 * The artisan's own ready-check — the gate that replaced "upload any photo".
 *
 * Before V9, marking a demand order complete accepted any 2 MB image and
 * flipped the status. The buyer's own later check ran a QR match, a patch
 * lookup and an AI comparison; the maker's side ran none of them. This route
 * closes that gap by asking the artisan to prove the same three things the
 * buyer will be asked to prove, at the moment the piece is finished:
 *
 *   1. the patch belongs to a piece THIS artisan made
 *   2. the QR they scanned is that same patch
 *   3. the finished photo matches that piece's original capture
 *
 * Passing binds `ArtisanOrder.craftItemId`, which is what later lets
 * `verifyBuyerImage` ask "is this the piece that was promised" rather than
 * "does this artisan hold any order on this demand".
 *
 * Failing writes NOTHING. No status change, no binding, no notification, and
 * no health penalty — `healthAfterGuilty` exists for an admin's GUILTY verdict
 * on a buyer's dispute, and an artisan photographing their own work badly in
 * workshop light is not fraud. They retry.
 */
export const dynamic = 'force-dynamic';

/** Statuses a ready-check may be run from. */
const VERIFIABLE_FROM = ['ACCEPTED', 'IN_PROGRESS'];

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      orderId?: unknown;
      patchId?: unknown;
      scannedPatchId?: unknown;
      readyImageBase64?: unknown;
    };

    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const patchId = typeof body.patchId === 'string' ? body.patchId.trim() : '';
    const scannedPatchId =
      typeof body.scannedPatchId === 'string' && body.scannedPatchId.trim()
        ? body.scannedPatchId.trim()
        : null;
    const readyImageBase64 =
      typeof body.readyImageBase64 === 'string' ? body.readyImageBase64 : '';

    if (!orderId || !patchId || !readyImageBase64) {
      return NextResponse.json(
        { error: 'orderId, patchId and readyImageBase64 are required.' },
        { status: 400 }
      );
    }

    // (b) Payload limits, checked before anything is read from the database.
    if (!IMAGE_DATA_URL_RE.test(readyImageBase64)) {
      return NextResponse.json({ error: 'The finished photo must be an image.' }, { status: 400 });
    }
    if (base64Bytes(readyImageBase64) > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'The photo is larger than 2 MB.' }, { status: 400 });
    }

    // (a) The order must exist and belong to the caller.
    const order = await prisma.artisanOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        artisanId: true,
        status: true,
        readyVerified: true,
        readyScanPatchId: true,
        readySimilarityScore: true,
        readyVerifiedAt: true,
        advanceStatus: true,
        demandId: true,
        demand: { select: { id: true, buyerName: true } },
        artisan: { select: { name: true } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    if (order.artisanId !== auth.artisan.userId) {
      return NextResponse.json({ error: 'This order is not yours.' }, { status: 403 });
    }

    // Idempotent. A second tap on a verified order returns what was STORED —
    // it does not re-run the model. The Gemini key on this deployment is on a
    // free tier measured in requests per day, and a flaky network double-firing
    // a submit must not cost two of them.
    if (order.readyVerified) {
      return NextResponse.json({
        success: true,
        passed: true,
        idempotent: true,
        similarityScore: order.readySimilarityScore ?? 0,
        patchId: order.readyScanPatchId,
        verifiedAt: order.readyVerifiedAt?.toISOString() ?? null,
        reasoning: '',
        scoredBy: null,
      });
    }

    // Verifying a finished piece is the end of work the buyer has not paid the
    // advance on. Checked after the idempotent short-circuit above, so an order
    // already verified still returns its stored result.
    if (!advancePaidOrWaived(order.advanceStatus)) {
      return NextResponse.json({ error: ADVANCE_PENDING_MESSAGE }, { status: 409 });
    }

    if (!VERIFIABLE_FROM.includes(order.status)) {
      return NextResponse.json(
        { error: 'This order is no longer at a stage where it can be marked ready.' },
        { status: 409 }
      );
    }

    // (c) The patch must resolve to a piece THIS artisan made. This is the
    // check the whole route exists for: without it, an artisan could pass the
    // ready gate by scanning any patch they happened to have to hand.
    const item = await prisma.craftItem.findFirst({
      where: { patchId },
      select: { id: true, artisanId: true, images: true, originalImageUrl: true, craftType: true },
    });
    if (!item) {
      return NextResponse.json(
        { error: 'That patch ID does not match any piece. Check the QR label.' },
        { status: 404 }
      );
    }
    if (item.artisanId !== auth.artisan.userId) {
      return NextResponse.json(
        { error: 'That patch belongs to another artisan’s piece.' },
        { status: 403 }
      );
    }

    // (d) A scanned QR that disagrees with the submitted code is a mismatch,
    // not a typo to forgive — the whole point of scanning is that the two agree.
    if (scannedPatchId && scannedPatchId !== patchId) {
      return NextResponse.json(
        { error: 'The scanned QR does not match the patch ID entered.' },
        { status: 400 }
      );
    }

    // (e) Nothing to compare against.
    // The camera frame, never the chosen listing look — see provenanceReference().
    const originalImage = provenanceReference(item);
    if (!originalImage) {
      return NextResponse.json(
        {
          error:
            'That piece has no original capture photo, so there is nothing to compare the finished photo against.',
        },
        { status: 422 }
      );
    }

    // (f) The shared comparator — the same prompt, threshold and fallback the
    // buyer's delivery check runs, so the two can never drift.
    const comparison = await compareProductPhotos(originalImage, readyImageBase64);

    if (!comparison.isMatch) {
      // Nothing is written. Deliberately a 200: the check ran and produced an
      // answer, and a 4xx here would make a legitimate "these do not look like
      // the same piece" verdict indistinguishable from a broken request.
      return NextResponse.json({
        success: true,
        passed: false,
        similarityScore: comparison.similarityScore,
        threshold: MIN_SIMILARITY,
        reasoning: comparison.reasoning,
        scoredBy: comparison.scoredBy,
      });
    }

    const now = new Date();
    // `readyVerified: false` in the predicate is the concurrency guard: two
    // overlapping submits cannot both bind a piece and both notify the buyer.
    const written = await prisma.artisanOrder.updateMany({
      where: { id: order.id, artisanId: auth.artisan.userId, readyVerified: false },
      data: {
        craftItemId: item.id,
        readyVerified: true,
        readyImageUrl: readyImageBase64,
        readyScanPatchId: patchId,
        // Only a score Gemini produced is stored. The comparator's fallback
        // (no key, quota, timeout) passes the check with a fixed number, and a
        // fixed number is not a similarity — the buyer passport prints this.
        readySimilarityScore: comparison.scoredBy === 'gemini' ? comparison.similarityScore : null,
        readyVerifiedAt: now,
        status: advanceOrderStatus(order.status, 'READY'),
      },
    });

    if (written.count > 0) {
      const copy = buyerNotificationCopy.orderReady(
        order.artisan.name,
        comparison.similarityScore,
        comparison.scoredBy
      );
      await createBuyerNotification({
        buyerName: order.demand.buyerName,
        demandId: order.demandId,
        artisanOrderId: order.id,
        type: 'ORDER_READY',
        ...copy,
      });
    }

    return NextResponse.json({
      success: true,
      passed: true,
      idempotent: written.count === 0,
      similarityScore: comparison.similarityScore,
      threshold: MIN_SIMILARITY,
      reasoning: comparison.reasoning,
      scoredBy: comparison.scoredBy,
      craftItemId: item.id,
      patchId,
      verifiedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Ready verify error:', error);
    return NextResponse.json({ error: 'Failed to verify the finished piece.' }, { status: 500 });
  }
}
