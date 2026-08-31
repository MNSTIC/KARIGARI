import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** Same rule as src/lib/pricing.ts — accepted price more than 30% below the AI fair floor. */
const FAIR_WAGE_TOLERANCE = 0.7;

function flagFor(fairWageFloor: number, salePrice: number | null) {
  if (salePrice === null || !fairWageFloor) return { pricingFlag: false, flagReason: null };
  if (salePrice >= fairWageFloor * FAIR_WAGE_TOLERANCE) return { pricingFlag: false, flagReason: null };
  const pctBelow = Math.round(((fairWageFloor - salePrice) / fairWageFloor) * 100);
  return {
    pricingFlag: true,
    flagReason: `Accepted price ${pctBelow}% below AI fair wage floor`,
  };
}

/**
 * Explicit shape for the artisan seeds so the array element type does not get
 * narrowed off the first entry. `socialCategory` is optional on purpose: an
 * artisan who has never declared it must reach the eligibility engine as
 * undefined so NSFDC/NBCFDC resolve to INFO_NEEDED rather than INELIGIBLE.
 */
type ArtisanSeed = {
  key: string;
  name: string;
  email: string;
  craftType: string;
  location: string;
  clusterName: string;
  mobileNumber: string;
  experienceYears: number;
  description: string;
  tags: string[];
  healthScore: number;
  upiId: string;
  giTagCertified: boolean;
  giTagName: string | null;
  socialCategory?: string;
  /** Drives the GeM Womaniya (women-owned) 3% sub-target. */
  gender: string;
  annualIncome: number;
  aadhaarLast4: string;
  photoUrl: string;
};

type SeedItem = {
  key: string;
  artisan: string;
  craftType: string;
  catalogMethod: 'VOICE' | 'MANUAL';
  voiceLanguage: string;
  descriptionOriginal: string;
  descriptionEnglish: string;
  aiGeneratedListing: string;
  rawMaterialCost: number;
  laborDays: number;
  fairWageFloor: number;
  salePrice: number | null;
  advancePaid: number;
  status: string;
  patchId: string | null;
  createdDaysAgo: number;
  tags: string[];
};

async function main() {
  console.log('Seeding KARIGARI database...');

  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.demand.deleteMany();
  await prisma.schemeApplication.deleteMany();
  await prisma.craftItem.deleteMany();
  await prisma.artisanProfile.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 10);

  // ---------------------------------------------------------------------
  // 1. The single admin. One ADMIN role opens both admin dashboards.
  // ---------------------------------------------------------------------
  const admin = await prisma.user.create({
    data: {
      id: 'cooperative-admin-001',
      name: 'Cooperative Admin',
      email: 'superadmin@karigari.com',
      passwordHash,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      patchBankBalance: 4873,
      patchBankIssued: 127,
    },
  });
  console.log('Admin created:', admin.email);

  // ---------------------------------------------------------------------
  // 2. Artisans across three clusters (real mobile numbers + income baselines)
  // ---------------------------------------------------------------------
  const artisanSeeds: ArtisanSeed[] = [
    {
      key: 'lakshmi',
      name: 'Lakshmi Devi',
      email: 'lakshmi@karigari.com',
      craftType: 'Pochampally Ikat',
      location: 'Pochampally, Telangana',
      clusterName: 'Pochampally Weavers Cooperative',
      mobileNumber: '9876543210',
      experienceYears: 15,
      description: 'Master weaver specializing in double-ikat silk sarees.',
      tags: ['Ikat', 'Silk', 'Handloom', 'GI Tag'],
      healthScore: 95,
      upiId: 'lakshmi@upi',
      giTagCertified: true,
      giTagName: 'Pochampally Ikat',
      socialCategory: 'OBC',
      gender: 'FEMALE',
      annualIncome: 180000,
      aadhaarLast4: '4523',
      photoUrl: '/female_artisan.jpg',
    },
    {
      key: 'sunita',
      name: 'Sunita Meher',
      email: 'sunita@karigari.com',
      craftType: 'Sambalpuri Bandha',
      location: 'Bargarh, Odisha',
      clusterName: 'Bargarh Handloom Cluster',
      mobileNumber: '9437221190',
      experienceYears: 22,
      description: 'Third-generation tie-and-dye Bandha weaver.',
      tags: ['Sambalpuri', 'Bandha', 'Cotton'],
      healthScore: 72,
      upiId: 'sunita@upi',
      giTagCertified: true,
      giTagName: 'Sambalpuri Bandha',
      socialCategory: 'SC',
      gender: 'FEMALE',
      annualIncome: 96000,
      aadhaarLast4: '7781',
      photoUrl: '/female_artisan.jpg',
    },
    {
      key: 'ramesh',
      name: 'Ramesh Bhoi',
      email: 'ramesh@karigari.com',
      craftType: 'Sonepuri Silk',
      location: 'Sonepur, Odisha',
      clusterName: 'Bargarh Handloom Cluster',
      mobileNumber: '9438110245',
      experienceYears: 9,
      description: 'Weaves Sonepuri silk sarees on a pit loom with his family.',
      tags: ['Sonepuri', 'Silk', 'Handloom'],
      healthScore: 64,
      upiId: 'ramesh@upi',
      giTagCertified: false,
      giTagName: null,
      socialCategory: 'ST',
      gender: 'MALE',
      annualIncome: 84000,
      aadhaarLast4: '3390',
      photoUrl: '/ikat_saree.jpg',
    },
    {
      key: 'anita',
      name: 'Anita Devi',
      email: 'anita@karigari.com',
      craftType: 'Banarasi Silk',
      location: 'Varanasi, Uttar Pradesh',
      clusterName: 'Varanasi Silk Cluster',
      mobileNumber: '9125553301',
      experienceYears: 18,
      description: 'Zari brocade specialist working with real silver thread.',
      tags: ['Banarasi', 'Silk', 'Zari'],
      healthScore: 88,
      upiId: 'anita@upi',
      giTagCertified: true,
      giTagName: 'Banaras Brocades and Sarees',
      socialCategory: 'OBC',
      gender: 'FEMALE',
      annualIncome: 210000,
      aadhaarLast4: '9012',
      photoUrl: '/female_artisan.jpg',
    },
    {
      key: 'mohan',
      name: 'Mohan Prajapati',
      email: 'mohan@karigari.com',
      craftType: 'Khurja Pottery',
      location: 'Khurja, Uttar Pradesh',
      clusterName: 'Khurja Pottery Cluster',
      mobileNumber: '9719004488',
      experienceYears: 27,
      description: 'Terracotta and blue-pottery potter, no smartphone of his own.',
      tags: ['Terracotta', 'Pottery', 'Blue Pottery'],
      healthScore: 58,
      upiId: 'mohan@upi',
      giTagCertified: false,
      giTagName: null,
      socialCategory: 'SC',
      gender: 'MALE',
      annualIncome: 72000,
      aadhaarLast4: '6644',
      photoUrl: '/ikat_saree.jpg',
    },
    {
      // Filigree maps onto the Goldsmith (Sonar) notified trade, so Devi is the
      // one artisan the PM Vishwakarma trade rule can actually pass. Her social
      // category is deliberately unset and she is seeded with NO craft items:
      // that combination demonstrates the INFO_NEEDED branch (NSFDC/NBCFDC) and
      // the ONDC "verify & list at least one product first" blocker on one card.
      key: 'devi',
      name: 'Devi Prasad',
      email: 'devi@karigari.com',
      craftType: 'Cuttack Silver Filigree',
      location: 'Cuttack, Odisha',
      clusterName: 'Cuttack Filigree Cluster',
      mobileNumber: '9812340077',
      experienceYears: 9,
      description: 'Silver filigree (tarakasi) artisan working in fine drawn wire.',
      tags: ['Filigree', 'Silver', 'Tarakasi'],
      healthScore: 90,
      upiId: 'devi@upi',
      giTagCertified: false,
      giTagName: null,
      socialCategory: undefined,
      gender: 'MALE',
      annualIncome: 150000,
      aadhaarLast4: '2287',
      photoUrl: '/female_artisan.jpg',
    },
  ];

  const artisans: Record<string, { id: string; name: string }> = {};

  for (const a of artisanSeeds) {
    const user = await prisma.user.create({
      data: {
        // Stable id: re-seeding must not invalidate a browser session that is
        // already signed in as this artisan.
        id: `artisan-${a.key}`,
        name: a.name,
        email: a.email,
        passwordHash,
        role: 'ARTISAN',
        accountStatus: 'ACTIVE',
        artisanProfile: {
          create: {
            craftType: a.craftType,
            location: a.location,
            clusterName: a.clusterName,
            mobileNumber: a.mobileNumber,
            experienceYears: a.experienceYears,
            description: a.description,
            tags: a.tags,
            healthScore: a.healthScore,
            upiId: a.upiId,
            giTagCertified: a.giTagCertified,
            giTagName: a.giTagName,
            socialCategory: a.socialCategory,
            gender: a.gender,
            annualIncome: a.annualIncome,
            aadhaarLast4: a.aadhaarLast4,
            photoUrl: a.photoUrl,
          },
        },
      },
    });
    artisans[a.key] = { id: user.id, name: user.name };
  }
  const clusterCount = new Set(artisanSeeds.map((a) => a.clusterName)).size;
  console.log(`${artisanSeeds.length} artisans created across ${clusterCount} clusters`);
  console.log('--- ARTISAN ACCOUNTS (password: password123) ---');
  for (const a of artisanSeeds) {
    console.log(`- ${a.email} (${a.craftType})`);
  }
  console.log('------------------------------------------------');

  // ---------------------------------------------------------------------
  // 3. Craft items. descriptionOriginal is the raw regional transcript,
  //    descriptionEnglish is the AI translation — Voice QA compares them.
  // ---------------------------------------------------------------------
  const itemSeeds: SeedItem[] = [
    // --- Lakshmi (Telugu) ---
    {
      key: 'lak-001',
      artisan: 'lakshmi',
      craftType: 'Pochampally Ikat Silk Saree',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Telugu',
      descriptionOriginal:
        'ఈ చీరను స్వచ్ఛమైన మల్బరీ పట్టుతో డబుల్ ఇకత్ పద్ధతిలో చేతితో నేశాను. పద్దెనిమిది రోజులు పట్టింది, పట్టు నూలుకు రెండు వేల ఐదు వందల రూపాయలు ఖర్చు అయ్యింది.',
      descriptionEnglish:
        'Hand-woven double-ikat saree in pure mulberry silk. Took eighteen days of loom work; the silk yarn cost two thousand five hundred rupees.',
      aiGeneratedListing:
        'Authentic Pochampally Ikat Silk Saree, GI-tagged and hand-woven over 18 days using the traditional double-ikat resist-dye technique. Pure mulberry silk with a fast-dye geometric motif.',
      rawMaterialCost: 2500,
      laborDays: 18,
      fairWageFloor: 5200,
      salePrice: 1500, // <-- exploited: 71% below the AI fair wage floor
      advancePaid: 1200,
      status: 'SOLD_FINAL',
      patchId: 'PATCH-LAK-001',
      createdDaysAgo: 12,
      tags: ['Ikat', 'Silk', 'Saree'],
    },
    {
      key: 'lak-002',
      artisan: 'lakshmi',
      craftType: 'Cotton Ikat Dupatta',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Telugu',
      descriptionOriginal:
        'ఇది మెత్తని నూలుతో చేసిన దుపట్టా, సాంప్రదాయ ఇకత్ డిజైన్‌తో. మూడు రోజులు పట్టింది, నూలుకు ఎనిమిది వందల రూపాయలు అయ్యింది.',
      descriptionEnglish:
        'Soft cotton dupatta carrying classic ikat motifs. Three days on the loom; eight hundred rupees of cotton yarn.',
      aiGeneratedListing:
        'Breathable handloom Cotton Ikat Dupatta with classic Pochampally motifs. Light enough for daily wear, dyed with colour-fast natural pigments.',
      rawMaterialCost: 800,
      laborDays: 3,
      fairWageFloor: 1980,
      salePrice: null,
      advancePaid: 0,
      status: 'PENDING_VERIFICATION',
      patchId: null,
      createdDaysAgo: 2,
      tags: ['Ikat', 'Cotton', 'Dupatta'],
    },
    {
      key: 'lak-003',
      artisan: 'lakshmi',
      craftType: 'Double Ikat Silk Yardage',
      catalogMethod: 'MANUAL',
      voiceLanguage: 'English',
      descriptionOriginal:
        'Five metres of double ikat silk yardage, warp and weft both resist-dyed before weaving.',
      descriptionEnglish:
        'Five metres of double ikat silk yardage, warp and weft both resist-dyed before weaving.',
      aiGeneratedListing:
        'Five metres of premium double-ikat silk yardage. Both warp and weft are resist-dyed before weaving, giving the motif identical clarity on either face.',
      rawMaterialCost: 3400,
      laborDays: 22,
      fairWageFloor: 6800,
      salePrice: 8400,
      advancePaid: 3400,
      status: 'SOLD_FINAL',
      patchId: 'PATCH-LAK-003',
      createdDaysAgo: 25,
      tags: ['Ikat', 'Silk', 'Yardage'],
    },

    // --- Sunita (Odia) ---
    {
      key: 'sun-001',
      artisan: 'sunita',
      craftType: 'Sambalpuri Bandha Saree',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Odia',
      descriptionOriginal:
        'ଏହି ଶାଢ଼ୀଟି ଶୁଦ୍ଧ ସମ୍ବଲପୁରୀ ବନ୍ଧ କଳାରେ ହାତରେ ବୁଣା ହୋଇଛି। ପନ୍ଦର ଦିନ ଲାଗିଛି ଏବଂ ସୂତା ପାଇଁ ଦୁଇ ହଜାର ଟଙ୍କା ଖର୍ଚ୍ଚ ହୋଇଛି।',
      descriptionEnglish:
        'Hand-woven in the pure Sambalpuri Bandha tie-and-dye tradition. Fifteen days of work and two thousand rupees of yarn.',
      aiGeneratedListing:
        'GI-tagged Sambalpuri Bandha Saree, tie-dyed thread by thread before weaving. Fifteen days of loom work by a third-generation Bargarh weaver.',
      rawMaterialCost: 2000,
      laborDays: 15,
      fairWageFloor: 4400,
      salePrice: 5600,
      advancePaid: 2200,
      status: 'SOLD_FINAL',
      patchId: 'PATCH-SUN-001',
      createdDaysAgo: 20,
      tags: ['Sambalpuri', 'Bandha', 'Saree'],
    },
    {
      key: 'sun-002',
      artisan: 'sunita',
      craftType: 'Sambalpuri Cotton Stole',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Odia',
      descriptionOriginal:
        'ଏହା ଏକ ହାଲୁକା ସୂତା ଷ୍ଟୋଲ୍, ପାରମ୍ପରିକ ପାଶାପାଲି ଡିଜାଇନ୍ ସହିତ। ଚାରି ଦିନ ଲାଗିଛି।',
      descriptionEnglish:
        'A light cotton stole with the traditional Pasapali chequer design. Four days of work.',
      aiGeneratedListing:
        'Lightweight Sambalpuri cotton stole in the traditional Pasapali chequerboard pattern. Soft, breathable and hand-finished.',
      rawMaterialCost: 550,
      laborDays: 4,
      fairWageFloor: 1450,
      salePrice: null,
      advancePaid: 0,
      status: 'PENDING_VERIFICATION',
      patchId: null,
      createdDaysAgo: 1,
      tags: ['Sambalpuri', 'Cotton', 'Stole'],
    },
    {
      key: 'sun-003',
      artisan: 'sunita',
      craftType: 'Bandha Bed Cover',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Odia',
      descriptionOriginal:
        'ଡବଲ୍ ବେଡ୍ ପାଇଁ ବନ୍ଧ କଳାର ଚାଦର। ଆଠ ଦିନ ଲାଗିଛି ଏବଂ ସୂତା ପାଇଁ ଏଗାର ଶହ ଟଙ୍କା ଖର୍ଚ୍ଚ ହୋଇଛି।',
      descriptionEnglish:
        'A Bandha tie-and-dye bed cover for a double bed. Eight days of work and eleven hundred rupees of yarn.',
      aiGeneratedListing:
        'Double-bed Sambalpuri Bandha bed cover, tie-dyed and hand-woven over eight days. Heavy cotton that softens with every wash.',
      rawMaterialCost: 1100,
      laborDays: 8,
      fairWageFloor: 3200,
      salePrice: null,
      advancePaid: 1600,
      status: 'ADVANCE_PAID',
      patchId: 'PATCH-SUN-003',
      createdDaysAgo: 6,
      tags: ['Sambalpuri', 'Bandha', 'Home'],
    },

    // --- Ramesh (Odia) ---
    {
      key: 'ram-001',
      artisan: 'ramesh',
      craftType: 'Sonepuri Silk Saree',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Odia',
      descriptionOriginal:
        'ସୋନପୁରୀ ପଟ୍ଟ ଶାଢ଼ୀ, ପାରମ୍ପରିକ ବନ୍ଧ ନମୁନା ସହିତ ହାତରେ ବୁଣା। ଷୋହଳ ଦିନ ଲାଗିଛି।',
      descriptionEnglish:
        'Sonepuri silk saree, hand-woven with traditional Bandha motifs. Sixteen days of work.',
      aiGeneratedListing:
        'Handloom Sonepuri Silk Saree woven on a pit loom over sixteen days, carrying traditional Bandha motifs in natural dyes.',
      rawMaterialCost: 2400,
      laborDays: 16,
      fairWageFloor: 5000,
      salePrice: 3050, // <-- flagged: 39% below the AI fair wage floor
      advancePaid: 1500,
      status: 'SOLD_FINAL',
      patchId: 'PATCH-RAM-001',
      createdDaysAgo: 9,
      tags: ['Sonepuri', 'Silk', 'Saree'],
    },
    {
      key: 'ram-002',
      artisan: 'ramesh',
      craftType: 'Cotton Gamucha Set',
      catalogMethod: 'MANUAL',
      voiceLanguage: 'English',
      descriptionOriginal: 'Set of four handwoven cotton gamuchas with red border.',
      descriptionEnglish: 'Set of four handwoven cotton gamuchas with red border.',
      aiGeneratedListing:
        'Set of four hand-woven Odia cotton gamuchas with the classic red border. Quick-drying, absorbent, and made entirely on a handloom.',
      rawMaterialCost: 320,
      laborDays: 2,
      fairWageFloor: 900,
      salePrice: null,
      advancePaid: 0,
      status: 'VERIFIED',
      patchId: 'PATCH-RAM-002',
      createdDaysAgo: 4,
      tags: ['Cotton', 'Gamucha'],
    },

    // --- Anita (Hindi) ---
    {
      key: 'ani-001',
      artisan: 'anita',
      craftType: 'Banarasi Silk Saree',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Hindi',
      descriptionOriginal:
        'यह बनारसी रेशमी साड़ी असली चाँदी की ज़री से हाथ से बुनी गई है। इसमें बाईस दिन लगे और कच्चे माल पर चार हज़ार रुपये खर्च हुए।',
      descriptionEnglish:
        'This Banarasi silk saree is hand-woven with real silver zari. It took twenty-two days and four thousand rupees of raw material.',
      aiGeneratedListing:
        'Hand-woven Banarasi Silk Saree with genuine silver zari brocade. Twenty-two days on the loom in the GI-tagged Varanasi tradition.',
      rawMaterialCost: 4000,
      laborDays: 22,
      fairWageFloor: 9200,
      salePrice: 12500,
      advancePaid: 4600,
      status: 'SOLD_FINAL',
      patchId: 'PATCH-ANI-001',
      createdDaysAgo: 18,
      tags: ['Banarasi', 'Silk', 'Zari'],
    },
    {
      key: 'ani-002',
      artisan: 'anita',
      craftType: 'Banarasi Brocade Dupatta',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Hindi',
      descriptionOriginal:
        'यह दुपट्टा शुद्ध कातान रेशम पर ज़री की बूटियों के साथ बुना है। सात दिन लगे।',
      descriptionEnglish:
        'This dupatta is woven on pure katan silk with zari buti motifs. It took seven days.',
      aiGeneratedListing:
        'Pure katan silk Banarasi dupatta scattered with hand-woven zari buti motifs. Seven days of loom work, finished with a hand-knotted fringe.',
      rawMaterialCost: 1500,
      laborDays: 7,
      fairWageFloor: 3600,
      salePrice: null,
      advancePaid: 0,
      status: 'PENDING_VERIFICATION',
      patchId: null,
      createdDaysAgo: 1,
      tags: ['Banarasi', 'Silk', 'Dupatta'],
    },
    {
      key: 'ani-003',
      artisan: 'anita',
      craftType: 'Zari Border Yardage',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Hindi',
      descriptionOriginal:
        'तीन मीटर ज़री बॉर्डर वाला कपड़ा, नौ दिन में तैयार हुआ। धागे पर अठारह सौ रुपये लगे।',
      descriptionEnglish:
        'Three metres of zari-bordered fabric, finished in nine days. Eighteen hundred rupees spent on thread.',
      aiGeneratedListing:
        'Three metres of Banarasi yardage with a woven zari border, ready to be tailored into a lehenga or kurta set.',
      rawMaterialCost: 1800,
      laborDays: 9,
      fairWageFloor: 4100,
      salePrice: null,
      advancePaid: 2000,
      status: 'ADVANCE_PAID',
      patchId: 'PATCH-ANI-003',
      createdDaysAgo: 5,
      tags: ['Banarasi', 'Zari', 'Yardage'],
    },

    // --- Mohan (Hindi) ---
    {
      key: 'moh-001',
      artisan: 'mohan',
      craftType: 'Khurja Terracotta Planter Set',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Hindi',
      descriptionOriginal:
        'चाक पर बने छह टेराकोटा गमले, हाथ से रंगे हुए। पाँच दिन लगे और मिट्टी पर छह सौ रुपये खर्च हुए।',
      descriptionEnglish:
        'Six terracotta planters thrown on the wheel and hand-painted. Five days of work and six hundred rupees of clay.',
      aiGeneratedListing:
        'Set of six wheel-thrown Khurja terracotta planters, hand-painted and kiln-fired. Porous walls keep roots healthy.',
      rawMaterialCost: 600,
      laborDays: 5,
      fairWageFloor: 1800,
      salePrice: 2400,
      advancePaid: 900,
      status: 'SOLD_FINAL',
      patchId: 'PATCH-MOH-001',
      createdDaysAgo: 15,
      tags: ['Terracotta', 'Pottery', 'Home'],
    },
    {
      key: 'moh-002',
      artisan: 'mohan',
      craftType: 'Blue Pottery Dinner Set',
      catalogMethod: 'VOICE',
      voiceLanguage: 'Hindi',
      descriptionOriginal:
        'नीली पॉटरी का खाने का सेट, आठ टुकड़े। सात दिन लगे, कच्चे माल पर नौ सौ रुपये खर्च हुए।',
      descriptionEnglish:
        'Blue pottery dinner set of eight pieces. Seven days of work, nine hundred rupees of raw material.',
      aiGeneratedListing:
        'Eight-piece Khurja blue pottery dinner set, glazed by hand in cobalt and turquoise. Food-safe and dishwasher-friendly.',
      rawMaterialCost: 900,
      laborDays: 7,
      fairWageFloor: 2600,
      salePrice: null,
      advancePaid: 0,
      status: 'PENDING_VERIFICATION',
      patchId: null,
      createdDaysAgo: 3,
      tags: ['Blue Pottery', 'Dinnerware'],
    },
    {
      key: 'moh-003',
      artisan: 'mohan',
      craftType: 'Terracotta Wall Mural',
      catalogMethod: 'MANUAL',
      voiceLanguage: 'English',
      descriptionOriginal: 'Large terracotta wall mural panel, hand-carved village scene.',
      descriptionEnglish: 'Large terracotta wall mural panel, hand-carved village scene.',
      aiGeneratedListing:
        'Large hand-carved terracotta wall mural depicting a village scene. Kiln-fired in a single piece and sealed for indoor display.',
      rawMaterialCost: 1200,
      laborDays: 11,
      fairWageFloor: 3400,
      salePrice: null,
      advancePaid: 0,
      status: 'VERIFIED',
      patchId: 'PATCH-MOH-002',
      createdDaysAgo: 8,
      tags: ['Terracotta', 'Mural', 'Decor'],
    },
  ];

  const createdItems: Record<string, { id: string; createdAt: Date }> = {};

  for (const s of itemSeeds) {
    const { pricingFlag, flagReason } = flagFor(s.fairWageFloor, s.salePrice);
    const createdAt = daysAgo(s.createdDaysAgo);
    const isSettled = s.status === 'SOLD_FINAL';

    const item = await prisma.craftItem.create({
      data: {
        artisanId: artisans[s.artisan].id,
        assignedAdminId: s.status === 'PENDING_VERIFICATION' ? null : admin.id,
        patchId: s.patchId,
        craftType: s.craftType,
        descriptionOriginal: s.descriptionOriginal,
        descriptionEnglish: s.descriptionEnglish,
        aiGeneratedListing: s.aiGeneratedListing,
        aiSuggestedCategory: s.tags[0],
        tags: s.tags,
        images: ['/ikat_saree.jpg'],
        rawMaterialCost: s.rawMaterialCost,
        laborDays: s.laborDays,
        fairWageFloor: s.fairWageFloor,
        standardMarketPrice: Math.round(s.fairWageFloor * 1.4),
        marketPriceMin: Math.round(s.fairWageFloor * 1.2),
        marketPriceMax: Math.round(s.fairWageFloor * 1.6),
        fairnessScore: pricingFlag ? 42 : 95,
        creditScore: 85.5,
        status: s.status,
        advancePaid: s.advancePaid,
        finalPayoutQueued: isSettled ? Math.max(0, (s.salePrice ?? 0) - s.advancePaid) : 0,
        salePrice: s.salePrice,
        isListedOnMarketplace: s.status !== 'PENDING_VERIFICATION',
        catalogMethod: s.catalogMethod,
        voiceLanguage: s.voiceLanguage,
        audioUrl: null, // no audio blob is persisted yet — the QA player degrades gracefully
        pricingFlag,
        flagReason,
        createdAt,
      },
    });

    createdItems[s.key] = { id: item.id, createdAt };

    // ------- Immutable hash-chain: Created -> Verified -> Sold -------
    const chain: { action: string; actorRole: string; comments: string; offsetDays: number }[] = [
      {
        action: s.catalogMethod === 'VOICE' ? 'VOICE_CATALOG_CREATED' : 'UPLOAD_CREATED',
        actorRole: 'ARTISAN',
        comments:
          s.catalogMethod === 'VOICE'
            ? `Artisan catalogued ${s.craftType} by voice in ${s.voiceLanguage}. AI translated the transcript and estimated a fair wage floor of Rs ${s.fairWageFloor.toLocaleString('en-IN')}.`
            : `Artisan typed the listing for ${s.craftType}. AI estimated a fair wage floor of Rs ${s.fairWageFloor.toLocaleString('en-IN')}.`,
        offsetDays: 0,
      },
    ];

    if (s.status !== 'PENDING_VERIFICATION') {
      chain.push({
        action: 'ADMIN_VERIFIED',
        actorRole: 'ADMIN',
        comments: `Admin verified the AI valuation and attached Patch ID: ${s.patchId}.`,
        offsetDays: 0.5,
      });
    }
    if (s.advancePaid > 0) {
      chain.push({
        action: 'ADVANCE_DISBURSED',
        actorRole: 'ADMIN',
        comments: `Same-day advance of Rs ${s.advancePaid.toLocaleString('en-IN')} disbursed to the artisan's UPI.`,
        offsetDays: 1,
      });
    }
    if (isSettled) {
      chain.push({
        action: 'UPI_PAYMENT_PROCESSED',
        actorRole: 'ADMIN',
        comments: `Sale settled at Rs ${(s.salePrice ?? 0).toLocaleString('en-IN')}. Final payout of Rs ${Math.max(0, (s.salePrice ?? 0) - s.advancePaid).toLocaleString('en-IN')} released to the artisan.`,
        offsetDays: 2,
      });
    }
    if (pricingFlag) {
      chain.push({
        action: 'PRICING_FLAG_RAISED',
        actorRole: 'SYSTEM',
        comments: `${flagReason}. Held for facilitator review under the anti-exploitation policy.`,
        offsetDays: 2.1,
      });
    }

    for (const step of chain) {
      await prisma.auditLog.create({
        data: {
          craftItemId: item.id,
          actorId: step.actorRole === 'ARTISAN' ? artisans[s.artisan].id : admin.id,
          actorRole: step.actorRole,
          action: step.action,
          comments: step.comments,
          createdAt: new Date(createdAt.getTime() + step.offsetDays * DAY),
        },
      });
    }
  }
  console.log(`${itemSeeds.length} craft items seeded with full audit chains`);

  const flagged = itemSeeds.filter((s) => flagFor(s.fairWageFloor, s.salePrice).pricingFlag);
  console.log(`   ${flagged.length} pricing flags raised: ${flagged.map((f) => f.craftType).join(', ')}`);

  // ---------------------------------------------------------------------
  // 4. Scheme applications (artisan-side dashboards read these)
  // ---------------------------------------------------------------------
  //
  // These rows are the artisan's *tracking* record of an application they made
  // through the official channel — KARIGARI never submits anything to a
  // government system. Every row therefore has to agree with what the rules
  // engine in src/lib/schemes.ts would say about that artisan, otherwise the
  // tracker and the eligibility card contradict each other on screen.
  //
  // Two deliberate omissions:
  //   * No pm_vishwakarma row for any weaver. Handloom weaving is not one of
  //     the 18 notified trades, so the engine returns INELIGIBLE for Lakshmi,
  //     Sunita, Ramesh and Anita — a tracked row would be a visible lie.
  //   * Mohan (potter) and Lakshmi's ONDC are left untracked so the live demo
  //     can click Apply, tick the self-declarations and watch a card move.
  //
  const schemeApplicationSeeds: {
    userId: string;
    schemeKey: string;
    schemeName: string;
    status: string;
    appliedAt: Date;
    notes: string;
  }[] = [
    // --- Lakshmi: OBC, income Rs 1.8L, in a cooperative, Aadhaar + UPI on file,
    //     verified marketplace items. Passes nbcfdc, ahvy and gem_seller.
    {
      userId: artisans.lakshmi.id,
      schemeKey: 'nbcfdc',
      schemeName: 'NBCFDC — National Backward Classes Finance & Development Corporation',
      status: 'DISBURSED',
      appliedAt: daysAgo(40),
      notes: 'Concessional term loan sanctioned and disbursed through the state channel partner.',
    },
    {
      userId: artisans.lakshmi.id,
      schemeKey: 'ahvy',
      schemeName: 'AHVY — Ambedkar Hastshilp Vikas Yojana',
      status: 'APPROVED',
      appliedAt: daysAgo(25),
      notes: 'Cluster proposal approved through the Pochampally Weavers Cooperative.',
    },
    {
      userId: artisans.lakshmi.id,
      schemeKey: 'gem_seller',
      schemeName: 'GeM Seller Registration',
      status: 'UNDER_REVIEW',
      appliedAt: daysAgo(6),
      notes: 'Seller profile submitted on GeM. Awaiting vendor assessment.',
    },

    // --- Sunita: SC, income Rs 96,000 — passes nsfdc.
    {
      userId: artisans.sunita.id,
      schemeKey: 'nsfdc',
      schemeName: 'NSFDC — National Scheduled Castes Finance & Development Corporation',
      status: 'APPROVED',
      appliedAt: daysAgo(30),
      notes: 'Approved by the Bargarh State Channelizing Agency.',
    },

    // --- Ramesh: ST, in the Bargarh cluster — passes ahvy (not nsfdc/nbcfdc).
    {
      userId: artisans.ramesh.id,
      schemeKey: 'ahvy',
      schemeName: 'AHVY — Ambedkar Hastshilp Vikas Yojana',
      status: 'APPLIED',
      appliedAt: daysAgo(4),
      notes: 'Application started through the Bargarh Handloom Cluster.',
    },

    // --- Mohan, Anita, Devi: intentionally no rows.
  ];

  await prisma.schemeApplication.createMany({ data: schemeApplicationSeeds });
  console.log(`${schemeApplicationSeeds.length} scheme applications seeded`);

  // ---------------------------------------------------------------------
  // 5. Buyer demand board. Every surface that used to hardcode a demand pin
  //    (the insights map, the WhatsApp simulation, the buyer ticket) reads
  //    these rows, so the demo has real data on first load.
  // ---------------------------------------------------------------------
  const demandSeeds: {
    id: string;
    craftType: string;
    quantity: number;
    targetPriceMin: number;
    targetPriceMax: number;
    location: string;
    festival: string | null;
    buyerName: string;
    notes: string;
    status: string;
    createdAt: Date;
  }[] = [
    {
      id: 'demand-delhi-sambalpuri',
      craftType: 'Sambalpuri Bandha',
      quantity: 50,
      targetPriceMin: 3500,
      targetPriceMax: 4000,
      location: 'Delhi NCR',
      festival: 'Diwali',
      buyerName: 'Rajesh Retailers',
      notes: 'Festive collection for 12 stores. Needs GI-tagged handloom only.',
      status: 'OPEN',
      createdAt: daysAgo(1),
    },
    {
      id: 'demand-mumbai-pochampally',
      craftType: 'Pochampally Ikat',
      quantity: 120,
      targetPriceMin: 4200,
      targetPriceMax: 5200,
      location: 'Mumbai',
      festival: 'Diwali',
      buyerName: 'Aarna Boutique Group',
      notes: 'Double-ikat silk sarees for the Diwali window. Staggered delivery accepted.',
      status: 'OPEN',
      createdAt: daysAgo(3),
    },
    {
      id: 'demand-bengaluru-banarasi',
      craftType: 'Banarasi Silk',
      quantity: 40,
      targetPriceMin: 6000,
      targetPriceMax: 8000,
      location: 'Bengaluru',
      festival: 'North Indian Wedding Season',
      buyerName: 'Tech Park Gifting Co.',
      notes: 'Bridal-grade brocade for corporate wedding gifting hampers.',
      status: 'OPEN',
      createdAt: daysAgo(5),
    },
    {
      id: 'demand-hyderabad-pottery',
      craftType: 'Khurja Pottery',
      quantity: 200,
      targetPriceMin: 450,
      targetPriceMax: 700,
      location: 'Hyderabad',
      festival: 'Ganesh Chaturthi',
      buyerName: 'Deccan Home Store',
      notes: 'Planter sets and dinnerware for the festive home decor aisle.',
      status: 'OPEN',
      createdAt: daysAgo(2),
    },
    {
      id: 'demand-kolkata-sonepuri',
      craftType: 'Sonepuri Silk',
      quantity: 60,
      targetPriceMin: 3800,
      targetPriceMax: 4600,
      location: 'Kolkata',
      festival: 'Durga Puja',
      buyerName: 'Baithak Handlooms',
      notes: 'Puja-week stock. Prefers weavers inside the Bargarh cluster.',
      status: 'OPEN',
      createdAt: daysAgo(4),
    },
    {
      id: 'demand-pune-filigree',
      craftType: 'Cuttack Silver Filigree',
      quantity: 80,
      targetPriceMin: 1800,
      targetPriceMax: 2600,
      location: 'Pune',
      festival: null,
      buyerName: 'Silverline Exports',
      notes: 'Export sampling order — already matched with a Cuttack workshop.',
      status: 'MATCHED',
      createdAt: daysAgo(12),
    },
  ];

  await prisma.demand.createMany({ data: demandSeeds });
  console.log(
    `${demandSeeds.length} buyer demands seeded (${demandSeeds.filter((d) => d.status === 'OPEN').length} open)`
  );

  // ---------------------------------------------------------------------
  // 6. Notifications. These are the rows the header bell reads and the
  //    WhatsApp/SMS simulation replays — one per artisan whose craft matches
  //    an open demand, plus a festival nudge.
  // ---------------------------------------------------------------------
  const notificationSeeds: {
    userId: string;
    type: string;
    title: string;
    message: string;
    read: boolean;
    relatedDemandId: string | null;
    channel: string;
    createdAt: Date;
  }[] = [
    {
      userId: artisans.sunita.id,
      type: 'DEMAND_ALERT',
      title: 'Demand spike: Sambalpuri Bandha',
      message:
        'Rajesh Retailers wants 50 Sambalpuri Bandha pieces in Delhi NCR at Rs 3,500-4,000 per unit for Diwali. Reply YES to list your stock.',
      read: false,
      relatedDemandId: 'demand-delhi-sambalpuri',
      channel: 'WHATSAPP',
      createdAt: daysAgo(1),
    },
    {
      userId: artisans.lakshmi.id,
      type: 'DEMAND_ALERT',
      title: 'Demand spike: Pochampally Ikat',
      message:
        'Aarna Boutique Group wants 120 Pochampally Ikat pieces in Mumbai at Rs 4,200-5,200 per unit for Diwali. Reply YES to list your stock.',
      read: false,
      relatedDemandId: 'demand-mumbai-pochampally',
      channel: 'WHATSAPP',
      createdAt: daysAgo(3),
    },
    {
      userId: artisans.ramesh.id,
      type: 'DEMAND_ALERT',
      title: 'Demand spike: Sonepuri Silk',
      message:
        'Baithak Handlooms wants 60 Sonepuri Silk pieces in Kolkata at Rs 3,800-4,600 per unit for Durga Puja. Reply YES to list your stock.',
      read: false,
      relatedDemandId: 'demand-kolkata-sonepuri',
      channel: 'SMS',
      createdAt: daysAgo(4),
    },
    {
      userId: artisans.anita.id,
      type: 'DEMAND_ALERT',
      title: 'Demand spike: Banarasi Silk',
      message:
        'Tech Park Gifting Co. wants 40 Banarasi Silk pieces in Bengaluru at Rs 6,000-8,000 per unit for the wedding season. Reply YES to list your stock.',
      read: true,
      relatedDemandId: 'demand-bengaluru-banarasi',
      channel: 'WHATSAPP',
      createdAt: daysAgo(5),
    },
    {
      userId: artisans.mohan.id,
      type: 'FESTIVAL',
      title: 'Ganesh Chaturthi is close',
      message:
        'Idol and decor demand rises before Ganesh Chaturthi. Terracotta and pottery sell out early — list your stock this week.',
      read: false,
      relatedDemandId: null,
      channel: 'IN_APP',
      createdAt: daysAgo(2),
    },
  ];

  await prisma.notification.createMany({ data: notificationSeeds });
  console.log(`${notificationSeeds.length} notifications seeded`);

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
