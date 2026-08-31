import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';

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

const LISTING_FIELDS = {
  id: true,
  craftType: true,
  patchId: true,
  status: true,
  images: true,
  descriptionOriginal: true,
  descriptionEnglish: true,
  aiGeneratedListing: true,
  marketPriceMin: true,
  marketPriceMax: true,
  fairWageFloor: true,
  standardMarketPrice: true,
  askingPrice: true,
  salePrice: true,
  isListedOnMarketplace: true,
  // Syndication Hub reads these to render which channels an item went out on.
  isOndcLive: true,
  syndicatedChannels: true,
  syndicatedAt: true,
  createdAt: true,
} as const;

/**
 * The artisan's marketplace view: what is already published, and what is still
 * waiting so a "New Listing" action has something real to attach copy to.
 */
export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const [listings, drafts] = await Promise.all([
      prisma.craftItem.findMany({
        where: {
          artisanId: auth.userId,
          OR: [{ isListedOnMarketplace: true }, { patchId: { not: null } }],
        },
        orderBy: { createdAt: 'desc' },
        select: LISTING_FIELDS,
      }),
      prisma.craftItem.findMany({
        where: {
          artisanId: auth.userId,
          isListedOnMarketplace: false,
          patchId: null,
        },
        orderBy: { createdAt: 'desc' },
        select: LISTING_FIELDS,
      }),
    ]);

    return NextResponse.json({ success: true, listings, drafts });
  } catch (error) {
    console.error('Artisan listings GET error:', error);
    return NextResponse.json({ error: 'Failed to load listings' }, { status: 500 });
  }
}

/**
 * Save the artisan's own listing copy onto one of their craft items.
 *
 * `descriptionEnglish` is the text that goes out as the ONDC listing;
 * `descriptionOriginal` is their own-language version, kept for the digital
 * passport story. Both are written straight to the CraftItem — no separate
 * listing table, so the passport and the marketplace can never disagree.
 */
export async function PATCH(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const itemId = typeof body?.itemId === 'string' ? body.itemId : null;
    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required.' }, { status: 400 });
    }

    // Scoped read: an artisan can only ever edit their own item.
    const item = await prisma.craftItem.findFirst({
      where: { id: itemId, artisanId: auth.userId },
      select: { id: true, craftType: true, descriptionEnglish: true, aiGeneratedListing: true },
    });
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const text = (value: unknown, max = 4000): string | undefined =>
      typeof value === 'string' ? value.trim().slice(0, max) : undefined;

    const descriptionEnglish = text(body?.descriptionEnglish);
    const descriptionOriginal = text(body?.descriptionOriginal);
    const aiGeneratedListing = text(body?.aiGeneratedListing) ?? descriptionEnglish;

    if (descriptionEnglish === undefined && descriptionOriginal === undefined) {
      return NextResponse.json(
        { error: 'Provide descriptionEnglish and/or descriptionOriginal.' },
        { status: 400 }
      );
    }
    if (descriptionEnglish !== undefined && descriptionEnglish.length === 0) {
      return NextResponse.json({ error: 'The English listing cannot be empty.' }, { status: 400 });
    }

    const updated = await prisma.craftItem.update({
      where: { id: item.id },
      data: {
        ...(descriptionEnglish !== undefined ? { descriptionEnglish } : {}),
        ...(descriptionOriginal !== undefined ? { descriptionOriginal } : {}),
        ...(aiGeneratedListing !== undefined ? { aiGeneratedListing } : {}),
      },
      select: LISTING_FIELDS,
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: auth.userId,
      actorRole: 'ARTISAN',
      action: 'LISTING_TEXT_UPDATED',
      previousState: {
        descriptionEnglish: item.descriptionEnglish,
        aiGeneratedListing: item.aiGeneratedListing,
      },
      newState: {
        descriptionEnglish: updated.descriptionEnglish,
        aiGeneratedListing: updated.aiGeneratedListing,
      },
      comments: 'Artisan edited their own listing description. This text is what goes out as the ONDC listing.',
    });

    return NextResponse.json({ success: true, item: updated });
  } catch (error) {
    console.error('Artisan listings PATCH error:', error);
    return NextResponse.json({ error: 'Failed to save listing' }, { status: 500 });
  }
}
