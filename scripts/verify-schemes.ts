/**
 * Executable verification of the Government Scheme Eligibility Engine.
 *
 * There is no test runner in this project on purpose. This file is a plain tsx
 * script with a hand-rolled assertion harness:
 *
 *     npm run verify:schemes
 *
 * It exits 0 when every assertion passes and 1 when any assertion fails, so it
 * can be wired into CI without adding jest/vitest.
 *
 * NOTE: the "@/" path alias is a tsconfig/bundler concern and does not resolve
 * under plain tsx, so src/lib/schemes is imported by relative path.
 */

import {
  matchPmVishwakarmaTrade,
  evaluateScheme,
  evaluateAllSchemes,
  selfDeclarationsFor,
  SCHEME_BY_KEY,
  type EligibilityContext,
  type SchemeKey,
  type SchemeVerdict,
} from '../src/lib/schemes';

/* ------------------------------------------------------------------------- */
/* Assertion harness                                                          */
/* ------------------------------------------------------------------------- */

let passed = 0;
let failed = 0;

function section(title: string): void {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log('  PASS  ' + label);
    return;
  }
  failed += 1;
  console.log('  FAIL  ' + label);
  console.log('          expected: ' + e);
  console.log('          actual:   ' + a);
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------- */

function verdictFor(key: SchemeKey, ctx: EligibilityContext): SchemeVerdict {
  return evaluateScheme(SCHEME_BY_KEY[key], ctx);
}

function statusFor(key: SchemeKey, ctx: EligibilityContext): string {
  return verdictFor(key, ctx).status;
}

/** Rule ids reported in the verdict's `failed` list, sorted for stable compare. */
function failedIds(key: SchemeKey, ctx: EligibilityContext): string[] {
  return verdictFor(key, ctx).failed.map((f) => f.id).sort();
}

/** The `missing` profile fields, or [] for any non-INFO_NEEDED verdict. */
function missingFields(key: SchemeKey, ctx: EligibilityContext): string[] {
  const v = verdictFor(key, ctx);
  return v.status === 'INFO_NEEDED' ? [...v.missing].sort() : [];
}

function selfDeclareCount(key: SchemeKey): number {
  return selfDeclarationsFor(SCHEME_BY_KEY[key]).length;
}

/* ------------------------------------------------------------------------- */
/* Fixtures - every one a complete EligibilityContext                         */
/* ------------------------------------------------------------------------- */

/** Handloom weaver: Ikat. Must never qualify for PM Vishwakarma. */
const LAKSHMI: EligibilityContext = {
  socialCategory: 'OBC',
  annualIncome: 180000,
  craftType: 'Pochampally Ikat',
  aadhaarLast4: '4821',
  upiId: 'lakshmi@upi',
  clusterName: 'Pochampally Weavers Cluster',
  cooperativeId: 'coop-ap-014',
  hasListedItem: true,
  hasVerifiedItem: true,
};

/** Potter, SC, low income: the broadest-eligibility persona. */
const MOHAN: EligibilityContext = {
  socialCategory: 'SC',
  annualIncome: 72000,
  craftType: 'Khurja Pottery',
  aadhaarLast4: '9013',
  upiId: 'mohan@upi',
  clusterName: 'Khurja Pottery Cluster',
  cooperativeId: 'coop-up-007',
  hasListedItem: true,
  hasVerifiedItem: true,
};

/** Filigree artisan with no social category recorded and nothing listed yet. */
const DEVI: EligibilityContext = {
  socialCategory: null,
  annualIncome: 150000,
  craftType: 'Cuttack Silver Filigree',
  aadhaarLast4: '2277',
  upiId: 'devi@upi',
  clusterName: 'Cuttack Tarakasi Cluster',
  cooperativeId: 'coop-od-002',
  hasListedItem: false,
  hasVerifiedItem: false,
};

/** Freshly registered artisan who has filled in nothing at all. */
const NO_PROFILE: EligibilityContext = {
  socialCategory: null,
  annualIncome: null,
  craftType: null,
  aadhaarLast4: null,
  upiId: null,
  clusterName: null,
  cooperativeId: null,
  hasListedItem: false,
  hasVerifiedItem: false,
};

/** SC but well over the income ceiling - must fail on income, not category. */
const HIGH_INCOME_SC: EligibilityContext = {
  socialCategory: 'SC',
  annualIncome: 500000,
  craftType: 'Khurja Pottery',
  aadhaarLast4: '5566',
  upiId: 'high@upi',
  clusterName: 'Khurja Pottery Cluster',
  cooperativeId: 'coop-up-007',
  hasListedItem: true,
  hasVerifiedItem: true,
};

console.log('KARIGARI - scheme rules engine verification');

/* ------------------------------------------------------------------------- */
/* 1-2. Trade mapping                                                         */
/* ------------------------------------------------------------------------- */

section('1. matchPmVishwakarmaTrade - handloom is NOT a notified trade');

const HANDLOOM_CRAFTS = [
  'Pochampally Ikat',
  'Sambalpuri Bandha',
  'Sonepuri Silk',
  'Banarasi Silk Saree',
  'Cotton Ikat Dupatta',
];

for (const craft of HANDLOOM_CRAFTS) {
  const m = matchPmVishwakarmaTrade(craft);
  assertEqual(craft + ' -> trade null', m.trade, null);
  assertEqual(craft + ' -> isHandloom true', m.isHandloom, true);
}

// The specific trap: the word "cotton" must not drag a dupatta into Tailor.
assertEqual(
  '"Cotton Ikat Dupatta" is NOT matched as Tailor',
  matchPmVishwakarmaTrade('Cotton Ikat Dupatta').trade === 'Tailor (Darzi)',
  false
);

section('2. matchPmVishwakarmaTrade - handicrafts map to notified trades');

assertEqual(
  '"Khurja Pottery" -> Potter',
  matchPmVishwakarmaTrade('Khurja Pottery').trade,
  'Potter (Kumhaar)'
);
assertEqual(
  '"Cuttack Silver Filigree" -> Goldsmith',
  matchPmVishwakarmaTrade('Cuttack Silver Filigree').trade,
  'Goldsmith (Sonar)'
);
assertEqual(
  '"Terracotta Wall Mural" -> Potter',
  matchPmVishwakarmaTrade('Terracotta Wall Mural').trade,
  'Potter (Kumhaar)'
);
assertEqual(
  '"Bamboo Basket" -> Basket maker',
  matchPmVishwakarmaTrade('Bamboo Basket').trade,
  'Basket / Mat / Broom Maker / Coir Weaver'
);
assertEqual(
  '"Wooden Toy" -> a notified trade (non-null)',
  matchPmVishwakarmaTrade('Wooden Toy').trade !== null,
  true
);

const HANDICRAFT_CRAFTS = [
  'Khurja Pottery',
  'Cuttack Silver Filigree',
  'Terracotta Wall Mural',
  'Bamboo Basket',
  'Wooden Toy',
];
for (const craft of HANDICRAFT_CRAFTS) {
  assertEqual(craft + ' -> isHandloom false', matchPmVishwakarmaTrade(craft).isHandloom, false);
}

assertEqual('empty craftType -> trade null', matchPmVishwakarmaTrade('').trade, null);
assertEqual('empty craftType -> isHandloom false', matchPmVishwakarmaTrade('').isHandloom, false);

/* ------------------------------------------------------------------------- */
/* 3-8. Scheme verdicts                                                       */
/* ------------------------------------------------------------------------- */

section('3. Lakshmi - Ikat weaver, OBC, income 1.8L, full profile');

// Uses evaluateAllSchemes so the whole card grid is covered in one pass.
const lakshmiByKey: Record<string, string> = {};
for (const s of evaluateAllSchemes(LAKSHMI)) lakshmiByKey[s.key] = s.verdict.status;

assertEqual('evaluateAllSchemes returns all 6 schemes', evaluateAllSchemes(LAKSHMI).length, 6);
assertEqual('pm_vishwakarma INELIGIBLE (weaving is not notified)', lakshmiByKey.pm_vishwakarma, 'INELIGIBLE');
assertEqual('nsfdc INELIGIBLE (OBC, not SC)', lakshmiByKey.nsfdc, 'INELIGIBLE');
assertEqual('nbcfdc ELIGIBLE', lakshmiByKey.nbcfdc, 'ELIGIBLE');
assertEqual('gem_seller ELIGIBLE', lakshmiByKey.gem_seller, 'ELIGIBLE');
assertEqual('ahvy ELIGIBLE', lakshmiByKey.ahvy, 'ELIGIBLE');
assertEqual('ondc ELIGIBLE', lakshmiByKey.ondc, 'ELIGIBLE');
assertEqual('pm_vishwakarma fails on notified_trade', failedIds('pm_vishwakarma', LAKSHMI), ['notified_trade']);
assertEqual('nsfdc fails on category_sc only', failedIds('nsfdc', LAKSHMI), ['category_sc']);

section('4. Mohan - potter, SC, income 72k, full profile');

assertEqual('pm_vishwakarma ELIGIBLE (Potter is notified)', statusFor('pm_vishwakarma', MOHAN), 'ELIGIBLE');
assertEqual('nsfdc ELIGIBLE (SC and under ceiling)', statusFor('nsfdc', MOHAN), 'ELIGIBLE');
assertEqual('nbcfdc INELIGIBLE (SC is not OBC/EWS)', statusFor('nbcfdc', MOHAN), 'INELIGIBLE');
assertEqual('nbcfdc fails on category_obc_ews only', failedIds('nbcfdc', MOHAN), ['category_obc_ews']);

section('5. Devi - filigree, no social category, nothing listed');

assertEqual('nsfdc INFO_NEEDED', statusFor('nsfdc', DEVI), 'INFO_NEEDED');
assertEqual('nsfdc missing includes socialCategory', missingFields('nsfdc', DEVI), ['socialCategory']);
assertEqual('nbcfdc INFO_NEEDED', statusFor('nbcfdc', DEVI), 'INFO_NEEDED');
assertEqual('nbcfdc missing includes socialCategory', missingFields('nbcfdc', DEVI), ['socialCategory']);
assertEqual('pm_vishwakarma ELIGIBLE (Goldsmith is notified)', statusFor('pm_vishwakarma', DEVI), 'ELIGIBLE');
assertEqual('ondc INELIGIBLE (no listed/verified item)', statusFor('ondc', DEVI), 'INELIGIBLE');
assertEqual('ondc fails on has_market_ready_item only', failedIds('ondc', DEVI), ['has_market_ready_item']);
assertEqual('ahvy ELIGIBLE', statusFor('ahvy', DEVI), 'ELIGIBLE');

section('6. No-profile artisan - everything null/false');

assertEqual('gem_seller INFO_NEEDED', statusFor('gem_seller', NO_PROFILE), 'INFO_NEEDED');
assertEqual(
  'gem_seller missing aadhaarLast4 + upiId',
  missingFields('gem_seller', NO_PROFILE),
  ['aadhaarLast4', 'upiId']
);

// Precedence, straight from the evaluateScheme doc comment:
//   1. a verifiable rule failing on KNOWN data      -> INELIGIBLE (definitive)
//   2. otherwise, a rule blocked only by an unfilled profile field -> INFO_NEEDED
//   3. otherwise                                    -> ELIGIBLE
// ONDC has BOTH kinds of failure for this artisan: has_settlement_account
// carries missingField 'upiId', but has_market_ready_item is a hard failure
// with no missingField (listing a product is not a profile field). The hard
// failure outranks the missing field, so the true verdict is INELIGIBLE - not
// INFO_NEEDED. STATUS follows that precedence, but `failed` still carries EVERY
// failing rule so the card can list all blockers and tick the criteria honestly.
assertEqual('ondc INELIGIBLE (hard failure outranks missing field)', statusFor('ondc', NO_PROFILE), 'INELIGIBLE');
assertEqual(
  'ondc failed lists BOTH blockers, not just the hard one',
  failedIds('ondc', NO_PROFILE).slice().sort(),
  ['has_market_ready_item', 'has_settlement_account']
);
assertEqual('ondc carries no missing[] when INELIGIBLE', missingFields('ondc', NO_PROFILE), []);

assertEqual('ahvy INELIGIBLE (no cluster)', statusFor('ahvy', NO_PROFILE), 'INELIGIBLE');
assertEqual(
  'ahvy fails on in_cluster (and on having no craft recorded)',
  failedIds('ahvy', NO_PROFILE),
  ['in_cluster', 'is_handicraft_craft']
);
assertEqual('pm_vishwakarma INELIGIBLE (no craft recorded)', statusFor('pm_vishwakarma', NO_PROFILE), 'INELIGIBLE');

section('7. High-income SC - income, not category, is the blocker');

assertEqual('nsfdc INELIGIBLE', statusFor('nsfdc', HIGH_INCOME_SC), 'INELIGIBLE');
assertEqual(
  'nsfdc fails on income_ceiling_3l only (category passes)',
  failedIds('nsfdc', HIGH_INCOME_SC),
  ['income_ceiling_3l']
);

section('8. Self-declaration counts');

assertEqual('pm_vishwakarma has exactly 4 self-declarations', selfDeclareCount('pm_vishwakarma'), 4);
assertEqual('gem_seller has exactly 1 self-declaration', selfDeclareCount('gem_seller'), 1);
assertEqual('nsfdc has 0 self-declarations', selfDeclareCount('nsfdc'), 0);
assertEqual(
  'self-declarations are surfaced even on an INELIGIBLE verdict',
  verdictFor('pm_vishwakarma', LAKSHMI).selfDeclare.map((r) => r.id),
  ['age_18', 'not_govt_employee', 'no_similar_credit_5y', 'one_per_family']
);

/* ------------------------------------------------------------------------- */
/* Summary                                                                    */
/* ------------------------------------------------------------------------- */

console.log('');

/* ------------------------------------------------------------------------- */
/* 9. Regressions from the adversarial review                                 */
/* ------------------------------------------------------------------------- */

section('9. Marker-collision regressions');

// Notified trades whose NAME contains a weaving word must still reach their trade.
// Before the fix the 'weav' handloom short-circuit swallowed them.
assertEqual(
  '"Coir Weaving" -> Basket/Coir (weaving word, but a notified trade)',
  matchPmVishwakarmaTrade('Coir Weaving').trade,
  'Basket / Mat / Broom Maker / Coir Weaver'
);
assertEqual(
  '"Fishing Net Weaving" -> Fishing Net Maker',
  matchPmVishwakarmaTrade('Fishing Net Weaving').trade,
  'Fishing Net Maker'
);
assertEqual(
  '"Cotton Doll Making" -> Doll and Toy Maker (fibre word is not decisive)',
  matchPmVishwakarmaTrade('Cotton Doll Making').trade,
  'Doll and Toy Maker (Traditional)'
);

// Substring collisions that used to grant or deny eligibility by coincidence.
assertEqual(
  '"Hurricane Lamp Glasswork" is NOT a Basket maker (cane inside hurricane)',
  matchPmVishwakarmaTrade('Hurricane Lamp Glasswork').trade,
  null
);
assertEqual(
  '"Sugarcane Crusher" is NOT a Basket maker',
  matchPmVishwakarmaTrade('Sugarcane Crusher').trade,
  null
);
assertEqual(
  '"Heirloom Brass Lamps" is NOT handloom (loom inside heirloom)',
  matchPmVishwakarmaTrade('Heirloom Brass Lamps').isHandloom,
  false
);
assertEqual(
  '"Hammered Brass Bowl" is NOT a Hammer and Tool Kit Maker',
  matchPmVishwakarmaTrade('Hammered Brass Bowl').trade,
  null
);

// G4 must survive every one of the above.
for (const craft of [
  'Pochampally Ikat Silk Saree',
  'Sambalpuri Bandha Bed Cover',
  'Handloom Cotton Gamucha',
  'Silk Yardage Weaving',
]) {
  assertEqual('G4: "' + craft + '" stays OUT of the 18 trades', matchPmVishwakarmaTrade(craft).trade, null);
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
