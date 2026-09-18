import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { canMoveLicence } from '@/lib/motifLicence';
import { clusterKeyFor } from '@/lib/motifRecord';
import type { LicenceStatus } from '@/lib/motifHash';

/**
 * GET / PATCH /api/artisan/motif-licence — the cluster decides.
 *
 * Any artisan of the cluster may answer, not only the one who filed the record:
 * the motif belongs to the village, so the decision does too. Authorisation is
 * therefore "is this licence's motif in your cluster", checked against the
 * artisan's own resolved key rather than against the submitter's id.
 *
 * The transition is monotonic and guarded on the CURRENT status inside the
 * update predicate, so two artisans tapping accept and decline at the same
 * moment cannot both win — Postgres decides, and the loser is told the decision
 * was already made rather than silently overwriting it.
 *
 * A fee exists only because a human typed one. Nothing here suggests a figure.
 */
export const dynamic = 'force-dynamic';

const MAX_FEE = 10_00_000;
const MAX_NOTE = 300;

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status });
}

/** What the artisan's own screen shows. Enquirer contact IS included here — the
 *  cluster has to be able to answer the brand — and this route is artisan-only. */
const LICENCE_FIELDS = {
  id: true,
  licenseeName: true,
  licenseeContact: true,
  intendedUse: true,
  scope: true,
  feeAmount: true,
  decisionNote: true,
  status: true,
  payoutMode: true,
  paidAt: true,
  decidedAt: true,
  createdAt: true,
  motif: { select: { id: true, name: true, clusterKey: true, hash: true } },
} as const;

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const clusterKey = await clusterKeyFor(auth.artisan.userId);
    if (!clusterKey) return NextResponse.json({ success: true, licences: [], clusterKey: null });

    const rows = await prisma.motifLicence.findMany({
      where: { motif: { clusterKey } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: LICENCE_FIELDS,
    });

    return NextResponse.json({
      success: true,
      clusterKey,
      licences: rows.map((row) => ({
        ...row,
        paidAt: row.paidAt?.toISOString() ?? null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[artisan/motif-licence] list failed:', error);
    return fail(500, 'LIST_FAILED', 'Could not load your licensing enquiries.');
  }
}

export async function PATCH(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    const action = body.action === 'accept' ? 'accept' : body.action === 'decline' ? 'decline' : null;
    if (!id || !action) return fail(400, 'BAD_REQUEST', 'Say which enquiry, and whether you accept or decline.');

    const clusterKey = await clusterKeyFor(artisanId);
    if (!clusterKey) return fail(409, 'NO_CLUSTER', 'Add your village or SHG to your profile first.');

    const licence = await prisma.motifLicence.findUnique({
      where: { id },
      select: { id: true, status: true, motif: { select: { clusterKey: true } } },
    });
    // Same 404 for "not yours" and "not there": a stranger must not be able to
    // probe which licence ids exist.
    if (!licence || licence.motif.clusterKey !== clusterKey) {
      return fail(404, 'NOT_FOUND', 'That enquiry is not your cluster’s.');
    }

    const next: LicenceStatus = action === 'accept' ? 'ACCEPTED' : 'DECLINED';
    if (!canMoveLicence(licence.status as LicenceStatus, next)) {
      return fail(409, 'ALREADY_DECIDED', 'This enquiry has already been answered.');
    }

    let feeAmount: number | null = null;
    if (action === 'accept') {
      const raw = typeof body.feeAmount === 'number' ? body.feeAmount : Number(body.feeAmount);
      if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0 || raw > MAX_FEE) {
        return fail(400, 'BAD_FEE', 'Enter the fee your cluster is asking for, in whole rupees.');
      }
      feeAmount = raw;
    }

    const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '';

    // The guard is in the predicate, not in an earlier read: two artisans
    // answering at once cannot both succeed.
    const moved = await prisma.motifLicence.updateMany({
      where: { id, status: licence.status },
      data: {
        status: next,
        ...(feeAmount !== null ? { feeAmount } : {}),
        ...(note ? { decisionNote: note } : {}),
        decidedById: artisanId,
        decidedAt: new Date(),
      },
    });
    if (moved.count === 0) return fail(409, 'ALREADY_DECIDED', 'This enquiry has already been answered.');

    const row = await prisma.motifLicence.findUnique({ where: { id }, select: LICENCE_FIELDS });
    return NextResponse.json({
      success: true,
      licence: row && {
        ...row,
        paidAt: row.paidAt?.toISOString() ?? null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[artisan/motif-licence] decide failed:', error);
    return fail(500, 'DECIDE_FAILED', 'Could not record that decision.');
  }
}
