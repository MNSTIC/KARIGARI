import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

/**
 * The artisan's influencer-promotion opt-in, and the context the marketing tab
 * needs to find creators near them.
 *
 * Opt-in is off until the artisan turns it on: nobody's craft gets pushed into
 * an affiliate programme by default. Stored on `ArtisanProfile` rather than per
 * item, because the decision is about their shop, not one saree.
 */
export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

async function requireArtisan(): Promise<{ userId: string } | NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token');
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let decoded: AuthToken;
  try {
    decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
  if (decoded.role !== 'ARTISAN') {
    return NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 });
  }
  return { userId: decoded.userId };
}

export async function GET() {
  try {
    const auth = await requireArtisan();
    if (auth instanceof NextResponse) return auth;

    const profile = await prisma.artisanProfile.findUnique({
      where: { userId: auth.userId },
      select: {
        craftType: true,
        location: true,
        clusterName: true,
        promotionOptIn: true,
      },
    });

    // Listings this artisan already has affiliate attribution on, so the tab
    // can show what the programme has actually done for them rather than a
    // generic pitch.
    const attributed = await prisma.craftItem.findMany({
      where: { artisanId: auth.userId, affiliateCreatorId: { not: null } },
      select: {
        id: true,
        craftType: true,
        affiliateHandle: true,
        affiliateCommission: true,
        salePrice: true,
        askingPrice: true,
        escrowStatus: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return NextResponse.json({
      success: true,
      promotionOptIn: profile?.promotionOptIn ?? false,
      craftType: profile?.craftType || 'General Crafts',
      location: profile?.location || '',
      clusterName: profile?.clusterName || '',
      attributedItems: attributed.map((item) => ({
        id: item.id,
        craftType: item.craftType,
        handle: item.affiliateHandle,
        commission: item.affiliateCommission,
        price: item.salePrice ?? item.askingPrice ?? null,
        settled: item.escrowStatus === 'STAGE2_SETTLED_89',
      })),
    });
  } catch (error) {
    console.error('Promotion read error:', error);
    return NextResponse.json({ error: 'Could not load your promotion settings.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireArtisan();
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => ({}));
    if (typeof body?.promotionOptIn !== 'boolean') {
      return NextResponse.json({ error: 'promotionOptIn must be true or false.' }, { status: 400 });
    }

    const profile = await prisma.artisanProfile.findUnique({
      where: { userId: auth.userId },
      select: { id: true },
    });
    if (!profile) {
      return NextResponse.json(
        { error: 'Complete your artisan profile before enabling promotion.' },
        { status: 409 }
      );
    }

    const updated = await prisma.artisanProfile.update({
      where: { userId: auth.userId },
      data: { promotionOptIn: body.promotionOptIn },
      select: { promotionOptIn: true },
    });

    return NextResponse.json({ success: true, promotionOptIn: updated.promotionOptIn });
  } catch (error) {
    console.error('Promotion update error:', error);
    return NextResponse.json({ error: 'Could not save your choice.' }, { status: 500 });
  }
}
