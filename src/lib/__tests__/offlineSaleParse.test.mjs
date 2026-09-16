/**
 * The rule-based offline-sale parser, against how sales are actually said.
 *
 * This parser is what voice logging falls back to with no AI key, and what the
 * AI answer is cross-checked against when there is one — so a wrong number here
 * is a wrong number in an artisan's ledger. Every row below is one utterance
 * and the fields it must (and must not) produce. The adversarial rows are the
 * ones that matter most: a phone number read as a price, or a guess made
 * between two amounts, would be worse than no answer.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/offlineSaleParse.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-offlinesale-'));
const outFile = path.join(outDir, 'offlineSaleParse.mjs');
await esbuild.build({
  entryPoints: ['src/lib/offlineSaleParse.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outFile,
  logLevel: 'error',
});
const { parseOfflineSaleText } = await import(pathToFileURL(outFile).href);

const domainFile = path.join(outDir, 'offlineSales.mjs');
await esbuild.build({
  entryPoints: ['src/lib/offlineSales.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: domainFile,
  logLevel: 'error',
});
const domain = await import(pathToFileURL(domainFile).href);

// Noon IST on 16 September 2026, so "today" / "yesterday" are fixed.
const NOW = new Date('2026-09-16T06:30:00Z');

/**
 * [utterance, expected fields, options?]. Only the fields named are checked;
 * `null` means "must NOT be filled".
 */
const CASES = [
  // ---- Romanised Hindi ------------------------------------------------------
  ['pandrah sau rupaye ka dupatta becha', { amount: 1500, craftTypeLabel: 'Dupatta', quantity: null }],
  ['do hazaar paanch sau ki saree haat mein bechi', { amount: 2500, craftTypeLabel: 'Saree', channel: 'HAAT' }],
  ['dedh hazaar mein becha', { amount: 1500 }],
  ['dhai hazaar rupaye', { amount: 2500 }],
  ['saadhe teen hazaar ka stole', { amount: 3500, craftTypeLabel: 'Stole' }],
  ['ek lakh pachas hazaar ki saree', { amount: 150000 }],
  ['1.5k ka dupatta', { amount: 1500 }],
  ['bichauliye ko 900 mein becha', { amount: 900, channel: 'MIDDLEMAN', buyerName: null }],
  ['exhibition mein 3 dupatte 4500 mein beche', { amount: 4500, quantity: 3, channel: 'EXHIBITION' }],
  ['3 dupatte 500 rupaye each', { amount: 1500, quantity: 3 }],
  ['kal mele mein 800 ka dupatta', { amount: 800, channel: 'HAAT', soldAt: '2026-09-15' }],
  ['Ramesh ko 700 rupaye mein shawl becha', { amount: 700, buyerName: 'Ramesh', craftTypeLabel: 'Shawl' }],

  // ---- English ---------------------------------------------------------------
  ['sold a dupatta for rs 1,200 at the haat yesterday', { amount: 1200, channel: 'HAAT', soldAt: '2026-09-15' }],
  ['₹1500 dupatta to Priya Das', { amount: 1500, buyerName: 'Priya Das' }],
  ['fifteen hundred rupees, walk-in customer', { amount: 1500, channel: 'WALK_IN' }],
  ['rs.800 today', { amount: 800, soldAt: '2026-09-16' }],

  // ---- Hindi (Devanagari) ----------------------------------------------------
  ['पंद्रह सौ रुपये का दुपट्टा बेचा', { amount: 1500, craftTypeLabel: 'Dupatta' }],
  ['डेढ़ हज़ार रुपये में साड़ी बेची', { amount: 1500, craftTypeLabel: 'Saree' }],
  ['३ दुपट्टे ४५० रुपये में बेचे', { amount: 450, quantity: 3 }],
  ['आज हाट में १२०० रुपये की साड़ी', { amount: 1200, channel: 'HAAT', soldAt: '2026-09-16' }],
  ['राधा को दो हजार रुपये में साड़ी बेची', { amount: 2000, buyerName: 'राधा' }],

  // ---- Odia ------------------------------------------------------------------
  ['ପନ୍ଦର ଶହ ଟଙ୍କାରେ ଶାଢ଼ୀ ବିକିଲି', { amount: 1500, craftTypeLabel: 'Saree' }],
  ['୧୫୦୦ ଟଙ୍କା', { amount: 1500 }],
  ['ଦୁଇ ହଜାର ଟଙ୍କା ହାଟରେ', { amount: 2000, channel: 'HAAT' }],

  // ---- Telugu ----------------------------------------------------------------
  ['పదిహేను వందల రూపాయలకు చీర అమ్మాను', { amount: 1500, craftTypeLabel: 'Saree' }],
  ['౧౫౦౦ రూపాయలు', { amount: 1500 }],
  ['రెండు వేల రూపాయలు నిన్న సంతలో', { amount: 2000, channel: 'HAAT', soldAt: '2026-09-15' }],
  ['ఒక వెయ్యి ఐదు వందలు', { amount: 1500 }],

  // ---- Adversarial -----------------------------------------------------------
  // No number at all.
  ['aaj haat gaya tha', { amount: null, quantity: null, channel: 'HAAT', soldAt: '2026-09-16' }],
  ['', { amount: null, craftTypeLabel: null }],
  // Two amounts, nothing to choose between them.
  ['1200 aur 800', { amount: null, ambiguousAmount: true }],
  ['1200 ka dupatta aur 800 ki saree', { amount: null, ambiguousAmount: true }],
  // A date and an amount in one sentence.
  ['15/09/2026 ko 1500 ka dupatta', { amount: 1500, soldAt: '2026-09-15' }],
  ['12 september ko 2000 rupaye', { amount: 2000, soldAt: '2026-09-12' }],
  // A phone number must never become a price.
  ['mera number 98765 43210 hai', { amount: null }],
  ['Suresh 9876543210 ko 700 mein becha', { amount: 700 }],
  ['+91 98765 43210 wale ko dupatta diya 1500 rupaye', { amount: 1500 }],
  // A length and a labour period are not prices or quantities.
  ['2 metre ki saree 3000 mein', { amount: 3000, quantity: null }],
  ['12 din lage, 4000 rupaye mili', { amount: 4000 }],
  // A future date is last year's, never next week's.
  ['20/09 ko 500 rupaye', { amount: 500, soldAt: '2025-09-20' }],
];

let failures = 0;
for (const [utterance, expected, options] of CASES) {
  const result = parseOfflineSaleText(utterance, { now: NOW, ...(options ?? {}) });
  for (const [field, want] of Object.entries(expected)) {
    try {
      assert.deepEqual(result[field], want);
    } catch {
      failures += 1;
      console.log(`FAIL  ${JSON.stringify(utterance)}\n      ${field}: expected ${JSON.stringify(want)}, got ${JSON.stringify(result[field])}`);
    }
  }
}

// ---- Known labels outrank the generic nouns --------------------------------
{
  const result = parseOfflineSaleText('sambalpuri saree 3200 mein bechi', {
    now: NOW,
    knownLabels: ['Sambalpuri Silk Saree', 'Cotton Dupatta'],
  });
  try {
    assert.equal(result.craftTypeLabel, 'Sambalpuri Silk Saree');
    assert.equal(result.amount, 3200);
  } catch (e) {
    failures += 1;
    console.log(`FAIL  known label: ${e.message}`);
  }
}

// ---- The domain rules the parser leans on -----------------------------------
const domainChecks = [
  () => assert.equal(domain.parseAmountInput('₹ 1,500'), 1500),
  () => assert.equal(domain.parseAmountInput('१५००'), 1500),
  () => assert.equal(domain.parseAmountInput('Rs. 2,50,000'), 250000),
  () => assert.equal(domain.parseAmountInput('1500.00'), 1500),
  () => assert.equal(domain.parseAmountInput('1500.50'), null),
  () => assert.equal(domain.parseAmountInput('abc'), null),
  () => assert.equal(domain.median([100, 900, 300]), 300),
  () => assert.equal(domain.median([100, 200, 300, 400]), 250),
  () => assert.equal(domain.buildPriceSignal([{ amount: 500, quantity: 1, soldAt: NOW }], 'x', NOW), null),
  () =>
    assert.equal(
      domain.buildPriceSignal(
        [
          { amount: 500, quantity: 1, soldAt: NOW },
          { amount: 1200, quantity: 2, soldAt: NOW },
        ],
        'x',
        NOW
      ),
      null
    ),
  () => {
    const signal = domain.buildPriceSignal(
      [
        { amount: 500, quantity: 1, soldAt: NOW },
        { amount: 1200, quantity: 2, soldAt: NOW },
        { amount: 90, quantity: 1, soldAt: NOW }, // a distress sale must not drag the median
        { amount: 700, quantity: 1, soldAt: new Date('2025-01-01T06:30:00Z') }, // outside the window
      ],
      'Dupatta',
      NOW
    );
    assert.deepEqual(signal, { craftTypeLabel: 'Dupatta', sampleSize: 3, median: 500, min: 90, max: 600, windowDays: 180 });
  },
  () => {
    const offline = [500, 600, 550].map((amount) => ({ amount, quantity: 1, soldAt: NOW }));
    assert.equal(domain.buildComparison(offline, [{ salePrice: 900, soldAt: NOW }], 'Dupatta', NOW), null);
    const comparison = domain.buildComparison(
      offline,
      [{ salePrice: 900, soldAt: NOW }, { salePrice: 1100, soldAt: NOW }],
      'Dupatta',
      NOW
    );
    assert.deepEqual(comparison, {
      craftTypeLabel: 'Dupatta',
      offlineMedian: 550,
      onlineMedian: 1000,
      deltaPct: 82,
      onlineSampleSize: 2,
      offlineSampleSize: 3,
    });
  },
  () => assert.deepEqual(domain.soldAtFromInput('2026-09-17', NOW), { ok: false, reason: 'future' }),
  () => assert.equal(domain.soldAtFromInput('2026-09-16', NOW).ok, true),
  () => assert.deepEqual(domain.soldAtFromInput('2024-01-01', NOW), { ok: false, reason: 'too_old' }),
  () => assert.deepEqual(domain.soldAtFromInput('2026-02-31', NOW), { ok: false, reason: 'invalid' }),
  () => assert.equal(domain.istMonthKey(domain.soldAtFromInput('2026-08-31', NOW).soldAt), '2026-08'),
  () => assert.equal(domain.channelLabelKey('WALK_IN'), 'channel_walk_in'),
  () => assert.equal(domain.highAmountThreshold(null), domain.HIGH_AMOUNT_WITHOUT_HISTORY),
  () => assert.equal(domain.highAmountThreshold(500), 10000),
];
for (const check of domainChecks) {
  try {
    check();
  } catch (e) {
    failures += 1;
    console.log(`FAIL  domain: ${e.message}`);
  }
}

const utterances = CASES.length + 1;
console.log(`offlineSaleParse: ${utterances} utterances, ${domainChecks.length} domain checks`);
if (failures) {
  console.log(`FAIL (${failures})`);
  process.exit(1);
}
console.log('PASS — every utterance parsed as expected; no phone, date or length was read as a price');
