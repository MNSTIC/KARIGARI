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

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Run queries concurrently
    const [
      totalArtisans,
      advances,
      itemsCaptured,
      itemsSold,
      pastWeekItemsCaptured,
      pastWeekItemsSold,
      pastWeekAdvancesQuery,
      pastWeekArtisans,
      adminItems,
      recentCaptures,
      pendingCaptures,
      alerts,
      alertCount,
      atRiskArtisans,
      adminUser,
      allArtisans,
      disbursementRows
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'ARTISAN' } }),
      prisma.craftItem.aggregate({ _sum: { advancePaid: true }, where: { status: { in: ['ADVANCE_PAID', 'SOLD_FINAL'] } } }),
      prisma.craftItem.count(),
      prisma.craftItem.count({ where: { status: { in: ['SOLD_FINAL', 'SOLD_MIDDLEMAN'] } } }),
      prisma.craftItem.count({ where: { createdAt: { gte: oneWeekAgo } } }),
      prisma.craftItem.count({ where: { status: { in: ['SOLD_FINAL', 'SOLD_MIDDLEMAN'] }, createdAt: { gte: oneWeekAgo } } }),
      prisma.craftItem.aggregate({ _sum: { advancePaid: true }, where: { status: { in: ['ADVANCE_PAID', 'SOLD_FINAL'] }, createdAt: { gte: oneWeekAgo } } }),
      prisma.user.count({ where: { role: 'ARTISAN', createdAt: { gte: oneWeekAgo } } }),
      prisma.craftItem.findMany({ where: { assignedAdminId: decoded.userId, status: { not: 'PENDING_VERIFICATION' } } }),
      prisma.craftItem.findMany({ take: 5, orderBy: { createdAt: 'desc' }, where: { status: { not: 'PENDING_VERIFICATION' } }, include: { artisan: { select: { name: true, artisanProfile: true } }, auditLogs: { orderBy: { createdAt: 'desc' } } } }),
      prisma.craftItem.findMany({ where: { status: 'PENDING_VERIFICATION' }, orderBy: { createdAt: 'desc' }, include: { artisan: { select: { name: true, artisanProfile: true } } } }),
      prisma.craftItem.findMany({ where: { assignedAdminId: decoded.userId, OR: [ { status: 'FLAGGED' }, { failedScanCount: { gt: 0 } }, { fairnessScore: { lt: 60 } } ] }, include: { auditLogs: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' } }),
      prisma.craftItem.count({ where: { assignedAdminId: decoded.userId, OR: [ { status: 'FLAGGED' }, { fairnessScore: { lt: 60 } } ] } }),
      prisma.user.findMany({ where: { role: 'ARTISAN', accountStatus: 'ACTIVE', artisanProfile: { healthScore: { lt: 65 } } }, include: { artisanProfile: true } }),
      prisma.user.findUnique({ where: { id: decoded.userId } }),
      prisma.user.findMany({ where: { role: 'ARTISAN' }, include: { artisanProfile: true, craftItems: { where: { status: { in: ['ADVANCE_PAID', 'SOLD_FINAL', 'SOLD_MIDDLEMAN'] } }, select: { advancePaid: true, fairWageFloor: true, finalPayoutQueued: true } } } }),
      prisma.craftItem.findMany({ select: { createdAt: true, advancePaid: true, finalPayoutQueued: true }, orderBy: { createdAt: 'asc' } })
    ]);

    const totalAdvances = advances._sum.advancePaid || 0;
    const pastWeekAdvances = pastWeekAdvancesQuery._sum.advancePaid || 0;

    const trends = {
      artisans: `+${pastWeekArtisans}`,
      captured: `+${pastWeekItemsCaptured}`,
      sold: `+${pastWeekItemsSold}`,
      advances: `+₹${pastWeekAdvances.toLocaleString()}`
    };
    
    let totalScore = 0;
    if (adminItems.length > 0) {
      adminItems.forEach((item: any) => {
        const salePrice = item.salePrice || item.fairWageFloor || 0;
        const floor = item.fairWageFloor || 1;
        let score = (salePrice / floor) * 100;
        if (score > 100) score = 100;
        totalScore += score;
      });
    }
    
    const complianceRate = adminItems.length > 0 ? Math.round(totalScore / adminItems.length) : 100;

    const leaderboard = allArtisans.map((a: any) => {
      let earnings = 0;
      a.craftItems.forEach((ci: any) => {
        // Real money only: advance actually disbursed plus final payout queued.
        earnings += (ci.advancePaid || 0) + (ci.finalPayoutQueued || 0);
      });
      return {
        id: a.id,
        name: a.name,
        image: a.artisanProfile?.photoUrl || "/female_artisan.jpg",
        items: a.craftItems.length,
        earnings
      };
    }).sort((a: any, b: any) => b.earnings - a.earnings).slice(0, 5);

    let above = 0, at = 0, below = 0;
    adminItems.forEach((item: any) => {
      const sale = item.salePrice || item.standardMarketPrice || item.fairWageFloor || 0;
      const floor = item.fairWageFloor || 1;
      if (sale > floor * 1.1) above++;
      else if (sale >= floor) at++;
      else below++;
    });
    
    const totalWageItems = above + at + below;
    const fairWageData = totalWageItems > 0 ? [
      { name: "Above Fair Floor", value: Math.round((above / totalWageItems) * 100), color: "#4A5241" },
      { name: "At Fair Floor", value: Math.round((at / totalWageItems) * 100), color: "#A9BFB0" },
      { name: "Below Fair Floor", value: Math.round((below / totalWageItems) * 100), color: "#B14B39" }
    ] : [
      { name: "No Sales Data", value: 100, color: "#E4DCD6" }
    ];
    
    // Real cumulative disbursement over the last six weeks, computed from the
    // ledger rather than from placeholder figures.
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const disbursementData = Array.from({ length: 7 }, (_, i) => {
      const cutoff = now - (6 - i) * WEEK_MS;
      const amount = disbursementRows
        .filter((r: any) => r.createdAt.getTime() <= cutoff)
        .reduce((sum: number, r: any) => sum + (r.advancePaid || 0) + (r.finalPayoutQueued || 0), 0);
      return {
        day: i === 6 ? 'Today' : new Date(cutoff).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        amount
      };
    });
    
    return NextResponse.json({
      success: true,
      data: {
        totalArtisans,
        totalAdvances,
        complianceRate,
        recentCaptures,
        pendingCaptures,
        alertCount,
        alerts,
        atRiskArtisans,
        patchBankBalance: adminUser?.patchBankBalance || 0,
        patchBankIssued: adminUser?.patchBankIssued || 0,
        itemsCaptured,
        itemsSold,
        trends,
        leaderboard,
        fairWageData,
        disbursementData
      }
    });
  } catch (error: any) {
    console.error('Admin Dashboard API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
