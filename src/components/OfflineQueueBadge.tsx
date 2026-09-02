"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useOfflineQueue } from "@/lib/offlineQueueStore";

/**
 * The artisan header's connectivity indicator.
 *
 * Silent when everything is online and nothing is waiting — an always-on
 * "connected" pill is noise. It only speaks when the artisan needs to know
 * something: that they are offline, or that work is still sitting on the phone.
 */
export function OfflineQueueBadge({ className = "" }: { className?: string }) {
  const { online, queued, syncing } = useOfflineQueue();

  if (online && queued === 0 && !syncing) return null;

  const offline = !online;
  const label = offline
    ? queued > 0
      ? `Offline — ${queued} saved on phone`
      : "Offline"
    : syncing
      ? `Uploading ${queued}…`
      : `${queued} waiting to upload`;

  return (
    <span
      role="status"
      aria-live="polite"
      title={
        offline
          ? "You have no connection. Captures are saved on this phone and upload automatically."
          : "Saved captures are uploading."
      }
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold whitespace-nowrap min-h-[32px]",
        offline
          ? "bg-amber-50 text-amber-800 border border-amber-200"
          : "bg-[var(--color-mint)] text-primary border border-[var(--color-sage)]/60",
        className,
      ].join(" ")}
    >
      {offline ? (
        <CloudOff size={13} className="shrink-0" />
      ) : (
        <RefreshCw size={13} className={syncing ? "shrink-0 animate-spin" : "shrink-0"} />
      )}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{offline ? (queued > 0 ? queued : "Offline") : queued}</span>
    </span>
  );
}
