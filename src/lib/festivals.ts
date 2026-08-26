/**
 * Festival calendar used by the market-insights engine.
 *
 * Deliberately a constant, not a database model: the dates are public
 * knowledge, they never differ per artisan, and keeping them in code means the
 * insights endpoint can reason about "what is coming up" without a migration.
 *
 * Dates for movable feasts are the commonly published dates for that year and
 * are good enough to drive a demand signal; they are not a panchang.
 */

export interface Festival {
  key: string;
  name: string;
  /** ISO calendar date (YYYY-MM-DD), interpreted in local time. */
  date: string;
  /**
   * Lowercase substrings matched against a craft type. `['*']` means the
   * festival lifts every craft (gifting seasons).
   */
  crafts: string[];
  /** One line on why this festival moves this craft. Feeds the AI prompt and the alert copy. */
  demandNote: string;
}

export const FESTIVALS: Festival[] = [
  {
    key: 'raksha_bandhan_2026',
    name: 'Raksha Bandhan',
    date: '2026-08-28',
    crafts: ['*'],
    demandNote: 'Gifting peak — small handcrafted items and stoles move in volume.',
  },
  {
    key: 'onam_2026',
    name: 'Onam',
    date: '2026-08-26',
    crafts: ['cotton', 'handloom', 'saree', 'kasavu'],
    demandNote: 'Kerala handloom cotton demand spikes across the Onam week.',
  },
  {
    key: 'ganesh_chaturthi_2026',
    name: 'Ganesh Chaturthi',
    date: '2026-09-14',
    crafts: ['terracotta', 'pottery', 'clay', 'filigree', 'brass', 'dhokra'],
    demandNote: 'Idol and decor demand — terracotta and metal crafts sell out early.',
  },
  {
    key: 'durga_puja_2026',
    name: 'Durga Puja',
    date: '2026-10-17',
    crafts: ['saree', 'silk', 'bandha', 'sambalpuri', 'handloom', 'ikat'],
    demandNote: 'Eastern India buys new handloom sarees through Puja week.',
  },
  {
    key: 'dussehra_2026',
    name: 'Dussehra',
    date: '2026-10-20',
    crafts: ['*'],
    demandNote: 'Auspicious buying day — retail and B2B restocking runs ahead of Diwali.',
  },
  {
    key: 'diwali_2026',
    name: 'Diwali',
    date: '2026-11-08',
    crafts: ['*'],
    demandNote: 'The largest gifting and corporate-procurement window of the year.',
  },
  {
    key: 'wedding_season_2026',
    name: 'North Indian Wedding Season',
    date: '2026-11-20',
    crafts: ['silk', 'saree', 'banarasi', 'zari', 'brocade', 'ikat', 'pochampally'],
    demandNote: 'Bridal silk and brocade orders are placed 6–8 weeks in advance.',
  },
  {
    key: 'christmas_2026',
    name: 'Christmas',
    date: '2026-12-25',
    crafts: ['*'],
    demandNote: 'Corporate gifting hampers favour small, packable handcrafted items.',
  },
  {
    key: 'sankranti_2027',
    name: 'Makar Sankranti / Pongal',
    date: '2027-01-14',
    crafts: ['cotton', 'handloom', 'saree', 'pochampally', 'ikat'],
    demandNote: 'South Indian handloom cotton demand peaks in the harvest week.',
  },
  {
    key: 'republic_day_2027',
    name: 'Republic Day Handicraft Fairs',
    date: '2027-01-26',
    crafts: ['*'],
    demandNote: 'State emporium and fair procurement closes its orders in January.',
  },
  {
    key: 'holi_2027',
    name: 'Holi',
    date: '2027-03-22',
    crafts: ['cotton', 'handloom', 'dupatta', 'stole'],
    demandNote: 'Light cotton dupattas and stoles sell through the Holi fortnight.',
  },
];

export interface UpcomingFestival extends Festival {
  /** Whole days from `now` to the festival. Never negative in returned results. */
  daysAway: number;
}

/** Whole days between now and an ISO date. Negative once the date has passed. */
export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** True when the festival lifts this craft (or lifts every craft). */
export function festivalMatchesCraft(festival: Festival, craftType?: string | null): boolean {
  if (festival.crafts.includes('*')) return true;
  const craft = (craftType ?? '').toLowerCase();
  if (!craft) return false;
  return festival.crafts.some((keyword) => craft.includes(keyword));
}

/**
 * Festivals landing inside the next `withinDays`, soonest first.
 * Pass `craftType` to keep only the ones relevant to that craft.
 */
export function upcomingFestivals(opts: {
  withinDays?: number;
  craftType?: string | null;
  now?: Date;
} = {}): UpcomingFestival[] {
  const { withinDays = 45, craftType, now = new Date() } = opts;

  return FESTIVALS.map((f) => ({ ...f, daysAway: daysUntil(f.date, now) }))
    .filter((f) => f.daysAway >= 0 && f.daysAway <= withinDays)
    .filter((f) => (craftType === undefined ? true : festivalMatchesCraft(f, craftType)))
    .sort((a, b) => a.daysAway - b.daysAway);
}

/** The single nearest relevant festival, or null when nothing is close. */
export function nextFestivalForCraft(
  craftType?: string | null,
  withinDays = 45,
  now: Date = new Date()
): UpcomingFestival | null {
  return upcomingFestivals({ withinDays, craftType, now })[0] ?? null;
}
