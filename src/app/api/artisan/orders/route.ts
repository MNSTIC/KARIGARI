import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { buyerNotificationCopy, createBuyerNotification } from '@/lib/buyerNotify';
import { advanceDemandStatus, advanceOrderStatus, isUpdateOverdue } from '@/lib/orderStage';
import { advanceFor } from '@/lib/escrow';
import { formatRupees } from '@/lib/pricing';
import { ADVANCE_PENDING_MESSAGE, advancePaidOrWaived } from '@/lib/advanceGate';
import { SALE_SELECT, storefrontSalesWhere, toArtisanSale } from '@/lib/storefrontSale';

/**
 * The artisan Orders page endpoint.
 *
 *   GET  — four payloads at once:
 *          - the artisan's active `ArtisanOrder` records, with logs
 *          - their STOREFRONT sales: pieces bought outright from the
 *            marketplace. These have no `ArtisanOrder` (a demand is required
 *            for one), so before `sales` existed a marketplace purchase never
 *            appeared on this page at all — even though verify-payment told the
 *            artisan to dispatch it from here. Actions: POST /api/artisan/sales.
 *          - a stats bar (demands accepted, earned, review average)
 *          - open demands on the board that MATCH this artisan's craft and
 *            they have not accepted yet
 *
 *   POST — accept a demand (with or without a negotiated price)
 *
 * The API decides "matching demand" by a set of craft keywords — the demand
 * board's `craftType` is free text, so a fuzzy contains-any match is more
 * useful than an exact one. The list is capped so a busy board never floods.
 */
export const dynamic = 'force-dynamic';

const DEFAULT_DEADLINE_DAYS = 14;
const MAX_MATCHING_DEMANDS = 20;

/** Small, boring stopword set, mirroring /api/demand/track. */
const STOPWORDS = new Set([
  'and', 'the', 'with', 'for', 'set', 'of', 'pair', 'inch', 'piece', 'work',
]);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const artisanId = auth.artisan.userId;

    const [orders, profile, earnings, ratingStats, demandEarningsAgg, sales] = await Promise.all([
      prisma.artisanOrder.findMany({
        where: { artisanId },
        orderBy: { createdAt: 'desc' },
        include: {
          demand: {
            select: {
              id: true,
              craftType: true,
              quantity: true,
              targetPriceMin: true,
              targetPriceMax: true,
              location: true,
              festival: true,
              buyerName: true,
              referenceImageUrl: true,
              material: true,
              color: true,
              description: true,
              createdAt: true,
              // V9 structured capture — everything the artisan needs to judge
              // the job, on the card, before they commit to it.
              category: true,
              productType: true,
              sizeSpec: true,
              customizationRequired: true,
              customizationDetails: true,
              referenceImageUrls: true,
              requiredBy: true,
              deliveryMode: true,
              purchaseType: true,
              additionalRequirements: true,
              notes: true,
              flexBudget: true,
              flexColor: true,
              flexMaterial: true,
              flexDelivery: true,
              flexDesign: true,
            },
          },
          logs: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      }),
      prisma.artisanProfile.findUnique({
        where: { userId: artisanId },
        select: { craftType: true },
      }),
      // Real earnings from the escrow ledger — the same figures the earnings
      // page prints. Only advances and final payouts count; queued/simulated
      // rows are still money the artisan is owed and shown here.
      prisma.craftItem.aggregate({
        where: {
          artisanId,
          status: { in: ['ADVANCE_PAID', 'SOLD_FINAL', 'PAYOUT_COMPLETED'] },
        },
        _sum: { advancePaid: true, finalPayoutQueued: true, salePrice: true },
      }),
      prisma.review.aggregate({
        where: { craftItem: { artisanId } },
        _avg: { rating: true },
        _count: { id: true },
      }),
      // Demand-order credits — separate stream from the CraftItem escrow
      // ledger. Written by /api/buyer/orders/delivered when the buyer marks
      // the demand delivered. Always the on-screen agreed price, never the ₹10 demo charge.
      prisma.artisanOrder.aggregate({
        where: { artisanId, settledAt: { not: null } },
        _sum: { settledAmount: true },
      }),
      // Newest sale first — the one most likely to need packing today.
      prisma.craftItem.findMany({
        where: storefrontSalesWhere(artisanId),
        orderBy: { paidAt: 'desc' },
        // A workshop with more open sales than this has outgrown a demo page.
        take: 100,
        select: SALE_SELECT,
      }),
    ]);

    const alreadyAccepted = new Set(orders.map((order) => order.demandId));

    // Matching demands. Empty craftType (or no keywords) falls back to any
    // OPEN demand — better to see the board than nothing.
    const terms = keywords(profile?.craftType || '');
    const matchingDemands = await prisma.demand.findMany({
      where: {
        status: 'OPEN',
        NOT: alreadyAccepted.size > 0 ? { id: { in: [...alreadyAccepted] } } : undefined,
        ...(terms.length
          ? {
              OR: terms.map((term) => ({
                craftType: { contains: term, mode: 'insensitive' as const },
              })),
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_MATCHING_DEMANDS,
      select: {
        id: true,
        craftType: true,
        quantity: true,
        targetPriceMin: true,
        targetPriceMax: true,
        location: true,
        festival: true,
        buyerName: true,
        referenceImageUrl: true,
        material: true,
        color: true,
        description: true,
        createdAt: true,
        category: true,
        productType: true,
        sizeSpec: true,
        customizationRequired: true,
        customizationDetails: true,
        referenceImageUrls: true,
        requiredBy: true,
        deliveryMode: true,
        purchaseType: true,
        additionalRequirements: true,
        notes: true,
        flexBudget: true,
        flexColor: true,
        flexMaterial: true,
        flexDelivery: true,
        flexDesign: true,
      },
    });

    // Total earned pulls from the ledger. `_sum` fields are null when there are
    // no matching rows — coalesce so the tile never renders NaN.
    const escrowEarned =
      (earnings._sum.advancePaid ?? 0) + (earnings._sum.finalPayoutQueued ?? 0);
    // On-screen demand-order credits — the settled agreed price for demand
    // orders. Independent stream, so summed with escrow (never double-counted:
    // a demand order does NOT get a CraftItem escrow row).
    const demandEarned = demandEarningsAgg._sum.settledAmount ?? 0;
    const totalEarned = escrowEarned + demandEarned;

    return NextResponse.json({
      success: true,
      orders: orders.map((order) => ({
        id: order.id,
        status: order.status,
        negotiatedPrice: order.negotiatedPrice,
        deadline: order.deadline?.toISOString() ?? null,
        settledAmount: order.settledAmount ?? null,
        settledAt: order.settledAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
        // The finished-product photo. Returned before V9 by /api/buyer/orders
        // but silently dropped here, so the artisan's own page could never show
        // back what they had submitted.
        completedImageUrl: order.completedImageUrl,
        // ---- V9 lifecycle ----
        craftItemId: order.craftItemId,
        readyVerified: order.readyVerified,
        readyImageUrl: order.readyImageUrl,
        readyScanPatchId: order.readyScanPatchId,
        readySimilarityScore: order.readySimilarityScore,
        readyVerifiedAt: order.readyVerifiedAt?.toISOString() ?? null,
        packedAt: order.packedAt?.toISOString() ?? null,
        dispatchedAt: order.dispatchedAt?.toISOString() ?? null,
        courierName: order.courierName,
        trackingRef: order.trackingRef,
        lastLogAt: order.lastLogAt?.toISOString() ?? null,
        /** True when a live order has gone quiet — drives the nudge card. */
        updateOverdue: isUpdateOverdue(order),
        // ---- V10 advance ----
        advanceStatus: order.advanceStatus,
        /** The REAL 40%, not the demo charge. What the buyer is asked for. */
        advanceDueAmount: order.advanceDueAmount,
        advanceChargedPaise: order.advanceChargedPaise,
        advancePaidAt: order.advancePaidAt?.toISOString() ?? null,
        balanceDueAmount: order.balanceDueAmount,
        /** Production is blocked until the buyer pays, unless it was waived. */
        awaitingAdvance:
          order.advanceStatus !== 'ADVANCE_PAID' && order.advanceStatus !== 'ADVANCE_WAIVED',
        demand: {
          ...order.demand,
          createdAt: order.demand.createdAt.toISOString(),
          requiredBy: order.demand.requiredBy?.toISOString() ?? null,
        },
        logs: order.logs.map((log) => ({
          id: log.id,
          note: log.note,
          imageUrl: log.imageUrl,
          createdAt: log.createdAt.toISOString(),
        })),
      })),
      stats: {
        totalAccepted: orders.length,
        totalEarned,
        escrowEarned,
        demandEarned,
        avgRating: ratingStats._avg.rating,
        totalReviews: ratingStats._count.id,
      },
      sales: sales.map(toArtisanSale),
      matchingDemands: matchingDemands.map((demand) => ({
        ...demand,
        createdAt: demand.createdAt.toISOString(),
        requiredBy: demand.requiredBy?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error('Orders GET error:', error);
    return NextResponse.json({ error: 'Failed to load orders.' }, { status: 500 });
  }
}

/** Deadline hard-clamps (in days from acceptance). */
const MIN_DEADLINE_DAYS = 3;
const MAX_DEADLINE_DAYS = 90;

/**
 * Parse an ISO deadline from the client, clamped to a sane window.
 *
 * A deadline in the past or more than a season out is almost always a broken
 * client — silently coerce to the default (14 days) rather than reject the
 * whole acceptance for a bad date.
 */
function parseDeadline(value: unknown): Date {
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + DEFAULT_DEADLINE_DAYS);

  if (typeof value !== 'string' || !value) return fallback;
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) return fallback;

  const now = Date.now();
  const min = now + MIN_DEADLINE_DAYS * 86_400_000;
  const max = now + MAX_DEADLINE_DAYS * 86_400_000;
  if (candidate.getTime() < min) return new Date(min);
  if (candidate.getTime() > max) return new Date(max);
  return candidate;
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      demandId?: unknown;
      action?: unknown;
      negotiatedPrice?: unknown;
      deadline?: unknown;
    };
    const demandId = typeof body.demandId === 'string' ? body.demandId : '';
    const action = typeof body.action === 'string' ? body.action : '';
    const negotiatedPriceRaw = Number(body.negotiatedPrice);
    const negotiatedPrice =
      action === 'negotiate' && Number.isFinite(negotiatedPriceRaw) && negotiatedPriceRaw > 0
        ? Math.round(negotiatedPriceRaw)
        : null;

    if (!demandId) {
      return NextResponse.json({ error: 'demandId is required.' }, { status: 400 });
    }
    if (action !== 'accept' && action !== 'negotiate') {
      return NextResponse.json(
        { error: 'action must be "accept" or "negotiate".' },
        { status: 400 }
      );
    }
    if (action === 'negotiate' && negotiatedPrice === null) {
      return NextResponse.json(
        { error: 'negotiatedPrice must be a positive number when negotiating.' },
        { status: 400 }
      );
    }

    const demand = await prisma.demand.findUnique({
      where: { id: demandId },
      select: {
        id: true,
        status: true,
        quantity: true,
        craftType: true,
        buyerName: true,
        // Needed to work out the 40% advance when the artisan accepts at the
        // listed band rather than negotiating their own price.
        targetPriceMin: true,
        targetPriceMax: true,
      },
    });
    if (!demand) {
      return NextResponse.json({ error: 'Demand not found.' }, { status: 404 });
    }
    if (demand.status === 'FULFILLED' || demand.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'This demand is no longer open.' },
        { status: 409 }
      );
    }

    // Idempotent per (artisan, demand): a re-clicked Accept returns the
    // existing acceptance rather than creating a duplicate row.
    const existing = await prisma.artisanOrder.findFirst({
      where: { artisanId: auth.artisan.userId, demandId },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ success: true, orderId: existing.id, idempotent: true });
    }

    const deadline = parseDeadline(body.deadline);

    // The 40% advance the buyer owes before work starts.
    //
    // `advanceFor()` is the SAME helper the CraftItem escrow ladder uses, so the
    // demand advance and the storefront advance are one definition of "40%",
    // rounded the same way.
    //
    // The balance is `agreed - advance`, never `agreed * 0.6`. Subtraction is
    // correct by construction: the balance is whatever is left after the
    // advance, so it cannot drift however `advanceFor()` rounds, and it stays
    // right if ADVANCE_RATE ever becomes a figure that does not divide cleanly.
    // (`agreed * 0.6` happens to agree at the current 40/60 split — for an
    // integer price, 0.4x never lands exactly on a .5 boundary, so the two
    // roundings always complement. That is a coincidence of this rate, not a
    // property to build on.)
    const agreedPrice =
      negotiatedPrice ?? demand.targetPriceMax ?? demand.targetPriceMin ?? null;
    const hasPrice = typeof agreedPrice === 'number' && Number.isFinite(agreedPrice) && agreedPrice > 0;
    const advanceDueAmount = hasPrice ? advanceFor(agreedPrice) : null;
    const balanceDueAmount =
      hasPrice && advanceDueAmount !== null ? Math.round(agreedPrice - advanceDueAmount) : null;

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.artisanOrder.create({
        data: {
          artisanId: auth.artisan.userId,
          demandId,
          status: 'ACCEPTED',
          negotiatedPrice,
          deadline,
          // No resolvable price means no advance to ask for. WAIVED rather than
          // a zero-rupee advance: nothing was agreed, and persisting ₹0 as
          // though it were a figure would put a false number in front of both
          // sides and block production behind a payment that can never happen.
          advanceStatus: hasPrice ? 'ADVANCE_PENDING' : 'ADVANCE_WAIVED',
          advanceDueAmount,
          balanceDueAmount,
        },
        select: { id: true },
      });

      // Once any artisan has accepted, the demand is at least MATCHED. The
      // ladder helper is what keeps this monotonic now that the vocabulary has
      // an IN_PRODUCTION rung between MATCHED and FULFILLED.
      const nextStatus = advanceDemandStatus(demand.status, 'MATCHED');
      if (nextStatus !== demand.status) {
        await tx.demand.update({ where: { id: demandId }, data: { status: nextStatus } });
      }

      return created;
    });

    // The buyer has had no way of knowing an artisan took their request without
    // reloading the board and expanding the card. Best-effort, after the
    // transaction commits: an acceptance must not fail because an alert could
    // not be written. Deliberately NOT inside the idempotent branch above — a
    // re-clicked Accept must not send the buyer a second acceptance.
    const artisanName = auth.artisan.userId;
    const profile = await prisma.user.findUnique({
      where: { id: artisanName },
      select: { name: true },
    });
    const copy = buyerNotificationCopy.orderAccepted(
      profile?.name ?? 'An artisan',
      demand.quantity,
      demand.craftType,
      negotiatedPrice,
      deadline
    );
    await createBuyerNotification({
      buyerName: demand.buyerName,
      demandId,
      artisanOrderId: order.id,
      type: 'ORDER_ACCEPTED',
      // The acceptance copy names the advance when there is one, so the buyer
      // learns in a single alert both that someone took the job and that work
      // starts once they pay. Two notifications for one event would be noise.
      title: copy.title,
      message:
        advanceDueAmount !== null
          ? `${copy.message} A 40% advance of ${formatRupees(advanceDueAmount)} is due before work begins.`
          : copy.message,
    });

    return NextResponse.json({ success: true, orderId: order.id });
  } catch (error) {
    console.error('Orders POST error:', error);
    return NextResponse.json({ error: 'Failed to accept demand.' }, { status: 500 });
  }
}

/**
 * Lifecycle transitions on an existing ArtisanOrder.
 *
 *   PATCH { orderId, action: "pack" }
 *   PATCH { orderId, action: "dispatch", courierName?, trackingRef? }
 *   PATCH { orderId, action: "complete", completedImageUrl }
 *
 * Each step requires the one before it, enforced inside the `updateMany`
 * predicate rather than by a read-then-write, so two overlapping clicks cannot
 * both apply the same transition.
 *
 * "complete" is the survivor of the pre-V9 flow, and it is no longer a way to
 * skip anything: it now demands `readyVerified`, so the unverified path that
 * accepted any 2 MB image and called the job done is closed. The photo is still
 * required, because a completion claim without one is what caused the buyer
 * trust problem this flow exists to fix.
 *
 * Only the acting artisan can move their own orders; ownership is part of every
 * predicate below.
 */
const MAX_COMPLETED_IMAGE_BYTES = 2 * 1024 * 1024;

function base64Bytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((payload.length * 3) / 4);
}

const PATCH_ACTIONS = ['pack', 'dispatch', 'complete'];

export async function PATCH(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      orderId?: unknown;
      action?: unknown;
      completedImageUrl?: unknown;
      courierName?: unknown;
      trackingRef?: unknown;
    };
    const orderId = typeof body.orderId === 'string' ? body.orderId : '';
    const action = typeof body.action === 'string' ? body.action : '';

    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required.' }, { status: 400 });
    }
    if (!PATCH_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
    }

    // Read once, for the ownership message, the buyer's name and the status the
    // ladder helper needs. The authoritative guard is still the predicate.
    const order = await prisma.artisanOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        artisanId: true,
        status: true,
        readyVerified: true,
        packedAt: true,
        dispatchedAt: true,
        advanceStatus: true,
        demandId: true,
        demand: { select: { buyerName: true } },
        artisan: { select: { name: true } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    if (order.artisanId !== auth.artisan.userId) {
      return NextResponse.json({ error: 'This order is not yours.' }, { status: 403 });
    }

    // The production gate. Packing and dispatching are work done against money
    // the buyer has not yet paid, so both wait for the advance.
    //
    // `complete` is deliberately NOT gated: an order that somehow reached
    // DISPATCHED must stay closable, and blocking the final step would strand
    // rows without protecting anyone.
    if (
      (action === 'pack' || action === 'dispatch') &&
      !advancePaidOrWaived(order.advanceStatus)
    ) {
      return NextResponse.json({ error: ADVANCE_PENDING_MESSAGE }, { status: 409 });
    }

    const now = new Date();
    const notifyBuyer = async (
      type: 'ORDER_PACKED' | 'ORDER_DISPATCHED',
      copy: { title: string; message: string }
    ) =>
      createBuyerNotification({
        buyerName: order.demand.buyerName,
        demandId: order.demandId,
        artisanOrderId: order.id,
        type,
        ...copy,
      });

    if (action === 'pack') {
      // `packedAt: null` makes this idempotent; `readyVerified: true` is what
      // stops an artisan telling a buyer a piece is boxed before it has been
      // proved to be the piece that was promised.
      const result = await prisma.artisanOrder.updateMany({
        where: { id: orderId, artisanId: auth.artisan.userId, readyVerified: true, packedAt: null },
        data: { packedAt: now, status: advanceOrderStatus(order.status, 'PACKED') },
      });
      if (result.count === 0) {
        return NextResponse.json(
          {
            error: order.readyVerified
              ? 'This order is already packed.'
              : 'Verify the finished piece before packing it.',
          },
          { status: 409 }
        );
      }
      await notifyBuyer('ORDER_PACKED', buyerNotificationCopy.orderPacked(order.artisan.name));
      return NextResponse.json({ success: true, packedAt: now.toISOString() });
    }

    if (action === 'dispatch') {
      const courierName =
        typeof body.courierName === 'string' && body.courierName.trim()
          ? body.courierName.trim().slice(0, 120)
          : null;
      const trackingRef =
        typeof body.trackingRef === 'string' && body.trackingRef.trim()
          ? body.trackingRef.trim().slice(0, 120)
          : null;

      const result = await prisma.artisanOrder.updateMany({
        where: {
          id: orderId,
          artisanId: auth.artisan.userId,
          packedAt: { not: null },
          dispatchedAt: null,
        },
        data: {
          dispatchedAt: now,
          courierName,
          trackingRef,
          status: advanceOrderStatus(order.status, 'DISPATCHED'),
        },
      });
      if (result.count === 0) {
        return NextResponse.json(
          {
            error: order.packedAt
              ? 'This order is already dispatched.'
              : 'Pack the order before dispatching it.',
          },
          { status: 409 }
        );
      }
      await notifyBuyer(
        'ORDER_DISPATCHED',
        buyerNotificationCopy.orderDispatched(order.artisan.name, courierName, trackingRef)
      );
      return NextResponse.json({ success: true, dispatchedAt: now.toISOString() });
    }

    // ---- complete ----
    const completedImageUrl =
      typeof body.completedImageUrl === 'string' ? body.completedImageUrl.trim() : '';
    if (!completedImageUrl) {
      return NextResponse.json(
        { error: 'A photo of the finished product is required.' },
        { status: 400 }
      );
    }
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(completedImageUrl)) {
      return NextResponse.json({ error: 'Photo must be an image.' }, { status: 400 });
    }
    if (base64Bytes(completedImageUrl) > MAX_COMPLETED_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Photo is larger than 2 MB.' }, { status: 400 });
    }

    // `readyVerified: true` is the gate that closes the old unverified path.
    // The status window is deliberately narrow: closing a job that has not been
    // dispatched, or that the buyer has already closed, is not a thing to do.
    const result = await prisma.artisanOrder.updateMany({
      where: {
        id: orderId,
        artisanId: auth.artisan.userId,
        readyVerified: true,
        status: { in: ['DISPATCHED', 'DELIVERED'] },
      },
      data: {
        status: advanceOrderStatus(order.status, 'COMPLETED'),
        completedImageUrl,
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        {
          error: order.readyVerified
            ? 'Dispatch the order before marking it complete.'
            : 'Verify the finished piece before marking this order complete.',
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Orders PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update order.' }, { status: 500 });
  }
}
