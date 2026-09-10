"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  ImagePlus,
  Loader2,
  Package,
  Scale,
  SlidersHorizontal,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { upcomingFestivals } from "@/lib/festivals";
import { DemandRecommendation } from "@/components/DemandRecommendation";
import { prepareImage } from "@/lib/clientImagePrep";
import { cn } from "@/lib/utils";

/**
 * Buyer-side form behind "Post New Demand".
 *
 * Posts to the public /api/demand board — buyers have no login in this app, so
 * the form carries the buyer's name rather than an identity token. The demand
 * it creates is the same row the artisan insights map and alerts read.
 *
 * V9 split what was one flat scroll of inputs into five labelled sections. It
 * is deliberately still ONE modal rather than a multi-route wizard: a buyer
 * posting a bulk request wants to see the whole thing before committing to it,
 * and a wizard would also break the live recommendation panel, which needs the
 * craft, the quantity and the price visible at the same time to say anything
 * useful.
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
  referenceImageUrls?: string[] | null;
  material?: string | null;
  color?: string | null;
  description?: string | null;
  matchScore?: number | null;
  // V9 structured capture.
  category?: string | null;
  productType?: string | null;
  sizeSpec?: string | null;
  customizationRequired?: boolean | null;
  customizationDetails?: string | null;
  requiredBy?: string | null;
  deliveryMode?: string | null;
  purchaseType?: string | null;
  additionalRequirements?: string | null;
  flexBudget?: string | null;
  flexColor?: string | null;
  flexMaterial?: string | null;
  flexDelivery?: string | null;
  flexDesign?: string | null;
}

/**
 * Matches the server's cap in `POST /api/demand`. Checked here too so the
 * buyer is told before a multi-megabyte base64 string is posted over what is
 * often a phone connection.
 */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Four photos is enough to show front, back, detail and scale. */
const MAX_IMAGES = 4;

interface PostDemandModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultBuyerName?: string;
  onPosted: (demand: PostedDemand, notified: number) => void;
}

/**
 * The category list. Fixed rather than free text because this is the one field
 * the matcher compares ACROSS artisans — a buyer inventing their own category
 * name would score against nobody.
 */
const CATEGORIES = [
  "Saree & Textile",
  "Pottery & Ceramics",
  "Jewellery",
  "Handicraft",
  "Painting & Art",
  "Furniture",
  "Home Décor",
  "Metalwork",
  "Leather",
  "Other",
] as const;

/**
 * Suggestions for the product type, per category. A datalist, not a select: the
 * point is to save typing for the common case without blocking a buyer whose
 * article is not on anyone's list.
 */
const PRODUCT_TYPES: Record<string, string[]> = {
  "Saree & Textile": ["Saree", "Dupatta", "Stole", "Shawl", "Running fabric", "Kurta piece"],
  "Pottery & Ceramics": ["Dinner set", "Vase", "Planter", "Water jug", "Serving bowl"],
  Jewellery: ["Necklace", "Earrings", "Bangle set", "Anklet", "Ring"],
  Handicraft: ["Wall hanging", "Basket", "Toy", "Mask", "Figurine"],
  "Painting & Art": ["Canvas", "Scroll", "Framed print", "Wall mural"],
  Furniture: ["Chair", "Stool", "Coffee table", "Cabinet", "Bed frame"],
  "Home Décor": ["Lamp", "Cushion cover", "Table runner", "Mirror frame"],
  Metalwork: ["Lamp", "Idol", "Bowl", "Tray", "Bell"],
  Leather: ["Bag", "Wallet", "Footwear", "Belt", "Journal cover"],
};

/** Chips for the material field. "Other" reveals the free-text input. */
const MATERIALS = ["Cotton", "Silk", "Wool", "Wood", "Clay", "Metal", "Leather", "Bamboo", "Other"];

/** Budget presets, in rupees per piece. `null` bounds mean "custom". */
const BUDGET_PRESETS: { id: string; label: string; min: number | null; max: number | null }[] = [
  { id: "500-1000", label: "₹500 – ₹1,000", min: 500, max: 1000 },
  { id: "1000-5000", label: "₹1,000 – ₹5,000", min: 1000, max: 5000 },
  { id: "5000-10000", label: "₹5,000 – ₹10,000", min: 5000, max: 10000 },
  { id: "custom", label: "Custom", min: null, max: null },
];

type TimingChoice = "flexible" | "week" | "month" | "date";

const EMPTY = {
  // 1. Product requirements
  category: "",
  productType: "",
  craftType: "",
  description: "",
  quantity: "",
  material: "",
  materialOther: "",
  color: "",
  designPattern: "",
  sizeSpec: "",
  customizationRequired: "no",
  customizationDetails: "",
  // 2. Budget & purchase
  budgetPreset: "custom",
  targetPriceMin: "",
  targetPriceMax: "",
  purchaseType: "INDIVIDUAL",
  timing: "flexible" as TimingChoice,
  requiredByDate: "",
  // 4. Delivery
  location: "",
  preferredDeliveryDate: "",
  deliveryMode: "DELIVERY",
  festival: "",
  // 5. Flexibility + additional
  flexBudget: "STRICT",
  flexColor: "STRICT",
  flexMaterial: "STRICT",
  flexDelivery: "STRICT",
  flexDesign: "EXACT",
  additionalRequirements: "",
};

type FormState = typeof EMPTY;
type FieldErrors = Partial<Record<keyof FormState | "images", string>>;

/** yyyy-mm-dd, N days out, for `requiredBy` and the date inputs' bounds. */
function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

export function PostDemandModal({
  isOpen,
  onClose,
  defaultBuyerName = "",
  onPosted,
}: PostDemandModalProps) {
  const { t } = useLanguage();
  const [form, setForm] = useState<FormState>(EMPTY);
  // Derived, not synced: the field shows the caller's name until the buyer
  // types over it, so a changing prop never needs an effect to catch up.
  const [buyerNameEdit, setBuyerNameEdit] = useState<string | null>(null);
  const buyerName = buyerNameEdit ?? defaultBuyerName;
  const setBuyerName = (value: string) => setBuyerNameEdit(value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Per-field messages, so a buyer is told WHICH input is wrong, not just that one is. */
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  /** Buyer's reference photos, held as data URLs — the same shape every other
      image in this app is stored in. There is no upload bucket. */
  const [images, setImages] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * Escape closes, and Tab stays inside.
   *
   * The trap matters more here than on the app's other sheets: this one is five
   * sections and ~50 controls deep, so a keyboard user who tabs off the end
   * lands somewhere in the demand board behind the overlay with no visible
   * focus and no obvious way back. The focusable list is recomputed on each Tab
   * rather than cached, because the sections reveal and hide controls as the
   * buyer fills them in.
   */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const root = dialogRef.current;
      if (!root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Move focus into the sheet when it opens, so a keyboard user is not left
  // tabbing through the page behind it.
  useEffect(() => {
    if (!isOpen) return;
    const kickoff = setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    }, 0);
    return () => clearTimeout(kickoff);
  }, [isOpen]);

  // Offered as a datalist so a buyer can tag the occasion the artisan side
  // already reasons about, instead of inventing free-text festivals.
  const festivalOptions = useMemo(() => upcomingFestivals({ withinDays: 200 }), []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clearing as they type: an error that survives the fix is noise.
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  if (!isOpen) return null;

  /** The material actually posted — the chip, or the free text behind "Other". */
  const resolvedMaterial = form.material === "Other" ? form.materialOther : form.material;

  const pickImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Reset immediately so picking the same file twice still fires a change.
    e.target.value = "";
    if (picked.length === 0) return;

    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setFieldErrors((prev) => ({ ...prev, images: t("demand_images_max") }));
      return;
    }

    const accepted: string[] = [];
    let rejection: string | null = null;

    // Validated BEFORE the read, so an oversized photo never becomes several
    // megabytes of base64 in memory on a phone.
    for (const file of picked.slice(0, room)) {
      if (!file.type.startsWith("image/")) {
        rejection = t("demand_image_invalid");
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        rejection = t("demand_image_too_large");
        continue;
      }
      accepted.push(await prepareImage(file));
    }

    if (picked.length > room) rejection = t("demand_images_max");
    setFieldErrors((prev) => ({ ...prev, images: rejection ?? undefined }));
    if (accepted.length > 0) setImages((prev) => [...prev, ...accepted].slice(0, MAX_IMAGES));
  };

  /** `requiredBy` from the timing choice. Null means the buyer said flexible. */
  const resolveRequiredBy = (): string | null => {
    if (form.timing === "flexible") return null;
    if (form.timing === "week") return new Date(`${isoDate(7)}T23:59:00`).toISOString();
    if (form.timing === "month") return new Date(`${isoDate(30)}T23:59:00`).toISOString();
    return form.requiredByDate ? new Date(`${form.requiredByDate}T23:59:00`).toISOString() : null;
  };

  /** Every blocking rule in one place, so submit can never silently no-op. */
  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};

    if (!form.craftType.trim()) errors.craftType = t("demand_error_craft");

    const quantity = Number(form.quantity);
    if (!form.quantity.trim() || !Number.isFinite(quantity) || quantity < 1) {
      errors.quantity = t("demand_error_quantity");
    }

    const min = form.targetPriceMin ? Number(form.targetPriceMin) : null;
    const max = form.targetPriceMax ? Number(form.targetPriceMax) : null;
    if (min !== null && (!Number.isFinite(min) || min < 0)) {
      errors.targetPriceMin = t("demand_error_price_range");
    }
    if (max !== null && (!Number.isFinite(max) || max < 0)) {
      errors.targetPriceMax = t("demand_error_price_range");
    }
    if (min !== null && max !== null && min > max) {
      errors.targetPriceMax = t("demand_error_price_range");
    }

    if (form.customizationRequired === "yes" && !form.customizationDetails.trim()) {
      errors.customizationDetails = t("demand_error_customization");
    }

    if (form.timing === "date") {
      if (!form.requiredByDate) errors.requiredByDate = t("demand_error_required_by");
      else if (new Date(`${form.requiredByDate}T23:59:00`) < new Date()) {
        errors.requiredByDate = t("demand_error_required_by_past");
      }
    }

    if (form.material === "Other" && !form.materialOther.trim()) {
      errors.materialOther = t("demand_error_material_other");
    }

    return errors;
  };

  const submit = async () => {
    setError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      // One summary line alongside the inline markers, so the reason is visible
      // even when the offending field has scrolled out of the sheet.
      setError(t("demand_error_summary").replace("{count}", String(Object.keys(errors).length)));
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const res = await fetch("/api/demand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftType: form.craftType,
          quantity: Number(form.quantity),
          targetPriceMin: form.targetPriceMin ? Number(form.targetPriceMin) : null,
          targetPriceMax: form.targetPriceMax ? Number(form.targetPriceMax) : null,
          location: form.location,
          festival: form.festival,
          buyerName: buyerName.trim() || null,
          referenceImageUrls: images,
          material: resolvedMaterial,
          color: form.color,
          description: form.description,
          // ---- V9 ----
          category: form.category,
          productType: form.productType,
          // The design/pattern note has no column of its own: it is a
          // description of the piece, and merging it into `sizeSpec` would be
          // wrong. It rides on the description instead, which is where an
          // artisan already reads for it.
          sizeSpec: form.sizeSpec,
          customizationRequired: form.customizationRequired === "yes",
          customizationDetails: form.customizationDetails,
          requiredBy: resolveRequiredBy(),
          deliveryMode: form.deliveryMode,
          purchaseType: form.purchaseType,
          additionalRequirements: [
            form.designPattern.trim() ? `Design / pattern: ${form.designPattern.trim()}` : "",
            form.preferredDeliveryDate ? `Preferred delivery: ${form.preferredDeliveryDate}` : "",
            form.additionalRequirements.trim(),
          ]
            .filter(Boolean)
            .join("\n"),
          flexBudget: form.flexBudget,
          flexColor: form.flexColor,
          flexMaterial: form.flexMaterial,
          flexDelivery: form.flexDelivery,
          flexDesign: form.flexDesign,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || t("demand_error_generic"));
        return;
      }
      onPosted(data.demand, data.notified ?? 0);
      setForm(EMPTY);
      setImages([]);
      onClose();
    } catch (e) {
      console.error("Failed to post demand", e);
      setError(t("network_error_retry"));
    } finally {
      setSubmitting(false);
    }
  };

  const field =
    "min-h-[44px] w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all";
  // Every shade here is one globals.css actually defines. Tailwind falls back
  // to its own stock palette for any it does not — red-300 renders a bright
  // lab() red that is nowhere in this heritage palette, and red-400 is not
  // emitted at all, so it resolves to currentColor and paints the border
  // near-black.
  const fieldBad = "border-red-500 bg-red-50 focus:border-red-600 focus:ring-red-200";
  const label = "block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("post_new_demand")}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] animate-fade-in-up"
      >
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
            className="kg-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-200"
            aria-label={t("close_btn")}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-7 overflow-y-auto">
          {/* ============ 1. Product requirements ============ */}
          <Section icon={<Package size={13} />} title={t("demand_section_product")}>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label} htmlFor="demand-category">
                  {t("demand_category")}
                </label>
                <select
                  id="demand-category"
                  className={field}
                  value={form.category}
                  onChange={(e) => {
                    set("category", e.target.value);
                    // A product type from the previous category is worse than
                    // an empty one — it describes an article the buyer is no
                    // longer asking for.
                    set("productType", "");
                  }}
                >
                  <option value="">{t("demand_category_choose")}</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="demand-product-type">
                  {t("demand_product_type")}
                </label>
                <input
                  id="demand-product-type"
                  className={field}
                  list="demand-product-type-options"
                  value={form.productType}
                  onChange={(e) => set("productType", e.target.value)}
                  placeholder={PRODUCT_TYPES[form.category]?.[0] || t("demand_product_type_placeholder")}
                />
                <datalist id="demand-product-type-options">
                  {(PRODUCT_TYPES[form.category] ?? []).map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label className={label} htmlFor="demand-craft">
                {t("demand_craft_type")} *
              </label>
              <input
                id="demand-craft"
                className={cn(field, fieldErrors.craftType && fieldBad)}
                aria-invalid={Boolean(fieldErrors.craftType)}
                value={form.craftType}
                onChange={(e) => set("craftType", e.target.value)}
                placeholder={t("demand_craft_placeholder")}
              />
              <FieldError message={fieldErrors.craftType} />
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label} htmlFor="demand-qty">
                  {t("demand_quantity")} *
                </label>
                <input
                  id="demand-qty"
                  type="number"
                  min={1}
                  className={cn(field, fieldErrors.quantity && fieldBad)}
                  aria-invalid={Boolean(fieldErrors.quantity)}
                  value={form.quantity}
                  onChange={(e) => set("quantity", e.target.value)}
                  placeholder="50"
                />
                <FieldError message={fieldErrors.quantity} />
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
              <span className={label}>{t("demand_material")}</span>
              <div className="flex flex-wrap gap-1.5">
                {MATERIALS.map((option) => (
                  <Chip
                    key={option}
                    selected={form.material === option}
                    onClick={() => set("material", form.material === option ? "" : option)}
                  >
                    {option}
                  </Chip>
                ))}
              </div>
              {form.material === "Other" && (
                <div className="mt-2">
                  <input
                    aria-label={t("demand_material")}
                    className={cn(field, fieldErrors.materialOther && fieldBad)}
                    aria-invalid={Boolean(fieldErrors.materialOther)}
                    value={form.materialOther}
                    onChange={(e) => set("materialOther", e.target.value)}
                    placeholder={t("demand_material_placeholder")}
                  />
                  <FieldError message={fieldErrors.materialOther} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label} htmlFor="demand-design">
                  {t("demand_design_pattern")}
                </label>
                <input
                  id="demand-design"
                  className={field}
                  value={form.designPattern}
                  onChange={(e) => set("designPattern", e.target.value)}
                  placeholder={t("demand_design_pattern_placeholder")}
                />
              </div>
              <div>
                <label className={label} htmlFor="demand-size">
                  {t("demand_size")}
                </label>
                <input
                  id="demand-size"
                  className={field}
                  value={form.sizeSpec}
                  onChange={(e) => set("sizeSpec", e.target.value)}
                  placeholder={t("demand_size_placeholder")}
                  aria-describedby="demand-size-hint"
                />
                <p id="demand-size-hint" className="mt-1 text-[11px] text-gray-500">
                  {t("demand_size_hint")}
                </p>
              </div>
            </div>

            <fieldset>
              <legend className={label}>{t("demand_customization")}</legend>
              <div className="flex gap-2">
                <Radio
                  name="customization"
                  value="no"
                  checked={form.customizationRequired === "no"}
                  onChange={() => set("customizationRequired", "no")}
                  label={t("no")}
                />
                <Radio
                  name="customization"
                  value="yes"
                  checked={form.customizationRequired === "yes"}
                  onChange={() => set("customizationRequired", "yes")}
                  label={t("yes")}
                />
              </div>
              {form.customizationRequired === "yes" && (
                <div className="mt-2">
                  <textarea
                    aria-label={t("demand_customization_details")}
                    rows={2}
                    className={cn(field, "resize-y", fieldErrors.customizationDetails && fieldBad)}
                    aria-invalid={Boolean(fieldErrors.customizationDetails)}
                    value={form.customizationDetails}
                    onChange={(e) => set("customizationDetails", e.target.value)}
                    placeholder={t("demand_customization_placeholder")}
                  />
                  <FieldError message={fieldErrors.customizationDetails} />
                </div>
              )}
            </fieldset>
          </Section>

          {/* ============ 2. Budget & purchase ============ */}
          <Section icon={<Scale size={13} />} title={t("demand_section_budget")}>
            <div>
              <span className={label}>{t("demand_budget_band")}</span>
              <div className="flex flex-wrap gap-1.5">
                {BUDGET_PRESETS.map((preset) => (
                  <Chip
                    key={preset.id}
                    selected={form.budgetPreset === preset.id}
                    onClick={() => {
                      set("budgetPreset", preset.id);
                      if (preset.min !== null) set("targetPriceMin", String(preset.min));
                      if (preset.max !== null) set("targetPriceMax", String(preset.max));
                    }}
                  >
                    {preset.label}
                  </Chip>
                ))}
              </div>
            </div>

            {form.budgetPreset === "custom" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={label} htmlFor="demand-min">
                    {t("demand_price_min")}
                  </label>
                  <input
                    id="demand-min"
                    type="number"
                    min={0}
                    className={cn(field, fieldErrors.targetPriceMin && fieldBad)}
                    value={form.targetPriceMin}
                    onChange={(e) => set("targetPriceMin", e.target.value)}
                    placeholder="3500"
                  />
                  <FieldError message={fieldErrors.targetPriceMin} />
                </div>
                <div>
                  <label className={label} htmlFor="demand-max">
                    {t("demand_price_max")}
                  </label>
                  <input
                    id="demand-max"
                    type="number"
                    min={0}
                    className={cn(field, fieldErrors.targetPriceMax && fieldBad)}
                    value={form.targetPriceMax}
                    onChange={(e) => set("targetPriceMax", e.target.value)}
                    placeholder="4000"
                  />
                  <FieldError message={fieldErrors.targetPriceMax} />
                </div>
              </div>
            )}

            <fieldset>
              <legend className={label}>{t("demand_purchase_type")}</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["INDIVIDUAL", t("demand_purchase_individual")],
                    ["BULK", t("demand_purchase_bulk")],
                    ["WHOLESALE", t("demand_purchase_wholesale")],
                  ] as const
                ).map(([value, text]) => (
                  <Radio
                    key={value}
                    name="purchaseType"
                    value={value}
                    checked={form.purchaseType === value}
                    onChange={() => set("purchaseType", value)}
                    label={text}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className={label}>{t("demand_when_needed")}</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["flexible", t("demand_when_flexible")],
                    ["week", t("demand_when_week")],
                    ["month", t("demand_when_month")],
                    ["date", t("demand_when_date")],
                  ] as const
                ).map(([value, text]) => (
                  <Radio
                    key={value}
                    name="timing"
                    value={value}
                    checked={form.timing === value}
                    onChange={() => set("timing", value)}
                    label={text}
                  />
                ))}
              </div>
              {form.timing === "date" && (
                <div className="mt-2">
                  <input
                    type="date"
                    aria-label={t("demand_when_date")}
                    min={isoDate(1)}
                    className={cn(field, fieldErrors.requiredByDate && fieldBad)}
                    aria-invalid={Boolean(fieldErrors.requiredByDate)}
                    value={form.requiredByDate}
                    onChange={(e) => set("requiredByDate", e.target.value)}
                  />
                  <FieldError message={fieldErrors.requiredByDate} />
                </div>
              )}
            </fieldset>

            {/* Live AI verdict on the form as it stands. Silent until the
                required fields are filled, so a half-typed row does not nag. */}
            <DemandRecommendation
              craftType={form.craftType}
              quantity={Number(form.quantity) || 0}
              targetPriceMin={Number(form.targetPriceMin) || undefined}
              targetPriceMax={Number(form.targetPriceMax) || undefined}
              material={resolvedMaterial}
              color={form.color}
              description={form.description}
              category={form.category}
              sizeSpec={form.sizeSpec}
              purchaseType={form.purchaseType}
            />
          </Section>

          {/* ============ 3. Visual reference ============ */}
          <Section icon={<ImagePlus size={13} />} title={t("demand_section_reference")}>
            {images.length > 0 && (
              <ul className="grid grid-cols-4 gap-2">
                {images.map((src, index) => (
                  <li
                    key={`${index}-${src.slice(-16)}`}
                    className="relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
                  >
                    {/* Guarded and `unoptimized`: these are data URLs, which the
                        image optimizer cannot fetch. */}
                    <Image
                      src={src}
                      alt={`${t("demand_reference_image")} ${index + 1}`}
                      fill
                      sizes="88px"
                      unoptimized
                      className="object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={t("demand_remove_image")}
                      className="kg-press absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-red-600 shadow-sm hover:bg-white"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {images.length < MAX_IMAGES && (
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
              multiple
              aria-label={t("demand_add_image")}
              className="hidden"
              onChange={(e) => void pickImages(e)}
            />
            <p className="text-xs text-gray-500">
              {t("demand_reference_hint_multi")
                .replace("{max}", String(MAX_IMAGES))
                .replace("{used}", String(images.length))}
            </p>
            <FieldError message={fieldErrors.images} />
          </Section>

          {/* ============ 4. Delivery ============ */}
          <Section icon={<Truck size={13} />} title={t("demand_section_delivery")}>
            <div className="grid grid-cols-2 gap-4">
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
              <div>
                <label className={label} htmlFor="demand-delivery-date">
                  {t("demand_preferred_delivery")}
                </label>
                <input
                  id="demand-delivery-date"
                  type="date"
                  min={isoDate(1)}
                  className={field}
                  value={form.preferredDeliveryDate}
                  onChange={(e) => set("preferredDeliveryDate", e.target.value)}
                />
              </div>
            </div>

            <fieldset>
              <legend className={label}>{t("demand_delivery_mode")}</legend>
              <div className="flex gap-2">
                <Radio
                  name="deliveryMode"
                  value="DELIVERY"
                  checked={form.deliveryMode === "DELIVERY"}
                  onChange={() => set("deliveryMode", "DELIVERY")}
                  label={t("demand_delivery_ship")}
                />
                <Radio
                  name="deliveryMode"
                  value="PICKUP"
                  checked={form.deliveryMode === "PICKUP"}
                  onChange={() => set("deliveryMode", "PICKUP")}
                  label={t("demand_delivery_pickup")}
                />
              </div>
            </fieldset>

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
          </Section>

          {/* ============ 5. Flexibility + additional ============ */}
          <Section icon={<SlidersHorizontal size={13} />} title={t("demand_section_flexibility")}>
            <p className="text-xs leading-relaxed text-gray-500">{t("demand_flex_lede")}</p>

            <FlexRow
              label={t("demand_flex_budget")}
              explanation={t("demand_flex_budget_note")}
              value={form.flexBudget}
              options={[
                ["STRICT", t("flex_strict")],
                ["FLEXIBLE", t("flex_flexible")],
              ]}
              onChange={(v) => set("flexBudget", v)}
            />
            <FlexRow
              label={t("demand_flex_color")}
              explanation={t("demand_flex_color_note")}
              value={form.flexColor}
              options={[
                ["STRICT", t("flex_strict")],
                ["FLEXIBLE", t("flex_flexible")],
              ]}
              onChange={(v) => set("flexColor", v)}
            />
            <FlexRow
              label={t("demand_flex_material")}
              explanation={t("demand_flex_material_note")}
              value={form.flexMaterial}
              options={[
                ["STRICT", t("flex_strict")],
                ["FLEXIBLE", t("flex_flexible")],
              ]}
              onChange={(v) => set("flexMaterial", v)}
            />
            <FlexRow
              label={t("demand_flex_delivery")}
              explanation={t("demand_flex_delivery_note")}
              value={form.flexDelivery}
              options={[
                ["STRICT", t("flex_strict")],
                ["FLEXIBLE", t("flex_flexible")],
              ]}
              onChange={(v) => set("flexDelivery", v)}
            />
            <FlexRow
              label={t("demand_flex_design")}
              explanation={t("demand_flex_design_note")}
              value={form.flexDesign}
              options={[
                ["EXACT", t("flex_exact")],
                ["SIMILAR", t("flex_similar")],
              ]}
              onChange={(v) => set("flexDesign", v)}
            />

            <div>
              <label className={label} htmlFor="demand-additional">
                {t("demand_additional")}
              </label>
              <textarea
                id="demand-additional"
                rows={3}
                className={`${field} resize-y`}
                value={form.additionalRequirements}
                onChange={(e) => set("additionalRequirements", e.target.value)}
                placeholder={t("demand_additional_placeholder")}
              />
            </div>
          </Section>

          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-3 leading-relaxed">
            {t("post_demand_honesty")}
          </p>

          {error && (
            <p role="alert" className="text-sm text-red-600 font-medium flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              {error}
            </p>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-3xl flex justify-end gap-3">
          <button
            onClick={onClose}
            className="kg-press min-h-[44px] px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="kg-press min-h-[44px] px-6 py-2.5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}
            {submitting ? t("posting") : t("post_demand_cta")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Section furniture. Local to this file because nothing else renders a form
 * shaped like this, and lifting them into the shared kit would be inventing a
 * component with one caller.
 * ---------------------------------------------------------------------- */

/**
 * Inline error line under a field. Renders nothing when the field is fine.
 *
 * Declared at module level rather than inside the form: a component defined in
 * a render body is a NEW component type on every render, so React remounts it
 * and throws away any state it holds. This one is stateless today, but the rule
 * is the rule — and `react-hooks/static-components` enforces it.
 */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-[11px] font-bold text-red-600">
      {message}
    </p>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 border-b border-gray-100 pb-2 text-[11px] font-bold uppercase tracking-wider text-primary">
        <span className="text-gray-400">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A selectable chip. A real button, so it is reachable and operable by keyboard. */
function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "kg-press min-h-[44px] rounded-full border px-4 text-[12px] font-bold transition-colors",
        selected
          ? "border-primary bg-[var(--color-mint)] text-primary"
          : "border-gray-200 bg-white text-gray-600 hover:border-primary hover:text-primary"
      )}
    >
      {children}
    </button>
  );
}

/** A styled radio that keeps the real input for keyboard and screen readers. */
function Radio({
  name,
  value,
  checked,
  onChange,
  label,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label
      className={cn(
        "kg-press inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 text-[12px] font-bold transition-colors",
        checked
          ? "border-primary bg-[var(--color-mint)] text-primary"
          : "border-gray-200 bg-white text-gray-600 hover:border-primary"
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 accent-[var(--color-primary)]"
      />
      {label}
    </label>
  );
}

/**
 * One row of the flexibility matrix.
 *
 * The explanation line is the point of the whole section: "Flexible" means
 * nothing on its own, and a buyer switching it without knowing it lets an
 * artisan propose a different material has not really consented to that.
 */
function FlexRow({
  label,
  explanation,
  value,
  options,
  onChange,
}: {
  label: string;
  explanation: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="min-w-0 flex-1 basis-[55%]">
        <p className="text-[12px] font-bold text-gray-900">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{explanation}</p>
      </div>
      <div
        role="group"
        aria-label={label}
        className="flex shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white"
      >
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            aria-pressed={value === optionValue}
            className={cn(
              "kg-press min-h-[44px] px-3 text-[11px] font-bold transition-colors",
              value === optionValue
                ? "bg-primary text-white"
                : "bg-white text-gray-600 hover:bg-[var(--color-mint)]"
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
