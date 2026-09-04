"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  ImagePlus,
  Loader2,
  MapPin,
  MessageSquarePlus,
  Package,
  Star,
  TrendingUp,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Shell } from "@/components/ui/AppShell";
import { StatTile } from "@/components/ui/StatTile";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { formatRupees } from "@/lib/pricing";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * Artisan Orders — commitments against buyer demands, distinct from sales.
 *
 * Two tabs on one page rather than two routes: the artisan flips between
 * "what am I already working on?" and "what could I take on next?" often, and a
 * navigation each time would break the flow. The list of what they could take
 * on is filtered server-side by their craftType so the panel is short and
 * relevant — a Sambalpuri weaver does not see Dhokra requests.
 */

interface DemandLite {
  id: string;
  craftType: string;
  quantity: number;
  targetPriceMin: number | null;
  targetPriceMax: number | null;
  location: string | null;
  festival: string | null;
  buyerName: string | null;
  referenceImageUrl: string | null;
  material: string | null;
  color: string | null;
  description: string | null;
  createdAt: string;
}

interface OrderLog {
  id: string;
  note: string | null;
  imageUrl: string | null;
  createdAt: string;
}

interface ArtisanOrderRow {
  id: string;
  status: "ACCEPTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  negotiatedPrice: number | null;
  deadline: string | null;
  createdAt: string;
  demand: DemandLite;
  logs: OrderLog[];
  completedImageUrl?: string | null;
}

const DEFAULT_DEADLINE_DAYS = 14;
const MIN_DEADLINE_DAYS = 3;
const MAX_DEADLINE_DAYS = 90;

/** yyyy-mm-dd in the local zone, for prefilling <input type="date">. */
function isoDateInputValue(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

interface OrdersPayload {
  success: true;
  orders: ArtisanOrderRow[];
  stats: {
    totalAccepted: number;
    totalEarned: number;
    avgRating: number | null;
    totalReviews: number;
  };
  matchingDemands: DemandLite[];
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** File → data URL for progress photos. Never left in state without a size check. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function priceRange(demand: DemandLite): string {
  const { targetPriceMin: min, targetPriceMax: max } = demand;
  if (min && max) return `${formatRupees(min)} – ${formatRupees(max)}`;
  if (max) return `≤ ${formatRupees(max)}`;
  if (min) return `≥ ${formatRupees(min)}`;
  return "—";
}

export default function ArtisanOrdersPage() {
  const { t } = useLanguage();
  const [payload, setPayload] = useState<OrdersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"current" | "demands">("current");
  const [toast, setToast] = useState<string | null>(null);

  // Per-row transient state so a click on one card does not disable every card.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [negotiatingFor, setNegotiatingFor] = useState<string | null>(null);
  const [negotiatePrice, setNegotiatePrice] = useState("");
  const [logDrafts, setLogDrafts] = useState<Record<string, { note: string; image: string | null }>>({});

  /** Deadline the artisan picks before accepting. Prefilled to today + 14. */
  const [deadlineDrafts, setDeadlineDrafts] = useState<Record<string, string>>({});
  /** Which order is currently being completed (Complete modal target). */
  const [completingOrder, setCompletingOrder] = useState<ArtisanOrderRow | null>(null);
  const [completeImage, setCompleteImage] = useState<string | null>(null);
  const [completeBusy, setCompleteBusy] = useState(false);

  const getDeadlineDraft = (demandId: string) =>
    deadlineDrafts[demandId] ?? isoDateInputValue(DEFAULT_DEADLINE_DAYS);
  const setDeadlineDraft = (demandId: string, value: string) =>
    setDeadlineDrafts((prev) => ({ ...prev, [demandId]: value }));

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/artisan/orders", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) setPayload(data as OrdersPayload);
      else setError(data?.error || t("orders_load_failed"));
    } catch (e) {
      console.error("Orders load failed:", e);
      setError(t("orders_load_failed"));
    }
  }, [t]);

  useEffect(() => {
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const currentOrders = useMemo(
    () =>
      (payload?.orders ?? []).filter(
        (order) => order.status !== "COMPLETED" && order.status !== "CANCELLED"
      ),
    [payload]
  );

  const stats = payload?.stats;
  const matching = payload?.matchingDemands ?? [];

  const acceptDemand = async (demandId: string, priceOverride?: number) => {
    setBusyId(demandId);
    try {
      // The artisan-picked date is yyyy-mm-dd; end-of-day IST keeps the buyer
      // from seeing "0 days left" the moment the artisan accepts at 6 am.
      const rawDate = getDeadlineDraft(demandId);
      const deadlineIso = new Date(`${rawDate}T23:59:00`).toISOString();

      const res = await fetch("/api/artisan/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demandId,
          action: priceOverride ? "negotiate" : "accept",
          ...(priceOverride ? { negotiatedPrice: priceOverride } : {}),
          deadline: deadlineIso,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("orders_load_failed"));
        return;
      }
      setToast(t("orders_accepted_toast"));
      setNegotiatingFor(null);
      setNegotiatePrice("");
      setTab("current");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const addLog = async (orderId: string) => {
    const draft = logDrafts[orderId];
    if (!draft || (!draft.note.trim() && !draft.image)) return;
    setBusyId(orderId);
    try {
      const res = await fetch("/api/artisan/orders/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artisanOrderId: orderId,
          note: draft.note || undefined,
          imageUrl: draft.image || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("orders_load_failed"));
        return;
      }
      setToast(t("orders_log_submitted"));
      setLogDrafts((prev) => ({ ...prev, [orderId]: { note: "", image: null } }));
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const openComplete = (order: ArtisanOrderRow) => {
    setCompletingOrder(order);
    setCompleteImage(null);
  };

  const pickCompleteImage = async (file: File | null) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError(`"${file.name}" is over 2 MB.`);
      return;
    }
    setCompleteImage(await readFileAsDataUrl(file));
  };

  const submitComplete = async () => {
    if (!completingOrder || !completeImage) return;
    setCompleteBusy(true);
    try {
      const res = await fetch("/api/artisan/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: completingOrder.id,
          action: "complete",
          completedImageUrl: completeImage,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("orders_load_failed"));
        return;
      }
      setToast(t("order_completed_toast"));
      setCompletingOrder(null);
      setCompleteImage(null);
      await load();
    } finally {
      setCompleteBusy(false);
    }
  };

  const setDraftNote = (orderId: string, note: string) => {
    setLogDrafts((prev) => ({
      ...prev,
      [orderId]: { note, image: prev[orderId]?.image ?? null },
    }));
  };

  const setDraftImage = async (orderId: string, file: File | null) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError(`"${file.name}" is over 2 MB.`);
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setLogDrafts((prev) => ({
      ...prev,
      [orderId]: { note: prev[orderId]?.note ?? "", image: dataUrl },
    }));
  };

  if (payload === null && !error) {
    return (
      <Shell>
        <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-10 text-gray-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-8">
        <h1 className="kg-display text-[32px] leading-tight text-gray-900 sm:text-[40px]">
          {t("orders_title")}
        </h1>
      </header>

      {/* ---------------------------------------------- Summary tiles */}
      {stats && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile
            label={t("orders_total_accepted")}
            value={String(stats.totalAccepted)}
            icon={<ClipboardList size={16} />}
          />
          <StatTile
            label={t("orders_total_earned")}
            value={formatRupees(stats.totalEarned)}
            icon={<TrendingUp size={16} />}
          />
          <StatTile
            label={t("orders_your_rating")}
            value={
              stats.avgRating !== null
                ? `${stats.avgRating.toFixed(1)} (${stats.totalReviews})`
                : "—"
            }
            icon={<Star size={16} />}
          />
        </div>
      )}

      <SegmentedToggle<"current" | "demands">
        options={[
          { value: "current", label: t("orders_current"), icon: <ClipboardList size={14} /> },
          { value: "demands", label: t("orders_raised_demands"), icon: <Package size={14} /> },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t("orders_title")}
        className="mb-6 max-w-md"
      />

      {toast && (
        <div className="mb-6 rounded-xl border border-[var(--color-sage)] bg-[var(--color-mint)] px-4 py-3 text-sm font-medium text-primary">
          {toast}
        </div>
      )}
      {error && (
        <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      {/* --------------------------------------------- Current orders */}
      {tab === "current" ? (
        currentOrders.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
            {t("orders_no_current")}
          </p>
        ) : (
          <div className="space-y-4">
            {currentOrders.map((order) => {
              const daysLeft = order.deadline
                ? daysBetween(new Date(), new Date(order.deadline))
                : null;
              const draft = logDrafts[order.id] ?? { note: "", image: null };
              return (
                <Card key={order.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-primary">
                        {order.status === "IN_PROGRESS" ? "In progress" : order.status}
                        <span className="text-gray-400">ORD-{order.id.slice(0, 6).toUpperCase()}</span>
                      </p>
                      <h3 className="text-lg font-bold text-gray-900">
                        {order.demand.quantity} × {order.demand.craftType}
                      </h3>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {order.demand.buyerName || "Anonymous buyer"}
                        {order.demand.location ? ` · ${order.demand.location}` : ""}
                      </p>
                      {order.demand.description && (
                        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
                          {order.demand.description}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      {order.negotiatedPrice ? (
                        <p className="font-sans text-lg font-black text-primary">
                          {formatRupees(order.negotiatedPrice)}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500">{priceRange(order.demand)}</p>
                      )}
                      {order.deadline && daysLeft !== null && (
                        <p
                          className={cn(
                            "mt-1 flex items-center gap-1 text-[11px] font-bold",
                            daysLeft < 3 ? "text-red-600" : "text-gray-500"
                          )}
                        >
                          <CalendarClock size={11} />
                          {t("orders_deadline")}: {shortDate(order.deadline)}
                          <span className="ml-1 font-normal">
                            ({t("orders_days_left").replace("{days}", String(Math.max(0, daysLeft)))})
                          </span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* ----------------- log composer ----------------- */}
                  <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <p className="mb-2 flex items-center gap-2 text-xs font-bold text-gray-700">
                      <MessageSquarePlus size={13} /> {t("orders_add_log")}
                    </p>
                    <textarea
                      rows={2}
                      value={draft.note}
                      onChange={(e) => setDraftNote(order.id, e.target.value)}
                      placeholder={t("orders_log_placeholder")}
                      className="w-full resize-y rounded-lg border border-gray-200 bg-white p-2.5 text-[13px] outline-none focus:border-primary"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="kg-press inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-500 hover:border-primary hover:text-primary">
                        <ImagePlus size={13} /> {t("orders_log_photo")}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => void setDraftImage(order.id, e.target.files?.[0] ?? null)}
                          className="hidden"
                        />
                      </label>
                      {draft.image && (
                        <div className="relative h-10 w-10 overflow-hidden rounded-lg border border-gray-200">
                          <Image src={draft.image} alt="" fill sizes="40px" unoptimized className="object-cover" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => addLog(order.id)}
                        disabled={busyId === order.id || (!draft.note.trim() && !draft.image)}
                        className={cn(
                          "kg-press ml-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
                          (busyId === order.id || (!draft.note.trim() && !draft.image)) &&
                            "cursor-not-allowed opacity-50"
                        )}
                      >
                        {busyId === order.id && <Loader2 size={12} className="animate-spin" />}
                        {t("orders_add_log")}
                      </button>
                    </div>
                  </div>

                  {/* --------- Mark as complete --------- */}
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => openComplete(order)}
                      className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[var(--color-sage)] bg-[var(--color-mint)] px-4 text-xs font-bold text-primary hover:bg-white"
                    >
                      <CheckCircle2 size={13} /> {t("mark_complete")}
                    </button>
                  </div>

                  {/* -------------------- log timeline --------------------- */}
                  {order.logs.length > 0 && (
                    <ol className="mt-5 space-y-3 border-l-2 border-gray-100 pl-4">
                      {order.logs.map((log) => (
                        <li key={log.id} className="relative">
                          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                            {shortDate(log.createdAt)}
                          </p>
                          {log.note && (
                            <p className="mt-0.5 text-[13px] leading-relaxed text-gray-700">
                              {log.note}
                            </p>
                          )}
                          {log.imageUrl && (
                            <div className="mt-2 relative h-24 w-24 overflow-hidden rounded-lg border border-gray-200">
                              <Image
                                src={log.imageUrl}
                                alt=""
                                fill
                                sizes="96px"
                                unoptimized={log.imageUrl.startsWith("data:")}
                                className="object-cover"
                              />
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              );
            })}
          </div>
        )
      ) : matching.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          {t("orders_no_demands")}
        </p>
      ) : (
        <div className="space-y-4">
          {matching.map((demand) => (
            <Card key={demand.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                    REQ-{demand.id.slice(0, 6).toUpperCase()} · {shortDate(demand.createdAt)}
                  </p>
                  <h3 className="text-lg font-bold text-gray-900">
                    {demand.quantity} × {demand.craftType}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {demand.buyerName || "Anonymous buyer"}
                    {demand.location ? (
                      <>
                        {" "}
                        <MapPin size={11} className="mb-0.5 ml-1 inline-block" /> {demand.location}
                      </>
                    ) : null}
                  </p>
                  {(demand.material || demand.color) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {demand.material && (
                        <span className="rounded-full bg-[var(--color-mint)] px-2.5 py-1 text-[11px] font-bold text-primary">
                          {demand.material}
                        </span>
                      )}
                      {demand.color && (
                        <span className="rounded-full bg-[var(--color-mint)] px-2.5 py-1 text-[11px] font-bold text-primary">
                          {demand.color}
                        </span>
                      )}
                    </div>
                  )}
                  {demand.description && (
                    <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
                      {demand.description}
                    </p>
                  )}
                </div>

                {demand.referenceImageUrl && (
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
                    <Image
                      src={demand.referenceImageUrl}
                      alt=""
                      fill
                      sizes="80px"
                      unoptimized={demand.referenceImageUrl.startsWith("data:")}
                      className="object-cover"
                    />
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
                <span className="text-xs font-medium text-gray-500">
                  Target: {priceRange(demand)}
                </span>

                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  <CalendarClock size={11} /> {t("deadline_label")}
                  <input
                    type="date"
                    min={isoDateInputValue(MIN_DEADLINE_DAYS)}
                    max={isoDateInputValue(MAX_DEADLINE_DAYS)}
                    value={getDeadlineDraft(demand.id)}
                    onChange={(e) => setDeadlineDraft(demand.id, e.target.value)}
                    className="ml-1 min-h-[36px] rounded-lg border border-gray-200 bg-white px-2 text-[12px] font-medium normal-case tracking-normal text-gray-700 outline-none focus:border-primary"
                  />
                </label>

                <div className="ml-auto flex flex-wrap gap-2">
                  {negotiatingFor === demand.id ? (
                    <>
                      <input
                        type="number"
                        min={1}
                        value={negotiatePrice}
                        onChange={(e) => setNegotiatePrice(e.target.value)}
                        placeholder={t("orders_negotiate_price")}
                        className="min-h-[40px] w-32 rounded-lg border border-gray-200 px-3 text-[13px] outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => acceptDemand(demand.id, Number(negotiatePrice) || 0)}
                        disabled={busyId === demand.id || !Number(negotiatePrice)}
                        className={cn(
                          "kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
                          (busyId === demand.id || !Number(negotiatePrice)) &&
                            "cursor-not-allowed opacity-50"
                        )}
                      >
                        {busyId === demand.id && <Loader2 size={12} className="animate-spin" />}
                        {t("orders_send_offer")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setNegotiatingFor(demand.id)}
                        className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-primary hover:bg-[var(--color-mint)]"
                      >
                        {t("orders_negotiate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => acceptDemand(demand.id)}
                        disabled={busyId === demand.id}
                        className={cn(
                          "kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
                          busyId === demand.id && "cursor-not-allowed opacity-50"
                        )}
                      >
                        {busyId === demand.id && <Loader2 size={12} className="animate-spin" />}
                        {t("orders_accept")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Complete-order modal. Rendered only while open so its file input never
          holds a dangling blob across order changes. */}
      {completingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{t("mark_complete")}</h3>
                <p className="mt-1 text-xs text-gray-500">
                  {completingOrder.demand.quantity} × {completingOrder.demand.craftType}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCompletingOrder(null);
                  setCompleteImage(null);
                }}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <p className="mb-3 text-sm text-gray-700">{t("upload_finished_photo")}</p>

            <label className="kg-press flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-sm font-bold text-gray-500 hover:border-primary hover:text-primary">
              <ImagePlus size={18} />
              {completeImage ? t("orders_log_photo") : t("upload_finished_photo")}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => void pickCompleteImage(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>

            {completeImage && (
              <div className="relative mx-auto mt-4 h-40 w-40 overflow-hidden rounded-xl border border-gray-200">
                <Image
                  src={completeImage}
                  alt=""
                  fill
                  sizes="160px"
                  unoptimized
                  className="object-cover"
                />
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCompletingOrder(null);
                  setCompleteImage(null);
                }}
                className="kg-press min-h-[44px] rounded-lg border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                {t("close_btn")}
              </button>
              <button
                type="button"
                onClick={submitComplete}
                disabled={!completeImage || completeBusy}
                className={cn(
                  "kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-bold text-white hover:bg-primary-dark",
                  (!completeImage || completeBusy) && "cursor-not-allowed opacity-50"
                )}
              >
                {completeBusy && <Loader2 size={14} className="animate-spin" />}
                <CheckCircle2 size={14} /> {t("mark_complete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
