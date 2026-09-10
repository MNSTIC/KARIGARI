import crypto from 'node:crypto';

/**
 * Google Sign-in, hand-rolled.
 *
 * No `next-auth`. The whole flow is an authorization-code exchange with PKCE
 * plus an `id_token` signature check, and all three of those are `node:crypto`
 * primitives — pulling in an auth framework to get them would add a large
 * dependency and a second, competing notion of what a session is, next to the
 * JWT this app already issues.
 *
 * TRUST BOUNDARY. `GOOGLE_CLIENT_SECRET` is read here and nowhere else, and this
 * module imports `node:crypto`, so it can never be pulled into a client bundle.
 * Never add a `NEXT_PUBLIC_` alias for the secret.
 *
 * Nothing here throws into a route. Every function returns a typed result, so a
 * handler turns a failure into a redirect with a notice code rather than a 500
 * with a stack trace in front of someone trying to sign in.
 */

const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || '').trim();

/** All three present. False → the routes 503 and the button never renders. */
export const GOOGLE_CONFIGURED = Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

/** The client id is public by design — Google shows it in the consent URL. */
export const GOOGLE_CLIENT_ID = CLIENT_ID;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';

/** Google publishes both spellings; a token may legitimately carry either. */
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/** base64url without padding — what OAuth and JOSE both expect. */
function b64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomB64url(bytes: number): string {
  return b64url(crypto.randomBytes(bytes));
}

/** The PKCE pair. The verifier stays in an httpOnly cookie; only the challenge travels. */
export function createPkcePair(): { verifier: string; challenge: string } {
  // 32 random bytes → 43 base64url characters, the minimum RFC 7636 allows.
  const verifier = randomB64url(32);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function createState(): string {
  return randomB64url(32);
}

export function createNonce(): string {
  return randomB64url(32);
}

/**
 * The URL to send the browser to.
 *
 * `prompt: 'select_account'` rather than the default: on a shared machine the
 * default silently reuses whichever Google account is already signed in, which
 * is the wrong behaviour for a device an artisan borrows.
 */
export function buildAuthUrl(opts: { state: string; nonce: string; challenge: string }): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type ExchangeResult =
  | { ok: true; idToken: string }
  | { ok: false; reason: string };

/**
 * Trade the authorization code for tokens.
 *
 * Only the `id_token` is kept. This app never calls a Google API on the user's
 * behalf, so holding an access token would be storing a credential with no
 * purpose — and `id_token` alone carries everything the fork below needs.
 */
export async function exchangeCode(code: string, verifier: string): Promise<ExchangeResult> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });

    if (!res.ok) {
      // Google's body names the real problem (redirect_uri_mismatch,
      // invalid_grant on a replayed code). Logged, never returned: it would
      // tell a prober how far they got.
      const detail = await res.text().catch(() => '');
      console.error('[google] token exchange failed:', res.status, detail.slice(0, 400));
      return { ok: false, reason: 'exchange_failed' };
    }

    const body = (await res.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string' || !body.id_token) {
      return { ok: false, reason: 'no_id_token' };
    }
    return { ok: true, idToken: body.id_token };
  } catch (error) {
    console.error('[google] token exchange threw:', (error as Error)?.message);
    return { ok: false, reason: 'exchange_failed' };
  }
}

// ---------------------------------------------------------------------------
// JWKS
// ---------------------------------------------------------------------------

interface Jwk {
  kid: string;
  n: string;
  e: string;
  kty: string;
  alg?: string;
}

/**
 * Google's signing keys, cached in module scope.
 *
 * Re-fetching on every callback would put a network round-trip on the hot path
 * of every sign-in and hammer Google's endpoint. The keys rotate on the order of
 * days; a one-hour TTL is well inside that, and a `kid` we have never seen
 * forces one immediate refetch regardless of the TTL, which is what makes a
 * mid-cache rotation self-healing rather than an outage.
 */
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJwks(force = false): Promise<Jwk[] | null> {
  const fresh = jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && !force) return jwksCache!.keys;

  try {
    const res = await fetch(JWKS_URI, { cache: 'no-store' });
    if (!res.ok) {
      console.error('[google] JWKS fetch failed:', res.status);
      // A stale cache beats no verification at all — but only if we have one.
      return jwksCache?.keys ?? null;
    }
    const body = (await res.json()) as { keys?: Jwk[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) return jwksCache?.keys ?? null;
    jwksCache = { keys: body.keys, fetchedAt: Date.now() };
    return body.keys;
  } catch (error) {
    console.error('[google] JWKS fetch threw:', (error as Error)?.message);
    return jwksCache?.keys ?? null;
  }
}

/** Reset the cache. Exists for tests and for the runbook's key-rotation step. */
export function resetJwksCache(): void {
  jwksCache = null;
}

// ---------------------------------------------------------------------------
// id_token verification
// ---------------------------------------------------------------------------

export interface GoogleIdentity {
  /** The `sub` claim — the ONLY stable, never-reused Google identifier. */
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export type VerifyResult =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; reason: string };

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/**
 * Verify an `id_token` end to end.
 *
 * The signature check is the part that matters: without it every claim below is
 * attacker-controlled, and "verifying" them would be theatre. Google signs with
 * RS256, so the JWK's modulus and exponent are turned into a public key and the
 * `header.payload` string is checked against the signature.
 *
 * Then, all mandatory:
 *   iss  — one of Google's two published issuer strings
 *   aud  — OUR client id, so a token minted for a different app is refused
 *   exp  — still in the future
 *   nonce— equals the one we put in the cookie, which is what makes a captured
 *          token from another session useless here
 *   email_verified — Google itself vouches for the address
 */
export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<VerifyResult> {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };

    const header = decodeSegment(parts[0]) as { kid?: string; alg?: string };
    if (header.alg !== 'RS256') return { ok: false, reason: 'bad_alg' };
    if (!header.kid) return { ok: false, reason: 'no_kid' };

    // A kid we have not seen means Google rotated; refetch once before failing.
    let keys = await getJwks();
    let jwk = keys?.find((k) => k.kid === header.kid);
    if (!jwk) {
      keys = await getJwks(true);
      jwk = keys?.find((k) => k.kid === header.kid);
    }
    if (!jwk) return { ok: false, reason: 'unknown_kid' };

    const publicKey = crypto.createPublicKey({
      key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
      format: 'jwk',
    });

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    if (!verifier.verify(publicKey, Buffer.from(parts[2], 'base64url'))) {
      return { ok: false, reason: 'bad_signature' };
    }

    const claims = decodeSegment(parts[1]) as {
      iss?: string;
      aud?: string;
      exp?: number;
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
      nonce?: string;
    };

    if (!claims.iss || !VALID_ISSUERS.has(claims.iss)) return { ok: false, reason: 'bad_iss' };
    if (claims.aud !== CLIENT_ID) return { ok: false, reason: 'bad_aud' };
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    // Constant-time so a nonce cannot be walked a byte at a time. Both are our
    // own base64url strings, so equal length is the normal case.
    const a = Buffer.from(String(claims.nonce ?? ''), 'utf8');
    const b = Buffer.from(expectedNonce, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad_nonce' };
    }
    if (claims.email_verified !== true) return { ok: false, reason: 'email_unverified' };
    if (!claims.sub || !claims.email) return { ok: false, reason: 'incomplete' };

    return {
      ok: true,
      identity: {
        sub: claims.sub,
        email: claims.email.toLowerCase().trim(),
        name: (claims.name || claims.email.split('@')[0]).slice(0, 120),
        picture: typeof claims.picture === 'string' ? claims.picture.slice(0, 500) : null,
      },
    };
  } catch (error) {
    console.error('[google] id_token verification threw:', (error as Error)?.message);
    return { ok: false, reason: 'malformed' };
  }
}
