import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

/**
 * One item's heavy detail, fetched only when the artisan opens it.
 *
 * The dashboard used to ship every capture's base64 `images` and its whole
 * `auditLogs` array on first load — megabytes of JSON for a table that renders
 * craft type, patch id, date and status. Those two fields live here instead, so
 * the list stays small and the cost is paid once, by the one row someone
 * actually opened.
 *
 * Scoped to the caller: an artisan reads only their own items. An admin may
 * read any item, because the facilitator queue legitimately reviews them.
 */
export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
      select: {
        id: true,
        images: true,
        patchId: true,
        qrVerified: true,
        // The artisan's "product photographed with its QR patch" upload. Kept
        // out of every list query for the same reason `images` is: it is only
        // ever rendered here.
        qrVerifiedImageUrl: true,
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            action: true,
            actorRole: true,
            comments: true,
            createdAt: true,
          },
        },
      },
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      // Only the first photo is rendered in the details view; sending the rest
      // would put the payload straight back where it was.
      images: item.images.slice(0, 1),
      auditLogs: item.auditLogs,
      patchId: item.patchId,
      qrVerified: item.qrVerified,
      qrVerifiedImageUrl: item.qrVerifiedImageUrl,
    });
  } catch (error) {
    console.error('Item detail error:', error);
    return NextResponse.json({ error: 'Failed to load item details' }, { status: 500 });
  }
}
