"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Box,
  CalendarClock,
  Camera,
  CheckCircle2,
  ClipboardList,
  Hourglass,
  ImagePlus,
  Loader2,
  MapPin,
  MessageSquarePlus,
  Package,
  ScanLine,
  Star,
  TrendingUp,
  Truck,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Shell } from "@/components/ui/AppShell";
import { StatTile } from "@/components/ui/StatTile";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { QrScanModal } from "@/components/QrScanModal";
import { ReadyVerifyResult, type ReadyVerifyOutcome } from "@/components/ReadyVerifyResult";
import { prepareImage } from "@/lib/clientImagePrep";
import { formatRupees } from "@/lib/pricing";
import { ORDER_STATUS_KEYS } from "@/lib/orderStage";
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
 *
 * V9 replaced the old complete-modal — which accepted any photo and called the
 * job done — with a Ready → Pack → Dispatch chain whose first step is a real
 * verification against the piece's own QR patch.
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
  // V9 structured capture. Optional throughout: a demand posted before V9
  // carries none of it and every card below must still render.
  referenceImageUrls?: string[] | null;
  category?: string | null;
  productType?: string | null;
  sizeSpec?: string | null;
  customizationRequired?: boolean | null;
  customizationDetails?: string | null;
  requiredBy?: string | null;
  deliveryMode?: string | null;
  purchaseType?: string | null;
  additionalRequirements?: string | null;
  notes?: string | null;
  flexBudget?: string | null;
  flexColor?: string | null;
  flexMaterial?: string | null;
  flexDelivery?: string | null;
  flexDesign?: string | null;
}

interface OrderLog {
  id: string;
  note: string | null;
  imageUrl: string | null;
  createdAt: string;
}

type OrderStatusValue =
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "READY"
  | "PACKED"
  | "DISPATCHED"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED";

interface ArtisanOrderRow {
  id: string;
  status: OrderStatusValue;
  negotiatedPrice: number | null;
  deadline: string | null;
  createdAt: string;
  demand: DemandLite;
  logs: OrderLog[];
  completedImageUrl?: string | null;
  // ---- V9 lifecycle ----
  craftItemId: string | null;
  readyVerified: boolean;
  readyImageUrl: string | null;
  readyScanPatchId: string | null;
  readySimilarityScore: number | null;
  readyVerifiedAt: string | null;
  packedAt: string | null;
  dispatchedAt: string | null;
  courierName: string | null;
  trackingRef: string | null;
  lastLogAt: string | null;
  updateOverdue: boolean;
  // ---- V10 advance ----
  advanceStatus: string;
  advanceDueAmount: number | null;
  advancePaidAt: string | null;
  balanceDueAmount: number | null;
  /** True while production is blocked on the buyer's 40%. */
  awaitingAdvance: boolean;
}

const DEFAULT_DEADLINE_DAYS = 14;
const MIN_DEADLINE_DAYS = 3;
const MAX_DEADLINE_DAYS = 90;

/** The chain shown on every order card, in order. */
const STEPPER: { status: OrderStatusValue; icon: React.ReactNode }[] = [
  { status: "ACCEPTED", icon: <ClipboardList size={12} /> },
  { status: "IN_PROGRESS", icon: <MessageSquarePlus size={12} /> },
  { status: "READY", icon: <ScanLine size={12} /> },
  { status: "PACKED", icon: <Box size={12} /> },
  { status: "DISPATCHED", icon: <Truck size={12} /> },
  { status: "DELIVERED", icon: <CheckCircle2 size={12} /> },
];

/** How far along an order is, as an index into STEPPER. -1 for cancelled. */
function stepperIndex(order: ArtisanOrderRow): number {
  if (order.status === "CANCELLED") return -1;
  if (order.status === "COMPLETED" || order.status === "DELIVERED") return 5;
  if (order.dispatchedAt) return 4;
  if (order.packedAt) return 3;
  if (order.readyVerified) return 2;
  if (order.status === "IN_PROGRESS" || order.lastLogAt) return 1;
  return 0;
}

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

  /** Which order's Ready → Verify sheet is open. */
  const [readyOrder, setReadyOrder] = useState<ArtisanOrderRow | null>(null);
  const [readyPatchId, setReadyPatchId] = useState("");
  /** Set only when a QR supplied the code, so the API can cross-check it. */
  const [readyScannedPatchId, setReadyScannedPatchId] = useState<string | null>(null);
  const [readyImage, setReadyImage] = useState<string | null>(null);
  const [readyBusy, setReadyBusy] = useState(false);
  const [readyOutcome, setReadyOutcome] = useState<ReadyVerifyOutcome | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  /** Courier details, per order, for the Dispatch step. */
  const [dispatchDrafts, setDispatchDrafts] = useState<
    Record<string, { courierName: string; trackingRef: string; open: boolean }>
  >({});

  /** Finished-product photo, per order, for the final Complete step. */
  const [completeDrafts, setCompleteDrafts] = useState<Record<string, string>>({});

  /** Deep link from /artisan/market: ?tab=demands&demandId=<id>. */
  const [highlightDemandId, setHighlightDemandId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

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

  // Read the deep link off the URL in a deferred effect rather than via
  // useSearchParams, so this fully client page needs no Suspense boundary —
  // the same pattern /artisan/market and the buyer board already use.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") === "demands") setTab("demands");
      const demandId = params.get("demandId");
      if (demandId) setHighlightDemandId(demandId);
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  // Scroll the deep-linked demand into view once the list it lives in has
  // actually rendered. Guarded on `payload` because the ref is null until then.
  useEffect(() => {
    if (!highlightDemandId || !payload) return;
    const kickoff = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => clearTimeout(kickoff);
  }, [highlightDemandId, payload, tab]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const currentOrders = useMemo(
    () =>
      (payload?.orders ?? []).filter(
        (order) =>
          // DELIVERED joined COMPLETED and CANCELLED as terminal in V9. Without
          // it, an order the buyer has confirmed and paid for would sit in the
          // artisan's active list forever.
          order.status !== "COMPLETED" &&
          order.status !== "CANCELLED" &&
          order.status !== "DELIVERED"
      ),
    [payload]
  );

  const overdueOrders = useMemo(
    () => currentOrders.filter((order) => order.updateOverdue),
    [currentOrders]
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

  /* ------------------------------------------------------------------ */
  /* Ready → Verify                                                      */
  /* ------------------------------------------------------------------ */

  const openReady = (order: ArtisanOrderRow) => {
    setReadyOrder(order);
    setReadyPatchId("");
    setReadyScannedPatchId(null);
    setReadyImage(null);
    setReadyOutcome(null);
  };

  const closeReady = () => {
    setReadyOrder(null);
    setReadyPatchId("");
    setReadyScannedPatchId(null);
    setReadyImage(null);
    setReadyOutcome(null);
    setScannerOpen(false);
  };

  /** A hand-edited code is no longer a scanned one — drop the QR claim. */
  const editReadyPatch = (value: string) => {
    setReadyPatchId(value);
    setReadyScannedPatchId(null);
  };

  const onScannedPatchId = useCallback((patchId: string) => {
    setReadyPatchId(patchId);
    setReadyScannedPatchId(patchId);
  }, []);

  const onScannedPhoto = useCallback((dataUrl: string) => {
    setReadyImage(dataUrl);
  }, []);

  const pickReadyImage = async (file: File | null) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError(`"${file.name}" ${t("orders_file_too_large")}`);
      return;
    }
    setReadyImage(await prepareImage(file));
  };

  const submitReady = async () => {
    if (!readyOrder || !readyPatchId.trim() || !readyImage) return;
    setReadyBusy(true);
    try {
      const res = await fetch("/api/artisan/orders/verify-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: readyOrder.id,
          patchId: readyPatchId.trim(),
          scannedPatchId: readyScannedPatchId,
          readyImageBase64: readyImage,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        // A 4xx here is a real refusal — wrong patch, another artisan's piece,
        // a QR that disagrees — and the message says which. Shown in the sheet
        // rather than the page banner, where the artisan is actually looking.
        setReadyOutcome({
          passed: false,
          similarityScore: 0,
          threshold: 0,
          reasoning: data?.error || t("verification_failed"),
          scoredBy: null,
          patchId: readyPatchId.trim(),
        });
        return;
      }
      setReadyOutcome({
        passed: Boolean(data.passed),
        similarityScore: Number(data.similarityScore) || 0,
        threshold: Number(data.threshold) || 0,
        reasoning: typeof data.reasoning === "string" ? data.reasoning : "",
        scoredBy: data.scoredBy ?? null,
        patchId: readyPatchId.trim(),
      });
      if (data.passed) {
        setToast(t("ready_verify_passed_toast"));
        await load();
      }
    } finally {
      setReadyBusy(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Pack / Dispatch                                                     */
  /* ------------------------------------------------------------------ */

  const patchOrder = async (
    orderId: string,
    action: "pack" | "dispatch",
    extra: Record<string, string> = {}
  ) => {
    setBusyId(orderId);
    try {
      const res = await fetch("/api/artisan/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("orders_load_failed"));
        return;
      }
      setToast(action === "pack" ? t("orders_packed_toast") : t("orders_dispatched_toast"));
      setDispatchDrafts((prev) => ({
        ...prev,
        [orderId]: { courierName: "", trackingRef: "", open: false },
      }));
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const pickCompleteImage = async (orderId: string, file: File | null) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError(`"${file.name}" ${t("orders_file_too_large")}`);
      return;
    }
    // Downscaled BEFORE the setState, not inside the updater — an updater is a
    // plain function and cannot await.
    const dataUrl = await prepareImage(file);
    setCompleteDrafts((prev) => ({ ...prev, [orderId]: dataUrl }));
  };

  /**
   * Close a dispatched job.
   *
   * The API refuses this unless the order already passed the ready check, so
   * the old path — any 2 MB photo, straight to COMPLETED — is closed even
   * though the button looks the same.
   */
  const completeOrder = async (orderId: string) => {
    const image = completeDrafts[orderId];
    if (!image) return;
    setBusyId(orderId);
    try {
      const res = await fetch("/api/artisan/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, action: "complete", completedImageUrl: image }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("orders_load_failed"));
        return;
      }
      setToast(t("order_completed_toast"));
      setCompleteDrafts((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      await load();
    } finally {
      setBusyId(null);
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
      setError(`"${file.name}" ${t("orders_file_too_large")}`);
      return;
    }
    const dataUrl = await prepareImage(file);
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

      {/* Persistent, non-blocking: an artisan with three quiet orders should see
          it every visit until they post, but it must never sit between them and
          the page. */}
      {overdueOrders.length > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-800" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900">{t("orders_overdue_title")}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
              {t("orders_overdue_body").replace("{count}", String(overdueOrders.length))}
            </p>
          </div>
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
              const reached = stepperIndex(order);
              const dispatchDraft =
                dispatchDrafts[order.id] ?? { courierName: "", trackingRef: "", open: false };
              const completeDraft = completeDrafts[order.id] ?? null;

              return (
                <Card key={order.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-primary">
                        {t(ORDER_STATUS_KEYS[order.status] ?? "order_status_accepted")}
                        <span className="text-gray-400">ORD-{order.id.slice(0, 6).toUpperCase()}</span>
                        {order.updateOverdue && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                            {t("orders_overdue_pill")}
                          </span>
                        )}
                      </p>
                      <h3 className="text-lg font-bold text-gray-900">
                        {order.demand.quantity} × {order.demand.productType || order.demand.craftType}
                      </h3>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {order.demand.buyerName || t("anonymous_buyer")}
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

                  {/* ----------------- lifecycle stepper ----------------- */}
                  <ol className="mt-5 flex items-start justify-between gap-1">
                    {STEPPER.map((step, index) => {
                      const done = index < reached;
                      const active = index === reached;
                      return (
                        <li
                          key={step.status}
                          className="relative flex min-w-0 flex-1 flex-col items-center"
                        >
                          {index > 0 && (
                            <span
                              aria-hidden
                              className={cn(
                                "absolute right-1/2 top-[11px] h-[2px] w-full",
                                index <= reached ? "bg-primary" : "bg-gray-200"
                              )}
                            />
                          )}
                          <span
                            className={cn(
                              "relative z-10 flex h-6 w-6 items-center justify-center rounded-full border",
                              done && "border-transparent bg-primary text-white",
                              active && "border-primary bg-[var(--color-mint)] text-primary",
                              !done && !active && "border-gray-200 bg-white text-gray-300"
                            )}
                          >
                            {step.icon}
                          </span>
                          <span
                            className={cn(
                              "mt-1.5 text-center text-[9px] font-bold uppercase leading-tight tracking-wider",
                              index <= reached ? "text-gray-800" : "text-gray-400"
                            )}
                          >
                            {t(ORDER_STATUS_KEYS[step.status])}
                          </span>
                        </li>
                      );
                    })}
                  </ol>

                  {/* The buyer has not paid the 40% yet. A waiting state, not
                      an error: the artisan has done nothing wrong, and the
                      controls below would only return a 409 anyway. */}
                  {order.awaitingAdvance ? (
                    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
                        <Hourglass size={15} className="text-gray-500" />
                        {t("advance_waiting_title")}
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-gray-600">
                        {order.advanceDueAmount !== null
                          ? t("advance_waiting_body").replace(
                              "{amount}",
                              formatRupees(order.advanceDueAmount)
                            )
                          : t("advance_waiting_body_no_amount")}
                      </p>
                    </div>
                  ) : (
                  <>
                  {/* ----------------- log composer ----------------- */}
                  <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <p className="mb-2 flex items-center gap-2 text-xs font-bold text-gray-700">
                      <MessageSquarePlus size={13} /> {t("orders_add_log")}
                    </p>
                    <textarea
                      rows={2}
                      aria-label={t("orders_add_log")}
                      value={draft.note}
                      onChange={(e) => setDraftNote(order.id, e.target.value)}
                      placeholder={t("orders_log_placeholder")}
                      className="w-full resize-y rounded-lg border border-gray-200 bg-white p-2.5 text-[13px] outline-none focus:border-primary"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="kg-press inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-500 hover:border-primary hover:text-primary">
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
                          "kg-press ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
                          (busyId === order.id || (!draft.note.trim() && !draft.image)) &&
                            "cursor-not-allowed opacity-50"
                        )}
                      >
                        {busyId === order.id && <Loader2 size={12} className="animate-spin" />}
                        {t("orders_add_log")}
                      </button>
                    </div>
                  </div>

                  {/* --------- Ready → Pack → Dispatch --------- */}
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    {order.readyVerified && order.readySimilarityScore !== null && (
                      <span className="mr-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--color-mint)] px-3 py-1 text-[11px] font-bold text-primary">
                        <CheckCircle2 size={12} />
                        {t("ready_verified_at")} {Math.round(order.readySimilarityScore)}%
                      </span>
                    )}

                    {!order.readyVerified ? (
                      <button
                        type="button"
                        onClick={() => openReady(order)}
                        className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--color-sage)] bg-[var(--color-mint)] px-4 text-xs font-bold text-primary hover:bg-white"
                      >
                        <ScanLine size={13} /> {t("orders_mark_ready")}
                      </button>
                    ) : !order.packedAt ? (
                      <button
                        type="button"
                        onClick={() => void patchOrder(order.id, "pack")}
                        disabled={busyId === order.id}
                        className={cn(
                          "kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
                          busyId === order.id && "cursor-not-allowed opacity-50"
                        )}
                      >
                        {busyId === order.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Box size={13} />
                        )}
                        {t("orders_mark_packed")}
                      </button>
                    ) : !order.dispatchedAt ? (
                      dispatchDraft.open ? (
                        <div className="flex w-full flex-wrap items-end gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
                          <label className="min-w-[140px] flex-1">
                            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500">
                              {t("orders_courier")}
                            </span>
                            <input
                              className="min-h-[40px] w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-primary"
                              value={dispatchDraft.courierName}
                              onChange={(e) =>
                                setDispatchDrafts((prev) => ({
                                  ...prev,
                                  [order.id]: { ...dispatchDraft, courierName: e.target.value },
                                }))
                              }
                              placeholder={t("orders_courier_placeholder")}
                            />
                          </label>
                          <label className="min-w-[140px] flex-1">
                            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500">
                              {t("orders_tracking")}
                            </span>
                            <input
                              className="min-h-[40px] w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-primary"
                              value={dispatchDraft.trackingRef}
                              onChange={(e) =>
                                setDispatchDrafts((prev) => ({
                                  ...prev,
                                  [order.id]: { ...dispatchDraft, trackingRef: e.target.value },
                                }))
                              }
                              placeholder={t("orders_tracking_placeholder")}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              void patchOrder(order.id, "dispatch", {
                                courierName: dispatchDraft.courierName,
                                trackingRef: dispatchDraft.trackingRef,
                              })
                            }
                            disabled={busyId === order.id}
                            className={cn(
                              "kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
                              busyId === order.id && "cursor-not-allowed opacity-50"
                            )}
                          >
                            {busyId === order.id && <Loader2 size={12} className="animate-spin" />}
                            <Truck size={13} /> {t("orders_confirm_dispatch")}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setDispatchDrafts((prev) => ({
                              ...prev,
                              [order.id]: { ...dispatchDraft, open: true },
                            }))
                          }
                          className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark"
                        >
                          <Truck size={13} /> {t("orders_mark_dispatched")}
                        </button>
                      )
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-gray-500">
                          <Truck size={12} />
                          {t("orders_dispatched_on")} {shortDate(order.dispatchedAt)}
                          {order.courierName ? ` · ${order.courierName}` : ""}
                          {order.trackingRef ? ` · ${order.trackingRef}` : ""}
                        </span>

                        {/* Closing the job. The photo is still required — a
                            completion claim without one is what caused the
                            buyer trust problem this flow exists to fix — but it
                            is no longer the ONLY check: the API refuses this
                            unless the piece already passed the ready
                            verification above. */}
                        {completeDraft ? (
                          <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
                            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-gray-200">
                              <Image
                                src={completeDraft}
                                alt=""
                                fill
                                sizes="48px"
                                unoptimized
                                className="object-cover"
                              />
                            </div>
                            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-gray-500">
                              {t("orders_complete_hint")}
                            </p>
                            <button
                              type="button"
                              onClick={() => void completeOrder(order.id)}
                              disabled={busyId === order.id}
                              className={cn(
                                "kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
                                busyId === order.id && "cursor-not-allowed opacity-50"
                              )}
                            >
                              {busyId === order.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <CheckCircle2 size={13} />
                              )}
                              {t("mark_complete")}
                            </button>
                          </div>
                        ) : (
                          <label className="kg-press inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--color-sage)] bg-[var(--color-mint)] px-4 text-xs font-bold text-primary hover:bg-white">
                            <CheckCircle2 size={13} /> {t("mark_complete")}
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) =>
                                void pickCompleteImage(order.id, e.target.files?.[0] ?? null)
                              }
                              className="hidden"
                            />
                          </label>
                        )}
                      </>
                    )}
                  </div>
                  </>
                  )}

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
                                unoptimized={log.imageUrl.startsWith("data:") || log.imageUrl.startsWith("/api/")}
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
          {matching.map((demand) => {
            const highlighted = demand.id === highlightDemandId;
            const gallery =
              demand.referenceImageUrls && demand.referenceImageUrls.length > 0
                ? demand.referenceImageUrls
                : [demand.referenceImageUrl].filter((u): u is string => Boolean(u));
            const flexible: string[] = [];
            if (demand.flexBudget === "FLEXIBLE") flexible.push(t("demand_flex_budget"));
            if (demand.flexColor === "FLEXIBLE") flexible.push(t("demand_flex_color"));
            if (demand.flexMaterial === "FLEXIBLE") flexible.push(t("demand_flex_material"));
            if (demand.flexDelivery === "FLEXIBLE") flexible.push(t("demand_flex_delivery"));
            if (demand.flexDesign === "SIMILAR") flexible.push(t("demand_flex_design"));

            return (
              <div key={demand.id} ref={highlighted ? highlightRef : undefined}>
                <Card
                  className={cn(
                    "p-5 transition-colors",
                    highlighted && "border-primary ring-2 ring-primary/20"
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                        REQ-{demand.id.slice(0, 6).toUpperCase()} · {shortDate(demand.createdAt)}
                      </p>
                      <h3 className="text-lg font-bold text-gray-900">
                        {demand.quantity} × {demand.productType || demand.craftType}
                      </h3>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {demand.buyerName || t("anonymous_buyer")}
                        {demand.location ? (
                          <>
                            {" "}
                            <MapPin size={11} className="mb-0.5 ml-1 inline-block" /> {demand.location}
                          </>
                        ) : null}
                      </p>

                      {/* Everything the buyer specified, BEFORE the artisan
                          commits — which is the whole point of the richer
                          capture. */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {[
                          demand.category,
                          demand.material,
                          demand.color,
                          demand.sizeSpec,
                          demand.purchaseType && demand.purchaseType !== "INDIVIDUAL"
                            ? demand.purchaseType
                            : null,
                          demand.deliveryMode === "PICKUP" ? t("demand_delivery_pickup") : null,
                        ]
                          .filter((v): v is string => Boolean(v))
                          .map((chip) => (
                            <span
                              key={chip}
                              className="rounded-full bg-[var(--color-mint)] px-2.5 py-1 text-[11px] font-bold text-primary"
                            >
                              {chip}
                            </span>
                          ))}
                      </div>

                      {demand.requiredBy && (
                        <p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-gray-600">
                          <CalendarClock size={11} /> {t("demand_when_needed")}:{" "}
                          {shortDate(demand.requiredBy)}
                        </p>
                      )}

                      {demand.description && (
                        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
                          {demand.description}
                        </p>
                      )}

                      {demand.customizationRequired && (
                        <div className="mt-2 rounded-lg border border-[var(--color-sage)] bg-[var(--color-mint)] p-2.5">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
                            {t("demand_customization_required")}
                          </p>
                          {demand.customizationDetails && (
                            <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-primary/85">
                              {demand.customizationDetails}
                            </p>
                          )}
                        </div>
                      )}

                      {flexible.length > 0 && (
                        <p className="mt-2 text-[11px] text-gray-500">
                          <span className="font-bold uppercase tracking-wider">
                            {t("demand_flex_heading")}:
                          </span>{" "}
                          {flexible.join(" · ")}
                        </p>
                      )}

                      {(demand.additionalRequirements || demand.notes) && (
                        <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-gray-600">
                          {demand.additionalRequirements || demand.notes}
                        </p>
                      )}
                    </div>

                    {gallery.length > 0 && (
                      <div className="flex shrink-0 gap-1.5">
                        {gallery.slice(0, 2).map((src, index) => (
                          <div
                            key={`${index}-${src.slice(-12)}`}
                            className="relative h-20 w-20 overflow-hidden rounded-xl border border-gray-200 bg-gray-100"
                          >
                            <Image
                              src={src}
                              alt=""
                              fill
                              sizes="80px"
                              unoptimized={src.startsWith("data:") || src.startsWith("/api/")}
                              className="object-cover"
                            />
                            {index === 1 && gallery.length > 2 && (
                              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-bold text-white">
                                +{gallery.length - 2}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
                    <span className="text-xs font-medium text-gray-500">
                      {t("target")}: {priceRange(demand)}
                    </span>

                    <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                      <CalendarClock size={11} /> {t("deadline_label")}
                      <input
                        type="date"
                        min={isoDateInputValue(MIN_DEADLINE_DAYS)}
                        max={isoDateInputValue(MAX_DEADLINE_DAYS)}
                        value={getDeadlineDraft(demand.id)}
                        onChange={(e) => setDeadlineDraft(demand.id, e.target.value)}
                        className="ml-1 min-h-[40px] rounded-lg border border-gray-200 bg-white px-2 text-[12px] font-medium normal-case tracking-normal text-gray-700 outline-none focus:border-primary"
                      />
                    </label>

                    <div className="ml-auto flex flex-wrap gap-2">
                      {negotiatingFor === demand.id ? (
                        <>
                          <input
                            type="number"
                            min={1}
                            aria-label={t("orders_negotiate_price")}
                            value={negotiatePrice}
                            onChange={(e) => setNegotiatePrice(e.target.value)}
                            placeholder={t("orders_negotiate_price")}
                            className="min-h-[44px] w-32 rounded-lg border border-gray-200 px-3 text-[13px] outline-none focus:border-primary"
                          />
                          <button
                            type="button"
                            onClick={() => acceptDemand(demand.id, Number(negotiatePrice) || 0)}
                            disabled={busyId === demand.id || !Number(negotiatePrice)}
                            className={cn(
                              "kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
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
                            className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-primary hover:bg-[var(--color-mint)]"
                          >
                            {t("orders_negotiate")}
                          </button>
                          <button
                            type="button"
                            onClick={() => acceptDemand(demand.id)}
                            disabled={busyId === demand.id}
                            className={cn(
                              "kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
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
              </div>
            );
          })}
        </div>
      )}

      {/* Ready → Verify sheet. Rendered only while open so its file input never
          holds a dangling blob across order changes, and so the camera sheet it
          mounts is never running for a card nobody is looking at. */}
      {readyOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl max-h-[90vh]">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900">{t("orders_mark_ready")}</h3>
                <p className="mt-1 truncate text-xs text-gray-500">
                  {readyOrder.demand.quantity} ×{" "}
                  {readyOrder.demand.productType || readyOrder.demand.craftType}
                </p>
              </div>
              <button
                type="button"
                onClick={closeReady}
                className="text-gray-400 hover:text-gray-700"
                aria-label={t("close_btn")}
              >
                <X size={18} />
              </button>
            </div>

            {readyOutcome ? (
              <>
                <ReadyVerifyResult result={readyOutcome} t={t} />
                <div className="mt-5 flex justify-end gap-2">
                  {!readyOutcome.passed && (
                    <button
                      type="button"
                      onClick={() => setReadyOutcome(null)}
                      className="kg-press min-h-[44px] rounded-lg border border-gray-200 bg-white px-4 text-sm font-bold text-primary hover:bg-[var(--color-mint)]"
                    >
                      {t("ready_verify_retry")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closeReady}
                    className="kg-press min-h-[44px] rounded-lg bg-primary px-5 text-sm font-bold text-white hover:bg-primary-dark"
                  >
                    {t("close_btn")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-4 text-sm leading-relaxed text-gray-700">
                  {t("ready_verify_lede")}
                </p>

                <label
                  className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-gray-500"
                  htmlFor="ready-patch"
                >
                  {t("enter_patch_id")}
                </label>
                <div className="flex gap-2">
                  <input
                    id="ready-patch"
                    type="text"
                    value={readyPatchId}
                    onChange={(e) => editReadyPatch(e.target.value)}
                    placeholder="P-XXXXXX"
                    className="min-h-[44px] flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    title={t("scan_qr_code")}
                    aria-label={t("scan_qr_code")}
                    className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[var(--color-mint)] px-3 text-xs font-bold text-primary hover:bg-[var(--color-sage)]/40"
                  >
                    <Camera size={16} /> {t("scan_qr_code")}
                  </button>
                </div>
                {readyScannedPatchId && (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-primary">
                    <CheckCircle2 size={12} /> {t("scanned_via_qr")}
                  </p>
                )}

                <label className="kg-press mt-4 flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm font-bold text-gray-500 hover:border-primary hover:text-primary">
                  <ImagePlus size={16} />
                  {readyImage ? `${t("upload_finished_photo")} ✓` : t("upload_finished_photo")}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => void pickReadyImage(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                </label>

                {readyImage && (
                  <div className="relative mx-auto mt-4 h-36 w-36 overflow-hidden rounded-xl border border-gray-200">
                    <Image
                      src={readyImage}
                      alt=""
                      fill
                      sizes="144px"
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeReady}
                    className="kg-press min-h-[44px] rounded-lg border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50"
                  >
                    {t("close_btn")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitReady()}
                    disabled={!readyPatchId.trim() || !readyImage || readyBusy}
                    className={cn(
                      "kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-bold text-white hover:bg-primary-dark",
                      (!readyPatchId.trim() || !readyImage || readyBusy) &&
                        "cursor-not-allowed opacity-50"
                    )}
                  >
                    {readyBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ScanLine size={14} />
                    )}
                    {t("orders_mark_ready")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* The same camera sheet the buyer's verify flow uses: it decodes the
          patch QR and captures the finished photo on one surface, which is what
          a phone in a workshop can actually manage. */}
      <QrScanModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onPatchId={onScannedPatchId}
        onPhoto={onScannedPhoto}
        t={t}
      />
    </Shell>
  );
}
