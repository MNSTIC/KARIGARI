import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';

/** Reads the auth cookie, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';


export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');

    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let decoded: any;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret');
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { itemId } = await req.json();

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.craftItem.findUnique({ where: { id: itemId } });
      if (!item || item.artisanId !== decoded.userId) throw new Error("Item not found or unauthorized");
      
      const updated = await tx.craftItem.update({
        where: { id: itemId },
        data: { status: 'TAG_ATTACHED' }
      });

      await logCraftItemEvent({
        prisma: tx as any,
        craftItemId: itemId,
        actorId: decoded.userId,
        actorRole: 'ARTISAN',
        action: 'TAG_ATTACHED',
        previousState: { status: item.status },
        newState: { status: 'TAG_ATTACHED' },
        comments: 'Artisan attached the QR patch and Gemini AI confirmed the visual match.'
      });

      return updated;
    });

    return NextResponse.json({ success: true, item: result });
  } catch (error: any) {
    console.error('Cross-Check API error:', error);
    return NextResponse.json({ error: 'Failed to cross-check' }, { status: 500 });
  }
}
