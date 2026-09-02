import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * The public creator directory.
 *
 * Feeds both the `/creators` portal and the artisan's discovery tab, so it is
 * deliberately public and deliberately narrow: `upiId` is never selected. A
 * creator's payout address is between them and the settlement engine, and it
 * has no business being in a list endpoint anyone can call.
 *
 * `?niche=` and `?location=` are the artisan's "creators near me who cover my
 * craft" filter. Both match loosely — an artisan's profile says "Odisha" and a
 * creator's says "Bhubaneswar, Odisha".
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const niche = (url.searchParams.get('niche') || '').trim();
    const location = (url.searchParams.get('location') || '').trim();

    const creators = await prisma.creator.findMany({
      where: {
        status: 'ACTIVE',
        ...(niche ? { nicheCategory: { contains: niche, mode: 'insensitive' as const } } : {}),
        ...(location ? { location: { contains: location, mode: 'insensitive' as const } } : {}),
      },
      select: {
        id: true,
        name: true,
        handle: true,
        platform: true,
        profileUrl: true,
        photoUrl: true,
        nicheCategory: true,
        location: true,
        bio: true,
        totalClicks: true,
        totalSales: true,
        earningsTotal: true,
      },
      // Creators who have actually driven sales lead the list; ties break on
      // reach, then on who registered first.
      orderBy: [{ totalSales: 'desc' }, { totalClicks: 'desc' }, { createdAt: 'asc' }],
      take: 200,
    });

    return NextResponse.json({ success: true, creators });
  } catch (error) {
    console.error('Creator list error:', error);
    return NextResponse.json({ error: 'Could not load creators.' }, { status: 500 });
  }
}
