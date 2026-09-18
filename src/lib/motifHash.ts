/**
 * Perceptual fingerprints for motif registration.
 *
 * The pure half of this file (distances, classification, validation) has no DOM
 * and is unit-tested; `hashImageDataUrl` needs a canvas and is verified in the
 * browser.
 *
 * **Why a perceptual hash and not a cryptographic one.** The question a motif
 * fingerprint answers is "have we seen this pattern before", and two
 * photographs of the same saree — different light, different crop, a resize on
 * the way — must answer yes. SHA-256 answers no to every one of those, which
 * would make the register useless. dHash answers yes, and the amount by which
 * two images differ is a number a reviewer can see.
 *
 * **The algorithm, in one sentence:** draw the image into a 9×8 grid, convert
 * to grey with the standard luma weights, compare each pixel with the one to
 * its right, and emit a 1 when the left is brighter — 8 rows × 8 comparisons =
 * 64 bits = 16 hex characters.
 *
 * **What this is not.** A fingerprint here is a discovery aid that a human
 * reviews. It is not proof of authorship, not a legal record, and not an
 * authorisation: nothing in this app grants a right because two hashes matched.
 * A near match opens a review; it never accuses anyone of anything.
 */

/** Columns sampled per row. 9 columns give 8 left-to-right comparisons. */
export const HASH_GRID = 9;
/** Rows sampled. 8 rows × 8 comparisons = 64 bits. */
export const HASH_ROWS = 8;
export const HASH_BITS = 64;
/** The fingerprint as stored and displayed: 64 bits in 16 hex characters. */
export const HASH_HEX_LENGTH = 16;

/**
 * At or below this Hamming distance two images are treated as the same motif.
 *
 * Six bits of sixty-four. Chosen to absorb a re-crop, a resize and a change of
 * light without absorbing a genuinely different pattern — the boundary is
 * asserted in the unit tests rather than left to a reader's trust.
 */
export const DUPLICATE_DISTANCE = 6;

/**
 * Above this, two images are unrelated. Between the two thresholds they are
 * "similar", which is a reason for a human to look, not a verdict.
 */
export const SIMILAR_DISTANCE = 14;

export const HASH_PATTERN = /^[0-9a-f]{16}$/;

export type DistanceClass = 'DUPLICATE' | 'SIMILAR' | 'DISTINCT';

/** Registration statuses, so no route or screen spells one by hand. */
export const MOTIF_STATUSES = ['PENDING', 'REGISTERED', 'FLAGGED_DUPLICATE', 'REJECTED'] as const;
export type MotifStatus = (typeof MOTIF_STATUSES)[number];

/** Licence statuses. Monotonic: REQUESTED → ACCEPTED → PAID, or a dead end. */
export const LICENCE_STATUSES = ['REQUESTED', 'ACCEPTED', 'DECLINED', 'PAID', 'WITHDRAWN'] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

export function isMotifStatus(value: unknown): value is MotifStatus {
  return typeof value === 'string' && (MOTIF_STATUSES as readonly string[]).includes(value);
}

export function isLicenceStatus(value: unknown): value is LicenceStatus {
  return typeof value === 'string' && (LICENCE_STATUSES as readonly string[]).includes(value);
}

/** True for a well-formed fingerprint: exactly 16 lower-case hex characters. */
export function isMotifHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

/** Normalise a submitted hash, or null when it is not one. */
export function normaliseHash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase();
  return HASH_PATTERN.test(hex) ? hex : null;
}

const BIT_COUNT = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) {
  BIT_COUNT[i] = (i & 1) + BIT_COUNT[i >> 1];
}

/**
 * Bits that differ between two fingerprints, 0–64.
 *
 * Throws on a malformed input rather than returning a large distance: a silent
 * "these are very different" from a typo would quietly register a duplicate.
 */
export function hammingDistance(a: string, b: string): number {
  const left = normaliseHash(a);
  const right = normaliseHash(b);
  if (!left || !right) {
    throw new Error(`motifHash: expected ${HASH_HEX_LENGTH} hex characters, got "${a}" and "${b}"`);
  }

  let distance = 0;
  for (let i = 0; i < HASH_HEX_LENGTH; i += 2) {
    const x = parseInt(left.slice(i, i + 2), 16) ^ parseInt(right.slice(i, i + 2), 16);
    distance += BIT_COUNT[x];
  }
  return distance;
}

/** Which band a distance falls in. The boundaries are inclusive at the low end. */
export function classifyDistance(distance: number): DistanceClass {
  if (distance <= DUPLICATE_DISTANCE) return 'DUPLICATE';
  if (distance <= SIMILAR_DISTANCE) return 'SIMILAR';
  return 'DISTINCT';
}

/** The nearest existing fingerprint to a candidate, or null when there are none. */
export interface NearestMatch<T extends { hash: string }> {
  row: T;
  distance: number;
  verdict: DistanceClass;
}

export function nearestHash<T extends { hash: string }>(
  candidate: string,
  rows: readonly T[]
): NearestMatch<T> | null {
  let best: NearestMatch<T> | null = null;
  for (const row of rows) {
    // A malformed stored hash is skipped rather than allowed to throw: one bad
    // legacy row must not stop every future registration.
    if (!isMotifHash(row.hash)) continue;
    const distance = hammingDistance(candidate, row.hash);
    if (!best || distance < best.distance) {
      best = { row, distance, verdict: classifyDistance(distance) };
    }
  }
  return best;
}

/** Grouped 4 hex characters at a time, so a fingerprint can be read aloud. */
export function formatHash(hash: string): string {
  const hex = normaliseHash(hash);
  if (!hex) return '';
  return (hex.match(/.{1,4}/g) ?? []).join(' ');
}

// ------------------------------------------------------------------- client

/**
 * A data URL → its 16-hex fingerprint, computed in the browser.
 *
 * Deliberately client-side. A route that decoded several full-size data-URL
 * images would exhaust memory on this deployment — `clientImagePrep.ts` exists
 * in this codebase for exactly that reason — and the server has no need for the
 * pixels: it validates the hash's FORMAT and stores it, because a fingerprint
 * is a discovery aid a human reviews, not an authorisation.
 *
 * Returns null when there is no canvas, when the image will not decode, or when
 * the canvas is blocked (some privacy modes refuse `getImageData`). The caller
 * must then refuse to register rather than submitting a record with no
 * fingerprint in it.
 */
export async function hashImageDataUrl(dataUrl: string): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

  try {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = HASH_GRID;
    canvas.height = HASH_ROWS;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, HASH_GRID, HASH_ROWS);
    const { data } = context.getImageData(0, 0, HASH_GRID, HASH_ROWS);

    // Standard luma weights: the eye is far more sensitive to green, and a flat
    // average would make a red motif and a green one of equal brightness
    // indistinguishable.
    const grey = new Float64Array(HASH_GRID * HASH_ROWS);
    for (let i = 0; i < grey.length; i += 1) {
      const p = i * 4;
      grey[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    let bits = '';
    for (let row = 0; row < HASH_ROWS; row += 1) {
      for (let col = 0; col < HASH_GRID - 1; col += 1) {
        const here = grey[row * HASH_GRID + col];
        const right = grey[row * HASH_GRID + col + 1];
        bits += here > right ? '1' : '0';
      }
    }

    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return HASH_PATTERN.test(hex) ? hex : null;
  } catch (error) {
    console.warn('[motifHash] could not fingerprint the image:', (error as Error)?.message);
    return null;
  }
}

/**
 * The longest edge of the crop a registration stores and sends for reading.
 *
 * A pattern is a repeat, so a model reading one needs resolution enough to see
 * a few tiles and no more; a full capture is a few hundred kilobytes of detail
 * nobody looks at. Keeping it small does three things at once: the stored row
 * stays small, the vision call finishes inside its budget, and the crop a human
 * reviews loads on a slow connection.
 *
 * The FINGERPRINT is unaffected — dHash draws to a 9×8 grid, so it is the same
 * value whether the source is 320px or 2000px, which is the property the whole
 * near-duplicate check rests on.
 */
export const REFERENCE_MAX_EDGE = 320;
export const REFERENCE_QUALITY = 0.8;

/** Re-encode a data URL down to `REFERENCE_MAX_EDGE`. Returns the original on failure. */
export async function downscaleReference(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;

  try {
    const image = await loadImage(dataUrl);
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (!longest) return dataUrl;
    const scale = Math.min(1, REFERENCE_MAX_EDGE / longest);
    // Already small enough: re-encoding would only lose detail for nothing.
    if (scale === 1) return dataUrl;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', REFERENCE_QUALITY);
    return out.startsWith('data:image/') && out.length < dataUrl.length ? out : dataUrl;
  } catch (error) {
    console.warn('[motifHash] could not downscale the crop:', (error as Error)?.message);
    return dataUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image failed to decode'));
    image.src = src;
  });
}

/**
 * The dominant colours in an image, as a small histogram over coarse buckets.
 *
 * This is the HEURISTIC descriptor path — what the motif record shows when no
 * model answered. It is labelled as such everywhere it appears, because a
 * colour histogram is arithmetic and calling it an AI reading would be a lie
 * about where the description came from.
 */
export async function dominantColours(dataUrl: string, count = 4): Promise<string[]> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return [];

  try {
    const image = await loadImage(dataUrl);
    const side = 48;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [];

    context.drawImage(image, 0, 0, side, side);
    const { data } = context.getImageData(0, 0, side, side);

    // 4 bits per channel: fine enough to tell indigo from madder, coarse enough
    // that a photograph's noise does not become forty different "colours".
    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    for (let p = 0; p < data.length; p += 4) {
      if (data[p + 3] < 128) continue;
      const key = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4);
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += data[p];
      bucket.g += data[p + 1];
      bucket.b += data[p + 2];
      buckets.set(key, bucket);
    }

    return [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, count)
      .map(({ count: n, r, g, b }) => {
        const hex = (value: number) => Math.round(value / n).toString(16).padStart(2, '0');
        return `#${hex(r)}${hex(g)}${hex(b)}`;
      });
  } catch (error) {
    console.warn('[motifHash] could not read colours:', (error as Error)?.message);
    return [];
  }
}
