/**
 * Non-custodial escrow unit economics — the single source of truth for the
 * split, shared by `/api/payments/create-checkout` and
 * `/api/payments/settle-escrow` so the amount quoted at checkout is the amount
 * released on dispatch.
 *
 * GOVERNANCE RULE: no admin, facilitator or middleman has any financial
 * authority here. Nothing in this file is gated behind an approval step. The
 * two tranches are released by machine on `DISPATCH` and `DELIVERED`, and the
 * destination is always the artisan's own registered VPA.
 *
 * HONESTY: Stripe runs in TEST mode and Stripe cannot settle to an Indian VPA
 * in test, so the transfers are recorded as programmatic settlement records.
 * The escrow state machine, the ledger fields and the immutable audit trail are
 * real; the bank credit itself is simulated. Never label these as a confirmed
 * bank credit.
 *
 * Of every ₹100 a buyer pays:
 *   ₹40.00  Stage 1 — fair-wage advance, released on dispatch
 *   ₹49.36  Stage 2 — final settlement, released on delivery
 *   -------
 *   ₹89.36  direct to the artisan's VPA
 *    ₹3.50  KARIGARI platform maintenance fee (nominal)
 *    ₹7.14  logistics + payment-gateway costs
 *
 * When the sale came through a creator's affiliate link, ₹5.00 of that ₹7.14
 * platform-side remainder goes to the creator's own VPA on delivery:
 *   ₹89.36  artisan       (unchanged — the 40% dispatch advance is never touched)
 *    ₹5.00  creator       (only on an attributed sale)
 *    ₹3.50  platform fee
 *    ₹2.14  logistics + gateway
 *   -------
 *  ₹100.00
 *
 * The commission is funded entirely from the platform's side of the split. An
 * artisan promoted by a creator earns exactly what an unpromoted one earns.
 */

/** Stage 1: fair-wage advance, released the moment the item is dispatched. */
export const ADVANCE_RATE = 0.4;

/** Stage 2: final tranche, released on delivery. 40% + 49.36% = 89.36% total. */
export const FINAL_SETTLEMENT_RATE = 0.4936;

/** Nominal platform maintenance fee. KARIGARI never touches the artisan's share. */
export const PLATFORM_FEE_RATE = 0.035;

/**
 * Creator/influencer commission on an attributed sale.
 *
 * Taken from the platform-side remainder above, NOT from the artisan's share:
 * an affiliate link must never make a craft worth less to the person who made
 * it. Paid direct to the creator's own VPA on delivery, in the same
 * transaction that settles the artisan.
 */
export const CREATOR_RATE = 0.05;

/** Share of gross that reaches the artisan across both tranches. */
export const ARTISAN_TOTAL_RATE = ADVANCE_RATE + FINAL_SETTLEMENT_RATE;

export const ESCROW_HELD = 'ESCROW_HELD';
export const STAGE1_ADVANCE_PAID_40 = 'STAGE1_ADVANCE_PAID_40';
export const STAGE2_SETTLED_89 = 'STAGE2_SETTLED_89';

export type EscrowStatus =
  | typeof ESCROW_HELD
  | typeof STAGE1_ADVANCE_PAID_40
  | typeof STAGE2_SETTLED_89;

/** Rupee amounts are whole; a half-paisa tranche would never reconcile. */
export function rupees(value: number): number {
  return Math.round(value);
}

export function advanceFor(gross: number): number {
  return rupees(gross * ADVANCE_RATE);
}

export function finalSettlementFor(gross: number): number {
  return rupees(gross * FINAL_SETTLEMENT_RATE);
}

export function platformFeeFor(gross: number): number {
  return rupees(gross * PLATFORM_FEE_RATE);
}

/** The creator's 5%, on an attributed sale only. */
export function creatorCommissionFor(gross: number): number {
  return rupees(gross * CREATOR_RATE);
}

/** The label the UI must use. Programmatic settlement — not a bank confirmation. */
export const SETTLEMENT_LABEL =
  'Programmatic settlement (test) — direct to artisan VPA, zero middleman';

/** Same honesty framing for the creator half of an attributed sale. */
export const CREATOR_SETTLEMENT_LABEL =
  'Programmatic settlement (test) — direct to creator VPA, zero middleman';

/**
 * The share of one item's gross that actually reaches the artisan, as a
 * percentage — what the marketplace prints under every card.
 *
 * Derived from the two tranche helpers rather than from `ARTISAN_TOTAL_RATE`
 * directly, so the number on screen is the number the settlement engine will
 * pay: both tranches are rounded to whole rupees, which moves the effective
 * share a hundredth of a point either way on small amounts. With no price yet
 * it falls back to the nominal rate.
 */
export function artisanSharePctFor(gross: number | null | undefined): number {
  const value = Number(gross);
  if (!Number.isFinite(value) || value <= 0) return ARTISAN_TOTAL_RATE * 100;
  return ((advanceFor(value) + finalSettlementFor(value)) / value) * 100;
}
