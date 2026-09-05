/**
 * What a KARIGARI patch QR encodes, and how to read it back.
 *
 * The sticker carries the VERIFICATION GATE, not the passport:
 *   `${origin}/buyer/verify?patchId=<patchId>&scan=1`
 *
 * The patch id rides in the query, so the QR still carries the real identity
 * of the piece and still points at this origin. What changed is where it
 * lands: anyone scanning the physical sticker — Google Lens, the phone camera,
 * any generic reader — arrives at `/buyer/verify` and has to prove they are
 * holding the object (patch id + a photo of the product with its QR) before
 * the Digital Craft Passport opens.
 *
 * That is the point. The passport shows provenance, price, and the artisan's
 * story; handing all of it to anyone who photographs a sticker in a shop
 * window makes the QR a broadcast rather than a proof. After a successful
 * check the gate forwards to the passport at `/verify/<patchId>?scan=1`, which
 * is still directly reachable for people who are already entitled to it — the
 * buyer from My Orders, the artisan from their dashboard.
 */

/** The marker that says a QR — not a hand-typed visit — is the source. */
export const SCAN_QUERY_KEY = "scan";
export const SCAN_QUERY_VALUE = "1";

/** The query key carrying the patch id on the gate URL. */
export const PATCH_QUERY_KEY = "patchId";

/** Where the gate lives. */
export const VERIFY_GATE_PATH = "/buyer/verify";

/**
 * What a printed patch QR encodes: the verification gate, carrying the piece's
 * real patch id. This is the string that goes into the sticker.
 */
export function buildPatchScanUrl(origin: string, patchId: string): string {
  const params = new URLSearchParams({
    [PATCH_QUERY_KEY]: patchId,
    [SCAN_QUERY_KEY]: SCAN_QUERY_VALUE,
  });
  return `${origin}${VERIFY_GATE_PATH}?${params.toString()}`;
}

/**
 * The Digital Craft Passport for a piece — where the gate forwards to once the
 * scan verifies, and where an entitled viewer (buyer, artisan) links directly.
 */
export function buildPassportUrl(origin: string, patchId: string): string {
  return `${origin}/verify/${encodeURIComponent(patchId)}?${SCAN_QUERY_KEY}=${SCAN_QUERY_VALUE}`;
}

/**
 * Pull a patch id out of decoded QR text.
 *
 * Accepts, in order:
 *   - the gate URL          `/buyer/verify?patchId=<id>`   (what we now print)
 *   - the passport URL      `/verify/<id>`                  (stickers already
 *                                                            in the field)
 *   - a bare code           `PATCH-XXXX-1234`
 *
 * A URL is only trusted when it points at THIS origin — a QR from some other
 * site must never be mistaken for one of ours. Returns null otherwise.
 */
export function parseScannedPatchId(decoded: string, origin: string): string | null {
  const text = (decoded || "").trim();
  if (!text) return null;

  // Only treat the text as a URL when it actually looks like one. Resolving a
  // bare code against `origin` would silently succeed (`P-7F3K9Q` becomes
  // `<origin>/P-7F3K9Q`) and swallow the bare-code case entirely.
  const looksLikeUrl =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || text.startsWith("//") || text.startsWith("/");

  if (looksLikeUrl) {
    try {
      const url = new URL(text, origin);
      // A QR from some other site must never be treated as one of ours.
      if (url.origin !== origin) return null;

      // The gate form: /buyer/verify?patchId=<id>
      const fromQuery = url.searchParams.get(PATCH_QUERY_KEY);
      if (fromQuery && fromQuery.trim()) return fromQuery.trim();

      // The legacy passport form: /verify/<id>. Patches printed before the
      // gate existed are still in artisans' hands and must keep working.
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
