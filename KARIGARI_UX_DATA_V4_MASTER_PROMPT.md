# MASTER PROMPT — KARIGARI UX + Seed-Data Batch V4 (14 items)

> Paste into **Claude Code** (it already has this repo). Implement every item below. Keep the build green, keep the green-heritage theme, keep everything responsive and i18n-wired. Work **only inside the app root**. Add no new dependencies — everything needed (`recharts`, `lucide-react`, `next/image`, Prisma, bcryptjs) is already installed.

---

## 0. ORIENTATION (read first — do not skip)

**App root (nested one level down):** `KARIGARI-main/KARIGARI/` — `cd` there. `package.json` = `karigari-app`.

**Stack:** Next.js **16.3.1** App Router (Turbopack), React **19.2**, TS 5, Prisma **7.9** + `@prisma/adapter-pg` (Postgres), Tailwind **v4**, `lucide-react`, `recharts@3`.

**⚠️ Next 16 ≠ your training-data Next.** Dynamic `params` is a Promise (`await params`), `cookies()` is async. Client pages read the query string via `window.location.search` in a **deferred** `useEffect` (see `src/lib/urlTab.ts`), never `useSearchParams`.

**Conventions to match (do not reinvent):**
- Prisma singleton: `import { prisma } from '@/lib/prisma'`. Run `npx prisma generate` after any schema change.
- Theme tokens in `src/app/globals.css`: `primary #24332C`, mint `var(--color-mint)`, sage, pill `var(--color-pill)`, maroon/rust. Use `bg-primary`, `rounded-2xl`, `shadow-card`, `font-serif`, `kg-press`, `kg-rail`. No raw hex outside tokens.
- **i18n is mandatory.** `const { t } = useLanguage()` from `@/lib/translations`. Every new user-facing string gets a key in **all four** locale files: `src/lib/i18n/en.ts`, `hi.ts`, `or.ts`, `te.ts`. No hardcoded English in JSX.
- Money: `getListingPrice`, `formatRupees`, `estimateCraftValuation` from `@/lib/pricing`. Never hand-roll.
- **Data model fact:** there is NO `Order` table — an order IS a `CraftItem`. Sale state lives on `CraftItem`: `status`, `salePrice`, `askingPrice`, `escrowStatus` (`ESCROW_HELD|STAGE1_ADVANCE_PAID_40|STAGE2_SETTLED_89`), `advanceAmount`, `finalSettlementAmount`, `images` (String[] of data-URL/URL strings), `fairWageFloor`, `marketPriceMin/Max`, `standardMarketPrice`, `pricingFlag`, `flagReason`.

**Seed data lives in `prisma/seed.ts`** (~1300 lines). Key structures to extend, not rewrite:
- `ARTISANS: ArtisanSeed[]` (6 artisans) — `key, craftType, craftSlug, language, location, ...`.
- `ITEMS: Record<string, ItemSeed[]>` keyed by `artisan.key` — each `ItemSeed` has `title, stage ('PENDING_VERIFICATION'|'SELLABLE'|'LISTED'|'SOLD'), createdDaysAgo, imageIndex`.
- Images come from `scripts/build-seed-images.ts` (`buildSeedImages(perCraft, artisanCount)` → `images.crafts[craftSlug]`). `gallery = [craftPhotos[seed.imageIndex % craftPhotos.length]]`.
- Seeding wipes and rebuilds: `main()` deletes all rows then recreates. **Re-run `npm run seed` after editing** and confirm counts print.

**Finish gate:** `npm run build` (zero TS errors, all routes compile) **and** `npm run lint` clean. Run `npm run seed` and verify it completes and prints artisan/item/creator counts. Manual click-through of every screen touched.

---

# PART A — UI / UX

## ITEM 1 · Move the artisan Logout button up to the top bar, next to the language selector

**Current:** artisan logout is a button at the bottom of the dashboard page — `src/app/artisan/dashboard/page.tsx:482` (`handleLogout`, uses `POST /api/auth/logout` then routes to `/login`). The top bar (`src/components/ui/TopBar.tsx`, right cluster ~line 299) holds `OfflineQueueBadge → actions → <LanguageMenu/> → <NotificationsBell/> → profile avatar`.

**Do:**
1. Add a **Logout** control to the TopBar right cluster, placed **immediately beside `<LanguageMenu/>`** (a `lucide-react` `LogOut` icon button, `kg-press`, themed hover `hover:bg-[var(--color-pill)]`, `aria-label={t('logout')}`, same 40px round footprint as the other controls). On click: `await fetch('/api/auth/logout',{method:'POST'})` then `router.push('/login')`. Extract the logout handler into a tiny shared helper (e.g. `src/lib/authClient.ts` `logout(router)`) so TopBar and any existing caller reuse it.
2. **Remove** the old bottom-of-dashboard logout button (lines ~478–486) so there is exactly one artisan logout, in the top bar.
3. Add the `logout` i18n key to all four locale files if missing.

**Acceptance:** artisan sees a logout button top-right next to the globe on every artisan screen; it logs out and lands on `/login`; the old bottom button is gone.

---

## ITEM 2 · Remove the AI Hub completely

**Current footprint:** route `src/app/artisan/hub/` (`page.tsx`, `loading.tsx`); nav entry in `src/components/ui/Sidebar.tsx:88` (`{ href:'/artisan/hub', label:'nav_ai_hub', ... }` in the `shell_group_my_workshop` group); inbound links from `src/app/artisan/learn/page.tsx:242` and `src/app/artisan/news/page.tsx:319`; i18n keys `nav_ai_hub` and `page_hub_title` (+ any `page_hub_*`).

**Do:** delete the `src/app/artisan/hub/` directory; remove the Sidebar nav entry; remove/replace the two inbound `/artisan/hub` links (drop the CTA, or repoint to `/artisan/learn` if it makes sense — pick the cleaner option and note which); remove now-unused `hub` i18n keys from all four locale files; delete any now-unused imports (e.g. `Sparkles` if the hub was its only user — verify first). Grep `hub` and `Hub` across `src/` afterward to confirm zero dangling references. Keep the build green.

**Acceptance:** no AI Hub route, nav item, or link anywhere; `npm run build` passes with no unused-import errors.

---

## ITEM 3 · Earnings page — recent activity BELOW analytics, add "Most sold product" card

**File:** `src/app/artisan/earnings/page.tsx`. It already renders (in order): StatTiles → **Fair wage index** → **Recent activity** (`activity.map`, ~line 266) → **`<EarningsAnalytics/>`** (dynamic import, ~line 346). Data comes from `/api/artisan/dashboard` (`recentCaptures`).

**Do:**
1. **Reorder** so the section order becomes: StatTiles → Fair wage index → **`<EarningsAnalytics/>`** → **Recent activity**. Move the Recent-activity block to render after the analytics block. Keep spacing/`SectionLabel` consistent.
2. **Add a "Most sold product" card** (themed `Card` with `SectionLabel`), placed with the analytics section. Compute the top item from settled/sold rows (`status` SOLD_FINAL/PAYOUT_COMPLETED or `salePrice`/`escrowStatus` settled — mirror the existing `activityChip` logic). If a craftType repeats, aggregate by title. Show: product image (guard falsy `src` — themed placeholder when empty), title, **units sold**, **total revenue contributed** (`formatRupees`), and its **share of total earnings** (a `ProgressBar` + "X% of your KARIGARI earnings"). If the dashboard payload lacks per-item aggregates, extend `src/app/api/artisan/dashboard/route.ts` to return `topProduct: { title, image, unitsSold, revenue }` and a `bestSellers` array computed server-side from the artisan's settled `CraftItem` rows — cleaner than re-deriving client-side. Never count an AI valuation as revenue.
3. Empty/low-data artisans get a graceful "no sales yet" state, not a broken card.
4. New strings → all four locale files.

**Acceptance:** analytics appears above recent activity; a Most-sold-product card shows real units, revenue, and % share reconciled with the page totals; empty state is clean.

---

## ITEM 12 · Admin dashboard — fix tab switching + add a Logout button

**Files:** `src/lib/urlTab.ts` (`useUrlTab`), `src/components/AdminShell.tsx` (`TabBar` ~line 94, and its existing bottom `Log out` button ~line 83), consumers `src/app/admin/nodal/page.tsx:147` (`impact|audit`) and `src/app/admin/facilitator/page.tsx:140` (`qa|cluster`). The admin rail deep-links with `?tab=` (see `Sidebar.tsx` `ADMIN_GROUPS`).

**Fix the tab glitch (reproduce first):** the initial URL read in `useUrlTab` is deferred with `setTimeout(read, 0)`; a click landing before that macrotask fires calls `select()` (state + `history.replaceState`) and then the pending `read` re-runs and can stomp the tab back → flicker / dead first click.
- Read the `?tab=` value **synchronously in the `useState` initializer** (guard `typeof window !== 'undefined'` for SSR) and drop the `setTimeout` for the initial read; keep only the `popstate` listener for back/forward. Do **not** switch to `useSearchParams`.
- Ensure `select` and `popstate` always validate against the current `allowed` list.
- Verify each panel is a pure conditional render off `tab` with no remount/refetch storm.

**Add admin logout to the top bar:** the shared `TopBar` (Item 1) renders for `role==='ADMIN'` too. Ensure the same top-right Logout control shows for admins (it will, once added in Item 1 — just confirm it renders and works from `/admin/*`). Keep the existing `AdminShell` bottom logout or remove it for a single source — your call, but there must be an obvious, working logout on every admin screen.

**Acceptance:** on `/admin/nodal` and `/admin/facilitator`, every tab switches on the **first** click 10/10, no flicker; deep-link `?tab=audit`/`?tab=cluster` lands correctly with the rail highlighting; back/forward works; a logout button is visible and works on admin screens.

---

## ITEM 13 · Replace the login-page image  ⚠️ IMAGE NOT ATTACHED

**File:** `src/app/login/page.tsx` — the left plate uses `<Image src="/login-textile.jpg" ... fill priority sizes="50vw" .../>` (~line 87). The asset is `public/login-textile.jpg`.

**⚠️ The new image was not attached to this request.** Proceed as follows:
1. When the user provides the new image, drop it into `public/` (keep a descriptive name, e.g. `public/login-hero.jpg`) and point the login `<Image src>` at it. Keep `fill`, `priority`, `sizes="50vw"`, and the existing `object-cover` styling and gradient overlay so the swap is drop-in.
2. If the user wants to keep the same filename, simply overwrite `public/login-textile.jpg` — no code change needed.
3. Update the `alt` text to describe the new image.

**If the new image file is present in the repo/uploads when you run this, use it. If not, leave a clear `// TODO: swap src to new login image` at the `<Image>` and do not fabricate an asset.**

**Acceptance:** login left plate shows the new image full-bleed with the overlay intact, or a clearly-marked TODO if the asset is still missing.

---

## ITEM 14 · Remove the "India's Artisan Network" eyebrow on the landing page

**File:** `src/app/page.tsx:187` — the pill `<span class="kg-label ...">…India&rsquo;s Artisan Network</span>` (with the rust dot) above the hero `<h1>`.

**Do:** remove that entire eyebrow `<span>` (and its rust-dot child). Keep the hero heading "Preserving Heritage, Powering the Future" and adjust the top margin on the `<h1>` so the spacing still looks intentional without the pill. Leave the identical strings on `/login` and `/register` (the "The Artisan Network" figcaption) untouched — the request is only the landing hero eyebrow.

**Acceptance:** landing hero no longer shows the "India's Artisan Network" pill; spacing above the headline still looks clean.

---

# PART B — DATA MODEL / LOGIC

## ITEM 11 · Anti-exploitation pricing must flag ABOVE the estimate too (not only below)

**File:** `src/lib/pricing.ts` — `getPricingDiscrepancy()` currently flags only when `acceptedPrice < fairWageFloor * FAIR_WAGE_TOLERANCE` (0.7), i.e. **underpricing**. Consumers: `src/lib/pricing.ts` verdict, the facilitator queue (`/api/admin/facilitator-queue`, `src/app/admin/facilitator/page.tsx`), and `simulate-sale`.

**Do:**
1. Add an **upper bound**: define `FAIR_PRICE_CEILING_TOLERANCE` (e.g. `1.6` → flag when accepted price exceeds 60% above the fair/market reference). Prefer comparing against `marketPriceMax`/`standardMarketPrice` when present, falling back to `fairWageFloor`. Compute `pctAbove` symmetrically to `pctBelow`.
2. Extend `PricingDiscrepancy` with `direction: 'below' | 'above' | null` (and `pctAbove`, `overshoot` rupees). Set `flagged` for **either** direction. Reasons: below → the existing "…% below AI fair wage floor" (exploitation/middleman squeeze); above → e.g. "Accepted price {pctAbove}% above fair market range — possible over-pricing / buyer-gouging risk". Keep the function safe on partial rows (no NaN; legacy `pricingFlag`/`flagReason` still honoured).
3. Update the facilitator-queue UI + any pricing badge to show both directions (e.g. a red "Underpriced" chip and an amber "Overpriced" chip), themed. Add i18n keys for the new labels in all four locale files.
4. **Seed both cases** (feeds Item 6/9/10): add `ItemSeed` rows whose `askingPrice` is deliberately set well **below** and well **above** the AI estimate so the anti-exploitation check visibly surfaces both. In `prisma/seed.ts`, allow an `ItemSeed` to carry an optional `priceOverride` (or `priceMultiplier`) and, when present, set `askingPrice` from it instead of the computed valuation, and set `pricingFlag`/`flagReason` accordingly (or let the recompute do it). Add at least 2 underpriced and 2 overpriced items spread across artisans.

**Acceptance:** the facilitator anti-exploitation queue shows items flagged both for being below **and** above the estimate, with distinct reasons; `getPricingDiscrepancy` returns a correct `direction`; seed produces visible examples of each.

---

## ITEMS 4 · Add more high-quality dummy influencers (creators)

**Model `Creator`** (`prisma/schema.prisma`): `name, handle (unique), platform (INSTAGRAM|YOUTUBE|NIFT_STUDENT), profileUrl, photoUrl, nicheCategory, location, upiId, bio, totalClicks, totalSales, earningsTotal, status`. Creators are surfaced on `/artisan/marketing` via `/api/creators`. **They are currently NOT seeded** — only created via the register API.

**Do:** in `prisma/seed.ts`, add a `CREATORS` array and a `prisma.creator.createMany` block in `main()` (delete creators at the top alongside the other `deleteMany` calls). Seed **10–14 realistic, high-quality Indian craft influencers** across the three platforms, with niches drawn from `CREATOR_NICHES` in `src/lib/creators.ts` (Handloom Sarees, Tribal Jewelry, Pottery & Ceramics, Blue Pottery, Brass & Metalcraft, Mirror & Textile Embroidery, etc.), plausible handles, Indian city locations, valid-looking `upiId` VPAs, short authentic bios, and non-zero `totalClicks/totalSales/earningsTotal` so the marketing page looks populated. Use `photoUrl` from an existing public asset or leave null (the UI must already handle null — verify and guard falsy `src`). Keep it Indian-themed and genuine-sounding; no placeholder lorem.

**Acceptance:** `/artisan/marketing` shows a rich roster of influencers across niches and platforms with realistic stats; matching by craft niche returns creators.

---

## ITEMS 6, 9, 10 · Many more products across all statuses + more "SOLD" + niche Indian crafts

**Files:** `prisma/seed.ts` (`ARTISANS`, `ITEMS`), and `scripts/build-seed-images.ts` for imagery.

**Do:**
1. **Expand the arsenal, Indian-themed.** Add several new craft categories and, ideally, 2–4 **new artisans** in `ARTISANS` covering niche Indian crafts not yet present — e.g. **Madhubani painting, Kalamkari, Bidriware, Channapatna toys, Warli painting, Kashmiri Pashmina/Papier-mâché, Bagh/Ajrakh block print, Tanjore painting, Kondapalli toys, Meenakari, Phulkari, Terracotta (Molela/Panchmura), Kanjivaram silk**. Give each a `craftSlug` and add matching image generation in `build-seed-images.ts` so `images.crafts[craftSlug]` exists (follow the existing per-slug pattern; do not leave a slug without images).
2. **More items per artisan, across ALL stages.** Grow each artisan's `ITEMS[key]` list so every stage is well represented: `PENDING_VERIFICATION`, `SELLABLE`, `LISTED`, and especially **more `SOLD`** rows (Item 9). Aim for a healthy spread — e.g. each artisan ≥ 6–10 items with a realistic status mix and varied `createdDaysAgo` so earnings charts and monthly tallies have history.
3. **Every item must have an image** (Item 5): `gallery` already pulls from `craftPhotos`; ensure every new craftSlug produces images and every `ItemSeed.imageIndex` resolves. No item should list with an empty `images` array.
4. Keep prices realistic per craft; include the under/over-priced examples from Item 11.

**Acceptance:** after `npm run seed`, marketplace and each artisan dashboard show a large, varied catalogue of Indian crafts; all statuses populated; noticeably more SOLD items; every listing has an image.

---

## ITEM 5 · Product image attached to every dashboard listing (never empty)

**Context:** listing cards on `src/app/artisan/dashboard/page.tsx` (and marketplace/earnings) render `images[0]`. The `next/image` empty-`src` crash class was addressed elsewhere; here ensure **data**, not just guards.

**Do:**
1. In seed, guarantee every `CraftItem.images` has ≥1 valid entry (covered by Item 6.3).
2. In the dashboard listing card, render `images[0]` with `next/image`; when `images` is empty/falsy, render a themed placeholder (mint circle/box + `lucide-react` `Package`/`Camera` icon in `text-primary`) rather than an empty `src`. Add `sizes` and, for data-URL sources, `unoptimized`.
3. For newly captured items with no image yet, show the placeholder — never a broken image.

**Acceptance:** no dashboard listing shows an empty/broken image; seeded items show real craft photos; image-less items show a clean placeholder; zero `next/image` console warnings.

---

## ITEM 7 · Government schemes don't translate — fix eligible-scheme text on language change

**Root cause:** `/artisan/schemes` renders `scheme.name` and `scheme.description` straight from the server (`src/lib/schemes.ts` → `/api/artisan/schemes`) as raw English strings; they never pass through `t()`, so switching language leaves them English. Each scheme has a stable `key` (`SchemeKey`: `pm_vishwakarma, nsfdc, nbcfdc, gem_seller, ahvy, ondc`, plus any seeded like `mudra_shishu, nsfdc_term_loan`). The verdict/eligibility copy and self-declaration rows may have the same problem.

**Do:**
1. Add i18n keys for every scheme's **name** and **description** (and any eligibility/verdict/self-declare strings shown to the artisan) in **all four** locale files — e.g. `scheme_pm_vishwakarma_name`, `scheme_pm_vishwakarma_desc`, etc. Provide genuine Hindi/Odia/Telugu translations, not English copies.
2. In `src/app/artisan/schemes/page.tsx` (and `SchemeFormAssistant`/apply modal), render the localized string via the scheme `key` with a **fallback to the server string** when a key is missing: `t(\`scheme_${key}_name\`) || scheme.name`. Do the same for description, eyebrow, and status/verdict labels.
3. Ensure the eyebrow map (`pm_vishwakarma: "Central Scheme"`, etc.) and any status chips (`ELIGIBLE`, `APPLIED`, `UNDER_REVIEW`, …) are translated too.
4. Do **not** move eligibility logic into the client — only the presentation strings get localized.

**Acceptance:** on the schemes page, switching language (globe menu) translates scheme names, descriptions, eyebrows, and status labels for eligible and blocked schemes; a scheme with no translation key falls back to English instead of blanking.

---

## ITEM 8 · Add more genuine suppliers to Raw Materials

**Context:** `/artisan/materials` sources supplier rows from the Groq route `src/app/api/artisan/generate-materials/route.ts` (AI-generated, and only when Groq is configured — otherwise the list is thin/empty). The page (`src/app/artisan/materials/page.tsx`) shows supplier name, location, phone, price, verified badge.

**Do:** add a **curated static supplier directory** as a reliable base that always renders, independent of AI:
1. Create `src/lib/suppliers.ts` exporting a typed list of **genuine, real-sounding Indian raw-material suppliers** keyed by material/craft family (silk yarn, cotton hanks, natural dyes, brass/bell-metal, clay/glaze, mirror & thread, lacquer, stone/marble, etc.) — each with `name, material, location (real district/city), phone (plausible Indian format), priceRange (₹), verified`. Cover the crafts in `ARTISANS` including the new niche ones from Item 6. 8–15 quality entries per major family.
2. Update `/api/artisan/generate-materials` to **merge** the curated suppliers relevant to the artisan's `craftType` with any AI results (dedupe by name), so the list is rich even when Groq is unconfigured or errors. Keep the AI honesty rule intact (never surface raw error text as a fake supplier — see the route's existing note).
3. Materials page must gracefully show the curated list with a clear count; no empty state when curated data exists.

**Acceptance:** the Raw Materials tab shows a healthy list of credible suppliers for every craft, with or without Groq configured; matching to the artisan's craft works; no fake/error rows.

---

## FINAL CHECKLIST (do not report done until all pass)

- [ ] `npm run build` — zero TS errors, all routes compile (Turbopack).
- [ ] `npm run lint` — clean (no unused imports after Hub removal).
- [ ] `npx prisma generate` after schema changes; `npm run seed` runs clean and prints artisan / item / creator counts.
- [ ] Item 1: single artisan logout, top-right next to the globe, works.
- [ ] Item 2: AI Hub fully gone (route, nav, links, i18n keys) — grep clean.
- [ ] Item 3: analytics above recent activity; Most-sold-product card with units + revenue + % share, reconciled.
- [ ] Item 4: 10–14 seeded influencers across niches/platforms with stats.
- [ ] Item 5: every listing has an image or a clean placeholder; no `next/image` empty-src warnings.
- [ ] Items 6/9/10: large varied Indian-craft catalogue, all statuses, many more SOLD, new niche crafts with images.
- [ ] Item 7: schemes translate fully on language change, with English fallback.
- [ ] Item 8: curated supplier directory merged in; rich list with/without Groq.
- [ ] Item 11: pricing flags both below AND above the estimate; seed shows both; facilitator queue displays both.
- [ ] Item 12: admin tabs switch on first click, no flicker; admin logout visible + working.
- [ ] Item 13: login image swapped (or clear TODO if the asset is still missing).
- [ ] Item 14: landing "India's Artisan Network" eyebrow removed; spacing clean.
- [ ] Every new string added to `en / hi / or / te`. No hardcoded English. Theme + responsiveness intact on a 360px viewport.
- [ ] Report per item: files changed and how you verified.
