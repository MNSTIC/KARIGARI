# KARIGARI V12 Enhancement Programme — Progress Ledger

Branch: feat/v12-enhancements
Baseline commit: c70097a (c70097ada1c3d31199342953c7f9dcd85f6c7125, branched from `feat/gov-catalog-export`)
Baseline gates: tsc PASS | lint 293 (115 errors, 178 warnings — all pre-existing) | build PASS

Spec: `KARIGARI_ENHANCEMENTS_V12_MASTER_PROMPT.md` at the app root.

| Phase | Feature | Status | Commit | Date | Notes |
|:--|:--|:--|:--|:--|:--|
| 0 | Baseline & ledger | DONE | e12da52 | 2026-09-16 | No feature code. Baseline gate numbers below. |
| 1 | Hybrid Income Tracker (offline sale ledger) | DONE | 6ea6a6d + 8b28a0e | 2026-09-17 | Code in 6ea6a6d; browser page checks and three fixes they found in 8b28a0e. One sub-check verified at API level only: the "Real local sales" line inside the capture modal's price step (see detail). |
| 2 | Buyer Intelligence ("My Buyers" CRM) | DONE | f96d433 | 2026-09-17 | Marketplace search + search log, `/api/artisan/buyers`, My buyers tab. 15 unit checks, 28 live API checks, browser checks in four languages at 360 px. |
| 3 | Production Credit Score + bank share link | DONE | 6e91809 | 2026-09-17 | `creditScore.ts` (pure, 33 unit checks), frozen share snapshots, public `/credit/[token]` record that prints to one A4 page. 67 live API checks (one confirmed on a production build), browser checks in four languages at 360 px. |
| 4 | Buyer Discovery Page (QR passport + product page) | DONE | (this commit) | 2026-09-17 | Shared passport (story, timeline, 3-layer trust, similar request, more from artisan, gallery) on `/verify/[patchId]` and the product page. Fixes a PII leak on the QR page. 21 unit checks, 65 page checks on dev and on a key-less production build, browser checks in four languages at 360 px. |
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

## Phase 4 detail
- Status: **DONE** (2026-09-17)
- Schema: none.
- Files created: `src/lib/passport.ts` (server loader, explicit select, `cache()`d per request; photos referenced by URL, never inlined) · `src/lib/passportFacts.ts` (pure: `buildTimeline`, `buildTrustLayers`, `receivedFor`, `giLabelFor`, `materialFrom`/`colorFrom`, `demandDraftFor`) · `src/lib/demandDraft.ts` (demand-form vocabularies + `DemandDraft`, moved out of the modal) · `src/app/api/passport/[id]/image/route.ts` · `src/components/buyer/{PassportGallery,CraftStory,ProvenanceTimeline,TrustLayers,SimilarRequest,MoreFromArtisan}.tsx` · `src/components/buyer/passportFormat.ts` · `src/lib/__tests__/passportFacts.test.mjs`
- Files modified: `src/app/verify/[patchId]/page.tsx` + `VerificationClient.tsx` (rewritten on the passport), `src/app/marketplace/product/[id]/page.tsx` (server-loads the passport, `generateMetadata`) + `ProductClient.tsx` (gallery and passport sections; buy flow unchanged; `router.refresh()` after a verified payment), `src/components/PostDemandModal.tsx` (optional `initial` prop, default empty; vocabularies imported), `src/app/api/artisan/orders/verify-ready/route.ts`, `src/app/api/buyer/orders/verify/route.ts`, `src/app/api/buyer/verify-item/route.ts` (store a similarity score only when Gemini produced it), `package.json` (`test:passport` in `test:all`), `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 106 × 4 dictionaries (all 37 in §4.7 plus 69: hero, gallery, story lines, trust bodies, 13 language names). Coverage: 0 missing, placeholders identical; only `gallery_position` ("{n} / {total}") is the same string in every language.
- Gates: tsc PASS | lint 112 / 45 source, 0 files worse than baseline (the rewritten `/verify/[patchId]` page and client dropped 3 errors and 19 warnings; no other file changed) | build PASS, baseline warnings only | `test:all` PASS (+ passportFacts 21 checks)
- Verification — server (65/65 against `next dev`, and 65/65 again against a production build started with `GEMINI_API_KEY`, `GOOGLE_API_KEY` and `GROQ_API_KEY` blank):
  - ✓ Seven real pieces (verified + voice, QR-waived, sold with escrow held, settled, data-URL photo, bare unlisted, IVR): 200, `noindex, nofollow`, no mobile / UPI / bank / Aadhaar / buyer / Razorpay / payout-ref value or field name anywhere in the HTML or RSC payload, no base64 photo inlined (pages 54–61 KB)
  - ✓ Negative control: the pre-Phase-4 QR page, served by stashing only the two verify files, contained Jethiben's mobile number, the shared UPI id, a bank account number, `aadhaarLast4`/`bankAccountNumber`/`mobileNumber` keys, raw audit comments and "Authentic. Fair. Verified."
  - ✓ Waived piece reads "QR check waived (demo catalogue)" and never the matched step or badge; verified piece shows both; voice ("Catalogued by voice, in Gujarati") and IVR ("…over a phone call, in Odia") lines
  - ✓ Fair pay: unsold → ₹0 "Not yet sold"; sold + escrow held → ₹0 "held in escrow"; settled → ₹13,051 = ₹5,842 + ₹7,209 with the simulated-payout label
  - ✓ Timeline dates equal `createdAt` / `qrVerifiedAt` in IST; unlisted and unpaid steps grey with "Not recorded yet"; admin date from the `ADMIN_VERIFIED` row
  - ✓ GI line for certified Jethiben ("GI: Kutch Embroidery"), none for uncertified Imran
  - ✓ No "authenticated by AI", accuracy, "Authenticity score" or "Geographic Origin Protected" text on any page
  - ✓ Unknown patch → 404; image route: data photo 200 `image/jpeg` 192 KB, `&w=240` thumbnail 8 KB, public cache header, bad index / unknown item 404, path photo 307 to the file
  - ✓ Product page: title "Kutch Mirror Work Bridal Odhani by Jethiben Rabari · Karigari", meta description from the item, indexable, no patch ID, no PII
  - ✓ "More from this artisan": Imran's only buyable piece shows no rail; his other piece shows a rail of one
  - ✓ Key-less build: `/api/demand/recommend` still answers from rules; passport pages identical
- Verification — browser (Browser pane):
  - ✓ Gallery: ArrowRight/ArrowLeft move and wrap, a 100 px swipe moves, a 20 px swipe does not, full-size view opens with focus on Close, arrows work inside it, Escape closes and focus returns to "View full size"
  - ✓ "Want something similar?": the form opens with category Saree & Textile, craft type, colour "red", the Cotton chip and the piece's photo as a data URL. Quantity 3, colour changed to "maroon", posted: the page said 1 artisan notified. The stored demand matched (maroon, Cotton, 1 photo), with exactly 1 in-app alert (Jethiben) and no SMS (`outboundSid` null; no artisan number is on the SMS allow-list). Craft changed to "Venetian blown glass chandelier", category Other, posted: 0 alerts, and the page showed the no-match wording. Both test demands, their alerts and the buyer notification were deleted; the test buyer name was cleared from the pane's storage
  - ✓ Sold piece at 360 px: hero (patch-matched and Sold chips, raw patch ID), gallery, sold note, timeline, story (GI chip, bio, own-words quote, translation), fair pay with escrow explainer open, trust layers, similar request, rail, footer — in en / hi / or / te on the QR page and on the product page: scroll width 360, no overflowing element, no raw keys; language names translated ("गुजराती")
  - ✓ Console across both pages, four languages and the gallery / demand interactions: no errors, no React or hydration warnings. The only warnings are Chrome's "Unrecognized feature: 'web-share' / 'local-network-access'" from the Razorpay checkout iframe, which the product page already loaded before this phase
  - ✓ Throttled load (production build, Playwright, 390 px, Chrome "Fast 3G" 1.6 Mbps / 150 ms, fresh context each run): hero, story and timeline text painted at 1.1–1.6 s; the gallery photo (LCP) at 2.8 s, 2.8 s and 3.3 s (the first run hit a cold route); about 620 KB transferred. Warm server TTFB on the QR page dropped from 1.3 s to 0.35 s after the loader was cut to one query round
- Decisions and deviations:
  1. **PII leak fixed.** The QR page used to pass the whole item row and the whole artisan profile into a client component. Both surfaces now read one allow-listed `Passport`.
  2. **No placeholder similarity.** The shared photo comparator returns a fixed 98 when Gemini fails, and three routes stored that number as `readySimilarityScore` / `deliveryScanScore`. Those columns are documented as "never a placeholder number", so they now store only a Gemini-produced score. The passport shows a similarity only when one is stored, labelled "Image similarity" with its source and date.
  3. **Human-capture wording.** There is no geotag column, so geotagging is not claimed, and the capture layer does not say "at the workshop".
  4. **AI layer.** The QR-patch step is shown as an AI photo match: `/api/items/attach-verify` fails closed when the AI is down, so a pass is a real match.
  5. **Paid step reads `paidAt` only.** Thirty-one seeded SOLD_FINAL pieces have settled escrow but no `paidAt`. Their timeline shows "Paid: not recorded" while fair pay shows the released tranches — a seed artefact, not a guessed date.
  6. **Payouts labelled simulated** unless `payoutMode` is RAZORPAYX, per the honesty rule in `src/lib/escrow.ts`.
  7. **Removed from the old QR page:**
     - the hero "Authentic. Fair. Verified.";
     - an "Authenticity score" that was actually `fairnessScore`;
     - "Geographic Origin Protected" — the village is shown now, as the product page already did;
     - raw-material cost, which the market API treats as internal;
     - the raw audit-log list, whose comments carried patch IDs, payment IDs and buyer names.
  8. **Material and colour.** Whole-word matches from named term lists, read from the artisan's tags, then catalogue tags, then the English description.
  9. **New vertical `ProvenanceTimeline`.** `OrderTimeline` is order-stage specific and `ProgressStepper` is a horizontal label strip, so neither fit.
  10. **"More from this artisan"** applies `PURCHASABLE_WHERE` on the server rather than fetching `/api/items/market`, which ships every listing with its photos.
  11. **Reference photo** is converted to a data URL in the browser, because `POST /api/demand` accepts only data URLs.
  12. **Public image route.** It serves only `images[]` and look thumbnails — the same photos `/api/items/market?id=` already returns. Photos stored as a path redirect to the file.
- Known follow-ups:
  - No piece in the database has an AI photo-quality score, a material bill, stored looks, shipping timestamps or a stored similarity score. Those states are covered by the unit tests but have not been seen rendered with real rows.
  - A real phone scan over conference wifi was emulated (Playwright Fast 3G), not performed. App-wide web fonts (~230 KB) are now the largest transfer on the passport.
  - Pre-existing, not changed here:
    - the demand form's category names are English-only;
    - the recommendation panel's rule estimate (₹3,080 for a ₹30,771 odhani) is far from the listing price.

## Phase 3 detail
- Status: **DONE** (2026-09-17)
- Schema: `CreditProfileShare` model (token `@unique`, frozen `snapshot Json`, `version`, `sharedWith`, `viewCount`, `lastViewedAt`, `expiresAt`, `revokedAt`) and `User.creditShares`. Additive; pushed with `db push --url $DIRECT_URL`. Single writer: POST/DELETE `/api/artisan/credit-profile`; view counters written only by `openCreditShare()` in `src/lib/creditRecord.ts`.
- Files created: `src/lib/creditScore.ts` (pure: `computeCreditProfile`, every weight exported, `readCreditSnapshot` allow-list, `wholeMonthsBetween`) · `src/lib/creditShare.ts` (token, day limits, 5-link cap, `cleanSharedWith`) · `src/lib/creditRecord.ts` (`gatherCreditInputs` — one `Promise.all` of counts/sums plus one `COUNT(DISTINCT month)`; `listActiveShares`; `openCreditShare`) · `src/lib/publicOrigin.ts` · `src/app/api/artisan/credit-profile/route.ts` · `src/app/api/credit/[token]/route.ts` · `src/app/credit/[token]/page.tsx` + `CreditRecordClient.tsx` · `src/components/CreditProfileCard.tsx` · `src/components/CreditRecordParts.tsx` (gauge, bars, formula, counts table, disclaimer — shared by the card and the public page) · `src/lib/__tests__/creditScore.test.mjs`
- Files modified: `prisma/schema.prisma`, `package.json` (`test:credit`, added to `test:all`), `src/lib/buyers.ts` (exports `STOREFRONT_SOLD_STATUSES`), `src/app/api/artisan/buyers/route.ts` (uses it), `src/app/api/creators/register/route.ts` (inline origin helper replaced by `publicOrigin()`, same logic), `src/app/artisan/earnings/page.tsx` (Credit record tab), `src/app/artisan/dashboard/page.tsx` (compact card under Trust & Reports), `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 103 × 4 dictionaries (all 29 in §3.6 plus 74 for the formula, basis lines, counts table, share list and public page). Coverage script: 0 missing, 0 extra, placeholders identical, none left identical to English. Telugu ZWNJ inserted by script.
- Gates: tsc PASS | lint 115 / 64 source (baseline), 0 files worse | build PASS, baseline warnings only | `test:all` PASS (orderStage, offlineSaleParse, buyers, creditScore 33 checks incl. monotonicity sweeps over 10 inputs)
- Verification — live API against `next dev` (66/66) plus one check on `next start`:
  - ✓ Unauthenticated GET/POST → 401
  - ✓ Lakshmi: all 15 inputs equal independent hand queries; escrow ₹74,397 / demand / offline reconcile with the Money tab; recomputing from the hand inputs gives the identical profile — 585 FAIR (production 82.5, income 111.6, fulfilment 0 insufficient with 1 order, consistency 33.3, trust 57.6)
  - ✓ Brand-new artisan (adi@): ineligible, `score: null`, `band: null`; POST → 409 NOT_ELIGIBLE
  - ✓ Create → 201, `/credit/<64 hex>`, who-for text cleaned (NUL and extra spaces removed), expiry 30 days, stored snapshot equals the live profile, token unrelated to the artisan id; 91 days / "abc" → 400; empty body → default 30 days; two creates in the same instant → distinct tokens
  - ✓ Public GET → 200 with `noindex, nofollow` and `no-store`; top-level and artisan keys exactly the allow-list; no PII field names and no PII values (mobile, UPI, bank account, email, buyer names) in the JSON or the page HTML; page carries the robots meta; view count 2 after one API read and one page read
  - ✓ Frozen: an offline sale logged after sharing moves the live profile (+1, +₹900) and not the shared one; the test sale undone
  - ✓ 4 active → 5th 201, 6th 409 SHARE_LIMIT; DELETE without id 400; another artisan's DELETE 404 and the link still opens; revoke 200, again 404; revoked link → 410 `{error}` only; revoked page shows no score, name or craft; a revoked open is not counted; expired → 410; revoked and expired leave the active list and free a slot
  - ✓ Garbage, well-formed-unknown and traversal tokens → 404. The garbage-token page on `next start` (port 3100, stopped afterwards) has no stack trace; `next dev` inlines Next's dev-only error template, which is why this one was checked on the production build
- Verification — browser (Browser pane, signed in as lakshmi@karigari.com):
  - ✓ `/artisan/earnings?tab=credit`: gauge 585 / FAIR, five bars with real basis lines, fulfilment explains its grey bar, honesty line visible; "How this is calculated" prints each formula with the real inputs, ending `Score = 300 + 82.5 + 111.6 + 0 + 33.3 + 57.6 = 585`
  - ✓ Share with a bank → "SBI Rourkela branch", 7 days → link, copy button, QR and active-list row; opened in a second tab → frozen record, prepared-for line, IST dates; view count shown on the row; two-tap revoke (the arm lapses after 4 s) → "Link revoked" and the link opens the gone page
  - ✓ Dashboard: compact card under Trust & Reports with gauge, honesty line and link to the tab
  - ✓ Other accounts' real API responses replayed into the page (the agent cannot sign in as them; rows written for capture were removed): 0 events → ineligible panel naming the four event kinds, no gauge, share button disabled with its reason; 2 offline sales → "3 more needed"; 5 offline sales, ₹10,000 → 374 BUILDING, income 7.5 with the half-weight note; 5 active links → limit message instead of the create button
  - ✓ Print: Chromium PDF of the public page is one A4 page in en / hi / or / te (record heights 919 / 906 / 894 / 944 px of 1054)
  - ✓ en / hi / or / te at 360 px — credit tab (form open, link panel open, formula open), dashboard card, public record, gone page: scroll width 360, no overflowing element, no raw keys
  - ✓ Console in a fresh tab: no errors or warnings on the credit tab, tab switching, dashboard, public record and gone page
  - ✓ Page checks found and fixed: share row cramped at 360 px (buttons now stack), English "Opened 1 times" → "Views: {n}", screen-reader labels doubled on the record dates, "rounded to 585" when nothing was rounded, Telugu print label wrapping, print overflowing to a second page (formula moved into the right column)
  - ✓ No AI service or outside network call anywhere in the scoring, share or public-page code (grep); the public page needs only the database
  - ✓ Cleanup: all share rows created by the checks deleted (0 left); all test offline sales undone (0 left for lakshmi@ and adi@)
- Decisions and deviations:
  1. `ArtisanOrder` has no `deliveredAt`. Delivered = `settledAt` set (the buyer confirmed delivery) or status DELIVERED / COMPLETED. On time = no deadline, or `settledAt <= deadline` (a Prisma field reference, still one count). A delivered order with a deadline but no settlement cannot be shown to be on time and is not counted as on time.
  2. `CreditInputs` gains `soldCount` and `offlineSalesCount`: the spec's `eventCount` formula needs them. `soldCount` uses My Buyers' storefront definition, now shared as `STOREFRONT_SOLD_STATUSES`.
  3. `realisedEarnings` uses the Money tab's `onlineEarnings` basis so the record reconciles with what the artisan already sees.
  4. Active month = any IST month with a piece catalogued, a piece paid for, an offline sale, or a demand order accepted or settled.
  5. `accountAgeMonths` is shown for context and not scored: the spec's weight table gives it no weight.
  6. Component points are kept to one decimal and the score is rounded once, so the printed sum is exact. `insufficient`: production 0 verified, income 0, fulfilment < 3 orders, consistency 0 months. Trust is never `insufficient`: the health record always exists.
  7. A stored snapshot is read back through `readCreditSnapshot`, an allow-list down to each component's basis keys, so a stray field can never reach the public page.
  8. An App Router page cannot send 410, so a revoked or expired link renders the gone page with 200; the API returns 410. A token that never existed is a real 404.
  9. Views are counted by a conditional `updateMany` (live links only) on each page render or API read. Link previews and bots opening the link count too, and in `next dev` HMR rebuilds re-render and add views.
  10. Print uses `zoom: 0.64` inside `@media print`; Chromium paginates on the zoomed layout. No PDF library.
  11. The share-limit check is count-then-create. Two creates racing at 4 active links could both succeed.
- Known follow-ups:
  - Seed data gives Lakshmi pieces dated before her account was created (5 active months, 3 months on Karigari). This is a seed artefact, not a scoring bug.
  - The formula panel prints today's constants. A snapshot from an older `CREDIT_ALGO_VERSION` shows the version caveat, but not the old weights.
  - The Trust & Reports card above the new dashboard card still has hard-coded English labels and raw hex colours from before V12.

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
