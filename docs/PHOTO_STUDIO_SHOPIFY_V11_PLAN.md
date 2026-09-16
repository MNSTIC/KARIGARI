# KARIGARI V11 — AI Photo Studio & Shopify Artisan Shops

Blueprint and schema diff. No feature code lands in this stage.

Every claim below was checked against the code at commit `538a705` (or measured
live) before it was written down. Where the ground truth disagreed with the
brief, the disagreement is stated and the design follows the code.

---

## 0. Ground truth — what is actually there

### Photo pipeline

| # | Brief said | Verified | Consequence for the design |
|---|---|---|---|
| A1 | Quality score exists but never acts; parse fallback `{match:true, score:8}` masquerades as a real check | **Confirmed, and narrower than stated.** A 5xx or thrown request is *already* handled honestly: `CaptureModal` shows `vision_unavailable_*` and lets capture continue. The masquerade is only the **JSON-parse** path, which returns `success:true, score:8` and the client treats it as a real verdict. | `scoreSource: 'FALLBACK'` targets exactly that path. The 5xx path already behaves correctly and stays. |
| A1b | — | `photoQualityScore` and `bgRecommendation` are set in state and **never rendered and never persisted** (not in `CapturePayload`). | The score has never reached the screen or the row. Persisting it is new, not a fix. |
| A1c | — | `match:false` is a **hard dead end today**: the only control is "Try another photo". | The lenient gate must replace a real wall, not just add one. |
| A1d | — | **`/api/items/vision-verify` has no auth guard.** Any anonymous request spends the shared Gemini quota. Its only caller is `CaptureModal` (artisan-only). | Add `requireArtisan()`. Safe: nothing else calls it. |
| A2 | `canRunBackgroundRemoval()` hard-requires WebGPU | **Confirmed** (`if (!nav.gpu) return false`), plus ≥4 GiB memory, ≥4 cores, not 2g/3g/saveData. None of these helpers are exported. | Server fallback is justified. The helpers are reused inside the module, not exported wholesale. |
| A3 | Enhanced frame destroys the original | **Confirmed.** `downscaleImage(enhanced.dataUrl)` replaces `images[0]` via `setImages`. | Named columns (§1). |
| A3b | — | **`/api/items/capture` has no size or count cap on `images`** (only the bill is capped). `complete-draft` caps count at 4 but not bytes. | Server-side caps are mandatory once variants exist — a client cap alone is not a guard. |
| A3c | "a resumed draft keeps its variants" via `complete-draft` | `complete-draft` is called **only by `CompleteDraftModal`** (IVR voice drafts). In-app "resume" is the **offline queue** (`queueCapture` → IndexedDB → replay of `POST /api/items/capture`). | Both paths accept the new fields. `CapturePayload` gains them as optional so an old queued row still replays. |
| A4 | Generative scene via Gemini image model | Image models are *listed* on the key (`gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-2.5-flash-image`, …). **A real call to each returned 429 with `limit: 0`** on `generate_content_free_tier_requests` — the free tier has **no image-generation quota at all**. | The generative tier is built as specified and silently absent. **On the current key it will never appear.** The canvas presets are the real feature. §4 states this in the UI copy too. |
| A4b | Provenance: `buyerVerify` compares against `images[0]` | **Four** comparators read `images[0]`: `src/lib/buyerVerify.ts:224`, `api/artisan/orders/verify-ready:163`, `api/items/attach-verify:471`, `api/verify-authenticity:30`. | All four move to `originalImageUrl ?? images[0]` (§4.6). The chosen *look* can then never be the frame authenticity is judged against. |
| A4c | — | Today the cutout passes through `enhanceOnCanvas`, which applies white balance, a levels LUT and a 3×3 sharpen **to the product pixels**. | "Pixels untouched" needs a precise definition (§4.5), not a slogan. |
| A4d | — | Captured thumbnails in step 2 render with CSS `brightness-110 contrast-105 saturate-110` once verified. | The gallery must show true pixels. That filter goes. |

### Dependency: `@imgly/background-removal-node`

Measured with `npm view`, not assumed:

- **Size.** The package is **133 MB** unpacked and depends on `onnxruntime-node ~1.17.0` (**102–139 MB** unpacked, native binaries for several platforms). Together **235–272 MB before anything else** — against Vercel's **250 MB unzipped per-function limit**.
- **Duplicate `sharp`.** It pins `sharp ~0.32.4`; the app runs `sharp 0.35.4`. A second native `sharp` is installed alongside.
- **License: AGPL-3.0.** The browser package already in `package.json` (`@imgly/background-removal`) is AGPL-3.0 too (read from its `LICENSE.md`). Running the model *server-side* engages AGPL §13 (network interaction): users of the service can be entitled to the corresponding source. Fine for an open demo; a real obligation for a closed commercial product.

Mitigations, all in the design: the server tier sits behind `SERVER_CUTOUT_ENABLED` (default `false`), the package is a `serverExternalPackages` entry so the bundler never inlines it, non-Linux ONNX binaries are excluded from output tracing, and Prompt 3 measures the traced size of the route rather than hoping.

### Shopify

- The Admin API is scoped to one store and cannot create stores. `developmentStoreCreate` is Partner API and produces non-transacting dev stores. **One platform store; one collection per artisan.**
- Mutation shapes were checked against the Admin GraphQL reference (2026-01; the default `SHOPIFY_API_VERSION` is `2026-07`, same shapes):
  - `productCreate(product:, media:)` creates **one default variant** and leaves the product **unpublished**.
  - Price goes on that variant via `productVariantsBulkUpdate(productId, variants:[{id, price}])`.
  - `stagedUploadsCreate` returns `url` + `parameters` + `resourceUrl`; the documented attach path is **`productUpdate(product:{id}, media:[{originalSource: resourceUrl}])`** (not the older `productCreateMedia`).
  - `collectionCreate(input:)` returns the real `handle` Shopify assigned.
  - `publishablePublish(id, input:{publicationId})` publishes a product **or a collection**.
- **The brief omits one required step:** a custom collection is itself unpublished on creation. Unless the collection is published to the Online Store too, the artisan's shop URL `/collections/<handle>` **404s**. `ensureArtisanShop()` publishes it.
- `/api/items/[id]/thumbnail` requires the artisan's session cookie, so Shopify cannot fetch from it. **Images cross via staged uploads.**
- Every existing channel in `src/lib/syndication.ts` is export-only, and `normalizePlatforms()` is what lets `/api/artisan/syndicate` stamp `syndicatedChannels`. **If `SHOPIFY` were simply appended to `SYNDICATION_PLATFORMS`, the master switch would stamp it as "published" without transmitting anything** — exactly the dishonesty B2 warns about. §5.6 prevents it structurally.

### Colour tokens (for the Shopify states)

`--color-mint` is `#ECE7E0` — a warm grey, not a green. The real ramps are `--color-green-50…900` (muted olive) and `--color-red-50…900` (maroon family). Live = green ramp; failed = red ramp.

---

## 1. Prisma diff

No `prisma/migrations/` directory exists. The change lands via
`npx prisma db push --url "$DIRECT_URL"` (the pooler cannot carry DDL) then
`npx prisma generate`, and **the dev server must be restarted** afterwards — a
running `next dev` keeps the old client in memory and every route that selects a
new field silently returns an empty result. Every new column is nullable or
defaulted, so existing rows survive untouched.

```prisma
model User {
  // …existing fields…
  /// The artisan's shop inside the platform Shopify store. One-to-one.
  shopifyShop ShopifyShop?
}

model CraftItem {
  // …existing fields…

  // ---- V11: AI Photo Studio -------------------------------------------------
  //
  // `images[0]` is still the listing photo every surface reads. These columns
  // exist because the enhance pass used to REPLACE the camera frame with no copy
  // kept and no choice offered. Ordering-by-convention inside `images[]`
  // ("[0] is chosen, [1] is original, [2] is enhanced") is not a contract: every
  // existing writer treats `images` as "the artisan's photos", `complete-draft`
  // slices it to four, and the listing grid happily renders `[1]` as a second
  // product shot. Named columns cannot be reshuffled by a writer that never
  // heard of the convention.

  /// The frame the camera produced, downscaled for storage and otherwise
  /// untouched. Written by /api/items/capture and complete-draft. This — not
  /// the chosen look — is what every authenticity comparator reads (see
  /// `provenanceReference()`), so a background swap can never become the thing
  /// a buyer's delivered piece is judged against.
  originalImageUrl     String?
  /// The canvas-enhanced frame (white balance, levels, sharpen). Same writers.
  enhancedImageUrl     String?
  /// Key of the variant currently in `images[0]`: ORIGINAL | ENHANCED |
  /// PRESET_<name> | GENERATED_<n>. Written at capture and by the listing
  /// picker via /api/artisan/listings.
  selectedImageVariant String?
  /// `{ v: 1, variants: [{ key, label, kind, thumb }], cutout? }`. Thumbnails
  /// only (≤320 px), plus an optional downscaled transparent cutout so the
  /// picker can re-render a preset later. NEVER full-resolution copies of every
  /// look — the server drops this blob rather than storing an oversized one.
  imageVariants        Json?
  /// 1–10. Written only when a score was actually produced — see the source.
  photoQualityScore    Int?
  /// The specific, human reason behind the verdict ("very blurry…").
  photoQualityNotes    String?
  /// AI | HEURISTIC | UNCHECKED. AI = Gemini scored this frame. HEURISTIC =
  /// only the on-device blur/exposure pre-check ran (the vision call failed or
  /// returned an unreadable reply). UNCHECKED = neither ran. A fallback can
  /// therefore never be mistaken for an AI verdict, on screen or in reports.
  photoQualitySource   String?
  /// How many times the artisan retook this photo. The gate stops prompting
  /// after the first retake, whatever the score.
  photoRetakeCount     Int       @default(0)
  /// ON_DEVICE | SERVER | NONE — which tier produced the cutout, so a "no
  /// background removal" outcome is recorded rather than implied.
  backgroundRemovalMode String?

  // ---- V11: Shopify ---------------------------------------------------------
  //
  // The FIRST channel that performs a real outbound write. Every other channel
  // in src/lib/syndication.ts only stamps `syndicatedChannels`. These fields
  // are written by exactly one route, POST /api/artisan/shopify/publish.

  /// gid://shopify/Product/…, recorded the moment productCreate returns — the
  /// resume point for a retry, so a failed image attach never causes a second
  /// product to be created.
  shopifyProductId     String?
  /// The default variant productCreate made; the price is written onto it.
  shopifyVariantId     String?
  /// Deterministic `karigari-<patchId|itemId>` handle. Also the idempotency
  /// key: before creating, the route looks the handle up in Shopify and adopts
  /// an existing product, which covers a crash between create and this write.
  shopifyHandle        String?
  /// NOT_PUBLISHED | PUBLISHING | LIVE | FAILED. Monotonic except FAILED →
  /// PUBLISHING on an explicit retry.
  shopifyStatus        String?
  /// When `shopifyStatus` last changed. Lets a PUBLISHING claim that outlived
  /// its request (a killed function) be taken over after a timeout instead of
  /// wedging the item forever.
  shopifyStatusAt      DateTime?
  shopifyPublishedAt   DateTime?
  /// The actionable sentence shown beside Retry. Never a stack trace.
  shopifySyncError     String?
  /// Which `selectedImageVariant` is currently on Shopify, so a re-publish
  /// after the artisan changes the look replaces the image and one without a
  /// change does not re-upload it.
  shopifySyncedImageKey String?

  @@index([shopifyStatus])
}

/// An artisan's shop: a custom collection inside the ONE platform store.
///
/// Shopify's Admin API cannot create a store per artisan. The shareable
/// `shopUrl` below IS their shop. Written only by `ensureArtisanShop()`.
model ShopifyShop {
  id               String    @id @default(uuid())
  /// @unique is the concurrency guard: the row is CLAIMED before the Shopify
  /// collection is created, so two simultaneous first publishes cannot both
  /// create a collection — the loser hits the constraint and re-reads.
  artisanId        String    @unique
  artisan          User      @relation(fields: [artisanId], references: [id])
  /// Null while status is CREATING.
  collectionId     String?
  /// The handle Shopify actually assigned (it suffixes on collision).
  collectionHandle String?
  shopUrl          String?
  /// CREATING | ACTIVE | FAILED
  status           String    @default("CREATING")
  productCount     Int       @default(0)
  createdAt        DateTime  @default(now())
  lastSyncedAt     DateTime?
}
```

Two fields beyond the brief, each earning its place: `shopifyStatusAt` (stale-claim recovery) and `shopifySyncedImageKey` (don't re-upload an unchanged image). `ShopifyShop.collectionId/handle/shopUrl` are nullable because the row is claimed before the collection exists.

---

## 2. The quality gate

Product-owner instruction: **lenient**. A photo the artisan cannot improve must never be a wall.

### Server verdict inputs (`/api/items/vision-verify`)

Existing: `match`, `score` (1–10), `bg_ok`, `recommended_bg`, `display`, `craft_details`.
New in Task 2: `blur: none|mild|severe`, `exposure: ok|dark|blown`.
New derived: `retakeAdvice: PASS|SOFT|RETAKE`, `retakeReason`, `scoreSource: AI|FALLBACK`.

### Decision table

Evaluated top to bottom; first match wins.

| # | Condition | Advice | UI |
|---|---|---|---|
| 1 | `scoreSource = FALLBACK` | **PASS** | No quality claim at all. `photoQualitySource = HEURISTIC` if the local pre-check ran, else `UNCHECKED`. If the local pre-check said `unusable`, show its hint as **SOFT** copy (the local check only ever warns). |
| 2 | `photoRetakeCount ≥ 1` and rule 3 would fire | **SOFT** | The reason is shown as advice. Never prompted twice. |
| 3 | `match = false` **or** `blur = severe` **or** `score ≤ 3` **or** (`exposure ∈ {dark, blown}` **and** `score ≤ 4`) | **RETAKE** | Retake prompt with **Use this photo anyway** as an equal button. |
| 4 | `score ≥ 7` **and** `blur ≠ severe` **and** `exposure = ok` | **PASS** | Silent. Mild blur at 7+ is a cheap sensor, not a problem. |
| 5 | anything else (`score 4–6`, or `exposure ≠ ok` with `score ≥ 5`) | **SOFT** | Advice inline above the gallery; flow continues. |

`bg_ok = false` alone never lowers the advice: the background is exactly what the studio replaces. It feeds the "why we suggest this" note instead.

**The common case is SOFT, not RETAKE.** A cheap-camera photo lands at score 4–6 with mild blur → rule 5. RETAKE needs a genuine mismatch, severe blur, or a score of 3 or below.

### `match = false` and "Use this photo anyway"

The brief requires no dead end, and `match:false` is a dead end today. Allowing it through is a provenance trade-off, stated rather than hidden:
- `photoQualityNotes` records `"AI could not match this photo to the description"` so the **admin verification queue** sees it.
- The piece still cannot be sold until **QR attach-verify** matches a photo of the physical patched piece against the original frame — a mismatched listing photo fails there.

### Messages (i18n keys, specific and kind)

| Trigger | Key | English |
|---|---|---|
| `blur = severe` | `photo_retake_blurry` | "This photo is very blurry. Hold the phone still, tap the craft on the screen to focus, then take it again." |
| `exposure = dark` | `photo_retake_dark` | "This photo is too dark to see the craft. Move near a window or a bright light and try again." |
| `exposure = blown` | `photo_retake_blown` | "Strong light has washed out the colours. Step out of direct sunlight, or turn the craft away from the light." |
| `match = false` | `photo_retake_mismatch` | "We could not see the craft you described in this photo. Make sure the whole piece is in the frame." |
| `score ≤ 3` (none of the above) | `photo_retake_unclear` | "The craft is hard to see clearly. Try a plain background and fill the frame with the piece." |
| SOFT, mild blur | `photo_soft_blurry` | "A little soft — fine to use. Holding the phone steadier would make the weave sharper." |
| SOFT, generic | `photo_soft_generic` | "Usable. Better light would show the colours more truly." |

Never "rejected", "failed" or "invalid". The retake prompt is `role="status"` with a heading, not `role="alert"` — screen readers announce it as guidance.

---

## 3. Client-side pre-check (`src/lib/photoQuality.ts`)

Offline, instant, dependency-free. Runs before the Gemini call so the artisan gets feedback while the network is still working. **It only ever warns** — the authoritative verdict is the server's, and a local `unusable` never produces RETAKE.

- Thumbnail: ≤256 px long edge, the `STATS_MAX_EDGE` pattern — image-wide aggregates barely change between 65 k and 1.4 M pixels, at ~20× less main-thread time.
- `yieldToBrowser()` between decode, luma, Laplacian and histogram passes.
- **Blur:** variance of the 4-neighbour Laplacian over luma.
- **Exposure:** mean luma, fraction ≤16 (crushed), fraction ≥240 (clipped).

### Thresholds — measured, not picked

Calibrated on 80 seeded product photos in `public/seed`, each measured as-is and synthetically degraded, computing exactly what the browser will compute:

```
Laplacian variance (256px luma)      p05     p25     p50     p95
  sharp originals                    656    1237    3073   12012
  mild softness (cheap sensor)       409     856    2052    8001
  severe blur                         14      28      74     209

Mean luma                            p05     p50     p95
  normal                              59     116     150
  underexposed                        10      20      27
  overexposed                        184     223     249

Fraction >=240 (clipped highlights)  p05     p50     p95
  normal                             0.000   0.007   0.299   ← white backgrounds
  overexposed                        0.050   0.575   0.894
```

| Verdict | Rule | Why this value |
|---|---|---|
| `unusable` | `lapVar < 120` **or** `meanLuma < 22` **or** (`meanLuma > 235` and `blown > 0.80`) | 120 sits above the median of severe blur (74) and **3.4× below** the 5th percentile of mild softness (409): it catches most genuinely blurred frames and zero soft ones. |
| `borderline` | `lapVar < 300`, or `exposure ≠ ok` | A frame between severe blur's 95th percentile (209) and mild softness's 5th (409). |
| `good` | otherwise | **Mild cheap-sensor softness (p05 409) is `good`**, as the brief requires. |
| `exposure = dark` | `meanLuma < 40` and `crushed > 0.25` | Normal photos never have a mean below 59 (p05); every underexposed one is below 27 (p95). |
| `exposure = blown` | `meanLuma > 215` and `clipped > 0.60` | **Normal photos reach 30% clipped at p95** — a craft on a white seamless, which is the look we want. 0.60 plus a high mean avoids telling exactly those artisans their photo is overexposed. |

---

## 4. The variant pipeline

```
capture ──► [1] local pre-check ──► [2] server verdict ──► [3] cutout ──► [4] variants ──► [5] pick ──► [6] persist
             instant, offline        Gemini, ≤1 call       ON_DEVICE      presets always    Original     images[0] = pick
             warns only              FALLBACK-aware        → SERVER       generated         first,       original + enhanced
                                                           → NONE         optionally        labelled     always kept
```

| Step | While running, the artisan sees | On failure |
|---|---|---|
| 1 Pre-check | `photo_checking` compact line | Skipped silently (a decode error means no local hint). |
| 2 Verdict | `photo_checking_ai` | 5xx / network: existing honest `vision_unavailable` path, `photoQualitySource = HEURISTIC/UNCHECKED`. Unreadable JSON: `scoreSource = FALLBACK`, same outcome, **no "AI verified" copy.** |
| 3 Cutout | `photo_removing_background` | Tier ladder below; `NONE` is a valid ending, never an error. |
| 4 Variants | Gallery fills in as each look finishes | A preset that throws is omitted; Original and Enhanced always exist. |
| 5 Pick | Gallery, Original pre-selected | — |
| 6 Persist | existing save flow | Oversized optional data dropped server-side, capture kept. |

### 4.1 Background-removal tiers

| Tier | When | Artisan is told (`photo_bg_*`) |
|---|---|---|
| **ON_DEVICE** | `canRunBackgroundRemoval()` is true. Existing worker+WebGPU path, 12 s race. | "Background removed on your phone." |
| **SERVER** | `canRunBackgroundRemoval()` refuses **and** `/api/items/background` is enabled. Frame downscaled to ≤1024 px JPEG q0.78 before upload (~120–250 KB instead of up to 2 MB). 25 s client timeout; route hard timeout 20 s. | "Background removed on our server — your phone did not need to do the heavy work." |
| **NONE** | Server disabled, busy, timed out or failed; or on-device **timed out** (12 s). | "We kept your background — the looks below use your full photo." |

~~On-device *timeout* goes straight to NONE.~~ **Revised during A6 after measuring in the browser:** on-device *timeout* and *error* both fall through to SERVER. The timeout almost always means the ~40 MB model was still downloading on the artisan's first capture (≈9 s of fetches), so sending it to NONE cost every first capture its looks. The wait blocks nothing — Original and Enhanced are selectable and Next is enabled while the status line runs — and the server answers in 2–5 s. Warm, on-device finishes in ~1.5 s. The legacy `enhanceProductPhoto()` wrapper passes `allowServer: false`, so its behaviour is unchanged.

### 4.2 Variants

| Kind | Key | Needs cutout | Source of product pixels |
|---|---|---|---|
| ORIGINAL | `ORIGINAL` | no | Camera frame, downscaled only. **Always first, always labelled "Original".** |
| ENHANCED | `ENHANCED` | no | `enhanceOnCanvas(original)` — today's pass. |
| PRESET | `PRESET_WHITE`, `PRESET_CREAM`, `PRESET_GRADIENT`, `PRESET_WOVEN`, `PRESET_WOOD` | **yes** | Cutout, colour-corrected (§4.5), with the existing contact shadow. |
| GENERATED | `GENERATED_1`, `GENERATED_2` | **yes** | Cutout over a **backdrop-only** Gemini image. Max 2. |

Without a cutout there is nothing to place on a new background, so the gallery is **Original + Enhanced**. That is stated in the UI, not hidden.

Presets are pure canvas: `PRESET_CREAM` uses `--color-cream` (`#F6F3EE`) read from the computed style; `PRESET_WOVEN` and `PRESET_WOOD` are procedural textures drawn on the canvas (no image assets, no network).

### 4.3 Generative tier (`src/lib/backdropGen.ts`)

- Only when `GEMINI_CONFIGURED`, a cutout exists, and the session has not already seen `limit: 0`.
- Prompt from `craft_details` + `display`; asks for **an empty backdrop, no objects, no product**.
- The returned image is used **only as the canvas ground**; the cutout is drawn over it on the client.
- 15 s timeout, ≤2 variants, one attempt per capture.
- A 429 with `limit: 0` marks the tier unavailable for the rest of the page session — every later capture skips the call instead of paying the latency again.
- **On the current free-tier key this tier is always absent.** The gallery shows no placeholder and no "AI unavailable" error for it.

### 4.4 Payload budget — enforced, not hoped

| Field | Content | Cap (server) |
|---|---|---|
| `images[0]` | chosen look, ≤1280 px JPEG q0.8 | existing `MAX_UPLOAD_BYTES` (2 MB) per image, **new**: max 4 images |
| `originalImageUrl` | ≤1280 px JPEG q0.8 | 1 MB |
| `enhancedImageUrl` | ≤1280 px JPEG q0.8 | 1 MB |
| `imageVariants.variants[].thumb` | ≤320 px JPEG q0.7 (~15–25 KB) | ≤8 entries |
| `imageVariants.cutout` | ≤900 px PNG with alpha | 700 KB, else omitted |
| `imageVariants` total | | **1.2 MB, else the whole blob is dropped** and the capture still saves |

Dropping the optional blob keeps "degrade, never block": an over-cap variant set costs the artisan the ability to switch looks later, never the capture. Prompt 3 traces a 4 MB photo through and reports real byte totals.

### 4.5 "The product's pixels are the ones the camera captured" — precisely

Enforced by construction, so it holds for every variant:

1. **Allowed on product pixels:** the alpha matte from the cutout model; a global per-channel colour transform (grey-world gains clamped 0.85–1.15 and one levels LUT, identical for every pixel — the same class of adjustment a phone camera applies); an optional 3×3 sharpen. No pixel is added, removed, moved, inpainted or synthesised.
2. **No generative model ever receives the product.** `backdropGen.ts` sends a text prompt only; there is no code path that uploads the frame or the cutout to an image model, and none that accepts a returned image as the subject.
3. **The cutout is always drawn last,** over whatever ground was produced.

### 4.6 Provenance reference

New `provenanceReference(item) = item.originalImageUrl ?? item.images?.[0] ?? null` in `src/lib/buyerVerify.ts`, used by all four comparators (`buyerVerify`, `verify-ready`, `attach-verify`, `verify-authenticity`). Rows captured before V11 have no `originalImageUrl` and behave exactly as today.

### 4.7 Changing the look later

The same picker appears on the item in `/artisan/market`, writing through `PATCH /api/artisan/listings` (`selectedImageVariant`). Choices available: Original and Enhanced (full size, stored), and — when `imageVariants.cutout` was kept — every preset re-rendered from it. **Locked once `paidAt` is set**: the listing photo a buyer paid for is frozen. A LIVE Shopify product is updated on the next publish (`shopifySyncedImageKey` differs).

---

## 5. Shopify integration

### 5.1 Model

One platform store (created by hand). Each artisan: a **custom collection** (handle `karigari-<slug(name)>-<first 6 of artisanId>`), published to the Online Store, and their name as every product's `vendor`. `shopUrl = <shop.primaryDomain.url>/collections/<handle>`.

Two artisans named "Lakshmi Devi Meher" → `…-lakshmi-devi-meher-32756c` and `…-lakshmi-devi-meher-9f10aa`. Shopify additionally suffixes on collision; the handle it returns is the one stored.

### 5.2 `src/lib/shopify.ts`

| Export | Uses | Notes |
|---|---|---|
| `SHOPIFY_CONFIGURED` | env | domain + token + version all present |
| `shopifyGraphQL(query, vars)` | `POST https://<domain>/admin/api/<version>/graphql.json`, header `X-Shopify-Access-Token` | The one chokepoint. Never throws. |
| `testConnection()` | `shop { name myshopifyDomain currencyCode primaryDomain { url } }`, `currentAppInstallation { accessScopes { handle } }` | |
| `ensureArtisanShop(artisanId)` | `collections(query:"handle:…")`, `collectionCreate`, `publications`, `publishablePublish` | Claim-row-first; see §5.4 |
| `publishProduct({item, artisan, shop})` | `products(query:"handle:…")`, `productCreate`, `productVariantsBulkUpdate`, `stagedUploadsCreate`, `productUpdate(media)`, `collectionAddProducts`, `publishablePublish` | Resumable; see §5.5 |
| `updateProduct(...)` | `productUpdate`, `productVariantsBulkUpdate`, media replace when the look changed | |

Result type:
```ts
type ShopifyResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'unconfigured' | 'auth' | 'scope' | 'throttled' | 'user' | 'graphql' | 'http' | 'network';
      message: string; userErrors?: { field: string[] | null; message: string }[] };
```
**A 200 carrying `userErrors` is `ok:false, kind:'user'`.** It is checked per mutation payload, not assumed absent.

### 5.3 Rate limits

Shopify's leaky bucket reports `extensions.cost.{requestedQueryCost, throttleStatus{currentlyAvailable, restoreRate}}`.
- On `errors[].extensions.code = 'THROTTLED'`: wait `max(0, requested − available) / restoreRate` seconds, × (1 + random 0–30 % jitter), capped at 4 s; **max 3 attempts**.
- Proactively: if `currentlyAvailable` after a call is below the next mutation's typical cost (~10), sleep until it is.
- After 3 attempts: `kind:'throttled'`, message *"Shopify is busy right now. Try publishing again in a minute."* Never a loop.

### 5.4 Idempotency — the shop

```
1. SELECT ShopifyShop WHERE artisanId          → ACTIVE: return it
2. INSERT ShopifyShop {artisanId, status:CREATING}
     P2002 (another request claimed it) → poll the row up to ~6 s for ACTIVE, then return it
3. Query collections by the deterministic handle → found: adopt it (covers a crash after step 4)
4. collectionCreate → publishablePublish(collection, Online Store)
5. UPDATE row: collectionId, collectionHandle, shopUrl, status ACTIVE
```
Exactly one collection per artisan under concurrency, because the unique constraint is taken **before** any Shopify write.

### 5.5 Idempotency — the product, and the partial-failure resume

The route claims first: `updateMany WHERE shopifyStatus IN (null, NOT_PUBLISHED, FAILED, LIVE) OR (PUBLISHING AND shopifyStatusAt < now − 3 min)` → `PUBLISHING`. Zero rows = already publishing → `409`.

Each step is either persisted immediately or idempotent against Shopify's own state:

| Step | Idempotent because |
|---|---|
| a. find product | `shopifyProductId` set → `product(id)` query (null = deleted in Shopify → clear and recreate). Else look up by `shopifyHandle`; found → adopt. |
| b. `productCreate` | Only when (a) found nothing. **`shopifyProductId` + `shopifyVariantId` written the instant it returns.** |
| c. price | `productVariantsBulkUpdate` sets an absolute value. |
| d. image | Skipped when `shopifySyncedImageKey = selectedImageVariant` and the product has media; otherwise staged upload + `productUpdate(media)`, then `shopifySyncedImageKey` written. |
| e. collection | Checked via `product.collections` before `collectionAddProducts`. |
| f. publish | `publishablePublish` is a no-op on an already-published resource. |

**Partial failure trace (most likely real failure):** (b) succeeds, (d) fails → productId is already stored → status `FAILED`, `shopifySyncError = "The product was created but its photo did not upload. Retry to finish."` → Retry runs (a) → finds the product by id → skips (b) → redoes (d)…(f). **No second product.**

Price: `salePrice ?? getListingPrice(item)` in rupees. The ₹10 demo charge and ₹4 advance never appear. If `shop.currencyCode ≠ INR`, publish refuses: *"The Shopify store's currency is USD. Set it to Indian Rupees before publishing."* — a rupee number on a dollar store would list a ₹21,243 saree at $21,243.

### 5.6 Syndication honesty — structural, not just copy

`SyndicationPlatform` gains `mode: 'EXPORT' | 'LIVE_PUBLISH'`. `normalizePlatforms()` accepts **only `EXPORT`** keys, so `/api/artisan/syndicate` can never stamp `SHOPIFY` into `syndicatedChannels`. Shopify has its own route and its own state columns. Export notes are sharpened to say *"prepared, not sent"*.

Price comparison row: `Your Karigari shop on Shopify` — buyer pays the base price, **0 % marketplace commission**, note: *"Sold from the platform's own store — no marketplace cut. The store pays its payment gateway and Shopify plan fees, which depend on the plan."* No percentage is printed: the real figure depends on the store's plan and gateway, and inventing one is exactly what the brief forbids.

### 5.7 Trust boundary and failure matrix

`SHOPIFY_ADMIN_ACCESS_TOKEN` is read in `src/lib/shopify.ts` only, server-side, never logged, never returned, **never given a `NEXT_PUBLIC_` alias**. Only `NEXT_PUBLIC_SHOPIFY_ENABLED` (a boolean that decides whether a card renders) is public.

| Condition | Detected by | Artisan sees |
|---|---|---|
| Not configured | `!SHOPIFY_CONFIGURED` | Card absent. Routes: `503` *"Shopify publishing is not set up on this deployment."* |
| Invalid or revoked token | HTTP 401 | *"The platform's Shopify connection has been disconnected. Ask the administrator to reconnect the store."* |
| Missing scope | `ACCESS_DENIED` in `errors[].extensions.code`, or 403 | *"The platform's Shopify app is missing a permission (write_products). Ask the administrator to grant it."* — the scope named when Shopify names it. |
| Throttled | §5.3 | *"Shopify is busy right now. Try publishing again in a minute."* |
| `userErrors` | payload | The first userError message, prefixed *"Shopify refused this listing:"* |
| Network | fetch throws | *"Could not reach Shopify. Check the connection and retry."* |
| Wrong currency | `shop.currencyCode` | §5.5 |

Custom-app Admin tokens do not expire on a schedule; "expired" presents as revoked (401) and shares that message.

---

## 6. File-by-file work order

Each block leaves the app building.

**A0 Schema** — `prisma/schema.prisma` (§1) · `db push --url $DIRECT_URL` · `generate` · restart dev.

**A1** `src/lib/photoQuality.ts` (new) — `assessPhotoLocally()`, thresholds from §3.

**A2** `src/app/api/items/vision-verify/route.ts` — `requireArtisan()`, `blur`/`exposure` in prompt + schema + `required`, `retakeAdvice`/`retakeReason`/`scoreSource`; legacy fields unchanged.
`src/lib/photoGate.ts` (new, shared by route and modal) — the §2 decision table as a pure function.

**A3** `src/app/api/items/background/route.ts` (new) — guarded, capped, timed, bounded concurrency, typed failure. `next.config.ts` — `serverExternalPackages`, `outputFileTracingExcludes`. `package.json` — `@imgly/background-removal-node`. `.env.example` — `SERVER_CUTOUT_ENABLED`.

**A4** `src/lib/imageEnhance.ts` — `buildPhotoVariants()`, preset compositors, tier ladder, colour-correct-the-cutout; `enhanceProductPhoto()` kept as a wrapper.

**A5** `src/lib/backdropGen.ts` (new).

**A6** `src/components/PhotoStudio.tsx` (new — keeps `CaptureModal` from growing past 2,173 lines) · `src/components/CaptureModal.tsx` (step-2 wiring only; header, state machine, steps unchanged) · `src/lib/offlineQueue.ts` (`CapturePayload` optional fields) · `src/app/api/items/capture/route.ts` + `complete-draft/route.ts` (accept, validate, cap, persist) · `src/lib/buyerVerify.ts` + the three other comparators (`provenanceReference`) · `src/app/api/artisan/listings/route.ts` + `src/app/artisan/market/page.tsx` (later picker).

**B1** `.env.example` Shopify block.
**B2** `src/lib/shopify.ts` (new).
**B3** `src/app/api/artisan/shopify/route.ts`, `…/shopify/publish/route.ts`, `…/shopify/test/route.ts` (new).
**B4** `src/lib/syndication.ts` (`mode`, Shopify row, sharper notes).
**B5** `src/app/artisan/market/page.tsx` — Shopify card in the Syndication Hub.
**B6** `src/lib/i18n/{en,hi,or,te}.ts` — `photo_*`, `variant_*`, `shopify_*`.

**Docs (Prompt 3)** — `ARCHITECTURE.md`, `docs/CONTRACT.md`, `README.md`, `docs/PHOTO_STUDIO_RUNBOOK.md`.

---

## 7. Rollback

| Switch | Effect | Data |
|---|---|---|
| `NEXT_PUBLIC_PHOTO_STUDIO_ENABLED=false` | `CaptureModal` runs the pre-V11 path: `enhanceProductPhoto()` wrapper, no gallery | New columns simply stay null on new rows; existing values untouched. `provenanceReference()` falls back to `images[0]`. |
| `SERVER_CUTOUT_ENABLED=false` (default) | Tier ladder skips SERVER | None. |
| `GEMINI_API_KEY` unset or free tier | Generative tier absent | None. |
| `NEXT_PUBLIC_SHOPIFY_ENABLED=false` | Shopify card hidden | Shopify columns and `ShopifyShop` rows kept. |
| Shopify env unset | Routes `503` with a sentence | Same. **Products already LIVE stay on Shopify** — rollback does not unpublish them; the runbook covers archiving. |

No flag strands data: every column is nullable, every reader has a pre-V11 fallback, and nothing is deleted when a feature is turned off.

---

## 8. Revisions made during implementation

Each was found by testing or by re-checking the live reference, not assumed.

| # | Plan said | Built | Why |
|---|---|---|---|
| R1 | On-device cutout timeout → NONE | Timeout → SERVER (studio path only) | The timeout is almost always the ~40 MB model still downloading on a first capture. §4.1 has the measurement. |
| R2 | Any cutout a tier returns is used | `assessCutout()` rejects cutouts that cut into the craft (`kept ≥ 0.50`, or `kept ≥ 0.30` with `soft ≤ 0.30`) → NONE + `cutoutRejected` | A full-frame saree lost everything but its borders, so every preset showed the product erased. Calibrated by eye on 60 seed photos (comment in `src/lib/imageEnhance.ts`). |
| R3 | productCreate → productVariantsBulkUpdate → staged upload + productUpdate(media) → collectionAddProducts → publish | Staged upload → **`productSet(identifier:{handle}, synchronous:true)`** → publishablePublish | The current Admin reference marks `collectionAddProducts` and `productDeleteMedia` deprecated. `productSet` is a documented upsert by handle carrying price, stock, collection and photo in one call, so every retry is idempotent by construction and a changed photo replaces the old one (files list semantics). |
| R4 | `collectionCreate(input:)` | `collectionCreate(collection: CollectionCreateInput)` | `input` is deprecated. |
| R5 | Shop claim via INSERT + catch P2002 | `createMany({ skipDuplicates: true })` | Same guarantee; the race loser no longer logs a database error. |
| R6 | — | **`withdrawSoldPiece()`**: after a Karigari sale, `after()` in `/api/payments/verify-payment` sets the Shopify product to DRAFT; row → `WITHDRAWN` | Every piece is one of a kind. Without it a sold saree stayed purchasable on Shopify. |
| R7 | — | Stock of 1 with `inventoryPolicy: DENY` when `SHOPIFY_LOCATION_ID` is set; set on first publish only | A re-publish must not put a piece that sold on Shopify back to 1. |
| R8 | Shopify row always in the price comparison | Only when `SHOPIFY_CONFIGURED` | A channel the artisan cannot use has no place in their comparison. |
| R9 | A failed publish → FAILED | A failed **update** of a LIVE product stays LIVE with `shopifySyncError` | The product is still on Shopify; saying FAILED would misstate it. |
