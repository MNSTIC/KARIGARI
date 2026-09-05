import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { generateContentWithFallback } from '@/lib/gemini';

/**
 * The physical-patch gate.
 *
 * An admin approving an item mints its `patchId` but publishes nothing. To make
 * the item sellable the artisan prints that QR, sticks it on the piece, and
 * photographs the two together. This route is the check, and it is deliberately
 * two independent tests:
 *
 *   1. The QR in the photo decodes to THIS item's patch id. Proves the right
 *      patch is on the thing being photographed.
 *   2. The photo shows the SAME craft item as the original capture. Proves the
 *      patch was not peeled off an approved piece and stuck on a different one.
 *
 * Either failing leaves the status untouched and returns a reason the artisan
 * can act on. Both passing flips the item to SELLABLE.
 */
export const dynamic = 'force-dynamic';

/** Same latency-first order as the other capture-flow vision routes. */
const CAPTURE_MODELS = ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite'];

type AuthToken = { userId: string; role: string };

async function requireArtisan(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token');
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  let decoded: AuthToken;
  try {
    decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) };
  }

  if (decoded.role !== 'ARTISAN') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 }),
    };
  }

  return { ok: true, userId: decoded.userId };
}

function base64Payload(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

/**
 * The original capture may be stored three ways: an inline data URI (the normal
 * capture flow), an absolute URL, or a site-relative path like
 * `/ikat_saree.jpg` (seeded rows). Only the first is already base64, so the
 * other two are fetched and encoded — otherwise the vision model was handed a
 * file path as if it were image bytes.
 */
async function originalAsBase64(source: string, req: Request): Promise<string | null> {
  if (source.startsWith('data:')) return base64Payload(source);

  try {
    const url = /^https?:/i.test(source)
      ? source
      : new URL(source, new URL(req.url).origin).toString();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (error) {
    console.warn('[attach-verify] could not load the original image:', (error as Error)?.message);
    return null;
  }
}

/**
 * Shrink an image before it goes to the vision model.
 *
 * A pair of full-size phone photos pushed this request past three minutes,
 * which is unusable for someone standing over a saree. 900px on the long edge
 * is far more than the model needs to compare motif, colour and border, and it
 * cuts the round trip to seconds.
 */
async function downscaleForVision(base64: string): Promise<string> {
  try {
    const out = await sharp(Buffer.from(base64, 'base64'))
      .rotate()
      .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return out.toString('base64');
  } catch (error) {
    console.warn('[attach-verify] downscale skipped:', (error as Error)?.message);
    return base64;
  }
}

/**
 * Decode any QR in the uploaded photo.
 *
 * sharp gives us raw RGBA, which is exactly what jsQR wants. The image is
 * downscaled first: a 12-megapixel phone photo is ~48 MB of RGBA and jsQR scans
 * it linearly, which is slow enough to time the request out for no accuracy
 * gain. 1600px on the long edge still resolves a printed patch comfortably.
 */
async function decodeQr(buffer: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(buffer)
      .rotate() // honour EXIF orientation; a sideways QR will not decode
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    return result?.data?.trim() || null;
  } catch (error) {
    console.warn('[attach-verify] QR decode failed:', (error as Error)?.message);
    return null;
  }
}

interface SameItemVerdict {
  isSameItem: boolean;
  reasoning: string;
}

/** Ask Gemini whether the two photos show the same physical piece. */
async function confirmSameItem(
  originalBase64: string,
  newBase64: string,
  craftType: string
): Promise<SameItemVerdict> {
  const prompt = `You are an anti-fraud verifier for a handicraft marketplace.

You are shown TWO photographs. The FIRST is the original photo an artisan captured of their "${craftType}". The SECOND is a photo of a physical product with a printed QR patch attached to it.

Decide whether the SECOND photo shows THE SAME INDIVIDUAL ITEM as the first — the same piece, not merely another item of the same category.

Compare: the specific motif and pattern layout, the exact colour combination, border/edge treatment, weave or texture, and any distinguishing irregularities.

Be tolerant of: different lighting, white balance, camera angle, distance, background, folding or draping, and the QR sticker itself covering part of the piece.

Be strict about: a different pattern, a different colour scheme, or a clearly different object. Those mean the patch has been moved to another product, which is the fraud this check exists to catch.

Return JSON only:
{ "isSameItem": true|false, "reasoning": "one short sentence the artisan can act on" }`;

  const result = await generateContentWithFallback(
    [
      { text: prompt },
      { inlineData: { data: originalBase64, mimeType: 'image/jpeg' } },
      { inlineData: { data: newBase64, mimeType: 'image/jpeg' } },
    ],
    {
      responseMimeType: 'application/json',
      // Same-piece check is a classification. Never cached — two different
      // photos must never share one verdict.
      thinkingConfig: { thinkingBudget: 0 },
      responseSchema: {
        type: 'OBJECT',
        properties: {
          isSameItem: { type: 'BOOLEAN' },
          reasoning: { type: 'STRING' },
        },
        required: ['isSameItem', 'reasoning'],
      },
    },
    CAPTURE_MODELS
  );

  const rawText = typeof result === 'string' ? result : (result as { text?: string })?.text || '';
  const parsed = JSON.parse(
    rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  );

  return {
    isSameItem: Boolean(parsed?.isSameItem),
    reasoning:
      typeof parsed?.reasoning === 'string' && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : 'The AI could not confirm this is the same piece.',
  };
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const craftItemId = typeof body?.craftItemId === 'string' ? body.craftItemId : null;
    const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : null;

    if (!craftItemId || !imageBase64) {
      return NextResponse.json(
        { success: false, reason: 'craftItemId and imageBase64 are required.' },
        { status: 400 }
      );
    }

    // Ownership-scoped read: an artisan can only patch-verify their own piece.
    const item = await prisma.craftItem.findFirst({
      where: { id: craftItemId, artisanId: auth.userId },
      select: {
        id: true,
        status: true,
        patchId: true,
        craftType: true,
        images: true,
        qrVerified: true,
      },
    });

    if (!item) {
      return NextResponse.json({ success: false, reason: 'Item not found.' }, { status: 404 });
    }
    if (!item.patchId) {
      return NextResponse.json(
        { success: false, reason: 'This item has no patch ID yet. It must be approved by an admin first.' },
        { status: 409 }
      );
    }
    if (item.qrVerified) {
      // Idempotent: re-submitting an already-verified piece is not an error.
      return NextResponse.json({ success: true, status: 'SELLABLE', alreadyVerified: true });
    }
    if (!item.images?.[0]) {
      return NextResponse.json(
        { success: false, reason: 'The original capture has no photo to compare against.' },
        { status: 409 }
      );
    }

    const newBase64 = base64Payload(imageBase64);
    const buffer = Buffer.from(newBase64, 'base64');

    /* ---- Check 1: the QR in the photo is this item's patch ---------------- */
    const decoded = await decodeQr(buffer);
    if (!decoded) {
      return NextResponse.json({
        success: false,
        reason:
          'No QR code could be read in that photo. Make sure the printed patch is flat, well lit, and fully inside the frame.',
      });
    }
    // The QR encodes the full verify URL; a bare patch id is accepted too.
    if (!decoded.includes(item.patchId)) {
      return NextResponse.json({
        success: false,
        reason: `That QR patch belongs to a different item. This piece needs patch ${item.patchId}.`,
      });
    }

    /* ---- Check 2: it is the same physical piece --------------------------- */
    const originalBase64 = await originalAsBase64(item.images[0], req);
    if (!originalBase64) {
      return NextResponse.json(
        {
          success: false,
          reason: 'The original photo of this item could not be loaded for comparison.',
        },
        { status: 502 }
      );
    }

    let verdict: SameItemVerdict;
    try {
      // The QR was decoded from the full-resolution upload above; the vision
      // comparison only needs enough pixels to match the pattern.
      const [originalSmall, newSmall] = await Promise.all([
        downscaleForVision(originalBase64),
        downscaleForVision(newBase64),
      ]);
      verdict = await confirmSameItem(originalSmall, newSmall, item.craftType);
    } catch (error) {
      console.error('[attach-verify] vision check failed:', (error as Error)?.message);
      // Fail closed. A vision outage must not become a way to skip the gate.
      return NextResponse.json(
        {
          success: false,
          reason: 'The AI match could not run right now. Please try again in a moment.',
        },
        { status: 502 }
      );
    }

    if (!verdict.isSameItem) {
      return NextResponse.json({
        success: false,
        reason: `This does not look like the piece you originally captured. ${verdict.reasoning}`,
      });
    }

    /* ---- Both passed: the item is sellable -------------------------------- */
    const verifiedAt = new Date();
    await prisma.craftItem.update({
      where: { id: item.id },
      data: {
        status: 'SELLABLE',
        qrVerified: true,
        qrVerifiedImageUrl: imageBase64,
        qrVerifiedAt: verifiedAt,
      },
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: auth.userId,
      actorRole: 'ARTISAN',
      action: 'QR_PATCH_VERIFIED',
      previousState: { status: item.status, qrVerified: false },
      newState: { status: 'SELLABLE', qrVerified: true, patchId: item.patchId },
      comments:
        'Physical QR patch + product image AI-matched to original; item is now sellable.',
    });

    return NextResponse.json({ success: true, status: 'SELLABLE', reasoning: verdict.reasoning });
  } catch (error) {
    console.error('Attach-verify error:', error);
    return NextResponse.json(
      { success: false, reason: 'Verification failed. Please try again.' },
      { status: 500 }
    );
  }
}
