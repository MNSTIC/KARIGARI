import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  DEMO_ADVANCE_PAISE,
  RAZORPAY_CONFIGURED,
  RAZORPAY_KEY_ID,
  getRazorpay,
} from '@/lib/razorpay';

/**
 * The buyer's 40% advance on a demand order — step 1 of 2: open the order.
 *
 * Public, like every other buyer route here: buyers have no account in this app,
 * so the identity is the free-text `buyerName` matched case-insensitively
 * against `Demand.buyerName` — the same pattern `/api/buyer/orders/delivered`
 * already uses, and the thing that stops one buyer paying another's advance.
 *
 * DEMO CHARGE. The Razorpay order is for `DEMO_ADVANCE_PAISE` (₹4), not the real
 * 40%. The real figure travels in the order notes and is what both sides are
 * shown; `advanceChargedPaise` records what was actually taken. The two are kept
 * in different columns on purpose — see src/lib/razorpay.ts.
 *
 * This route does NOT mark anything paid. It hands the browser an order id; the
 * advance is only recorded once `/demand-advance/verify` has checked the HMAC.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const artisanOrderId = typeof body?.artisanOrderId === 'string' ? body.artisanOrderId.trim() : '';
    const buyerName = typeof body?.buyerName === 'string' ? body.buyerName.trim() : '';

    if (!artisanOrderId || !buyerName) {
      return NextResponse.json(
        { error: 'artisanOrderId and buyerName are required.' },
        { status: 400 }
      );
    }

    if (!RAZORPAY_CONFIGURED) {
      return NextResponse.json(
        {
          error:
            'Razorpay checkout is not configured on this deployment. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable it.',
        },
        { status: 503 }
      );
    }

    const order = await prisma.artisanOrder.findUnique({
      where: { id: artisanOrderId },
      select: {
        id: true,
        advanceStatus: true,
        advanceDueAmount: true,
        advancePaidAt: true,
        demandId: true,
        demand: { select: { buyerName: true, craftType: true } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }

    // Ownership. Case-insensitive because the name is typed by hand each visit.
    if ((order.demand.buyerName || '').toLowerCase() !== buyerName.toLowerCase()) {
      return NextResponse.json(
        { error: 'This order was placed under a different buyer name.' },
        { status: 403 }
      );
    }

    // Already settled — say so rather than opening a second gateway order that
    // would take another ₹4 for nothing.
    if (order.advanceStatus === 'ADVANCE_PAID' || order.advancePaidAt) {
      return NextResponse.json({ success: true, alreadyPaid: true });
    }
    if (order.advanceStatus === 'ADVANCE_WAIVED') {
      return NextResponse.json(
        { error: 'This order has no advance to pay.' },
        { status: 409 }
      );
    }
    if (order.advanceStatus !== 'ADVANCE_PENDING' && order.advanceStatus !== 'ADVANCE_INITIATED') {
      return NextResponse.json({ error: 'This advance cannot be paid now.' }, { status: 409 });
    }
    if (!order.advanceDueAmount || order.advanceDueAmount <= 0) {
      // ADVANCE_PENDING with no amount should be impossible — acceptance sets
      // WAIVED when no price resolves — but a row that reached it anyway must
      // not be charged for an amount nobody agreed.
      return NextResponse.json(
        { error: 'This order has no advance amount recorded.' },
        { status: 409 }
      );
    }

    let rzpOrder;
    try {
      rzpOrder = await getRazorpay().orders.create({
        // ₹4, deliberately. The REAL 40% rides along in the notes so the
        // Razorpay dashboard shows what the advance actually is.
        amount: DEMO_ADVANCE_PAISE,
        currency: 'INR',
        receipt: `adv_${order.id.slice(0, 30)}`,
        notes: {
          stage: 'DEMAND_ADVANCE_40',
          artisanOrderId: order.id,
          demandId: order.demandId,
          craftType: order.demand.craftType,
          displayAdvance: String(order.advanceDueAmount),
        },
      });
    } catch (gatewayError) {
      console.error('[demand-advance/create-order] Razorpay refused the order:', gatewayError);
      return NextResponse.json(
        { error: 'The payment gateway could not open this order. Please try again.' },
        { status: 502 }
      );
    }

    // Guarded so a second click cannot overwrite an order id that a payment is
    // already in flight against — the predicate keeps this to the two states in
    // which opening a new gateway order is legitimate.
    await prisma.artisanOrder.updateMany({
      where: {
        id: order.id,
        advancePaidAt: null,
        advanceStatus: { in: ['ADVANCE_PENDING', 'ADVANCE_INITIATED'] },
      },
      data: { advanceRazorpayOrderId: rzpOrder.id, advanceStatus: 'ADVANCE_INITIATED' },
    });

    return NextResponse.json({
      success: true,
      orderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      // The PUBLIC key id. The secret never leaves src/lib/razorpay.ts.
      keyId: RAZORPAY_KEY_ID,
      /** The REAL 40%, for the UI. Never the charged amount. */
      displayAdvance: order.advanceDueAmount,
    });
  } catch (error) {
    console.error('[demand-advance/create-order] failed:', error);
    return NextResponse.json({ error: 'Could not start the advance payment.' }, { status: 500 });
  }
}
