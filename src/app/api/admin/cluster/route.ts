import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { getPricingDiscrepancy } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

/** The whole JWT payload: one admin role, nothing else. */
type AuthToken = { userId: string; role: string };

/**
 * The facilitator's CRM view of their cluster (new_admin.md Tier 1, "My Cluster").
 *
 * Contact details are intentionally unmasked here — this is the on-the-ground
 * admin who needs to call artisans. The Nodal view never renders this data.
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');

    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let decoded: AuthToken;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const artisans = await prisma.user.findMany({
      where: { role: 'ARTISAN' },
      include: {
        artisanProfile: true,
        craftItems: {
          select: {
            id: true,
            status: true,
            salePrice: true,
            askingPrice: true,
            fairWageFloor: true,
            marketPriceMax: true,
            standardMarketPrice: true,
            pricingFlag: true,
            flagReason: true,
            advancePaid: true,
            finalPayoutQueued: true,
            catalogMethod: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const roster = artisans.map((a) => {
      const items = a.craftItems;
      const earnings = items.reduce(
        (sum, i) => sum + (i.advancePaid || 0) + (i.finalPayoutQueued || 0),
        0
      );
      const activeFlags = items.filter(
        (i) =>
          getPricingDiscrepancy(i).flagged && !(i.flagReason || '').startsWith('OVERRIDE_APPROVED:')
      ).length;
      const voiceItems = items.filter((i) => i.catalogMethod === 'VOICE').length;

      return {
        id: a.id,
        name: a.name,
        email: a.email,
        accountStatus: a.accountStatus,
        mobileNumber: a.artisanProfile?.mobileNumber || null,
        craftType: a.artisanProfile?.craftType || null,
        location: a.artisanProfile?.location || null,
        clusterName: a.artisanProfile?.clusterName || 'Unassigned Cluster',
        photoUrl: a.artisanProfile?.photoUrl || null,
        healthScore: a.artisanProfile?.healthScore ?? null,
        experienceYears: a.artisanProfile?.experienceYears ?? null,
        socialCategory: a.artisanProfile?.socialCategory || null,
        annualIncome: a.artisanProfile?.annualIncome ?? null,
        upiId: a.artisanProfile?.upiId || null,
        giTagCertified: a.artisanProfile?.giTagCertified ?? false,
        itemCount: items.length,
        pendingCount: items.filter((i) => i.status === 'PENDING_VERIFICATION').length,
        soldCount: items.filter((i) => i.status === 'SOLD_FINAL').length,
        voiceItems,
        activeFlags,
        earnings,
      };
    });

    // Group into the clusters the facilitator actually walks between.
    const clusterMap = new Map<string, typeof roster>();
    for (const artisan of roster) {
      const key = artisan.clusterName;
      if (!clusterMap.has(key)) clusterMap.set(key, []);
      clusterMap.get(key)!.push(artisan);
    }

    const clusters = Array.from(clusterMap.entries())
      .map(([name, members]) => ({
        name,
        artisanCount: members.length,
        activeFlags: members.reduce((s, m) => s + m.activeFlags, 0),
        members,
      }))
      .sort((a, b) => b.artisanCount - a.artisanCount);

    return NextResponse.json({
      success: true,
      data: { artisans: roster, clusters, totalArtisans: roster.length },
    });
  } catch (error) {
    console.error('Cluster API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
