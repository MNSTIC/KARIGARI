/**
 * What a badge is allowed to claim.
 *
 * The rule this file exists to enforce: a badge is a statement that something
 * really happened. So every criterion is checked at its exact boundary, a
 * locked badge must state a gap the artisan can act on, and a badge that was
 * earned must never be taken back by a later change of mind about a price.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/badges.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-badges-'));
const outfile = path.join(outDir, 'badges.mjs');
await esbuild.build({
  entryPoints: ['src/lib/badges.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'error',
});
const B = await import(pathToFileURL(outfile).href);

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

const inputs = (over = {}) => ({ ...B.EMPTY_BADGE_INPUTS, ...over });
const keys = (i) => B.evaluateBadges(i).map((a) => a.key);
const gapFor = (i, key) => B.badgeProgress(i).find((g) => g.key === key);

// -------------------------------------------------------------- the criteria

test('an empty record earns nothing at all', () => {
  assert.deepEqual(keys(inputs()), []);
});

test('nothing is awarded for merely existing — every badge has a countable threshold', () => {
  // If a future edit adds a badge that is earned on an empty record, this fails.
  for (const badge of B.BADGES) {
    assert.ok(!keys(inputs()).includes(badge.key), `${badge.key} is earned by doing nothing`);
  }
});

test('FIRST_SALE lands on the first sale and not before', () => {
  assert.deepEqual(keys(inputs({ settledSales: 0 })), []);
  assert.deepEqual(keys(inputs({ settledSales: 1 })), ['FIRST_SALE']);
});

test('TEN_SALES lands at exactly ten, and FIRST_SALE stays', () => {
  assert.deepEqual(keys(inputs({ settledSales: 9 })), ['FIRST_SALE']);
  assert.deepEqual(keys(inputs({ settledSales: 10 })), ['FIRST_SALE', 'TEN_SALES']);
});

test('REPEAT_MAGNET needs one buyer who came back', () => {
  assert.ok(!keys(inputs({ repeatBuyers: 0 })).includes('REPEAT_MAGNET'));
  assert.ok(keys(inputs({ repeatBuyers: 1 })).includes('REPEAT_MAGNET'));
});

test('FAIR_WAGE_KEEPER needs five pieces AND none under its floor', () => {
  assert.ok(!keys(inputs({ listings: 4, listingsBelowFloor: 0 })).includes('FAIR_WAGE_KEEPER'));
  assert.ok(keys(inputs({ listings: 5, listingsBelowFloor: 0 })).includes('FAIR_WAGE_KEEPER'));
  // One under-priced piece is enough to withhold it.
  assert.ok(!keys(inputs({ listings: 14, listingsBelowFloor: 1 })).includes('FAIR_WAGE_KEEPER'));
});

test('VERIFIED_TEN counts buyer scans, at exactly ten', () => {
  assert.ok(!keys(inputs({ verifiedScans: 9 })).includes('VERIFIED_TEN'));
  assert.ok(keys(inputs({ verifiedScans: 10 })).includes('VERIFIED_TEN'));
});

test('ON_TIME_FIVE needs five delivered and none late', () => {
  assert.ok(!keys(inputs({ ordersDelivered: 4, ordersOnTime: 4 })).includes('ON_TIME_FIVE'));
  assert.ok(keys(inputs({ ordersDelivered: 5, ordersOnTime: 5 })).includes('ON_TIME_FIVE'));
  assert.ok(!keys(inputs({ ordersDelivered: 6, ordersOnTime: 5 })).includes('ON_TIME_FIVE'));
});

test('CLUSTER_HELPER and VOICE_PIONEER land on their own thresholds', () => {
  assert.ok(!keys(inputs({ requestsAccepted: 2 })).includes('CLUSTER_HELPER'));
  assert.ok(keys(inputs({ requestsAccepted: 3 })).includes('CLUSTER_HELPER'));
  assert.ok(!keys(inputs({ voiceCatalogued: 4 })).includes('VOICE_PIONEER'));
  assert.ok(keys(inputs({ voiceCatalogued: 5 })).includes('VOICE_PIONEER'));
});

test('the basis is the artisan\'s real figures, not the threshold', () => {
  const award = B.evaluateBadges(inputs({ settledSales: 12 })).find((a) => a.key === 'TEN_SALES');
  assert.deepEqual(award.basis, { sales: 12 });
  const fair = B.evaluateBadges(inputs({ listings: 14, listingsBelowFloor: 0 })).find(
    (a) => a.key === 'FAIR_WAGE_KEEPER'
  );
  assert.deepEqual(fair.basis, { listings: 14, belowFloor: 0 });
});

// ------------------------------------------------------------------ the gaps

test('every unearned badge reports a gap, and every earned one does not', () => {
  const i = inputs({ settledSales: 3, voiceCatalogued: 9 });
  const earned = new Set(keys(i));
  const locked = new Set(B.badgeProgress(i).map((g) => g.key));
  assert.equal(earned.size + locked.size, B.BADGES.length);
  for (const key of earned) assert.ok(!locked.has(key), `${key} is both earned and locked`);
});

test('a locked gap never overstates what the artisan has', () => {
  for (const gap of B.badgeProgress(inputs({ settledSales: 3, verifiedScans: 4 }))) {
    assert.ok(gap.have <= gap.need, `${gap.key}: ${gap.have} of ${gap.need}`);
    assert.ok(gap.need > 0, gap.key);
  }
});

test('too few pieces and an under-priced piece read as different sentences', () => {
  const few = gapFor(inputs({ listings: 2 }), 'FAIR_WAGE_KEEPER');
  assert.equal(few.gapKey, B.GAP_KEY_COUNT);
  assert.deepEqual([few.have, few.need], [2, B.FAIR_WAGE_MIN_LISTINGS]);

  const under = gapFor(inputs({ listings: 14, listingsBelowFloor: 2 }), 'FAIR_WAGE_KEEPER');
  assert.equal(under.gapKey, B.GAP_KEY_BELOW_FLOOR);
  // 12 of your 14 pieces are at or above their floor.
  assert.deepEqual([under.have, under.need], [12, 14]);
});

test('too few orders and a late order read as different sentences', () => {
  const few = gapFor(inputs({ ordersDelivered: 2, ordersOnTime: 2 }), 'ON_TIME_FIVE');
  assert.equal(few.gapKey, B.GAP_KEY_COUNT);
  const late = gapFor(inputs({ ordersDelivered: 7, ordersOnTime: 5 }), 'ON_TIME_FIVE');
  assert.equal(late.gapKey, B.GAP_KEY_LATE);
  assert.deepEqual([late.have, late.need], [5, 7]);
});

test('with every badge earned there is no locked list at all', () => {
  const everything = inputs({
    settledSales: 40,
    repeatBuyers: 3,
    listings: 20,
    listingsBelowFloor: 0,
    verifiedScans: 12,
    ordersDelivered: 8,
    ordersOnTime: 8,
    requestsAccepted: 4,
    voiceCatalogued: 15,
  });
  assert.equal(keys(everything).length, B.BADGES.length);
  assert.deepEqual(B.badgeProgress(everything), []);
});

// ------------------------------------------------------ the notification row

test('a stored English title round-trips back to its badge', () => {
  for (const badge of B.BADGES) {
    assert.equal(B.parseBadgeTitle(B.badgeTitle(badge.key)), badge.key);
  }
});

test('a notification that is not a badge is not mistaken for one', () => {
  assert.equal(B.parseBadgeTitle('No new listing in 23 days'), null);
  assert.equal(B.parseBadgeTitle('Badge earned: something we never wrote'), null);
  assert.equal(B.parseBadgeTitle(''), null);
});

test('the stored body carries the real figures', () => {
  const message = B.badgeMessage({ key: 'TEN_SALES', basis: { sales: 12 } });
  assert.ok(message.includes('12'), message);
});

// ------------------------------------------------------------- the catalogue

test('badge keys and English labels are unique, so neither can be ambiguous', () => {
  assert.equal(new Set(B.BADGES.map((b) => b.key)).size, B.BADGES.length);
  assert.equal(new Set(B.BADGES.map((b) => b.english.toLowerCase())).size, B.BADGES.length);
});

test('every badge label exists in all four dictionaries', () => {
  const dicts = Object.fromEntries(
    ['en', 'hi', 'or', 'te'].map((lang) => [lang, readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8')])
  );
  for (const badge of B.BADGES) {
    for (const [lang, src] of Object.entries(dicts)) {
      assert.ok(new RegExp(`^  ${badge.labelKey}: "`, 'm').test(src), `${lang} missing ${badge.labelKey}`);
    }
  }
});

test('every gap sentence exists in all four dictionaries', () => {
  const dicts = ['en', 'hi', 'or', 'te'].map((lang) => [lang, readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8')]);
  for (const key of [B.GAP_KEY_COUNT, B.GAP_KEY_BELOW_FLOOR, B.GAP_KEY_LATE]) {
    for (const [lang, src] of dicts) {
      assert.ok(new RegExp(`^  ${key}: "`, 'm').test(src), `${lang} missing ${key}`);
    }
  }
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} badge checks failed`);
  process.exit(1);
}
console.log(`badges: all ${checks} checks passed`);
