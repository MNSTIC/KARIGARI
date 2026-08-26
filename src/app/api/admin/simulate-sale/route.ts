import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { getPricingDiscrepancy } from '@/lib/pricing';

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret');
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const { itemId, actualSalePrice } = await req.json();

    if (!itemId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 });
    }

    const item = await prisma.craftItem.findUnique({
      where: { id: itemId }
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (item.status !== 'ADVANCE_PAID' && item.status !== 'LISTED_AUCTION') {
      return NextResponse.json({ error: 'Item is not eligible for sale simulation.' }, { status: 400 });
    }

    // Simulate sale at manual price or fallback
    const salePrice = actualSalePrice ? Number(actualSalePrice) : (item.marketPriceMax || ((item.fairWageFloor || 0) * 1.5));
    
    // Ledger math
    const advancePaid = item.advancePaid || 0;
    
    // Remainder to be queued to the artisan
    const finalPayoutQueued = Math.max(0, salePrice - advancePaid);

    // Anti-exploitation guardian: a price more than 30% below the AI fair wage
    // floor means the artisan is very likely being squeezed by a middleman.
    const discrepancy = getPricingDiscrepancy({ fairWageFloor: item.fairWageFloor, salePrice });

    const updatedItem = await prisma.craftItem.update({
      where: { id: itemId },
      data: { 
        status: 'SOLD_FINAL',
        salePrice: salePrice,
        finalPayoutQueued: finalPayoutQueued,
        pricingFlag: discrepancy.flagged,
        flagReason: discrepancy.flagged ? discrepancy.reason : null,
        fairnessScore: discrepancy.flagged ? Math.max(0, 100 - discrepancy.pctBelow) : (item.fairnessScore ?? 95)
      }
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: itemId,
      actorId: decoded.userId,
      actorRole: 'ADMIN',
      action: 'UPI_PAYMENT_PROCESSED',
      previousState: { status: item.status },
      newState: { status: 'SOLD_FINAL', salePrice },
      comments: `UPI Payment processed for buyer sale: ₹${salePrice.toLocaleString()}. Final direct payout of ₹${finalPayoutQueued.toLocaleString()} disbursed to artisan's linked bank account.`
    });

    if (discrepancy.flagged) {
      await logCraftItemEvent({
        prisma,
        craftItemId: itemId,
        actorId: decoded.userId,
        actorRole: 'SYSTEM',
        action: 'PRICING_FLAG_RAISED',
        previousState: { pricingFlag: item.pricingFlag },
        newState: { pricingFlag: true, salePrice, fairWageFloor: item.fairWageFloor },
        comments: `${discrepancy.reason}. Held for facilitator review under the anti-exploitation policy.`
      });
    }

    return NextResponse.json({ success: true, item: updatedItem, pricing: discrepancy });
  } catch (error: any) {
    console.error('Simulate Sale API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
