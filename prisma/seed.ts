/**
 * KARIGARI demo seed.
 *
 * DESTRUCTIVE: wipes every table in FK-safe order and rebuilds the whole demo
 * from scratch. Run only against a database you are willing to lose.
 *
 *     npm run seed
 *
 * The goal here is data that stands up to being clicked through. Every item
 * carries a real photograph of its actual craft (sourced by
 * `scripts/build-seed-images.ts`), self-consistent economics derived from the
 * same `estimateCraftValuation` the live capture flow uses, an audit chain that
 * matches the status it is in, and — where the item has passed the physical
 * patch gate — a verification photo with a genuinely decodable QR encoding that
 * item's own patch id.
 *
 * Items are spread across the whole lifecycle on purpose, so the facilitator
 * queue, nodal analytics, the marketplace, the passport and the earnings
 * tracker are all populated at once rather than one screen looking alive and
 * the rest empty.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { estimateCraftValuation, getPricingDiscrepancy } from '../src/lib/pricing';
import { buildSeedImages, buildVerifiedImage } from '../scripts/build-seed-images';

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const BASE_URL = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
/** Minutes after a base time, for ordering an audit chain within one day. */
const plusMinutes = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60 * 1000);

/** Same shape the admin approval route mints. */
function makePatchId(seed: number): string {
  const stamp = (Date.now() + seed * 7919).toString(36).toUpperCase();
  return `PATCH-${stamp}-${String(1000 + ((seed * 3571) % 9000))}`;
}

const round = (n: number) => Math.round(n);

/* -------------------------------------------------------------------------- */
/*  Artisans                                                                   */
/* -------------------------------------------------------------------------- */

interface ArtisanSeed {
  key: string;
  name: string;
  email: string;
  craftType: string;
  craftSlug: string;
  location: string;
  clusterName: string;
  mobileNumber: string;
  upiId: string;
  bankAccountNumber: string;
  aadhaarLast4: string;
  experienceYears: number;
  cooperativeId: string;
  description: string;
  tags: string[];
  socialCategory: string;
  gender: string;
  annualIncome: number;
  healthScore: number;
  giTagCertified: boolean;
  giTagName: string | null;
  /** Language the artisan actually speaks, used for descriptionOriginal. */
  language: 'Odia' | 'Hindi' | 'Telugu' | 'Gujarati' | 'English';
}

const ARTISANS: ArtisanSeed[] = [
  {
    key: 'lakshmi',
    name: 'Lakshmi Devi Meher',
    email: 'lakshmi@karigari.com',
    craftType: 'Sambalpuri Ikat Silk Saree',
    craftSlug: 'sambalpuri',
    location: 'Bargarh, Odisha',
    clusterName: 'Bargarh Handloom Weavers Cooperative',
    mobileNumber: '9438201157',
    upiId: 'yugankrout@oksbi',
    bankAccountNumber: 'XXXXXXXX4471',
    aadhaarLast4: '4471',
    experienceYears: 22,
    cooperativeId: 'COOP-OD-BGH-014',
    description:
      'I have been tying and dyeing Sambalpuri ikat since I was fourteen, the way my mother taught me. Every saree takes me three weeks on the pit loom.',
    tags: ['Ikat', 'Silk', 'Handloom', 'GI Tag', 'SHG Member'],
    socialCategory: 'ST',
    gender: 'FEMALE',
    annualIncome: 246000,
    healthScore: 96,
    giTagCertified: true,
    giTagName: 'Sambalpuri Ikat',
    language: 'Odia',
  },
  {
    key: 'raghunath',
    name: 'Raghunath Maharana',
    email: 'raghunath@karigari.com',
    craftType: 'Pattachitra Painting',
    craftSlug: 'pattachitra',
    location: 'Raghurajpur, Odisha',
    clusterName: 'Raghurajpur Heritage Crafts Village',
    mobileNumber: '9337114820',
    upiId: 'yugankrout@oksbi',
    bankAccountNumber: 'XXXXXXXX8802',
    aadhaarLast4: '8802',
    experienceYears: 31,
    cooperativeId: 'COOP-OD-PUR-007',
    description:
      'Third-generation chitrakar. I grind my own stone colours and paint on tussar-cloth canvas prepared with tamarind seed paste.',
    tags: ['Pattachitra', 'Natural Pigment', 'Folk Art', 'GI Tag', 'Master Craftsman'],
    socialCategory: 'OBC',
    gender: 'MALE',
    annualIncome: 388000,
    healthScore: 92,
    giTagCertified: true,
    giTagName: 'Odisha Pattachitra',
    language: 'Odia',
  },
  {
    key: 'anitha',
    name: 'Anitha Reddy',
    email: 'anitha@karigari.com',
    craftType: 'Pochampally Ikat',
    craftSlug: 'pochampally',
    location: 'Bhoodan Pochampally, Telangana',
    clusterName: 'Pochampally Weavers Cooperative Society',
    mobileNumber: '9848337265',
    upiId: 'yugankrout@oksbi',
    bankAccountNumber: 'XXXXXXXX1936',
    aadhaarLast4: '1936',
    experienceYears: 14,
    cooperativeId: 'COOP-TS-PCH-021',
    description:
      'I run a women-led weaving unit with eleven members. We specialise in double-ikat silk with the traditional telia rumal motifs.',
    tags: ['Ikat', 'Double Ikat', 'Silk', 'GI Tag', 'Women Led'],
    socialCategory: 'GEN',
    gender: 'FEMALE',
    annualIncome: 612000,
    healthScore: 88,
    giTagCertified: true,
    giTagName: 'Pochampally Ikat',
    language: 'Telugu',
  },
  {
    key: 'imran',
    name: 'Imran Khokhar',
    email: 'imran@karigari.com',
    craftType: 'Jaipur Blue Pottery',
    craftSlug: 'blue-pottery',
    location: 'Jaipur, Rajasthan',
    clusterName: 'Sanganer Blue Pottery Kiln Cluster',
    mobileNumber: '9784562013',
    upiId: 'yugankrout@oksbi',
    bankAccountNumber: 'XXXXXXXX6650',
    aadhaarLast4: '6650',
    experienceYears: 18,
    cooperativeId: 'COOP-RJ-JPR-033',
    description:
      'We make blue pottery the old way — quartz powder, fuller earth and gum, no clay at all. Each piece is fired once at low heat.',
    tags: ['Blue Pottery', 'Quartz', 'Glazed', 'MSME Registered'],
    socialCategory: 'OBC',
    gender: 'MALE',
    annualIncome: 455000,
    healthScore: 81,
    giTagCertified: false,
    giTagName: null,
    language: 'Hindi',
  },
  {
    key: 'budhram',
    name: 'Budhram Vishwakarma',
    email: 'budhram@karigari.com',
    craftType: 'Dhokra Brass Figurine',
    craftSlug: 'dhokra',
    location: 'Kondagaon, Chhattisgarh',
    clusterName: 'Bastar Dhokra Shilp Samiti',
    mobileNumber: '9424109738',
    upiId: 'yugankrout@oksbi',
    bankAccountNumber: 'XXXXXXXX2287',
    aadhaarLast4: '2287',
    experienceYears: 26,
    cooperativeId: 'COOP-CG-KGN-005',
    description:
      'I cast in the lost-wax method my community has used for generations. Each figure is one solid pour — the mould is broken to free it, so no two are alike.',
    tags: ['Dhokra', 'Lost Wax', 'Brass', 'GI Tag', 'Tribal Craft'],
    socialCategory: 'ST',
    gender: 'MALE',
    annualIncome: 198000,
    healthScore: 74,
    giTagCertified: true,
    giTagName: 'Bastar Dhokra',
    language: 'Hindi',
  },
  {
    key: 'jethiben',
    name: 'Jethiben Rabari',
    email: 'jethiben@karigari.com',
    craftType: 'Kutch Mirror Embroidery',
    craftSlug: 'kutch-embroidery',
    location: 'Bhuj, Kutch, Gujarat',
    clusterName: 'Bhuj Rabari Embroidery Mahila Mandal',
    mobileNumber: '9825471306',
    upiId: 'yugankrout@oksbi',
    bankAccountNumber: 'XXXXXXXX9014',
    aadhaarLast4: '9014',
    experienceYears: 29,
    cooperativeId: 'COOP-GJ-BHJ-018',
    description:
      'Rabari abhla-bharat work — mirror and chain stitch. I stitch by daylight only; the mirrors have to catch the sun to be set straight.',
    tags: ['Embroidery', 'Mirror Work', 'Abhla Bharat', 'GI Tag', 'Women Artisan'],
    socialCategory: 'SC',
    gender: 'FEMALE',
    annualIncome: 173000,
    healthScore: 79,
    giTagCertified: true,
    giTagName: 'Kutch Embroidery',
    language: 'Gujarati',
  },
  {
    key: 'sunaina',
    name: 'Sunaina Devi Jha',
    email: 'sunaina@karigari.com',
    craftType: 'Madhubani Painting',
    craftSlug: 'madhubani',
    location: 'Jitwarpur, Madhubani, Bihar',
    clusterName: 'Jitwarpur Mithila Chitrakala Samiti',
    mobileNumber: '9430762851',
    upiId: 'yugankrout@oksbi',
    bankAccountNumber: 'XXXXXXXX3128',
    aadhaarLast4: '3128',
    experienceYears: 24,
    cooperativeId: 'COOP-BR-MDB-042',
    description:
      'I paint in the kachni line style my grandmother used — bamboo nib, no pencil underneath. The colours are all from home: kajal, geru, palash flower, indigo.',
    tags: ['Madhubani', 'Mithila', 'Natural Colour', 'GI Tag', 'Women Artisan'],
    socialCategory: 'GEN',
    gender: 'FEMALE',
    annualIncome: 214000,
    healthScore: 90,
    giTagCertified: true,
    giTagName: 'Madhubani Painting',
    language: 'Hindi',
  },
  {
    key: 'shaukat',
    name: 'Shaukat Ali Qadri',
    email: 'shaukat@karigari.com',
    craftType: 'Bidriware Silver Inlay',
    craftSlug: 'bidriware',
    location: 'Bidar, Karnataka',
    clusterName: 'Bidar Bidriware Artisans Cooperative',
    mobileNumber: '9448270356',
    upiId: 'yugankrout@oksbi',
    bankAccountNumber: 'XXXXXXXX7743',
    aadhaarLast4: '7743',
    experienceYears: 33,
    cooperativeId: 'COOP-KA-BDR-011',
    description:
      'Bidri is zinc and copper, sixteen to one. The black comes from the soil of the old Bidar fort — nothing else blackens the metal the same way, and the silver stays bright against it.',
    tags: ['Bidriware', 'Silver Inlay', 'Metalcraft', 'GI Tag', 'Master Craftsman'],
    socialCategory: 'OBC',
    gender: 'MALE',
    annualIncome: 402000,
    healthScore: 86,
    giTagCertified: true,
    giTagName: 'Bidriware',
    language: 'Hindi',
  },
  {
    key: 'girija',
    name: 'Girija Bai Achar',
    email: 'girija@karigari.com',
    craftType: 'Channapatna Lacquered Toys',
    craftSlug: 'channapatna',
    location: 'Channapatna, Karnataka',
    clusterName: 'Channapatna Toy Cluster Mahila Sangha',
    mobileNumber: '9480613427',
    upiId: 'yugankrout@oksbi',
    bankAccountNumber: 'XXXXXXXX5590',
    aadhaarLast4: '5590',
    experienceYears: 17,
    cooperativeId: 'COOP-KA-CPT-027',
    description:
      'We turn aale mara on the lathe and colour it with lac while it spins — the heat of the friction is what melts the stick. The dyes are vegetable, because these go straight into a baby’s mouth.',
    tags: ['Channapatna', 'Lacquerware', 'Wooden Toys', 'GI Tag', 'Child Safe'],
    socialCategory: 'OBC',
    gender: 'FEMALE',
    annualIncome: 189000,
    healthScore: 83,
    giTagCertified: true,
    giTagName: 'Channapatna Toys',
    language: 'English',
  },
  {
    key: 'ghulam',
    name: 'Ghulam Nabi Wani',
    email: 'ghulam@karigari.com',
    craftType: 'Kashmiri Pashmina Shawl',
    craftSlug: 'pashmina',
    location: 'Kanihama, Srinagar, Jammu & Kashmir',
    clusterName: 'Kanihama Kani Weavers Guild',
    mobileNumber: '9419026873',
    upiId: 'yugankrout@oksbi',
    bankAccountNumber: 'XXXXXXXX2461',
    aadhaarLast4: '2461',
    experienceYears: 38,
    cooperativeId: 'COOP-JK-SGR-003',
    description:
      'The pashm comes down from Changthang and my wife spins it on the yinder. A kani shawl is woven from a coded talim — I read the pattern aloud and move the wooden needles one weft at a time.',
    tags: ['Pashmina', 'Kani Weave', 'Handspun', 'GI Tag', 'Master Craftsman'],
    socialCategory: 'GEN',
    gender: 'MALE',
    annualIncome: 528000,
    healthScore: 88,
    giTagCertified: true,
    giTagName: 'Kashmir Pashmina',
    language: 'Hindi',
  },
];

/* -------------------------------------------------------------------------- */
/*  Items                                                                      */
/* -------------------------------------------------------------------------- */

type Stage =
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'SELLABLE'
  | 'LISTED'
  | 'SOLD';

interface ItemSeed {
  title: string;
  descriptionEnglish: string;
  descriptionOriginal: string;
  aiGeneratedListing: string;
  aiSuggestedCategory: string;
  tags: string[];
  laborDays: number;
  rawMaterialCost: number;
  stage: Stage;
  catalogMethod: 'VOICE' | 'MANUAL' | 'IVR';
  createdDaysAgo: number;
  /** Index into the craft's image set, so an artisan's items differ visually. */
  imageIndex: number;
  /** Optional second photo for the gallery. */
  secondImageIndex?: number;
  /**
   * Deliberately break the price away from the AI estimate.
   *
   * The asking price normally lands just inside the upper half of the AI market
   * band, which means every seeded row is priced sensibly and the facilitator's
   * anti-exploitation queue seeds up empty. A multiplier here is applied to the
   * fair wage floor instead: below `FAIR_WAGE_TOLERANCE` (0.7) the row is an
   * underpricing flag, and far above the market band it is an over-pricing one.
   * The verdict itself is not hand-written — `getPricingDiscrepancy` computes it
   * from the same numbers the live app would, so the seeded flags are the real
   * rule firing rather than a decoration.
   */
  priceMultiplier?: number;
}

/** Per-artisan catalogue. Five items each, covering every lifecycle stage. */
const ITEMS: Record<string, ItemSeed[]> = {
  lakshmi: [
    {
      title: 'Sambalpuri Ikat Silk Saree — Bandha Phula',
      descriptionEnglish:
        'Handwoven double-ikat silk saree in deep maroon with the traditional bandha phula (tied flower) motif and a contrast temple border.',
      descriptionOriginal: 'ଗାଢ଼ ମରୁନ ରଙ୍ଗର ବନ୍ଧା ଫୁଲ ନକ୍ସାର ସମ୍ବଲପୁରୀ ପଟ ଶାଢ଼ୀ।',
      aiGeneratedListing:
        'A deep maroon Sambalpuri ikat silk saree, its bandha phula motif tied and dyed thread by thread before a single pick is woven. Twenty-one days on a pit loom in Bargarh, finished with a contrast temple border.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Sambalpuri', 'Ikat', 'Silk', 'Maroon'],
      laborDays: 21,
      rawMaterialCost: 6800,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 52,
      imageIndex: 0,
      secondImageIndex: 1,
    },
    {
      title: 'Sambalpuri Cotton Saree — Pasapali Check',
      descriptionEnglish:
        'Handwoven cotton saree in the pasapali chessboard pattern, black and off-white, with a fine ikat border.',
      descriptionOriginal: 'କଳା ଓ ଧଳା ପାଶାପାଲି ନକ୍ସାର ସୂତା ଶାଢ଼ୀ।',
      aiGeneratedListing:
        'The pasapali chessboard in black and off-white cotton — a Bargarh classic. Light enough for daily wear, with a fine ikat border tied on the same loom.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Sambalpuri', 'Cotton', 'Pasapali'],
      laborDays: 12,
      rawMaterialCost: 2400,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 34,
      imageIndex: 1,
    },
    {
      title: 'Sambalpuri Silk Dupatta — Indigo',
      descriptionEnglish:
        'Indigo-dyed silk dupatta with a repeating conch motif, tied and dyed in natural indigo before weaving.',
      descriptionOriginal: 'ନୀଳ ରଙ୍ଗର ଶଙ୍ଖ ନକ୍ସା ଥିବା ପଟ ଓଢ଼ଣା।',
      aiGeneratedListing:
        'An indigo silk dupatta carrying the conch motif, dyed in natural indigo before the warp went on the loom. Light, and the colour deepens with washing.',
      aiSuggestedCategory: 'Dupattas & Stoles',
      tags: ['Sambalpuri', 'Silk', 'Indigo', 'Natural Dye'],
      laborDays: 8,
      rawMaterialCost: 2100,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 18,
      imageIndex: 2,
    },
    {
      title: 'Sambalpuri Ikat Silk Saree — Saptapar',
      descriptionEnglish:
        'Seven-colour ikat silk saree, the saptapar palette, with a wide pallu carrying a fish and lotus motif.',
      descriptionOriginal: 'ସାତ ରଙ୍ଗର ସପ୍ତପାର ପଟ ଶାଢ଼ୀ, ମାଛ ଓ ପଦ୍ମ ନକ୍ସା।',
      aiGeneratedListing:
        'Seven colours tied into one warp — the saptapar palette, with a wide pallu of fish and lotus. Twenty-six days of work, and the motif lines up on both faces.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Sambalpuri', 'Ikat', 'Silk', 'Saptapar'],
      laborDays: 26,
      rawMaterialCost: 8200,
      stage: 'VERIFIED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 9,
      imageIndex: 0,
    },
    {
      title: 'Sambalpuri Cotton Stole — Bichitrapuri',
      descriptionEnglish:
        'Cotton stole in the bichitrapuri weave, rust and cream, finished with hand-twisted tassels.',
      descriptionOriginal: 'ବିଚିତ୍ରପୁରୀ ବୁଣା ସୂତା ଷ୍ଟୋଲ।',
      aiGeneratedListing:
        'A bichitrapuri cotton stole in rust and cream, tassels twisted by hand at both ends.',
      aiSuggestedCategory: 'Dupattas & Stoles',
      tags: ['Sambalpuri', 'Cotton', 'Bichitrapuri'],
      laborDays: 5,
      rawMaterialCost: 900,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'IVR',
      createdDaysAgo: 3,
      imageIndex: 1,
    },
    {
      title: 'Sambalpuri Ikat Silk Saree — Sachipar Border',
      descriptionEnglish:
        'Bottle-green ikat silk saree with the sachipar leaf border, 5.5m with an unstitched 0.8m blouse piece.',
      descriptionOriginal: 'ସବୁଜ ରଙ୍ଗର ସଚିପାର ପାଢ଼ି ଥିବା ପଟ ଶାଢ଼ୀ।',
      aiGeneratedListing:
        'Bottle green with the sachipar leaf running the length of both borders. 5.5 metres with an unstitched blouse piece, and the leaf repeat lines up where the pallu joins.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Sambalpuri', 'Ikat', 'Silk', 'Sachipar'],
      laborDays: 23,
      rawMaterialCost: 7400,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 44,
      imageIndex: 3,
      secondImageIndex: 4,
    },
    {
      title: 'Sambalpuri Cotton Bedcover — Double',
      descriptionEnglish:
        'Handwoven double bedcover, 90 x 108 inches, in rust and natural cotton with a fish-motif ikat band across the centre.',
      descriptionOriginal: 'ମାଛ ନକ୍ସାର ସୂତା ବେଡ଼କଭର, ଡବଲ ସାଇଜ।',
      aiGeneratedListing:
        'A 90 by 108 inch double bedcover in rust and undyed cotton, with a fish-motif ikat band tied across the centre panel. Woven in two loom widths and joined by hand.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Sambalpuri', 'Cotton', 'Bedcover'],
      laborDays: 16,
      rawMaterialCost: 3200,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 12,
      imageIndex: 4,
    },
    {
      title: 'Sambalpuri Ikat Silk Saree — Nabakothi',
      descriptionEnglish:
        'Nabakothi ikat silk saree carrying nine traditional motifs across the body, in madder red with a black pallu.',
      descriptionOriginal: 'ନଅଟି ପାରମ୍ପରିକ ନକ୍ସା ଥିବା ନବକୋଠି ପଟ ଶାଢ଼ୀ।',
      aiGeneratedListing:
        'Nine motifs in nine compartments — the nabakothi grid — tied into a madder-red body and closed with a black pallu. Twenty-four days on the loom.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Sambalpuri', 'Ikat', 'Silk', 'Nabakothi'],
      laborDays: 24,
      rawMaterialCost: 7900,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 118,
      imageIndex: 2,
      secondImageIndex: 5,
    },
    {
      title: 'Sambalpuri Cotton Saree — Dolabedi Border',
      descriptionEnglish:
        'Cotton ikat saree in mustard with the dolabedi temple-swing border, woven for daily wear.',
      descriptionOriginal: 'ଦୋଳବେଦୀ ପାଢ଼ି ଥିବା ହଳଦିଆ ସୂତା ଶାଢ଼ୀ।',
      aiGeneratedListing:
        'Mustard cotton with the dolabedi border running both edges. Light on the shoulder and it softens with every wash.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Sambalpuri', 'Cotton', 'Dolabedi'],
      laborDays: 11,
      rawMaterialCost: 2200,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 86,
      imageIndex: 3,
    },
    {
      title: 'Sambalpuri Ikat Silk Dupatta — Rudraksha Motif',
      descriptionEnglish:
        'Silk dupatta tied with the rudraksha bead motif, sold well under its own fair wage floor.',
      descriptionOriginal: 'ରୁଦ୍ରାକ୍ଷ ନକ୍ସାର ପଟ ଓଢ଼ଣା।',
      aiGeneratedListing:
        'The rudraksha bead repeated the length of a silk dupatta, tied and dyed before weaving. Eleven days of work.',
      aiSuggestedCategory: 'Dupattas & Stoles',
      tags: ['Sambalpuri', 'Silk', 'Rudraksha', 'Dupatta'],
      laborDays: 11,
      rawMaterialCost: 3100,
      stage: 'LISTED',
      catalogMethod: 'IVR',
      createdDaysAgo: 21,
      imageIndex: 5,
      // Deliberately underpriced: a trader talked her down to roughly half the
      // fair wage floor, which is exactly the squeeze the queue exists to catch.
      priceMultiplier: 0.52,
    },
  ],

  raghunath: [
    {
      title: 'Pattachitra — Krishna Leela on Tussar',
      descriptionEnglish:
        'Traditional Pattachitra of the Krishna Leela painted with stone and shell pigments on tamarind-treated tussar cloth.',
      descriptionOriginal: 'ତୁସର କପଡ଼ା ଉପରେ ପଥର ରଙ୍ଗରେ ଅଙ୍କିତ କୃଷ୍ଣ ଲୀଳା ପଟଚିତ୍ର।',
      aiGeneratedListing:
        'Krishna Leela in the Raghurajpur idiom — hingula red, haritala yellow and lamp-black, all ground by hand, on tussar cloth stiffened with tamarind seed paste. Thirty-four days of work.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Pattachitra', 'Krishna', 'Natural Pigment', 'Tussar'],
      laborDays: 34,
      rawMaterialCost: 4200,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 47,
      imageIndex: 0,
      secondImageIndex: 2,
    },
    {
      title: 'Pattachitra — Jagannath Trinity',
      descriptionEnglish:
        'The Jagannath, Balabhadra and Subhadra trinity in the classical Pattachitra border, painted on palm-leaf-backed canvas.',
      descriptionOriginal: 'ଜଗନ୍ନାଥ, ବଳଭଦ୍ର ଓ ସୁଭଦ୍ରାଙ୍କ ପଟଚିତ୍ର।',
      aiGeneratedListing:
        'The trinity of Puri, painted in the classical Pattachitra border with a fine white outline drawn in a single unbroken stroke.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Pattachitra', 'Jagannath', 'Folk Art'],
      laborDays: 19,
      rawMaterialCost: 2600,
      stage: 'LISTED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 29,
      imageIndex: 1,
    },
    {
      title: 'Palm Leaf Etching — Gita Govinda Panel',
      descriptionEnglish:
        'Talapatra palm-leaf etching of a Gita Govinda verse, incised with an iron stylus and rubbed with lamp-black.',
      descriptionOriginal: 'ତାଳପତ୍ର ଉପରେ ଗୀତଗୋବିନ୍ଦର ଖୋଦେଇ।',
      aiGeneratedListing:
        'A Gita Govinda verse cut into dried palm leaf with an iron stylus, then rubbed with lamp-black so the lines come up. The panel folds like a concertina.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Palm Leaf', 'Talapatra', 'Etching'],
      laborDays: 15,
      rawMaterialCost: 1400,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 21,
      imageIndex: 2,
    },
    {
      title: 'Pattachitra — Dasavatara Scroll',
      descriptionEnglish:
        'A long-form Dasavatara scroll showing all ten avatars in sequence, painted in the traditional register format.',
      descriptionOriginal: 'ଦଶାବତାର ପଟଚିତ୍ର ଗୁଣ୍ଡିଆ।',
      aiGeneratedListing:
        'Ten avatars in ten registers, read top to bottom the way a chitrakar would recite them.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Pattachitra', 'Dasavatara', 'Scroll'],
      laborDays: 41,
      rawMaterialCost: 5100,
      stage: 'VERIFIED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 11,
      imageIndex: 0,
    },
    {
      title: 'Pattachitra Coaster Set — Elephant Motif',
      descriptionEnglish:
        'Set of four coated palm-leaf coasters, each hand-painted with the Pattachitra elephant motif.',
      descriptionOriginal: 'ହାତୀ ନକ୍ସାର ଚାରିଟି ପଟଚିତ୍ର କୋଷ୍ଟର।',
      aiGeneratedListing: 'Four coasters, each with the Pattachitra elephant painted by hand and sealed.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Pattachitra', 'Coasters', 'Gift'],
      laborDays: 4,
      rawMaterialCost: 700,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'IVR',
      createdDaysAgo: 2,
      imageIndex: 1,
    },
    {
      title: 'Pattachitra — Tree of Life on Silk',
      descriptionEnglish:
        'Tree of Life composition painted on silk, 18 x 24 inches, with birds and creepers filling the canopy in stone colours.',
      descriptionOriginal: 'ରେଶମ ଉପରେ ଅଙ୍କିତ ଜୀବନ ବୃକ୍ଷ ପଟଚିତ୍ର।',
      aiGeneratedListing:
        'The Tree of Life on silk, 18 by 24 inches. Birds and creepers fill the canopy so no ground is left bare — the chitrakar convention that a painted surface should never rest.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Pattachitra', 'Tree of Life', 'Silk', 'Stone Colour'],
      laborDays: 27,
      rawMaterialCost: 3800,
      stage: 'LISTED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 36,
      imageIndex: 3,
      secondImageIndex: 4,
    },
    {
      title: 'Pattachitra Ganjapa Playing Cards',
      descriptionEnglish:
        'Hand-painted round ganjapa cards, a set of 96 in eight suits, lacquered on both faces and boxed.',
      descriptionOriginal: 'ହାତରେ ଅଙ୍କିତ ଗଞ୍ଜପା ତାସ, ୯୬ଟି।',
      aiGeneratedListing:
        'Ninety-six round ganjapa cards in eight suits, each painted by hand and lacquered on both faces. The game predates the rectangular deck in Odisha by centuries.',
      aiSuggestedCategory: 'Folk Games & Curios',
      tags: ['Pattachitra', 'Ganjapa', 'Hand Painted'],
      laborDays: 22,
      rawMaterialCost: 2400,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 14,
      imageIndex: 4,
    },
    {
      title: 'Pattachitra — Kanchi Abhijan Panel',
      descriptionEnglish:
        'The Kanchi Abhijan legend painted across a horizontal panel in stone colours on tussar-backed canvas.',
      descriptionOriginal: 'କାଞ୍ଚି ଅଭିଯାନ ପଟଚିତ୍ର ପ୍ୟାନେଲ।',
      aiGeneratedListing:
        'Jagannath and Balabhadra riding to Kanchi, read left to right across one long panel. Thirty days, and the horses are drawn in a single unbroken line each.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Pattachitra', 'Kanchi Abhijan', 'Stone Colour'],
      laborDays: 30,
      rawMaterialCost: 4600,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 132,
      imageIndex: 2,
      secondImageIndex: 5,
    },
    {
      title: 'Palm Leaf Etching — Ramayana Fold Book',
      descriptionEnglish:
        'A twenty-leaf talapatra fold book of Ramayana scenes, incised with an iron stylus and inked with lamp-black.',
      descriptionOriginal: 'ରାମାୟଣର ତାଳପତ୍ର ପୋଥି, କୋଡ଼ିଏ ପତ୍ର।',
      aiGeneratedListing:
        'Twenty cured palm leaves, bound at one edge so the book opens like a concertina. Every line is cut, not drawn.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Palm Leaf', 'Talapatra', 'Ramayana'],
      laborDays: 26,
      rawMaterialCost: 2100,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 74,
      imageIndex: 3,
    },
    {
      title: 'Pattachitra — Gaja Uddharana on Tussar',
      descriptionEnglish:
        'The elephant-rescue episode painted on tussar cloth, 14 x 20 inches, bordered with the classical creeper.',
      descriptionOriginal: 'ତୁସର ଉପରେ ଗଜ ଉଦ୍ଧାରଣ ପଟଚିତ୍ର।',
      aiGeneratedListing:
        'Gaja Uddharana on tussar, 14 by 20 inches, inside the creeper border every Raghurajpur chitrakar draws last.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Pattachitra', 'Tussar', 'Natural Pigment'],
      laborDays: 17,
      rawMaterialCost: 2300,
      stage: 'SELLABLE',
      catalogMethod: 'VOICE',
      createdDaysAgo: 16,
      imageIndex: 5,
    },
  ],

  anitha: [
    {
      title: 'Pochampally Double Ikat Silk Saree — Telia Rumal',
      descriptionEnglish:
        'Double-ikat silk saree in the telia rumal geometry, both warp and weft tied and dyed before weaving.',
      descriptionOriginal: 'తెలియా రుమాల్ డిజైన్‌లో డబుల్ ఇకత్ పట్టు చీర.',
      aiGeneratedListing:
        'True double ikat — warp and weft both tied before a single pick is thrown, so the telia rumal geometry resolves only as the cloth grows. Twenty-eight days.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Pochampally', 'Double Ikat', 'Silk', 'Telia Rumal'],
      laborDays: 28,
      rawMaterialCost: 9400,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 41,
      imageIndex: 0,
      secondImageIndex: 1,
    },
    {
      title: 'Pochampally Ikat Silk Saree — Chowka Border',
      descriptionEnglish:
        'Silk ikat saree in teal with a chowka square border and a contrasting mustard pallu.',
      descriptionOriginal: 'చౌకా బార్డర్‌తో టీల్ రంగు ఇకత్ పట్టు చీర.',
      aiGeneratedListing:
        'Teal ikat silk with the chowka square border, finished with a mustard pallu that lifts the whole drape.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Pochampally', 'Ikat', 'Silk', 'Teal'],
      laborDays: 17,
      rawMaterialCost: 5600,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 26,
      imageIndex: 1,
    },
    {
      title: 'Pochampally Ikat Cotton Yardage — 5m',
      descriptionEnglish:
        'Five metres of ikat cotton yardage in indigo and white, suitable for shirting or light furnishing.',
      descriptionOriginal: 'ఐదు మీటర్ల ఇండిగో ఇకత్ కాటన్ వస్త్రం.',
      aiGeneratedListing:
        'Five metres of indigo-and-white ikat cotton, woven as continuous yardage — cuts well for shirting or a light curtain.',
      aiSuggestedCategory: 'Fabric & Yardage',
      tags: ['Pochampally', 'Ikat', 'Cotton', 'Yardage'],
      laborDays: 9,
      rawMaterialCost: 2200,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 15,
      imageIndex: 2,
    },
    {
      title: 'Pochampally Ikat Silk Dupatta — Rust',
      descriptionEnglish: 'Rust silk ikat dupatta with a fine diamond repeat and a plain selvedge.',
      descriptionOriginal: 'తుప్పు రంగు ఇకత్ పట్టు దుపట్టా.',
      aiGeneratedListing: 'A rust silk dupatta with a fine diamond repeat, plain selvedge, no border.',
      aiSuggestedCategory: 'Dupattas & Stoles',
      tags: ['Pochampally', 'Ikat', 'Silk', 'Dupatta'],
      laborDays: 7,
      rawMaterialCost: 2800,
      stage: 'VERIFIED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 7,
      imageIndex: 0,
    },
    {
      title: 'Pochampally Ikat Cushion Cover Pair',
      descriptionEnglish: 'Pair of ikat cotton cushion covers, 16 inch, with concealed zip.',
      descriptionOriginal: 'రెండు ఇకత్ కాటన్ కుషన్ కవర్లు.',
      aiGeneratedListing: 'A pair of 16-inch ikat cotton cushion covers, concealed zip, woven from loom-end yardage.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Pochampally', 'Ikat', 'Cushion'],
      laborDays: 3,
      rawMaterialCost: 750,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 4,
      imageIndex: 2,
    },
    {
      title: 'Pochampally Ikat Silk Saree — Elephant Pallu',
      descriptionEnglish:
        'Ochre double-ikat silk saree with a procession of elephants tied into the pallu and a plain body.',
      descriptionOriginal: 'ఏనుగుల పల్లూతో ఓక్రా రంగు డబుల్ ఇకత్ చీర.',
      aiGeneratedListing:
        'A plain ochre body so the pallu carries the whole story — a procession of elephants, tied into both warp and weft before weaving. Twenty-four days.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Pochampally', 'Double Ikat', 'Silk', 'Elephant'],
      laborDays: 24,
      rawMaterialCost: 8100,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 33,
      imageIndex: 3,
      secondImageIndex: 4,
    },
    {
      title: 'Pochampally Ikat Table Runner — 6ft',
      descriptionEnglish:
        'Six-foot cotton table runner in charcoal and cream ikat with mitred corners and a hand-rolled hem.',
      descriptionOriginal: 'ఆరు అడుగుల ఇకత్ కాటన్ టేబుల్ రన్నర్.',
      aiGeneratedListing:
        'Six feet of charcoal-and-cream ikat cotton, mitred at the corners and hemmed by hand. Sits across a long table without bunching.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Pochampally', 'Ikat', 'Cotton', 'Table Runner'],
      laborDays: 5,
      rawMaterialCost: 1400,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 10,
      imageIndex: 4,
    },
    {
      title: 'Pochampally Double Ikat Silk Saree — Padma Border',
      descriptionEnglish:
        'Double-ikat silk saree in deep plum with a lotus border, both warp and weft tied before weaving.',
      descriptionOriginal: 'పద్మ బార్డర్‌తో ప్లమ్ రంగు డబుల్ ఇకత్ పట్టు చీర.',
      aiGeneratedListing:
        'Plum double ikat with a lotus running the border. Twenty-six days, and the lotus resolves only when the two tied sets meet on the loom.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Pochampally', 'Double Ikat', 'Silk', 'Lotus'],
      laborDays: 26,
      rawMaterialCost: 8800,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 141,
      imageIndex: 3,
      secondImageIndex: 4,
    },
    {
      title: 'Pochampally Ikat Silk Saree — Grey Chevron',
      descriptionEnglish:
        'Silk ikat saree in slate grey with a chevron repeat and a wine-red pallu.',
      descriptionOriginal: 'బూడిద రంగు చెవ్రాన్ ఇకత్ పట్టు చీర.',
      aiGeneratedListing:
        'Slate grey with a chevron repeat, closed by a wine-red pallu. Eighteen days on the loom.',
      aiSuggestedCategory: 'Handloom Sarees',
      tags: ['Pochampally', 'Ikat', 'Silk', 'Grey'],
      laborDays: 18,
      rawMaterialCost: 5900,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 97,
      imageIndex: 5,
    },
    {
      title: 'Pochampally Telia Rumal Silk Stole',
      descriptionEnglish:
        'Telia rumal stole in oil-treated silk, listed far above the AI market band by the unit.',
      descriptionOriginal: 'నూనె పట్టిన తెలియా రుమాల్ పట్టు స్టోల్.',
      aiGeneratedListing:
        'The telia rumal treatment on a stole — the yarn is oil-cured for weeks before it is tied, which is why the black stays black.',
      aiSuggestedCategory: 'Dupattas & Stoles',
      tags: ['Pochampally', 'Telia Rumal', 'Silk', 'Stole'],
      laborDays: 9,
      rawMaterialCost: 3200,
      stage: 'LISTED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 13,
      imageIndex: 4,
      // Deliberately over the band: the unit priced this at nearly three times
      // its own fair wage floor, well past the market ceiling.
      priceMultiplier: 2.9,
    },
  ],

  imran: [
    {
      title: 'Blue Pottery Vase — Persian Floral, 10 inch',
      descriptionEnglish:
        'Quartz-body blue pottery vase with cobalt Persian floral work under a clear glaze, fired once at low heat.',
      descriptionOriginal: 'फ़ारसी फूलों की नक़्क़ाशी वाला दस इंच का ब्लू पॉटरी फूलदान।',
      aiGeneratedListing:
        'No clay at all — quartz powder, fuller earth and gum, shaped in a mould and painted in cobalt oxide before a single low firing. The Persian floral runs unbroken around the body.',
      aiSuggestedCategory: 'Pottery & Ceramics',
      tags: ['Blue Pottery', 'Quartz', 'Cobalt', 'Vase'],
      laborDays: 11,
      rawMaterialCost: 1900,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 38,
      imageIndex: 0,
      secondImageIndex: 1,
    },
    {
      title: 'Blue Pottery Serving Bowl Set of 4',
      descriptionEnglish:
        'Four glazed quartz-body bowls in turquoise with white floral sprigs, food-safe glaze.',
      descriptionOriginal: 'फ़िरोज़ी रंग के चार ब्लू पॉटरी कटोरे।',
      aiGeneratedListing:
        'Four turquoise bowls with white floral sprigs, glazed food-safe. Quartz body, so they ring when tapped.',
      aiSuggestedCategory: 'Pottery & Ceramics',
      tags: ['Blue Pottery', 'Bowls', 'Turquoise'],
      laborDays: 8,
      rawMaterialCost: 1500,
      stage: 'LISTED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 24,
      imageIndex: 1,
    },
    {
      title: 'Blue Pottery Door Knob Set of 6',
      descriptionEnglish: 'Six hand-painted quartz door knobs with brass fittings, mixed floral patterns.',
      descriptionOriginal: 'छह हाथ से बने ब्लू पॉटरी दरवाज़े के हैंडल।',
      aiGeneratedListing: 'Six hand-painted knobs, brass fittings included, no two patterns the same.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Blue Pottery', 'Knobs', 'Brass'],
      laborDays: 5,
      rawMaterialCost: 1100,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 13,
      imageIndex: 2,
    },
    {
      title: 'Blue Pottery Wall Plate — 12 inch',
      descriptionEnglish: 'Twelve-inch decorative wall plate with a cobalt medallion and scalloped rim.',
      descriptionOriginal: 'बारह इंच की सजावटी ब्लू पॉटरी दीवार प्लेट।',
      aiGeneratedListing: 'A twelve-inch wall plate, cobalt medallion at the centre, scalloped rim.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Blue Pottery', 'Wall Plate'],
      laborDays: 6,
      rawMaterialCost: 1250,
      stage: 'VERIFIED',
      catalogMethod: 'IVR',
      createdDaysAgo: 8,
      imageIndex: 0,
    },
    {
      title: 'Blue Pottery Soap Dish',
      descriptionEnglish: 'Small glazed soap dish with drainage ridges, turquoise on white.',
      descriptionOriginal: 'फ़िरोज़ी रंग की छोटी साबुनदानी।',
      aiGeneratedListing: 'A small turquoise soap dish with drainage ridges cut into the base.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Blue Pottery', 'Bath'],
      laborDays: 2,
      rawMaterialCost: 400,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'IVR',
      createdDaysAgo: 1,
      imageIndex: 1,
    },
    {
      title: 'Blue Pottery Planter — 8 inch, Pierced Rim',
      descriptionEnglish:
        'Eight-inch quartz-body planter with a pierced rim and drainage hole, cobalt vine on a white ground.',
      descriptionOriginal: 'आठ इंच का जालीदार किनारे वाला ब्लू पॉटरी गमला।',
      aiGeneratedListing:
        'An eight-inch planter with the rim pierced by hand before firing, cobalt vine on white, drainage hole cut at the base. The quartz body will not hold damp the way terracotta does.',
      aiSuggestedCategory: 'Pottery & Ceramics',
      tags: ['Blue Pottery', 'Planter', 'Cobalt'],
      laborDays: 9,
      rawMaterialCost: 1700,
      stage: 'LISTED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 30,
      imageIndex: 3,
      secondImageIndex: 4,
    },
    {
      title: 'Blue Pottery Tile Set — 4 x 4 inch, Set of 9',
      descriptionEnglish:
        'Nine hand-painted 4-inch tiles that assemble into one continuous floral panel, glazed and ready to set.',
      descriptionOriginal: 'नौ हाथ से चित्रित चार इंच की ब्लू पॉटरी टाइलें।',
      aiGeneratedListing:
        'Nine four-inch tiles painted as one continuous floral panel, so the vine carries across the grout lines when they are set together.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Blue Pottery', 'Tiles', 'Floral'],
      laborDays: 7,
      rawMaterialCost: 1350,
      stage: 'SELLABLE',
      catalogMethod: 'IVR',
      createdDaysAgo: 11,
      imageIndex: 4,
    },
    {
      title: 'Blue Pottery Dinner Plate Set — Six',
      descriptionEnglish:
        'Set of six quartz-body dinner plates glazed in cobalt with a running iris motif.',
      descriptionOriginal: 'छह नीली मीनाकारी थालियों का सेट, कोबाल्ट ग्लेज़ में।',
      aiGeneratedListing:
        'Six plates in the quartz body — no clay at all — glazed cobalt with an iris running the rim. Fired once, at low heat.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Blue Pottery', 'Quartz', 'Tableware'],
      laborDays: 14,
      rawMaterialCost: 3400,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 109,
      imageIndex: 3,
      secondImageIndex: 5,
    },
    {
      title: 'Blue Pottery Surahi — Cobalt & White',
      descriptionEnglish:
        'A long-necked surahi in cobalt and white with a hand-drawn floral band around the shoulder.',
      descriptionOriginal: 'लंबी गर्दन वाली सुराही, कोबाल्ट और सफ़ेद में।',
      aiGeneratedListing:
        'A surahi with the neck thrown long, banded at the shoulder with a floral drawn freehand before the glaze went on.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Blue Pottery', 'Surahi', 'Glazed'],
      laborDays: 8,
      rawMaterialCost: 1500,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 63,
      imageIndex: 4,
    },
    {
      title: 'Blue Pottery Door Knob Set — Twelve',
      descriptionEnglish:
        'Twelve glazed door knobs in mixed cobalt, turquoise and white patterns, brass-threaded.',
      descriptionOriginal: 'बारह नीली मीनाकारी दरवाज़े के हैंडल, पीतल की चूड़ी सहित।',
      aiGeneratedListing:
        'Twelve knobs, no two patterns alike, threaded onto brass so they fit a standard cabinet.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Blue Pottery', 'Knobs', 'Hardware'],
      laborDays: 6,
      rawMaterialCost: 1200,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'IVR',
      createdDaysAgo: 4,
      imageIndex: 5,
    },
  ],

  budhram: [
    {
      title: 'Dhokra Brass Nandi — 9 inch',
      descriptionEnglish:
        'Lost-wax cast brass Nandi with the characteristic Dhokra thread-work surface, single solid pour.',
      descriptionOriginal: 'ढोकरा विधि से बना नौ इंच का पीतल का नंदी।',
      aiGeneratedListing:
        'Wax thread wound by hand over a clay core, packed in mud, and the metal poured in one go. The mould is broken to free the figure, so this Nandi is the only one of its kind.',
      aiSuggestedCategory: 'Metal Craft',
      tags: ['Dhokra', 'Brass', 'Lost Wax', 'Nandi'],
      laborDays: 16,
      rawMaterialCost: 3400,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 44,
      imageIndex: 0,
      secondImageIndex: 2,
    },
    {
      title: 'Dhokra Tribal Musician Figurine',
      descriptionEnglish:
        'Standing tribal musician with a dhol, cast in brass by the lost-wax method, natural patina.',
      descriptionOriginal: 'ढोल बजाते आदिवासी की ढोकरा पीतल मूर्ति।',
      aiGeneratedListing:
        'A standing musician with his dhol, cast in brass and left with its natural patina rather than polished.',
      aiSuggestedCategory: 'Metal Craft',
      tags: ['Dhokra', 'Brass', 'Figurine', 'Tribal'],
      laborDays: 12,
      rawMaterialCost: 2600,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 31,
      imageIndex: 1,
    },
    {
      title: 'Dhokra Brass Elephant — 6 inch',
      descriptionEnglish: 'Six-inch brass elephant with howdah, lost-wax cast, thread-work texture throughout.',
      descriptionOriginal: 'छह इंच का ढोकरा पीतल हाथी।',
      aiGeneratedListing: 'A six-inch elephant with howdah, the wax threads still legible across the whole surface.',
      aiSuggestedCategory: 'Metal Craft',
      tags: ['Dhokra', 'Brass', 'Elephant'],
      laborDays: 9,
      rawMaterialCost: 2100,
      stage: 'SELLABLE',
      catalogMethod: 'IVR',
      createdDaysAgo: 17,
      imageIndex: 2,
    },
    {
      title: 'Dhokra Measuring Bowl (Paili)',
      descriptionEnglish:
        'Traditional paili grain-measure bowl in cast brass, a Bastar household form.',
      descriptionOriginal: 'बस्तर की पारंपरिक पैली नापने वाली पीतल कटोरी।',
      aiGeneratedListing: 'The paili grain measure, cast in brass — a working household form, not an ornament.',
      aiSuggestedCategory: 'Metal Craft',
      tags: ['Dhokra', 'Brass', 'Paili'],
      laborDays: 7,
      rawMaterialCost: 1800,
      stage: 'VERIFIED',
      catalogMethod: 'IVR',
      createdDaysAgo: 6,
      imageIndex: 0,
    },
    {
      title: 'Dhokra Wall Hook Pair',
      descriptionEnglish: 'Pair of cast brass wall hooks with peacock heads, mounting screws included.',
      descriptionOriginal: 'मोर के सिर वाले दो पीतल के हुक।',
      aiGeneratedListing: 'Two cast brass hooks with peacock heads, screws included.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Dhokra', 'Brass', 'Hooks'],
      laborDays: 3,
      rawMaterialCost: 900,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'VOICE',
      createdDaysAgo: 5,
      imageIndex: 1,
    },
    {
      title: 'Dhokra Brass Tribal Horse — 11 inch',
      descriptionEnglish:
        'Eleven-inch standing horse in cast brass, lost-wax method, with the characteristic wound-thread surface intact.',
      descriptionOriginal: 'ग्यारह इंच का ढोकरा पीतल घोड़ा।',
      aiGeneratedListing:
        'An eleven-inch horse, wax thread wound over the clay core so the whole surface reads as fine coiled line. One pour, one mould, broken to free it.',
      aiSuggestedCategory: 'Metal Craft',
      tags: ['Dhokra', 'Brass', 'Horse', 'Lost Wax'],
      laborDays: 18,
      rawMaterialCost: 3900,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 37,
      imageIndex: 3,
      secondImageIndex: 4,
    },
    {
      title: 'Dhokra Brass Oil Lamp (Diya) — Set of 3',
      descriptionEnglish:
        'Three graduated cast-brass diyas on tripod feet, the tallest 5 inches, each with a thread-work stem.',
      descriptionOriginal: 'तीन ढोकरा पीतल दीये, अलग-अलग ऊँचाई।',
      aiGeneratedListing:
        'Three diyas in graduated heights, the tallest five inches, each on tripod feet with the wax-thread texture running up the stem.',
      aiSuggestedCategory: 'Metal Craft',
      tags: ['Dhokra', 'Brass', 'Diya', 'Festival'],
      laborDays: 8,
      rawMaterialCost: 2000,
      stage: 'SELLABLE',
      catalogMethod: 'IVR',
      createdDaysAgo: 9,
      imageIndex: 4,
    },
    {
      title: 'Dhokra Nandi — Solid Cast',
      descriptionEnglish:
        'A seated Nandi cast solid in brass by the lost-wax method, the wax threads still legible on the flank.',
      descriptionOriginal: 'खोई मोम विधि से ढाला हुआ ठोस पीतल का नंदी।',
      aiGeneratedListing:
        'A seated Nandi, poured solid. The wax threads that formed the surface are still readable along the flank — the mould was broken to free it, so there is no second one.',
      aiSuggestedCategory: 'Sculpture & Figurines',
      tags: ['Dhokra', 'Lost Wax', 'Brass', 'Nandi'],
      laborDays: 15,
      rawMaterialCost: 3900,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 124,
      imageIndex: 3,
      secondImageIndex: 5,
    },
    {
      title: 'Dhokra Tribal Musicians — Set of Three',
      descriptionEnglish:
        'Three standing figures with dhol, flute and cymbals, each cast separately in the lost-wax method.',
      descriptionOriginal: 'ढोल, बाँसुरी और मंजीरे के साथ तीन आदिवासी वादक।',
      aiGeneratedListing:
        'Dhol, flute and cymbals — three pours, three broken moulds, and the three stand together at the same height.',
      aiSuggestedCategory: 'Sculpture & Figurines',
      tags: ['Dhokra', 'Tribal', 'Musicians', 'Brass'],
      laborDays: 21,
      rawMaterialCost: 5200,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 78,
      imageIndex: 4,
    },
    {
      title: 'Dhokra Wall Hanging — Tree of Life',
      descriptionEnglish:
        'A cast brass tree of life for the wall, sold to a middleman at well under its own fair wage floor.',
      descriptionOriginal: 'दीवार के लिए ढाला हुआ पीतल का जीवन-वृक्ष।',
      aiGeneratedListing:
        'A tree of life poured flat for the wall, birds on every branch. Eighteen days of wax work before a drop of metal was melted.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Dhokra', 'Tree of Life', 'Brass', 'Wall Art'],
      laborDays: 18,
      rawMaterialCost: 4400,
      stage: 'SOLD',
      catalogMethod: 'IVR',
      createdDaysAgo: 33,
      imageIndex: 5,
      // Deliberately underpriced: an agent bought the whole lot at well under
      // the floor, and the settled sale is what raises the flag.
      priceMultiplier: 0.58,
    },
  ],

  jethiben: [
    {
      title: 'Kutch Mirror Work Wall Hanging — Chakla',
      descriptionEnglish:
        'Square chakla wall hanging in Rabari abhla-bharat, hand-set mirrors on indigo cotton with chain and herringbone stitch.',
      descriptionOriginal: 'રાબારી આભલા ભરતકામનું ચોરસ ચાકળા દીવાલ સુશોભન.',
      aiGeneratedListing:
        'A square chakla worked in Rabari abhla-bharat — every mirror set by hand with a ring of chain stitch, on indigo cotton. Twenty-three days of daylight work.',
      aiSuggestedCategory: 'Textile Art',
      tags: ['Kutch', 'Mirror Work', 'Embroidery', 'Chakla'],
      laborDays: 23,
      rawMaterialCost: 3100,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 49,
      imageIndex: 0,
      secondImageIndex: 1,
    },
    {
      title: 'Kutch Embroidered Cotton Blouse Piece',
      descriptionEnglish:
        'Blouse-length cotton panel with mirror and chain stitch along the yoke and sleeves.',
      descriptionOriginal: 'આભલા અને સાંકળી ટાંકાવાળું બ્લાઉઝ કાપડ.',
      aiGeneratedListing:
        'A blouse-length panel with mirror and chain stitch across the yoke and both sleeves, ready to cut and tailor.',
      aiSuggestedCategory: 'Fabric & Yardage',
      tags: ['Kutch', 'Mirror Work', 'Cotton'],
      laborDays: 10,
      rawMaterialCost: 1600,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 27,
      imageIndex: 1,
    },
    {
      title: 'Kutch Embroidered Toran Door Hanging',
      descriptionEnglish:
        'Traditional toran door hanging with five pendant flaps, mirror work and cowrie shell edging.',
      descriptionOriginal: 'પાંચ પટ્ટીવાળું આભલા ભરતકામનું તોરણ.',
      aiGeneratedListing:
        'A five-flap toran for a doorway, mirrors through the body and cowrie shells along the lower edge.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Kutch', 'Toran', 'Mirror Work', 'Cowrie'],
      laborDays: 14,
      rawMaterialCost: 2000,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 19,
      imageIndex: 2,
    },
    {
      title: 'Kutch Mirror Work Cushion Cover',
      descriptionEnglish: 'Sixteen-inch cushion cover with a central mirror rosette on black cotton.',
      descriptionOriginal: 'કાળા કાપડ પર આભલાનું કુશન કવર.',
      aiGeneratedListing: 'A sixteen-inch cover with a mirror rosette at the centre, worked on black cotton.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Kutch', 'Cushion', 'Mirror Work'],
      laborDays: 6,
      rawMaterialCost: 850,
      stage: 'VERIFIED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 10,
      imageIndex: 0,
    },
    {
      title: 'Kutch Embroidered Potli Bag',
      descriptionEnglish: 'Drawstring potli bag in maroon cotton with mirror and interlacing stitch.',
      descriptionOriginal: 'મરૂન કાપડની આભલાવાળી પોટલી થેલી.',
      aiGeneratedListing: 'A drawstring potli in maroon cotton, mirrors set into an interlacing stitch.',
      aiSuggestedCategory: 'Bags & Accessories',
      tags: ['Kutch', 'Potli', 'Mirror Work'],
      laborDays: 4,
      rawMaterialCost: 600,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'IVR',
      createdDaysAgo: 2,
      imageIndex: 2,
    },
    {
      title: 'Kutch Mirror Work Bridal Odhani',
      descriptionEnglish:
        'Full bridal odhani in madder-red cotton, 2.5m, with dense abhla-bharat across the ends and a mirrored centre medallion.',
      descriptionOriginal: 'લાલ કાપડની આભલા ભરતકામવાળી લગ્નની ઓઢણી.',
      aiGeneratedListing:
        'A bridal odhani, two and a half metres of madder-red cotton, worked end to end in abhla-bharat with a mirrored medallion at the centre. Thirty-one days of daylight stitching.',
      aiSuggestedCategory: 'Textile Art',
      tags: ['Kutch', 'Mirror Work', 'Bridal', 'Odhani'],
      laborDays: 31,
      rawMaterialCost: 4200,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 39,
      imageIndex: 3,
      secondImageIndex: 4,
    },
    {
      title: 'Kutch Embroidered Camel Belt',
      descriptionEnglish:
        'Traditional Rabari camel belt, 4 feet, in wool and cotton with mirror rosettes and woollen tassels at both ends.',
      descriptionOriginal: 'ઊન અને કપાસની આભલાવાળી ઊંટની પટ્ટી.',
      aiGeneratedListing:
        'The Rabari camel belt, four feet of wool and cotton with mirror rosettes down its length and woollen tassels at both ends. A working piece, made the way it always was.',
      aiSuggestedCategory: 'Textile Art',
      tags: ['Kutch', 'Rabari', 'Mirror Work', 'Wool'],
      laborDays: 12,
      rawMaterialCost: 1800,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 8,
      imageIndex: 4,
    },
    {
      title: 'Kutch Mirror Toran — Full Doorway',
      descriptionEnglish:
        'A full doorway toran in abhla-bharat mirror work with chain-stitch peacocks and hanging flaps.',
      descriptionOriginal: 'આભલા ભરતનું આખા બારણાનું તોરણ, મોર ભાતમાં.',
      aiGeneratedListing:
        'A doorway toran with peacocks worked in chain stitch and mirrors set flat enough to catch the light from either side.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Kutch', 'Mirror Work', 'Toran', 'Abhla Bharat'],
      laborDays: 19,
      rawMaterialCost: 2900,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 115,
      imageIndex: 3,
      secondImageIndex: 5,
    },
    {
      title: 'Rabari Embroidered Blouse Piece',
      descriptionEnglish:
        'An unstitched blouse piece in Rabari mirror and chain stitch on a black cotton ground.',
      descriptionOriginal: 'કાળા સુતરાઉ કાપડ પર રબારી ભરતનું ચોળીનું કાપડ.',
      aiGeneratedListing:
        'Rabari work on black cotton, unstitched so it can be cut to fit. The mirrors are set by daylight only.',
      aiSuggestedCategory: 'Textiles & Apparel',
      tags: ['Kutch', 'Rabari', 'Embroidery', 'Blouse Piece'],
      laborDays: 9,
      rawMaterialCost: 1300,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 69,
      imageIndex: 4,
    },
    {
      title: 'Kutch Mirror Wall Chakla — Large',
      descriptionEnglish:
        'A large round chakla panel in dense mirror work, listed far above the AI market band.',
      descriptionOriginal: 'ગાઢ આભલા ભરતનું મોટું ગોળ ચકલા પેનલ.',
      aiGeneratedListing:
        'A large round chakla worked edge to edge in mirror — the densest piece on this loom this year.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Kutch', 'Chakla', 'Mirror Work'],
      laborDays: 13,
      rawMaterialCost: 2000,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 25,
      imageIndex: 5,
      // Deliberately over the band: a boutique reseller listed it at more than
      // twice the top of the AI market range.
      priceMultiplier: 3.1,
    },
  ],

  sunaina: [
    {
      title: 'Madhubani — Kohbar Ghar Wedding Panel',
      descriptionEnglish:
        'The kohbar marriage chamber composition in the bharni fill style, painted on handmade paper with home-ground colours.',
      descriptionOriginal: 'हाथ के बने कागज़ पर भरनी शैली में कोहबर घर का विवाह चित्र।',
      aiGeneratedListing:
        'The kohbar — lotus pond, bamboo grove, sun and moon — painted the way it is drawn on a Mithila wedding wall, in bharni fill. Twenty-two days, and every colour was ground at home.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Madhubani', 'Kohbar', 'Bharni', 'Natural Colour'],
      laborDays: 22,
      rawMaterialCost: 2600,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 128,
      imageIndex: 0,
      secondImageIndex: 1,
    },
    {
      title: 'Madhubani — Ardhanarishvara on Handmade Paper',
      descriptionEnglish:
        'Ardhanarishvara in the kachni line style, drawn with a bamboo nib and filled only with cross-hatching.',
      descriptionOriginal: 'कचनी शैली में बाँस की कलम से बना अर्धनारीश्वर।',
      aiGeneratedListing:
        'Kachni, not bharni — the whole figure is built from hatched line, no flat colour anywhere. Drawn straight in ink with no pencil underneath.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Madhubani', 'Kachni', 'Line Work'],
      laborDays: 16,
      rawMaterialCost: 1400,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 82,
      imageIndex: 1,
    },
    {
      title: 'Madhubani — Fish and Lotus Pond',
      descriptionEnglish:
        'A fish and lotus pond composition in bharni fill, 18 x 24 inches, on primed cotton cloth.',
      descriptionOriginal: 'भरनी शैली में मछली और कमल के तालाब का चित्र, सूती कपड़े पर।',
      aiGeneratedListing:
        'Fish and lotus, the Mithila sign for plenty, filled in bharni on primed cotton. 18 by 24 inches.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Madhubani', 'Bharni', 'Fish', 'Lotus'],
      laborDays: 13,
      rawMaterialCost: 1800,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 47,
      imageIndex: 2,
    },
    {
      title: 'Madhubani — Krishna and the Gopis Scroll',
      descriptionEnglish:
        'A vertical scroll of Krishna among the gopis, painted in godhana line with a double border.',
      descriptionOriginal: 'गोधना शैली में कृष्ण और गोपियों का लंबवत चित्र।',
      aiGeneratedListing:
        'Krishna among the gopis, read top to bottom, with the double border that closes a Mithila scroll.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Madhubani', 'Godhana', 'Krishna', 'Scroll'],
      laborDays: 19,
      rawMaterialCost: 2200,
      stage: 'LISTED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 38,
      imageIndex: 3,
      secondImageIndex: 4,
    },
    {
      title: 'Madhubani Painted Sari — Cotton',
      descriptionEnglish:
        'A cotton sari hand-painted end to end with a Mithila border and a peacock pallu.',
      descriptionOriginal: 'मिथिला किनारी और मोर पल्लू वाली हाथ से चित्रित सूती साड़ी।',
      aiGeneratedListing:
        'Painted, not printed — the border runs the full length by hand and the peacock is drawn once, on the pallu.',
      aiSuggestedCategory: 'Textiles & Apparel',
      tags: ['Madhubani', 'Hand Painted', 'Cotton', 'Sari'],
      laborDays: 21,
      rawMaterialCost: 3100,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 30,
      imageIndex: 4,
    },
    {
      title: 'Madhubani — Tree of Life on Paper',
      descriptionEnglish:
        'A tree of life filled with birds and creepers, painted with kajal, geru and palash colours.',
      descriptionOriginal: 'कजल, गेरू और पलाश के रंगों से बना जीवन-वृक्ष।',
      aiGeneratedListing:
        'A tree of life with no bare ground left anywhere in the canopy. Kajal for black, geru for red, palash flower for orange.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Madhubani', 'Tree of Life', 'Natural Colour'],
      laborDays: 12,
      rawMaterialCost: 1500,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 19,
      imageIndex: 5,
    },
    {
      title: 'Madhubani Coaster Set — Six on Board',
      descriptionEnglish:
        'Six mounted coasters, each painted with a different Mithila motif and sealed.',
      descriptionOriginal: 'छह मिथिला नक्काशी वाले कोस्टर, सील किए हुए।',
      aiGeneratedListing:
        'Six coasters, six motifs, sealed so a wet glass does not lift the colour.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Madhubani', 'Coasters', 'Gift'],
      laborDays: 5,
      rawMaterialCost: 800,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 12,
      imageIndex: 0,
    },
    {
      title: 'Madhubani — Durga Panel in Bharni',
      descriptionEnglish:
        'A seated Durga panel in bharni fill with the lion drawn in profile and a red field behind.',
      descriptionOriginal: 'भरनी शैली में सिंह सहित बैठी दुर्गा का चित्र।',
      aiGeneratedListing:
        'Durga seated, lion in profile, the field behind filled flat in madder red the way a bharni panel closes.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Madhubani', 'Durga', 'Bharni'],
      laborDays: 15,
      rawMaterialCost: 1900,
      stage: 'VERIFIED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 8,
      imageIndex: 1,
    },
    {
      title: 'Madhubani — Sun and Moon Diptych',
      descriptionEnglish:
        'A pair of small panels, surya and chandra, painted as a matched diptych on handmade paper.',
      descriptionOriginal: 'हाथ के कागज़ पर सूर्य और चंद्र की जोड़ी।',
      aiGeneratedListing:
        'Surya and chandra as a pair, painted to hang together — the borders line up when they do.',
      aiSuggestedCategory: 'Paintings & Wall Art',
      tags: ['Madhubani', 'Surya', 'Chandra', 'Diptych'],
      laborDays: 7,
      rawMaterialCost: 950,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'IVR',
      createdDaysAgo: 3,
      imageIndex: 2,
    },
  ],

  shaukat: [
    {
      title: 'Bidriware Flower Vase — Silver Inlay',
      descriptionEnglish:
        'A cast zinc-copper vase inlaid with pure silver in the classic ashrafi-ki-booti pattern, blackened with fort soil.',
      descriptionOriginal: 'शुद्ध चाँदी की अशरफ़ी-की-बूटी जड़ाई वाला बिदरी फूलदान।',
      aiGeneratedListing:
        'Ashrafi-ki-booti inlaid in pure silver, then blackened with soil from the Bidar fort — the only earth that takes the metal to that black. Twenty days.',
      aiSuggestedCategory: 'Metalcraft & Brass',
      tags: ['Bidriware', 'Silver Inlay', 'Vase', 'GI Tag'],
      laborDays: 20,
      rawMaterialCost: 7200,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 136,
      imageIndex: 0,
      secondImageIndex: 1,
    },
    {
      title: 'Bidriware Surahi — Tarkashi Wire Work',
      descriptionEnglish:
        'A long-necked surahi with drawn silver wire set into the body in continuous tarkashi lines.',
      descriptionOriginal: 'तारकशी शैली में चाँदी के तार जड़ी लंबी गर्दन वाली सुराही।',
      aiGeneratedListing:
        'Tarkashi, not inlay by sheet — every line is a drawn wire hammered into a chiselled channel and filed flush.',
      aiSuggestedCategory: 'Metalcraft & Brass',
      tags: ['Bidriware', 'Tarkashi', 'Surahi'],
      laborDays: 24,
      rawMaterialCost: 8600,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 91,
      imageIndex: 1,
    },
    {
      title: 'Bidriware Jewellery Box — Aftabi Sheet Inlay',
      descriptionEnglish:
        'A lidded box with broad silver sheet inlay in the aftabi style, velvet lined.',
      descriptionOriginal: 'आफ़ताबी शैली में चाँदी की चादर जड़ा हुआ आभूषण बॉक्स।',
      aiGeneratedListing:
        'Aftabi work — silver laid as sheet rather than wire, so the pattern reads as a field of light against the black.',
      aiSuggestedCategory: 'Metalcraft & Brass',
      tags: ['Bidriware', 'Aftabi', 'Box'],
      laborDays: 18,
      rawMaterialCost: 6400,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 52,
      imageIndex: 2,
    },
    {
      title: 'Bidriware Wine Goblet Pair',
      descriptionEnglish:
        'A pair of goblets inlaid with a vine motif, cast from the 16:1 zinc-copper alloy.',
      descriptionOriginal: 'बेल की भात में जड़े हुए बिदरी जाम की जोड़ी।',
      aiGeneratedListing:
        'A matched pair, vine running the stem to the lip. The alloy is sixteen parts zinc to one of copper, as it has been for six centuries.',
      aiSuggestedCategory: 'Metalcraft & Brass',
      tags: ['Bidriware', 'Goblet', 'Silver Inlay'],
      laborDays: 16,
      rawMaterialCost: 5800,
      stage: 'LISTED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 44,
      imageIndex: 3,
      secondImageIndex: 5,
    },
    {
      title: 'Bidriware Hookah Base — Museum Copy',
      descriptionEnglish:
        'A hookah base worked after an eighteenth-century Deccan original, with dense floral inlay.',
      descriptionOriginal: 'अठारहवीं सदी के दक्खनी नमूने पर बना हुक़्क़े का आधार।',
      aiGeneratedListing:
        'Worked after a Deccan original, floral inlay carried right around the shoulder with no repeat.',
      aiSuggestedCategory: 'Metalcraft & Brass',
      tags: ['Bidriware', 'Hookah', 'Deccan', 'Heritage'],
      laborDays: 32,
      rawMaterialCost: 11400,
      stage: 'LISTED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 36,
      imageIndex: 4,
    },
    {
      title: 'Bidriware Cufflink Pair',
      descriptionEnglish:
        'A pair of cufflinks in blackened bidri with a fine silver crescent inlay.',
      descriptionOriginal: 'चाँदी के चाँद की जड़ाई वाले बिदरी कफ़लिंक।',
      aiGeneratedListing:
        'The smallest thing this workshop makes — a crescent inlaid into each face and filed flush.',
      aiSuggestedCategory: 'Jewellery & Accessories',
      tags: ['Bidriware', 'Cufflinks', 'Silver'],
      laborDays: 4,
      rawMaterialCost: 1600,
      stage: 'SELLABLE',
      catalogMethod: 'VOICE',
      createdDaysAgo: 22,
      imageIndex: 5,
    },
    {
      title: 'Bidriware Pen Holder — Geometric Inlay',
      descriptionEnglish:
        'A desk pen holder inlaid with a stepped geometric band in silver wire.',
      descriptionOriginal: 'चाँदी के तार की ज्यामितीय पट्टी वाला कलमदान।',
      aiGeneratedListing:
        'A stepped geometric band, wire-inlaid, on a plain black cylinder — the pattern is the only ornament.',
      aiSuggestedCategory: 'Metalcraft & Brass',
      tags: ['Bidriware', 'Desk', 'Geometric'],
      laborDays: 9,
      rawMaterialCost: 3000,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 15,
      imageIndex: 0,
    },
    {
      title: 'Bidriware Wall Plate — Chand Booti',
      descriptionEnglish:
        'A wall plate carrying the chand booti moon motif inlaid across the whole face.',
      descriptionOriginal: 'पूरी सतह पर चाँद बूटी जड़ी दीवार की थाली।',
      aiGeneratedListing:
        'Chand booti across the full face, each moon set by hand and the ground blackened around them.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Bidriware', 'Wall Plate', 'Chand Booti'],
      laborDays: 14,
      rawMaterialCost: 4900,
      stage: 'VERIFIED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 10,
      imageIndex: 1,
    },
    {
      title: 'Bidriware Paperweight — Single Motif',
      descriptionEnglish:
        'A solid cast paperweight with one inlaid poppy, the simplest piece in the workshop.',
      descriptionOriginal: 'एक जड़े हुए फूल वाला ठोस बिदरी पेपरवेट।',
      aiGeneratedListing:
        'One poppy, inlaid in silver on a solid black block. Nothing else on it.',
      aiSuggestedCategory: 'Metalcraft & Brass',
      tags: ['Bidriware', 'Paperweight', 'Gift'],
      laborDays: 3,
      rawMaterialCost: 1100,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'IVR',
      createdDaysAgo: 2,
      imageIndex: 2,
    },
  ],

  girija: [
    {
      title: 'Channapatna Stacking Rings — Seven Piece',
      descriptionEnglish:
        'A seven-ring stacking toy turned from aale mara and lacquered with vegetable-dyed lac.',
      descriptionOriginal: 'Seven rings turned from ivory wood and coloured with vegetable lac on the lathe.',
      aiGeneratedListing:
        'Seven rings on a turned post, coloured with lac while the lathe spins — the friction is what melts the stick. Vegetable dyes only, because these go in a child mouth.',
      aiSuggestedCategory: 'Toys & Games',
      tags: ['Channapatna', 'Lacquerware', 'Stacking Toy', 'Child Safe'],
      laborDays: 6,
      rawMaterialCost: 900,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 121,
      imageIndex: 0,
      secondImageIndex: 1,
    },
    {
      title: 'Channapatna Spinning Tops — Set of Five',
      descriptionEnglish:
        'Five lathe-turned tops in banded lac colour, weighted to spin long on a hard floor.',
      descriptionOriginal: 'Five turned tops in banded lac, weighted at the shoulder to spin long.',
      aiGeneratedListing:
        'Five tops, banded in lac and weighted at the shoulder so they run rather than wobble.',
      aiSuggestedCategory: 'Toys & Games',
      tags: ['Channapatna', 'Tops', 'Lacquerware'],
      laborDays: 4,
      rawMaterialCost: 600,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 88,
      imageIndex: 1,
    },
    {
      title: 'Channapatna Pull-Along Elephant',
      descriptionEnglish:
        'A pull-along elephant on turned wheels, lacquered in red and mustard with a cord pull.',
      descriptionOriginal: 'A pull-along elephant on turned wheels, lacquered red and mustard.',
      aiGeneratedListing:
        'Turned in parts and pinned, so the wheels run true. Red and mustard lac, and a cotton cord to pull it by.',
      aiSuggestedCategory: 'Toys & Games',
      tags: ['Channapatna', 'Pull Toy', 'Elephant'],
      laborDays: 7,
      rawMaterialCost: 1100,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 55,
      imageIndex: 2,
    },
    {
      title: 'Channapatna Kitchen Set — Fourteen Piece',
      descriptionEnglish:
        'A fourteen-piece miniature kitchen set, each vessel turned separately and lacquered.',
      descriptionOriginal: 'A fourteen-piece miniature kitchen set, each vessel turned and lacquered separately.',
      aiGeneratedListing:
        'Fourteen vessels, each one turned on its own and coloured before it comes off the lathe.',
      aiSuggestedCategory: 'Toys & Games',
      tags: ['Channapatna', 'Kitchen Set', 'Lacquerware'],
      laborDays: 11,
      rawMaterialCost: 1700,
      stage: 'LISTED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 41,
      imageIndex: 3,
      secondImageIndex: 5,
    },
    {
      title: 'Channapatna Rattle Pair — Natural & Red',
      descriptionEnglish:
        'Two infant rattles, one left in natural aale mara and one in red lac, both seed-filled.',
      descriptionOriginal: 'Two infant rattles, one natural and one red lac, both seed-filled.',
      aiGeneratedListing:
        'One natural, one red, both filled with seed so they sound soft rather than sharp.',
      aiSuggestedCategory: 'Toys & Games',
      tags: ['Channapatna', 'Rattle', 'Infant', 'Child Safe'],
      laborDays: 3,
      rawMaterialCost: 450,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 27,
      imageIndex: 4,
    },
    {
      title: 'Channapatna Alphabet Blocks — Twenty Six',
      descriptionEnglish:
        'Twenty-six turned blocks in five lac colours, one letter burned into each face.',
      descriptionOriginal: 'Twenty-six turned blocks in five lac colours, letters burned into each face.',
      aiGeneratedListing:
        'Twenty-six blocks, five colours, letters burned rather than printed so they cannot rub off.',
      aiSuggestedCategory: 'Toys & Games',
      tags: ['Channapatna', 'Blocks', 'Learning'],
      laborDays: 9,
      rawMaterialCost: 1400,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 20,
      imageIndex: 5,
    },
    {
      title: 'Channapatna Bead Necklace — Long',
      descriptionEnglish:
        'A long strung necklace of lacquered wooden beads in graduated sizes.',
      descriptionOriginal: 'A long necklace of lacquered wooden beads, graduated in size.',
      aiGeneratedListing:
        'Beads turned and lacquered in graduated sizes, strung long enough to double.',
      aiSuggestedCategory: 'Jewellery & Accessories',
      tags: ['Channapatna', 'Beads', 'Necklace'],
      laborDays: 5,
      rawMaterialCost: 700,
      stage: 'SELLABLE',
      catalogMethod: 'VOICE',
      createdDaysAgo: 14,
      imageIndex: 0,
    },
    {
      title: 'Channapatna Chess Set — Turned',
      descriptionEnglish:
        'A full turned chess set in two lac colours with a lacquered folding board.',
      descriptionOriginal: 'A full turned chess set in two lac colours with a folding lacquered board.',
      aiGeneratedListing:
        'Thirty-two pieces turned to matched heights, in two lac colours, with a board that folds on a cloth hinge.',
      aiSuggestedCategory: 'Toys & Games',
      tags: ['Channapatna', 'Chess', 'Lacquerware'],
      laborDays: 13,
      rawMaterialCost: 2100,
      stage: 'VERIFIED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 9,
      imageIndex: 1,
    },
    {
      title: 'Channapatna Rocking Horse — Small',
      descriptionEnglish:
        'A small rocking horse assembled from turned parts and finished in mustard lac.',
      descriptionOriginal: 'A small rocking horse built from turned parts, finished in mustard lac.',
      aiGeneratedListing:
        'Built from turned parts rather than carved, which is why it is light enough for a two-year-old to move.',
      aiSuggestedCategory: 'Toys & Games',
      tags: ['Channapatna', 'Rocking Horse', 'Lacquerware'],
      laborDays: 8,
      rawMaterialCost: 1300,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'IVR',
      createdDaysAgo: 5,
      imageIndex: 2,
    },
  ],

  ghulam: [
    {
      title: 'Kani Pashmina Shawl — Full Jamawar',
      descriptionEnglish:
        'A full jamawar kani shawl woven from a coded talim on hand-spun pashmina, the pattern covering the whole ground.',
      descriptionOriginal: 'तालीम से बुना पूरा जामावार कनी शॉल, हाथ से काती पश्मीना पर।',
      aiGeneratedListing:
        'A full jamawar — pattern edge to edge, no plain ground anywhere. Woven from a coded talim read aloud, one weft at a time with wooden needles. A hundred and ten days.',
      aiSuggestedCategory: 'Shawls & Wraps',
      tags: ['Pashmina', 'Kani', 'Jamawar', 'GI Tag'],
      laborDays: 110,
      rawMaterialCost: 26000,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 147,
      imageIndex: 0,
      secondImageIndex: 1,
    },
    {
      title: 'Sozni Embroidered Pashmina Shawl — Ivory',
      descriptionEnglish:
        'An ivory pashmina shawl with sozni needle embroidery worked along both borders and the ends.',
      descriptionOriginal: 'दोनों किनारों पर सोज़नी कढ़ाई वाला हाथी दाँत रंग का पश्मीना शॉल।',
      aiGeneratedListing:
        'Sozni worked with a needle so fine the reverse reads almost as cleanly as the face. Ivory ground, borders and both ends.',
      aiSuggestedCategory: 'Shawls & Wraps',
      tags: ['Pashmina', 'Sozni', 'Embroidery'],
      laborDays: 64,
      rawMaterialCost: 17500,
      stage: 'SOLD',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 103,
      imageIndex: 1,
    },
    {
      title: 'Plain Pashmina Stole — Natural Undyed',
      descriptionEnglish:
        'A plain stole in undyed pashmina, hand-spun on the yinder and woven on a handloom.',
      descriptionOriginal: 'बिना रंगा सादा पश्मीना स्टोल, यिन्दर पर काता हुआ।',
      aiGeneratedListing:
        'Nothing on it — no dye, no embroidery. Just hand-spun pashm, so the weight and the warmth are the whole argument.',
      aiSuggestedCategory: 'Shawls & Wraps',
      tags: ['Pashmina', 'Undyed', 'Handspun', 'Stole'],
      laborDays: 21,
      rawMaterialCost: 8200,
      stage: 'SOLD',
      catalogMethod: 'VOICE',
      createdDaysAgo: 58,
      imageIndex: 2,
    },
    {
      title: 'Kani Pashmina Shawl — Palla Border',
      descriptionEnglish:
        'A kani shawl with the woven pattern confined to the two palla ends and a narrow side border.',
      descriptionOriginal: 'दोनों पल्लों और पतली किनारी में कनी बुनाई वाला शॉल।',
      aiGeneratedListing:
        'The kani work is held to the two palla ends and a narrow border, so the field stays plain. Seventy days.',
      aiSuggestedCategory: 'Shawls & Wraps',
      tags: ['Pashmina', 'Kani', 'Palla'],
      laborDays: 70,
      rawMaterialCost: 19800,
      stage: 'LISTED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 49,
      imageIndex: 3,
      secondImageIndex: 5,
    },
    {
      title: 'Pashmina Muffler — Charcoal',
      descriptionEnglish:
        'A charcoal-dyed pashmina muffler, narrow cut, with hand-knotted fringe.',
      descriptionOriginal: 'कोयला रंग का पतला पश्मीना मफ़लर, हाथ से बँधी झालर सहित।',
      aiGeneratedListing:
        'Cut narrow for daily wear, dyed charcoal, fringe knotted by hand rather than machine-serged.',
      aiSuggestedCategory: 'Shawls & Wraps',
      tags: ['Pashmina', 'Muffler', 'Charcoal'],
      laborDays: 12,
      rawMaterialCost: 5400,
      stage: 'LISTED',
      catalogMethod: 'VOICE',
      createdDaysAgo: 34,
      imageIndex: 4,
    },
    {
      title: 'Papier-Mâché Pen Case — Gold Naqashi',
      descriptionEnglish:
        'A Kashmiri papier-mâché pen case painted in gold naqashi over a lacquered ground.',
      descriptionOriginal: 'लाख की सतह पर सुनहरी नक़ाशी वाला कश्मीरी पेपर-माशी कलमदान।',
      aiGeneratedListing:
        'Naqashi in gold over lacquer, on a case built up from paper pulp and then burnished smooth.',
      aiSuggestedCategory: 'Home Décor',
      tags: ['Papier Mache', 'Naqashi', 'Kashmir'],
      laborDays: 10,
      rawMaterialCost: 2300,
      stage: 'SELLABLE',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 26,
      imageIndex: 5,
    },
    {
      title: 'Pashmina Shawl — Aari Hook Embroidery',
      descriptionEnglish:
        'A pashmina shawl worked in aari hook chain stitch with a floral vine on both ends.',
      descriptionOriginal: 'दोनों सिरों पर आरी की ज़ंजीर कढ़ाई वाला पश्मीना शॉल।',
      aiGeneratedListing:
        'Aari hook work, a floral vine on both ends. Faster than sozni and it reads bolder from across a room.',
      aiSuggestedCategory: 'Shawls & Wraps',
      tags: ['Pashmina', 'Aari', 'Embroidery'],
      laborDays: 31,
      rawMaterialCost: 11200,
      stage: 'SELLABLE',
      catalogMethod: 'VOICE',
      createdDaysAgo: 18,
      imageIndex: 0,
    },
    {
      title: 'Pashmina Scarf — Indigo Dip',
      descriptionEnglish:
        'A light pashmina scarf dip-dyed in natural indigo, graduating from pale to deep.',
      descriptionOriginal: 'प्राकृतिक नील में डुबोकर रंगा हल्का पश्मीना दुपट्टा।',
      aiGeneratedListing:
        'Dip-dyed in a natural indigo vat, so the colour runs pale at one end and deep at the other.',
      aiSuggestedCategory: 'Shawls & Wraps',
      tags: ['Pashmina', 'Indigo', 'Natural Dye', 'Scarf'],
      laborDays: 14,
      rawMaterialCost: 6100,
      stage: 'VERIFIED',
      catalogMethod: 'MANUAL',
      createdDaysAgo: 11,
      imageIndex: 1,
    },
    {
      title: 'Pashmina Yarn Hank — Hand-Spun',
      descriptionEnglish:
        'A hank of hand-spun pashmina yarn from the workshop wheel, sold to other weavers.',
      descriptionOriginal: 'कार्यशाला के चरखे पर काता पश्मीना सूत का लच्छा।',
      aiGeneratedListing:
        'Spun on the yinder at home and sold on to other weavers. The count is uneven on purpose — a machine-even pashm yarn is not pashm.',
      aiSuggestedCategory: 'Fabric & Yardage',
      tags: ['Pashmina', 'Yarn', 'Handspun'],
      laborDays: 6,
      rawMaterialCost: 3800,
      stage: 'PENDING_VERIFICATION',
      catalogMethod: 'IVR',
      createdDaysAgo: 6,
      imageIndex: 2,
    },
  ],
};

/* -------------------------------------------------------------------------- */
/*  Creators / affiliate influencers                                           */
/* -------------------------------------------------------------------------- */

/**
 * The creator roster behind `/artisan/marketing` and the public `/creators`
 * portal.
 *
 * Creators were never seeded — the only way one existed was for someone to fill
 * in the registration form, so the artisan's discovery tab was empty on a fresh
 * database and the niche matcher looked broken when it was merely asking an
 * empty table. Every `nicheCategory` below is a literal member of
 * `CREATOR_NICHES` in `src/lib/creators.ts`, because `nicheForCraft` matches on
 * exactly those strings and a near-miss silently returns nothing.
 *
 * `photoUrl` is deliberately null: `Avatar` draws initials on a colour derived
 * from the name, which is honest, whereas borrowing a stock face would put a
 * stranger's photograph on an invented person.
 */
interface CreatorSeed {
  name: string;
  handle: string;
  platform: 'INSTAGRAM' | 'YOUTUBE' | 'NIFT_STUDENT';
  profileUrl: string;
  nicheCategory: string;
  location: string;
  upiId: string;
  bio: string;
  totalClicks: number;
  totalSales: number;
  earningsTotal: number;
}

const CREATORS: CreatorSeed[] = [
  {
    name: 'Shreya Mohanty',
    handle: 'shreya_drapes',
    platform: 'INSTAGRAM',
    profileUrl: 'https://instagram.com/shreya_drapes',
    nicheCategory: 'Handloom Sarees',
    location: 'Bhubaneswar, Odisha',
    upiId: 'shreyamohanty@okaxis',
    bio: 'Six-yard reels, mostly Odisha looms. I name the weaver in every caption or I do not post it.',
    totalClicks: 4820,
    totalSales: 37,
    earningsTotal: 41260,
  },
  {
    name: 'Aditi Raghavan',
    handle: 'kanchi_diaries',
    platform: 'INSTAGRAM',
    profileUrl: 'https://instagram.com/kanchi_diaries',
    nicheCategory: 'Handloom Sarees',
    location: 'Chennai, Tamil Nadu',
    upiId: 'aditiraghavan@ybl',
    bio: 'South Indian silk, styled for people who actually wear them to work. Korvai explainers on Sundays.',
    totalClicks: 6310,
    totalSales: 44,
    earningsTotal: 58900,
  },
  {
    name: 'Rukmini Barik',
    handle: 'tribal_metal_stories',
    platform: 'YOUTUBE',
    profileUrl: 'https://youtube.com/@tribal_metal_stories',
    nicheCategory: 'Tribal Jewelry',
    location: 'Koraput, Odisha',
    upiId: 'rukminibarik@okicici',
    bio: 'Long-form films on Dhokra and Bastar metal. I film the pour, not just the finished piece.',
    totalClicks: 3170,
    totalSales: 21,
    earningsTotal: 27340,
  },
  {
    name: 'Farhan Sheikh',
    handle: 'bidar_black',
    platform: 'INSTAGRAM',
    profileUrl: 'https://instagram.com/bidar_black',
    nicheCategory: 'Metalwork & Brass',
    location: 'Hyderabad, Telangana',
    upiId: 'farhansheikh@okhdfcbank',
    bio: 'Bidri, koftgari and Deccan metal. Mostly close-ups of inlay you cannot see in a shop.',
    totalClicks: 2940,
    totalSales: 18,
    earningsTotal: 31580,
  },
  {
    name: 'Nandini Iyer',
    handle: 'clay_and_kiln',
    platform: 'YOUTUBE',
    profileUrl: 'https://youtube.com/@clay_and_kiln',
    nicheCategory: 'Pottery & Terracotta',
    location: 'Jaipur, Rajasthan',
    upiId: 'nandiniiyer@okaxis',
    bio: 'Studio pottery meets village kiln. Blue pottery series ran for eleven episodes.',
    totalClicks: 5460,
    totalSales: 52,
    earningsTotal: 39710,
  },
  {
    name: 'Devika Menon',
    handle: 'devika.makes',
    platform: 'NIFT_STUDENT',
    profileUrl: 'https://instagram.com/devika.makes',
    nicheCategory: 'Textiles & Embroidery',
    location: 'Gandhinagar, Gujarat',
    upiId: 'devikamenon@ybl',
    bio: 'NIFT Gandhinagar, textile design. My thesis was on Kutch mirror work and I have not stopped since.',
    totalClicks: 1880,
    totalSales: 14,
    earningsTotal: 11420,
  },
  {
    name: 'Harleen Kaur Sandhu',
    handle: 'phulkari_files',
    platform: 'INSTAGRAM',
    profileUrl: 'https://instagram.com/phulkari_files',
    nicheCategory: 'Textiles & Embroidery',
    location: 'Patiala, Punjab',
    upiId: 'harleensandhu@okicici',
    bio: 'Phulkari, bagh and everything darned in pat silk. I buy from the stitcher, never the middle shop.',
    totalClicks: 4090,
    totalSales: 29,
    earningsTotal: 22850,
  },
  {
    name: 'Ritwik Sen',
    handle: 'folkframe',
    platform: 'YOUTUBE',
    profileUrl: 'https://youtube.com/@folkframe',
    nicheCategory: 'Painting & Folk Art',
    location: 'Kolkata, West Bengal',
    upiId: 'ritwiksen@okhdfcbank',
    bio: 'Pattachitra, Kalighat and Madhubani, filmed slowly. Twenty minutes on one brush stroke is fine by me.',
    totalClicks: 7120,
    totalSales: 48,
    earningsTotal: 63400,
  },
  {
    name: 'Meenal Jha',
    handle: 'mithila_modern',
    platform: 'INSTAGRAM',
    profileUrl: 'https://instagram.com/mithila_modern',
    nicheCategory: 'Painting & Folk Art',
    location: 'Patna, Bihar',
    upiId: 'meenaljha@ybl',
    bio: 'Madhubani on walls, saris and anything that will hold colour. Kachni over bharni, always.',
    totalClicks: 3620,
    totalSales: 26,
    earningsTotal: 18960,
  },
  {
    name: 'Tenzin Dolma',
    handle: 'wool_and_altitude',
    platform: 'INSTAGRAM',
    profileUrl: 'https://instagram.com/wool_and_altitude',
    nicheCategory: 'Textiles & Embroidery',
    location: 'Srinagar, Jammu & Kashmir',
    upiId: 'tenzindolma@okaxis',
    bio: 'Pashmina, sozni and the difference between the two. I have watched a kani shawl take four months.',
    totalClicks: 2510,
    totalSales: 16,
    earningsTotal: 47300,
  },
  {
    name: 'Karthik Prasad',
    handle: 'lathe_and_lac',
    platform: 'YOUTUBE',
    profileUrl: 'https://youtube.com/@lathe_and_lac',
    nicheCategory: 'Wood & Stone Carving',
    location: 'Bengaluru, Karnataka',
    upiId: 'karthikprasad@okicici',
    bio: 'Channapatna, Etikoppaka and Kondapalli. Toy safety testing is half the channel now.',
    totalClicks: 4470,
    totalSales: 61,
    earningsTotal: 26180,
  },
  {
    name: 'Ipsita Das',
    handle: 'ipsita.textile',
    platform: 'NIFT_STUDENT',
    profileUrl: 'https://instagram.com/ipsita.textile',
    nicheCategory: 'Handloom Sarees',
    location: 'Bhubaneswar, Odisha',
    upiId: 'ipsitadas@ybl',
    bio: 'NIFT Bhubaneswar, third year. Documenting the Bargarh bandha tying process for my portfolio.',
    totalClicks: 1240,
    totalSales: 9,
    earningsTotal: 7480,
  },
  {
    name: 'Zoya Qureshi',
    handle: 'the_block_desk',
    platform: 'INSTAGRAM',
    profileUrl: 'https://instagram.com/the_block_desk',
    nicheCategory: 'General Handicraft',
    location: 'Ahmedabad, Gujarat',
    upiId: 'zoyaqureshi@okhdfcbank',
    bio: 'Ajrakh, bagru and dabu. If a print is screen-printed I say so in the first line.',
    totalClicks: 5890,
    totalSales: 40,
    earningsTotal: 34270,
  },
  {
    name: 'Anirban Roy',
    handle: 'bamboo_beat',
    platform: 'NIFT_STUDENT',
    profileUrl: 'https://instagram.com/bamboo_beat',
    nicheCategory: 'Bamboo & Cane',
    location: 'Guwahati, Assam',
    upiId: 'anirbanroy@okaxis',
    bio: 'NIFT Shillong. Cane and bamboo from the North East, and the makers who never get named.',
    totalClicks: 1630,
    totalSales: 11,
    earningsTotal: 8940,
  },
];

const LANGUAGE_CODE: Record<ArtisanSeed['language'], string> = {
  Odia: 'Odia',
  Hindi: 'Hindi',
  Telugu: 'Telugu',
  Gujarati: 'Gujarati',
  English: 'English',
};

/* -------------------------------------------------------------------------- */

async function main() {
  console.log('Seeding KARIGARI database...\n');

  // 6 photos per craft so ten items per artisan still look distinct.
  const images = await buildSeedImages(6, ARTISANS.length);
  console.log('');

  // FK-safe wipe. `affiliateClick` goes before `creator`: it carries the only
  // real foreign key onto that table, so deleting creators first would fail.
  await prisma.auditLog.deleteMany();
  await prisma.affiliateClick.deleteMany();
  await prisma.creator.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.demand.deleteMany();
  await prisma.schemeApplication.deleteMany();
  await prisma.craftItem.deleteMany();
  await prisma.artisanProfile.deleteMany();
  await prisma.user.deleteMany();
  console.log('Existing data cleared.');

  const passwordHash = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.create({
    data: {
      id: 'cooperative-admin-001',
      name: 'Cooperative Admin',
      email: 'admin@karigari.com',
      passwordHash,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      patchBankBalance: 4841,
      patchBankIssued: 159,
    },
  });

  const counts: Record<string, number> = {};
  let listed = 0;
  let sold = 0;
  let verifiedImages = 0;
  let patchSeed = 1;
  let underpriced = 0;
  let overpriced = 0;

  const credentials: { email: string; craft: string; items: number }[] = [];

  for (let a = 0; a < ARTISANS.length; a += 1) {
    const artisan = ARTISANS[a];

    const user = await prisma.user.create({
      data: {
        name: artisan.name,
        email: artisan.email,
        passwordHash,
        role: 'ARTISAN',
        accountStatus: 'ACTIVE',
        createdAt: daysAgo(90 - a * 4),
        artisanProfile: {
          create: {
            craftType: artisan.craftType,
            location: artisan.location,
            clusterName: artisan.clusterName,
            mobileNumber: artisan.mobileNumber,
            upiId: artisan.upiId,
            bankAccountNumber: artisan.bankAccountNumber,
            aadhaarLast4: artisan.aadhaarLast4,
            experienceYears: artisan.experienceYears,
            cooperativeId: artisan.cooperativeId,
            description: artisan.description,
            tags: artisan.tags,
            socialCategory: artisan.socialCategory,
            gender: artisan.gender,
            annualIncome: artisan.annualIncome,
            healthScore: artisan.healthScore,
            giTagCertified: artisan.giTagCertified,
            giTagName: artisan.giTagName,
            photoUrl: images.people[a],
          },
        },
      },
    });

    const craftPhotos = images.crafts[artisan.craftSlug];
    const itemSeeds = ITEMS[artisan.key];

    for (let i = 0; i < itemSeeds.length; i += 1) {
      const seed = itemSeeds[i];
      const created = daysAgo(seed.createdDaysAgo);

      // Same helper the live capture flow runs, so the seeded band is the band
      // the app would actually have quoted for these inputs.
      const valuation = estimateCraftValuation(
        artisan.craftType,
        seed.laborDays,
        seed.rawMaterialCost
      );
      // Asking price sits just inside the upper half of the band, unless the
      // seed deliberately breaks it away to exercise the pricing guardrail.
      const askingPrice = round(
        seed.priceMultiplier !== undefined
          ? valuation.fairWageFloor * seed.priceMultiplier
          : valuation.marketPriceMin + (valuation.marketPriceMax - valuation.marketPriceMin) * 0.55
      );

      const gallery = [craftPhotos[seed.imageIndex % craftPhotos.length]];
      if (seed.secondImageIndex !== undefined) {
        gallery.push(craftPhotos[seed.secondImageIndex % craftPhotos.length]);
      }

      const hasPatch = seed.stage !== 'PENDING_VERIFICATION';
      const patchId = hasPatch ? makePatchId(patchSeed++) : null;
      const qrVerified = seed.stage === 'SELLABLE' || seed.stage === 'LISTED' || seed.stage === 'SOLD';

      // A real, decodable QR over the real product photo — the same artefact
      // /api/items/attach-verify would have accepted.
      let qrVerifiedImageUrl: string | null = null;
      if (qrVerified && patchId) {
        try {
          qrVerifiedImageUrl = await buildVerifiedImage(gallery[0], patchId, BASE_URL);
          verifiedImages += 1;
        } catch (error) {
          console.warn(`  QR composite failed for ${patchId}:`, (error as Error).message);
        }
      }

      const isListed = seed.stage === 'LISTED' || seed.stage === 'SOLD';
      const isSold = seed.stage === 'SOLD';

      // The same verdict the capture route and the facilitator queue compute,
      // from the same numbers — so a seeded flag is the real rule firing.
      const priceVerdict = getPricingDiscrepancy({
        fairWageFloor: round(valuation.fairWageFloor),
        marketPriceMax: round(valuation.marketPriceMax),
        standardMarketPrice: round(valuation.standardMarketPrice),
        askingPrice,
        salePrice: isSold ? askingPrice : null,
      });

      const salePrice = isSold ? askingPrice : null;
      const advanceAmount = isSold ? round(askingPrice * 0.4) : null;
      const finalSettlementAmount = isSold ? round(askingPrice * 0.4936) : null;

      const status =
        seed.stage === 'SOLD'
          ? 'SOLD_FINAL'
          : seed.stage === 'LISTED'
            ? 'SELLABLE'
            : seed.stage;

      const item = await prisma.craftItem.create({
        data: {
          artisanId: user.id,
          craftType: seed.title,
          descriptionOriginal: seed.descriptionOriginal,
          descriptionEnglish: seed.descriptionEnglish,
          aiGeneratedListing: seed.aiGeneratedListing,
          aiSuggestedCategory: seed.aiSuggestedCategory,
          tags: seed.tags,
          images: gallery,
          laborDays: seed.laborDays,
          rawMaterialCost: seed.rawMaterialCost,
          fairWageFloor: round(valuation.fairWageFloor),
          marketPriceMin: round(valuation.marketPriceMin),
          marketPriceMax: round(valuation.marketPriceMax),
          standardMarketPrice: round(valuation.standardMarketPrice),
          askingPrice,
          salePrice,
          pricingFlag: priceVerdict.flagged,
          flagReason: priceVerdict.reason,
          creditScore: 640 + ((a * 37 + i * 19) % 180),
          status,
          patchId,
          assignedAdminId: hasPatch ? admin.id : null,
          giTagApplied: artisan.giTagCertified ? artisan.giTagName : null,
          catalogMethod: seed.catalogMethod,
          voiceLanguage: seed.catalogMethod === 'MANUAL' ? null : LANGUAGE_CODE[artisan.language],

          qrVerified,
          qrVerifiedImageUrl,
          qrVerifiedAt: qrVerified ? plusMinutes(created, 2880) : null,

          isListedOnMarketplace: isListed,
          isOndcLive: isListed,
          syndicatedChannels: isListed
            ? ['KARIGARI_ONDC', 'ONDC_PAYTM_MAGICPIN', 'GEM_B2G']
            : [],
          syndicatedAt: isListed ? plusMinutes(created, 4320) : null,

          escrowStatus: isSold ? 'STAGE2_SETTLED_89' : null,
          razorpayOrderId: isSold ? `order_${patchId?.slice(6, 20).replace(/-/g, '')}` : null,
          advanceAmount,
          finalSettlementAmount,
          artisanUpiDestination: isSold ? artisan.upiId : null,
          advancePaid: isSold ? advanceAmount! : 0,
          finalPayoutQueued: isSold ? finalSettlementAmount! : 0,

          createdAt: created,
        },
      });

      counts[status] = (counts[status] ?? 0) + 1;
      if (isListed) listed += 1;
      if (isSold) sold += 1;
      if (priceVerdict.direction === 'below') underpriced += 1;
      if (priceVerdict.direction === 'above') overpriced += 1;

      /* ---- Audit chain: only the steps this item has actually reached ---- */
      const trail: {
        action: string;
        actorId: string | null;
        actorRole: string;
        comments: string;
        at: Date;
      }[] = [
        {
          action: 'ITEM_CAPTURED',
          actorId: user.id,
          actorRole: 'ARTISAN',
          comments: `Captured via ${seed.catalogMethod}. Artisan described the piece in ${artisan.language}.`,
          at: created,
        },
      ];

      if (priceVerdict.flagged) {
        trail.push({
          action: 'PRICING_FLAG_RAISED',
          actorId: 'ANTI_EXPLOITATION_ENGINE',
          actorRole: 'SYSTEM',
          comments: `${priceVerdict.reason}. Held for facilitator review under the anti-exploitation policy.`,
          at: plusMinutes(created, 30),
        });
      }

      if (hasPatch) {
        trail.push({
          action: 'ADMIN_VERIFIED',
          actorId: admin.id,
          actorRole: 'ADMIN',
          comments: `Admin verified AI math and issued Patch ID: ${patchId}. The artisan must now attach the physical QR patch and re-photograph the piece before it can be listed.`,
          at: plusMinutes(created, 1440),
        });
      }

      if (qrVerified) {
        trail.push({
          action: 'QR_PATCH_VERIFIED',
          actorId: user.id,
          actorRole: 'ARTISAN',
          comments:
            'Physical QR patch + product image AI-matched to original; item is now sellable.',
          at: plusMinutes(created, 2880),
        });
      }

      if (isListed) {
        trail.push({
          action: 'MULTI_CHANNEL_SYNDICATE',
          actorId: user.id,
          actorRole: 'ARTISAN',
          comments:
            'Artisan published this listing to every connected channel from their own account. Broadcast-ready payload; no external seller id involved.',
          at: plusMinutes(created, 4320),
        });
      }

      if (isSold) {
        trail.push(
          {
            action: 'ESCROW_HELD',
            actorId: 'RAZORPAY_ORDER',
            actorRole: 'SYSTEM',
            comments:
              'Buyer opened a Razorpay TEST payment. Funds are held in escrow; the artisan VPA on file is locked in as the payout destination. No admin can release or redirect this.',
            at: plusMinutes(created, 5760),
          },
          {
            action: 'DIRECT_ARTISAN_ADVANCE_PAID',
            actorId: 'SMART_ESCROW_ENGINE',
            actorRole: 'SYSTEM',
            comments:
              'Stage 1 (40% fair-wage advance) released programmatically on dispatch, direct to the artisan VPA. Test-mode settlement record — no admin approved or touched this.',
            at: plusMinutes(created, 7200),
          },
          {
            action: 'DIRECT_ARTISAN_FINAL_SETTLEMENT',
            actorId: 'SMART_ESCROW_ENGINE',
            actorRole: 'SYSTEM',
            comments:
              'Stage 2 final settlement released programmatically on delivery, direct to the artisan VPA. Total to artisan: 89.36% of gross. Test-mode settlement record — no admin approved or touched this.',
            at: plusMinutes(created, 10080),
          }
        );
      }

      await prisma.auditLog.createMany({
        data: trail.map((entry) => ({
          craftItemId: item.id,
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          action: entry.action,
          comments: entry.comments,
          createdAt: entry.at,
        })),
      });
    }

    credentials.push({
      email: artisan.email,
      craft: artisan.craftType,
      items: itemSeeds.length,
    });
    console.log(`  ${artisan.name} — ${itemSeeds.length} items`);
  }

  /* ---- Scheme applications ------------------------------------------- */
  const artisanUsers = await prisma.user.findMany({
    where: { role: 'ARTISAN' },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });
  const byEmail = new Map(artisanUsers.map((u) => [u.email, u.id]));

  const schemeSeeds = [
    { email: 'lakshmi@karigari.com', schemeKey: 'pm_vishwakarma', schemeName: 'PM Vishwakarma', status: 'APPLIED', appliedAt: daysAgo(40) },
    { email: 'lakshmi@karigari.com', schemeKey: 'mudra_shishu', schemeName: 'MUDRA Shishu Loan', status: 'ELIGIBLE', appliedAt: null },
    { email: 'raghunath@karigari.com', schemeKey: 'pm_vishwakarma', schemeName: 'PM Vishwakarma', status: 'APPROVED', appliedAt: daysAgo(61) },
    { email: 'anitha@karigari.com', schemeKey: 'mudra_shishu', schemeName: 'MUDRA Shishu Loan', status: 'APPLIED', appliedAt: daysAgo(22) },
    { email: 'imran@karigari.com', schemeKey: 'pm_vishwakarma', schemeName: 'PM Vishwakarma', status: 'ELIGIBLE', appliedAt: null },
    { email: 'budhram@karigari.com', schemeKey: 'pm_vishwakarma', schemeName: 'PM Vishwakarma', status: 'APPROVED', appliedAt: daysAgo(75) },
    { email: 'budhram@karigari.com', schemeKey: 'nsfdc_term_loan', schemeName: 'NSFDC Term Loan', status: 'APPLIED', appliedAt: daysAgo(18) },
    { email: 'jethiben@karigari.com', schemeKey: 'mudra_shishu', schemeName: 'MUDRA Shishu Loan', status: 'ELIGIBLE', appliedAt: null },
    { email: 'sunaina@karigari.com', schemeKey: 'pm_vishwakarma', schemeName: 'PM Vishwakarma', status: 'UNDER_REVIEW', appliedAt: daysAgo(29) },
    { email: 'shaukat@karigari.com', schemeKey: 'ahvy', schemeName: 'AHVY — Ambedkar Hastshilp Vikas Yojana', status: 'APPROVED', appliedAt: daysAgo(88) },
    { email: 'girija@karigari.com', schemeKey: 'pm_vishwakarma', schemeName: 'PM Vishwakarma', status: 'ELIGIBLE', appliedAt: null },
    { email: 'ghulam@karigari.com', schemeKey: 'gem_seller', schemeName: 'GeM Seller Registration', status: 'DISBURSED', appliedAt: daysAgo(120) },
  ];

  await prisma.schemeApplication.createMany({
    data: schemeSeeds
      .filter((s) => byEmail.has(s.email))
      .map((s) => ({
        userId: byEmail.get(s.email)!,
        schemeKey: s.schemeKey,
        schemeName: s.schemeName,
        status: s.status,
        appliedAt: s.appliedAt,
        createdAt: s.appliedAt ?? daysAgo(70),
      })),
  });

  /* ---- Creators / affiliate influencers ------------------------------- */
  await prisma.creator.createMany({
    data: CREATORS.map((creator, index) => ({
      ...creator,
      // Null on purpose — Avatar draws initials rather than borrowing a face.
      photoUrl: null,
      status: 'ACTIVE',
      // Spread across the last few months so the roster does not look like it
      // registered in one batch, which is exactly what it is.
      createdAt: daysAgo(150 - index * 9),
    })),
  });

  /* ---- Buyer demand board -------------------------------------------- */
  const demandSeeds = [
    { craftType: 'Sambalpuri Ikat Silk Saree', quantity: 40, targetPriceMin: 9000, targetPriceMax: 14000, location: 'Bhubaneswar, Odisha', festival: 'Raja Parba', buyerName: 'Utkal Handloom Emporium', notes: 'Bulk order for the festival window. Prefer GI-tagged weavers.', status: 'OPEN', createdAt: daysAgo(6) },
    { craftType: 'Pattachitra Painting', quantity: 15, targetPriceMin: 6000, targetPriceMax: 18000, location: 'New Delhi', festival: null, buyerName: 'Crafts Museum Store', notes: 'Jagannath and Dasavatara subjects preferred.', status: 'OPEN', createdAt: daysAgo(11) },
    { craftType: 'Pochampally Ikat', quantity: 60, targetPriceMin: 7000, targetPriceMax: 12000, location: 'Hyderabad, Telangana', festival: 'Bathukamma', buyerName: 'Telangana State Emporium', notes: 'Double ikat only. Need GI certification on file.', status: 'MATCHED', createdAt: daysAgo(20) },
    { craftType: 'Jaipur Blue Pottery', quantity: 120, targetPriceMin: 900, targetPriceMax: 2600, location: 'Jaipur, Rajasthan', festival: 'Diwali', buyerName: 'Rajasthali Retail', notes: 'Mixed vases, bowls and knobs for the Diwali gifting range.', status: 'OPEN', createdAt: daysAgo(3) },
    { craftType: 'Dhokra Brass Figurine', quantity: 25, targetPriceMin: 3500, targetPriceMax: 9000, location: 'Raipur, Chhattisgarh', festival: null, buyerName: 'Bastar Art Collective', notes: 'Tribal musician and animal forms.', status: 'OPEN', createdAt: daysAgo(9) },
    { craftType: 'Kutch Mirror Embroidery', quantity: 35, targetPriceMin: 2500, targetPriceMax: 7000, location: 'Ahmedabad, Gujarat', festival: 'Navratri', buyerName: 'Gurjari Handicrafts', notes: 'Toran and chakla pieces for the Navratri display.', status: 'OPEN', createdAt: daysAgo(14) },
    { craftType: 'Madhubani Painting', quantity: 30, targetPriceMin: 3000, targetPriceMax: 12000, location: 'Patna, Bihar', festival: 'Chhath Puja', buyerName: 'Bihar Museum Shop', notes: 'Kohbar and fish-pond subjects. Handmade paper preferred over canvas.', status: 'OPEN', createdAt: daysAgo(8) },
    { craftType: 'Bidriware Silver Inlay', quantity: 18, targetPriceMin: 6000, targetPriceMax: 24000, location: 'Bengaluru, Karnataka', festival: null, buyerName: 'Cauvery Emporium', notes: 'Vases and boxes for the corporate gifting range. GI certificate on file required.', status: 'OPEN', createdAt: daysAgo(5) },
    { craftType: 'Channapatna Lacquered Toys', quantity: 240, targetPriceMin: 400, targetPriceMax: 1800, location: 'Mysuru, Karnataka', festival: 'Dasara', buyerName: 'Karnataka Toy Cluster Retail', notes: 'Vegetable-dye certification mandatory. Mixed rattles, tops and stackers.', status: 'MATCHED', createdAt: daysAgo(17) },
    { craftType: 'Kashmiri Pashmina Shawl', quantity: 22, targetPriceMin: 18000, targetPriceMax: 90000, location: 'New Delhi', festival: null, buyerName: 'Kashmir Loom Export House', notes: 'Kani and sozni only. Must carry the GI mark and the handspun declaration.', status: 'OPEN', createdAt: daysAgo(10) },
  ];
  const demandCount = demandSeeds.length;

  await prisma.demand.createMany({ data: demandSeeds });

  /* ---- Notifications --------------------------------------------------- */
  const notificationSeeds = [
    { email: 'lakshmi@karigari.com', type: 'DEMAND_ALERT', title: 'New bulk enquiry', message: 'Utkal Handloom Emporium wants 40 Sambalpuri sarees for Raja Parba.', channel: 'SMS', daysAgo: 6 },
    { email: 'lakshmi@karigari.com', type: 'FESTIVAL', title: 'Raja Parba approaching', message: 'Silk saree demand rises sharply in the four weeks before Raja Parba.', channel: 'IN_APP', daysAgo: 12 },
    { email: 'raghunath@karigari.com', type: 'DEMAND_ALERT', title: 'Museum store enquiry', message: 'Crafts Museum Store is looking for 15 Pattachitra works.', channel: 'WHATSAPP', daysAgo: 11 },
    { email: 'anitha@karigari.com', type: 'SCHEME', title: 'MUDRA Shishu update', message: 'Your MUDRA Shishu application has moved to bank verification.', channel: 'IN_APP', daysAgo: 5 },
    { email: 'anitha@karigari.com', type: 'DEMAND_ALERT', title: 'Bathukamma order matched', message: 'Telangana State Emporium matched your double-ikat listing.', channel: 'SMS', daysAgo: 20 },
    { email: 'imran@karigari.com', type: 'DEMAND_ALERT', title: 'Diwali gifting range', message: 'Rajasthali Retail wants 120 blue pottery pieces before Diwali.', channel: 'SMS', daysAgo: 3 },
    { email: 'budhram@karigari.com', type: 'SCHEME', title: 'PM Vishwakarma approved', message: 'Your PM Vishwakarma toolkit grant has been approved.', channel: 'IN_APP', daysAgo: 30 },
    { email: 'budhram@karigari.com', type: 'DEMAND_ALERT', title: 'Bastar Art Collective', message: '25 Dhokra figurines wanted — tribal musician and animal forms.', channel: 'WHATSAPP', daysAgo: 9 },
    { email: 'jethiben@karigari.com', type: 'DEMAND_ALERT', title: 'Navratri display order', message: 'Gurjari Handicrafts wants 35 toran and chakla pieces.', channel: 'SMS', daysAgo: 14 },
    { email: 'jethiben@karigari.com', type: 'FESTIVAL', title: 'Navratri season', message: 'Mirror-work demand peaks six weeks before Navratri.', channel: 'IN_APP', daysAgo: 21 },
    { email: 'sunaina@karigari.com', type: 'DEMAND_ALERT', title: 'Museum shop enquiry', message: 'Bihar Museum Shop wants 30 Madhubani works on handmade paper.', channel: 'SMS', daysAgo: 8 },
    { email: 'sunaina@karigari.com', type: 'FESTIVAL', title: 'Chhath Puja approaching', message: 'Mithila painting demand rises through the four weeks before Chhath.', channel: 'IN_APP', daysAgo: 16 },
    { email: 'shaukat@karigari.com', type: 'DEMAND_ALERT', title: 'Corporate gifting order', message: 'Cauvery Emporium wants 18 Bidriware vases and boxes.', channel: 'WHATSAPP', daysAgo: 5 },
    { email: 'girija@karigari.com', type: 'DEMAND_ALERT', title: 'Dasara toy order matched', message: 'Karnataka Toy Cluster Retail matched your vegetable-dye toy listings.', channel: 'SMS', daysAgo: 17 },
    { email: 'girija@karigari.com', type: 'SCHEME', title: 'PM Vishwakarma eligible', message: 'Your craft is one of the 18 notified trades. You can register at a CSC.', channel: 'IN_APP', daysAgo: 26 },
    { email: 'ghulam@karigari.com', type: 'DEMAND_ALERT', title: 'Export house enquiry', message: 'Kashmir Loom Export House wants 22 kani and sozni shawls with GI marks.', channel: 'WHATSAPP', daysAgo: 10 },
  ];

  await prisma.notification.createMany({
    data: notificationSeeds
      .filter((n) => byEmail.has(n.email))
      .map((n) => ({
        userId: byEmail.get(n.email)!,
        type: n.type,
        title: n.title,
        message: n.message,
        channel: n.channel,
        read: n.daysAgo > 14,
        createdAt: daysAgo(n.daysAgo),
      })),
  });

  /* ---- Summary --------------------------------------------------------- */
  const totalItems = Object.values(counts).reduce((sum, n) => sum + n, 0);

  console.log('\n' + '='.repeat(66));
  console.log('  LOGINS — password for every account: password123');
  console.log('='.repeat(66));
  console.log('  admin@karigari.com'.padEnd(34) + 'ADMIN'.padEnd(22) + '—');
  for (const c of credentials) {
    console.log('  ' + c.email.padEnd(32) + c.craft.padEnd(30) + `${c.items} items`);
  }

  console.log('\n' + '='.repeat(66));
  console.log('  DATA');
  console.log('='.repeat(66));
  console.log(`  Artisans:              ${ARTISANS.length}`);
  console.log(`  Craft items:           ${totalItems}`);
  for (const [status, n] of Object.entries(counts).sort()) {
    console.log(`    ${status.padEnd(21)}${n}`);
  }
  console.log(`  Listed on marketplace: ${listed}`);
  console.log(`  Sold (escrow settled): ${sold}`);
  console.log(`  Pricing flags — under:  ${underpriced}`);
  console.log(`  Pricing flags — over:   ${overpriced}`);
  console.log(`  Scheme applications:   ${schemeSeeds.length}`);
  console.log(`  Creators (influencers): ${CREATORS.length}`);
  console.log(`  Buyer demands:         ${demandCount}`);
  console.log(`  Notifications:         ${notificationSeeds.length}`);

  console.log('\n' + '='.repeat(66));
  console.log('  IMAGES');
  console.log('='.repeat(66));
  console.log(`  Real photographs (Wikimedia Commons): ${images.report.real}`);
  console.log(`  Generated fallbacks:                  ${images.report.generated}`);
  console.log(`  QR verification composites:           ${verifiedImages}`);
  console.log(`  QR codes encode: ${BASE_URL}/verify/<patchId>`);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
