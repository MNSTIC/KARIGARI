import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { base64Bytes, IMAGE_DATA_URL_RE, MAX_IMAGE_BYTES } from '@/lib/buyerVerify';

/**
 * Buyer-raised dispute tickets.
 *
 *   POST — open a ticket from a FAILED verification. The buyer's photo and a
 *          snapshot of the artisan's original capture are both stored on the
 *          row, so the admin compares exactly what the AI compared even if the
 *          item's images change later.
 *   GET  — one buyer's own tickets (`?buyer=<name>`), so their My Orders page
 *          can render the under-review / discarded / refund states.
 *
 * Public, like the rest of the buyer surface: buyers have no account, so the
 * identity is the free-text `buyerName` convention used throughout.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      craftItemId?: unknown;
      patchId?: unknown;
      buyerName?: unknown;
      buyerContact?: unknown;
      demandId?: unknown;
      buyerImageUrl?: unknown;
      similarityScore?: unknown;
      aiReasoning?: unknown;
    };

    const craftItemId = typeof body.craftItemId === 'string' ? body.craftItemId.trim() : '';
    const patchId = typeof body.patchId === 'string' ? body.patchId.trim() : '';
    const buyerName = typeof body.buyerName === 'string' ? body.buyerName.trim() : '';
    const buyerImageUrl =
      typeof body.buyerImageUrl === 'string' ? body.buyerImageUrl : '';
    const buyerContact =
      typeof body.buyerContact === 'string' && body.buyerContact.trim()
        ? body.buyerContact.trim().slice(0, 120)
        : null;
    const demandId =
      typeof body.demandId === 'string' && body.demandId.trim() ? body.demandId.trim() : null;
    const aiReasoning =
      typeof body.aiReasoning === 'string' ? body.aiReasoning.slice(0, 1000) : null;

    const scoreRaw = Number(body.similarityScore);
    const similarityScore = Number.isFinite(scoreRaw)
      ? Math.max(0, Math.min(100, scoreRaw))
      : null;

    if (!craftItemId || !patchId || !buyerName || !buyerImageUrl) {
      return NextResponse.json(
        { error: 'craftItemId, patchId, buyerName and buyerImageUrl are required.' },
        { status: 400 }
      );
    }
    if (!IMAGE_DATA_URL_RE.test(buyerImageUrl)) {
      return NextResponse.json({ error: 'Photo must be an image.' }, { status: 400 });
    }
    if (base64Bytes(buyerImageUrl) > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Photo is larger than 2 MB.' }, { status: 400 });
    }

    const craftItem = await prisma.craftItem.findUnique({
      where: { id: craftItemId },
      select: { id: true, images: true, patchId: true },
    });
    if (!craftItem) {
      return NextResponse.json({ error: 'Craft item not found.' }, { status: 404 });
    }

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          craftItemId: craftItem.id,
          demandId,
          patchId,
          buyerName,
          buyerContact,
          buyerImageUrl,
          // Snapshot at creation time — the admin must see what the AI saw.
          artisanImageUrl: craftItem.images?.[0] ?? null,
          similarityScore,
          aiReasoning,
          status: 'OPEN',
        },
        select: { id: true },
      });

      await logCraftItemEvent({
        prisma: tx,
        craftItemId: craftItem.id,
        actorRole: 'BUYER',
        action: 'TICKET_OPENED',
        comments: `Buyer "${buyerName}" reported this piece. AI similarity: ${
          similarityScore ?? 'n/a'
        }. Ticket ${created.id}.`,
      });

      return created;
    });

    return NextResponse.json({ success: true, ticketId: ticket.id });
  } catch (error) {
    console.error('Buyer ticket POST error:', error);
    return NextResponse.json({ error: 'Failed to open the report.' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const buyer = (new URL(req.url).searchParams.get('buyer') || '').trim();
    if (!buyer) {
      return NextResponse.json({ error: 'buyer is required.' }, { status: 400 });
    }

    const tickets = await prisma.ticket.findMany({
      where: { buyerName: { equals: buyer, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        craftItemId: true,
        demandId: true,
        patchId: true,
        status: true,
        adminNote: true,
        similarityScore: true,
        resolvedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      tickets: tickets.map((ticket) => ({
        ...ticket,
        resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
        createdAt: ticket.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Buyer ticket GET error:', error);
    return NextResponse.json({ error: 'Failed to load reports.' }, { status: 500 });
  }
}
