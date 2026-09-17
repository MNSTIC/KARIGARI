import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { slugifyHandle } from '@/lib/creators';
import { saltedIpHash } from '@/lib/searchLog';

/**
 * Record one visit that arrived through a creator's `?ref=` link.
 *
 * Never hard-fails on an unknown handle. A shopper who mistypes a link, or
 * follows one whose creator has since been deactivated, must still see the
 * storefront — a 404 here would break the shop over an analytics row.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const handle = slugifyHandle(typeof body?.handle === 'string' ? body.handle : '');
    const craftItemId = typeof body?.craftItemId === 'string' ? body.craftItemId : null;

    if (!handle) {
      return NextResponse.json({ ok: true, tracked: false });
    }

    const creator = await prisma.creator.findUnique({
      where: { handle },
      select: { id: true, status: true },
    });
    if (!creator || creator.status !== 'ACTIVE') {
      return NextResponse.json({ ok: true, tracked: false });
    }

    // The counter and the click row land together: a totalClicks that does not
    // reconcile against AffiliateClick would make the creator's stats page a
    // number nobody can audit.
    await prisma.$transaction([
      prisma.affiliateClick.create({
        data: { creatorId: creator.id, craftItemId, ipHash: saltedIpHash(req) },
      }),
      prisma.creator.update({
        where: { id: creator.id },
        data: { totalClicks: { increment: 1 } },
      }),
    ]);

    return NextResponse.json({ ok: true, tracked: true });
  } catch (error) {
    // Analytics must never take the storefront down with it.
    console.error('Affiliate track error:', error);
    return NextResponse.json({ ok: true, tracked: false });
  }
}
