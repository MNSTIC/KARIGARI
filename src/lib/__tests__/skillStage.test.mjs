/**
 * The skill stage and the learning tracks built around it.
 *
 * The stage is a claim an artisan reads about themselves, so it is checked
 * against hand-worked boundaries: thresholds are inclusive, all criteria must
 * hold at once, progress is the weakest criterion (exactly 1.0 at the boundary,
 * never 0.99), and more of anything never lowers the stage. The tracks must
 * never be empty, never carry a link the AI wrote, and never lose a lesson the
 * artisan needs because the AI answered thinly.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/skillStage.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-stage-'));
async function compile(entry, name) {
  const outfile = path.join(outDir, name);
  await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
  return import(pathToFileURL(outfile).href);
}
const stage = await compile('src/lib/skillStage.ts', 'skillStage.mjs');
const catalog = await compile('src/lib/learningCatalog.ts', 'learningCatalog.mjs');
const plan = await compile('src/lib/learningPlan.ts', 'learningPlan.mjs');

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

const ZERO = { verifiedListings: 0, itemsSold: 0, realisedEarnings: 0, ordersDelivered: 0, modulesCompleted: 0 };
const at = (patch) => ({ ...ZERO, ...patch });
const PRO_EXACT = at({ verifiedListings: 20, itemsSold: 10, realisedEarnings: 50_000, modulesCompleted: 3 });

// ---------------------------------------------------------------- stage

test('a new artisan is a beginner with both Intermediate requirements at zero', () => {
  const r = stage.resolveSkillStage(ZERO);
  assert.equal(r.stage, 'BEGINNER');
  assert.equal(r.nextStage, 'INTERMEDIATE');
  assert.equal(r.progress, 0);
  assert.deepEqual(
    r.nextRequirements.map(({ key, have, need }) => [key, have, need]),
    [['verifiedListings', 0, 5], ['itemsSold', 0, 1]]
  );
});

test('a new artisan has all four Pro requirements unmet (the ladder the card shows)', () => {
  const pro = stage.requirementsFor('PRO', ZERO);
  assert.deepEqual(pro.map((r) => r.key), ['verifiedListings', 'itemsSold', 'realisedEarnings', 'modulesCompleted']);
  assert.ok(pro.every((r) => r.have < r.need));
});

test('exactly 5 listings and 1 sale is Intermediate (inclusive), and progress to it is exactly 1', () => {
  const inputs = at({ verifiedListings: 5, itemsSold: 1 });
  assert.equal(stage.resolveSkillStage(inputs).stage, 'INTERMEDIATE');
  assert.equal(stage.progressToward('INTERMEDIATE', inputs), 1);
  assert.equal(Object.is(stage.progressToward('INTERMEDIATE', inputs), 1), true);
});

test('one listing short stays Beginner at 0.8, and lists only the listing gap', () => {
  const r = stage.resolveSkillStage(at({ verifiedListings: 4, itemsSold: 1 }));
  assert.equal(r.stage, 'BEGINNER');
  assert.equal(r.progress, 0.8);
  assert.deepEqual(r.nextRequirements.map((q) => [q.key, q.have, q.need]), [['verifiedListings', 4, 5]]);
});

test('all-of, not any-of: forty listings and no sale is still a beginner at 0 progress', () => {
  const r = stage.resolveSkillStage(at({ verifiedListings: 40 }));
  assert.equal(r.stage, 'BEGINNER');
  assert.equal(r.progress, 0);
  assert.deepEqual(r.nextRequirements.map((q) => q.key), ['itemsSold']);
});

test('exactly the Pro thresholds is Pro, progress 1, nothing left to meet', () => {
  const r = stage.resolveSkillStage(PRO_EXACT);
  assert.deepEqual(r, { stage: 'PRO', nextStage: null, progress: 1, nextRequirements: [] });
  assert.equal(stage.progressToward('PRO', PRO_EXACT), 1);
});

test('one short on any single Pro criterion is Intermediate, with that criterion as the only gap', () => {
  const cases = [
    ['verifiedListings', 19, 0.95],
    ['itemsSold', 9, 0.9],
    ['realisedEarnings', 49_999, 49_999 / 50_000],
    ['modulesCompleted', 2, 2 / 3],
  ];
  for (const [key, value, progress] of cases) {
    const r = stage.resolveSkillStage({ ...PRO_EXACT, [key]: value });
    assert.equal(r.stage, 'INTERMEDIATE', key);
    assert.equal(r.progress, progress, key);
    assert.deepEqual(r.nextRequirements.map((q) => [q.key, q.have]), [[key, value]], key);
  }
});

test('progress is the weakest criterion, not an average', () => {
  const r = stage.resolveSkillStage({ ...PRO_EXACT, modulesCompleted: 0 });
  assert.equal(r.stage, 'INTERMEDIATE');
  assert.equal(r.progress, 0);
  const half = stage.resolveSkillStage(at({ verifiedListings: 30, itemsSold: 30, realisedEarnings: 25_000, modulesCompleted: 3 }));
  assert.equal(half.progress, 0.5);
});

test('garbage, negative and missing counts read as zero', () => {
  const r = stage.resolveSkillStage({ verifiedListings: NaN, itemsSold: -4, realisedEarnings: 'lots', modulesCompleted: undefined });
  assert.equal(r.stage, 'BEGINNER');
  assert.equal(r.progress, 0);
  assert.ok(r.nextRequirements.every((q) => q.have === 0));
});

test('more of anything never lowers the stage or the progress within it', () => {
  const order = { BEGINNER: 0, INTERMEDIATE: 1, PRO: 2 };
  const steps = { verifiedListings: [0, 1, 4, 5, 6, 19, 20, 50], itemsSold: [0, 1, 2, 9, 10, 40], realisedEarnings: [0, 1, 25_000, 49_999, 50_000, 200_000], modulesCompleted: [0, 1, 2, 3, 9] };
  const bases = [ZERO, at({ verifiedListings: 5, itemsSold: 1 }), PRO_EXACT, at({ verifiedListings: 20, itemsSold: 10, realisedEarnings: 50_000 })];
  for (const base of bases) {
    for (const [key, values] of Object.entries(steps)) {
      let previous = null;
      for (const value of values) {
        const r = stage.resolveSkillStage({ ...base, [key]: value });
        if (previous) {
          const rank = order[r.stage];
          const prevRank = order[previous.stage];
          assert.ok(rank >= prevRank, `${key}=${value} lowered the stage`);
          if (rank === prevRank) assert.ok(r.progress >= previous.progress, `${key}=${value} lowered progress`);
        }
        previous = r;
      }
    }
  }
});

test('every requirement carries its i18n label key', () => {
  for (const q of stage.requirementsFor('PRO', ZERO)) {
    assert.equal(q.labelKey, stage.STAGE_CRITERION_LABEL_KEYS[q.key]);
  }
});

// ------------------------------------------------------------ catalogue

const { curatedTrack, LEARNING_TRACKS, LEARNING_CATALOG, TRACK_SIZE, NO_GAPS } = catalog;
const slugs = (items) => items.map((item) => item.key.split(':')[1]);

test('every track fills to TRACK_SIZE for a known craft, an unknown craft and no craft', () => {
  for (const craftType of ['Kutch Embroidery', 'Glass bangle making', '', null]) {
    for (const track of LEARNING_TRACKS) {
      const items = curatedTrack(track, { craftType, stage: 'BEGINNER' });
      assert.equal(items.length, TRACK_SIZE, `${craftType} ${track}`);
      assert.ok(items.every((item) => item.track === track && item.source === 'CURATED'));
    }
  }
});

test('design lessons follow what the craft is made of', () => {
  const kutch = slugs(curatedTrack('design', { craftType: 'Kutch Embroidery', stage: 'BEGINNER' }));
  assert.ok(kutch.includes('embroidery-layout'), kutch.join());
  assert.ok(!kutch.includes('glaze-firing'));
  const pottery = slugs(curatedTrack('design', { craftType: 'Blue Pottery', stage: 'BEGINNER' }));
  assert.equal(pottery[0], 'glaze-firing');
  assert.ok(!pottery.includes('weave-patterns') && !pottery.includes('embroidery-layout'), pottery.join());
  const dhokra = slugs(curatedTrack('design', { craftType: 'Dhokra metal casting', stage: 'INTERMEDIATE' }));
  assert.equal(dhokra[0], 'metal-finish');
});

test('a real gap moves its lesson to the front', () => {
  const upi = slugs(curatedTrack('digital', { craftType: '', stage: 'INTERMEDIATE', gaps: { ...NO_GAPS, profileMissing: ['upi'] } }));
  assert.equal(upi[0], 'upi-safety');
  const drafts = slugs(curatedTrack('digital', { craftType: '', stage: 'PRO', gaps: { ...NO_GAPS, draftsUnfinished: 2 } }));
  assert.equal(drafts[0], 'phone-photos');
  const listing = slugs(curatedTrack('digital', { craftType: '', stage: 'BEGINNER', gaps: { ...NO_GAPS, sellableUnlisted: 1 } }));
  assert.equal(listing[0], 'online-listing');
});

test('the artisan\'s level comes first, and a lesson already done drops to the back', () => {
  assert.equal(slugs(curatedTrack('business', { craftType: '', stage: 'PRO' }))[0], 'export-basics');
  assert.equal(slugs(curatedTrack('business', { craftType: '', stage: 'BEGINNER' }))[0], 'pricing-basics');
  const done = slugs(curatedTrack('business', { craftType: '', stage: 'BEGINNER', completed: ['business:pricing-basics'] }));
  assert.notEqual(done[0], 'pricing-basics');
});

test('catalogue module keys are unique and valid LearningProgress keys', () => {
  const keys = LEARNING_CATALOG.map((entry) => catalog.catalogModuleKey(entry));
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.ok(plan.isModuleKey(key), key);
});

test('every catalogue title, reason and search exists in all four dictionaries, with the same placeholders', () => {
  const dicts = Object.fromEntries(['en', 'hi', 'or', 'te'].map((lang) => [lang, readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8')]));
  const valueOf = (src, key) => {
    const m = src.match(new RegExp(`^  ${key}: "((?:[^"\\\\]|\\\\.)*)",\\r?$`, 'm'));
    return m ? m[1] : null;
  };
  for (const entry of LEARNING_CATALOG) {
    for (const key of Object.values(catalog.catalogKeys(entry))) {
      const english = valueOf(dicts.en, key);
      assert.ok(english, `en missing ${key}`);
      const placeholders = (english.match(/\{[a-z]+\}/g) || []).join();
      for (const lang of ['hi', 'or', 'te']) {
        const value = valueOf(dicts[lang], key);
        assert.ok(value, `${lang} missing ${key}`);
        assert.equal((value.match(/\{[a-z]+\}/g) || []).join(), placeholders, `${lang} ${key}`);
      }
    }
  }
});

// ----------------------------------------------------------------- plan

test('cleanText removes control and bidi characters, links, and extra space', () => {
  const nul = String.fromCharCode(0);
  const rlo = String.fromCharCode(0x202e);
  const dirty = `  Pricing${nul} basics ${rlo}see https://youtu.be/dQw4w9WgXcQ and www.example.com\n now `;
  assert.equal(plan.cleanText(dirty, 200), 'Pricing basics see and now');
  assert.equal(plan.cleanText('watch youtube.com/watch?v=abc123 today', 200), 'watch today');
  assert.equal(plan.cleanText(42, 10), '');
});

test('cleanText caps by characters without splitting a Telugu or emoji code point', () => {
  const telugu = 'నేర్చుకోవడం'.repeat(30);
  const capped = plan.cleanText(telugu, 120);
  assert.equal(Array.from(capped).length, 120);
  const emoji = plan.cleanText(String.fromCodePoint(0x1f9f5).repeat(5), 3);
  assert.equal(Array.from(emoji).length, 3);
});

test('youtubeSearchUrl is always a search results page, encoded and capped at 120 characters', () => {
  assert.equal(
    plan.youtubeSearchUrl('ikat & bandha #1 / dyeing?'),
    'https://www.youtube.com/results?search_query=ikat%20%26%20bandha%20%231%20%2F%20dyeing%3F'
  );
  const long = plan.youtubeSearchUrl('a'.repeat(500));
  assert.equal(decodeURIComponent(long.split('search_query=')[1]).length, plan.MAX_SEARCH_QUERY_LENGTH);
  assert.equal(plan.youtubeSearchUrl('   '), null);
  assert.equal(plan.youtubeSearchUrl('https://youtu.be/xyz'), null);
  assert.ok(plan.youtubeSearchUrl('हस्तशिल्प पैकिंग').startsWith('https://www.youtube.com/results?search_query=%E0%A4'));
});

test('shortHash is FNV-1a and AI module keys are stable, valid keys', () => {
  assert.equal(plan.shortHash(''), '811c9dc5');
  assert.equal(plan.shortHash('a'), 'e40c292c');
  const key = plan.aiModuleKey('design', 'Mirror work layout');
  assert.equal(key, plan.aiModuleKey('design', 'mirror work layout'));
  assert.ok(plan.isModuleKey(key), key);
  assert.ok(!plan.isModuleKey('design:Pricing Basics'));
  assert.ok(!plan.isModuleKey('cooking:pricing'));
  assert.ok(!plan.isModuleKey(`business:${'a'.repeat(49)}`));
});

test('normaliseAiItems keeps valid lessons and drops the rest', () => {
  const raw = {
    lessons: [
      { track: 'Business', level: 'growing', title: 'Pricing for bulk', whyItHelps: 'Fair margin', searchQuery: 'bulk order pricing' },
      { track: 'design', level: 'expert', title: 'Motifs', whyItHelps: '', searchQuery: 'kutch motifs' },
      { track: 'cooking', title: 'Rice', searchQuery: 'rice' },
      { track: 'digital', title: '', searchQuery: 'upi' },
      { track: 'digital', title: 'Video', searchQuery: 'https://www.youtube.com/watch?v=abcdefghijk' },
      { track: 'business', title: 'Pricing again', searchQuery: 'BULK ORDER PRICING' },
      'not an object',
    ],
  };
  const items = plan.normaliseAiItems(raw, 'BEGINNER');
  assert.deepEqual(items.map((i) => [i.track, i.level, i.title]), [
    ['business', 'growing', 'Pricing for bulk'],
    ['design', 'basic', 'Motifs'],
  ]);
  assert.ok(items.every((i) => i.source === 'AI' && plan.isModuleKey(i.key)));
  assert.deepEqual(plan.normaliseAiItems(null, 'PRO'), []);
  assert.equal(plan.normaliseAiItems([{ track: 'digital', title: 'UPI', searchQuery: 'upi safety' }], 'PRO')[0].level, 'advanced');
});

test('a lopsided AI answer is capped and padded: no track is ever empty', () => {
  const ai = plan.normaliseAiItems(
    { items: Array.from({ length: 5 }, (_, n) => ({ track: 'business', level: 'basic', title: `Lesson ${n}`, searchQuery: `business lesson ${n}` })) },
    'BEGINNER'
  );
  const built = plan.buildTracks(ai, { craftType: 'Pattachitra', stage: 'BEGINNER' });
  assert.equal(built.tracks.business.length, TRACK_SIZE);
  assert.ok(built.tracks.business.every((i) => i.source === 'AI'));
  assert.equal(built.tracks.design.length, TRACK_SIZE);
  assert.ok(built.tracks.design.every((i) => i.source === 'CURATED'));
  assert.equal(built.tracks.digital.length, TRACK_SIZE);
  assert.equal(built.source, 'AI');
  assert.equal(built.mixed, true);
});

test('a thin AI track is padded to MIN_TRACK_ITEMS; a full answer is not mixed', () => {
  const one = plan.normaliseAiItems([{ track: 'digital', title: 'UPI', searchQuery: 'upi safety' }], 'BEGINNER');
  const built = plan.buildTracks(one, { craftType: '', stage: 'BEGINNER' });
  assert.equal(built.tracks.digital.length, catalog.MIN_TRACK_ITEMS);
  assert.equal(built.tracks.digital[0].source, 'AI');

  const full = plan.normaliseAiItems(
    LEARNING_TRACKS.flatMap((track) => [0, 1, 2].map((n) => ({ track, title: `${track} ${n}`, searchQuery: `${track} search ${n}` }))),
    'INTERMEDIATE'
  );
  const fullBuilt = plan.buildTracks(full, { craftType: '', stage: 'INTERMEDIATE' });
  assert.equal(fullBuilt.mixed, false);
  assert.ok(LEARNING_TRACKS.every((track) => fullBuilt.tracks[track].length === 3));
});

test('no AI at all is the curated catalogue, labelled CURATED, even with no stage (offline)', () => {
  const built = plan.buildTracks([], { craftType: '', stage: null });
  assert.equal(built.source, 'CURATED');
  assert.equal(built.mixed, false);
  assert.ok(LEARNING_TRACKS.every((track) => built.tracks[track].length === TRACK_SIZE));
});

test('nothing a track holds carries a video id, channel, duration or thumbnail field', () => {
  const ai = plan.normaliseAiItems(
    [{ track: 'design', title: 'Motifs', searchQuery: 'motifs', videoId: 'abc', channel: 'X', duration: '10:00', thumbnail: 'http://x' }],
    'BEGINNER'
  );
  const built = plan.buildTracks(ai, { craftType: '', stage: 'BEGINNER' });
  const allowed = new Set(['source', 'key', 'track', 'level', 'title', 'whyItHelps', 'searchQuery', 'titleKey', 'whyKey', 'queryKey']);
  for (const track of LEARNING_TRACKS) {
    for (const item of built.tracks[track]) {
      for (const field of Object.keys(item)) assert.ok(allowed.has(field), `unexpected field ${field}`);
    }
  }
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} skill-stage checks failed`);
  process.exit(1);
}
console.log(`skillStage: all ${checks} checks passed`);
