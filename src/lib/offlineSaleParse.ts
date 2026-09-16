import {
  MAX_OFFLINE_AMOUNT,
  MAX_OFFLINE_QUANTITY,
  dateKeyToInstant,
  istDateKey,
  istDaysAgoKey,
  normaliseCraftLabel,
  toAsciiDigits,
  type OfflineChannel,
} from '@/lib/offlineSales';

/**
 * A spoken or typed sale, turned into form fields without any model.
 *
 * This is the path that always runs: the fallback when Groq is not configured
 * or fails, and the cross-check when it answers. It understands how a sale is
 * actually said in the four app languages — "pandrah sau", "डेढ़ हज़ार",
 * "ପନ୍ଦର ଶହ ଟଙ୍କା", "పదిహేను వందల రూపాయలు", "₹1,500", "1.5k" — and it
 * would rather return null than guess:
 *
 *   - two different amounts with nothing to tell them apart → no amount;
 *   - a phone number is removed before any number is read, so "98765 43210"
 *     can never become a price;
 *   - a date is read as a date, and a length ("2 metre") or a labour period
 *     ("12 din") is never read as a price or a quantity.
 *
 * The result is a draft. Nothing here ever submits a sale; the artisan sees
 * every field and corrects it first.
 */

export interface ParsedOfflineSale {
  amount: number | null;
  quantity: number | null;
  craftTypeLabel: string | null;
  buyerName: string | null;
  channel: OfflineChannel | null;
  /** `YYYY-MM-DD`, IST. */
  soldAt: string | null;
  /** True when more than one distinct amount was heard and none was chosen. */
  ambiguousAmount: boolean;
}

export interface ParseOptions {
  now?: Date;
  /** The artisan's own labels and catalogue craft types, preferred over the generic nouns. */
  knownLabels?: string[];
}

// ---------------------------------------------------------------------------
// Folding: one spelling per word before anything is looked up
// ---------------------------------------------------------------------------

/**
 * Lower-case, NFC, and the spelling variants speech engines disagree on:
 * the nukta (हज़ार / हजार, ଢ଼ / ଢ), candrabindu vs anusvara (पाँच / पांच), and
 * the zero-width joiners Indic keyboards insert.
 */
function fold(text: string): string {
  return text
    .normalize('NFC')
    .normalize('NFD')
    .replace(/[\u093C\u0B3C\u200C\u200D]/g, '')
    .normalize('NFC')
    .replace(/\u0901/g, '\u0902')
    .toLowerCase();
}

function foldedMap(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries).map(([k, v]) => [fold(k), v]));
}

function foldedSet(words: string[]): Set<string> {
  return new Set(words.map(fold));
}

/** Word → value for 1–99, in romanised Hindi, English, Hindi, Odia and Telugu. */
const UNIT_WORDS = foldedMap({
  // Romanised Hindi. "saath" (60) is left out on purpose: it also means "with".
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, chah: 6,
  saat: 7, aath: 8, nau: 9, das: 10, dus: 10, gyarah: 11, gyaarah: 11, barah: 12, baarah: 12,
  terah: 13, chaudah: 14, chaudha: 14, pandrah: 15, pandra: 15, pandhra: 15, solah: 16,
  sola: 16, satrah: 17, atharah: 18, athara: 18, unnis: 19, unees: 19, bees: 20, pachees: 25,
  pachchees: 25, pacchis: 25, tees: 30, chalis: 40, chaalis: 40, pachas: 50, pachaas: 50,
  sattar: 70, assi: 80, nabbe: 90,
  // English.
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
  // Hindi.
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8, 'नौ': 9,
  'दस': 10, 'ग्यारह': 11, 'बारह': 12, 'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15, 'पन्द्रह': 15,
  'सोलह': 16, 'सत्रह': 17, 'अठारह': 18, 'उन्नीस': 19, 'बीस': 20, 'पच्चीस': 25, 'तीस': 30,
  'चालीस': 40, 'पचास': 50, 'साठ': 60, 'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90,
  // Odia.
  'ଏକ': 1, 'ଦୁଇ': 2, 'ତିନି': 3, 'ଚାରି': 4, 'ପାଞ୍ଚ': 5, 'ଛଅ': 6, 'ସାତ': 7, 'ଆଠ': 8, 'ନଅ': 9,
  'ଦଶ': 10, 'ଏଗାର': 11, 'ବାର': 12, 'ତେର': 13, 'ଚଉଦ': 14, 'ପନ୍ଦର': 15, 'ଷୋହଳ': 16, 'ସତର': 17,
  'ଅଠର': 18, 'ଉଣେଇଶି': 19, 'କୋଡ଼ିଏ': 20, 'ପଚିଶି': 25, 'ତିରିଶି': 30, 'ଚାଳିଶି': 40, 'ପଚାଶ': 50,
  // Telugu.
  'ఒకటి': 1, 'ఒక': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 'అయిదు': 5, 'ఆరు': 6,
  'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10, 'పదకొండు': 11, 'పన్నెండు': 12,
  'పదమూడు': 13, 'పద్నాలుగు': 14, 'పదిహేను': 15, 'పదహారు': 16, 'పదిహేడు': 17,
  'పద్దెనిమిది': 18, 'పందొమ్మిది': 19, 'ఇరవై': 20, 'ముప్పై': 30, 'నలభై': 40, 'యాభై': 50,
});

/** Whole numbers that are already fractional: "dedh" hazaar is 1.5 thousand. */
const FRACTION_WORDS = foldedMap({
  dedh: 1.5, deedh: 1.5, deed: 1.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5,
  'डेढ़': 1.5, 'ढाई': 2.5, 'ଦେଢ଼': 1.5, 'ଅଢ଼େଇ': 2.5, 'ఒకటిన్నర': 1.5, 'రెండున్నర': 2.5,
});

/** Modifiers applied to the next number: "saadhe teen" = 3.5, "sawa do" = 2.25. */
const MODIFIER_WORDS = foldedMap({
  saadhe: 0.5, sadhe: 0.5, saade: 0.5, sawa: 0.25, sava: 0.25, paune: -0.25,
  'साढ़े': 0.5, 'सवा': 0.25, 'पौने': -0.25, 'ସାଢ଼େ': 0.5,
});

/** Exact-match multipliers. */
const MULTIPLIER_WORDS = foldedMap({
  sau: 100, hundred: 100, hundreds: 100,
  hazaar: 1000, hazar: 1000, hajaar: 1000, hajar: 1000, thousand: 1000, thousands: 1000,
  lakh: 100000, lakhs: 100000, lac: 100000, laakh: 100000,
  'सौ': 100, 'हज़ार': 1000, 'लाख': 100000,
});

/**
 * Stem multipliers for the agglutinative scripts, where the word carries a
 * suffix: ହଜାରରେ, వందల, వేలు, లక్షల.
 */
const MULTIPLIER_STEMS: [string, number][] = [
  ['ଶହ', 100],
  ['ହଜାର', 1000],
  ['ଲକ୍ଷ', 100000],
  ['వంద', 100],
  ['వేయి', 1000],
  ['వేల', 1000],
  ['వెయ్య', 1000],
  ['లక్ష', 100000],
].map(([stem, value]) => [fold(stem as string), value as number]);

const CONNECTORS = foldedSet(['aur', 'and', 'और', 'ଓ', 'మరియు']);

const CURRENCY_EXACT = foldedSet([
  '₹', 'rs', 'inr', 'rupee', 'rupees', 'rupaye', 'rupaiye', 'rupaya', 'rupye', 'rupiya', 'rupay',
  'rupiye', 'रु', 'रू', 'రూ',
]);
const CURRENCY_STEMS = ['रुप', 'रूप', 'ଟଙ୍କ', 'రూపాయ'].map(fold);

/** Words that follow a price without naming a currency: "1500 ka dupatta". */
const PRICE_CONTEXT = foldedSet(['ka', 'ki', 'ke', 'mein', 'me', 'main', 'for', 'का', 'की', 'के', 'में']);

const PIECE_WORDS = foldedSet(['pc', 'pcs', 'piece', 'pieces', 'nag', 'nos', 'unit', 'units', 'नग', 'पीस', 'ଟି']);
const PIECE_STEMS = ['ଖଣ୍ଡ', 'ముక్క'].map(fold);

/** A number followed by one of these is a length, a weight or a span of time — never a price. */
const MEASURE_WORDS = foldedSet([
  'm', 'mtr', 'metre', 'metres', 'meter', 'meters', 'cm', 'inch', 'inches', 'ft', 'feet', 'foot',
  'gaj', 'yard', 'yards', 'kg', 'kgs', 'kilo', 'gram', 'grams', 'g', 'gm', 'day', 'days', 'din',
  'hafte', 'week', 'weeks', 'ghante', 'hour', 'hours', 'saal', 'year', 'years', 'baje', 'bje',
  'मीटर', 'गज', 'दिन', 'किलो', 'बजे', 'साल', 'ମିଟର', 'ଦିନ', 'మీటర్', 'గంట',
]);
const MEASURE_STEMS = ['రోజ', 'ଘଣ୍ଟ'].map(fold);

const EACH_WORDS = foldedSet(['each', 'apiece', 'per', 'har', 'pratyek', 'प्रति', 'हर', 'ପ୍ରତି', 'ప్రతి']);

/** Craft nouns → the English label stored on the row. */
const CRAFT_NOUNS: [string, string][] = [
  ['dupatta', 'Dupatta'], ['dupattas', 'Dupatta'], ['dupatte', 'Dupatta'], ['duppatta', 'Dupatta'],
  ['saree', 'Saree'], ['sarees', 'Saree'], ['sari', 'Saree'], ['saris', 'Saree'], ['saari', 'Saree'],
  ['saaree', 'Saree'], ['sadi', 'Saree'], ['stole', 'Stole'], ['stoles', 'Stole'],
  ['shawl', 'Shawl'], ['shawls', 'Shawl'], ['shaal', 'Shawl'], ['basket', 'Basket'],
  ['baskets', 'Basket'], ['tokri', 'Basket'], ['pot', 'Pot'], ['pots', 'Pot'], ['matka', 'Pot'],
  ['bag', 'Bag'], ['bags', 'Bag'], ['kurta', 'Kurta'], ['kurtas', 'Kurta'], ['bedsheet', 'Bedsheet'],
  ['chadar', 'Bedsheet'], ['gamcha', 'Gamcha'], ['towel', 'Towel'], ['mat', 'Mat'], ['chatai', 'Mat'],
  ['painting', 'Painting'], ['paintings', 'Painting'], ['lamp', 'Lamp'], ['diya', 'Lamp'],
  ['दुपट्टा', 'Dupatta'], ['दुपट्टे', 'Dupatta'], ['साड़ी', 'Saree'], ['साड़ियां', 'Saree'],
  ['शॉल', 'Shawl'], ['शाल', 'Shawl'], ['टोकरी', 'Basket'], ['मटका', 'Pot'], ['गमछा', 'Gamcha'],
  ['ଶାଢ଼ୀ', 'Saree'], ['ଓଢ଼ଣୀ', 'Dupatta'], ['ଗାମୁଛା', 'Gamcha'], ['ଟୋକେଇ', 'Basket'],
  ['చీర', 'Saree'], ['దుపట్టా', 'Dupatta'], ['శాలువా', 'Shawl'], ['బుట్ట', 'Basket'],
].map(([word, label]) => [fold(word), label]);

/** Indic craft nouns are matched as stems ("చీరను", "ଶାଢ଼ୀଟି"); Latin ones exactly. */
function craftNounFor(token: string): string | null {
  for (const [word, label] of CRAFT_NOUNS) {
    if (/^[a-z]+$/.test(word) ? token === word : token.startsWith(word)) return label;
  }
  return null;
}

const CHANNEL_WORDS: [OfflineChannel, string[]][] = [
  ['MIDDLEMAN', ['middleman', 'dalal', 'bichauliya', 'bichauliye', 'bichoulia', 'vyapari', 'trader', 'mahajan', 'दलाल', 'बिचौलिया', 'बिचौलिये', 'बिचौलिए', 'व्यापारी', 'ଦଲାଲ', 'ମଧ୍ୟସ୍ଥ', 'దళారి', 'మధ్యవర్తి', 'వ్యాపారి']],
  ['EXHIBITION', ['exhibition', 'expo', 'pradarshani', 'प्रदर्शनी', 'ପ୍ରଦର୍ଶନୀ', 'ప్రదర్శన']],
  ['WALK_IN', ['walk-in', 'walkin', 'ghar', 'घर', 'ଘର', 'ఇంటి']],
  ['HAAT', ['haat', 'hatt', 'bazaar', 'bazar', 'market', 'mandi', 'mela', 'mele', 'हाट', 'बाज़ार', 'मेला', 'मेले', 'मंडी', 'ହାଟ', 'ମେଳା', 'సంత', 'మార్కెట్']],
].map(([channel, words]) => [channel as OfflineChannel, (words as string[]).map(fold)]);

function channelFor(token: string): OfflineChannel | null {
  for (const [channel, words] of CHANNEL_WORDS) {
    for (const word of words) {
      if (/^[a-z-]+$/.test(word) ? token === word : token.startsWith(word)) return channel;
    }
  }
  return null;
}

const TODAY_WORDS = foldedSet(['today', 'aaj', 'आज', 'ଆଜି', 'ఈరోజు', 'నేడు']);
const YESTERDAY_WORDS = foldedSet(['yesterday', 'kal', 'कल', 'ଗତକାଲି', 'କାଲି', 'నిన్న']);
const DAY_BEFORE_WORDS = foldedSet(['parso', 'परसों', 'మొన్న']);

const MONTHS: [string, number][] = [
  ['january', 1], ['jan', 1], ['february', 2], ['feb', 2], ['march', 3], ['mar', 3], ['april', 4],
  ['apr', 4], ['may', 5], ['june', 6], ['jun', 6], ['july', 7], ['jul', 7], ['august', 8], ['aug', 8],
  ['september', 9], ['sept', 9], ['sep', 9], ['october', 10], ['oct', 10], ['november', 11],
  ['nov', 11], ['december', 12], ['dec', 12], ['जनवरी', 1], ['फरवरी', 2], ['मार्च', 3],
  ['अप्रैल', 4], ['मई', 5], ['जून', 6], ['जुलाई', 7], ['अगस्त', 8], ['सितंबर', 9], ['सितम्बर', 9],
  ['अक्टूबर', 10], ['नवंबर', 11], ['नवम्बर', 11], ['दिसंबर', 12], ['दिसम्बर', 12],
].map(([name, n]) => [fold(name as string), n as number]);

/** Words that sit where a buyer's name would and are not one. */
const NOT_A_NAME = foldedSet([
  'the', 'a', 'an', 'customer', 'customers', 'someone', 'somebody', 'grahak', 'buyer', 'middleman',
  'dalal', 'vyapari', 'unko', 'usko', 'inko', 'ek', 'kisi', 'haat', 'market', 'mela', 'bazaar',
  'ग्राहक', 'किसी', 'उन', 'उस', 'इन', 'एक', 'दलाल', 'व्यापारी', 'बिचौलिये', 'हाट', 'मेले',
]);

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'num'; value: number; raw: string }
  | { kind: 'unit'; value: number; raw: string }
  | { kind: 'fraction'; value: number; raw: string }
  | { kind: 'modifier'; value: number; raw: string }
  | { kind: 'mult'; value: number; raw: string }
  | { kind: 'word'; raw: string };

function classify(raw: string): Token {
  if (/^\d+(\.\d+)?$/.test(raw)) return { kind: 'num', value: Number(raw), raw };
  const unit = UNIT_WORDS.get(raw);
  if (unit !== undefined) return { kind: 'unit', value: unit, raw };
  const fraction = FRACTION_WORDS.get(raw);
  if (fraction !== undefined) return { kind: 'fraction', value: fraction, raw };
  const modifier = MODIFIER_WORDS.get(raw);
  if (modifier !== undefined) return { kind: 'modifier', value: modifier, raw };
  const mult = MULTIPLIER_WORDS.get(raw) ?? MULTIPLIER_STEMS.find(([stem]) => raw.startsWith(stem))?.[1];
  if (mult !== undefined) return { kind: 'mult', value: mult, raw };
  return { kind: 'word', raw };
}

const isNumeric = (t: Token | undefined) =>
  !!t && (t.kind === 'num' || t.kind === 'unit' || t.kind === 'fraction' || t.kind === 'modifier' || t.kind === 'mult');

function isCurrency(t: Token | undefined): boolean {
  if (!t) return false;
  return CURRENCY_EXACT.has(t.raw) || CURRENCY_STEMS.some((stem) => t.raw.startsWith(stem));
}

function isPiece(t: Token | undefined): boolean {
  if (!t) return false;
  return PIECE_WORDS.has(t.raw) || PIECE_STEMS.some((stem) => t.raw.startsWith(stem));
}

function isMeasure(t: Token | undefined): boolean {
  if (!t) return false;
  return MEASURE_WORDS.has(t.raw) || MEASURE_STEMS.some((stem) => t.raw.startsWith(stem));
}

interface NumberGroup {
  value: number;
  start: number;
  end: number;
  hasMultiplier: boolean;
}

/**
 * Read one spoken number starting at `start`.
 *
 * Standard Indian composition: `sau` multiplies what is pending ("pandrah sau"
 * = 1500); `hazaar` and `lakh` close it into the total ("do hazaar paanch sau"
 * = 2500). Two bare numbers side by side ("1200 800") are two groups, never
 * one.
 */
function readGroup(tokens: Token[], start: number): NumberGroup {
  let total = 0;
  let current: number | null = null;
  let modifier = 0;
  let hasMultiplier = false;
  let i = start;

  for (; i < tokens.length; i += 1) {
    const t = tokens[i];

    // "ek hazaar aur paanch sau": a connector continues a number only right
    // after a multiplier closed a part of it.
    if (t.kind === 'word' && CONNECTORS.has(t.raw)) {
      if (current === null && total > 0 && isNumeric(tokens[i + 1])) continue;
      break;
    }
    if (t.kind === 'modifier') {
      if (current !== null) break;
      modifier = t.value;
      continue;
    }
    if (t.kind === 'num' || t.kind === 'unit' || t.kind === 'fraction') {
      if (current !== null) {
        // "twenty five" composes; "1200 800" does not.
        const composes = t.kind === 'unit' && t.value < 10 && current >= 20 && current < 100 && current % 10 === 0;
        if (!composes) break;
        current += t.value;
        continue;
      }
      if (total > 0 && t.kind === 'num' && t.value >= 100) break;
      current = t.value + modifier;
      modifier = 0;
      continue;
    }
    if (t.kind === 'mult') {
      const base: number = current ?? 1;
      hasMultiplier = true;
      if (t.value === 100) {
        current = base * 100;
      } else {
        total += base * t.value;
        current = null;
      }
      continue;
    }
    break;
  }

  return { value: total + (current ?? 0), start, end: i - 1, hasMultiplier };
}

// ---------------------------------------------------------------------------
// Phones and dates come out before any number is read
// ---------------------------------------------------------------------------

/** "+91 98765 43210", "9876543210", "98765-43210", and any long digit run. */
const PHONE = /(?:\+?91[\s-]?)?(?<!\d)[6-9]\d{4}[\s-]?\d{5}(?!\d)|\d{10,}/g;

function dayKey(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const instant = dateKeyToInstant(key);
  return Number.isNaN(instant.getTime()) || istDateKey(instant) !== key ? null : key;
}

/** A day without a year is this year's, unless that would be in the future. */
function inferYear(month: number, day: number, now: Date): string | null {
  const year = Number(istDateKey(now).slice(0, 4));
  const key = dayKey(year, month, day);
  if (key && key > istDateKey(now)) return dayKey(year - 1, month, day);
  return key;
}

function extractDate(text: string, now: Date): { text: string; soldAt: string | null } {
  const iso = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(text);
  if (iso) {
    const key = dayKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (key) return { text: text.replace(iso[0], ' '), soldAt: key };
  }

  const full = /(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?!\d)/.exec(text);
  if (full) {
    const year = full[3].length === 2 ? 2000 + Number(full[3]) : Number(full[3]);
    const key = dayKey(year, Number(full[2]), Number(full[1]));
    if (key) return { text: text.replace(full[0], ' '), soldAt: key };
  }

  // Day and month only. The dot is left out here: "1.5" is a number.
  const short = /(?<!\d)(\d{1,2})[/-](\d{1,2})(?![\d/-])/.exec(text);
  if (short) {
    const key = inferYear(Number(short[2]), Number(short[1]), now);
    if (key) return { text: text.replace(short[0], ' '), soldAt: key };
  }

  for (const [name, month] of MONTHS) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s+${escaped}(?![\\p{L}\\p{M}])|${escaped}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)`,
      'u'
    );
    const hit = pattern.exec(text);
    if (hit) {
      const key = inferYear(month, Number(hit[1] ?? hit[2]), now);
      if (key) return { text: text.replace(hit[0], ' '), soldAt: key };
    }
  }

  return { text, soldAt: null };
}

// ---------------------------------------------------------------------------
// Buyer name
// ---------------------------------------------------------------------------

/**
 * Only the unambiguous shapes: "sold to Priya Das", "Ramesh ko", "राधा को".
 * Read from the original text, because capitalisation is the evidence that a
 * romanised word is a name. Odia and Telugu are not attempted: without a
 * reliable marker a guess would put a common noun in the buyer field.
 */
function extractBuyerName(original: string): string | null {
  const candidates: string[] = [];
  const english = /\bto\s+((?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?)/.exec(original);
  if (english) candidates.push(english[1]);
  const hinglish = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:ji\s+)?ko\b/.exec(original);
  if (hinglish) candidates.push(hinglish[1]);
  const hindi = /([\u0900-\u0963\u0971-\u097F]+)\s+(?:\u091C\u0940\s+)?\u0915\u094B(?![\u0900-\u097F])/u.exec(original.normalize('NFC'));
  if (hindi) candidates.push(hindi[1]);

  for (const candidate of candidates) {
    const words = candidate.trim().split(/\s+/);
    const folded = words.map(fold);
    // Only the first word is tested against the number words: "Priya Das" is a
    // name even though "das" is ten.
    if (folded.some((w) => NOT_A_NAME.has(w))) continue;
    if (UNIT_WORDS.has(folded[0]) || MULTIPLIER_WORDS.has(folded[0])) continue;
    if (folded.some((w) => craftNounFor(w) || channelFor(w) || MONTHS.some(([m]) => m === w))) continue;
    return words.join(' ');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Craft label
// ---------------------------------------------------------------------------

function tokensOf(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * The artisan's own label when their words clearly name it, else a generic
 * craft noun. A known label wins only on real overlap: every token of a short
 * label, or at least two tokens of a longer one.
 */
function extractCraftLabel(tokens: string[], knownLabels: string[]): string | null {
  const said = new Set(tokens);
  let best: { label: string; hits: number } | null = null;
  for (const label of knownLabels) {
    const labelTokens = tokensOf(label).filter((t) => t.length >= 3);
    if (labelTokens.length === 0) continue;
    const hits = labelTokens.filter((t) => said.has(t) || tokens.some((w) => w.startsWith(t))).length;
    const enough = labelTokens.length === 1 ? hits === 1 : hits >= 2;
    if (!enough) continue;
    if (!best || hits > best.hits || (hits === best.hits && label.length > best.label.length)) {
      best = { label: label.trim().replace(/\s+/g, ' '), hits };
    }
  }
  if (best) return best.label;
  for (const token of tokens) {
    const noun = craftNounFor(token);
    if (noun) return noun;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseOfflineSaleText(input: string, options: ParseOptions = {}): ParsedOfflineSale {
  const now = options.now ?? new Date();
  const empty: ParsedOfflineSale = {
    amount: null,
    quantity: null,
    craftTypeLabel: null,
    buyerName: null,
    channel: null,
    soldAt: null,
    ambiguousAmount: false,
  };
  if (typeof input !== 'string' || !input.trim()) return empty;

  const original = input.slice(0, 1000);
  let text = toAsciiDigits(original);
  text = text.replace(PHONE, ' ');

  const dated = extractDate(text, now);
  text = dated.text;

  text = fold(text)
    // "1,500" and "1,50,000".
    .replace(/(\d),(?=\d)/g, '$1')
    // "1.5k", "2k".
    .replace(/(\d+(?:\.\d+)?)k(?![\p{L}])/gu, (_m, n: string) => String(Math.round(Number(n) * 1000)))
    // "rs.1500", "rs1500", "1500rs", "1500ଟଙ୍କା": digits and letters become separate words.
    .replace(/₹/g, ' ₹ ')
    .replace(/(\d)(?=[^\d\s.,])/g, '$1 ')
    .replace(/([^\d\s.,])(?=\d)/g, '$1 ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ');

  const words = text.split(/[\s,;:!?()"'“”‘’।|/]+/).filter(Boolean);
  const tokens = words.map(classify);

  // ---- numbers -----------------------------------------------------------
  const groups: NumberGroup[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (!isNumeric(tokens[i])) continue;
    const group = readGroup(tokens, i);
    if (group.end < group.start) continue;
    if (group.value > 0) groups.push(group);
    i = group.end;
  }

  let quantity: number | null = null;
  const strong: number[] = [];
  const weak: number[] = [];

  for (const group of groups) {
    const before = tokens[group.start - 1];
    const after = tokens[group.end + 1];
    if (isMeasure(after)) continue;

    const marked = isCurrency(before) || isCurrency(after);
    const smallWhole = !group.hasMultiplier && Number.isInteger(group.value) && group.value <= MAX_OFFLINE_QUANTITY;
    const namesAPiece = !!after && (isPiece(after) || (after.kind === 'word' && craftNounFor(after.raw) !== null));

    if (!marked && smallWhole && namesAPiece) {
      if (quantity === null) quantity = group.value;
      else if (quantity !== group.value) quantity = null;
      continue;
    }
    if (!Number.isInteger(group.value)) continue;
    if (marked) strong.push(group.value);
    else if (after && PRICE_CONTEXT.has(after.raw)) weak.push(group.value);
    else weak.push(group.value);
  }

  const distinct = (values: number[]) => [...new Set(values)];
  let amount: number | null = null;
  let ambiguousAmount = false;
  const strongValues = distinct(strong);
  const weakValues = distinct(weak);
  if (strongValues.length === 1) amount = strongValues[0];
  else if (strongValues.length > 1) ambiguousAmount = true;
  else if (weakValues.length === 1) amount = weakValues[0];
  else if (weakValues.length > 1) ambiguousAmount = true;

  // "3 dupatte 500 rupaye each" is a ₹1,500 line.
  if (amount !== null && quantity !== null && tokens.some((t) => t.kind === 'word' && EACH_WORDS.has(t.raw))) {
    amount *= quantity;
  }
  if (amount !== null && (amount < 1 || amount > MAX_OFFLINE_AMOUNT)) amount = null;

  // ---- everything else ---------------------------------------------------
  const wordTokens = tokens.filter((t) => t.kind === 'word').map((t) => t.raw);

  let channel: OfflineChannel | null = null;
  for (const word of wordTokens) {
    channel = channelFor(word);
    if (channel) break;
  }
  // "walk-in" split on the hyphen above.
  if (!channel && /walk[\s-]?in/.test(fold(original))) channel = 'WALK_IN';

  let soldAt = dated.soldAt;
  if (!soldAt) {
    if (wordTokens.some((w) => DAY_BEFORE_WORDS.has(w))) soldAt = istDaysAgoKey(2, now);
    else if (wordTokens.some((w) => YESTERDAY_WORDS.has(w))) soldAt = istDaysAgoKey(1, now);
    else if (wordTokens.some((w) => TODAY_WORDS.has(w))) soldAt = istDateKey(now);
  }

  const knownLabels = (options.knownLabels ?? []).filter((l) => normaliseCraftLabel(l).length > 0);

  return {
    amount,
    quantity,
    craftTypeLabel: extractCraftLabel(wordTokens, knownLabels),
    buyerName: extractBuyerName(original),
    channel,
    soldAt,
    ambiguousAmount,
  };
}
