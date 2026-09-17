"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useOfflineQueue } from "@/lib/offlineQueueStore";
import { useLanguage } from "@/lib/translations";
import { fill } from "@/components/buyer/passportFormat";

/**
 * The artisan header's connectivity indicator.
 *
 * Silent when everything is online and nothing is waiting — an always-on
 * "connected" pill is noise. It only speaks when the artisan needs to know
 * something: that they are offline, or that work is still sitting on the phone.
 *
 * Its neighbour, `SyncStatusChip`, is the other half of the answer: this badge
 * is the count, that chip is the freshness. Both read the same store, so they
 * cannot disagree.
 */
export function OfflineQueueBadge({ className = "" }: { className?: string }) {
  const { online, queued, syncing } = useOfflineQueue();
  const { t } = useLanguage();

  if (online && queued === 0 && !syncing) return null;

  const offline = !online;
  const label = offline
    ? queued > 0
      ? fill(t("sync_offline_with_count"), { n: queued })
      : t("sync_offline")
    : syncing
      ? fill(t("sync_uploading"), { n: queued })
      : fill(t("sync_waiting_upload"), { n: queued });

  return (
    <span
      role="status"
      aria-live="polite"
      title={offline ? t("sync_tooltip_offline") : t("sync_tooltip_uploading")}
      aria-label={label}
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
      {/* Narrow screens: the icon carries the state, so only a real count is
          worth the width. The full sentence stays in aria-label and title. */}
      {queued > 0 && <span className="sm:hidden">{queued}</span>}
    </span>
  );
}
