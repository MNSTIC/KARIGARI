import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildOndcCatalog, ONDC_ITEM_SELECT, type CatalogItem } from '@/lib/ondcCatalog';

/**
 * KARIGARI as an ONDC **Provider node (BPP)**: the published catalogue,
 * serialized into the Beckn `on_search` shape an ONDC buyer app consumes.
 *
 * This is a pure serializer over `CraftItem` rows — no mock data, no invented
 * providers. It does NOT join the live ONDC network and it does not sign or
 * transact; it exposes a spec-shaped catalogue that a registered BAP could
 * ingest. A real BPP catalogue is public, so there is no auth here.
 *
 * The serialization itself lives in `@/lib/ondcCatalog`, shared with the
 * artisan's government-catalog export.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const origin = process.env.ONDC_BPP_URI_ORIGIN || url.origin;

    /**
     * Optional scoping for the artisan-facing export ("download my own Beckn
     * payload"). Absent — the default, and what a buyer app requests — the
     * response is the full public catalogue, unchanged.
     */
    const artisanId = url.searchParams.get('artisanId') || url.searchParams.get('providerId');

    // "Published" means exactly what the rest of the app calls live: an item an
    // admin has verified and flipped onto the marketplace.
    const rows = (await prisma.craftItem.findMany({
      where: {
        isListedOnMarketplace: true,
        ...(artisanId ? { artisanId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: ONDC_ITEM_SELECT,
    })) as CatalogItem[];

    return NextResponse.json(buildOndcCatalog(rows, origin), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('ONDC catalog error:', error);
    return NextResponse.json({ error: 'Failed to build ONDC catalog' }, { status: 500 });
  }
}
