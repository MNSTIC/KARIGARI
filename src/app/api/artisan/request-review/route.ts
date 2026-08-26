import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback_secret');
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { itemId } = await req.json();

    const item = await prisma.craftItem.findUnique({
      where: { id: itemId }
    });

    if (!item || item.artisanId !== decoded.userId) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (item.status !== 'FLAGGED') {
      return NextResponse.json({ error: 'Item is not flagged' }, { status: 400 });
    }

    // Update status to APPLIED_FOR_REVIEW
    await prisma.craftItem.update({
      where: { id: itemId },
      data: { status: 'APPLIED_FOR_REVIEW' }
    });

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        craftItemId: item.id,
        actorId: decoded.userId,
        actorRole: 'ARTISAN',
        action: 'APPLIED_FOR_REVIEW',
        comments: 'Artisan disputed counterfeit flag and requested manual admin review.'
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Request Review Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
