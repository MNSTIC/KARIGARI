import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Buyer reviews on one `CraftItem`.
 *
 * Public, like the rest of the storefront. Both endpoints take the buyer
 * identity as a case-insensitive free-text `buyerName` — the same identity the
 * demand board and My Orders already use, because buyers have no accounts on
 * this app.
 *
 * The trust boundary is on POST: a review only writes when the same buyer name
 * appears on a paid `CraftItem` in a sold state. There is no way to leave a
 * review for a piece nobody bought.
 */
export const dynamic = 'force-dynamic';

/** Sold statuses the app recognises. Kept in step with the escrow engine. */
const PURCHASED_STATUSES = ['SOLD_FINAL', 'PAYOUT_COMPLETED'];

/** Max data-URL bytes for one image. 2MB × 4/3 base64 overhead ≈ 2.7MB header. */
const MAX_IMAGE_BYTES = 2_800_000;
const MAX_IMAGES = 3;

export async function GET(req: Request) {
  try {
    const craftItemId = new URL(req.url).searchParams.get('craftItemId');
    if (!craftItemId) {
      return NextResponse.json({ error: 'craftItemId is required.' }, { status: 400 });
    }

    const [reviews, stats] = await Promise.all([
      prisma.review.findMany({
        where: { craftItemId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          buyerName: true,
          rating: true,
          comment: true,
          images: true,
          createdAt: true,
        },
      }),
      prisma.review.aggregate({
        where: { craftItemId },
        _avg: { rating: true },
        _count: { id: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      reviews,
      avgRating: stats._avg.rating,
      totalReviews: stats._count.id,
    });
  } catch (error) {
    console.error('Reviews GET error:', error);
    return NextResponse.json({ error: 'Failed to load reviews.' }, { status: 500 });
  }
}

interface ReviewBody {
  craftItemId?: unknown;
  buyerName?: unknown;
  buyerContact?: unknown;
  rating?: unknown;
  comment?: unknown;
  images?: unknown;
}

function trimmed(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ReviewBody;
    const craftItemId = trimmed(body.craftItemId, 64);
    const buyerName = trimmed(body.buyerName, 120);
    const buyerContact = trimmed(body.buyerContact, 60) || null;
    const ratingRaw = Number(body.rating);
    const rating = Number.isFinite(ratingRaw) ? Math.round(ratingRaw) : 0;
    const comment = trimmed(body.comment, 2000) || null;

    if (!craftItemId || !buyerName) {
      return NextResponse.json(
        { error: 'craftItemId and buyerName are required.' },
        { status: 400 }
      );
    }
    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'rating must be between 1 and 5.' },
        { status: 400 }
      );
    }

    // Validate the image attachments before touching the DB.
    const rawImages = Array.isArray(body.images) ? body.images : [];
    if (rawImages.length > MAX_IMAGES) {
      return NextResponse.json(
        { error: `At most ${MAX_IMAGES} images per review.` },
        { status: 400 }
      );
    }
    const images: string[] = [];
    for (const image of rawImages) {
      if (typeof image !== 'string' || !image.startsWith('data:image/')) {
        return NextResponse.json(
          { error: 'Each image must be a data:image/... URL.' },
          { status: 400 }
        );
      }
      if (image.length > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: 'Each image must be under 2 MB.' },
          { status: 400 }
        );
      }
      images.push(image);
    }

    // The purchase check — the only thing gating a review.
    const purchased = await prisma.craftItem.findFirst({
      where: {
        id: craftItemId,
        buyerName: { equals: buyerName, mode: 'insensitive' },
        status: { in: PURCHASED_STATUSES },
      },
      select: { id: true, artisanId: true, buyerContact: true },
    });
    if (!purchased) {
      return NextResponse.json(
        { error: 'Only buyers who purchased this item can leave a review.' },
        { status: 403 }
      );
    }

    // Case-insensitive uniqueness. One person, one review per piece.
    const existing = await prisma.review.findFirst({
      where: {
        craftItemId,
        buyerName: { equals: buyerName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'You have already reviewed this item.' },
        { status: 409 }
      );
    }

    const review = await prisma.review.create({
      data: {
        craftItemId,
        buyerName,
        // Fall back to whatever the checkout captured, so the artisan's own
        // records stay complete even when the buyer skipped the field here.
        buyerContact: buyerContact ?? purchased.buyerContact ?? null,
        rating,
        comment,
        images,
      },
      select: {
        id: true,
        buyerName: true,
        rating: true,
        comment: true,
        images: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, review });
  } catch (error) {
    console.error('Reviews POST error:', error);
    return NextResponse.json({ error: 'Failed to submit review.' }, { status: 500 });
  }
}
