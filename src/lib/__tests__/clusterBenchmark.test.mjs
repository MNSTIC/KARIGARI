/**
 * What a benchmark is allowed to reveal.
 *
 * The rule this file exists to enforce: a leaderboard in a small village causes
 * real conflict, so the k-anonymity threshold is not advice — it is the only
 * thing standing between a median and a neighbour's income. These checks look
 * at the *payload*, not the screen, because a JSON response is as public as a
 * screenshot of it: below the threshold there must be no figure anywhere in it.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/clusterBenchmark.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-benchmark-'));
const outfile = path.join(outDir, 'clusterBenchmark.mjs');
await esbuild.build({
  entryPoints: ['src/lib/clusterBenchmark.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'error',
});
const K = await import(pathToFileURL(outfile).href);

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

/** A peer with everything filled in, so a test can vary one figure at a time. */
const peer = (monthlyEarnings, over = {}) => ({
  monthlyEarnings,
  listings: 3,
  fulfilment: 80,
  avgPrice: 5000,
  ...over,
});

const cohort = (...earnings) => earnings.map((e) => peer(e));

// -------------------------------------------------------------------- medians

test('median of an odd list is the middle value', () => {
  assert.equal(K.median([5, 1, 3]), 3);
});

test('median of an even list is the average of the two middles', () => {
  assert.equal(K.median([1, 2, 3, 4]), 2.5);
});

test('median of nothing is null, never zero', () => {
  assert.equal(K.median([]), null);
  assert.equal(K.median([Number.NaN]), null);
});

test('one very large seller does not drag the median — that is why it is not a mean', () => {
  const values = [4000, 5000, 6000, 7000, 900000];
  assert.equal(K.median(values), 6000);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(mean > 180000, `a mean would have claimed ${Math.round(mean)}`);
});

// ------------------------------------------------------------------ quartiles

test('a value below the lower quartile reads BELOW, above the upper reads ABOVE', () => {
  const peers = [10, 20, 30, 40, 50, 60, 70, 80];
  assert.equal(K.quartilePosition(5, peers), 'BELOW');
  assert.equal(K.quartilePosition(45, peers), 'MIDDLE');
  assert.equal(K.quartilePosition(95, peers), 'ABOVE');
});

test('sitting exactly on a quartile edge is never reported as being under it', () => {
  const peers = [10, 20, 30, 40, 50, 60, 70, 80];
  // Q1 = 25, Q3 = 65 for this list.
  assert.equal(K.quartilePosition(25, peers), 'MIDDLE');
  assert.equal(K.quartilePosition(65, peers), 'MIDDLE');
});

test('too few peers to have quartiles reports MIDDLE rather than guessing', () => {
  assert.equal(K.quartilePosition(1000, [1, 2, 3]), 'MIDDLE');
});

// --------------------------------------------------------- the privacy floor

test('a cohort of four is refused, and a cohort of five is shown', () => {
  const four = K.buildBenchmark(peer(9000), cohort(1000, 2000, 3000, 4000), 'CLUSTER');
  assert.equal(four.available, false);
  assert.equal(four.cohortSize, 4);

  const five = K.buildBenchmark(peer(9000), cohort(1000, 2000, 3000, 4000, 5000), 'CLUSTER');
  assert.equal(five.available, true);
  assert.equal(five.cohortSize, 5);
});

test('a refusal carries NO figure anywhere in the payload', () => {
  const refusal = K.buildBenchmark(peer(48000), cohort(1000, 2000), 'CLUSTER');
  assert.equal(refusal.available, false);
  assert.equal(refusal.scope, null);
  assert.equal(refusal.metrics, undefined);
  // Serialise it and look for the numbers that must not have escaped.
  const json = JSON.stringify(refusal);
  for (const leak of ['48000', '1000', '2000']) {
    assert.ok(!json.includes(leak), `${leak} leaked in ${json}`);
  }
  // The only numbers allowed are the real cohort size and the threshold.
  assert.deepEqual(json.match(/\d+/g).sort(), ['2', String(K.MIN_COHORT)].sort());
});

test('the threshold the refusal names is the one that was applied', () => {
  const refusal = K.buildBenchmark(peer(1), cohort(1, 2, 3, 4), 'CLUSTER');
  assert.equal(refusal.minCohort, K.MIN_COHORT);
  assert.equal(K.MIN_COHORT, 5);
});

test('nothing in an available payload can carry a name, an id or a rank', () => {
  const result = K.buildBenchmark(peer(9000), cohort(1000, 2000, 3000, 4000, 5000), 'CLUSTER');
  const json = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['name', 'id"', 'rank', 'percentile', 'email', 'location']) {
    assert.ok(!json.includes(forbidden), `${forbidden} appears in ${json}`);
  }
  for (const metric of result.metrics) {
    assert.ok(['BELOW', 'MIDDLE', 'ABOVE'].includes(metric.position), metric.position);
  }
});

// ----------------------------------------------------------------- the metrics

test('the median is the peers\' own, never including the artisan\'s figure', () => {
  const result = K.buildBenchmark(peer(100000), cohort(1000, 2000, 3000, 4000, 5000), 'CLUSTER');
  const earnings = result.metrics.find((m) => m.key === 'monthlyEarnings');
  assert.equal(earnings.median, 3000);
  assert.equal(earnings.you, 100000);
});

test('a metric too few peers can answer is dropped, not zeroed', () => {
  // Five peers, but only three of them ever took a bulk order.
  const peers = [
    peer(1000, { fulfilment: 50 }),
    peer(2000, { fulfilment: 60 }),
    peer(3000, { fulfilment: 70 }),
    peer(4000, { fulfilment: null }),
    peer(5000, { fulfilment: null }),
  ];
  const result = K.buildBenchmark(peer(2500, { fulfilment: 90 }), peers, 'CLUSTER');
  assert.equal(result.available, true);
  assert.ok(!result.metrics.some((m) => m.key === 'fulfilment'), JSON.stringify(result.metrics));
  assert.ok(result.metrics.some((m) => m.key === 'monthlyEarnings'));
});

test('a figure the artisan has no basis for is dropped rather than shown as zero', () => {
  const result = K.buildBenchmark(peer(2500, { avgPrice: null }), cohort(1, 2, 3, 4, 5), 'CLUSTER');
  assert.ok(!result.metrics.some((m) => m.key === 'avgPrice'));
});

test('when no metric survives, the whole card is refused rather than left blank', () => {
  const blank = { monthlyEarnings: Number.NaN, listings: Number.NaN, fulfilment: null, avgPrice: null };
  const result = K.buildBenchmark(blank, cohort(1, 2, 3, 4, 5), 'CLUSTER');
  assert.equal(result.available, false);
  assert.equal(result.cohortSize, 5);
});

test('money is whole rupees and pieces keep one decimal', () => {
  const peers = [
    peer(1000, { listings: 1 }),
    peer(1000, { listings: 1 }),
    peer(1000, { listings: 2 }),
    peer(1000, { listings: 2 }),
    peer(1000, { listings: 2 }),
  ];
  const result = K.buildBenchmark(peer(1234.56, { listings: 1.6667 }), peers, 'CLUSTER');
  assert.equal(result.metrics.find((m) => m.key === 'monthlyEarnings').you, 1235);
  assert.equal(result.metrics.find((m) => m.key === 'listings').you, 1.7);
});

test('the scope that was searched is the scope that is reported', () => {
  const region = K.buildBenchmark(peer(9000), cohort(1, 2, 3, 4, 5), 'REGION');
  assert.equal(region.scope, 'REGION');
  assert.equal(K.buildBenchmark(peer(9000), cohort(1, 2, 3, 4, 5), 'CLUSTER').scope, 'CLUSTER');
});

// ------------------------------------------------------------------ the units

test('per-month divides by the window that was actually measured', () => {
  assert.equal(K.BENCHMARK_WINDOW_DAYS, K.BENCHMARK_MONTHS * 30);
  assert.equal(K.perMonth(9000), 3000);
});

test('a fulfilment rate with nothing accepted is null, not 0 %', () => {
  assert.equal(K.fulfilmentRate(0, 0), null);
  assert.equal(K.fulfilmentRate(4, 2), 50);
  // Clamped: an order delivered twice must not read as 200 %.
  assert.equal(K.fulfilmentRate(2, 4), 100);
});

test('every metric label exists in all four dictionaries', () => {
  const dicts = ['en', 'hi', 'or', 'te'].map((lang) => [lang, readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8')]);
  for (const key of Object.values(K.BENCHMARK_METRIC_LABEL_KEYS)) {
    for (const [lang, src] of dicts) {
      assert.ok(new RegExp(`^  ${key}: "`, 'm').test(src), `${lang} missing ${key}`);
    }
  }
});

test('the region radius the code applies is the one the copy names', () => {
  assert.equal(K.REGION_RADIUS_KM, 150);
  const en = readFileSync('src/lib/i18n/en.ts', 'utf8');
  assert.ok(new RegExp(`^  benchmark_scope_region: ".*${K.REGION_RADIUS_KM}`, 'm').test(en));
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} benchmark checks failed`);
  process.exit(1);
}
console.log(`clusterBenchmark: all ${checks} checks passed`);
