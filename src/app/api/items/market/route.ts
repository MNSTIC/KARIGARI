import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

/**
 * The public marketplace feed, and the single-item read behind the product page.
 *
 *   (no params)   every craft item, oldest behaviour preserved
 *   ?listed=1     only items an artisan has actually published
 *   ?id=<id>      one item, for `/marketplace/product/[id]`
 *
 * Public: a consumer browsing the storefront has no account here. The auth
 * cookie is read only to tell the caller which rows are their own, and a
 * missing or invalid token is not an error.
 */
export const dynamic = 'force-dynamic';

/**
 * Deliberately narrower than the whole row. This endpoint is unauthenticated,
 * so the artisan's commercial internals — credit score, raw-material cost,
 * fairness score, payout ledger, VPA destination — are not part of it. Every
 * field below is already public on the passport page.
 */
const PUBLIC_ITEM_SELECT = {
  id: true,
  patchId: true,
  craftType: true,
  descriptionOriginal: true,
  descriptionEnglish: true,
  aiGeneratedListing: true,
  aiSuggestedCategory: true,
  giTagApplied: true,
  tags: true,
  images: true,
  laborDays: true,
  fairWageFloor: true,
  marketPriceMin: true,
  marketPriceMax: true,
  standardMarketPrice: true,
  askingPrice: true,
  salePrice: true,
  status: true,
  isListedOnMarketplace: true,
  isOndcLive: true,
  syndicatedChannels: true,
  escrowStatus: true,
  createdAt: true,
  artisan: {
    select: {
      id: true,
      name: true,
      artisanProfile: {
        select: {
          clusterName: true,
          location: true,
          craftType: true,
          photoUrl: true,
          giTagCertified: true,
          giTagName: true,
        },
      },
    },
  },
} as const;

type PublicItem = Prisma.CraftItemGetPayload<{ select: typeof PUBLIC_ITEM_SELECT }>;

/** Flatten the profile onto `artisan` so the storefront reads one shape. */
function format(
  item: PublicItem,
  rating?: { avg: number | null; count: number }
) {
  const profile = item.artisan.artisanProfile;
  // The raw patch ID is private. Strip it from the public payload entirely and
  // ship only a boolean, so a browsing visitor cannot read another piece's ID
  // out of the network response.
  const { patchId, ...rest } = item;
  return {
    ...rest,
    verified: Boolean(patchId),
    artisan: {
      id: item.artisan.id,
      name: item.artisan.name,
      clusterName: profile?.clusterName || 'Artisan Cluster',
      location: profile?.location || null,
      craftType: profile?.craftType || null,
      photoUrl: profile?.photoUrl || null,
      giTagCertified: profile?.giTagCertified ?? false,
      giTagName: profile?.giTagName || null,
    },
    // Undefined when never reviewed — kept out of the payload rather than sent
    // as a 0 that a card could render as five empty stars.
    avgRating: rating?.avg ?? null,
    reviewCount: rating?.count ?? 0,
  };
}

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    // The cookie is `auth-token` everywhere else in the app; this route used to
    // read `auth_token`, so `currentUserId` was always null.
    const token = cookieStore.get('auth-token')?.value;
    let userId: string | null = null;

    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as {
          userId?: string;
        };
        userId = payload.userId ?? null;
      } catch {
        // Not fatal — public listings are still visible to a signed-out visitor.
      }
    }

    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (id) {
      const item = await prisma.craftItem.findUnique({
        where: { id },
        select: PUBLIC_ITEM_SELECT,
      });
      if (!item) {
        return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
      }
      const stats = await prisma.review.aggregate({
        where: { craftItemId: id },
        _avg: { rating: true },
        _count: { id: true },
      });
      return NextResponse.json({
        success: true,
        item: format(item, { avg: stats._avg.rating, count: stats._count.id }),
        currentUserId: userId,
      });
    }

    const listedOnly = url.searchParams.get('listed') === '1';

    const items = await prisma.craftItem.findMany({
      where: listedOnly ? { isListedOnMarketplace: true } : {},
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_ITEM_SELECT,
    });

    // Ratings in one aggregate rather than N queries. Cards on the grid stay
    // an O(1) DB hit no matter how big the marketplace grows.
    const itemIds = items.map((item) => item.id);
    const stats = itemIds.length
      ? await prisma.review.groupBy({
          by: ['craftItemId'],
          where: { craftItemId: { in: itemIds } },
          _avg: { rating: true },
          _count: { id: true },
        })
      : [];
    const ratings = new Map(
      stats.map((row) => [row.craftItemId, { avg: row._avg.rating, count: row._count.id }])
    );

    return NextResponse.json({
      success: true,
      items: items.map((item) => format(item, ratings.get(item.id))),
      currentUserId: userId,
    });
  } catch (error) {
    console.error('Market items error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
