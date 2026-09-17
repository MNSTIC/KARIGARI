/**
 * The learn page's copy of its last answer, kept on the phone.
 *
 * A village with no signal should still open to the lessons the artisan saw
 * yesterday, so the last GET /api/artisan/learning-recommendations payload is
 * saved here per language and shown first on every visit, then refreshed in the
 * background. A stale copy is never thrown away while the network is gone:
 * stale content beats an empty page. LEARNING_CACHE_TTL_DAYS only decides how
 * hard the page tries to refresh it.
 *
 * Its own database (`karigari-learning`, version 1), so it can never touch the
 * capture outbox's version history in src/lib/offlineQueue.ts.
 *
 * Scoped to one artisan: every copy carries the artisanId it was fetched for, a
 * fresh answer for a different artisan clears the store, and logging out
 * (src/lib/authClient.ts) clears it too — a shared phone does not show one
 * artisan's stage and earnings to the next.
 *
 * IndexedDB is missing during SSR and throws in some private modes. Every call
 * is wrapped; on failure the cache drops to memory for this page session and
 * logs one console.warn, once.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { LearningPayload } from '@/lib/learningPlan';

const DB_NAME = 'karigari-learning';
const DB_VERSION = 1;
const STORE = 'recommendations';

/** After this long a saved copy is refreshed again whenever the phone reconnects. */
export const LEARNING_CACHE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CachedLearning {
  language: string;
  savedAt: number;
  payload: LearningPayload;
}

/** Used when IndexedDB is unusable, so the page still works within one session. */
const memory = new Map<string, CachedLearning>();
let unusable = false;
let warned = false;
let dbPromise: Promise<IDBPDatabase> | null = null;

function degrade(error: unknown) {
  unusable = true;
  if (!warned) {
    warned = true;
    console.warn('[learningCache] IndexedDB unavailable, keeping lessons in memory only:', (error as Error)?.message);
  }
}

function db(): Promise<IDBPDatabase> | null {
  if (unusable) return null;
  if (typeof indexedDB === 'undefined') {
    unusable = true;
    return null;
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'language' });
        }
      },
      blocking() {
        void dbPromise?.then((database) => database.close());
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

async function readAll(): Promise<CachedLearning[]> {
  const pending = db();
  if (!pending) return [...memory.values()];
  try {
    return (await (await pending).getAll(STORE)) as CachedLearning[];
  } catch (error) {
    degrade(error);
    return [...memory.values()];
  }
}

/**
 * The saved copy for this language, or failing that the newest copy in any
 * language — its curated cards still translate, and its stage is still true.
 */
export async function readLearningCache(language: string): Promise<CachedLearning | null> {
  const rows = (await readAll()).filter((row) => row?.payload?.success === true);
  if (rows.length === 0) return null;
  return rows.find((row) => row.language === language) ?? rows.sort((a, b) => b.savedAt - a.savedAt)[0];
}

export async function writeLearningCache(payload: LearningPayload): Promise<CachedLearning> {
  const row: CachedLearning = { language: payload.language, savedAt: Date.now(), payload };
  const rows = await readAll();
  const otherArtisan = rows.some((existing) => existing.payload?.artisanId !== payload.artisanId);

  if (otherArtisan) memory.clear();
  memory.set(row.language, row);

  const pending = db();
  if (!pending) return row;
  try {
    const database = await pending;
    const tx = database.transaction(STORE, 'readwrite');
    if (otherArtisan) await tx.store.clear();
    await tx.store.put(row);
    await tx.done;
  } catch (error) {
    degrade(error);
  }
  return row;
}

/**
 * Carry a "mark as done" into every saved language for this artisan, so going
 * offline straight after does not bring back the old state.
 */
export async function patchLearningCache(
  artisanId: string,
  patch: Partial<Pick<LearningPayload, 'completed' | 'stage' | 'inputs' | 'earnings'>>
): Promise<void> {
  const rows = (await readAll()).filter((row) => row.payload?.artisanId === artisanId);
  if (rows.length === 0) return;
  const next = rows.map((row) => ({ ...row, payload: { ...row.payload, ...patch } }));
  for (const row of next) memory.set(row.language, row);

  const pending = db();
  if (!pending) return;
  try {
    const database = await pending;
    const tx = database.transaction(STORE, 'readwrite');
    for (const row of next) await tx.store.put(row);
    await tx.done;
  } catch (error) {
    degrade(error);
  }
}

/** Forget every saved copy — called on logout. Never throws. */
export async function clearLearningCache(): Promise<void> {
  memory.clear();
  const pending = db();
  if (!pending) return;
  try {
    await (await pending).clear(STORE);
  } catch (error) {
    degrade(error);
  }
}

/** True once a saved copy is older than LEARNING_CACHE_TTL_DAYS. */
export function isLearningCacheStale(savedAt: number, now: number = Date.now()): boolean {
  return now - savedAt > LEARNING_CACHE_TTL_DAYS * DAY_MS;
}

/** True when this session is running without IndexedDB. */
export function learningCacheIsMemoryOnly(): boolean {
  return unusable;
}
