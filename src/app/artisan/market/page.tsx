"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Globe,
  Info,
  MapPin,
  Package,
  Pencil,
  Plus,
  TrendingUp,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { CaptureModal } from "@/components/CaptureModal";

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
  createdAt: string;
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

export default function MarketPage() {
  const { t } = useLanguage();

  const [tab, setTab] = useState<"listings" | "buyers">("listings");
  const [listings, setListings] = useState<Listing[]>([]);
  const [drafts, setDrafts] = useState<Listing[]>([]);
  const [demands, setDemands] = useState<BoardDemand[]>([]);
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
      const [listingRes, demandRes] = await Promise.all([
        fetch("/api/artisan/listings", { cache: "no-store" }),
        fetch("/api/demand?limit=50", { cache: "no-store" }),
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

  const renderCard = (item: Listing, isDraft: boolean) => {
    const isEditing = editingId === item.id;
    const listingText = item.descriptionEnglish || item.aiGeneratedListing || "";

    return (
      <div
        key={item.id}
        className="bg-card rounded-2xl border border-gray-100 shadow-card overflow-hidden flex flex-col"
      >
        <div className="h-44 bg-gray-100 relative">
          {item.images?.[0] ? (
            <Image src={item.images[0]} fill alt={item.craftType} className="object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <Package size={40} />
            </div>
          )}
          <span
            className={cn(
              "absolute top-2 right-2 text-[10px] font-bold px-2 py-1 rounded-full shadow-sm",
              isDraft ? "bg-white text-gray-600 border border-gray-200" : "bg-primary text-white"
            )}
          >
            {isDraft ? t("awaiting_qa") : t("live_on_ondc")}
          </span>
        </div>

        <div className="p-5 flex flex-col flex-1">
          <h3 className="font-serif font-bold text-lg text-primary mb-1">{item.craftType}</h3>
          {item.patchId && (
            <p className="text-[11px] font-mono text-gray-400 mb-2 truncate">{item.patchId}</p>
          )}

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

          <div className="mt-auto pt-4 border-t border-gray-100 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 font-bold uppercase tracking-wider">{t("valuation")}</span>
              <span className="text-primary font-bold">
                {rupees(item.askingPrice ?? item.marketPriceMin ?? item.standardMarketPrice)}
              </span>
            </div>
            {item.fairWageFloor !== null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-bold uppercase tracking-wider">
                  {t("fair_wage_floor")}
                </span>
                <span className="text-gray-700 font-bold">{rupees(item.fairWageFloor)}</span>
              </div>
            )}

            {isDraft && <p className="text-[11px] text-gray-400 italic pt-1">{t("draft_hint")}</p>}

            {!isEditing && (
              <button
                onClick={() => startEdit(item)}
                className="w-full mt-2 flex items-center justify-center gap-2 text-sm font-bold text-primary border border-[var(--color-sage)] rounded-xl py-2 hover:bg-[var(--color-mint)] transition-colors"
              >
                <Pencil size={14} /> {t("edit_listing_text")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans pb-12">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Link
          href="/artisan/dashboard"
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ArrowLeft size={20} className="text-gray-700" />
        </Link>
        <KarigariLogo variant="dark" showWordmark={true} size={28} />
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold text-primary flex items-center gap-3">
              <Globe size={26} className="text-primary-light" />
              {t("market_title")}
            </h1>
            <p className="text-gray-600 mt-2 text-sm">{t("market_subtitle")}</p>
          </div>
          <button
            onClick={() => setCaptureOpen(true)}
            className="flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-3 rounded-xl font-bold shadow-sm transition-colors shrink-0"
          >
            <Plus size={18} /> {t("new_listing")}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 sm:gap-3 mb-8 border-b border-gray-200 pb-1 overflow-x-auto">
          {(
            [
              { id: "listings" as const, label: t("my_listings"), icon: <Package size={17} /> },
              { id: "buyers" as const, label: t("bulk_buyers"), icon: <TrendingUp size={17} /> },
            ]
          ).map((entry) => (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                "py-3 px-5 rounded-t-xl font-bold flex items-center gap-2 transition-colors whitespace-nowrap text-sm",
                tab === entry.id
                  ? "bg-primary text-white shadow-sm"
                  : "bg-gray-50 text-gray-500 hover:bg-gray-100"
              )}
            >
              {entry.icon} {entry.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-20 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : tab === "listings" ? (
          <div className="space-y-10">
            {loadFailed && <p className="text-sm text-gray-500">{t("market_load_failed")}</p>}

            <p className="text-xs text-gray-500 bg-[var(--color-mint)]/50 border border-[var(--color-sage)]/40 rounded-xl p-3 flex gap-2 items-start">
              <Info size={14} className="shrink-0 mt-0.5 text-primary" />
              {t("publish_explainer")}
            </p>

            {/* Published */}
            <section>
              <h2 className="text-lg font-serif font-bold text-primary mb-4 border-b border-gray-200 pb-2 flex items-center gap-2">
                <CheckCircle2 size={18} className="text-primary-light" /> {t("live_listings")}
              </h2>
              {listings.length === 0 ? (
                <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-8 text-center">
                  {t("no_listings_yet")}
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {listings.map((item) => renderCard(item, false))}
                </div>
              )}
            </section>

            {/* Awaiting QA */}
            {drafts.length > 0 && (
              <section>
                <h2 className="text-lg font-serif font-bold text-primary mb-4 border-b border-gray-200 pb-2 flex items-center gap-2">
                  <Clock size={18} className="text-gray-400" /> {t("awaiting_qa")}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {drafts.map((item) => renderCard(item, true))}
                </div>
              </section>
            )}

            {/* ONDC context — secondary, and honest about what is connected */}
            <section className="bg-card rounded-2xl border border-gray-100 shadow-card p-6">
              <h2 className="text-lg font-serif font-bold text-primary mb-2 flex items-center gap-2">
                <Globe size={18} className="text-primary-light" /> {t("ondc_title")}
              </h2>
              <p className="text-sm text-gray-600 mb-4 leading-relaxed">{t("ondc_body")}</p>
              <p className="text-sm font-bold text-primary mb-3">
                {listings.length} {t("items_live_on_network")}
              </p>
              <p className="text-xs text-gray-500 italic">{t("ondc_status_note")}</p>
            </section>
          </div>
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

            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              {demands.length} {t("active_bulk_enquiries")}
            </p>

            {demands.length === 0 ? (
              <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-8 text-center">
                {t("no_open_demands")}
              </p>
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
      </main>

      <CaptureModal
        isOpen={captureOpen}
        onClose={() => {
          setCaptureOpen(false);
          load();
        }}
      />
    </div>
  );
}
