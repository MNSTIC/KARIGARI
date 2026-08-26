/**
 * Government Scheme Eligibility Engine — pure rules, no model, no black box.
 *
 * Every scheme below encodes *published* eligibility criteria mapped onto fields
 * KARIGARI actually stores on the artisan. Anything that cannot be checked from
 * stored data is marked `verifiable: false` and becomes a self-declaration the
 * artisan ticks at apply time — it is never silently auto-passed.
 *
 * This module is deliberately free of React, Prisma and `next/*` imports so the
 * API can evaluate it server-side and a test file can assert it directly.
 */

export type SchemeKey =
  | 'pm_vishwakarma'
  | 'nsfdc'
  | 'nbcfdc'
  | 'gem_seller'
  | 'ahvy'
  | 'ondc';

export type ApplicationStatus =
  | 'ELIGIBLE'
  | 'APPLIED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'DISBURSED';

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'ELIGIBLE',
  'APPLIED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'DISBURSED',
];

/** Profile fields an artisan can fill in themselves (drives INFO_NEEDED vs INELIGIBLE). */
export type ProfileField =
  | 'socialCategory'
  | 'annualIncome'
  | 'aadhaarLast4'
  | 'upiId';

export interface EligibilityContext {
  socialCategory?: string | null;
  annualIncome?: number | null;
  craftType?: string | null;
  aadhaarLast4?: string | null;
  upiId?: string | null;
  clusterName?: string | null;
  cooperativeId?: string | null;
  /** At least one craft item flagged `isListedOnMarketplace`. */
  hasListedItem: boolean;
  /** At least one craft item that carries a blockchain patch id (admin-verified). */
  hasVerifiedItem: boolean;
}

export interface RuleOutcome {
  pass: boolean;
  /** What the artisan's data actually says, e.g. "OBC". */
  actual?: string;
  /** What the published criterion requires, e.g. "Scheduled Caste (SC)". */
  needed?: string;
  /**
   * Set when the rule failed only because the artisan has not filled a profile
   * field yet. Turns the verdict into INFO_NEEDED instead of a dead INELIGIBLE.
   */
  missingField?: ProfileField;
}

export interface Rule {
  id: string;
  /** Human-readable criterion. This is what makes the engine auditable. */
  label: string;
  /** false → cannot be checked from stored data → self-declaration checkbox. */
  verifiable: boolean;
  evaluate?: (ctx: EligibilityContext) => RuleOutcome;
}

/** JSON-safe projection of a Rule (functions cannot cross the API boundary). */
export interface PublicRule {
  id: string;
  label: string;
  verifiable: boolean;
}

export interface RuleFailure extends PublicRule {
  actual?: string;
  needed?: string;
  missingField?: ProfileField;
}

export type ApplyMode = 'DIRECT' | 'DOWNLOAD_FORM';

export interface Scheme {
  key: SchemeKey;
  name: string;
  description: string;
  benefit: string;
  officialUrl: string;
  applyMode: ApplyMode;
  /** For DOWNLOAD_FORM schemes; falls back to `officialUrl` when no PDF is bundled. */
  formPath?: string;
  /** Extra caveat shown on the card (e.g. GST rules we cannot verify). */
  note?: string;
  rules: Rule[];
}

export interface PublicScheme {
  key: SchemeKey;
  name: string;
  description: string;
  benefit: string;
  officialUrl: string;
  applyMode: ApplyMode;
  formPath?: string;
  note?: string;
  rules: PublicRule[];
}

export type SchemeVerdict =
  | { status: 'ELIGIBLE'; failed: []; selfDeclare: PublicRule[] }
  | { status: 'INELIGIBLE'; failed: RuleFailure[]; selfDeclare: PublicRule[] }
  | {
      status: 'INFO_NEEDED';
      missing: ProfileField[];
      failed: RuleFailure[];
      selfDeclare: PublicRule[];
    };

/* ------------------------------------------------------------------------- */
/* PM Vishwakarma — the 18 notified trades                                    */
/* ------------------------------------------------------------------------- */

/**
 * The 18 trades notified under PM Vishwakarma. Handloom / textile weaving is
 * deliberately absent — it is NOT a notified trade, and most KARIGARI artisans
 * (Ikat, Bandha, Banarasi, saree and dupatta weavers) are therefore ineligible.
 */
export const PM_VISHWAKARMA_TRADES = [
  'Carpenter (Suthar)',
  'Boat Maker',
  'Armourer',
  'Blacksmith (Lohar)',
  'Hammer and Tool Kit Maker',
  'Locksmith',
  'Goldsmith (Sonar)',
  'Potter (Kumhaar)',
  'Sculptor (Moortikar, stone carver)',
  'Cobbler (Charmakar) / Shoesmith',
  'Mason (Rajmistri)',
  'Basket / Mat / Broom Maker / Coir Weaver',
  'Doll and Toy Maker (Traditional)',
  'Barber (Naai)',
  'Garland Maker (Malakaar)',
  'Washerman (Dhobi)',
  'Tailor (Darzi)',
  'Fishing Net Maker',
] as const;

export type PmTrade = (typeof PM_VISHWAKARMA_TRADES)[number];

/**
 * Craft types that are handloom / textile weaving. Checked FIRST so that a
 * "Cotton Ikat Dupatta" is never dragged into "Tailor" by the word "cotton",
 * and "Basket weave stole" is never dragged into "Basket / Coir Weaver".
 */
const HANDLOOM_MARKERS = [
  'handloom',
  'loom',
  'weav',
  'weaver',
  'textile',
  'fabric',
  'yardage',
  'ikat',
  'ikkat',
  'bandha',
  'bandhani',
  'pochampally',
  'sambalpuri',
  'sonepuri',
  'banarasi',
  'benarasi',
  'brocade',
  'zari',
  'jamdani',
  'chanderi',
  'maheshwari',
  'kanjeevaram',
  'kanchipuram',
  'patola',
  'paithani',
  'bhagalpuri',
  'tussar',
  'muga',
  'khadi',
  'pashmina',
  'shawl',
  'saree',
  'sari',
  'dupatta',
  'stole',
  'gamucha',
  'gamcha',
  'lungi',
  'dhoti',
  'bed cover',
  'bedcover',
  'silk',
  'cotton',
  'wool',
  'thread',
  'yarn',
  'embroider',
  'kantha',
  'chikankari',
  'phulkari',
  'kalamkari',
  'block print',
  'batik',
  'tie and dye',
  'tie-dye',
];

/**
 * Trades that are unambiguously NOT textile weaving. These are tested BEFORE the
 * handloom short-circuit, because several notified trades legitimately contain a
 * weaving word ("Coir Weaver", "Fishing Net Maker") or a fibre word
 * ("Cotton Doll Making") and would otherwise be wrongly excluded.
 */
const STRONG_TRADE_MARKERS: Array<{ markers: string[]; trade: PmTrade }> = [
  { markers: ['pottery', 'potter', 'terracotta', 'clay', 'kumhaar', 'kumbhar', 'ceramic'], trade: 'Potter (Kumhaar)' },
  { markers: ['sculpt', 'stone carv', 'stone-carv', 'moortikar', 'murti', 'idol', 'statue', 'marble carv'], trade: 'Sculptor (Moortikar, stone carver)' },
  { markers: ['goldsmith', 'silversmith', 'jewel', 'sonar', 'filigree', 'tarakasi', 'kundan', 'meenakari'], trade: 'Goldsmith (Sonar)' },
  { markers: ['blacksmith', 'lohar', 'iron work', 'ironwork', 'wrought iron'], trade: 'Blacksmith (Lohar)' },
  { markers: ['hammer maker', 'tool kit', 'toolkit', 'tool-kit'], trade: 'Hammer and Tool Kit Maker' },
  { markers: ['locksmith', 'lock maker'], trade: 'Locksmith' },
  { markers: ['armour', 'armor', 'weapon smith'], trade: 'Armourer' },
  { markers: ['boat'], trade: 'Boat Maker' },
  { markers: ['carpenter', 'carpentry', 'woodwork', 'wood work', 'wood carv', 'wooden', 'furniture', 'suthar', 'badhai'], trade: 'Carpenter (Suthar)' },
  { markers: ['cobbler', 'shoesmith', 'footwear', 'leather', 'charmakar', 'juti', 'mojari', 'chappal'], trade: 'Cobbler (Charmakar) / Shoesmith' },
  { markers: ['mason', 'rajmistri', 'bricklay'], trade: 'Mason (Rajmistri)' },
  { markers: ['fishing net', 'fishnet', 'fish net'], trade: 'Fishing Net Maker' },
  { markers: ['basket', 'mat maker', 'broom', 'coir', 'bamboo', 'cane', 'wicker', 'sabai'], trade: 'Basket / Mat / Broom Maker / Coir Weaver' },
  { markers: ['doll', 'toy', 'channapatna'], trade: 'Doll and Toy Maker (Traditional)' },
  { markers: ['barber', 'naai', 'hairdress'], trade: 'Barber (Naai)' },
  { markers: ['garland', 'malakaar', 'malakar', 'flower work'], trade: 'Garland Maker (Malakaar)' },
  { markers: ['washerman', 'dhobi', 'laundry'], trade: 'Washerman (Dhobi)' },
];

/**
 * Textile-adjacent notified trades. Tested AFTER the handloom short-circuit so a
 * silk saree weaver is never re-labelled a Tailor — G4 wins any ambiguity.
 */
const WEAK_TRADE_MARKERS: Array<{ markers: string[]; trade: PmTrade }> = [
  { markers: ['tailor', 'darzi', 'stitch', 'sewing', 'garment', 'apparel'], trade: 'Tailor (Darzi)' },
];

/**
 * Word-START matching. Plain `includes()` fires inside unrelated words —
 * 'cane' in "Hurricane Lamp", 'loom' in "Heirloom Brass" — which silently
 * granted or denied PM Vishwakarma eligibility on a coincidence. Requiring the
 * marker to begin a word keeps deliberate stems ('weav' → weaving/weaver,
 * 'sculpt' → sculptor) working while killing the accidental matches.
 */
function hasMarker(haystack: string, marker: string): boolean {
  const at = haystack.indexOf(marker);
  if (at < 0) return false;
  let from = 0;
  for (let i = at; i >= 0; i = haystack.indexOf(marker, from)) {
    const before = i === 0 ? '' : haystack[i - 1];
    if (!/[a-z0-9]/.test(before)) return true;
    from = i + 1;
  }
  return false;
}

export interface TradeMatch {
  /** The notified trade, or null when the craft is not one of the 18. */
  trade: PmTrade | null;
  /** True when the craft is recognisably handloom/textile weaving. */
  isHandloom: boolean;
}

/**
 * Map a free-text `craftType` onto one of PM Vishwakarma's 18 notified trades.
 *
 * Order: unambiguous non-textile trades → handloom short-circuit → textile-adjacent
 * trades. Handloom outranks anything textile, so weaving can never be fudged into
 * eligibility, while a coir weaver or a net maker still reaches their notified trade.
 */
export function matchPmVishwakarmaTrade(craftType?: string | null): TradeMatch {
  const c = (craftType ?? '').toLowerCase().trim();
  if (!c) return { trade: null, isHandloom: false };

  for (const { markers, trade } of STRONG_TRADE_MARKERS) {
    if (markers.some((m) => hasMarker(c, m))) return { trade, isHandloom: false };
  }

  if (HANDLOOM_MARKERS.some((m) => hasMarker(c, m))) {
    return { trade: null, isHandloom: true };
  }

  for (const { markers, trade } of WEAK_TRADE_MARKERS) {
    if (markers.some((m) => hasMarker(c, m))) return { trade, isHandloom: false };
  }

  return { trade: null, isHandloom: false };
}

/**
 * KARIGARI only onboards handloom and handicraft artisans, so any recorded
 * craftType is a handicraft/handloom craft for AHVY's purposes. Kept as an
 * explicit, named predicate so the assumption is visible and testable rather
 * than hidden inside a rule body.
 */
export function isHandicraftOrHandloomCraft(craftType?: string | null): boolean {
  return Boolean((craftType ?? '').trim());
}

/* ------------------------------------------------------------------------- */
/* Shared rule builders                                                       */
/* ------------------------------------------------------------------------- */

const INCOME_CEILING = 300000;

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

function incomeCeilingRule(): Rule {
  return {
    id: 'income_ceiling_3l',
    label: `Annual family income is ${inr(INCOME_CEILING)} or less`,
    verifiable: true,
    evaluate: (ctx) => {
      if (ctx.annualIncome === null || ctx.annualIncome === undefined) {
        return {
          pass: false,
          needed: `${inr(INCOME_CEILING)} or less`,
          missingField: 'annualIncome',
        };
      }
      return {
        pass: ctx.annualIncome <= INCOME_CEILING,
        actual: inr(ctx.annualIncome),
        needed: `${inr(INCOME_CEILING)} or less`,
      };
    },
  };
}

function socialCategoryRule(id: string, accepted: string[], neededLabel: string): Rule {
  return {
    id,
    label: `Social category is ${neededLabel}`,
    verifiable: true,
    evaluate: (ctx) => {
      const cat = (ctx.socialCategory ?? '').trim().toUpperCase();
      if (!cat) {
        return { pass: false, needed: neededLabel, missingField: 'socialCategory' };
      }
      return { pass: accepted.includes(cat), actual: cat, needed: neededLabel };
    },
  };
}

/* ------------------------------------------------------------------------- */
/* The six schemes                                                            */
/* ------------------------------------------------------------------------- */

export const SCHEMES: Scheme[] = [
  {
    key: 'pm_vishwakarma',
    name: 'PM Vishwakarma Yojana',
    description:
      'Central scheme for traditional artisans and craftspeople working with their hands and tools, delivered through CSC-assisted registration.',
    benefit: '₹15,000 toolkit e-voucher • collateral-free loan up to ₹3 lakh at 5% • ₹500/day training stipend',
    officialUrl: 'https://pmvishwakarma.gov.in/',
    applyMode: 'DIRECT',
    note: 'Registration is completed at a Common Service Centre (CSC) with biometric Aadhaar authentication.',
    rules: [
      {
        id: 'notified_trade',
        label: 'Craft is one of the 18 notified PM Vishwakarma trades',
        verifiable: true,
        evaluate: (ctx) => {
          const { trade, isHandloom } = matchPmVishwakarmaTrade(ctx.craftType);
          if (trade) return { pass: true, actual: trade, needed: 'One of the 18 notified trades' };
          return {
            pass: false,
            actual: ctx.craftType?.trim()
              ? isHandloom
                ? `${ctx.craftType} (handloom weaving)`
                : ctx.craftType
              : 'No craft recorded',
            needed: 'One of the 18 notified trades',
          };
        },
      },
      {
        id: 'age_18',
        label: 'I am 18 years of age or older',
        verifiable: false,
      },
      {
        id: 'not_govt_employee',
        label: 'I am not a government employee, and no member of my family is',
        verifiable: false,
      },
      {
        id: 'no_similar_credit_5y',
        label: 'I have not availed a PMEGP, PM SVANidhi or Mudra loan in the last 5 years',
        verifiable: false,
      },
      {
        id: 'one_per_family',
        label: 'I am the only member of my family applying for this benefit',
        verifiable: false,
      },
    ],
  },

  {
    key: 'nsfdc',
    name: 'NSFDC — National Scheduled Castes Finance & Development Corporation',
    description:
      'Subsidised credit, skill training and marketing support for Scheduled Caste artisans, routed through State Channelizing Agencies and banks.',
    benefit: 'Concessional term loans, micro-credit, skill training and marketing support',
    officialUrl: 'https://nsfdc.nic.in/',
    applyMode: 'DOWNLOAD_FORM',
    note: 'Applications are submitted through your State Channelizing Agency (SCA) or a partner bank branch.',
    rules: [
      socialCategoryRule('category_sc', ['SC'], 'Scheduled Caste (SC)'),
      incomeCeilingRule(),
    ],
  },

  {
    key: 'nbcfdc',
    name: 'NBCFDC — National Backward Classes Finance & Development Corporation',
    description:
      'Concessional term loans and micro-finance for Other Backward Classes and Economically Weaker Sections, via online registration and channel partners.',
    benefit: 'Concessional term loan and micro-finance for income-generating activity',
    officialUrl: 'https://nbcfdc.gov.in/',
    applyMode: 'DIRECT',
    rules: [
      socialCategoryRule('category_obc_ews', ['OBC', 'EWS'], 'OBC or EWS'),
      incomeCeilingRule(),
    ],
  },

  {
    key: 'gem_seller',
    name: 'GeM Seller Registration',
    description:
      'Register as a seller on the Government e-Marketplace and sell directly to government departments and PSUs with no middleman.',
    benefit: 'Direct access to government buyers • free seller registration',
    officialUrl: 'https://gem.gov.in/',
    applyMode: 'DIRECT',
    note: 'PAN is required at registration. GST registration may additionally be required for taxable product categories.',
    rules: [
      {
        id: 'has_aadhaar',
        label: 'Aadhaar recorded on your KARIGARI profile (identity verification)',
        verifiable: true,
        evaluate: (ctx) =>
          ctx.aadhaarLast4?.trim()
            ? { pass: true, actual: `•••• ${ctx.aadhaarLast4}` }
            : {
                pass: false,
                needed: 'Add Aadhaar + UPI/bank to your profile',
                missingField: 'aadhaarLast4',
              },
      },
      {
        id: 'has_upi',
        label: 'UPI / bank account recorded (financial verification)',
        verifiable: true,
        evaluate: (ctx) =>
          ctx.upiId?.trim()
            ? { pass: true, actual: ctx.upiId }
            : {
                pass: false,
                needed: 'Add Aadhaar + UPI/bank to your profile',
                missingField: 'upiId',
              },
      },
      {
        id: 'has_pan',
        label: 'I have a PAN card',
        verifiable: false,
      },
    ],
  },

  {
    key: 'ahvy',
    name: 'AHVY — Ambedkar Hastshilp Vikas Yojana',
    description:
      'Cluster-based handicraft development under the National Handicraft Development Programme, run by the Office of the Development Commissioner (Handicrafts).',
    benefit: 'Toolkits (~₹5,000) • margin money (~₹4,000 per artisan) • Common Facility Centres • marketing and exposure visits',
    officialUrl: 'https://handicrafts.nic.in/',
    applyMode: 'DOWNLOAD_FORM',
    note: 'Applied through a registered producer group, SHG or cooperative in which at least 50% of members are cluster artisans.',
    rules: [
      {
        id: 'is_handicraft_craft',
        label: 'Practises a handicraft or handloom craft',
        verifiable: true,
        evaluate: (ctx) =>
          isHandicraftOrHandloomCraft(ctx.craftType)
            ? { pass: true, actual: ctx.craftType ?? undefined }
            : {
                pass: false,
                needed: 'A recorded handicraft or handloom craft',
                actual: 'No craft recorded',
              },
      },
      {
        id: 'in_cluster',
        label: 'Belongs to a registered cluster or cooperative',
        verifiable: true,
        evaluate: (ctx) => {
          const where = ctx.clusterName?.trim() || ctx.cooperativeId?.trim();
          return where
            ? { pass: true, actual: where }
            : {
                pass: false,
                needed: 'Join a registered cooperative/cluster to qualify',
              };
        },
      },
    ],
  },

  {
    key: 'ondc',
    name: 'ONDC Seller Onboarding',
    description:
      'List your craft on the Open Network for Digital Commerce and reach buyers nationwide through any ONDC seller app.',
    benefit: 'Nationwide buyer reach on an open e-commerce network, without platform lock-in',
    officialUrl: 'https://ondc.org/',
    applyMode: 'DIRECT',
    note: 'Onboarding happens via an ONDC Seller App (network participant). GST is required unless your category is exempt under CGST §9(5).',
    rules: [
      {
        id: 'has_settlement_account',
        label: 'UPI / settlement account recorded',
        verifiable: true,
        evaluate: (ctx) =>
          ctx.upiId?.trim()
            ? { pass: true, actual: ctx.upiId }
            : { pass: false, needed: 'Add a UPI ID to qualify', missingField: 'upiId' },
      },
      {
        id: 'has_market_ready_item',
        label: 'At least one verified or listed craft item',
        verifiable: true,
        evaluate: (ctx) =>
          ctx.hasListedItem || ctx.hasVerifiedItem
            ? {
                pass: true,
                actual: ctx.hasVerifiedItem ? 'Verified item on the ledger' : 'Item listed on the marketplace',
              }
            : { pass: false, needed: 'Verify & list at least one product first' },
      },
      {
        id: 'gst_or_exempt',
        label: 'I have GST registration, or my category is exempt under CGST §9(5)',
        verifiable: false,
      },
    ],
  },
];

export const SCHEME_BY_KEY: Record<SchemeKey, Scheme> = SCHEMES.reduce(
  (acc, s) => {
    acc[s.key] = s;
    return acc;
  },
  {} as Record<SchemeKey, Scheme>
);

export function isSchemeKey(value: unknown): value is SchemeKey {
  // hasOwnProperty, not `in` — `in` also answers true for 'constructor',
  // '__proto__' and every other Object.prototype key, which would let a crafted
  // POST body walk straight past this guard.
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCHEME_BY_KEY, value);
}

/* ------------------------------------------------------------------------- */
/* The engine                                                                 */
/* ------------------------------------------------------------------------- */

function toPublicRule(rule: Rule): PublicRule {
  return { id: rule.id, label: rule.label, verifiable: rule.verifiable };
}

export function toPublicScheme(scheme: Scheme): PublicScheme {
  return {
    key: scheme.key,
    name: scheme.name,
    description: scheme.description,
    benefit: scheme.benefit,
    officialUrl: scheme.officialUrl,
    applyMode: scheme.applyMode,
    formPath: scheme.formPath,
    note: scheme.note,
    rules: scheme.rules.map(toPublicRule),
  };
}

/** The non-verifiable rules an artisan must tick before this scheme can be applied to. */
export function selfDeclarationsFor(scheme: Scheme): PublicRule[] {
  return scheme.rules.filter((r) => !r.verifiable).map(toPublicRule);
}

/**
 * Evaluate one scheme against one artisan.
 *
 * Precedence is deliberate:
 *   1. A verifiable rule that fails on *known* data  → INELIGIBLE (definitive).
 *   2. Otherwise a rule blocked only by an unfilled  → INFO_NEEDED (actionable).
 *      profile field
 *   3. Otherwise                                     → ELIGIBLE.
 *
 * A hard failure outranks a missing field so we never send an artisan off to
 * fill in a form that cannot change the outcome.
 */
export function evaluateScheme(scheme: Scheme, ctx: EligibilityContext): SchemeVerdict {
  const selfDeclare = selfDeclarationsFor(scheme);

  const failures: RuleFailure[] = [];

  for (const rule of scheme.rules) {
    if (!rule.verifiable || !rule.evaluate) continue;

    const outcome = rule.evaluate(ctx);
    if (outcome.pass) continue;

    failures.push({
      ...toPublicRule(rule),
      actual: outcome.actual,
      needed: outcome.needed,
      missingField: outcome.missingField,
    });
  }

  const hardFailures = failures.filter((f) => !f.missingField);
  const missingFailures = failures.filter((f) => f.missingField);

  // `failed` always carries EVERY failing rule, so the card can show the whole
  // blocker list and tick the criteria accurately. Only the STATUS follows the
  // precedence rule above.
  if (hardFailures.length > 0) {
    return { status: 'INELIGIBLE', failed: failures, selfDeclare };
  }

  if (missingFailures.length > 0) {
    const missing = Array.from(
      new Set(missingFailures.map((f) => f.missingField as ProfileField))
    );
    return { status: 'INFO_NEEDED', missing, failed: failures, selfDeclare };
  }

  return { status: 'ELIGIBLE', failed: [], selfDeclare };
}

export interface EvaluatedScheme extends PublicScheme {
  verdict: SchemeVerdict;
}

export function evaluateAllSchemes(ctx: EligibilityContext): EvaluatedScheme[] {
  return SCHEMES.map((scheme) => ({
    ...toPublicScheme(scheme),
    verdict: evaluateScheme(scheme, ctx),
  }));
}

/* ------------------------------------------------------------------------- */
/* Status normalisation                                                       */
/* ------------------------------------------------------------------------- */

/**
 * Older rows used ad-hoc status strings ("PENDING_APPROVAL"). Normalise on read
 * so the tracker only ever renders the six standard states.
 */
const LEGACY_STATUS_ALIASES: Record<string, ApplicationStatus> = {
  PENDING_APPROVAL: 'UNDER_REVIEW',
  PENDING: 'UNDER_REVIEW',
  SUBMITTED: 'APPLIED',
  IN_REVIEW: 'UNDER_REVIEW',
};

export function normalizeStatus(raw?: string | null): ApplicationStatus {
  const s = (raw ?? '').trim().toUpperCase();
  if ((APPLICATION_STATUSES as string[]).includes(s)) return s as ApplicationStatus;
  return LEGACY_STATUS_ALIASES[s] ?? 'ELIGIBLE';
}

/** Statuses that mean the artisan has already moved past "just eligible". */
export function isTracked(status: ApplicationStatus): boolean {
  return status !== 'ELIGIBLE';
}

/* ------------------------------------------------------------------------- */
/* Legacy row adoption                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Rows written before `SchemeApplication.schemeKey` existed only carry a display
 * name. Both the read and the apply route resolve them through THIS function —
 * if they disagreed, the apply route would create a second row for a scheme that
 * already had history and the tracker could walk backwards.
 */
const LEGACY_NAME_ALIASES: Record<string, SchemeKey> = {
  'pm vishwakarma yojana': 'pm_vishwakarma',
  'pm vishwakarma': 'pm_vishwakarma',
  'national handicraft development programme': 'ahvy',
  'ambedkar hastshilp vikas yojana': 'ahvy',
  ahvy: 'ahvy',
  nsfdc: 'nsfdc',
  nbcfdc: 'nbcfdc',
  'gem seller registration': 'gem_seller',
  'ondc seller onboarding': 'ondc',
};

export function resolveLegacySchemeKey(schemeName?: string | null): SchemeKey | null {
  const n = (schemeName ?? '').trim().toLowerCase();
  if (!n) return null;
  const exact = SCHEMES.find((s) => s.name.toLowerCase() === n);
  if (exact) return exact.key;
  return Object.prototype.hasOwnProperty.call(LEGACY_NAME_ALIASES, n)
    ? LEGACY_NAME_ALIASES[n]
    : null;
}
