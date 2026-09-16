import sharp from 'sharp';

/**
 * Server-side proof that a chosen LOOK still shows the artisan's own piece.
 *
 * SERVER-ONLY (sharp). The listing photo (`images[0]`) is produced in the
 * browser — the enhanced frame, or the cutout composited onto a backdrop — and
 * the browser is not a trust boundary. Before V11 the listing photo WAS the
 * frame every authenticity check compared against, so a substituted photo
 * failed those checks. Since V11 they compare against `originalImageUrl`, which
 * means a tampered client could list a different, or AI-redrawn, product as a
 * "look" while every check still passed against the real frame. This closes
 * that gap: a look whose product pixels do not come from the camera frame is
 * not stored as the listing photo.
 *
 * THE MEASURE. Correlation of local gradient magnitude (|∂x| + |∂y| of luma)
 * on a 256 px grid between the look and its reference, over the pixels where
 * the product is. Gradients, not raw values, because the enhance pass and the
 * cutout's colour correction are global tone curves: they change brightness
 * but not where the edges and weave are. A different piece, a mirrored frame,
 * or a product redrawn by a generative model changes exactly that structure.
 *
 *   mode 'frame'   the whole image — ENHANCED against the camera frame.
 *   mode 'cutout'  only pixels the matte marks opaque, eroded by one pixel so
 *                  resampled edges never count — a studio look against the
 *                  stored cutout, and the cutout against the camera frame.
 *
 * CALIBRATION — 60 seed photos (public/seed), server-model cutouts, measured
 * with this exact code:
 *
 *                                        min     p05     max
 *   genuine enhanced vs frame           0.994   0.998   1.000
 *   genuine studio look vs cutout       0.889   0.917   0.991
 *   different photo, same craft (frame) —       —       0.802
 *   mirrored frame                      —       —       0.414
 *   product interior redrawn (frame)    —       —       0.883
 *   product interior redrawn (cutout)   —       —       0.752
 *   a different piece's cutout          —       —       0.142
 *
 * Hence FRAME_MIN 0.95 and CUTOUT_MIN 0.85: every genuine look passes, every
 * substitution and redraw in the set fails. A redraw subtle enough to survive a
 * 256 px grid is below what this can see — the physical QR check still compares
 * the delivered piece against the camera frame.
 */

const GRID = 256;
export const FRAME_MIN = 0.95;
export const CUTOUT_MIN = 0.85;
/** A matte this sparse, or a surface this flat, cannot support a verdict. */
const MIN_MASK_FRACTION = 0.03;
const OPAQUE = 230;

function decode(dataUrl: string | null | undefined): Buffer | null {
  const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:image\/(?:jpeg|png|webp);base64,(.+)$/) : null;
  return match ? Buffer.from(match[1], 'base64') : null;
}

export type LookVerdict =
  | { ok: true; correlation: number }
  | { ok: false; reason: 'mismatch' | 'unverifiable'; correlation: number | null };

/**
 * Gradient-structure correlation of `look` against `reference`. Never throws.
 * In 'cutout' mode the REFERENCE carries the matte.
 */
export async function verifyLook(input: {
  look: string;
  reference: string;
  mode: 'frame' | 'cutout';
}): Promise<LookVerdict> {
  try {
    const lookBytes = decode(input.look);
    const refBytes = decode(input.reference);
    if (!lookBytes || !refBytes) return { ok: false, reason: 'unverifiable', correlation: null };

    const meta = await sharp(refBytes).metadata();
    if (!meta.width || !meta.height) return { ok: false, reason: 'unverifiable', correlation: null };
    const w = GRID;
    const h = Math.max(16, Math.round((GRID * meta.height) / meta.width));
    const toGrid = (bytes: Buffer) => sharp(bytes).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    const [a, b] = await Promise.all([toGrid(lookBytes), toGrid(refBytes)]);

    const luma = (buf: Buffer, i: number) => 0.299 * buf[i * 4] + 0.587 * buf[i * 4 + 1] + 0.114 * buf[i * 4 + 2];
    const opaqueAround = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (b[((y + dy) * w + (x + dx)) * 4 + 3] < OPAQUE) return false;
        }
      }
      return true;
    };

    let n = 0;
    let sa = 0;
    let sb = 0;
    let aa = 0;
    let bb = 0;
    let ab = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        if (input.mode === 'cutout' && !opaqueAround(x, y)) continue;
        const i = y * w + x;
        const ga = Math.abs(luma(a, i + 1) - luma(a, i - 1)) + Math.abs(luma(a, i + w) - luma(a, i - w));
        const gb = Math.abs(luma(b, i + 1) - luma(b, i - 1)) + Math.abs(luma(b, i + w) - luma(b, i - w));
        n += 1;
        sa += ga;
        sb += gb;
        aa += ga * ga;
        bb += gb * gb;
        ab += ga * gb;
      }
    }
    if (n < w * h * MIN_MASK_FRACTION) return { ok: false, reason: 'unverifiable', correlation: null };

    const varA = aa - (sa * sa) / n;
    const varB = bb - (sb * sb) / n;
    // A featureless surface has no structure to compare, and cannot be told
    // apart from a featureless fake: unverifiable, not a pass.
    if (varA <= n || varB <= n) return { ok: false, reason: 'unverifiable', correlation: null };
    const correlation = (ab - (sa * sb) / n) / Math.sqrt(varA * varB);
    const min = input.mode === 'frame' ? FRAME_MIN : CUTOUT_MIN;
    return correlation >= min ? { ok: true, correlation } : { ok: false, reason: 'mismatch', correlation };
  } catch {
    return { ok: false, reason: 'unverifiable', correlation: null };
  }
}

interface StudioLikeFields {
  originalImageUrl?: string | null;
  enhancedImageUrl?: string | null;
  selectedImageVariant?: string | null;
  imageVariants?: { cutout?: string | null } | null;
  photoQualityNotes?: string | null;
}

/**
 * Enforce provenance on a capture before it is stored.
 *
 * - ORIGINAL (or no studio data): nothing to check.
 * - ENHANCED: the listing photo must match the camera frame.
 * - A studio look: the stored cutout must match the camera frame, and the
 *   listing photo must match the cutout — the chain frame → cutout → look.
 * - A stored `enhancedImageUrl` that does not match the frame is dropped.
 *
 * Anything that fails, or cannot be checked, is listed with the CAMERA FRAME
 * instead and the reason is added to the notes. The capture itself is never
 * refused: the artisan's piece is still listed, with the photo it can be proven
 * to be.
 */
export async function enforceLookProvenance<F extends StudioLikeFields>(
  fields: F,
  images: string[]
): Promise<{ fields: F; images: string[]; downgraded: boolean }> {
  const selected = fields.selectedImageVariant;
  const original = fields.originalImageUrl;
  const next = { ...fields };
  const notes: string[] = [];

  if (next.enhancedImageUrl && original) {
    const enhanced = await verifyLook({ look: next.enhancedImageUrl, reference: original, mode: 'frame' });
    if (!enhanced.ok) next.enhancedImageUrl = null;
  }

  if (!selected || selected === 'ORIGINAL' || !images[0]) {
    return { fields: next, images, downgraded: false };
  }

  let proven = false;
  if (original) {
    if (selected === 'ENHANCED') {
      proven = (await verifyLook({ look: images[0], reference: original, mode: 'frame' })).ok;
    } else {
      const cutout = next.imageVariants?.cutout ?? null;
      if (cutout) {
        const cutoutFromFrame = await verifyLook({ look: original, reference: cutout, mode: 'cutout' });
        proven = cutoutFromFrame.ok && (await verifyLook({ look: images[0], reference: cutout, mode: 'cutout' })).ok;
      }
    }
  }

  if (proven) return { fields: next, images, downgraded: false };

  // Not proven: list the camera frame. Without an original there is nothing
  // provable to list, so the look stays but is recorded as the unverified
  // ORIGINAL it now stands in for.
  notes.push('The chosen look could not be matched to the camera frame, so the original photo was listed instead.');
  next.selectedImageVariant = 'ORIGINAL';
  next.photoQualityNotes = [fields.photoQualityNotes, ...notes].filter(Boolean).join(' ').slice(0, 500);
  return {
    fields: next,
    images: original ? [original, ...images.slice(1)] : images,
    downgraded: true,
  };
}
