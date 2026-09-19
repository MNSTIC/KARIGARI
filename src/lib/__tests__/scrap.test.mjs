/**
 * What a pool weighs, when it lists, where it may say it is, and how its money
 * divides.
 *
 * The rule this file exists to enforce: **a sale price divides completely.**
 * Every split below is asserted to sum to exactly the rupee figure a recycler
 * paid — including ₹1 across three contributors, where integer division leaves
 * everything on the floor unless the remainder rule actually works. A payout
 * ledger that quietly keeps a rupee is the one bug a cluster would be right
 * never to forgive.
 *
 * And two honesty guards: the listing threshold is arithmetic on real weight,
 * asserted at the boundary in both directions; and the public board's area
 * label never gets more precise than a district.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/scrap.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-scrap-'));
const outfile = path.join(outDir, 'scrap.mjs');
await esbuild.build({
  entryPoints: ['src/lib/scrap.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'error',
  alias: { '@': path.resolve('src') },
});
const S = await import(pathToFileURL(outfile).href);

let failures = 0;
let checks = 0;
function test(name, fn) {
  checks += 1;
  try {
    fn();
  } catch (e) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

const at = (day) => new Date(`2026-09-${String(day).padStart(2, '0')}T06:00:00Z`);
const sum = (rows) => rows.reduce((total, row) => total + row.amount, 0);

// ---------------------------------------------------------------- the split

test('§12.3 — the shares sum to exactly the price, for every price and every cluster size', () => {
  const PRICES = [1, 7, 1000, 99_999];
  // Uneven on purpose: an even split hides every remainder bug there is.
  const SHAPES = [[700], [700, 300], [5000, 3100, 1900], [910, 730, 645, 520, 480, 301, 77]];
  for (const price of PRICES) {
    for (const shape of SHAPES) {
      const contributions = shape.map((grams, i) => ({ artisanId: `a${i}`, grams, at: at(i + 1) }));
      const shares = S.splitProRata(price, contributions);
      assert.equal(shares.length, shape.length, `${price} across ${shape.length}`);
      assert.equal(sum(shares), price, `₹${price} across ${shape.length} summed to ${sum(shares)}`);
      assert.ok(shares.every((row) => row.amount >= 0), 'no share may be negative');
      assert.ok(
        shares.every((row) => Number.isInteger(row.amount)),
        'every share must be a whole rupee'
      );
    }
  }
});

test('§12.7 case 6 — ₹1 across three contributors is 1 / 0 / 0, never ₹0.33', () => {
  const shares = S.splitProRata(1, [
    { artisanId: 'small', grams: 200, at: at(1) },
    { artisanId: 'big', grams: 500, at: at(2) },
    { artisanId: 'mid', grams: 300, at: at(3) },
  ]);
  assert.equal(sum(shares), 1);
  const byId = Object.fromEntries(shares.map((row) => [row.artisanId, row.amount]));
  assert.deepEqual(byId, { big: 1, mid: 0, small: 0 });
});

test('§12.7 case 7 — a zero-gram contributor gets 0 and there is no divide-by-zero', () => {
  const shares = S.splitProRata(101, [
    { artisanId: 'ghost', grams: 0, at: at(1) },
    { artisanId: 'real', grams: 1000, at: at(2) },
  ]);
  assert.equal(sum(shares), 101);
  assert.equal(shares.find((row) => row.artisanId === 'ghost').amount, 0);
  assert.equal(shares.find((row) => row.artisanId === 'real').amount, 101);
});

test('identical contributions split evenly, and the odd rupee goes to whoever logged first', () => {
  const even = S.splitProRata(300, [
    { artisanId: 'a', grams: 500, at: at(1) },
    { artisanId: 'b', grams: 500, at: at(2) },
    { artisanId: 'c', grams: 500, at: at(3) },
  ]);
  assert.deepEqual(even.map((row) => row.amount), [100, 100, 100]);

  const odd = S.splitProRata(301, [
    { artisanId: 'later', grams: 500, at: at(9) },
    { artisanId: 'earlier', grams: 500, at: at(2) },
  ]);
  assert.equal(sum(odd), 301);
  assert.equal(odd.find((row) => row.artisanId === 'earlier').amount, 151);
  assert.equal(odd.find((row) => row.artisanId === 'later').amount, 150);
});

test('the remainder goes to the largest contributors first', () => {
  // 10 rupees over 3 equal-ish shares: bases 3/3/3, one rupee spare.
  const shares = S.splitProRata(10, [
    { artisanId: 'tiny', grams: 10, at: at(1) },
    { artisanId: 'huge', grams: 900, at: at(2) },
    { artisanId: 'mid', grams: 90, at: at(3) },
  ]);
  assert.equal(sum(shares), 10);
  const byId = Object.fromEntries(shares.map((row) => [row.artisanId, row.amount]));
  assert.ok(byId.huge > byId.mid && byId.mid >= byId.tiny, JSON.stringify(byId));
});

test('a split that could not add up throws BEFORE anything is written', () => {
  assert.throws(() => S.splitProRata(0, [{ artisanId: 'a', grams: 10, at: at(1) }]), /above zero/);
  assert.throws(() => S.splitProRata(-5, [{ artisanId: 'a', grams: 10, at: at(1) }]), /above zero/);
  assert.throws(() => S.splitProRata(10.5, [{ artisanId: 'a', grams: 10, at: at(1) }]), /whole number/);
  assert.throws(() => S.splitProRata(100, []), /no contributors/);
  assert.throws(
    () => S.splitProRata(100, [{ artisanId: 'a', grams: 0, at: at(1) }]),
    /no weight in it/
  );
});

test('a single contributor takes the whole price', () => {
  const shares = S.splitProRata(4000, [{ artisanId: 'solo', grams: 12_345, at: at(1) }]);
  assert.deepEqual(shares.map((row) => row.amount), [4000]);
});

test('§12.8 — ₹4,000 across three uneven contributors sums to exactly 4000', () => {
  const shares = S.splitProRata(4000, [
    { artisanId: 'a', grams: 7000, at: at(1) },
    { artisanId: 'b', grams: 4500, at: at(2) },
    { artisanId: 'c', grams: 3500, at: at(3) },
  ]);
  assert.equal(sum(shares), 4000);
  // 7000/15000 of 4000 is 1866.67, 4500 is 1200, 3500 is 933.33.
  assert.deepEqual(shares.map((row) => row.amount), [1867, 1200, 933]);
});

// ------------------------------------------------------------- the material

test('normaliseMaterial pools a known material, a synonym, and nothing else', () => {
  assert.equal(S.normaliseMaterial('SILK_OFFCUT'), 'SILK_OFFCUT');
  assert.equal(S.normaliseMaterial('  silk offcut '), 'SILK_OFFCUT');
  assert.equal(S.normaliseMaterial('wood'), 'WOOD_SHAVING');
  assert.equal(S.normaliseMaterial('Brass'), 'METAL_SCRAP');
  assert.equal(S.normaliseMaterial('terracotta'), 'CLAY');
});

test('§12.7 case 8 — an unrecognised material pools under OTHER rather than being mislabelled', () => {
  for (const raw of ['sequins', '', '   ', '!!!', 'खराब', null, undefined, 42]) {
    assert.equal(S.normaliseMaterial(raw), 'OTHER', JSON.stringify(raw));
  }
});

test('every material has an i18n key and a threshold', () => {
  for (const material of S.SCRAP_MATERIALS) {
    assert.equal(S.materialLabelKey(material), `scrap_material_${material.toLowerCase()}`);
    assert.ok(Number.isInteger(S.LOT_THRESHOLD_GRAMS[material]), `${material} has no threshold`);
    assert.ok(S.LOT_THRESHOLD_GRAMS[material] > 0, `${material}'s threshold is not a real weight`);
  }
  assert.equal(Object.keys(S.LOT_THRESHOLD_GRAMS).length, S.SCRAP_MATERIALS.length);
});

// ------------------------------------------------------------ the threshold

test('§12.7 case 2 — exactly at the threshold lists, one gram under does not', () => {
  for (const material of S.SCRAP_MATERIALS) {
    const need = S.LOT_THRESHOLD_GRAMS[material];
    assert.equal(S.meetsThreshold(material, need), true, `${material} at exactly ${need} g must list`);
    assert.equal(S.meetsThreshold(material, need - 1), false, `${material} at ${need - 1} g must not list`);
    assert.equal(S.meetsThreshold(material, need + 1), true);
    assert.equal(S.meetsThreshold(material, 0), false);
  }
});

// ---------------------------------------------------------------- the weight

test('formatWeight keeps grams under a kilo and rounds kilos to one decimal', () => {
  assert.deepEqual(S.formatWeight(0), { value: 0, unitKey: 'scrap_unit_g' });
  assert.deepEqual(S.formatWeight(999), { value: 999, unitKey: 'scrap_unit_g' });
  assert.deepEqual(S.formatWeight(1000), { value: 1, unitKey: 'scrap_unit_kg' });
  assert.deepEqual(S.formatWeight(7200), { value: 7.2, unitKey: 'scrap_unit_kg' });
  assert.deepEqual(S.formatWeight(15_000), { value: 15, unitKey: 'scrap_unit_kg' });
  assert.deepEqual(S.formatWeight(7249), { value: 7.2, unitKey: 'scrap_unit_kg' });
  // Never negative, never NaN, whatever it is handed.
  assert.deepEqual(S.formatWeight(-40), { value: 0, unitKey: 'scrap_unit_g' });
  assert.deepEqual(S.formatWeight(Number.NaN), { value: 0, unitKey: 'scrap_unit_g' });
});

test('sharePercent is a real proportion and never divides by zero', () => {
  assert.equal(S.sharePercent(3000, 12_000), 25);
  assert.equal(S.sharePercent(1, 3), 33.3);
  assert.equal(S.sharePercent(0, 12_000), 0);
  assert.equal(S.sharePercent(500, 0), 0);
  assert.equal(S.sharePercent(Number.NaN, 100), 0);
});

// ------------------------------------------------------------- the location

test('§12.7 case 9 — a village name never reaches the public board', () => {
  // Three parts: the first is the precise one and is dropped.
  assert.equal(S.publicAreaLabel('Kanihama, Srinagar, Jammu & Kashmir'), 'Srinagar, Jammu & Kashmir');
  assert.equal(S.publicAreaLabel('Jitwarpur, Madhubani, Bihar'), 'Madhubani, Bihar');
  assert.equal(S.publicAreaLabel('Bhuj, Kutch, Gujarat'), 'Kutch, Gujarat');
  // Two parts: the first could be a district or a hamlet, so only the state goes out.
  assert.equal(S.publicAreaLabel('Bargarh, Odisha'), 'Odisha');
  assert.equal(S.publicAreaLabel('Raghurajpur, Odisha'), 'Odisha');
  assert.equal(S.publicAreaLabel('Channapatna, Karnataka'), 'Karnataka');
  // One part: published only when it is certainly a state or union territory.
  assert.equal(S.publicAreaLabel('Telangana'), 'Telangana');
  assert.equal(S.publicAreaLabel('delhi'), 'Delhi');
  assert.equal(S.publicAreaLabel('Bhubaneswar'), null);
  assert.equal(S.publicAreaLabel('Raghurajpur'), null);
  assert.equal(S.publicAreaLabel(''), null);
  assert.equal(S.publicAreaLabel(null), null);
  assert.equal(S.publicAreaLabel(undefined), null);
});

test('the area label never carries more parts than the location it came from', () => {
  const samples = [
    'Kanihama, Srinagar, Jammu & Kashmir',
    'Jitwarpur, Madhubani, Bihar',
    'Bargarh, Odisha',
    'Bhoodan Pochampally, Telangana',
    'Bhubaneswar',
  ];
  for (const location of samples) {
    const area = S.publicAreaLabel(location);
    if (area === null) continue;
    const first = location.split(',')[0].trim().toLowerCase();
    assert.ok(
      !area.toLowerCase().split(',').map((part) => part.trim()).includes(first),
      `"${area}" still names "${first}", the most precise part of "${location}"`
    );
  }
});

// ----------------------------------------------------------- the public row

test('toPublicPool carries an allow-list and nothing else — no id, name or contact', () => {
  const row = S.toPublicPool({
    id: 'pool-1',
    material: 'cotton offcut',
    totalGrams: 16_400,
    contributorCount: 4,
    area: 'Madhubani, Bihar',
    listedAt: new Date('2026-09-19T04:30:00Z'),
    // Fields a careless implementation would pass straight through.
    clusterKey: 'auto:jitwarpur, madhubani, bihar',
    recyclerContact: '99999 00000',
    salePriceRupees: 4000,
  });
  assert.deepEqual(Object.keys(row).sort(), [
    'area',
    'contributorCount',
    'id',
    'listedAt',
    'material',
    'totalGrams',
  ]);
  assert.equal(row.material, 'COTTON_OFFCUT');
  const serialised = JSON.stringify(row);
  for (const leak of ['auto:', 'jitwarpur', '99999', 'salePrice', 'recycler', 'artisan']) {
    assert.ok(!serialised.toLowerCase().includes(leak.toLowerCase()), `public row leaks "${leak}"`);
  }
});

test('poolStatusKey names the three real statuses', () => {
  assert.equal(S.poolStatusKey('OPEN'), 'scrap_pool_status_open');
  assert.equal(S.poolStatusKey('LISTED'), 'scrap_pool_status_listed');
  assert.equal(S.poolStatusKey('SOLD'), 'scrap_pool_status_sold');
});

// ------------------------------------------------------------------- i18n

const DICTS = ['en', 'hi', 'or', 'te'].map((lang) => ({
  lang,
  src: readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8'),
}));

test('every material and pool status is translated in all four dictionaries', () => {
  const keys = [
    ...S.SCRAP_MATERIALS.map((material) => S.materialLabelKey(material)),
    ...['OPEN', 'LISTED', 'SOLD'].map((status) => S.poolStatusKey(status)),
    'scrap_unit_g',
    'scrap_unit_kg',
  ];
  for (const { lang, src } of DICTS) {
    for (const key of keys) {
      assert.ok(new RegExp(`\\n\\s*${key}:`).test(src), `${lang}.ts is missing ${key}`);
    }
  }
});

test('no scrap string in any language presents the threshold as a market fact', () => {
  // `scrap_threshold_note` is the string whose job is to DENY being a market
  // standard, so it is the one place the phrase may appear.
  const FORBIDDEN = [/market (rate|price|standard)/i, /estimated value/i, /worth about/i, /guaranteed/i];
  for (const { lang, src } of DICTS) {
    for (const match of src.matchAll(/\n\s*(scrap_[a-z0-9_]+):\s*"((?:[^"\\]|\\.)*)"/g)) {
      const [, key, value] = match;
      if (key === 'scrap_threshold_note') continue;
      for (const pattern of FORBIDDEN) {
        assert.ok(!pattern.test(value), `${lang}.${key} claims ${pattern}: "${value}"`);
      }
    }
  }
});

test('the scrap surfaces say the weight is self-reported and the price is not set', () => {
  const surfaces = [
    'src/components/workshop/ScrapSection.tsx',
    'src/app/scrap/ScrapBoardClient.tsx',
  ];
  for (const file of surfaces) {
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes('scrap_self_reported'), `${file} does not say the weight is self-reported`);
    assert.ok(src.includes('scrap_price_not_set'), `${file} does not say the price is not set`);
  }
});

// --------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\nscrap: ${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`scrap: ${checks} checks passed`);
