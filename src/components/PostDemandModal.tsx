"use client";

import { useEffect, useState } from "react";
import { X, Package, Loader2, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { upcomingFestivals } from "@/lib/festivals";

/**
 * Buyer-side form behind "Post New Demand".
 *
 * Posts to the public /api/demand board — buyers have no login in this app, so
 * the form carries the buyer's name rather than an identity token. The demand
 * it creates is the same row the artisan insights map and alerts read.
 */

export interface PostedDemand {
  id: string;
  craftType: string;
  quantity: number;
  targetPriceMin: number | null;
  targetPriceMax: number | null;
  location: string | null;
  festival: string | null;
  buyerName: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
}

interface PostDemandModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultBuyerName?: string;
  onPosted: (demand: PostedDemand, notified: number) => void;
}

const EMPTY = {
  craftType: "",
  quantity: "",
  targetPriceMin: "",
  targetPriceMax: "",
  location: "",
  festival: "",
  notes: "",
};

export function PostDemandModal({
  isOpen,
  onClose,
  defaultBuyerName = "",
  onPosted,
}: PostDemandModalProps) {
  const { t } = useLanguage();
  const [form, setForm] = useState(EMPTY);
  // Derived, not synced: the field shows the caller's name until the buyer
  // types over it, so a changing prop never needs an effect to catch up.
  const [buyerNameEdit, setBuyerNameEdit] = useState<string | null>(null);
  const buyerName = buyerNameEdit ?? defaultBuyerName;
  const setBuyerName = (value: string) => setBuyerNameEdit(value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Offered as a datalist so a buyer can tag the occasion the artisan side
  // already reasons about, instead of inventing free-text festivals.
  const festivalOptions = upcomingFestivals({ withinDays: 200 });

  const set = (key: keyof typeof EMPTY, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setError(null);

    if (!form.craftType.trim()) {
      setError(t("demand_error_craft"));
      return;
    }
    const quantity = Number(form.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError(t("demand_error_quantity"));
      return;
    }
    const min = form.targetPriceMin ? Number(form.targetPriceMin) : null;
    const max = form.targetPriceMax ? Number(form.targetPriceMax) : null;
    if (min !== null && max !== null && min > max) {
      setError(t("demand_error_price_range"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/demand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftType: form.craftType,
          quantity,
          targetPriceMin: min,
          targetPriceMax: max,
          location: form.location,
          festival: form.festival,
          notes: form.notes,
          buyerName: buyerName.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || t("demand_error_generic"));
        return;
      }
      onPosted(data.demand, data.notified ?? 0);
      setForm(EMPTY);
      onClose();
    } catch (e) {
      console.error("Failed to post demand", e);
      setError(t("network_error_retry"));
    } finally {
      setSubmitting(false);
    }
  };

  const field =
    "w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all";
  const label = "block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("post_new_demand")}
    >
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] animate-fade-in-up">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-3xl">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-[var(--color-mint)] text-primary flex items-center justify-center shrink-0">
              <Package size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="font-serif font-bold text-lg text-primary truncate">
                {t("post_new_demand")}
              </h2>
              <p className="text-xs text-gray-500 truncate">{t("post_demand_subtitle")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500 shrink-0"
            aria-label={t("close_btn")}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className={label} htmlFor="demand-craft">
              {t("demand_craft_type")} *
            </label>
            <input
              id="demand-craft"
              className={field}
              value={form.craftType}
              onChange={(e) => set("craftType", e.target.value)}
              placeholder={t("demand_craft_placeholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="demand-qty">
                {t("demand_quantity")} *
              </label>
              <input
                id="demand-qty"
                type="number"
                min={1}
                className={field}
                value={form.quantity}
                onChange={(e) => set("quantity", e.target.value)}
                placeholder="50"
              />
            </div>
            <div>
              <label className={label} htmlFor="demand-location">
                {t("demand_location")}
              </label>
              <input
                id="demand-location"
                className={field}
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Delhi NCR"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="demand-min">
                {t("demand_price_min")}
              </label>
              <input
                id="demand-min"
                type="number"
                min={0}
                className={field}
                value={form.targetPriceMin}
                onChange={(e) => set("targetPriceMin", e.target.value)}
                placeholder="3500"
              />
            </div>
            <div>
              <label className={label} htmlFor="demand-max">
                {t("demand_price_max")}
              </label>
              <input
                id="demand-max"
                type="number"
                min={0}
                className={field}
                value={form.targetPriceMax}
                onChange={(e) => set("targetPriceMax", e.target.value)}
                placeholder="4000"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="demand-festival">
                {t("demand_festival")}
              </label>
              <input
                id="demand-festival"
                className={field}
                list="demand-festival-options"
                value={form.festival}
                onChange={(e) => set("festival", e.target.value)}
                placeholder={festivalOptions[0]?.name || "Diwali"}
              />
              <datalist id="demand-festival-options">
                {festivalOptions.map((f) => (
                  <option key={f.key} value={f.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={label} htmlFor="demand-buyer">
                {t("demand_buyer_name")}
              </label>
              <input
                id="demand-buyer"
                className={field}
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder={t("demand_buyer_placeholder")}
              />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="demand-notes">
              {t("demand_notes")}
            </label>
            <textarea
              id="demand-notes"
              rows={3}
              className={`${field} resize-y`}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder={t("demand_notes_placeholder")}
            />
          </div>

          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-3 leading-relaxed">
            {t("post_demand_honesty")}
          </p>

          {error && (
            <p className="text-sm text-red-600 font-medium flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              {error}
            </p>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-3xl flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-6 py-2.5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}
            {submitting ? t("posting") : t("post_demand_cta")}
          </button>
        </div>
      </div>
    </div>
  );
}
