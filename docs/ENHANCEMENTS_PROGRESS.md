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
| 4 | Buyer Discovery Page (QR passport + product page) | DONE | 11eddd0 | 2026-09-17 | Shared passport (story, timeline, 3-layer trust, similar request, more from artisan, gallery) on `/verify/[patchId]` and the product page. Fixes a PII leak on the QR page. 21 unit checks, 65 page checks on dev and on a key-less production build, browser checks in four languages at 360 px. |
| 5 | AI Learning Pathways (skill stages, offline cache) | DONE | 2fbcae9 | 2026-09-18 | `skillStage.ts` (pure, derived, never stored), three learning tracks from AI with a curated catalogue underneath, YouTube *search* links only, and an on-phone copy so the page opens offline. 26 unit checks, 71 live API checks on dev and again on a key-less production build, browser checks in four languages at 360 px. |
| 6 | Proactive Supply Intelligence (20-day reminder) | DONE | 210fc73 | 2026-09-18 | Lazy, idempotent 20-day restock nudge on the dashboard request — no cron added. Offline sales and demand orders count as activity. In-app alert stored in English and rendered in the artisan's language with the real day count, plus an inline card, a 7-day snooze and a per-device dismiss. 15 unit checks, 31 live API checks, browser checks in four languages at 360 px. |
| 7 | Sync Status Indicator ("Synced 2 min ago") | DONE | d7b3b53 | 2026-09-18 | Header chip reporting the last confirmed round-trip, with a hydration-safe relative time from i18n keys. No new polling. Also fixes a pre-existing 360 px header overflow and translates the offline badge and sync toast. 17 unit checks, browser checks on dev and a production build in four languages at 360 px. |
| 8 | Workshop Resources (rename + repair + tool schemes) | DONE | 68d8342 | 2026-09-18 | `/artisan/materials` → `/artisan/workshop` (308 redirect) with three tabs: materials unchanged, cluster-sourced repair help whose AI brief is stripped of any contact detail, and equipment schemes that cite the page every figure was read from. PMEGP and MUDRA added from official sources; SFURTI withheld because its source could not be reached. 11 unit checks, 89 scheme assertions, 23 live API checks, browser checks in four languages at 360 px. |
| 9 | Recognition & Anonymous Cluster Benchmarks | DONE | 0bf43db | 2026-09-18 | Badges awarded only by `evaluateBadges()` from the artisan's own rows — never by an admin, never for signing in — with the frozen figures that earned each one, and a k-anonymous cluster comparison that shows medians only when at least 5 other artisans are active and otherwise returns no figure at all, in the UI or the JSON. 42 unit checks, 45 live API checks, browser checks in four languages at 360 px. |
| 10 | Design Lab (AI concept + SVG motif composer) | DONE | 19f24ab | 2026-09-18 | The model returns a pattern *grammar*, never a picture; a pure deterministic renderer draws it as one tiled `<pattern>`, so the same spec is byte-identical every time and a 16×16 grid emits the same markup as a 2×2. Safe by construction — no prompt text, script, foreignObject or external reference can reach the SVG. A concept is a sketch: it can never become a `CraftItem` photograph, and "Start a listing" carries words only. 30 unit checks, 51 live API checks, browser checks in four languages at 360 px. |
| 11 | Digital Craft IP Registry (motif fingerprint + licensing) | DONE | c8d48ae | 2026-09-18 | A 64-bit perceptual fingerprint computed in the artisan's own browser, registered to the CLUSTER rather than to whoever photographed it first, reviewed by a human before it is public, and licensable with a fee the village names. Every surface carries the disclaimer that this is a timestamped registration and **not** a GI or a legal right — a unit test fails the build if any motif string claims otherwise. 36 unit checks, 47 live API checks, browser checks in four languages at 360 px. |
| 12 | Scrap-to-Wealth (circular economy module) | DONE | (this commit) | 2026-09-19 | Offcuts, shavings and clay waste logged by weight, pooled across the CLUSTER, and listed to recyclers by arithmetic — a pool lists the moment real logged weight crosses a published minimum and comes straight back off when a withdrawal drops it under. No price exists anywhere until a human records what a recycler actually paid, because this project has no scrap price feed to estimate from. A sale splits pro rata by the grams each artisan logged, to the rupee, and `splitProRata` throws before a caller can write shares that do not sum exactly. 21 unit checks, 56 live API checks, browser checks in four languages at 360 px. |
| 13 | Influencer commission model — artisan-funded 5% opt-in | PENDING | — | — | — |

A commit cannot contain its own hash, so the newest row reads `(this commit)`;
each phase backfills the previous row's short sha when it updates this file.

## Phase 12 detail
- Status: **DONE** (2026-09-19)
- Schema: `model ScrapLot` (self-reported grams, cluster-keyed, LOGGED | POOLED | SOLD | WITHDRAWN) · `model ScrapPool` (`totalGrams`, `contributorCount`, OPEN | LISTED | SOLD, `salePriceRupees` null until a real sale) · `model ScrapEnquiry` (public, `ipHash` rate limit) · `model ScrapPayoutShare` (`@@unique([poolId, artisanId])`, frozen at payout) · `User.scrapLots`, `User.scrapShares`. Pushed with `prisma db push --url "$DIRECT_URL"`, client regenerated, dev restarted.
- Files created: `src/lib/scrap.ts` (pure: the materials, the thresholds, `splitProRata`, `formatWeight`, `publicAreaLabel`, the public allow-list) · `src/lib/scrapRecord.ts` (the lane lock, find-or-create, `recomputePool`, the cluster area, the earnings read) · `src/app/api/artisan/scrap/route.ts` (POST/GET/DELETE) · `src/app/api/scrap/{pools,enquiry}/route.ts` · `src/app/api/admin/scrap-sale/route.ts` · `src/app/scrap/{page,ScrapBoardClient,loading}.tsx` · `src/components/workshop/ScrapSection.tsx` · `src/components/admin/ScrapSales.tsx` · `src/lib/__tests__/scrap.test.mjs`
- Files modified: `prisma/schema.prisma`, `src/app/artisan/workshop/page.tsx` (the fourth tab Phase 8 deliberately left out), `src/app/admin/facilitator/page.tsx` (a fifth tab, not a new admin page), `package.json`, `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 81 × 4 dictionaries — every key §12.6 lists, plus the eleven material names, the three pool statuses, the four lot statuses, the singular "1 enquiry", and the copy the screens actually needed (the self-reported caveat, the threshold caveat, the no-cluster prompt, the withheld-area line and the admin split note).
- Gates: tsc PASS | lint 112 errors / 160 warnings, 0 files worse than baseline | build PASS (`ƒ /api/artisan/scrap`, `ƒ /api/scrap/enquiry`, `ƒ /api/scrap/pools`, `ƒ /api/admin/scrap-sale`, `ƒ /scrap`), same nine warnings as the Phase 11 build | `test:all` PASS (+ scrap 21) | `verify:schemes` 89 passed, 0 failed
- Verification — live API (56/56 against `next dev`):
  - ✓ 401 unauthenticated and 403 for the wrong role on the artisan and admin routes
  - ✓ a zero-gram lot, a lot over the 500 kg cap and a fractional gram count are all refused before anything is written
  - ✓ **§12.7 case 1** — the first lot opens a pool at 4 kg of 15 kg, OPEN, one contributor
  - ✓ **§12.7 case 5** — two artisans logging the same material in the same instant produce ONE pool with the correct combined weight and contributor count
  - ✓ **§12.7 case 2** — 14,999 g does not list; 15,000 g exactly does, and all three contributors are notified
  - ✓ **§12.7 case 3** — a withdrawal back to 14,999 g demotes the pool to OPEN, notifies the contributors and removes it from the public board; re-logging the gram re-lists the SAME pool
  - ✓ **§12.7 case 4** — a lot in a SOLD pool cannot be withdrawn; a lot cannot be withdrawn twice; one artisan cannot withdraw another's
  - ✓ **§12.7 case 8** — "sequins and mirror dust" pools under OTHER with `materialWasRecognised: false`
  - ✓ **§12.7 case 9** — the public board's area reads "Odisha" and the payload contains no artisan name, no village, no SHG name, no artisan id, no contact and no price field at all
  - ✓ an enquiry against an OPEN or SOLD pool is refused; one with no contact is refused
  - ✓ **the rate limit** — the sixth enquiry from one address inside an hour is refused, and a different address is not caught by it
  - ✓ **§12.8** — ₹4,000 across 10,000 / 3,000 / 2,000 g is 2,667 / 800 / 533, summing to exactly 4,000, every share `SIMULATED` with a `SIM_` ref, each visible on the contributing artisan's own page
  - ✓ a second payout click returns ALREADY_SOLD and writes nothing; the recorded price is not overwritten
  - ✓ a pool that never listed cannot be sold; a sale with no real figure is refused
  - ✓ selling one lot does not stop the cluster starting the next — a new OPEN pool of the same material opens immediately (this is what `liveKey` is for)
  - ✓ **scrap money is NOT folded into craft earnings**: the dashboard's `totalEarnings` is ₹74,397 before and after a ₹2,667 scrap payout, and the dashboard payload contains the word "scrap" nowhere
- Verification — browser (Browser pane, `next dev`, signed in as an artisan and then as an admin):
  - ✓ The public board renders with no session: "Cotton offcuts · 15 kg · Odisha · 3 contributing · Listed 19 Sept 2026", the price-not-set explanation, and **no ₹ anywhere on the page**
  - ✓ `/scrap` is `noindex, nofollow, nocache` and sets no cookie
  - ✓ A recycler enquiry sent through the real form was accepted and the cluster notified
  - ✓ Logging 3.2 kg of silk through the form opened a pool at "3.2 kg of 5 kg · You: 3.2 kg (100%)"; taking it back marked the lot "Taken back" and recomputed the pool to zero
  - ✓ The artisan's three states: real pools with weight, "Nothing pooled yet" with the full threshold table (Cotton 15 kg, Silk 5 kg, Clay 50 kg) and no invented figures, and "Collecting" with a progress bar below the threshold
  - ✓ The public board's empty state was proved through the real demotion path, not a stub
  - ✓ Scrap income renders on its own with ₹2,667 "Simulated" and the sentence saying why it is kept apart from craft earnings
  - ✓ The facilitator console's fifth tab shows the listed pool with its enquiry, and the recycler's stated ₹3,500 is shown as "said ₹3,500" — the sale price field beside it is **empty**, not pre-filled from the offer
  - ✓ en / hi / or / te at 360 px on the artisan tab and the public board: page scroll width 360, nothing overflowing outside the pill rails, no raw keys, no unfilled placeholders
  - ✓ Console on a fresh tab for both pages: no errors, no React warnings
  - ✓ This phase has no AI surface at all, so there is no key-absent path to exercise
- Decisions and deviations:
  1. **`@@unique([clusterKey, material, status])` would have allowed only ONE SOLD pool per cluster and material, ever.** §12.2's own comment says a sold pool and a new open pool should coexist, which that key does deliver — but a cluster selling cotton a second time would have hit a constraint violation. Replaced with a nullable `liveKey` column (`"LIVE"` while collecting, NULL once sold) and `@@unique([clusterKey, material, liveKey])`: Postgres treats NULLs in a unique index as distinct, so every past sale coexists while exactly one pool stays live.
  2. **One live pool per cluster and material, whether OPEN or LISTED.** §12.4 says to find-or-create the OPEN pool, but a LISTED pool that kept accepting lots into a second OPEN pool would make the demotion in case 3 collide with the unique key. New lots join the live pool either way, so the board always shows the weight the cluster actually has.
  3. **Withdrawal is allowed from a LISTED pool, not only an OPEN one.** §12.4 says "only while its pool is OPEN" and §12.7 case 3 requires withdrawing from a LISTED pool and watching it demote; the two cannot both be true. Case 3 is the one in the verification checklist, so withdrawal is refused only once the pool is SOLD.
  4. **Totals are recomputed from the lots, never incremented.** An increment drifts the first time a request is retried or a withdrawal is missed, and a pool that drifts is a pool that lists on weight nobody logged.
  5. **The area a public board may name is district-level at the most precise, and null when even that is a guess.** `publicAreaLabel` drops the first part of a three-part location, publishes only the state from a two-part one (the first of two could be a district or a weaving village of two hundred people and this app cannot tell), and publishes a single part only when it is a state or union territory. An SHG cluster's area is resolved from its members' locations rather than from its name, because the group's name identifies it as precisely as a village would.
  6. **No price anywhere before a sale.** A recycler's stated offer is stored as what they said, is never shown as the lot's price, and is never pre-filled into the admin's sale field — pre-filling it would quietly make an opening offer the settlement.
  7. **Scrap is a fourth income stream with its own read.** `readScrapEarnings` is separate from every craft total, and the artisan's page says in words why.
  8. **The thresholds are Karigari's own operating minimums and are labelled as such** on the artisan page, on the public board and in the source. No trade body publishes a minimum pickup weight for village craft waste, and inventing a citation would be worse than admitting the figures are ours. A unit test fails the build if any `scrap_*` string in any language calls them a market rate or standard.
- Bugs and gaps found while verifying, and fixed:
  1. **A lost update under concurrency.** Two artisans logging the same material at the same second each recomputed a total from a lot table that did not yet contain the other's row, and the later write won — the pool ended 3 kg short. Found by §12.7 case 5's own check reading the stored row rather than the response body. Fixed with a transaction-scoped Postgres advisory lock keyed on cluster and material (`lockPoolLane`), taken before the find-or-create so it covers the create as well as the recompute. Re-proved with three simultaneous 1,667 g logs crossing a 5,000 g threshold together: 5,001 g, three contributors, LISTED.
  2. **`pg_advisory_xact_lock` returns `void`**, which the Prisma driver adapter cannot deserialize into a result row — the first version of the lock 500'd every log. `$executeRaw` rather than `$queryRaw`.
  3. **"1 enquiries".** Added `scrap_enquiries_one` / `scrap_admin_enquiries_one` in all four languages.
  4. **A pool everyone had withdrawn from lingered as "0 g of 5 kg · 0 contributing"**, implying the cluster was collecting something nobody had. The artisan read now filters to pools with weight in them; the row stays in the database because it is what the next lot joins.
- Known follow-ups:
  - Every seeded artisan is alone in their own cluster, so the pooling, the three-way split and the cross-artisan concurrency were all proved by temporarily joining three artisans into one SHG and then restoring them. Nothing in the seed exercises a real multi-member cluster — the same gap Phases 8, 9 and 11 recorded. This run touched only `shgGroupLink` and restored both it and `location`, which is the fix for the Phase 11 bug where only half of what had been changed was put back.
  - The facilitator dashboard reports a page scroll width of 377 px at a 360 px viewport on **all five** of its tabs, including the four that predate this phase. Pre-existing and left alone: the overflow is in the admin shell, and changing it would touch the other four tabs.
  - `LanguageSwitcher` renders a 36 px tap target on `/scrap`. Shared with the creators, credit, marketplace and motif public pages and predates this phase.
  - The facilitator page's own `facilitator-queue` query took over two minutes during this verification — it selects every `CraftItem` column, including base64 images, for 105 rows, and it saturated the connection pool badly enough to queue an unrelated POST behind it. Pre-existing and out of this phase's scope, but it is the slowest thing in the app.
  - A recycler enquiry has a `status` column (RECEIVED | ACCEPTED | DECLINED) that nothing yet moves: the cluster answers out of band and the facilitator records the sale. Accepting or declining an enquiry in the app is the obvious next step.
  - The area label is recomputed on every public board read rather than cached, and each distinct cluster costs one profile query.

## Phase 11 detail
- Status: **DONE** (2026-09-18)
- Schema: `model MotifRegistration` (cluster-owned fingerprint, `status`, `duplicateOfId`/`duplicateDistance`, `descriptors`, `referenceImageUrl`) · `model MotifLicence` (+ `ipHash` for the rate limit and `decisionNote`, both added during the build when the spec's shape turned out to be a field short) · `model MotifPayoutShare` (`@@unique([licenceId, artisanId])`) · `User.motifRegistrations`, `User.motifPayoutShares`, `CraftItem.motifRegistrations`. Pushed with `prisma db push --url "$DIRECT_URL"`, client regenerated, dev restarted.
- Files created: `src/lib/motifHash.ts` (the dHash, the two thresholds, `hammingDistance`, the client canvas path and the colour histogram) · `src/lib/motifLicence.ts` (pure: `splitFee`, the transitions, the claim guard, the public allow-list) · `src/lib/motifRecord.ts` (cluster reads, the trust ledger) · `src/app/api/motif/{register,registry,licence,describe}/route.ts` · `src/app/api/artisan/{motifs,motif-licence}/route.ts` · `src/app/api/admin/{motif-review,motif-licence-payout}/route.ts` · `src/app/artisan/motifs/{page,loading}.tsx` · `src/app/motif/[id]/{page,MotifRecordClient}.tsx` · `src/components/MotifDisclaimer.tsx` · `src/components/motif/MotifCard.tsx` · `src/components/admin/MotifReviews.tsx` · `src/lib/__tests__/{motifHash,motifLicence}.test.mjs`
- Files modified: `prisma/schema.prisma`, `src/components/ui/Sidebar.tsx` (`nav_motifs`, Fingerprint icon, in My Workshop), `src/app/admin/facilitator/page.tsx` (a fourth tab, not a new admin page), `package.json`, `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 74 × 4 dictionaries — every key §11.7 lists, with `motif_licence_status_*` expanded to its five real values and the copy the screens actually needed (the four filing states, the two flagged explanations, the reviewer's strings, the trust ledger's four lines, and the public form's six).
- Gates: tsc PASS | lint 112 / 44 source, 0 files worse than baseline | build PASS (eight `ƒ` motif routes, `○ /artisan/motifs`, `ƒ /motif/[id]`), same four Node warnings as the baseline build | `test:all` PASS (+ motifHash 16, motifLicence 22) | `verify:schemes` 89 passed, 0 failed
- Verification — live API (47/47 against `next dev`):
  - ✓ 401 unauthenticated and 403 for the wrong role on every artisan and admin route
  - ✓ a malformed fingerprint and a name claiming a legal status are both refused before anything is written
  - ✓ **§11.8 case 1** — the same photograph again: distance 0, refused as already registered with a pointer to the existing record, and no second row
  - ✓ **§11.8 case 2** — a re-cropped version: distance 4, same refusal
  - ✓ **§11.8 case 3** — a genuinely different pattern: distance 30, accepted, PENDING
  - ✓ **§11.8 case 4** — the same motif from ANOTHER cluster: FLAGGED_DUPLICATE with distance 2, both records in the admin queue, and a scan of the review payload for "stole / copied / infringe / original" finds none
  - ✓ a GI claim inside the model's description was dropped from the stored row; a non-hex "indigo" was dropped and `#1f3a68` kept
  - ✓ the record is keyed on `auto:bargarh, odisha` — the cluster — with the submitter recorded separately
  - ✓ the public register needs no session, shows only CONFIRMED records (1 of 3 filed), and **no artisan id, email, mobile or UPI appears anywhere in it**; the cluster reads "Bargarh, Odisha", never `auto:…`
  - ✓ `/motif/[id]` renders with no session, carries the disclaimer in its HTML, is `noindex`, and a flagged record 404s
  - ✓ a public enquiry is accepted and notifies the cluster; an enquiry against an unconfirmed record is refused
  - ✓ **the rate limit** — the sixth enquiry from one address inside an hour is refused, and a different address is not caught by it
  - ✓ an artisan of another cluster cannot answer; accepting without a real fee is refused; a second decision is refused
  - ✓ **§11.8 case 6** — ₹1,000 across three artisans is 334 / 333 / 333, summing to exactly 1,000, every share `SIMULATED` with a `SIM_` ref
  - ✓ **§11.8 case 8** — a second payout click returns ALREADY_PAID and writes nothing
  - ✓ **§11.8 case 9** — an ACCEPTED licence with no agreed fee is refused with NO_FEE
  - ✓ the trust ledger reports ₹1,000 to the cluster, ₹334 to this artisan, ₹1,000 simulated and **₹0 real**
- Verification — browser (Browser pane, signed in as lakshmi@karigari.com, `next dev`):
  - ✓ **The fingerprint is computed in the browser**: picking a real piece produced `f575 6160 656c 54d4` from its own photograph, and the same piece gave the same value on a later page load
  - ✓ Registering filed a PENDING record with that fingerprint, a 28.5 KB reference crop and an AI reading (confidence 0.9, three palette colours, a symmetry and a repeat-unit sentence)
  - ✓ The record renders with its status chip, its fingerprint in the mono face, and the "AI reading" badge; the earlier run rendered "Read from the colours" when the model did not answer
  - ✓ The disclaimer is on the artisan page, the public page (twice) and the admin review, in all four languages
  - ✓ The public page shows no price and says why: the cluster names it
  - ✓ en / hi / or / te at 360 px on both pages: page scroll width 360, nothing overflowing outside the piece rail, no raw keys, no unfilled placeholders
  - ✓ Console on a fresh tab: no errors, no React warnings
  - ✓ Cleanup: every registration, licence, share and notification deleted; the two artisans temporarily moved into another cluster restored to their own location and SHG link
- Decisions and deviations:
  1. **The cluster owns it, not the filer.** `clusterKey` is the owning column and `submittedById` is only credit and contact; every payout splits across the cluster's confirmed registrants. Attributing a village's motif to whoever photographed it first is the exact appropriation this feature exists to resist.
  2. **A hash is a reason to look, never a verdict.** Nothing reaches the public register without a human confirming it, a flagged pair is shown as two records and a distance with no "original" and no "copy", and the copy on both sides says a review is not an accusation. Two villages genuinely can carry the same tradition and this platform has no standing to rule on which came first.
  3. **Same cluster → refused; another cluster → flagged.** Re-registering your own motif points at the record you already have rather than making a second row; the cross-cluster case is the one a person looks at.
  4. **The fingerprint is computed client-side** (§11.3) and the server validates only its FORMAT. Decoding several full-size data URLs server-side would exhaust memory on this deployment, and it is acceptable because a fingerprint is a discovery aid a human reviews, not an authorisation.
  5. **A description says where it came from.** `source` is AI or HEURISTIC on every record and on screen, and a confidence figure survives only on the AI path — a colour histogram has no confidence to report, so inventing one would be a number nobody computed.
  6. **No claim this app cannot grant survives.** `claimsLegalStatus` drops any sentence mentioning a GI, a trademark, a patent, copyright, legal protection, authentication, certification or a blockchain — from the model's prose AND from a motif name an artisan types. A unit test walks every `motif_*` string in all four dictionaries and fails on any of those words outside the three strings whose job is to deny them, and a second test asserts all three motif surfaces render `<MotifDisclaimer />`.
  7. **No rupee rounds away.** `splitFee` gives the remainder to the earliest registrants one rupee at a time and throws if the shares do not sum to the fee — before anything is written, because a caller that has already set `paidAt` cannot recover from a bad split. 104 fee/cluster-size combinations are asserted in the unit tests.
  8. **The admin surface is a fourth tab on the facilitator console**, not a new page, exactly as §11.6 asks.
  9. **`decisionNote` and `ipHash` were added to `MotifLicence`.** §11.5 asks the cluster to "decline with a reason" and to rate-limit by `ipHash`, and §11.2's model had a column for neither; writing the reason into `intendedUse` or rate-limiting on nothing would both have been worse than one column each.
  10. **Constants that a route would have exported live in `motifLicence.ts`.** A Next.js route module may only export its handlers and route config — the same wall Phase 10 hit with a thumbnail cap, and the build caught it here too.
- Bugs and gaps found while verifying, and fixed:
  1. **The Write tool turned `\u202a` escapes into literal bidi characters** in the licence route's sanitiser — the provenance hook caught it. Rewritten as numeric code-point checks, which is also the version a reader can actually check.
  2. **The reference crop was the full thumbnail** (262 KB), not the ≤320 px crop §11.2 describes, and the vision call timed out against it at a 12 s budget. Added `downscaleReference()`: the crop is now 28.5 KB, the reading arrives, and the fingerprint is unaffected because dHash draws to a 9×8 grid whatever the source size.
  3. **The first verification run overwrote two artisans' `location`** and restored only their SHG links. Caught by a post-run sweep, restored by hand, and the script now saves and restores both.
  4. **Three Next `<Image>` aspect-ratio warnings** from CSS-resizing width/height images. All three now use `fill` inside a sized box.
  5. **A 16 px tap target** on the "Open the public record" link, raised to 40 px.
- Known follow-ups:
  - Every seeded artisan is alone in their own cluster, so the cross-cluster flag and the three-way split were both proved by temporarily moving artisans between clusters and then restoring them. Nothing in the seed exercises a real multi-member cluster — the same gap Phases 8 and 9 recorded.
  - `payableArtisanIds` pays the artisans who FILED a confirmed record in the cluster, not every artisan in it. That is the narrower reading of §11.2's "artisans who have a registered, non-duplicate motif in that cluster"; a cluster where one person files for everybody would concentrate the fee on them, and the fix is a cluster-membership payout rather than a registration-based one.
  - The register compares a candidate against **every** row, which is right at this size and is a full scan at a larger one. The hashes are 16 characters and indexed, so the natural next step is a coarse bucket on the first nibble before the distance loop.
  - The AI reading is not cached: two registrations of the same crop are two vision calls.
  - `LanguageSwitcher` renders a 36 px tap target on the public page. It is shared with the creators, credit and marketplace pages and predates this phase, so it was left alone.

## Phase 10 detail
- Status: **DONE** (2026-09-18)
- Schema: `model DesignConcept { id, artisanId, artisan, prompt, promptLanguage, title, spec Json, source @default("AI"), svgThumb, usedForItemId, createdAt, @@index([artisanId, createdAt]) }` + `User.designConcepts`. Pushed with `prisma db push --url "$DIRECT_URL"`, client regenerated, dev restarted.
- Files created: `src/lib/motifSpec.ts` (pure: the grammar, `validateSpec`, `defaultSpec`, `renderMotifSvg`) · `src/lib/motifPalettes.ts` (eight committed palettes, named for dyestuffs) · `src/lib/designLab.ts` (the model's prose, cleaned) · `src/app/api/artisan/design-lab/route.ts` · `src/app/artisan/design-lab/{page,loading}.tsx` · `src/components/lab/{MotifPreview,SpecControls}.tsx` · `src/lib/__tests__/{motifSpec,designLab}.test.mjs`
- Files modified: `prisma/schema.prisma`, `src/components/ui/Sidebar.tsx` (`nav_design_lab`, Palette icon, in My Workshop), `src/components/CaptureModal.tsx` (optional `seedText` + `onItemCreated`), `src/app/artisan/dashboard/page.tsx` (reads `?concept=`, opens the capture flow, records `usedForItemId`), `package.json` (`test:motif`, `test:design-lab` in `test:all`), `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 74 × 4 dictionaries — the 28 in §10.6 that this build uses, plus one per motif (10), per repeat (5) and per palette (8), the four slider labels, the palette editor's six strings, and the copy the page needed that §10.6 did not list (`lab_placeholder`, `lab_preview`, `lab_preview_alt`, `lab_thin_prompt`, `lab_offline_fallback`, `lab_listing_words_only`, `lab_untitled`, `lab_concept_title`, `lab_controls`, `lab_labor_days`, `lab_used_for_listing`, `lab_delete`, `lab_load_more`, `lab_nothing_yet`). Coverage script: 0 missing, 0 extra, 0 collisions, placeholders identical, none left identical to English.
- Gates: tsc PASS | lint 112 / 44 source, 0 files worse than baseline | build PASS (`ƒ /api/artisan/design-lab`, `○ /artisan/design-lab`), same four Node warnings as the baseline build | `test:all` PASS (+ motifSpec 19, designLab 11) | `verify:schemes` 89 passed, 0 failed
- Verification — live API, keys in place (35/35):
  - ✓ 401 unauthenticated and 403 for an ADMIN token on every verb
  - ✓ a real prompt returns a spec whose motif, repeat and border are all from the allowed sets, every number inside its published range, every colour six-digit hex
  - ✓ **the five malformed answers §10.7 asks for, through the real HTTP path**: an unknown motif, `grid: 400` with `scale: 9` and `rotation: 5000`, a palette of colour names, a spec that is a string, a spec that is null — all clamped and saved, none errored
  - ✓ **injection is impossible by construction**: a spec stuffed with `"><script>alert(1)</script>` and `http://evil.test` produced a thumbnail with no script, no prompt text, no anchor, and no reference beyond the SVG namespace and our own `url(#kg-motif-tile)`
  - ✓ the stored thumbnail is **byte-identical** to a fresh render of its spec, and re-reading a concept returns the same spec
  - ✓ the model's prose carries no phone number, email or link, and no claim of tradition, community or authenticity
  - ✓ an empty prompt and a one-word prompt both return a drawable spec and are flagged `thin`
  - ✓ ownership is in the predicate: another artisan gets 404 on read, edit and delete
  - ✓ `usedForItemId` records that the lab led to work, and a SQL sweep confirms **no `CraftItem` anywhere holds an SVG in `images[]`**
- Verification — live API, both AI keys blanked (9/9): the route still returns a drawable spec, labels it `FALLBACK`, returns an **empty** notes object rather than invented prose, gives the same cloth for the same words and different cloth for different words, and still saves. `.env` was restored byte-for-byte afterwards (sha256 verified against the backup).
- Verification — pagination and the column cap (7/7): 30 concepts at the densest 16×16 mirror/temple setting paginate 12 / 12 / 8 with `hasMore` closing on the last page; the largest thumbnail is 5,119 bytes against the 40 KB cap and none was dropped. All 32 rows deleted afterwards.
- Verification — browser (Browser pane, signed in as lakshmi@karigari.com, `next dev`):
  - ✓ A typed prompt produced "Indigo Temple Border" — temple motif, brick repeat, indigo and madder — with the notes panel showing the motif note, colour names, material note and "about 3 days", each under an "AI suggestion" badge
  - ✓ Dragging the grid slider across its whole range re-renders live; the tile width went 160 → 60 while the output stayed ~3 KB
  - ✓ **Re-render cost measured with a MutationObserver** (rAF has a one-frame floor and cannot tell 2 ms from 15 ms): median 13.1 ms, worst 19.8 ms on the first drag, on a dev build. The densest grid was no slower than the sparsest — 12.9 ms at 16 cells against 19.8 ms at 2 — which is the tiled `<pattern>` doing its job.
  - ✓ A saved FALLBACK concept opens with "Made without AI" and no notes panel; the AI one opens with "AI suggestion"
  - ✓ **Download** produced a valid 1024×1024 `image/svg+xml` blob, 5.7 KB, no script, no foreignObject, no handler attribute, and only the SVG namespace as an external reference
  - ✓ "Start a listing" navigates to `/artisan/dashboard?concept=…`, opens the capture flow at Step 1 with the concept's words in the description box, **no image attached**, and the camera step still required
  - ✓ The concept disclaimer renders in all four languages
  - ✓ en / hi / or / te at 360 px: page scroll width 360, nothing overflowing outside the motif rail (which scrolls on purpose), no raw keys, no unfilled placeholders, no tap target under 40 px
  - ✓ Console on a fresh tab: no errors, no React warnings
  - ✓ Cleanup: every test concept deleted, `.env` restored, the temporary launch config removed
- Decisions and deviations:
  1. **The renderer emits one tiled `<pattern>`, not one group per cell.** The first version drew every cell and a 16×16 lotus came to 132 KB — over the 40 KB thumbnail cap. The repeat rules are now expressed as a small block (1, 4 or 16 cells) that the browser tiles, so output is constant-size whatever the grid, which is what §10.3 describes and what makes the preview cheap.
  2. **`DETAIL_CELL_LIMIT` is about legibility, not cost.** With tiling, a dense grid is no more expensive to draw. What changes at sixteen cells is that a motif is about thirty pixels wide, where an eight-petal lotus is a smudge — so the inner detail is dropped because it stops reading, and the comment says that rather than claiming a performance reason it no longer has.
  3. **Safety is by construction, not by sanitising.** Nothing from a model or an artisan is interpolated into the markup: numbers are clamped, colours must match `/^#[0-9a-f]{6}$/`, and every element and attribute is a literal in `motifSpec.ts`. There is no text node, no `foreignObject`, no `href`. That is why `dangerouslySetInnerHTML` is acceptable in `MotifPreview`, and the comment there says exactly why.
  4. **The palettes are named for dyestuffs, not for people.** "Indigo & madder", "turmeric & iron black" — real materials an artisan buys. No palette is named for, or claimed to belong to, a community or a registered craft.
  5. **A sentence that claims authenticity is dropped whole**, not softened: `dropClaims()` removes any sentence mentioning authentic, traditional, GI, sacred, ancestral, or a community/village/tribe/caste. Editing such a sentence would leave the claim standing in a quieter voice.
  6. **The listing hand-off carries words and an id, never the drawing.** `seedText` lands in the same box the artisan types into, so the normal parse runs over it unchanged, and nothing touches `images`.
  7. **`MAX_THUMB_BYTES` lives in `designLab.ts`, not the route.** A Next.js route module may only export its handlers and route config; exporting a constant from it fails the build's own check on the generated route types. Found by the build, not guessed.
  8. **The voice path reuses the existing recorder end to end.** `useSpeechCapture` handles the browser recognizer, and the recorded-clip path POSTs multipart to the same route, which transcribes with the same `transcribeAudio()` the capture flow uses — no new endpoint.
- Bugs found in the browser and fixed:
  1. **The concept's words never reached the capture box.** The seed guard was a boolean set *before* its deferred write, so React's development double-invoke ran the effect, cleaned it up — clearing the pending timeout — and then returned early because the flag was already true. The guard now records the seed itself and is set *inside* the callback, which also makes "only once" honest: a second, different concept can still seed.
  2. **The page overflowed to 959 px at a 360 px viewport.** The preview's `<svg width="100%">` still reports an intrinsic width, which sized the implicit `auto` grid track. Fixed with an explicit `grid-cols-1` base and `[&>svg]:block [&>svg]:w-full [&>svg]:h-auto` on the preview host.
  3. **Four sliders, two segmented toggles and the title box were under 40 px.** The sliders went to `h-11`, the title box got `min-h-[44px]`, and the toggles dropped `size="sm"` so they match every other `SegmentedToggle` in the app.
- Known follow-ups:
  - The re-render figures are from a **development** build, where React runs in development mode and the whole page re-renders; a production build will be faster. The number that matters structurally — that a 16×16 grid costs no more than a 2×2 — was measured and holds.
  - The **Scrap & waste tab** promised in Phase 8 is still Phase 12's.
  - `usedForItemId` is written from the dashboard when the capture flow reports a created item. A capture that is queued offline and POSTed later by `offlineSync` does not report back, so that concept keeps `usedForItemId: null` even though it led to a listing.
  - The AI's spec is not cached: two identical prompts are two model calls. The deterministic composer is cached by nature (same words, same cloth), so this only costs on the AI path.

## Phase 9 detail
- Status: **DONE** (2026-09-18)
- Schema: `model ArtisanBadge { id, artisanId, artisan, key, basis Json, awardedAt, @@unique([artisanId, key]), @@index([artisanId]) }` + `User.badges`. Pushed with `prisma db push --url "$DIRECT_URL"`, client regenerated, dev restarted.
- Files created: `src/lib/badges.ts` (pure: the eight criteria, their named thresholds, `evaluateBadges`, `badgeProgress`, and the stored-title round trip) · `src/lib/badgeRecord.ts` (the only writer of `ArtisanBadge`) · `src/lib/badgeNotice.ts` (renders a stored English alert in the artisan's language) · `src/lib/clusterBenchmark.ts` (pure: medians, quartiles, `MIN_COHORT`, the refusal) · `src/lib/benchmarkRecord.ts` (cohort resolution and six grouped aggregate queries) · `src/app/api/artisan/recognition/route.ts` · `src/app/api/artisan/benchmarks/route.ts` · `src/components/RecognitionPanel.tsx` · `src/lib/__tests__/badges.test.mjs` · `src/lib/__tests__/clusterBenchmark.test.mjs`
- Files modified: `prisma/schema.prisma`, `src/app/artisan/dashboard/page.tsx` (mounts the panel), `src/app/api/buyer/sales/delivered/route.ts`, `src/app/api/buyer/orders/delivered/route.ts`, `src/app/api/artisan/offline-sales/route.ts`, `src/lib/buyerVerify.ts` (the four eager award points), `src/components/NotificationsBell.tsx` and `src/app/artisan/notifications/page.tsx` (render the badge alert), `src/components/ui/ProgressBar.tsx` (a `neutral` tone for the cohort median beside "you"), `package.json` (`test:badges`, `test:benchmark` in `test:all`), `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 48 × 4 dictionaries — the 27 in §9.6 that this build actually uses, the eight badge basis sentences (two with a singular form, because the first sale and the first returning buyer are both legitimately 1), `badge_gap_below_floor` and `badge_gap_late` for the two badges a quality condition can hold up, the three quartile bands, `benchmark_peers`, `benchmark_offline_note`, `benchmark_platform_idle`, `benchmark_no_location`, `badge_section_title`, `badge_none_yet`, `badge_locked_title` and `notif_badge_body`. Coverage script: 0 missing, 0 extra, 0 collisions, placeholders identical, none left identical to English.
- Gates: tsc PASS | lint 112 / 44 source, 0 files worse than baseline | build PASS (`ƒ /api/artisan/recognition`, `ƒ /api/artisan/benchmarks`), same four Node warnings as the baseline build | `test:all` PASS (+ badges 21, clusterBenchmark 21) | `verify:schemes` 89 passed, 0 failed
- Verification — live API (45/45 against `next dev`):
  - ✓ both routes: unauthenticated 401, an ADMIN token 403; `/benchmarks` really sends `Cache-Control: private, no-store` (read off the response, not asserted)
  - ✓ badges match a hand count in SQL: 5 real sales earns FIRST_SALE and **not** TEN_SALES; 8 voice/IVR captures earns VOICE_PIONEER
  - ✓ **one piece priced under its floor withholds FAIR_WAGE_KEEPER**, and the locked row says the true thing — "14 of your 15 pieces are at or above their floor", not "4 of 5"
  - ✓ earned and locked never overlap and together cover all eight badges
  - ✓ ten concurrent recognition loads → no duplicate badge row and no duplicate bell alert; one alert per earned badge
  - ✓ **the frozen basis does not move**: VOICE_PIONEER still read 8 after the underlying count was pushed to 9, then the row was restored
  - ✓ **a badge is never revoked**: an artisan holding FAIR_WAGE_KEEPER kept it when a piece was dropped below its floor, and it was not re-offered in "still to earn"; the price was then restored exactly
  - ✓ **the eager path works**: logging a real offline sale for an artisan with nothing at all awarded FIRST_SALE at that moment, basis `{"sales":1}`, with exactly one bell alert — before any dashboard load. The sale, badge and alert were then deleted and that artisan is clean again.
  - ✓ every seeded artisan is alone in their cluster, so the honest answer is the refusal: `{"available":false,"scope":null,"cohortSize":0,"minCohort":5}` — and a check asserts the only digits in that payload are the cohort size and the threshold
  - ✓ a town `locateCity()` cannot place (Kondagaon) **skips the widening step entirely** rather than falling back to a platform-wide average
  - ✓ with six active artisans temporarily joined into one SHG: cohort 5, scope CLUSTER, and the earnings median matched a hand count (₹7,851 — a mean would have said ₹6,837)
  - ✓ fulfilment was **dropped, not zeroed**, because fewer than 5 peers had an accepted order; every shown metric reported ≥ 5 peers
  - ✓ position is only ever BELOW / MIDDLE / ABOVE; no artisan name, email or id appears anywhere in the payload, and there is no rank or percentile field
  - ✓ dropping to 4 peers refused the comparison again, again with no figure; all six SHG links restored to their originals
- Verification — browser (Browser pane, signed in as lakshmi@karigari.com, `next dev`):
  - ✓ The panel sits on the dashboard under the restock nudge: skill stage, two earned badges, six locked rows with their real gaps, and the comparison
  - ✓ Tapping a badge chip shows the frozen figures and the IST award date ("Earned with 5 sales. Earned on 18 Sept 2026")
  - ✓ The unavailable state names the real cohort (0) and the threshold (5), with the privacy note under it
  - ✓ With the temporary cluster: "Compared with 5 artisans in your cluster, over the last 90 days", You ₹9,515 vs Median ₹7,851, 4.3 vs 2.7 pieces, ₹16,363 vs ₹11,456 — both bars on one scale, no fulfilment row, no name anywhere
  - ✓ The bell and the notifications page render "Badge earned: Voice pioneer" fully translated (checked in Telugu); no English title leaks
  - ✓ en / hi / or / te at 360 px, in both the available and the unavailable state: page scroll width 360, nothing overflowing inside the panel, no raw keys, no unfilled placeholders, no tap target under 40 px
  - ✓ Console on a fresh tab: no errors, no React warnings, no hydration warning (the award date is formatted with an explicit `en-IN` + `Asia/Kolkata` after a client fetch)
  - ✓ Cleanup: SHG links all null again, the below-floor count back to its original 2, `catalogMethod` back to 16 IVR / 44 MANUAL / 36 VOICE / 9 null, no test sales or requests left
- Decisions and deviations:
  1. **k-anonymity is the feature, not a note under it.** `buildBenchmark` returns `{available:false, scope:null, cohortSize, minCohort}` below the threshold, and a unit test serialises that payload and asserts the only digits in it are the cohort size and the threshold. A leaderboard cannot be reconstructed from a response that contains no numbers.
  2. **MIN_COHORT counts OTHER artisans**, not the artisan plus four. That is the more protective reading of "at least 5 artisans are active", and the copy says "at least 5 others".
  3. **The threshold is applied per metric as well as per cohort.** If only three of nine peers ever accepted a bulk order, their fulfilment rates are three identifiable people's rates, so the row is dropped rather than shown — and never filled with a zero, which would be a fabricated figure in somebody else's median.
  4. **Offline income is the artisan's own, and stays out of every median.** It is self-reported and invisible for every peer, so folding it in would compare a measured number against an unverified one. It is reported separately and labelled, and an artisan with no platform sale in the window is told their figure is zero *and* that this is not a judgement on their month (§9.7 case 6).
  5. **Badges are never revoked** (§9.7 case 4). `evaluateBadges` answers "is this true now" and the caller only ever inserts; the *locked* list is recomputed live, so an artisan who stops meeting a criterion simply stops being offered it. The alternative punishes them for trying a price experiment.
  6. **A locked badge whose blocker is quality, not quantity, gets its own sentence.** "4 of 5" would be a lie when the artisan has fourteen pieces and one is under its floor, so `badgeProgress` returns a `gapKey` and FAIR_WAGE_KEEPER / ON_TIME_FIVE use their own wording.
  7. **The lazy evaluation is the recognition request the dashboard already makes**, not a second `void awardBadges()` inside `/api/artisan/dashboard`. The panel mounts on every dashboard load and its endpoint awards; adding the call to the dashboard route as well would run the same twenty aggregate queries twice per load and award nothing the first had not. The four *eager* points §9.3 asks for are all wired: a storefront delivery, a demand delivery, an offline sale and a successful buyer verification. `/api/payments/settle-escrow` is named in the spec but was retired in an earlier version (it now returns 410), so the storefront hook sits on its live replacement, `/api/buyer/sales/delivered`.
  8. **`benchmark_scope_state` from §9.6 is deliberately not added.** §9.4 of the same spec says `indiaGeo` provides coordinates and no state mapping, and forbids deriving one; a key for a scope the code cannot resolve would be an unused string promising a comparison this app cannot make.
  9. **Escrow income is bucketed by `CraftItem.createdAt` and demand income by `settledAt`** — exactly how `/api/artisan/dashboard` builds its twelve-month series — so a figure on this panel reconciles with the artisan's own charts rather than contradicting them.
  10. **`MAX_CANDIDATES = 500`** caps the profiles the widening step reads in one request. At 13 artisans it changes nothing; it exists so a later deployment cannot turn one dashboard load into an unbounded table scan.
- Known follow-ups:
  - Every seeded artisan is alone in their own `auto:<location>` cluster and no two of the same craft family are within 150 km, so **the benchmark is unavailable for all thirteen on real data**. The available path was proved by temporarily joining six into one SHG and then restoring every link. Nothing in the seed exercises a real multi-member cluster — the same gap Phase 8 recorded.
  - The **badge empty state** ("No badges yet…") was verified from the API for an artisan with no rows at all (`earned: []`, all eight locked) and from the four dictionaries, but not rendered on screen: every artisan who has any data earns at least FIRST_SALE, and the only clean-slate accounts could not be signed into from this session.
  - The seed has **no settled demand orders and no accepted resource requests**, so ON_TIME_FIVE and CLUSTER_HELPER cannot be earned on this data and their award paths are covered by unit tests and the eager hook rather than a live row.
  - Exercising `/api/artisan/recognition` awarded real badges to `lakshmi` (2) and `anitha` (3). They are genuine — every one traces to rows that already existed — and were deliberately left in place rather than deleted as test data.
  - This phase has **no AI path**, so there was no key-absent case to exercise; both endpoints are pure database reads.
  - The `NotificationTicker` marquee reports elements left of the viewport at 360 px. It predates this phase, causes no page scroll (`scrollWidth === clientWidth === 360`), and was left alone.

## Phase 8 detail
- Status: **DONE** (2026-09-18)
- Schema: none.
- Files created: `src/lib/toolingGuide.ts` (pure: 22 curated repair entries by material family, `stripContactDetails`, `normaliseToolingBrief`) · `src/app/api/artisan/tooling/route.ts` · `src/components/schemes/SchemeCard.tsx` (the scheme card, its helpers and the API payload types, lifted out of the schemes page so both screens share one rendering) · `src/components/workshop/{MaterialsSection,RepairSection,FundingSection}.tsx` · `src/lib/__tests__/toolingGuide.test.mjs`
- Files moved: `src/app/artisan/materials/{page,loading}.tsx` → `src/app/artisan/workshop/` (git rename; the page body became the three-tab shell and the old body moved into `MaterialsSection`)
- Files modified: `next.config.ts` (a `redirects()` block, added to the object the PWA wrapper receives), `src/lib/schemes.ts`, `scripts/verify-schemes.ts`, `src/app/api/artisan/schemes/route.ts` (reports what it withheld), `src/app/artisan/schemes/page.tsx` (imports the extracted card), `src/app/api/voice-assistant/route.ts`, `src/app/artisan/notifications/page.tsx`, `src/components/NotificationsBell.tsx`, `src/components/SupplyNudgeCard.tsx`, `src/components/ui/Sidebar.tsx` (`nav_workshop_resources`), `package.json` (`test:tooling` in `test:all`), `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 146 × 4 dictionaries (all 25 in §8.6, 66 curated tooling strings, the materials tab's own copy — English-only before this phase — the two new schemes' name/description/benefit/note, their seven new rule labels, and three singular forms found in the browser). One key **replaced**: `scheme_ahvy_benefit`, which carried two approximate figures. Coverage script: 0 missing, 0 extra, 0 collisions, placeholders identical.
- Gates: tsc PASS | lint 112 / 44 source, 0 files worse than baseline (one warning fewer than Phase 7) | build PASS | `test:all` PASS (+ toolingGuide 11 checks) | `verify:schemes` 89 passed, 0 failed
- Verification — scheme figures, fetched today:
  - ✓ **PM Vishwakarma** — read on pmvishwakarma.gov.in: ₹15,000 toolkit grant, collateral-free ₹1 lakh then ₹2 lakh at 5 % with an 8 % subvention cap, ₹500/day stipend, ₹1 per digital transaction up to 100 a month. The benefit line was rewritten to match what the portal says and now carries `sourceUrl` + `verifiedOn`.
  - ✓ **PMEGP** — read on pmegp.msme.gov.in/Home/FAQ: age 18+, class VIII for projects above ₹10 lakh (manufacturing) / ₹5 lakh (service), one person per family, new units only, business/trading ceiling ₹20 lakh. The subsidy table and the manufacturing ceiling could **not** be confirmed from a current source — the only guidelines PDF that opened (kvic.gov.in) is the 2008 original, whose ₹25 lakh / ₹10 lakh caps are out of date — so no subsidy percentage and no manufacturing ceiling is shown, and the note tells the artisan to check the portal.
  - ✓ **MUDRA** — read in a PIB backgrounder (static.pib.gov.in, Oct 2024): Shishu up to ₹50,000, Kishore above ₹50,000 to ₹5 lakh, Tarun above ₹5 lakh to ₹10 lakh, Tarun Plus ₹10 lakh to ₹20 lakh after a repaid Tarun loan, collateral-free through member lending institutions.
  - ✓ **SFURTI** — sfurti.msme.gov.in, msme.gov.in and the PIB release all refused this environment (TLS failure or HTTP 403), so the scheme carries `verifiedOn: null`, states no figure, and is **withheld from the artisan-facing list** by the guard. The funding tab says one scheme is not shown and why.
  - ✓ **AHVY** — handicrafts.nic.in unreachable, so its "~₹5,000 toolkits / ~₹4,000 margin money" approximations were removed from both the scheme and the four dictionaries. It still renders, describing what it funds.
- Verification — live API (23/23 against `next dev`):
  - ✓ `/artisan/materials` → **308** to `/artisan/workshop`; a grep proves no `/artisan/materials` link is left in `src`
  - ✓ tooling: unauthenticated 401, ADMIN 403; cluster key follows the one app-wide rule; a weaver gets the loom entries and every curated row carries its three i18n keys
  - ✓ **No phone number, email or link survives in the AI brief** (checked against the live model answer), and the cost band it returned states its basis
  - ✓ "Ask my cluster" writes a real `ResourceRequest`; it appears in the tab marked as the artisan's own; **another artisan in the same cluster sees it** and one in a different cluster does not
  - ✓ Every equipment scheme that names an amount carries an https .gov.in source and an ISO check date; SFURTI is absent from the list and named in `withheld`; each blocked scheme reports the rule that blocks it
- Verification — browser (Browser pane, signed in as lakshmi@karigari.com):
  - ✓ The old URL lands on Workshop Resources with the sidebar reading "Workshop Resources"; `?tab=repair` and `?tab=funding` deep-link correctly and the tab is written back to the URL
  - ✓ Materials tab unchanged: 14 rows, Restock/Bulk toggle, and the prototype-directory caveat intact
  - ✓ Repair tab: cluster reach line, a posted request appearing in the list as "Your request", the AI brief labelled "AI suggestion for your craft", no digit run anywhere in it, and the note that Karigari keeps no list of repair shops
  - ✓ Funding tab: PMEGP and MUDRA cards with "Official source" links and "Figures checked on 18 Sept 2026"; PM Vishwakarma in "Not open to you yet" with "Needs: One of the 18 notified trades · Yours: Sambalpuri Ikat Silk Saree (handloom weaving)"; the withheld-scheme footnote
  - ✓ en / hi / or / te at 360 px on all three tabs: page scroll width 360, no overflowing element, no raw keys, no tap target under 40 px
  - ✓ Console on a fresh tab: no errors, no React warnings
  - ✓ Cleanup: the two artisans temporarily joined into one SHG were restored to their original (null) links, and all four test `ResourceRequest` rows were deleted
- Decisions and deviations:
  1. **Nothing states an amount it has not read.** `statesAnAmount` + `isSchemeCited` in `src/lib/schemes.ts` are a guard, not a convention: `evaluateAllSchemes` withholds any scheme that names a figure without a source and a date, or that the author marked `verifiedOn: null`, and `verify:schemes` fails the same case in CI.
  2. **A percentage is only a money figure in a money context.** The first version of that guard read AHVY's "at least 50 % of members are cluster artisans" as a price and withheld a scheme that states no amount at all. It now looks for money words within 40 characters of the `%`.
  3. **The repair tab names nobody.** No shop, no person, no number — from the curated guide or from the model. `stripContactDetails` removes any 6+ digit run (spaced or hyphenated), anything with an @, and any URL or bare domain, and a test asserts "call 98765 43210" cannot survive in any of those forms.
  4. **A cost band needs a stated basis.** The model must say what the range covers; without that `typicalCostBand` becomes null rather than a price an artisan might quote to a repairer. Where a band is shown it is labelled "AI estimate — verify locally before paying."
  5. **"Who fixes it" is the cluster.** The primary action posts a real `ResourceRequest` prefixed `Repair:`, and the page says how many artisans it will actually reach — including when that is nobody.
  6. **The scheme card was extracted, not forked** (§8.5 asks for exactly this): `SchemeCard`, `LockedCard`, the status maps, the payload types and one `toAssistantScheme` converter now live in `src/components/schemes/SchemeCard.tsx`, imported by both the schemes page and the funding tab.
  7. **The Scrap & waste tab is not added here**, per §8.3's own instruction — Phase 12 adds it with the code behind it.
  8. **The materials tab's English-only strings were translated** (mode toggle, refresh, empty states, call/order labels, the two quality guides), because this phase is checked in four languages.
  9. **Three singular forms** were added after seeing "1 artisans" in the browser, and the no-cluster line now distinguishes "you are in no cluster" from "nobody else has joined your cluster yet".
- Known follow-ups:
  - Every seeded artisan is alone in their own `auto:<location>` cluster, so cluster visibility was proved by temporarily joining two Odisha artisans into one SHG and then restoring both. Nothing in the seed exercises a real multi-member cluster.
  - PMEGP's subsidy rates and manufacturing ceiling are still unverified from this environment; the card deliberately shows neither. If kviconline.gov.in becomes reachable, the revised (Dec 2023) guidelines should be read and the figures added with a fresh `verifiedOn`.
  - SFURTI stays hidden until its source can be fetched. It is a cluster-level scheme applied for by an implementing agency, so an individual artisan losing it costs them little.
  - The tooling brief is per craft and area, cached in process memory for a day; a model that answers in English for an Odia request is not re-asked.

## Phase 7 detail
- Status: **DONE** (2026-09-18)
- Schema: none.
- Files created: `src/lib/relativeTime.ts` (pure: `relativeKeyAndValue` → an i18n key + a number, never an English string) · `src/lib/syncStatus.ts` (pure: `syncView`, the four states and their precedence) · `src/components/SyncStatusChip.tsx` · `src/lib/__tests__/syncStatus.test.mjs`
- Files modified: `src/lib/offlineQueueStore.ts` (`lastSyncedAt` / `lastSyncError`, `markSynced`, `markSyncError`, `hydrateLastSynced`, `LAST_SYNCED_KEY`, both added to the server snapshot and to the change check) · `src/lib/offlineSync.ts` (`FlushResult.contacted`) · `src/components/OfflineSyncProvider.tsx` (marks synced/errored, hydrates the remembered time, toast translated) · `src/components/NotificationsBell.tsx` (marks synced on a successful load) · `src/components/OfflineQueueBadge.tsx` (translated; narrow-screen count) · `src/components/ui/TopBar.tsx` (mounts the chip; wordmark hidden below `sm`) · `package.json` (`test:sync` in `test:all`) · `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 20 × 4 dictionaries (the 11 in §7.4 plus `sync_synced_no_time`, `sync_never`, the two badge tooltips, `sync_uploading`, `sync_waiting_upload` and the three toast strings — the badge and the toast were English-only before this phase). Coverage script: 0 missing, 0 extra, placeholders identical, none left identical to English.
- Gates: tsc PASS | lint 112 / 45 source (baseline), 0 files worse | build PASS, baseline warnings only | `test:all` PASS (+ syncStatus 17 checks)
- Verification — browser (Browser pane, signed in as lakshmi@karigari.com, `next dev` unless noted):
  - ✓ First load with the remembered time cleared: the chip reads "Synced just now" and `karigari_last_synced` is written
  - ✓ **The label ages without a reload**: the same page later read "Synced 2 min ago", and after a long pause "Synced 4 h ago" — the 30 s timer re-renders the string and makes no request
  - ✓ Offline (`navigator.onLine` forced false + the `offline` event): chip and badge both amber, "Offline"; with one row queued both read "Offline — 1 saved on phone", in en / hi / or / te
  - ✓ Server stopped with a queued row: the flush reaches nobody and the chip becomes a `role="alert"` button, "Not synced / Retry", aria-label "Not synced: Retry"
  - ✓ Server restarted, Retry tapped: the server answered (the row's attempt counter rose and it came back `AMOUNT_INVALID`), so the chip returned to "Synced just now" while the badge kept counting the refused row — reachability and queue state reported separately
  - ✓ A row the server had already refused as terminal is not retried, and therefore does not turn the chip red (the existing queue rule, still holding)
  - ✓ 360 px: chip 34 px and badge 50 px, icon-only, each carrying the full sentence in `aria-label` and `title`; page scroll width 360 with no overflow
  - ✓ Production build, fresh tab: **zero hydration warnings and no React errors** — the only console message is the pane's own inability to register a service worker, which appears identically on every page of the app
  - ✓ Production build in en / hi / or / te: chip text and the "what is saved on this phone" tooltip translated
  - ✓ Cleanup: the queued test rows removed from IndexedDB (captures 0, offline sales 0); nothing was written to the database by these checks
- Decisions and deviations:
  1. **"Synced" means the server answered.** `flushQueue()` now reports `contacted`, and the chip's time is set only when a request came back — from a flush that reached the server, or the bell's load. The spec suggested marking a *successful empty drain* as a sync; an empty queue sends nothing, so that would have been a claim with no evidence behind it, and this is the honest version of the same idea.
  2. **A rejected row is not a sync failure.** A sale the server refuses (an amount that needs fixing) is the queue's business and is counted by the badge; the chip turns red only when the server could not be reached at all. Both are visible at once, which is how the two pills divide the work.
  3. **No new polling anywhere.** The 30 s interval re-renders the relative string only. The bell already fetches once per navigation and has no timer, so the chip's freshness is the freshness of work the app was doing anyway.
  4. **Hydration safety**: the first paint renders the state with no relative time (`sync_synced_no_time`), and the time appears inside the deferred `setTimeout(…, 0)` effect. `relativeTime.ts` returns an i18n key and a number rather than a formatted string, so no locale is ever implied.
  5. **Both new store fields are in `SERVER_SNAPSHOT` and in `setQueueState`'s equality check** — the second is what stops `useSyncExternalStore` from missing an update, and a test asserts the live state and the snapshot have exactly the same keys.
  6. **A pre-existing 360 px overflow is fixed here.** The header already scrolled sideways at 360 px whenever the offline badge appeared (403 px of content in a 360 px row); adding a second pill made it permanent. The 99 px wordmark is now hidden below `sm`, where the hamburger beside it already identifies the app, and the row fits (360 px, measured with both pills visible).
  7. **The badge and the sync toast were English-only** and are now translated, because this phase is checked in four languages and they sit next to the chip.
  8. **`/offline`** already links back to the dashboard and explains that queued captures upload automatically, so it was left alone; it is the service worker's static fallback and is English-only, as before.
- Known follow-ups:
  - Offline was simulated by overriding `navigator.onLine` and firing the `offline` event, not by real airplane mode; and the service worker does not register inside the Browser pane, so a cold offline relaunch still has not been seen here.
  - `lastSyncedAt` is per device and per browser profile, as `localStorage` is. Two browsers on the same phone show their own last-synced times.
  - The chip lives in `TopBar`, so it appears on the artisan and admin shells only. Public pages (the storefront, a QR passport) have no header chip.

## Phase 6 detail
- Status: **DONE** (2026-09-18)
- Schema: `SupplyReminderState` model (`artisanId` `@unique`, `lastRemindedAt`, `snoozedUntil`, `remindCount`) and `User.supplyReminderState`. Additive; pushed with `db push --url $DIRECT_URL`. Single writer: `src/lib/supplyReminder.ts`.
- Files created: `src/lib/supplyReminderRules.ts` (pure: thresholds, `decideReminder`, the stored English title and its parser) · `src/lib/supplyReminder.ts` (server: one `Promise.all` of five reads, the conditional claim, the write) · `src/lib/supplyNotice.ts` (client: renders a stored alert in the artisan's language) · `src/components/SupplyNudgeCard.tsx` · `src/app/api/artisan/supply-reminder/route.ts` · `src/lib/__tests__/supplyReminder.test.mjs`
- Files modified: `prisma/schema.prisma`, `package.json` (`test:supply` in `test:all`), `src/app/api/artisan/dashboard/route.ts` (fire-and-forget check + `supplyStatus` in the payload), `src/app/artisan/dashboard/page.tsx` (the nudge card above the portfolio list), `src/components/NotificationsBell.tsx`, `src/app/artisan/notifications/page.tsx`, `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 12 × 4 dictionaries (the 9 in §6.6 plus `supply_nudge_since`, `supply_nudge_since_never` and `supply_nudge_snooze_failed`). Coverage script: 0 missing, 0 extra, placeholders identical, none left identical to English.
- Gates: tsc PASS | lint 112 / 45 source (baseline), 0 files worse | build PASS, baseline warnings only | `test:all` PASS (+ supplyReminder 15 checks)
- Verification — live API (31/31 against `next dev`):
  - ✓ Unauthenticated GET/POST → 401; an ADMIN token → 403
  - ✓ Ghulam (newest of his items, offline sales and demand orders is 21 days old): GET reports CREATED with idleDays 21, equal to a hand-written `GREATEST(max(CraftItem.createdAt), max(OfflineSale.soldAt), max(ArtisanOrder.createdAt))` query
  - ✓ The GET writes nothing: no alert row, no state row, after it answers
  - ✓ Lakshmi (active 12 days ago) reads ACTIVE; a 7-day-old account reads TOO_NEW
  - ✓ **Ten concurrent dashboard loads → exactly one notification row**, `remindCount` 1, all ten responses 200 and carrying the same `supplyStatus`
  - ✓ The alert is `IN_APP`, stored in English, titled "No new listing in 21 days", and the number in the title equals the computed idle days
  - ✓ An eleventh load writes nothing; the artisan then reads COOLDOWN
  - ✓ POST without an action, or with an unknown one → 400. Snooze → 200 with the date it runs to; the artisan reads SNOOZED and the dashboard payload says so
  - ✓ An expired snooze stops silencing it (back to COOLDOWN); past the 14-day cooldown it reads CREATED again
  - ✓ **One offline sale makes an idle artisan ACTIVE again** (idleDays 0) and the dashboard nudge disappears with it; no alert was written; deleting the test sale returns them to CREATED
  - ✓ A 7-day-old account and an actively working artisan were never nudged, however many times their dashboard loaded
- Verification — timing (sequential, same server, after a warm-up):
  - ✓ The dashboard call whose check writes the alert: **676 ms**; the next five calls for the same artisan: 725–840 ms (median 772 ms); an active artisan: median 1040 ms. The writing call is not the slow one, which is what "fire-and-forget" has to mean.
  - ✓ `GET /api/artisan/supply-reminder` alone: median 232 ms. Inside the dashboard its five reads join the existing `Promise.all`, so they add no serial step.
- Verification — browser (Browser pane, signed in as lakshmi@karigari.com):
  - ✓ With her two newest activity rows temporarily backdated 15 days (originals saved and restored afterwards): the card reads "24 DAYS QUIET / It has been 24 days since your last piece / Last recorded on 24 Aug 2026", with links to `/artisan/materials` and `/artisan/schemes`, "Remind me later" and a dismiss
  - ✓ The bell row and the notifications page row both render the translated sentence with the real count and the same three actions
  - ✓ en / hi / or / te: card and bell row translated, day count 24 in all four, no raw keys; at 360 px the card has no overflowing element and every action is a 40 px tap target
  - ✓ "Remind me later" from the notifications page: the row disappears, the account reads SNOOZED, and the dashboard card is gone on the next load
  - ✓ "Dismiss": the card goes, stays gone across a reload, and returns once the artisan has been idle a week longer (the stored value is the idle-day count, not a timestamp)
  - ✓ Console on a fresh dashboard load with the card rendered: no errors, no React warnings
  - ✓ Cleanup: the backdated timestamps restored exactly (Lakshmi's newest piece is 12 days old again), every `SUPPLY_REMINDER` row and every `SupplyReminderState` row written by the checks deleted, the test offline sale deleted
- Decisions and deviations:
  1. **No cron, as instructed.** The check rides on the dashboard request, the same lazy pattern `notifyArtisanOfFestival()` uses on `/api/artisan/insights`.
  2. **Idempotency is enforced by the database, not by a read-then-write.** Before writing, the reminder is claimed with a conditional `updateMany` on `SupplyReminderState` (`lastRemindedAt` null or older than the cooldown); only the winner writes the alert. The festival path's dedupe `findFirst` is kept as a second guard for rows written before this table existed. Ten simultaneous loads were tested, not assumed.
  3. **The GET is read-only.** A page asking "am I idle?" must not be able to create an alert as a side effect.
  4. **An artisan who has never catalogued anything is idle since they joined**, so a three-month-old empty account is nudged once it passes the 21-day age gate. The account-age gate is what keeps a new artisan quiet.
  5. **Activity is activity.** The idle clock reads the newest of a catalogue entry, an offline sale (Phase 1) and a demand order, so a weaver selling at haats every week is never told they have stopped working.
  6. **Two different ways to quiet it.** "Remind me later" writes a 7-day snooze on the account; "Dismiss" only hides the card on that phone (localStorage), and it returns after another week of idleness. The dismissal stores the idle-day count it was made at, so it expires against the artisan's own record rather than a clock.
  7. **The day count travels in the English title** ("No new listing in 23 days") because `Notification` has no params column; the clients parse it back out and render the sentence from the dictionary. A row that does not parse renders as the English it was stored as, and that fallback is covered by a test.
  8. **The bell's actions are spans with `role="button"`**, not links: each notification row is itself a `<button>`, and nesting interactive elements would be invalid HTML. The demand expander in that file already uses this pattern, keyboard handling included. The notifications page, whose rows are plain `<div>`s, uses real links and a real button.
  9. **Dates inside the card use `en-IN` with `Asia/Kolkata`** (the house format), so "24 Aug 2026" keeps its English month abbreviation in all four languages, exactly as the credit record and passport dates do.
- Known follow-ups:
  - `NO_PROFILE` (registration abandoned before the profile row exists) is covered by a unit test only: every artisan in the database has a profile, and deleting one to prove it would have meant mutating a seeded account.
  - The reminder is in-app only. `src/lib/sms.ts` exists and is allow-listed, but no artisan's number is on the allow-list, so sending this over SMS was neither wired nor tested.
  - The nudge links to `/artisan/materials`. Phase 8 renames that surface to `/artisan/workshop`; the link will need to follow it (or the rename needs a redirect).

## Phase 5 detail
- Status: **DONE** (2026-09-18)
- Schema: `LearningProgress` model (`moduleKey` `track:slug`, `status` STARTED | COMPLETED, `@@unique([artisanId, moduleKey])`) and `User.learningProgress`. Additive; pushed with `db push --url $DIRECT_URL`. Single writer: POST `/api/artisan/learning-progress`. The skill stage is deliberately NOT stored — it is derived from the production record on every read, so it cannot drift from the sales and listings it summarises.
- Files created: `src/lib/skillStage.ts` (pure: `resolveSkillStage`, `requirementsFor`, `progressToward`, every threshold exported) · `src/lib/skillStageRecord.ts` (server: reuses `gatherCreditInputs` so "verified listings" and "sales" mean what they mean on the Credit record tab) · `src/lib/learningCatalog.ts` (23 hand-written lessons, family- and gap-aware selection, client-safe) · `src/lib/learningPlan.ts` (AI sanitising, track assembly, `youtubeSearchUrl`, module-key rules) · `src/lib/learningCache.ts` (IndexedDB `karigari-learning` v1) · `src/lib/useLearningPlan.ts` (saved copy → network → catalogue) · `src/lib/craftFamilies.ts` (`familiesForCraft` moved out of `suppliers.ts`; re-exported there) · `src/components/learn/{SkillStageCard,LearningTracks}.tsx` · `src/app/api/artisan/{learning-recommendations,learning-progress}/route.ts` · `src/lib/__tests__/skillStage.test.mjs`
- Files modified: `prisma/schema.prisma`, `package.json` (`test:skill-stage` in `test:all`), `next.config.ts` (one NetworkOnly service-worker rule for the recommendations route), `src/lib/suppliers.ts` (re-export), `src/lib/authClient.ts` (logout clears the learning cache), `src/app/artisan/learn/page.tsx`, `src/lib/i18n/{en,hi,or,te}.ts`
- i18n keys added: 148 × 4 dictionaries (all 22 in §5.7, 69 catalogue keys — title, "why this helps" and search phrase per lesson — and 57 for the stage card, track cards, footnotes and the page's own copy, which was English-only before this phase). Coverage script: 0 missing, 0 extra, placeholders identical; only `learn_field_upi` ("UPI ID") is the same string in every language.
- Gates: tsc PASS | lint 112 / 45 source (baseline), 0 files worse | build PASS, baseline warnings only | `test:all` PASS (+ skillStage 26 checks)
- Verification — live API (71/71 against `next dev`, and 71/71 again against a production build started with `GEMINI_API_KEY`, `GOOGLE_API_KEY` and `GROQ_API_KEY` blank):
  - ✓ Unauthenticated GET/POST → 401; an ADMIN token → 403
  - ✓ Lakshmi: stage, all five inputs and all three money streams equal independent hand-written SQL counts (11 verified listings, 5 sales, ₹74,397, 0 lessons) — INTERMEDIATE, progress to PRO 0, gaps listed as 11/20, 5/10, 0/3 with the money criterion already met
  - ✓ Adi with no craft set: BEGINNER, `craftType: null`, every input 0, both Intermediate gaps listed, catalogue falls back to the generic craft family (profile restored afterwards)
  - ✓ Cards: three tracks, 3–4 each, valid module keys, and no card carries any field beyond title / reason / search — no video id, channel, duration, view count or thumbnail exists in the response shape
  - ✓ AI cards contain no link or youtu.be/youtube.com text and no search over 120 characters; Hindi request returns Hindi titles
  - ✓ A repeat request reuses the cached AI answer (same `generatedAt`, 310 ms vs 5.0 s); unknown `lang` falls back to `en`; `Cache-Control: private, no-store`
  - ✓ Progress writes: seven malformed bodies (missing action, unknown action, unknown track, a title as a key, an over-long key, malformed JSON) → 400; start → STARTED; complete → COMPLETED and progress to PRO 1/3; start after complete does not downgrade; complete twice → one row; six concurrent completes ("two tabs") → one row, all 200; undo → STARTED with the row kept; undo twice is a no-op; undo on a lesson never started writes nothing
  - ✓ Three lessons done: the lesson criterion disappears from the gaps and progress becomes the next weakest (sales 5/10 = 0.5)
  - ✓ Another artisan sees none of Lakshmi's rows; after the writes the live figures still equal a fresh hand count
  - ✓ Key-less build: every track is the curated catalogue, `source: 'CURATED'`, and the route answers in ~230 ms because no model is called
- Verification — browser (Browser pane, signed in as lakshmi@karigari.com, 360 × 800):
  - ✓ Stage chip "Intermediate"; tapping it opens the real have/need — 11 of 20, 5 of 10, 2 of 3 — each with its own bar (55 %, 50 %, 67 %) and the headline bar at 50 %, the weakest of them
  - ✓ "Mark as done" → the card shows Done, the lesson gap disappears from the disclosure, the row is COMPLETED in the database, and it survives a reload
  - ✓ Nine cards, every "Watch on YouTube" a `https://www.youtube.com/results?search_query=…` link with `rel="noopener noreferrer"`; no image, iframe, duration or view-count text anywhere in the tracks
  - ✓ en / hi / or / te: headings, chip, cards and footnotes translated, no raw keys, page scroll width 360 with no overflow (cards sit in a horizontal rail), every tap target ≥ 40 px
  - ✓ The Odia answer came back thin (one usable AI card), so the tracks were padded from the catalogue and the footnote said so — the mixed state, seen live rather than only in tests
  - ✓ Server stopped mid-session: the page keeps its cards and shows "Saved on this phone · generated 17 Sept 2026, 11:39 pm IST" in a polite live region; switching language offline shows the copy saved in that language
  - ✓ Mark as done with the server down: "That could not be saved. Check your connection and try again." in a `role="alert"`, and the card reverts to not-done
  - ✓ No saved copy and no answer at all: the twelve curated lessons render with "You are offline, so these are the standard suggestions built into the app", and the stage card says the stage needs a connection instead of inventing one
  - ✓ Console on a fresh tab: no errors from this feature. Two messages are app-wide and pre-existing in this pane — the service worker cannot register here ("unknown error occurred when fetching the script"), and Next's CSS preload warning; both appear identically on the dashboard
  - ✓ Cleanup: every `LearningProgress` row written by the checks deleted (0 left); Adi's craft type restored
- Decisions and deviations:
  1. **Stage counts are the credit record's counts.** `gatherStageRecord` calls `gatherCreditInputs`, so "verified listings" (`qrVerified`) and "sales" cannot mean one thing on the Credit record tab and another here.
  2. **`itemsSold` and `realisedEarnings` include the offline ledger.** Phase 1 exists because cash sales at a haat are real income; excluding them would make the stage unreachable for an artisan who sells locally. The three streams are never merged in the text: the money requirement always prints "Karigari sales · demand orders · offline sales you logged" with each figure.
  3. **Progress is the weakest criterion**, not an average, and the card says so in words. At the boundary it is exactly 1.0 (covered by a test), so 5 listings + 1 sale reads as Intermediate and not 99 %.
  4. **A beginner sees the whole ladder.** `nextRequirements` holds only the next stage's gaps, per the spec; the card additionally lists the unmet Pro criteria underneath, so a new artisan sees all four.
  5. **`ordersDelivered` is carried but gates nothing** — it is in the spec's `StageInputs` and Phase 9 will want it.
  6. **No video is ever named.** Cards link to a YouTube *search* built here; the AI is forbidden video ids, links, channels, durations, view counts and thumbnails, and any link-like text is stripped from its title, reason and search before it reaches the phone. The card art is a lucide icon on a token block.
  7. **Curated lessons are i18n keys** (title, reason and search phrase), so a Hindi artisan searches in Hindi. `{craft}` in a search phrase is filled with their own craft, or the word for handicraft when they have not set one.
  8. **"Done" is the artisan's own word.** Nothing checks that a video was watched, so every surface says "lessons you marked done". Keys are format-checked and capped at 300 rows per artisan.
  9. **Server-side AI cache is per artisan, language and inputs**, 24 h for an answer and 10 min for a failure, in process memory. A gap counts as "open or not", so selling one more piece does not buy a fresh model call.
  10. **The service worker must not cache the recommendations route.** Its default `/api/` rule would have returned a day-old answer that looked fresh, which would have made the "saved on this phone" note a lie. One NetworkOnly rule now precedes it.
  11. **Logging out clears the on-phone copy**, since it carries that artisan's stage and earnings and the handset may be shared.
  12. **`familiesForCraft` moved to `src/lib/craftFamilies.ts`** so the offline catalogue can match a craft without bundling the supplier directory into the page; `suppliers.ts` re-exports it, so no call site changed.
  13. **Two changes to the existing page**, which the spec asked to leave alone: every string is now an i18n key (it was English-only, and this phase is checked in four languages), and the invented 35 % / 70 % / 85 % bars on the assignment rows are gone. Only the profile assignment keeps a bar, because "2 of 4 fields filled" is a real fraction; the others show their real count. The two documented design decisions — masterclasses pre-fetch no videos, assignments are real outstanding work — are untouched.
  14. **The prompt was tightened after reading its first answers**: an early version let one open gap ("pieces need their QR patch photographed") colour every track, producing lessons about packaging a QR patch. Each gap may now seed at most one lesson, in the track it belongs to.
- Known follow-ups:
  - No artisan in the database meets the PRO thresholds, and no seeded artisan has an unset craft type, so the PRO card and the beginner two-list layout were verified from payloads and unit tests rather than rendered. The same applies to the BEGINNER stage chip: the checks ran as Lakshmi (INTERMEDIATE).
  - The service worker does not register inside the Browser pane, so the cold offline *relaunch* (worker serves the page shell) was not observed; the page's own offline behaviour was exercised by stopping the server with the page open.
  - Switching language while offline falls back to English UI chrome, because the Hindi/Odia/Telugu dictionaries are lazily imported and that chunk cannot be fetched. Pre-existing, app-wide.
  - An AI lesson's module key is a hash of its search phrase, so a lesson marked done keeps its row but may not show as done after the AI rewrites that suggestion in another language. The completed count is unaffected.
  - Marking a lesson done needs a connection; there is no outbox for it (the capture and offline-sale queues are for money and stock).

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
