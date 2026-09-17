# KARIGARI V12 Enhancement Programme — Progress Ledger

Branch: feat/v12-enhancements
Baseline commit: c70097a (c70097ada1c3d31199342953c7f9dcd85f6c7125, branched from `feat/gov-catalog-export`)
Baseline gates: tsc PASS | lint 293 (115 errors, 178 warnings — all pre-existing) | build PASS

Spec: `KARIGARI_ENHANCEMENTS_V12_MASTER_PROMPT.md` at the app root.

| Phase | Feature | Status | Commit | Date | Notes |
|:--|:--|:--|:--|:--|:--|
| 0 | Baseline & ledger | DONE | e12da52 | 2026-09-16 | No feature code. Baseline gate numbers below. |
| 1 | Hybrid Income Tracker (offline sale ledger) | DONE | 6ea6a6d + 8b28a0e | 2026-09-17 | Code in 6ea6a6d; browser page checks and three fixes they found in 8b28a0e. One sub-check verified at API level only: the "Real local sales" line inside the capture modal's price step (see detail). |
| 2 | Buyer Intelligence ("My Buyers" CRM) | DONE | (this commit) | 2026-09-17 | Marketplace search + search log, `/api/artisan/buyers`, My buyers tab. 15 unit checks, 28 live API checks, browser checks in four languages at 360 px. |
| 3 | Production Credit Score + bank share link | PENDING | — | — | — |
| 4 | Buyer Discovery Page (QR passport + product page) | PENDING | — | — | — |
| 5 | AI Learning Pathways (skill stages, offline cache) | PENDING | — | — | — |
| 6 | Proactive Supply Intelligence (20-day reminder) | PENDING | — | — | — |
| 7 | Sync Status Indicator ("Synced 2 min ago") | PENDING | — | — | — |
| 8 | Workshop Resources (rename + repair + tool schemes) | PENDING | — | — | — |
| 9 | Recognition & Anonymous Cluster Benchmarks | PENDING | — | — | — |
| 10 | Design Lab (AI concept + SVG motif composer) | PENDING | — | — | — |
| 11 | Digital Craft IP Registry (motif fingerprint + licensing) | PENDING | — | — | — |
| 12 | Scrap-to-Wealth (circular economy module) | PENDING | — | — | — |
| 13 | Influencer commission model — artisan-funded 5% opt-in | PENDING | — | — | — |

A commit cannot contain its own hash, so the newest row reads `(this commit)`;
each phase backfills the previous row's short sha when it updates this file.

## Phase 2 detail
- Status: **DONE** (2026-09-17)
- Schema: `MarketplaceSearch` model (additive; pushed with `db push --url $DIRECT_URL`). Single writer: `POST /api/market/search-log`. Single reader: `GET /api/artisan/buyers`.
- Files created: `src/lib/searchLog.ts` (`saltedIpHash`, `clientIp`, `normaliseSearchTerm`, the 3 / 80 / 10-minute constants) · `src/lib/buyers.ts` (pure: `aggregateBuyers`, `buildDemandSignals`, `normaliseBuyerKey`, thresholds) · `src/app/api/market/search-log/route.ts` · `src/app/api/artisan/buyers/route.ts` · `src/components/MyBuyers.tsx` · `src/components/BuyersMonthlyChart.tsx` · `src/lib/__tests__/buyers.test.mjs`
- Files modified: `prisma/schema.prisma`, `package.json` (`test:buyers`, added to `test:all`), `src/app/api/creators/track/route.ts` (its inline IP hash replaced by `saltedIpHash()`, byte-for-byte the same digest), `src/app/marketplace/page.tsx` (search box, `?q=` sync, debounced log), `src/app/artisan/earnings/page.tsx` (Money / My buyers tabs through `useUrlTab`), `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 49 × 4 dictionaries (all 28 in §2.4 plus 21 the UI needed, incl. the marketplace search strings). Coverage script: 0 missing in any language, placeholders identical to English.
- Gates: tsc PASS | lint 115 / 178, 0 files worse than baseline (the marketplace page keeps its one baseline `set-state-in-effect` error, on the existing `setVisible` effect) | build PASS, baseline warnings only | `test:all` PASS (orderStage, offlineSaleParse, buyers 15 checks)
- Verification — live API against `next dev` (28/28):
  - ✓ Lakshmi: "Biswajeet" and "Biswajeet Sahoo" stay two buyers; 3 unnamed storefront sales counted in revenue, not listed; repeat rate hidden below 3 buyers
  - ✓ Received reconciles with the Money tab per stream: storefront 74,397 = `onlineEarnings`, demand 0 = `demandEarnings`, offline = `offlineEarnings`
  - ✓ Search log: always 204 with no body; same term from the same visitor within 10 min → one row; six visitors → six rows stored normalised; "ab" → nothing stored; a 500-character term with control characters → clamped to 80, control characters removed, non-numeric count → 0; empty body → 204
  - ✓ With ≥5 matching searches: source SEARCHES, basis 8, "sambalpuri dupatta" ×6 share 0, "sambalpuri jacket" ×2 share 1 (unmet). The same searches do not count for a Pattachitra artisan, whose open Pattachitra request gives source DEMANDS
  - ✓ Offline sales "Meena Das" / "meena   das" / "  MEENA DAS " → one buyer, 3 purchases, ₹1,500, latest spelling shown; "राधा" and "Radha" stay separate; unnamed offline sale counted but not listed; 5 buyers → repeat rate 20%
  - ✓ Unauthenticated `GET /api/artisan/buyers` → 401
- Verification — browser (Browser pane, signed in as lakshmi@karigari.com):
  - ✓ `/artisan/earnings?tab=buyers` deep-links, survives reload, "Earnings" stays highlighted in the rail; switching tabs rewrites `?tab=`
  - ✓ Tiles: 5 buyers · 1 repeat ("20% came back") · 0 B2B · Received ₹76,697 = Storefront ₹74,397 + Demand ₹0 + Offline ₹2,300; the Money tab's TOTAL INCOME reads ₹76,697 too
  - ✓ MEENA DAS expands to her three ₹500 purchases with first-bought date; Offline and Repeat badges; filters All 5 / Repeat 1 / B2B 0 ("No buyers in this view yet.") / Offline 3
  - ✓ Footnote "Sales with no buyer name recorded: 4…"; "Buyers by month" stacked chart with legend, September tooltip "New 4 · Came back 1"
  - ✓ "What buyers are looking for": source line names searches and window; "sambalpuri jacket" carries the maroon marker and "Nobody is listing this"
  - ✓ Empty states, from real API responses of other accounts replayed into the page (the agent cannot sign in as them): a brand-new artisan (adi@) shows "No buyers yet… Nothing to show yet.", ₹0 tiles, the repeat-rate threshold and the no-signal line naming its thresholds; Raghunath (unnamed sales only) shows the footnote and the open-request source
  - ✓ 120-buyer response: 50 rows, "Show 50 more" → 100, "Show 20 more" → 120, button gone
  - ✓ `/marketplace`: typing "pattachitra" filters to 2 pieces, status "Matching “pattachitra”: 2", URL `?q=pattachitra`, exactly one log request after typing stopped (row stored with count 2); "kalamkari lamp" → "Nothing matches…" with Clear search, logged with count 0; `?q=` survives reload; Clear resets the grid and the URL
  - ✓ `/artisan/earnings?tab=buyers` and `/marketplace?q=…` in en / hi / or / te at 360 px: scroll width 360, no overflowing element, no raw keys
  - ✓ Console: no React warnings and no errors from these pages. The only errors in the tab were the HMR socket from a server restart and two pre-existing Leaflet dev errors on the landing page `/`, which the pane opens at start
  - ✓ Cleanup: all 6 test offline sales undone through the app; 11 test search rows deleted by exact test term and test-IP hash within the test window; 0 left
- Decisions and deviations:
  1. "This artisan's craft" for demand signals is the profile craft **and** up to 20 of their catalogue craft types, each through `craftMatchScore()`. The profile alone ("Sambalpuri Ikat Silk Saree") would miss what the artisan also sells ("…Dupatta").
  2. SEARCHES is used only when ≥5 matching searches exist **and** at least one term reaches 2 searches; otherwise it falls back to open requests. This avoids a "from N searches" line above an empty list.
  3. `MIN_BUYERS_FOR_REPEAT_RATE = 3`: below it `repeatRatePct` is null and the tile names the threshold.
  4. `revenueByChannel` counts every purchase, named or not, so it reconciles with the Money tab; `summary.unnamed` gives per-channel counts for the footnote.
  5. The storefront source excludes `SOLD_OFFLINE` pieces; those belong to the offline source, and counting them twice would inflate buyers and money.
  6. Buyer keys and search terms are NFC-normalised as well as lower-cased and whitespace-collapsed. That changes composition only; no letters are stripped.
  7. A storefront purchase made against a BULK/WHOLESALE demand (`relatedDemandId`) also makes the buyer B2B.
  8. `resultCount` is counted over every listed piece, before the category and verified filters, so narrowing a category never makes a term look like unmet demand.
  9. The search box sits in the marketplace masthead's control row (full width on phones) in TopBar's input style, as `type="text"` with `inputMode="search"` so the browser's own clear control does not duplicate ours.
- Known follow-ups:
  - `x-forwarded-for` is trusted as-is, exactly as affiliate clicks already trust it; on Vercel the platform sets it, but a client could spoof it against a self-hosted server.
  - Pre-existing and out of scope: several marketplace labels ("Filter", "Sort", "Load more artifacts", "Marketplace"…) are hard-coded English.

## Phase 1 detail
- Status: **DONE** (2026-09-17). Code landed in `6ea6a6d` as PARTIAL; the page checks were then run in the Browser pane after the owner signed in, and the three defects they found are fixed in the follow-up commit. One §1.8 sub-check is verified at API level only — see "Verified at API level only" below.
- Schema: `OfflineSale` model (additive; pushed with `db push --url $DIRECT_URL`); `User.offlineSales`; `CraftItem.offlineSale`. Single writer: `POST /api/artisan/offline-sales` (also what the offline queue replays); only delete is that route's 24 h undo.
- Files created:
  `src/lib/offlineSales.ts` (pure domain: channels, thresholds, amount/date normalisation, median, `buildPriceSignal`, `buildComparison`, error codes) ·
  `src/lib/offlineSaleParse.ts` (rule-based parser, four languages) ·
  `src/lib/localMarketSignal.ts` (server helper for the pricing routes) ·
  `src/lib/speechCapture.ts` (speech primitives moved out of `VoiceOnboarding.tsx`) ·
  `src/lib/useSpeechCapture.ts` (hold-to-speak hook on those primitives) ·
  `src/app/api/artisan/offline-sales/route.ts` (GET / POST / DELETE) ·
  `src/app/api/artisan/offline-sales/parse/route.ts` ·
  `src/app/artisan/log-sale/page.tsx`, `loading.tsx` ·
  `src/lib/__tests__/offlineSaleParse.test.mjs`
- Files modified: `prisma/schema.prisma`, `package.json` (`test:order-stage`, `test:offline-parse`, `test:all`), `src/lib/storefrontSale.ts`, `src/components/ui/Badge.tsx`, `src/lib/shopify.ts`, `src/lib/offlineQueue.ts` (DB_VERSION 2, additive `offlineSales` store), `src/lib/offlineSync.ts`, `src/lib/offlineQueueStore.ts`, `src/components/ui/Sidebar.tsx`, `src/app/api/artisan/dashboard/route.ts`, `src/app/artisan/earnings/page.tsx`, `src/components/EarningsAnalytics.tsx`, `src/app/artisan/dashboard/page.tsx`, `src/app/api/items/price-estimate/route.ts`, `src/app/api/items/price-market/route.ts`, `src/components/CaptureModal.tsx`, `src/components/VoiceOnboarding.tsx`, `src/app/artisan/layout.tsx`, `src/app/artisan/market/page.tsx`, `src/components/ShopifyShopCard.tsx`, `src/app/verify/[patchId]/VerificationClient.tsx`, `src/app/api/verify-authenticity/route.ts`, `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 104 × 4 dictionaries (all 38 keys listed in §1.6 plus 66 the UI needed). A script confirmed every key the new code reads exists in all four, with placeholders identical to English. English `ticker_offline` / `ticker_syncing` / `ticker_waiting` now say "items" rather than "captures", because the queue count includes sales; hi/or/te already said "items".
- Gates:
  - tsc PASS (0 errors)
  - lint: 115 errors / 178 warnings, identical to baseline; per-file comparison shows **0 files worse than baseline**; every new file lints clean
  - build PASS; the only warnings are the two baseline ones (lockfile root, Node ExperimentalWarning ×8)
  - `npm run test:all` PASS (orderStage 672 combinations; offlineSaleParse 41 utterances across en/hi/or/te incl. adversarial + 20 domain checks)
  - Re-run after the page-check fixes (2026-09-17): tsc PASS; lint 115 / 178 with 0 files worse than baseline; build PASS with only the baseline warnings; test:all PASS
- Verification actually performed (against `next dev`, demo account lakshmi@karigari.com, session signed locally with `JWT_SECRET` — 48/48 checks):
  - ✓ Empty ledger: count 0, `signal` null, `comparison` null, no median anywhere; dashboard offline stream 0
  - ✓ Parse route: "pandrah sau rupaye ka dupatta becha" → 1500 / Dupatta (Groq + rules, no conflict); a phone number → amount null; empty transcript → 200 with `success:false`, never 500
  - ✓ Validation, each with its own code: future date, >2 years back, amount 0, paise, >₹1,00,00,000, quantity 1000, blank label, 121-char label
  - ✓ "₹ 1,500" and "१८००" normalised; unknown channel stored as OTHER, "walk_in" as WALK_IN
  - ✓ 1 and 2 sales: no median, `progress` names the shortfall (1 of 3, 2 of 3); 3 sales: median ₹1,500 from 3
  - ✓ A sale dated last month lands in last month (this month 2,700 / last month 1,800) in both the ledger totals and the dashboard monthly series
  - ✓ `price-estimate` and `price-market` return `localMarketSignal` (median 1500, n 3); null for a craft below threshold
  - ✓ ₹1,50,000 questioned with 422 AMOUNT_HIGH at 20× the artisan's median (₹30,000); saved after `confirmHighAmount`
  - ✓ Catalogued piece: status → SOLD_OFFLINE, escrow/advance/paidAt untouched, AuditLog `SOLD_OFFLINE_LOGGED` with `previousState`, storefront item `sold:true / buyable:false`, absent from the `listed=1` grid
  - ✓ Same piece again → 409; two simultaneous logs of one piece → one 201, one 409, exactly one row
  - ✓ Piece already paid online → 409 PIECE_SOLD_ONLINE carrying the paid date; another artisan's piece → 403
  - ✓ Dashboard: `offlineEarnings` 7,900 / 5 sales reported separately; `totalEarnings` unchanged (74,397 before and after); `onlineEarnings + demandEarnings = totalEarnings`; platform monthly `amount` series unchanged
  - ✓ Undo restores the piece to its recorded previous status (VERIFIED), writes `SOLD_OFFLINE_REVERSED`, piece buyable again; unknown id 404; another artisan cannot undo
  - ✓ With GROQ_API_KEY, GROK_KEY and GEMINI_API_KEY blank (production build on :3001): Hindi and Telugu voice still parse (engine `rules`, notice `ai_unconfigured`); price-estimate degrades and still carries the signal
  - ✓ Every test row removed afterwards through the app's own undo route; the three touched pieces are back to VERIFIED / SELLABLE / SELLABLE. The AuditLog rows for those pieces remain, as audit history is append-only by design.
- Browser page checks (2026-09-17, `next dev`, Browser pane signed in by the owner as lakshmi@karigari.com):
  - ✓ `/artisan/log-sale` empty state: ₹0 "None logged yet", no median, shortfall names its threshold ("needs at least 3 offline and 2 online sales of this craft; you have 0 and 0")
  - ✓ Typed sale "₹1,500" saved → "Sale saved"; ledger ₹1,500; median card "2 more sales…"; second sale (Devanagari "१२००", Walk-in, Yesterday) → "1 more sale of this craft and we can show your local median"
  - ✓ Offline (the page's own `navigator.onLine` / `offline` event path): save → "Saved on this phone", header badge "Offline — 1 saved on phone" → back online → uploaded, ₹1,800 lands in LAST MONTH, card reads "median ₹1,500 from 3 sales in the last 6 months"
  - ✓ Queued sale whose piece was already paid online → refused row "Could not be saved — this piece sold online on 03 Sept 2026. Your amount is kept." → "Save without this piece" uploads the ₹2,400 with the piece detached; the paid piece is untouched
  - ✓ IndexedDB upgraded to v2 in the browser with both `captures` and `offlineSales` stores present
  - ✓ Catalogued piece picked from the rail (label prefilled read-only) → saved → `/artisan/market` "Sold" filter lists it with a "Sold offline" badge and no order-progress controls
  - ✓ Two-tap Undo on that sale → row gone, "Sale removed…" notice, piece back to its recorded SELLABLE with `SOLD_OFFLINE_REVERSED` in AuditLog
  - ✓ Voice → form: with the pane's microphone blocked, the mic button shows "The microphone is off for this site. Type the sale below instead."; with a stand-in recognizer supplying "pandrah sau rupaye ka dupatta becha, kal haat mein", the real page path (hook → parse route → form) shows "We heard", fills ₹1500 / Dupatta / yesterday / Haat, says "Nothing is saved until you tap Save", and saves nothing. The saved row records `captureMethod: VOICE`. Real microphone capture cannot run in the Browser pane.
  - ✓ ₹1,50,000 → "₹1,50,000 is much higher than your usual sales. Is that right?" with a confirm button; nothing saved
  - ✓ `/artisan/earnings`: TOTAL INCOME ₹84,497 = Online (settled) ₹74,397 + Demand orders ₹0 + Offline (self-logged) ₹10,100; the total's tooltip on keyboard focus reads "Online ₹74,397 + demand orders ₹0 + offline ₹10,100"; monthly chart stacks three series with a legend; September tooltip names all three streams
  - ✓ `/artisan/dashboard`: TOTAL INCOME tile ₹84,497 with the three parts on its delta line
  - ✓ `/artisan/log-sale`, `/artisan/earnings`, `/artisan/dashboard` in en / hi / or / te at 360 px: page scroll width = 360, no element overflows, no raw i18n key rendered; `/artisan/market` in Odia shows "ଅଫଲାଇନ ବିକ୍ରି ହୋଇଛି"
  - ✓ Fresh loads of all four pages: zero React warnings, zero uncaught errors. The only console errors in the session were the pre-login 401s, the dev-server restart's HMR socket, the deliberate 409/422 refusal tests, a 404 from a probe script, and one transient HMR `Store is not defined` while the market page's import was mid-edit
  - ✓ Cleanup: every test sale undone through the app (0 left), the phone queue empty, the form draft cleared; pieces back to VERIFIED / SELLABLE / SELLABLE
- Defects the page checks found, fixed in the follow-up commit:
  1. `/artisan/log-sale` scrolled the whole page sideways: a `<fieldset>` defaults to `min-width: min-content`, so it grew to the piece rail's full width. Fixed with `min-w-0`.
  2. After a queued sale uploaded, the success card still said "You are offline. It will upload…". It now switches to "Sale saved" once the phone's queue is empty.
  3. `/artisan/market` showed "LIVE ON ONDC" and live production-stage buttons on a SOLD_OFFLINE piece. It now shows a "Sold offline" badge and no stage controls.
- Verified at API level only:
  - The "Real local sales: median ₹X from N sales" line in CaptureModal Step 3. `price-estimate` / `price-market` return `localMarketSignal` correctly (checked live, with and without AI keys) and the page shows the median everywhere else, but reaching Step 3 in the pane needs a photo upload plus live Gemini vision and smart-draft calls on the free-tier key (20 requests/day, shared with the demo), so it was not rendered.
- Pre-existing, noticed but out of scope: the earnings page subtitle and several of its older labels ("Gross sales", "Fair wage index", "Recent activity"…) are hard-coded English; `/artisan/dashboard` overflows below 360 px (seen at 313 px).
- Decisions and deviations, each deliberate:
  1. **SmartDraftAssistant** renders no price band (it is the Step 1 follow-up questioner), so there was no "AI band" to place the signal above. The signal is rendered in CaptureModal Step 3, above the AI band, where the price is actually set.
  2. **`MIN_ONLINE_SAMPLES = 2`.** §1.4 says one online sale suffices, but §1.4 also says "never compute a delta from one row on either side"; the stricter rule wins and is named in the UI.
  3. **A piece Karigari already has money against** (escrow set, or `advancePaid > 0`) is refused with 409 PIECE_HAS_PLATFORM_MONEY, in addition to the paid/sold guards the spec lists.
  4. **`src/app/artisan/layout.tsx`**: a failed `/api/auth/me` while `navigator.onLine === false` now shows the shell instead of redirecting to /login. Without it no artisan page, including this one, could survive an offline reload. Every API call still checks the session server-side.
  5. **`src/app/api/verify-authenticity/route.ts`**: a genuine buyer scan no longer rewrites a SOLD_OFFLINE piece to SOLD_FINAL (which would have turned a haat sale into platform income in every earnings query).
  6. **`withdrawSoldPiece(id, soldVia)`**: the optional second argument only changes the recorded wording, so an offline sale is not described as "sold on Karigari". Existing callers are unchanged.
  7. **Speech**: the recognizer/recorder primitives moved verbatim from `VoiceOnboarding.tsx` into `src/lib/speechCapture.ts` (VoiceOnboarding now imports them); the page uses a small hook on top. CaptureModal's Whisper recorder is untouched.
  8. The separate "Demand orders" card on the earnings page is gone, because demand is now one of the three headline streams. Its keys `demand_orders_label` / `demand_orders_note` are now unused.
  9. `prisma format` was not run: it realigns the whole schema file.
- Known follow-ups:
  - Render the Step 3 "Real local sales" line once, in a capture with a real photo, on a day with Gemini quota to spare.
  - Replay idempotency: if a queued sale's POST commits but its response is lost, the next flush logs it again. The capture queue has the same property. A client-generated reference column would close it.
  - No demo artisan has two online sales of the same craft, so the offline/online comparison shows its not-enough-data state on live data. Its arithmetic is covered by the unit test.
  - Shopify withdrawal on an offline log was not exercised live, because no demo piece is LIVE on Shopify. An undo does not re-publish a withdrawn Shopify product (WITHDRAWN is terminal by design).

## Phase 0 detail
- Schema: none
- Files created: `docs/ENHANCEMENTS_PROGRESS.md`; `KARIGARI_ENHANCEMENTS_V12_MASTER_PROMPT.md` committed (was untracked, byte-identical to the prompt supplied for this programme — the repo keeps every master prompt at the app root)
- Files modified: none
- i18n keys added: 0
- Gates: tsc PASS (0 errors) | lint 115 errors / 178 warnings, all pre-existing | build PASS
- Manual verification:
  - On branch `feat/v12-enhancements`, created from `c70097a`; tree was clean apart from the untracked prompt copy
  - `npm install` a no-op ("up to date, audited 914 packages"); `postinstall` regenerated Prisma Client 7.10.0; no lockfile change
  - Baseline `tsc` / `lint` / `build` results recorded below
  - Required files read end to end: `prisma/schema.prisma`, `src/app/globals.css`, `src/components/ui/{AppShell,Sidebar,TopBar}.tsx`, `src/lib/{escrow,pricing,storefrontSale,notifications,offlineQueue,offlineQueueStore}.ts`, `src/app/artisan/earnings/page.tsx`, `src/app/api/artisan/dashboard/route.ts`, `docs/CONTRACT.md`
- Known follow-ups: none for this phase. See the baseline notes below before judging any later phase's gates.

### Baseline environment
- Node v26.8.1, Next.js 16.3.1 (`next build --webpack`), Prisma 7.10.0
- No dev server was running during the baseline.

### Baseline: `npx tsc --noEmit`
0 errors.

### Baseline: `npm run lint`
`✖ 293 problems (115 errors, 178 warnings)` — exits 1. **Every one is pre-existing and out of scope
for this programme.** The rule for later phases is therefore "no file gains a problem", measured
against the per-file table below, not "lint exits 0".

**114 of the 178 warnings are in generated, gitignored PWA files under `public/`** (`sw.js`,
`workbox-*.js`, `fallback-*.js`, `swe-worker-*.js`), which `next build` rewrites. ESLint lints them
because they are not in its ignore list. Their hashed names can change between builds, so compare
the `src/` rows. Source-only baseline: **115 errors, 64 warnings**. Re-running lint after the
baseline build gave identical counts.

By rule:

| Count | Rule | Severity |
|--:|:--|:--|
| 95 | `@typescript-eslint/no-explicit-any` | error |
| 90 | `@typescript-eslint/no-unused-expressions` | warn (all in `public/` workers) |
| 82 | `@typescript-eslint/no-unused-vars` | warn |
| 10 | `react-hooks/set-state-in-effect` | error |
| 4 | `react-hooks/exhaustive-deps` | warn |
| 4 | `react/no-unescaped-entities` | error |
| 3 | `react-hooks/refs` | error |
| 2 | `@next/next/no-img-element` | warn |
| 1 | `react-hooks/immutability` | error |
| 1 | `react-hooks/purity` | error |
| 1 | `react-hooks/preserve-manual-memoization` | error |

By file (errors | warnings):

| File | E | W |
|:--|--:|--:|
| `public/fallback-ce627215c0e4a9af.js` | 0 | 23 |
| `public/sw.js` | 0 | 3 |
| `public/swe-worker-5c72df51bb1f6ee0.js` | 0 | 1 |
| `public/workbox-d825fed3.js` | 0 | 87 |
| `scratch/translations.ts` | 2 | 0 |
| `src/app/api/admin/ban-artisan/route.ts` | 2 | 1 |
| `src/app/api/admin/dashboard/route.ts` | 10 | 2 |
| `src/app/api/admin/export-compliance/route.ts` | 2 | 2 |
| `src/app/api/admin/payouts/route.ts` | 4 | 3 |
| `src/app/api/admin/simulate-sale/route.ts` | 2 | 1 |
| `src/app/api/admin/verify-batch/route.ts` | 3 | 1 |
| `src/app/api/artisan/cross-check/route.ts` | 3 | 1 |
| `src/app/api/artisan/dashboard/route.ts` | 4 | 2 |
| `src/app/api/artisan/request-review/route.ts` | 2 | 1 |
| `src/app/api/artisan/schemes/apply/route.ts` | 2 | 0 |
| `src/app/api/artisan/schemes/route.ts` | 2 | 0 |
| `src/app/api/disbursement/apply/route.ts` | 5 | 1 |
| `src/app/api/items/capture/route.ts` | 2 | 2 |
| `src/app/api/users/admins/route.ts` | 0 | 1 |
| `src/app/api/verify-authenticity/route.ts` | 5 | 0 |
| `src/app/api/verify/[patchId]/route.ts` | 1 | 0 |
| `src/app/artisan/dashboard/page.tsx` | 16 | 4 |
| `src/app/artisan/learn/page.tsx` | 2 | 0 |
| `src/app/artisan/marketing/page.tsx` | 0 | 3 |
| `src/app/artisan/materials/page.tsx` | 0 | 1 |
| `src/app/buyer/verify/page.tsx` | 0 | 1 |
| `src/app/creators/page.tsx` | 0 | 6 |
| `src/app/marketplace/page.tsx` | 1 | 0 |
| `src/app/register/page.tsx` | 1 | 0 |
| `src/app/verify/[patchId]/page.tsx` | 0 | 17 |
| `src/app/verify/[patchId]/VerificationClient.tsx` | 3 | 2 |
| `src/components/AgentHandoffModal.tsx` | 1 | 0 |
| `src/components/CaptureModal.tsx` | 13 | 2 |
| `src/components/CrossCheckModal.tsx` | 2 | 1 |
| `src/components/DemandMap.tsx` | 0 | 1 |
| `src/components/DisputeModal.tsx` | 3 | 0 |
| `src/components/HeritageMarquee.tsx` | 0 | 3 |
| `src/components/ProfileEditorModal.tsx` | 8 | 0 |
| `src/components/SellModal.tsx` | 4 | 1 |
| `src/components/ui/AppShell.tsx` | 1 | 0 |
| `src/components/ui/AssistantChat.tsx` | 5 | 0 |
| `src/components/ui/Card.tsx` | 1 | 0 |
| `src/components/ui/Sidebar.tsx` | 0 | 1 |
| `src/components/VerificationCamera.tsx` | 0 | 3 |
| `src/lib/auditLogger.ts` | 2 | 0 |
| `src/lib/translations.ts` | 1 | 0 |

Several of these files are ones later phases must edit (`Sidebar.tsx`, `CaptureModal.tsx`,
`artisan/dashboard/page.tsx`, `api/artisan/dashboard/route.ts`, `marketplace/page.tsx`,
`auditLogger.ts`). Their counts above are the ceiling for those files.

### Baseline: `npm run build`
PASS — compiled in 19.6 s, TypeScript step clean, 30 static pages generated, PWA service worker
emitted to `public/sw.js`. Warnings already present, so not "new" in any later phase:
- `⚠ Warning: Next.js ignored package-lock.json in C:\Users\bmsah\Downloads\KARIGARI-main because it is outside the current Git repository` — caused by the throwaway `package-lock.json` in the parent folder (§2.1).
- `ExperimentalWarning: The supports Web Crypto API method is an experimental feature…` and `…ML-DSA-44 Web Crypto API algorithm…`, once per page-data worker — emitted by Node 26 itself during page-data collection, not by app code.

### Tests
No `test:all` script yet; `src/lib/__tests__/` holds only `orderStage.test.mjs`. Per §3.2 the
`test:all` gate starts once a phase adds tests.
