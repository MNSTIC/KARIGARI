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
  | 'ondc'
  | 'pmegp'
  | 'mudra'
  | 'sfurti';

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
  /** True when this scheme's primary use is buying, repairing or replacing equipment. */
  equipmentFunding?: boolean;
  /**
   * The official page the figures in `benefit`/`note` were read from.
   * Required for any scheme that states an amount — see `isSchemeCited`.
   */
  sourceUrl?: string;
  /**
   * ISO date the figures were last checked against `sourceUrl`, or null when
   * they could not be confirmed. A scheme that names an amount without both of
   * these is withheld from the artisan entirely rather than shown unverified.
   */
  verifiedOn?: string | null;
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
  equipmentFunding?: boolean;
  sourceUrl?: string;
  verifiedOn?: string | null;
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
    benefit:
      '₹15,000 toolkit grant • collateral-free loan ₹1 lakh, then ₹2 lakh, at 5% • ₹500/day training stipend • ₹1 per digital transaction, up to 100 a month',
    officialUrl: 'https://pmvishwakarma.gov.in/',
    applyMode: 'DIRECT',
    note: 'Registration is completed at a Common Service Centre (CSC) with biometric Aadhaar authentication.',
    // The toolkit grant is what makes this an equipment route for an artisan
    // whose loom or wheel has failed.
    equipmentFunding: true,
    sourceUrl: 'https://pmvishwakarma.gov.in/',
    verifiedOn: '2026-09-18',
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
    // No amounts: the toolkit and margin-money figures this line used to carry
    // were approximations, and handicrafts.nic.in could not be reached to
    // confirm them. What the scheme funds is still true and still useful.
    benefit: 'Toolkits • margin money per artisan • Common Facility Centres • marketing and exposure visits',
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

  {
    key: 'pmegp',
    name: 'PMEGP — Prime Minister\u2019s Employment Generation Programme',
    description:
      'Credit-linked subsidy for setting up a NEW micro-enterprise: a bank term loan for equipment and working capital, with part of the project cost met by a government margin-money subsidy.',
    // Deliberately no subsidy percentage and no manufacturing ceiling: the
    // official FAQ read on the date below states the business/trading ceiling
    // and the education thresholds, and the subsidy table could not be
    // confirmed from a current source. An out-of-date percentage in front of an
    // artisan is worse than no percentage.
    benefit:
      'Margin-money subsidy on a new micro-enterprise project, with the balance financed by a bank • project cost up to ₹20 lakh for business/trading activities',
    officialUrl: 'https://pmegp.msme.gov.in/',
    applyMode: 'DIRECT',
    note: 'Only new units qualify — an existing workshop cannot be funded. Applications are filed on the PMEGP e-portal and appraised by KVIC/KVIB/DIC and your bank. Check the current project-cost ceiling and subsidy rate on the portal before applying.',
    equipmentFunding: true,
    sourceUrl: 'https://pmegp.msme.gov.in/Home/FAQ',
    verifiedOn: '2026-09-18',
    rules: [
      {
        id: 'new_unit_only',
        label: 'This is for a NEW unit — my existing workshop cannot be funded under PMEGP',
        verifiable: false,
      },
      {
        id: 'age_18',
        label: 'I am 18 years of age or older',
        verifiable: false,
      },
      {
        id: 'class_viii_for_large_projects',
        label:
          'If my project costs more than ₹10 lakh (manufacturing) or ₹5 lakh (service), I have passed at least class VIII',
        verifiable: false,
      },
      {
        id: 'one_per_family',
        label: 'Only one person from my family (self, spouse, unmarried children) is applying',
        verifiable: false,
      },
      {
        id: 'is_handicraft_craft',
        label: 'Practises a craft the unit would be built around',
        verifiable: true,
        evaluate: (ctx) =>
          isHandicraftOrHandloomCraft(ctx.craftType)
            ? { pass: true, actual: ctx.craftType ?? undefined }
            : {
                pass: false,
                needed: 'A recorded craft',
                actual: ctx.craftType?.trim() || 'No craft recorded',
              },
      },
    ],
  },

  {
    key: 'mudra',
    name: 'PM MUDRA Yojana',
    description:
      'Collateral-free loans for a non-corporate, non-farm micro enterprise — equipment, raw material or working capital — from banks, small finance banks, NBFCs and MFIs.',
    benefit:
      'Collateral-free loan: Shishu up to ₹50,000 • Kishore above ₹50,000 to ₹5 lakh • Tarun above ₹5 lakh to ₹10 lakh • Tarun Plus ₹10 lakh to ₹20 lakh after a repaid Tarun loan',
    officialUrl: 'https://www.mudra.org.in/',
    applyMode: 'DIRECT',
    note: 'Applied at any member lending institution — a bank branch, small finance bank, NBFC or MFI. Tarun Plus is open only to borrowers who have repaid a Tarun loan.',
    equipmentFunding: true,
    sourceUrl:
      'https://static.pib.gov.in/WriteReadData/specificdocs/documents/2024/oct/doc20241029426401.pdf',
    verifiedOn: '2026-09-18',
    rules: [
      {
        id: 'non_farm_micro',
        label: 'Runs a non-corporate, non-farm micro enterprise (craft production, trading or services)',
        verifiable: true,
        evaluate: (ctx) =>
          ctx.craftType?.trim()
            ? { pass: true, actual: ctx.craftType }
            : { pass: false, needed: 'A recorded craft or trade', actual: 'No craft recorded' },
      },
      {
        id: 'income_generating',
        label: 'The loan is for an income-generating activity, not personal use',
        verifiable: false,
      },
      {
        id: 'bank_account',
        label: 'I have a bank account in my own name to receive the loan',
        verifiable: false,
      },
      {
        id: 'no_default',
        label: 'I am not a defaulter with any bank or financial institution',
        verifiable: false,
      },
    ],
  },

  {
    key: 'sfurti',
    name: 'SFURTI — Scheme of Fund for Regeneration of Traditional Industries',
    description:
      'Cluster-level support for traditional industries: a Common Facility Centre with shared machinery, tools, training and market linkage. Applied for by an implementing agency on behalf of a cluster, not by an individual artisan.',
    // No amounts: sfurti.msme.gov.in and the MSME guidelines PDF could not be
    // reached from this environment, so nothing here states a figure, and
    // verifiedOn null keeps the scheme out of the artisan-facing list entirely
    // (see isSchemeCited / evaluateAllSchemes below).
    benefit: 'Shared machinery and a Common Facility Centre for the cluster, with training and market linkage',
    officialUrl: 'https://sfurti.msme.gov.in/',
    applyMode: 'DOWNLOAD_FORM',
    note: 'Applied through an implementing agency (an NGO, institution or state agency) for a whole cluster of artisans, and sanctioned by the Ministry of MSME.',
    equipmentFunding: true,
    verifiedOn: null,
    rules: [
      {
        id: 'in_cluster',
        label: 'Belongs to a registered cluster or cooperative',
        verifiable: true,
        evaluate: (ctx) => {
          const where = ctx.clusterName?.trim() || ctx.cooperativeId?.trim();
          return where
            ? { pass: true, actual: where }
            : { pass: false, needed: 'Join a registered cooperative/cluster to qualify' };
        },
      },
      {
        id: 'through_implementing_agency',
        label: 'My cluster has an implementing agency willing to apply on its behalf',
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
    equipmentFunding: scheme.equipmentFunding,
    sourceUrl: scheme.sourceUrl,
    verifiedOn: scheme.verifiedOn ?? null,
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

/**
 * Does this scheme put a number in front of the artisan?
 *
 * Rupee amounts, lakh/crore quantities and percentages are all figures someone
 * could act on, so they are what the citation rule applies to.
 */
export function statesAnAmount(scheme: Pick<Scheme, 'benefit' | 'note'>): boolean {
  const text = `${scheme.benefit} ${scheme.note ?? ''}`;
  if (/₹|\b\d+(?:\.\d+)?\s*(lakh|crore)\b/i.test(text)) return true;

  // A percentage counts only when it is a percentage OF MONEY. AHVY requires
  // "at least 50% of members are cluster artisans" — an eligibility ratio, not
  // a figure anyone can bank, and demanding a price citation for it would have
  // withheld a scheme that states no amount at all.
  const MONEY_WORDS = /₹|loan|subsidy|interest|stipend|margin money|lakh|crore|rupee/i;
  for (const match of text.matchAll(/\d\s*%/g)) {
    const at = match.index ?? 0;
    if (MONEY_WORDS.test(text.slice(Math.max(0, at - 40), at + 40))) return true;
  }
  return false;
}

/**
 * A scheme may state an amount only if it carries the page that amount was read
 * from and the date it was checked.
 *
 * This is a guard, not a convention: `evaluateAllSchemes` withholds anything
 * that fails it, so an unverified figure cannot reach a screen even by
 * accident, and `npm run verify:schemes` fails the same case in CI.
 */
export function isSchemeCited(scheme: Scheme): boolean {
  // An explicit null is the author saying "I went to the source and could not
  // confirm this". That scheme is withheld even when it names no figure: the
  // rest of its description came from the same unconfirmed reading.
  if (scheme.verifiedOn === null) return false;
  if (!statesAnAmount(scheme)) return true;
  return Boolean(scheme.sourceUrl) && Boolean(scheme.verifiedOn);
}

/** The schemes an artisan may be shown: everything whose figures are cited. */
export function citedSchemes(): Scheme[] {
  return SCHEMES.filter(isSchemeCited);
}

/**
 * Schemes held back because their source could not be confirmed.
 *
 * Returned so the funding screen can say plainly that something is missing,
 * rather than silently showing a shorter list.
 */
export function withheldSchemes(): Scheme[] {
  return SCHEMES.filter((scheme) => !isSchemeCited(scheme));
}

export function evaluateAllSchemes(ctx: EligibilityContext): EvaluatedScheme[] {
  return citedSchemes().map((scheme) => ({
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
  pmegp: 'pmegp',
  "prime minister's employment generation programme": 'pmegp',
  'prime minister employment generation programme': 'pmegp',
  mudra: 'mudra',
  'mudra loan': 'mudra',
  'pradhan mantri mudra yojana': 'mudra',
  'pm mudra yojana': 'mudra',
  sfurti: 'sfurti',
  'scheme of fund for regeneration of traditional industries': 'sfurti',
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
