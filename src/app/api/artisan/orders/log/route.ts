import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';

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
      select: { id: true, artisanId: true, status: true },
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

    const log = await prisma.$transaction(async (tx) => {
      const created = await tx.orderLog.create({
        data: {
          artisanOrderId,
          note: note || null,
          imageUrl: imageUrl || null,
        },
      });

      // A logged update against an ACCEPTED order is the artisan starting work.
      // Move forward only — a COMPLETED order stays complete.
      if (order.status === 'ACCEPTED') {
        await tx.artisanOrder.update({
          where: { id: artisanOrderId },
          data: { status: 'IN_PROGRESS' },
        });
      }

      return created;
    });

    return NextResponse.json({
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
