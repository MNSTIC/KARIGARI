/**
 * The production gate: may this artisan start work yet?
 *
 * Four routes ask the same question — add a log, verify ready, pack, dispatch —
 * and four copies of the rule would be four chances for one of them to let work
 * through on an unpaid order. One predicate, one message.
 */

/** Advance states in which the artisan may proceed. */
const CLEARED = new Set(['ADVANCE_PAID', 'ADVANCE_WAIVED']);

/**
 * True when production may begin.
 *
 * `ADVANCE_WAIVED` clears the gate as fully as `ADVANCE_PAID` does. It means the
 * demand carried no resolvable price, so there was never a 40% to ask for — and
 * holding an artisan behind a payment that can never be made would strand the
 * order permanently.
 *
 * An unrecognised value is treated as NOT cleared. A status this file has not
 * heard of is not a licence to start work.
 */
export function advancePaidOrWaived(advanceStatus: string | null | undefined): boolean {
  return CLEARED.has(String(advanceStatus ?? ''));
}

/**
 * What the artisan is told.
 *
 * Deliberately calm, and deliberately not phrased as their mistake: they have
 * done nothing wrong, the buyer simply has not paid yet. The UI renders this as
 * a waiting state rather than an error.
 */
export const ADVANCE_PENDING_MESSAGE =
  "The buyer's 40% advance has not been paid yet. You will be told the moment it arrives.";
