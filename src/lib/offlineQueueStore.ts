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
import { countQueued } from '@/lib/offlineQueue';

export interface OfflineQueueState {
  online: boolean;
  queued: number;
  /** Set while a flush is running, so the UI can say "Syncing N…". */
  syncing: boolean;
  /** Uploaded in the last completed flush; drives the "all uploaded" toast. */
  lastUploaded: number;
}

let state: OfflineQueueState = {
  // Optimistic on the server: `navigator` does not exist during SSR, and
  // rendering "offline" then correcting it would flash the badge on every load.
  online: true,
  queued: 0,
  syncing: false,
  lastUploaded: 0,
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
    next.lastUploaded === state.lastUploaded
  ) {
    return;
  }
  state = next;
  emit();
}

/** Re-read the count from IndexedDB and publish it. */
export async function refreshQueueCount(): Promise<number> {
  const queued = await countQueued();
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
};

export function useOfflineQueue(): OfflineQueueState {
  return useSyncExternalStore(subscribe, getQueueState, () => SERVER_SNAPSHOT);
}
