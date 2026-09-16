import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { requireArtisan } from '@/lib/artisanAuth';
import { MAX_UPLOAD_BYTES, dataUrlBytes } from '@/lib/fileToDataUrl';

/**
 * Server-side background removal — the middle tier of the cutout ladder.
 *
 * WHY THIS EXISTS. `canRunBackgroundRemoval()` in src/lib/imageEnhance.ts
 * refuses the on-device model on any phone without WebGPU, under 4 GiB of
 * memory, or on a 2g/3g/saveData connection. That refusal is correct — without
 * WebGPU the 24 MB ONNX session runs on the main thread and freezes the tab
 * mid-capture — but it means a ₹6,000 Android handset, the device this product
 * exists for, got no cutout at all. This does the same matting on the server.
 *
 * THE SAME MODEL, NOT A DIFFERENT ONE. `@imgly/background-removal-node` is the
 * Node build of the library the browser already uses, so a cutout looks the
 * same whichever tier made it.
 *
 * NEVER THROWS INTO THE CLIENT. Every refusal is a typed `{ ok: false, reason }`
 * with a real status code, so the capture flow falls straight through to the
 * canvas-only enhancement instead of stalling.
 *
 * LICENCE. The package is AGPL-3.0 (as is the browser build already shipped).
 * Serving it over the network engages AGPL §13 — see
 * docs/PHOTO_STUDIO_SHOPIFY_V11_PLAN.md before using this in a closed product.
 */

export const dynamic = 'force-dynamic';
/** Native bindings (onnxruntime-node, sharp) — never the edge runtime. */
export const runtime = 'nodejs';
/** Headroom over HARD_TIMEOUT_MS for the response itself on hosted platforms. */
export const maxDuration = 30;

/** Off unless explicitly enabled — see `.env.example` for the deployment-size caveat. */
const ENABLED = process.env.SERVER_CUTOUT_ENABLED === 'true';

/**
 * Past this the client is told to fall back. Measured locally: a warm cutout of
 * a 1024 px frame takes ~1.8 s and a cold one ~2.1 s, so 20 s is only ever hit
 * by a genuinely overloaded instance.
 */
const HARD_TIMEOUT_MS = 20_000;

/** Longest edge the model sees. The client already downscales; this is the backstop. */
const MODEL_MAX_EDGE = 1024;

/**
 * Concurrency bounds.
 *
 * Inference is CPU-bound and cannot be cancelled: `Promise.race` stops us
 * WAITING, but the ONNX session keeps computing until it finishes. So a slot is
 * released when the real work settles, not when the client gives up — otherwise
 * timeouts would quietly let unbounded work pile up behind a cap that only
 * looked enforced. One per artisan stops a single person (or a stuck retry loop)
 * holding every slot.
 */
const MAX_IN_FLIGHT = 2;
let inFlight = 0;
const busyArtisans = new Set<string>();

type Failure = 'disabled' | 'invalid' | 'too_large' | 'busy' | 'timeout' | 'failed';

function fail(reason: Failure, status: number, message: string) {
  return NextResponse.json({ ok: false, reason, message }, { status });
}

const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/i;

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  if (!ENABLED) {
    return fail('disabled', 503, 'Server background removal is not enabled on this deployment.');
  }

  const body = await req.json().catch(() => ({}));
  const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : '';
  if (!IMAGE_DATA_URL.test(imageBase64)) {
    return fail('invalid', 400, 'Send the photo as a JPEG, PNG or WebP data URL.');
  }
  if (dataUrlBytes(imageBase64) > MAX_UPLOAD_BYTES) {
    return fail('too_large', 413, 'The photo is larger than 2 MB.');
  }

  const artisanId = auth.artisan.userId;
  if (busyArtisans.has(artisanId)) {
    return fail('busy', 429, 'Your previous photo is still being processed.');
  }
  if (inFlight >= MAX_IN_FLIGHT) {
    return fail('busy', 429, 'The background remover is busy. Your photo will use its original background.');
  }

  inFlight += 1;
  busyArtisans.add(artisanId);
  const started = Date.now();

  // The actual work, as one promise whose settlement frees the slot.
  const work = (async () => {
    const input = Buffer.from(imageBase64.slice(imageBase64.indexOf(',') + 1), 'base64');
    // `rotate()` applies EXIF orientation and drops the metadata, so a sideways
    // phone photo is matted the right way up and no GPS tag reaches the model.
    const prepared = await sharp(input)
      .rotate()
      .resize({ width: MODEL_MAX_EDGE, height: MODEL_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    // Imported lazily: the model and its native runtime are only paid for by a
    // request that actually needs them, and a deployment with this route
    // disabled never loads them at all.
    const { removeBackground } = await import('@imgly/background-removal-node');
    const blob = await removeBackground(new Blob([new Uint8Array(prepared)], { type: 'image/jpeg' }), {
      model: 'medium',
      // PNG, because the contact shadow and every backdrop preset need the alpha.
      output: { format: 'image/png' },
    });
    return Buffer.from(await blob.arrayBuffer());
  })();

  work
    .catch(() => undefined)
    .finally(() => {
      inFlight -= 1;
      busyArtisans.delete(artisanId);
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), HARD_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([work, timeout]);
    if (result === 'timeout') {
      console.warn(`[items/background] timed out after ${HARD_TIMEOUT_MS} ms for ${artisanId}`);
      return fail('timeout', 504, 'Background removal took too long. Your photo will use its original background.');
    }
    return NextResponse.json({
      ok: true,
      mode: 'SERVER',
      cutout: `data:image/png;base64,${result.toString('base64')}`,
      ms: Date.now() - started,
    });
  } catch (error) {
    console.error('[items/background] cutout failed:', error);
    return fail('failed', 502, 'Background removal did not work for this photo. It will use its original background.');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
