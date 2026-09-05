import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

/**
 * The admin's Tickets & Reports queue.
 *
 * Every row here was raised by a real buyer whose scan failed — nothing is
 * seeded. The joined craftItem carries the artisan's live health score so the
 * admin can see what a GUILTY verdict is about to cost before they cast it.
 */
export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

const ALLOWED_STATUS = ['OPEN', 'RESOLVED_GUILTY', 'RESOLVED_NOT_GUILTY', 'DISCARDED'] as const;

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let decoded: AuthToken;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const statusParam = new URL(req.url).searchParams.get('status');
    const status =
      statusParam && (ALLOWED_STATUS as readonly string[]).includes(statusParam)
        ? statusParam
        : null;

    const tickets = await prisma.ticket.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        craftItem: {
          select: {
            id: true,
            patchId: true,
            craftType: true,
            images: true,
            status: true,
            artisan: {
              select: {
                id: true,
                name: true,
                artisanProfile: {
                  select: { healthScore: true, verifiedGenuineCount: true },
                },
              },
            },
          },
        },
      },
    });

    const openCount = await prisma.ticket.count({ where: { status: 'OPEN' } });

    return NextResponse.json({
      success: true,
      openCount,
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        patchId: ticket.patchId,
        demandId: ticket.demandId,
        buyerName: ticket.buyerName,
        buyerContact: ticket.buyerContact,
        buyerImageUrl: ticket.buyerImageUrl,
        artisanImageUrl: ticket.artisanImageUrl,
        similarityScore: ticket.similarityScore,
        aiReasoning: ticket.aiReasoning,
        status: ticket.status,
        adminNote: ticket.adminNote,
        resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
        createdAt: ticket.createdAt.toISOString(),
        craftItem: {
          id: ticket.craftItem.id,
          patchId: ticket.craftItem.patchId,
          craftType: ticket.craftItem.craftType,
          // Only the first frame — the queue renders one thumbnail per side and
          // shipping the whole base64 array would balloon the payload.
          image: ticket.craftItem.images?.[0] ?? null,
          status: ticket.craftItem.status,
          artisan: {
            id: ticket.craftItem.artisan.id,
            name: ticket.craftItem.artisan.name,
            healthScore: ticket.craftItem.artisan.artisanProfile?.healthScore ?? null,
            verifiedGenuineCount:
              ticket.craftItem.artisan.artisanProfile?.verifiedGenuineCount ?? 0,
          },
        },
      })),
    });
  } catch (error) {
    console.error('Admin tickets GET error:', error);
    return NextResponse.json({ error: 'Failed to load tickets.' }, { status: 500 });
  }
}
