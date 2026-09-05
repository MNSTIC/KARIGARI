import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { HEALTH_PENALTY_GUILTY, healthAfterGuilty } from '@/lib/artisanHealth';

/**
 * An admin's verdict on one buyer ticket.
 *
 *   GUILTY     — the artisan shipped something other than what they captured.
 *                Costs HEALTH_PENALTY_GUILTY health points and marks the item
 *                so the buyer's card can show the refund banner.
 *   NOT_GUILTY — the report is discarded, optionally with a note back to the
 *                buyer. The artisan's score is untouched.
 *
 * Idempotent by construction: the status transition is an `updateMany` guarded
 * on `status: 'OPEN'`, so a double-clicked "Submit verdict" applies the penalty
 * exactly once — the second call matches zero rows and short-circuits before
 * any score is moved.
 */
export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

/** Marks the piece for the buyer-facing refund banner. Escrow is out of scope. */
const REFUND_STATUS = 'FLAGGED_REFUND_INITIATED';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

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

    const body = (await req.json().catch(() => ({}))) as {
      verdict?: unknown;
      note?: unknown;
    };
    const verdict = typeof body.verdict === 'string' ? body.verdict : '';
    const note =
      typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null;

    if (verdict !== 'GUILTY' && verdict !== 'NOT_GUILTY') {
      return NextResponse.json(
        { error: 'verdict must be "GUILTY" or "NOT_GUILTY".' },
        { status: 400 }
      );
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        craftItemId: true,
        buyerName: true,
        craftItem: { select: { id: true, artisanId: true, status: true } },
      },
    });
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }
    if (ticket.status !== 'OPEN') {
      return NextResponse.json(
        { error: 'This ticket has already been resolved.' },
        { status: 409 }
      );
    }

    const nextStatus = verdict === 'GUILTY' ? 'RESOLVED_GUILTY' : 'RESOLVED_NOT_GUILTY';
    const resolvedAt = new Date();

    const applied = await prisma.$transaction(async (tx) => {
      // The concurrency guard. Only the request that actually flips OPEN → resolved
      // is allowed to move the health score.
      const claim = await tx.ticket.updateMany({
        where: { id: ticket.id, status: 'OPEN' },
        data: {
          status: nextStatus,
          adminNote: verdict === 'NOT_GUILTY' ? note : null,
          resolvedByAdminId: decoded.userId,
          resolvedAt,
        },
      });
      if (claim.count === 0) return false;

      if (verdict === 'GUILTY') {
        // Read-modify-write through the shared bounded helper, so an artisan at
        // 5 floors to 0 rather than going negative.
        const profile = await tx.artisanProfile.findUnique({
          where: { userId: ticket.craftItem.artisanId },
          select: { healthScore: true },
        });
        if (profile) {
          await tx.artisanProfile.update({
            where: { userId: ticket.craftItem.artisanId },
            data: { healthScore: healthAfterGuilty(profile.healthScore) },
          });
        }

        await tx.craftItem.update({
          where: { id: ticket.craftItemId },
          data: { status: REFUND_STATUS },
        });

        await logCraftItemEvent({
          prisma: tx,
          craftItemId: ticket.craftItemId,
          actorId: decoded.userId,
          actorRole: 'ADMIN',
          action: 'TICKET_RESOLVED_GUILTY',
          previousState: { status: ticket.craftItem.status },
          newState: { status: REFUND_STATUS },
          comments: `Ticket ${ticket.id} upheld. Artisan health reduced by ${HEALTH_PENALTY_GUILTY}. Refund flagged for buyer "${ticket.buyerName}".`,
        });
      } else {
        await logCraftItemEvent({
          prisma: tx,
          craftItemId: ticket.craftItemId,
          actorId: decoded.userId,
          actorRole: 'ADMIN',
          action: 'TICKET_RESOLVED_NOT_GUILTY',
          comments: `Ticket ${ticket.id} discarded.${note ? ` Note to buyer: ${note}` : ''}`,
        });
      }

      return true;
    });

    if (!applied) {
      return NextResponse.json(
        { error: 'This ticket has already been resolved.' },
        { status: 409 }
      );
    }

    const updated = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: {
        id: true,
        status: true,
        adminNote: true,
        resolvedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      ticket: updated
        ? { ...updated, resolvedAt: updated.resolvedAt?.toISOString() ?? null }
        : null,
    });
  } catch (error) {
    console.error('Admin ticket resolve error:', error);
    return NextResponse.json({ error: 'Failed to record the verdict.' }, { status: 500 });
  }
}
