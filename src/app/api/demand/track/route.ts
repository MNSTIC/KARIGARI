import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getListingPrice } from '@/lib/pricing';
import {
  fulfilmentRate,
  isDelivered,
  projectedCompletion,
  resolveDemandStage,
  resolveStage,
} from '@/lib/orderStage';

/**
 * Production progress for one buyer demand.
 *
 * Public, like the rest of the demand board — buyers have no account here.
 *
 * **One source of truth.** This route and `/api/buyer/orders` used to answer
 * the same question two different ways: this one followed
 * `Notification.relatedDemandId` to the artisans a request had merely REACHED
 * and then keyword-matched their inventory, while My Orders counted only pieces
 * carrying a verified payment. The same demand could read "3 fulfilled" here
 * and "0" there, on two tabs of the same screen.
 *
 * V9 reads `ArtisanOrder` first — the row an artisan creates when they actually
 * commit — and counts an order fulfilled when its resolved stage reaches
 * DELIVERED, which is the identical test My Orders applies to its own rows. The
 * old notification-derived view survives only as the fallback for a demand
 * nobody has accepted yet, and the response says which of the two ran
 * (`source`) rather than presenting a keyword guess as a commitment.
 */
export const dynamic = 'force-dynamic';

const STOPWORDS = new Set([
  'and', 'the', 'with', 'for', 'set', 'of', 'pair', 'inch', 'piece', 'work',
]);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

/** The newest of a set of timestamps, or the fallback when all are absent. */
function latest(fallback: Date, ...dates: (Date | null | undefined)[]): Date {
  return dates.reduce<Date>((best, d) => (d && d > best ? d : best), fallback);
}

export async function GET(req: Request) {
  try {
    const demandId = new URL(req.url).searchParams.get('demandId');
    if (!demandId) {
      return NextResponse.json({ error: 'demandId is required' }, { status: 400 });
    }

    const demand = await prisma.demand.findUnique({
      where: { id: demandId },
      select: {
        id: true,
        craftType: true,
        quantity: true,
        createdAt: true,
        status: true,
        referenceImageUrls: true,
        referenceImageUrl: true,
        targetPriceMin: true,
        targetPriceMax: true,
      },
    });
    if (!demand) {
      return NextResponse.json({ error: 'Demand not found' }, { status: 404 });
    }

    // The primary source. One query with the logs, the bound piece and the
    // maker — never one query per order.
    const orders = await prisma.artisanOrder.findMany({
      where: { demandId: demand.id },
      orderBy: { createdAt: 'asc' },
      include: {
        artisan: { select: { name: true } },
        logs: { orderBy: { createdAt: 'desc' }, take: 20 },
        craftItem: {
          select: {
            id: true,
            craftType: true,
            images: true,
            status: true,
            escrowStatus: true,
            qrVerified: true,
            productionStage: true,
            salePrice: true,
            askingPrice: true,
            standardMarketPrice: true,
            fairWageFloor: true,
          },
        },
      },
    });

    if (orders.length > 0) {
      const fallbackImage = demand.referenceImageUrls?.[0] ?? demand.referenceImageUrl ?? null;

      const items = orders.map((order) => {
        const stage = resolveDemandStage(order, order.craftItem);
        return {
          id: order.id,
          craftType: order.craftItem?.craftType ?? demand.craftType,
          // The public tracker never exposes a patch ID — it is private to the
          // artisan and to the buyer who bought the piece, whose My Orders view
          // is served by /api/buyer/orders and does keep it.
          patchId: null,
          // The artisan's own verified photo of the finished piece is the most
          // truthful image available; the bound item's capture is next, and the
          // buyer's own reference is the last resort. Never an invented one.
          image:
            order.readyImageUrl ??
            order.craftItem?.images?.[0] ??
            fallbackImage,
          artisanName: order.artisan.name,
          stage,
          stageAt: latest(
            order.createdAt,
            order.dispatchedAt,
            order.packedAt,
            order.readyVerifiedAt,
            order.lastLogAt,
            order.settledAt
          ).toISOString(),
          createdAt: order.createdAt.toISOString(),
          estimatedDeliveryAt: order.deadline?.toISOString() ?? null,
          // The AGREED price. `paidAmountPaise` is the ₹10 demo charge and is
          // never what an order is denominated in.
          price:
            order.negotiatedPrice ??
            demand.targetPriceMax ??
            demand.targetPriceMin ??
            (order.craftItem
              ? order.craftItem.salePrice ?? getListingPrice(order.craftItem)
              : null),
          // ---- V9 lifecycle detail, on top of the TrackPayload shape ----
          readyVerified: order.readyVerified,
          readySimilarityScore: order.readySimilarityScore,
          readyVerifiedAt: order.readyVerifiedAt?.toISOString() ?? null,
          packedAt: order.packedAt?.toISOString() ?? null,
          dispatchedAt: order.dispatchedAt?.toISOString() ?? null,
          courierName: order.courierName,
          trackingRef: order.trackingRef,
          lastLogAt: order.lastLogAt?.toISOString() ?? null,
          dailyUpdates: order.logs.map((log) => ({
            id: log.id,
            note: log.note,
            imageUrl: log.imageUrl,
            createdAt: log.createdAt.toISOString(),
          })),
        };
      });

      // The SAME test /api/buyer/orders applies to its own rows: an order counts
      // when it has reached the end of the ladder. This is what makes the two
      // endpoints agree about one demand.
      const delivered = items.filter((item) => item.stage === 'DELIVERED');
      const deliveredDates = orders
        .filter((_, index) => items[index].stage === 'DELIVERED')
        .map((order) => order.settledAt ?? order.dispatchedAt ?? order.updatedAt);

      const rate = fulfilmentRate(demand.createdAt, deliveredDates);
      const remaining = Math.max(0, demand.quantity - delivered.length);
      const eta = rate ? projectedCompletion(rate.perDay, remaining) : null;

      return NextResponse.json({
        success: true,
        /** 'orders' when real commitments drove this view. */
        source: 'orders' as const,
        demandId: demand.id,
        craftType: demand.craftType,
        requested: demand.quantity,
        fulfilled: delivered.length,
        /** An ArtisanOrder exists, so an artisan has genuinely committed. */
        acceptedByArtisan: true,
        items,
        rate: rate ? { perDay: Number(rate.perDay.toFixed(2)), days: Math.round(rate.days) } : null,
        projectedCompletion: eta?.toISOString() ?? null,
      });
    }

    // ------------------------------------------------------------------ //
    // Fallback: nobody has accepted this demand, so there is no commitment
    // to report. What the schema still records is which artisans the request
    // REACHED, so the board follows their matching pieces and labels the view
    // as such. It never claims a maker committed to a quantity they did not.
    // ------------------------------------------------------------------ //
    const reached = await prisma.notification.findMany({
      where: { relatedDemandId: demand.id },
      select: { userId: true, accepted: true, createdAt: true },
    });

    const acceptedIds = reached.filter((n) => n.accepted).map((n) => n.userId);
    const artisanIds = acceptedIds.length > 0 ? acceptedIds : reached.map((n) => n.userId);

    if (artisanIds.length === 0) {
      return NextResponse.json({
        success: true,
        source: 'notifications' as const,
        demandId: demand.id,
        craftType: demand.craftType,
        requested: demand.quantity,
        fulfilled: 0,
        acceptedByArtisan: false,
        items: [],
        rate: null,
        projectedCompletion: null,
      });
    }

    const terms = keywords(demand.craftType);

    const rows = await prisma.craftItem.findMany({
      where: {
        artisanId: { in: artisanIds },
        ...(terms.length
          ? {
              OR: terms.map((term) => ({
                craftType: { contains: term, mode: 'insensitive' as const },
              })),
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      // A bulk request is fulfilled by many pieces; more than this and the
      // timeline stops being readable anyway.
      take: 40,
      select: {
        id: true,
        craftType: true,
        patchId: true,
        images: true,
        status: true,
        escrowStatus: true,
        qrVerified: true,
        qrVerifiedAt: true,
        productionStage: true,
        stageUpdatedAt: true,
        estimatedDeliveryAt: true,
        createdAt: true,
        salePrice: true,
        askingPrice: true,
        standardMarketPrice: true,
        fairWageFloor: true,
        artisan: { select: { name: true } },
      },
    });

    const items = rows.map((row) => ({
      id: row.id,
      craftType: row.craftType,
      patchId: null,
      image: row.images?.[0] ?? null,
      artisanName: row.artisan.name,
      stage: resolveStage(row),
      // The best timestamp available for the current stage. `stageUpdatedAt`
      // when the artisan moved it by hand, the QA timestamp when the patch was
      // matched, otherwise when the piece was captured.
      stageAt: (row.stageUpdatedAt ?? row.qrVerifiedAt ?? row.createdAt).toISOString(),
      createdAt: row.createdAt.toISOString(),
      estimatedDeliveryAt: row.estimatedDeliveryAt?.toISOString() ?? null,
      price: row.salePrice ?? getListingPrice(row),
    }));

    const deliveredDates = rows.filter(isDelivered).map((row) => row.stageUpdatedAt ?? row.createdAt);
    const rate = fulfilmentRate(demand.createdAt, deliveredDates);
    const remaining = Math.max(0, demand.quantity - deliveredDates.length);
    const eta = rate ? projectedCompletion(rate.perDay, remaining) : null;

    return NextResponse.json({
      success: true,
      /** 'notifications' means nobody has accepted yet — see the note above. */
      source: 'notifications' as const,
      demandId: demand.id,
      craftType: demand.craftType,
      requested: demand.quantity,
      fulfilled: deliveredDates.length,
      /** True when at least one artisan replied YES to the SMS alert. */
      acceptedByArtisan: acceptedIds.length > 0,
      items,
      rate: rate ? { perDay: Number(rate.perDay.toFixed(2)), days: Math.round(rate.days) } : null,
      projectedCompletion: eta?.toISOString() ?? null,
    });
  } catch (error) {
    console.error('Demand track error:', error);
    return NextResponse.json({ error: 'Failed to load progress' }, { status: 500 });
  }
}
