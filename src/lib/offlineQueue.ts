/**
 * The on-phone capture queue.
 *
 * An artisan in a weaving cluster loses signal constantly. Before this, a
 * capture made without a network simply failed — the photographs, the spoken
 * description and the price were gone, and the only recovery was to do the
 * whole flow again with signal. IndexedDB is the only browser store big enough
 * to hold the photos (localStorage caps out around 5 MB and throws), so the
 * exact `/api/items/capture` request body is parked here and replayed later.
 *
 * Per device by design: this is a durable outbox, not a sync engine. Rows leave
 * the store only when the server has accepted them.
 *
 * Version 2 adds a second outbox, `offlineSales`, for sales logged at a haat
 * with no signal (POST /api/artisan/offline-sales). The upgrade is additive: it
 * creates the new store and never touches `captures`, so an artisan with
 * captures already queued keeps every one of them.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { PhotoStudioFields } from '@/lib/photoStudioPayload';
import type { OfflineSaleErrorCode, OfflineSalePayload } from '@/lib/offlineSales';

const DB_NAME = 'karigari-offline';
const DB_VERSION = 2;
const STORE = 'captures';
const SALES_STORE = 'offlineSales';

/**
 * The `/api/items/capture` POST body, verbatim.
 *
 * Deliberately typed as the request rather than as a domain object: whatever
 * the capture modal sends online is exactly what gets replayed, so the two
 * paths can never drift into producing different items.
 */
export interface CapturePayload extends PhotoStudioFields {
  // V11 photo-studio fields come from PhotoStudioFields, all optional: a row
  // queued before V11 replays exactly as it did, and one queued after keeps
  // its original frame and looks through the replay.
  craftType: string;
  laborDays: number;
  rawMaterialCost: number;
  askingPrice: number | null;
  descriptionOriginal: string;
  descriptionEnglish: string;
  tags: string[];
  /** Compressed data URLs — `downscaleImage` has already run on these. */
  images: string[];
  aiGeneratedListing: string;

  // ---- Revised capture pipeline artefacts (spec Steps 3-7). Optional so
  // an older queued row (pre-migration) still replays cleanly. ----
  aiCatalog?: {
    title_en: string;
    desc_en: string;
    title_regional: string;
    desc_regional: string;
    category: string;
    tags: string[];
  } | null;
  aiPriceCeiling?: number | null;
  aiMarketAvg?: number | null;
  /** Optional raw-material bill as a data URL. Null when none was attached. */
  rawMaterialProofUrl?: string | null;
  claimsFlag?: 'none' | 'exorbitant_labor' | 'exorbitant_material' | 'both' | null;
  aiTier?: 'A' | 'B' | null;
  advanceEligible?: boolean | null;
}

export interface QueuedCapture {
  /** Local id. Never sent to the server; only used to delete the row. */
  id: string;
  createdAt: number;
  /** Failed replay attempts, so a permanently-rejected row can be surfaced. */
  attempts: number;
  lastError?: string;
  payload: CapturePayload;
}

/** IndexedDB is absent in SSR and blocked in some private modes. */
function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** One sale logged on the phone while the network was gone. */
export interface QueuedOfflineSale {
  /** Local id. Never sent to the server; only used to update or delete the row. */
  id: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /**
   * Why the server refused it, when it did. A code in
   * TERMINAL_OFFLINE_SALE_CODES means retrying will not help — the artisan has
   * to change something — so the flush leaves the row alone until they do.
   */
  lastErrorCode?: OfflineSaleErrorCode;
  /** The piece's online sale date for PIECE_SOLD_ONLINE, so the page can say when. */
  soldOnlineAt?: string;
  /** What the artisan typed or said, as the POST body. The amount is never dropped. */
  payload: OfflineSalePayload;
  /** The piece's name at the time, for display only; not sent. */
  pieceLabel?: string | null;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      // Each store is created only if it is missing, so this runs safely from
      // an empty database (v0) and from a v1 one that already holds captures.
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
        if (!database.objectStoreNames.contains(SALES_STORE)) {
          const sales = database.createObjectStore(SALES_STORE, { keyPath: 'id' });
          sales.createIndex('createdAt', 'createdAt');
        }
      },
      // Another tab is opening a newer version: step aside so its upgrade is
      // not blocked, and reopen lazily on the next call.
      blocking() {
        void dbPromise?.then((database) => database.close());
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

function localId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Park one capture on the phone.
 *
 * Returns the stored row so the caller can show the artisan what was saved.
 * Throws only if IndexedDB itself is unusable — the modal treats that as a hard
 * failure and says so, rather than pretending the craft was saved.
 */
export async function queueCapture(payload: CapturePayload): Promise<QueuedCapture> {
  if (!hasIndexedDB()) {
    throw new Error('This browser cannot save captures offline.');
  }
  const row: QueuedCapture = {
    id: localId(),
    createdAt: Date.now(),
    attempts: 0,
    payload,
  };
  const database = await db();
  await database.put(STORE, row);
  return row;
}

/** Oldest first, so the queue uploads in the order the artisan made them. */
export async function listQueued(): Promise<QueuedCapture[]> {
  if (!hasIndexedDB()) return [];
  try {
    const database = await db();
    const rows: QueuedCapture[] = await database.getAll(STORE);
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  } catch (error) {
    console.warn('[offlineQueue] read failed:', (error as Error)?.message);
    return [];
  }
}

export async function removeQueued(id: string): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const database = await db();
    await database.delete(STORE, id);
  } catch (error) {
    console.warn('[offlineQueue] delete failed:', (error as Error)?.message);
  }
}

export async function countQueued(): Promise<number> {
  if (!hasIndexedDB()) return 0;
  try {
    const database = await db();
    return await database.count(STORE);
  } catch {
    return 0;
  }
}

/**
 * Record a failed replay without dropping the row.
 *
 * A network error must not cost the artisan their capture, so the attempt
 * counter and the message are kept and the payload stays queued.
 */
export async function markAttempt(id: string, error: string): Promise<void> {
  await markAttemptIn(STORE, id, { lastError: error });
}

/** The shared half of both stores' attempt bookkeeping. */
async function markAttemptIn(store: string, id: string, patch: Record<string, unknown>): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const database = await db();
    const row: { attempts: number } | undefined = await database.get(store, id);
    if (!row) return;
    await database.put(store, { ...row, ...patch, attempts: row.attempts + 1 });
  } catch (err) {
    console.warn('[offlineQueue] attempt update failed:', (err as Error)?.message);
  }
}

// ---------------------------------------------------------------------------
// Offline sales — the same four operations as captures, on their own store
// ---------------------------------------------------------------------------

/** Park one sale on the phone. Throws only if IndexedDB itself is unusable. */
export async function queueOfflineSale(
  payload: OfflineSalePayload,
  pieceLabel: string | null = null
): Promise<QueuedOfflineSale> {
  if (!hasIndexedDB()) {
    throw new Error('This browser cannot save sales offline.');
  }
  const row: QueuedOfflineSale = {
    id: localId(),
    createdAt: Date.now(),
    attempts: 0,
    payload,
    pieceLabel,
  };
  const database = await db();
  await database.put(SALES_STORE, row);
  return row;
}

/** Oldest first, so sales upload in the order the artisan logged them. */
export async function listQueuedOfflineSales(): Promise<QueuedOfflineSale[]> {
  if (!hasIndexedDB()) return [];
  try {
    const database = await db();
    const rows: QueuedOfflineSale[] = await database.getAll(SALES_STORE);
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  } catch (error) {
    console.warn('[offlineQueue] sales read failed:', (error as Error)?.message);
    return [];
  }
}

export async function removeQueuedOfflineSale(id: string): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const database = await db();
    await database.delete(SALES_STORE, id);
  } catch (error) {
    console.warn('[offlineQueue] sales delete failed:', (error as Error)?.message);
  }
}

export async function countQueuedOfflineSales(): Promise<number> {
  if (!hasIndexedDB()) return 0;
  try {
    const database = await db();
    return await database.count(SALES_STORE);
  } catch {
    return 0;
  }
}

/** Record a refused or failed replay, keeping the payload — and its amount — intact. */
export async function markOfflineSaleAttempt(
  id: string,
  error: string,
  code?: OfflineSaleErrorCode,
  soldOnlineAt?: string
): Promise<void> {
  await markAttemptIn(SALES_STORE, id, { lastError: error, lastErrorCode: code, soldOnlineAt });
}

/**
 * The artisan acted on a refused row — "save it without that piece", "the
 * amount is right". The payload changes and the refusal is cleared, so the next
 * flush tries again.
 */
export async function reviseQueuedOfflineSale(id: string, patch: Partial<OfflineSalePayload>): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const database = await db();
    const row: QueuedOfflineSale | undefined = await database.get(SALES_STORE, id);
    if (!row) return;
    const next: QueuedOfflineSale = {
      ...row,
      payload: { ...row.payload, ...patch },
      pieceLabel: patch.craftItemId === null ? null : row.pieceLabel,
      lastError: undefined,
      lastErrorCode: undefined,
      soldOnlineAt: undefined,
    };
    await database.put(SALES_STORE, next);
  } catch (error) {
    console.warn('[offlineQueue] sales revise failed:', (error as Error)?.message);
  }
}
