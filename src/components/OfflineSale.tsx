"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CloudOff,
  Loader2,
  Mic,
  Minus,
  Package,
  PackageX,
  Plus,
  ReceiptIndianRupee,
  RefreshCw,
  Square,
  Store,
  Trash2,
  TrendingUp,
  Undo2,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import { imageProps } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { StatTile } from "@/components/ui/StatTile";
import { useSpeechCapture, type SpeechCaptureError } from "@/lib/useSpeechCapture";
import { useOfflineQueue, refreshQueueCount } from "@/lib/offlineQueueStore";
import { flushQueue } from "@/lib/offlineSync";
import {
  listQueuedOfflineSales,
  queueOfflineSale,
  removeQueuedOfflineSale,
  reviseQueuedOfflineSale,
  type QueuedOfflineSale,
} from "@/lib/offlineQueue";
import {
  MAX_CRAFT_LABEL_LENGTH,
  MAX_OFFLINE_AMOUNT,
  MAX_OFFLINE_QUANTITY,
  MAX_SALE_AGE_DAYS,
  OFFLINE_CHANNELS,
  TERMINAL_OFFLINE_SALE_CODES,
  channelLabelKey,
  istDateKey,
  istDaysAgoKey,
  normaliseCraftLabel,
  parseAmountInput,
  soldAtFromInput,
  type OfflineChannel,
  type OfflineComparison,
  type OfflinePriceSignal,
  type OfflineSaleErrorCode,
  type OfflineSalePayload,
} from "@/lib/offlineSales";
import { parseOfflineSaleText } from "@/lib/offlineSaleParse";

/**
 * Log a sale made outside Karigari.
 *
 * A full page rather than a modal, because it has to work at a haat with no
 * signal: a sale saved offline goes to the phone's queue and uploads itself
 * later, and the half-filled form survives a reload.
 *
 * Voice first — the artisan speaks the sale, the page shows exactly what was
 * heard, fills the form, and waits. Nothing is ever saved until they tap Save.
 */

interface Piece {
  id: string;
  craftType: string;
  patchId: string | null;
  status: string;
  thumbnail: string | null;
  price: number | null;
}

interface LedgerSale {
  id: string;
  craftItemId: string | null;
  craftTypeLabel: string;
  amount: number;
  quantity: number;
  channel: string;
  buyerName: string | null;
  soldAt: string;
  notes: string | null;
  captureMethod: string;
  createdAt: string;
  undoUntil: string | null;
}

interface Progress {
  craftTypeLabel: string | null;
  offlineSamples: number;
  onlineSamples: number;
  minPriceSamples: number;
  minOnlineSamples: number;
  windowDays: number;
}

interface Ledger {
  sales: LedgerSale[];
  totals: { offlineTotal: number; offlineCount: number; thisMonth: number; lastMonth: number };
  signal: OfflinePriceSignal | null;
  comparison: OfflineComparison | null;
  progress: Progress;
  ownMedianUnit: number | null;
  highAmountThreshold: number;
  labels: string[];
  pieces: Piece[];
}

interface Insight {
  signal: OfflinePriceSignal | null;
  comparison: OfflineComparison | null;
  progress: Progress;
}

interface FormState {
  craftItemId: string | null;
  craftTypeLabel: string;
  amount: string;
  quantity: number;
  channel: OfflineChannel;
  buyerName: string;
  soldAt: string;
  notes: string;
  captureMethod: "MANUAL" | "VOICE";
  voiceLanguage: string | null;
}

interface VoiceInfo {
  engine: "ai+rules" | "rules";
  conflicts: { amount?: [number, number]; quantity?: [number, number] };
  ambiguousAmount: boolean;
}

const EMPTY_FORM: FormState = {
  craftItemId: null,
  craftTypeLabel: "",
  amount: "",
  quantity: 1,
  channel: "HAAT",
  buyerName: "",
  soldAt: "",
  notes: "",
  captureMethod: "MANUAL",
  voiceLanguage: null,
};

/** The unsent form, per phone. A convenience only — never the source of truth. */
const DRAFT_KEY = "karigari_log_sale_draft_v1";

const IST_DAY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
};
const IST_TIME: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Kolkata",
};

/** "{n} more" → "3 more". Every placeholder in the template is filled. */
function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template
  );
}

/** The i18n key for a refusal code the route or the queue carries. */
function errorKey(code: OfflineSaleErrorCode | string | undefined): string {
  switch (code) {
    case "AMOUNT_INVALID":
    case "AMOUNT_TOO_LARGE":
      return "log_sale_error_amount";
    case "AMOUNT_HIGH":
      return "log_sale_amount_high_warning";
    case "QUANTITY_INVALID":
      return "log_sale_error_quantity";
    case "SOLD_AT_FUTURE":
      return "log_sale_future_date";
    case "SOLD_AT_TOO_OLD":
      return "log_sale_error_too_old";
    case "SOLD_AT_INVALID":
      return "log_sale_error_date";
    case "LABEL_REQUIRED":
      return "log_sale_error_label";
    case "PIECE_ALREADY_SOLD":
    case "PIECE_NOT_FOUND":
    case "PIECE_NOT_YOURS":
      return "log_sale_piece_already_sold";
    case "PIECE_HAS_PLATFORM_MONEY":
      return "log_sale_error_platform_money";
    case "UNDO_WINDOW_CLOSED":
      return "log_sale_undo_closed";
    default:
      return "log_sale_error_generic";
  }
}

const SPEECH_ERROR_KEY: Record<SpeechCaptureError, string> = {
  mic_denied: "log_sale_voice_error_mic",
  no_mic: "log_sale_voice_error_mic",
  no_speech: "log_sale_voice_error_no_speech",
  unsupported: "log_sale_voice_unsupported",
  failed: "log_sale_voice_error_failed",
};

function readDraft(): Partial<FormState> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<FormState>) : null;
  } catch {
    return null;
  }
}

function writeDraft(form: FormState | null) {
  try {
    if (form) localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage blocked: the form still works, it just will not survive a reload.
  }
}

export function OfflineSale() {
  const { t, language } = useLanguage();
  const { online, syncing } = useOfflineQueue();

  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerState, setLedgerState] = useState<"loading" | "ready" | "failed">("loading");
  const [insight, setInsight] = useState<Insight | null>(null);
  const [queued, setQueued] = useState<QueuedOfflineSale[]>([]);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [today, setToday] = useState<string>("");
  const [nowMs, setNowMs] = useState<number>(0);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"amount" | "craftTypeLabel" | "soldAt" | "quantity", string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [highAmount, setHighAmount] = useState<{ threshold: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<"saved" | "queued" | null>(null);

  const [heard, setHeard] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [voiceInfo, setVoiceInfo] = useState<VoiceInfo | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);

  // ---- data ------------------------------------------------------------
  const loadLedger = useCallback(async () => {
    try {
      const res = await fetch("/api/artisan/offline-sales?pieces=1", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setLedger(data as Ledger);
      setLedgerState("ready");
    } catch (error) {
      console.warn("[log-sale] ledger unavailable:", (error as Error)?.message);
      setLedgerState((state) => (state === "ready" ? "ready" : "failed"));
    }
  }, []);

  const loadQueue = useCallback(async () => {
    const rows = await listQueuedOfflineSales();
    setQueued(rows);
    // A sale that was "saved on this phone" and has since uploaded is simply
    // saved; the card must not keep telling the artisan they are offline.
    if (rows.length === 0) setDone((current) => (current === "queued" ? "saved" : current));
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      setToday(istDateKey(new Date()));
      setNowMs(Date.now());
      const draft = readDraft();
      setForm((current) => ({
        ...current,
        ...(draft ?? {}),
        soldAt: draft?.soldAt || istDateKey(new Date()),
      }));
      void loadLedger();
      void loadQueue();
    }, 0);
    const clock = setInterval(() => {
      setNowMs(Date.now());
      setToday(istDateKey(new Date()));
    }, 60_000);
    const onFlushed = () => {
      void loadLedger();
      void loadQueue();
    };
    window.addEventListener("karigari:queue-flushed", onFlushed);
    return () => {
      clearTimeout(kickoff);
      clearInterval(clock);
      window.removeEventListener("karigari:queue-flushed", onFlushed);
    };
  }, [loadLedger, loadQueue]);

  // A flush that just finished may have refused a row — re-read the queue.
  const wasSyncing = useRef(syncing);
  useEffect(() => {
    if (wasSyncing.current && !syncing) {
      void loadQueue();
      void loadLedger();
    }
    wasSyncing.current = syncing;
  }, [syncing, loadQueue, loadLedger]);

  // Persist the half-filled form. Only once the kickoff has restored it, or
  // the empty initial state would overwrite a real draft.
  useEffect(() => {
    if (!today || done) return;
    writeDraft(form);
  }, [form, today, done]);

  // The local signal and the comparison for whatever craft is being logged.
  const label = form.craftTypeLabel.trim();
  useEffect(() => {
    if (!label || !online) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/artisan/offline-sales?craft=${encodeURIComponent(label)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (res.ok && data?.success) {
          setInsight({ signal: data.signal, comparison: data.comparison, progress: data.progress });
        }
      } catch {
        // Offline or aborted: the summary simply shows no comparison.
      }
    }, 700);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [label, online]);

  // ---- derived -----------------------------------------------------------
  const queuedPieceIds = useMemo(
    () => new Set(queued.map((row) => row.payload.craftItemId).filter(Boolean) as string[]),
    [queued]
  );
  const pieces = useMemo(
    () => (ledger?.pieces ?? []).filter((piece) => !queuedPieceIds.has(piece.id)),
    [ledger, queuedPieceIds]
  );
  const selectedPiece = pieces.find((piece) => piece.id === form.craftItemId) ?? null;
  const amountValue = parseAmountInput(form.amount);
  const labelOptions = useMemo(
    () => [...new Set([...(ledger?.labels ?? []), ...(ledger?.pieces ?? []).map((p) => p.craftType)])],
    [ledger]
  );
  const currentInsight =
    label && normaliseCraftLabel(insight?.progress.craftTypeLabel) === normaliseCraftLabel(label) ? insight : null;

  // ---- form helpers ------------------------------------------------------
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((errors) => ({ ...errors, [key]: undefined }));
    setFormError(null);
    setHighAmount(null);
  };

  const pickPiece = (piece: Piece | null) => {
    setForm((current) => ({
      ...current,
      craftItemId: piece?.id ?? null,
      // The piece's own name, so the ledger line survives a later delete.
      craftTypeLabel: piece ? piece.craftType : current.craftItemId ? "" : current.craftTypeLabel,
    }));
    setFieldErrors((errors) => ({ ...errors, craftTypeLabel: undefined }));
    setFormError(null);
  };

  const resetForAnother = () => {
    setDone(null);
    setHeard(null);
    setVoiceInfo(null);
    setVoiceError(null);
    setFieldErrors({});
    setFormError(null);
    setHighAmount(null);
    setForm({ ...EMPTY_FORM, soldAt: today || istDateKey(new Date()), channel: form.channel });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ---- voice -------------------------------------------------------------
  const applyDraft = useCallback(
    (draft: Partial<Record<keyof FormState, unknown>>, info: VoiceInfo) => {
      setForm((current) => {
        const next: FormState = { ...current, captureMethod: "VOICE", voiceLanguage: language };
        if (typeof draft.amount === "number") next.amount = String(draft.amount);
        if (typeof draft.quantity === "number") next.quantity = draft.quantity;
        if (typeof draft.craftTypeLabel === "string" && !current.craftItemId) next.craftTypeLabel = draft.craftTypeLabel;
        if (typeof draft.buyerName === "string") next.buyerName = draft.buyerName;
        if (typeof draft.channel === "string" && (OFFLINE_CHANNELS as readonly string[]).includes(draft.channel)) {
          next.channel = draft.channel as OfflineChannel;
        }
        if (typeof draft.soldAt === "string") next.soldAt = draft.soldAt;
        return next;
      });
      setVoiceInfo(info);
      setFieldErrors({});
      setFormError(null);
    },
    [language]
  );

  /** The rule parser runs in the browser too, so a dropped request still fills the form. */
  const parseLocally = useCallback(
    (text: string) => {
      const knownLabels = [...new Set([...(ledger?.labels ?? []), ...(ledger?.pieces ?? []).map((p) => p.craftType)])];
      const result = parseOfflineSaleText(text, { knownLabels });
      applyDraft(result, { engine: "rules", conflicts: {}, ambiguousAmount: result.ambiguousAmount });
    },
    [applyDraft, ledger]
  );

  const handleParseResponse = useCallback(
    (data: {
      success?: boolean;
      transcript?: string | null;
      draft?: Partial<Record<keyof FormState, unknown>>;
      conflicts?: VoiceInfo["conflicts"];
      ambiguousAmount?: boolean;
      engine?: VoiceInfo["engine"];
    }) => {
      if (data.transcript) setHeard(data.transcript);
      if (!data.success || !data.draft) {
        setVoiceError(t("log_sale_voice_error_failed"));
        return;
      }
      applyDraft(data.draft, {
        engine: data.engine === "ai+rules" ? "ai+rules" : "rules",
        conflicts: data.conflicts ?? {},
        ambiguousAmount: Boolean(data.ambiguousAmount),
      });
    },
    [applyDraft, t]
  );

  const onTranscript = useCallback(
    async (text: string) => {
      setHeard(text);
      setVoiceError(null);
      setParsing(true);
      try {
        const res = await fetch("/api/artisan/offline-sales/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text, language }),
        });
        handleParseResponse(await res.json());
      } catch {
        parseLocally(text);
      } finally {
        setParsing(false);
      }
    },
    [handleParseResponse, language, parseLocally]
  );

  const onAudio = useCallback(
    async (audio: Blob, mimeType: string) => {
      setVoiceError(null);
      setParsing(true);
      try {
        const body = new FormData();
        body.append("file", audio, mimeType.includes("mp4") ? "sale.mp4" : "sale.webm");
        body.append("language", language);
        const res = await fetch("/api/artisan/offline-sales/parse", { method: "POST", body });
        const data = await res.json();
        if (!data?.success && !data?.transcript) {
          setVoiceError(t("log_sale_voice_error_failed"));
          return;
        }
        handleParseResponse(data);
      } catch {
        setVoiceError(t("log_sale_voice_offline"));
      } finally {
        setParsing(false);
      }
    },
    [handleParseResponse, language, t]
  );

  const speech = useSpeechCapture({ language, onTranscript, onAudio });
  const speechError = speech.error ? t(SPEECH_ERROR_KEY[speech.error]) : null;

  const toggleMic = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    setHeard(null);
    setVoiceInfo(null);
    setVoiceError(null);
    speech.start();
  };

  // ---- save --------------------------------------------------------------
  const validate = (): OfflineSalePayload | null => {
    const errors: typeof fieldErrors = {};
    if (amountValue === null || amountValue < 1 || amountValue > MAX_OFFLINE_AMOUNT) {
      errors.amount = t("log_sale_error_amount");
    }
    if (!label) errors.craftTypeLabel = t("log_sale_error_label");
    if (form.quantity < 1 || form.quantity > MAX_OFFLINE_QUANTITY) errors.quantity = t("log_sale_error_quantity");
    const when = soldAtFromInput(form.soldAt);
    if (!when.ok) {
      errors.soldAt = t(
        when.reason === "future" ? "log_sale_future_date" : when.reason === "too_old" ? "log_sale_error_too_old" : "log_sale_error_date"
      );
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || amountValue === null) return null;
    return {
      craftItemId: form.craftItemId,
      craftTypeLabel: label,
      amount: amountValue,
      quantity: form.quantity,
      channel: form.channel,
      buyerName: form.buyerName.trim() || null,
      soldAt: form.soldAt,
      notes: form.notes.trim() || null,
      captureMethod: form.captureMethod,
      voiceLanguage: form.captureMethod === "VOICE" ? form.voiceLanguage : null,
    };
  };

  const finishSaved = (kind: "saved" | "queued") => {
    writeDraft(null);
    setDone(kind);
    setHighAmount(null);
  };

  const saveToPhone = async (payload: OfflineSalePayload) => {
    try {
      await queueOfflineSale(payload, selectedPiece?.craftType ?? null);
      await refreshQueueCount();
      await loadQueue();
      finishSaved("queued");
    } catch (error) {
      console.warn("[log-sale] could not queue:", (error as Error)?.message);
      setFormError(t("log_sale_error_generic"));
    }
  };

  const save = async (confirmHighAmount = false) => {
    if (saving) return;
    const payload = validate();
    if (!payload) return;
    if (confirmHighAmount) payload.confirmHighAmount = true;

    // Offline there is no server to ask, so the phone asks the same question
    // with the threshold it last saw. Online the route asks it itself.
    const threshold = ledger?.highAmountThreshold ?? null;
    if (!confirmHighAmount && !online && threshold !== null && payload.amount / payload.quantity > threshold) {
      setHighAmount({ threshold });
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (!online) {
        await saveToPhone(payload);
        return;
      }
      let res: Response;
      try {
        res = await fetch("/api/artisan/offline-sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        // The request never reached the server: the sale goes to the phone.
        await saveToPhone(payload);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.sale?.id) {
        finishSaved("saved");
        void loadLedger();
        return;
      }
      if (data?.code === "AMOUNT_HIGH") {
        setHighAmount({ threshold: Number(data.threshold) || 0 });
        return;
      }
      if (data?.code === "PIECE_SOLD_ONLINE") {
        setFormError(
          fill(t("log_sale_piece_sold_online"), {
            date: data.soldOnlineAt ? new Date(data.soldOnlineAt).toLocaleDateString("en-IN", IST_DAY) : "—",
          })
        );
        void loadLedger();
        return;
      }
      setFormError(t(errorKey(data?.code)));
    } finally {
      setSaving(false);
    }
  };

  // ---- queue actions -----------------------------------------------------
  const syncNow = async () => {
    await flushQueue().catch(() => undefined);
    await refreshQueueCount().catch(() => 0);
    await loadQueue();
    await loadLedger();
  };

  const reviseAndSync = async (id: string, patch: Partial<OfflineSalePayload>) => {
    await reviseQueuedOfflineSale(id, patch);
    await loadQueue();
    if (online) await syncNow();
  };

  const removeQueued = async (id: string) => {
    if (confirming !== `queue-${id}`) {
      setConfirming(`queue-${id}`);
      return;
    }
    setConfirming(null);
    await removeQueuedOfflineSale(id);
    await refreshQueueCount();
    await loadQueue();
  };

  const undoSale = async (id: string) => {
    if (confirming !== `undo-${id}`) {
      setConfirming(`undo-${id}`);
      return;
    }
    setConfirming(null);
    try {
      const res = await fetch(`/api/artisan/offline-sales?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      setNotice(res.ok ? t("log_sale_undone") : t(errorKey(data?.code)));
      void loadLedger();
    } catch {
      setNotice(t("log_sale_error_generic"));
    }
  };

  // ---- render ------------------------------------------------------------
  const busy = parsing || saving;
  const micDisabled = parsing || !online || speech.supported === false;
  const unitLine =
    amountValue !== null && form.quantity > 1
      ? fill(t("log_sale_summary_units"), { n: form.quantity, amount: formatRupees(Math.round(amountValue / form.quantity)) })
      : null;

  return (
    <>

      {!online && (
        <p
          role="status"
          aria-live="polite"
          className="mb-6 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900"
        >
          <CloudOff size={16} className="mt-0.5 shrink-0" />
          {t("log_sale_offline_banner")}
        </p>
      )}

      {done ? (
        <Card pad="lg" className="kg-enter mb-10 text-center" role="status" aria-live="polite">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-pill)] text-primary">
            {done === "saved" ? <CheckCircle2 size={26} /> : <CloudOff size={26} />}
          </span>
          <h2 className="kg-display mt-5 text-[26px] leading-tight text-gray-900">
            {t(done === "saved" ? "log_sale_saved" : "log_sale_queued_offline")}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-gray-600">
            {t(done === "saved" ? "log_sale_saved_body" : "log_sale_queued_body")}
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={resetForAnother}
              className="kg-press inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-[14px] font-semibold text-white hover:bg-primary-dark sm:w-auto"
            >
              <Plus size={16} /> {t("log_sale_another")}
            </button>
            <Link
              href="/artisan/earnings"
              className="kg-press inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-pill)] px-6 text-[14px] font-semibold text-gray-800 hover:bg-gray-200 sm:w-auto"
            >
              {t("nav_earnings")} <ArrowRight size={15} />
            </Link>
          </div>
        </Card>
      ) : (
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          noValidate
          className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start"
        >
          <div className="min-w-0 space-y-6">
            {/* ------------------------------------------------ speak first */}
            <Card pad="lg" className="kg-enter text-center">
              <button
                type="button"
                onClick={toggleMic}
                disabled={micDisabled && !speech.listening}
                aria-label={speech.listening ? t("log_sale_stop_listening") : t("log_sale_speak_cta")}
                aria-pressed={speech.listening}
                className={cn(
                  "kg-press mx-auto flex h-20 w-20 items-center justify-center rounded-full text-white shadow-soft disabled:cursor-not-allowed disabled:opacity-40",
                  speech.listening ? "bg-[var(--color-maroon)]" : "bg-primary hover:bg-primary-dark"
                )}
              >
                {parsing ? (
                  <Loader2 size={30} className="animate-spin" />
                ) : speech.listening ? (
                  <Square size={26} fill="currentColor" />
                ) : (
                  <Mic size={32} />
                )}
              </button>
              <p className="mt-4 text-[15px] font-semibold text-gray-900">
                {speech.listening
                  ? t("log_sale_listening")
                  : parsing
                    ? t("log_sale_hearing")
                    : t("log_sale_speak_cta")}
              </p>
              <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-gray-500">
                {!online ? t("log_sale_voice_offline") : t("log_sale_speak_hint")}
              </p>

              <div role="status" aria-live="polite" className="mt-4 space-y-3 text-left">
                {speech.interim && (
                  <p className="rounded-xl bg-gray-50 px-4 py-3 text-[14px] italic text-gray-500">{speech.interim}</p>
                )}
                {heard && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="kg-label text-gray-500">{t("log_sale_heard")}</p>
                    <p className="mt-1 text-[15px] text-gray-900">“{heard}”</p>
                    {voiceInfo && (
                      <p className="mt-2 text-[12px] leading-relaxed text-gray-500">
                        {t(voiceInfo.engine === "rules" ? "log_sale_voice_rules_only" : "log_sale_draft_note")}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {(speechError || voiceError) && (
                <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-[13px] text-amber-900">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  {voiceError ?? speechError}
                </p>
              )}
            </Card>

            {/* ------------------------------------------------ the sale */}
            <Card pad="lg" className="kg-enter space-y-7">
              {/* min-w-0: a fieldset defaults to min-width: min-content, which
                  would stretch it to the whole rail and scroll the page. */}
              <fieldset className="min-w-0">
                <legend className="mb-3 text-[13px] font-semibold text-gray-800">{t("log_sale_pick_piece")}</legend>
                <div className="kg-rail -mx-6 flex gap-3 overflow-x-auto px-6 pb-1 sm:-mx-8 sm:px-8">
                  <button
                    type="button"
                    onClick={() => pickPiece(null)}
                    aria-pressed={form.craftItemId === null}
                    className={cn(
                      "kg-press flex h-[112px] w-[104px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border-2 px-2 text-center text-[12px] font-semibold",
                      form.craftItemId === null
                        ? "border-primary bg-white text-gray-900"
                        : "border-transparent bg-[var(--color-pill)] text-gray-600"
                    )}
                  >
                    <PackageX size={22} strokeWidth={1.6} />
                    {t("log_sale_not_in_catalogue")}
                  </button>
                  {ledgerState === "loading" &&
                    [0, 1, 2].map((i) => <span key={`shimmer-${i}`} className="kg-shimmer h-[112px] w-[104px] shrink-0 rounded-2xl" />)}
                  {pieces.map((piece) => {
                    const active = form.craftItemId === piece.id;
                    return (
                      <button
                        key={piece.id}
                        type="button"
                        onClick={() => pickPiece(active ? null : piece)}
                        aria-pressed={active}
                        aria-label={piece.patchId ? `${piece.craftType} · ${piece.patchId}` : piece.craftType}
                        className={cn(
                          "kg-press flex h-[112px] w-[104px] shrink-0 flex-col overflow-hidden rounded-2xl border-2 bg-white text-left",
                          active ? "border-primary" : "border-gray-200/70"
                        )}
                      >
                        <span className="relative block h-[70px] w-full bg-[var(--color-pill)]">
                          {piece.thumbnail ? (
                            <Image {...imageProps(piece.thumbnail)} alt="" fill sizes="104px" className="object-cover" />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-gray-400">
                              <Package size={20} />
                            </span>
                          )}
                        </span>
                        <span className="line-clamp-2 px-2 py-1.5 text-[11px] font-semibold leading-tight text-gray-800">
                          {piece.craftType}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {ledgerState === "ready" && pieces.length === 0 && (
                  <p className="mt-2 text-[12px] text-gray-500">{t("log_sale_no_pieces")}</p>
                )}
              </fieldset>

              <div>
                <label htmlFor="sale-label" className="mb-2 block text-[13px] font-semibold text-gray-800">
                  {t("log_sale_what_sold")}
                </label>
                <input
                  id="sale-label"
                  type="text"
                  list="sale-label-options"
                  value={form.craftTypeLabel}
                  maxLength={MAX_CRAFT_LABEL_LENGTH}
                  readOnly={Boolean(selectedPiece)}
                  onChange={(e) => update("craftTypeLabel", e.target.value)}
                  aria-invalid={Boolean(fieldErrors.craftTypeLabel)}
                  aria-describedby={fieldErrors.craftTypeLabel ? "sale-label-error" : undefined}
                  className={cn(
                    "block h-[50px] w-full rounded-xl border bg-white px-4 text-[15px] text-gray-900 focus:outline-none focus:ring-1",
                    fieldErrors.craftTypeLabel ? "border-red-500 focus:ring-red-600" : "border-gray-200 focus:border-gray-900 focus:ring-gray-900",
                    selectedPiece && "bg-gray-50 text-gray-600"
                  )}
                />
                <datalist id="sale-label-options">
                  {labelOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
                {fieldErrors.craftTypeLabel && (
                  <p id="sale-label-error" role="alert" className="mt-1.5 text-[12px] text-red-700">
                    {fieldErrors.craftTypeLabel}
                  </p>
                )}
              </div>

              <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <label htmlFor="sale-amount" className="mb-2 block text-[13px] font-semibold text-gray-800">
                    {t("log_sale_amount")}
                  </label>
                  <div className="relative">
                    <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[22px] font-semibold text-gray-400">
                      ₹
                    </span>
                    <input
                      id="sale-amount"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={form.amount}
                      onChange={(e) => update("amount", e.target.value)}
                      aria-invalid={Boolean(fieldErrors.amount)}
                      aria-describedby="sale-amount-hint"
                      className={cn(
                        "block h-[60px] w-full rounded-xl border bg-white pl-10 pr-4 font-sans text-[26px] font-bold text-gray-900 focus:outline-none focus:ring-1",
                        fieldErrors.amount ? "border-red-500 focus:ring-red-600" : "border-gray-200 focus:border-gray-900 focus:ring-gray-900"
                      )}
                    />
                  </div>
                  <p id="sale-amount-hint" className={cn("mt-1.5 text-[12px]", fieldErrors.amount ? "text-red-700" : "text-gray-500")} role={fieldErrors.amount ? "alert" : undefined}>
                    {fieldErrors.amount ?? t("log_sale_amount_hint")}
                  </p>
                  {voiceInfo?.conflicts.amount && (
                    <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      {fill(t("log_sale_check_amount"), {
                        a: formatRupees(voiceInfo.conflicts.amount[0]),
                        b: formatRupees(voiceInfo.conflicts.amount[1]),
                      })}
                    </p>
                  )}
                  {voiceInfo?.ambiguousAmount && amountValue === null && (
                    <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      {t("log_sale_amount_unclear")}
                    </p>
                  )}
                </div>

                <div>
                  <span id="sale-quantity-label" className="mb-2 block text-[13px] font-semibold text-gray-800">
                    {t("log_sale_quantity")}
                  </span>
                  <div role="group" aria-labelledby="sale-quantity-label" className="flex h-[60px] items-center gap-2">
                    <button
                      type="button"
                      onClick={() => update("quantity", Math.max(1, form.quantity - 1))}
                      disabled={form.quantity <= 1}
                      aria-label={t("log_sale_quantity_less")}
                      className="kg-press flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-pill)] text-gray-800 disabled:opacity-40"
                    >
                      <Minus size={18} />
                    </button>
                    <output aria-live="polite" className="kg-display w-12 text-center text-[26px] text-gray-900">
                      {form.quantity}
                    </output>
                    <button
                      type="button"
                      onClick={() => update("quantity", Math.min(MAX_OFFLINE_QUANTITY, form.quantity + 1))}
                      disabled={form.quantity >= MAX_OFFLINE_QUANTITY}
                      aria-label={t("log_sale_quantity_more")}
                      className="kg-press flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-pill)] text-gray-800 disabled:opacity-40"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {voiceInfo?.conflicts.quantity && (
                    <p className="mt-2 text-[12px] text-amber-900">
                      {fill(t("log_sale_check_quantity"), {
                        a: voiceInfo.conflicts.quantity[0],
                        b: voiceInfo.conflicts.quantity[1],
                      })}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <span id="sale-channel-label" className="mb-2 block text-[13px] font-semibold text-gray-800">
                  {t("log_sale_channel")}
                </span>
                {/* Scrolls rather than truncating: five choices in Odia or
                    Telugu do not fit a 360px screen side by side. */}
                <div className="kg-scroll-x kg-rail -mx-1 px-1 pb-1">
                  <SegmentedToggle<OfflineChannel>
                    ariaLabel={t("log_sale_channel")}
                    value={form.channel}
                    onChange={(value) => update("channel", value)}
                    options={OFFLINE_CHANNELS.map((channel) => ({ value: channel, label: t(channelLabelKey(channel)) }))}
                    className="min-w-[540px]"
                  />
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="sale-date" className="mb-2 block text-[13px] font-semibold text-gray-800">
                    {t("log_sale_date")}
                  </label>
                  <input
                    id="sale-date"
                    type="date"
                    value={form.soldAt}
                    max={today || undefined}
                    min={today ? istDaysAgoKey(MAX_SALE_AGE_DAYS, new Date(`${today}T12:00:00+05:30`)) : undefined}
                    onChange={(e) => update("soldAt", e.target.value)}
                    aria-invalid={Boolean(fieldErrors.soldAt)}
                    className={cn(
                      "block h-[50px] w-full rounded-xl border bg-white px-4 text-[15px] text-gray-900 focus:outline-none focus:ring-1",
                      fieldErrors.soldAt ? "border-red-500 focus:ring-red-600" : "border-gray-200 focus:border-gray-900 focus:ring-gray-900"
                    )}
                  />
                  <div className="mt-2 flex gap-2">
                    {today &&
                      [
                        { key: "log_sale_today", value: today },
                        { key: "log_sale_yesterday", value: istDaysAgoKey(1, new Date(`${today}T12:00:00+05:30`)) },
                      ].map((shortcut) => (
                        <button
                          key={shortcut.key}
                          type="button"
                          onClick={() => update("soldAt", shortcut.value)}
                          aria-pressed={form.soldAt === shortcut.value}
                          className={cn(
                            "kg-press min-h-[40px] rounded-full px-4 text-[12px] font-semibold",
                            form.soldAt === shortcut.value ? "bg-primary text-white" : "bg-[var(--color-pill)] text-gray-700"
                          )}
                        >
                          {t(shortcut.key)}
                        </button>
                      ))}
                  </div>
                  {fieldErrors.soldAt && (
                    <p role="alert" className="mt-1.5 text-[12px] text-red-700">
                      {fieldErrors.soldAt}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="sale-buyer" className="mb-2 block text-[13px] font-semibold text-gray-800">
                    {t("log_sale_buyer")} <span className="font-normal text-gray-400">· {t("log_sale_optional")}</span>
                  </label>
                  <input
                    id="sale-buyer"
                    type="text"
                    value={form.buyerName}
                    maxLength={120}
                    autoComplete="off"
                    onChange={(e) => update("buyerName", e.target.value)}
                    className="block h-[50px] w-full rounded-xl border border-gray-200 bg-white px-4 text-[15px] text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="sale-notes" className="mb-2 block text-[13px] font-semibold text-gray-800">
                  {t("log_sale_notes")} <span className="font-normal text-gray-400">· {t("log_sale_optional")}</span>
                </label>
                <textarea
                  id="sale-notes"
                  rows={2}
                  maxLength={500}
                  value={form.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  className="block w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </div>
            </Card>
          </div>

          {/* ------------------------------------------------ live summary */}
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24">
            <Card pad="lg" className="kg-enter">
              <SectionLabel>{t("log_sale_summary_title")}</SectionLabel>
              <p className="kg-display text-[40px] leading-none text-gray-900">{formatRupees(amountValue ?? 0)}</p>
              {unitLine && <p className="mt-2 text-[13px] text-gray-500">{unitLine}</p>}
              <p className="mt-2 text-[13px] text-gray-600">
                {[label || null, t(channelLabelKey(form.channel))].filter(Boolean).join(" · ")}
              </p>

              <CraftInsight t={t} insight={currentInsight} label={label} currentUnit={amountValue !== null ? amountValue / form.quantity : null} />

              {highAmount && (
                <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[13px] text-amber-900">
                  <p className="flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    {fill(t("log_sale_amount_high_warning"), { amount: formatRupees(amountValue ?? 0) })}
                  </p>
                  <button
                    type="button"
                    onClick={() => void save(true)}
                    className="kg-press mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-amber-800 px-4 text-[13px] font-semibold text-white"
                  >
                    {t("log_sale_amount_high_confirm")}
                  </button>
                </div>
              )}

              {formError && (
                <p role="alert" className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="kg-press mt-6 inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-[15px] font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : online ? <ReceiptIndianRupee size={18} /> : <CloudOff size={18} />}
                {saving ? t("log_sale_saving") : t("log_sale_save")}
              </button>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-gray-500">{t("log_sale_self_logged_note")}</p>
            </Card>
          </aside>
        </form>
      )}

      {/* -------------------------------------------------- on this phone */}
      {queued.length > 0 && (
        <section aria-labelledby="queued-sales" className="mb-10">
          <SectionLabel
            action={
              online ? (
                <button
                  type="button"
                  onClick={() => void syncNow()}
                  className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-gray-700 hover:bg-[var(--color-pill)]"
                >
                  <RefreshCw size={13} className={syncing ? "animate-spin" : undefined} /> {t("log_sale_queue_retry")}
                </button>
              ) : null
            }
          >
            <span id="queued-sales">{t("log_sale_queue_title")}</span>
          </SectionLabel>
          <ul className="space-y-3">
            {queued.map((row) => {
              const code = row.lastErrorCode;
              const terminal = code ? (TERMINAL_OFFLINE_SALE_CODES as readonly string[]).includes(code) : false;
              const pieceProblem =
                code === "PIECE_SOLD_ONLINE" || code === "PIECE_ALREADY_SOLD" || code === "PIECE_NOT_FOUND" || code === "PIECE_NOT_YOURS" || code === "PIECE_HAS_PLATFORM_MONEY";
              const message =
                code === "PIECE_SOLD_ONLINE"
                  ? fill(t("log_sale_piece_sold_online"), {
                      date: row.soldOnlineAt ? new Date(row.soldOnlineAt).toLocaleDateString("en-IN", IST_DAY) : "—",
                    })
                  : code
                    ? fill(t(errorKey(code)), { amount: formatRupees(row.payload.amount) })
                    : row.lastError
                      ? t("log_sale_queue_waiting_retry")
                      : t("log_sale_queue_waiting");
              return (
                <Card as="li" key={row.id} pad="sm" className="kg-list-item">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", terminal ? "bg-red-50 text-red-700" : "bg-[var(--color-pill)] text-gray-600")}>
                      {terminal ? <AlertTriangle size={17} /> : <CloudOff size={17} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-gray-900">
                        {row.payload.craftTypeLabel}
                        {row.payload.quantity > 1 ? ` × ${row.payload.quantity}` : ""}
                      </p>
                      <p className={cn("mt-0.5 text-[12px] leading-relaxed", terminal ? "text-red-700" : "text-gray-500")}>{message}</p>
                    </div>
                    <p className="shrink-0 font-sans text-[16px] font-bold text-gray-900">{formatRupees(row.payload.amount)}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 pl-[52px]">
                    {pieceProblem && (
                      <button
                        type="button"
                        onClick={() => void reviseAndSync(row.id, { craftItemId: null })}
                        className="kg-press min-h-[40px] rounded-full bg-primary px-4 text-[12px] font-semibold text-white"
                      >
                        {t("log_sale_queue_save_without_piece")}
                      </button>
                    )}
                    {code === "AMOUNT_HIGH" && (
                      <button
                        type="button"
                        onClick={() => void reviseAndSync(row.id, { confirmHighAmount: true })}
                        className="kg-press min-h-[40px] rounded-full bg-primary px-4 text-[12px] font-semibold text-white"
                      >
                        {t("log_sale_amount_high_confirm")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void removeQueued(row.id)}
                      className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--color-pill)] px-4 text-[12px] font-semibold text-gray-700"
                    >
                      <Trash2 size={13} />
                      {confirming === `queue-${row.id}` ? t("log_sale_queue_remove_confirm") : t("log_sale_queue_remove")}
                    </button>
                  </div>
                </Card>
              );
            })}
          </ul>
        </section>
      )}

      {/* -------------------------------------------------- the ledger */}
      <section aria-labelledby="offline-ledger">
        <SectionLabel>
          <span id="offline-ledger">{t("log_sale_recent_title")}</span>
        </SectionLabel>

        {ledgerState === "loading" ? (
          <div className="kg-shimmer h-[220px] rounded-2xl" />
        ) : ledgerState === "failed" || !ledger ? (
          <Card pad="lg" className="border-dashed text-center text-[14px] text-gray-500">
            {t(online ? "log_sale_ledger_failed" : "log_sale_ledger_offline")}
          </Card>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 kg-stagger">
              <StatTile
                label={t("log_sale_total_logged")}
                value={formatRupees(ledger.totals.offlineTotal)}
                icon={<Store size={16} />}
                delta={ledger.totals.offlineCount === 0 ? t("earnings_offline_none") : fill(t("log_sale_count"), { n: ledger.totals.offlineCount })}
              />
              <StatTile label={t("log_sale_this_month")} value={formatRupees(ledger.totals.thisMonth)} />
              <StatTile label={t("log_sale_last_month")} value={formatRupees(ledger.totals.lastMonth)} />
            </div>

            {ledger.totals.offlineCount > 0 && (
              <Card className="mb-5">
                <CraftInsight
                  t={t}
                  insight={{ signal: ledger.signal, comparison: ledger.comparison, progress: ledger.progress }}
                  label={ledger.progress.craftTypeLabel ?? ""}
                  currentUnit={null}
                  standalone
                />
              </Card>
            )}

            {notice && (
              <p role="status" aria-live="polite" className="mb-4 rounded-xl bg-[var(--color-pill)] px-4 py-2.5 text-[13px] text-gray-800">
                {notice}
              </p>
            )}

            {ledger.sales.length === 0 ? (
              <Card pad="lg" className="border-dashed text-center">
                <p className="text-[14px] text-gray-500">{t("log_sale_recent_empty")}</p>
              </Card>
            ) : (
              <ul className="space-y-3 kg-stagger">
                {ledger.sales.map((sale) => {
                  const undoable = sale.undoUntil !== null && nowMs > 0 && new Date(sale.undoUntil).getTime() > nowMs;
                  const channel = (OFFLINE_CHANNELS as readonly string[]).includes(sale.channel) ? (sale.channel as OfflineChannel) : "OTHER";
                  return (
                    <Card as="li" key={sale.id} pad="sm" className="kg-list-item">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-pill)] text-[var(--color-stat-brown)]">
                          <ReceiptIndianRupee size={17} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-semibold text-gray-900">
                            {sale.craftTypeLabel}
                            {sale.quantity > 1 ? ` × ${sale.quantity}` : ""}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-500">
                            <span>{new Date(sale.soldAt).toLocaleDateString("en-IN", IST_DAY)}</span>
                            <Badge variant="neutral">{t(channelLabelKey(channel))}</Badge>
                            {sale.craftItemId && <Badge variant="outline">{t("status_sold_offline")}</Badge>}
                            {sale.buyerName && <span className="truncate">{sale.buyerName}</span>}
                          </p>
                        </div>
                        <p className="shrink-0 font-sans text-[16px] font-bold text-gray-900">{formatRupees(sale.amount)}</p>
                      </div>
                      {undoable && sale.undoUntil && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 pl-[52px]">
                          <button
                            type="button"
                            onClick={() => void undoSale(sale.id)}
                            className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--color-pill)] px-4 text-[12px] font-semibold text-gray-700"
                          >
                            <Undo2 size={13} />
                            {confirming === `undo-${sale.id}` ? t("log_sale_undo_confirm") : t("log_sale_undo")}
                          </button>
                          <span className="text-[11px] text-gray-400">
                            {fill(t("log_sale_undo_until"), { time: new Date(sale.undoUntil).toLocaleString("en-IN", IST_TIME) })}
                          </span>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>
    </>
  );
}

/**
 * The local price signal and the online comparison for one craft — or, when
 * either is below its threshold, exactly how many more sales it needs.
 */
function CraftInsight({
  t,
  insight,
  label,
  currentUnit,
  standalone = false,
}: {
  t: (key: string) => string;
  insight: Insight | null;
  label: string;
  currentUnit: number | null;
  standalone?: boolean;
}) {
  if (!label) return null;
  if (!insight) return null;

  const { signal, comparison, progress } = insight;
  const needOffline = Math.max(0, progress.minPriceSamples - progress.offlineSamples);

  return (
    <div className={cn("space-y-4", !standalone && "mt-5 border-t border-gray-100 pt-5")}>
      <div>
        <p className="kg-label flex items-center gap-1.5 text-gray-500">
          <Store size={12} /> {t("local_market_signal_label")} · {progress.craftTypeLabel ?? label}
        </p>
        {signal ? (
          <p className="mt-1.5 text-[14px] leading-relaxed text-gray-800">
            {fill(t("local_market_signal_body"), { amount: formatRupees(signal.median), n: signal.sampleSize })}
          </p>
        ) : (
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">
            {needOffline === 1
              ? t("local_market_need_one")
              : fill(t("local_market_need_many"), { n: needOffline })}
          </p>
        )}
      </div>

      <div>
        <p className="kg-label flex items-center gap-1.5 text-gray-500">
          <TrendingUp size={12} /> {t("offline_vs_online_title")}
        </p>
        {comparison ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[var(--color-pill)] px-3 py-2.5">
                <p className="kg-label text-gray-500">{t("earnings_stream_offline")}</p>
                <p className="font-sans text-[17px] font-bold text-gray-900">{formatRupees(comparison.offlineMedian)}</p>
              </div>
              <div className="rounded-xl bg-[var(--color-pill)] px-3 py-2.5">
                <p className="kg-label text-gray-500">{t("earnings_stream_online")}</p>
                <p className="font-sans text-[17px] font-bold text-gray-900">{formatRupees(comparison.onlineMedian)}</p>
              </div>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-800">
              {fill(t(comparison.deltaPct >= 0 ? "offline_vs_online_body" : "offline_vs_online_body_less"), {
                pct: Math.abs(comparison.deltaPct),
              })}
            </p>
            <p className="mt-1 text-[11px] text-gray-500">
              {fill(t("offline_vs_online_samples"), {
                offline: comparison.offlineSampleSize,
                online: comparison.onlineSampleSize,
              })}
            </p>
            {currentUnit !== null && currentUnit > 0 && (
              <p className="mt-1 text-[11px] text-gray-500">
                {fill(t("offline_vs_online_this_sale"), { amount: formatRupees(Math.round(currentUnit)) })}
              </p>
            )}
          </>
        ) : (
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">
            {fill(t("offline_vs_online_not_enough"), {
              offline: progress.offlineSamples,
              online: progress.onlineSamples,
              minOffline: progress.minPriceSamples,
              minOnline: progress.minOnlineSamples,
            })}
          </p>
        )}
      </div>
    </div>
  );
}
