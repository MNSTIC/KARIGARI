/**
 * Razorpay Standard Checkout — the BROWSER global.
 *
 * `checkout.js` is loaded from Razorpay's CDN and ships no types, so the
 * handful of options this app actually passes are declared here rather than
 * casting `window` to `any` at the call site. Distinct from the `razorpay` npm
 * package's own `Razorpay` class, which is the server SDK and unrelated to
 * this constructor.
 */

/** What Checkout hands back on a successful payment. Verified server-side. */
export interface RazorpaySuccessResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/** The `payment.failed` event payload. Every field is best-effort. */
export interface RazorpayFailureResponse {
  error?: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: { order_id?: string; payment_id?: string };
  };
}

/** One payment-method block in Checkout's display config. */
export interface RazorpayDisplayBlock {
  name: string;
  instruments: { method: string; flows?: string[]; types?: string[] }[];
}

export interface RazorpayCheckoutOptions {
  /** The PUBLIC key id. Never the secret. */
  key: string;
  order_id: string;
  amount?: number;
  currency?: string;
  name?: string;
  description?: string;
  image?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  /** Which methods Checkout offers. Omitted keys keep Razorpay's defaults. */
  method?: Record<string, boolean>;
  /** Orders the method blocks — used here to put UPI first. */
  config?: {
    display?: {
      blocks?: Record<string, RazorpayDisplayBlock>;
      sequence?: string[];
      preferences?: { show_default_blocks?: boolean };
    };
  };
  handler?: (response: RazorpaySuccessResponse) => void;
  modal?: { ondismiss?: () => void; escape?: boolean; confirm_close?: boolean };
}

export interface RazorpayCheckoutInstance {
  open(): void;
  close(): void;
  on(event: 'payment.failed', handler: (response: RazorpayFailureResponse) => void): void;
}

declare global {
  interface Window {
    /** Undefined until `checkout.js` has finished loading. */
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}
