import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { getListingPrice } from '@/lib/pricing';
import { ESCROW_HELD, advanceFor, finalSettlementFor } from '@/lib/escrow';

/**
 * Direct-to-artisan checkout.
 *
 * Public by design: the caller is a consumer on the storefront, not a logged-in
 * user of this app. The session is created in Stripe TEST mode — no live charge
 * is ever made — and the artisan's own VPA is snapshotted onto the row as the
 * payout destination before a single rupee moves.
 *
 * No admin or facilitator participates. Nothing here queues an approval; the
 * two tranches are released later by `/api/payments/settle-escrow`, which is
 * triggered by dispatch and delivery events.
 */
export const dynamic = 'force-dynamic';

function baseUrl(req: Request): string {
  const configured = (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    ''
  ).trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const craftItemId = typeof body?.craftItemId === 'string' ? body.craftItemId : null;
    if (!craftItemId) {
      return NextResponse.json({ error: 'craftItemId is required.' }, { status: 400 });
    }

    const secretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secretKey) {
      // Say so plainly rather than letting Stripe return an auth error the
      // buyer cannot act on. The rest of the storefront still works.
      return NextResponse.json(
        {
          error:
            'Stripe test checkout is not configured on this deployment. Set STRIPE_SECRET_KEY (sk_test_...) to enable it.',
        },
        { status: 503 }
      );
    }

    const item = await prisma.craftItem.findUnique({
      where: { id: craftItemId },
      select: {
        id: true,
        artisanId: true,
        craftType: true,
        images: true,
        askingPrice: true,
        salePrice: true,
        standardMarketPrice: true,
        fairWageFloor: true,
        artisan: {
          select: {
            name: true,
            artisanProfile: { select: { upiId: true } },
          },
        },
      },
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const price = item.salePrice ?? getListingPrice(item);
    if (price === null || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json(
        { error: 'This item has no price yet, so it cannot be bought.' },
        { status: 409 }
      );
    }

    const artisanUpi = item.artisan.artisanProfile?.upiId ?? '';

    const stripe = new Stripe(secretKey);

    const base = baseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'inr',
            unit_amount: Math.round(price * 100),
            product_data: {
              name: item.craftType,
              description: `Handcrafted by ${item.artisan.name}. Escrow-protected: 40% fair-wage advance released to the artisan on dispatch.`,
            },
          },
        },
      ],
      metadata: {
        craftItemId: item.id,
        artisanId: item.artisanId,
        artisanUpi,
        askingPrice: String(price),
      },
      success_url: `${base}/marketplace?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/marketplace/product/${item.id}?payment=cancelled`,
    });

    const advanceAmount = advanceFor(price);
    const finalSettlementAmount = finalSettlementFor(price);

    await prisma.craftItem.update({
      where: { id: item.id },
      data: {
        stripeSessionId: session.id,
        escrowStatus: ESCROW_HELD,
        artisanUpiDestination: artisanUpi || null,
        advanceAmount,
        finalSettlementAmount,
      },
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: 'STRIPE_CHECKOUT',
      actorRole: 'SYSTEM',
      action: 'ESCROW_HELD',
      newState: { sessionId: session.id, price },
      comments:
        'Buyer opened a Stripe TEST checkout session. Funds are held in escrow; the artisan VPA on file is locked in as the payout destination. No admin can release or redirect this.',
    });

    return NextResponse.json({ success: true, url: session.url });
  } catch (error) {
    console.error('Create checkout error:', error);
    return NextResponse.json({ error: 'Failed to start checkout' }, { status: 500 });
  }
}
