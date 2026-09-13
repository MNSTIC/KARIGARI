import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PURCHASABLE_WHERE } from '@/lib/storefrontSale';
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

    // "Published" means exactly what the storefront means: a piece a buyer can
    // actually purchase (PURCHASABLE_WHERE). This used to be the listed flag
    // alone, and the comment claimed that implied admin verification — it did
    // not. Pieces still PENDING_VERIFICATION, never QR-verified, and already
    // sold and settled were all going out to ONDC buyer apps, which would take
    // orders for them that checkout then refuses.
    const rows = (await prisma.craftItem.findMany({
      where: {
        AND: [PURCHASABLE_WHERE],
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
