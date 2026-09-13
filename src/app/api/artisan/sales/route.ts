import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { ESCROW_HELD } from '@/lib/escrow';
import { settleEscrow } from '@/lib/escrowSettle';
import { QR_CLEARED_WHERE, SALE_SELECT, isQrCleared, toArtisanSale } from '@/lib/storefrontSale';

/**
 * The artisan's side of a storefront sale: pack it, then dispatch it.
 *
 * Before this existed a paid storefront piece had no next step anywhere in the
 * app. verify-payment told the artisan to "mark it dispatched from your Orders
 * page", but the piece never appeared there and no dispatch action existed — so
 * every sale stopped at quality check and its escrow was never released.
 *
 * Two actions, each with exactly one precondition beyond ownership:
 *
 *   pack      requires the piece to be paid for and QR-verified. The box is
 *             going to a buyer who paid for THIS piece, and the patch is what
 *             proves it is this piece.
 *   dispatch  requires it to be packed. Releases the 40% escrow advance to the
 *             artisan's own VPA in the same request.
 *
 * There is no "delivered" action here, and that is the point. Delivery releases
 * the final settlement, so it is confirmed by the buyer at
 * POST /api/buyer/sales/delivered. An artisan able to mark their own sale
 * delivered could pay themselves before the piece left the workshop.
 */
export const dynamic = 'force-dynamic';

const ACTIONS = ['pack', 'dispatch'] as const;
type Action = (typeof ACTIONS)[number];

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      craftItemId?: unknown;
      action?: unknown;
      courierName?: unknown;
      trackingRef?: unknown;
    };
    const craftItemId = typeof body.craftItemId === 'string' ? body.craftItemId : '';
    const action = (typeof body.action === 'string' ? body.action : '') as Action;

    if (!craftItemId) {
      return NextResponse.json({ error: 'craftItemId is required.' }, { status: 400 });
    }
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'action must be "pack" or "dispatch".' }, { status: 400 });
    }

    const sale = await prisma.craftItem.findUnique({
      where: { id: craftItemId },
      select: { ...SALE_SELECT, _count: { select: { artisanOrders: true } } },
    });
    if (!sale) {
      return NextResponse.json({ error: 'Sale not found.' }, { status: 404 });
    }
    // 404, not 403, for someone else's piece: whether a given id exists and has
    // sold is not this caller's business.
    if (sale.artisanId !== artisanId) {
      return NextResponse.json({ error: 'Sale not found.' }, { status: 404 });
    }
    if (!sale.paidAt) {
      return NextResponse.json({ error: 'This piece has not been paid for yet.' }, { status: 409 });
    }
    // A piece bound to a demand order is fulfilled through that order's own
    // ladder. Acting on it here too would give one piece two dispatch records.
    if (sale._count.artisanOrders > 0) {
      return NextResponse.json(
        { error: 'This piece belongs to a demand order. Pack and dispatch it from that order.' },
        { status: 409 }
      );
    }
    if (sale.deliveredAt) {
      return NextResponse.json({ error: 'The buyer has already received this piece.' }, { status: 409 });
    }

    const now = new Date();

    // ---- pack -----------------------------------------------------------------

    if (action === 'pack') {
      // Verified, or grandfathered onto the demo catalogue. Checkout accepts a
      // grandfathered piece, so packing must too — otherwise it could be sold
      // and then never shipped.
      if (!isQrCleared(sale)) {
        return NextResponse.json(
          { error: 'Verify the QR patch on this piece before packing it.' },
          { status: 409 }
        );
      }

      // The predicate is the guard: only an unpacked, paid, verified piece of
      // this artisan's matches, so a double click writes once.
      const packed = await prisma.craftItem.updateMany({
        where: { id: sale.id, artisanId, paidAt: { not: null }, packedAt: null, AND: [QR_CLEARED_WHERE] },
        data: { packedAt: now, stageUpdatedAt: now },
      });
      if (packed.count === 0) {
        return NextResponse.json({ success: true, idempotent: true, packedAt: sale.packedAt?.toISOString() });
      }

      await logCraftItemEvent({
        prisma,
        craftItemId: sale.id,
        actorId: artisanId,
        actorRole: 'ARTISAN',
        action: 'SALE_PACKED',
        previousState: { packedAt: null },
        newState: { packedAt: now.toISOString() },
        comments: 'Artisan packed a paid storefront sale. The piece was QR-verified before packing.',
      });

      return NextResponse.json({ success: true, packedAt: now.toISOString() });
    }

    // ---- dispatch -------------------------------------------------------------

    if (!sale.packedAt) {
      return NextResponse.json({ error: 'Pack the piece before dispatching it.' }, { status: 409 });
    }

    const courierName = text(body.courierName, 120);
    const trackingRef = text(body.trackingRef, 120);

    /**
     * Claim first, then settle.
     *
     * The conditional update is atomic, so two simultaneous Dispatch presses
     * cannot both proceed to release the advance: exactly one matches. If the
     * settlement then fails — a real RazorpayX payout refused, say — the claim is
     * undone, so the piece is not shown to the buyer as shipped while its money
     * is still held.
     */
    const claimed = await prisma.craftItem.updateMany({
      where: { id: sale.id, artisanId, packedAt: { not: null }, dispatchedAt: null },
      data: { dispatchedAt: now, courierName, trackingRef, stageUpdatedAt: now },
    });
    const claimedNow = claimed.count > 0;
    /** The dispatch time on record — this request's, or an interrupted earlier one's. */
    let dispatchedAt = now;

    if (!claimedNow) {
      // Already dispatched. Normally a no-op — but if a previous dispatch
      // recorded the timestamp and was interrupted before the advance released,
      // the piece would be stuck: shown as shipped, escrow still held, and the
      // buyer's delivery confirmation refused because the advance never moved.
      // Re-firing dispatch is how the artisan recovers from that, so fall
      // through to settle rather than returning.
      const current = await prisma.craftItem.findUnique({
        where: { id: sale.id },
        select: { escrowStatus: true, dispatchedAt: true },
      });
      if (current?.escrowStatus !== ESCROW_HELD) {
        return NextResponse.json({
          success: true,
          idempotent: true,
          dispatchedAt: current?.dispatchedAt?.toISOString() ?? null,
        });
      }
      if (current.dispatchedAt) dispatchedAt = current.dispatchedAt;
    }

    const settlement = await settleEscrow(sale.id, 'DISPATCH');

    if (!settlement.ok) {
      if (claimedNow) {
        // Undo only what THIS request wrote, and only if nothing has moved it
        // on since.
        await prisma.craftItem.updateMany({
          where: { id: sale.id, dispatchedAt: now },
          data: { dispatchedAt: null, courierName: null, trackingRef: null },
        });
      }
      return NextResponse.json(
        {
          error: `The piece was not marked dispatched because its advance could not be released: ${settlement.error}`,
          stage: settlement.stage,
        },
        { status: settlement.status }
      );
    }

    await logCraftItemEvent({
      prisma,
      craftItemId: sale.id,
      actorId: artisanId,
      actorRole: 'ARTISAN',
      action: 'SALE_DISPATCHED',
      previousState: { dispatchedAt: null },
      newState: {
        dispatchedAt: dispatchedAt.toISOString(),
        courierName,
        trackingRef,
        advance: settlement.paid,
        // True when this request finished an earlier dispatch whose advance had
        // not released, rather than dispatching for the first time.
        recoveredInterruptedDispatch: !claimedNow,
      },
      comments: settlement.payoutReal
        ? `Artisan dispatched a storefront sale. The 40% advance (₹${settlement.paid}) was released to their VPA via RazorpayX.`
        : `Artisan dispatched a storefront sale. The 40% advance (₹${settlement.paid}) was recorded as a programmatic settlement — RazorpayX is not enabled, so no bank credit was made.`,
    });

    const updated = await prisma.craftItem.findUnique({ where: { id: sale.id }, select: SALE_SELECT });

    return NextResponse.json({
      success: true,
      dispatchedAt: dispatchedAt.toISOString(),
      advance: {
        amount: settlement.paid,
        payoutReal: settlement.payoutReal,
        payoutRef: settlement.payoutRef,
      },
      sale: updated ? toArtisanSale(updated) : null,
    });
  } catch (error) {
    console.error('[artisan/sales] failed:', error);
    return NextResponse.json({ error: 'Could not update this sale.' }, { status: 500 });
  }
}
