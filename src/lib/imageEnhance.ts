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
 *
 * V11 adds `buildPhotoVariants()`: instead of one frame silently replacing the
 * camera's, it returns the original, the enhanced frame and a set of looks the
 * artisan chooses between. See docs/PHOTO_STUDIO_SHOPIFY_V11_PLAN.md §4.
 *
 * THE PROVENANCE RULE, enforced by construction below: the only operations ever
 * applied to the product's own pixels are (1) the alpha matte from the cutout
 * model, (2) one global per-channel colour transform — grey-world gains and a
 * levels LUT, identical for every pixel, the same class of adjustment a phone
 * camera makes — and (3) a 3x3 sharpen on the enhanced frame. No pixel of the
 * product is added, moved, inpainted or synthesised, and no generative model
 * ever receives it. A buyer's later authenticity check compares the delivered
 * piece against the artisan's camera frame; a redrawn product would break it.
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
const MAX_EDGE = 1200;

/**
 * Histogram and white-balance statistics are read from a thumbnail, not the
 * full frame.
 *
 * The numbers this pass needs — channel averages and a 2nd/98th percentile
 * luminance cut — are image-wide aggregates. Computing them over 1.4 million
 * pixels instead of 65 thousand changes the result by well under one greyscale
 * level while costing ~20x the time, on the main thread, in front of an artisan
 * waiting to photograph a saree.
 */
const STATS_MAX_EDGE = 256;

/**
 * Above this pixel count the sharpen pass is skipped.
 *
 * The 3x3 convolution is O(pixels x 9 x 3) in plain JS. At the old 1400px cap
 * that is ~53 million multiply-adds in a single synchronous loop — seconds of
 * frozen tab on a mid-range laptop, and the "This page isn't responding"
 * dialog on anything weaker. Sharpening is a cosmetic nicety; being able to
 * complete a capture is not.
 */
const SHARPEN_MAX_PIXELS = 480_000;

/** Hand control back to the browser so it can paint between heavy passes. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Is this device worth asking to run a 24 MB ONNX matting model?
 *
 * `deviceMemory` and `hardwareConcurrency` are advisory and absent on Safari,
 * where we assume capable rather than punishing every iPhone. `saveData` and a
 * 2g `effectiveType` are explicit user/network signals and are honoured.
 */
function canRunBackgroundRemoval(): boolean {
  if (typeof navigator === 'undefined') return false;

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; saveData?: boolean };
    gpu?: unknown;
  };

  /**
   * WebGPU is the hard requirement, and it is not about speed.
   *
   * `@imgly/background-removal` only honours `proxyToWorker` when WebGPU is
   * available (`proxyToWorker = useWebGPU && config.proxyToWorker` in its
   * bundle). Without it the ONNX session runs on the main thread, and no
   * timeout can rescue that: `Promise.race` stops us waiting but cannot stop
   * the model computing, so the tab stays frozen and the browser shows
   * "This page isn't responding" mid-capture. Running the model only when it
   * can be moved off the main thread is the difference between a nicer photo
   * and an artisan who cannot list their work at all.
   */
  if (!nav.gpu) return false;

  if (nav.connection?.saveData) return false;
  const effectiveType = nav.connection?.effectiveType;
  if (effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g') return false;

  // Reported in GiB, rounded down to a power of two. 4 is a mid-range phone.
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) return false;
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency < 4) return false;

  return true;
}

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

interface FrameStats {
  avgR: number;
  avgG: number;
  avgB: number;
  low: number;
  high: number;
}

interface ToneMap {
  /** False when there is no cast worth correcting. */
  applyGains: boolean;
  gainR: number;
  gainG: number;
  gainB: number;
  lut: Uint8ClampedArray;
}

/**
 * The global colour transform, computed once from frame statistics.
 *
 * Pulled out of `enhanceOnCanvas` so the backdrop presets can colour-correct a
 * cutout with EXACTLY the same arithmetic — two copies of this would drift the
 * first time one was tuned. The numbers are unchanged from the original pass.
 */
function buildToneMap(stats: FrameStats): ToneMap {
  // --- Grey-world white balance ------------------------------------------
  // Workshop bulbs are strongly yellow, which tints the whole product. The
  // grey-world assumption says a varied scene should average to neutral grey,
  // so scaling each channel toward the mean of the three removes the cast
  // without needing a reference card in the frame.
  const { avgR, avgG, avgB } = stats;
  const grey = (avgR + avgG + avgB) / 3;

  // Only correct a cast worth correcting, and clamp the gain: an image that is
  // legitimately mostly one colour (a red saree) must not be drained to grey.
  const applyGains = grey > 8 && Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB) > 4;
  const clampGain = (gain: number) => Math.max(0.85, Math.min(1.15, gain));
  const gainR = applyGains ? clampGain(grey / (avgR || grey)) : 1;
  const gainG = applyGains ? clampGain(grey / (avgG || grey)) : 1;
  const gainB = applyGains ? clampGain(grey / (avgB || grey)) : 1;

  // --- Brightness/contrast normalisation ----------------------------------
  // Stretch the luminance histogram between its 2nd and 98th percentile, so a
  // photo shot in a dim workshop gains range without blowing out highlights.
  let low = stats.low;
  let high = stats.high;
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

  return { applyGains, gainR, gainG, gainB, lut };
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

  // Statistics come from a thumbnail — see STATS_MAX_EDGE. Everything below
  // that reads `stats` used to walk the full-resolution buffer twice.
  const tone = buildToneMap(sampleStats(image));

  const frame = ctx.getImageData(0, 0, width, height);
  const px = frame.data;

  // --- Pass 0: grey-world white balance (see buildToneMap) ----------------
  if (tone.applyGains) {
    for (let i = 0; i < px.length; i += 4) {
      px[i] = Math.max(0, Math.min(255, px[i] * tone.gainR));
      px[i + 1] = Math.max(0, Math.min(255, px[i + 1] * tone.gainG));
      px[i + 2] = Math.max(0, Math.min(255, px[i + 2] * tone.gainB));
    }
  }

  // --- Pass 1: brightness/contrast normalisation (see buildToneMap) -------
  // The histogram is the thumbnail's, for the reason given at STATS_MAX_EDGE.
  const { lut } = tone;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i]];
    px[i + 1] = lut[px[i + 1]];
    px[i + 2] = lut[px[i + 2]];
  }

  // --- Pass 2: mild sharpen ----------------------------------------------
  // 3x3 convolution, applied to a copy so neighbours are read pre-sharpen.
  // Skipped above SHARPEN_MAX_PIXELS: this is the single most expensive thing
  // in the capture flow and it is the one step nobody misses.
  if (width * height <= SHARPEN_MAX_PIXELS) {
    // Let the browser paint the levels result before starting the convolution.
    ctx.putImageData(frame, 0, 0);
    await yieldToBrowser();

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
  }

  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Channel averages and the luminance percentile cuts, read from a thumbnail.
 *
 * One small `drawImage` plus a ~65k-pixel walk replaces two full-resolution
 * passes over the working buffer. The browser's own downscale is doing the
 * averaging for us, which is exactly what an aggregate wants.
 */
function sampleStats(image: HTMLImageElement): FrameStats {
  const fallback = { avgR: 128, avgG: 128, avgB: 128, low: 0, high: 255 };

  const scale = Math.min(1, STATS_MAX_EDGE / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallback;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // Tainted canvas (a cross-origin source) — enhance without stats rather
    // than failing the capture.
    return fallback;
  }

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    sumR += data[i];
    sumG += data[i + 1];
    sumB += data[i + 2];
    const luma = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    histogram[Math.max(0, Math.min(255, Math.round(luma)))] += 1;
  }

  const pixels = data.length / 4;
  const lowCut = pixels * 0.02;
  const highCut = pixels * 0.98;
  let cumulative = 0;
  let low = 0;
  let high = 255;
  for (let level = 0; level < 256; level += 1) {
    cumulative += histogram[level];
    if (cumulative <= lowCut) low = level;
    if (cumulative <= highCut) high = level;
  }

  return { avgR: sumR / pixels, avgG: sumG / pixels, avgB: sumB / pixels, low, high };
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

// ===========================================================================
// V11 — the cutout ladder
// ===========================================================================

export type BackgroundRemovalMode = 'ON_DEVICE' | 'SERVER' | 'NONE';

/** Upload size for the server tier. The model gains nothing past 1024 px. */
const SERVER_UPLOAD_EDGE = 1024;
const SERVER_UPLOAD_QUALITY = 0.78;
/**
 * Client-side ceiling on the server tier. The route's own hard timeout is 20 s;
 * the extra covers upload on a weak link. Past this the artisan keeps their
 * background rather than watching a spinner.
 */
const SERVER_TIMEOUT_MS = 25_000;

interface CutoutOutcome {
  /** Transparent PNG data URL, or null when no tier produced one. */
  cutout: string | null;
  mode: BackgroundRemovalMode;
}

/** The existing on-device path. Resolves null on timeout; throws on a real error. */
async function removeOnDevice(dataUrl: string): Promise<string | null> {
  const blob = await dataUrlToBlob(dataUrl);

  // Imported lazily so the ~and-then-some WASM bundle is only fetched when an
  // artisan actually uploads a photo, not on every dashboard load.
  const removal = import('@imgly/background-removal').then(({ removeBackground }) =>
    removeBackground(blob, {
      // `isnet` is the high-quality matting model; the default trades edge
      // accuracy for speed, which shows badly on fabric fringes and fringed
      // saree ends. PNG because the cutout needs its alpha channel.
      model: 'isnet',
      output: { format: 'image/png', quality: 0.9 },
      // Run the session in a worker on the GPU. Both are required for the main
      // thread to stay free — see canRunBackgroundRemoval(), which refuses to
      // start at all unless WebGPU is present, because the library silently
      // ignores proxyToWorker without it.
      device: 'gpu',
      proxyToWorker: true,
    })
  );

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), BG_REMOVAL_TIMEOUT_MS)
  );

  const result = await Promise.race([removal, timeout]);
  return result ? blobToDataUrl(result as Blob) : null;
}

/** POST /api/items/background. Null on any refusal — the caller falls through. */
async function removeOnServer(dataUrl: string): Promise<string | null> {
  if (typeof fetch === 'undefined') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  try {
    // Downscaled before upload: a phone photo is up to 2 MB of base64 on the
    // artisan's own data plan, and the model gains nothing past 1024 px.
    const upload = await downscaleImage(dataUrl, SERVER_UPLOAD_EDGE, SERVER_UPLOAD_QUALITY);
    const res = await fetch('/api/items/background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: upload }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data?.ok && typeof data.cutout === 'string' ? data.cutout : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ON_DEVICE → SERVER → NONE.
 *
 * - A device that passes `canRunBackgroundRemoval()` uses the existing worker +
 *   WebGPU path. A TIMEOUT or an ERROR there falls through to SERVER.
 *
 *   The plan first sent a timeout straight to NONE, to spare a 37 s spinner.
 *   Measured in the browser, that was the wrong trade: the timeout almost always
 *   means the ~40 MB model was still DOWNLOADING on the artisan's first capture
 *   (≈9 s of fetches, then inference), so every first capture lost its looks.
 *   The spinner blocks nothing — Original and Enhanced are already selectable
 *   and Next is enabled — and the server answers in 2–5 s, so the fall-through
 *   costs a status line, not the artisan's time. Warm, on-device takes ~1.5 s.
 * - A device that fails the check — the ₹6,000 phone — goes to the server.
 * - NONE is a valid ending, never an error: the gallery still has the original
 *   and the enhanced frame, and capture still completes.
 */
async function obtainCutout(dataUrl: string, allowServer: boolean): Promise<CutoutOutcome> {
  if (canRunBackgroundRemoval()) {
    try {
      const cutout = await removeOnDevice(dataUrl);
      if (cutout) return { cutout, mode: 'ON_DEVICE' };
      console.info('[imageEnhance] on-device removal timed out');
    } catch (error) {
      console.warn('[imageEnhance] on-device removal failed, trying the server:', (error as Error)?.message);
    }
  } else {
    console.info('[imageEnhance] device too constrained for on-device removal');
  }

  if (allowServer) {
    const cutout = await removeOnServer(dataUrl);
    if (cutout) return { cutout, mode: 'SERVER' };
  }
  return { cutout: null, mode: 'NONE' };
}

// ===========================================================================
// V11 — backdrops and variants
// ===========================================================================

export type VariantKind = 'ORIGINAL' | 'ENHANCED' | 'PRESET' | 'GENERATED';

export interface PhotoVariant {
  /** ORIGINAL | ENHANCED | PRESET_<name> | GENERATED_<n>. Persisted as selectedImageVariant. */
  key: string;
  /** An i18n KEY — the gallery translates it. */
  label: string;
  dataUrl: string;
  kind: VariantKind;
}

export interface PhotoVariants {
  /** The camera frame, downscaled for storage and otherwise untouched. */
  original: string;
  enhanced: string;
  /** Colour-corrected transparent cutout, or null when no tier produced one. */
  cutout: string | null;
  variants: PhotoVariant[];
  backgroundRemovalMode: BackgroundRemovalMode;
  /**
   * True when a tier DID produce a cutout but `assessCutout()` found it had cut
   * into the craft, so it was discarded. Mode is then NONE, and the UI says
   * why instead of implying removal simply failed.
   */
  cutoutRejected?: boolean;
}

/*
 * THE CUTOUT GUARD — measured, not picked.
 *
 * A matting model assumes "object on a background". Artisans very often shoot
 * a textile or painting that FILLS the frame; the model then calls most of the
 * craft "background" and keeps a few border strips. Composited onto a preset,
 * that is a listing photo with the product erased.
 *
 * Two numbers, on a 256 px thumbnail:
 *   kept  — share of the frame's DETAIL (|Laplacian| of luma) under the matte.
 *           Plain backgrounds carry little detail, so a good cutout keeps most
 *           of it; a weave the model threw away takes its detail with it.
 *   soft  — share of the matte that is semi-transparent (0.15 < α < 0.85). A
 *           confused model leaves a ghostly, see-through product.
 *
 * Calibrated on 60 seed photos (public/seed, server model), judged by eye on a
 * contact sheet of each cutout:
 *   kept ≥ 0.50           every cutout clean (bidriware, dhokra, blue pottery…)
 *   kept < 0.30           every cutout destroyed the craft (sarees, paintings)
 *   0.30 ≤ kept < 0.50    mixed — the good ones had soft ≤ 0.22, the bad ones
 *                         (embroidery on black, shawls, a washed-out saree)
 *                         soft ≥ 0.33
 */
const CUTOUT_CONFIDENT_KEPT = 0.5;
const CUTOUT_MIN_KEPT = 0.3;
const CUTOUT_MAX_SOFT = 0.3;

/** Does this cutout keep the craft? Never rejects; on any failure it trusts the cutout. */
async function assessCutout(original: HTMLImageElement, cutout: HTMLImageElement): Promise<boolean> {
  try {
    const scale = Math.min(1, STATS_MAX_EDGE / Math.max(original.width, original.height));
    const w = Math.max(3, Math.round(original.width * scale));
    const h = Math.max(3, Math.round(original.height * scale));
    const read = (image: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('No 2D canvas');
      ctx.drawImage(image, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const o = read(original);
    const c = read(cutout);
    await yieldToBrowser();

    const luma = new Float32Array(w * h);
    for (let i = 0; i < w * h; i += 1) luma[i] = 0.299 * o[i * 4] + 0.587 * o[i * 4 + 1] + 0.114 * o[i * 4 + 2];

    let energy = 0;
    let energyKept = 0;
    let opaque = 0;
    let soft = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        const a = c[i * 4 + 3] / 255;
        if (a > 0.15) {
          opaque += 1;
          if (a < 0.85) soft += 1;
        }
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
        const lap = Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w]);
        energy += lap;
        energyKept += lap * a;
      }
    }
    const kept = energy > 0 ? energyKept / energy : 1;
    const softness = opaque > 0 ? soft / opaque : 1;
    const usable = kept >= CUTOUT_CONFIDENT_KEPT || (kept >= CUTOUT_MIN_KEPT && softness <= CUTOUT_MAX_SOFT);
    if (!usable) {
      console.info(`[imageEnhance] cutout discarded: kept ${kept.toFixed(2)}, soft ${softness.toFixed(2)}`);
    }
    return usable;
  } catch {
    return true;
  }
}

export interface BuildVariantOptions {
  /** Try `/api/items/background` when the device cannot run the model. */
  allowServer?: boolean;
  /** Progress for the compact status line. */
  onPhase?: (phase: 'enhancing' | 'removing_background' | 'composing') => void;
  /** Each look as soon as it exists, so the gallery fills in progressively. */
  onVariant?: (variant: PhotoVariant) => void;
  /**
   * Optional generative backdrops. Called ONLY when a cutout exists, and asked
   * for backgrounds alone — the product is composited over them here.
   */
  generateBackdrops?: () => Promise<string[]>;
}

/** A design token from the live stylesheet, so a preset can never drift from the theme. */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

type Backdrop = (ctx: CanvasRenderingContext2D, width: number, height: number) => void | Promise<void>;

/** Deterministic pseudo-random, so a procedural texture is the same every time it is drawn. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BACKDROPS: { key: string; label: string; draw: Backdrop }[] = [
  {
    key: 'PRESET_WHITE',
    label: 'variant_white',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    key: 'PRESET_CREAM',
    label: 'variant_cream',
    draw: (ctx, w, h) => {
      ctx.fillStyle = token('--color-cream', '#F6F3EE');
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    // A soft studio falloff: bright where the piece sits, easing to the pill tone
    // at the edges — the look of a lit sweep without a single invented object.
    key: 'PRESET_GRADIENT',
    label: 'variant_gradient',
    draw: (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.1, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, '#FFFFFF');
      g.addColorStop(1, token('--color-pill', '#ECE7E0'));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    // A handloom basket weave, drawn from warm neutral tokens. Procedural, so it
    // costs no asset download and looks identical offline.
    key: 'PRESET_WOVEN',
    label: 'variant_woven',
    draw: (ctx, w, h) => {
      const base = token('--color-pill', '#ECE7E0');
      const thread = token('--color-sage', '#D9D0C4');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      const cell = Math.max(10, Math.round(Math.min(w, h) / 28));
      const band = Math.max(3, Math.round(cell * 0.42));
      const rand = seeded(7);
      for (let y = 0; y < h; y += cell) {
        for (let x = 0; x < w; x += cell) {
          const across = ((x / cell) + (y / cell)) % 2 === 0;
          ctx.globalAlpha = 0.55 + rand() * 0.25;
          ctx.fillStyle = thread;
          if (across) ctx.fillRect(x, y + (cell - band) / 2, cell, band);
          else ctx.fillRect(x + (cell - band) / 2, y, band, cell);
        }
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    // A pale wooden surface: long grain lines over a warm beige base, the
    // "workshop table" look, again from tokens rather than a photo.
    key: 'PRESET_WOOD',
    label: 'variant_wood',
    draw: (ctx, w, h) => {
      ctx.fillStyle = token('--color-sage', '#D9D0C4');
      ctx.fillRect(0, 0, w, h);
      const grain = token('--color-primary-light', '#4A423C');
      const rand = seeded(19);
      const lines = Math.max(24, Math.round(h / 9));
      ctx.strokeStyle = grain;
      for (let i = 0; i < lines; i += 1) {
        const y0 = (i / lines) * h;
        const amp = 2 + rand() * 6;
        const freq = 0.004 + rand() * 0.006;
        const phase = rand() * Math.PI * 2;
        ctx.globalAlpha = 0.05 + rand() * 0.09;
        ctx.lineWidth = 0.6 + rand() * 1.6;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = y0 + Math.sin(x * freq + phase) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },
];

/** Keys of every deterministic preset, in gallery order. */
export const PRESET_KEYS = BACKDROPS.map((b) => b.key);

/**
 * Colour-correct a cutout with the SAME global transform the enhanced frame gets.
 *
 * The statistics come from the ORIGINAL frame — the real scene's lighting — not
 * from the cutout, whose transparent pixels would read as white and skew the
 * balance. Only pixels with any opacity are touched, and alpha is never changed,
 * so the matte the model produced is exactly the matte that is drawn. No
 * sharpen here: sharpening a matte edge rings into a visible halo.
 */
async function toneCorrectCutout(cutoutDataUrl: string, originalDataUrl: string): Promise<string> {
  const [cutout, original] = await Promise.all([loadImage(cutoutDataUrl), loadImage(originalDataUrl)]);
  const tone = buildToneMap(sampleStats(original));

  const scale = Math.min(1, MAX_EDGE / Math.max(cutout.width, cutout.height));
  const width = Math.max(1, Math.round(cutout.width * scale));
  const height = Math.max(1, Math.round(cutout.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return cutoutDataUrl;
  ctx.drawImage(cutout, 0, 0, width, height);
  await yieldToBrowser();

  const frame = ctx.getImageData(0, 0, width, height);
  const px = frame.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    let r = px[i];
    let g = px[i + 1];
    let b = px[i + 2];
    if (tone.applyGains) {
      r = Math.max(0, Math.min(255, r * tone.gainR));
      g = Math.max(0, Math.min(255, g * tone.gainG));
      b = Math.max(0, Math.min(255, b * tone.gainB));
    }
    px[i] = tone.lut[Math.round(r)];
    px[i + 1] = tone.lut[Math.round(g)];
    px[i + 2] = tone.lut[Math.round(b)];
  }
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Draw a backdrop, the contact shadow, then the cutout on top.
 *
 * The cutout is ALWAYS drawn last, over whatever ground was produced — so no
 * backdrop, deterministic or generated, can ever sit on top of the product or
 * be mistaken for it. Shadow parameters are `compositeWithShadow`'s, so every
 * preset is lit the same way.
 */
async function composeOnBackdrop(cutout: HTMLImageElement, draw: Backdrop): Promise<string> {
  const scale = Math.min(1, MAX_EDGE / Math.max(cutout.width, cutout.height));
  const width = Math.max(1, Math.round(cutout.width * scale));
  const height = Math.max(1, Math.round(cutout.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');

  await draw(ctx, width, height);

  const blur = Math.max(6, Math.round(width * 0.018));
  const offsetY = Math.max(4, Math.round(height * 0.012));
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(cutout, 0, offsetY, width, height);
  ctx.restore();

  ctx.drawImage(cutout, 0, 0, width, height);
  // The ground is opaque, so JPEG: a fraction of a PNG's size with nothing lost.
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Fill the canvas with a generated image, cropped to cover, as a backdrop. */
function imageBackdrop(src: HTMLImageElement): Backdrop {
  return (ctx, w, h) => {
    const s = Math.max(w / src.width, h / src.height);
    const dw = src.width * s;
    const dh = src.height * s;
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
  };
}

/** Max generated looks per capture — each one costs quota an artisan captures ~20 pieces on. */
const MAX_GENERATED = 2;

/**
 * Every look for one photo. Never rejects.
 *
 * Original and Enhanced always exist. Presets exist only when a cutout does —
 * without one there is nothing to place on a new background. A preset that
 * throws is omitted, never fatal. Generated looks exist only when the caller
 * supplies backdrops AND a cutout exists.
 */
export async function buildPhotoVariants(
  dataUrl: string,
  opts: BuildVariantOptions = {}
): Promise<PhotoVariants> {
  const variants: PhotoVariant[] = [];
  const add = (variant: PhotoVariant) => {
    variants.push(variant);
    opts.onVariant?.(variant);
  };

  // The camera frame, sized for storage — the only change is resolution.
  const original = await downscaleImage(dataUrl);
  add({ key: 'ORIGINAL', label: 'variant_original', dataUrl: original, kind: 'ORIGINAL' });

  opts.onPhase?.('enhancing');
  await yieldToBrowser();
  let enhanced = original;
  try {
    enhanced = await downscaleImage(await enhanceOnCanvas(original));
  } catch (error) {
    console.warn('[imageEnhance] enhancement skipped:', (error as Error)?.message);
  }
  add({ key: 'ENHANCED', label: 'variant_enhanced', dataUrl: enhanced, kind: 'ENHANCED' });

  opts.onPhase?.('removing_background');
  const { cutout: rawCutout, mode } = await obtainCutout(original, opts.allowServer ?? false);
  if (!rawCutout) {
    return { original, enhanced, cutout: null, variants, backgroundRemovalMode: 'NONE' };
  }

  // A cutout that cut into the craft is worse than none: every preset would
  // show the product erased. Judge it against the frame before composing.
  try {
    const [originalImage, rawImage] = await Promise.all([loadImage(original), loadImage(rawCutout)]);
    if (!(await assessCutout(originalImage, rawImage))) {
      return { original, enhanced, cutout: null, variants, backgroundRemovalMode: 'NONE', cutoutRejected: true };
    }
  } catch {
    // Undecodable here means undecodable below too; that path already says NONE.
  }

  opts.onPhase?.('composing');
  let cutout = rawCutout;
  try {
    cutout = await toneCorrectCutout(rawCutout, original);
  } catch (error) {
    console.warn('[imageEnhance] cutout colour correction skipped:', (error as Error)?.message);
  }

  let cutoutImage: HTMLImageElement;
  try {
    cutoutImage = await loadImage(cutout);
  } catch {
    // A cutout we cannot decode is no cutout — and the artisan is told NONE.
    return { original, enhanced, cutout: null, variants, backgroundRemovalMode: 'NONE' };
  }

  for (const backdrop of BACKDROPS) {
    await yieldToBrowser();
    try {
      add({
        key: backdrop.key,
        label: backdrop.label,
        dataUrl: await composeOnBackdrop(cutoutImage, backdrop.draw),
        kind: 'PRESET',
      });
    } catch (error) {
      console.warn(`[imageEnhance] preset ${backdrop.key} skipped:`, (error as Error)?.message);
    }
  }

  if (opts.generateBackdrops) {
    try {
      const backdrops = (await opts.generateBackdrops()).slice(0, MAX_GENERATED);
      for (let i = 0; i < backdrops.length; i += 1) {
        await yieldToBrowser();
        try {
          const ground = await loadImage(backdrops[i]);
          add({
            key: `GENERATED_${i + 1}`,
            label: 'variant_generated',
            dataUrl: await composeOnBackdrop(cutoutImage, imageBackdrop(ground)),
            kind: 'GENERATED',
          });
        } catch (error) {
          console.warn('[imageEnhance] generated backdrop skipped:', (error as Error)?.message);
        }
      }
    } catch (error) {
      // Quota, a missing key, a timeout — the tier is simply absent.
      console.info('[imageEnhance] generative backdrops unavailable:', (error as Error)?.message);
    }
  }

  return { original, enhanced, cutout, variants, backgroundRemovalMode: mode };
}

/**
 * Re-render one preset from a stored cutout — for the listing picker, which can
 * offer a look the artisan did not pick at capture time. Null when the key is
 * not a deterministic preset or the cutout will not decode.
 */
export async function renderPreset(cutoutDataUrl: string, key: string): Promise<string | null> {
  const backdrop = BACKDROPS.find((b) => b.key === key);
  if (!backdrop) return null;
  try {
    return await composeOnBackdrop(await loadImage(cutoutDataUrl), backdrop.draw);
  } catch {
    return null;
  }
}

/** Gallery / picker thumbnail: ≤320 px JPEG q0.7, ~15–25 KB. Never rejects. */
export function makeVariantThumbnail(dataUrl: string): Promise<string> {
  return downscaleImage(dataUrl, 320, 0.7);
}

/** Just under the server's 700 KB cutout cap (MAX_CUTOUT_BYTES), leaving room for base64 rounding. */
const CUTOUT_BUDGET_BYTES = 650 * 1024;
/** Tried largest first; the first that fits the budget is kept. */
const CUTOUT_EDGES = [900, 760, 640, 520];

/**
 * Shrink a transparent cutout for storage, keeping its alpha channel.
 *
 * The stored cutout does two jobs: the listing picker re-renders presets from
 * it, and the server PROVES a studio look against it (src/lib/lookProvenance.ts).
 * A cutout the server has to drop for size therefore costs the artisan their
 * chosen look, not just a later re-render — so this fits it under the cap.
 *
 * `downscaleImage` re-encodes to JPEG, which would flatten the matte onto
 * white. Instead: WebP with alpha first (a fraction of PNG's size; every
 * Chromium phone supports it), then PNG, at decreasing edges, until one fits.
 * Measured: a detailed bidriware jug was 773 KB as a 900 px PNG. Null when
 * nothing fits or the image will not decode.
 */
export async function shrinkCutout(dataUrl: string): Promise<string | null> {
  try {
    const image = await loadImage(dataUrl);
    for (const maxEdge of CUTOUT_EDGES) {
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, width, height);
      await yieldToBrowser();
      // A browser that cannot encode WebP silently returns PNG; the prefix says which.
      const webp = canvas.toDataURL('image/webp', 0.9);
      const candidates = webp.startsWith('data:image/webp') ? [webp, canvas.toDataURL('image/png')] : [webp];
      for (const candidate of candidates) {
        if (((candidate.length - candidate.indexOf(',') - 1) * 3) / 4 <= CUTOUT_BUDGET_BYTES) return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Remove the background, then enhance. Never rejects: on any failure the
 * enhanced original is returned with `backgroundRemoved: false`.
 *
 * Kept exactly as it behaved before V11 — on-device cutout only, contact shadow
 * on white, then the enhancement pass — and now a thin wrapper over the shared
 * cutout ladder. It is what the capture flow falls back to when
 * NEXT_PUBLIC_PHOTO_STUDIO_ENABLED is off, so its output must not change.
 */
export async function enhanceProductPhoto(dataUrl: string): Promise<EnhanceResult> {
  // `allowServer: false`: the pre-V11 path never called the server, and a
  // rollback must not start doing so.
  const { cutout: raw } = await obtainCutout(dataUrl, false);
  const cutout = raw ? await compositeWithShadow(raw).catch(() => raw) : null;

  try {
    const enhanced = await enhanceOnCanvas(cutout ?? dataUrl);
    return { dataUrl: enhanced, backgroundRemoved: cutout !== null };
  } catch (error) {
    console.warn('[imageEnhance] enhancement skipped:', (error as Error)?.message);
    return { dataUrl: cutout ?? dataUrl, backgroundRemoved: cutout !== null };
  }
}
