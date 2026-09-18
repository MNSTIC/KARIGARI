/**
 * What a motif fingerprint is allowed to conclude.
 *
 * The register exists to resist appropriation, so the two ways it can fail are
 * both serious: a false DISTINCT lets the same motif be registered twice by
 * different clusters, and a false DUPLICATE tells an artisan their own pattern
 * already belongs to somebody else. The thresholds are therefore asserted at
 * their exact boundaries rather than described in a comment, and a malformed
 * hash throws instead of quietly returning a large distance — a typo must never
 * read as "these are very different".
 *
 * Only the pure half is tested here. `hashImageDataUrl` needs a canvas and is
 * verified in the browser.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/motifHash.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-motifhash-'));
const outfile = path.join(outDir, 'motifHash.mjs');
await esbuild.build({
  entryPoints: ['src/lib/motifHash.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'error',
  alias: { '@': path.resolve('src') },
});
const H = await import(pathToFileURL(outfile).href);

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

/** A hash that differs from `base` in exactly `bits` positions. */
function flip(base, bits) {
  const value = BigInt(`0x${base}`) ^ ((1n << BigInt(bits)) - 1n);
  return value.toString(16).padStart(16, '0');
}

const A = '9f8e7d6c5b4a3928';

// ------------------------------------------------------------- the distance

test('a fingerprint is identical to itself', () => {
  assert.equal(H.hammingDistance(A, A), 0);
});

test('a known pair has the distance its bits say it has', () => {
  // 0000… vs ffff… is all 64 bits.
  assert.equal(H.hammingDistance('0000000000000000', 'ffffffffffffffff'), H.HASH_BITS);
  // One nibble apart: 0x0 vs 0xf is four bits.
  assert.equal(H.hammingDistance('0000000000000000', '000000000000000f'), 4);
  // A hand-checked pair: 0xa (1010) vs 0x5 (0101) differ in all four bits.
  assert.equal(H.hammingDistance('aaaaaaaaaaaaaaaa', '5555555555555555'), H.HASH_BITS);
});

test('flipping n bits gives a distance of exactly n', () => {
  for (const bits of [1, 6, 7, 14, 15, 32]) {
    assert.equal(H.hammingDistance(A, flip(A, bits)), bits, `${bits} bits`);
  }
});

test('distance does not depend on the order of the two hashes', () => {
  const other = flip(A, 9);
  assert.equal(H.hammingDistance(A, other), H.hammingDistance(other, A));
});

test('case and surrounding space do not change a fingerprint', () => {
  assert.equal(H.hammingDistance(A, `  ${A.toUpperCase()}  `), 0);
});

// -------------------------------------------------------- malformed inputs

test('a malformed hash throws rather than reading as very different', () => {
  for (const bad of ['', 'nothex0000000000', '9f8e7d6c5b4a392', '9f8e7d6c5b4a39288', null, undefined, 42, {}]) {
    assert.throws(() => H.hammingDistance(A, bad), /motifHash/, `accepted ${JSON.stringify(bad)}`);
  }
});

test('the format guard accepts only 16 lower-case hex characters', () => {
  assert.equal(H.isMotifHash(A), true);
  assert.equal(H.normaliseHash(` ${A.toUpperCase()} `), A);
  for (const bad of ['zzzzzzzzzzzzzzzz', '9f8e7d6c5b4a392', '', null, 0]) {
    assert.equal(H.isMotifHash(bad), false, String(bad));
    assert.equal(H.normaliseHash(bad), null, String(bad));
  }
});

// ------------------------------------------------------- the two thresholds

test('the DUPLICATE boundary is exactly where the constant says', () => {
  assert.equal(H.DUPLICATE_DISTANCE, 6);
  assert.equal(H.classifyDistance(0), 'DUPLICATE');
  assert.equal(H.classifyDistance(6), 'DUPLICATE');
  assert.equal(H.classifyDistance(7), 'SIMILAR');
});

test('the SIMILAR boundary is exactly where the constant says', () => {
  assert.equal(H.SIMILAR_DISTANCE, 14);
  assert.equal(H.classifyDistance(14), 'SIMILAR');
  assert.equal(H.classifyDistance(15), 'DISTINCT');
  assert.equal(H.classifyDistance(H.HASH_BITS), 'DISTINCT');
});

test('a re-crop sized change lands in DUPLICATE, a different fabric in DISTINCT', () => {
  assert.equal(H.classifyDistance(H.hammingDistance(A, flip(A, 4))), 'DUPLICATE');
  assert.equal(H.classifyDistance(H.hammingDistance(A, flip(A, 30))), 'DISTINCT');
});

// ------------------------------------------------------------ the search

test('the nearest match is the nearest, with its distance and verdict', () => {
  const rows = [
    { id: 'far', hash: flip(A, 40) },
    { id: 'near', hash: flip(A, 3) },
    { id: 'middling', hash: flip(A, 10) },
  ];
  const best = H.nearestHash(A, rows);
  assert.equal(best.row.id, 'near');
  assert.equal(best.distance, 3);
  assert.equal(best.verdict, 'DUPLICATE');
});

test('an empty register has no nearest match, rather than a default one', () => {
  assert.equal(H.nearestHash(A, []), null);
});

test('one malformed stored row cannot stop every future registration', () => {
  const rows = [{ id: 'broken', hash: 'not-a-hash' }, { id: 'good', hash: flip(A, 20) }];
  const best = H.nearestHash(A, rows);
  assert.equal(best.row.id, 'good');
  assert.equal(best.distance, 20);
});

// ------------------------------------------------------------- the display

test('a fingerprint is grouped so it can be read aloud', () => {
  assert.equal(H.formatHash(A), '9f8e 7d6c 5b4a 3928');
  assert.equal(H.formatHash('nope'), '');
});

test('the hash geometry produces exactly the bits the constants claim', () => {
  assert.equal((H.HASH_GRID - 1) * H.HASH_ROWS, H.HASH_BITS);
  assert.equal(H.HASH_BITS / 4, H.HASH_HEX_LENGTH);
});

// ------------------------------------------------------------ the statuses

test('the status vocabularies are closed', () => {
  assert.deepEqual([...H.MOTIF_STATUSES], ['PENDING', 'REGISTERED', 'FLAGGED_DUPLICATE', 'REJECTED']);
  assert.deepEqual([...H.LICENCE_STATUSES], ['REQUESTED', 'ACCEPTED', 'DECLINED', 'PAID', 'WITHDRAWN']);
  assert.equal(H.isMotifStatus('REGISTERED'), true);
  assert.equal(H.isMotifStatus('GI_GRANTED'), false, 'a status this app must never have');
  assert.equal(H.isLicenceStatus('PAID'), true);
  assert.equal(H.isLicenceStatus('anything else'), false);
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} motif-hash checks failed`);
  process.exit(1);
}
console.log(`motifHash: all ${checks} checks passed`);
