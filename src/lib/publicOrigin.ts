/**
 * The origin to put in a link someone else will open — an affiliate link, a
 * bank share link.
 *
 * A configured public base URL wins, because behind a tunnel or proxy the
 * request's own origin is the internal one and a link built from it would not
 * open anywhere else. Without one, the request origin is the best available
 * answer (local development, a direct deployment).
 */
export function publicOrigin(req: Request): string {
  const configured = (process.env.NEXT_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(req.url).origin;
}
