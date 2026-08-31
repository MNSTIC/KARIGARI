import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';

export const dynamic = 'force-dynamic';

// GET all queued payouts
export async function GET(req: Request) {
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

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payouts = await prisma.craftItem.findMany({
      where: {
        status: 'SOLD_FINAL',
        finalPayoutQueued: { gt: 0 }
      },
      include: {
        artisan: {
          select: { name: true, artisanProfile: { select: { upiId: true, photoUrl: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ success: true, payouts });
  } catch (error: any) {
    console.error('Payouts API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST process a payout
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

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { itemId } = await req.json();

    if (!itemId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 });
    }

    const item = await prisma.craftItem.findUnique({ where: { id: itemId } });
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

    // GOLDEN RULE: an item that went through non-custodial escrow is settled
    // programmatically, direct to the artisan's own VPA. No admin may release,
    // re-release or close out that money. This guard exists so the legacy
    // cooperative-disbursement path can never reach an escrow-settled row.
    if (item.escrowStatus) {
      return NextResponse.json(
        {
          error:
            'This item settles through non-custodial escrow, direct to the artisan VPA. Admins have zero financial authority over it.',
        },
        { status: 403 }
      );
    }

    if (item.status !== 'SOLD_FINAL' || item.finalPayoutQueued <= 0) {
      return NextResponse.json({ error: 'Item not eligible for payout' }, { status: 400 });
    }

    const payoutAmount = item.finalPayoutQueued;

    // Update item status and reset payout queue
    const updatedItem = await prisma.craftItem.update({
      where: { id: itemId },
      data: { 
        status: 'PAYOUT_COMPLETED',
        finalPayoutQueued: 0 
      }
    });

    // Log the transaction
    await logCraftItemEvent({
      prisma,
      craftItemId: itemId,
      actorId: decoded.userId,
      actorRole: 'ADMIN',
      action: 'FINAL_PAYOUT_DISBURSED',
      previousState: { status: item.status, queuedPayout: payoutAmount },
      newState: { status: 'PAYOUT_COMPLETED', queuedPayout: 0 },
      comments: `Disbursed final profit share of ₹${payoutAmount} to artisan's account via Cooperative.`
    });

    return NextResponse.json({ success: true, item: updatedItem });
  } catch (error: any) {
    console.error('Process Payout API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
