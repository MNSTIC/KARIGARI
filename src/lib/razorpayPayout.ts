/**
 * UPI payouts — the money-OUT half of the escrow.
 *
 * WHAT THIS IS FOR. Razorpay Checkout only ever COLLECTS: a buyer's rupee lands
 * in the platform's own merchant account. Sending it back out to an artisan's
 * VPA is a different product — RazorpayX Payouts (or Route) — with its own
 * account, its own KYC and its own credentials. This module is that second leg.
 *
 * WHY IT IS OFF BY DEFAULT. RazorpayX Payouts needs an ACTIVATED, KYC'd
 * RazorpayX account with a funded virtual account number. A Checkout key —
 * `rzp_test_...` or `rzp_live_...` — cannot make one. So unless the deployment
 * is explicitly configured for it, `payoutToVpa` returns a SIMULATED result and
 * makes no network call at all. The escrow state machine, the ledger and the
 * audit trail stay real; only the bank credit is simulated, and every audit row
 * says which of the two happened.
 *
 * Server-only: no React, no Prisma, secrets read from env and never exported.
 *
 * Docs: https://razorpay.com/docs/razorpayx/
 *       https://razorpay.com/docs/api/x/payouts/
 */

const KEY_ID = (process.env.RAZORPAYX_KEY_ID || '').trim();
const KEY_SECRET = (process.env.RAZORPAYX_KEY_SECRET || '').trim();

/** The RazorpayX virtual account the money is debited FROM. */
const ACCOUNT_NUMBER = (process.env.RAZORPAYX_ACCOUNT_NUMBER || '').trim();

/**
 * Real payouts run only when the flag is explicitly on AND every credential is
 * present. Both halves are required on purpose: a half-configured deployment
 * must fall back to a recorded settlement rather than fail a dispatch.
 */
export const RAZORPAYX_ENABLED =
  (process.env.RAZORPAYX_ENABLED || '').trim().toLowerCase() === 'true' &&
  Boolean(KEY_ID && KEY_SECRET && ACCOUNT_NUMBER);

/** Why the flag is off, for the operator. Never shown to a buyer. */
export function razorpayxStatus(): string {
  if (RAZORPAYX_ENABLED) return 'RazorpayX payouts enabled.';
  if ((process.env.RAZORPAYX_ENABLED || '').trim().toLowerCase() !== 'true') {
    return 'RAZORPAYX_ENABLED is not "true" — settlements are recorded, not paid out.';
  }
  return 'RAZORPAYX_ENABLED is true but RAZORPAYX_KEY_ID / _KEY_SECRET / _ACCOUNT_NUMBER are incomplete — settlements are recorded, not paid out.';
}

export interface PayoutResult {
  mode: 'RAZORPAYX' | 'SIMULATED';
  /** RazorpayX payout id (`pout_…`), or `SIM_<referenceId>` when simulated. */
  reference: string;
  vpa: string;
  /** Rupees, matching the escrow helpers. Converted to paise on the wire. */
  amount: number;
  raw?: unknown;
}

/** A payout that did not happen. The caller must NOT mark the tranche paid. */
export class PayoutError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'PayoutError';
    this.status = status;
    this.detail = detail;
  }
}

export interface PayoutRequest {
  /** RUPEES, not paise — the same unit `advanceFor` / `finalSettlementFor` return. */
  amount: number;
  /** The artisan's or creator's own VPA. Read from the DB by the caller, never from a request body. */
  vpa: string;
  /** RazorpayX purpose code. `payout` for a settlement, `refund` for a reversal. */
  purpose?: string;
  /**
   * Stable per-tranche id, e.g. `<itemId>-STAGE1`. Doubles as the idempotency
   * key, so a retried dispatch can never release the same tranche twice.
   */
  referenceId: string;
  /** Who is being paid, for the RazorpayX contact record. */
  contactName?: string;
  notes?: Record<string, string>;
}

/** RazorpayX rejects a payout under ₹1, and a zero tranche is a bug upstream. */
function toPaise(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PayoutError(`Refusing to pay out a non-positive amount (${amount}).`, 400);
  }
  return Math.round(amount * 100);
}

function simulated(request: PayoutRequest): PayoutResult {
  return {
    mode: 'SIMULATED',
    reference: `SIM_${request.referenceId}`,
    vpa: request.vpa,
    amount: request.amount,
  };
}

/**
 * Pay one tranche to a UPI VPA.
 *
 * Returns a SIMULATED result — no network call — whenever RazorpayX is not
 * fully configured, which is the default for this deployment. Throws
 * `PayoutError` only when a REAL payout was attempted and failed; the caller
 * must then leave the escrow stage untouched so the dispatch stays re-fireable.
 */
export async function payoutToVpa(request: PayoutRequest): Promise<PayoutResult> {
  // Validated even in simulated mode, so a bad amount surfaces in the demo
  // rather than waiting for the day real payouts are switched on.
  const amountPaise = toPaise(request.amount);

  // A missing VPA is fatal only when money would really move. Simulated mode
  // stays tolerant of it so rows captured before the artisan had a VPA on file
  // still advance through the ladder exactly as they did before this module
  // existed — the audit row records the empty destination either way.
  if (!request.vpa && RAZORPAYX_ENABLED) {
    throw new PayoutError('No payout VPA on file for this item.', 409);
  }

  if (!RAZORPAYX_ENABLED) return simulated(request);

  // Composite payout: RazorpayX creates the contact and the VPA fund account
  // from this body, so the app never has to store a fund_account_id.
  const body = {
    account_number: ACCOUNT_NUMBER,
    amount: amountPaise,
    currency: 'INR',
    mode: 'UPI',
    purpose: request.purpose || 'payout',
    queue_if_low_balance: true,
    reference_id: request.referenceId,
    narration: 'KARIGARI settlement',
    fund_account: {
      account_type: 'vpa',
      vpa: { address: request.vpa },
      contact: {
        name: request.contactName || 'KARIGARI artisan',
        type: 'vendor',
        reference_id: request.referenceId,
      },
    },
    ...(request.notes ? { notes: request.notes } : {}),
  };

  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');

  let response: Response;
  try {
    response = await fetch('https://api.razorpay.com/v1/payouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
        // Retrying with the same key returns the ORIGINAL payout instead of
        // creating a second one. This is what makes a re-fired dispatch safe.
        'X-Payout-Idempotency': request.referenceId,
      },
      body: JSON.stringify(body),
      // A hung gateway must not hold a dispatch open indefinitely.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new PayoutError(
      `RazorpayX payout could not be reached: ${error instanceof Error ? error.message : 'network error'}`,
      502,
      error
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (payload as { error?: { description?: string } } | null)?.error?.description ||
      `RazorpayX returned ${response.status}`;
    throw new PayoutError(`RazorpayX payout failed: ${message}`, 502, payload);
  }

  const id = (payload as { id?: string } | null)?.id;
  if (!id) {
    throw new PayoutError('RazorpayX accepted the payout but returned no id.', 502, payload);
  }

  return {
    mode: 'RAZORPAYX',
    reference: id,
    vpa: request.vpa,
    amount: request.amount,
    raw: payload,
  };
}
