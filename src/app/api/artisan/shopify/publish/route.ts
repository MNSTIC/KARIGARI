import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { unpurchasableReason } from '@/lib/storefrontSale';
import {
  SHOPIFY_CONFIGURED,
  ensureArtisanShop,
  publishProduct,
  shopifyPriceFor,
  type ShopifyFailureKind,
} from '@/lib/shopify';

/**
 * Publish (or re-publish) one of the artisan's own pieces to their Shopify shop.
 *
 * The only route that writes the Shopify columns. Flow:
 *   1. Ownership, then the same "is this for sale" rule the storefront uses.
 *   2. CLAIM the row as PUBLISHING with a guarded updateMany, so a double-click
 *      or a second tab gets 409 instead of a second publish. A claim older than
 *      STALE_CLAIM_MS belongs to a request that died and may be taken over.
 *   3. ensureArtisanShop() → publishProduct(), both idempotent against
 *      Shopify's own state, so a Retry after any failure resumes.
 *   4. LIVE, or FAILED with the sentence to show beside Retry.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Longer than this route's own maxDuration, so a live request is never taken over. */
const STALE_CLAIM_MS = 3 * 60_000;

const STATUS_FOR: Record<ShopifyFailureKind, number> = {
  unconfigured: 503,
  auth: 502,
  scope: 502,
  throttled: 503,
  user: 422,
  currency: 422,
  graphql: 502,
  http: 502,
  network: 502,
  busy: 409,
};

const PUBLISH_SELECT = {
  id: true,
  artisanId: true,
  patchId: true,
  craftType: true,
  images: true,
  selectedImageVariant: true,
  descriptionEnglish: true,
  aiGeneratedListing: true,
  aiCatalog: true,
  askingPrice: true,
  salePrice: true,
  standardMarketPrice: true,
  fairWageFloor: true,
  tags: true,
  status: true,
  escrowStatus: true,
  paidAt: true,
  isListedOnMarketplace: true,
  qrVerified: true,
  qrExemptAt: true,
  shopifyProductId: true,
  shopifyHandle: true,
  shopifyStatus: true,
  shopifySyncedImageKey: true,
} as const;

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  if (!SHOPIFY_CONFIGURED) {
    return NextResponse.json({ error: 'Shopify publishing is not set up on this deployment.' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const craftItemId = typeof body?.craftItemId === 'string' ? body.craftItemId : null;
  if (!craftItemId) {
    return NextResponse.json({ error: 'craftItemId is required.' }, { status: 400 });
  }

  let claimed = false;
  let previousStatus: string | null = null;

  try {
    // The id in the body is a claim; ownership is checked here, before any write.
    const item = await prisma.craftItem.findUnique({ where: { id: craftItemId }, select: PUBLISH_SELECT });
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    if (item.artisanId !== artisanId) {
      return NextResponse.json({ error: 'You can only publish your own pieces.' }, { status: 403 });
    }
    previousStatus = item.shopifyStatus;

    // The same rule as the Karigari storefront: a piece that is sold, or not
    // yet verified for sale, is not offered anywhere else either.
    const reason = unpurchasableReason(item);
    if (reason === 'sold') {
      return NextResponse.json({ error: 'This piece has already sold, so it cannot be listed on your shop.' }, { status: 409 });
    }
    if (reason === 'unavailable') {
      return NextResponse.json(
        { error: 'This piece is not open for sale yet. It can go on your shop once a facilitator has verified it.' },
        { status: 409 }
      );
    }
    if (!shopifyPriceFor(item)) {
      return NextResponse.json({ error: 'This piece has no price yet, so it cannot be listed.' }, { status: 400 });
    }
    if (!item.images?.[0]) {
      return NextResponse.json({ error: 'This piece has no photo. Add a photo, then publish.' }, { status: 400 });
    }

    // The claim. WITHDRAWN is terminal and never matches.
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
    const claim = await prisma.craftItem.updateMany({
      where: {
        id: item.id,
        artisanId,
        OR: [
          { shopifyStatus: null },
          { shopifyStatus: { in: ['NOT_PUBLISHED', 'FAILED', 'LIVE'] } },
          { shopifyStatus: 'PUBLISHING', OR: [{ shopifyStatusAt: null }, { shopifyStatusAt: { lt: staleBefore } }] },
        ],
      },
      data: { shopifyStatus: 'PUBLISHING', shopifyStatusAt: new Date(), shopifySyncError: null },
    });
    if (claim.count === 0) {
      return NextResponse.json(
        {
          error:
            item.shopifyStatus === 'WITHDRAWN'
              ? 'This piece sold on Karigari and was taken off your shop.'
              : 'This piece is already being published. Give it a moment.',
        },
        { status: 409 }
      );
    }
    claimed = true;

    const shop = await ensureArtisanShop(artisanId);
    const artisan = await prisma.user.findUnique({
      where: { id: artisanId },
      select: { id: true, name: true, artisanProfile: { select: { clusterName: true } } },
    });

    const result =
      shop.ok && artisan
        ? await publishProduct({
            item,
            artisan: { id: artisan.id, name: artisan.name, clusterName: artisan.artisanProfile?.clusterName },
            shop: shop.data,
          })
        : shop.ok
          ? ({ ok: false, kind: 'user', message: 'Artisan account not found.' } as const)
          : shop;

    if (!result.ok) {
      // A failed UPDATE of a product that is already live leaves it live on
      // Shopify, so the row says LIVE with the error beside it rather than
      // claiming the piece came down.
      const stillLive = previousStatus === 'LIVE';
      await prisma.craftItem.update({
        where: { id: item.id },
        data: {
          shopifyStatus: stillLive ? 'LIVE' : 'FAILED',
          shopifyStatusAt: new Date(),
          shopifySyncError: result.message,
        },
      });
      await logCraftItemEvent({
        prisma,
        craftItemId: item.id,
        actorId: artisanId,
        actorRole: 'ARTISAN',
        action: 'SHOPIFY_PUBLISH_FAILED',
        previousState: { shopifyStatus: previousStatus },
        newState: { shopifyStatus: stillLive ? 'LIVE' : 'FAILED', kind: result.kind },
        comments: `Publishing to the artisan's Shopify shop did not complete: ${result.message}`,
      });
      return NextResponse.json(
        { success: false, status: stillLive ? 'LIVE' : 'FAILED', error: result.message, kind: result.kind },
        { status: STATUS_FOR[result.kind] }
      );
    }

    const now = new Date();
    await prisma.craftItem.update({
      where: { id: item.id },
      data: { shopifyStatus: 'LIVE', shopifyStatusAt: now, shopifyPublishedAt: now, shopifySyncError: null },
    });
    const liveCount = await prisma.craftItem.count({ where: { artisanId, shopifyStatus: 'LIVE' } });
    const shopRow = shop.ok ? shop.data : null;
    await prisma.shopifyShop.update({ where: { artisanId }, data: { productCount: liveCount, lastSyncedAt: now } });

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: artisanId,
      actorRole: 'ARTISAN',
      action: previousStatus === 'LIVE' ? 'SHOPIFY_PRODUCT_UPDATED' : 'SHOPIFY_PUBLISHED',
      previousState: { shopifyStatus: previousStatus },
      newState: {
        shopifyStatus: 'LIVE',
        shopifyProductId: result.data.productId,
        handle: result.data.handle,
        // The real listing price in rupees — never the gateway's demo charge.
        priceRupees: result.data.price,
        imageKey: result.data.imageKey,
        imageUploaded: result.data.imageUploaded,
      },
      comments:
        previousStatus === 'LIVE'
          ? "Artisan re-published this piece to their Shopify shop. Shopify confirmed the update."
          : "Artisan published this piece to their Shopify shop. Shopify confirmed the product and put it on the Online Store.",
    });

    return NextResponse.json({
      success: true,
      status: 'LIVE',
      productUrl: result.data.productUrl,
      shopUrl: shopRow?.shopUrl ?? null,
      productCount: liveCount,
    });
  } catch (error) {
    console.error('[artisan/shopify/publish] failed:', error);
    // Never leave a claim behind: a thrown request would otherwise read as
    // "publishing" until the stale window passed.
    if (claimed) {
      await prisma.craftItem
        .update({
          where: { id: craftItemId },
          data: {
            shopifyStatus: previousStatus === 'LIVE' ? 'LIVE' : 'FAILED',
            shopifyStatusAt: new Date(),
            shopifySyncError: 'Publishing stopped unexpectedly. Retry to finish.',
          },
        })
        .catch(() => undefined);
    }
    return NextResponse.json({ error: 'Publishing stopped unexpectedly. Retry to finish.' }, { status: 500 });
  }
}
