import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { getListingPrice } from '@/lib/pricing';
import {
  buildPriceComparison,
  middlemanAdvantage,
  normalizePlatforms,
} from '@/lib/syndication';

/**
 * Zero-ID multi-platform syndication.
 *
 * POST publishes one of the artisan's own items to every requested channel;
 * GET returns the live buyer-price comparison for that item, computed from its
 * real listing price. Both are scoped to the caller: an artisan can only ever
 * syndicate or inspect a row they own, which is what makes the listing
 * "zero-ID" — there is no external seller account, so ownership of the row is
 * the whole authorisation model.
 *
 * Publishing marks the item broadcast-ready and stamps which channels it went
 * out on. It does not transmit to Paytm, Magicpin, gem.gov.in or Amazon; the
 * payloads themselves are served by `/api/ondc/catalog` and
 * `/api/artisan/gem-export`.
 */
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

const SYNDICATION_FIELDS = {
  id: true,
  craftType: true,
  patchId: true,
  status: true,
  images: true,
  askingPrice: true,
  salePrice: true,
  standardMarketPrice: true,
  fairWageFloor: true,
  isListedOnMarketplace: true,
  isOndcLive: true,
  syndicatedChannels: true,
  syndicatedAt: true,
} as const;

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const craftItemId = typeof body?.craftItemId === 'string' ? body.craftItemId : null;
    if (!craftItemId) {
      return NextResponse.json({ error: 'craftItemId is required.' }, { status: 400 });
    }

    const targetPlatforms = normalizePlatforms(body?.targetPlatforms);
    if (targetPlatforms.length === 0) {
      return NextResponse.json(
        { error: 'targetPlatforms must list at least one known channel.' },
        { status: 400 }
      );
    }

    // Zero-ID: the artisan is the only owner of this listing. A row they do not
    // own is not theirs to broadcast, so this doubles as the auth check.
    const existing = await prisma.craftItem.findFirst({
      where: { id: craftItemId, artisanId: auth.userId },
      select: { ...SYNDICATION_FIELDS },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const item = await prisma.craftItem.update({
      where: { id: existing.id },
      data: {
        isListedOnMarketplace: true,
        isOndcLive: true,
        syndicatedChannels: targetPlatforms,
        syndicatedAt: new Date(),
      },
      select: SYNDICATION_FIELDS,
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: auth.userId,
      actorRole: 'ARTISAN',
      action: 'MULTI_CHANNEL_SYNDICATE',
      previousState: {
        syndicatedChannels: existing.syndicatedChannels,
        isOndcLive: existing.isOndcLive,
      },
      newState: { targetPlatforms },
      comments:
        'Artisan published this listing to every connected channel from their own account. Broadcast-ready payload; no external seller id involved.',
    });

    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error('Syndicate POST error:', error);
    return NextResponse.json({ error: 'Failed to syndicate this listing' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const craftItemId = url.searchParams.get('id');
    if (!craftItemId) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }

    const item = await prisma.craftItem.findFirst({
      where: { id: craftItemId, artisanId: auth.userId },
      select: SYNDICATION_FIELDS,
    });
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // The artisan's own effective price is the only input. An item with no
    // price at all yields an empty matrix rather than a row of NaN.
    const base = item.salePrice ?? getListingPrice(item);
    if (base === null || !Number.isFinite(base)) {
      return NextResponse.json({
        success: true,
        base: null,
        comparisons: [],
        middlemanAdvantage: 0,
      });
    }

    const comparisons = buildPriceComparison(base);

    return NextResponse.json({
      success: true,
      base: Math.round(base),
      comparisons,
      middlemanAdvantage: middlemanAdvantage(comparisons),
    });
  } catch (error) {
    console.error('Syndicate GET error:', error);
    return NextResponse.json({ error: 'Failed to build the price comparison' }, { status: 500 });
  }
}
