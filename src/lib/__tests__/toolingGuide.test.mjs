/**
 * What the repair tab is allowed to say.
 *
 * The rule this file exists to enforce: Karigari has no verified register of
 * repair shops, so nothing it prints may look like one. A model that answers
 * "call Ravi at 98765 43210" must lose the number before the text leaves the
 * server, a cost range without a stated basis must become null rather than a
 * price an artisan quotes to a repairer, and the curated fallback must match the
 * craft's own equipment.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/toolingGuide.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-tooling-'));
const outfile = path.join(outDir, 'toolingGuide.mjs');
await esbuild.build({ entryPoints: ['src/lib/toolingGuide.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
const guide = await import(pathToFileURL(outfile).href);

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

// ------------------------------------------------- the hard contact guard

test('a phone number is stripped however it is written', () => {
  const cases = [
    'Call Ravi at 9876543210 for the reed',
    'Call Ravi at 98765 43210 for the reed',
    'Call Ravi at 98765-43210 for the reed',
    'Call Ravi at +91 98765 43210 for the reed',
  ];
  for (const text of cases) {
    const clean = guide.stripContactDetails(text);
    assert.ok(!/\d{5}/.test(clean), `${text} → ${clean}`);
    assert.ok(!/98765/.test(clean), clean);
  }
});

test('emails, links and bare domains go too', () => {
  assert.ok(!guide.stripContactDetails('write to loomfix@gmail.com today').includes('@'));
  assert.ok(!/http/.test(guide.stripContactDetails('see https://loomrepair.example.com/prices')));
  assert.ok(!/www\./.test(guide.stripContactDetails('see www.loomrepair.in for rates')));
  assert.ok(!/\.com/.test(guide.stripContactDetails('order from loomparts.com quickly')));
});

test('ordinary numbers an artisan needs are kept', () => {
  assert.equal(guide.stripContactDetails('a 5 mm gap on the 12 inch beam'), 'a 5 mm gap on the 12 inch beam');
  assert.ok(guide.stripContactDetails('about ₹1,200 for the part').includes('1,200'));
  assert.ok(guide.stripContactDetails('it lasts 2 to 3 years').includes('2 to 3 years'));
});

test('cleanBriefText also removes control characters and caps the length', () => {
  const nul = String.fromCharCode(0);
  assert.equal(guide.cleanBriefText(`the${nul} reed   is bent `, 100), 'the reed is bent');
  assert.equal(Array.from(guide.cleanBriefText('क'.repeat(300), guide.MAX_BRIEF_FIELD)).length, guide.MAX_BRIEF_FIELD);
  assert.equal(guide.cleanBriefText(42, 10), '');
});

// --------------------------------------------------- normalising a brief

test('a model answer keeps its useful parts and loses the rest', () => {
  const brief = guide.normaliseToolingBrief({
    commonFaults: [
      { part: 'Reed', symptom: 'Threads crowd', whoFixesIt: 'the loom mechanic — call 9876543210' },
      { part: '', symptom: 'no part named', whoFixesIt: 'x' },
      { part: 'Shuttle', symptom: '', whoFixesIt: 'y' },
      'not an object',
    ],
    localTerms: ['phani', '', 'dandi'],
    questionsToAsk: ['Can it be straightened?'],
    typicalCostBand: { low: 300, high: 900, note: 'Reed straightening in a weaving cluster' },
  });
  assert.deepEqual(brief.commonFaults.map((f) => f.part), ['Reed']);
  assert.ok(!/9876543210/.test(brief.commonFaults[0].whoFixesIt), brief.commonFaults[0].whoFixesIt);
  assert.deepEqual(brief.localTerms, ['phani', 'dandi']);
  assert.deepEqual(brief.questionsToAsk, ['Can it be straightened?']);
  assert.deepEqual(brief.typicalCostBand, { low: 300, high: 900, note: 'Reed straightening in a weaving cluster' });
});

test('a cost band with no stated basis, or an impossible range, is dropped', () => {
  const noNote = guide.normaliseToolingBrief({ commonFaults: [{ part: 'a', symptom: 'b' }], typicalCostBand: { low: 100, high: 500 } });
  assert.equal(noNote.typicalCostBand, null);
  const reversed = guide.normaliseToolingBrief({ commonFaults: [{ part: 'a', symptom: 'b' }], typicalCostBand: { low: 900, high: 100, note: 'x' } });
  assert.equal(reversed.typicalCostBand, null);
  const zero = guide.normaliseToolingBrief({ commonFaults: [{ part: 'a', symptom: 'b' }], typicalCostBand: { low: 0, high: 0, note: 'x' } });
  assert.equal(zero.typicalCostBand, null);
});

test('garbage in gives an empty, usable-free brief rather than a crash', () => {
  for (const raw of [null, undefined, 'text', 42, [], {}]) {
    const brief = guide.normaliseToolingBrief(raw);
    assert.deepEqual(brief.commonFaults, []);
    assert.equal(brief.typicalCostBand, null);
    assert.equal(guide.briefIsUsable(brief), false);
  }
  assert.equal(
    guide.briefIsUsable(guide.normaliseToolingBrief({ questionsToAsk: ['What will it cost?'] })),
    true
  );
});

// ------------------------------------------------------- curated fallback

test('the curated guide follows the craft\'s own equipment', () => {
  const slugs = (craft) => guide.curatedToolingFor(craft).map((e) => e.slug);
  assert.equal(guide.toolingFamilyFor('Sambalpuri Ikat Silk Saree'), 'loom-textile');
  assert.ok(slugs('Sambalpuri Ikat Silk Saree').includes('reed_damage'));
  assert.equal(guide.toolingFamilyFor('Blue Pottery'), 'clay');
  assert.ok(slugs('Blue Pottery').includes('kiln_cracks'));
  assert.equal(guide.toolingFamilyFor('Dhokra metal casting'), 'metal');
  assert.ok(slugs('Dhokra metal casting').includes('furnace_lining'));
  assert.equal(guide.toolingFamilyFor('Channapatna lacquered toys'), 'wood-lacquer');
  assert.equal(guide.toolingFamilyFor('Pattachitra painting'), 'paint-surface');
});

test('every craft gets the general workshop entries as well, and never an empty list', () => {
  for (const craft of ['Kutch Embroidery', 'Blue Pottery', 'something nobody has heard of', '', null]) {
    const slugs = guide.curatedToolingFor(craft).map((e) => e.slug);
    assert.ok(slugs.length >= 3, String(craft));
    for (const general of ['power_supply', 'storage_damp', 'hand_tools']) {
      assert.ok(slugs.includes(general), `${craft} missing ${general}`);
    }
  }
});

test('every curated entry has its three strings in all four dictionaries', () => {
  const dicts = Object.fromEntries(['en', 'hi', 'or', 'te'].map((lang) => [lang, readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8')]));
  for (const entry of guide.TOOLING_GUIDE) {
    for (const key of Object.values(guide.toolingKeys(entry))) {
      assert.ok(/^tooling_[a-z0-9_]+$/.test(key), key);
      for (const [lang, src] of Object.entries(dicts)) {
        assert.ok(new RegExp(`^  ${key}: "`, 'm').test(src), `${lang} missing ${key}`);
      }
    }
  }
});

test('no curated string names a business or a number', () => {
  const en = readFileSync('src/lib/i18n/en.ts', 'utf8');
  for (const entry of guide.TOOLING_GUIDE) {
    for (const key of Object.values(guide.toolingKeys(entry))) {
      const value = (en.match(new RegExp(`^  ${key}: "((?:[^"\\\\]|\\\\.)*)",$`, 'm')) || [])[1] ?? '';
      assert.equal(guide.stripContactDetails(value), value, `${key} would be altered by the contact guard`);
    }
  }
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} tooling checks failed`);
  process.exit(1);
}
console.log(`toolingGuide: all ${checks} checks passed`);
