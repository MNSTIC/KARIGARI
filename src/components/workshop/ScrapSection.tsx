"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Coins,
  Loader2,
  Recycle,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading, SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { PillTabs } from "@/components/ui/SegmentedToggle";
import { fill, passportDay } from "@/components/buyer/passportFormat";
import { downscaleImage } from "@/lib/imageEnhance";
import {
  LOT_THRESHOLD_GRAMS,
  MAX_LOT_GRAMS,
  SCRAP_MATERIALS,
  SCRAP_PHOTO_MAX_EDGE,
  formatWeight,
  materialLabelKey,
  poolStatusKey,
  type ScrapMaterial,
  type ScrapPoolStatus,
} from "@/lib/scrap";

/**
 * Scrap & waste — offcuts, shavings and clay waste pooled across a cluster.
 *
 * Alone, a kilo of cotton offcut is not worth a recycler's trip. Pooled across
 * a village it is a lot somebody will collect. That is the entire idea, and
 * this screen is careful to promise nothing more than it:
 *
 *   · Every weight on this page is the artisan's own number, and the page says
 *     so rather than implying somebody here weighed anything.
 *   · The threshold on each progress bar is Karigari's own operating minimum,
 *     labelled as one. No trade body publishes a minimum pickup weight for
 *     village craft waste, and citing a fictional one would be worse than
 *     admitting the figure is ours.
 *   · There is no price anywhere until a real sale is recorded. Not an
 *     estimate, not a range, not a "worth about" — this project has no scrap
 *     price feed, so the card says the price is not set and explains why.
 *   · Scrap money is a FOURTH income stream and is shown on its own, never
 *     added into craft earnings.
 */

interface Lot {
  id: string;
  material: ScrapMaterial;
  grams: number;
  notes: string | null;
  photoUrl: string | null;
  status: string;
  poolId: string | null;
  loggedAt: string;
}

interface Pool {
  id: string;
  material: ScrapMaterial;
  totalGrams: number;
  thresholdGrams: number;
  contributorCount: number;
  status: ScrapPoolStatus;
  listedAt: string | null;
  soldAt: string | null;
  salePriceRupees: number | null;
  enquiryCount: number;
  myGrams: number;
  mySharePercent: number;
}

interface EarningsRow {
  poolId: string;
  material: string;
  grams: number;
  amount: number;
  payoutMode: string;
  payoutRef: string | null;
  createdAt: string;
}

interface ScrapPayload {
  success: true;
  clusterKey: string | null;
  area: string | null;
  thresholds: Record<string, number>;
  lots: Lot[];
  pools: Pool[];
  earnings: { totalReceived: number; simulated: number; real: number; rows: EarningsRow[] };
}

const POOL_TONE: Record<ScrapPoolStatus, "neutral" | "success" | "info"> = {
  OPEN: "neutral",
  LISTED: "success",
  SOLD: "info",
};

const LOT_STATUS_KEY: Record<string, string> = {
  LOGGED: "scrap_lot_status_logged",
  POOLED: "scrap_lot_status_pooled",
  SOLD: "scrap_lot_status_sold",
  WITHDRAWN: "scrap_lot_status_withdrawn",
};

export function ScrapSection() {
  const { t } = useLanguage();
  const [data, setData] = useState<ScrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [material, setMaterial] = useState<ScrapMaterial>("COTTON_OFFCUT");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"g" | "kg">("kg");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyLot, setBusyLot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justLogged, setJustLogged] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/artisan/scrap", { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(`scrap ${res.status}`);
      setData(payload as ScrapPayload);
      setFailed(false);
    } catch (loadError) {
      console.warn("[workshop] scrap unavailable:", (loadError as Error)?.message);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    // Deferred a macrotask so the effect body performs no synchronous setState.
    const kickoff = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, []);

  /** The artisan types grams or kilos; grams are what is stored. */
  const grams = (() => {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(unit === "kg" ? value * 1000 : value);
  })();

  const weightText = (value: number) => {
    const w = formatWeight(value);
    return `${w.value} ${t(w.unitKey)}`;
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      // Downscaled in the artisan's own browser before it is ever sent: the
      // same helper the capture flow uses, at a smaller edge because this is a
      // thumbnail of a heap of offcuts, not a product photograph.
      setPhotoUrl(await downscaleImage(raw, SCRAP_PHOTO_MAX_EDGE, 0.7));
    } catch (photoError) {
      console.warn("[scrap] photo skipped:", (photoError as Error)?.message);
    }
  };

  const logScrap = async () => {
    if (grams <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/artisan/scrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material, grams, notes: notes.trim() || null, photoUrl }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `scrap ${res.status}`);
      setJustLogged(grams);
      setAmount("");
      setNotes("");
      setPhotoUrl(null);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (logError) {
      setError((logError as Error)?.message || "failed");
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (id: string) => {
    setBusyLot(id);
    setError(null);
    try {
      const res = await fetch(`/api/artisan/scrap?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `scrap ${res.status}`);
      await load();
    } catch (withdrawError) {
      setError((withdrawError as Error)?.message || "failed");
    } finally {
      setBusyLot(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="kg-shimmer h-[220px] rounded-2xl" />
        <div className="kg-shimmer h-[180px] rounded-2xl" />
      </div>
    );
  }

  if (failed || !data) {
    return (
      <Card pad="lg" className="border-dashed text-center">
        <AlertTriangle size={24} className="mx-auto mb-3 text-gray-400" />
        <p className="text-[14px] text-gray-600">{t("scrap_load_failed")}</p>
      </Card>
    );
  }

  const openLots = data.lots.filter((lot) => lot.status === "LOGGED" || lot.status === "POOLED");
  const earnings = data.earnings;

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------ Log a lot */}
      <Card pad="lg">
        <SectionHeading size="sm">
          <span className="inline-flex items-center gap-2">
            <Recycle size={18} className="text-gray-500" aria-hidden /> {t("scrap_title")}
          </span>
        </SectionHeading>
        <p className="-mt-1 text-[14px] leading-relaxed text-gray-600">{t("scrap_lede")}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">{t("scrap_self_reported")}</p>

        {!data.clusterKey && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">
            {t("scrap_no_cluster")}
          </p>
        )}

        <div className="mt-5">
          <span className="kg-label mb-1.5 block font-medium text-gray-600">{t("scrap_material")}</span>
          <PillTabs<ScrapMaterial>
            ariaLabel={t("scrap_material")}
            value={material}
            onChange={setMaterial}
            options={SCRAP_MATERIALS.map((key) => ({ value: key, label: t(materialLabelKey(key)) }))}
          />
          {material === "OTHER" && (
            <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{t("scrap_material_other_note")}</p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1">
            <span className="kg-label mb-1.5 block font-medium text-gray-600">{t("scrap_weight")}</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              maxLength={8}
              placeholder="0"
              className="min-h-[48px] w-full rounded-xl border border-gray-300 bg-card px-3.5 text-[15px] text-gray-900 outline-none focus:border-primary"
            />
          </label>
          <div
            role="group"
            aria-label={t("scrap_weight")}
            className="flex overflow-hidden rounded-xl border border-gray-300"
          >
            {(["g", "kg"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={unit === option}
                onClick={() => setUnit(option)}
                className={`kg-press min-h-[48px] px-4 text-[13px] font-semibold ${
                  unit === option ? "bg-primary text-white" : "bg-card text-gray-600"
                }`}
              >
                {t(option === "g" ? "scrap_unit_g" : "scrap_unit_kg")}
              </button>
            ))}
          </div>
        </div>
        {grams > MAX_LOT_GRAMS && (
          <p className="mt-1.5 text-[12px] text-red-700">
            {fill(t("scrap_weight_too_big"), { max: MAX_LOT_GRAMS / 1000 })}
          </p>
        )}

        <label className="mt-4 block">
          <span className="kg-label mb-1.5 block font-medium text-gray-600">{t("scrap_notes")}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={300}
            rows={2}
            className="w-full rounded-xl border border-gray-300 bg-card px-3.5 py-2.5 text-[14px] text-gray-900 outline-none focus:border-primary"
          />
        </label>

        <div className="mt-4">
          <span className="kg-label mb-1.5 block font-medium text-gray-600">{t("scrap_photo")}</span>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => void pickPhoto(e.target.files?.[0])}
              className="block max-w-full text-[13px] text-gray-600 file:mr-3 file:min-h-[44px] file:rounded-xl file:border-0 file:bg-[var(--color-pill)] file:px-4 file:text-[13px] file:font-semibold file:text-gray-700"
            />
            {photoUrl && (
              <span className="relative block h-14 w-14 overflow-hidden rounded-xl border border-gray-200">
                <Image src={photoUrl} alt="" fill sizes="56px" unoptimized className="object-cover" />
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-gray-500">{t("scrap_photo_hint")}</p>
        </div>

        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>}
        {justLogged !== null && !error && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
            {fill(t("scrap_logged"), { weight: weightText(justLogged) })}
          </p>
        )}

        <button
          type="button"
          onClick={() => void logScrap()}
          disabled={saving || grams <= 0 || grams > MAX_LOT_GRAMS || !data.clusterKey}
          className="kg-press mt-4 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
        >
          {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
          {t("scrap_log_cta")}
        </button>
      </Card>

      {/* --------------------------------------------------- Cluster pools */}
      <section aria-label={t("scrap_pool_title")}>
        <SectionHeading size="sm">{t("scrap_pool_title")}</SectionHeading>
        <p className="-mt-1 mb-4 text-[13px] leading-relaxed text-gray-500">{t("scrap_threshold_note")}</p>

        {data.pools.length === 0 ? (
          <Card pad="lg" className="border-dashed">
            <p className="text-[14px] leading-relaxed text-gray-600">{t("scrap_empty")}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-500">{t("scrap_how_it_works")}</p>
            <ul className="mt-3 space-y-1.5">
              {SCRAP_MATERIALS.map((key) => (
                <li key={key} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-gray-700">{t(materialLabelKey(key))}</span>
                  <span className="shrink-0 font-mono text-[12px] text-gray-500">
                    {weightText(LOT_THRESHOLD_GRAMS[key])}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <ul className="space-y-4">
            {data.pools.map((pool) => (
              <li key={pool.id}>
                <Card pad="lg">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 truncate text-[15px] font-semibold text-gray-900">
                      {t(materialLabelKey(pool.material))}
                    </h3>
                    <Badge variant={POOL_TONE[pool.status]}>{t(poolStatusKey(pool.status))}</Badge>
                  </div>

                  <p className="mt-2 text-[14px] font-semibold text-gray-900">
                    {fill(t("scrap_pool_progress"), {
                      have: weightText(pool.totalGrams),
                      need: weightText(pool.thresholdGrams),
                    })}
                  </p>
                  <ProgressBar
                    className="mt-1.5"
                    value={pool.totalGrams}
                    max={pool.thresholdGrams}
                    tone={pool.status === "OPEN" ? "primary" : "success"}
                    label={t(materialLabelKey(pool.material))}
                  />

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-gray-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Users size={13} aria-hidden />
                      {fill(t("scrap_pool_contributors"), { n: pool.contributorCount })}
                    </span>
                    {pool.myGrams > 0 && (
                      <span>
                        {fill(t("scrap_your_share"), {
                          weight: weightText(pool.myGrams),
                          percent: pool.mySharePercent,
                        })}
                      </span>
                    )}
                    {pool.status === "LISTED" && (
                      <span>
                        {pool.enquiryCount === 1
                          ? t("scrap_enquiries_one")
                          : fill(t("scrap_enquiries"), { n: pool.enquiryCount })}
                      </span>
                    )}
                  </div>

                  {/* No price, and the reason why, rather than an estimate
                      nobody computed from anything. */}
                  {pool.salePriceRupees === null ? (
                    <p className="mt-3 text-[12px] leading-relaxed text-gray-500">{t("scrap_price_not_set")}</p>
                  ) : (
                    <p className="mt-3 text-[13px] font-semibold text-gray-900">
                      {fill(t("scrap_sold_for"), {
                        amount: pool.salePriceRupees.toLocaleString("en-IN"),
                        date: pool.soldAt ? passportDay(pool.soldAt) : "",
                      })}
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- My lots */}
      {openLots.length > 0 && (
        <section aria-label={t("scrap_my_lots")}>
          <SectionHeading size="sm">{t("scrap_my_lots")}</SectionHeading>
          <ul className="space-y-2.5">
            {data.lots.map((lot) => (
              <li key={lot.id}>
                <Card pad="md" className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-gray-900">
                      {weightText(lot.grams)} · {t(materialLabelKey(lot.material))}
                    </p>
                    <p className="mt-0.5 text-[12px] text-gray-500">
                      {passportDay(lot.loggedAt)} ·{" "}
                      {t(LOT_STATUS_KEY[lot.status] ?? "scrap_lot_status_logged")}
                    </p>
                    {lot.notes && <p className="mt-1 text-[12px] text-gray-600">{lot.notes}</p>}
                  </div>
                  {(lot.status === "LOGGED" || lot.status === "POOLED") && (
                    <button
                      type="button"
                      onClick={() => void withdraw(lot.id)}
                      disabled={busyLot === lot.id}
                      className="kg-press inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-gray-300 bg-card px-3.5 text-[13px] font-semibold text-gray-700 disabled:opacity-60"
                    >
                      {busyLot === lot.id ? (
                        <Loader2 size={14} className="animate-spin" aria-hidden />
                      ) : (
                        <Trash2 size={14} aria-hidden />
                      )}
                      {t("scrap_withdraw")}
                    </button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------- Scrap earnings */}
      <section aria-label={t("scrap_earnings_title")}>
        <SectionHeading size="sm">
          <span className="inline-flex items-center gap-2">
            <Coins size={18} className="text-gray-500" aria-hidden /> {t("scrap_earnings_title")}
          </span>
        </SectionHeading>
        <Card pad="lg">
          <SectionEyebrow>{t("scrap_received")}</SectionEyebrow>
          <p className="mt-1 text-[28px] font-bold leading-none text-gray-900">
            ₹{earnings.totalReceived.toLocaleString("en-IN")}
          </p>
          {/* A fourth stream, and the page says so — this figure is never added
              into the craft earnings total on the earnings page. */}
          <p className="mt-2 text-[13px] leading-relaxed text-gray-600">{t("scrap_earnings_separate")}</p>

          {earnings.rows.length === 0 ? (
            <p className="mt-3 text-[13px] leading-relaxed text-gray-500">{t("scrap_no_payouts")}</p>
          ) : (
            <ul className="mt-4 space-y-2.5 border-t border-gray-100 pt-4">
              {earnings.rows.map((row) => (
                <li key={`${row.poolId}-${row.createdAt}`} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700">
                    {t(materialLabelKey(row.material as ScrapMaterial))} · {weightText(row.grams)}
                  </span>
                  <span className="text-[13px] font-semibold text-gray-900">
                    ₹{row.amount.toLocaleString("en-IN")}
                  </span>
                  <Badge variant={row.payoutMode === "SIMULATED" ? "warning" : "success"}>
                    {t(row.payoutMode === "SIMULATED" ? "scrap_payout_simulated" : "scrap_payout_real")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {earnings.simulated > 0 && (
            <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
              {fill(t("scrap_simulated_note"), { amount: earnings.simulated.toLocaleString("en-IN") })}
            </p>
          )}
        </Card>
      </section>
    </div>
  );
}
