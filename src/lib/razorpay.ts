import crypto from 'crypto';
import Razorpay from 'razorpay';
import { isLiveKeyId } from '@/lib/razorpayMode';

/**
 * Razorpay Standard Checkout — the server half.
 *
 * Deliberately free of React and Prisma imports so it can be pulled into any
 * route handler without dragging a client bundle or a DB connection with it.
 *
 * TRUST BOUNDARY. `RAZORPAY_KEY_SECRET` never leaves this module. The key *id*
 * is public by design — the browser needs it to open the modal — but the id
 * alone can only *start* a payment. What proves a payment actually happened is
 * the HMAC signature Razorpay returns, and only the secret can check that. So:
 *
 *   - `RAZORPAY_KEY_ID` is safe to return to a client.
 *   - `RAZORPAY_KEY_SECRET` is read here and nowhere else.
 *   - Never add a `NEXT_PUBLIC_` alias for the secret. Next inlines every
 *     `NEXT_PUBLIC_` value into the browser bundle.
 */

const KEY_ID = (process.env.RAZORPAY_KEY_ID || '').trim();
const KEY_SECRET = (process.env.RAZORPAY_KEY_SECRET || '').trim();

/** The public key id, safe to hand to the browser so Checkout can open. */
export const RAZORPAY_KEY_ID = KEY_ID;

/** Both halves present. False → the buy button returns an honest 503. */
export const RAZORPAY_CONFIGURED = Boolean(KEY_ID && KEY_SECRET);

/**
 * Whether the SERVER key charges real money. Authoritative — this is the key
 * the order is actually created with.
 *
 * `RAZORPAY_LIVE_MODE` in `src/lib/razorpayMode.ts` reads the public key id and
 * decides what the buyer is *told*. Keep the two env values in step.
 */
export const RAZORPAY_LIVE = isLiveKeyId(KEY_ID);

/**
 * FLAT CHARGE — the only place the amount is decided.
 *
 * The point of this flow is to demonstrate the escrow ladder, not to collect
 * the listing price, so Razorpay is asked for ₹1 no matter what the piece
 * costs. 100 paise is also Razorpay's own minimum order amount, so it is the
 * smallest chargeable value.
 *
 * ⚠ IN LIVE MODE THIS IS A REAL RUPEE. It is debited from a real card or UPI
 * account and settles into the merchant account the keys belong to. It is
 * small, not simulated. Nothing here refunds it.
 *
 * Everything the buyer SEES stays the real listing price: the product page,
 * the marketplace cards, `salePrice`, both escrow tranches and the artisan's
 * earnings are all still computed from `getListingPrice(item)`. Only
 * `order.amount` is this constant.
 *
 * To bill the real price, delete this constant and pass
 * `Math.round(price * 100)` as the order amount in
 * `/api/payments/create-order`. That is the entire revert — and in live mode
 * it means charging buyers thousands of rupees, so change it deliberately.
 */
export const DEMO_CHARGE_PAISE = 100;

let client: Razorpay | null = null;

/**
 * The Razorpay SDK client, built on first use.
 *
 * Lazy because a module-scope `new Razorpay(...)` would throw at import time on
 * a deployment with no keys, taking down every route that merely imports this
 * file — including the ones whose job is to report the misconfiguration.
 *
 * @throws when the keys are missing. Callers must check `RAZORPAY_CONFIGURED`
 *         first and return a 503, rather than letting this surface as a 500.
 */
export function getRazorpay(): Razorpay {
  if (!RAZORPAY_CONFIGURED) {
    throw new Error('Razorpay is not configured: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }
  if (!client) {
    client = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  }
  return client;
}

/**
 * Does this payment response actually come from Razorpay?
 *
 * Razorpay signs `<order_id>|<payment_id>` with the key secret. Recomputing
 * that HMAC and comparing is the ONLY thing that proves a payment happened —
 * the browser's word for it proves nothing, since anyone can POST a made-up
 * payment id at the verify route.
 *
 * Compared with `timingSafeEqual` so the comparison cannot be walked one byte
 * at a time. Length is checked first because `timingSafeEqual` throws on
 * mismatched buffers, and a wrong-length signature is a mismatch anyway.
 */
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  if (!RAZORPAY_CONFIGURED || !orderId || !paymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
