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

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret');
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 });
    }

    const { itemId, selectedOption, assignedAdminId, patchId } = await req.json();

    if (!itemId || !selectedOption) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const item = await prisma.craftItem.findUnique({
      where: { id: itemId }
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (item.artisanId !== decoded.userId) {
      return NextResponse.json({ error: 'Forbidden. You do not own this item.' }, { status: 403 });
    }

    // An item already under non-custodial escrow has its `advancePaid` written
    // by the escrow engine. Choosing a disbursement route again would overwrite
    // a real settlement, so it is refused rather than silently clobbered.
    if (item.escrowStatus) {
      return NextResponse.json(
        {
          error:
            'This piece is already sold under escrow. Its advance is released automatically on dispatch, direct to your UPI.',
        },
        { status: 409 }
      );
    }

    let newStatus = 'PENDING_DISBURSEMENT';
    let advancePaid = 0;

    if (selectedOption === 'MIDDLEMAN') {
      newStatus = 'SOLD_MIDDLEMAN';
      // Risk taken by artisan, cash paid immediately off-platform
      advancePaid = 0; 
    } else if (selectedOption === 'COOP_AUCTION') {
      newStatus = 'LISTED_AUCTION';
      // No advance, wait for sale
      advancePaid = 0;
    } else if (selectedOption === 'KARIGARI_ADVANCE') {
      newStatus = 'ADVANCE_PAID'; // Paid instantly
      // Cooperative pays the floor wage immediately as an advance
      advancePaid = item.fairWageFloor || 0;
    }

    const dataToUpdate: any = {
      status: newStatus,
      advancePaid: advancePaid
    };
    if (assignedAdminId) dataToUpdate.assignedAdminId = assignedAdminId;
    if (patchId) dataToUpdate.patchId = patchId;

    const result = await prisma.$transaction(async (tx) => {
      const updatedItem = await tx.craftItem.update({
        where: { id: itemId },
        data: dataToUpdate
      });

      await logCraftItemEvent({
        prisma: tx as any,
        craftItemId: itemId,
        actorId: decoded.userId,
        actorRole: 'Artisan cum Agent',
        action: 'AGENT_HANDOFF_COMPLETED',
        previousState: { status: item.status },
        newState: { status: newStatus, patchId: patchId },
        comments: `Agent verified product custody. Route selected: ${selectedOption}. Advance triggered: ₹${advancePaid.toLocaleString()}. Patch ID: ${patchId} minted.`
      });

      // Implement +2.5% Health Score Gain for successful authentic sale
      const artisanProfile = await tx.artisanProfile.findUnique({
        where: { userId: decoded.userId }
      });
      
      if (artisanProfile) {
        const newHealthScore = Math.min(100, artisanProfile.healthScore + 2.5);
        
        await tx.artisanProfile.update({
          where: { id: artisanProfile.id },
          data: { healthScore: newHealthScore }
        });
        
        // Dynamic Account Status Update based on health
        let newAccountStatus = 'ACTIVE';
        if (newHealthScore < 50) newAccountStatus = 'PENDING_BAN_APPROVAL';
        else if (newHealthScore < 65) newAccountStatus = 'PROBATION';
        
        await tx.user.update({
          where: { id: decoded.userId },
          data: { accountStatus: newAccountStatus as any }
        });
      }

      return updatedItem;
    });

    return NextResponse.json({ success: true, item: result });
  } catch (error: any) {
    console.error('Disbursement Apply API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
