import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { generateBackdrops } from '@/lib/backdropGen';

/**
 * Generated backdrops for the capture studio — backgrounds only.
 *
 * The request carries TEXT (the craft description and display type), never the
 * artisan's photo, so there is no path by which a product could be sent to an
 * image model. The client composites its own cutout over whatever comes back.
 * Full reasoning: src/lib/backdropGen.ts.
 *
 * Always 200 with `{ ok }`: the generative tier is optional, and its absence —
 * no key, no quota, a slow model — is a normal outcome the gallery handles by
 * simply not showing those looks. `reason: 'no_quota'` tells the client to stop
 * asking for the rest of the session.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 40;

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const craftDetails = typeof body?.craftDetails === 'string' ? body.craftDetails : '';
    const display = typeof body?.display === 'string' ? body.display : 'other';
    if (!craftDetails.trim()) {
      return NextResponse.json({ ok: false, reason: 'failed' });
    }

    const result = await generateBackdrops({ craftDetails, display });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[items/backdrop] failed:', error);
    return NextResponse.json({ ok: false, reason: 'failed' });
  }
}
