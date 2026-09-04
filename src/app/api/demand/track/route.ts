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
 * Production progress for one buyer demand.
 *
 * Public, like the rest of the demand board — buyers have no account here.
 *
 * **What counts as fulfilling this request.** There is no join table between a
 * `Demand` and the pieces made for it, and inventing one would mean inventing
 * the data to fill it. What the schema does record is which artisans the
 * request actually reached (`Notification.relatedDemandId`), so the tracker
 * follows their matching pieces and says so plainly in the UI. It never claims
 * a maker committed to a quantity they did not.
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

export async function GET(req: Request) {
  try {
    const demandId = new URL(req.url).searchParams.get('demandId');
    if (!demandId) {
      return NextResponse.json({ error: 'demandId is required' }, { status: 400 });
    }

    const demand = await prisma.demand.findUnique({
      where: { id: demandId },
      select: { id: true, craftType: true, quantity: true, createdAt: true, status: true },
    });
    if (!demand) {
      return NextResponse.json({ error: 'Demand not found' }, { status: 404 });
    }

    // Artisans this request actually reached, and whether any of them replied
    // YES to the SMS. An acceptance is the strongest signal available; without
    // one the board still shows the matching pieces, labelled as such.
    const reached = await prisma.notification.findMany({
      where: { relatedDemandId: demand.id },
      select: { userId: true, accepted: true, createdAt: true },
    });

    const acceptedIds = reached.filter((n) => n.accepted).map((n) => n.userId);
    const artisanIds = acceptedIds.length > 0 ? acceptedIds : reached.map((n) => n.userId);

    if (artisanIds.length === 0) {
      return NextResponse.json({
        success: true,
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

    const items = rows.map((row) => {
      const stage = resolveStage(row);
      return {
        id: row.id,
        craftType: row.craftType,
        // The public demand-board tracker never exposes the raw patch ID — it is
        // private to the artisan and to the buyer who bought the piece (whose My
        // Orders view is served by /api/buyer/orders, which keeps it).
        patchId: null,
        image: row.images?.[0] ?? null,
        artisanName: row.artisan.name,
        stage,
        // The best timestamp available for the current stage. `stageUpdatedAt`
        // when the artisan moved it by hand, the QA timestamp when the patch
        // was matched, otherwise when the piece was captured.
        stageAt: (row.stageUpdatedAt ?? row.qrVerifiedAt ?? row.createdAt).toISOString(),
        createdAt: row.createdAt.toISOString(),
        estimatedDeliveryAt: row.estimatedDeliveryAt?.toISOString() ?? null,
        price: row.salePrice ?? getListingPrice(row),
      };
    });

    const deliveredDates = rows.filter(isDelivered).map((row) => row.stageUpdatedAt ?? row.createdAt);
    const rate = fulfilmentRate(demand.createdAt, deliveredDates);
    const remaining = Math.max(0, demand.quantity - deliveredDates.length);
    const eta = rate ? projectedCompletion(rate.perDay, remaining) : null;

    return NextResponse.json({
      success: true,
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
