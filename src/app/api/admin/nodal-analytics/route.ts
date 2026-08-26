import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { getPricingDiscrepancy } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

/** The whole JWT payload: one admin role, nothing else. */
type AuthToken = { userId: string; role: string };

const METHOD_COLORS: Record<string, string> = {
  Voice: '#24332C',
  Manual: '#8F412F',
  Unrecorded: '#DCD4CE',
};

const LANGUAGE_COLORS = ['#24332C', '#3D624F', '#4D5D6C', '#8F412F', '#9A7B3F', '#6B635E'];
const CATEGORY_COLORS: Record<string, string> = {
  SC: '#8F412F',
  ST: '#4D5D6C',
  OBC: '#3D624F',
  EWS: '#9A7B3F',
  General: '#A69C95',
  Unrecorded: '#DCD4CE',
};

/**
 * Digital Inclusion impact metrics for the Central Nodal Officer
 * (new_admin.md Tier 2.1).
 *
 * Deliberately macro: counts, percentages and distributions only. No individual
 * artisan PII is returned from this endpoint — that lives on the Facilitator view.
 * Every number here is computed from the database; nothing is hard-coded.
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

    const [items, profiles, totalArtisans, totalAuditEvents] = await Promise.all([
      prisma.craftItem.findMany({
        select: {
          id: true,
          artisanId: true,
          catalogMethod: true,
          voiceLanguage: true,
          status: true,
          salePrice: true,
          fairWageFloor: true,
          advancePaid: true,
          finalPayoutQueued: true,
          pricingFlag: true,
          flagReason: true,
          createdAt: true,
        },
      }),
      prisma.artisanProfile.findMany({
        select: { userId: true, socialCategory: true, annualIncome: true, clusterName: true },
      }),
      prisma.user.count({ where: { role: 'ARTISAN' } }),
      prisma.auditLog.count(),
    ]);

    // ---- 1. Cataloging method: voice vs manual (the literacy-barrier metric) ----
    const methodCounts = { Voice: 0, Manual: 0, Unrecorded: 0 };
    for (const i of items) {
      if (i.catalogMethod === 'VOICE') methodCounts.Voice++;
      else if (i.catalogMethod === 'MANUAL') methodCounts.Manual++;
      else methodCounts.Unrecorded++;
    }
    const catalogMethodData = Object.entries(methodCounts)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value, color: METHOD_COLORS[name] }));

    const methodTotal = methodCounts.Voice + methodCounts.Manual;
    const voiceAdoptionPct = methodTotal > 0 ? Math.round((methodCounts.Voice / methodTotal) * 100) : 0;

    // ---- 2. Language distribution ----
    const languageCounts = new Map<string, number>();
    for (const i of items) {
      const key = i.voiceLanguage || 'Unrecorded';
      languageCounts.set(key, (languageCounts.get(key) || 0) + 1);
    }
    const languageData = Array.from(languageCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], idx) => ({
        name,
        value,
        pct: items.length > 0 ? Math.round((value / items.length) * 100) : 0,
        color: LANGUAGE_COLORS[idx % LANGUAGE_COLORS.length],
      }));

    // ---- 3. Average wage increase ----
    // Baseline = the artisan's declared annual income before joining.
    // Uplift = money they have actually received through KARIGARI (advance +
    // final payout). Expressed as a percentage on top of that baseline.
    const earningsByArtisan = new Map<string, number>();
    for (const i of items) {
      const earned = (i.advancePaid || 0) + (i.finalPayoutQueued || 0);
      if (earned <= 0) continue;
      earningsByArtisan.set(i.artisanId, (earningsByArtisan.get(i.artisanId) || 0) + earned);
    }

    const wageRows = profiles
      .filter((p) => typeof p.annualIncome === 'number' && (p.annualIncome as number) > 0)
      .map((p) => {
        const baseline = p.annualIncome as number;
        const uplift = earningsByArtisan.get(p.userId) || 0;
        return {
          userId: p.userId,
          cluster: p.clusterName || 'Unassigned',
          baseline,
          uplift,
          increasePct: Math.round((uplift / baseline) * 100),
        };
      });

    const avgWageIncreasePct =
      wageRows.length > 0
        ? Math.round(wageRows.reduce((s, r) => s + r.increasePct, 0) / wageRows.length)
        : 0;
    const totalBaseline = wageRows.reduce((s, r) => s + r.baseline, 0);
    const totalUplift = wageRows.reduce((s, r) => s + r.uplift, 0);

    // Roll up by cluster so the chart stays aggregate — no individual is named.
    const clusterWage = new Map<string, { baseline: number; uplift: number; artisans: number }>();
    for (const r of wageRows) {
      const entry = clusterWage.get(r.cluster) || { baseline: 0, uplift: 0, artisans: 0 };
      entry.baseline += r.baseline;
      entry.uplift += r.uplift;
      entry.artisans += 1;
      clusterWage.set(r.cluster, entry);
    }
    const wageChart = Array.from(clusterWage.entries()).map(([name, v]) => ({
      name,
      baseline: Math.round(v.baseline / v.artisans),
      withKarigari: Math.round((v.baseline + v.uplift) / v.artisans),
      increasePct: v.baseline > 0 ? Math.round((v.uplift / v.baseline) * 100) : 0,
      artisans: v.artisans,
    }));

    // ---- 4. MoSJE community breakdown, from real socialCategory values ----
    const categoryCounts = new Map<string, number>();
    for (const p of profiles) {
      const key = p.socialCategory || 'Unrecorded';
      categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
    }
    const communityData = Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({
        name,
        value,
        pct: profiles.length > 0 ? Math.round((value / profiles.length) * 100) : 0,
        color: CATEGORY_COLORS[name] || '#6B635E',
      }));

    // ---- 5. Fair-wage compliance + open exploitation flags ----
    const pricedItems = items.filter((i) => i.salePrice !== null && i.fairWageFloor !== null);
    const compliant = pricedItems.filter((i) => (i.salePrice as number) >= (i.fairWageFloor as number)).length;
    const belowFloor = pricedItems.length - compliant;
    const compliancePct =
      pricedItems.length > 0 ? Math.round((compliant / pricedItems.length) * 100) : 100;

    const activeFlags = items.filter(
      (i) =>
        getPricingDiscrepancy(i).flagged && !(i.flagReason || '').startsWith('OVERRIDE_APPROVED:')
    ).length;

    const totalDisbursed = items.reduce(
      (s, i) => s + (i.advancePaid || 0) + (i.finalPayoutQueued || 0),
      0
    );

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalArtisans,
          totalItems: items.length,
          voiceAdoptionPct,
          languagesInUse: languageData.filter((l) => l.name !== 'Unrecorded').length,
          avgWageIncreasePct,
          activeFlags,
          compliancePct,
          totalDisbursed,
          totalAuditEvents,
          clustersCovered: clusterWage.size,
        },
        catalogMethodData,
        languageData,
        wage: {
          avgWageIncreasePct,
          artisansCounted: wageRows.length,
          totalBaseline,
          totalUplift,
          chart: wageChart,
        },
        communityData,
        fairWage: { compliant, belowFloor, compliancePct, pricedItems: pricedItems.length },
      },
    });
  } catch (error) {
    console.error('Nodal Analytics API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
