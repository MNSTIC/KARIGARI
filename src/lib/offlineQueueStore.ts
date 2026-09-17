"use client";

/**
 * One shared reading of "am I online, and how much is waiting on this phone".
 *
 * Three separate surfaces need it — the header badge, the capture modal's
 * success screen and the sync toast — and if each kept its own `useState` they
 * would disagree the moment one of them queued an item. A module-level store
 * with subscribers keeps them on the same number without pulling in a state
 * library.
 */

import { useSyncExternalStore } from 'react';
import { countQueued, countQueuedOfflineSales } from '@/lib/offlineQueue';

export interface OfflineQueueState {
  online: boolean;
  /** Everything waiting on this phone: queued captures plus queued sales. */
  queued: number;
  /** Set while a flush is running, so the UI can say "Syncing N…". */
  syncing: boolean;
  /** Uploaded in the last completed flush; drives the "all uploaded" toast. */
  lastUploaded: number;
  /**
   * Epoch ms of the last CONFIRMED round-trip to the server — a request that
   * came back, not merely an attempt. Null before any. Persisted to
   * localStorage so a reload does not claim the work has never synced.
   */
  lastSyncedAt: number | null;
  /** Set when a flush attempt failed, so the chip can say so. Cleared on success. */
  lastSyncError: string | null;
}

/** Where `lastSyncedAt` survives a reload. */
export const LAST_SYNCED_KEY = 'karigari_last_synced';

let state: OfflineQueueState = {
  // Optimistic on the server: `navigator` does not exist during SSR, and
  // rendering "offline" then correcting it would flash the badge on every load.
  online: true,
  queued: 0,
  syncing: false,
  lastUploaded: 0,
  lastSyncedAt: null,
  lastSyncError: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getQueueState(): OfflineQueueState {
  return state;
}

export function setQueueState(patch: Partial<OfflineQueueState>) {
  const next = { ...state, ...patch };
  if (
    next.online === state.online &&
    next.queued === state.queued &&
    next.syncing === state.syncing &&
    next.lastUploaded === state.lastUploaded &&
    next.lastSyncedAt === state.lastSyncedAt &&
    next.lastSyncError === state.lastSyncError
  ) {
    return;
  }
  state = next;
  emit();
}

/** Re-read the count from IndexedDB and publish it. */
export async function refreshQueueCount(): Promise<number> {
  const [captures, sales] = await Promise.all([countQueued(), countQueuedOfflineSales()]);
  const queued = captures + sales;
  setQueueState({ queued });
  return queued;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Server snapshot is the same object every time on purpose — returning a fresh
 * literal makes `useSyncExternalStore` loop forever.
 */
const SERVER_SNAPSHOT: OfflineQueueState = {
  online: true,
  queued: 0,
  syncing: false,
  lastUploaded: 0,
  lastSyncedAt: null,
  lastSyncError: null,
};

export function useOfflineQueue(): OfflineQueueState {
  return useSyncExternalStore(subscribe, getQueueState, () => SERVER_SNAPSHOT);
}

/* -------------------------------------------------------------------------- */
/*  Last confirmed round-trip                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Record a request that actually came back.
 *
 * Called from the queue flush when it contacted the server, and from the
 * header bell's successful load — one confirmed round-trip per navigation,
 * which is the granularity the chip claims. Nothing in this app polls to
 * manufacture one.
 */
export function markSynced(at: number = Date.now()): void {
  setQueueState({ lastSyncedAt: at, lastSyncError: null });
  try {
    localStorage.setItem(LAST_SYNCED_KEY, String(at));
  } catch {
    // Private mode, or storage disabled. The chip still works; it simply
    // forgets the time on reload.
  }
}

/** Record a failed attempt, so the chip can offer a retry. */
export function markSyncError(message: string): void {
  setQueueState({ lastSyncError: message || 'Sync failed', syncing: false });
}

/**
 * Restore the remembered time on first client render.
 *
 * Deliberately not read at module load: this module is imported during SSR,
 * where `localStorage` does not exist, and the value must not reach the first
 * paint anyway — `SERVER_SNAPSHOT` has to match it.
 */
export function hydrateLastSynced(): void {
  try {
    const raw = localStorage.getItem(LAST_SYNCED_KEY);
    const at = raw === null ? NaN : Number(raw);
    if (Number.isFinite(at) && at > 0) setQueueState({ lastSyncedAt: at });
  } catch {
    /* Nothing remembered; the chip starts from "no sync yet". */
  }
}
