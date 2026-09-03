import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * One artisan's aggregate rating across every piece they have listed.
 *
 * Read-only, public: the storefront lists an artisan's cluster and the
 * profile card wants to say "4.6 across 23 reviews" without loading every
 * review. `_avg` is null when there are none yet — the caller must render an
 * honest empty state rather than 0.0.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const artisanId = new URL(req.url).searchParams.get('artisanId');
    if (!artisanId) {
      return NextResponse.json({ error: 'artisanId is required.' }, { status: 400 });
    }

    const stats = await prisma.review.aggregate({
      where: { craftItem: { artisanId } },
      _avg: { rating: true },
      _count: { id: true },
    });

    return NextResponse.json({
      success: true,
      artisanId,
      avgRating: stats._avg.rating,
      totalReviews: stats._count.id,
    });
  } catch (error) {
    console.error('Artisan reviews error:', error);
    return NextResponse.json({ error: 'Failed to load ratings.' }, { status: 500 });
  }
}
