import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { getPricingDiscrepancy } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

/** The whole JWT payload: one admin role, nothing else. */
type AuthToken = { userId: string; role: string };

/** Markers we write into flagReason so a resolved flag never re-raises itself. */
const OVERRIDE_PREFIX = 'OVERRIDE_APPROVED:';
const INVESTIGATION_PREFIX = 'UNDER_INVESTIGATION:';

function resolutionOf(flagReason: string | null): 'OPEN' | 'INVESTIGATING' | 'OVERRIDE_APPROVED' {
  if (!flagReason) return 'OPEN';
  if (flagReason.startsWith(OVERRIDE_PREFIX)) return 'OVERRIDE_APPROVED';
  if (flagReason.startsWith(INVESTIGATION_PREFIX)) return 'INVESTIGATING';
  return 'OPEN';
}

function stripMarker(flagReason: string | null): string | null {
  if (!flagReason) return null;
  return flagReason.replace(OVERRIDE_PREFIX, '').replace(INVESTIGATION_PREFIX, '').trim() || null;
}

/**
 * The Field Facilitator work queue (new_admin.md Tier 1.1 + 1.2).
 *
 * Returns the anti-exploitation pricing queue and the Voice QA queue with the
 * artisan's real contact details — this view exists precisely so the facilitator
 * can phone the artisan before an exploited listing goes live.
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

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const artisanInclude = {
      artisan: {
        select: {
          id: true,
          name: true,
          email: true,
          artisanProfile: {
            select: {
              mobileNumber: true,
              location: true,
              clusterName: true,
              craftType: true,
              photoUrl: true,
              healthScore: true,
            },
          },
        },
      },
    } as const;

    const [priceCandidates, voiceItems, clusterArtisans, publishedThisWeek] = await Promise.all([
      // Anything that either carries a stored flag or has an accepted price we can
      // re-test on the fly — legacy rows predate `pricingFlag` and must still surface.
      prisma.craftItem.findMany({
        where: { OR: [{ pricingFlag: true }, { salePrice: { not: null } }] },
        include: artisanInclude,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.craftItem.findMany({
        where: { status: 'PENDING_VERIFICATION' },
        include: artisanInclude,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where: { role: 'ARTISAN', accountStatus: 'ACTIVE' } }),
      prisma.auditLog.count({
        where: { action: 'ADMIN_VERIFIED', createdAt: { gte: oneWeekAgo } },
      }),
    ]);

    const shape = (item: (typeof priceCandidates)[number]) => {
      const discrepancy = getPricingDiscrepancy(item);
      return {
        id: item.id,
        patchId: item.patchId,
        craftType: item.craftType,
        status: item.status,
        images: item.images,
        laborDays: item.laborDays,
        rawMaterialCost: item.rawMaterialCost,
        createdAt: item.createdAt,
        catalogMethod: item.catalogMethod,
        voiceLanguage: item.voiceLanguage,
        fairWageFloor: item.fairWageFloor,
        salePrice: item.salePrice,
        askingPrice: item.askingPrice,
        resolution: resolutionOf(item.flagReason),
        flagReason: stripMarker(item.flagReason),
        discrepancy,
        artisan: {
          id: item.artisan.id,
          name: item.artisan.name,
          // Facilitator view is deliberately unmasked: the whole point is to call.
          mobileNumber: item.artisan.artisanProfile?.mobileNumber || null,
          location: item.artisan.artisanProfile?.location || null,
          clusterName: item.artisan.artisanProfile?.clusterName || null,
          craftType: item.artisan.artisanProfile?.craftType || null,
          photoUrl: item.artisan.artisanProfile?.photoUrl || null,
          healthScore: item.artisan.artisanProfile?.healthScore ?? null,
        },
      };
    };

    const shapedCandidates = priceCandidates.map(shape);
    const pricingQueue = shapedCandidates.filter(
      (i) => i.discrepancy.flagged && i.resolution !== 'OVERRIDE_APPROVED'
    );
    const resolvedFlags = shapedCandidates
      .filter((i) => i.resolution === 'OVERRIDE_APPROVED')
      .slice(0, 10);

    const voiceQueue = voiceItems.map((item) => ({
      ...shape(item),
      descriptionOriginal: item.descriptionOriginal,
      descriptionEnglish: item.descriptionEnglish,
      aiGeneratedListing: item.aiGeneratedListing,
      audioUrl: item.audioUrl,
    }));

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          pendingQa: voiceQueue.length,
          activeFlags: pricingQueue.length,
          clusterArtisans,
          publishedThisWeek,
        },
        pricingQueue,
        resolvedFlags,
        voiceQueue,
      },
    });
  } catch (error) {
    console.error('Facilitator Queue API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
