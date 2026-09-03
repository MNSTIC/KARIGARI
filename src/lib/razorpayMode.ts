/**
 * Test mode or live mode — the one fact both halves of the app need.
 *
 * Deliberately free of every import so a client component can use it. The
 * server half (`src/lib/razorpay.ts`) pulls in the Razorpay SDK and `crypto`
 * and can never be imported into the browser; this can.
 *
 * WHY IT MATTERS. The mode is not cosmetic. In test mode nothing is charged
 * and the storefront may honestly say so. With an `rzp_live_` key every "Buy
 * Now" takes a real rupee off a real card or UPI account, and any copy still
 * promising "no live charge is made" is a lie told to a paying buyer. The
 * strings on the product page and the marketplace banner therefore key off
 * this value rather than being hardcoded.
 *
 * The prefix is Razorpay's own convention (`rzp_test_` / `rzp_live_`), and the
 * *key id* is public by design, so reading it in the browser gives away
 * nothing. The secret never appears here.
 */

/** The public key id, inlined into the client bundle by Next at build time. */
export const RAZORPAY_PUBLIC_KEY_ID = (process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '').trim();

/** True for an `rzp_live_` key id: real money moves. */
export function isLiveKeyId(keyId: string | null | undefined): boolean {
  return (keyId || '').trim().startsWith('rzp_live_');
}

/**
 * Whether THIS deployment charges real money.
 *
 * Read from the public key id so the browser and the server agree. Keep
 * `NEXT_PUBLIC_RAZORPAY_KEY_ID` in step with `RAZORPAY_KEY_ID`: if they
 * disagree, the server decides what is actually charged and this only decides
 * what the buyer is told — which is the one mismatch that would matter.
 */
export const RAZORPAY_LIVE_MODE = isLiveKeyId(RAZORPAY_PUBLIC_KEY_ID);
