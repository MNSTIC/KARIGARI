/**
 * What the buyer passport may claim about a piece.
 *
 * A judge scans the patch on a real object and reads this page, so every step,
 * badge and figure must come from a real column: a missing timestamp is a
 * pending step with no date, a waived QR check is never a pass, a GI label
 * needs a certified profile, and money that has not moved is not "received".
 * The demand prefill must land on the form's own options.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/passportFacts.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-passport-'));
const outfile = path.join(outDir, 'passportFacts.mjs');
await esbuild.build({ entryPoints: ['src/lib/passportFacts.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
const facts = await import(pathToFileURL(outfile).href);
const draftLib = path.join(outDir, 'demandDraft.mjs');
await esbuild.build({ entryPoints: ['src/lib/demandDraft.ts'], bundle: true, format: 'esm', platform: 'node', outfile: draftLib, logLevel: 'error' });
const draft = await import(pathToFileURL(draftLib).href);

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

const BARE = {
  createdAt: '2026-06-10T05:00:00.000Z',
  catalogMethod: null,
  voiceLanguage: null,
  hasMaterialBill: false,
  photoQualityScore: null,
  photoQualitySource: null,
  qrVerified: false,
  qrVerifiedAt: null,
  qrExemptAt: null,
  isListedOnMarketplace: false,
  syndicatedAt: null,
  shopifyPublishedAt: null,
  syndicatedChannels: [],
  paidAt: null,
  packedAt: null,
  dispatchedAt: null,
  deliveredAt: null,
  auditLogs: [],
};
const timeline = (overrides) => facts.buildTimeline({ ...BARE, ...overrides });
const stepOf = (steps, key) => steps.find((s) => s.key === key);

// ---- timeline -------------------------------------------------------------------
test('a bare capture: only "crafted" is done; every other step pending and dateless', () => {
  const steps = timeline({});
  assert.deepEqual(steps.map((s) => s.key), ['material_sourced', 'crafted', 'ai_quality', 'admin_verified', 'qr_attached', 'listed', 'paid', 'packed', 'dispatched', 'delivered']);
  for (const s of steps) {
    if (s.key === 'crafted') {
      assert.equal(s.state, 'DONE');
      assert.equal(s.at, BARE.createdAt);
    } else {
      assert.equal(s.state, 'PENDING', s.key);
      assert.equal(s.at, null, `${s.key} must carry no date`);
    }
  }
});

test('a material bill marks sourcing done, with no invented date', () => {
  const s = stepOf(timeline({ hasMaterialBill: true }), 'material_sourced');
  assert.equal(s.state, 'DONE');
  assert.equal(s.at, null);
});

test('AI quality is done only when Gemini scored the frame', () => {
  assert.equal(stepOf(timeline({ photoQualitySource: 'AI', photoQualityScore: 8 }), 'ai_quality').state, 'DONE');
  assert.equal(stepOf(timeline({ photoQualitySource: 'AI', photoQualityScore: 8 }), 'ai_quality').detail.score, 8);
  const heuristic = stepOf(timeline({ photoQualitySource: 'HEURISTIC', photoQualityScore: 6 }), 'ai_quality');
  assert.equal(heuristic.state, 'PENDING');
  assert.equal(heuristic.detail.score, null, 'a heuristic score is never shown as an AI one');
});

test('admin verified comes from the ADMIN_VERIFIED audit row — the earliest one', () => {
  const steps = timeline({
    auditLogs: [
      { action: 'ADMIN_VERIFIED', actorRole: 'ADMIN', createdAt: '2026-06-12T10:00:00.000Z' },
      { action: 'ADMIN_VERIFIED', actorRole: 'ADMIN', createdAt: '2026-06-11T10:00:00.000Z' },
      { action: 'PRICING_OVERRIDE_APPROVED', actorRole: 'ADMIN', createdAt: '2026-06-01T10:00:00.000Z' },
    ],
  });
  assert.equal(stepOf(steps, 'admin_verified').state, 'DONE');
  assert.equal(stepOf(steps, 'admin_verified').at, '2026-06-11T10:00:00.000Z');
  assert.equal(stepOf(timeline({ auditLogs: [{ action: 'PRICING_OVERRIDE_APPROVED', actorRole: 'ADMIN', createdAt: '2026-06-01T10:00:00Z' }] }), 'admin_verified').state, 'PENDING');
});

test('QR: verified → done at qrVerifiedAt; waived → WAIVED, never done; verified wins over a waiver', () => {
  const verified = stepOf(timeline({ qrVerified: true, qrVerifiedAt: '2026-06-15T08:00:00.000Z' }), 'qr_attached');
  assert.equal(verified.state, 'DONE');
  assert.equal(verified.at, '2026-06-15T08:00:00.000Z');
  const waived = stepOf(timeline({ qrExemptAt: '2026-09-13T16:10:50.604Z' }), 'qr_attached');
  assert.equal(waived.state, 'WAIVED');
  assert.notEqual(waived.state, 'DONE');
  assert.equal(stepOf(timeline({ qrVerified: true, qrVerifiedAt: '2026-06-15T08:00:00Z', qrExemptAt: '2026-09-13T16:10:50Z' }), 'qr_attached').state, 'DONE');
});

test('listed: date from syndicatedAt, else Shopify, else the listing audit row; unlisted stays pending', () => {
  const log = [{ action: 'MULTI_CHANNEL_SYNDICATE', actorRole: 'ARTISAN', createdAt: '2026-06-20T00:00:00.000Z' }];
  assert.equal(stepOf(timeline({ isListedOnMarketplace: true, syndicatedAt: '2026-06-18T00:00:00.000Z', auditLogs: log }), 'listed').at, '2026-06-18T00:00:00.000Z');
  assert.equal(stepOf(timeline({ isListedOnMarketplace: true, shopifyPublishedAt: '2026-06-19T00:00:00.000Z', auditLogs: log }), 'listed').at, '2026-06-19T00:00:00.000Z');
  assert.equal(stepOf(timeline({ isListedOnMarketplace: true, auditLogs: log }), 'listed').at, '2026-06-20T00:00:00.000Z');
  const withChannels = stepOf(timeline({ isListedOnMarketplace: true, syndicatedChannels: ['ONDC_PAYTM', 'GEM'], shopifyPublishedAt: '2026-06-19T00:00:00Z' }), 'listed');
  assert.equal(withChannels.detail.channels, 3);
  const unlisted = stepOf(timeline({ isListedOnMarketplace: false, syndicatedAt: '2026-06-18T00:00:00Z' }), 'listed');
  assert.equal(unlisted.state, 'PENDING');
  assert.equal(unlisted.at, null);
});

test('paid / packed / dispatched / delivered each follow their own timestamp only', () => {
  const steps = timeline({ paidAt: '2026-09-12T04:52:03.777Z', dispatchedAt: '2026-09-14T04:52:03.777Z' });
  assert.equal(stepOf(steps, 'paid').state, 'DONE');
  assert.equal(stepOf(steps, 'packed').state, 'PENDING', 'no packedAt → pending even though dispatched');
  assert.equal(stepOf(steps, 'dispatched').state, 'DONE');
  assert.equal(stepOf(steps, 'delivered').state, 'PENDING');
});

test('an unparseable timestamp is not rendered as a date', () => {
  const s = stepOf(timeline({ paidAt: 'not a date' }), 'paid');
  assert.equal(s.at, null);
});

test('voice capture records its language; manual capture does not', () => {
  assert.deepEqual(stepOf(timeline({ catalogMethod: 'VOICE', voiceLanguage: 'Odia' }), 'crafted').detail, { method: 'VOICE', language: 'Odia' });
  assert.deepEqual(stepOf(timeline({ catalogMethod: 'MANUAL', voiceLanguage: 'Odia' }), 'crafted').detail, { method: 'MANUAL', language: null });
});

// ---- trust layers ------------------------------------------------------------------
test('trust: capture date from the capture row; admin from ADMIN_VERIFIED; no similarity → null', () => {
  const layers = facts.buildTrustLayers(
    { ...BARE, auditLogs: [{ action: 'ITEM_CAPTURED', actorRole: 'ARTISAN', createdAt: '2026-06-10T05:00:01.000Z' }, { action: 'ADMIN_VERIFIED', actorRole: 'ADMIN', createdAt: '2026-06-11T00:00:00.000Z' }] },
    []
  );
  assert.equal(layers.human.at, '2026-06-10T05:00:01.000Z');
  assert.equal(layers.admin.at, '2026-06-11T00:00:00.000Z');
  assert.equal(layers.ai.similarity, null);
  assert.equal(layers.ai.patchMatchedAt, null);
  assert.equal(layers.ai.waivedAt, null);
});

test('trust: a buyer delivery scan outranks a ready check; latest within a source; bad scores dropped', () => {
  const layers = facts.buildTrustLayers(BARE, [
    { score: 91, source: 'READY_CHECK', at: '2026-09-01T00:00:00Z' },
    { score: 84.4, source: 'DELIVERY_SCAN', at: '2026-09-02T00:00:00Z' },
    { score: 88, source: 'DELIVERY_SCAN', at: '2026-09-05T00:00:00Z' },
    { score: 140, source: 'DELIVERY_SCAN', at: '2026-09-09T00:00:00Z' },
    { score: Number.NaN, source: 'DELIVERY_SCAN', at: '2026-09-10T00:00:00Z' },
  ]);
  assert.deepEqual(layers.ai.similarity, { score: 88, source: 'DELIVERY_SCAN', at: '2026-09-05T00:00:00.000Z' });
  assert.equal(facts.buildTrustLayers(BARE, [{ score: 79.6, source: 'READY_CHECK', at: null }]).ai.similarity.score, 80);
});

test('trust: patch match vs waiver are kept apart', () => {
  assert.equal(facts.buildTrustLayers({ ...BARE, qrVerified: true, qrVerifiedAt: '2026-06-15T08:00:00Z' }, []).ai.patchMatchedAt, '2026-06-15T08:00:00.000Z');
  const waived = facts.buildTrustLayers({ ...BARE, qrExemptAt: '2026-09-13T16:10:50Z' }, []).ai;
  assert.equal(waived.patchMatchedAt, null);
  assert.equal(waived.waivedAt, '2026-09-13T16:10:50.000Z');
});

// ---- fair pay -------------------------------------------------------------------------
test('received: ₹0 NOT_SOLD before a sale, whatever the ledger columns hold', () => {
  assert.deepEqual(facts.receivedFor({ sold: false, advancePaid: 5000, finalPayoutQueued: 0 }), { state: 'NOT_SOLD', advance: 0, final: 0, total: 0, simulated: true });
});

test('received: sold with nothing released → HELD; released → the real tranches', () => {
  assert.equal(facts.receivedFor({ sold: true, advancePaid: 0, finalPayoutQueued: 0 }).state, 'HELD');
  const released = facts.receivedFor({ sold: true, advancePaid: 13246, finalPayoutQueued: 16345.4, payoutMode: 'SIMULATED' });
  assert.deepEqual(released, { state: 'RELEASED', advance: 13246, final: 16345, total: 29591, simulated: true });
  assert.equal(facts.receivedFor({ sold: true, advancePaid: 100, finalPayoutQueued: 0, payoutMode: 'RAZORPAYX' }).simulated, false);
  assert.equal(facts.receivedFor({ sold: true, advancePaid: -50, finalPayoutQueued: null }).total, 0);
});

// ---- GI ------------------------------------------------------------------------------
test('GI label only for a certified profile, normalised through the GI list', () => {
  assert.equal(facts.giLabelFor({ giTagCertified: false, giTagName: 'Sambalpuri Ikat' }), null);
  assert.equal(facts.giLabelFor(null), null);
  assert.equal(facts.giLabelFor({ giTagCertified: true, giTagName: '' }), null);
  assert.equal(facts.giLabelFor({ giTagCertified: true, giTagName: 'sambalpuri ikat' }), 'Sambalpuri Ikat');
  assert.equal(facts.giLabelFor({ giTagCertified: true, giTagName: 'Bidriware' }), facts.giLabelFor({ giTagCertified: true, giTagName: 'Bidriware' }));
  assert.ok(typeof facts.giLabelFor({ giTagCertified: true, giTagName: 'Some Local Designation' }) === 'string');
});

// ---- material & colour -------------------------------------------------------------------
test('material: tags first, then catalogue tags, then the description; longest term wins', () => {
  assert.deepEqual(facts.materialFrom({ tags: ['Ikat', 'Silk'], catalogTags: ['cotton'], descriptionEnglish: 'wool' }), { value: 'silk', source: 'TAGS' });
  assert.deepEqual(facts.materialFrom({ tags: ['Ikat'], catalogTags: ['mulberry silk', 'handloom'] }), { value: 'mulberry silk', source: 'CATALOGUE' });
  assert.deepEqual(facts.materialFrom({ tags: [], descriptionEnglish: 'Full bridal odhani in madder-red cotton, 2.5m' }), { value: 'cotton', source: 'DESCRIPTION' });
  assert.equal(facts.materialFrom({ tags: ['silky finish'], descriptionEnglish: '' }), null, '"silky" is not silk');
  assert.equal(facts.materialFrom({}), null);
});

test('colour is read the same way, whole words only', () => {
  assert.deepEqual(facts.colorFrom({ tags: [], descriptionEnglish: 'vibrant red and blue hues' }), { value: 'red', source: 'DESCRIPTION' });
  assert.equal(facts.colorFrom({ descriptionEnglish: 'reddish tone, bordered' }), null);
});

test('catalogue tags are read defensively from the stored JSON', () => {
  assert.deepEqual(facts.catalogTagsOf({ tags: ['silk', 3, null, 'ikat'] }), ['silk', 'ikat']);
  assert.deepEqual(facts.catalogTagsOf('nope'), []);
  assert.deepEqual(facts.catalogTagsOf(null), []);
});

// ---- demand prefill -----------------------------------------------------------------------
test('prefill lands on the form\'s own category, product type and material chips', () => {
  const saree = facts.demandDraftFor({ craftType: 'Red Sambalpuri Pata Saree', category: 'Textiles & Weaving', tags: ['ikat'], material: 'mulberry silk', color: 'red' });
  assert.deepEqual(saree, { craftType: 'Red Sambalpuri Pata Saree', category: 'Saree & Textile', productType: 'Saree', material: 'Silk', color: 'red' });
  for (const value of [saree.category]) assert.ok(draft.DEMAND_CATEGORIES.includes(value));
  assert.ok(draft.DEMAND_PRODUCT_TYPES[saree.category].includes(saree.productType));
  assert.ok(draft.DEMAND_MATERIALS.includes(saree.material));
});

test('prefill: an unlisted material becomes Other + the real word; no material → no field', () => {
  const lac = facts.demandDraftFor({ craftType: 'Lac Bangle Set of 6', category: 'Jewellery', material: 'lac', color: null });
  assert.equal(lac.category, 'Jewellery');
  assert.equal(lac.productType, 'Bangle set');
  assert.equal(lac.material, 'Other');
  assert.equal(lac.materialOther, 'lac');
  const bare = facts.demandDraftFor({ craftType: 'Mystery Object', category: 'Other Crafts', material: null, color: null });
  assert.deepEqual(bare, { craftType: 'Mystery Object', category: 'Other', productType: '' });
});

test('prefill categories across the seeded crafts', () => {
  const cases = [
    ['Bastar Dhokra Tribal Horse', 'Metalwork (Dhokra)', 'Metalwork'],
    ['Blue Pottery Serving Bowl Set of 4', 'Blue Pottery', 'Pottery & Ceramics'],
    ['Odisha Pattachitra Scroll — Krishna Leela', 'Painting & Scrolls', 'Painting & Art'],
    ['Channapatna Lacquered Wooden Toy Train', 'Wood Carving', 'Handicraft'],
    ['Kutch Mirror Wall Chakla — Large', 'Textiles & Weaving', 'Saree & Textile'],
    ['Bidriware Silver-inlay Vase', 'Metalwork (Dhokra)', 'Metalwork'],
  ];
  for (const [craftType, category, expected] of cases) {
    assert.equal(facts.demandCategoryFor({ craftType, category }), expected, craftType);
  }
  assert.equal(facts.productTypeFor('Pottery & Ceramics', 'Blue Pottery Serving Bowl Set of 4'), 'Serving bowl');
  assert.equal(facts.productTypeFor('Saree & Textile', 'Pochampally Telia Rumal Silk Stole'), 'Stole');
  assert.equal(facts.productTypeFor('Saree & Textile', 'Sambalpuri Cotton Bedcover'), '');
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} passport checks failed`);
  process.exit(1);
}
console.log(`passportFacts: all ${checks} checks passed`);
