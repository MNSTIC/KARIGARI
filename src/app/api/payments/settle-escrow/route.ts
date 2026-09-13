import { NextResponse } from 'next/server';

/**
 * RETIRED. Escrow now settles through the two routes that own each step.
 *
 * This endpoint used to hold the entire settlement engine behind no
 * authentication — "deliberately NOT behind an admin auth gate" — and nothing in
 * the app called it. Both halves of that were wrong at once:
 *
 *   - ANY anonymous request carrying a `craftItemId` could release an artisan's
 *     40% advance or final settlement, and with RazorpayX enabled that is real
 *     money leaving the platform to whatever state the row was in;
 *   - NO real dispatch or delivery ever reached it, so every storefront sale
 *     sat at ESCROW_HELD forever and no artisan was ever settled.
 *
 * The governance rule it cited is kept exactly: no admin, facilitator or
 * middleman has any financial authority. What changed is that "no admin gate"
 * no longer means "no gate". Each tranche is now released by the one person
 * whose step it is, in the same request that records the step:
 *
 *   DISPATCH  →  POST /api/artisan/sales    { craftItemId, action: "dispatch" }
 *                the artisan who owns the piece; requires it to be packed first
 *   DELIVERED →  POST /api/buyer/sales/delivered   { craftItemId, buyerName }
 *                the buyer who paid for it; requires it to have been dispatched
 *
 * Keeping this route live would also have let the artisan release their advance
 * without packing, skipping a rung the ladder is built on. The engine itself is
 * unchanged and lives in `src/lib/escrowSettle.ts`.
 *
 * 410 rather than 404 so a caller that still has this URL learns it was
 * deliberately removed and where the replacement is, rather than suspecting a
 * typo.
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    {
      error:
        'This endpoint has been retired. Escrow settles through the step that earns it: the artisan releases the advance by dispatching, and the buyer releases the final settlement by confirming delivery.',
      dispatch: 'POST /api/artisan/sales { craftItemId, action: "dispatch" }',
      delivered: 'POST /api/buyer/sales/delivered { craftItemId, buyerName }',
    },
    { status: 410 }
  );
}
