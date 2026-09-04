import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';

/**
 * The artisan Orders page endpoint.
 *
 *   GET  — three payloads at once:
 *          - the artisan's active `ArtisanOrder` records, with logs
 *          - a stats bar (demands accepted, earned, review average)
 *          - open demands on the board that MATCH this artisan's craft and
 *            they have not accepted yet
 *
 *   POST — accept a demand (with or without a negotiated price)
 *
 * The API decides "matching demand" by a set of craft keywords — the demand
 * board's `craftType` is free text, so a fuzzy contains-any match is more
 * useful than an exact one. The list is capped so a busy board never floods.
 */
export const dynamic = 'force-dynamic';

const DEFAULT_DEADLINE_DAYS = 14;
const MAX_MATCHING_DEMANDS = 20;

/** Small, boring stopword set, mirroring /api/demand/track. */
const STOPWORDS = new Set([
  'and', 'the', 'with', 'for', 'set', 'of', 'pair', 'inch', 'piece', 'work',
]);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const artisanId = auth.artisan.userId;

    const [orders, profile, earnings, ratingStats, demandEarningsAgg] = await Promise.all([
      prisma.artisanOrder.findMany({
        where: { artisanId },
        orderBy: { createdAt: 'desc' },
        include: {
          demand: {
            select: {
              id: true,
              craftType: true,
              quantity: true,
              targetPriceMin: true,
              targetPriceMax: true,
              location: true,
              festival: true,
              buyerName: true,
              referenceImageUrl: true,
              material: true,
              color: true,
              description: true,
              createdAt: true,
            },
          },
          logs: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      }),
      prisma.artisanProfile.findUnique({
        where: { userId: artisanId },
        select: { craftType: true },
      }),
      // Real earnings from the escrow ledger — the same figures the earnings
      // page prints. Only advances and final payouts count; queued/simulated
      // rows are still money the artisan is owed and shown here.
      prisma.craftItem.aggregate({
        where: {
          artisanId,
          status: { in: ['ADVANCE_PAID', 'SOLD_FINAL', 'PAYOUT_COMPLETED'] },
        },
        _sum: { advancePaid: true, finalPayoutQueued: true, salePrice: true },
      }),
      prisma.review.aggregate({
        where: { craftItem: { artisanId } },
        _avg: { rating: true },
        _count: { id: true },
      }),
      // Demand-order credits — separate stream from the CraftItem escrow
      // ledger. Written by /api/buyer/orders/delivered when the buyer marks
      // the demand delivered. Always the on-screen agreed price, never ₹1.
      prisma.artisanOrder.aggregate({
        where: { artisanId, settledAt: { not: null } },
        _sum: { settledAmount: true },
      }),
    ]);

    const alreadyAccepted = new Set(orders.map((order) => order.demandId));

    // Matching demands. Empty craftType (or no keywords) falls back to any
    // OPEN demand — better to see the board than nothing.
    const terms = keywords(profile?.craftType || '');
    const matchingDemands = await prisma.demand.findMany({
      where: {
        status: 'OPEN',
        NOT: alreadyAccepted.size > 0 ? { id: { in: [...alreadyAccepted] } } : undefined,
        ...(terms.length
          ? {
              OR: terms.map((term) => ({
                craftType: { contains: term, mode: 'insensitive' as const },
              })),
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_MATCHING_DEMANDS,
      select: {
        id: true,
        craftType: true,
        quantity: true,
        targetPriceMin: true,
        targetPriceMax: true,
        location: true,
        festival: true,
        buyerName: true,
        referenceImageUrl: true,
        material: true,
        color: true,
        description: true,
        createdAt: true,
      },
    });

    // Total earned pulls from the ledger. `_sum` fields are null when there are
    // no matching rows — coalesce so the tile never renders NaN.
    const escrowEarned =
      (earnings._sum.advancePaid ?? 0) + (earnings._sum.finalPayoutQueued ?? 0);
    // On-screen demand-order credits — the settled agreed price for demand
    // orders. Independent stream, so summed with escrow (never double-counted:
    // a demand order does NOT get a CraftItem escrow row).
    const demandEarned = demandEarningsAgg._sum.settledAmount ?? 0;
    const totalEarned = escrowEarned + demandEarned;

    return NextResponse.json({
      success: true,
      orders: orders.map((order) => ({
        id: order.id,
        status: order.status,
        negotiatedPrice: order.negotiatedPrice,
        deadline: order.deadline?.toISOString() ?? null,
        settledAmount: order.settledAmount ?? null,
        settledAt: order.settledAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
        demand: {
          ...order.demand,
          createdAt: order.demand.createdAt.toISOString(),
        },
        logs: order.logs.map((log) => ({
          id: log.id,
          note: log.note,
          imageUrl: log.imageUrl,
          createdAt: log.createdAt.toISOString(),
        })),
      })),
      stats: {
        totalAccepted: orders.length,
        totalEarned,
        escrowEarned,
        demandEarned,
        avgRating: ratingStats._avg.rating,
        totalReviews: ratingStats._count.id,
      },
      matchingDemands: matchingDemands.map((demand) => ({
        ...demand,
        createdAt: demand.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Orders GET error:', error);
    return NextResponse.json({ error: 'Failed to load orders.' }, { status: 500 });
  }
}

/** Deadline hard-clamps (in days from acceptance). */
const MIN_DEADLINE_DAYS = 3;
const MAX_DEADLINE_DAYS = 90;

/**
 * Parse an ISO deadline from the client, clamped to a sane window.
 *
 * A deadline in the past or more than a season out is almost always a broken
 * client — silently coerce to the default (14 days) rather than reject the
 * whole acceptance for a bad date.
 */
function parseDeadline(value: unknown): Date {
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + DEFAULT_DEADLINE_DAYS);

  if (typeof value !== 'string' || !value) return fallback;
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) return fallback;

  const now = Date.now();
  const min = now + MIN_DEADLINE_DAYS * 86_400_000;
  const max = now + MAX_DEADLINE_DAYS * 86_400_000;
  if (candidate.getTime() < min) return new Date(min);
  if (candidate.getTime() > max) return new Date(max);
  return candidate;
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      demandId?: unknown;
      action?: unknown;
      negotiatedPrice?: unknown;
      deadline?: unknown;
    };
    const demandId = typeof body.demandId === 'string' ? body.demandId : '';
    const action = typeof body.action === 'string' ? body.action : '';
    const negotiatedPriceRaw = Number(body.negotiatedPrice);
    const negotiatedPrice =
      action === 'negotiate' && Number.isFinite(negotiatedPriceRaw) && negotiatedPriceRaw > 0
        ? Math.round(negotiatedPriceRaw)
        : null;

    if (!demandId) {
      return NextResponse.json({ error: 'demandId is required.' }, { status: 400 });
    }
    if (action !== 'accept' && action !== 'negotiate') {
      return NextResponse.json(
        { error: 'action must be "accept" or "negotiate".' },
        { status: 400 }
      );
    }
    if (action === 'negotiate' && negotiatedPrice === null) {
      return NextResponse.json(
        { error: 'negotiatedPrice must be a positive number when negotiating.' },
        { status: 400 }
      );
    }

    const demand = await prisma.demand.findUnique({
      where: { id: demandId },
      select: { id: true, status: true, quantity: true, craftType: true },
    });
    if (!demand) {
      return NextResponse.json({ error: 'Demand not found.' }, { status: 404 });
    }
    if (demand.status === 'FULFILLED' || demand.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'This demand is no longer open.' },
        { status: 409 }
      );
    }

    // Idempotent per (artisan, demand): a re-clicked Accept returns the
    // existing acceptance rather than creating a duplicate row.
    const existing = await prisma.artisanOrder.findFirst({
      where: { artisanId: auth.artisan.userId, demandId },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ success: true, orderId: existing.id, idempotent: true });
    }

    const deadline = parseDeadline(body.deadline);

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.artisanOrder.create({
        data: {
          artisanId: auth.artisan.userId,
          demandId,
          status: 'ACCEPTED',
          negotiatedPrice,
          deadline,
        },
        select: { id: true },
      });

      // Once any artisan has accepted, the demand is at least MATCHED. Only
      // moved forward — a FULFILLED demand stays fulfilled.
      if (demand.status === 'OPEN') {
        await tx.demand.update({ where: { id: demandId }, data: { status: 'MATCHED' } });
      }

      return created;
    });

    return NextResponse.json({ success: true, orderId: order.id });
  } catch (error) {
    console.error('Orders POST error:', error);
    return NextResponse.json({ error: 'Failed to accept demand.' }, { status: 500 });
  }
}

/**
 * Lifecycle transitions on an existing ArtisanOrder.
 *
 *   PATCH { orderId, action: "complete", completedImageUrl }
 *
 * "complete" flips status → COMPLETED and stores the finished-product photo the
 * artisan uploads. The photo is required — a completion claim without a photo
 * is what caused the buyer trust problems this flow exists to fix.
 *
 * Only the acting artisan can complete their own orders; ownership is enforced
 * both in the update predicate and by re-check.
 */
const MAX_COMPLETED_IMAGE_BYTES = 2 * 1024 * 1024;

function base64Bytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((payload.length * 3) / 4);
}

export async function PATCH(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      orderId?: unknown;
      action?: unknown;
      completedImageUrl?: unknown;
    };
    const orderId = typeof body.orderId === 'string' ? body.orderId : '';
    const action = typeof body.action === 'string' ? body.action : '';

    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required.' }, { status: 400 });
    }
    if (action !== 'complete') {
      return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
    }

    const completedImageUrl =
      typeof body.completedImageUrl === 'string' ? body.completedImageUrl.trim() : '';
    if (!completedImageUrl) {
      return NextResponse.json(
        { error: 'A photo of the finished product is required.' },
        { status: 400 }
      );
    }
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(completedImageUrl)) {
      return NextResponse.json({ error: 'Photo must be an image.' }, { status: 400 });
    }
    if (base64Bytes(completedImageUrl) > MAX_COMPLETED_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Photo is larger than 2 MB.' }, { status: 400 });
    }

    // Ownership + existence in one query. `updateMany` returns count instead of
    // throwing on no-match, so we can distinguish "not yours" from a real error.
    const result = await prisma.artisanOrder.updateMany({
      where: {
        id: orderId,
        artisanId: auth.artisan.userId,
        status: { in: ['ACCEPTED', 'IN_PROGRESS'] },
      },
      data: {
        status: 'COMPLETED',
        completedImageUrl,
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { error: 'Order not found or already completed.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Orders PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update order.' }, { status: 500 });
  }
}
