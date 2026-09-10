import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * One buyer's alerts, and the unread badge count.
 *
 * Public, like every other buyer route in this app — buyers have no account, so
 * the identity is the same free-text name they post demands under, matched
 * case-insensitively because it is typed by hand each visit.
 *
 * That is also the security boundary, and it is a weak one: anyone who knows a
 * buyer's name can read that buyer's feed. It is the SAME boundary
 * `/api/buyer/orders`, `/api/buyer/orders/delivered` and `/api/reviews` already
 * stand on, and nothing here widens it — the match is exact-equals-insensitive,
 * never a `contains` or a prefix, so one buyer can never sweep up another's
 * alerts by posting a shorter name. Nothing sensitive is returned: no patch
 * ids, no contact numbers, no artisan PII beyond the name the buyer is already
 * shown on their order card.
 */
export const dynamic = 'force-dynamic';

/** More than this and the feed stops being readable well before it is useful. */
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const buyer = (searchParams.get('buyer') || '').trim();
    if (!buyer) {
      return NextResponse.json({ error: 'buyer is required' }, { status: 400 });
    }

    const limit = Math.min(Number(searchParams.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT);
    // Cursor paging on id, the same shape the rest of the buyer routes use for
    // their caps. Absent on the first page.
    const cursor = searchParams.get('cursor');

    const where = { buyerName: { equals: buyer, mode: 'insensitive' as const } };

    const [rows, unreadCount] = await Promise.all([
      prisma.buyerNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          demandId: true,
          artisanOrderId: true,
          type: true,
          title: true,
          message: true,
          read: true,
          createdAt: true,
        },
      }),
      prisma.buyerNotification.count({ where: { ...where, read: false } }),
    ]);

    // One row over the limit is how we know there is another page, without a
    // second count query against a table that only grows.
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      success: true,
      buyer,
      unreadCount,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      notifications: page.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Buyer notifications GET error:', error);
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 });
  }
}

/**
 * Mark one alert read, or all of them with `{ all: true }`.
 *
 * Both paths are scoped by `buyerName` in the update predicate itself, not by a
 * separate ownership check — so there is no window in which a mismatched name
 * could still clear somebody else's feed.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      buyerName?: unknown;
      id?: unknown;
      all?: unknown;
    };
    const buyerName = typeof body.buyerName === 'string' ? body.buyerName.trim() : '';
    if (!buyerName) {
      return NextResponse.json({ error: 'buyerName is required.' }, { status: 400 });
    }

    const scope = { buyerName: { equals: buyerName, mode: 'insensitive' as const } };

    if (body.all === true) {
      const result = await prisma.buyerNotification.updateMany({
        where: { ...scope, read: false },
        data: { read: true },
      });
      return NextResponse.json({ success: true, updated: result.count });
    }

    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) {
      return NextResponse.json(
        { error: 'Provide a notification id or { all: true }.' },
        { status: 400 }
      );
    }

    const result = await prisma.buyerNotification.updateMany({
      where: { id, ...scope },
      data: { read: true },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, updated: result.count });
  } catch (error) {
    console.error('Buyer notifications POST error:', error);
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 });
  }
}
