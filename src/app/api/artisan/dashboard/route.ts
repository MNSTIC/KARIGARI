import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret');
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 });
    }

    const artisanId = decoded.userId;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Parallelize all independent DB queries to dramatically improve SSR / API response time
    const [
      user,
      myCapturesCount,
      advancedItems,
      itemsSold,
      queued,
      recentCaptures,
      pastWeekCaptures,
      pastWeekAdvancedItems,
      pastWeekSold,
      pastWeekQueued
    ] = await Promise.all([
      prisma.user.findUnique({ 
        where: { id: artisanId }, 
        include: { artisanProfile: true, schemeApplications: true } 
      }),
      prisma.craftItem.count({ where: { artisanId } }),
      prisma.craftItem.findMany({ where: { artisanId, status: { in: ['ADVANCE_PAID', 'SOLD_FINAL'] } }, select: { advancePaid: true } }),
      prisma.craftItem.count({ where: { artisanId, status: { in: ['SOLD_FINAL', 'SOLD_MIDDLEMAN'] } } }),
      prisma.craftItem.aggregate({ _sum: { finalPayoutQueued: true }, where: { artisanId, status: 'SOLD_FINAL' } }),
      // auditLogs travel with the item so "View Details" can render the same
      // Product Timeline the public passport shows, without a second round trip.
      prisma.craftItem.findMany({
        where: { artisanId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { auditLogs: { orderBy: { createdAt: 'desc' } } }
      }),
      prisma.craftItem.count({ where: { artisanId, createdAt: { gte: oneWeekAgo } } }),
      prisma.craftItem.findMany({ where: { artisanId, status: { in: ['ADVANCE_PAID', 'SOLD_FINAL'] }, createdAt: { gte: oneWeekAgo } }, select: { advancePaid: true } }),
      prisma.craftItem.count({ where: { artisanId, status: { in: ['SOLD_FINAL', 'SOLD_MIDDLEMAN'] }, createdAt: { gte: oneWeekAgo } } }),
      prisma.craftItem.aggregate({ _sum: { finalPayoutQueued: true }, where: { artisanId, status: 'SOLD_FINAL', createdAt: { gte: oneWeekAgo } } })
    ]);

    if (!user) {
      return NextResponse.json(
        { error: 'Your session is no longer valid. Please sign in again.', code: 'SESSION_STALE' },
        { status: 401 }
      );
    }

    // Only money actually disbursed counts. The `fairWageFloor` fallback that used
    // to sit here invented an advance for every item that had not been paid yet.
    const totalAdvances = advancedItems.reduce((sum: number, item: any) => sum + (item.advancePaid || 0), 0);
    const totalEarnings = totalAdvances + (queued._sum.finalPayoutQueued || 0);

    const pastWeekAdvances = pastWeekAdvancedItems.reduce((sum: number, item: any) => sum + (item.advancePaid || 0), 0);
    const pastWeekEarnings = pastWeekAdvances + (pastWeekQueued._sum.finalPayoutQueued || 0);

    return NextResponse.json({
      success: true,
      data: {
        artisanName: user?.name,
        artisanProfile: user?.artisanProfile,
        schemeApplications: user?.schemeApplications,
        myCapturesCount,
        totalAdvances,
        itemsSold,
        totalEarnings,
        healthScore: user?.artisanProfile?.healthScore ?? 100,
        accountStatus: user?.accountStatus ?? 'ACTIVE',
        recentCaptures,
        trends: {
          captures: `+${pastWeekCaptures}`,
          advances: `+₹${pastWeekAdvances.toLocaleString()}`,
          sold: `+${pastWeekSold}`,
          earnings: `+₹${pastWeekEarnings.toLocaleString()}`
        }
      }
    });
  } catch (error: any) {
    console.error('Artisan Dashboard API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
