"use client";

import { MAX_UPLOAD_BYTES, readFileAsDataUrl } from "@/lib/fileToDataUrl";

/**
 * Shrink a photo IN THE BROWSER, before it is ever uploaded.
 *
 * This is the half of the image budget the artisan actually pays for. A modern
 * phone camera produces 3–8 MB JPEGs; on a 2G/edge link that is minutes of
 * upload for a picture the server immediately downscales to 1024 px anyway
 * (see `src/lib/imagePrep.ts`). Doing it here means the bytes never leave the
 * handset.
 *
 * Never throws: a file the canvas cannot decode (HEIC on an old browser, a PDF
 * bill) falls back to the plain data-URL read, so an upload still happens.
 */

/** Longest edge after downscaling. Generous enough for QA and vision matching. */
export const CLIENT_MAX_EDGE = 1600;
/** First-pass JPEG quality. */
export const CLIENT_QUALITY = 0.78;
/** Retry quality when the first pass is still over budget. */
export const CLIENT_QUALITY_RETRY = 0.65;
/** Target ceiling. Well inside the 2 MB the APIs enforce. */
export const CLIENT_TARGET_BYTES = 800 * 1024;

export interface PrepareImageOptions {
  maxEdge?: number;
  quality?: number;
}

/** Byte length of a data URL's base64 payload, without decoding it. */
function dataUrlBytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((payload.length * 3) / 4);
}

/** Decode a File into something drawable, preferring the cheap path. */
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  // createImageBitmap avoids an <img> round trip and honours EXIF orientation
  // on every browser that has it.
  if (typeof createImageBitmap === "function") {
    return (await createImageBitmap(file, {
      imageOrientation: "from-image",
    })) as ImageBitmap;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return img as unknown as CanvasImageSource & { width: number; height: number };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Downscale + re-encode `file` to a JPEG data URL.
 *
 * Non-images (a PDF bill) are returned as-is — there is nothing to downscale
 * and re-encoding would corrupt them.
 */
export async function prepareImage(
  file: File,
  opts: PrepareImageOptions = {}
): Promise<string> {
  const maxEdge = opts.maxEdge ?? CLIENT_MAX_EDGE;
  const quality = opts.quality ?? CLIENT_QUALITY;

  if (!file.type.startsWith("image/")) {
    return readFileAsDataUrl(file);
  }

  try {
    const source = await decode(file);
    const w = source.width;
    const h = source.height;
    if (!w || !h) return readFileAsDataUrl(file);

    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) return readFileAsDataUrl(file);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    // Release the bitmap's memory on the phones that need it most.
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();

    let out = canvas.toDataURL("image/jpeg", quality);
    // Still too big for a weak link — one more pass at lower quality rather
    // than failing the upload or shipping a megabyte.
    if (dataUrlBytes(out) > CLIENT_TARGET_BYTES) {
      out = canvas.toDataURL("image/jpeg", CLIENT_QUALITY_RETRY);
    }

    // If the re-encode somehow grew the file, keep the original bytes.
    const original = await readFileAsDataUrl(file);
    return dataUrlBytes(out) < dataUrlBytes(original) ? out : original;
  } catch (error) {
    console.warn("[clientImagePrep] falling back to raw read:", (error as Error)?.message);
    return readFileAsDataUrl(file);
  }
}

/**
 * `prepareImage` plus the app-wide size guard.
 * Returns `{ dataUrl }` on success or `{ error }` with a ready-to-show message.
 */
export async function prepareImageChecked(
  file: File
): Promise<{ dataUrl: string; error?: undefined } | { dataUrl?: undefined; error: string }> {
  const dataUrl = await prepareImage(file);
  if (dataUrlBytes(dataUrl) > MAX_UPLOAD_BYTES) {
    return { error: `"${file.name}" is still over 2 MB after compression.` };
  }
  return { dataUrl };
}

export { dataUrlBytes as clientDataUrlBytes };
