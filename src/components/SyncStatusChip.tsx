"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CloudCheck, CloudOff, RefreshCw } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { markSynced, markSyncError, setQueueState, useOfflineQueue } from "@/lib/offlineQueueStore";
import { flushQueue } from "@/lib/offlineSync";
import { syncView, type SyncTone } from "@/lib/syncStatus";
import { REL_JUST_NOW } from "@/lib/relativeTime";
import { fill } from "@/components/buyer/passportFormat";
import { cn } from "@/lib/utils";

/**
 * "Synced 2 min ago" in the header — the quiet reassurance that the work is
 * safe.
 *
 * Complementary to `OfflineQueueBadge`, which stays silent when there is
 * nothing waiting: that one is a count, this one is freshness.
 *
 * **Hydration.** A relative time cannot be server-rendered, so the first paint
 * shows the state without a time and the time is filled in inside the deferred
 * `setTimeout(…, 0)` effect this codebase uses everywhere. The 30-second timer
 * below re-renders that *string* only — it makes no request. Nothing in this
 * app polls the server to keep this label fresh; the chip reports the last
 * confirmed round-trip (a queue flush that reached the server, or the header
 * bell's load), and says "no sync yet" until there has been one.
 */

const TONES: Record<SyncTone, string> = {
  offline: "bg-amber-50 text-amber-800 border-amber-200",
  syncing: "bg-[var(--color-mint)] text-primary border-[var(--color-sage)]/60",
  synced: "bg-green-50 text-green-700 border-green-200/70",
  error: "bg-red-50 text-red-700 border-red-100",
  unknown: "bg-gray-100 text-gray-600 border-gray-200",
};

/** How often the relative string is recomputed. No network involved. */
const TICK_MS = 30_000;

function IconFor({ tone }: { tone: SyncTone }) {
  if (tone === "offline") return <CloudOff size={13} className="shrink-0" aria-hidden />;
  if (tone === "syncing") return <RefreshCw size={13} className="shrink-0 animate-spin" aria-hidden />;
  if (tone === "error") return <AlertTriangle size={13} className="shrink-0" aria-hidden />;
  if (tone === "unknown") return <CloudOff size={13} className="shrink-0 opacity-70" aria-hidden />;
  return <CloudCheck size={13} className="shrink-0" aria-hidden />;
}

export function SyncStatusChip({ className = "" }: { className?: string }) {
  const { t } = useLanguage();
  const { online, queued, syncing, lastSyncedAt, lastSyncError } = useOfflineQueue();
  /** False until the deferred effect runs, which is what keeps the first paint stable. */
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const kickoff = setTimeout(() => setReady(true), 0);
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, []);

  // `tick` is read so the relative string is recomputed on each interval.
  void tick;
  const view = syncView({ online, queued, syncing, lastSyncedAt, lastSyncError, ready });

  const relative = view.relative
    ? view.relative.key === REL_JUST_NOW
      ? t(REL_JUST_NOW)
      : fill(t(view.relative.key), { n: view.relative.value })
    : "";
  const label = fill(t(view.labelKey), { n: view.queued, time: relative });

  const retry = async () => {
    setQueueState({ syncing: true });
    try {
      const result = await flushQueue();
      setQueueState({ syncing: false, queued: result.remaining, lastUploaded: result.uploaded });
      if (result.contacted) markSynced();
      else markSyncError("Could not reach the server");
    } catch (error) {
      markSyncError((error as Error)?.message || "Sync failed");
      setQueueState({ syncing: false });
    }
  };

  const classes = cn(
    "inline-flex min-h-[32px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[11px] font-bold",
    TONES[view.tone],
    className
  );
  // The label is the accessible name on narrow screens, where only the icon is
  // drawn; the title carries what is actually kept on the phone, so a demo with
  // the wifi switched off explains itself.
  const shared = {
    title: `${label} — ${t("sync_tooltip")}`,
    "aria-label": view.retryable ? `${label}: ${t("sync_retry")}` : label,
  };

  if (view.retryable) {
    return (
      <button type="button" onClick={retry} role="alert" {...shared} className={cn(classes, "kg-press")}>
        <IconFor tone={view.tone} />
        <span className="hidden sm:inline">{label}</span>
        <span className="hidden font-semibold underline underline-offset-2 sm:inline">{t("sync_retry")}</span>
      </button>
    );
  }

  return (
    <span role="status" aria-live="polite" {...shared} className={classes}>
      <IconFor tone={view.tone} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
