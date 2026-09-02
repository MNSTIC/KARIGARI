import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

/**
 * One item's first photo, served as an image rather than as JSON.
 *
 * Every list surface wants a thumbnail, and the artisan's own captures are
 * stored as base64 data URLs — a 1280px JPEG is a few hundred kilobytes, so
 * inlining ten of them into `/api/artisan/dashboard` is the multi-megabyte
 * payload that route deliberately stopped sending. A photo behind its own URL
 * costs the list nothing: the browser fetches it lazily, one request per row
 * that is actually on screen, and caches it.
 *
 * Seeded and uploaded items whose `images[0]` is already a path or an http URL
 * never reach this route — the dashboard hands those straight to `next/image`,
 * because a redirect would be a pointless extra hop.
 *
 * Scoped to the caller, exactly like `GET /api/items/[id]`: an artisan reads
 * only their own items, an admin may read any.
 */
export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

/** `data:image/jpeg;base64,...` -> bytes + content type. Null if it is not one. */
function decodeDataUrl(value: string): { body: Buffer; contentType: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value);
  if (!match) return null;
  try {
    return { contentType: match[1], body: Buffer.from(match[2], 'base64') };
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let decoded: AuthToken;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const item = await prisma.craftItem.findFirst({
      where: {
        id,
        // Ownership is part of the query, not a check afterwards.
        ...(decoded.role === 'ADMIN' ? {} : { artisanId: decoded.userId }),
      },
      select: { images: true },
    });

    const first = item?.images?.[0];
    if (!first) return NextResponse.json({ error: 'No image' }, { status: 404 });

    // Already a URL: send the caller there rather than proxying the bytes.
    if (!first.startsWith('data:')) {
      return NextResponse.redirect(new URL(first, process.env.PUBLIC_BASE_URL || 'http://localhost:3000'));
    }

    const decodedImage = decodeDataUrl(first);
    if (!decodedImage) return NextResponse.json({ error: 'Unreadable image' }, { status: 404 });

    return new NextResponse(new Uint8Array(decodedImage.body), {
      headers: {
        'Content-Type': decodedImage.contentType,
        // Private: this is one artisan's own photo, and it is served behind
        // their session cookie. A shared cache must never hold it.
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Item thumbnail error:', error);
    return NextResponse.json({ error: 'Failed to load thumbnail' }, { status: 500 });
  }
}
