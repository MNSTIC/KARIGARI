import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { getPricingDiscrepancy, formatRupees } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

/** The whole JWT payload: one admin role, nothing else. */
type AuthToken = { userId: string; role: string };

const OVERRIDE_PREFIX = 'OVERRIDE_APPROVED:';
const INVESTIGATION_PREFIX = 'UNDER_INVESTIGATION:';

/**
 * Resolve an anti-exploitation pricing flag (new_admin.md Tier 1.1).
 *
 * APPROVE_OVERRIDE clears the flag — the facilitator called the artisan and the
 * discount was genuinely intentional. INVESTIGATE keeps the flag raised but marks
 * it as being worked, so the listing stays held. Either way the immutable ledger
 * records who decided what.
 */
export async function PATCH(req: Request) {
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

    const { itemId, action, note } = await req.json();

    if (!itemId || !action) {
      return NextResponse.json({ error: 'Missing itemId or action' }, { status: 400 });
    }
    if (action !== 'APPROVE_OVERRIDE' && action !== 'INVESTIGATE') {
      return NextResponse.json(
        { error: 'action must be APPROVE_OVERRIDE or INVESTIGATE' },
        { status: 400 }
      );
    }

    const item = await prisma.craftItem.findUnique({ where: { id: itemId } });
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

    const discrepancy = getPricingDiscrepancy(item);
    const baseReason =
      (item.flagReason || '')
        .replace(OVERRIDE_PREFIX, '')
        .replace(INVESTIGATION_PREFIX, '')
        .trim() ||
      discrepancy.reason ||
      'Pricing discrepancy against the AI fair wage floor';

    const approving = action === 'APPROVE_OVERRIDE';

    const updated = await prisma.craftItem.update({
      where: { id: itemId },
      data: {
        pricingFlag: !approving,
        flagReason: approving
          ? `${OVERRIDE_PREFIX} ${baseReason}`
          : `${INVESTIGATION_PREFIX} ${baseReason}`,
        // Clearing the flag restores the item's fairness standing.
        fairnessScore: approving ? 95 : item.fairnessScore,
      },
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: itemId,
      actorId: decoded.userId,
      actorRole: 'ADMIN',
      action: approving ? 'PRICING_OVERRIDE_APPROVED' : 'PRICING_FLAG_INVESTIGATION',
      previousState: { pricingFlag: item.pricingFlag, flagReason: item.flagReason },
      newState: { pricingFlag: updated.pricingFlag, flagReason: updated.flagReason },
      comments: approving
        ? `Facilitator contacted the artisan and approved the price override. Accepted ${formatRupees(
            item.salePrice
          )} against an AI fair wage floor of ${formatRupees(item.fairWageFloor)}.${
            note ? ` Note: ${note}` : ''
          }`
        : `Facilitator placed the listing on hold pending an exploitation check. ${baseReason}.${
            note ? ` Note: ${note}` : ''
          }`,
    });

    return NextResponse.json({ success: true, item: updated });
  } catch (error) {
    console.error('Resolve Flag API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
