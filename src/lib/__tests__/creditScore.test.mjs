/**
 * The production credit score: what it withholds, where it saturates, where it
 * floors, and that a better record can never score lower.
 *
 * A loan officer may be shown this number, so the arithmetic is checked here
 * against hand-computed values rather than against itself, and every input that
 * measures something good is swept upward to prove the score never drops.
 * Also covered: the share-link helpers and the snapshot allow-list the public
 * page reads through.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/creditScore.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-credit-'));
async function compile(entry, name) {
  const outfile = path.join(outDir, name);
  await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
  return import(pathToFileURL(outfile).href);
}
const credit = await compile('src/lib/creditScore.ts', 'creditScore.mjs');
const share = await compile('src/lib/creditShare.ts', 'creditShare.mjs');

const NOW = new Date('2026-09-17T06:30:00Z');

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

const ZERO = {
  verifiedListings: 0,
  totalListings: 0,
  realisedEarnings: 0,
  demandEarnings: 0,
  offlineEarnings: 0,
  ordersAccepted: 0,
  ordersDelivered: 0,
  ordersOnTime: 0,
  activeMonths: 0,
  accountAgeMonths: 0,
  buyerVerifiedScans: 0,
  guiltyTickets: 0,
  healthScore: 0,
  soldCount: 0,
  offlineSalesCount: 0,
};
const profileOf = (overrides) => credit.computeCreditProfile({ ...ZERO, ...overrides }, NOW);
const component = (profile, key) => profile.components.find((c) => c.key === key);

// ---- the formula's frame ----------------------------------------------------
test('the five weights span exactly SCORE_MIN..SCORE_MAX', () => {
  const total =
    credit.PRODUCTION_WEIGHT + credit.REVENUE_WEIGHT + credit.FULFILMENT_WEIGHT + credit.CONSISTENCY_WEIGHT + credit.TRUST_WEIGHT;
  assert.equal(credit.SCORE_MIN, 300);
  assert.equal(credit.SCORE_MAX, 900);
  assert.equal(total, credit.SCORE_MAX - credit.SCORE_MIN);
  assert.equal(credit.FULFILMENT_DELIVERY_POINTS + credit.FULFILMENT_ON_TIME_POINTS, credit.FULFILMENT_WEIGHT);
  assert.equal(credit.TRUST_HEALTH_POINTS + credit.TRUST_SCAN_POINTS, credit.TRUST_WEIGHT);
});

test('bands switch exactly at 450, 600 and 750', () => {
  assert.equal(credit.creditBand(300), 'BUILDING');
  assert.equal(credit.creditBand(449), 'BUILDING');
  assert.equal(credit.creditBand(450), 'FAIR');
  assert.equal(credit.creditBand(599), 'FAIR');
  assert.equal(credit.creditBand(600), 'GOOD');
  assert.equal(credit.creditBand(749), 'GOOD');
  assert.equal(credit.creditBand(750), 'STRONG');
  assert.equal(credit.creditBand(900), 'STRONG');
});

// ---- all zero ---------------------------------------------------------------
test('all-zero input: withheld — no score, no band, every empty component flagged', () => {
  const p = profileOf({});
  assert.equal(p.eligible, false);
  assert.equal(p.eventCount, 0);
  assert.equal(p.score, null, 'never a default 300');
  assert.equal(p.band, null);
  assert.equal(p.version, credit.CREDIT_ALGO_VERSION);
  assert.equal(p.computedAt, NOW.toISOString());
  for (const key of ['production', 'revenue', 'fulfilment', 'consistency']) {
    assert.equal(component(p, key).insufficient, true, key);
    assert.equal(component(p, key).points, 0, key);
  }
  assert.equal(component(p, 'trust').insufficient, false);
  assert.equal(component(p, 'trust').points, 0);
});

test('a brand-new artisan with the default health score is still withheld', () => {
  const p = profileOf({ healthScore: 100, totalListings: 3, accountAgeMonths: 0 });
  assert.equal(p.eligible, false);
  assert.equal(p.score, null);
});

// ---- the eligibility boundary -----------------------------------------------
test('4 events is withheld, 5 events scores — low but real, empty parts flagged', () => {
  const four = profileOf({ verifiedListings: 2, soldCount: 1, offlineSalesCount: 1, healthScore: 100, activeMonths: 1 });
  assert.equal(four.eventCount, 4);
  assert.equal(four.eligible, false);
  assert.equal(four.score, null);

  const five = profileOf({ verifiedListings: 5, totalListings: 6, healthScore: 100, activeMonths: 1 });
  assert.equal(five.eventCount, 5);
  assert.equal(five.eligible, true);
  // 150 × 5/20 = 37.5 · revenue 0 · fulfilment 0 · 80 × 1/12 = 6.7 · 60 × 100/100 = 60
  assert.equal(component(five, 'production').points, 37.5);
  assert.equal(component(five, 'consistency').points, 6.7);
  assert.equal(component(five, 'trust').points, 60);
  assert.equal(five.score, 404);
  assert.equal(five.band, 'BUILDING');
  assert.equal(component(five, 'revenue').insufficient, true);
  assert.equal(component(five, 'fulfilment').insufficient, true);
  assert.equal(component(five, 'production').insufficient, false);
});

test('eventCount = verified pieces + demand orders + storefront sales + offline sales', () => {
  const p = profileOf({ verifiedListings: 2, ordersAccepted: 1, soldCount: 3, offlineSalesCount: 4, totalListings: 9 });
  assert.equal(p.eventCount, 10);
});

// ---- saturation -------------------------------------------------------------
test('100 verified pieces scores the same production as 20 — saturates, never exceeds', () => {
  const twenty = profileOf({ verifiedListings: 20, totalListings: 20 });
  const hundred = profileOf({ verifiedListings: 100, totalListings: 100 });
  assert.equal(component(twenty, 'production').points, 150);
  assert.equal(component(hundred, 'production').points, 150);
});

test('a perfect record is exactly 900 STRONG', () => {
  const p = profileOf({
    verifiedListings: 40,
    totalListings: 40,
    realisedEarnings: 500_000,
    ordersAccepted: 10,
    ordersDelivered: 10,
    ordersOnTime: 10,
    activeMonths: 30,
    buyerVerifiedScans: 25,
    healthScore: 100,
  });
  assert.equal(p.score, 900);
  assert.equal(p.band, 'STRONG');
  for (const c of p.components) assert.equal(c.points, c.weight, c.key);
});

// ---- revenue weighting ------------------------------------------------------
test('100 % offline income counts at half weight: ₹1,00,000 logged scores like ₹50,000 verified', () => {
  const offline = profileOf({ offlineEarnings: 100_000, offlineSalesCount: 5 });
  const platform = profileOf({ realisedEarnings: 50_000, soldCount: 5 });
  assert.equal(component(offline, 'revenue').basis.weightedRevenue, 50_000);
  assert.equal(component(offline, 'revenue').points, 75);
  assert.equal(component(platform, 'revenue').points, 75);
  assert.equal(offline.score, platform.score);
  assert.equal(credit.OFFLINE_REVENUE_WEIGHT, 0.5);
});

test('revenue adds escrow and demand in full, then saturates at ₹1,00,000', () => {
  const p = profileOf({ realisedEarnings: 30_000, demandEarnings: 20_000, offlineEarnings: 10_000 });
  // 30,000 + 20,000 + 0.5 × 10,000 = 55,000 → 150 × 0.55 = 82.5
  assert.equal(component(p, 'revenue').basis.weightedRevenue, 55_000);
  assert.equal(component(p, 'revenue').points, 82.5);
  assert.equal(component(profileOf({ realisedEarnings: 1_000_000 }), 'revenue').points, 150);
});

// ---- fulfilment -------------------------------------------------------------
test('fewer than 3 accepted orders: fulfilment insufficient and 0, whatever was delivered', () => {
  const p = profileOf({ ordersAccepted: 2, ordersDelivered: 2, ordersOnTime: 2, soldCount: 12 });
  assert.equal(component(p, 'fulfilment').insufficient, true);
  assert.equal(component(p, 'fulfilment').points, 0);
  const none = profileOf({ soldCount: 12, verifiedListings: 12, healthScore: 100 });
  assert.equal(none.eligible, true, '12 storefront sales still score from the other four');
  assert.equal(component(none, 'fulfilment').insufficient, true);
});

test('fulfilment: 80 × delivered/accepted + 40 × on-time/delivered', () => {
  const p = profileOf({ ordersAccepted: 4, ordersDelivered: 3, ordersOnTime: 2 });
  // 80 × 0.75 + 40 × 2/3 = 60 + 26.67 → 86.7
  assert.equal(component(p, 'fulfilment').points, 86.7);
  assert.equal(component(profileOf({ ordersAccepted: 3 }), 'fulfilment').points, 0);
  assert.equal(component(profileOf({ ordersAccepted: 3, ordersDelivered: 3, ordersOnTime: 3 }), 'fulfilment').points, 120);
});

// ---- trust and its floor ----------------------------------------------------
test('a guilty ticket lowers trust by 25 and trust floors at 0, never negative', () => {
  const clean = profileOf({ healthScore: 100, buyerVerifiedScans: 10 });
  const one = profileOf({ healthScore: 100, buyerVerifiedScans: 10, guiltyTickets: 1 });
  assert.equal(component(clean, 'trust').points, 100);
  assert.equal(component(one, 'trust').points, 75);
  const many = profileOf({ healthScore: 55, guiltyTickets: 3, verifiedListings: 5 });
  // 60 × 0.55 − 75 = −42 → 0
  assert.equal(component(many, 'trust').points, 0);
  // 300 + 37.5 + 0 + 0 + 0 + 0 = 337.5 → 338
  assert.equal(many.score, 338);
  assert.ok(many.score >= credit.SCORE_MIN);
});

// ---- monotonicity -----------------------------------------------------------
const BASE = {
  verifiedListings: 5,
  totalListings: 8,
  realisedEarnings: 10_000,
  demandEarnings: 2_000,
  offlineEarnings: 3_000,
  ordersAccepted: 4,
  ordersDelivered: 2,
  ordersOnTime: 1,
  activeMonths: 3,
  accountAgeMonths: 4,
  buyerVerifiedScans: 2,
  guiltyTickets: 0,
  healthScore: 70,
  soldCount: 3,
  offlineSalesCount: 2,
};

function sweep(name, values, build, direction = 'up') {
  test(`monotonic: raising ${name} never ${direction === 'up' ? 'lowers' : 'raises'} the score`, () => {
    let previous = null;
    for (const value of values) {
      const p = credit.computeCreditProfile({ ...BASE, ...build(value) }, NOW);
      assert.equal(p.eligible, true);
      for (const c of p.components) {
        assert.ok(c.points >= 0 && c.points <= c.weight, `${c.key} ${c.points} outside 0..${c.weight} at ${name}=${value}`);
      }
      if (previous !== null) {
        if (direction === 'up') assert.ok(p.score >= previous, `${name}=${value}: ${p.score} < ${previous}`);
        else assert.ok(p.score <= previous, `${name}=${value}: ${p.score} > ${previous}`);
      }
      previous = p.score;
    }
  });
}
const range = (from, to, step) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

sweep('verifiedListings', range(0, 60, 1), (v) => ({ verifiedListings: v, totalListings: Math.max(8, v) }));
sweep('realisedEarnings', range(0, 250_000, 2_500), (v) => ({ realisedEarnings: v }));
sweep('demandEarnings', range(0, 250_000, 2_500), (v) => ({ demandEarnings: v }));
sweep('offlineEarnings', range(0, 400_000, 5_000), (v) => ({ offlineEarnings: v }));
sweep('activeMonths', range(0, 36, 1), (v) => ({ activeMonths: v }));
sweep('buyerVerifiedScans', range(0, 30, 1), (v) => ({ buyerVerifiedScans: v }));
sweep('healthScore', range(0, 100, 2.5), (v) => ({ healthScore: v }));
sweep('ordersOnTime (up to delivered)', range(0, 10, 1), (v) => ({ ordersAccepted: 10, ordersDelivered: 10, ordersOnTime: v }));
sweep('orders delivered on time together', range(0, 10, 1), (v) => ({ ordersAccepted: 10, ordersDelivered: v, ordersOnTime: v }));
sweep('guiltyTickets', range(0, 8, 1), (v) => ({ guiltyTickets: v, healthScore: 100, buyerVerifiedScans: 10 }), 'down');

test('same inputs, same moment → identical profile (deterministic)', () => {
  assert.deepEqual(credit.computeCreditProfile(BASE, NOW), credit.computeCreditProfile({ ...BASE }, NOW));
});

// ---- hostile input ----------------------------------------------------------
test('NaN, negatives, strings and impossible ratios are sanitised, not propagated', () => {
  const p = credit.computeCreditProfile(
    {
      ...BASE,
      verifiedListings: Number.NaN,
      realisedEarnings: -50_000,
      demandEarnings: '9000',
      ordersAccepted: 3,
      ordersDelivered: 7,
      ordersOnTime: 9,
      healthScore: 150,
      buyerVerifiedScans: Number.POSITIVE_INFINITY,
    },
    NOW
  );
  assert.equal(p.inputs.verifiedListings, 0);
  assert.equal(p.inputs.realisedEarnings, 0);
  assert.equal(p.inputs.demandEarnings, 0);
  assert.equal(p.inputs.ordersDelivered, 3, 'cannot deliver more than accepted');
  assert.equal(p.inputs.ordersOnTime, 3, 'cannot be on time more than delivered');
  assert.equal(p.inputs.healthScore, 100, 'clamped to HEALTH_MAX');
  assert.equal(p.inputs.buyerVerifiedScans, 0);
  assert.ok(Number.isInteger(p.score));
  for (const c of p.components) assert.ok(c.points >= 0 && c.points <= c.weight, c.key);
});

// ---- account age ------------------------------------------------------------
test('account age counts whole IST calendar months', () => {
  const at = (iso) => new Date(iso);
  assert.equal(credit.wholeMonthsBetween(at('2026-06-04T10:00:00+05:30'), NOW), 3);
  assert.equal(credit.wholeMonthsBetween(at('2026-06-18T10:00:00+05:30'), NOW), 2, 'the 18th has not come round in September yet');
  assert.equal(credit.wholeMonthsBetween(at('2025-09-17T09:00:00+05:30'), NOW), 12);
  // 23:30 UTC on 31 Aug is 05:00 IST on 1 Sep: same IST month as NOW
  assert.equal(credit.wholeMonthsBetween(at('2026-08-31T23:30:00Z'), NOW), 0);
  assert.equal(credit.wholeMonthsBetween(NOW, at('2026-01-01T00:00:00Z')), 0, 'future start → 0');
  assert.equal(credit.wholeMonthsBetween(new Date('nope'), NOW), 0);
});

// ---- the snapshot allow-list ------------------------------------------------
test('a stored snapshot is read back through an allow-list — extra fields are dropped', () => {
  const real = credit.computeCreditProfile(BASE, NOW);
  const tampered = JSON.parse(JSON.stringify(real));
  tampered.mobileNumber = '9999999999';
  tampered.inputs.upiId = 'someone@upi';
  tampered.inputs.buyerNames = ['Meena Das'];
  tampered.components[0].basis.bankAccountNumber = 123456789;
  tampered.components[0].basis.note = 'text';
  tampered.components[1].buyerName = 'Radha';

  const read = credit.readCreditSnapshot(tampered);
  assert.deepEqual(read, JSON.parse(JSON.stringify(real)), 'round-trips the real profile exactly');
  const text = JSON.stringify(read);
  for (const leaked of ['9999999999', 'someone@upi', 'Meena', 'Radha', 'note', '123456789']) {
    assert.ok(!text.includes(leaked), `${leaked} leaked`);
  }
  assert.equal('bankAccountNumber' in read.components[0].basis, false, 'a numeric extra basis field is dropped too');
});

test('garbage snapshots read as null, never as a partial record', () => {
  assert.equal(credit.readCreditSnapshot(null), null);
  assert.equal(credit.readCreditSnapshot('{}'), null);
  assert.equal(credit.readCreditSnapshot({ score: 700 }), null);
  const missingComponent = JSON.parse(JSON.stringify(credit.computeCreditProfile(BASE, NOW)));
  missingComponent.components = missingComponent.components.slice(1);
  assert.equal(credit.readCreditSnapshot(missingComponent), null);
});

test('a withheld snapshot stays withheld when read back', () => {
  const read = credit.readCreditSnapshot(JSON.parse(JSON.stringify(profileOf({}))));
  assert.equal(read.eligible, false);
  assert.equal(read.score, null);
  assert.equal(read.band, null);
});

// ---- share links ------------------------------------------------------------
test('share tokens: 64 hex characters, never repeating, never the artisan id', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const token = share.newShareToken();
    assert.ok(share.isShareToken(token), token);
    seen.add(token);
  }
  assert.equal(seen.size, 2000, 'two shares created together get distinct tokens');
  assert.equal(share.isShareToken('abc'), false);
  assert.equal(share.isShareToken('../../etc/passwd'), false);
  assert.equal(share.isShareToken('A'.repeat(64)), false);
  assert.equal(share.creditSharePath('ab'), '/credit/ab');
});

test('share days: default 30, whole days 1..90 only', () => {
  assert.equal(share.parseShareDays(undefined), share.SHARE_DEFAULT_DAYS);
  assert.equal(share.parseShareDays(''), 30);
  assert.equal(share.parseShareDays(7), 7);
  assert.equal(share.parseShareDays('90'), 90);
  assert.equal(share.parseShareDays(91), null);
  assert.equal(share.parseShareDays(0), null);
  assert.equal(share.parseShareDays(2.5), null);
  assert.equal(share.parseShareDays('ten'), null);
  for (const option of share.SHARE_DAY_OPTIONS) {
    assert.equal(share.parseShareDays(option), option);
  }
  assert.equal(share.MAX_ACTIVE_SHARES, 5);
});

test('who-for text: control characters removed, whitespace collapsed, capped at 80', () => {
  assert.equal(share.cleanSharedWith('  SBI\u0000  Rourkela\n branch '), 'SBI Rourkela branch');
  assert.equal(share.cleanSharedWith('   '), null);
  assert.equal(share.cleanSharedWith(42), null);
  assert.equal(share.cleanSharedWith('x'.repeat(200)).length, share.MAX_SHARED_WITH_LENGTH);
  assert.equal(share.cleanSharedWith('ଏସବିଆଇ ଶାଖା'), 'ଏସବିଆଇ ଶାଖା');
});

test('a share is active until revoked or past its expiry', () => {
  const future = new Date(NOW.getTime() + 86_400_000);
  const past = new Date(NOW.getTime() - 1);
  assert.equal(share.isShareActive({ revokedAt: null, expiresAt: future }, NOW), true);
  assert.equal(share.isShareActive({ revokedAt: NOW, expiresAt: future }, NOW), false);
  assert.equal(share.isShareActive({ revokedAt: null, expiresAt: past }, NOW), false);
  assert.equal(share.isShareActive({ revokedAt: null, expiresAt: NOW.toISOString() }, NOW), false);
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} credit-score checks failed`);
  process.exit(1);
}
console.log(`creditScore: all ${checks} checks passed`);
