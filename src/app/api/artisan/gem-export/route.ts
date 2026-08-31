import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { ONDC_ITEM_SELECT, type CatalogItem } from '@/lib/ondcCatalog';
import { toGemCsv, toGemJson, toGemRows } from '@/lib/gemCatalog';
import { buildGemGuidance } from '@/lib/gemGuidance';

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

/**
 * Government-marketplace catalog export.
 *
 * Produces upload-ready files, and nothing more: GeM has no public seller push
 * API, so the artisan uploads these on gem.gov.in themselves. Every format here
 * is generated deterministically — no model call — so the export cannot fail
 * because an AI key is missing or rate-limited.
 *
 *   ?format=csv       (default) GeM bulk-upload spreadsheet
 *   ?format=json      the same rows as JSON
 *   ?format=guidance  personalised step-by-step submission guide
 */
export async function GET(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const format = (url.searchParams.get('format') || 'csv').toLowerCase();
    const origin = process.env.ONDC_BPP_URI_ORIGIN || url.origin;

    const profile = await prisma.artisanProfile.findUnique({
      where: { userId: auth.userId },
      select: {
        craftType: true,
        clusterName: true,
        location: true,
        giTagName: true,
        socialCategory: true,
        gender: true,
      },
    });

    if (format === 'guidance') {
      return NextResponse.json({
        success: true,
        guidance: buildGemGuidance(profile, profile?.craftType || ''),
      });
    }

    // "Exportable" is anything a government buyer could actually be shown: on
    // the marketplace, or verified with a patch id.
    const rows = (await prisma.craftItem.findMany({
      where: {
        artisanId: auth.userId,
        OR: [{ isListedOnMarketplace: true }, { patchId: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      select: ONDC_ITEM_SELECT,
    })) as CatalogItem[];

    // Answer with JSON rather than handing back an empty spreadsheet, so the UI
    // can explain what is missing instead of downloading a header-only file.
    if (rows.length === 0) {
      return NextResponse.json({ success: true, empty: true, count: 0 });
    }

    const gemRows = toGemRows(rows, origin);

    if (format === 'json') {
      return new NextResponse(toGemJson(gemRows), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="karigari-gem-catalog.json"',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (format === 'count') {
      return NextResponse.json({ success: true, empty: false, count: gemRows.length });
    }

    return new NextResponse(toGemCsv(gemRows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="karigari-gem-catalog.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('GeM export error:', error);
    return NextResponse.json({ error: 'Failed to build the catalog export' }, { status: 500 });
  }
}
