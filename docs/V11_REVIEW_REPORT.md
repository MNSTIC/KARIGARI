# V11 Review Report — AI Photo Studio & Shopify artisan shops

Prompt 3 of `KARIGARI_PHOTO_STUDIO_SHOPIFY_V11_MASTER_PROMPT.md`. Every result
below was produced by running code or reading it in this session; where a trace
was walked in code rather than executed, it says so.

---

## A. Gates

```
$ npx prisma generate
✔ Generated Prisma Client (v7.10.0) to .\node_modules\@prisma\client in 559ms

$ npx tsc --noEmit
(no output)            exit 0

$ npm run lint
✖ 290 problems (114 errors, 176 warnings)

$ npm run build        (dev server stopped first)
▲ Next.js 16.3.1 (webpack)
✓ Compiled successfully in 71s
  Finished TypeScript in 23.8s ...
  ƒ /api/artisan/shopify  ƒ /api/artisan/shopify/publish  ƒ /api/artisan/shopify/test
  ƒ /api/items/backdrop   ƒ /api/items/background
exit 0
```

**Lint is not zero, and none of it is V11.** The 290 problems were the baseline
before V11 began (recorded at the start of the work, including the owner's own
uncommitted files). Every file V11 created lints with **0** problems, and every
pre-existing file V11 edited has exactly its `HEAD` count:

| File | HEAD | Now |
|---|---|---|
| src/components/CaptureModal.tsx | 15 | 15 |
| src/app/api/items/capture/route.ts | 4 | 4 |
| src/app/api/verify-authenticity/route.ts | 5 | 5 |
| src/app/api/admin/simulate-sale/route.ts | 3 | 3 |
| verify-payment, syndicate, attach-verify, verify-ready, listings, market page, complete-draft | 0 | 0 |

Clearing the 114 pre-existing errors means editing unrelated features and the
owner's uncommitted files; that was deliberately not done in a V11 review.

**Gates that needed live services:** the database gates ran against the real
Supabase demo database. **No gate or trace used real Shopify credentials** —
there is no store (see §H).

---

## B. Full-file sweep

- `enhanceProductPhoto` has one caller (`CaptureModal`, the flag-off path), still
  compiles, and its output is unchanged: the refactor's shared tone map was
  proven pixel-identical (**0 of 20,000** random frames differ, re-run after the
  last edit).
- Every Prisma `select`/`include` is type-checked by `tsc` against the generated
  client — clean.
- i18n (throwaway script, run after the last change):
  ```
  t() literal calls checked: 219; indirect V11 keys checked: 36
  en: 1273 keys, missing 0, extra 0, V11 strings identical to English 0
  hi: 1273 keys, missing 0, extra 0, V11 strings identical to English 0
  or: 1273 keys, missing 0, extra 0, V11 strings identical to English 0
  te: 1273 keys, missing 0, extra 0, V11 strings identical to English 0
  every key resolves in all four dictionaries
  ```

### Findings

| # | File · line | Severity | Defect | Fix | Verified |
|---|---|---|---|---|---|
| 1 | `src/app/api/items/capture/route.ts`, `…/complete-draft/route.ts`, `…/artisan/listings/route.ts` (PATCH) | **Critical** | Since comparators read `originalImageUrl`, a client could store a *different or AI-redrawn product* as the listing "look" while every buyer and QR check still passed against the real frame. | New `src/lib/lookProvenance.ts`: gradient-structure correlation on a 256 px grid, frame → cutout → look. Capture/draft replace an unprovable look with the camera frame and note it; the PATCH returns 422. Thresholds calibrated on 60 seed photos: every genuine look passed, every substituted, mirrored or redrawn product failed. | 13/13 unit; A6 traces T10c (capture), T7c (PATCH 422); a real browser-composed look passed (0.985 / 0.968) |
| 2 | `next.config.ts` · tracing | **Critical** | The server-cutout function traced `onnxruntime_binding.node` but not `libonnxruntime.so.1.17.3` it links, nor the 84 MB model (22 hash-named chunks resolved at runtime). With `SERVER_CUTOUT_ENABLED=true` on Linux every call would fail. | `outputFileTracingIncludes` adds Linux x64 runtime libs and exactly the medium-model chunks (read from `resources.json`); excludes other platforms. | Rebuilt: 22 chunks + `.so` in the trace. Projected Linux x64 function **124.3 MB** / 250 MB |
| 3 | `src/lib/imageEnhance.ts` · `shrinkCutout` | **High** | A detailed piece's 900 px PNG cutout measured **773 KB**, over the 700 KB cap → dropped → the artisan's studio look lost (and, after #1, unprovable). | WebP with alpha, then PNG, at 900/760/640/520 px until ≤ 650 KB; server accepts WebP cutouts. | Same jug: **80–92 KB**; A6 traces 22/22 |
| 4 | `src/lib/shopify.ts` · `productHandleFor` | **High** | `patchId` is indexed, not unique. Two pieces sharing one would share a handle, and the `productSet` upsert would overwrite one product with the other. | Handle = `karigari-<patch>-<8 hex of item id>`. | Shopify S13 |
| 5 | `src/lib/shopify.ts` · `ensureArtisanShop` | **High** | Adopt-by-handle could adopt a collection another artisan's row owns (id-prefix collision). | 8-hex suffix (was 6) **and** an ownership check before adopting. | Shopify S13 |
| 6 | `src/app/api/admin/simulate-sale/route.ts` | **High** | Only the Razorpay path withdrew a sold piece from Shopify; an admin-recorded sale left it buyable. | Same `after(() => withdrawSoldPiece(id))`. | Code walk; `withdrawSoldPiece` itself S11 |
| 7 | `src/app/api/artisan/shopify/publish/route.ts` | Medium | Another artisan's item returned 404; trace 20 requires 403. | Ownership checked after an unscoped read → 403, nothing written. | Route R3 |
| 8 | `src/lib/photoStudioPayload.ts` | Medium | Original frame capped at 1 MB; a detailed 1280 px JPEG could exceed it, dropping the provenance frame. | `MAX_ORIGINAL_BYTES = MAX_UPLOAD_BYTES` (2 MB). | Payload 13/13 |
| 9 | Next 16.3 `collect-build-traces.js` | Low — **not fixed** | `outputFileTracingExcludes` is joined with `\` on Windows and matches nothing; a local Windows build over-reports the function (~179 MB). | Upstream behaviour; documented in `next.config.ts` and the runbook. A Linux build is unaffected. | Read in source |
| 10 | `src/lib/photoGate.ts` | Low — **not fixed** | After one retake a severe problem is shown as SOFT advice using the retake wording ("…then take it again"). Advisory, not a prompt. | Left: the wording is still accurate guidance; a separate soft string per cause is a copy change for the owner. | Gate 17/17 |

Fixed earlier in Prompt 2, re-verified here (plan §8): on-device timeout → server
fall-through; cutout-rejection guard; `productSet` upsert; skip-duplicates shop
claim; withdraw-on-sale; stock of 1; LIVE stays LIVE on a failed update.

---

## C. Photo Studio traces

| # | Trace | How verified | Result |
|---|---|---|---|
| 1 | Sharp, well-lit → silent pass, gallery, Original first | Gate truth table; live browser run (A6) | PASS. Live: no prompt, Original first and checked, 7 looks, radiogroup with one tab stop |
| 2 | Severe blur → RETAKE with reason; "Use anyway" proceeds; never prompted after one retake | Truth table (severe blur → `photo_retake_blurry`; after retake → SOFT); live RETAKE (mismatch) with equal 373×44 buttons, `role=status`, no `role=alert`; "Use anyway" built 7 looks and noted it | PASS. `photoRetakeCount` counts retakes taken; "use anyway" is recorded in `photoQualityNotes` |
| 3 | Cheap-camera middling photo → SOFT, flow continues | Truth table (score 6 mild blur → SOFT); calibration: mild softness p05 Laplacian 409 vs RETAKE threshold 120; live: local hint "A little soft, but fine to use" and a SOFT AI verdict | PASS — SOFT is the common case |
| 4 | WebGPU → ON_DEVICE; no WebGPU → SERVER; neither → NONE | Live: ON_DEVICE (warm, 1.5 s); SERVER (on-device timeout → server, 18.8 s); NONE via cutout rejection. "No WebGPU and server disabled" walked in `obtainCutout()` | PASS (the last case by code walk) |
| 5 | Gemini unconfigured → no AI claim | Code walk: `generateContentWithFallback` throws 401 → route 500 → client `unavailable` → `HEURISTIC\|UNCHECKED`, green banner only for `source === 'AI'`; backdrop `unconfigured`. Live equivalent: Gemini timed out → "Photo check unavailable", no AI banner, stored `HEURISTIC`, score null | PASS |
| 6 | Malformed Gemini JSON → FALLBACK, accepted, not blocked | Code walk (`vision-verify` parse catch → `scoreSource: FALLBACK`; client `unchecked(false)`) | PASS by code walk — Gemini cannot be made to return malformed JSON on demand |
| 7 | Each variant → exact `images[0]`; original + enhanced persist; resumed draft keeps variants | A6 T4–T7 (capture, picker to ORIGINAL, to a preset); live browser capture stored PRESET_CREAM with original + enhanced | PASS. `complete-draft` accepts and persists the studio fields; the IVR `CompleteDraftModal` does not run the studio, so real drafts carry none |
| 8 | **Provenance** | Code: comparators use `provenanceReference`; `backdropGen` sends `contents: [{ text }]` only; cutout drawn last in `composeOnBackdrop`. **Found and fixed finding #1**, then verified 13/13 + T10c + T7c | PASS after fix |
| 9 | 4 MB photo payload | Live: a **4.78 MB** 12 MP JPEG | Request **665 KB**; stored **549 KB** total: listing 101, original 119, enhanced 116, `imageVariants` 213 KB JSON (7 thumbnails ≈ 11 KB, one 80 KB WebP cutout). No full-resolution copies of looks |
| 10 | Main thread | `SHARPEN_MAX_PIXELS` still gates sharpen; `yieldToBrowser()` between every heavy pass incl. new ones; `if (!nav.gpu) return false` intact | PASS |

## D. Shopify traces

Library against a stateful fake Admin API (30/30), routes against the dev server
pointed at an unreachable store (15/15).

| # | Trace | Result |
|---|---|---|
| 11 | Unconfigured → card absent, routes 503 with a sentence, hub unaffected | PASS — both routes 503 "Shopify publishing is not set up on this deployment."; card returns null; export chips and matrix render |
| 12 | First publish → collection, row, real price, chosen image, collection membership, Online Store, LIVE | PASS (S1, S3): `21243.00` rupees, staged upload of the chosen photo, collection published, ids persisted; route marks LIVE after this |
| 13 | Second publish → no duplicate | PASS (S4): same product, no re-upload, stock untouched |
| 14 | Same-name artisans → distinct handles | PASS (S13) after finding #5 |
| 15 | Concurrent first publishes → one collection | PASS (S1): one `collectionCreate`; loser re-reads |
| 16 | Partial failure → FAILED with reason; Retry resumes | PASS (S6): "product was created but is not on your shop page yet…", productId kept, retry → same product |
| 17 | 200 with `userErrors` → failure | PASS (S7) |
| 18 | Throttled → backoff with jitter, bounded, "busy" | PASS (S8): 2 THROTTLED → ok after 1.7 s; 3 → `throttled`, 1.6 s, no loop |
| 19 | Invalid / under-scoped token → distinct messages; token never exposed | PASS (S9, R9): auth vs scope (names `write_products`) vs network; no token in any response; client-bundle scan: 0 files contain the token name, `shpat_` or `X-Shopify-Access-Token` |
| 20 | Artisan A publishes B's item → 403, nothing written | PASS (R3) after finding #7 |

## E. Security and performance

- `NEXT_PUBLIC_` in `src/`: `BASE_URL`, `GOOGLE_AUTH_ENABLED`, `PASSKEY_ENABLED`, `PHOTO_STUDIO_ENABLED`, `RAZORPAY_KEY_ID` (publishable), `SHOPIFY_ENABLED` — all genuinely public.
- Production client bundle scanned for `SHOPIFY_ADMIN_ACCESS_TOKEN`, `shpat_`, `GEMINI_API_KEY`, `JWT_SECRET`, `RAZORPAY_KEY_SECRET`, `X-Shopify-Access-Token`, `backdropGen`, `generateContent`: **0 files each**.
- No N+1: `GET /api/artisan/shopify` is two queries; the publish route adds one count. `CraftItem` has `@@index([artisanId])` and `@@index([shopifyStatus])`; `ShopifyShop.artisanId` is unique.
- Server cutout: 2 MB input cap, ≤ 1024 px, 20 s hard timeout, 2 in flight, 1 per artisan.
- `vision-verify` downscales before the model call (`prepareForVision`: live 119 KB → 52 KB) and still tries at most 3 models.
- Look provenance costs ~72 ms per capture.

## F. UX and accessibility

- Gallery: `role=radiogroup` named by its heading; roving tabIndex (one tab stop); Arrow/Home/End move **and** select (live: 3× ArrowRight → Cream checked and focused); alt "Your craft — Cream"; focus ring `ring-[var(--color-maroon)]`; selected `ring-2` + `shadow-card` (computed box-shadow confirmed).
- Retake prompt: `role=status` + `<h4>`, not `role=alert`; two equal buttons.
- Shopify card at 360 px: body overflow 0, every control 44 px; status flip keeps row height constant (189 px through Retry → Publishing → Failed).
- Loading / empty / error / unsupported states present on the studio, the picker and the card.
- Theme audit: new UI uses only `--color-maroon, -rust, -pill, -sage, -mint, -green-50/700, -red-50/700`; canvas presets read tokens live; no new radius, shadow or font.

## G. Documentation

Updated `ARCHITECTURE.md` (no longer claims `/artisan/market` is a stub; capture
pipeline; channel modes; Shopify status machine; models; gap table),
`docs/CONTRACT.md` (every new or changed endpoint with its guard; invariants),
`README.md` (Photo Studio, Shopify setup, one-store model, env block,
`prisma db push`), new `docs/PHOTO_STUDIO_RUNBOOK.md` (token rotation, stuck
PUBLISHING, bulk retry via new `scripts/shopify-retry-failed.ts`, rollback,
server-cutout licence and size), and plan §8.

## H. Left undone, and why

- **No real Shopify store.** Every Shopify path is verified against a fake that
  follows the current Admin reference and against an unreachable store. Exact
  mutation shapes, the staged upload and `productSet` behaviour must be confirmed
  on the first real publish (runbook §1.1).
- **Shopify sales do not flow back into Karigari.** A piece sold on Shopify is
  not marked sold here. With `SHOPIFY_LOCATION_ID`, Shopify stops at stock 0;
  Karigari's listing must be closed by hand. A Shopify orders webhook is the fix
  and was out of V11's scope.
- **Lint baseline of 114 errors** — pre-existing, not V11 (§A).
- **`next start` smoke test** was not run. The launcher started the dev server
  instead. Both production builds passed, and every route trace ran against the
  dev server on the final code.
- **Traces 5 and 6** (Gemini unconfigured / malformed JSON) and the "no WebGPU,
  server disabled" leg of trace 4 were walked in code, not forced live.
- **Provenance limit:** a product redraw subtle enough to survive a 256 px grid
  is below what `lookProvenance` can see; the physical QR check remains the
  backstop.
- **Nothing is committed.** `.env` gained `NEXT_PUBLIC_PHOTO_STUDIO_ENABLED=true`
  and `SERVER_CUTOUT_ENABLED=true` for local testing (gitignored).
