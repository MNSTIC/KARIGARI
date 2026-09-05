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
import {
  PayoutError,
  RAZORPAYX_ENABLED,
  payoutToVpa,
  type PayoutResult,
} from '@/lib/razorpayPayout';

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
 * HONESTY: Checkout only COLLECTS, into the platform's own merchant account.
 * Paying back out to a VPA is RazorpayX Payouts, a separate product needing an
 * activated KYC'd account — so it lives behind a flag in `@/lib/razorpayPayout`
 * and is OFF by default. With it off, each tranche is written as a programmatic
 * settlement record: the state machine, the ledger fields and the audit trail
 * are real, the bank credit is not. `payoutMode` on the row and in every audit
 * entry says which of the two happened, so a recorded settlement can never be
 * mistaken later for a real one.
 *
 * Idempotent by state: re-firing the same action never double-pays. When real
 * payouts are on, the per-tranche reference (`<itemId>-STAGE1`) is also sent as
 * the RazorpayX idempotency key, so even a retry that races the DB write cannot
 * release the same money twice.
 */
export const dynamic = 'force-dynamic';

type SettleAction = 'DISPATCH' | 'DELIVERED';

/**
 * A failed REAL payout must leave the escrow stage untouched, so the dispatch
 * stays re-fireable once the problem is fixed. Nothing is written here.
 */
function payoutFailure(error: unknown, stage: string) {
  const detail =
    error instanceof PayoutError ? error.message : 'The payout could not be completed.';
  console.error(`Settle escrow payout failed (${stage}):`, error);
  return NextResponse.json(
    {
      error: detail,
      stage,
      // Said plainly so an operator does not go looking for a half-settled row.
      settled: false,
    },
    { status: error instanceof PayoutError ? error.status : 502 }
  );
}

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
        payoutMode: true,
        stage1PayoutRef: true,
        stage2PayoutRef: true,
        creatorPayoutRef: true,
        // Only ever used as the RazorpayX contact name on a real payout.
        artisan: { select: { name: true } },
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
          payoutMode: item.payoutMode,
          payoutRef: item.stage1PayoutRef,
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

      // The money moves BEFORE the ledger commits. A real payout that fails
      // must leave the item exactly as it was, so the dispatch can be re-fired
      // once the cause is fixed; a payout that succeeds but whose commit then
      // fails is recovered by re-firing too, because the RazorpayX idempotency
      // key returns the original payout instead of releasing a second one.
      let payout: PayoutResult;
      try {
        payout = await payoutToVpa({
          amount: advance,
          vpa: destination ?? '',
          purpose: 'payout',
          referenceId: `${item.id}-STAGE1`,
          contactName: item.artisan?.name,
          notes: { craftItemId: item.id, stage: 'STAGE1_ADVANCE_40' },
        });
      } catch (error) {
        return payoutFailure(error, 'STAGE1_ADVANCE_40');
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
            payoutMode: payout.mode,
            stage1PayoutRef: payout.reference,
          },
        }),
        prisma.auditLog.create({
          data: {
            craftItemId: item.id,
            actorId: 'SMART_ESCROW_ENGINE',
            actorRole: 'SYSTEM',
            action: 'DIRECT_ARTISAN_ADVANCE_PAID',
            previousState: { escrowStatus: item.escrowStatus, advancePaid: item.advancePaid },
            newState: {
              advance,
              destination,
              payoutMode: payout.mode,
              payoutRef: payout.reference,
            },
            comments:
              payout.mode === 'RAZORPAYX'
                ? `Stage 1 (40% fair-wage advance) released programmatically on dispatch, direct to the artisan VPA via RazorpayX Payout ${payout.reference}. No admin approved or touched this.`
                : 'Stage 1 (40% fair-wage advance) released programmatically on dispatch, direct to the artisan VPA. Simulated settlement record — RazorpayX payouts are not enabled on this deployment, so no bank credit has been made. No admin approved or touched this.',
          },
        }),
      ]);

      return NextResponse.json({
        success: true,
        escrowStatus: STAGE1_ADVANCE_PAID_40,
        paid: advance,
        destination,
        payoutMode: payout.mode,
        payoutRef: payout.reference,
        // False here means the ledger advanced but no bank credit was made.
        payoutReal: RAZORPAYX_ENABLED,
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
        payoutMode: item.payoutMode,
        payoutRef: item.stage2PayoutRef,
        creatorPayoutRef: item.creatorPayoutRef,
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
     * settlement: no payout rail is wired on this deployment, so this is a
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

    /**
     * Ledger sanity check, before a single rupee is recorded as moving.
     *
     * Every tranche is derived independently from `price` by its own helper, so
     * a future edit to one rate — or a stale `advanceAmount` persisted at a
     * different price than the one settling now — could silently produce a split
     * that does not reconcile against what the buyer paid. The pieces are:
     *
     *   advance + final + platformFee + creatorCommission + logistics = gross
     *
     * `logistics` is the deliberate remainder (see src/lib/escrow.ts), so what
     * is asserted is that the parts we DO compute never exceed the gross and
     * never leave a negative remainder. Rounding to whole rupees is by design,
     * so a sub-rupee drift is tolerated; anything larger is a real arithmetic
     * bug and must stop the settlement rather than pay out a wrong number.
     */
    if (price !== null && Number.isFinite(price)) {
      // The advance was released at DISPATCH and persisted then; fall back to
      // recomputing it from the same gross if an older row never stored it.
      const releasedAdvance = item.advanceAmount ?? advanceFor(price);
      const accountedFor = releasedAdvance + final + platformFee + creatorCommission;
      const remainder = price - accountedFor;
      // One rupee of slack absorbs the four independent Math.round() calls.
      if (remainder < -1) {
        console.error(
          `[settle-escrow] split does not reconcile for ${item.id}: gross=${price} ` +
            `advance=${releasedAdvance} final=${final} fee=${platformFee} creator=${creatorCommission} ` +
            `remainder=${remainder}`
        );
        return NextResponse.json(
          {
            error:
              'This settlement does not reconcile against the amount paid and was stopped. No payout was recorded.',
          },
          { status: 409 }
        );
      }
    }

    // Both payouts happen before anything commits, artisan first: their 89.36%
    // is the obligation this engine exists to honour, and the creator's 5% is
    // funded from the platform's own share. If the creator leg fails after the
    // artisan leg succeeded, nothing is written and the whole delivery is
    // re-fired — the idempotency keys make the artisan payout a no-op the
    // second time round rather than a double payment.
    let finalPayout: PayoutResult;
    try {
      finalPayout = await payoutToVpa({
        amount: final,
        vpa: destination ?? '',
        purpose: 'payout',
        referenceId: `${item.id}-STAGE2`,
        contactName: item.artisan?.name,
        notes: { craftItemId: item.id, stage: 'STAGE2_FINAL_SETTLEMENT' },
      });
    } catch (error) {
      return payoutFailure(error, 'STAGE2_FINAL_SETTLEMENT');
    }

    let creatorPayout: PayoutResult | null = null;
    if (affiliate && creatorCommission > 0) {
      try {
        creatorPayout = await payoutToVpa({
          amount: creatorCommission,
          vpa: affiliate.upiId ?? '',
          purpose: 'payout',
          referenceId: `${item.id}-CREATOR`,
          contactName: `@${affiliate.handle}`,
          notes: { craftItemId: item.id, stage: 'CREATOR_COMMISSION' },
        });
      } catch (error) {
        return payoutFailure(error, 'CREATOR_COMMISSION');
      }
    }

    const settlementWrites: Prisma.PrismaPromise<unknown>[] = [
      prisma.craftItem.update({
        where: { id: item.id },
        data: {
          escrowStatus: STAGE2_SETTLED_89,
          finalPayoutQueued: final,
          salePrice: item.salePrice ?? (price !== null && Number.isFinite(price) ? price : null),
          status: 'SOLD_FINAL',
          payoutMode: finalPayout.mode,
          stage2PayoutRef: finalPayout.reference,
          ...(creatorPayout ? { creatorPayoutRef: creatorPayout.reference } : {}),
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
          newState: {
            final,
            platformFee,
            destination,
            payoutMode: finalPayout.mode,
            payoutRef: finalPayout.reference,
          },
          comments:
            finalPayout.mode === 'RAZORPAYX'
              ? `Stage 2 final settlement released programmatically on delivery, direct to the artisan VPA via RazorpayX Payout ${finalPayout.reference}. Total to artisan: 89.36% of gross. No admin approved or touched this.`
              : 'Stage 2 final settlement released programmatically on delivery, direct to the artisan VPA. Total to artisan: 89.36% of gross. Simulated settlement record — RazorpayX payouts are not enabled on this deployment, so no bank credit has been made. No admin approved or touched this.',
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
              payoutMode: creatorPayout?.mode ?? 'SIMULATED',
              payoutRef: creatorPayout?.reference ?? null,
            },
            comments:
              `Creator commission (${Math.round(CREATOR_RATE * 100)}% of gross) released programmatically on delivery, direct to @${affiliate.handle}'s own VPA. Funded from the platform share — the artisan's 89.36% is unchanged. ` +
              (creatorPayout?.mode === 'RAZORPAYX'
                ? `Paid via RazorpayX Payout ${creatorPayout.reference}. No admin approved or touched this.`
                : 'Simulated settlement record — RazorpayX payouts are not enabled on this deployment, so no bank credit has been made. No admin approved or touched this.'),
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
      payoutMode: finalPayout.mode,
      payoutRef: finalPayout.reference,
      // False here means the ledger advanced but no bank credit was made.
      payoutReal: RAZORPAYX_ENABLED,
      ...(affiliate && creatorCommission > 0
        ? {
            affiliate: {
              handle: affiliate.handle,
              commission: creatorCommission,
              destination: affiliate.upiId,
              payoutRef: creatorPayout?.reference ?? null,
            },
          }
        : {}),
    });
  } catch (error) {
    console.error('Settle escrow error:', error);
    return NextResponse.json({ error: 'Failed to settle escrow' }, { status: 500 });
  }
}
