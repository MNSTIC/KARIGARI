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
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'karigari-offline';
const DB_VERSION = 1;
const STORE = 'captures';

/**
 * The `/api/items/capture` POST body, verbatim.
 *
 * Deliberately typed as the request rather than as a domain object: whatever
 * the capture modal sends online is exactly what gets replayed, so the two
 * paths can never drift into producing different items.
 */
export interface CapturePayload {
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

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
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
  if (!hasIndexedDB()) return;
  try {
    const database = await db();
    const row: QueuedCapture | undefined = await database.get(STORE, id);
    if (!row) return;
    await database.put(STORE, { ...row, attempts: row.attempts + 1, lastError: error });
  } catch (err) {
    console.warn('[offlineQueue] attempt update failed:', (err as Error)?.message);
  }
}
