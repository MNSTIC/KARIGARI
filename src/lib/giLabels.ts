/**
 * India GI-tagged / protected craft designations.
 *
 * Used by the Step-1 smart-draft assistant to spot the narrow case where the
 * artisan's stated craft name implies a regional / authorised-user claim that
 * their profile location does NOT support (e.g. "Muga silk" declared from
 * outside Assam). Match → gentle, non-blocking `verificationNote` on the
 * smart-draft response. Never blocks the listing; never accuses.
 *
 * Plain data module — no React, Prisma, or other framework imports — so the
 * route can pull it, and a unit test can pull it, without dragging half the
 * app into a bundle.
 *
 * Seeded from well-known Indian GI craft registrations; not exhaustive. Add
 * new entries whenever a cluster reports being mis-flagged or missed.
 */

export interface GiLabel {
  /** Canonical human-readable name shown to the artisan in the note. */
  label: string;
  /** Case-insensitive substrings that identify this designation in free text. */
  aliases: string[];
  /**
   * Region names that legitimately produce this craft. Matched case-insensitively
   * as substrings of the artisan's own recorded location, so "Sivasagar, Assam"
   * still resolves for a Muga entry named "Assam".
   */
  regions: string[];
  /** One short sentence for the note, in the artisan's own frame. */
  note: string;
}

export const GI_LABELS: GiLabel[] = [
  {
    label: 'Muga silk',
    aliases: ['muga silk', 'muga saree', 'muga sari', 'muga'],
    regions: ['assam'],
    note: 'Muga silk is a GI product of Assam.',
  },
  {
    label: 'Sambalpuri Ikat',
    aliases: ['sambalpuri', 'sambalpuri ikat', 'sambalpuri saree'],
    regions: ['odisha', 'sambalpur', 'bargarh', 'sonepur'],
    note: 'Sambalpuri Ikat is a GI product of Odisha.',
  },
  {
    label: 'Pochampally Ikat',
    aliases: ['pochampally', 'pochampalli', 'pochampally ikat'],
    regions: ['telangana', 'pochampally', 'bhoodan pochampally'],
    note: 'Pochampally Ikat is a GI product of Telangana.',
  },
  {
    label: 'Kanjivaram / Kancheepuram silk',
    aliases: ['kanjivaram', 'kanchipuram', 'kancheepuram'],
    regions: ['tamil nadu', 'kancheepuram', 'kanchipuram'],
    note: 'Kanjivaram silk is a GI product of Tamil Nadu.',
  },
  {
    label: 'Banarasi silk',
    aliases: ['banarasi', 'benarasi'],
    regions: ['uttar pradesh', 'varanasi', 'banaras'],
    note: 'Banarasi silk is a GI product of Uttar Pradesh.',
  },
  {
    label: 'Pashmina',
    aliases: ['pashmina'],
    regions: ['kashmir', 'ladakh', 'jammu and kashmir'],
    note: 'Pashmina is a GI product of Kashmir / Ladakh.',
  },
  {
    label: 'Channapatna toys',
    aliases: ['channapatna'],
    regions: ['karnataka', 'channapatna'],
    note: 'Channapatna toys are a GI product of Karnataka.',
  },
  {
    label: 'Kondapalli toys',
    aliases: ['kondapalli'],
    regions: ['andhra pradesh', 'kondapalli'],
    note: 'Kondapalli toys are a GI product of Andhra Pradesh.',
  },
  {
    label: 'Bidriware',
    aliases: ['bidri', 'bidriware'],
    regions: ['karnataka', 'bidar'],
    note: 'Bidriware is a GI product of Karnataka.',
  },
  {
    label: 'Madhubani painting',
    aliases: ['madhubani', 'mithila painting'],
    regions: ['bihar', 'madhubani', 'mithila'],
    note: 'Madhubani is a GI product of Bihar.',
  },
  {
    label: 'Kalamkari',
    aliases: ['kalamkari', 'srikalahasti', 'machilipatnam kalamkari'],
    regions: ['andhra pradesh', 'telangana', 'srikalahasti', 'machilipatnam'],
    note: 'Kalamkari is a GI product of Andhra Pradesh / Telangana.',
  },
  {
    label: 'Chanderi',
    aliases: ['chanderi'],
    regions: ['madhya pradesh', 'chanderi'],
    note: 'Chanderi is a GI product of Madhya Pradesh.',
  },
  {
    label: 'Maheshwari',
    aliases: ['maheshwari'],
    regions: ['madhya pradesh', 'maheshwar'],
    note: 'Maheshwari is a GI product of Madhya Pradesh.',
  },
  {
    label: 'Bagh print',
    aliases: ['bagh print', 'bagh printing'],
    regions: ['madhya pradesh', 'bagh'],
    note: 'Bagh printing is a GI product of Madhya Pradesh.',
  },
  {
    label: 'Pattachitra',
    aliases: ['pattachitra', 'patachitra'],
    regions: ['odisha', 'west bengal', 'raghurajpur', 'puri'],
    note: 'Pattachitra is a GI product of Odisha / West Bengal.',
  },
  {
    label: 'Dhokra',
    aliases: ['dhokra', 'dokra'],
    regions: ['odisha', 'chhattisgarh', 'west bengal', 'jharkhand', 'bastar'],
    note: 'Dhokra is a GI-registered craft of Bastar / eastern India.',
  },
  {
    label: 'Sandalwood carving',
    aliases: ['sandalwood', 'sandal wood', 'chandan carving'],
    regions: [], // CITES-regulated; region alone does not clear the claim.
    note:
      'Sandalwood is CITES-regulated. Keep your source / permit paperwork handy for buyers who ask.',
  },
];

/**
 * First GI entry whose `aliases` matches the free-text craft description.
 * Case-insensitive substring match on the concatenation of craftType + the
 * artisan's own description, so "handloom silk saree in muga" still resolves.
 */
export function findGiLabel(text: string): GiLabel | null {
  const haystack = (text || '').toLowerCase();
  if (!haystack) return null;
  for (const entry of GI_LABELS) {
    for (const alias of entry.aliases) {
      if (haystack.includes(alias)) return entry;
    }
  }
  return null;
}

/**
 * True when `location` sits inside any of the entry's legitimate regions. An
 * empty `regions` list (e.g. sandalwood, which is CITES-regulated regardless
 * of state) never resolves and always returns `false`, so those items always
 * flag a note.
 */
export function locationMatchesGi(entry: GiLabel, location: string | null | undefined): boolean {
  if (!location || entry.regions.length === 0) return false;
  const loc = location.toLowerCase();
  return entry.regions.some((region) => loc.includes(region.toLowerCase()));
}
