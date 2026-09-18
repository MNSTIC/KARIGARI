import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { readBenchmark } from '@/lib/benchmarkRecord';

/**
 * GET /api/artisan/benchmarks
 *
 * How this artisan's own quarter compares with the artisans around them —
 * medians only, and only when enough of them are active to make the comparison
 * anonymous.
 *
 * The hazard this endpoint is built against is a leaderboard: naming the
 * highest earner in a small village causes real conflict between neighbours.
 * The control is technical, not a disclaimer. Below `MIN_COHORT` active peers
 * the response carries **no figure at all** — not a median, not a quartile, not
 * a "you" value — because a JSON payload is as public as a screenshot of it.
 * Above it, the response still has no field that could hold a name, an id, a
 * rank or a percentile: the finest position expressed is BELOW / MIDDLE / ABOVE.
 *
 * `Cache-Control: private, no-store` because the payload is about one artisan's
 * own standing and must never be served from a shared cache.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const record = await readBenchmark(auth.artisan.userId);
    return NextResponse.json(
      { success: true, ...record },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.error('[benchmarks] failed:', error);
    return NextResponse.json({ success: false, error: 'Could not load the comparison.' }, { status: 500 });
  }
}
