import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { ARTISAN_SETTABLE_STAGES, resolveStage, stageIndex, type OrderStage } from '@/lib/orderStage';
import { dataUrlBytes, MAX_UPLOAD_BYTES } from '@/lib/fileToDataUrl';
import { VARIANT_KEY_RE, type StoredImageVariants } from '@/lib/photoStudioPayload';
import { verifyLook } from '@/lib/lookProvenance';

export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

async function requireArtisan(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token');
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  let decoded: AuthToken;
  try {
    decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) };
  }

  if (decoded.role !== 'ARTISAN') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 }),
    };
  }

  return { ok: true, userId: decoded.userId };
}

const LISTING_FIELDS = {
  id: true,
  craftType: true,
  patchId: true,
  status: true,
  images: true,
  descriptionOriginal: true,
  descriptionEnglish: true,
  aiGeneratedListing: true,
  marketPriceMin: true,
  marketPriceMax: true,
  fairWageFloor: true,
  standardMarketPrice: true,
  askingPrice: true,
  salePrice: true,
  isListedOnMarketplace: true,
  // Syndication Hub reads these to render which channels an item went out on.
  isOndcLive: true,
  syndicatedChannels: true,
  syndicatedAt: true,
  createdAt: true,
  // Buyer-facing production ladder.
  productionStage: true,
  stageUpdatedAt: true,
  estimatedDeliveryAt: true,
  // V11 photo studio. Only the KEY is listed here — the looks themselves
  // (thumbnails plus a cutout, up to ~1 MB) are fetched per item with
  // `GET ?looks=<id>` when the artisan opens the picker.
  selectedImageVariant: true,
  // A paid-for listing photo is frozen; the picker reads this to say so.
  paidAt: true,
} as const;

/** Stored looks as the picker needs them, with what can actually be switched to. */
function lookOptionsFor(item: {
  selectedImageVariant: string | null;
  originalImageUrl: string | null;
  enhancedImageUrl: string | null;
  imageVariants: unknown;
  paidAt: Date | null;
}) {
  const blob = (item.imageVariants && typeof item.imageVariants === 'object'
    ? item.imageVariants
    : null) as StoredImageVariants | null;
  const cutout = typeof blob?.cutout === 'string' ? blob.cutout : null;
  const options = (Array.isArray(blob?.variants) ? blob.variants : []).filter((v) => {
    if (v.key === item.selectedImageVariant) return true;
    if (v.key === 'ORIGINAL') return Boolean(item.originalImageUrl);
    if (v.key === 'ENHANCED') return Boolean(item.enhancedImageUrl);
    // A preset can be re-rendered from the stored cutout. A generated backdrop
    // was never stored, so it can only stay selected, never be switched back to.
    if (v.kind === 'PRESET') return Boolean(cutout);
    return false;
  });
  return {
    selectedKey: item.selectedImageVariant ?? 'ORIGINAL',
    options,
    cutout,
    locked: Boolean(item.paidAt),
  };
}

/**
 * The artisan's marketplace view: what is already published, and what is still
 * waiting so a "New Listing" action has something real to attach copy to.
 */
export async function GET(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    // `?looks=<itemId>`: the stored looks for one of the artisan's own items.
    const looksFor = new URL(req.url).searchParams.get('looks');
    if (looksFor) {
      const item = await prisma.craftItem.findFirst({
        where: { id: looksFor, artisanId: auth.userId },
        select: {
          selectedImageVariant: true,
          originalImageUrl: true,
          enhancedImageUrl: true,
          imageVariants: true,
          paidAt: true,
        },
      });
      if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      return NextResponse.json({ success: true, looks: lookOptionsFor(item) });
    }

    const [listings, drafts] = await Promise.all([
      prisma.craftItem.findMany({
        where: {
          artisanId: auth.userId,
          OR: [{ isListedOnMarketplace: true }, { patchId: { not: null } }],
        },
        orderBy: { createdAt: 'desc' },
        select: LISTING_FIELDS,
      }),
      prisma.craftItem.findMany({
        where: {
          artisanId: auth.userId,
          isListedOnMarketplace: false,
          patchId: null,
        },
        orderBy: { createdAt: 'desc' },
        select: LISTING_FIELDS,
      }),
    ]);

    return NextResponse.json({ success: true, listings, drafts });
  } catch (error) {
    console.error('Artisan listings GET error:', error);
    return NextResponse.json({ error: 'Failed to load listings' }, { status: 500 });
  }
}

/**
 * Save the artisan's own listing copy onto one of their craft items.
 *
 * `descriptionEnglish` is the text that goes out as the ONDC listing;
 * `descriptionOriginal` is their own-language version, kept for the digital
 * passport story. Both are written straight to the CraftItem — no separate
 * listing table, so the passport and the marketplace can never disagree.
 */
export async function PATCH(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const itemId = typeof body?.itemId === 'string' ? body.itemId : null;
    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required.' }, { status: 400 });
    }

    // Scoped read: an artisan can only ever edit their own item.
    const item = await prisma.craftItem.findFirst({
      where: { id: itemId, artisanId: auth.userId },
      select: {
        id: true,
        craftType: true,
        descriptionEnglish: true,
        aiGeneratedListing: true,
        status: true,
        escrowStatus: true,
        qrVerified: true,
        productionStage: true,
        images: true,
        selectedImageVariant: true,
        originalImageUrl: true,
        enhancedImageUrl: true,
        imageVariants: true,
        paidAt: true,
      },
    });
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    /**
     * V11 — change the listing photo's look.
     *
     * Handled on its own, before the text and stage edits, so one request can
     * never half-apply. The camera frame (`originalImageUrl`) is never touched:
     * only `images[0]` and `selectedImageVariant` change, and every
     * authenticity comparator reads the original — see provenanceReference().
     */
    if (body?.selectedImageVariant !== undefined) {
      const key = String(body.selectedImageVariant);
      if (!VARIANT_KEY_RE.test(key)) {
        return NextResponse.json({ error: 'That look does not exist.' }, { status: 400 });
      }
      // What a buyer paid for is what they receive a photo of. Frozen.
      if (item.paidAt) {
        return NextResponse.json(
          { error: 'A buyer has paid for this piece, so its listing photo can no longer be changed.' },
          { status: 409 }
        );
      }
      if (!item.selectedImageVariant) {
        return NextResponse.json(
          { error: 'This piece was photographed before looks existed, so there is nothing to switch to.' },
          { status: 400 }
        );
      }
      if (key === item.selectedImageVariant) {
        return NextResponse.json({ success: true, unchanged: true });
      }

      const { options, cutout } = lookOptionsFor(item);
      const option = options.find((o) => o.key === key);
      if (!option) {
        return NextResponse.json({ error: 'That look is not available for this piece.' }, { status: 400 });
      }

      let listingImage: string | null = null;
      if (key === 'ORIGINAL') listingImage = item.originalImageUrl;
      else if (key === 'ENHANCED') listingImage = item.enhancedImageUrl;
      else if (option.kind === 'PRESET' && cutout) {
        // The browser re-renders the preset from the stored cutout (canvas only
        // exists there) and sends the composite. It is size- and type-checked;
        // its pixels cannot affect provenance, which reads the original frame.
        const candidate = typeof body?.imageDataUrl === 'string' ? body.imageDataUrl : '';
        if (!/^data:image\/(jpeg|png|webp);base64,/.test(candidate) || dataUrlBytes(candidate) > MAX_UPLOAD_BYTES) {
          return NextResponse.json({ error: 'The new photo could not be prepared. Please try again.' }, { status: 400 });
        }
        // The browser rendered it, so prove it: the stored cutout must be the
        // camera frame's pixels, and the new photo must be the cutout's.
        const cutoutOk = item.originalImageUrl
          ? (await verifyLook({ look: item.originalImageUrl, reference: cutout, mode: 'cutout' })).ok
          : false;
        const lookOk = cutoutOk && (await verifyLook({ look: candidate, reference: cutout, mode: 'cutout' })).ok;
        if (!lookOk) {
          return NextResponse.json(
            { error: 'That look could not be matched to your original photo, so it was not applied.' },
            { status: 422 }
          );
        }
        listingImage = candidate;
      }
      if (!listingImage) {
        return NextResponse.json({ error: 'That look is not available for this piece.' }, { status: 400 });
      }

      const updated = await prisma.craftItem.update({
        where: { id: item.id },
        data: {
          images: [listingImage, ...item.images.slice(1)],
          selectedImageVariant: key,
        },
        select: LISTING_FIELDS,
      });

      await logCraftItemEvent({
        prisma,
        craftItemId: item.id,
        actorId: auth.userId,
        actorRole: 'ARTISAN',
        action: 'LISTING_PHOTO_LOOK_CHANGED',
        previousState: { selectedImageVariant: item.selectedImageVariant },
        newState: { selectedImageVariant: key },
        comments:
          'Artisan changed the look of their listing photo. The original camera frame used for authenticity checks is unchanged.',
      });

      return NextResponse.json({ success: true, item: updated });
    }

    /**
     * Production stage, if the artisan is advancing one.
     *
     * Only ACCEPTED and IN_PRODUCTION are settable here. Everything past the
     * quality check is written by the escrow engine on a real dispatch or
     * delivery trigger, so an artisan can never tell a buyer a piece shipped
     * when no money has moved. It also cannot go backwards: whatever the escrow
     * and verification fields already prove is the floor.
     */
    let productionStage: OrderStage | undefined;
    if (body?.productionStage !== undefined) {
      const requested = String(body.productionStage) as OrderStage;
      if (!ARTISAN_SETTABLE_STAGES.includes(requested)) {
        return NextResponse.json(
          { error: 'That production stage cannot be set by an artisan.' },
          { status: 400 }
        );
      }
      if (stageIndex(requested) < stageIndex(resolveStage(item))) {
        return NextResponse.json(
          { error: 'This piece is already further along than that.' },
          { status: 409 }
        );
      }
      productionStage = requested;
    }

    const text = (value: unknown, max = 4000): string | undefined =>
      typeof value === 'string' ? value.trim().slice(0, max) : undefined;

    const descriptionEnglish = text(body?.descriptionEnglish);
    const descriptionOriginal = text(body?.descriptionOriginal);
    const aiGeneratedListing = text(body?.aiGeneratedListing) ?? descriptionEnglish;
    const askingPrice = typeof body?.askingPrice === 'number' ? body.askingPrice : undefined;
    const newImages = Array.isArray(body?.newImages) ? body.newImages.filter((i: any) => typeof i === 'string') : undefined;

    if (
      descriptionEnglish === undefined &&
      descriptionOriginal === undefined &&
      productionStage === undefined &&
      askingPrice === undefined &&
      newImages === undefined
    ) {
      return NextResponse.json(
        { error: 'Provide descriptionEnglish, descriptionOriginal, productionStage, askingPrice, and/or newImages.' },
        { status: 400 }
      );
    }
    if (descriptionEnglish !== undefined && descriptionEnglish.length === 0) {
      return NextResponse.json({ error: 'The English listing cannot be empty.' }, { status: 400 });
    }

    const updateData: any = {
      ...(descriptionEnglish !== undefined ? { descriptionEnglish } : {}),
      ...(descriptionOriginal !== undefined ? { descriptionOriginal } : {}),
      ...(aiGeneratedListing !== undefined ? { aiGeneratedListing } : {}),
      ...(productionStage !== undefined
        ? { productionStage, stageUpdatedAt: new Date() }
        : {}),
      ...(askingPrice !== undefined ? { askingPrice } : {}),
    };
    
    if (newImages && newImages.length > 0) {
      updateData.images = [...item.images, ...newImages];
    }

    const updated = await prisma.craftItem.update({
      where: { id: item.id },
      data: updateData,
      select: LISTING_FIELDS,
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: auth.userId,
      actorRole: 'ARTISAN',
      action: productionStage !== undefined ? 'PRODUCTION_STAGE_UPDATED' : 'LISTING_TEXT_UPDATED',
      previousState: {
        descriptionEnglish: item.descriptionEnglish,
        aiGeneratedListing: item.aiGeneratedListing,
        productionStage: item.productionStage,
      },
      newState: {
        descriptionEnglish: updated.descriptionEnglish,
        aiGeneratedListing: updated.aiGeneratedListing,
        productionStage: updated.productionStage,
      },
      comments:
        productionStage !== undefined
          ? `Artisan advanced this piece to ${productionStage}. The buyer's tracker moves with it.`
          : 'Artisan edited their own listing description, price, or images. This text is what goes out as the ONDC listing.',
    });

    return NextResponse.json({ success: true, item: updated });
  } catch (error) {
    console.error('Artisan listings PATCH error:', error);
    return NextResponse.json({ error: 'Failed to save listing' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireArtisan();
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 });
    }

    const item = await prisma.craftItem.findUnique({
      where: { id, artisanId: auth.userId },
      select: { id: true, isListedOnMarketplace: true, isOndcLive: true },
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Usually you don't want to delete items that are already live or sold,
    // but the request is to "delete that listing", so we can just delete it.
    // However, it's safer to just set a status if it was live, but the user explicitly asked to delete it.
    await prisma.craftItem.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Artisan listings DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete listing' }, { status: 500 });
  }
}
