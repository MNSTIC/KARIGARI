"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpDown, CheckCircle2, Info, Search, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { FilterTabs, Pill } from "@/components/ui/FilterTabs";
import { PageLede, PageTitle } from "@/components/ui/SectionEyebrow";
import { ProductCard } from "@/components/ui/ProductCard";
import { useLanguage } from "@/lib/translations";
import { categoryFor, marketPrice, type MarketItem } from "@/lib/marketplace";
import { captureRefFromUrl, trackRef } from "@/lib/affiliateRef";
import { RAZORPAY_LIVE_MODE } from "@/lib/razorpayMode";
import { cn } from "@/lib/utils";

/**
 * The public consumer storefront.
 *
 * Every card is a real `CraftItem` an artisan has published. Buying opens the
 * Razorpay test modal on the product page itself, and the escrow that follows
 * pays the artisan's own VPA — there is no middleman account in between.
 *
 * The category rail is built from the crafts that are actually listed, so it
 * never offers a filter that would return nothing.
 */

type SortKey = "newest" | "price-asc" | "price-desc";

const PAGE_SIZE = 8;

/** A search is logged only once the shopper has stopped typing for this long. */
const SEARCH_LOG_DELAY_MS = 900;

/** The same shape the search-log route stores: lower-cased, whitespace collapsed. */
function foldQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Every word of the query must appear somewhere in what a shopper can see of
 * the piece: its name, its tags, its craft family, or the artisan's name.
 */
function matchesQuery(item: MarketItem, words: string[]): boolean {
  const haystack = [item.craftType, ...(item.tags ?? []), categoryFor(item), item.aiSuggestedCategory, item.artisan?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export default function MarketplacePage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<MarketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [paymentBanner, setPaymentBanner] = useState<"success" | "cancelled" | null>(null);
  /** The creator whose link brought this shopper here, if any. */
  const [ref, setRef] = useState("");

  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  /** Free-text search, mirrored into `?q=` so a search can be shared or reloaded. */
  const [query, setQuery] = useState("");
  /** Set once `?q=` has been read, so the URL writer cannot erase it first. */
  const queryReadRef = useRef(false);
  /** The last term sent to the search log from this page view. */
  const loggedTermRef = useRef("");

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const res = await fetch("/api/items/market?listed=1", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        // The route already filters, but the storefront never renders an
        // unpublished row even if the filter is dropped upstream.
        setItems((data.items || []).filter((item: MarketItem) => item.isListedOnMarketplace));
      } else {
        setLoadFailed(true);
      }
    } catch (error) {
      console.error("Failed to load the marketplace:", error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the market and buyer pages use.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  // Creator attribution. Read off the URL the same way the payment banner is,
  // for the same reason: no useSearchParams means no Suspense boundary on this
  // fully-client page. The click is recorded once per landing.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      const handle = captureRefFromUrl();
      if (!handle) return;
      setRef(handle);
      trackRef(handle);
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  // Legacy return path. The Razorpay modal never leaves the product page, so
  // nothing produces `?payment=` any more — but an old bookmark or a shared
  // link still can, and it should read as an outcome rather than as noise.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const payment = params.get("payment");
      if (payment !== "success" && payment !== "cancelled") return;
      setPaymentBanner(payment);
      params.delete("payment");
      params.delete("session_id");
      const query = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  // `?q=` in, then back out. Read in a deferred effect like `?payment=` above,
  // so no useSearchParams and no Suspense boundary.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q) setQuery(q.slice(0, 200));
      queryReadRef.current = true;
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  useEffect(() => {
    if (!queryReadRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const trimmed = query.trim();
    if (trimmed) params.set("q", trimmed);
    else params.delete("q");
    const next = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (next ? `?${next}` : ""));
  }, [query]);

  const queryWords = useMemo(() => foldQuery(query).split(" ").filter(Boolean), [query]);

  /** The search applied to everything listed, before category and sort. */
  const searchMatches = useMemo(
    () => (queryWords.length ? items.filter((item) => matchesQuery(item, queryWords)) : items),
    [items, queryWords]
  );

  // Log the search once it has settled: never per keystroke, never blocking the
  // filter (which is local and instant), and never able to surface an error.
  // The count is over every listed piece, so a category filter never makes a
  // term look like unmet demand.
  useEffect(() => {
    if (loading || loadFailed) return;
    const term = foldQuery(query);
    if (term.length < 3 || term === loggedTermRef.current) return;
    const resultCount = searchMatches.length;
    const timer = setTimeout(() => {
      loggedTermRef.current = term;
      fetch("/api/market/search-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, resultCount }),
        keepalive: true,
      }).catch(() => {});
    }, SEARCH_LOG_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, searchMatches, loading, loadFailed]);

  /** Only categories that have something in them. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const label = categoryFor(item);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [
      { value: "all", label: "All Crafts" },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([label]) => ({ value: label, label })),
    ];
  }, [items]);

  const shown = useMemo(() => {
    let list = searchMatches;
    if (category !== "all") list = list.filter((item) => categoryFor(item) === category);
    if (verifiedOnly) list = list.filter((item) => item.verified);

    const sorted = [...list];
    if (sort === "price-asc" || sort === "price-desc") {
      sorted.sort((a, b) => {
        // Items with no price sink to the bottom of either direction rather
        // than sorting as ₹0 and leading the "cheapest first" view.
        const pa = marketPrice(a);
        const pb = marketPrice(b);
        if (pa === null) return 1;
        if (pb === null) return -1;
        return sort === "price-asc" ? pa - pb : pb - pa;
      });
    } else {
      sorted.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    }
    return sorted;
  }, [searchMatches, category, verifiedOnly, sort]);

  // A narrower filter must not leave the grid stuck on a page that no longer
  // exists, so the window resets whenever the result set changes shape.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [category, verifiedOnly, sort, query]);

  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans">
      <header className="sticky top-0 z-40 border-b border-gray-200/60 bg-[var(--color-background)]/90 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-[1180px] items-center gap-4 px-4 sm:px-6 lg:px-10">
          <Link href="/" className="flex shrink-0 items-center">
            <Image
              src="/logo.png"
              alt="Karigari"
              width={186}
              height={64}
              className="h-[44px] w-[128px] object-contain mt-1"
              priority
            />
          </Link>

          <div className="ml-auto flex min-w-0 items-center gap-3 sm:gap-4">
            {/* A shopper has no account here, so the switcher has to be
                reachable from the storefront itself. */}
            <LanguageSwitcher />
            <Link
              href="/login"
              className="whitespace-nowrap text-[14px] font-semibold text-gray-900 hover:underline"
            >
              {t("artisan_login")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
        {paymentBanner === "success" && (
          <Banner
            tone="ok"
            icon={<CheckCircle2 size={19} />}
            title={t(RAZORPAY_LIVE_MODE ? "payment_success_title_live" : "payment_success_title")}
            body={t(RAZORPAY_LIVE_MODE ? "payment_success_body_live" : "payment_success_body")}
            onDismiss={() => setPaymentBanner(null)}
            dismissLabel={t("dismiss")}
          />
        )}
        {paymentBanner === "cancelled" && (
          <Banner
            tone="quiet"
            icon={<Info size={19} />}
            body={t("payment_cancelled")}
            onDismiss={() => setPaymentBanner(null)}
            dismissLabel={t("dismiss")}
          />
        )}
        {ref && (
          <Banner
            tone="warm"
            icon={<Sparkles size={18} />}
            title={`Curated & recommended by @${ref}`}
            body="They earn 5% of anything you buy through this link, paid direct to their UPI. The artisan's share is unchanged."
          />
        )}

        {/* ------------------------------------------------------ Masthead */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <PageTitle>Marketplace</PageTitle>
            <PageLede>{t("marketplace_subtitle")}</PageLede>
          </div>

          <div className="flex w-full flex-wrap gap-3 lg:w-auto lg:shrink-0">
            <div role="search" className="relative w-full sm:w-72">
              <label htmlFor="mp-search" className="sr-only">
                {t("mp_search_label")}
              </label>
              <Search
                size={17}
                strokeWidth={1.7}
                aria-hidden
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                id="mp-search"
                type="text"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("mp_search_placeholder")}
                className="h-[42px] w-full rounded-full border border-transparent bg-[var(--color-pill)] pl-11 pr-11 text-[14px] text-gray-900 placeholder:text-gray-500 focus:border-gray-300 focus:bg-white focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t("mp_search_clear")}
                  className="kg-press absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-gray-500 hover:text-gray-900"
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <FilterMenu verifiedOnly={verifiedOnly} onChange={setVerifiedOnly} />
            <SortMenu sort={sort} onChange={setSort} />
          </div>
        </div>

        {queryWords.length > 0 && !loading && !loadFailed && (
          <p role="status" aria-live="polite" className="mt-5 text-[13px] text-gray-500">
            {t("mp_search_results").replace("{n}", String(shown.length)).replace("{term}", query.trim())}
          </p>
        )}

        {/* --------------------------------------------------- Category rail */}
        {categories.length > 1 && (
          <div className="mt-10">
            <FilterTabs
              options={categories}
              value={category}
              onChange={setCategory}
              ariaLabel="Craft category"
            />
          </div>
        )}

        {/* -------------------------------------------------------- The grid */}
        <div className="mt-10">
          {loading ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <div className="kg-shimmer aspect-square rounded-2xl" />
                  <div className="kg-shimmer mt-4 h-5 w-2/3 rounded" />
                  <div className="kg-shimmer mt-2 h-3 w-1/2 rounded" />
                </div>
              ))}
            </div>
          ) : loadFailed ? (
            <EmptyState>
              {t("mp_load_failed")}
              <button
                onClick={load}
                className="kg-press mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-6 text-[13px] font-semibold text-white hover:bg-primary-dark"
              >
                {t("retry")}
              </button>
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState>
              {items.length === 0 ? (
                t("mp_empty")
              ) : queryWords.length > 0 ? (
                <>
                  {t("mp_search_no_results").replace("{term}", query.trim())}
                  <span className="mt-5 block">
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="kg-press inline-flex min-h-[44px] items-center rounded-xl bg-primary px-6 text-[13px] font-semibold text-white hover:bg-primary-dark"
                    >
                      {t("mp_search_clear")}
                    </button>
                  </span>
                </>
              ) : (
                "Nothing in this category yet. Try another craft family."
              )}
            </EmptyState>
          ) : (
            <>
              <div className="kg-stagger grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
                {shown.slice(0, visible).map((item) => (
                  <ProductCard key={item.id} item={item} />
                ))}
              </div>

              {visible < shown.length && (
                <div className="mt-14 flex justify-center">
                  <button
                    onClick={() => setVisible((v) => v + PAGE_SIZE)}
                    className="kg-press kg-label inline-flex min-h-[52px] items-center rounded-full border border-gray-900/25 px-9 font-medium text-gray-900 hover:border-gray-900/60"
                  >
                    Load more artifacts
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* --------------------------------------------------- Honest notes */}
        <div className="mt-16 grid gap-4 border-t border-gray-200/70 pt-10 sm:grid-cols-2">
          <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-gray-600">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-gray-400" />
            {t("mp_escrow_note")}
          </p>
          <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-gray-500">
            <Info size={15} className="mt-0.5 shrink-0 text-gray-400" />
            {t(RAZORPAY_LIVE_MODE ? "mp_live_note" : "mp_prototype_note")}
          </p>
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 p-12 text-center text-[15px] text-gray-500">
      {children}
    </div>
  );
}

function Banner({
  tone,
  icon,
  title,
  body,
  onDismiss,
  dismissLabel,
}: {
  tone: "ok" | "quiet" | "warm";
  icon: React.ReactNode;
  title?: string;
  body: string;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const TONES = {
    ok: "border-green-200 bg-green-50 text-green-800",
    quiet: "border-gray-200 bg-card text-gray-600",
    warm: "border-orange-100 bg-orange-50 text-orange-900",
  } as const;

  return (
    <div className={cn("mb-8 flex items-start gap-3 rounded-2xl border p-4 sm:p-5", TONES[tone])}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 text-[14px] leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        <p className={title ? "mt-1 opacity-85" : undefined}>{body}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="ml-auto shrink-0 p-1 opacity-60 transition-opacity hover:opacity-100"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

/** Popover menus. Small enough not to warrant a library, real enough to work. */
function useDismissable(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function FilterMenu({
  verifiedOnly,
  onChange,
}: {
  verifiedOnly: boolean;
  onChange: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <Pill
        icon={<SlidersHorizontal size={15} />}
        onClick={() => setOpen((v) => !v)}
        tone={verifiedOnly ? "dark" : "neutral"}
      >
        Filter
      </Pill>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-60 rounded-2xl border border-gray-200 bg-white p-2 shadow-soft">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(e) => onChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
            />
            <span className="text-[13px] leading-relaxed text-gray-700">
              <span className="block font-semibold text-gray-900">Verified Origin only</span>
              Show only pieces whose printed patch has been matched to a re-photograph.
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

function SortMenu({ sort, onChange }: { sort: SortKey; onChange: (next: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));

  const OPTIONS: { value: SortKey; label: string }[] = [
    { value: "newest", label: "Newest first" },
    { value: "price-asc", label: "Price: low to high" },
    { value: "price-desc", label: "Price: high to low" },
  ];

  return (
    <div ref={ref} className="relative">
      <Pill icon={<ArrowUpDown size={15} />} onClick={() => setOpen((v) => !v)}>
        Sort
      </Pill>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white p-1 shadow-soft">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "block w-full rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-gray-50",
                sort === option.value ? "font-semibold text-gray-900" : "font-medium text-gray-600"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
