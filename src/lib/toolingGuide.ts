import { familiesForCraft, type MaterialFamily } from '@/lib/craftFamilies';

/**
 * Repair and tooling help for a craft — what usually breaks, what to call it
 * locally, and what to ask before agreeing a price.
 *
 * HONESTY NOTE, and the reason this file exists. There is no verified directory
 * of loom-repair shops, kiln builders or wheel turners in India that this
 * project can reach, and inventing one would put an artisan on a bus to a
 * business that does not exist. So this module names no shop, no person and no
 * phone number, and neither may the AI brief that sits beside it — see
 * `stripContactDetails`, which is a hard server-side guard, not a prompt.
 *
 * What is here instead: the faults a craft's own equipment actually develops,
 * written per material family, and the questions worth asking whoever does the
 * work. Who to call is answered by the artisan's own cluster ("Ask my cluster"),
 * where someone genuinely knows a person.
 *
 * Pure and client-safe: titles and lines are i18n keys, so the guide reads in
 * the artisan's language.
 */

export type ToolingFamily = 'loom-textile' | 'dye-print' | 'metal' | 'clay' | 'wood-lacquer' | 'paint-surface' | 'general';

export interface ToolingEntry {
  /** `tooling_<family>_<slug>` is the key stem for this entry's strings. */
  family: ToolingFamily;
  slug: string;
}

/** Which tooling family a craft's materials put it in. */
const FAMILY_BY_MATERIAL: Partial<Record<MaterialFamily, ToolingFamily>> = {
  'silk-yarn': 'loom-textile',
  'cotton-yarn': 'loom-textile',
  'pashmina-wool': 'loom-textile',
  'mirror-thread': 'loom-textile',
  'natural-dye': 'dye-print',
  'brass-bell-metal': 'metal',
  'silver-inlay': 'metal',
  'clay-quartz-glaze': 'clay',
  'lac-wood': 'wood-lacquer',
  'stone-pigment': 'paint-surface',
  'palm-leaf-paper': 'paint-surface',
};

export function toolingFamilyFor(craftType: string | null | undefined): ToolingFamily {
  for (const material of familiesForCraft(craftType ?? '')) {
    const family = FAMILY_BY_MATERIAL[material];
    if (family) return family;
  }
  return 'general';
}

/**
 * The curated guide. Every entry is a real, ordinary failure of the equipment
 * that craft uses, and the general set applies to any workshop.
 */
export const TOOLING_GUIDE: readonly ToolingEntry[] = [
  { family: 'loom-textile', slug: 'reed_damage' },
  { family: 'loom-textile', slug: 'heddle_wear' },
  { family: 'loom-textile', slug: 'shuttle_bobbin' },
  { family: 'loom-textile', slug: 'frame_alignment' },

  { family: 'dye-print', slug: 'vat_leak' },
  { family: 'dye-print', slug: 'block_cracks' },
  { family: 'dye-print', slug: 'water_hardness' },

  { family: 'metal', slug: 'furnace_lining' },
  { family: 'metal', slug: 'anvil_chisel' },
  { family: 'metal', slug: 'polish_buffer' },

  { family: 'clay', slug: 'wheel_bearing' },
  { family: 'clay', slug: 'kiln_cracks' },
  { family: 'clay', slug: 'pugmill_blades' },

  { family: 'wood-lacquer', slug: 'lathe_belt' },
  { family: 'wood-lacquer', slug: 'chisel_edge' },
  { family: 'wood-lacquer', slug: 'lac_stick_storage' },

  { family: 'paint-surface', slug: 'brush_care' },
  { family: 'paint-surface', slug: 'surface_prep' },
  { family: 'paint-surface', slug: 'pigment_grinding' },

  { family: 'general', slug: 'power_supply' },
  { family: 'general', slug: 'storage_damp' },
  { family: 'general', slug: 'hand_tools' },
];

export function toolingKeys(entry: ToolingEntry) {
  // Hyphens in a family name would break the i18n key convention, which is
  // all lower-case words joined by underscores.
  const base = `tooling_${entry.family.replace(/-/g, "_")}_${entry.slug}`;
  return { partKey: base, symptomKey: `${base}_symptom`, askKey: `${base}_ask` };
}

/** The curated entries for a craft: its own family first, then the general set. */
export function curatedToolingFor(craftType: string | null | undefined): ToolingEntry[] {
  const family = toolingFamilyFor(craftType);
  return [
    ...TOOLING_GUIDE.filter((entry) => entry.family === family),
    ...TOOLING_GUIDE.filter((entry) => entry.family === 'general'),
  ];
}

/* -------------------------------------------------------------------------- */
/*  The hard guard on AI output                                                */
/* -------------------------------------------------------------------------- */

/**
 * Remove anything that looks like a way to contact a business.
 *
 * The prompt forbids shop names, numbers and addresses, but a prompt is a
 * request and this is a rule: a model that answers "call Ravi at 9876543210"
 * must not be able to put that in front of an artisan, because Karigari has not
 * checked that anybody of that name exists.
 *
 * Removed: any run of 6+ digits (allowing spaces and hyphens, so 98765 43210
 * goes too), anything with an @, and any URL or bare domain.
 */
export function stripContactDetails(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\b/g, ' ')
    .replace(/\S*@\S*/g, ' ')
    .replace(/\b[\w-]+\.(?:com|in|org|net|co|gov|info|shop|store)\b\S*/gi, ' ')
    .replace(/(?:\+?\d[\d\s-]{4,}\d)/g, (match) => (match.replace(/\D/g, '').length >= 6 ? ' ' : match))
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Plain, single-line, contact-free text of at most `max` characters. */
export function cleanBriefText(value: unknown, max: number): string {
  const stripped = stripContactDetails(value)
    .split('')
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return !(code < 0x20 || (code >= 0x7f && code < 0xa0));
    })
    .join('');
  return Array.from(stripped.replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();
}

export const MAX_BRIEF_FIELD = 140;
export const MAX_BRIEF_ITEMS = 6;

export interface ToolingFault {
  part: string;
  symptom: string;
  whoFixesIt: string;
}

export interface ToolingCostBand {
  low: number;
  high: number;
  /** What the band is based on. Without one there is no band. */
  note: string;
}

export interface ToolingBrief {
  commonFaults: ToolingFault[];
  localTerms: string[];
  questionsToAsk: string[];
  /** Null unless the model named a basis for the range. Always labelled as an estimate. */
  typicalCostBand: ToolingCostBand | null;
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Validate a model's brief.
 *
 * A fault with no part or no symptom is dropped; a cost band without a stated
 * basis, or with a reversed or absurd range, becomes null rather than a number
 * an artisan might quote to a repairer.
 */
export function normaliseToolingBrief(raw: unknown): ToolingBrief {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const faults = (Array.isArray(record.commonFaults) ? record.commonFaults : [])
    .map((row) => {
      const fault = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
      return {
        part: cleanBriefText(fault.part, MAX_BRIEF_FIELD),
        symptom: cleanBriefText(fault.symptom, MAX_BRIEF_FIELD),
        whoFixesIt: cleanBriefText(fault.whoFixesIt, MAX_BRIEF_FIELD),
      };
    })
    .filter((fault) => fault.part && fault.symptom)
    .slice(0, MAX_BRIEF_ITEMS);

  const list = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .map((item) => cleanBriefText(item, MAX_BRIEF_FIELD))
      .filter(Boolean)
      .slice(0, MAX_BRIEF_ITEMS);

  const band = (record.typicalCostBand && typeof record.typicalCostBand === 'object'
    ? record.typicalCostBand
    : {}) as Record<string, unknown>;
  const low = numberOrNull(band.low);
  const high = numberOrNull(band.high);
  const note = cleanBriefText(band.note, MAX_BRIEF_FIELD);
  const typicalCostBand = low !== null && high !== null && high >= low && note ? { low, high, note } : null;

  return { commonFaults: faults, localTerms: list(record.localTerms), questionsToAsk: list(record.questionsToAsk), typicalCostBand };
}

/** True when the model gave enough to be worth showing at all. */
export function briefIsUsable(brief: ToolingBrief): boolean {
  return brief.commonFaults.length > 0 || brief.questionsToAsk.length > 0;
}
