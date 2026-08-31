# MASTER PROMPT — 1-Click "GeM & ONDC Catalog Exporter" (Virtual Business Manager)

> Paste into Claude Code. App root: **`KARIGARI-main/KARIGARI/`** (`cd` there). Next 16 App Router, React 19, TS, Prisma 7. Theme in `src/app/globals.css` (primary `#24332C`, mint `#DCEBE0`); keep `useLanguage` i18n. Build must stay green.

## GOAL
Add a **1-click "Export to Government Platforms"** action in the **Market Insights** page (`src/app/artisan/insights/page.tsx`) that turns the artisan's verified products into upload-ready government-marketplace catalogs:
1. **GeM-compliant catalog** — download as **CSV** (bulk-upload/spreadsheet) and **JSON**.
2. **ONDC Beckn payload** — reuse the existing `/api/ondc/catalog` (Beckn `on_search`), scoped to this artisan.
3. **Personalized step-by-step guidance** — e.g. *"How to submit your Sambalpuri Saree to GeM under the SC/ST artisan quota"*, driven by the artisan's real profile.

## HONESTY (bake into copy — do not fake it)
GeM and ONDC have **no public seller "push" API** for catalogs — sellers upload via the GeM portal / onboard via an ONDC seller app. So this feature **generates upload-ready files + a guide**, it does **not** transmit to any government system. Label the UI accordingly ("Download a GeM-ready catalog to upload on gem.gov.in", "ONDC Beckn payload, broadcast-ready"). This is the same honest framing already used by `/api/ondc/catalog`.

## MUST REUSE (don't reinvent, don't fork logic)
- Price: `getListingPrice` from `@/lib/pricing` (already used by ONDC). Sell price = `salePrice ?? getListingPrice(item)`.
- ONDC serializer: the Beckn builder in `src/app/api/ondc/catalog/route.ts`. **Refactor its provider/catalog builder into a shared `src/lib/ondcCatalog.ts`** (`buildOndcCatalog(rows, origin)`), then have BOTH the existing public route and the new artisan-scoped export import it — no copy-paste, no behavior change to the public route.
- Item source + fields: same `CraftItem` selection shape as `src/app/api/artisan/listings/route.ts` (`LISTING_FIELDS`) and the ONDC route's select (craftType, descriptionEnglish, aiGeneratedListing, images, askingPrice, salePrice, standardMarketPrice, marketPriceMin/Max, fairWageFloor, patchId, tags, giTagApplied, aiSuggestedCategory, isListedOnMarketplace, artisan.artisanProfile{location, clusterName, giTagName, socialCategory}).
- Auth: copy the `requireArtisan()` helper pattern from `src/app/api/artisan/listings/route.ts`.
- Location split: `locateCity` / the `splitLocation` helper already in the ONDC route.

## DATA MODEL
No schema change. Export the artisan's **listable** items: `isListedOnMarketplace === true` OR `patchId !== null` (verified). If none, the UI shows an empty state (see below).

## NEW FILE 1 — `src/lib/gemCatalog.ts` (deterministic, no AI, unit-testable)
A pure module that maps `CraftItem` rows → GeM catalog rows and serializes CSV/JSON.
- **HSN + GST are indicative, not authoritative.** Provide a small keyword→HSN map with a safe fallback, and mark them for confirmation (they're tax-sensitive — never present a guessed HSN as final):
  - silk → `5007`; cotton/handloom fabric or saree → `5208`; shawl/scarf/stole/dupatta → `6214`; made-up textile / furnishing / bedcover → `6304`; carpet/rug/durrie → `5705`; terracotta/pottery/ceramic → `6913`; wood/wooden → `4420`; bamboo/cane/basket → `4602`; brass/metal → `8306`; jute → `6305`; **default** → `""` (blank, flagged "confirm HSN").
  - GST: default `5` for textiles/handloom, else leave `""`; label as "indicative — confirm on GeM".
- **GeM CSV columns** (standard GeM product fields; category-specific attributes vary, so this is a clean generic template the seller finishes on the portal):
  `Product Name, Brand, Brand Type, Model Number, Category, Sub-Category, HSN Code, Product Description, Specifications, MRP (INR), Selling Price (INR), Minimum Order Quantity, Available Stock, Unit of Measurement, Country of Origin, GST (%), Seller SKU, Image URL 1, Image URL 2, Image URL 3`
  Mapping: Product Name = `craftType` (+ GI tag if any); Brand = `Unbranded`; Brand Type = `Unbranded`; Model Number = `patchId || id`; Category = `Handloom & Handicrafts`; Sub-Category = `aiSuggestedCategory || craftType`; HSN = map above; Description = `aiGeneratedListing || descriptionEnglish || craftType`; Specifications = joined `tags` + craft type; MRP = `standardMarketPrice || marketPriceMax || sellPrice`; Selling Price = `sellPrice`; MOQ = `1`; Stock = `1`; UoM = `Piece`; Country of Origin = `India`; GST = map; SKU = `id`; Image URL 1..3 = absolute image URLs (reuse the ONDC route's `absoluteImages`; take first 3).
- **CSV correctness (critical):** implement RFC-4180 escaping — wrap any field containing a comma, double-quote, or newline in double quotes and double any inner quotes. Prepend a UTF-8 BOM so Excel opens Hindi/Odia text correctly. Do not hand-concatenate without escaping.
- Export `toGemRows(items, origin)`, `toGemCsv(rows)`, `toGemJson(rows)`.

## NEW FILE 2 — `src/lib/gemGuidance.ts` (deterministic, personalized, no AI)
`buildGemGuidance(profile, craftType)` returns a structured step-by-step guide (array of steps + a title), personalized from real facts. **Do not use an LLM here** — it must always work and never hit a quota. Facts to encode (all verifiable — see Sources):
- Title example: `How to submit your {craftType} to GeM under the SC/ST artisan quota` (swap the qualifier by `socialCategory`: SC/ST → "SC/ST artisan quota"; women artisan → "Womaniya"; else → "MSME seller").
- Steps: (1) Register as a seller on **gem.gov.in** using **Aadhaar + PAN + Udyam (MSME) registration**; GSTIN if applicable (handloom/khadi may be exempt) — done online, no office visit. (2) Complete seller profile & bank details. (3) Upload this catalog (CSV) under **Handloom & Handicrafts**; for rural artisan/SHG products use the **SARAS Collection** channel on GeM. (4) Add high-res images (min 1000×1000). (5) Government-buyer purchase preference the artisan qualifies for — personalize: **SC/ST-owned MSE → 4% procurement sub-target** (within the 25% MSE target); **women → Womaniya (3%)**; **startup → Startup Runway (no DPIIT certificate needed)**. (6) For ONDC, onboard via an ONDC Seller App using the Beckn payload from this export. (7) Also consider Flipkart Samarth for artisan/weaver onboarding.
- Return values (title + steps + which preference applies) so the UI renders them; keep each step ≤ ~30 words and translatable.

## NEW FILE 3 — `src/app/api/artisan/gem-export/route.ts` (GET, auth ARTISAN)
- `requireArtisan()`; load this artisan's listable items (select the fields above).
- Query `?format=csv|json` (default `csv`).
  - `csv` → `toGemCsv(...)`, return with headers `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="karigari-gem-catalog.csv"`.
  - `json` → `toGemJson(...)` as `application/json` (attachment).
- Also return, on a `?format=guidance` (or a small JSON GET), the `buildGemGuidance(...)` output for the modal (or compute guidance client-side from `/api/artisan/dashboard` profile — your call; keep it one clean source).
- Empty state: if no listable items, return `{ success: true, empty: true, count: 0 }` (200) so the UI can explain rather than download an empty file.

## EXTEND — artisan-scoped ONDC
Add an optional `?artisanId=` (or `?providerId=`) filter to `/api/ondc/catalog` (via the shared `buildOndcCatalog`) so the export can offer **this artisan's** Beckn payload, e.g. `/api/ondc/catalog?artisanId=<me>`. Keep the unfiltered public behavior unchanged when the param is absent.

## NEW FILE 4 — `src/components/GovExportModal.tsx` + wire into insights
- In `src/app/artisan/insights/page.tsx`, add an **"Export to Government Platforms"** card/button (themed, mint/primary, `lucide-react` icon e.g. `Download`/`Building2`) near the market-insight content. Clicking opens `GovExportModal`.
- Modal contents:
  - Count of items that will be exported ("Export N verified products").
  - Buttons: **Download GeM CSV**, **Download GeM JSON**, **Download ONDC (Beckn) JSON** (opens `/api/ondc/catalog?artisanId=<me>` — get the id from `/api/auth/me` or the dashboard profile).
  - **Downloads via Blob**: `fetch` the endpoint → `res.blob()` → `URL.createObjectURL` → click a temporary `<a download>` → revoke. (Don't just `window.open` the CSV.)
  - A **"How to submit to GeM" guide** panel rendering `buildGemGuidance(...)` steps, personalized to the logged-in artisan.
  - **Empty state**: if `count === 0`, show "You need at least one verified/listed product to export. Complete a draft or list an item first." with a link to the marketplace/dashboard — no broken download.
- Handle 401/403 like the other artisan pages (redirect to `/login`), and show a small error toast on fetch failure. Add the new UI strings to `useLanguage`/`translations.ts` in all four languages.

## GUARDRAILS (this must be error-free)
- **No AI/LLM dependency** anywhere in this feature — CSV, JSON, and guidance are all deterministic. It must work even with the Gemini/Groq keys unset.
- **No new npm packages** — build the CSV by hand (with correct RFC-4180 escaping + BOM), JSON natively, downloads via Blob.
- **Reuse** `getListingPrice`, the extracted `buildOndcCatalog`, `locateCity`, `requireArtisan`, and the existing image-absolutizing helper — do not duplicate.
- Do **not** change the existing public `/api/ondc/catalog` output shape (only add the optional filter via the shared builder).
- HSN/GST are shown as **indicative, confirm on GeM** — never assert a guessed HSN as final.
- Keep theme + i18n; no off-theme colors; no `NaN`/empty-cell surprises (blank, not "undefined").

## VERIFY (report results)
1. `npx tsc --noEmit && npm run build` pass.
2. As an artisan with ≥1 verified/listed item: open Insights → "Export to Government Platforms" → **GeM CSV** downloads, opens cleanly in Excel/Sheets with readable Hindi/Odia (BOM works), correct columns, one row per product, prices from `getListingPrice`, images as absolute URLs, commas inside descriptions properly quoted.
3. **GeM JSON** downloads and is valid JSON with the same rows.
4. **ONDC JSON** (`?artisanId=me`) downloads and contains only this artisan's items; the unfiltered `/api/ondc/catalog` is unchanged.
5. The guide panel shows the personalized title/steps (SC/ST → 4% quota + SARAS; women → Womaniya; else → MSME) with no AI call.
6. Empty-state path works (an artisan with no listable items sees the message, not a broken file).
7. Report new/changed files and confirm the public ONDC route still returns its original payload.

## SOURCES (facts encoded above — for confirmation)
- GeM SC/ST 4% sub-target within 25% MSE procurement, Womaniya 3%, Startup Runway, SARAS Collection for artisans/weavers, Aadhaar/PAN/Udyam onboarding: https://taxguru.in/finance/ever-evolving-gem-opportunities-challenges.html and https://gem.gov.in
- GeM catalog fields / listing process: https://gem.gov.in/landing/index/Catalogue_Management
- ONDC/Beckn spec (already used): https://github.com/ONDC-Official/ONDC-RET-Specifications
