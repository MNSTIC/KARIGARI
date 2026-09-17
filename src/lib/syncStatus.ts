import { relativeSince, type RelativeTime } from '@/lib/relativeTime';

/**
 * What the header's sync chip should say.
 *
 * Pure, so the four states and their edges (never synced, a clock running fast,
 * offline with nothing queued versus offline with three things queued) are
 * decided in one tested place rather than inside JSX.
 *
 * The chip reports the freshness of the last *confirmed* round-trip to the
 * server. Nothing here starts one: no timer in this app polls to keep the chip
 * warm, because manufacturing a request so a label can look fresh would spend
 * an artisan's data to tell them something that was already true.
 */

export type SyncTone = 'offline' | 'syncing' | 'synced' | 'error' | 'unknown';

export interface SyncView {
  tone: SyncTone;
  /** The i18n key for the label. */
  labelKey: string;
  /** Rows waiting on this phone, when that is part of the label. */
  queued: number;
  /** Present only in the `synced` tone. */
  relative: RelativeTime | null;
  /** True when the chip offers a retry (and therefore takes a tap). */
  retryable: boolean;
}

export interface SyncInputs {
  online: boolean;
  queued: number;
  syncing: boolean;
  /** Epoch ms of the last confirmed round-trip, or null before any. */
  lastSyncedAt: number | null;
  lastSyncError: string | null;
  /**
   * False on the server and on the first client paint. A relative time cannot
   * be rendered before then without risking a hydration mismatch, so the chip
   * shows its state without a time until the deferred effect has run.
   */
  ready?: boolean;
  now?: number;
}

export function syncView(input: SyncInputs): SyncView {
  const queued = Math.max(0, input.queued || 0);
  const base = { queued, relative: null as RelativeTime | null, retryable: false };

  // Offline first: it is the state the artisan most needs to recognise, and it
  // explains any queue count next to it.
  if (!input.online) {
    return { ...base, tone: 'offline', labelKey: queued > 0 ? 'sync_offline_with_count' : 'sync_offline' };
  }

  if (input.syncing) return { ...base, tone: 'syncing', labelKey: 'sync_syncing' };

  // An error is only worth showing while there is still something to retry; a
  // failed flush that later emptied the queue is not the artisan's problem.
  if (input.lastSyncError) {
    return { ...base, tone: 'error', labelKey: 'sync_error', retryable: true };
  }

  if (input.lastSyncedAt === null) {
    return { ...base, tone: 'unknown', labelKey: 'sync_never' };
  }

  if (!input.ready) {
    // Same state, no time yet — the first paint must match the server's.
    return { ...base, tone: 'synced', labelKey: 'sync_synced_no_time' };
  }

  return {
    ...base,
    tone: 'synced',
    labelKey: 'sync_synced',
    relative: relativeSince(input.lastSyncedAt, input.now ?? Date.now()),
  };
}
