import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { loadEligibilitySnapshot } from '@/lib/artisanEligibility';
import {
  evaluateAllSchemes,
  normalizeStatus,
  resolveLegacySchemeKey,
  type ApplicationStatus,
  type SchemeKey,
} from '@/lib/schemes';

export const dynamic = 'force-dynamic';

interface TrackedApplication {
  id: string;
  schemeKey: SchemeKey | null;
  schemeName: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  notes: string | null;
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret');
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 });
    }

    const artisanId = decoded.userId as string;

    const [snapshot, rows] = await Promise.all([
      loadEligibilitySnapshot(artisanId),
      prisma.schemeApplication.findMany({
        where: { userId: artisanId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!snapshot.found) {
      return NextResponse.json(
        { error: 'Your session is no longer valid. Please sign in again.', code: 'SESSION_STALE' },
        { status: 401 }
      );
    }

    // Eligibility is computed here, on the server, from the DB — never sent in.
    const evaluated = evaluateAllSchemes(snapshot.ctx);

    const byKey = new Map<SchemeKey, TrackedApplication>();
    for (const row of rows) {
      const key = (row.schemeKey as SchemeKey | null) ?? resolveLegacySchemeKey(row.schemeName);
      if (!key) continue;
      // rows are newest-first; keep the newest per scheme
      if (byKey.has(key)) continue;
      byKey.set(key, {
        id: row.id,
        schemeKey: key,
        schemeName: row.schemeName,
        status: normalizeStatus(row.status),
        appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
        notes: row.notes,
      });
    }

    // A tracked row whose scheme the artisan no longer qualifies for is marked
    // `stale`, so the card can show the history without dressing it as a live
    // government outcome next to an "ineligible" reason.
    const schemes = evaluated.map((s) => {
      const app = byKey.get(s.key) ?? null;
      return {
        ...s,
        application: app ? { ...app, stale: s.verdict.status !== 'ELIGIBLE' } : null,
      };
    });

    return NextResponse.json({
      success: true,
      artisanName: snapshot.artisanName,
      profileSummary: snapshot.profileSummary,
      schemes,
      counts: {
        eligible: schemes.filter((s) => s.verdict.status === 'ELIGIBLE').length,
        infoNeeded: schemes.filter((s) => s.verdict.status === 'INFO_NEEDED').length,
        ineligible: schemes.filter((s) => s.verdict.status === 'INELIGIBLE').length,
      },
    });
  } catch (error: any) {
    console.error('Artisan Schemes API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
