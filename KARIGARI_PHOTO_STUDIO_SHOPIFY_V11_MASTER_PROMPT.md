# KARIGARI — AI PHOTO STUDIO & SHOPIFY ARTISAN SHOPS V11 MASTER PROMPT

> Three-stage execution workflow for Claude Code. Run PROMPT 1 to completion, then PROMPT 2, then PROMPT 3.
> Repo root for every path below: `KARIGARI/` (the Next.js app).

---

## PROMPT 1 — PLANNING & ARCHITECTURE

You are a principal engineer working inside KARIGARI (Next.js 16.3.1 App Router, React 19, TypeScript, Tailwind v4, Prisma 7 + PostgreSQL), a marketplace giving marginal artisans verifiable provenance, fair-pay floors and direct payouts. **This stage produces a blueprint and a schema diff only — no feature code.**

Two features:
- **A. AI Photo Studio** — a real quality gate that asks for a retake only when a photo is genuinely unusable, then background removal and *several generated backgrounds* the artisan picks between, with the original always kept and always selectable.
- **B. Shopify artisan shops** — the platform owns the Shopify store; each artisan is handed their own shop inside it, and approving a listing publishes the product to it on their behalf.

### Read these first

Photo pipeline
- `src/lib/imageEnhance.ts` — `enhanceProductPhoto()`, `canRunBackgroundRemoval()`, `enhanceOnCanvas()`, `compositeWithShadow()`, `downscaleImage()`, `STORED_MAX_EDGE`
- `src/lib/imagePrep.ts` (`prepareForVision`, `describeSaving`), `src/lib/clientImagePrep.ts`, `src/lib/fileToDataUrl.ts` (`MAX_UPLOAD_BYTES`, `dataUrlBytes`)
- `src/app/api/items/vision-verify/route.ts` — the single Gemini call returning `match`, `score` (1-10), `display`, `bg_ok`, `recommended_bg`, `enhance`, `craft_details`
- `src/components/CaptureModal.tsx` — the 3-step capture flow; step 2 is where the photo is taken and enhanced (find the `enhanceProductPhoto(images[0])` effect and the `photoQualityScore` / `recommendedBg` state)
- `src/app/api/items/capture/route.ts`, `src/app/api/items/complete-draft/route.ts`, `src/lib/gemini.ts` (`GEMINI_CONFIGURED`, `generateContentWithFallback`)

Syndication
- `src/lib/syndication.ts` — `SYNDICATION_PLATFORMS`, `normalizePlatforms`, `buildPriceComparison`
- `src/app/api/artisan/syndicate/route.ts` — the publish endpoint and its ownership model
- `src/app/artisan/market/page.tsx` — the Syndication Hub tab that renders the channels
- `src/app/api/ondc/catalog/route.ts`, `src/app/api/artisan/gem-export/route.ts` — the existing export pattern to mirror
- `prisma/schema.prisma`, `.env.example`, `src/app/globals.css`, `src/lib/i18n/{en,hi,or,te}.ts`

### Ground truth — establish these before designing, they are the whole shape of the work

**A1. Quality scoring already exists but never acts.** `/api/items/vision-verify` returns a 1-10 `score`, `bg_ok` and `recommended_bg`. Nothing in `CaptureModal` blocks or asks for a retake — the score is displayed and the flow continues. Worse, the JSON-parse fallback is `{ match: true, score: 8, bg_ok: true }`, so a malformed model response silently reports a good photo. Keep that accept-on-failure default (never block a capture because the AI broke) but make it *distinguishable* from a real score so the UI does not claim a check that did not happen.

**A2. Background removal silently skips on exactly the phones our users own.** `canRunBackgroundRemoval()` hard-requires WebGPU (`if (!nav.gpu) return false`), plus ≥4 GiB `deviceMemory`, ≥4 cores, and not 2g/3g/`saveData`. The reasoning in that file is sound — `@imgly/background-removal` only honours `proxyToWorker` when WebGPU exists, so without it the 24 MB ONNX model runs on the main thread and freezes the tab mid-capture. But the consequence is that a ₹6,000 Android phone gets **no cutout at all**, and that is the device this whole product exists for. The competitor runs RemBG server-side in Python and therefore works on every handset.
→ Design a **server-side fallback**: keep the on-device path when the device can take it, and when `canRunBackgroundRemoval()` refuses, do the cutout on the server. Use `@imgly/background-removal-node` (the same model, Node build) behind a new route. Plan for the payload cost (downscale before upload), a hard timeout, and a documented degrade to the canvas-only enhancement when the server path is unavailable too. State the three tiers explicitly and what the artisan is told in each.

**A3. The enhanced frame destroys the original.** In `CaptureModal`, `enhanceProductPhoto()` runs automatically and `downscaleImage(enhanced.dataUrl)` becomes the stored `images[0]`. There is no second copy and no choice. `CraftItem.images` is a `String[]` of data URLs — there is no upload bucket in this app, and every image convention is a data URL.
→ Both frames must be persisted and the artisan's pick recorded. Decide where: named columns (`originalImageUrl`, `enhancedImageUrl`, `selectedImageVariant`) plus a `Json` variant set, versus overloading `images[]` by index. Recommend the named columns and say why ordering-by-convention in an array is not a contract.

**A4. "Generate backgrounds" does not exist.** Today the cutout is composited onto flat white with a contact shadow — one outcome, no options. The ask is several backgrounds to choose from.
→ Design two classes of variant and be honest about the difference:
  - **Deterministic canvas presets** (always available, no key, no network, instant): white studio, warm neutral / cream matching `--color-cream`, soft gradient, a woven-texture or wood surface, each with the existing contact shadow. These are composites of the cutout — no generative model, no invented detail.
  - **Generative scene** (optional, only when `GEMINI_CONFIGURED`): a contextual backdrop from Gemini's image model, prompted from `craft_details` and `display` (`packed` / `draped` / `3d_object`). Cap it at one or two variants — every call costs quota an artisan captures ~20 pieces on.
  The generated scene must never alter the product itself. State how that is enforced (composite the *cutout* over the generated backdrop client-side rather than asking a model to redraw the piece) and why it matters: this app sells provenance, and a listing photo whose product was AI-redrawn breaks the buyer's later QR-and-photo authenticity check in `src/lib/buyerVerify.ts`, which compares the delivered piece against `images[0]`.
  **This is a hard constraint, not a preference** — whatever variant the artisan picks, the pixels of the product must be the ones their camera captured.

**A5. The buyer-authenticity comparator must not be fooled by a legitimate background swap.** Once a variant with a swapped backdrop can become `images[0]`, two downstream comparisons are put at risk: `src/lib/buyerVerify.ts`'s `verifyBuyerImage()` (buyer's delivered-photo check) and, if V9 landed, the artisan's own ready-verification comparator — both diff a live phone photo against the item's stored reference image via Gemini Vision. A buyer's own photo will *never* match a studio backdrop anyway — their piece sits on their table, in their light — so the reference used for comparison must be the least-manipulated ground truth, and the comparison itself must be told to disregard setting. Two independent fixes, both required:
  1. **Compare against the untouched original, not the display photo.** Both comparators must read `originalImageUrl` (the raw, unedited camera capture persisted in A0's schema diff) as the reference image, falling back to `images[0]` only for pre-V11 rows that never captured a separate original. The backdrop-swapped, marketing-optimised frame is for buyers browsing the storefront; it must never be the forensic reference.
  2. **Make the comparison prompt background-blind.** Rewrite the Gemini comparison prompt in `src/lib/buyerVerify.ts` (and the shared V9 comparator, if present) to explicitly instruct the model to ignore backdrop, surface, lighting and staging differences entirely and judge only product-level identity: weave/knit pattern, texture, colour, material, shape/silhouette, visible motifs or embellishments, and proportions. State plainly in the plan that this is the correct scope for the check — it is answering "is this the same physical object," not "was this photographed in the same room" — and that QR/patch matching is already exact-string comparison, untouched by any of this.
  This does not relax the earlier constraint that no generated pixel may touch the product itself — a background-blind comparator does not forgive a product the model invented; it only stops a legitimate backdrop choice from producing a false rejection.

**B1. Shopify cannot create a store per artisan. Do not attempt it.** The Admin API is scoped to one store and has no store-creation mutation; `developmentStoreCreate` belongs to the Partner API and produces development stores that cannot transact until transferred and upgraded. Any design that provisions a Shopify store per artisan is fiction.
→ The achievable, honest reading of "the platform hands the artisan a shop": **one platform-owned Shopify store**, and each artisan gets their own **custom collection** inside it, auto-created on first publish, plus their name as the product `vendor`. That collection has a real, shareable URL (`https://<store>/collections/<artisan-handle>`) which *is* their shop. Products they approve are created in the platform store, tagged to them, and added to their collection. Plan the handle strategy (stable, unique, derived from the artisan but collision-safe) and what happens when two artisans share a name.

**B2. Every existing channel is export-only.** `src/lib/syndication.ts` says so plainly — publishing "does not transmit to Paytm, Magicpin, gem.gov.in or Amazon". Shopify will be the **first channel that performs a real outbound write**, so it cannot be bolted onto the same code path that merely stamps `syndicatedChannels`. Design its distinct states: never published, publishing, live (with the product URL), failed (with the reason and a retry). And keep the honesty discipline the rest of the file has — do not let the new channel's presence make the export-only ones sound live.

### Deliver, as `docs/PHOTO_STUDIO_SHOPIFY_V11_PLAN.md`

1. **Prisma diff**, house comment style (explain *why*, name the writer of each field, never over-claim):
   - `CraftItem`: `originalImageUrl String?`, `enhancedImageUrl String?`, `selectedImageVariant String?`, `imageVariants Json?`, `photoQualityScore Int?`, `photoQualityNotes String?`, `photoQualitySource String?` (`AI` | `HEURISTIC` | `UNCHECKED` — so a fallback can never masquerade as a real AI score), `photoRetakeCount Int @default(0)`, `backgroundRemovalMode String?` (`ON_DEVICE` | `SERVER` | `NONE`).
   - `CraftItem` Shopify block: `shopifyProductId String?`, `shopifyVariantId String?`, `shopifyHandle String?`, `shopifyStatus String?` (`NOT_PUBLISHED` | `PUBLISHING` | `LIVE` | `FAILED`), `shopifyPublishedAt DateTime?`, `shopifySyncError String?`, `@@index([shopifyStatus])`.
   - New `ShopifyShop` model: `artisanId String @unique` + relation, `collectionId`, `collectionHandle`, `shopUrl`, `status`, `productCount Int @default(0)`, `createdAt`, `lastSyncedAt DateTime?`.
   - Note that this repo has **no `prisma/migrations/`** — the change lands via `npx prisma db push` + `npx prisma generate`, and every new column must be nullable or defaulted so existing rows survive.
2. **The quality gate, as a decision table.** Per the product owner's explicit instruction, this must be *lenient*: marginal artisans often have poor cameras, and a photo they cannot improve must never be a wall. Three bands — hard retake prompt only at the bottom (unusable: a genuine `match: false`, or a severe-blur / extreme-exposure verdict), a soft advisory in the middle with **Continue anyway as an equal-weight button**, silent pass at the top. After one retake the artisan can always proceed regardless of score. Specify the exact thresholds, the wording of each message (specific and actionable — "the photo is very blurry, try holding the phone still and tapping to focus", never "photo rejected"), and how `photoRetakeCount` caps the nagging.
3. **Client-side pre-check.** A cheap, offline, no-network heuristic before the Gemini call: Laplacian-variance blur estimate and a luminance histogram for clipped shadows/highlights, computed on a downscaled canvas thumbnail (reuse the `STATS_MAX_EDGE` thumbnail pattern already in `imageEnhance.ts`). Give the thresholds, and state that this only ever *warns* — the authoritative score stays the server's.
4. **The variant pipeline**, as a sequence with a fallback at every step: pre-check → server quality verdict → cutout (on-device → server → none) → variant generation (presets always, generative optionally) → artisan picks → chosen variant becomes `images[0]`, original and enhanced both retained. Say what the UI shows while each step runs and what happens when each fails.
5. **Shopify integration design**: the `src/lib/shopify.ts` surface (`SHOPIFY_CONFIGURED`, `getShopifyClient()`, `ensureArtisanShop()`, `publishProduct()`, `updateProduct()`, `testConnection()`), which Admin GraphQL mutations each uses, the rate-limit and retry strategy (Shopify's leaky bucket — respect `throttleStatus`, exponential backoff, never a tight retry loop), idempotency (a re-clicked Publish must not create a second product), and how images cross over given that this app stores data URLs and Shopify wants a URL or a staged upload.
6. **Trust boundary and failure matrix**: `SHOPIFY_ADMIN_ACCESS_TOKEN` is read server-side only and never gets a `NEXT_PUBLIC_` alias; what an artisan sees when the token is missing, expired, scope-denied, or rate-limited — each an actionable sentence, never a stack trace.
7. **File-by-file work order** and a **rollback plan** (both features off by env flag without stranding data).

Constraints: approved new dependencies are `@imgly/background-removal-node` (server cutout) and nothing else unless you justify it in the plan — the Shopify Admin API is plain `fetch` against GraphQL, no SDK. No `middleware.ts`; per-route `requireArtisan()` guards stay the pattern. Every user-visible string is an i18n key in all four dictionaries. Existing design tokens only. Both features degrade honestly when unconfigured, following the established `RAZORPAY_CONFIGURED` → 503-with-a-sentence and `GEMINI_CONFIGURED` → documented-fallback patterns.

---

## PROMPT 2 — IMPLEMENTATION

Implement `docs/PHOTO_STUDIO_SHOPIFY_V11_PLAN.md`. Production quality: typed, guarded, idempotent, themed, translated. Keep the app building after each numbered block.

## FEATURE A — AI PHOTO STUDIO

### A0. Schema
Apply the planned diff. `npx prisma generate`. State that `npx prisma db push` is required against a live `DATABASE_URL`; do not fabricate migration files.

### A1. `src/lib/photoQuality.ts` (new) — the client pre-check
Pure, dependency-free, canvas-based. Export `assessPhotoLocally(dataUrl): Promise<LocalQuality>` returning `{ blurScore, exposure: 'ok'|'dark'|'blown', verdict: 'good'|'borderline'|'unusable', hint: string }`. Laplacian variance for blur; a luminance histogram for clipped ends. Compute on a ≤256px-long-edge thumbnail — reuse the reasoning already documented for `STATS_MAX_EDGE`, and `yieldToBrowser()` between passes so the tab never locks. Calibrate deliberately **lenient**: a slightly soft photo from a cheap sensor is `good`, not `borderline`. Document each threshold with the reason for its value.

### A2. `/api/items/vision-verify` — make the verdict actionable
Extend the Gemini prompt's Task 2 to also return `blur: 'none'|'mild'|'severe'` and `exposure: 'ok'|'dark'|'blown'`, added to the response schema and the `required` list. Derive and return `retakeAdvice: 'PASS' | 'SOFT' | 'RETAKE'` plus a specific, kind `retakeReason` string. Add `scoreSource: 'AI' | 'FALLBACK'` and set it to `FALLBACK` on the parse-failure path so the client can avoid claiming a check that did not happen — keep the accept-by-default behaviour exactly as it is. Every existing legacy field keeps its current meaning; nothing that reads this route today may break.

### A3. `src/app/api/items/background/route.ts` (new) — server-side cutout
`requireArtisan()`-guarded POST taking a downscaled data URL, running `@imgly/background-removal-node`, returning the PNG cutout as a data URL. Enforce the existing `MAX_UPLOAD_BYTES` cap, a hard timeout, and `export const dynamic = 'force-dynamic'`. Return a typed failure rather than throwing, so the client can fall through to canvas-only enhancement. Note in a comment that this exists because `canRunBackgroundRemoval()` correctly refuses on the low-end handsets that are this product's primary users.

### A4. `src/lib/imageEnhance.ts` — variants instead of one frame
Refactor `enhanceProductPhoto()` into `buildPhotoVariants(dataUrl, opts)` returning:
```
{ original, enhanced, cutout | null, variants: [{ key, label, dataUrl, kind: 'ORIGINAL'|'ENHANCED'|'PRESET'|'GENERATED' }], backgroundRemovalMode }
```
Keep `enhanceOnCanvas()`, `compositeWithShadow()`, `sampleStats()` and `downscaleImage()` as they are — they work. Add the preset compositors (white studio, cream `--color-cream`, soft gradient, woven texture, wood surface), each drawing the **cutout** over a generated backdrop, all with the existing contact shadow. Preserve every current guard: the WebGPU gate, the 12s race, `SHARPEN_MAX_PIXELS`, and degrade-never-block. Add the on-device → server → none tier ladder. `enhanceProductPhoto()` stays exported as a thin wrapper so nothing that calls it today breaks.

### A5. Generative backdrop (optional tier)
`src/lib/backdropGen.ts`: when `GEMINI_CONFIGURED`, ask Gemini's image model for **a backdrop only** — prompted from `craft_details` and `display` — then composite the artisan's cutout over it locally. Never send the product to be redrawn, and never accept a returned image as the product. One or two variants maximum, a short timeout, and silent absence of the tier when the key is missing or quota is exhausted. Put the provenance reasoning in a comment: `src/lib/buyerVerify.ts` later compares the delivered piece against `images[0]`, so a synthesised product would break the buyer's authenticity check and the fair-pay proof with it.

### A6. `src/components/CaptureModal.tsx` — the step-2 studio
Replace the silent auto-enhance effect with a visible, three-phase sequence inside the existing step-2 panel. Do **not** add a fourth step or restructure the modal — the "Step N of 3" header, the state machine and the draft-resume behaviour all stay.

1. **Checking** — run `assessPhotoLocally()` immediately for instant feedback, then the server verdict. Show a compact progress line, not a full-screen spinner.
2. **Retake prompt** (only on `RETAKE`) — the specific reason, a large **Retake photo** action, and **Use this photo anyway** as a real, equally-weighted button. Never a dead end. On `SOFT`, show the advice inline above the gallery and continue automatically. Track `photoRetakeCount` and stop prompting after the first retake.
3. **Choose the look** — a responsive thumbnail gallery of every variant, **Original first and labelled as such**, with the AI-made ones marked. Selected state uses the established pattern (`ring-2 ring-[var(--color-maroon)]`, `shadow-card`); tap targets ≥44px; horizontally scrollable on narrow screens inside its own `overflow-x-auto`, never a body scroll. One line under the gallery saying the product itself is untouched in every option and only the background changes. A "why we suggest this" note when `recommended_bg` is non-empty.

The chosen variant becomes `images[0]` and the AI verification continues to run against that frame, exactly as today. Persist `originalImageUrl`, `enhancedImageUrl`, `selectedImageVariant`, `imageVariants`, `photoQualityScore`, `photoQualityNotes`, `photoQualitySource`, `photoRetakeCount`, `backgroundRemovalMode` through `/api/items/capture` (and `complete-draft`, so a resumed draft keeps its variants). Guard the total payload: variants are data URLs and `imageVariants` must store downscaled thumbnails plus the chosen full-size frame, not five full-resolution copies — say so in a comment and enforce it.

Also let the artisan change their mind later: surface the same picker on the item in `src/app/artisan/market/page.tsx`, writing through `/api/artisan/listings`.

### A7. Point the authenticity comparator at the original, and make it background-blind
Two files compare a live phone photo against a stored reference via Gemini Vision: `src/lib/buyerVerify.ts` (`verifyBuyerImage()`, used by the buyer's delivery check and the scan-anywhere route) and, if V9's shared ready-verification comparator exists, that too. Change both:
1. **Reference image.** Read `item.originalImageUrl ?? item.images[0]` as the comparison reference — never the display/marketing frame a background variant produced. Add this as a one-line, well-commented change at each call site rather than duplicating the fallback logic; if a small shared helper (`referenceImageFor(item)`) does not already exist, add one so it cannot drift between the two call sites.
2. **Prompt.** Replace the comparison prompt's instruction to "analyse weave, texture, colour, and style" with an explicit background-blind instruction: the two photos may have completely different settings, lighting and staging, and the model must ignore all of that and judge only whether the physical product is the same — weave/knit pattern, texture, colour, material, shape/silhouette, visible motifs or embellishments, and proportions. Add one worked example to the prompt (a studio-lit product photo vs. a phone photo on a kitchen table) so the model has a concrete anchor for "same product, different setting."
3. Keep every existing guard unchanged: `MIN_SIMILARITY`, the downscale-before-vision step, the Gemini-unconfigured fallback, and the health-score reward logic in `verifyBuyerImage()`. This is a reference-image and prompt change only — the plumbing around it is correct today and must not move.
4. Do not weaken the no-synthesised-product rule from A5/A6 — this section makes legitimate backdrop differences stop causing false rejections; it does not make the comparator more permissive about the product itself.

## FEATURE B — SHOPIFY ARTISAN SHOPS

### B1. Environment — extend `.env.example` in its existing commented style
```
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxxxxxxxxx
SHOPIFY_API_VERSION=2026-07
SHOPIFY_LOCATION_ID=
NEXT_PUBLIC_SHOPIFY_ENABLED=false
```
Document each, the required Admin scopes (`write_products`, `read_products`, `write_publications`, `read_publications`, plus inventory scopes if stock is tracked), that the token is a **server-only secret with no `NEXT_PUBLIC_` alias ever**, and — prominently — that **the Admin API cannot create a store per artisan**: one platform store is provisioned by hand, and each artisan's "shop" is a collection inside it.

### B2. `src/lib/shopify.ts` (new) — the whole API surface
Plain `fetch` against `https://<domain>/admin/api/<version>/graphql.json` with the `X-Shopify-Access-Token` header. No SDK. Export:
- `SHOPIFY_CONFIGURED` (all of domain + token + version present)
- `shopifyGraphQL(query, variables)` — one chokepoint that handles HTTP errors, GraphQL `errors[]`, and `userErrors[]` as *distinct* failures (a 200 with `userErrors` is a failure and must not read as success), returns a typed result, and never throws into a route
- Leaky-bucket handling: read `extensions.cost.throttleStatus`, back off exponentially with jitter on `THROTTLED`, cap the attempts, and surface "busy, try again shortly" rather than retrying forever
- `testConnection()` — a cheap `{ shop { name myshopifyDomain } }` probe
- `ensureArtisanShop(artisanId)` — idempotent: return the existing `ShopifyShop` row, else create a `collectionCreate` custom collection named for the artisan with a collision-safe handle, persist the row, return it. Two concurrent first-publishes must not create two collections — guard on the `@unique artisanId` and treat the constraint violation as "someone else just made it, re-read".
- `publishProduct({ item, artisan, shop })` — `productCreate` (title, descriptionHtml from the AI catalog copy, vendor = artisan name, productType from craft, tags including the patch ID and cluster), price from `getListingPrice(item)` **in rupees, the real listing price — never the ₹10 demo charge**, then attach the chosen image, then add to the artisan's collection, then publish to the Online Store channel. Multi-step and therefore partially failable: record what succeeded so a retry resumes rather than duplicating.
- `updateProduct()` for a re-publish after an edit.

Images: `CraftItem.images` holds data URLs and Shopify needs a fetchable URL or a staged upload. Implement it properly — either `stagedUploadsCreate` + PUT the bytes + `productCreateMedia`, or expose the existing `/api/items/[id]/thumbnail` route as the public source if it serves a stable absolute URL. Pick one, say why in a comment, and make sure the image that goes up is the **variant the artisan chose**.

### B3. Routes
- `POST /api/artisan/shopify/publish` — `requireArtisan()`, body `{ craftItemId }`. Ownership-checked. Refuse with a clear message when the item has no price, no image, or is not sellable (reuse `unpurchasableReason` from `src/lib/storefrontSale.ts`). Set `shopifyStatus: 'PUBLISHING'` first so a double-click is caught, then `ensureArtisanShop()` → `publishProduct()` → persist ids, handle, URL, `shopifyPublishedAt`, `LIVE`. On failure: `FAILED` + `shopifySyncError` with the actionable reason, and a retry that resumes. Write an `AuditLog` row via `logCraftItemEvent` — a `CraftItem` exists here, so unlike the demand-advance routes there is a valid FK.
- `GET /api/artisan/shopify` — the artisan's shop row, their live product count, and their shop URL; `503` with a sentence when `!SHOPIFY_CONFIGURED`.
- `POST /api/artisan/shopify/test` — admin-only connection probe surfacing the shop name, the API version and the granted scopes, so a misconfigured token is diagnosable without reading server logs.

### B4. Syndication integration
Add `SHOPIFY` to `SYNDICATION_PLATFORMS` in `src/lib/syndication.ts` with a note that says what is true of it and only it: this channel performs a **real** publish to a live consumer storefront. Do not let its arrival make the export-only channels sound live — if anything, sharpen their notes. Add a Shopify row to `buildPriceComparison()` using Shopify's actual economics (no marketplace commission on the platform's own store; payment-processing fees only) rather than inventing a rate.

### B5. UI — `src/app/artisan/market/page.tsx`, Syndication Hub tab
A Shopify card distinct from the export-only ones: the artisan's shop URL as a copyable link once it exists, a live product count, and per-item **Publish to my shop** / **View in shop** / **Retry** actions driven by `shopifyStatus`. States: not configured (card absent, not broken), never published, publishing (spinner + disabled), live (green check, product link), failed (the reason plus Retry). Use only existing tokens — `--color-maroon` for primary actions, the muted green ramp for live, the maroon-family red for failed. Mobile-first, ≥44px targets, no layout shift when a status flips.

### B6. i18n
Every new string in `en`, `hi`, `or`, `te` with real translations, not English placeholders. Follow existing key naming (`photo_*`, `variant_*`, `shopify_*`).

### Engineering rules — non-negotiable
- Match the surrounding code: `"use client"` only where needed, `export const dynamic = 'force-dynamic'` on handlers reading request state, `requireArtisan()` on artisan routes, `NextResponse.json` with real status codes, `try/catch` + route-prefixed `console.error`.
- Comments explain **why**, in full sentences, in this repo's voice. No banner comments.
- Theme: existing tokens only. No new colours, radii, shadows or fonts. Mobile-first; ≥44px targets; wide content scrolls inside its own container, never the body.
- Money: displayed and published prices are the real listing price (`salePrice ?? getListingPrice(item)`). The ₹10 demo charge and ₹4 advance are gateway amounts and must never reach a Shopify listing.
- Honesty: never claim a transmission that did not happen, never present a `FALLBACK` score as an AI verdict, never describe a simulated settlement as paid.
- Every mutating endpoint idempotent and double-submit safe; every state machine monotonic.
- No `any`, no unused imports, no `console.log` left in UI components. Secrets server-side only.

---

## PROMPT 3 — REVIEW, TESTING & OPTIMISATION

Audit V11 across the whole codebase. Findings table (file · line · severity · defect · fix), apply every Critical and High fix, re-verify. Do not declare done on partial work.

### A. Gates — run these, paste real output
```
npx prisma generate
npx tsc --noEmit
npm run lint
npm run build
```
Zero type errors, zero lint errors, clean build. If a gate needs a live database or real Shopify credentials, say so explicitly rather than skipping it silently.

### B. Full-file sweep
Every file created or edited plus everything importing them. Confirm: no stale references to the old single-frame enhance contract; every caller of `enhanceProductPhoto` still compiles and behaves; no `select:`/`include:` naming a non-existent field; the four i18n dictionaries have identical key sets (write and run a throwaway diff script, paste the result); every `t("...")` in changed files resolves.

### C. Photo Studio traces — walk the code
1. A sharp, well-lit photo → silent pass, no retake prompt, gallery with Original + presets, Original selectable and first.
2. A severely blurred photo → `RETAKE` with a specific reason; **Use this photo anyway** proceeds and records `photoRetakeCount`; after one retake the artisan is never prompted again.
3. A middling photo from a cheap camera → `SOFT` advisory only, flow continues automatically. Confirm against the calibrated thresholds that this is the common case, not the retake case — a lenient gate is a product requirement, and a gate that nags a ₹6,000-phone user is a defect.
4. A WebGPU device → `backgroundRemovalMode: 'ON_DEVICE'`. A device that fails `canRunBackgroundRemoval()` → `'SERVER'` and a real cutout. Both server and device unavailable → `'NONE'`, canvas-enhanced original, gallery still renders, capture still completes.
5. Gemini unconfigured → presets only, no generative tier, `photoQualitySource` is `HEURISTIC` or `FALLBACK`, and **no UI text claims an AI check ran**.
6. Malformed Gemini JSON → accept-by-default preserved, `scoreSource: 'FALLBACK'`, capture not blocked.
7. Pick each variant in turn → that exact frame becomes `images[0]`; `originalImageUrl` and `enhancedImageUrl` both persist; a resumed draft keeps its variants.
8. **Provenance check:** confirm in code that no path can put an AI-synthesised product into `images[0]`, and that `src/lib/buyerVerify.ts` still compares against the artisan's real pixels. This is the highest-severity check in this section — a failure here breaks the buyer authenticity flow.
9. **Background-swap robustness:** an item whose chosen listing photo used a swapped studio backdrop (white, cream, gradient, textured, or generated) still verifies as genuine when the buyer's delivery photo is taken in a completely different real-world setting. Confirm the comparator reads `originalImageUrl` as the reference, not the backdrop-swapped display frame, and that the rewritten prompt correctly disregards setting — trace at least one case where the two photos have visibly different backgrounds and the same product, and one where the backgrounds match but the product does not, to confirm the model is actually discriminating on the product and not accidentally rewarding matching backgrounds.
10. Payload: capture a 4 MB photo and trace the stored size. `imageVariants` must not hold multiple full-resolution data URLs. Report the actual byte totals.
11. Main thread: confirm the sharpen skip, the `yieldToBrowser()` calls and the WebGPU gate all survived the refactor. No synchronous pass over a full-size frame.

### D. Shopify traces
12. `SHOPIFY_CONFIGURED` false → the card is absent (not broken), routes 503 with a sentence, the rest of the Syndication Hub is unaffected.
13. First publish → collection auto-created with a collision-safe handle, `ShopifyShop` row written, product created with the **real listing price**, the artisan's chosen image attached, added to their collection, published to Online Store, `LIVE` + product URL stored.
14. Second publish of the same item → no duplicate product; it updates or short-circuits.
15. Two artisans with identical names → distinct collection handles, no cross-contamination.
16. Two concurrent first-publishes for one artisan → exactly one collection; the unique-constraint path re-reads rather than erroring.
17. Partial failure (product created, image attach fails) → `FAILED` with an actionable reason; Retry resumes rather than creating a second product. Trace this explicitly — it is the most likely real-world failure.
18. A 200 response carrying `userErrors` → treated as a failure, not a success.
19. Throttled response → backoff with jitter, bounded attempts, an honest "busy" message, no tight loop.
20. Invalid / expired / under-scoped token → three distinguishable, actionable messages; no stack trace to the browser; the token never appears in a response, a log line, or the client bundle.
21. Artisan A attempts to publish artisan B's item → 403, nothing written.

### E. Security and performance
- `grep -rn "NEXT_PUBLIC_" src/` — every hit genuinely public. No Shopify token, Gemini key or admin token reachable from the client bundle.
- No N+1 in the shop/product-count reads; every new query path has a supporting index.
- Server cutout: payload capped, timeout enforced, concurrent requests bounded so one artisan cannot exhaust the route.
- Images downscaled before every model call (`prepareForVision`), vision candidates still capped.

### F. UX and accessibility
- Every new control: label, accessible name, keyboard operable, visible focus ring. The variant gallery is arrow-key navigable with a proper `radiogroup` role, and each thumbnail has a meaningful alt.
- Loading, empty, error and unsupported states on every new surface. 360px width: no horizontal body scroll, gallery scrolls inside its own container.
- Theme audit: no new colour, radius, shadow or font escaped the token set.
- Screen-reader pass on the retake prompt — it must read as guidance, not rejection.

### G. Documentation
- `ARCHITECTURE.md` is materially out of date (it still claims no Razorpay and `/artisan/market` as a UI stub). Correct the capture-pipeline and syndication sections, and add the Shopify channel to the status machine with its real semantics.
- `docs/CONTRACT.md` — every new endpoint with its guard.
- `README.md` — Shopify setup (create the store by hand, install a custom app, grant the scopes, copy the Admin token), the "one store, a collection per artisan" model stated plainly, the new env block, and `prisma db push`.
- `docs/PHOTO_STUDIO_RUNBOOK.md` — how to rotate the Shopify token, what to do when a publish is stuck in `PUBLISHING`, and how to re-run a failed publish in bulk.

### H. Final report
Gates with real output · findings table with what was fixed · results for all 21 traces · anything deliberately left undone and why. Do not claim a trace verified that you did not actually walk in the code.
