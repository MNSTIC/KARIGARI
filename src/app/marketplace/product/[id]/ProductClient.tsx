"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Script from "next/script";
import {
  ArrowLeft,
  CheckCircle2,
  Info,
  Loader2,
  MapPin,
  Package,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PatchIdChip, VerifiedOriginBadge } from "@/components/ui/Badge";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { artisanSharePctFor } from "@/lib/escrow";
import { formatRupees } from "@/lib/pricing";
import { imageProps, marketPrice, type MarketItem } from "@/lib/marketplace";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { captureRefFromUrl, currentRef, trackRef } from "@/lib/affiliateRef";
import { readBuyerContact, readBuyerName, rememberBuyer } from "@/lib/buyerIdentity";
import { ReviewSection } from "@/components/ReviewSection";
import { RAZORPAY_LIVE_MODE } from "@/lib/razorpayMode";
import type { RazorpayFailureResponse, RazorpaySuccessResponse } from "@/types/razorpay";

/**
 * One published craft item, and the direct-to-artisan buy button.
 *
 * "Buy Now" opens the Razorpay Standard Checkout modal. There is no redirect:
 * the payment happens in an overlay on this page, and the sale is only booked
 * once `/api/payments/verify-payment` has checked Razorpay's own signature
 * server-side. What follows is the non-custodial escrow: the artisan's own VPA
 * is locked in as the destination before anything moves, and neither tranche
 * passes through an admin.
 *
 * The buyer is charged ₹1 whatever the piece costs; the constant that decides
 * it lives in src/lib/razorpay.ts. Everything shown on this page is the real
 * listing price, and so is everything the escrow ladder and the artisan's
 * earnings are computed from.
 *
 * The note under the button keys off `RAZORPAY_LIVE_MODE`, because in live
 * mode that ₹1 is a real debit and telling a paying buyer "no live charge is
 * made" would be false.
 */
export function ProductClient({ id }: { id: string }) {
  const { t } = useLanguage();
  const [item, setItem] = useState<MarketItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  /** True once checkout.js has defined `window.Razorpay`. Gates the button. */
  const [checkoutReady, setCheckoutReady] = useState(false);
  /** Set after the server has verified the signature — never on the modal alone. */
  const [paid, setPaid] = useState(false);
  /** Free-text buyer identity; the storefront has no accounts. */
  const [buyerName, setBuyerName] = useState("");
  const [buyerContact, setBuyerContact] = useState("");
  /** The creator credited for this visit — from `?ref=` or the stored session. */
  const [ref, setRef] = useState("");
  /** The bulk demand this purchase fulfils, when arrived at from /buyer. */
  const [demandId, setDemandId] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/items/market?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data?.success && data.item) {
        setItem(data.item as MarketItem);
      } else {
        setNotFound(true);
      }
    } catch (error) {
      console.error("Failed to load the product:", error);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the other client pages use.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  // Creator attribution. A `?ref=` on this URL wins; otherwise the handle the
  // shopper arrived on at /marketplace carries over from sessionStorage. The
  // click is recorded against this specific item.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      const handle = captureRefFromUrl() || currentRef();
      if (!handle) return;
      setRef(handle);
      trackRef(handle, id);
    }, 0);
    return () => clearTimeout(kickoff);
  }, [id]);

  // The demand this purchase fulfils, and the buyer identity this browser
  // already knows. Read straight off the URL rather than via useSearchParams,
  // so this page needs no Suspense boundary.
  //
  // `?payment=cancelled` is a leftover from the old redirect checkout. Nothing
  // produces it any more, but an old bookmark still lands here, so it is
  // honoured rather than ignored.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      setBuyerName(readBuyerName());
      setBuyerContact(readBuyerContact());

      const params = new URLSearchParams(window.location.search);
      const demand = params.get("demand");
      if (demand) setDemandId(demand);
      if (params.get("payment") !== "cancelled") return;
      setCancelled(true);
      params.delete("payment");
      const query = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  // checkout.js may already be on the page from an earlier visit in this SPA
  // session, in which case <Script onReady> is the only signal that fires —
  // but a hard refresh with a warm HTTP cache can also define the global before
  // React mounts. Check once on mount so the button is never stuck disabled.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      if (typeof window !== "undefined" && window.Razorpay) setCheckoutReady(true);
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  /**
   * Open the Razorpay modal — then let the SERVER decide whether a sale happened.
   *
   * The modal's own success callback proves nothing on its own; it is only the
   * trigger to ask `/api/payments/verify-payment` to check the signature. The
   * page shows a sale as complete when, and only when, that route says so.
   */
  const buyNow = async () => {
    if (!item) return;
    setBuying(true);
    setBuyError(null);
    setCancelled(false);

    try {
      const res = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The creator handle rides along so create-order can attach the
        // attribution before the escrow row is written.
        body: JSON.stringify({ craftItemId: item.id, ref: ref || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !data.orderId) {
        setBuyError(data?.error || t("checkout_failed"));
        setBuying(false);
        return;
      }

      const Checkout = window.Razorpay;
      if (!Checkout) {
        setBuyError(t("checkout_script_failed"));
        setBuying(false);
        return;
      }

      const rzp = new Checkout({
        key: data.keyId,
        order_id: data.orderId,
        // ₹1 by design — see src/lib/razorpay.ts. The price above is real.
        amount: data.amount,
        currency: data.currency,
        name: "KARIGARI",
        description: item.craftType,
        image: "/icons/karigari-logo.png",
        prefill: {
          name: buyerName || undefined,
          contact: buyerContact || undefined,
        },
        theme: { color: "#24332C" },
        // UPI first. It is how this audience actually pays, and it is the one
        // method whose QR the escrow story is demonstrated with. Everything
        // Razorpay would otherwise offer stays available underneath.
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
          try {
            const verify = await fetch("/api/payments/verify-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...response,
                craftItemId: item.id,
                buyerName: buyerName || undefined,
                buyerContact: buyerContact || undefined,
                relatedDemandId: demandId || undefined,
              }),
            });
            const result = await verify.json();
            if (!verify.ok || !result?.success) {
              setBuyError(result?.error || t("payment_verify_failed"));
              return;
            }
            // Remembered so the My Orders tab on /buyer finds this purchase.
            rememberBuyer(buyerName, buyerContact);
            setPaid(true);
            void load();
          } catch (error) {
            console.error("Payment verification failed:", error);
            setBuyError(t("payment_verify_failed"));
          } finally {
            setBuying(false);
          }
        },
        modal: {
          ondismiss: () => {
            setBuying(false);
            setCancelled(true);
          },
        },
      });

      rzp.on("payment.failed", (response: RazorpayFailureResponse) => {
        setBuying(false);
        setBuyError(response?.error?.description || t("payment_failed"));
      });

      rzp.open();
    } catch (error) {
      console.error("Checkout failed:", error);
      setBuyError(t("checkout_failed"));
      setBuying(false);
    }
  };

  const price = item ? marketPrice(item) : null;
  const description = item
    ? item.descriptionEnglish || item.aiGeneratedListing || item.descriptionOriginal || ""
    : "";
  const images = item?.images?.length ? item.images : [];

  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans pb-16">
      {/* Loaded once per page. `onReady` fires both on a fresh load and when the
          script is already cached from an earlier visit, which is what makes it
          the right signal to ungate the buy button. */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onReady={() => setCheckoutReady(true)}
        onError={() => setBuyError(t("checkout_script_failed"))}
      />

      <header className="sticky top-0 z-40 border-b border-gray-200/60 bg-[var(--color-background)]/90 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-[1180px] items-center gap-3 px-4 sm:px-6 lg:px-10">
          <Link
            href="/marketplace"
            aria-label={t('back_to_marketplace')}
            className="kg-press flex h-11 w-11 items-center justify-center rounded-full text-gray-700 hover:bg-[var(--color-pill)]"
          >
            <ArrowLeft size={20} />
          </Link>
          <Link href="/" className="kg-display text-[21px] leading-none text-gray-900">
            Karigari
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
        {loading ? (
          <div className="py-24 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : notFound || !item ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-12 text-center">
            <p className="text-sm text-gray-500 italic mb-4">
              {t('product_unavailable')}
            </p>
            <Link
              href="/marketplace"
              className="kg-press mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-6 text-[13px] font-semibold text-white hover:bg-primary-dark"
            >
              {t('back_to_marketplace')}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
            {/* Gallery */}
            <div>
              <div className="relative aspect-square overflow-hidden rounded-3xl bg-[var(--color-pill)]">
                {images[activeImage] ? (
                  <Image
                    {...imageProps(images[activeImage])}
                    fill
                    alt={item.craftType}
                    className="object-cover"
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    priority
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <Package size={48} />
                  </div>
                )}
              </div>

              {images.length > 1 && (
                <div className="flex gap-3 mt-4 overflow-x-auto pb-1">
                  {images.map((src, index) => (
                    <button
                      key={`${src.slice(0, 24)}-${index}`}
                      onClick={() => setActiveImage(index)}
                      aria-label={`${t('view_photo')} ${index + 1}`}
                      className={cn(
                        "relative h-16 w-16 shrink-0 rounded-xl overflow-hidden border-2 transition-colors",
                        index === activeImage
                          ? "border-gray-900"
                          : "border-transparent hover:border-gray-300"
                      )}
                    >
                      <Image
                        {...imageProps(src)}
                        fill
                        alt=""
                        className="object-cover"
                        sizes="64px"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Detail + buy */}
            <div className="flex flex-col">
              {ref && (
                <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-orange-100 bg-orange-50 p-3.5">
                  <Sparkles size={16} className="shrink-0 mt-0.5 text-amber-600" />
                  <p className="text-xs text-amber-900 leading-relaxed">
                    <span className="font-bold">{t('endorsed_by')} @{ref}</span>
                    <span className="block mt-0.5 text-amber-800/80">
                      They earn 5% of this sale, paid direct to their UPI on delivery. The
                      artisan&rsquo;s share is unchanged.
                    </span>
                  </p>
                </div>
              )}

              {/* No GI badge. GI claims were removed from the product earlier and
                  stay removed: what Karigari can actually attest to is that this
                  piece carries a patch ID matched against a re-photograph. */}
              <div className="mb-4 flex flex-wrap items-center gap-2.5">
                {item.patchId && <VerifiedOriginBadge className="shadow-none" />}
                {item.isOndcLive && (
                  <span className="kg-label rounded-full bg-[var(--color-pill)] px-2.5 py-1.5 font-medium text-gray-700">
                    {t('live_on_ondc')}
                  </span>
                )}
              </div>

              <h1 className="kg-display text-[34px] leading-tight text-gray-900 sm:text-[42px]">
                {item.craftType}
              </h1>

              <p className="mt-3 flex items-center gap-1.5 text-[14px] text-gray-600">
                <MapPin size={13} className="text-gray-400" /> {item.artisan.clusterName}
                {item.artisan.location ? ` · ${item.artisan.location}` : ""}
              </p>
              <p className="mt-1 text-[14px] text-gray-600">
                {t('handcrafted_by')}{" "}
                <span className="font-semibold text-gray-900">{item.artisan.name}</span>
              </p>

              <p className="kg-display mt-6 text-[40px] leading-none text-gray-900">
                {formatRupees(price)}
              </p>

              {/* The real escrow arithmetic, not a fixed headline number. */}
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-gray-200/70 py-3.5">
                <span className="kg-label font-medium text-[var(--color-rust)]">
                  Artisan Share: {artisanSharePctFor(price).toFixed(2)}%
                </span>
                {item.patchId && <PatchIdChip patchId={item.patchId} />}
              </div>

              {item.fairWageFloor !== null && (
                <p className="mt-3 text-xs text-gray-500">
                  {t('ai_fair_floor_note')} {formatRupees(item.fairWageFloor)}
                </p>
              )}

              {description && (
                <div className="mt-7">
                  <SectionEyebrow>The maker&rsquo;s account</SectionEyebrow>
                  <p className="mt-2.5 whitespace-pre-line text-[15px] leading-relaxed text-gray-600">
                    {description}
                  </p>
                </div>
              )}

              {item.patchId && (
                <Link
                  href={`/verify/${item.patchId}`}
                  className="mt-6 w-fit text-[13px] font-semibold text-gray-900 underline underline-offset-4"
                >
                  {t('view_passport')}
                </Link>
              )}

              {/* Trust line */}
              <div className="mt-7 flex items-start gap-2.5 rounded-2xl bg-[var(--color-gray-100)] p-4">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-gray-500" />
                <p className="text-[13px] font-medium leading-relaxed text-gray-700">
                  {t('escrow_trust_line')}
                </p>
              </div>

              {cancelled && (
                <p className="text-xs text-gray-600 bg-card border border-gray-200 rounded-xl p-3 mb-4">
                  {t('payment_cancelled')}
                </p>
              )}

              {buyError && (
                <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
                  {buyError}
                </p>
              )}

              {paid ? (
                /* Shown only after the server verified the signature. */
                <div className="mt-5 rounded-2xl border border-[var(--color-sage)] bg-[var(--color-mint)] p-5">
                  <p className="flex items-center gap-2 text-sm font-bold text-primary">
                    <CheckCircle2 size={18} className="shrink-0" />
                    {t(RAZORPAY_LIVE_MODE ? 'payment_success_title_live' : 'payment_success_title')}
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-primary/85">
                    {t(RAZORPAY_LIVE_MODE ? 'payment_success_body_live' : 'payment_success_body')}
                  </p>
                  <Link
                    href="/buyer?tab=orders"
                    className="kg-press mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
                  >
                    {t('view_my_orders')}
                  </Link>
                </div>
              ) : (
                <>
                  {/* Buyers have no account here, so the name is asked for
                      inline. It is what My Orders looks the purchase up by. */}
                  <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4">
                    <label
                      htmlFor="buyer-name"
                      className="kg-label block font-medium text-gray-500"
                    >
                      {t('buyer_name_label')}
                    </label>
                    <input
                      id="buyer-name"
                      value={buyerName}
                      onChange={(event) => setBuyerName(event.target.value)}
                      placeholder={t('buyer_name_placeholder')}
                      autoComplete="name"
                      className="mt-1.5 min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-[14px] text-gray-900 outline-none focus:border-primary"
                    />

                    <label
                      htmlFor="buyer-contact"
                      className="kg-label mt-3 block font-medium text-gray-500"
                    >
                      {t('buyer_contact_label')}
                    </label>
                    <input
                      id="buyer-contact"
                      value={buyerContact}
                      onChange={(event) => setBuyerContact(event.target.value)}
                      placeholder={t('buyer_contact_placeholder')}
                      inputMode="tel"
                      autoComplete="tel"
                      className="mt-1.5 min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-[14px] text-gray-900 outline-none focus:border-primary"
                    />

                    <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                      {t('buyer_identity_note')}
                    </p>
                  </div>

                  {/* The escrow promise, restated where the decision is made
                      rather than only in the trust panel further up. */}
                  <p className="mt-4 flex items-start gap-2 text-[12px] font-medium leading-relaxed text-primary">
                    <ShieldCheck size={13} className="mt-0.5 shrink-0 text-[var(--color-rust)]" />
                    {t('escrow_hold_note')}
                  </p>

                  <button
                    onClick={buyNow}
                    disabled={buying || price === null || !checkoutReady || !buyerName.trim()}
                    className="kg-press mt-4 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-[15px] font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {buying ? (
                      <>
                        <Loader2 size={18} className="animate-spin" /> {t('opening_razorpay')}
                      </>
                    ) : price === null ? (
                      t('price_not_set')
                    ) : !checkoutReady ? (
                      t('checkout_loading')
                    ) : (
                      t('buy_now')
                    )}
                  </button>
                </>
              )}

              {/* In live mode this is a real-money warning, not a footnote, so
                  it gets the weight of one. */}
              <p
                className={cn(
                  "mt-3 flex items-start gap-2 text-[11px] leading-relaxed",
                  RAZORPAY_LIVE_MODE
                    ? "rounded-xl border border-amber-200 bg-amber-50 p-3 font-medium text-amber-900"
                    : "text-gray-500"
                )}
              >
                <Info
                  size={12}
                  className={cn(
                    "mt-0.5 shrink-0",
                    RAZORPAY_LIVE_MODE ? "text-amber-600" : "text-gray-400"
                  )}
                />
                {t(RAZORPAY_LIVE_MODE ? 'razorpay_live_note' : 'razorpay_test_note')}
              </p>
            </div>
          </div>
        )}

        {/* Reviews live below the product body. Kept inside the same page for
            SEO — a reviewed piece prints its testimonials right on the URL a
            shopper landed on. */}
        {item && <ReviewSection craftItemId={item.id} />}
      </main>
    </div>
  );
}
