"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Globe,
  Info,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Plus,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { CaptureModal } from "@/components/CaptureModal";
import { formatRupees } from "@/lib/pricing";
import { Shell } from "@/components/ui/AppShell";
import { PageLede, PageTitle } from "@/components/ui/SectionEyebrow";
import { Card } from "@/components/ui/Card";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Badge } from "@/components/ui/Badge";
import {
  ARTISAN_SETTABLE_STAGES,
  ORDER_STAGE_KEYS,
  resolveStage,
  stageIndex,
  type OrderStage,
} from "@/lib/orderStage";
import { PillTabs } from "@/components/ui/SegmentedToggle";
import {
  SYNDICATION_PLATFORMS,
  SYNDICATION_PLATFORM_KEYS,
  type PriceComparison,
} from "@/lib/syndication";

/**
 * The artisan's own marketplace view.
 *
 * Everything here is a real `CraftItem` row. Editing the listing text writes
 * `descriptionEnglish` / `aiGeneratedListing` straight back to that item, which
 * is the same text the ONDC listing and the digital passport read — so the two
 * can never drift apart.
 */

interface Listing {
  id: string;
  craftType: string;
  patchId: string | null;
  status: string;
  images: string[];
  descriptionOriginal: string | null;
  descriptionEnglish: string | null;
  aiGeneratedListing: string | null;
  marketPriceMin: number | null;
  marketPriceMax: number | null;
  fairWageFloor: number | null;
  standardMarketPrice: number | null;
  askingPrice: number | null;
  isListedOnMarketplace: boolean;
  isOndcLive: boolean;
  syndicatedChannels: string[];
  syndicatedAt: string | null;
  createdAt: string;
  /** Buyer-facing production ladder; null means "derive it from escrow/QA". */
  productionStage?: string | null;
  stageUpdatedAt?: string | null;
  escrowStatus?: string | null;
  qrVerified?: boolean | null;
}

interface BoardDemand {
  id: string;
  craftType: string;
  quantity: number;
  targetPriceMin: number | null;
  targetPriceMax: number | null;
  location: string | null;
  festival: string | null;
  buyerName: string | null;
  createdAt: string;
}

function rupees(value?: number | null): string {
  return value || value === 0 ? `₹${value.toLocaleString("en-IN")}` : "—";
}

type StatusFilter = "all" | "live" | "verifying" | "sellable" | "sold";

/**
 * Where a listing sits against its own AI fair-wage floor.
 *
 * This is computed from the two numbers already on the row, not fetched or
 * invented: an asking price at or above the floor is a low-risk listing, one
 * meaningfully below it is the artisan under-pricing themselves, which is the
 * artisan-facing half of the middleman squeeze the platform exists to stop.
 */
function marketRisk(item: Listing): { label: string; variant: "success" | "warning" | "danger" } | null {
  const price = item.askingPrice ?? item.standardMarketPrice;
  const floor = item.fairWageFloor;
  if (!price || !floor) return null;
  if (price >= floor) return { label: "Low", variant: "success" };
  if (price >= floor * 0.85) return { label: "Med", variant: "warning" };
  return { label: "High", variant: "danger" };
}

function matchesFilter(item: Listing, filter: StatusFilter): boolean {
  switch (filter) {
    case "live":
      return item.isListedOnMarketplace || item.isOndcLive;
    case "verifying":
      return item.status === "PENDING_VERIFICATION" || item.status === "VERIFIED";
    case "sellable":
      return item.status === "SELLABLE";
    case "sold":
      return item.status === "SOLD_FINAL" || item.status === "SOLD_MIDDLEMAN";
    default:
      return true;
  }
}

export default function MarketPage() {
  const { t } = useLanguage();

  const [tab, setTab] = useState<"listings" | "buyers" | "syndication">("listings");
  /** Item whose production stage is being written, so the row can show it. */
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [stageNotice, setStageNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  /** Status filter across the artisan's own pieces. */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [artisanId, setArtisanId] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [drafts, setDrafts] = useState<Listing[]>([]);
  const [demands, setDemands] = useState<BoardDemand[]>([]);
  const [artisanCraftType, setArtisanCraftType] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  /** Item currently being edited, and the draft text for it. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftEnglish, setDraftEnglish] = useState("");
  const [draftOriginal, setDraftOriginal] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      // The profile fetch runs first so the demand call can carry the artisan's
      // craft type — the whole point of WI3 is that a Sambalpuri weaver never
      // sees Dhokra requests. Failing the profile call is not fatal: the demand
      // fetch just runs unfiltered, and the "complete your profile" banner
      // will point the artisan at what is missing.
      let resolvedCraft = "";
      try {
        const profileRes = await fetch("/api/artisan/profile", { cache: "no-store" });
        const profileData = await profileRes.json();
        if (profileData?.success && typeof profileData.profile?.craftType === "string") {
          resolvedCraft = profileData.profile.craftType.trim();
        }
      } catch (profileError) {
        console.warn("Artisan profile fetch failed:", profileError);
      }
      setArtisanCraftType(resolvedCraft);

      const demandUrl = resolvedCraft
        ? `/api/demand?limit=50&craftType=${encodeURIComponent(resolvedCraft)}`
        : "/api/demand?limit=50";

      const [listingRes, demandRes] = await Promise.all([
        fetch("/api/artisan/listings", { cache: "no-store" }),
        fetch(demandUrl, { cache: "no-store" }),
      ]);

      const listingData = await listingRes.json();
      const demandData = await demandRes.json();

      if (listingData?.success) {
        setListings(listingData.listings || []);
        setDrafts(listingData.drafts || []);
      } else {
        setLoadFailed(true);
      }

      if (demandData?.success) setDemands(demandData.demands || []);
    } catch (error) {
      console.error("Failed to load market page:", error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the buyer and schemes pages use.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  // Deep link from Insights ("List on ONDC") arrives as ?tab=syndication. Read
  // it off the URL in a deferred effect rather than via useSearchParams, so
  // this fully client page needs no Suspense boundary.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("tab");
      if (requested === "syndication" || requested === "buyers" || requested === "listings") {
        setTab(requested);
      }
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  // The ONDC export is scoped by provider id, which is the caller's own user id.
  useEffect(() => {
    const kickoff = setTimeout(async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (data?.success && data.userId) setArtisanId(data.userId);
      } catch {
        // Non-fatal: the hub still publishes and compares without the export link.
      }
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const startEdit = (item: Listing) => {
    setEditingId(item.id);
    setSaveError(null);
    setSavedId(null);
    setDraftEnglish(item.descriptionEnglish || item.aiGeneratedListing || "");
    setDraftOriginal(item.descriptionOriginal || "");
  };

  const saveListing = async (item: Listing) => {
    if (!draftEnglish.trim()) {
      setSaveError(t("listing_english_required"));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/artisan/listings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          descriptionEnglish: draftEnglish,
          descriptionOriginal: draftOriginal,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setSaveError(json?.error || t("listing_save_failed"));
        return;
      }
      setEditingId(null);
      setSavedId(item.id);
      await load();
    } catch (error) {
      console.error("Listing save failed:", error);
      setSaveError(t("listing_save_failed"));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Move one piece along the production ladder.
   *
   * Only the two stages an artisan legitimately owns are offered; the server
   * re-checks that and refuses anything the escrow engine is responsible for.
   * The buyer's tracker reads the same field, so this is what makes their
   * timeline advance.
   */
  const advanceStage = async (item: Listing, next: OrderStage) => {
    setStagingId(item.id);
    setStageNotice(null);
    try {
      const res = await fetch("/api/artisan/listings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, productionStage: next }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setStageNotice({ tone: "warn", text: data?.error || t("stage_update_failed") });
        return;
      }
      setStageNotice({ tone: "ok", text: t("stage_updated") });
      await load();
    } catch (e) {
      console.error("Stage update failed:", e);
      setStageNotice({ tone: "warn", text: t("stage_update_failed") });
    } finally {
      setStagingId(null);
    }
  };

  const renderCard = (item: Listing, isDraft: boolean) => {
    const isEditing = editingId === item.id;
    const listingText = item.descriptionEnglish || item.aiGeneratedListing || "";
    const risk = marketRisk(item);

    return (
      <article
        key={item.id}
        className="kg-list-item bg-card rounded-2xl border border-gray-100 shadow-card overflow-hidden flex flex-col"
      >
        {/* Fixed aspect box: a percentage-height image container is what makes
            a grid of cards jump as photos decode at different times. */}
        <div className="relative aspect-[16/10] bg-gray-100">
          {item.images?.[0] ? (
            <Image
              src={item.images[0]}
              fill
              alt={item.craftType}
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
              unoptimized={String(item.images[0]).startsWith("data:")}
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <Package size={40} />
            </div>
          )}
          <span className="absolute top-3 right-3">
            <Badge
              variant={isDraft ? "warning" : "solid"}
              caps
              icon={isDraft ? <Clock size={11} /> : <CheckCircle2 size={11} />}
              className="shadow-sm"
            >
              {isDraft ? t("awaiting_qa") : t("live_on_ondc")}
            </Badge>
          </span>
        </div>

        <div className="p-5 flex flex-col flex-1">
          <h3 className="font-serif font-bold text-lg text-gray-900 mb-1">{item.craftType}</h3>
          <p className="text-[11px] text-gray-500 mb-3 truncate">
            {item.patchId ? (
              <span className="font-mono">{item.patchId}</span>
            ) : (
              <span className="italic">{t("pending_admin")}</span>
            )}
          </p>

          {/* Listing text — the ONDC copy, editable by its own artisan */}
          {isEditing ? (
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                  {t("listing_english_title")}
                </label>
                <textarea
                  value={draftEnglish}
                  onChange={(e) => setDraftEnglish(e.target.value)}
                  placeholder={t("listing_english_placeholder")}
                  rows={4}
                  className="w-full text-sm border border-gray-200 rounded-xl p-3 focus:outline-none focus:border-[var(--color-sage)] resize-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                  {t("listing_local_title")}
                </label>
                <textarea
                  value={draftOriginal}
                  onChange={(e) => setDraftOriginal(e.target.value)}
                  placeholder={t("listing_local_placeholder")}
                  rows={3}
                  className="w-full text-sm border border-gray-200 rounded-xl p-3 focus:outline-none focus:border-[var(--color-sage)] resize-none"
                />
              </div>

              {saveError && <p className="text-xs font-bold text-red-700">{saveError}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => setEditingId(null)}
                  className="flex-1 py-2 rounded-xl text-sm font-bold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={() => saveListing(item)}
                  disabled={saving}
                  className="flex-1 py-2 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {t("save_listing")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-3 leading-relaxed line-clamp-4">
                {listingText || <span className="italic text-gray-400">{t("no_listing_text")}</span>}
              </p>
              {savedId === item.id && (
                <p className="text-xs font-bold text-primary bg-[var(--color-mint)] rounded-lg px-3 py-2 mb-3">
                  {t("listing_saved")}
                </p>
              )}
            </>
          )}

          <div className="mt-auto pt-4 border-t border-gray-100">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  {t("fair_wage_floor")}
                </p>
                {/* font-sans: Playfair ships without U+20B9, so a rupee amount
                    set in the display face renders the mark as tofu. */}
                <p className="font-sans font-bold text-lg text-gray-900">
                  {rupees(item.fairWageFloor ?? item.askingPrice ?? item.standardMarketPrice)}
                </p>
              </div>

              {risk && (
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                    Market risk
                  </p>
                  <Badge variant={risk.variant} caps>{risk.label}</Badge>
                </div>
              )}
            </div>

            {/* Production stage. Only the steps ahead of where escrow and the
                QA patch already put this piece are offered — nothing here can
                claim a dispatch that has not happened. */}
            {!isDraft && (() => {
              const current = resolveStage(item);
              const next = ARTISAN_SETTABLE_STAGES.filter(
                (stage) => stageIndex(stage) > stageIndex(current)
              );
              return (
                <div className="pt-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    {t("track_title")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="neutral" caps>{t(ORDER_STAGE_KEYS[current])}</Badge>
                    {next.map((stage) => (
                      <button
                        key={stage}
                        onClick={() => advanceStage(item, stage)}
                        disabled={stagingId === item.id}
                        className="kg-press inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[var(--color-sage)] px-3 text-[11px] font-bold text-primary hover:bg-[var(--color-mint)] disabled:opacity-50"
                      >
                        {stagingId === item.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Clock size={12} />
                        )}
                        {t(ORDER_STAGE_KEYS[stage])}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {isDraft && <p className="text-[11px] text-gray-400 italic pt-3">{t("draft_hint")}</p>}

            {!isEditing && (
              <button
                onClick={() => startEdit(item)}
                className="kg-press w-full mt-4 flex items-center justify-center gap-2 text-sm font-bold text-primary border border-[var(--color-sage)] rounded-xl min-h-[44px] hover:bg-[var(--color-mint)]"
              >
                <Pencil size={14} /> {t("edit_listing_text")}
              </button>
            )}
          </div>
        </div>
      </article>
    );
  };

  const visibleListings = listings.filter((item) => matchesFilter(item, statusFilter));
  const visibleDrafts = drafts.filter((item) => matchesFilter(item, statusFilter));

  return (
    <Shell>
      {/* The lede carries the subtitle now, so the old paragraph beside the
          action button is gone — it printed the same sentence twice. */}
      <div className="mb-9 flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <PageTitle>{t("page_my_crafts_title")}</PageTitle>
          <PageLede>{t("market_subtitle")}</PageLede>
        </div>
        <button
          onClick={() => setCaptureOpen(true)}
          aria-label={t("new_listing")}
          className="kg-press mt-2 flex h-12 shrink-0 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          <Plus size={17} /> <span className="hidden sm:inline">{t("new_listing")}</span>
        </button>
      </div>

      {/* Section tabs */}
      <PillTabs
        ariaLabel={t("market_title")}
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: "listings" as const, label: t("my_listings"), icon: <Package size={14} /> },
          { value: "syndication" as const, label: "Syndication", icon: <Zap size={14} /> },
          { value: "buyers" as const, label: t("bulk_buyers"), icon: <TrendingUp size={14} /> },
        ]}
      />

      {/* Status filter — only meaningful on the listings tab. Counts come from
          the real rows, so a filter with nothing behind it reads zero rather
          than looking broken. */}
      {tab === "listings" && (
        <PillTabs
          ariaLabel="Filter by status"
          value={statusFilter}
          onChange={setStatusFilter}
          className="mb-6"
          options={([
            ["all", "All"],
            ["live", "Live"],
            ["sellable", "Sellable"],
            ["verifying", "Verifying"],
            ["sold", "Sold"],
          ] as [StatusFilter, string][]).map(([value, label]) => ({
            value,
            label,
            count: [...listings, ...drafts].filter((item) => matchesFilter(item, value)).length,
          }))}
        />
      )}

        {loading ? (
          <div className="py-20 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : tab === "listings" ? (
          <div className="space-y-10">
            {loadFailed && <p className="text-sm text-gray-500">{t("market_load_failed")}</p>}

            <p className="text-xs text-primary bg-[var(--color-mint)]/60 border border-[var(--color-sage)]/50 rounded-xl p-3.5 flex gap-2 items-start leading-relaxed">
              <Info size={14} className="shrink-0 mt-0.5" />
              {t("publish_explainer")}
            </p>

            {stageNotice && (
              <p
                className={cn(
                  "kg-fade rounded-xl border px-4 py-3 text-sm font-bold",
                  stageNotice.tone === "ok"
                    ? "border-green-200 bg-green-50 text-green-800"
                    : "border-orange-100 bg-orange-50 text-orange-800"
                )}
              >
                {stageNotice.text}
              </p>
            )}

            {/* Published */}
            <section>
              <SectionLabel>{t("live_listings")}</SectionLabel>
              {visibleListings.length === 0 ? (
                <Card pad="lg" className="border-dashed text-center text-sm text-gray-500 italic">
                  {t("no_listings_yet")}
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 kg-stagger">
                  {visibleListings.map((item) => renderCard(item, false))}
                </div>
              )}
            </section>

            {/* Awaiting QA */}
            {visibleDrafts.length > 0 && (
              <section>
                <SectionLabel>{t("awaiting_qa")}</SectionLabel>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 kg-stagger">
                  {visibleDrafts.map((item) => renderCard(item, true))}
                </div>
              </section>
            )}

            {/* ONDC context — secondary, and honest about what is connected */}
            <Card tone="muted" pad="lg">
              <SectionLabel>{t("ondc_title")}</SectionLabel>
              <p className="text-sm text-gray-600 mb-3 leading-relaxed">{t("ondc_body")}</p>
              <p className="text-sm font-bold text-primary mb-2">
                {listings.length} {t("items_live_on_network")}
              </p>
              <p className="text-xs text-gray-500 italic">{t("ondc_status_note")}</p>
            </Card>
          </div>
        ) : tab === "syndication" ? (
          <SyndicationHub
            items={[...listings, ...drafts]}
            artisanId={artisanId}
            onPublished={load}
          />
        ) : (
          /* ---------------- Bulk buyers: the real demand board ---------------- */
          <div className="space-y-4">
            <div className="bg-[var(--color-mint)]/50 border border-[var(--color-sage)]/40 p-4 rounded-xl text-primary text-sm mb-2 flex gap-3">
              <TrendingUp size={20} className="shrink-0" />
              <div>
                <p className="font-bold mb-1">{t("bulk_orders_title")}</p>
                <p className="text-primary/75 text-xs leading-relaxed">{t("bulk_orders_body")}</p>
              </div>
            </div>

            {!artisanCraftType && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
                <span>
                  <strong>{t("complete_profile_for_filter_bold")}</strong>{" "}
                  {t("complete_profile_for_filter")}
                </span>
              </div>
            )}

            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              {demands.length}{" "}
              {artisanCraftType
                ? `${t("active_bulk_enquiries")} · ${artisanCraftType}`
                : t("active_bulk_enquiries")}
            </p>

            {demands.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-card p-10 text-center">
                <Package size={40} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-bold text-gray-900 mb-2">
                  {artisanCraftType
                    ? `${t("no_matching_bulk_demands")} — ${artisanCraftType}`
                    : t("no_open_demands")}
                </h3>
                <p className="text-sm text-gray-500">{t("check_back_soon")}</p>
              </div>
            ) : (
              demands.map((demand) => (
                <div
                  key={demand.id}
                  className="bg-card p-5 sm:p-6 rounded-2xl border border-gray-100 shadow-card flex flex-col sm:flex-row justify-between sm:items-center gap-4"
                >
                  <div className="min-w-0">
                    {demand.buyerName && (
                      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                        {demand.buyerName}
                      </div>
                    )}
                    <h3 className="font-serif font-bold text-lg text-primary mb-2">
                      {demand.quantity} × {demand.craftType}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {demand.location && (
                        <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs font-bold px-2 py-1 rounded-md">
                          <MapPin size={11} /> {demand.location}
                        </span>
                      )}
                      {demand.festival && (
                        <span className="bg-[var(--color-mint)] text-primary text-xs font-bold px-2 py-1 rounded-md">
                          {demand.festival}
                        </span>
                      )}
                      <span className="bg-[var(--color-mint)] text-primary text-xs font-bold px-2 py-1 rounded-md">
                        {t("target_price")}: {rupees(demand.targetPriceMin)} – {rupees(demand.targetPriceMax)}
                      </span>
                    </div>
                  </div>

                  <Link
                    href="/artisan/insights"
                    className="bg-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm hover:bg-primary-dark transition-colors whitespace-nowrap text-center shrink-0"
                  >
                    {t("live_demand_map")}
                  </Link>
                </div>
              ))
            )}
          </div>
        )}

      {/* Mounted only while open: `dynamic` is not used here, but rendering the
          modal unconditionally still runs its state and effects on every page
          view for a surface most visits never open. */}
      {captureOpen && (
        <CaptureModal
          isOpen
          onClose={() => {
            setCaptureOpen(false);
            load();
          }}
        />
      )}
    </Shell>
  );
}

/* ---------------------------------------------------------------------------
 * Zero-ID Multi-Channel Syndication Hub
 *
 * "Zero-ID" means the artisan never opens a seller account anywhere. Their own
 * CraftItem row is the listing; every channel below reads that one row, so
 * there is no external seller id and no middleman between them and the buyer.
 *
 * Honest about scope, exactly like the ONDC/GeM features already are:
 * publishing marks an item broadcast-ready and produces the payloads. It does
 * not transmit to Paytm, Magicpin, gem.gov.in or Amazon.
 * ------------------------------------------------------------------------- */

interface ComparisonState {
  status: "loading" | "ready" | "error";
  base: number | null;
  comparisons: PriceComparison[];
  advantage: number;
}

function SyndicationHub({
  items,
  artisanId,
  onPublished,
}: {
  items: Listing[];
  artisanId: string | null;
  onPublished: () => Promise<void> | void;
}) {
  /** Per-item publish state, so one slow row never freezes the others. */
  const [publishing, setPublishing] = useState<Record<string, boolean>>({});
  const [publishAllRunning, setPublishAllRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openMatrix, setOpenMatrix] = useState<string | null>(null);
  const [matrices, setMatrices] = useState<Record<string, ComparisonState>>({});

  const publishOne = async (itemId: string): Promise<boolean> => {
    setPublishing((prev) => ({ ...prev, [itemId]: true }));
    try {
      const res = await fetch("/api/artisan/syndicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftItemId: itemId,
          targetPlatforms: SYNDICATION_PLATFORM_KEYS,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error || "Publishing failed. Please try again.");
        return false;
      }
      return true;
    } catch (err) {
      console.error("Syndicate failed:", err);
      setError("Publishing failed. Please try again.");
      return false;
    } finally {
      setPublishing((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  const publishAll = async () => {
    if (items.length === 0) return;
    setError(null);
    setPublishAllRunning(true);
    setProgress({ done: 0, total: items.length });
    for (let index = 0; index < items.length; index += 1) {
      await publishOne(items[index].id);
      setProgress({ done: index + 1, total: items.length });
    }
    await onPublished();
    setPublishAllRunning(false);
    // Prices did not change, but the matrix is cheap to refetch and this keeps
    // an open comparison consistent with what was just published.
    setMatrices({});
    setTimeout(() => setProgress(null), 4000);
  };

  const publishSingle = async (itemId: string) => {
    setError(null);
    const ok = await publishOne(itemId);
    if (ok) await onPublished();
  };

  const loadMatrix = async (itemId: string) => {
    setMatrices((prev) => ({
      ...prev,
      [itemId]: { status: "loading", base: null, comparisons: [], advantage: 0 },
    }));
    try {
      const res = await fetch(`/api/artisan/syndicate?id=${encodeURIComponent(itemId)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setMatrices((prev) => ({
          ...prev,
          [itemId]: { status: "error", base: null, comparisons: [], advantage: 0 },
        }));
        return;
      }
      setMatrices((prev) => ({
        ...prev,
        [itemId]: {
          status: "ready",
          base: json.base ?? null,
          comparisons: json.comparisons ?? [],
          advantage: json.middlemanAdvantage ?? 0,
        },
      }));
    } catch (err) {
      console.error("Price comparison failed:", err);
      setMatrices((prev) => ({
        ...prev,
        [itemId]: { status: "error", base: null, comparisons: [], advantage: 0 },
      }));
    }
  };

  const toggleMatrix = (itemId: string) => {
    if (openMatrix === itemId) {
      setOpenMatrix(null);
      return;
    }
    setOpenMatrix(itemId);
    if (!matrices[itemId] || matrices[itemId].status === "error") void loadMatrix(itemId);
  };

  const syndicatedCount = items.filter((item) => item.isOndcLive).length;

  return (
    <div className="space-y-8">
      {/* Master switch */}
      <section className="bg-card rounded-2xl border border-[var(--color-sage)]/50 shadow-card p-6">
        <h2 className="text-lg font-serif font-bold text-primary mb-2 flex items-center gap-2">
          <Zap size={18} className="text-primary-light" /> Publish once. Reach every channel.
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-4">
          You do not need a seller account on any platform. Your own listing is the catalogue
          entry — Karigari broadcasts it as an ONDC provider node, and exports it in the GeM
          upload format. Nobody sits between you and the buyer.
        </p>

        <button
          onClick={publishAll}
          disabled={publishAllRunning || items.length === 0}
          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3.5 rounded-xl font-bold shadow-sm transition-colors"
        >
          {publishAllRunning ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Publishing {progress?.done ?? 0}/{progress?.total ?? items.length}…
            </>
          ) : (
            <>
              <Zap size={18} /> Publish to All Connected Channels
            </>
          )}
        </button>

        {!publishAllRunning && progress && progress.done > 0 && (
          <p className="text-xs font-bold text-primary bg-[var(--color-mint)] rounded-lg px-3 py-2 mt-3 inline-block">
            {progress.done} listing{progress.done === 1 ? "" : "s"} published to all{" "}
            {SYNDICATION_PLATFORMS.length} channels.
          </p>
        )}

        {error && <p className="text-xs font-bold text-red-700 mt-3">{error}</p>}

        <p className="text-[11px] text-gray-500 italic mt-4 leading-relaxed">
          Broadcast-ready, not transmitted: this marks your items live on the Karigari ONDC
          provider node and builds the GeM/Beckn payloads below. It does not sign you up on
          Paytm, Magicpin, gem.gov.in or Amazon.
        </p>
      </section>

      {/* Per-listing channels + price comparison */}
      <section>
        <h2 className="text-lg font-serif font-bold text-primary mb-1 border-b border-gray-200 pb-2 flex items-center gap-2">
          <Globe size={18} className="text-primary-light" /> Your listings across channels
        </h2>
        <p className="text-xs text-gray-500 mb-4 mt-2">
          {syndicatedCount} of {items.length} syndicated
        </p>

        {items.length === 0 ? (
          <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-8 text-center">
            Capture a piece first — then publish it to every channel from here.
          </p>
        ) : (
          <div className="space-y-4">
            {items.map((item) => {
              const channels = item.syndicatedChannels ?? [];
              const matrix = matrices[item.id];
              const isOpen = openMatrix === item.id;

              return (
                <div
                  key={item.id}
                  className="bg-card rounded-2xl border border-gray-100 shadow-card p-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-serif font-bold text-lg text-primary">
                        {item.craftType}
                      </h3>
                      <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mt-1">
                        {formatRupees(item.askingPrice ?? item.standardMarketPrice)}
                        {item.isOndcLive ? " · Live on ONDC" : " · Not yet syndicated"}
                      </p>
                    </div>

                    <button
                      onClick={() => publishSingle(item.id)}
                      disabled={publishing[item.id] || publishAllRunning}
                      className="flex items-center justify-center gap-2 text-sm font-bold text-primary border border-[var(--color-sage)] rounded-xl px-4 py-2 hover:bg-[var(--color-mint)] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      {publishing[item.id] ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Zap size={14} />
                      )}
                      {item.isOndcLive ? "Re-publish" : "Publish"}
                    </button>
                  </div>

                  {/* Channel chips — mint once the channel is on the row */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {SYNDICATION_PLATFORMS.map((platform) => {
                      const on = channels.includes(platform.key);
                      return (
                        <span
                          key={platform.key}
                          title={platform.note}
                          className={cn(
                            "text-[11px] font-bold px-2.5 py-1 rounded-md border",
                            on
                              ? "bg-[var(--color-mint)] text-primary border-[var(--color-sage)]"
                              : "bg-gray-50 text-gray-400 border-gray-200"
                          )}
                        >
                          {on ? "✓ " : ""}
                          {platform.label}
                        </span>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => toggleMatrix(item.id)}
                    className="mt-4 flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary-dark transition-colors"
                  >
                    <ChevronDown
                      size={14}
                      className={cn("transition-transform", isOpen && "rotate-180")}
                    />
                    Live price comparison
                  </button>

                  {isOpen && (
                    <div className="mt-4">
                      {!matrix || matrix.status === "loading" ? (
                        <div className="py-6 flex justify-center">
                          <Loader2 size={18} className="animate-spin text-primary" />
                        </div>
                      ) : matrix.status === "error" ? (
                        <p className="text-xs text-gray-500 italic">
                          The comparison could not be loaded. Try again.
                        </p>
                      ) : matrix.base === null ? (
                        <p className="text-xs text-gray-500 italic">
                          Set a price on this piece to see how the channels compare.
                        </p>
                      ) : (
                        <PriceMatrix rows={matrix.comparisons} advantage={matrix.advantage} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Government / network exports — reuse the existing endpoints */}
      <section className="bg-card rounded-2xl border border-gray-100 shadow-card p-6">
        <h2 className="text-lg font-serif font-bold text-primary mb-2 flex items-center gap-2">
          <Download size={18} className="text-primary-light" /> Download GeM &amp; ONDC Compliant
          JSON / CSV
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-4">
          Upload-ready for gem.gov.in, and a broadcast-ready ONDC payload. Both are generated from
          the same listings shown above — no separate catalogue to keep in sync.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <a
            href="/api/artisan/gem-export?format=csv"
            className="flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-3 rounded-xl font-bold text-sm shadow-sm transition-colors"
          >
            <Download size={16} /> GeM CSV
          </a>
          <a
            href="/api/artisan/gem-export?format=json"
            className="flex items-center justify-center gap-2 text-primary border border-[var(--color-sage)] hover:bg-[var(--color-mint)] px-5 py-3 rounded-xl font-bold text-sm transition-colors"
          >
            <Download size={16} /> GeM JSON
          </a>
          {artisanId ? (
            <a
              href={`/api/ondc/catalog?artisanId=${encodeURIComponent(artisanId)}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 text-primary border border-[var(--color-sage)] hover:bg-[var(--color-mint)] px-5 py-3 rounded-xl font-bold text-sm transition-colors"
            >
              <Download size={16} /> ONDC Beckn JSON
            </a>
          ) : (
            <span className="flex items-center justify-center gap-2 text-gray-400 border border-gray-200 px-5 py-3 rounded-xl font-bold text-sm">
              <Download size={16} /> ONDC Beckn JSON
            </span>
          )}
        </div>

        <p className="text-[11px] text-gray-500 italic mt-4 leading-relaxed">
          GeM has no public seller push API, so you upload the file on gem.gov.in yourself. The
          Beckn payload is what an ONDC buyer app would ingest from this provider node.
        </p>
      </section>
    </div>
  );
}

function PriceMatrix({ rows, advantage }: { rows: PriceComparison[]; advantage: number }) {
  return (
    <div>
      {/* Table on wide screens */}
      <div className="hidden sm:block overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-left border-collapse min-w-[520px]">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-gray-500 text-[10px] font-bold tracking-wider uppercase py-3 px-4">
                Channel
              </th>
              <th className="text-gray-500 text-[10px] font-bold tracking-wider uppercase py-3 px-4">
                Buyer pays
              </th>
              <th className="text-gray-500 text-[10px] font-bold tracking-wider uppercase py-3 px-4">
                Commission
              </th>
              <th className="text-gray-500 text-[10px] font-bold tracking-wider uppercase py-3 px-4">
                What you get
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.channel}
                className={cn(
                  "border-t border-gray-100",
                  row.zeroMiddleman && "bg-[var(--color-mint)]/60"
                )}
              >
                <td className="py-3 px-4 text-sm font-bold text-primary">
                  {row.label}
                  {row.zeroMiddleman && (
                    <span className="ml-2 inline-block bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full align-middle">
                      0% middleman
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-sm font-bold text-gray-900">
                  {formatRupees(row.buyerPays)}
                </td>
                <td className="py-3 px-4 text-sm text-gray-600">{row.commissionPct}%</td>
                <td className="py-3 px-4 text-xs text-gray-600">{row.artisanReceivesNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards on phones */}
      <div className="sm:hidden space-y-3">
        {rows.map((row) => (
          <div
            key={row.channel}
            className={cn(
              "rounded-xl border p-4",
              row.zeroMiddleman
                ? "bg-[var(--color-mint)]/60 border-[var(--color-sage)]"
                : "bg-white border-gray-100"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-bold text-primary">{row.label}</p>
              <p className="text-sm font-bold text-gray-900 whitespace-nowrap">
                {formatRupees(row.buyerPays)}
              </p>
            </div>
            {row.zeroMiddleman && (
              <span className="inline-block mt-2 bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                0% middleman
              </span>
            )}
            <p className="text-[11px] text-gray-600 mt-2">
              {row.commissionPct}% commission · {row.artisanReceivesNote}
            </p>
          </div>
        ))}
      </div>

      {advantage > 0 && (
        <p className="mt-4 text-sm font-bold text-primary bg-[var(--color-mint)] border border-[var(--color-sage)] rounded-xl px-4 py-3 flex items-start gap-2">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          Your buyer keeps {formatRupees(advantage)} more by buying direct on ONDC than through
          Amazon Karigar — and none of it goes to a middleman.
        </p>
      )}
    </div>
  );
}
