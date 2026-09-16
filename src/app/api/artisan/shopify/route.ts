import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { prisma } from '@/lib/prisma';
import { SHOPIFY_CONFIGURED, productUrlFrom } from '@/lib/shopify';

/**
 * The artisan's Shopify shop: its link, how many pieces are live, and the
 * Shopify state of every piece that has one.
 *
 * Reads only the database — never Shopify — so the Syndication Hub renders
 * instantly and costs no API budget. Everything here was written by the publish
 * route after Shopify confirmed it.
 */
export const dynamic = 'force-dynamic';

/** Mirrors the publish route's takeover window. */
const STALE_CLAIM_MS = 3 * 60_000;

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  if (!SHOPIFY_CONFIGURED) {
    return NextResponse.json(
      { configured: false, error: 'Shopify publishing is not set up on this deployment.' },
      { status: 503 }
    );
  }

  try {
    const [shop, items] = await Promise.all([
      prisma.shopifyShop.findUnique({
        where: { artisanId },
        select: { status: true, shopUrl: true, collectionHandle: true, lastSyncedAt: true },
      }),
      prisma.craftItem.findMany({
        where: { artisanId, shopifyStatus: { not: null } },
        select: {
          id: true,
          shopifyStatus: true,
          shopifyStatusAt: true,
          shopifyHandle: true,
          shopifyPublishedAt: true,
          shopifySyncError: true,
          selectedImageVariant: true,
          shopifySyncedImageKey: true,
        },
      }),
    ]);

    const staleBefore = Date.now() - STALE_CLAIM_MS;
    const shopUrl = shop?.status === 'ACTIVE' ? shop.shopUrl : null;

    return NextResponse.json({
      configured: true,
      shop: shop ? { status: shop.status, shopUrl, lastSyncedAt: shop.lastSyncedAt } : null,
      productCount: items.filter((i) => i.shopifyStatus === 'LIVE').length,
      items: items.map((i) => {
        // A PUBLISHING claim whose request died shows as retryable rather than
        // spinning forever; the publish route will take the claim over.
        const interrupted =
          i.shopifyStatus === 'PUBLISHING' && (!i.shopifyStatusAt || i.shopifyStatusAt.getTime() < staleBefore);
        return {
          id: i.id,
          status: interrupted ? 'FAILED' : i.shopifyStatus,
          error: interrupted ? 'Publishing was interrupted. Retry to finish.' : i.shopifySyncError,
          publishedAt: i.shopifyPublishedAt,
          productUrl: i.shopifyStatus === 'LIVE' || i.shopifyStatus === 'FAILED' ? productUrlFrom(shopUrl, i.shopifyHandle) : null,
          // The artisan changed the photo's look since the last publish.
          lookChanged:
            i.shopifyStatus === 'LIVE' &&
            Boolean(i.shopifySyncedImageKey) &&
            (i.selectedImageVariant ?? 'ORIGINAL') !== i.shopifySyncedImageKey,
        };
      }),
    });
  } catch (error) {
    console.error('[artisan/shopify] GET failed:', error);
    return NextResponse.json({ error: 'Could not load your Shopify shop.' }, { status: 500 });
  }
}
