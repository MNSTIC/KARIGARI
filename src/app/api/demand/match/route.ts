import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getListingPrice } from '@/lib/pricing';

/**
 * Find real listed stock for one buyer demand.
 *
 * The buyer board used to "match" with a 1.5s `setTimeout` and then quote the
 * demand's own `targetPriceMax` back at the buyer — so the artisan was
 * invented and the price was just the buyer's own ceiling echoed. This returns
 * actual `CraftItem` rows that are on the marketplace, with the artisan who
 * made them and the price they are genuinely listed at.
 *
 * Public: the demand board is a shopfront and needs no account, same as
 * `/api/items/market`.
 */
export const dynamic = 'force-dynamic';

/**
 * Craft names rarely match a demand string exactly — a demand for
 * "Sambalpuri Ikat Silk Saree" should still find "Sambalpuri Cotton Saree —
 * Pasapali Check". Matching on the significant words finds those; requiring the
 * whole phrase would return nothing for almost every demand.
 */
const STOPWORDS = new Set([
  'and', 'the', 'with', 'for', 'set', 'of', 'pair', 'inch', 'piece', 'work',
]);

function keywords(craftType: string): string[] {
  return craftType
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const demandId = url.searchParams.get('demandId');
    if (!demandId) {
      return NextResponse.json({ error: 'demandId is required' }, { status: 400 });
    }

    const demand = await prisma.demand.findUnique({
      where: { id: demandId },
      select: { id: true, craftType: true, quantity: true, location: true },
    });
    if (!demand) {
      return NextResponse.json({ error: 'Demand not found' }, { status: 404 });
    }

    const terms = keywords(demand.craftType);

    const rows = await prisma.craftItem.findMany({
      where: {
        isListedOnMarketplace: true,
        ...(terms.length
          ? { OR: terms.map((term) => ({ craftType: { contains: term, mode: 'insensitive' as const } })) }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        craftType: true,
        patchId: true,
        images: true,
        askingPrice: true,
        salePrice: true,
        standardMarketPrice: true,
        fairWageFloor: true,
        artisan: {
          select: {
            name: true,
            artisanProfile: {
              select: { clusterName: true, location: true, photoUrl: true, experienceYears: true },
            },
          },
        },
      },
    });

    const matches = rows
      .map((row) => {
        const price = row.salePrice ?? getListingPrice(row);
        // An item with no resolvable price cannot be quoted honestly.
        if (price === null) return null;
        return {
          id: row.id,
          craftType: row.craftType,
          patchId: row.patchId,
          image: row.images?.[0] ?? null,
          price: Math.round(price),
          fairWageFloor: row.fairWageFloor,
          artisanName: row.artisan.name,
          clusterName: row.artisan.artisanProfile?.clusterName ?? null,
          location: row.artisan.artisanProfile?.location ?? null,
          photoUrl: row.artisan.artisanProfile?.photoUrl ?? null,
          experienceYears: row.artisan.artisanProfile?.experienceYears ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return NextResponse.json({
      success: true,
      demandId: demand.id,
      craftType: demand.craftType,
      quantity: demand.quantity,
      matches,
    });
  } catch (error) {
    console.error('Demand match error:', error);
    return NextResponse.json({ error: 'Failed to find matches' }, { status: 500 });
  }
}
