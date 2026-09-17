/**
 * What the header's sync chip claims, and when.
 *
 * The chip is a promise to the artisan that their work is safe, so the states
 * are pinned here: offline outranks everything, a time is only shown once there
 * has been a confirmed round-trip, a clock running fast reads "just now" rather
 * than a negative age, and the first paint carries no relative time at all —
 * that is what keeps hydration quiet.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/syncStatus.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-sync-'));
async function compile(entry, name) {
  const outfile = path.join(outDir, name);
  await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
  return import(pathToFileURL(outfile).href);
}
const rel = await compile('src/lib/relativeTime.ts', 'relativeTime.mjs');
const sync = await compile('src/lib/syncStatus.ts', 'syncStatus.mjs');

let failures = 0;
let checks = 0;
function test(name, fn) {
  checks += 1;
  try {
    fn();
  } catch (e) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${e.message.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ------------------------------------------------------------ relative time

test('under a minute is "just now", with no number to render', () => {
  for (const ms of [0, 1, 999, 59 * SECOND]) {
    assert.deepEqual(rel.relativeKeyAndValue(ms), { key: 'rel_just_now', value: 0 }, String(ms));
  }
});

test('minutes, hours and days each start exactly on their boundary', () => {
  assert.deepEqual(rel.relativeKeyAndValue(MINUTE), { key: 'rel_minutes', value: 1 });
  assert.deepEqual(rel.relativeKeyAndValue(2 * MINUTE + 30 * SECOND), { key: 'rel_minutes', value: 2 });
  assert.deepEqual(rel.relativeKeyAndValue(59 * MINUTE), { key: 'rel_minutes', value: 59 });
  assert.deepEqual(rel.relativeKeyAndValue(HOUR), { key: 'rel_hours', value: 1 });
  assert.deepEqual(rel.relativeKeyAndValue(23 * HOUR + 59 * MINUTE), { key: 'rel_hours', value: 23 });
  assert.deepEqual(rel.relativeKeyAndValue(DAY), { key: 'rel_days', value: 1 });
  assert.deepEqual(rel.relativeKeyAndValue(9 * DAY + 5 * HOUR), { key: 'rel_days', value: 9 });
});

test('a clock running fast, or a broken number, reads "just now" — never a negative age', () => {
  assert.deepEqual(rel.relativeKeyAndValue(-5 * MINUTE), { key: 'rel_just_now', value: 0 });
  assert.deepEqual(rel.relativeKeyAndValue(NaN), { key: 'rel_just_now', value: 0 });
  assert.deepEqual(rel.relativeSince(Date.now() + 10 * MINUTE), { key: 'rel_just_now', value: 0 });
});

test('every key it can return is one of the four published ones', () => {
  const keys = new Set([rel.REL_JUST_NOW, rel.REL_MINUTES, rel.REL_HOURS, rel.REL_DAYS]);
  for (const ms of [0, MINUTE, HOUR, DAY, 400 * DAY]) assert.ok(keys.has(rel.relativeKeyAndValue(ms).key));
});

// ----------------------------------------------------------------- the chip

const NOW = 1_800_000_000_000;
const base = { online: true, queued: 0, syncing: false, lastSyncedAt: NOW - 2 * MINUTE, lastSyncError: null, ready: true, now: NOW };

test('online and freshly synced: the time is shown', () => {
  const view = sync.syncView(base);
  assert.equal(view.tone, 'synced');
  assert.equal(view.labelKey, 'sync_synced');
  assert.deepEqual(view.relative, { key: 'rel_minutes', value: 2 });
  assert.equal(view.retryable, false);
});

test('before the deferred effect runs there is no relative time (hydration safety)', () => {
  const view = sync.syncView({ ...base, ready: false });
  assert.equal(view.tone, 'synced');
  assert.equal(view.labelKey, 'sync_synced_no_time');
  assert.equal(view.relative, null);
});

test('never synced says so instead of inventing a time', () => {
  const view = sync.syncView({ ...base, lastSyncedAt: null });
  assert.equal(view.tone, 'unknown');
  assert.equal(view.labelKey, 'sync_never');
  assert.equal(view.relative, null);
});

test('offline with nothing queued, and offline with three queued, are different sentences', () => {
  const empty = sync.syncView({ ...base, online: false });
  assert.equal(empty.tone, 'offline');
  assert.equal(empty.labelKey, 'sync_offline');
  assert.equal(empty.queued, 0);
  const loaded = sync.syncView({ ...base, online: false, queued: 3 });
  assert.equal(loaded.labelKey, 'sync_offline_with_count');
  assert.equal(loaded.queued, 3);
});

test('offline outranks syncing, an error and a remembered time', () => {
  const view = sync.syncView({ ...base, online: false, syncing: true, lastSyncError: 'boom' });
  assert.equal(view.tone, 'offline');
  assert.equal(view.relative, null);
  assert.equal(view.retryable, false);
});

test('a running flush says so', () => {
  const view = sync.syncView({ ...base, syncing: true });
  assert.equal(view.tone, 'syncing');
  assert.equal(view.labelKey, 'sync_syncing');
});

test('a failed flush is an error the artisan can retry', () => {
  const view = sync.syncView({ ...base, lastSyncError: 'Upload failed (500)' });
  assert.equal(view.tone, 'error');
  assert.equal(view.labelKey, 'sync_error');
  assert.equal(view.retryable, true);
  // And it clears the moment a sync succeeds — the store nulls the error,
  // which is this input.
  assert.equal(sync.syncView({ ...base, lastSyncError: null }).tone, 'synced');
});

test('a negative or missing queue count never renders as a number', () => {
  assert.equal(sync.syncView({ ...base, online: false, queued: -3 }).queued, 0);
  assert.equal(sync.syncView({ ...base, online: false, queued: undefined }).labelKey, 'sync_offline');
});

test('an old sync still reads as synced, in days', () => {
  const view = sync.syncView({ ...base, lastSyncedAt: NOW - 3 * DAY });
  assert.equal(view.tone, 'synced');
  assert.deepEqual(view.relative, { key: 'rel_days', value: 3 });
});

// ------------------------------------------------- remembering the time

/** A localStorage that can be told to fail, like a private-mode browser. */
function fakeStorage({ broken = false } = {}) {
  const map = new Map();
  return {
    getItem: (k) => { if (broken) throw new Error("blocked"); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (broken) throw new Error("blocked"); map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const store = await compile('src/lib/offlineQueueStore.ts', 'offlineQueueStore.mjs');

test('a confirmed sync is remembered in localStorage and read back on the next load', () => {
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  store.markSynced(1_700_000_000_000);
  assert.equal(storage._map.get(store.LAST_SYNCED_KEY), '1700000000000');
  assert.equal(store.getQueueState().lastSyncedAt, 1_700_000_000_000);
  // A fresh page: the store starts empty and hydrates from what was stored.
  store.setQueueState({ lastSyncedAt: null });
  assert.equal(store.getQueueState().lastSyncedAt, null);
  store.hydrateLastSynced();
  assert.equal(store.getQueueState().lastSyncedAt, 1_700_000_000_000);
});

test('a success clears a previous error, and an error does not erase the remembered time', () => {
  globalThis.localStorage = fakeStorage();
  store.markSynced(1_700_000_000_000);
  store.markSyncError('Could not reach the server');
  assert.equal(store.getQueueState().lastSyncError, 'Could not reach the server');
  assert.equal(store.getQueueState().lastSyncedAt, 1_700_000_000_000);
  assert.equal(store.getQueueState().syncing, false);
  store.markSynced(1_700_000_060_000);
  assert.equal(store.getQueueState().lastSyncError, null);
  assert.equal(store.getQueueState().lastSyncedAt, 1_700_000_060_000);
});

test('storage that throws (private mode) costs the memory, not the feature', () => {
  globalThis.localStorage = fakeStorage({ broken: true });
  store.setQueueState({ lastSyncedAt: null, lastSyncError: null });
  store.markSynced(1_700_000_120_000);
  assert.equal(store.getQueueState().lastSyncedAt, 1_700_000_120_000);
  store.setQueueState({ lastSyncedAt: null });
  store.hydrateLastSynced();
  assert.equal(store.getQueueState().lastSyncedAt, null);
});

test('the server snapshot carries every field, or useSyncExternalStore warns', () => {
  globalThis.localStorage = fakeStorage();
  store.setQueueState({ lastSyncedAt: 1, lastSyncError: 'x', queued: 2, syncing: true, lastUploaded: 3 });
  const live = store.getQueueState();
  const snapshotKeys = ['online', 'queued', 'syncing', 'lastUploaded', 'lastSyncedAt', 'lastSyncError'];
  assert.deepEqual(Object.keys(live).sort(), snapshotKeys.slice().sort());
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} sync-status checks failed`);
  process.exit(1);
}
console.log(`syncStatus: all ${checks} checks passed`);
