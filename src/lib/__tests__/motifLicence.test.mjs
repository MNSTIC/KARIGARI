/**
 * What a licence fee may become, and what a motif record may say.
 *
 * Two rules this file enforces. **No money rounds away**: every split is
 * asserted to sum to exactly the fee, including the awkward remainders, because
 * a payout ledger that quietly keeps a rupee is the one bug a cluster would be
 * right never to forgive. And **no surface claims a legal status this app
 * cannot grant**: a sentence mentioning a GI, a trademark, a patent or a
 * blockchain is dropped whole rather than softened.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/motifLicence.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-motiflicence-'));
const outfile = path.join(outDir, 'motifLicence.mjs');
await esbuild.build({
  entryPoints: ['src/lib/motifLicence.ts'],
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

const ids = (n) => Array.from({ length: n }, (_, i) => `artisan-${i}`);
const sum = (shares) => shares.reduce((total, share) => total + share.amount, 0);

// ------------------------------------------------------------- the split

test('the worked example: 1000 across 3 is 334/333/333', () => {
  const shares = L.splitFee(1000, ids(3));
  assert.deepEqual(shares.map((s) => s.amount), [334, 333, 333]);
  assert.equal(sum(shares), 1000);
});

test('a share is never lost, for any fee and any cluster size', () => {
  for (const total of [1, 2, 3, 7, 99, 100, 1000, 12_345, 250_000]) {
    for (const size of [1, 2, 3, 4, 5, 7, 11, 13]) {
      const shares = L.splitFee(total, ids(size));
      assert.equal(sum(shares), total, `${total} across ${size}`);
      assert.equal(shares.length, size);
      // No share may be negative, and no two may differ by more than a rupee.
      const amounts = shares.map((s) => s.amount);
      assert.ok(Math.min(...amounts) >= 0, `${total}/${size} went negative`);
      assert.ok(Math.max(...amounts) - Math.min(...amounts) <= 1, `${total}/${size} is uneven`);
    }
  }
});

test('the remainder goes to the earliest registrants, in order', () => {
  const shares = L.splitFee(10, ids(4));
  assert.deepEqual(shares.map((s) => s.amount), [3, 3, 2, 2]);
  assert.deepEqual(shares.map((s) => s.artisanId), ['artisan-0', 'artisan-1', 'artisan-2', 'artisan-3']);
});

test('a cluster of one receives the whole fee', () => {
  assert.deepEqual(L.splitFee(5000, ['only']), [{ artisanId: 'only', amount: 5000 }]);
});

test('a fee smaller than the cluster still pays whoever it reaches, and loses nothing', () => {
  const shares = L.splitFee(2, ids(5));
  assert.equal(sum(shares), 2);
  assert.deepEqual(shares.map((s) => s.amount), [1, 1, 0, 0, 0]);
});

test('an impossible split throws rather than writing a wrong ledger', () => {
  assert.throws(() => L.splitFee(0, ids(3)), /positive whole number/);
  assert.throws(() => L.splitFee(-100, ids(3)), /positive whole number/);
  assert.throws(() => L.splitFee(10.5, ids(3)), /positive whole number/);
  assert.throws(() => L.splitFee(100, []), /no artisan/);
});

// --------------------------------------------------------- the transitions

test('a licence walks forward and never back', () => {
  assert.equal(L.canMoveLicence('REQUESTED', 'ACCEPTED'), true);
  assert.equal(L.canMoveLicence('ACCEPTED', 'PAID'), true);
  assert.equal(L.canMoveLicence('PAID', 'ACCEPTED'), false);
  assert.equal(L.canMoveLicence('DECLINED', 'ACCEPTED'), false, 'a decline must not be quietly re-opened');
  assert.equal(L.canMoveLicence('REQUESTED', 'PAID'), false, 'nothing is paid without being accepted');
});

test('payout is refused for every reason it should be, and allowed once', () => {
  assert.equal(L.payoutRefusal({ status: 'ACCEPTED', feeAmount: 1000, paidAt: null }), null);
  assert.equal(L.payoutRefusal({ status: 'ACCEPTED', feeAmount: 1000, paidAt: new Date() }), 'ALREADY_PAID');
  assert.equal(L.payoutRefusal({ status: 'REQUESTED', feeAmount: 1000, paidAt: null }), 'NOT_ACCEPTED');
  assert.equal(L.payoutRefusal({ status: 'ACCEPTED', feeAmount: null, paidAt: null }), 'NO_FEE');
  assert.equal(L.payoutRefusal({ status: 'ACCEPTED', feeAmount: 0, paidAt: null }), 'NO_FEE');
});

// --------------------------------------------------------- the claim guard

test('a sentence claiming a legal status is dropped whole', () => {
  const d = L.normaliseDescriptors(
    { symmetry: 'Mirrored about the vertical axis. This motif is GI-protected.', repeatUnit: 'A single fish.' },
    'AI'
  );
  assert.equal(d.symmetry, 'Mirrored about the vertical axis.');
  assert.equal(d.repeatUnit, 'A single fish.');
});

test('every forbidden claim is caught, in a sentence or a term', () => {
  for (const claim of [
    'This is a GI tag.',
    'A geographical indication of the region.',
    'The pattern is trademarked.',
    'Patented by the cluster.',
    'Copyrighted since 1998.',
    'It is legally protected.',
    'Registered intellectual property.',
    'Stored on the blockchain.',
    'Blockchain-verified provenance.',
    'AI authenticated.',
    'A certified original.',
  ]) {
    assert.equal(L.claimsLegalStatus(claim), true, claim);
    assert.equal(L.normaliseDescriptors({ symmetry: claim }, 'AI').symmetry, '', claim);
  }
});

test('an ordinary description survives untouched', () => {
  const text = 'Four-fold rotational symmetry about the centre of each tile.';
  assert.equal(L.normaliseDescriptors({ symmetry: text }, 'AI').symmetry, text);
});

test('a motif name that claims a legal status is refused outright', () => {
  assert.equal(L.cleanMotifName('Bandha fish'), 'Bandha fish');
  assert.equal(L.cleanMotifName('GI-registered fish'), null);
  assert.equal(L.cleanMotifName('   '), null);
  assert.equal(L.cleanMotifName(42), null);
});

// --------------------------------------------------------- the descriptors

test('garbage in gives an empty, unusable descriptor record rather than a crash', () => {
  for (const raw of [null, undefined, 'text', 42, [], {}]) {
    const d = L.normaliseDescriptors(raw, 'HEURISTIC');
    assert.deepEqual(d.motifs, []);
    assert.deepEqual(d.palette, []);
    assert.equal(d.confidence, null);
    assert.equal(d.source, 'HEURISTIC');
    assert.equal(L.descriptorsAreUsable(d), false);
  }
});

test('a heuristic reading never carries a confidence figure', () => {
  const d = L.normaliseDescriptors({ confidence: 0.92, palette: ['#1f3a68'] }, 'HEURISTIC');
  assert.equal(d.confidence, null, 'a colour histogram has no confidence to report');
  assert.equal(d.source, 'HEURISTIC');
});

test('an AI confidence survives only when the model actually gave one, inside 0-1', () => {
  assert.equal(L.normaliseDescriptors({ confidence: 0.83 }, 'AI').confidence, 0.83);
  for (const bad of [0, -1, 1.5, 'high', null, undefined, NaN]) {
    assert.equal(L.normaliseDescriptors({ confidence: bad }, 'AI').confidence, null, String(bad));
  }
});

test('colours must be real hex, and terms are capped and de-duplicated', () => {
  const d = L.normaliseDescriptors(
    { palette: ['#1F3A68', 'indigo', '#1f3a68', '#9c3b2e'], motifs: ['fish', 'fish', '', 'temple'] },
    'AI'
  );
  assert.deepEqual(d.palette, ['#1f3a68', '#9c3b2e']);
  assert.deepEqual(d.motifs, ['fish', 'temple']);
});

test('a link cannot ride into a descriptor', () => {
  const d = L.normaliseDescriptors({ repeatUnit: 'A fish, see https://example.test/motif for more' }, 'AI');
  assert.ok(!d.repeatUnit.includes('http'), d.repeatUnit);
});

// ------------------------------------------------------------- the public shape

test('a public record carries a readable cluster name, never the raw key', () => {
  assert.equal(L.clusterDisplayName('auto:bargarh, odisha'), 'Bargarh, Odisha');
  assert.equal(L.clusterDisplayName('Sambalpuri Weavers SHG'), 'Sambalpuri Weavers SHG');
});

test('a public record has no field that could carry contact details or an id', () => {
  const pub = L.toPublicMotif({
    id: 'motif-1',
    name: 'Bandha fish',
    hash: '9f8e7d6c5b4a3928',
    clusterKey: 'auto:bargarh, odisha',
    submittedBy: { name: 'Lakshmi Meher' },
    descriptors: { motifs: ['fish'], source: 'AI', confidence: 0.8 },
    referenceImageUrl: null,
    status: 'REGISTERED',
    licensable: true,
    registeredAt: new Date('2026-09-18T06:00:00Z'),
  });
  assert.deepEqual(
    Object.keys(pub).sort(),
    ['clusterName', 'descriptors', 'hash', 'id', 'licensable', 'name', 'referenceImageUrl', 'registeredAt', 'status', 'submittedBy'].sort()
  );
  const json = JSON.stringify(pub).toLowerCase();
  for (const forbidden of ['mobile', 'phone', 'email', 'upi', 'aadhaar', 'contact', 'submittedbyid', 'clusterkey', 'auto:']) {
    assert.ok(!json.includes(forbidden), `${forbidden} appears in the public record`);
  }
});

// ------------------------------------------------ the disclaimer must exist

test('the disclaimer text is in all four dictionaries and denies the three claims', () => {
  for (const lang of ['en', 'hi', 'or', 'te']) {
    const src = readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8');
    assert.ok(new RegExp('^  motif_disclaimer: "', 'm').test(src), `${lang} has no motif_disclaimer`);
  }
  const en = readFileSync('src/lib/i18n/en.ts', 'utf8');
  const line = (en.match(/^  motif_disclaimer: "((?:[^"\\]|\\.)*)",$/m) || [])[1] ?? '';
  for (const word of ['Geographical Indication', 'not a legal', 'Registry']) {
    assert.ok(line.includes(word), `the English disclaimer does not say "${word}": ${line}`);
  }
});

test('no motif string in any language claims a GI tag, legal protection or a blockchain', () => {
  // The disclaimer and the two flag explanations are allowed to name these
  // things, because their whole job is to deny them or to say the opposite.
  const DENIALS = new Set(['motif_disclaimer', 'motif_licence_submitted_note', 'motif_payout_simulated_note']);
  const CLAIM = /\bGI\b|geographical indication|भौगोलिक संकेत|ଭୌଗୋଳିକ ସୂଚକ|భౌగోళిక సూచిక|blockchain|ब्लॉकचेन|trademark|patent|copyright/i;

  for (const lang of ['en', 'hi', 'or', 'te']) {
    const src = readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8');
    for (const match of src.matchAll(/^  (motif_[a-z0-9_]+): "((?:[^"\\]|\\.)*)",$/gm)) {
      const [, key, value] = match;
      if (DENIALS.has(key)) continue;
      assert.ok(!CLAIM.test(value), `${lang}.${key} makes a claim this app cannot grant: ${value}`);
    }
  }
});

test('every motif surface renders the disclaimer', () => {
  // The component, not a copy of its text: a screen that forgot it would be a
  // screen making an unqualified registration claim.
  for (const file of [
    'src/app/artisan/motifs/page.tsx',
    'src/app/motif/[id]/MotifRecordClient.tsx',
    'src/components/admin/MotifReviews.tsx',
  ]) {
    const src = readFileSync(file, 'utf8');
    assert.ok(/<MotifDisclaimer/.test(src), `${file} does not render MotifDisclaimer`);
  }
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} motif-licence checks failed`);
  process.exit(1);
}
console.log(`motifLicence: all ${checks} checks passed`);
