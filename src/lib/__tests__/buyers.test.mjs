/**
 * Who counts as one buyer, and what counts as money received from them.
 *
 * Buyers have no account, so two purchases are the same person only when the
 * typed names match case-insensitively with whitespace collapsed — and never
 * because two different scripts look alike. A wrong merge hides a buyer; a
 * wrong split invents one. Both are checked here, with the totals that must
 * reconcile against the Money tab, and the search/request signal thresholds.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/buyers.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-buyers-'));
async function compile(entry, name) {
  const outfile = path.join(outDir, name);
  await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
  return import(pathToFileURL(outfile).href);
}
const buyers = await compile('src/lib/buyers.ts', 'buyers.mjs');
const searchLog = await compile('src/lib/searchLog.ts', 'searchLog.mjs');

const NOW = new Date('2026-09-17T06:30:00Z');
const day = (iso) => new Date(`${iso}T12:00:00+05:30`);

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

// ---- identity -------------------------------------------------------------
test('capitalisation and spacing merge into one buyer, newest spelling shown', () => {
  const { buyers: list } = buyers.aggregateBuyers(
    [
      { buyerName: 'priya das', channel: 'STOREFRONT', amount: 1000, at: day('2026-07-01'), title: 'Saree' },
      { buyerName: '  PRIYA   Das ', channel: 'OFFLINE', amount: 500, at: day('2026-08-01'), title: 'Dupatta' },
      { buyerName: 'Priya Das', channel: 'DEMAND', amount: 2000, at: day('2026-09-01'), title: 'Stole' },
    ],
    NOW
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].purchaseCount, 3);
  assert.equal(list[0].displayName, 'Priya Das');
  assert.equal(list[0].totalValue, 3500);
  assert.equal(list[0].isRepeat, true);
  assert.deepEqual(list[0].channels, ['STOREFRONT', 'DEMAND', 'OFFLINE']);
  assert.equal(list[0].firstPurchaseAt, day('2026-07-01').toISOString());
});

test('Devanagari, Odia and Latin spellings of a name stay separate buyers', () => {
  const { buyers: list } = buyers.aggregateBuyers(
    [
      { buyerName: 'राधा', channel: 'OFFLINE', amount: 100, at: day('2026-09-01'), title: 'x' },
      { buyerName: 'Radha', channel: 'OFFLINE', amount: 100, at: day('2026-09-02'), title: 'x' },
      { buyerName: 'ରାଧା', channel: 'OFFLINE', amount: 100, at: day('2026-09-03'), title: 'x' },
      { buyerName: 'राधा', channel: 'OFFLINE', amount: 100, at: day('2026-09-04'), title: 'x' },
    ],
    NOW
  );
  assert.equal(list.length, 3);
  assert.equal(list.find((b) => b.displayName === 'राधा').purchaseCount, 2);
});

test('similar but different names are not merged', () => {
  const { buyers: list } = buyers.aggregateBuyers(
    [
      { buyerName: 'Biswajeet', channel: 'STOREFRONT', amount: 10, at: day('2026-09-01'), title: 'x' },
      { buyerName: 'Biswajeet Sahoo', channel: 'STOREFRONT', amount: 10, at: day('2026-09-02'), title: 'x' },
    ],
    NOW
  );
  assert.equal(list.length, 2);
});

// ---- money ------------------------------------------------------------------
test('unnamed purchases count in revenue, not in the list', () => {
  const { buyers: list, summary } = buyers.aggregateBuyers(
    [
      { buyerName: null, channel: 'STOREFRONT', amount: 4000, at: day('2026-09-01'), title: 'x' },
      { buyerName: '   ', channel: 'OFFLINE', amount: 700, at: day('2026-09-01'), title: 'x' },
      { buyerName: 'Asha', channel: 'STOREFRONT', amount: 1000, at: day('2026-09-02'), title: 'x' },
      { buyerName: 'Asha', channel: 'DEMAND', amount: 0, at: day('2026-09-03'), title: 'paid, nothing released' },
    ],
    NOW
  );
  assert.equal(list.length, 1);
  assert.deepEqual(summary.revenueByChannel, { storefront: 5000, demand: 0, offline: 700 });
  assert.deepEqual(summary.unnamed, { storefront: 1, demand: 0, offline: 1 });
  assert.equal(list[0].totalValue, 1000);
  assert.equal(list[0].purchaseCount, 2);
});

test('negative or NaN amounts never count as money', () => {
  const { summary } = buyers.aggregateBuyers(
    [
      { buyerName: 'A', channel: 'OFFLINE', amount: -50, at: day('2026-09-01'), title: 'x' },
      { buyerName: 'A', channel: 'OFFLINE', amount: Number.NaN, at: day('2026-09-01'), title: 'x' },
    ],
    NOW
  );
  assert.equal(summary.revenueByChannel.offline, 0);
});

// ---- B2B, repeat rate, caps ---------------------------------------------------
test('B2B comes from a linked bulk/wholesale demand', () => {
  const { summary, buyers: list } = buyers.aggregateBuyers(
    [
      { buyerName: 'Emporium', channel: 'DEMAND', amount: 9000, at: day('2026-09-01'), title: 'x', b2b: true },
      { buyerName: 'Walk-in', channel: 'OFFLINE', amount: 90, at: day('2026-09-01'), title: 'x' },
    ],
    NOW
  );
  assert.equal(summary.b2bBuyers, 1);
  assert.equal(list.find((b) => b.displayName === 'Emporium').isB2B, true);
});

test('repeat rate hidden below 3 buyers, shown at 3', () => {
  const two = buyers.aggregateBuyers(
    [
      { buyerName: 'A', channel: 'OFFLINE', amount: 1, at: day('2026-09-01'), title: 'x' },
      { buyerName: 'A', channel: 'OFFLINE', amount: 1, at: day('2026-09-02'), title: 'x' },
      { buyerName: 'B', channel: 'OFFLINE', amount: 1, at: day('2026-09-02'), title: 'x' },
    ],
    NOW
  );
  assert.equal(two.summary.repeatRatePct, null);
  const three = buyers.aggregateBuyers(
    [
      { buyerName: 'A', channel: 'OFFLINE', amount: 1, at: day('2026-09-01'), title: 'x' },
      { buyerName: 'A', channel: 'OFFLINE', amount: 1, at: day('2026-09-02'), title: 'x' },
      { buyerName: 'B', channel: 'OFFLINE', amount: 1, at: day('2026-09-02'), title: 'x' },
      { buyerName: 'C', channel: 'OFFLINE', amount: 1, at: day('2026-09-02'), title: 'x' },
    ],
    NOW
  );
  assert.equal(three.summary.repeatRatePct, 33);
});

test('items capped at 10 newest; count and total stay exact', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    buyerName: 'Bulk Buyer',
    channel: 'OFFLINE',
    amount: 100,
    at: day(`2026-09-${String(i + 1).padStart(2, '0')}`),
    title: `piece ${i + 1}`,
  }));
  const { buyers: list } = buyers.aggregateBuyers(rows, NOW);
  assert.equal(list[0].items.length, 10);
  assert.equal(list[0].items[0].title, 'piece 14');
  assert.equal(list[0].purchaseCount, 14);
  assert.equal(list[0].totalValue, 1400);
});

test('300 buyers aggregate exactly', () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ buyerName: `Buyer ${i}`, channel: 'OFFLINE', amount: 10, at: day('2026-09-01'), title: 'x' }));
  const { buyers: list, summary } = buyers.aggregateBuyers(rows, NOW);
  assert.equal(list.length, 300);
  assert.equal(summary.totalBuyers, 300);
  assert.equal(summary.revenueByChannel.offline, 3000);
  assert.equal(summary.topBuyers.length, 5);
});

// ---- monthly series ----------------------------------------------------------
test('12 IST months, new vs returning, revenue by sold month', () => {
  const { summary } = buyers.aggregateBuyers(
    [
      { buyerName: 'A', channel: 'OFFLINE', amount: 100, at: day('2026-08-10'), title: 'x' },
      { buyerName: 'A', channel: 'OFFLINE', amount: 200, at: day('2026-09-10'), title: 'x' },
      { buyerName: 'B', channel: 'OFFLINE', amount: 300, at: day('2026-09-11'), title: 'x' },
      { buyerName: null, channel: 'STOREFRONT', amount: 50, at: day('2026-09-12'), title: 'x' },
      // 31 Aug 23:00 IST is still August in India even though it is August in UTC too;
      // 1 Sep 01:00 IST is 31 Aug in UTC and must land in September.
      { buyerName: 'C', channel: 'OFFLINE', amount: 1, at: new Date('2026-08-31T19:30:00Z'), title: 'x' },
    ],
    NOW
  );
  assert.equal(summary.monthly.length, 12);
  assert.equal(summary.monthly[0].month, '2025-10');
  assert.equal(summary.monthly[11].month, '2026-09');
  const sep = summary.monthly[11];
  const aug = summary.monthly[10];
  assert.deepEqual({ buyers: sep.buyers, newBuyers: sep.newBuyers, revenue: sep.revenue }, { buyers: 3, newBuyers: 2, revenue: 551 });
  assert.deepEqual({ buyers: aug.buyers, newBuyers: aug.newBuyers, revenue: aug.revenue }, { buyers: 1, newBuyers: 1, revenue: 100 });
});

test('month keys roll across a year boundary', () => {
  const keys = buyers.buyerMonthKeys(new Date('2027-01-15T06:30:00Z'));
  assert.equal(keys[11], '2027-01');
  assert.equal(keys[10], '2026-12');
  assert.equal(keys[0], '2026-02');
});

// ---- demand signals ------------------------------------------------------------
const saree = (term) => /saree|ikat|sambalpuri/.test(term);

test('searches: needs 5 matching searches and a term searched twice', () => {
  const four = buyers.buildDemandSignals(
    [
      { term: 'ikat saree', count: 3, zeroResultCount: 0 },
      { term: 'sambalpuri', count: 1, zeroResultCount: 1 },
      { term: 'blue pottery', count: 9, zeroResultCount: 0 },
    ],
    [],
    saree
  );
  assert.equal(four.source, 'NONE');

  const five = buyers.buildDemandSignals(
    [
      { term: 'ikat saree', count: 3, zeroResultCount: 0 },
      { term: 'sambalpuri dupatta', count: 2, zeroResultCount: 2 },
      { term: 'saree border', count: 1, zeroResultCount: 0 },
      { term: 'blue pottery', count: 9, zeroResultCount: 0 },
    ],
    ['Sambalpuri Ikat Silk Saree'],
    saree
  );
  assert.equal(five.source, 'SEARCHES');
  assert.equal(five.basis, 6);
  assert.deepEqual(five.terms, [
    { term: 'ikat saree', count: 3, zeroResultShare: 0 },
    { term: 'sambalpuri dupatta', count: 2, zeroResultShare: 1 },
  ]);
});

test('falls back to open requests, then to none', () => {
  const requests = buyers.buildDemandSignals([], ['Saree & Textile', 'Saree & Textile', 'Pattachitra'], () => false);
  assert.equal(requests.source, 'DEMANDS');
  assert.equal(requests.basis, 3);
  assert.deepEqual(requests.terms[0], { term: 'Saree & Textile', count: 2, zeroResultShare: 0 });
  assert.deepEqual(buyers.buildDemandSignals([], [], () => true), { source: 'NONE', window: 30, basis: 0, terms: [] });
});

// ---- search log normalisation -------------------------------------------------
test('search terms: trimmed, lower-cased, collapsed, clamped, control chars removed', () => {
  assert.equal(searchLog.normaliseSearchTerm('  Ikat   SAREE  '), 'ikat saree');
  assert.equal(searchLog.normaliseSearchTerm('ab'), null);
  assert.equal(searchLog.normaliseSearchTerm('  a  b  '), 'a b');
  assert.equal(searchLog.normaliseSearchTerm('   ab   '), null);
  assert.equal(searchLog.normaliseSearchTerm(42), null);
  assert.equal(searchLog.normaliseSearchTerm('x'.repeat(500)).length, 80);
  const control = `ikat${String.fromCharCode(0)}${String.fromCharCode(10)}saree${String.fromCharCode(27)}`;
  assert.equal(searchLog.normaliseSearchTerm(control), 'ikat saree');
  assert.equal(searchLog.normaliseSearchTerm('दुपट्टा'), 'दुपट्टा');
});

test('saltedIpHash is byte-for-byte the digest AffiliateClick has always stored', () => {
  const salt = process.env.JWT_SECRET || 'karigari-affiliate';
  const legacy = (ip) => createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
  const forwarded = new Request('http://x/', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });
  assert.equal(searchLog.saltedIpHash(forwarded), legacy('203.0.113.7'));
  const real = new Request('http://x/', { headers: { 'x-real-ip': '198.51.100.2' } });
  assert.equal(searchLog.saltedIpHash(real), legacy('198.51.100.2'));
  assert.equal(searchLog.saltedIpHash(new Request('http://x/')), null);
});

console.log(`buyers: ${checks} checks`);
if (failures) {
  console.log(`FAIL (${failures})`);
  process.exit(1);
}
console.log('PASS — buyer identity, received totals, monthly series and signal thresholds hold');
