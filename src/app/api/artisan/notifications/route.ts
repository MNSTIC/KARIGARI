import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { getListingPrice } from '@/lib/pricing';
import { festivalMatchesCraft, upcomingFestivals } from '@/lib/festivals';

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

/**
 * The artisan's own alerts, newest first, plus the unread badge count — and,
 * for the notifications page, the upcoming festival calendar with THIS
 * artisan's listed pieces attached to each event.
 *
 * The pairing is the point: an artisan does not need to be told Durga Puja is
 * coming, they need to be told which of their own listings to push for it.
 * Everything is derived from real rows and the shared festival table, so
 * nothing here is hardcoded to a demo date.
 */
export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const [notifications, unreadCount, profile, listings] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.notification.count({ where: { userId: auth.userId, read: false } }),
      prisma.artisanProfile.findUnique({
        where: { userId: auth.userId },
        select: { craftType: true },
      }),
      prisma.craftItem.findMany({
        where: { artisanId: auth.userId, isListedOnMarketplace: true },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          craftType: true,
          images: true,
          tags: true,
          askingPrice: true,
          salePrice: true,
          standardMarketPrice: true,
          fairWageFloor: true,
        },
      }),
    ]);

    // Every festival in the next quarter, not only the ones matching the
    // profile craft — an artisan's individual pieces span more than one
    // category, and the per-item match below is the finer filter.
    const festivals = upcomingFestivals({ withinDays: 90, now: new Date() });

    const calendar = festivals.map((festival) => ({
      key: festival.key,
      name: festival.name,
      date: festival.date,
      daysAway: festival.daysAway,
      demandNote: festival.demandNote,
      /** Whether this festival lifts the artisan's headline craft at all. */
      matchesCraft: festivalMatchesCraft(festival, profile?.craftType),
      products: listings
        // Match on the item's own craft name and tags, so a Sambalpuri weaver's
        // cotton stole can surface for a different festival than their silk.
        .filter((item) =>
          festivalMatchesCraft(festival, [item.craftType, ...(item.tags ?? [])].join(' '))
        )
        .slice(0, 4)
        .map((item) => ({
          id: item.id,
          craftType: item.craftType,
          image: item.images?.[0] ?? null,
          price: item.salePrice ?? getListingPrice(item),
        })),
    }));

    return NextResponse.json({
      success: true,
      notifications,
      unreadCount,
      craftType: profile?.craftType ?? null,
      listedCount: listings.length,
      calendar,
    });
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
