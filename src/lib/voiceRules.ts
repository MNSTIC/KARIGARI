import { SCHEMES, type SchemeKey } from '@/lib/schemes';

/**
 * Rules-based answers for the voice assistant.
 *
 * The assistant used to have exactly two outcomes: a Gemini answer, or "Sorry,
 * I could not hear that clearly." That second branch fires whenever the model
 * is unreachable — an exhausted per-model quota, a 503, a missing key — none of
 * which the artisan can do anything about, and all of which left the assistant
 * useless rather than merely less clever.
 *
 * Every fact below is read from the same `SCHEMES` catalogue and the same
 * eligibility verdicts the schemes page renders, so a rules answer and the
 * screen can never disagree. Nothing here is invented: if we do not know, the
 * reply says which screen to open instead of guessing.
 */

export type VoiceLanguage = 'en' | 'hi' | 'or' | 'te';

export interface RulesContext {
  transcript: string;
  languageCode: string;
  artisanName: string;
  /** Scheme keys this artisan currently qualifies for. */
  eligibleKeys: Set<string>;
  /** Why each non-eligible scheme is blocked, keyed by scheme key. Phrased in
   *  the second person — these are spoken to the artisan, not about them. */
  blockedReasons: Map<string, string>;
}

/** Words that point at one specific scheme, so "PM Vishwakarma" gets a real answer. */
const SCHEME_HINTS: { key: SchemeKey; words: string[] }[] = [
  { key: 'pm_vishwakarma', words: ['vishwakarma', 'vishwa karma', 'विश्वकर्मा', 'ବିଶ୍ୱକର୍ମା', 'విశ్వకర్మ'] },
  { key: 'nsfdc', words: ['nsfdc', 'scheduled caste', 'sc loan'] },
  { key: 'nbcfdc', words: ['nbcfdc', 'backward class', 'obc loan'] },
  { key: 'gem_seller', words: ['gem', 'government e-marketplace', 'government marketplace'] },
  { key: 'ahvy', words: ['ahvy', 'ambedkar', 'hastshilp', 'toolkit'] },
  { key: 'ondc', words: ['ondc', 'open network'] },
];

const SCHEME_WORDS = [
  'scheme', 'yojana', 'yojna', 'subsidy', 'loan', 'benefit', 'eligible', 'eligibility', 'apply',
  'sarkar', 'sarkari', 'government', 'grant', 'stipend', 'toolkit',
  'योजना', 'सरकार', 'ऋण', 'पात्र',
  'ଯୋଜନା', 'ସରକାର', 'ଋଣ',
  'పథకం', 'ప్రభుత్వ', 'రుణం',
];

const CAPTURE_WORDS = [
  'capture', 'upload', 'photo', 'picture', 'catalog', 'catalogue', 'list my', 'add product',
  'new item', 'register my', 'saree ready', 'record',
  'फोटो', 'अपलोड', 'दर्ज',
  'ଫଟୋ', 'ଅପଲୋଡ',
  'ఫోటో', 'అప్‌లోడ్',
];

const SELL_WORDS = [
  'sell', 'buyer', 'market', 'demand', 'price', 'rate', 'order', 'ondc', 'bulk',
  'बेच', 'खरीदार', 'बाजार', 'दाम', 'कीमत',
  'ବିକ୍ରି', 'କ୍ରେତା', 'ବଜାର', 'ଦାମ',
  'అమ్మ', 'కొనుగోలు', 'మార్కెట్', 'ధర',
];

const MONEY_WORDS = [
  'earning', 'earned', 'payment', 'paid', 'advance', 'money', 'balance', 'payout', 'income',
  'कमाई', 'पैसा', 'भुगतान', 'अग्रिम',
  'ରୋଜଗାର', 'ଟଙ୍କା', 'ଅଗ୍ରିମ',
  'సంపాదన', 'డబ్బు', 'అడ్వాన్స్',
];

/**
 * Reply templates, romanized so browser text-to-speech can read them aloud —
 * Windows and Android ship no Odia or Telugu voice.
 */
const COPY: Record<VoiceLanguage, {
  eligibleIntro: (name: string, count: number) => string;
  noneEligible: string;
  schemeYes: (scheme: string, benefit: string) => string;
  schemeNo: (scheme: string, reason: string) => string;
  applyNote: string;
  capture: string;
  sell: string;
  money: string;
  fallback: string;
}> = {
  en: {
    eligibleIntro: (name, count) => `${name}, you qualify for ${count} scheme${count === 1 ? '' : 's'} right now.`,
    noneEligible: 'No scheme has cleared yet. Open the Schemes page — it names exactly what is missing from your profile.',
    schemeYes: (scheme, benefit) => `You qualify for ${scheme}. It gives ${benefit}.`,
    schemeNo: (scheme, reason) => `You do not qualify for ${scheme} yet — ${reason}.`,
    applyNote: 'Open the Schemes page to apply on the official portal.',
    capture: 'Tap Capture New Craft on your dashboard, then just speak — the AI writes the listing and suggests a fair price.',
    sell: 'Open Market Insights to see which buyers want your craft and at what price, then use the Market page to list it.',
    money: 'Your dashboard shows every advance paid and your total earnings.',
    fallback: 'I can help with schemes, capturing a new craft, prices and buyers. Open the Schemes or Insights page from your dashboard.',
  },
  hi: {
    eligibleIntro: (name, count) => `${name}, abhi aap ${count} yojana ke liye paatra hain.`,
    noneEligible: 'Abhi koi yojana paas nahi hui. Schemes page kholiye — wahan likha hai profile mein kya kami hai.',
    schemeYes: (scheme, benefit) => `Aap ${scheme} ke liye paatra hain. Ismein milta hai: ${benefit}.`,
    schemeNo: (scheme, reason) => `Aap abhi ${scheme} ke liye paatra nahi hain — ${reason}.`,
    applyNote: 'Aavedan ke liye Schemes page kholiye aur sarkari portal par jaaiye.',
    capture: 'Dashboard par Capture New Craft dabaiye aur bas boliye — AI listing likh dega aur uchit daam bataayega.',
    sell: 'Market Insights kholiye — wahan dikhega kaun sa khareedar aapka kaam chahta hai aur kitne daam par.',
    money: 'Aapke dashboard par har agrim bhugtan aur kul kamai dikhti hai.',
    fallback: 'Main yojanaon, nayi craft darj karne, daam aur khareedaron mein madad kar sakti hoon. Dashboard se Schemes ya Insights kholiye.',
  },
  or: {
    eligibleIntro: (name, count) => `${name}, ebe apana ${count} yojana pain yogya atanti.`,
    noneEligible: 'Ebe kounasi yojana paas heini. Schemes page kholantu — sethire lekha achi profile re kana adhura achi.',
    schemeYes: (scheme, benefit) => `Apana ${scheme} pain yogya atanti. Ethire milithae: ${benefit}.`,
    schemeNo: (scheme, reason) => `Apana ebe ${scheme} pain yogya nuhanti — ${reason}.`,
    applyNote: 'Aabedan pain Schemes page kholi sarkari portal ku jaantu.',
    capture: 'Dashboard re Capture New Craft tipantu aau kuhantu — AI listing lekhiba aau uchita dama kahiba.',
    sell: 'Market Insights kholantu — sethire dekhibe kie apananka kama chahunchi aau kete dama re.',
    money: 'Apananka dashboard re pratyeka agrim aau mota rojagar dekhajae.',
    fallback: 'Mu yojana, nua craft darja, dama aau kreta bishayare sahajya kari pare. Dashboard ru Schemes kimba Insights kholantu.',
  },
  te: {
    eligibleIntro: (name, count) => `${name}, ippudu meeru ${count} pathakalaki arhulu.`,
    noneEligible: 'Inka e pathakam kooda pass kaledu. Schemes page teruvandi — akkada mee profile lo em thakkuvo cheputundi.',
    schemeYes: (scheme, benefit) => `Meeru ${scheme} ki arhulu. Indulo vastundi: ${benefit}.`,
    schemeNo: (scheme, reason) => `Meeru inka ${scheme} ki arhulu kaadu — ${reason}.`,
    applyNote: 'Darakhastu ki Schemes page teruvandi, adhikarika portal lo apply cheyandi.',
    capture: 'Dashboard lo Capture New Craft nokkandi, taruvata matladandi — AI listing rasi sarayina dhara cheputundi.',
    sell: 'Market Insights teruvandi — evaru mee vastuvu korukuntunnaro, e dhara ki anedi akkada kanipistundi.',
    money: 'Mee dashboard lo prati advance mariyu motham sampadana kanipistundi.',
    fallback: 'Nenu pathakalu, kotha craft namodu, dharalu mariyu konugoludarula gurinchi sahayam cheyagalanu. Dashboard nunchi Schemes leda Insights teruvandi.',
  },
};

function pickCopy(languageCode: string) {
  return COPY[(languageCode as VoiceLanguage)] ?? COPY.en;
}

function hits(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/** Trim a benefit line to something short enough to be spoken. */
function shortBenefit(benefit: string): string {
  const first = benefit.split('•')[0].trim();
  return first.length > 4 ? first : benefit.trim();
}

/**
 * Build a spoken answer from real data alone. Always returns something useful —
 * this is the branch that replaces "Sorry, I could not hear that clearly."
 */
export function buildRulesReply(ctx: RulesContext): string {
  const { transcript, languageCode, artisanName, eligibleKeys, blockedReasons } = ctx;
  const copy = pickCopy(languageCode);
  const said = transcript.toLowerCase();

  // 1. A named scheme beats every other rule — answer about that one.
  const named = SCHEME_HINTS.find((hint) => hits(said, hint.words));
  if (named) {
    const scheme = SCHEMES.find((s) => s.key === named.key);
    if (scheme) {
      return eligibleKeys.has(scheme.key)
        ? `${copy.schemeYes(scheme.name, shortBenefit(scheme.benefit))} ${copy.applyNote}`
        : copy.schemeNo(scheme.name, blockedReasons.get(scheme.key) || 'criteria not met');
    }
  }

  // 2. Schemes in general — report the live verdict count, then the first one.
  if (hits(said, SCHEME_WORDS)) {
    if (eligibleKeys.size === 0) return copy.noneEligible;
    const first = SCHEMES.find((s) => eligibleKeys.has(s.key));
    const intro = copy.eligibleIntro(artisanName, eligibleKeys.size);
    return first
      ? `${intro} ${copy.schemeYes(first.name, shortBenefit(first.benefit))} ${copy.applyNote}`
      : `${intro} ${copy.applyNote}`;
  }

  if (hits(said, CAPTURE_WORDS)) return copy.capture;
  if (hits(said, SELL_WORDS)) return copy.sell;
  if (hits(said, MONEY_WORDS)) return copy.money;

  return copy.fallback;
}
