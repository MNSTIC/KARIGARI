import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { notifyArtisansForDemand } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/**
 * Public demand board.
 *
 * Buyers have no account or role in KARIGARI yet — the buyer view at /buyer is
 * an unauthenticated storefront — so this route is deliberately open and a
 * demand carries a free-text `buyerName` instead of a user id. Anything that
 * touches artisan money still sits behind the artisan/admin JWT routes.
 */

const MAX_QUANTITY = 100_000;
const MAX_PRICE = 10_000_000;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function trimmed(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const craftType = searchParams.get('craftType');
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

    const demands = await prisma.demand.findMany({
      where: {
        // Default view is the live board; `status=ALL` shows history too.
        ...(status === 'ALL' ? {} : { status: status || 'OPEN' }),
        ...(craftType ? { craftType: { contains: craftType, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ success: true, demands });
  } catch (error) {
    console.error('Demand GET error:', error);
    return NextResponse.json({ error: 'Failed to load demands' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const craftType = trimmed(body?.craftType, 120);
    const quantity = toNumber(body?.quantity);

    if (!craftType) {
      return NextResponse.json({ error: 'Craft type is required.' }, { status: 400 });
    }
    if (!quantity || quantity <= 0 || quantity > MAX_QUANTITY) {
      return NextResponse.json(
        { error: `Quantity must be a number between 1 and ${MAX_QUANTITY.toLocaleString('en-IN')}.` },
        { status: 400 }
      );
    }

    const targetPriceMin = toNumber(body?.targetPriceMin);
    const targetPriceMax = toNumber(body?.targetPriceMax);

    for (const price of [targetPriceMin, targetPriceMax]) {
      if (price !== null && (price < 0 || price > MAX_PRICE)) {
        return NextResponse.json({ error: 'Target price is out of range.' }, { status: 400 });
      }
    }
    if (targetPriceMin !== null && targetPriceMax !== null && targetPriceMin > targetPriceMax) {
      return NextResponse.json(
        { error: 'Minimum target price cannot be above the maximum.' },
        { status: 400 }
      );
    }

    const demand = await prisma.demand.create({
      data: {
        craftType,
        quantity: Math.round(quantity),
        targetPriceMin,
        targetPriceMax,
        location: trimmed(body?.location, 120),
        festival: trimmed(body?.festival, 80),
        buyerName: trimmed(body?.buyerName, 120),
        notes: trimmed(body?.notes, 1000),
        status: 'OPEN',
      },
    });

    // The whole point of the board: a posted demand reaches the artisans who
    // can actually fill it. Failing to notify must not fail the post itself.
    let notified = 0;
    let smsSent = 0;
    try {
      const fanout = await notifyArtisansForDemand(demand);
      notified = fanout.created;
      smsSent = fanout.smsSent;
    } catch (notifyError) {
      console.error('Demand notification fan-out failed:', notifyError);
    }

    return NextResponse.json({ success: true, demand, notified, smsSent });
  } catch (error) {
    console.error('Demand POST error:', error);
    return NextResponse.json({ error: 'Failed to post demand' }, { status: 500 });
  }
}
