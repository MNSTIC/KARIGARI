import { dataUrlBytes, MAX_UPLOAD_BYTES } from '@/lib/fileToDataUrl';

/**
 * The photo-studio half of a capture payload, and the caps the server enforces
 * on it. Shared by the capture modal (which builds it), the offline queue
 * (which stores it verbatim) and the two routes that persist it
 * (/api/items/capture, /api/items/complete-draft).
 *
 * THE RULE: optional data degrades, the capture never does. An oversized
 * original or variant blob is DROPPED and the craft still saves; only the
 * photos the listing actually shows (`images[]`) can refuse a request, because
 * saving a listing without its photo would be lying to the artisan.
 *
 * Budget (docs/PHOTO_STUDIO_SHOPIFY_V11_PLAN.md §4.4):
 *   images[]                 ≤ 4, each ≤ MAX_UPLOAD_BYTES (2 MB)
 *   originalImageUrl         ≤ 2 MB (MAX_UPLOAD_BYTES — the provenance frame is never dropped for size first)
 *   enhancedImageUrl         ≤ 1 MB
 *   imageVariants.variants   ≤ 8 thumbnails, each ≤ 80 KB
 *   imageVariants.cutout     ≤ 700 KB PNG/WebP with alpha, else omitted (the client fits it; see shrinkCutout)
 *   imageVariants total      ≤ 1.2 MB, else the whole blob is dropped
 */

export const MAX_CAPTURE_IMAGES = 4;
/** The camera frame is what provenance rests on, so it gets the full per-photo cap. */
export const MAX_ORIGINAL_BYTES = MAX_UPLOAD_BYTES;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_VARIANT_THUMBS = 8;
export const MAX_THUMB_BYTES = 80 * 1024;
export const MAX_CUTOUT_BYTES = 700 * 1024;
export const MAX_VARIANTS_BLOB_BYTES = Math.round(1.2 * 1024 * 1024);

export type PhotoQualitySource = 'AI' | 'HEURISTIC' | 'UNCHECKED';
export type StoredRemovalMode = 'ON_DEVICE' | 'SERVER' | 'NONE';
export type StoredVariantKind = 'ORIGINAL' | 'ENHANCED' | 'PRESET' | 'GENERATED';

export type StoredVariantThumb = {
  key: string;
  /** i18n key, e.g. `variant_cream`. */
  label: string;
  kind: StoredVariantKind;
  /** ≤320 px JPEG data URL. */
  thumb: string;
};

/** Shape of `CraftItem.imageVariants`. */
export type StoredImageVariants = {
  v: 1;
  variants: StoredVariantThumb[];
  /** ≤900 px transparent PNG, so the listing picker can re-render a preset. */
  cutout?: string | null;
};

/** The optional fields a capture carries. All absent on a pre-V11 client. */
export interface PhotoStudioFields {
  originalImageUrl?: string | null;
  enhancedImageUrl?: string | null;
  selectedImageVariant?: string | null;
  imageVariants?: StoredImageVariants | null;
  photoQualityScore?: number | null;
  photoQualityNotes?: string | null;
  photoQualitySource?: PhotoQualitySource | null;
  photoRetakeCount?: number | null;
  backgroundRemovalMode?: StoredRemovalMode | null;
}

/** ORIGINAL | ENHANCED | PRESET_<NAME> | GENERATED_<n>. */
export const VARIANT_KEY_RE = /^(ORIGINAL|ENHANCED|PRESET_[A-Z]{2,16}|GENERATED_[1-9])$/;

const IMAGE_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
/** Cutouts need alpha: PNG, or WebP with alpha. */
const CUTOUT_DATA_URL_RE = /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/;
const KINDS: StoredVariantKind[] = ['ORIGINAL', 'ENHANCED', 'PRESET', 'GENERATED'];
const SOURCES: PhotoQualitySource[] = ['AI', 'HEURISTIC', 'UNCHECKED'];
const MODES: StoredRemovalMode[] = ['ON_DEVICE', 'SERVER', 'NONE'];

function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && IMAGE_DATA_URL_RE.test(value);
}

/** A data-URL frame within `cap`, else null. */
function frameWithin(value: unknown, cap: number): string | null {
  return isImageDataUrl(value) && dataUrlBytes(value) <= cap ? value : null;
}

/**
 * The listing photos. Refuses rather than drops: these are what the buyer sees.
 * Remote URLs (seeded rows, `/api/...` thumbnails) pass through unchanged — only
 * inline data is size-checked, because only inline data lands in the row.
 */
export function validateListingImages(
  raw: unknown
): { ok: true; images: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, images: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'Photos must be a list.' };
  const images = raw.filter((i: unknown): i is string => typeof i === 'string' && i.length > 0);
  if (images.length > MAX_CAPTURE_IMAGES) {
    return { ok: false, error: `At most ${MAX_CAPTURE_IMAGES} photos can be attached.` };
  }
  for (const image of images) {
    if (image.startsWith('data:') && dataUrlBytes(image) > MAX_UPLOAD_BYTES) {
      return { ok: false, error: 'One of the photos is larger than 2 MB.' };
    }
  }
  return { ok: true, images };
}

function sanitizeVariants(raw: unknown): { blob: StoredImageVariants | null; note: string | null } {
  if (!raw || typeof raw !== 'object') return { blob: null, note: null };
  const input = raw as { variants?: unknown; cutout?: unknown };
  if (!Array.isArray(input.variants)) return { blob: null, note: null };

  const seen = new Set<string>();
  const variants: StoredVariantThumb[] = [];
  for (const entry of input.variants.slice(0, MAX_VARIANT_THUMBS)) {
    if (!entry || typeof entry !== 'object') continue;
    const { key, label, kind, thumb } = entry as Record<string, unknown>;
    if (typeof key !== 'string' || !VARIANT_KEY_RE.test(key) || seen.has(key)) continue;
    if (typeof kind !== 'string' || !KINDS.includes(kind as StoredVariantKind)) continue;
    const safeThumb = frameWithin(thumb, MAX_THUMB_BYTES);
    if (!safeThumb) continue;
    seen.add(key);
    variants.push({
      key,
      label: typeof label === 'string' && /^variant_[a-z]{2,20}$/.test(label) ? label : 'variant_original',
      kind: kind as StoredVariantKind,
      thumb: safeThumb,
    });
  }
  if (variants.length === 0) return { blob: null, note: null };

  let note: string | null = null;
  let cutout: string | null = null;
  if (typeof input.cutout === 'string' && input.cutout) {
    if (CUTOUT_DATA_URL_RE.test(input.cutout) && dataUrlBytes(input.cutout) <= MAX_CUTOUT_BYTES) {
      cutout = input.cutout;
    } else {
      note = 'Cutout too large to keep; looks cannot be re-rendered later.';
    }
  }

  const blob: StoredImageVariants = { v: 1, variants, cutout };
  if (JSON.stringify(blob).length > MAX_VARIANTS_BLOB_BYTES) {
    return { blob: null, note: 'Look previews too large to keep; the chosen photo was saved.' };
  }
  return { blob, note };
}

/**
 * `sanitizeStudioFields`, plus the frames the client deliberately did not send
 * twice: when the chosen look IS the Original (or the Enhanced frame), it is
 * already `images[0]`, so it is copied from there rather than uploaded again.
 */
export function resolveStudioFields(body: unknown, images: string[]) {
  const fields = sanitizeStudioFields(body);
  if (!fields.selectedImageVariant) return fields;
  if (fields.selectedImageVariant === 'ORIGINAL' && !fields.originalImageUrl) {
    const listing = frameWithin(images[0], MAX_ORIGINAL_BYTES);
    if (listing) fields.originalImageUrl = listing;
  }
  if (fields.selectedImageVariant === 'ENHANCED' && !fields.enhancedImageUrl) {
    const listing = frameWithin(images[0], MAX_FRAME_BYTES);
    if (listing) fields.enhancedImageUrl = listing;
  }
  return fields;
}

/**
 * Validated, capped studio fields ready for a Prisma write. Never throws and
 * never refuses: anything malformed or oversized is dropped, and a short note
 * says what was dropped so the admin queue is not left guessing.
 *
 * Returns `{}` for a payload with no studio data, so a pre-V11 client writes
 * exactly what it always wrote (and `photoRetakeCount` keeps its default).
 */
export function sanitizeStudioFields(body: unknown): {
  originalImageUrl?: string | null;
  enhancedImageUrl?: string | null;
  selectedImageVariant?: string | null;
  imageVariants?: StoredImageVariants;
  photoQualityScore?: number | null;
  photoQualityNotes?: string | null;
  photoQualitySource?: PhotoQualitySource | null;
  photoRetakeCount?: number;
  backgroundRemovalMode?: StoredRemovalMode | null;
} {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const hasStudio =
    b.originalImageUrl !== undefined ||
    b.selectedImageVariant !== undefined ||
    b.photoQualitySource !== undefined;
  if (!hasStudio) return {};

  const notes: string[] = [];

  const originalImageUrl = frameWithin(b.originalImageUrl, MAX_ORIGINAL_BYTES);
  if (b.originalImageUrl && !originalImageUrl) {
    notes.push('Original camera frame too large to keep separately.');
  }
  const enhancedImageUrl = frameWithin(b.enhancedImageUrl, MAX_FRAME_BYTES);

  const { blob, note } = sanitizeVariants(b.imageVariants);
  if (note) notes.push(note);

  const selected =
    typeof b.selectedImageVariant === 'string' && VARIANT_KEY_RE.test(b.selectedImageVariant)
      ? b.selectedImageVariant
      : 'ORIGINAL';

  const scoreNum = Number(b.photoQualityScore);
  const source = SOURCES.includes(b.photoQualitySource as PhotoQualitySource)
    ? (b.photoQualitySource as PhotoQualitySource)
    : 'UNCHECKED';
  // A score is only ever stored beside the AI source that produced it — a
  // heuristic or unchecked capture must not carry a number that reads as a verdict.
  const photoQualityScore =
    source === 'AI' && Number.isFinite(scoreNum) && b.photoQualityScore !== null
      ? Math.max(1, Math.min(10, Math.round(scoreNum)))
      : null;

  const retakes = Number(b.photoRetakeCount);
  const clientNotes =
    typeof b.photoQualityNotes === 'string' ? b.photoQualityNotes.replace(/\s+/g, ' ').trim() : '';
  const allNotes = [clientNotes, ...notes].filter(Boolean).join(' ').slice(0, 500);

  const mode = MODES.includes(b.backgroundRemovalMode as StoredRemovalMode)
    ? (b.backgroundRemovalMode as StoredRemovalMode)
    : null;

  return {
    originalImageUrl,
    enhancedImageUrl,
    selectedImageVariant: selected,
    // Prisma's Json? column takes `undefined` for "leave unset"; a dropped blob
    // is simply not written.
    ...(blob ? { imageVariants: blob } : {}),
    photoQualityScore,
    photoQualityNotes: allNotes || null,
    photoQualitySource: source,
    photoRetakeCount: Number.isFinite(retakes) ? Math.max(0, Math.min(5, Math.round(retakes))) : 0,
    backgroundRemovalMode: mode,
  };
}
