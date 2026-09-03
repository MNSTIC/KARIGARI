import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

/**
 * Shared artisan auth for the new routes (cluster, orders, smart-draft, …).
 *
 * The existing routes each inline a copy of this check. New routes use this
 * helper instead, so the JWT secret and the role gate live in one place.
 * Non-null return is an authenticated artisan; a Response return is the failure
 * the caller should send back verbatim.
 */

interface Token {
  userId?: string;
  role?: string;
}

export interface ArtisanIdentity {
  userId: string;
  role: 'ARTISAN';
}

/** Reads the auth cookie and enforces role=ARTISAN. */
export async function requireArtisan(): Promise<
  { ok: true; artisan: ArtisanIdentity } | { ok: false; response: Response }
> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token');
  if (!token) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  let decoded: Token;
  try {
    decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as Token;
  } catch {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  if (decoded.role !== 'ARTISAN' || !decoded.userId) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: 'Forbidden. Artisan access required.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  return { ok: true, artisan: { userId: decoded.userId, role: 'ARTISAN' } };
}
