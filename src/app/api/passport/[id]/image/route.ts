import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * One photo of a piece, served as an image for the public buyer passport.
 *
 *   ?i=<n>     images[n] (0..3)
 *   ?v=<key>   an imageVariants thumbnail
 *   &w=<px>    a narrower JPEG, 32..1600
 *
 * Public by design: these are the same listing photos `/api/items/market?id=`
 * already returns to any visitor. The route exists so the passport can
 * reference a photo instead of inlining a few hundred kilobytes of base64 into
 * the HTML a judge's phone downloads on conference wifi — the browser fetches
 * each one lazily and caches it. It serves only `images[]` and variant
 * thumbnails; never `originalImageUrl`, `qrVerifiedImageUrl` or any other
 * column.
 */

function decodeDataUrl(value: string): { body: Buffer; contentType: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value);
  if (!match) return null;
  try {
    return { contentType: match[1], body: Buffer.from(match[2], 'base64') };
  } catch {
    return null;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const indexParam = url.searchParams.get('i');
    const variantKey = url.searchParams.get('v');

    const item = await prisma.craftItem.findUnique({
      where: { id },
      select: { images: true, imageVariants: true },
    });
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let value: string | null = null;
    if (variantKey) {
      const variants = (item.imageVariants as { variants?: { key?: unknown; thumb?: unknown }[] } | null)?.variants;
      const hit = Array.isArray(variants) ? variants.find((v) => v?.key === variantKey) : undefined;
      value = typeof hit?.thumb === 'string' ? hit.thumb : null;
    } else {
      const index = Number(indexParam ?? '0');
      value = Number.isInteger(index) && index >= 0 && index < 4 ? item.images[index] ?? null : null;
    }
    if (!value) return NextResponse.json({ error: 'No image' }, { status: 404 });

    if (!value.startsWith('data:')) {
      return NextResponse.redirect(new URL(value, url.origin));
    }

    const decoded = decodeDataUrl(value);
    if (!decoded) return NextResponse.json({ error: 'Unreadable image' }, { status: 404 });

    let body = decoded.body;
    let contentType = decoded.contentType;
    const width = Number(url.searchParams.get('w'));
    if (Number.isFinite(width) && width >= 32 && width <= 1600) {
      try {
        const sharp = (await import('sharp')).default;
        body = await sharp(decoded.body)
          .rotate()
          .resize({ width: Math.round(width), withoutEnlargement: true })
          .jpeg({ quality: 72, mozjpeg: true })
          .toBuffer();
        contentType = 'image/jpeg';
      } catch (resizeError) {
        console.warn('[passport image] resize skipped:', (resizeError as Error)?.message);
      }
    }

    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': contentType,
        // Public listing photos. An artisan can replace a photo, so an hour
        // rather than a year, with a long stale window for slow networks.
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('Passport image error:', error);
    return NextResponse.json({ error: 'Failed to load image' }, { status: 500 });
  }
}
