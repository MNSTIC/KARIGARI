import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CREATOR_RATE } from '@/lib/escrow';
import { slugifyHandle } from '@/lib/creators';

/**
 * A creator's own numbers, read straight from the database.
 *
 * Every figure here is derived from rows that exist: clicks from
 * `AffiliateClick`, sales and gross from the `CraftItem`s actually attributed
 * to this handle. Nothing is projected or estimated — a creator deciding
 * whether this is worth their time deserves the real count, including zero.
 */
export const dynamic = 'force-dynamic';

/**
 * `shreya.styles@okaxis` -> `shr***@okaxis`.
 *
 * This route is public — a handle is all anyone needs to call it — so the full
 * VPA never leaves the server. The creator still sees enough to confirm the
 * commission is pointed at the right account, which is the only thing the
 * stats panel actually needs it for.
 */
function maskUpi(upi: string): string {
  const [local, bank] = upi.split('@');
  if (!bank) return '***';
  return `${local.slice(0, 3)}***@${bank}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const handle = slugifyHandle(url.searchParams.get('handle') || '');
    if (!handle) {
      return NextResponse.json({ error: 'handle is required.' }, { status: 400 });
    }

    const creator = await prisma.creator.findUnique({
      where: { handle },
      select: {
        id: true,
        name: true,
        handle: true,
        platform: true,
        nicheCategory: true,
        location: true,
        photoUrl: true,
        upiId: true,
        totalClicks: true,
        totalSales: true,
        earningsTotal: true,
        createdAt: true,
      },
    });
    if (!creator) {
      return NextResponse.json({ error: 'No creator with that handle.' }, { status: 404 });
    }

    const attributed = await prisma.craftItem.findMany({
      where: { affiliateCreatorId: creator.id },
      select: {
        id: true,
        craftType: true,
        salePrice: true,
        askingPrice: true,
        escrowStatus: true,
        affiliateCommission: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const grossVolume = attributed.reduce(
      (sum, item) => sum + (item.salePrice ?? item.askingPrice ?? 0),
      0
    );
    // Attributed but not yet delivered. Shown separately from earnings so a
    // creator is never told they have been paid money that has not moved.
    const pendingCommission = attributed
      .filter((item) => item.escrowStatus !== 'STAGE2_SETTLED_89')
      .reduce((sum, item) => sum + (item.affiliateCommission ?? 0), 0);

    return NextResponse.json({
      success: true,
      stats: {
        name: creator.name,
        handle: creator.handle,
        platform: creator.platform,
        nicheCategory: creator.nicheCategory,
        location: creator.location,
        photoUrl: creator.photoUrl,
        joinedAt: creator.createdAt,
        totalClicks: creator.totalClicks,
        totalSales: creator.totalSales,
        grossVolume: Math.round(grossVolume),
        earningsTotal: Math.round(creator.earningsTotal),
        pendingCommission: Math.round(pendingCommission),
        commissionRate: CREATOR_RATE,
        payoutUpi: maskUpi(creator.upiId),
        attributedItems: attributed.map((item) => ({
          id: item.id,
          craftType: item.craftType,
          price: item.salePrice ?? item.askingPrice ?? null,
          commission: item.affiliateCommission ?? null,
          settled: item.escrowStatus === 'STAGE2_SETTLED_89',
        })),
      },
    });
  } catch (error) {
    console.error('Creator stats error:', error);
    return NextResponse.json({ error: 'Could not load stats.' }, { status: 500 });
  }
}
