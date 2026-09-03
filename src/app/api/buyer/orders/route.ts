import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getListingPrice } from '@/lib/pricing';
import {
  fulfilmentRate,
  isDelivered,
  projectedCompletion,
  resolveStage,
} from '@/lib/orderStage';

/**
 * One buyer's paid orders, with the production ladder for each.
 *
 * Public, like the demand board it sits beside — buyers have no account in this
 * app, so the identity is the same free-text name they post demands under. The
 * lookup is case-insensitive because that name is typed by hand each time.
 *
 * **Only real purchases.** A row appears here when `paidAt` is set, which only
 * `/api/payments/verify-payment` writes and only after Razorpay's own signature
 * has checked out. An item someone merely opened a checkout for is not an
 * order, and does not show up.
 *
 * **Shape.** Each order group is a superset of what `/api/demand/track` returns
 * — same `requested` / `fulfilled` / `items` / `rate` / `projectedCompletion`
 * keys — so `OrderTimeline` renders it without a single change. Orders placed
 * against a bulk demand are grouped by that demand and carry its real requested
 * quantity; a plain storefront purchase is its own group of one.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const buyer = (new URL(req.url).searchParams.get('buyer') || '').trim();
    if (!buyer) {
      return NextResponse.json({ error: 'buyer is required' }, { status: 400 });
    }

    const rows = await prisma.craftItem.findMany({
      where: {
        paidAt: { not: null },
        buyerName: { equals: buyer, mode: 'insensitive' },
      },
      orderBy: { paidAt: 'desc' },
      // A single buyer with more paid pieces than this is not a demo any more,
      // and the page would stop being readable well before it.
      take: 100,
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
        paidAt: true,
        paidAmountPaise: true,
        relatedDemandId: true,
        salePrice: true,
        askingPrice: true,
        standardMarketPrice: true,
        fairWageFloor: true,
        artisan: { select: { name: true } },
      },
    });

    if (rows.length === 0) {
      return NextResponse.json({ success: true, buyer, orders: [] });
    }

    // The demands these purchases were made against, for the real requested
    // quantity and the date the clock started on.
    const demandIds = Array.from(
      new Set(rows.map((row) => row.relatedDemandId).filter((id): id is string => Boolean(id)))
    );
    const demands = demandIds.length
      ? await prisma.demand.findMany({
          where: { id: { in: demandIds } },
          select: { id: true, craftType: true, quantity: true, createdAt: true, status: true },
        })
      : [];
    const demandById = new Map(demands.map((demand) => [demand.id, demand]));

    /** The per-piece shape `OrderTimeline` reads. Identical to /api/demand/track. */
    const tracked = (row: (typeof rows)[number]) => ({
      id: row.id,
      craftType: row.craftType,
      patchId: row.patchId,
      image: row.images?.[0] ?? null,
      artisanName: row.artisan.name,
      stage: resolveStage(row),
      // The best timestamp available for the current stage, falling back to
      // when the piece was paid for rather than when it was captured — for a
      // buyer, the order starts at payment.
      stageAt: (row.stageUpdatedAt ?? row.qrVerifiedAt ?? row.paidAt ?? row.createdAt).toISOString(),
      createdAt: row.createdAt.toISOString(),
      estimatedDeliveryAt: row.estimatedDeliveryAt?.toISOString() ?? null,
      // The DISPLAYED price. The ₹1 actually charged is `paidAmountPaise` and
      // is deliberately not what the buyer's order history is denominated in.
      price: row.salePrice ?? getListingPrice(row),
    });

    // Grouped by the demand a purchase fulfilled; a direct storefront buy is
    // keyed by its own item id so it stands alone.
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.relatedDemandId ? `demand:${row.relatedDemandId}` : `item:${row.id}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }

    const orders = Array.from(groups.entries()).map(([key, items]) => {
      const demand = items[0].relatedDemandId
        ? demandById.get(items[0].relatedDemandId) ?? null
        : null;

      const delivered = items.filter(isDelivered);
      const deliveredDates = delivered.map(
        (row) => row.stageUpdatedAt ?? row.paidAt ?? row.createdAt
      );

      // The clock starts when the request was posted for a bulk order, and at
      // payment for a direct buy.
      const since = demand?.createdAt ?? items[items.length - 1].paidAt ?? items[0].createdAt;
      const requested = demand?.quantity ?? items.length;
      const rate = fulfilmentRate(since, deliveredDates);
      const remaining = Math.max(0, requested - delivered.length);
      const eta = rate ? projectedCompletion(rate.perDay, remaining) : null;

      // Newest payment in the group is the order date shown on the card.
      const paidAt = items.reduce<Date | null>(
        (latest, row) => (row.paidAt && (!latest || row.paidAt > latest) ? row.paidAt : latest),
        null
      );

      const amountPaid = items.reduce((sum, row) => {
        const price = row.salePrice ?? getListingPrice(row);
        return sum + (price ?? 0);
      }, 0);

      return {
        key,
        demandId: demand?.id ?? null,
        craftType: demand?.craftType ?? items[0].craftType,
        artisanName: items[0].artisan.name,
        image: items.find((row) => row.images?.[0])?.images?.[0] ?? null,
        status: items[0].status,
        escrowStatus: items[0].escrowStatus,
        productionStage: items[0].productionStage,
        paidAt: paidAt?.toISOString() ?? null,
        /** Sum of the DISPLAYED prices — never the ₹1 demo charge. */
        amountPaid,
        /** What Razorpay actually took, in paise, so the demo stays honest. */
        chargedPaise: items.reduce((sum, row) => sum + (row.paidAmountPaise ?? 0), 0),

        // ---- the exact TrackPayload shape OrderTimeline consumes ----
        requested,
        fulfilled: delivered.length,
        /** A paid order is a committed one: the artisan's own piece was bought. */
        acceptedByArtisan: true,
        items: items.map(tracked),
        rate: rate ? { perDay: Number(rate.perDay.toFixed(2)), days: Math.round(rate.days) } : null,
        projectedCompletion: eta?.toISOString() ?? null,
      };
    });

    return NextResponse.json({ success: true, buyer, orders });
  } catch (error) {
    console.error('Buyer orders error:', error);
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  }
}
