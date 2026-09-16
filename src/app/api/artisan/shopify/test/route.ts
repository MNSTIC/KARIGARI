import { NextResponse } from 'next/server';
import { getSession } from '@/lib/authSession';
import { SHOPIFY_CONFIGURED, testConnection } from '@/lib/shopify';

/**
 * Admin-only Shopify connection probe.
 *
 * Reports the shop, the store currency, the API version, the scopes the token
 * actually has and any the publish flow still needs — so a misconfigured token
 * is diagnosable from a browser instead of from server logs. Never returns the
 * token or any part of it.
 *
 * Under /api/artisan/shopify because that is where the feature lives, but gated
 * to ADMIN: an artisan has no business probing the platform's credentials.
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
  }

  if (!SHOPIFY_CONFIGURED) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Shopify publishing is not set up on this deployment. Set SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN and SHOPIFY_API_VERSION.',
      },
      { status: 503 }
    );
  }

  try {
    const result = await testConnection();
    if (!result.ok) {
      return NextResponse.json({ ok: false, kind: result.kind, error: result.message }, { status: 502 });
    }
    const report = result.data;
    const problems = [
      ...(report.currencyOk ? [] : [`Store currency is ${report.currencyCode}; publishing needs INR.`]),
      ...(report.missingScopes.length ? [`Missing scopes: ${report.missingScopes.join(', ')}.`] : []),
      ...(report.onlineStoreChannel ? [] : ['The store has no Online Store sales channel.']),
    ];
    // Publishing works without a location, but a one-of-a-kind piece is then
    // not stock-tracked and Shopify could take two orders for it.
    const warnings = report.locationConfigured
      ? []
      : ['SHOPIFY_LOCATION_ID is not set, so pieces are not stock-tracked on Shopify.'];
    return NextResponse.json({ ok: problems.length === 0, report, problems, warnings });
  } catch (error) {
    console.error('[artisan/shopify/test] failed:', error);
    return NextResponse.json({ ok: false, error: 'The connection test could not run.' }, { status: 500 });
  }
}
