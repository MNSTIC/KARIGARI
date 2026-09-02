"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X, Package, Loader2, AlertTriangle, ImagePlus, Trash2 } from "lucide-react";
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
  referenceImageUrl?: string | null;
  material?: string | null;
  color?: string | null;
  description?: string | null;
  matchScore?: number | null;
}

/**
 * Matches the server's cap in `POST /api/demand`. Checked here too so the
 * buyer is told before a multi-megabyte base64 string is posted over what is
 * often a phone connection.
 */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

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
  material: "",
  color: "",
  description: "",
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
  /** Buyer's reference photo, held as a data URL — the same shape every other
      image in this app is stored in. There is no upload bucket. */
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const pickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change.
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError(t("demand_image_invalid"));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(t("demand_image_too_large"));
      return;
    }

    const reader = new FileReader();
    reader.onload = (loaded) => {
      if (typeof loaded.target?.result !== "string") return;
      setError(null);
      setReferenceImage(loaded.target.result);
    };
    reader.readAsDataURL(file);
  };

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
          referenceImageUrl: referenceImage,
          material: form.material,
          color: form.color,
          description: form.description,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || t("demand_error_generic"));
        return;
      }
      onPosted(data.demand, data.notified ?? 0);
      setForm(EMPTY);
      setReferenceImage(null);
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

          {/* What the buyer is actually after. The artisan reads all of this
              before accepting, and the matcher ranks against it. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="demand-material">
                {t("demand_material")}
              </label>
              <input
                id="demand-material"
                className={field}
                value={form.material}
                onChange={(e) => set("material", e.target.value)}
                placeholder={t("demand_material_placeholder")}
              />
            </div>
            <div>
              <label className={label} htmlFor="demand-color">
                {t("demand_color")}
              </label>
              <input
                id="demand-color"
                className={field}
                value={form.color}
                onChange={(e) => set("color", e.target.value)}
                placeholder={t("demand_color_placeholder")}
              />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="demand-description">
              {t("demand_description")}
            </label>
            <textarea
              id="demand-description"
              rows={3}
              className={`${field} resize-y`}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={t("demand_description_placeholder")}
            />
          </div>

          <div>
            <span className={label}>{t("demand_reference_image")}</span>
            {referenceImage ? (
              <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  {/* Guarded and `unoptimized`: this is a data URL, which the
                      image optimizer cannot fetch. */}
                  <Image
                    src={referenceImage}
                    alt={t("demand_reference_image")}
                    fill
                    sizes="80px"
                    unoptimized
                    className="object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setReferenceImage(null)}
                  className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={14} /> {t("demand_remove_image")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="kg-press flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 text-sm font-bold text-gray-600 hover:border-primary hover:text-primary"
              >
                <ImagePlus size={17} /> {t("demand_add_image")}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={pickImage}
            />
            <p className="mt-1.5 text-xs text-gray-500">{t("demand_reference_hint")}</p>
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
