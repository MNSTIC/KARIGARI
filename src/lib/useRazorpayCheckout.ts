"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  RazorpayCheckoutOptions,
  RazorpayFailureResponse,
  RazorpaySuccessResponse,
} from "@/types/razorpay";

/**
 * Opening Razorpay Checkout, once.
 *
 * `ProductClient.tsx` already carried this: the script-load guard, the modal
 * options, the success handler that treats the callback as a TRIGGER rather
 * than proof, and the dismiss/failure paths. V10 adds a second checkout for the
 * demand advance, and a copy-paste would be two places for the "the modal's
 * word proves nothing" rule to live — which is exactly the rule that must not
 * drift.
 *
 * The contract both callers keep: the modal's success callback never means a
 * payment happened. It means ask the server to check the signature. Only the
 * verify route's answer is allowed to change anything on screen.
 */

/**
 * `window.Razorpay` is already declared in src/types/razorpay.d.ts, which owns
 * the Checkout option shape. Redeclaring it here would be a second, competing
 * definition of the same global.
 */

export interface CheckoutOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

export interface OpenCheckoutOptions {
  order: CheckoutOrder;
  /** Shown in the modal header. */
  description: string;
  prefill?: { name?: string; contact?: string };
  /** Called with the gateway's response. MUST verify server-side inside this. */
  onSuccess: (response: RazorpaySuccessResponse) => Promise<void> | void;
  onDismiss?: () => void;
  onFailure?: (message: string) => void;
}

export function useRazorpayCheckout() {
  /** True once checkout.js has defined `window.Razorpay`. Gates the button. */
  const [ready, setReady] = useState(false);

  // The script may already be cached from an earlier visit, in which case the
  // <Script> onReady on the host page has nothing left to fire. Checking on
  // mount is what makes the button work on a second navigation.
  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the rest of this app uses.
    const kickoff = setTimeout(() => {
      if (typeof window !== "undefined" && window.Razorpay) setReady(true);
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const markReady = useCallback(() => setReady(true), []);

  const open = useCallback((opts: OpenCheckoutOptions): boolean => {
    const Checkout = typeof window !== "undefined" ? window.Razorpay : undefined;
    if (!Checkout) return false;

    const options: RazorpayCheckoutOptions = {
      key: opts.order.keyId,
      order_id: opts.order.orderId,
      // A flat demo amount by design — see src/lib/razorpay.ts. Every figure the
      // buyer is SHOWN elsewhere is the real one.
      amount: opts.order.amount,
      currency: opts.order.currency,
      name: "KARIGARI",
      description: opts.description,
      image: "/icons/karigari-logo.png",
      prefill: {
        name: opts.prefill?.name || undefined,
        contact: opts.prefill?.contact || undefined,
      },
      theme: { color: "#24332C" },
      // UPI first. It is how this audience actually pays, and it is the method
      // the escrow story is demonstrated with. Everything Razorpay would
      // otherwise offer stays available underneath.
      config: {
        display: {
          blocks: {
            upi: { name: "Pay by UPI", instruments: [{ method: "upi" }] },
          },
          sequence: ["block.upi"],
          preferences: { show_default_blocks: true },
        },
      },
      handler: async (response: RazorpaySuccessResponse) => {
        await opts.onSuccess(response);
      },
      modal: {
        ondismiss: () => opts.onDismiss?.(),
      },
    };

    const rzp = new Checkout(options);

    rzp.on("payment.failed", (response: RazorpayFailureResponse) => {
      opts.onFailure?.(response?.error?.description || "");
    });

    rzp.open();
    return true;
  }, []);

  return { ready, markReady, open };
}
