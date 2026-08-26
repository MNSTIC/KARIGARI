import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { loadEligibilitySnapshot } from '@/lib/artisanEligibility';
import {
  SCHEME_BY_KEY,
  evaluateScheme,
  isSchemeKey,
  normalizeStatus,
  resolveLegacySchemeKey,
  selfDeclarationsFor,
  type SchemeKey,
} from '@/lib/schemes';

export const dynamic = 'force-dynamic';

/**
 * Records the artisan's intent to apply and advances the internal tracker to
 * APPLIED.
 *
 * This endpoint does NOT transmit anything to any government system. The actual
 * submission happens on the official portal that the card's "Direct Apply"
 * button opens, or on the downloaded form. Nothing here should ever be
 * described to the artisan as a government submission.
 */
export async function POST(req: Request) {
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

    const body = await req.json().catch(() => null);
    const schemeKey = body?.schemeKey;
    const selfDeclarations: Record<string, boolean> = body?.selfDeclarations ?? {};

    if (!isSchemeKey(schemeKey)) {
      return NextResponse.json({ error: 'Unknown scheme' }, { status: 400 });
    }

    const scheme = SCHEME_BY_KEY[schemeKey];

    // Re-evaluate from the database. The client's opinion of its own
    // eligibility is never trusted.
    const snapshot = await loadEligibilitySnapshot(artisanId);
    if (!snapshot.found) {
      return NextResponse.json(
        { error: 'Your session is no longer valid. Please sign in again.', code: 'SESSION_STALE' },
        { status: 401 }
      );
    }

    const verdict = evaluateScheme(scheme, snapshot.ctx);
    if (verdict.status !== 'ELIGIBLE') {
      return NextResponse.json(
        {
          error:
            verdict.status === 'INFO_NEEDED'
              ? 'Complete your profile before applying for this scheme.'
              : 'You are not currently eligible for this scheme.',
          verdict,
        },
        { status: 409 }
      );
    }

    const required = selfDeclarationsFor(scheme);
    const unchecked = required.filter((r) => selfDeclarations[r.id] !== true);
    if (unchecked.length > 0) {
      return NextResponse.json(
        {
          error: 'All declarations must be confirmed before applying.',
          missingDeclarations: unchecked.map((r) => ({ id: r.id, label: r.label })),
        },
        { status: 400 }
      );
    }

    // Match on the stable key, but also adopt a legacy row written before
    // `schemeKey` existed so we backfill rather than duplicate. This must cover
    // EVERY name the read route's resolver adopts (legacyNamesFor) — otherwise
    // the GET would show an existing APPROVED row while this route created a
    // second one at APPLIED, walking the tracker backwards.
    const candidates = await prisma.schemeApplication.findMany({
      where: { userId: artisanId, OR: [{ schemeKey }, { schemeKey: null }] },
      orderBy: { createdAt: 'desc' },
    });
    const existing =
      candidates.find(
        (r) => ((r.schemeKey as SchemeKey | null) ?? resolveLegacySchemeKey(r.schemeName)) === schemeKey
      ) ?? null;

    // Never walk a tracker backwards: once a scheme is APPROVED or DISBURSED,
    // re-applying must not reset it to APPLIED.
    const currentStatus = existing ? normalizeStatus(existing.status) : null;
    if (currentStatus && currentStatus !== 'ELIGIBLE' && currentStatus !== 'REJECTED') {
      return NextResponse.json({
        success: true,
        alreadyTracked: true,
        application: {
          id: existing!.id,
          schemeKey,
          schemeName: existing!.schemeName,
          status: currentStatus,
          appliedAt: existing!.appliedAt ? existing!.appliedAt.toISOString() : null,
          notes: existing!.notes,
        },
      });
    }

    const appliedAt = new Date();
    const notes = `Artisan confirmed all ${required.length} declaration(s) and started an application on ${scheme.name}. Submission is completed on the official portal (${scheme.officialUrl}); KARIGARI tracks the status only.`;

    const row = existing
      ? await prisma.schemeApplication.update({
          where: { id: existing.id },
          data: {
            schemeKey,
            schemeName: scheme.name,
            status: 'APPLIED',
            appliedAt,
            notes,
          },
        })
      : await prisma.schemeApplication.create({
          data: {
            userId: artisanId,
            schemeKey,
            schemeName: scheme.name,
            status: 'APPLIED',
            appliedAt,
            notes,
          },
        });

    return NextResponse.json({
      success: true,
      application: {
        id: row.id,
        schemeKey,
        schemeName: row.schemeName,
        status: normalizeStatus(row.status),
        appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
        notes: row.notes,
      },
    });
  } catch (error: any) {
    console.error('Scheme apply API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
