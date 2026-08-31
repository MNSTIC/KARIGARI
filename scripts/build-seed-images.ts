/**
 * Build the seed image set under `public/seed/`.
 *
 * Every seeded item used to point at one shared `/ikat_saree.jpg`, which is the
 * single biggest reason the demo data reads as fake. This sources genuine,
 * freely-licensed craft photography from Wikimedia Commons, normalises it with
 * sharp, and — for items that have passed the physical-patch gate — composites a
 * REAL, decodable QR onto the product photo so the verification image is exactly
 * what `/api/items/attach-verify` would have accepted.
 *
 * Network is optional. Anything that cannot be downloaded falls back to a
 * generated, craft-tinted placeholder, so the seed never leaves an item pointing
 * at a missing file and never fails because a CDN was unreachable.
 *
 *   npx tsx --env-file=.env scripts/build-seed-images.ts
 *
 * The seeder calls `buildSeedImages()` itself, so running this by hand is only
 * useful for refreshing the artwork.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import QRCode from 'qrcode';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const SEED_DIR = path.join(PUBLIC_DIR, 'seed');

/** Long edge for stored product photos. Plenty for a card or a detail view. */
const MAX_EDGE = 1100;
const JPEG_QUALITY = 82;

const USER_AGENT =
  'KARIGARI-seed/1.0 (artisan marketplace demo seed; contact: admin@karigari.com)';

export interface CraftImageSpec {
  /** Folder under public/seed, e.g. "sambalpuri". */
  slug: string;
  /** Commons search terms, tried in order until enough images are found. */
  queries: string[];
  /** Used by the generated fallback. */
  label: string;
  sublabel: string;
  /** Two hex colours for the fallback gradient. */
  palette: [string, string];
}

export const CRAFT_IMAGES: CraftImageSpec[] = [
  {
    slug: 'sambalpuri',
    queries: ['Sambalpuri saree', 'Sambalpuri Ikat', 'Odisha handloom saree'],
    label: 'Sambalpuri Ikat Silk Saree',
    sublabel: 'Bargarh, Odisha',
    palette: ['#7B1E3A', '#2E1B2E'],
  },
  {
    slug: 'pattachitra',
    queries: ['Pattachitra', 'Patachitra Odisha painting', 'Raghurajpur painting'],
    label: 'Pattachitra Painting',
    sublabel: 'Raghurajpur, Odisha',
    palette: ['#B4571F', '#3A2412'],
  },
  {
    slug: 'pochampally',
    queries: ['Pochampally Saree', 'Pochampally Ikat', 'Telangana handloom'],
    label: 'Pochampally Ikat',
    sublabel: 'Bhoodan Pochampally, Telangana',
    palette: ['#1F5C63', '#12262A'],
  },
  {
    slug: 'blue-pottery',
    queries: ['Blue pottery Jaipur', 'Jaipur blue pottery', 'Indian blue pottery'],
    label: 'Jaipur Blue Pottery',
    sublabel: 'Jaipur, Rajasthan',
    palette: ['#1D4E89', '#0E2340'],
  },
  {
    slug: 'dhokra',
    queries: ['Dhokra art', 'Dokra metal casting', 'Bastar Dhokra'],
    label: 'Dhokra Brass Figurine',
    sublabel: 'Kondagaon, Bastar',
    palette: ['#8A5A1E', '#33210C'],
  },
  {
    slug: 'kutch-embroidery',
    queries: ['Kutch embroidery', 'Kachchh embroidery', 'Rabari embroidery'],
    label: 'Kutch Mirror Embroidery',
    sublabel: 'Bhuj, Kutch, Gujarat',
    palette: ['#A32E5C', '#2C1226'],
  },
];

/** Distinct faces so the six artisans do not all share one portrait. */
export const PEOPLE_QUERIES = [
  'Indian woman weaver portrait',
  'Indian artisan man portrait',
  'Indian craftsman working portrait',
  'Rajasthan potter portrait',
  'Indian tribal artisan portrait',
];

export interface BuildReport {
  real: number;
  generated: number;
  files: string[];
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Ask Commons for freely-licensed files matching a term.
 *
 * `iiurlwidth` makes the API hand back a pre-scaled thumbnail rather than a
 * 40-megapixel original, which keeps the download small and fast.
 */
async function commonsSearch(query: string, limit: number): Promise<string[]> {
  const url =
    'https://commons.wikimedia.org/w/api.php' +
    '?action=query&format=json&origin=*' +
    '&generator=search&gsrnamespace=6' +
    `&gsrsearch=${encodeURIComponent(query)}` +
    `&gsrlimit=${limit * 3}` +
    '&prop=imageinfo&iiprop=url|mime' +
    `&iiurlwidth=${MAX_EDGE}`;

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Commons search failed: ${res.status}`);

  const data = (await res.json()) as {
    query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; url?: string; mime?: string }[] }> };
  };

  const pages = Object.values(data.query?.pages ?? {});
  return pages
    .map((page) => page.imageinfo?.[0])
    // SVGs and PDFs are catalogued as "files" too; only take real photographs.
    .filter((info) => info && /^image\/(jpeg|png)$/.test(info.mime ?? ''))
    .map((info) => info!.thumburl || info!.url!)
    .filter(Boolean);
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Normalise to a cover-cropped 4:3 JPEG so every card looks consistent. */
async function writeNormalised(buffer: Buffer, dest: string): Promise<void> {
  await sharp(buffer)
    .rotate()
    .resize(MAX_EDGE, Math.round((MAX_EDGE * 3) / 4), { fit: 'cover', position: 'centre' })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(dest);
}

/**
 * A branded placeholder, used whenever a download fails.
 *
 * Tinted per craft and captioned, so six fallbacks still look like six
 * different products rather than six copies of the same grey box.
 */
async function writeFallback(
  dest: string,
  label: string,
  sublabel: string,
  palette: [string, string],
  index: number
): Promise<void> {
  const [from, to] = palette;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="750">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <pattern id="weave" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(${index * 17})">
      <rect width="28" height="28" fill="none"/>
      <path d="M0 14 H28 M14 0 V28" stroke="rgba(255,255,255,0.07)" stroke-width="3"/>
    </pattern>
  </defs>
  <rect width="1000" height="750" fill="url(#g)"/>
  <rect width="1000" height="750" fill="url(#weave)"/>
  <rect x="60" y="60" width="880" height="630" rx="28" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>
  <text x="500" y="360" text-anchor="middle" fill="#FFFFFF" font-family="Georgia, serif" font-size="46" font-weight="bold">${escapeXml(label)}</text>
  <text x="500" y="412" text-anchor="middle" fill="rgba(255,255,255,0.75)" font-family="Helvetica, Arial, sans-serif" font-size="24">${escapeXml(sublabel)}</text>
  <text x="500" y="660" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-family="Helvetica, Arial, sans-serif" font-size="18" letter-spacing="4">KARIGARI</text>
</svg>`;

  await sharp(Buffer.from(svg))
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(dest);
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string)
  );
}

/**
 * Fetch `count` photos for one craft, filling any shortfall with placeholders.
 * Returns the public paths, which is what goes into `CraftItem.images`.
 */
async function buildCraftSet(spec: CraftImageSpec, count: number, report: BuildReport): Promise<string[]> {
  const dir = path.join(SEED_DIR, spec.slug);
  await ensureDir(dir);

  const urls: string[] = [];
  for (const query of spec.queries) {
    if (urls.length >= count) break;
    try {
      const found = await commonsSearch(query, count);
      for (const url of found) {
        if (urls.length >= count) break;
        if (!urls.includes(url)) urls.push(url);
      }
    } catch (error) {
      console.warn(`  [${spec.slug}] search "${query}" failed:`, (error as Error).message);
    }
  }

  const paths: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const dest = path.join(dir, `${i + 1}.jpg`);
    const publicPath = `/seed/${spec.slug}/${i + 1}.jpg`;
    let ok = false;

    if (urls[i]) {
      try {
        await writeNormalised(await download(urls[i]), dest);
        ok = true;
        report.real += 1;
      } catch (error) {
        console.warn(`  [${spec.slug}] ${i + 1}.jpg download failed:`, (error as Error).message);
      }
    }

    if (!ok) {
      await writeFallback(dest, spec.label, spec.sublabel, spec.palette, i);
      report.generated += 1;
    }

    paths.push(publicPath);
    report.files.push(publicPath);
  }

  return paths;
}

/** Portraits for the artisan profiles. Same real-or-fallback contract. */
async function buildPeople(count: number, report: BuildReport): Promise<string[]> {
  const dir = path.join(SEED_DIR, 'people');
  await ensureDir(dir);

  const urls: string[] = [];
  for (const query of PEOPLE_QUERIES) {
    if (urls.length >= count) break;
    try {
      const found = await commonsSearch(query, 2);
      for (const url of found) {
        if (urls.length >= count) break;
        if (!urls.includes(url)) urls.push(url);
      }
    } catch (error) {
      console.warn(`  [people] search "${query}" failed:`, (error as Error).message);
    }
  }

  const paths: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const dest = path.join(dir, `${i + 1}.jpg`);
    const publicPath = `/seed/people/${i + 1}.jpg`;
    let ok = false;

    if (urls[i]) {
      try {
        // Portraits are square so the avatar circles crop cleanly.
        await sharp(await download(urls[i]))
          .rotate()
          .resize(600, 600, { fit: 'cover', position: 'attention' })
          .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
          .toFile(dest);
        ok = true;
        report.real += 1;
      } catch (error) {
        console.warn(`  [people] ${i + 1}.jpg failed:`, (error as Error).message);
      }
    }

    if (!ok) {
      await writeFallback(dest, 'KARIGARI Artisan', `Cluster member ${i + 1}`, ['#3D5145', '#1A2721'], i);
      report.generated += 1;
    }

    paths.push(publicPath);
    report.files.push(publicPath);
  }

  return paths;
}

/**
 * The "product photographed with its QR patch" image.
 *
 * This is the artefact `/api/items/attach-verify` checks: it decodes the QR,
 * requires it to carry the item's own patch id, and then asks the vision model
 * whether the photo shows the same piece. Generating it from the real product
 * photo plus a real QR means the seeded verification images would genuinely
 * pass that gate rather than merely looking like they had.
 */
export async function buildVerifiedImage(
  productImagePublicPath: string,
  patchId: string,
  baseUrl: string
): Promise<string> {
  const dir = path.join(SEED_DIR, 'verified');
  await ensureDir(dir);

  const dest = path.join(dir, `${patchId}.jpg`);
  const publicPath = `/seed/verified/${patchId}.jpg`;
  const source = path.join(PUBLIC_DIR, productImagePublicPath.replace(/^\//, ''));

  const base = sharp(source).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? MAX_EDGE;
  const height = meta.height ?? Math.round((MAX_EDGE * 3) / 4);

  // ~24% of the width, which is comfortably scannable at card size.
  const qrSize = Math.round(width * 0.24);
  const pad = Math.round(qrSize * 0.09);
  const cardSize = qrSize + pad * 2;

  const qrPng = await QRCode.toBuffer(`${baseUrl}/verify/${patchId}`, {
    type: 'png',
    width: qrSize,
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#111111', light: '#FFFFFF' },
  });

  // White rounded card behind the code: a QR printed straight onto a patterned
  // saree is not reliably decodable, and a real printed patch has a border too.
  const card = await sharp({
    create: {
      width: cardSize,
      height: cardSize,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${cardSize}" height="${cardSize}">
             <rect width="${cardSize}" height="${cardSize}" rx="${Math.round(cardSize * 0.08)}" fill="#FFFFFF"/>
           </svg>`
        ),
        blend: 'dest-in',
      },
      { input: qrPng, top: pad, left: pad },
    ])
    .png()
    .toBuffer();

  const margin = Math.round(width * 0.03);
  await base
    .composite([
      {
        input: card,
        top: Math.max(0, height - cardSize - margin),
        left: Math.max(0, width - cardSize - margin),
      },
    ])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(dest);

  return publicPath;
}

export interface SeedImageSet {
  /** craft slug -> public paths of its product photos. */
  crafts: Record<string, string[]>;
  /** Portrait paths, one per artisan. */
  people: string[];
  report: BuildReport;
}

export async function buildSeedImages(perCraft = 3, peopleCount = 6): Promise<SeedImageSet> {
  await ensureDir(SEED_DIR);
  const report: BuildReport = { real: 0, generated: 0, files: [] };

  console.log('Building seed images...');
  const crafts: Record<string, string[]> = {};
  for (const spec of CRAFT_IMAGES) {
    crafts[spec.slug] = await buildCraftSet(spec, perCraft, report);
    console.log(`  ${spec.slug}: ${crafts[spec.slug].length} images`);
  }

  const people = await buildPeople(peopleCount, report);
  console.log(`  people: ${people.length} portraits`);
  console.log(`Images ready — ${report.real} real, ${report.generated} generated fallback.`);

  return { crafts, people, report };
}

// Allow running standalone to refresh the artwork.
const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/build-seed-images.ts');

if (invokedDirectly) {
  buildSeedImages()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
