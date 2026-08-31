"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  CheckCircle2,
  Info,
  Loader2,
  MapPin,
  Package,
  ShieldCheck,
} from "lucide-react";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { formatRupees } from "@/lib/pricing";
import { imageProps, marketPrice, type MarketItem } from "@/lib/marketplace";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * One published craft item, and the direct-to-artisan buy button.
 *
 * "Buy Now" opens a Stripe TEST checkout session. What follows is the
 * non-custodial escrow: the artisan's own VPA is locked in as the destination
 * before anything moves, and neither tranche passes through an admin.
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

  // Read the Stripe cancel return straight off the URL rather than via
  // useSearchParams, so this page needs no Suspense boundary.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("payment") !== "cancelled") return;
      setCancelled(true);
      params.delete("payment");
      const query = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const buyNow = async () => {
    if (!item) return;
    setBuying(true);
    setBuyError(null);
    try {
      const res = await fetch("/api/payments/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ craftItemId: item.id }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !data.url) {
        setBuyError(data?.error || t('checkout_failed'));
        return;
      }
      window.location.href = data.url;
    } catch (error) {
      console.error("Checkout failed:", error);
      setBuyError(t('checkout_failed'));
    } finally {
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
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Link href="/marketplace" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft size={20} className="text-gray-700" />
        </Link>
        <KarigariLogo variant="dark" showWordmark={true} size={28} />
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="py-24 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : notFound || !item ? (
          <div className="bg-card border border-dashed border-gray-200 rounded-2xl p-10 text-center">
            <p className="text-sm text-gray-500 italic mb-4">
              {t('product_unavailable')}
            </p>
            <Link
              href="/marketplace"
              className="inline-block bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors"
            >
              {t('back_to_marketplace')}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
            {/* Gallery */}
            <div>
              <div className="relative aspect-square rounded-2xl overflow-hidden bg-gray-100 border border-gray-100 shadow-card">
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
                          ? "border-primary"
                          : "border-gray-200 hover:border-[var(--color-sage)]"
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
              <div className="flex flex-wrap gap-2 mb-3">
                {item.patchId && (
                  <span className="inline-flex items-center gap-1 bg-primary text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
                    <CheckCircle2 size={12} /> {t('verified_passport')}
                  </span>
                )}
                {(item.giTagApplied || item.artisan.giTagName) && (
                  <span className="bg-[var(--color-mint)] text-primary text-[11px] font-bold px-2.5 py-1 rounded-full">
                    {item.giTagApplied || item.artisan.giTagName} GI
                  </span>
                )}
                {item.isOndcLive && (
                  <span className="bg-[var(--color-mint)] text-primary text-[11px] font-bold px-2.5 py-1 rounded-full">
                    {t('live_on_ondc')}
                  </span>
                )}
              </div>

              <h1 className="text-3xl font-serif font-bold text-primary mb-2">{item.craftType}</h1>

              <p className="text-sm text-gray-500 font-medium flex items-center gap-1.5 mb-1">
                <MapPin size={13} /> {item.artisan.clusterName}
                {item.artisan.location ? ` · ${item.artisan.location}` : ""}
              </p>
              <p className="text-sm text-gray-600 mb-5">
                {t('handcrafted_by')} <span className="font-bold text-primary">{item.artisan.name}</span>
              </p>

              <p className="text-4xl font-serif font-bold text-primary mb-1">
                {formatRupees(price)}
              </p>
              {item.fairWageFloor !== null && (
                <p className="text-xs text-gray-500 mb-5">
                  {t('ai_fair_floor_note')} {formatRupees(item.fairWageFloor)}
                </p>
              )}

              {description && (
                <p className="text-sm text-gray-600 leading-relaxed mb-6 whitespace-pre-line">
                  {description}
                </p>
              )}

              {item.patchId && (
                <Link
                  href={`/verify/${item.patchId}`}
                  className="text-xs font-bold text-primary underline underline-offset-4 mb-6 w-fit"
                >
                  {t('view_passport')}
                </Link>
              )}

              {/* Trust line */}
              <div className="rounded-2xl border border-[var(--color-sage)]/60 bg-[var(--color-mint)]/60 p-4 mb-4 flex gap-2.5 items-start">
                <ShieldCheck size={16} className="shrink-0 mt-0.5 text-primary" />
                <p className="text-xs text-primary leading-relaxed font-medium">
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

              <button
                onClick={buyNow}
                disabled={buying || price === null}
                className="w-full bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-xl font-bold text-base shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                {buying ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> {t('opening_stripe')}
                  </>
                ) : price === null ? (
                  t('price_not_set')
                ) : (
                  t('buy_now_stripe')
                )}
              </button>

              <p className="text-[11px] text-gray-500 mt-3 flex gap-2 items-start leading-relaxed">
                <Info size={12} className="shrink-0 mt-0.5 text-gray-400" />
                {t('stripe_test_note')}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
