import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

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

/** The artisan's own alerts, newest first, plus the unread badge count. */
export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.notification.count({ where: { userId: auth.userId, read: false } }),
    ]);

    return NextResponse.json({ success: true, notifications, unreadCount });
  } catch (error) {
    console.error('Notifications GET error:', error);
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 });
  }
}

/** Mark one notification read, or all of them with `{ all: true }`. */
export async function PATCH(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));

    if (body?.all === true) {
      const result = await prisma.notification.updateMany({
        where: { userId: auth.userId, read: false },
        data: { read: true },
      });
      return NextResponse.json({ success: true, updated: result.count });
    }

    const id = typeof body?.id === 'string' ? body.id : null;
    if (!id) {
      return NextResponse.json({ error: 'Provide a notification id or { all: true }.' }, { status: 400 });
    }

    // Scoped by userId so one artisan can never mark another's alert read.
    const result = await prisma.notification.updateMany({
      where: { id, userId: auth.userId },
      data: { read: true },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, updated: result.count });
  } catch (error) {
    console.error('Notifications PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 });
  }
}
