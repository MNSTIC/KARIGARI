"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/lib/translations";
import { fill } from "@/components/buyer/passportFormat";
import { CheckCircle2, CloudOff, Loader2 } from "lucide-react";
import { flushQueue, registerCaptureSync } from "@/lib/offlineSync";
import {
  hydrateLastSynced,
  markSynced,
  markSyncError,
  refreshQueueCount,
  setQueueState,
  useOfflineQueue,
} from "@/lib/offlineQueueStore";

/**
 * Mounted once in the root layout.
 *
 * Owns the connectivity listeners and the queue flush for the whole app, so an
 * artisan who queued a capture on the dashboard and then wandered to the
 * schemes page still gets their upload the moment signal returns. Renders only
 * a small transient toast — the persistent "N saved on phone" indicator is the
 * header badge.
 */
export function OfflineSyncProvider() {
  const { syncing, queued, lastUploaded, online } = useOfflineQueue();
  const { t } = useLanguage();
  /** Kept out of the shared store: purely this component's dismissal state. */
  const [showDone, setShowDone] = useState(false);

  const runFlush = useCallback(async () => {
    const pending = await refreshQueueCount();
    if (pending === 0) return;

    setQueueState({ syncing: true });
    try {
      const result = await flushQueue();
      setQueueState({
        syncing: false,
        queued: result.remaining,
        lastUploaded: result.uploaded,
      });
      // What the chip reports is whether the server could be REACHED. A row the
      // server answered about — a sale whose amount it refuses, a piece already
      // sold online — is the queue's business, and the badge beside the chip
      // counts those. Only a run that reached nobody turns the chip red.
      if (result.contacted) markSynced();
      else if (result.failed > 0) markSyncError("Could not reach the server");
      if (result.uploaded > 0) {
        setShowDone(true);
        // The dashboard reads its items server-side on load, so a refresh is
        // the honest way to show the newly-uploaded craft rather than faking a
        // row the API has not returned.
        window.dispatchEvent(new CustomEvent("karigari:queue-flushed"));
      }
    } catch (error) {
      console.warn("[offlineSync] flush failed:", (error as Error)?.message);
      markSyncError((error as Error)?.message || "Sync failed");
      setQueueState({ syncing: false });
      await refreshQueueCount();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const publishOnline = () => {
      setQueueState({ online: navigator.onLine });
    };

    const handleOnline = () => {
      publishOnline();
      void runFlush();
    };

    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the artisan pages use.
    const kickoff = setTimeout(() => {
      if (cancelled) return;
      publishOnline();
      // The remembered time is read here, not at module load: this file is
      // imported during SSR, and the value must not reach the first paint.
      hydrateLastSynced();
      void refreshQueueCount();
      void registerCaptureSync();
      if (navigator.onLine) void runFlush();
    }, 0);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", publishOnline);

    return () => {
      cancelled = true;
      clearTimeout(kickoff);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", publishOnline);
    };
  }, [runFlush]);

  // The "all uploaded" confirmation is a moment, not a state.
  useEffect(() => {
    if (!showDone) return;
    const timer = setTimeout(() => setShowDone(false), 5000);
    return () => clearTimeout(timer);
  }, [showDone]);

  if (!syncing && !showDone) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] px-4 w-full max-w-sm pointer-events-none"
    >
      <div className="bg-primary text-white rounded-2xl shadow-lg px-4 py-3 flex items-center gap-2.5 text-sm font-medium">
        {syncing ? (
          <>
            <Loader2 size={16} className="animate-spin shrink-0" />
            <span>{fill(t("sync_toast_syncing"), { n: queued })}</span>
          </>
        ) : (
          <>
            <CheckCircle2 size={16} className="shrink-0" />
            <span>
              {fill(t("sync_toast_uploaded"), { n: lastUploaded })}
              {queued > 0 ? ` — ${fill(t("sync_toast_still_waiting"), { n: queued })}` : ""}
            </span>
          </>
        )}
        {!online && <CloudOff size={16} className="ml-auto shrink-0 opacity-80" />}
      </div>
    </div>
  );
}
