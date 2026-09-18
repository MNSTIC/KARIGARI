/**
 * What the Design Lab is allowed to say about a pattern.
 *
 * The drawing is safe by construction (see motifSpec.test.mjs). The prose is
 * not: it is whatever a model wrote. Two things it must never carry onto the
 * screen — a way to contact somebody, and a claim that the generated pattern is
 * authentic or belongs to a community. The second is the one that matters here:
 * this app does not get to tell an artisan that a shape a model picked is their
 * tradition.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/designLab.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-lab-'));
const outfile = path.join(outDir, 'designLab.mjs');
await esbuild.build({
  entryPoints: ['src/lib/designLab.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'error',
  alias: { '@': path.resolve('src') },
});
const L = await import(pathToFileURL(outfile).href);

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

// ------------------------------------------------------- the contact guard

test('a phone number is stripped however it is written', () => {
  for (const text of [
    'Order the yarn from Ravi at 9876543210',
    'Order the yarn from Ravi at 98765 43210',
    'Order the yarn from Ravi at 98765-43210',
    'Order the yarn from Ravi at +91 98765 43210',
  ]) {
    const clean = L.stripContacts(text);
    assert.ok(!/98765/.test(clean), `${text} → ${clean}`);
  }
});

test('emails, links and bare domains go too', () => {
  assert.ok(!L.stripContacts('write to dyes@example.com').includes('@'));
  assert.ok(!/http/.test(L.stripContacts('see https://dyes.example.com/indigo')));
  assert.ok(!/www\./.test(L.stripContacts('see www.indigo.in for rates')));
  assert.ok(!/\.com/.test(L.stripContacts('buy from indigoyarn.com')));
});

test('the numbers a pattern note legitimately needs are kept', () => {
  assert.equal(L.stripContacts('a 5 mm border on 8 inch cloth'), 'a 5 mm border on 8 inch cloth');
  assert.ok(L.cleanNote('roughly 12 days of weaving', 100).includes('12 days'));
});

// -------------------------------------------------------- the claim guard

test('a sentence claiming authenticity is dropped whole', () => {
  const kept = L.dropClaims('Small fish in three rows. This is an authentic traditional motif.');
  assert.equal(kept, 'Small fish in three rows.');
});

test('a sentence assigning the pattern to a group is dropped whole', () => {
  for (const claim of [
    'It belongs to the weaving community of that district.',
    'This design is GI-tagged.',
    'A centuries-old village pattern.',
    'The sacred form used in temple cloth.',
  ]) {
    const note = `A diamond grid in two colours. ${claim}`;
    const kept = L.dropClaims(note);
    assert.equal(kept, 'A diamond grid in two colours.', claim);
  }
});

test('an ordinary description survives untouched', () => {
  const note = 'Diamonds sit in a half-drop repeat, so each row shifts against the one above it.';
  assert.equal(L.dropClaims(note), note);
});

// ------------------------------------------------- the whole notes object

test('garbage in gives an empty, usable-free notes object rather than a crash', () => {
  for (const raw of [null, undefined, 'text', 42, [], {}]) {
    const notes = L.cleanLabNotes(raw);
    assert.equal(notes.motifNotes, '');
    assert.deepEqual(notes.paletteNames, []);
    assert.equal(notes.laborDaysEstimate, null);
    assert.equal(L.notesAreUsable(notes), false);
  }
});

test('a model answer keeps its useful parts and loses the rest', () => {
  const notes = L.cleanLabNotes({
    motifNotes: 'Fish in a brick repeat. This is the authentic pattern of that community.',
    paletteNames: ['indigo', '', 'madder red', 'indigo'],
    materialNote: 'Suits a fine cotton warp. Order from yarnshop.in or call 98765 43210.',
    laborDaysEstimate: 6,
  });
  assert.equal(notes.motifNotes, 'Fish in a brick repeat.');
  assert.deepEqual(notes.paletteNames, ['indigo', 'madder red']);
  assert.ok(!notes.materialNote.includes('98765'), notes.materialNote);
  assert.ok(!notes.materialNote.includes('yarnshop'), notes.materialNote);
  assert.equal(notes.laborDaysEstimate, 6);
  assert.equal(L.notesAreUsable(notes), true);
});

test('a labour estimate outside any sensible range becomes null, not a number', () => {
  for (const bad of [0, -3, 5000, 'soon', null, undefined, NaN]) {
    assert.equal(L.cleanLabNotes({ laborDaysEstimate: bad }).laborDaysEstimate, null, String(bad));
  }
  assert.equal(L.cleanLabNotes({ laborDaysEstimate: 6.4 }).laborDaysEstimate, 6);
  assert.equal(L.cleanLabNotes({ laborDaysEstimate: L.MAX_LABOR_DAYS }).laborDaysEstimate, L.MAX_LABOR_DAYS);
});

test('control and bidi characters cannot hide inside a note', () => {
  const nul = String.fromCharCode(0);
  const rtl = String.fromCharCode(0x202e);
  const clean = L.cleanNote(`fish${nul} in${rtl} rows`, 100);
  assert.equal(clean, 'fish in rows');
});

test('a note is capped by code points, so a long answer cannot break the panel', () => {
  const long = L.cleanNote('ଅ'.repeat(600), L.MAX_NOTE);
  assert.equal([...long].length, L.MAX_NOTE);
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} design-lab checks failed`);
  process.exit(1);
}
console.log(`designLab: all ${checks} checks passed`);
