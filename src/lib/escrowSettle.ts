import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getListingPrice } from '@/lib/pricing';
// The audit entries are written inline via `prisma.auditLog.create` rather than
// through `logCraftItemEvent`, because they have to be composed into the same
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
 * The escrow settlement engine, callable from the routes that legitimately
 * trigger it.
 *
 * WHY THIS MOVED OUT OF `/api/payments/settle-escrow`. That route held this
 * logic behind no authentication at all — "deliberately NOT behind an admin
 * auth gate" — and nothing in the app ever called it. So two things were true
 * at once: any anonymous request carrying a `craftItemId` could release an
 * artisan's escrow tranches, and no real dispatch or delivery ever did. Every
 * storefront sale sat at ESCROW_HELD forever.
 *
 * The governance rule behind "no admin gate" is right and is kept: no admin,
 * facilitator or middleman has financial authority here. But "no admin gate"
 * was never meant to be "no gate". The legitimate triggers are the two people
 * the money moves between, each acting on their own step:
 *
 *   DISPATCH  — the ARTISAN who owns the piece, shipping it
 *               (POST /api/artisan/sales action:"dispatch")
 *   DELIVERED — the BUYER who paid for it, confirming it arrived
 *               (POST /api/buyer/sales/delivered)
 *
 * Those routes authorise the actor and then call this. Keeping the engine in a
 * library means the authorisation lives in the caller, which knows who is
 * asking, and the arithmetic lives here, once.
 *
 * The logic below is the route's, moved rather than rewritten: the same
 * idempotency, the same payout-before-commit ordering, the same reconciliation
 * check. Only the return type changed — a result object instead of an HTTP
 * response — so a caller can fold settlement into its own reply.
 *
 * HONESTY: with RazorpayX off (the default), each tranche is a programmatic
 * settlement record, not a bank credit. `payoutMode` says which happened, and
 * `payoutReal` is false whenever the ledger moved without money moving.
 */

export type SettleAction = 'DISPATCH' | 'DELIVERED';

export interface SettleSuccess {
  ok: true;
  /** True when this stage had already been settled and nothing new moved. */
  idempotent: boolean;
  escrowStatus: string;
  /** The tranche amount, in whole rupees. */
  paid: number;
  destination: string | null;
  payoutMode: string | null;
  payoutRef: string | null;
  /** False means the ledger advanced but no bank credit was made. */
  payoutReal: boolean;
  affiliate?: {
    handle: string;
    commission: number;
    destination: string | null;
    payoutRef: string | null;
  };
}

export interface SettleFailure {
  ok: false;
  /** The HTTP status a route should send. */
  status: number;
  error: string;
  /** Which tranche failed, when the failure was a payout. */
  stage?: string;
}

export type SettleResult = SettleSuccess | SettleFailure;

/**
 * A failed REAL payout leaves the escrow stage untouched, so the step stays
 * re-fireable once the problem is fixed. Nothing is written.
 */
function payoutFailure(error: unknown, stage: string): SettleFailure {
  const detail =
    error instanceof PayoutError ? error.message : 'The payout could not be completed.';
  console.error(`[escrowSettle] payout failed (${stage}):`, error);
  return {
    ok: false,
    status: error instanceof PayoutError ? error.status : 502,
    error: detail,
    stage,
  };
}

/** The escrow state a sale must be in for `action` to be a valid next step. */
export function settleBlockedReason(escrowStatus: string | null, action: SettleAction): string | null {
  if (action === 'DISPATCH') {
    if (escrowStatus === STAGE1_ADVANCE_PAID_40 || escrowStatus === STAGE2_SETTLED_89) return null;
    return escrowStatus === ESCROW_HELD
      ? null
      : 'No escrow is held for this item yet. The payment has to be verified first.';
  }
  if (escrowStatus === STAGE2_SETTLED_89) return null;
  return escrowStatus === STAGE1_ADVANCE_PAID_40
    ? null
    : 'The 40% dispatch advance has not been released yet.';
}

export async function settleEscrow(
  craftItemId: string,
  action: SettleAction
): Promise<SettleResult> {
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

  if (!item) return { ok: false, status: 404, error: 'Item not found' };

  const price = item.salePrice ?? getListingPrice(item);
  const destination = item.artisanUpiDestination;

  // ---- DISPATCH : Stage 1, the 40% advance --------------------------------

  if (action === 'DISPATCH') {
    // Already advanced (or fully settled) — report the recorded tranche
    // instead of releasing a second one.
    if (
      item.escrowStatus === STAGE1_ADVANCE_PAID_40 ||
      item.escrowStatus === STAGE2_SETTLED_89
    ) {
      return {
        ok: true,
        idempotent: true,
        escrowStatus: item.escrowStatus,
        paid: item.advancePaid,
        destination,
        payoutMode: item.payoutMode,
        payoutRef: item.stage1PayoutRef,
        payoutReal: item.payoutMode === 'RAZORPAYX',
      };
    }

    if (item.escrowStatus !== ESCROW_HELD) {
      return {
        ok: false,
        status: 409,
        error: 'No escrow is held for this item yet. The payment has to be verified first.',
      };
    }

    const advance =
      item.advanceAmount ??
      (price !== null && Number.isFinite(price) ? advanceFor(price) : null);
    if (advance === null) {
      return {
        ok: false,
        status: 409,
        error: 'This item carries no price, so no advance can be computed.',
      };
    }

    // The money moves BEFORE the ledger commits. A real payout that fails must
    // leave the item exactly as it was, so the dispatch can be re-fired once the
    // cause is fixed; a payout that succeeds but whose commit then fails is
    // recovered by re-firing too, because the RazorpayX idempotency key returns
    // the original payout instead of releasing a second one.
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

    await prisma.$transaction([
      prisma.craftItem.update({
        where: { id: item.id },
        data: {
          escrowStatus: STAGE1_ADVANCE_PAID_40,
          advancePaid: advance,
          // `status` is deliberately left at SOLD_FINAL. The route this came
          // from set it to ADVANCE_PAID, which is the PRE-SALE capture-advance
          // label (see /api/disbursement/apply) — flipping a sold piece to it
          // mid-transit made /verify/[patchId] report the piece as not
          // purchased at exactly the moment the buyer scans it on arrival, and
          // dropped it from every `[SOLD_FINAL, SOLD_MIDDLEMAN]` sold count
          // until delivery. That flip was unreachable while nothing called
          // settlement; dispatch now does, so it had to go. The advance is
          // recorded where it belongs, on `escrowStatus`.
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

    return {
      ok: true,
      idempotent: false,
      escrowStatus: STAGE1_ADVANCE_PAID_40,
      paid: advance,
      destination,
      payoutMode: payout.mode,
      payoutRef: payout.reference,
      payoutReal: RAZORPAYX_ENABLED,
    };
  }

  // ---- DELIVERED : Stage 2, the final settlement --------------------------

  if (item.escrowStatus === STAGE2_SETTLED_89) {
    return {
      ok: true,
      idempotent: true,
      escrowStatus: item.escrowStatus,
      paid: item.finalPayoutQueued,
      destination,
      payoutMode: item.payoutMode,
      payoutRef: item.stage2PayoutRef,
      payoutReal: item.payoutMode === 'RAZORPAYX',
    };
  }

  if (item.escrowStatus !== STAGE1_ADVANCE_PAID_40) {
    return {
      ok: false,
      status: 409,
      error: 'The 40% dispatch advance has not been released yet.',
    };
  }

  const final =
    item.finalSettlementAmount ??
    (price !== null && Number.isFinite(price) ? finalSettlementFor(price) : null);
  if (final === null) {
    return {
      ok: false,
      status: 409,
      error: 'This item carries no price, so no settlement can be computed.',
    };
  }

  // 40% + 49.36% = 89.36% of gross reaches the artisan. KARIGARI retains a
  // nominal 3.5% maintenance fee; the remaining ~7.14% covers logistics and the
  // payment gateway. See src/lib/escrow.ts for the full split.
  const platformFee = price !== null && Number.isFinite(price) ? platformFeeFor(price) : 0;

  /**
   * The creator's 5%, on an attributed sale only. Funded from the platform-side
   * remainder — the artisan still receives 89.36% of gross. Paid to the
   * creator's OWN VPA, read here rather than passed in, so no caller can
   * redirect it.
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
   *   advance + final + platformFee + creatorCommission + logistics = gross
   *
   * `logistics` is the deliberate remainder, so what is asserted is that the
   * parts we DO compute never exceed the gross. One rupee of slack absorbs the
   * four independent Math.round() calls; anything larger is a real arithmetic
   * bug and stops the settlement rather than paying out a wrong number.
   */
  if (price !== null && Number.isFinite(price)) {
    const releasedAdvance = item.advanceAmount ?? advanceFor(price);
    const accountedFor = releasedAdvance + final + platformFee + creatorCommission;
    const remainder = price - accountedFor;
    if (remainder < -1) {
      console.error(
        `[escrowSettle] split does not reconcile for ${item.id}: gross=${price} ` +
          `advance=${releasedAdvance} final=${final} fee=${platformFee} creator=${creatorCommission} ` +
          `remainder=${remainder}`
      );
      return {
        ok: false,
        status: 409,
        error:
          'This settlement does not reconcile against the amount paid and was stopped. No payout was recorded.',
      };
    }
  }

  // Both payouts happen before anything commits, artisan first: their 89.36% is
  // the obligation this engine exists to honour. If the creator leg fails after
  // the artisan leg succeeded, nothing is written and the whole delivery is
  // re-fired — the idempotency keys make the artisan payout a no-op the second
  // time round rather than a double payment.
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
        // SOLD_FINAL, exactly as the original route wrote. PAYOUT_COMPLETED
        // looks more precise but is the ADMIN manual-payout state
        // (/api/admin/payouts), and the artisan dashboard sums
        // `finalPayoutQueued` over `status: 'SOLD_FINAL'` alone — writing
        // anything else here would silently drop every settled storefront sale
        // from its queued-payout figure and its sold count. What distinguishes
        // "settled" from "just paid" is `escrowStatus`, which every reader that
        // cares already has.
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

  return {
    ok: true,
    idempotent: false,
    escrowStatus: STAGE2_SETTLED_89,
    paid: final,
    destination,
    payoutMode: finalPayout.mode,
    payoutRef: finalPayout.reference,
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
  };
}
