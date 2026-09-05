"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  ClipboardList,
  ImagePlus,
  Loader2,
  Package,
  ShieldCheck,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { OrderTimeline, type TrackPayload } from "@/components/ui/OrderTimeline";
import { QrScanModal } from "@/components/QrScanModal";
import {
  BuyerVerifyResult,
  type BuyerVerifyResultShape,
} from "@/components/BuyerVerifyResult";
import { MAX_UPLOAD_BYTES, readFileAsDataUrl } from "@/lib/fileToDataUrl";
import { prepareImage } from "@/lib/clientImagePrep";
import { ORDER_STAGE_KEYS, stageIndex, type OrderStage } from "@/lib/orderStage";
import { formatRupees } from "@/lib/pricing";
import { useLanguage } from "@/lib/translations";

/**
 * The buyer's own paid orders, with Flipkart/Amazon-style tracking.
 *
 * A superset of `TrackPayload`, so each order is handed straight to
 * `OrderTimeline` — the same component the demand board already uses — rather
 * than growing a second timeline that could drift from it.
 */
export interface DailyUpdate {
  id: string;
  note: string | null;
  imageUrl: string | null;
  createdAt: string;
}

/** A dispute this buyer raised against a piece in this order. */
export interface OrderTicket {
  id: string;
  /** OPEN | RESOLVED_GUILTY | RESOLVED_NOT_GUILTY | DISCARDED */
  status: string;
  adminNote: string | null;
  resolvedAt: string | null;
}

export interface BuyerOrder extends TrackPayload {
  key: string;
  demandId: string | null;
  craftType: string;
  artisanName: string;
  image: string | null;
  status: string;
  escrowStatus: string | null;
  productionStage: string | null;
  paidAt: string | null;
  /** Sum of the DISPLAYED prices. Never the ₹1 actually charged. */
  amountPaid: number;
  /** What Razorpay really took, in paise, so the demo charge stays visible. */
  chargedPaise: number;

  // ---- Artisan-side lifecycle (WI2 / WI6) -------------------------------
  artisanDeadline: string | null;
  artisanOrderStatus: string | null;
  completedImageUrl: string | null;
  dailyUpdates: DailyUpdate[];
  /** On-screen agreed price credited on delivery — V8. */
  artisanSettledAmount: number | null;
  artisanSettledAt: string | null;

  // ---- Buyer-side delivery + verification (WI2) -------------------------
  deliveredAt: string | null;
  deliveryVerified: boolean;
  deliveryVerifiedAt: string | null;
  deliveryScanPatchId: string | null;
  deliveryScanScore: number | null;

  /** Disputes this buyer raised against pieces in this order. */
  tickets: OrderTicket[];
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

function orderDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * The order's headline stage: the LEAST advanced piece in it.
 *
 * A bulk order is only as far along as its slowest piece — telling a buyer
 * their request is "dispatched" because one of forty sarees shipped would be
 * a lie by rounding.
 */
function headlineStage(order: BuyerOrder): OrderStage | null {
  if (order.items.length === 0) return null;
  return order.items.reduce<OrderStage>(
    (slowest, item) => (stageIndex(item.stage) < stageIndex(slowest) ? item.stage : slowest),
    order.items[0].stage
  );
}

export function BuyerOrders({
  buyerName,
  onCount,
}: {
  buyerName: string;
  /** Reports how many orders were found, so the page can title the tab. */
  onCount?: (count: number) => void;
}) {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<BuyerOrder[] | null>(null);
  const [error, setError] = useState("");

  /** Per-demand busy flag for the delivered click. */
  const [deliveringId, setDeliveringId] = useState<string | null>(null);
  /** Per-demand verification form state. */
  const [verifyDrafts, setVerifyDrafts] = useState<
    Record<string, { patchId: string; image: string | null; busy: boolean }>
  >({});
  /** Last verification response per demand — shows the 3-check card inline. */
  const [verifyResults, setVerifyResults] = useState<
    Record<string, BuyerVerifyResultShape>
  >({});

  /** Which order's inline scanner sheet is open, if any. */
  const [scannerFor, setScannerFor] = useState<string | null>(null);
  /** Patch ids that arrived from a QR, so the API can run the qrValid check. */
  const [scannedPatchIds, setScannedPatchIds] = useState<Record<string, string>>({});

  const setVerifyPatch = (demandId: string, patchId: string) => {
    setVerifyDrafts((prev) => ({
      ...prev,
      [demandId]: {
        patchId,
        image: prev[demandId]?.image ?? null,
        busy: prev[demandId]?.busy ?? false,
      },
    }));
    // A hand-edited code is no longer a scanned one — drop the QR claim so the
    // fourth check is not asserted against a value the buyer typed over.
    setScannedPatchIds((prev) => {
      if (!(demandId in prev)) return prev;
      const next = { ...prev };
      delete next[demandId];
      return next;
    });
  };

  /** A QR decoded inside the sheet: fill the code AND remember it was scanned. */
  const onScannedPatchId = useCallback((demandId: string, scanned: string) => {
    setVerifyDrafts((prev) => ({
      ...prev,
      [demandId]: {
        patchId: scanned,
        image: prev[demandId]?.image ?? null,
        busy: prev[demandId]?.busy ?? false,
      },
    }));
    setScannedPatchIds((prev) => ({ ...prev, [demandId]: scanned }));
  }, []);

  /** A photo captured or picked inside the sheet. */
  const onScannedPhoto = useCallback((demandId: string, dataUrl: string) => {
    setVerifyDrafts((prev) => ({
      ...prev,
      [demandId]: {
        patchId: prev[demandId]?.patchId ?? "",
        image: dataUrl,
        busy: prev[demandId]?.busy ?? false,
      },
    }));
  }, []);

  const setVerifyImage = async (demandId: string, file: File | null) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`"${file.name}" is over 2 MB.`);
      return;
    }
    // Downscaled before upload — see src/lib/clientImagePrep.ts.
    const dataUrl = await prepareImage(file);
    setVerifyDrafts((prev) => ({
      ...prev,
      [demandId]: {
        patchId: prev[demandId]?.patchId ?? "",
        image: dataUrl,
        busy: prev[demandId]?.busy ?? false,
      },
    }));
  };

  // Held in a ref so an inline arrow from the parent cannot re-trigger the
  // fetch on every render. Assigned in an effect rather than during render,
  // which React forbids.
  const onCountRef = useRef(onCount);
  useEffect(() => {
    onCountRef.current = onCount;
  }, [onCount]);

  const load = useCallback(async () => {
    if (!buyerName.trim()) {
      setOrders([]);
      onCountRef.current?.(0);
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/buyer/orders?buyer=${encodeURIComponent(buyerName)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data?.success && Array.isArray(data.orders)) {
        setOrders(data.orders as BuyerOrder[]);
        onCountRef.current?.(data.orders.length);
      } else {
        setError(t("orders_load_failed"));
        setOrders([]);
        onCountRef.current?.(0);
      }
    } catch (e) {
      console.error("Buyer orders failed:", e);
      setError(t("orders_load_failed"));
      setOrders([]);
      onCountRef.current?.(0);
    }
  }, [buyerName, t]);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the rest of this page uses.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const markDelivered = async (demandId: string) => {
    setDeliveringId(demandId);
    try {
      const res = await fetch("/api/buyer/orders/delivered", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demandId, buyerName }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("orders_load_failed"));
        return;
      }
      await load();
    } finally {
      setDeliveringId(null);
    }
  };

  const submitVerify = async (demandId: string) => {
    const draft = verifyDrafts[demandId];
    if (!draft || !draft.patchId.trim() || !draft.image) return;
    setVerifyDrafts((prev) => ({
      ...prev,
      [demandId]: { ...draft, busy: true },
    }));
    try {
      const res = await fetch("/api/buyer/orders/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demandId,
          buyerName,
          patchId: draft.patchId.trim(),
          scannedImageBase64: draft.image,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("verification_failed"));
        return;
      }
      // This endpoint is the demand-scoped one and does not run the QR check;
      // a scan started here still records that a QR supplied the code, and the
      // shared card simply omits the row when nothing was scanned.
      const scanned = scannedPatchIds[demandId];
      setVerifyResults((prev) => ({
        ...prev,
        [demandId]: {
          patchIdValid: Boolean(data.patchIdValid),
          productMatch: Boolean(data.productMatch),
          artisanMatch: Boolean(data.artisanMatch),
          qrValid:
            typeof data.qrValid === "boolean"
              ? data.qrValid
              : !scanned || scanned === draft.patchId.trim(),
          qrChecked: typeof data.qrChecked === "boolean" ? data.qrChecked : Boolean(scanned),
          similarityScore: Number(data.similarityScore) || 0,
          reasoning: typeof data.reasoning === "string" ? data.reasoning : "",
          artisanName: typeof data.artisanName === "string" ? data.artisanName : null,
        },
      }));
      await load();
    } finally {
      setVerifyDrafts((prev) => ({
        ...prev,
        [demandId]: { ...(prev[demandId] || { patchId: "", image: null }), busy: false },
      }));
    }
  };

  if (orders === null) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-10 text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-gray-600">{error}</p>
        <button
          onClick={() => void load()}
          className="kg-press mt-4 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-5 text-[13px] font-bold text-primary hover:bg-[var(--color-mint)]"
        >
          {t("track_order")}
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-mint)] text-primary">
          <ShoppingBag size={24} />
        </span>
        <h3 className="kg-display text-[22px] leading-tight text-gray-900">
          {t("orders_empty_title")}
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
          {t("orders_empty_body")}
        </p>
        <Link
          href="/marketplace"
          className="kg-press mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-6 text-[13px] font-semibold text-white hover:bg-primary-dark"
        >
          {t("orders_browse_marketplace")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {orders.map((order) => {
        const stage = headlineStage(order);
        const bulk = order.requested > 1;

        return (
          <div
            key={order.key}
            className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-card"
          >
            <div className="flex flex-wrap items-start gap-4 border-b border-gray-100 p-5 sm:p-6">
              {order.image ? (
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                  <Image
                    src={order.image}
                    alt=""
                    fill
                    sizes="64px"
                    unoptimized={order.image.startsWith("data:") || order.image.startsWith("/api/")}
                    className="object-cover"
                  />
                </div>
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
                  <Package size={22} />
                </span>
              )}

              <div className="min-w-0 flex-1 basis-[55%]">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {stage && (
                    <span className="rounded-full bg-[var(--color-mint)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                      {t(ORDER_STAGE_KEYS[stage])}
                    </span>
                  )}
                  <span className="font-mono text-xs font-bold text-gray-500">
                    ORD-{order.key.split(":")[1].slice(0, 6).toUpperCase()}
                  </span>
                  {order.demandId && (
                    <span className="rounded-full bg-[var(--color-pill)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                      {t("order_for_demand")} REQ-{order.demandId.slice(0, 6).toUpperCase()}
                    </span>
                  )}
                </div>

                <h3 className="text-lg font-bold leading-tight text-gray-900">
                  {bulk ? `${order.requested} × ` : ""}
                  {order.craftType}
                </h3>
                <p className="mt-0.5 truncate text-sm text-gray-500">{order.artisanName}</p>
              </div>

              {/* Full width on a phone: sharing a 360px row with the title
                  squeezed both into four-line wraps. */}
              <div className="w-full shrink-0 border-t border-gray-100 pt-3 sm:w-auto sm:border-0 sm:pt-0 sm:text-right">
                <p className="kg-label font-medium text-gray-500">{t("order_amount_paid")}</p>
                {/* font-sans: the serif face has no rupee glyph. */}
                <p className="font-sans text-xl font-black text-primary">
                  {formatRupees(order.amountPaid)}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-gray-400">
                  {t("order_placed_on")} {orderDate(order.paidAt)}
                </p>

                {/* Top-level Scan & verify. Starts the flow without making the
                    buyer find the sub-form or type a patch id first. */}
                <Link
                  href={
                    order.demandId
                      ? `/buyer/verify?demandId=${encodeURIComponent(order.demandId)}`
                      : "/buyer/verify"
                  }
                  title={t("scan_and_verify")}
                  aria-label={t("scan_and_verify")}
                  className="kg-press mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[var(--color-mint)] px-4 text-xs font-bold text-primary hover:bg-[var(--color-sage)]/40"
                >
                  <Camera size={16} /> {t("scan_and_verify")}
                </Link>
              </div>
            </div>

            <div className="bg-gray-50 p-5 sm:p-6">
              {/* My Orders — the buyer bought these pieces, so they may see
                  each piece's private patch ID here (and nowhere public). */}
              <OrderTimeline data={order} showPatchId />
              <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
                {t("order_charged_note")}
              </p>

              {/* -------------------- WI6: Live Production Updates -------------------- */}
              {order.dailyUpdates && order.dailyUpdates.length > 0 && (
                <div className="mt-5 border-t border-gray-100 pt-5">
                  <h4 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                    <ClipboardList size={13} />
                    {t("live_production_updates")}
                  </h4>

                  {order.fulfilled > 0 && order.requested > 0 && (
                    <div className="mb-4">
                      <div className="mb-1.5 flex justify-between text-xs text-gray-600">
                        <span>
                          {order.fulfilled}/{order.requested} {t("units_completed")}
                        </span>
                        <span>{Math.round((order.fulfilled / order.requested) * 100)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${(order.fulfilled / order.requested) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="relative space-y-3 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
                    {order.dailyUpdates.map((update) => (
                      <div key={update.id} className="relative flex gap-3 pl-7">
                        <div className="absolute left-0 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[var(--color-mint)]">
                          <div className="h-2 w-2 rounded-full bg-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <time className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            {shortDate(update.createdAt)}
                          </time>
                          {update.note && (
                            <p className="mt-0.5 text-sm leading-relaxed text-gray-700">
                              {update.note}
                            </p>
                          )}
                          {update.imageUrl && (
                            <div className="relative mt-2 h-24 w-24 overflow-hidden rounded-lg bg-gray-100">
                              <Image
                                src={update.imageUrl}
                                alt=""
                                fill
                                sizes="96px"
                                unoptimized={update.imageUrl.startsWith("data:") || update.imageUrl.startsWith("/api/")}
                                className="object-cover"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(!order.dailyUpdates || order.dailyUpdates.length === 0) &&
                order.artisanOrderStatus === "ACCEPTED" && (
                  <div className="mt-5 border-t border-gray-100 pt-5">
                    <p className="py-4 text-center text-sm italic text-gray-500">
                      {t("production_updates_empty")}
                    </p>
                  </div>
                )}

              {/* V8 — Once the buyer marks delivered, the artisan is credited
                  the on-screen agreed price. Subtle note so the buyer sees
                  the payment landed. */}
              {order.artisanSettledAmount && order.artisanSettledAt && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--color-sage)] bg-[var(--color-mint)] px-3 py-2 text-[12px] text-primary">
                  <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                  <span>
                    <span className="font-bold">{t("artisan_paid_label")}</span>{" "}
                    {formatRupees(order.artisanSettledAmount)} — {t("artisan_paid_note")}
                  </span>
                </div>
              )}

              {/* -------------------- WI2: Deliver + Verify -------------------- */}
              {order.demandId &&
                (order.productionStage === "DISPATCHED" ||
                  order.productionStage === "DELIVERED" ||
                  order.artisanOrderStatus === "COMPLETED") && (
                  <div className="mt-5 border-t border-gray-100 pt-5">
                    {!order.deliveredAt ? (
                      <button
                        type="button"
                        onClick={() => order.demandId && markDelivered(order.demandId)}
                        disabled={deliveringId === order.demandId}
                        className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deliveringId === order.demandId ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Truck size={14} />
                        )}
                        {t("mark_delivered")}
                      </button>
                    ) : order.deliveryVerified &&
                      verifyResults[order.demandId] === undefined ? (
                      <BuyerVerifyResult
                        result={{
                          patchIdValid: true,
                          productMatch: true,
                          artisanMatch: true,
                          qrValid: true,
                          qrChecked: false,
                          similarityScore: order.deliveryScanScore ?? 0,
                          reasoning: "",
                          artisanName: order.artisanName,
                        }}
                        patchId={order.deliveryScanPatchId ?? ""}
                        t={t}
                      />
                    ) : verifyResults[order.demandId] ? (
                      <BuyerVerifyResult
                        result={verifyResults[order.demandId]}
                        patchId={verifyDrafts[order.demandId]?.patchId ?? ""}
                        t={t}
                      />
                    ) : (
                      <VerifyForm
                        demandId={order.demandId}
                        draft={
                          verifyDrafts[order.demandId] ?? {
                            patchId: "",
                            image: null,
                            busy: false,
                          }
                        }
                        onPatchChange={(v) => setVerifyPatch(order.demandId!, v)}
                        onImage={(f) => void setVerifyImage(order.demandId!, f)}
                        onSubmit={() => void submitVerify(order.demandId!)}
                        onScan={() => setScannerFor(order.demandId!)}
                        t={t}
                      />
                    )}
                  </div>
                )}

              {/* -------------------- Dispute outcomes -------------------- */}
              <OrderTicketStates tickets={order.tickets} t={t} />
            </div>
          </div>
        );
      })}

      {/* One sheet for the whole list — only ever open for a single order, so
          mounting it per card would be duplicated camera streams. */}
      <QrScanModal
        isOpen={Boolean(scannerFor)}
        onClose={() => setScannerFor(null)}
        onPatchId={(patchId) => {
          if (scannerFor) onScannedPatchId(scannerFor, patchId);
        }}
        onPhoto={(dataUrl) => {
          if (scannerFor) onScannedPhoto(scannerFor, dataUrl);
        }}
        t={t}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces below live in this file because they only render inside a
// buyer-order card and share its per-demand state via props.
// ---------------------------------------------------------------------------

/**
 * What the buyer sees after they report a piece, driven purely by ticket state.
 *
 * Only the most advanced outcome is worth showing: a resolved verdict replaces
 * the "under review" pill rather than stacking beneath it.
 */
function OrderTicketStates({
  tickets,
  t,
}: {
  tickets: OrderTicket[];
  t: (key: string) => string;
}) {
  if (!tickets || tickets.length === 0) return null;

  const guilty = tickets.find((ticket) => ticket.status === "RESOLVED_GUILTY");
  const notGuilty = tickets.find((ticket) => ticket.status === "RESOLVED_NOT_GUILTY");
  const open = tickets.find((ticket) => ticket.status === "OPEN");

  if (!guilty && !notGuilty && !open) return null;

  return (
    <div className="mt-5 space-y-3 border-t border-gray-100 pt-5">
      {guilty && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--color-sage)] bg-[var(--color-mint)] p-4">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-primary">{t("refund_initiated_title")}</p>
            <p className="mt-1 text-xs leading-relaxed text-primary/75">
              {t("refund_initiated_body")}
            </p>
          </div>
        </div>
      )}

      {notGuilty && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-bold text-gray-900">{t("report_discarded_title")}</p>
          {notGuilty.adminNote && (
            <p className="mt-2 text-xs leading-relaxed text-gray-600">
              <span className="font-bold uppercase tracking-wider text-gray-400">
                {t("report_discarded_reason")}:
              </span>{" "}
              {notGuilty.adminNote}
            </p>
          )}
        </div>
      )}

      {open && !guilty && !notGuilty && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-800">
          <Loader2 size={12} className="animate-spin" /> {t("report_under_review")}
        </span>
      )}
    </div>
  );
}

function VerifyForm({
  draft,
  onPatchChange,
  onImage,
  onSubmit,
  onScan,
  t,
}: {
  demandId: string;
  draft: { patchId: string; image: string | null; busy: boolean };
  onPatchChange: (value: string) => void;
  onImage: (file: File | null) => void;
  onSubmit: () => void;
  /** Opens the shared camera sheet for this order. */
  onScan: () => void;
  t: (key: string) => string;
}) {
  const canSubmit = draft.patchId.trim().length > 0 && !!draft.image && !draft.busy;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
        <ShieldCheck size={16} className="text-primary" /> {t("verify_product")}
      </h4>

      <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-gray-500">
        {t("enter_patch_id")}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft.patchId}
          onChange={(e) => onPatchChange(e.target.value)}
          placeholder="P-XXXXXX"
          className="min-h-[40px] flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={onScan}
          title={t("scan_qr_code")}
          aria-label={t("scan_qr_code")}
          className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[var(--color-mint)] px-3 text-xs font-bold text-primary hover:bg-[var(--color-sage)]/40"
        >
          <Camera size={16} /> {t("scan_qr_code")}
        </button>
      </div>

      <label className="kg-press mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm font-bold text-gray-500 hover:border-primary hover:text-primary">
        <ImagePlus size={16} />
        {draft.image ? t("upload_received_photo") + " ✓" : t("upload_received_photo")}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => onImage(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      </label>

      {draft.image && (
        <div className="relative mx-auto mt-3 h-32 w-32 overflow-hidden rounded-xl border border-gray-200">
          <Image src={draft.image} alt="" fill sizes="128px" unoptimized className="object-cover" />
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className={[
          "kg-press mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-white hover:bg-primary-dark",
          canSubmit ? "" : "cursor-not-allowed opacity-50",
        ].join(" ")}
      >
        {draft.busy && <Loader2 size={14} className="animate-spin" />}
        <ShieldCheck size={14} /> {t("verify_product")}
      </button>
    </div>
  );
}

