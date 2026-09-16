import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { estimateCraftValuation, getPricingDiscrepancy } from '@/lib/pricing';
import { MAX_CAPTURE_IMAGES, resolveStudioFields, validateListingImages } from '@/lib/photoStudioPayload';
import { enforceLookProvenance } from '@/lib/lookProvenance';

export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

/** Same ceiling the capture flow allows. */
const MAX_IMAGES = MAX_CAPTURE_IMAGES;

/**
 * Finish an IVR draft: attach the photo(s) and the price the phone call could
 * not collect, value it with the same formula as in-app capture, and hand it to
 * the admin queue.
 */
export async function POST(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let decoded: AuthToken;
  try {
    decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  if (decoded.role !== 'ARTISAN') {
    return NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const itemId = typeof body?.itemId === 'string' ? body.itemId : null;
    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required.' }, { status: 400 });
    }

    // Same caps as capture: at most four photos, each within MAX_UPLOAD_BYTES.
    // This route had no byte cap at all, so one raw 8 MB phone photo went
    // straight into the row.
    const checked = validateListingImages(
      Array.isArray(body?.images) ? body.images.slice(0, MAX_IMAGES) : body?.images
    );
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }
    if (checked.images.length === 0) {
      return NextResponse.json({ error: 'At least one photo is required.' }, { status: 400 });
    }

    const askingPrice = Number(body?.askingPrice);
    if (!Number.isFinite(askingPrice) || askingPrice <= 0) {
      return NextResponse.json({ error: 'A valid asking price is required.' }, { status: 400 });
    }

    // Ownership and state are re-checked here, never taken from the request:
    // the id in the body is a claim, not proof.
    const item = await prisma.craftItem.findFirst({
      where: { id: itemId, artisanId: decoded.userId, status: 'IVR_DRAFT' },
    });
    if (!item) {
      return NextResponse.json(
        { error: 'Draft not found, already completed, or not yours.' },
        { status: 404 }
      );
    }

    const text = (value: unknown, fallback: string | null): string | null =>
      typeof value === 'string' && value.trim() ? value.trim().slice(0, 4000) : fallback;

    const craftType = text(body?.craftType, item.craftType) || item.craftType;
    const descriptionEnglish = text(body?.descriptionEnglish, item.descriptionEnglish);

    const laborDays = Number(body?.laborDays);
    const resolvedLaborDays =
      Number.isFinite(laborDays) && laborDays > 0 ? Math.round(laborDays) : item.laborDays ?? 0;

    const rawCost = Number(body?.rawMaterialCost);
    const resolvedRawCost =
      Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : item.rawMaterialCost ?? 0;

    // The identical valuation the capture route runs, so a craft catalogued by
    // phone is priced on exactly the same basis as one catalogued in the app.
    const { fairWageFloor, standardMarketPrice, marketPriceMin, marketPriceMax } =
      estimateCraftValuation(craftType, resolvedLaborDays, resolvedRawCost);

    // Anti-exploitation guardian, same rule and wording as capture — under the
    // fair wage floor or over the market band, both raise the flag.
    const priceVerdict = getPricingDiscrepancy({
      fairWageFloor,
      marketPriceMax,
      standardMarketPrice,
      askingPrice,
    });
    const flagged = priceVerdict.flagged;
    const flagReason = flagged ? priceVerdict.reason : null;

    // Same provenance rule as capture: a look that cannot be proven to be the
    // camera frame's pixels is replaced by the frame itself.
    const proven = await enforceLookProvenance(resolveStudioFields(body, checked.images), checked.images);
    const images = proven.images;

    const updated = await prisma.craftItem.update({
      where: { id: item.id },
      data: {
        images,
        // V11: a draft finished with studio data keeps its original frame and
        // looks, exactly as an in-app capture does. `{}` when none was sent.
        ...proven.fields,
        askingPrice,
        craftType,
        descriptionEnglish,
        laborDays: resolvedLaborDays,
        rawMaterialCost: resolvedRawCost,
        fairWageFloor,
        standardMarketPrice,
        marketPriceMin,
        marketPriceMax,
        pricingFlag: flagged,
        flagReason,
        status: 'PENDING_VERIFICATION',
      },
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: decoded.userId,
      actorRole: 'ARTISAN',
      action: 'DRAFT_COMPLETED',
      previousState: { status: 'IVR_DRAFT', images: item.images.length, askingPrice: item.askingPrice },
      newState: {
        status: 'PENDING_VERIFICATION',
        images: updated.images.length,
        askingPrice: updated.askingPrice,
        fairWageFloor: updated.fairWageFloor,
        pricingFlag: updated.pricingFlag,
      },
      comments:
        'Artisan completed their IVR voice draft with photo and price. ' +
        'Item now enters the normal verification queue.' +
        (flagged ? ` Flagged: ${flagReason}` : ''),
    });

    return NextResponse.json({ success: true, item: updated });
  } catch (error) {
    console.error('Complete draft error:', error);
    return NextResponse.json({ error: 'Failed to complete the draft' }, { status: 500 });
  }
}
