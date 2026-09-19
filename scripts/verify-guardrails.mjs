/**
 * Executable verification of the V12 programme's own guardrails.
 *
 * `KARIGARI_ENHANCEMENTS_V12_MASTER_PROMPT.md` ends with two closing
 * appendices: A, the consolidated list of what each phase was allowed to add to
 * the schema, and B, a checklist to re-read before every commit. A checklist
 * that only ever ran once is not a checklist, so both live here:
 *
 *     npm run verify:guardrails
 *
 * Plain Node with a hand-rolled harness, the same convention as
 * verify-schemes.ts — there is no test runner in this project on purpose. Exits
 * 0 when every assertion passes and 1 when any fails.
 *
 * **Only the items a machine can actually decide are asserted here.** The rest
 * of Appendix B — empty states, medians over means, aria roles, 360 px layout,
 * a clean browser console — was checked in the browser phase by phase and is
 * recorded in docs/ENHANCEMENTS_PROGRESS.md. Claiming to re-verify those from a
 * regular expression would be worse than saying plainly that they are not
 * covered here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Phase 0. Everything this programme changed is measured against it. */
const BASELINE = 'e12da52';

let problems = 0;
let checks = 0;
const fail = (m) => { checks += 1; problems += 1; console.log('  FAIL  ' + m); };
const ok = (m) => { checks += 1; console.log('  PASS  ' + m); };
const note = (m) => console.log('  ·     ' + m);

const git = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

const schema = read('prisma/schema.prisma');
/** The body of one `model X { … }` block. */
const modelBody = (name) => {
  const m = new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  return m ? m[1] : null;
};

let v12Files = [];
try {
  v12Files = git(`git diff --name-only ${BASELINE} HEAD`)
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f && /^src\/.*\.(ts|tsx|mjs)$/.test(f))
    .filter(exists);
} catch {
  console.log(`Could not diff against ${BASELINE} — is this a shallow clone? Skipping the file sweep.\n`);
}

// ===========================================================================
console.log('APPENDIX A — consolidated schema changes\n');
// ===========================================================================

/** Appendix A, transcribed. Phase 13 is absent: it was not built. */
const EXPECTED = [
  { phase: 1, models: ['OfflineSale'], relations: ['User.offlineSales', 'CraftItem.offlineSale'] },
  { phase: 2, models: ['MarketplaceSearch'], relations: [] },
  { phase: 3, models: ['CreditProfileShare'], relations: ['User.creditShares'] },
  { phase: 5, models: ['LearningProgress'], relations: ['User.learningProgress'] },
  { phase: 6, models: ['SupplyReminderState'], relations: ['User.supplyReminderState'] },
  { phase: 9, models: ['ArtisanBadge'], relations: ['User.badges'] },
  { phase: 10, models: ['DesignConcept'], relations: ['User.designConcepts'] },
  {
    phase: 11,
    models: ['MotifRegistration', 'MotifLicence', 'MotifPayoutShare'],
    relations: ['User.motifRegistrations', 'User.motifPayoutShares', 'CraftItem.motifRegistrations'],
  },
  {
    phase: 12,
    models: ['ScrapLot', 'ScrapPool', 'ScrapEnquiry', 'ScrapPayoutShare'],
    relations: ['User.scrapLots', 'User.scrapShares'],
  },
];

for (const row of EXPECTED) {
  for (const model of row.models) {
    if (modelBody(model)) ok(`phase ${row.phase}: model ${model}`);
    else fail(`phase ${row.phase}: model ${model} is missing from schema.prisma`);
  }
  for (const rel of row.relations) {
    const [model, field] = rel.split('.');
    const body = modelBody(model);
    if (!body) { fail(`phase ${row.phase}: model ${model} is missing entirely`); continue; }
    if (new RegExp(`\\n\\s*${field}\\s`).test(body)) ok(`phase ${row.phase}: ${rel}`);
    else fail(`phase ${row.phase}: relation ${rel} is missing`);
  }
}

console.log('\nPhase 13 (artisan-funded commission) was not built — none of its columns may exist:');
const craftItem = modelBody('CraftItem') ?? '';
for (const col of ['commissionModel', 'artisanShareRate', 'creatorFundedBy']) {
  if (new RegExp(`\\n\\s*${col}\\s`).test(craftItem)) {
    fail(`CraftItem.${col} exists though phase 13 was skipped — schema is ahead of the code`);
  } else ok(`CraftItem.${col} absent, as expected`);
}

console.log('\nSOLD_OFFLINE, the one status string the programme added (phase 1):');
for (const [label, file, pattern] of [
  ['SOLD_STATUSES', 'src/lib/storefrontSale.ts', /export const SOLD_STATUSES[^\n]*'SOLD_OFFLINE'/],
  ['statusBadge()', 'src/components/ui/Badge.tsx', /case "SOLD_OFFLINE"/],
]) {
  if (exists(file) && pattern.test(read(file))) ok(`${label} handles SOLD_OFFLINE`);
  else fail(`${label} in ${file} does not handle SOLD_OFFLINE`);
}
// buyers.ts deliberately EXCLUDES it: that constant counts storefront purchases,
// and offline sales are read from their own table alongside it. Asserted so the
// omission reads as a decision rather than an oversight.
if (/STOREFRONT_SOLD_STATUSES[^\n]*SOLD_OFFLINE/.test(read('src/lib/buyers.ts'))) {
  fail('STOREFRONT_SOLD_STATUSES now includes SOLD_OFFLINE — offline sales would be double-counted');
} else ok('STOREFRONT_SOLD_STATUSES still excludes SOLD_OFFLINE (counted from OfflineSale instead)');

// ===========================================================================
console.log('\n\nAPPENDIX B — shared guardrails\n');
console.log(`(${v12Files.length} source files changed since ${BASELINE})\n`);
// ===========================================================================

console.log('[ ] No new npm dependency');
try {
  const before = JSON.parse(git(`git show ${BASELINE}:package.json`));
  const after = JSON.parse(read('package.json'));
  const changed = [];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(after[section] ?? {})) {
      const was = before[section]?.[name];
      if (!was) changed.push(`added ${section}.${name}`);
      else if (was !== version) changed.push(`${section}.${name} ${was} → ${version}`);
    }
  }
  if (changed.length) fail(`dependencies changed: ${changed.join(', ')}`);
  else ok('package.json dependencies are byte-identical to the baseline');
} catch {
  note('baseline package.json unavailable — dependency check skipped');
}

console.log('\n[ ] No alert() / confirm() / prompt()');
{
  const hits = [];
  for (const f of v12Files) {
    // Comments and string literals are stripped first: this repo deliberately
    // contains the words in both — comments recording that an alert() was
    // REPLACED, and `<script>alert(1)</script>` fixtures that the motif spec
    // sanitiser is tested against.
    const src = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');
    for (const m of src.matchAll(/(?<![.\w])(alert|confirm|prompt)\s*\(/g)) hits.push(`${f}: ${m[1]}(`);
  }
  if (hits.length) fail(`blocking browser dialogs: ${hits.slice(0, 5).join(', ')}`);
  else ok('no blocking browser dialog in any changed file');
}

console.log('\n[ ] Every string in all four dictionaries');
{
  const keysOf = (lang) =>
    new Set([...read(`src/lib/i18n/${lang}.ts`).matchAll(/\n\s{2}([a-z][a-z0-9_]*):\s/g)].map((m) => m[1]));
  const en = keysOf('en');
  let bad = 0;
  for (const lang of ['hi', 'or', 'te']) {
    const other = keysOf(lang);
    const missing = [...en].filter((k) => !other.has(k));
    const extra = [...other].filter((k) => !en.has(k));
    if (missing.length || extra.length) {
      bad += 1;
      fail(`${lang}.ts differs from en.ts — ${missing.length} missing, ${extra.length} extra${missing.length ? ` (e.g. ${missing.slice(0, 3).join(', ')})` : ''}`);
    }
  }
  if (!bad) ok(`all four dictionaries carry the same ${en.size} keys`);
}

console.log('\n[ ] No claim of GI registration, legal IP, credit rating, blockchain or AI authentication');
{
  // The guardrail forbids CLAIMING one of these, not naming it. "GI tag news",
  // a buyer's "GI tag needed" placeholder and "your GI tag" (the one an artisan
  // declared on their own profile) are legitimate uses of the words; a sentence
  // saying THIS APP registers, certifies or protects something is not.
  const FORBIDDEN = [
    [/\b(registered|certified|protected|verified|secured)\s+(on\s+the\s+)?(GI|blockchain|chain)\b/i, 'conferring a GI or chain record'],
    [/\bGI[- ]?(registered|registration|certified by)\b/i, 'GI registration'],
    [/\bwe (register|certify|protect|authenticate)\b/i, 'this app conferring a status'],
    [/geographical indication (is|has been) (granted|registered)/i, 'granting a geographical indication'],
    [/\b(is|are) (trademarked|patented|legally protected)\b/i, 'legal protection'],
    [/\bon the blockchain\b/i, 'blockchain'],
    [/\bblockchain[- ](secured|verified|backed|registered)\b/i, 'blockchain'],
    [/\bcredit rating\b/i, 'credit rating'],
    [/\bmarket (rate|standard)\b/i, 'a market standard'],
    [/\bAI[- ]authenticat(ed|ion)\b/i, 'AI authentication'],
  ];
  // Strings whose whole job is to DENY one of these may name it.
  const DENIALS = /^(motif_disclaimer|motif_not_|motif_registry_note|scrap_threshold_note|credit_not_a_rating|credit_disclaimer)/;
  const hits = [];
  for (const lang of ['en', 'hi', 'or', 'te']) {
    for (const m of read(`src/lib/i18n/${lang}.ts`).matchAll(/\n\s{2}([a-z][a-z0-9_]*):\s*"((?:[^"\\]|\\.)*)"/g)) {
      const [, key, value] = m;
      if (DENIALS.test(key)) continue;
      for (const [re, label] of FORBIDDEN) if (re.test(value)) hits.push(`${lang}.${key} → ${label}`);
    }
  }
  if (hits.length) fail(`claims found: ${hits.slice(0, 6).join(' · ')}`);
  else ok('no dictionary string in any language claims a status this app cannot grant');
}

console.log('\n[ ] The four income streams (escrow / demand / offline / scrap) stay separately labelled');
{
  const dash = read('src/app/api/artisan/dashboard/route.ts');
  if (/totalEarnings\s*\+=?[^;]*offline/i.test(dash)) fail('the dashboard folds offline sales into totalEarnings');
  else ok('offline earnings are returned separately from totalEarnings');
  if (/scrap/i.test(dash)) fail('the dashboard route mentions scrap — scrap is a fourth, separate stream');
  else ok('the dashboard route carries no scrap figure');
  if (/readScrapEarnings/.test(read('src/lib/scrapRecord.ts'))) ok('scrap income has its own read');
  else fail('no separate scrap earnings read');
}

console.log('\n[ ] Money that did not move is never shown as received; SIMULATED payouts labelled');
{
  // A route that merely SELECTS payoutMode is a reader, not a writer.
  const writes = /data:\s*[\s\S]{0,400}?payoutMode|payoutMode:\s*(row\.mode|mode|result\.mode)/;
  const writers = v12Files.filter((f) => f.includes('/api/') && writes.test(read(f)));
  if (writers.length === 0) note('no payout writer among the changed files');
  for (const f of writers) {
    if (/every\(\(row\) => row\.mode === 'RAZORPAYX'\)|result\.mode/.test(read(f))) {
      ok(`${f} derives payoutMode from payoutToVpa's result`);
    } else fail(`${f} writes payoutMode without deriving it from the payout result`);
  }
  for (const lang of ['en', 'hi', 'or', 'te']) {
    if (/(motif|scrap)_payout_simulated:/.test(read(`src/lib/i18n/${lang}.ts`))) ok(`${lang}.ts has a SIMULATED label`);
    else fail(`${lang}.ts has no SIMULATED payout label`);
  }
}

console.log('\n[ ] `unoptimized` on every data-URL <Image>');
{
  const bad = new Set();
  for (const f of v12Files.filter((x) => x.endsWith('.tsx'))) {
    const src = read(f);
    if (!src.includes('<Image')) continue;
    for (const m of src.matchAll(/<Image[\s\S]{0,400}?\/>/g)) {
      const tag = m[0];
      if (!/(photoUrl|referenceImageUrl|svgThumb|dataUrl|images\[)/.test(tag)) continue;
      if (!/unoptimized/.test(tag)) bad.add(f);
    }
  }
  if (bad.size) fail(`data-URL <Image> without unoptimized: ${[...bad].join(', ')}`);
  else ok('every data-URL <Image> in V12 code carries unoptimized');
}

console.log('\n[ ] Timestamp-presence idempotency guards; @@unique where a double-write is conceivable');
{
  for (const [model, key] of [
    ['MotifPayoutShare', '@@unique([licenceId, artisanId])'],
    ['ScrapPayoutShare', '@@unique([poolId, artisanId])'],
    ['ArtisanBadge', '@@unique([artisanId, key])'],
  ]) {
    if (schema.includes(key)) ok(`${model} carries ${key}`);
    else fail(`${model} is missing ${key}`);
  }
  for (const [f, guard] of [
    ['src/app/api/admin/scrap-sale/route.ts', /soldAt: null/],
    ['src/app/api/admin/motif-licence-payout/route.ts', /paidAt: null/],
  ]) {
    if (exists(f) && guard.test(read(f))) ok(`${f} guards on a timestamp being absent`);
    else fail(`${f} has no timestamp-presence guard`);
  }
}

console.log('\n[ ] Public routes leak no PII: explicit allow-lists, not delete-lists');
{
  for (const [f, builder] of [
    ['src/app/api/scrap/pools/route.ts', 'toPublicPool'],
    ['src/app/motif/[id]/page.tsx', 'toPublicMotif'],
  ]) {
    if (!exists(f)) { fail(`${f} is missing`); continue; }
    const src = read(f);
    if (src.includes(builder)) ok(`${f} builds its response through ${builder}`);
    else fail(`${f} does not go through an allow-list builder`);
    if (/delete\s+\w+\.\w+|delete\s+row\[/.test(src)) fail(`${f} deletes fields from a row instead of allow-listing`);
  }
}

console.log('\n[ ] logCraftItemEvent() on every CraftItem state change');
{
  const writers = v12Files.filter((f) => /craftItem\.update(Many)?\b/.test(read(f)));
  if (writers.length === 0) note('no changed file mutates a CraftItem directly');
  for (const f of writers) {
    if (/logCraftItemEvent/.test(read(f))) ok(`${f} logs its CraftItem change`);
    else fail(`${f} mutates a CraftItem without logCraftItemEvent()`);
  }
}

console.log('\nNot covered here, and checked in the browser instead (see the ledger):');
for (const item of [
  'empty and not-enough-data states, each naming its own threshold',
  'medians rather than means, with a minimum sample size',
  'role="status" / aria-live, aria-label on icon buttons, focus trapping',
  'hydration-safe dates and relative times',
  '360 px layout and reduced-motion',
  'zero React warnings and zero uncaught console errors',
]) note(item);

console.log(`\n${checks - problems} passed, ${problems} failed`);
process.exit(problems === 0 ? 0 : 1);
