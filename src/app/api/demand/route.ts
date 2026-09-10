import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { notifyArtisansForDemand } from '@/lib/notifications';
import { buyerNotificationCopy, createBuyerNotification } from '@/lib/buyerNotify';

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

/**
 * Reference photos are data URLs, the same as every other image in this schema
 * — there is no upload bucket to point at. A rejected image is never fatal: the
 * demand still posts without one, because losing a buyer's whole request over a
 * bad file would be the worse outcome.
 */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** How many reference photos one demand may carry. Mirrored by the client. */
const MAX_REFERENCE_IMAGES = 4;

function referenceImage(value: unknown): { url: string | null; error: string | null } {
  if (typeof value !== 'string' || value.trim() === '') return { url: null, error: null };
  const url = value.trim();
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url)) {
    return { url: null, error: 'The reference photo must be an image.' };
  }
  // base64 is 4 characters per 3 bytes; measuring the payload avoids decoding it.
  const payload = url.slice(url.indexOf(',') + 1);
  const bytes = Math.floor((payload.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    return { url: null, error: 'The reference photo is larger than 2 MB.' };
  }
  return { url, error: null };
}

/**
 * Validate the reference gallery.
 *
 * Each image is judged on its own and a bad one is dropped, never fatal — the
 * same rule the single-image field has always followed, and for the same
 * reason: losing a buyer's whole request over one oversized photo is the worse
 * outcome. Rejections come back in the response so the buyer is told which
 * ones did not make it rather than silently seeing three of their four.
 */
function referenceImages(value: unknown): { urls: string[]; rejected: string[] } {
  if (!Array.isArray(value)) return { urls: [], rejected: [] };

  const urls: string[] = [];
  const rejected: string[] = [];
  // Bounded before the loop: a caller posting two hundred images should not get
  // two hundred base64 payloads measured before being told the cap is four.
  for (const [index, candidate] of value.slice(0, MAX_REFERENCE_IMAGES).entries()) {
    const checked = referenceImage(candidate);
    if (checked.url) urls.push(checked.url);
    else if (checked.error) rejected.push(`Photo ${index + 1}: ${checked.error}`);
  }
  if (value.length > MAX_REFERENCE_IMAGES) {
    rejected.push(`Only the first ${MAX_REFERENCE_IMAGES} photos were kept.`);
  }
  return { urls, rejected };
}

/**
 * Coerce a value to one of an allow-list, falling back to the default.
 *
 * Never 500s and never 400s on an unknown value: these fields arrive from
 * selects and radio groups, so a value outside the list means a stale client or
 * a hand-crafted request, and neither is worth failing a buyer's demand over.
 * The fallback is always the STRICTER reading, so a broken client can never
 * quietly widen what an artisan is allowed to substitute.
 */
function oneOf(value: unknown, allowed: readonly string[], fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const upper = value.trim().toUpperCase();
  return allowed.includes(upper) ? upper : fallback;
}

const DELIVERY_MODES = ['DELIVERY', 'PICKUP'] as const;
const PURCHASE_TYPES = ['INDIVIDUAL', 'BULK', 'WHOLESALE'] as const;
const FLEX_LEVELS = ['STRICT', 'FLEXIBLE'] as const;
const DESIGN_LEVELS = ['EXACT', 'SIMILAR'] as const;

/**
 * A required-by date the artisan could actually meet.
 *
 * A date in the past is rejected outright rather than coerced, because unlike a
 * malformed enum it is almost always the buyer meaning something specific and
 * getting it wrong — silently storing "yesterday" would put an impossible
 * deadline in front of every artisan the demand reaches.
 */
function parseRequiredBy(value: unknown): { date: Date | null; error: string | null } {
  if (value === null || value === undefined || value === '') return { date: null, error: null };
  if (typeof value !== 'string') return { date: null, error: 'The required-by date is not a date.' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: null, error: 'The required-by date is not a date.' };
  // End of today, not this instant: a buyer picking today at 9 am means today.
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date.getTime() < endOfToday.getTime() - 86_400_000) {
    return { date: null, error: 'The required-by date is in the past.' };
  }
  return { date, error: null };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    // One demand by id. The artisan's notification carries `relatedDemandId`
    // and nothing else, so this is how they read what the buyer actually asked
    // for — reference photo, material, colour — before accepting.
    if (id) {
      const demand = await prisma.demand.findUnique({ where: { id } });
      if (!demand) {
        return NextResponse.json({ error: 'Demand not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, demand });
    }

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

    // Gallery first; the single-image field is still accepted so any client
    // that has not been rebuilt keeps posting successfully.
    const gallery = referenceImages(body?.referenceImageUrls);
    const single = referenceImage(body?.referenceImageUrl);
    if (gallery.urls.length === 0 && single.error) {
      // Only fatal when it was the ONLY photo offered and the caller sent no
      // gallery at all — preserving the pre-V9 contract for old clients.
      return NextResponse.json({ error: single.error }, { status: 400 });
    }
    const images = gallery.urls.length > 0 ? gallery.urls : [single.url].filter((u): u is string => Boolean(u));

    const requiredBy = parseRequiredBy(body?.requiredBy);
    if (requiredBy.error) {
      return NextResponse.json({ error: requiredBy.error }, { status: 400 });
    }

    const customizationRequired = body?.customizationRequired === true;

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
        // What the buyer is actually after. The artisan reads these before
        // accepting, and the matcher ranks against them.
        referenceImageUrls: images,
        // Legacy first-image mirror. Every reader written before V9 — the
        // notification card, the vision pass in /api/demand/match, the artisan
        // demand list — reads this one field, so keeping it filled means none
        // of them had to change.
        referenceImageUrl: images[0] ?? null,
        material: trimmed(body?.material, 120),
        color: trimmed(body?.color, 80),
        description: trimmed(body?.description, 1500),

        // ---- V9 structured capture ----
        category: trimmed(body?.category, 80),
        productType: trimmed(body?.productType, 120),
        sizeSpec: trimmed(body?.sizeSpec, 200),
        customizationRequired,
        // Details are meaningless without the flag, and storing them anyway
        // would put text in front of an artisan that the buyer had switched off.
        customizationDetails: customizationRequired
          ? trimmed(body?.customizationDetails, 1000)
          : null,
        requiredBy: requiredBy.date,
        deliveryMode: oneOf(body?.deliveryMode, DELIVERY_MODES, 'DELIVERY'),
        purchaseType: oneOf(body?.purchaseType, PURCHASE_TYPES, 'INDIVIDUAL'),
        additionalRequirements: trimmed(body?.additionalRequirements, 1500),
        flexBudget: oneOf(body?.flexBudget, FLEX_LEVELS, 'STRICT'),
        flexColor: oneOf(body?.flexColor, FLEX_LEVELS, 'STRICT'),
        flexMaterial: oneOf(body?.flexMaterial, FLEX_LEVELS, 'STRICT'),
        flexDelivery: oneOf(body?.flexDelivery, FLEX_LEVELS, 'STRICT'),
        flexDesign: oneOf(body?.flexDesign, DESIGN_LEVELS, 'EXACT'),

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

    // Tell the buyer their request actually went somewhere. Only when it did:
    // an empty board is not an event, and "0 artisans alerted" is a thing the
    // response already says without needing a stored row to repeat it.
    if (notified > 0) {
      const copy = buyerNotificationCopy.demandMatched(demand.craftType, notified);
      await createBuyerNotification({
        buyerName: demand.buyerName,
        demandId: demand.id,
        type: 'DEMAND_MATCHED',
        ...copy,
      });
    }

    return NextResponse.json({
      success: true,
      demand,
      notified,
      smsSent,
      // Photos that failed validation. The demand still posted — the buyer is
      // told which ones did not make it rather than discovering it later.
      rejectedImages: gallery.rejected,
    });
  } catch (error) {
    console.error('Demand POST error:', error);
    return NextResponse.json({ error: 'Failed to post demand' }, { status: 500 });
  }
}
