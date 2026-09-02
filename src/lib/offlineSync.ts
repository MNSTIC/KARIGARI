/**
 * Draining the on-phone capture queue.
 *
 * Background Sync would be the tidy answer, but it exists only in Chromium — an
 * artisan on an iPhone or on Firefox would never see their queue upload. So the
 * tag is registered where it is supported AND the same flush runs on the
 * `online` event and on app load. Both paths are idempotent: a row is deleted
 * only after the server has accepted it, and a flush already in flight is not
 * started twice.
 */

import { countQueued, listQueued, markAttempt, removeQueued } from '@/lib/offlineQueue';

export const CAPTURE_SYNC_TAG = 'karigari-capture-sync';

export interface FlushResult {
  uploaded: number;
  failed: number;
  /** Rows still on the phone after this run. */
  remaining: number;
}

/** One flush at a time: `online` and mount can otherwise fire together. */
let inFlight: Promise<FlushResult> | null = null;

/**
 * POST every queued capture to `/api/items/capture`.
 *
 * A 4xx is still a failure that keeps the row: the artisan's session may simply
 * have expired while they were offline, and throwing their craft away over a
 * 401 would be exactly the data loss this queue exists to prevent. Attempts are
 * counted so a genuinely poisoned row can be surfaced rather than retried
 * silently forever.
 */
export async function flushQueue(): Promise<FlushResult> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<FlushResult> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { uploaded: 0, failed: 0, remaining: await countQueued() };
    }

    const rows = await listQueued();
    let uploaded = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const res = await fetch('/api/items/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(row.payload),
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data?.item?.id) {
          await removeQueued(row.id);
          uploaded += 1;
        } else {
          await markAttempt(row.id, data?.error || `Upload failed (${res.status})`);
          failed += 1;
        }
      } catch (error) {
        await markAttempt(row.id, (error as Error)?.message || 'Network error');
        failed += 1;
        // The connection dropped again mid-flush. Stop rather than burn the
        // remaining rows' attempt counters on the same dead network.
        break;
      }
    }

    return { uploaded, failed, remaining: await countQueued() };
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Ask the browser to replay the queue on its own once connectivity returns.
 *
 * Chromium only, and it never replaces the listener-driven flush — it is the
 * extra guarantee that the upload happens even if the app is closed.
 */
export async function registerCaptureSync(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sync = (registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    }).sync;
    if (!sync) return false;
    await sync.register(CAPTURE_SYNC_TAG);
    return true;
  } catch {
    // Denied permission, or no service worker in this environment. The
    // `online` listener still covers it.
    return false;
  }
}
