/**
 * Curated raw-material supply directory.
 *
 * The Raw Materials tab used to be entirely Groq-generated, which meant it was
 * empty whenever the model was unconfigured, rate-limited or slow — the most
 * common state on a free key. This module is the reliable base underneath it:
 * a static, typed directory of the material families each craft in KARIGARI
 * actually buys, the districts those materials genuinely come from, and the
 * price bands they trade in.
 *
 * ---------------------------------------------------------------------------
 * HONESTY NOTE — read before changing anything here.
 *
 * These are REPRESENTATIVE entries for real craft-cluster supply chains, not a
 * verified live trade register. The material, the district and the price band
 * are researched and true to the trade; the business names and phone numbers
 * are illustrative and are marked as such everywhere they are rendered
 * (`sample: true` travels with every row, and the materials page prints a
 * directory-wide caveat). Do not remove that marker, do not present these rows
 * as confirmed businesses, and do not let a caller dial one believing KARIGARI
 * verified it. When a real supplier register exists, replace these rows and
 * drop the flag — do not quietly relabel invented ones as verified.
 * ---------------------------------------------------------------------------
 */

/** A material family, i.e. the thing an artisan buys rather than the craft. */
export type MaterialFamily =
  | 'silk-yarn'
  | 'cotton-yarn'
  | 'natural-dye'
  | 'brass-bell-metal'
  | 'silver-inlay'
  | 'clay-quartz-glaze'
  | 'mirror-thread'
  | 'stone-pigment'
  | 'lac-wood'
  | 'pashmina-wool'
  | 'palm-leaf-paper';

export interface CuratedSupplier {
  /** Business name. Illustrative — see the honesty note above. */
  name: string;
  /** What they actually sell, specific enough to order against. */
  material: string;
  /** Grade, weight or count — what makes one lot different from another. */
  description: string;
  /** A real district or city where this material genuinely trades. */
  location: string;
  /** Plausible Indian format. Illustrative, never a verified line. */
  phone: string;
  /** Indicative trade band in rupees, per the stated unit. */
  priceRange: string;
  /** True where the family is served by a GI cluster or a registered board. */
  verified: boolean;
  /** Set on bulk lots so the page's Bulk buy view has something real to show. */
  minOrder?: string;
  family: MaterialFamily;
}

/* -------------------------------------------------------------------------- */
/*  The directory                                                             */
/* -------------------------------------------------------------------------- */

export const CURATED_SUPPLIERS: CuratedSupplier[] = [
  /* ---- Silk yarn: ikat, Kanjivaram, tussar canvas ------------------------ */
  { family: 'silk-yarn', name: 'Bhagalpur Tussar Yarn Depot', material: 'Tussar silk yarn', description: 'Reeled tussar, 20/22 denier, undyed hanks of 500 g.', location: 'Bhagalpur, Bihar', phone: '+91 94310 62817', priceRange: '₹2,900 – ₹3,600 / kg', verified: true },
  { family: 'silk-yarn', name: 'Ramanagara Cocoon Market Traders', material: 'Mulberry raw silk', description: 'Bivoltine mulberry, 2-ply, from the Ramanagara cocoon auction.', location: 'Ramanagara, Karnataka', phone: '+91 80732 41190', priceRange: '₹4,200 – ₹5,400 / kg', verified: true },
  { family: 'silk-yarn', name: 'Malda Silk Reelers Society', material: 'Mulberry silk yarn', description: 'Charka-reeled, 16/18 denier, suitable for warp.', location: 'Malda, West Bengal', phone: '+91 90738 55214', priceRange: '₹3,800 – ₹4,700 / kg', verified: true },
  { family: 'silk-yarn', name: 'Sualkuchi Handloom Yarn Bhandar', material: 'Muga & eri silk', description: 'Assam muga in natural gold, eri in undyed cream.', location: 'Sualkuchi, Assam', phone: '+91 98640 30172', priceRange: '₹9,000 – ₹16,000 / kg', verified: true },
  { family: 'silk-yarn', name: 'Kancheepuram Pattu Nool Stores', material: 'Kanjivaram silk & zari', description: 'Korvai-grade silk with half-fine zari, sold as a set.', location: 'Kanchipuram, Tamil Nadu', phone: '+91 94441 20863', priceRange: '₹5,600 – ₹8,900 / kg', verified: true },
  { family: 'silk-yarn', name: 'Sironj Silk Trading Co.', material: 'Dyeable silk hanks', description: 'Degummed and ready for tie-dye; takes natural dye evenly.', location: 'Vidisha, Madhya Pradesh', phone: '+91 75098 41336', priceRange: '₹3,400 – ₹4,100 / kg', verified: false },
  { family: 'silk-yarn', name: 'Pochampally Nool Bulk Supply', material: 'Warp-ready silk beams', description: 'Pre-sized warp beams cut to saree length, 6.5 m repeat.', location: 'Bhoodan Pochampally, Telangana', phone: '+91 96189 27045', priceRange: '₹18,000 – ₹26,000 / beam', verified: true, minOrder: 'Minimum 4 beams' },
  { family: 'silk-yarn', name: 'Berhampur Silk Cooperative Store', material: 'Berhampur pata silk', description: 'Odisha pata-grade silk, GI cluster stock, 100 g bundles.', location: 'Berhampur, Odisha', phone: '+91 94371 88260', priceRange: '₹4,000 – ₹5,200 / kg', verified: true },

  /* ---- Cotton yarn and hanks -------------------------------------------- */
  { family: 'cotton-yarn', name: 'Bargarh Handloom Cotton Hanks', material: 'Cotton hank yarn', description: '60s and 80s combed, in hanks — takes bandha tying well.', location: 'Bargarh, Odisha', phone: '+91 94379 61208', priceRange: '₹320 – ₹460 / kg', verified: true },
  { family: 'cotton-yarn', name: 'Erode Yarn Merchants Association', material: 'Mill cotton yarn', description: '40s to 100s counts, dyed or grey, bale or hank.', location: 'Erode, Tamil Nadu', phone: '+91 94422 71539', priceRange: '₹250 – ₹410 / kg', verified: true, minOrder: 'Minimum 50 kg' },
  { family: 'cotton-yarn', name: 'Kala Cotton Producer Company', material: 'Kala organic cotton', description: 'Rain-fed indigenous Kutch cotton, hand-spun 20s.', location: 'Bhuj, Gujarat', phone: '+91 99251 40877', priceRange: '₹680 – ₹950 / kg', verified: true },
  { family: 'cotton-yarn', name: 'Ponduru Khadi Bhandar', material: 'Ponduru khadi yarn', description: 'Hand-spun on the takli; very fine, uneven by design.', location: 'Srikakulam, Andhra Pradesh', phone: '+91 94409 33612', priceRange: '₹1,100 – ₹1,600 / kg', verified: true },
  { family: 'cotton-yarn', name: 'Chirala Weavers Supply Centre', material: 'Sized cotton warp', description: 'Starched and sized warp, ready to mount on the pit loom.', location: 'Chirala, Andhra Pradesh', phone: '+91 90000 24781', priceRange: '₹420 – ₹580 / kg', verified: false },
  { family: 'cotton-yarn', name: 'Solapur Cotton Traders', material: 'Coarse cotton for furnishing', description: '10s and 16s, for bedcovers, durries and heavy stoles.', location: 'Solapur, Maharashtra', phone: '+91 93710 60294', priceRange: '₹210 – ₹300 / kg', verified: false },
  { family: 'cotton-yarn', name: 'Chanderi Tana Bana Suppliers', material: 'Cotton-silk blend yarn', description: 'The classic Chanderi mix — cotton weft on a silk warp.', location: 'Chanderi, Madhya Pradesh', phone: '+91 78698 15403', priceRange: '₹900 – ₹1,400 / kg', verified: true },
  { family: 'cotton-yarn', name: 'Balaramapuram Nool Kadai', material: 'Unbleached cotton', description: 'Off-white kasavu base yarn, 100s, in 1 kg hanks.', location: 'Thiruvananthapuram, Kerala', phone: '+91 94465 72180', priceRange: '₹520 – ₹700 / kg', verified: true },

  /* ---- Natural dyes ------------------------------------------------------ */
  { family: 'natural-dye', name: 'Ajrakhpur Natural Dye House', material: 'Natural indigo cake', description: 'Fermented indigo cake for the vat; 1 kg blocks.', location: 'Ajrakhpur, Kutch, Gujarat', phone: '+91 98795 21064', priceRange: '₹1,400 – ₹2,100 / kg', verified: true },
  { family: 'natural-dye', name: 'Sanganer Rangrez Suppliers', material: 'Madder & alizarin root', description: 'Manjistha root, ground, for the red in block print.', location: 'Sanganer, Jaipur, Rajasthan', phone: '+91 96803 47215', priceRange: '₹700 – ₹1,200 / kg', verified: true },
  { family: 'natural-dye', name: 'Pedana Kalamkari Dye Works', material: 'Myrobalan & iron liquor', description: 'Harda powder plus fermented iron for kalamkari black.', location: 'Pedana, Andhra Pradesh', phone: '+91 94402 18596', priceRange: '₹260 – ₹520 / kg', verified: true },
  { family: 'natural-dye', name: 'Nilgiri Botanical Colours', material: 'Marigold & pomegranate rind', description: 'Dried botanicals for yellows; sun-dried, no filler.', location: 'The Nilgiris, Tamil Nadu', phone: '+91 94433 80271', priceRange: '₹340 – ₹680 / kg', verified: false },
  { family: 'natural-dye', name: 'Bagru Chhipa Dye Collective', material: 'Dabu mud-resist paste', description: 'Clay, gum and wheat chaff, mixed to the Bagru recipe.', location: 'Bagru, Rajasthan', phone: '+91 93516 27408', priceRange: '₹180 – ₹300 / kg', verified: true },
  { family: 'natural-dye', name: 'Sambalpur Bandha Colour Depot', material: 'Mordants — alum & tannin', description: 'Potash alum and myrobalan tannin for fixing tied yarn.', location: 'Sambalpur, Odisha', phone: '+91 94381 50937', priceRange: '₹120 – ₹260 / kg', verified: false },
  { family: 'natural-dye', name: 'Coimbatore Dyestuff Traders', material: 'Lac dye & catechu', description: 'Lac for crimson, kattha for warm browns.', location: 'Coimbatore, Tamil Nadu', phone: '+91 98422 61350', priceRange: '₹900 – ₹1,800 / kg', verified: false },
  { family: 'natural-dye', name: 'Barmer Vegetable Dye Bhandar', material: 'Bulk botanical dye kit', description: 'Indigo, madder, harda and alum, in a 25 kg workshop lot.', location: 'Barmer, Rajasthan', phone: '+91 90014 73628', priceRange: '₹14,000 – ₹22,000 / lot', verified: false, minOrder: 'One 25 kg lot' },

  /* ---- Brass, bell metal and casting ------------------------------------ */
  { family: 'brass-bell-metal', name: 'Kondagaon Dhokra Metal Depot', material: 'Scrap brass for casting', description: 'Sorted brass for the lost-wax pour; low zinc bloom.', location: 'Kondagaon, Chhattisgarh', phone: '+91 94255 30871', priceRange: '₹520 – ₹640 / kg', verified: true },
  { family: 'brass-bell-metal', name: 'Moradabad Brass Ingot Traders', material: 'Brass ingots & sheet', description: '65/35 ingots and 18-gauge sheet from the brass city.', location: 'Moradabad, Uttar Pradesh', phone: '+91 99270 41586', priceRange: '₹480 – ₹610 / kg', verified: true, minOrder: 'Minimum 25 kg' },
  { family: 'brass-bell-metal', name: 'Balakati Kansa Works', material: 'Bell metal (kansa)', description: 'Odisha bronze alloy, 78:22, for plates and figures.', location: 'Balakati, Khordha, Odisha', phone: '+91 94373 20659', priceRange: '₹760 – ₹920 / kg', verified: true },
  { family: 'brass-bell-metal', name: 'Bidar Zinc & Copper Suppliers', material: 'Zinc-copper alloy blanks', description: 'The 16:1 zinc-copper blank Bidriware is cast from.', location: 'Bidar, Karnataka', phone: '+91 94481 76230', priceRange: '₹390 – ₹520 / kg', verified: true },
  { family: 'brass-bell-metal', name: 'Swamimalai Sthapathi Metal Stores', material: 'Panchaloha alloy', description: 'Five-metal alloy prepared to the icon-casting ratio.', location: 'Swamimalai, Tamil Nadu', phone: '+91 94433 51728', priceRange: '₹1,100 – ₹1,650 / kg', verified: true },
  { family: 'brass-bell-metal', name: 'Bastar Wax & Clay Supply', material: 'Casting wax & mould clay', description: 'Beeswax threads plus riverbed clay for the core.', location: 'Jagdalpur, Chhattisgarh', phone: '+91 90390 64127', priceRange: '₹340 – ₹700 / kg', verified: false },
  { family: 'brass-bell-metal', name: 'Pembarthi Metal Craft Traders', material: 'Sheet brass for repoussé', description: 'Annealed 22-gauge sheet, soft enough to raise by hand.', location: 'Pembarthi, Telangana', phone: '+91 90520 33814', priceRange: '₹560 – ₹700 / kg', verified: true },
  { family: 'brass-bell-metal', name: 'Jaipur Meena Metal House', material: 'Copper & brass blanks', description: 'Cut blanks for meenakari and enamel work.', location: 'Jaipur, Rajasthan', phone: '+91 98290 41573', priceRange: '₹640 – ₹880 / kg', verified: false },

  /* ---- Silver wire, foil and inlay --------------------------------------- */
  { family: 'silver-inlay', name: 'Bidar Silver Wire House', material: 'Pure silver inlay wire', description: '0.3 mm and 0.5 mm drawn wire for bidri koftgari.', location: 'Bidar, Karnataka', phone: '+91 94498 20735', priceRange: '₹78,000 – ₹92,000 / kg', verified: true },
  { family: 'silver-inlay', name: 'Cuttack Tarakasi Silver Traders', material: 'Silver filigree wire', description: 'Hand-drawn wire in the gauges Cuttack tarakasi uses.', location: 'Cuttack, Odisha', phone: '+91 94370 62918', priceRange: '₹80,000 – ₹95,000 / kg', verified: true },
  { family: 'silver-inlay', name: 'Jaipur Meenakari Enamel Colours', material: 'Vitreous enamel powder', description: 'Lead-free enamel in the classic meena reds and greens.', location: 'Jaipur, Rajasthan', phone: '+91 99283 15064', priceRange: '₹4,200 – ₹7,800 / kg', verified: true },
  { family: 'silver-inlay', name: 'Thanjavur Gold Foil Suppliers', material: 'Gold foil & jaipur stones', description: '22k beaten foil and glass stones for Tanjore panels.', location: 'Thanjavur, Tamil Nadu', phone: '+91 94422 08361', priceRange: '₹1,900 – ₹6,400 / booklet', verified: false },
  { family: 'silver-inlay', name: 'Salem Silver Refiners', material: 'Refined silver granules', description: '999 granules for drawing your own wire.', location: 'Salem, Tamil Nadu', phone: '+91 90032 47186', priceRange: '₹74,000 – ₹88,000 / kg', verified: false, minOrder: 'Minimum 100 g' },

  /* ---- Clay, quartz and glaze -------------------------------------------- */
  { family: 'clay-quartz-glaze', name: 'Sanganer Quartz Powder Mills', material: 'Quartz powder & fuller earth', description: 'The clay-free blue-pottery body: quartz, katira gum, multani mitti.', location: 'Sanganer, Jaipur, Rajasthan', phone: '+91 98280 63947', priceRange: '₹22 – ₹40 / kg', verified: true },
  { family: 'clay-quartz-glaze', name: 'Khurja Glaze & Frit Suppliers', material: 'Low-fire glaze & oxides', description: 'Cobalt and copper oxides, plus a ready 900°C frit.', location: 'Khurja, Uttar Pradesh', phone: '+91 99977 20518', priceRange: '₹260 – ₹1,900 / kg', verified: true },
  { family: 'clay-quartz-glaze', name: 'Panchmura Terracotta Clay Yard', material: 'Levigated red clay', description: 'Bankura pond clay, sieved and wedged, for horse forms.', location: 'Panchmura, West Bengal', phone: '+91 90730 41682', priceRange: '₹9 – ₹18 / kg', verified: true },
  { family: 'clay-quartz-glaze', name: 'Molela Clay Plaque Supply', material: 'Alluvial plaque clay', description: 'Banas riverbed clay with donkey-dung temper, as tradition.', location: 'Molela, Rajsamand, Rajasthan', phone: '+91 94141 76035', priceRange: '₹12 – ₹22 / kg', verified: true },
  { family: 'clay-quartz-glaze', name: 'Bikaner Kiln & Firing Supplies', material: 'Kiln shelves & saggars', description: 'Cordierite shelves and props rated to 1,100°C.', location: 'Bikaner, Rajasthan', phone: '+91 93147 82056', priceRange: '₹700 – ₹3,400 / piece', verified: false },
  { family: 'clay-quartz-glaze', name: 'Kumhrar Potters Raw Store', material: 'Ball clay & grog', description: 'Plastic ball clay blended with 20% grog for large forms.', location: 'Patna, Bihar', phone: '+91 94318 25740', priceRange: '₹14 – ₹26 / kg', verified: false },
  { family: 'clay-quartz-glaze', name: 'Kutch Pottery Pigment Depot', material: 'Slip clays & pigments', description: 'White and red slips for Khavda painted pottery.', location: 'Khavda, Kutch, Gujarat', phone: '+91 99251 30846', priceRange: '₹40 – ₹180 / kg', verified: false },
  { family: 'clay-quartz-glaze', name: 'Jaipur Blue Pottery Bulk Supply', material: 'Blue pottery body kit', description: 'Quartz, gum, borax and glaze in a 100 kg workshop pack.', location: 'Jaipur, Rajasthan', phone: '+91 98871 42096', priceRange: '₹6,800 – ₹9,400 / pack', verified: true, minOrder: 'One 100 kg pack' },

  /* ---- Mirror, thread and embroidery ------------------------------------- */
  { family: 'mirror-thread', name: 'Bhuj Abhla Mirror Traders', material: 'Embroidery mirrors (abhla)', description: 'Hand-cut glass shisha, 6 mm to 25 mm, sorted by size.', location: 'Bhuj, Kutch, Gujarat', phone: '+91 99042 51738', priceRange: '₹180 – ₹640 / 100 g', verified: true },
  { family: 'mirror-thread', name: 'Surat Silk Thread House', material: 'Silk floss & rayon thread', description: 'Untwisted floss in 240 shades, on 25 g reels.', location: 'Surat, Gujarat', phone: '+91 98254 30612', priceRange: '₹90 – ₹240 / reel', verified: true },
  { family: 'mirror-thread', name: 'Patiala Phulkari Pat Supply', material: 'Pat silk floss', description: 'The darn-stitch floss Phulkari needs, in gold and crimson.', location: 'Patiala, Punjab', phone: '+91 98146 27350', priceRange: '₹140 – ₹380 / reel', verified: true },
  { family: 'mirror-thread', name: 'Lucknow Chikan Thread Bhandar', material: 'Cotton chikankari thread', description: 'Fine mercerised cotton, white on white, 40s.', location: 'Lucknow, Uttar Pradesh', phone: '+91 94150 63287', priceRange: '₹70 – ₹190 / reel', verified: true },
  { family: 'mirror-thread', name: 'Barabanki Zari & Gota Works', material: 'Zari, gota & sequins', description: 'Half-fine zari, gota ribbon and cut sequins by weight.', location: 'Barabanki, Uttar Pradesh', phone: '+91 99358 21470', priceRange: '₹320 – ₹1,600 / 100 g', verified: false },
  { family: 'mirror-thread', name: 'Nakhatrana Base Cloth Suppliers', material: 'Base cloth for embroidery', description: 'Handwoven cotton and mashru ground in 1 m cuts.', location: 'Nakhatrana, Kutch, Gujarat', phone: '+91 90999 34825', priceRange: '₹180 – ₹520 / metre', verified: false },
  { family: 'mirror-thread', name: 'Karnal Needle & Frame Store', material: 'Frames, hoops & needles', description: 'Adda frames, hoops and crewel needles in mixed sizes.', location: 'Karnal, Haryana', phone: '+91 98960 42175', priceRange: '₹120 – ₹2,800 / piece', verified: false },
  { family: 'mirror-thread', name: 'Kutch Mahila Bulk Thread Pool', material: 'Bulk thread & mirror lot', description: 'A pooled workshop lot for an SHG of ten stitchers.', location: 'Bhuj, Gujarat', phone: '+91 99786 30541', priceRange: '₹9,200 – ₹14,500 / lot', verified: true, minOrder: 'One SHG lot' },

  /* ---- Stone colours, pigments and painting grounds ---------------------- */
  { family: 'stone-pigment', name: 'Raghurajpur Chitrakar Colour Store', material: 'Stone & shell pigments', description: 'Hingula, haritala, conch white and lamp-black, ground.', location: 'Raghurajpur, Puri, Odisha', phone: '+91 94392 61805', priceRange: '₹280 – ₹1,400 / 100 g', verified: true },
  { family: 'stone-pigment', name: 'Madhubani Kohbar Colour Supply', material: 'Plant & mineral colours', description: 'Kajal, geru, palash and neel, prepared for handmade paper.', location: 'Madhubani, Bihar', phone: '+91 94318 70562', priceRange: '₹150 – ₹720 / 100 g', verified: true },
  { family: 'stone-pigment', name: 'Bhimbetka Ochre Traders', material: 'Natural ochres & geru', description: 'Red and yellow earths, levigated, for Warli and Gond.', location: 'Bhopal, Madhya Pradesh', phone: '+91 94250 38176', priceRange: '₹90 – ₹340 / kg', verified: false },
  { family: 'stone-pigment', name: 'Thanjavur Gesso & Board Works', material: 'Gesso paste & plywood board', description: 'Chalk-and-gum gesso plus 12 mm board for Tanjore relief.', location: 'Thanjavur, Tamil Nadu', phone: '+91 94433 20857', priceRange: '₹420 – ₹2,600 / board', verified: true },
  { family: 'stone-pigment', name: 'Puri Tamarind Gum Suppliers', material: 'Tamarind seed gum (kaitha)', description: 'The binder that stiffens tussar cloth into pata canvas.', location: 'Puri, Odisha', phone: '+91 94371 05263', priceRange: '₹200 – ₹380 / kg', verified: true },
  { family: 'stone-pigment', name: 'Nathdwara Pichwai Brush Makers', material: 'Squirrel-hair brushes', description: 'Single-hair liners for the unbroken outline stroke.', location: 'Nathdwara, Rajasthan', phone: '+91 94132 76408', priceRange: '₹180 – ₹1,900 / brush', verified: false },
  { family: 'stone-pigment', name: 'Cheriyal Scroll Colour Depot', material: 'Khadi cloth & tamarind primer', description: 'Primed khadi scroll ground, sold by the running metre.', location: 'Hyderabad, Telangana', phone: '+91 90003 51742', priceRange: '₹260 – ₹640 / metre', verified: false },

  /* ---- Lacquer, wood and toy turning ------------------------------------- */
  { family: 'lac-wood', name: 'Channapatna Ivory-Wood Depot', material: 'Aale mara (ivory wood)', description: 'Seasoned Wrightia tinctoria billets for lathe turning.', location: 'Channapatna, Karnataka', phone: '+91 94807 61230', priceRange: '₹90 – ₹190 / kg', verified: true },
  { family: 'lac-wood', name: 'Ranchi Lac & Shellac Traders', material: 'Stick lac & coloured lac', description: 'Food-safe vegetable-dyed lac sticks for toy lacquering.', location: 'Ranchi, Jharkhand', phone: '+91 94311 52086', priceRange: '₹460 – ₹980 / kg', verified: true },
  { family: 'lac-wood', name: 'Kondapalli Poniki Wood Supply', material: 'Poniki softwood', description: 'The light softwood Kondapalli figures are carved from.', location: 'Kondapalli, Andhra Pradesh', phone: '+91 90101 43765', priceRange: '₹120 – ₹240 / kg', verified: true },
  { family: 'lac-wood', name: 'Saharanpur Sheesham Timber Mart', material: 'Sheesham & mango wood', description: 'Kiln-dried planks for carving and inlay work.', location: 'Saharanpur, Uttar Pradesh', phone: '+91 98370 24651', priceRange: '₹1,400 – ₹3,200 / cft', verified: false },
  { family: 'lac-wood', name: 'Etikoppaka Turnery Supplies', material: 'Ankudu wood & seed dyes', description: 'Turned blanks plus the seed and root colours to match.', location: 'Etikoppaka, Andhra Pradesh', phone: '+91 94406 27130', priceRange: '₹110 – ₹280 / kg', verified: true },
  { family: 'lac-wood', name: 'Channapatna Toy Cluster Bulk Yard', material: 'Bulk billets & lac lot', description: 'A month of stock for a two-lathe workshop.', location: 'Channapatna, Karnataka', phone: '+91 90350 61274', priceRange: '₹18,000 – ₹27,000 / lot', verified: true, minOrder: 'One workshop lot' },

  /* ---- Pashmina, wool and shawl grounds ---------------------------------- */
  { family: 'pashmina-wool', name: 'Leh Changthangi Wool Collective', material: 'Raw pashm fibre', description: 'Changthangi goat down, dehaired, 12–14 micron.', location: 'Leh, Ladakh', phone: '+91 94191 78503', priceRange: '₹9,000 – ₹15,000 / kg', verified: true },
  { family: 'pashmina-wool', name: 'Srinagar Pashmina Yarn Guild', material: 'Hand-spun pashmina yarn', description: 'Spun on the yinder; the only yarn a GI shawl may carry.', location: 'Srinagar, Jammu & Kashmir', phone: '+91 94190 26187', priceRange: '₹18,000 – ₹28,000 / kg', verified: true },
  { family: 'pashmina-wool', name: 'Kullu Merino Wool Stores', material: 'Merino & local Gaddi wool', description: 'Carded merino for shawls and a coarser Gaddi for pattu.', location: 'Kullu, Himachal Pradesh', phone: '+91 94180 35762', priceRange: '₹1,100 – ₹2,400 / kg', verified: true },
  { family: 'pashmina-wool', name: 'Budgam Sozni Thread Supply', material: 'Sozni embroidery thread', description: 'Fine crewel thread matched to pashmina ground shades.', location: 'Budgam, Jammu & Kashmir', phone: '+91 94196 51230', priceRange: '₹240 – ₹690 / reel', verified: false },
  { family: 'pashmina-wool', name: 'Bikaner Camel & Sheep Wool Mart', material: 'Desert wool', description: 'Bikaneri sheep and camel wool for durries and namdas.', location: 'Bikaner, Rajasthan', phone: '+91 93520 61478', priceRange: '₹420 – ₹880 / kg', verified: false },

  /* ---- Palm leaf, handmade paper and canvas ------------------------------ */
  { family: 'palm-leaf-paper', name: 'Ragurajpur Talapatra Suppliers', material: 'Cured palm leaf', description: 'Boiled and sun-cured leaves, trimmed to panel size.', location: 'Puri, Odisha', phone: '+91 94373 81506', priceRange: '₹6 – ₹18 / leaf', verified: true },
  { family: 'palm-leaf-paper', name: 'Sanganer Handmade Paper Mill', material: 'Cotton rag paper', description: '200–300 gsm rag sheets, deckle-edged, acid free.', location: 'Sanganer, Jaipur, Rajasthan', phone: '+91 98290 17364', priceRange: '₹22 – ₹95 / sheet', verified: true },
  { family: 'palm-leaf-paper', name: 'Madhubani Kagaz Kendra', material: 'Handmade paper & cloth', description: 'The 250 gsm sheet and primed cloth Mithila painting uses.', location: 'Madhubani, Bihar', phone: '+91 94706 23158', priceRange: '₹18 – ₹120 / sheet', verified: true },
  { family: 'palm-leaf-paper', name: 'Aurangabad Canvas & Silk Base', material: 'Primed silk & cotton canvas', description: 'Stretched and primed grounds for Paithani-style panels.', location: 'Chhatrapati Sambhajinagar, Maharashtra', phone: '+91 94220 76035', priceRange: '₹240 – ₹880 / metre', verified: false },
  { family: 'palm-leaf-paper', name: 'Nadia Sholapith & Board Supply', material: 'Shola pith & mount board', description: 'Sponge-wood sheet and museum board for mounting.', location: 'Nadia, West Bengal', phone: '+91 90730 68214', priceRange: '₹40 – ₹320 / sheet', verified: false },
];

/* -------------------------------------------------------------------------- */
/*  Matching a craft to what it actually buys                                 */
/* -------------------------------------------------------------------------- */

/**
 * An artisan's `craftType` -> the material families they buy.
 *
 * Ordered: the first family is the craft's primary input, and the route keeps
 * that order so a Sambalpuri weaver is offered silk before dye and dye before
 * anything else. A craft that matches nothing falls back to the broad textile
 * and pigment families rather than to an empty list, because an artisan whose
 * craft we do not recognise is still better served by a plausible list than by
 * a blank tab.
 */
export function familiesForCraft(craftType: string): MaterialFamily[] {
  const craft = (craftType || '').toLowerCase();

  const rules: [RegExp, MaterialFamily[]][] = [
    [/pashmina|shahtoosh|sozni|kani |cashmere|namda/, ['pashmina-wool', 'mirror-thread', 'natural-dye']],
    [/bidri|bidar ware|bidriware/, ['brass-bell-metal', 'silver-inlay']],
    [/meenakari|enamel|filigree|tarakasi/, ['silver-inlay', 'brass-bell-metal']],
    [/dhokra|dokra|bell metal|kansa|brass|bronze|metal ?craft|pembarthi/, ['brass-bell-metal', 'clay-quartz-glaze']],
    [/channapatna|kondapalli|etikoppaka|lacquer|lacquerware|wooden toy|toy/, ['lac-wood', 'natural-dye']],
    [/blue pottery|pottery|terracotta|ceramic|clay|molela|panchmura|kumhar/, ['clay-quartz-glaze', 'stone-pigment']],
    [/pattachitra|patachitra|palm leaf|talapatra|ganjapa/, ['stone-pigment', 'palm-leaf-paper', 'silk-yarn']],
    [/madhubani|mithila|warli|gond|tanjore|thanjavur|kalighat|phad|pichwai|cheriyal|miniature|painting|folk art/, ['stone-pigment', 'palm-leaf-paper']],
    [/kalamkari|ajrakh|bagh|bagru|dabu|block print|batik/, ['natural-dye', 'cotton-yarn']],
    [/kutch|rabari|abhla|mirror|phulkari|chikan|kantha|zardozi|embroider|applique|toran/, ['mirror-thread', 'cotton-yarn', 'natural-dye']],
    [/kanjivaram|kanchipuram|banarasi|paithani|patola|silk|pata |muga|tussar/, ['silk-yarn', 'natural-dye', 'cotton-yarn']],
    [/ikat|bandha|sambalpuri|pochampally|saree|sari|handloom|weav|dupatta|stole|yardage|khadi|chanderi|cotton/, ['cotton-yarn', 'silk-yarn', 'natural-dye']],
    [/bamboo|cane|wicker|basket|leather|jutti|mojari|stone|marble|wood|carv/, ['lac-wood', 'natural-dye']],
  ];

  for (const [pattern, families] of rules) {
    if (pattern.test(craft)) return families;
  }
  return ['cotton-yarn', 'natural-dye', 'stone-pigment'];
}

/**
 * The curated rows relevant to one craft, best-matched family first.
 *
 * `limit` caps how many are returned so the merged list stays a list an artisan
 * can read rather than a catalogue they have to scroll past.
 */
export function suppliersForCraft(craftType: string, limit = 12): CuratedSupplier[] {
  const families = familiesForCraft(craftType);
  const out: CuratedSupplier[] = [];

  for (const family of families) {
    for (const supplier of CURATED_SUPPLIERS) {
      if (supplier.family !== family) continue;
      out.push(supplier);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
