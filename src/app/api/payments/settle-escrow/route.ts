import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getListingPrice } from '@/lib/pricing';
// The audit entry is written inline via `prisma.auditLog.create` rather than
// through `logCraftItemEvent`, because it has to be composed into the same
// `$transaction` as the item update: a released tranche must never exist
// without its log row. The shape written here is identical.
import {
  CREATOR_RATE,
  ESCROW_HELD,
  STAGE1_ADVANCE_PAID_40,
  STAGE2_SETTLED_89,
  advanceFor,
  creatorCommissionFor,
  finalSettlementFor,
  platformFeeFor,
} from '@/lib/escrow';

/**
 * Automated non-custodial settlement.
 *
 * GOVERNANCE RULE: admins, facilitators and middlemen have ZERO financial
 * authority. This route is deliberately NOT behind an admin auth gate, because
 * an approval gate is exactly the hold-up point the rule exists to remove. It
 * is fired by a logistics event — `DISPATCH` or `DELIVERED` — and the money
 * goes to `artisanUpiDestination`, the artisan's own VPA snapshotted at
 * checkout. There is no code path that lets a human choose a different
 * destination or a different amount.
 *
 * HONESTY: Stripe test mode cannot settle to an Indian VPA, so each tranche is
 * written as a programmatic settlement record. The state machine, the ledger
 * fields and the audit trail are real; the bank credit is simulated.
 *
 * Idempotent by state: re-firing the same action never double-pays.
 */
export const dynamic = 'force-dynamic';

type SettleAction = 'DISPATCH' | 'DELIVERED';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const craftItemId = typeof body?.craftItemId === 'string' ? body.craftItemId : null;
    const action = (typeof body?.action === 'string' ? body.action : '').toUpperCase() as SettleAction;

    if (!craftItemId) {
      return NextResponse.json({ error: 'craftItemId is required.' }, { status: 400 });
    }
    if (action !== 'DISPATCH' && action !== 'DELIVERED') {
      return NextResponse.json(
        { error: 'action must be "DISPATCH" or "DELIVERED".' },
        { status: 400 }
      );
    }

    const item = await prisma.craftItem.findUnique({
      where: { id: craftItemId },
      select: {
        id: true,
        status: true,
        escrowStatus: true,
        advanceAmount: true,
        finalSettlementAmount: true,
        artisanUpiDestination: true,
        advancePaid: true,
        finalPayoutQueued: true,
        askingPrice: true,
        salePrice: true,
        standardMarketPrice: true,
        fairWageFloor: true,
        affiliateCreatorId: true,
        affiliateHandle: true,
        affiliateCommission: true,
      },
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const price = item.salePrice ?? getListingPrice(item);
    const destination = item.artisanUpiDestination;

    if (action === 'DISPATCH') {
      // Already advanced (or fully settled) — report the recorded tranche
      // instead of releasing a second one.
      if (
        item.escrowStatus === STAGE1_ADVANCE_PAID_40 ||
        item.escrowStatus === STAGE2_SETTLED_89
      ) {
        return NextResponse.json({
          success: true,
          idempotent: true,
          escrowStatus: item.escrowStatus,
          paid: item.advancePaid,
          destination,
        });
      }

      if (item.escrowStatus !== ESCROW_HELD) {
        return NextResponse.json(
          { error: 'No escrow is held for this item yet. Checkout has to complete first.' },
          { status: 409 }
        );
      }

      const advance =
        item.advanceAmount ??
        (price !== null && Number.isFinite(price) ? advanceFor(price) : null);
      if (advance === null) {
        return NextResponse.json(
          { error: 'This item carries no price, so no advance can be computed.' },
          { status: 409 }
        );
      }

      // Item update and audit entry land together: a released tranche without
      // its immutable log entry would break the trail this feature rests on.
      await prisma.$transaction([
        prisma.craftItem.update({
          where: { id: item.id },
          data: {
            escrowStatus: STAGE1_ADVANCE_PAID_40,
            advancePaid: advance,
            status: 'ADVANCE_PAID',
          },
        }),
        prisma.auditLog.create({
          data: {
            craftItemId: item.id,
            actorId: 'SMART_ESCROW_ENGINE',
            actorRole: 'SYSTEM',
            action: 'DIRECT_ARTISAN_ADVANCE_PAID',
            previousState: { escrowStatus: item.escrowStatus, advancePaid: item.advancePaid },
            newState: { advance, destination },
            comments:
              'Stage 1 (40% fair-wage advance) released programmatically on dispatch, direct to the artisan VPA. Test-mode settlement record — no admin approved or touched this.',
          },
        }),
      ]);

      return NextResponse.json({
        success: true,
        escrowStatus: STAGE1_ADVANCE_PAID_40,
        paid: advance,
        destination,
      });
    }

    // ---- action === 'DELIVERED' : Stage 2, final settlement -----------------

    if (item.escrowStatus === STAGE2_SETTLED_89) {
      return NextResponse.json({
        success: true,
        idempotent: true,
        escrowStatus: item.escrowStatus,
        paid: item.finalPayoutQueued,
        destination,
      });
    }

    if (item.escrowStatus !== STAGE1_ADVANCE_PAID_40) {
      return NextResponse.json(
        { error: 'The 40% dispatch advance has not been released yet.' },
        { status: 409 }
      );
    }

    const final =
      item.finalSettlementAmount ??
      (price !== null && Number.isFinite(price) ? finalSettlementFor(price) : null);
    if (final === null) {
      return NextResponse.json(
        { error: 'This item carries no price, so no settlement can be computed.' },
        { status: 409 }
      );
    }

    // 40% + 49.36% = 89.36% of gross reaches the artisan. KARIGARI retains a
    // nominal 3.5% maintenance fee; the remaining ~7.14% covers logistics and
    // the payment gateway. See src/lib/escrow.ts for the full split.
    const platformFee =
      price !== null && Number.isFinite(price) ? platformFeeFor(price) : 0;

    /**
     * The creator's 5%, on an attributed sale only.
     *
     * Funded from the platform-side remainder — the artisan still receives
     * 89.36% of gross and the 40% dispatch advance was released untouched at
     * DISPATCH. Paid to the creator's OWN VPA, read here rather than passed in,
     * so no caller can redirect it. Same honesty framing as the artisan
     * settlement: Stripe test mode cannot credit an Indian VPA, so this is a
     * programmatic settlement record, not a confirmed bank credit.
     */
    const affiliate = item.affiliateCreatorId
      ? await prisma.creator.findUnique({
          where: { id: item.affiliateCreatorId },
          select: { id: true, handle: true, upiId: true },
        })
      : null;

    const creatorCommission = affiliate
      ? (item.affiliateCommission ??
        (price !== null && Number.isFinite(price) ? creatorCommissionFor(price) : 0))
      : 0;

    const settlementWrites: Prisma.PrismaPromise<unknown>[] = [
      prisma.craftItem.update({
        where: { id: item.id },
        data: {
          escrowStatus: STAGE2_SETTLED_89,
          finalPayoutQueued: final,
          salePrice: item.salePrice ?? (price !== null && Number.isFinite(price) ? price : null),
          status: 'SOLD_FINAL',
          ...(affiliate ? { affiliateCommission: creatorCommission } : {}),
        },
      }),
      prisma.auditLog.create({
        data: {
          craftItemId: item.id,
          actorId: 'SMART_ESCROW_ENGINE',
          actorRole: 'SYSTEM',
          action: 'DIRECT_ARTISAN_FINAL_SETTLEMENT',
          previousState: {
            escrowStatus: item.escrowStatus,
            finalPayoutQueued: item.finalPayoutQueued,
          },
          newState: { final, platformFee, destination },
          comments:
            'Stage 2 final settlement released programmatically on delivery, direct to the artisan VPA. Total to artisan: 89.36% of gross. Test-mode settlement record — no admin approved or touched this.',
        },
      }),
    ];

    if (affiliate && creatorCommission > 0) {
      settlementWrites.push(
        prisma.creator.update({
          where: { id: affiliate.id },
          data: {
            totalSales: { increment: 1 },
            earningsTotal: { increment: creatorCommission },
          },
        }),
        prisma.auditLog.create({
          data: {
            craftItemId: item.id,
            actorId: 'SMART_ESCROW_ENGINE',
            actorRole: 'SYSTEM',
            action: 'AFFILIATE_COMMISSION_PAID',
            previousState: { affiliateHandle: item.affiliateHandle },
            newState: {
              handle: affiliate.handle,
              amount: creatorCommission,
              destination: affiliate.upiId,
              rate: CREATOR_RATE,
            },
            comments:
              `Creator commission (${Math.round(CREATOR_RATE * 100)}% of gross) released programmatically on delivery, direct to @${affiliate.handle}'s own VPA. Funded from the platform share — the artisan's 89.36% is unchanged. Test-mode settlement record — no admin approved or touched this.`,
          },
        })
      );
    }

    // One transaction: a released tranche, a bumped creator balance and their
    // audit rows must all land together or not at all.
    await prisma.$transaction(settlementWrites);

    return NextResponse.json({
      success: true,
      escrowStatus: STAGE2_SETTLED_89,
      paid: final,
      destination,
      ...(affiliate && creatorCommission > 0
        ? {
            affiliate: {
              handle: affiliate.handle,
              commission: creatorCommission,
              destination: affiliate.upiId,
            },
          }
        : {}),
    });
  } catch (error) {
    console.error('Settle escrow error:', error);
    return NextResponse.json({ error: 'Failed to settle escrow' }, { status: 500 });
  }
}
