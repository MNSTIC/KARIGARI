import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { RAZORPAYX_ENABLED, payoutToVpa } from '@/lib/razorpayPayout';
import { payoutRefusal, splitFee } from '@/lib/motifLicence';
import { licencePaidTitle, notifyCluster, payableArtisanIds } from '@/lib/motifRecord';
import type { LicenceStatus } from '@/lib/motifHash';

/**
 * POST /api/admin/motif-licence-payout — split an agreed fee across the cluster.
 *
 * Three rules, all of them about not lying with money:
 *
 *   1. **Nothing is paid that a human did not agree.** The licence must be
 *      ACCEPTED with a `feeAmount` somebody typed; `payoutRefusal` names the
 *      reason otherwise.
 *   2. **No rupee rounds away.** `splitFee` distributes the remainder one rupee
 *      at a time to the earliest registrants and throws if the shares do not sum
 *      to exactly the fee — so a bad split fails before anything is written
 *      rather than after.
 *   3. **A recorded payout is never described as a bank transfer.** RazorpayX is
 *      not configured on this deployment, so `payoutToVpa` returns SIMULATED and
 *      that word rides on every share row and every screen. This is the same
 *      convention the escrow settlement already uses.
 *
 * The whole distribution is one transaction guarded on `paidAt: null`, so a
 * second click is a no-op rather than a second split.
 */
export const dynamic = 'force-dynamic';

const REFUSAL_MESSAGE: Record<string, string> = {
  ALREADY_PAID: 'This licence has already been paid out.',
  NOT_ACCEPTED: 'The cluster has not accepted this enquiry yet.',
  NO_FEE: 'No fee has been agreed for this licence.',
};

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status });
}

async function requireAdmin(): Promise<{ ok: true; adminId: string } | { ok: false; response: NextResponse }> {
  const token = (await cookies()).get('auth-token');
  if (!token) return { ok: false, response: fail(401, 'UNAUTHORIZED', 'Sign in first.') };
  try {
    const decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as {
      userId: string;
      role: string;
    };
    if (decoded.role !== 'ADMIN') return { ok: false, response: fail(403, 'FORBIDDEN', 'Admin access required.') };
    return { ok: true, adminId: decoded.userId };
  } catch {
    return { ok: false, response: fail(401, 'BAD_TOKEN', 'Your session is no longer valid.') };
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const licenceId = typeof body.licenceId === 'string' ? body.licenceId : '';
    if (!licenceId) return fail(400, 'BAD_REQUEST', 'Say which licence to pay out.');

    const licence = await prisma.motifLicence.findUnique({
      where: { id: licenceId },
      select: {
        id: true,
        status: true,
        feeAmount: true,
        paidAt: true,
        motif: { select: { id: true, name: true, clusterKey: true } },
      },
    });
    if (!licence) return fail(404, 'NOT_FOUND', 'That licence no longer exists.');

    const refusal = payoutRefusal({
      status: licence.status as LicenceStatus,
      feeAmount: licence.feeAmount,
      paidAt: licence.paidAt,
    });
    if (refusal) return fail(409, refusal, REFUSAL_MESSAGE[refusal]);

    const artisanIds = await payableArtisanIds(licence.motif.clusterKey);
    if (artisanIds.length === 0) {
      return fail(409, 'NO_REGISTERED_ARTISAN', 'No confirmed motif registration in this cluster to pay.');
    }

    // Throws before anything is written if the arithmetic would not add up.
    const shares = splitFee(licence.feeAmount as number, artisanIds);

    // Each artisan's own VPA, read from the database and never from a body.
    const profiles = await prisma.artisanProfile.findMany({
      where: { userId: { in: artisanIds } },
      select: { userId: true, upiId: true },
    });
    const vpaFor = new Map(profiles.map((row) => [row.userId, row.upiId ?? '']));
    const names = await prisma.user.findMany({
      where: { id: { in: artisanIds } },
      select: { id: true, name: true },
    });
    const nameFor = new Map(names.map((row) => [row.id, row.name]));

    // Payouts first, outside the transaction: a network call inside one would
    // hold a database lock open for the length of an HTTP round trip. On this
    // deployment every one of these returns SIMULATED without leaving the
    // process.
    const settled: { artisanId: string; amount: number; mode: string; reference: string }[] = [];
    for (const share of shares) {
      const result = await payoutToVpa({
        amount: share.amount,
        vpa: vpaFor.get(share.artisanId) || 'unconfigured@upi',
        referenceId: `${licence.id}-${share.artisanId}`,
        contactName: nameFor.get(share.artisanId) ?? 'Artisan',
        notes: { motif: licence.motif.name, cluster: licence.motif.clusterKey },
      });
      settled.push({
        artisanId: share.artisanId,
        amount: share.amount,
        mode: result.mode,
        reference: result.reference,
      });
    }

    const mode = settled.every((row) => row.mode === 'RAZORPAYX') ? 'RAZORPAYX' : 'SIMULATED';
    const now = new Date();

    const written = await prisma.$transaction(async (tx) => {
      // The guard is the predicate: a second click finds `paidAt` already set
      // and writes nothing.
      const claimed = await tx.motifLicence.updateMany({
        where: { id: licence.id, paidAt: null, status: 'ACCEPTED' },
        data: { status: 'PAID', paidAt: now, payoutMode: mode, payoutRef: `MOTIF_${licence.id}` },
      });
      if (claimed.count === 0) return 0;

      await tx.motifPayoutShare.createMany({
        data: settled.map((row) => ({
          licenceId: licence.id,
          artisanId: row.artisanId,
          amount: row.amount,
          payoutMode: row.mode,
          payoutRef: row.reference,
        })),
      });
      return claimed.count;
    });

    if (written === 0) return fail(409, 'ALREADY_PAID', REFUSAL_MESSAGE.ALREADY_PAID);

    const total = settled.reduce((sum, row) => sum + row.amount, 0);
    await notifyCluster(
      artisanIds,
      licencePaidTitle(licence.motif.name),
      mode === 'RAZORPAYX'
        ? `A licence fee for this motif was split across the cluster and sent to your UPI.`
        : `A licence fee for this motif was split across the cluster and recorded to your ledger. Karigari has not moved this money — the payout rail is not live on this deployment.`
    ).catch((error) => console.warn('[motif payout] notify failed:', (error as Error)?.message));

    return NextResponse.json({
      success: true,
      licenceId: licence.id,
      payoutMode: mode,
      razorpayxConfigured: RAZORPAYX_ENABLED,
      total,
      shares: settled,
    });
  } catch (error) {
    console.error('[admin/motif-licence-payout] failed:', error);
    return fail(500, 'PAYOUT_FAILED', (error as Error)?.message || 'Could not split that fee.');
  }
}
