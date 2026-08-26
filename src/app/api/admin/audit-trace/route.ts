import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** The whole JWT payload: one admin role, nothing else. */
type AuthToken = { userId: string; role: string };

/**
 * Ledger hash for an audit event. Lifted verbatim from the old Super-Admin
 * "Global Raw Ledger" so the Nodal view keeps the same tamper-evident identifier
 * the rest of the demo already shows.
 */
function ledgerHash(id: string) {
  return '0x' + id.replace(/-/g, '').substring(0, 16).toUpperCase();
}

/**
 * Traceability & Hash-Ledger Oversight (new_admin.md Tier 2.2).
 *
 * With `q`: returns one product's immutable chain (Created -> Verified -> Sold).
 * Without `q`: returns the most recent platform-wide ledger entries.
 * Aggregate/oversight data only — no artisan phone numbers or UPI IDs.
 */
export async function GET(req: Request) {
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

    const q = (new URL(req.url).searchParams.get('q') || '').trim();

    // ---- Global raw ledger (always returned, so the tab is never empty) ----
    const rawLogs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: { craftItem: { select: { patchId: true, craftType: true } } },
    });

    const ledger = rawLogs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      patchId: log.craftItem?.patchId || null,
      craftType: log.craftItem?.craftType || null,
      actorRole: log.actorRole,
      action: log.action,
      hash: ledgerHash(log.id),
    }));

    // A short index of traceable products so the officer has something to click.
    const traceable = await prisma.craftItem.findMany({
      where: { patchId: { not: null } },
      select: { patchId: true, craftType: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    if (!q) {
      return NextResponse.json({ success: true, data: { query: '', item: null, ledger, traceable } });
    }

    const item = await prisma.craftItem.findFirst({
      where: {
        OR: [{ patchId: { equals: q, mode: 'insensitive' } }, { id: q }],
      },
      include: {
        artisan: { select: { name: true, artisanProfile: { select: { clusterName: true, location: true } } } },
        auditLogs: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!item) {
      return NextResponse.json({
        success: true,
        data: { query: q, item: null, notFound: true, ledger, traceable },
      });
    }

    let previousHash: string | null = null;
    const chain = item.auditLogs.map((log) => {
      const hash = ledgerHash(log.id);
      const entry = {
        id: log.id,
        action: log.action,
        actorRole: log.actorRole,
        comments: log.comments,
        createdAt: log.createdAt,
        hash,
        previousHash,
      };
      previousHash = hash;
      return entry;
    });

    return NextResponse.json({
      success: true,
      data: {
        query: q,
        item: {
          id: item.id,
          patchId: item.patchId,
          craftType: item.craftType,
          status: item.status,
          createdAt: item.createdAt,
          fairWageFloor: item.fairWageFloor,
          salePrice: item.salePrice,
          pricingFlag: item.pricingFlag,
          catalogMethod: item.catalogMethod,
          voiceLanguage: item.voiceLanguage,
          // Cluster, not contact details — the Nodal view stays macro.
          artisanName: item.artisan?.name || null,
          cluster: item.artisan?.artisanProfile?.clusterName || null,
          location: item.artisan?.artisanProfile?.location || null,
        },
        chain,
        ledger,
        traceable,
      },
    });
  } catch (error) {
    console.error('Audit Trace API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
