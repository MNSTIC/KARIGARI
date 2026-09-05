/**
 * What a KARIGARI patch QR encodes, and how to read it back.
 *
 * The sticker carries the public passport URL with a scan marker:
 *   `${origin}/verify/${patchId}?scan=1`
 *
 * The path segment IS the patch id — it is never repeated in the query. That
 * keeps an external scan (phone camera, Google Lens) landing on the passport
 * page exactly as it always has, while an in-app scan can pull the id straight
 * out of the URL and skip making the buyer type it.
 */

/** The marker that says a QR — not a hand-typed visit — is the source. */
export const SCAN_QUERY_KEY = "scan";
export const SCAN_QUERY_VALUE = "1";

/** Build the URL a patch QR should encode. Origin is always the live one. */
export function buildPatchVerifyUrl(origin: string, patchId: string): string {
  return `${origin}/verify/${patchId}?${SCAN_QUERY_KEY}=${SCAN_QUERY_VALUE}`;
}

/**
 * Pull a patch id out of decoded QR text.
 *
 * Accepts a full passport URL (only when it points at THIS origin — a QR from
 * some other site must never be treated as one of ours) or a bare patch id
 * typed/encoded on its own. Returns null when the text is neither.
 */
export function parseScannedPatchId(decoded: string, origin: string): string | null {
  const text = (decoded || "").trim();
  if (!text) return null;

  // Only treat the text as a URL when it actually looks like one. Resolving a
  // bare code against `origin` would silently succeed (`P-7F3K9Q` becomes
  // `<origin>/P-7F3K9Q`) and swallow the bare-code case entirely.
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || text.startsWith("//") || text.startsWith("/");

  if (looksLikeUrl) {
    try {
      const url = new URL(text, origin);
      // A QR from some other site must never be treated as one of ours.
      if (url.origin !== origin) return null;
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length >= 2 && segments[0] === "verify") {
        return decodeURIComponent(segments[1]) || null;
      }
    } catch {
      return null;
    }
    return null;
  }

  // A bare code is still usable, but only if it looks like one — never echo
  // back an arbitrary sentence scanned off some unrelated label.
  return /^[A-Za-z0-9_-]{4,64}$/.test(text) ? text : null;
}
