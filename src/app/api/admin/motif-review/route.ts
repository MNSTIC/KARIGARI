import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { isMotifStatus, type MotifStatus } from '@/lib/motifHash';
import { toPublicMotif } from '@/lib/motifLicence';

/**
 * GET / POST /api/admin/motif-review — the human half of the register.
 *
 * Every registration lands PENDING or FLAGGED_DUPLICATE and stays there until a
 * person looks at it. That is the whole design: a perceptual hash is a reason
 * to look, never a verdict, and nothing in this app decides on its own that one
 * village copied another.
 *
 * The review surface is deliberately neutral. A flagged pair is shown as two
 * records and a distance — not as an accusation, not with an "original" and a
 * "copy" — because two villages genuinely can carry the same tradition, and
 * this platform has no standing to rule on which came first.
 *
 * Confirming a registration writes an `AuditLog` row when the record is
 * attached to a piece, so the decision is on the piece's own timeline.
 */
export const dynamic = 'force-dynamic';

const MAX_NOTE = 400;

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status });
}

/** The same cookie-and-role check `/api/admin/tickets` performs. */
async function requireAdmin(): Promise<{ ok: true; adminId: string } | { ok: false; response: NextResponse }> {
  const token = (await cookies()).get('auth-token');
  if (!token) return { ok: false, response: fail(401, 'UNAUTHORIZED', 'Sign in first.') };
  try {
    const decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as {
      userId: string;
      role: string;
    };
    if (decoded.role !== 'ADMIN') {
      return { ok: false, response: fail(403, 'FORBIDDEN', 'Admin access required.') };
    }
    return { ok: true, adminId: decoded.userId };
  } catch {
    return { ok: false, response: fail(401, 'BAD_TOKEN', 'Your session is no longer valid.') };
  }
}

const REVIEW_FIELDS = {
  id: true,
  name: true,
  hash: true,
  clusterKey: true,
  descriptors: true,
  referenceImageUrl: true,
  status: true,
  licensable: true,
  registeredAt: true,
  duplicateOfId: true,
  duplicateDistance: true,
  adminNote: true,
  reviewedAt: true,
  craftItemId: true,
  submittedBy: { select: { name: true } },
} as const;

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const status = new URL(req.url).searchParams.get('status');
    const where = isMotifStatus(status) ? { status } : { status: { in: ['PENDING', 'FLAGGED_DUPLICATE'] } };

    const rows = await prisma.motifRegistration.findMany({
      where,
      orderBy: { registeredAt: 'desc' },
      take: 60,
      select: REVIEW_FIELDS,
    });

    // The other side of each flagged pair, so the reviewer sees both crops
    // rather than one record and an id.
    const counterpartIds = rows.map((row) => row.duplicateOfId).filter(Boolean) as string[];
    const counterparts = counterpartIds.length
      ? await prisma.motifRegistration.findMany({
          where: { id: { in: counterpartIds } },
          select: REVIEW_FIELDS,
        })
      : [];
    const byId = new Map(counterparts.map((row) => [row.id, row]));

    return NextResponse.json({
      success: true,
      reviews: rows.map((row) => ({
        ...toPublicMotif(row),
        duplicateDistance: row.duplicateDistance,
        adminNote: row.adminNote,
        craftItemId: row.craftItemId,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        counterpart: row.duplicateOfId && byId.has(row.duplicateOfId)
          ? toPublicMotif(byId.get(row.duplicateOfId)!)
          : null,
      })),
      openCount: await prisma.motifRegistration.count({
        where: { status: { in: ['PENDING', 'FLAGGED_DUPLICATE'] } },
      }),
    });
  } catch (error) {
    console.error('[admin/motif-review] list failed:', error);
    return fail(500, 'LIST_FAILED', 'Could not load motif reviews.');
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    const status = body.status;
    if (!id || !isMotifStatus(status) || status === 'PENDING') {
      return fail(400, 'BAD_REQUEST', 'Say which record, and whether it is registered or rejected.');
    }

    const note = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, MAX_NOTE) : '';

    const existing = await prisma.motifRegistration.findUnique({
      where: { id },
      select: { id: true, status: true, craftItemId: true, name: true, hash: true, clusterKey: true },
    });
    if (!existing) return fail(404, 'NOT_FOUND', 'That record no longer exists.');

    const next = status as MotifStatus;
    const row = await prisma.motifRegistration.update({
      where: { id },
      data: {
        status: next,
        adminNote: note || null,
        reviewedById: auth.adminId,
        reviewedAt: new Date(),
        // Confirming a record clears the flag it was raised under: the pair was
        // looked at and both may stand.
        ...(next === 'REGISTERED' ? { duplicateOfId: null, duplicateDistance: null } : {}),
      },
      select: REVIEW_FIELDS,
    });

    // On the piece's own timeline, when there is a piece.
    if (existing.craftItemId) {
      await logCraftItemEvent({
        prisma,
        craftItemId: existing.craftItemId,
        actorId: auth.adminId,
        actorRole: 'ADMIN',
        action: `MOTIF_${next}`,
        previousState: { motifStatus: existing.status },
        newState: { motifStatus: next, motifId: id, motifHash: existing.hash },
        comments:
          next === 'REGISTERED'
            ? 'Motif fingerprint confirmed as a timestamped Karigari registration. Not a Geographical Indication and not a legal right.'
            : `Motif registration rejected.${note ? ` ${note}` : ''}`,
      }).catch((error) => console.warn('[admin/motif-review] audit failed:', (error as Error)?.message));
    }

    return NextResponse.json({ success: true, motif: toPublicMotif(row) });
  } catch (error) {
    console.error('[admin/motif-review] decide failed:', error);
    return fail(500, 'REVIEW_FAILED', 'Could not record that review.');
  }
}
