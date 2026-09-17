/**
 * Draining the on-phone queues: captures, and sales logged with no signal.
 *
 * Background Sync would be the tidy answer, but it exists only in Chromium — an
 * artisan on an iPhone or on Firefox would never see their queue upload. So the
 * tag is registered where it is supported AND the same flush runs on the
 * `online` event and on app load. Both paths are idempotent: a row is deleted
 * only after the server has accepted it, and a flush already in flight is not
 * started twice.
 */

import {
  countQueued,
  countQueuedOfflineSales,
  listQueued,
  listQueuedOfflineSales,
  markAttempt,
  markOfflineSaleAttempt,
  removeQueued,
  removeQueuedOfflineSale,
} from '@/lib/offlineQueue';
import { TERMINAL_OFFLINE_SALE_CODES, type OfflineSaleErrorCode } from '@/lib/offlineSales';

export const CAPTURE_SYNC_TAG = 'karigari-capture-sync';

export interface FlushCounts {
  uploaded: number;
  failed: number;
  /** Rows of this kind still on the phone after this run. */
  remaining: number;
}

/** Set the moment any request comes back, however it answered. */
interface Reachability {
  contacted: boolean;
}

export interface FlushResult {
  /** Across both queues. */
  uploaded: number;
  failed: number;
  /** Rows still on the phone after this run, across both queues. */
  remaining: number;
  /** The same three numbers, per queue. */
  captures: FlushCounts;
  offlineSales: FlushCounts;
  /**
   * True when the server answered at least one request in this run — the only
   * honest basis for the header chip's "synced" time. An empty queue contacts
   * nobody, so an empty drain leaves this false rather than claiming a
   * round-trip that never happened.
   */
  contacted: boolean;
}

/** One flush at a time: `online` and mount can otherwise fire together. */
let inFlight: Promise<FlushResult> | null = null;

function isTerminal(code: string | undefined): boolean {
  return Boolean(code) && (TERMINAL_OFFLINE_SALE_CODES as readonly string[]).includes(code as string);
}

/**
 * POST every queued capture to `/api/items/capture`.
 *
 * A 4xx is still a failure that keeps the row: the artisan's session may simply
 * have expired while they were offline, and throwing their craft away over a
 * 401 would be exactly the data loss this queue exists to prevent. Attempts are
 * counted so a genuinely poisoned row can be surfaced rather than retried
 * silently forever.
 *
 * Returns false when the network dropped mid-run, so the caller stops too.
 */
async function flushCaptures(counts: FlushCounts, reach: Reachability): Promise<boolean> {
  const rows = await listQueued();
  for (const row of rows) {
    try {
      const res = await fetch('/api/items/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row.payload),
      });
      reach.contacted = true;
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.item?.id) {
        await removeQueued(row.id);
        counts.uploaded += 1;
      } else {
        await markAttempt(row.id, data?.error || `Upload failed (${res.status})`);
        counts.failed += 1;
      }
    } catch (error) {
      await markAttempt(row.id, (error as Error)?.message || 'Network error');
      counts.failed += 1;
      // The connection dropped again mid-flush. Stop rather than burn the
      // remaining rows' attempt counters on the same dead network.
      return false;
    }
  }
  return true;
}

/**
 * POST every queued sale to `/api/artisan/offline-sales`.
 *
 * A refusal the artisan has to act on — the piece sold online while this sat
 * on the phone, an amount that needs confirming — is recorded with its code and
 * then left alone: replaying it would get the same answer. The row, and the
 * amount in it, stay until the artisan decides what to do.
 */
async function flushOfflineSales(counts: FlushCounts, reach: Reachability): Promise<void> {
  const rows = await listQueuedOfflineSales();
  for (const row of rows) {
    if (isTerminal(row.lastErrorCode)) continue;
    try {
      const res = await fetch('/api/artisan/offline-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row.payload),
      });
      reach.contacted = true;
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.sale?.id) {
        await removeQueuedOfflineSale(row.id);
        counts.uploaded += 1;
      } else {
        await markOfflineSaleAttempt(
          row.id,
          data?.error || `Upload failed (${res.status})`,
          typeof data?.code === 'string' ? (data.code as OfflineSaleErrorCode) : undefined,
          typeof data?.soldOnlineAt === 'string' ? data.soldOnlineAt : undefined
        );
        counts.failed += 1;
      }
    } catch (error) {
      await markOfflineSaleAttempt(row.id, (error as Error)?.message || 'Network error');
      counts.failed += 1;
      return;
    }
  }
}

export async function flushQueue(): Promise<FlushResult> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<FlushResult> => {
    const captures: FlushCounts = { uploaded: 0, failed: 0, remaining: 0 };
    const offlineSales: FlushCounts = { uploaded: 0, failed: 0, remaining: 0 };
    const reach: Reachability = { contacted: false };

    const online = typeof navigator === 'undefined' || navigator.onLine;
    if (online) {
      const stillOnline = await flushCaptures(captures, reach);
      if (stillOnline) await flushOfflineSales(offlineSales, reach);
    }

    captures.remaining = await countQueued();
    offlineSales.remaining = await countQueuedOfflineSales();

    return {
      uploaded: captures.uploaded + offlineSales.uploaded,
      failed: captures.failed + offlineSales.failed,
      remaining: captures.remaining + offlineSales.remaining,
      captures,
      offlineSales,
      contacted: reach.contacted,
    };
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
