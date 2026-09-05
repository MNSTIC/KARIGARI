import sharp from 'sharp';

/**
 * Shrink an uploaded photo before it is shipped to a vision model.
 *
 * SERVER-SIDE ONLY (imports `sharp`).
 *
 * Every vision route used to forward the artisan's or buyer's raw capture — up
 * to the full 2 MB data-URL cap — straight to Google. That payload is uploaded
 * twice on a weak link: once from the phone to us, once from us to Gemini, and
 * the second leg is on the request the user is waiting for. A 1024 px JPEG at
 * q=0.72 is indistinguishable to the model for "is this the same object" while
 * being roughly an order of magnitude smaller.
 *
 * Never throws: an image the encoder cannot read is passed through untouched
 * rather than failing a verification the user is waiting on.
 */

/** Longest edge, in pixels, after downscaling. */
export const VISION_MAX_EDGE = 1024;
/** JPEG quality. High enough for weave/texture comparison, low enough to be small. */
export const VISION_JPEG_QUALITY = 72;

export interface PreparedImage {
  /** Bare base64 (no `data:` prefix) ready for Gemini's `inlineData.data`. */
  base64: string;
  mimeType: 'image/jpeg';
  bytesBefore: number;
  bytesAfter: number;
}

/** Byte length of a base64 payload, without decoding it. */
function b64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

/** Strip a `data:` prefix if present and return the bare base64 payload. */
export function stripDataUrl(value: string): string {
  return value.replace(/^data:[^;]+;base64,/i, '');
}

/**
 * Is this string actually image bytes we can decode?
 *
 * A `data:` URL always is. A bare payload is accepted only when it looks like
 * base64 and is long enough to be an image — which excludes the hosted paths
 * ("/images/x.jpg", "https://…") that some rows store instead.
 */
export function isEncodedImage(value: string): boolean {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return true;
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return false;
  // Sample the head only — checking megabytes of base64 on every call is waste.
  // No `=` anchor here: padding lives at the END of the full string, so
  // anchoring it against a slice rejects perfectly valid payloads.
  return value.length > 512 && /^[A-Za-z0-9+/=\r\n]+$/.test(value.slice(0, 512));
}

/**
 * Downscale + re-encode one image for a vision call.
 *
 * `rotate()` with no argument applies the EXIF orientation and then drops the
 * metadata, so a sideways phone photo is corrected AND the EXIF (which can
 * carry GPS) never reaches the model.
 */
export async function prepareForVision(input: string | Buffer): Promise<PreparedImage> {
  // Not every stored image is base64. Seeded and hosted rows carry a path
  // ("/images/foo.jpg") — decoding that as base64 yields garbage, so it is
  // handed back untouched and the caller ships exactly what it always did.
  if (typeof input === 'string' && !isEncodedImage(input)) {
    return {
      base64: input,
      mimeType: 'image/jpeg',
      bytesBefore: input.length,
      bytesAfter: input.length,
    };
  }

  const raw = typeof input === 'string' ? stripDataUrl(input) : null;
  const buffer = raw !== null ? Buffer.from(raw, 'base64') : (input as Buffer);
  const bytesBefore = buffer.length;

  try {
    const out = await sharp(buffer)
      .rotate()
      .resize({
        width: VISION_MAX_EDGE,
        height: VISION_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: VISION_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    // A "smaller" result that is actually larger means the source was already
    // better optimised than we can manage — keep the original.
    if (out.length >= bytesBefore) {
      return {
        base64: buffer.toString('base64'),
        mimeType: 'image/jpeg',
        bytesBefore,
        bytesAfter: bytesBefore,
      };
    }

    return {
      base64: out.toString('base64'),
      mimeType: 'image/jpeg',
      bytesBefore,
      bytesAfter: out.length,
    };
  } catch (error) {
    // Never fail a verification because the optimiser choked on a format.
    console.warn('[imagePrep] passthrough, could not re-encode:', (error as Error)?.message);
    return {
      base64: buffer.toString('base64'),
      mimeType: 'image/jpeg',
      bytesBefore,
      bytesAfter: bytesBefore,
    };
  }
}

/** Same, but tolerant of a missing image — returns null instead of throwing. */
export async function prepareForVisionSafe(
  input: string | null | undefined
): Promise<PreparedImage | null> {
  if (!input) return null;
  return prepareForVision(input);
}

/** Convenience for logs: "1.8 MB → 143 KB (92% smaller)". */
export function describeSaving(p: PreparedImage): string {
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  const pct = p.bytesBefore > 0 ? Math.round((1 - p.bytesAfter / p.bytesBefore) * 100) : 0;
  return `${kb(p.bytesBefore)} → ${kb(p.bytesAfter)} (${pct}% smaller)`;
}

export { b64Bytes };
