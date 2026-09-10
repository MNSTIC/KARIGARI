import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { buyerNotificationCopy, createBuyerNotification } from '@/lib/buyerNotify';
import { advanceDemandStatus, advanceOrderStatus } from '@/lib/orderStage';
import { ADVANCE_PENDING_MESSAGE, advancePaidOrWaived } from '@/lib/advanceGate';

/**
 * Add one dated update to one ArtisanOrder.
 *
 * The ownership check is not a nicety — the log becomes buyer-visible tracking
 * later, and letting a different artisan write to a stranger's order would
 * corrupt that tracking.
 *
 * Text or photo (or both) — a log with neither is rejected, because it is not
 * saying anything.
 */
export const dynamic = 'force-dynamic';

const MAX_NOTE = 2000;
const MAX_IMAGE_BYTES = 2_800_000;

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      artisanOrderId?: unknown;
      note?: unknown;
      imageUrl?: unknown;
    };
    const artisanOrderId = typeof body.artisanOrderId === 'string' ? body.artisanOrderId : '';
    const note =
      typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '';
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';

    if (!artisanOrderId) {
      return NextResponse.json({ error: 'artisanOrderId is required.' }, { status: 400 });
    }
    if (!note && !imageUrl) {
      return NextResponse.json(
        { error: 'Provide a note or a photo.' },
        { status: 400 }
      );
    }
    if (imageUrl) {
      if (!imageUrl.startsWith('data:image/')) {
        return NextResponse.json(
          { error: 'imageUrl must be a data:image/... URL.' },
          { status: 400 }
        );
      }
      if (imageUrl.length > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: 'Image must be under 2 MB.' },
          { status: 400 }
        );
      }
    }

    const order = await prisma.artisanOrder.findUnique({
      where: { id: artisanOrderId },
      select: {
        id: true,
        artisanId: true,
        status: true,
        advanceStatus: true,
        demandId: true,
        demand: { select: { status: true, buyerName: true } },
        artisan: { select: { name: true } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    if (order.artisanId !== auth.artisan.userId) {
      return NextResponse.json(
        { error: 'This order is not yours.' },
        { status: 403 }
      );
    }

    // Logging progress is work reported against an order the buyer has not paid
    // the advance on. See src/lib/advanceGate.ts.
    if (!advancePaidOrWaived(order.advanceStatus)) {
      return NextResponse.json({ error: ADVANCE_PENDING_MESSAGE }, { status: 409 });
    }

    const log = await prisma.$transaction(async (tx) => {
      const created = await tx.orderLog.create({
        data: {
          artisanOrderId,
          note: note || null,
          imageUrl: imageUrl || null,
        },
      });

      // A logged update against an ACCEPTED order is the artisan starting work.
      // `lastLogAt` is written on EVERY log, not just the first, because it is
      // what the staleness check reads — deriving it from the newest OrderLog
      // would mean a subquery per order on every page load.
      await tx.artisanOrder.update({
        where: { id: artisanOrderId },
        data: {
          lastLogAt: created.createdAt,
          status: advanceOrderStatus(order.status, 'IN_PROGRESS'),
        },
      });

      // Work has visibly started, so the request itself is in production. Moved
      // forward only — a FULFILLED demand stays fulfilled.
      const nextDemandStatus = advanceDemandStatus(order.demand.status, 'IN_PRODUCTION');
      if (nextDemandStatus !== order.demand.status) {
        await tx.demand.update({
          where: { id: order.demandId },
          data: { status: nextDemandStatus },
        });
      }

      return created;
    });

    // Throttled to one per order per IST calendar day inside
    // createBuyerNotification. A talkative artisan posting four updates in an
    // afternoon still gets four OrderLog rows — their own record of their work
    // is never suppressed — but the buyer is pinged once.
    const notified = await createBuyerNotification({
      buyerName: order.demand.buyerName,
      demandId: order.demandId,
      artisanOrderId: order.id,
      type: 'DAILY_UPDATE',
      ...buyerNotificationCopy.dailyUpdate(order.artisan.name, note || null),
    });

    return NextResponse.json({
      buyerNotified: notified,
      success: true,
      log: {
        id: log.id,
        note: log.note,
        imageUrl: log.imageUrl,
        createdAt: log.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Order log POST error:', error);
    return NextResponse.json({ error: 'Failed to add log.' }, { status: 500 });
  }
}
