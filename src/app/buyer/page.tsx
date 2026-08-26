"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Package,
  TrendingUp,
  Search,
  ShieldCheck,
  MapPin,
  Truck,
  Leaf,
  CheckCircle2,
  CalendarDays,
  Loader2,
  BellRing,
} from "lucide-react";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import Image from "next/image";
import { LogisticsMap } from "@/components/LogisticsMap";
import { PostDemandModal, type PostedDemand } from "@/components/PostDemandModal";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/** Buyers have no account yet — the display name is remembered in this browser only. */
const BUYER_NAME_KEY = "karigari_buyer_name";
const DEFAULT_BUYER = "Rajesh Retailers";

function rupees(value?: number | null): string {
  return value || value === 0 ? `₹${value.toLocaleString("en-IN")}` : "—";
}

function priceLabel(demand: PostedDemand): string {
  const { targetPriceMin: min, targetPriceMax: max } = demand;
  if (min && max) return `${rupees(min)} - ${rupees(max)}`;
  if (max) return `≤ ${rupees(max)}`;
  if (min) return `≥ ${rupees(min)}`;
  return "—";
}

export default function BuyerDashboard() {
  const { t } = useLanguage();

  const [buyerName, setBuyerName] = useState(DEFAULT_BUYER);
  const [demands, setDemands] = useState<PostedDemand[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // The artisan-match panel is an explicit simulation, kept per demand.
  const [quoteState, setQuoteState] = useState<Record<string, "pending" | "quoted" | "accepted">>({});

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — same pattern the schemes page uses.
    const kickoff = setTimeout(() => {
      const saved = localStorage.getItem(BUYER_NAME_KEY);
      if (saved) setBuyerName(saved);
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/demand?status=ALL&limit=100", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setDemands(data.demands ?? []);
        setSelectedId((cur) => cur ?? data.demands?.[0]?.id ?? null);
      }
    } catch (e) {
      console.error("Failed to load demands", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — same pattern the schemes page uses.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const myDemands = useMemo(
    () => demands.filter((d) => (d.buyerName || "").toLowerCase() === buyerName.toLowerCase()),
    [demands, buyerName]
  );
  const otherDemands = useMemo(
    () => demands.filter((d) => (d.buyerName || "").toLowerCase() !== buyerName.toLowerCase()),
    [demands, buyerName]
  );

  const selected = demands.find((d) => d.id === selectedId) || null;

  const boardStats = useMemo(() => {
    const open = demands.filter((d) => d.status === "OPEN");
    const units = open.reduce((sum, d) => sum + d.quantity, 0);
    const byCraft = new Map<string, number>();
    open.forEach((d) => byCraft.set(d.craftType, (byCraft.get(d.craftType) || 0) + d.quantity));
    const top = Array.from(byCraft.entries()).sort((a, b) => b[1] - a[1])[0];
    return { openCount: open.length, units, topCraft: top?.[0] ?? null, topUnits: top?.[1] ?? 0 };
  }, [demands]);

  const handlePosted = (demand: PostedDemand, notified: number) => {
    localStorage.setItem(BUYER_NAME_KEY, demand.buyerName || buyerName);
    if (demand.buyerName) setBuyerName(demand.buyerName);
    setDemands((prev) => [demand, ...prev]);
    setSelectedId(demand.id);
    setToast(
      notified > 0
        ? `${t("demand_posted")} ${notified} ${t("artisans_alerted")}`
        : `${t("demand_posted")} ${t("no_artisan_matched")}`
    );
  };

  const simulateMatch = (id: string) => {
    setQuoteState((prev) => ({ ...prev, [id]: "pending" }));
    setTimeout(() => setQuoteState((prev) => ({ ...prev, [id]: "quoted" })), 1500);
  };

  // Shipping is quoted off the real order size rather than a fixed sticker price.
  const shipping = selected
    ? {
        air: Math.max(450, Math.round(selected.quantity * 9)),
        surface: Math.max(200, Math.round(selected.quantity * 4)),
      }
    : { air: 450, surface: 200 };

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-16">
      <header className="px-4 sm:px-8 py-4 bg-white border-b border-gray-200 sticky top-0 z-40 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <KarigariLogo variant="dark" showWordmark={true} size={28} />
          <span className="text-gray-300 font-light text-xl hidden sm:inline">|</span>
          <span className="font-bold text-primary tracking-wide hidden sm:inline">
            B2B MARKETPLACE
          </span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 bg-gray-200 rounded-full overflow-hidden shrink-0">
            <Image src="/female_artisan.jpg" alt="Buyer" width={32} height={32} className="object-cover" />
          </div>
          <div className="hidden sm:block min-w-0">
            <div className="text-sm font-bold text-gray-900 truncate">{buyerName}</div>
            <div className="text-[10px] text-gray-500 font-medium">{t("verified_buyer")}</div>
          </div>
        </div>
      </header>

      {toast && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4">
          <div className="bg-[var(--color-mint)] border border-[var(--color-sage)] text-primary px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 animate-fade-in-up">
            <BellRing size={16} className="shrink-0" />
            {toast}
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold text-gray-900">{t("my_demand_requests")}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {myDemands.length} {t("posted_by_you")} · {boardStats.openCount} {t("open_on_board")}
            </p>
          </div>
          <button
            onClick={() => setIsFormOpen(true)}
            className="bg-primary-dark text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm hover:bg-primary transition-colors flex items-center gap-2"
          >
            <Package size={16} /> {t("post_new_demand")}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {loading && (
              <div className="bg-white rounded-2xl border border-gray-200 p-10 flex items-center justify-center text-gray-400">
                <Loader2 size={20} className="animate-spin" />
              </div>
            )}

            {!loading && demands.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
                <Package className="mx-auto text-gray-300 mb-3" size={32} />
                <p className="text-gray-500 font-medium text-sm">{t("no_demands_yet")}</p>
              </div>
            )}

            {/* Demand tickets — real rows from the shared board */}
            {[...myDemands, ...otherDemands].map((demand) => {
              const isSelected = demand.id === selectedId;
              const demandState = quoteState[demand.id] || "pending";
              const mine = (demand.buyerName || "").toLowerCase() === buyerName.toLowerCase();

              return (
                <div
                  key={demand.id}
                  className={cn(
                    "bg-white rounded-2xl border shadow-card overflow-hidden transition-colors",
                    isSelected ? "border-primary" : "border-gray-200"
                  )}
                >
                  <button
                    onClick={() => setSelectedId(isSelected ? null : demand.id)}
                    className="w-full text-left p-6 border-b border-gray-100 flex flex-wrap justify-between items-start gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center flex-wrap gap-2 mb-2">
                        <span
                          className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                            demand.status === "OPEN"
                              ? "bg-green-50 text-green-700"
                              : demand.status === "MATCHED"
                                ? "bg-blue-50 text-blue-700"
                                : "bg-gray-100 text-gray-600"
                          )}
                        >
                          {demand.status === "OPEN" ? t("active_search") : demand.status}
                        </span>
                        <span className="text-xs text-gray-500 font-bold font-mono">
                          REQ-{demand.id.slice(0, 6).toUpperCase()}
                        </span>
                        {mine && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-mint)] text-primary uppercase tracking-wider">
                            {t("yours")}
                          </span>
                        )}
                      </div>
                      <h3 className="text-xl font-bold text-gray-900">
                        {demand.quantity} × {demand.craftType}
                      </h3>
                      <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-4">
                        {demand.location && (
                          <span className="flex items-center gap-1">
                            <MapPin size={14} /> {demand.location}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <TrendingUp size={14} /> {t("target")}: {priceLabel(demand)}
                        </span>
                        {demand.festival && (
                          <span className="flex items-center gap-1">
                            <CalendarDays size={14} /> {demand.festival}
                          </span>
                        )}
                      </div>
                      {demand.notes && (
                        <p className="text-sm text-gray-600 mt-2 leading-relaxed">{demand.notes}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 font-medium shrink-0">
                      {new Date(demand.createdAt).toLocaleDateString("en-GB")}
                    </span>
                  </button>

                  {isSelected && (
                    <div className="p-6 bg-gray-50">
                      {demandState === "pending" ? (
                        <div className="text-center py-8">
                          <Search className="mx-auto text-gray-300 mb-3" size={32} />
                          <p className="text-gray-500 font-medium text-sm mb-4">
                            {t("matchmaker_searching")}
                          </p>
                          <button
                            onClick={() => simulateMatch(demand.id)}
                            className="text-xs font-bold bg-white text-primary px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                          >
                            {t("simulate_artisan_match")}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2 text-sm font-bold text-gray-700">
                            <CheckCircle2 className="text-green-500" size={18} /> {t("match_found")}
                          </div>

                          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-card">
                            <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-gray-200 rounded-full overflow-hidden">
                                  <Image
                                    src="/female_artisan.jpg"
                                    alt="Artisan"
                                    width={48}
                                    height={48}
                                    className="object-cover"
                                  />
                                </div>
                                <div>
                                  <div className="font-bold text-gray-900 flex items-center gap-2">
                                    {t("verified_artisan_cluster")}{" "}
                                    <ShieldCheck size={14} className="text-blue-500" />
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {t("simulated_match_note")}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-bold text-gray-500">{t("quoted_price")}</div>
                                <div className="text-2xl font-black text-primary">
                                  {rupees(
                                    demand.targetPriceMax ??
                                      demand.targetPriceMin ??
                                      null
                                  )}
                                  <span className="text-sm font-normal text-gray-500"> / {t("unit")}</span>
                                </div>
                              </div>
                            </div>

                            <div className="bg-[var(--color-mint)] rounded-lg p-4 mb-4 border border-[var(--color-sage)]/50">
                              <h4 className="text-xs font-bold text-primary uppercase tracking-wider mb-2 flex items-center gap-2">
                                <TrendingUp size={14} /> {t("fair_wage_guarantee")}
                              </h4>
                              <p className="text-sm text-primary/90 leading-relaxed">
                                {t("fair_wage_guarantee_body")}
                              </p>
                            </div>

                            {demandState === "accepted" ? (
                              <div className="mt-4 animate-fade-in-up">
                                <h4 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                                  <Truck size={16} className="text-green-600" /> {t("choose_route")}
                                </h4>
                                <LogisticsMap />
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-3">
                                <button
                                  onClick={() =>
                                    setQuoteState((prev) => ({ ...prev, [demand.id]: "accepted" }))
                                  }
                                  className="flex-1 min-w-[180px] bg-primary text-white py-3 rounded-xl font-bold hover:bg-primary-dark transition-colors shadow-sm"
                                >
                                  {t("accept_quote")}
                                </button>
                                <button
                                  onClick={() =>
                                    setQuoteState((prev) => ({ ...prev, [demand.id]: "pending" }))
                                  }
                                  className="flex-1 min-w-[180px] bg-white border border-gray-200 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-50 transition-colors shadow-sm"
                                >
                                  {t("negotiate")}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-card">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-1">
                {t("shipping_estimates")}
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                {selected
                  ? `${selected.quantity} ${t("units")} → ${selected.location || t("unspecified")}`
                  : t("select_a_demand")}
              </p>

              <div className="space-y-4">
                <div className="border border-gray-100 rounded-xl p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2 font-bold text-gray-900 text-sm">
                      <Truck size={16} className="text-gray-500" /> {t("standard_air")}
                    </div>
                    <div className="font-bold text-gray-900">{rupees(shipping.air)}</div>
                  </div>
                  <div className="text-xs text-gray-500">{t("standard_air_body")}</div>
                </div>

                <div className="border-2 border-primary bg-[var(--color-mint)] rounded-xl p-4 relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-primary text-white text-[9px] font-bold px-2 py-1 rounded-bl-lg uppercase tracking-wider">
                    {t("recommended")}
                  </div>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2 font-bold text-primary text-sm">
                      <Leaf size={16} /> {t("eco_surface")}
                    </div>
                    <div className="font-bold text-primary">{rupees(shipping.surface)}</div>
                  </div>
                  <div className="text-xs text-gray-600 mb-2">{t("eco_surface_body")}</div>
                  <div className="inline-flex items-center gap-1 bg-green-100 text-green-800 px-2 py-1 rounded text-[10px] font-bold">
                    ↓ 40% {t("carbon_emissions")}
                  </div>
                </div>
              </div>
            </div>

            {/* Live board stats — computed from the same demand rows */}
            <div className="bg-primary-dark text-white p-6 rounded-2xl shadow-card relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-2 relative z-10">
                {t("b2b_market_insights")}
              </h3>
              <p className="text-sm text-white/80 mb-4 relative z-10">
                {boardStats.topCraft
                  ? `${t("most_wanted")}: ${boardStats.topCraft} (${boardStats.topUnits} ${t("units")}).`
                  : t("board_quiet")}
              </p>
              <div className="grid grid-cols-2 gap-3 relative z-10">
                <div className="bg-white/10 p-3 rounded-xl border border-white/10">
                  <div className="text-2xl font-black mb-1">{boardStats.openCount}</div>
                  <div className="text-xs font-medium text-white/70">{t("open_requests")}</div>
                </div>
                <div className="bg-white/10 p-3 rounded-xl border border-white/10">
                  <div className="text-2xl font-black mb-1">{boardStats.units}</div>
                  <div className="text-xs font-medium text-white/70">{t("units_wanted")}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <PostDemandModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        defaultBuyerName={buyerName}
        onPosted={handlePosted}
      />
    </div>
  );
}
