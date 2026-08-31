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
import { estimateCraftValuation } from '../src/lib/pricing';
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
    upiId: 'lakshmimeher@okhdfcbank',
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
    upiId: 'raghunathm@okaxis',
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
    upiId: 'anithareddy@ybl',
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
    upiId: 'imrankhokhar@okhdfcbank',
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
    upiId: 'budhramv@ybl',
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
    upiId: 'jethibenr@okaxis',
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
  ],
};

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

  const images = await buildSeedImages(3, ARTISANS.length);
  console.log('');

  // FK-safe wipe, unchanged order.
  await prisma.auditLog.deleteMany();
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
      // Asking price sits just inside the upper half of the band.
      const askingPrice = round(
        valuation.marketPriceMin + (valuation.marketPriceMax - valuation.marketPriceMin) * 0.55
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
          stripeSessionId: isSold ? `cs_test_${patchId?.slice(6, 18).toLowerCase()}` : null,
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
            actorId: 'STRIPE_CHECKOUT',
            actorRole: 'SYSTEM',
            comments:
              'Buyer opened a Stripe TEST checkout session. Funds are held in escrow; the artisan VPA on file is locked in as the payout destination. No admin can release or redirect this.',
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

  /* ---- Buyer demand board -------------------------------------------- */
  await prisma.demand.createMany({
    data: [
      { craftType: 'Sambalpuri Ikat Silk Saree', quantity: 40, targetPriceMin: 9000, targetPriceMax: 14000, location: 'Bhubaneswar, Odisha', festival: 'Raja Parba', buyerName: 'Utkal Handloom Emporium', notes: 'Bulk order for the festival window. Prefer GI-tagged weavers.', status: 'OPEN', createdAt: daysAgo(6) },
      { craftType: 'Pattachitra Painting', quantity: 15, targetPriceMin: 6000, targetPriceMax: 18000, location: 'New Delhi', festival: null, buyerName: 'Crafts Museum Store', notes: 'Jagannath and Dasavatara subjects preferred.', status: 'OPEN', createdAt: daysAgo(11) },
      { craftType: 'Pochampally Ikat', quantity: 60, targetPriceMin: 7000, targetPriceMax: 12000, location: 'Hyderabad, Telangana', festival: 'Bathukamma', buyerName: 'Telangana State Emporium', notes: 'Double ikat only. Need GI certification on file.', status: 'MATCHED', createdAt: daysAgo(20) },
      { craftType: 'Jaipur Blue Pottery', quantity: 120, targetPriceMin: 900, targetPriceMax: 2600, location: 'Jaipur, Rajasthan', festival: 'Diwali', buyerName: 'Rajasthali Retail', notes: 'Mixed vases, bowls and knobs for the Diwali gifting range.', status: 'OPEN', createdAt: daysAgo(3) },
      { craftType: 'Dhokra Brass Figurine', quantity: 25, targetPriceMin: 3500, targetPriceMax: 9000, location: 'Raipur, Chhattisgarh', festival: null, buyerName: 'Bastar Art Collective', notes: 'Tribal musician and animal forms.', status: 'OPEN', createdAt: daysAgo(9) },
      { craftType: 'Kutch Mirror Embroidery', quantity: 35, targetPriceMin: 2500, targetPriceMax: 7000, location: 'Ahmedabad, Gujarat', festival: 'Navratri', buyerName: 'Gurjari Handicrafts', notes: 'Toran and chakla pieces for the Navratri display.', status: 'OPEN', createdAt: daysAgo(14) },
    ],
  });

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
  console.log(`  Scheme applications:   ${schemeSeeds.length}`);
  console.log(`  Buyer demands:         6`);
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
