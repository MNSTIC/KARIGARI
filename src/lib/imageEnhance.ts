/**
 * Client-side product-photo cleanup, run before AI verification.
 *
 * What used to happen here was a two-second `setTimeout` labelled "Enhancing
 * image…" — the artisan watched a spinner and the original photo went to the
 * vision model unchanged. This does the work for real:
 *
 *   1. Background removal via `@imgly/background-removal` (WASM/ONNX, runs in
 *      the browser, no API key, nothing leaves the device).
 *   2. A light enhancement pass on a canvas: composite onto white, normalise
 *      brightness/contrast, mild unsharp-style sharpen.
 *
 * Both steps degrade rather than block. On a rural handset the ML model may be
 * slow to fetch or unsupported; past `BG_REMOVAL_TIMEOUT_MS` we keep the
 * enhanced original so capture never stalls, and the caller is told which
 * happened so the UI can be honest about it.
 */

/**
 * Past this, the cutout is abandoned and the enhanced original is used.
 *
 * 12s rather than 6s because we now ask for the higher-quality `isnet` model,
 * which is a larger download and a slower pass. The fallback is unchanged, so a
 * slow handset still gets a usable photo — it just does not get the cutout.
 */
const BG_REMOVAL_TIMEOUT_MS = 12000;

/** Long edge of the processed image. Keeps the base64 payload sane. */
const MAX_EDGE = 1400;

/** Long edge for anything stored on the item. See `downscaleImage`. */
export const STORED_MAX_EDGE = 1280;
export const STORED_QUALITY = 0.8;

export interface EnhanceResult {
  /** The image to verify and save. Always present. */
  dataUrl: string;
  /** True when the ML cutout actually ran and was used. */
  backgroundRemoved: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the image'));
    image.src = src;
  });
}

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then((res) => res.blob());
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the processed image'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Composite onto white, then normalise and sharpen.
 *
 * White matters for two reasons: a cutout is transparent, and a transparent PNG
 * encoded to JPEG for the vision model turns black. Compositing first means the
 * model sees a catalogue-style photo either way.
 */
async function enhanceOnCanvas(source: string): Promise<string> {
  const image = await loadImage(source);

  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const frame = ctx.getImageData(0, 0, width, height);
  const px = frame.data;

  // --- Pass 0: grey-world white balance ----------------------------------
  // Workshop bulbs are strongly yellow, which tints the whole product. The
  // grey-world assumption says a varied scene should average to neutral grey,
  // so scaling each channel toward the mean of the three removes the cast
  // without needing a reference card in the frame.
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < px.length; i += 4) {
    sumR += px[i];
    sumG += px[i + 1];
    sumB += px[i + 2];
  }
  const pixels = px.length / 4;
  const avgR = sumR / pixels;
  const avgG = sumG / pixels;
  const avgB = sumB / pixels;
  const grey = (avgR + avgG + avgB) / 3;

  // Only correct a cast worth correcting, and clamp the gain: an image that is
  // legitimately mostly one colour (a red saree) must not be drained to grey.
  if (grey > 8 && Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB) > 4) {
    const clampGain = (gain: number) => Math.max(0.85, Math.min(1.15, gain));
    const gainR = clampGain(grey / (avgR || grey));
    const gainG = clampGain(grey / (avgG || grey));
    const gainB = clampGain(grey / (avgB || grey));

    for (let i = 0; i < px.length; i += 4) {
      px[i] = Math.max(0, Math.min(255, px[i] * gainR));
      px[i + 1] = Math.max(0, Math.min(255, px[i + 1] * gainG));
      px[i + 2] = Math.max(0, Math.min(255, px[i + 2] * gainB));
    }
  }

  // --- Pass 1: brightness/contrast normalisation -------------------------
  // Stretch the luminance histogram between its 2nd and 98th percentile, so a
  // photo shot in a dim workshop gains range without blowing out highlights.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const luma = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    histogram[Math.max(0, Math.min(255, Math.round(luma)))] += 1;
  }

  const total = width * height;
  const lowCut = total * 0.02;
  const highCut = total * 0.98;
  let cumulative = 0;
  let low = 0;
  let high = 255;
  for (let level = 0; level < 256; level += 1) {
    cumulative += histogram[level];
    if (cumulative <= lowCut) low = level;
    if (cumulative <= highCut) high = level;
  }
  if (high - low < 16) {
    low = 0;
    high = 255; // Degenerate histogram (a near-flat image) — leave levels alone.
  }

  const range = high - low;
  const lut = new Uint8ClampedArray(256);
  for (let level = 0; level < 256; level += 1) {
    // Slight S-curve on top of the stretch for a bit of contrast punch.
    const normalised = Math.max(0, Math.min(1, (level - low) / range));
    const curved = normalised < 0.5
      ? 2 * normalised * normalised
      : 1 - 2 * (1 - normalised) * (1 - normalised);
    lut[level] = Math.round((normalised * 0.7 + curved * 0.3) * 255);
  }

  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i]];
    px[i + 1] = lut[px[i + 1]];
    px[i + 2] = lut[px[i + 2]];
  }

  // --- Pass 2: mild sharpen ----------------------------------------------
  // 3x3 convolution, applied to a copy so neighbours are read pre-sharpen.
  const source32 = new Uint8ClampedArray(px);
  const kernel = [0, -0.25, 0, -0.25, 2, -0.25, 0, -0.25, 0];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const centre = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            sum += source32[((y + ky) * width + (x + kx)) * 4 + channel] * kernel[k];
            k += 1;
          }
        }
        px[centre + channel] = sum;
      }
    }
  }

  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Drop a soft contact shadow beneath a transparent cutout, then flatten to white.
 *
 * A cutout pasted straight onto white reads as a sticker. A blurred, offset,
 * low-opacity copy of the subject's own silhouette underneath is what makes it
 * look photographed on a seamless — the same trick a catalogue shoot gets from
 * a light table.
 *
 * Takes the cutout WITH its alpha intact, so it must run before the enhancement
 * pass flattens the image.
 */
async function compositeWithShadow(cutoutDataUrl: string): Promise<string> {
  const image = await loadImage(cutoutDataUrl);

  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return cutoutDataUrl;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // The shadow is the subject drawn in near-black, blurred and nudged down.
  // Scaled to the image so it looks the same at any resolution.
  const blur = Math.max(6, Math.round(width * 0.018));
  const offsetY = Math.max(4, Math.round(height * 0.012));

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(image, 0, offsetY, width, height);
  ctx.restore();

  // Then the subject itself, sharp, on top.
  ctx.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL('image/png');
}

/**
 * Cap an image and re-encode it as JPEG before it is stored.
 *
 * Camera capture used `canvas.toDataURL("image/png")` — a full-resolution
 * lossless PNG, routinely several megabytes as base64. That string goes into
 * `CraftItem.images` verbatim and is then re-sent by every list query that
 * returns the row, so one photo slowed down the dashboard, the market grid and
 * the passport at once. JPEG at 1280px is visually equivalent for a product
 * card at a fraction of the bytes.
 *
 * Never rejects: on any failure the original data URL is returned unchanged, so
 * a capture is never lost to a compression problem.
 */
export async function downscaleImage(
  dataUrl: string,
  maxEdge: number = STORED_MAX_EDGE,
  quality: number = STORED_QUALITY
): Promise<string> {
  try {
    const image = await loadImage(dataUrl);
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;

    // White ground first: a transparent cutout encoded to JPEG turns black.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    const out = canvas.toDataURL('image/jpeg', quality);
    // Guard against the rare case where re-encoding grows the payload.
    return out.length < dataUrl.length ? out : dataUrl;
  } catch (error) {
    console.warn('[imageEnhance] downscale skipped:', (error as Error)?.message);
    return dataUrl;
  }
}

/**
 * Remove the background, then enhance. Never rejects: on any failure the
 * enhanced original is returned with `backgroundRemoved: false`.
 */
export async function enhanceProductPhoto(dataUrl: string): Promise<EnhanceResult> {
  let cutout: string | null = null;

  try {
    const blob = await dataUrlToBlob(dataUrl);

    // Imported lazily so the ~and-then-some WASM bundle is only fetched when an
    // artisan actually uploads a photo, not on every dashboard load.
    const removal = import('@imgly/background-removal').then(({ removeBackground }) =>
      removeBackground(blob, {
        // `isnet` is the high-quality matting model; the default trades edge
        // accuracy for speed, which shows badly on fabric fringes and fringed
        // saree ends. PNG because the cutout needs its alpha channel for the
        // contact shadow below.
        model: 'isnet',
        output: { format: 'image/png', quality: 0.9 },
      })
    );

    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), BG_REMOVAL_TIMEOUT_MS)
    );

    const result = await Promise.race([removal, timeout]);
    if (result) {
      const raw = await blobToDataUrl(result as Blob);
      // Shadow first, while the alpha channel is still there to trace.
      cutout = await compositeWithShadow(raw).catch(() => raw);
    }
  } catch (error) {
    // Unsupported browser, blocked WASM, or a model fetch failure on a weak
    // connection. Not fatal — the capture flow must not stall on it.
    console.warn('[imageEnhance] background removal skipped:', (error as Error)?.message);
  }

  try {
    const enhanced = await enhanceOnCanvas(cutout ?? dataUrl);
    return { dataUrl: enhanced, backgroundRemoved: cutout !== null };
  } catch (error) {
    console.warn('[imageEnhance] enhancement skipped:', (error as Error)?.message);
    return { dataUrl: cutout ?? dataUrl, backgroundRemoved: cutout !== null };
  }
}
