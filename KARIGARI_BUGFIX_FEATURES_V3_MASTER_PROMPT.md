# MASTER PROMPT — KARIGARI Bug-Fix & Feature Batch V3 (6 bugs + 3 features)

> Paste into **Claude Code** (it already has this repo). Fix every bug and ship every feature below. Keep the build green, keep the green-heritage theme, keep latency low, keep everything responsive and i18n-wired. Work **only inside the app root**. Do not refactor unrelated code, do not restyle unrelated screens, do not add dependencies that are not already in `package.json` (everything you need — `recharts`, `lucide-react`, `next/image`, Prisma — is already there).

---

## 0. ORIENTATION (read first — do not skip)

**App root (nested one level down):** `KARIGARI-main/KARIGARI/` — `cd` there. `package.json` = `karigari-app`.

**Stack:** Next.js **16.3.1** App Router (Turbopack), React **19.2**, TypeScript 5, Prisma **7.9** + `@prisma/adapter-pg` (Postgres), Tailwind **v4**, `lucide-react`, `recharts@3`, `jsonwebtoken`.

**⚠️ Next.js 16 is NOT your training-data Next.** Dynamic `params` is a **Promise** (`const { id } = await params`), `cookies()` is **async** (`await cookies()`). Client pages that read the query string parse `window.location.search` in a **deferred** `useEffect` (see `src/lib/urlTab.ts`), never `useSearchParams` — that would force a Suspense boundary. Before touching route/dynamic-page mechanics, skim `node_modules/next/dist/...` rather than guessing from memory.

**Conventions to match (do not reinvent):**
- Prisma singleton: `import { prisma } from '@/lib/prisma'`. Never `new PrismaClient()`. Run `npx prisma generate` after ANY schema change, and create a migration (`npx prisma migrate dev --name <slug>`).
- Auth cookie is **`auth-token`** (hyphen). Reuse `requireArtisan()` from `src/app/api/artisan/listings/route.ts` for artisan routes; admin routes verify `decoded.role === 'ADMIN'`.
- Money/pricing: `getListingPrice`, `formatRupees`, `estimateCraftValuation` from `@/lib/pricing`. Never hand-roll rupee math or formatting.
- **Theme tokens** in `src/app/globals.css`: `primary #24332C`, mint `var(--color-mint)` `#DCEBE0`, sage `var(--color-sage)`, pill `var(--color-pill)`. Use `bg-primary`, `text-primary`, `bg-[var(--color-mint)]`, `rounded-2xl`, `shadow-card`, `font-serif`, and the `kg-press` / `kg-rail` utilities already in globals. Match the existing look; never introduce raw hex outside the token set.
- i18n: `const { t } = useLanguage()` from `@/lib/translations`. **Every new user-facing string** must be added as a key to **all four** locale files: `src/lib/i18n/en.ts`, `hi.ts`, `or.ts`, `te.ts`. No hardcoded English in JSX.
- Notifications fan-out: `notifyArtisansForDemand(demand)` from `@/lib/notifications`.
- Images in this app are stored as **data URLs / base64** strings in `String[]` columns (see `CaptureModal.tsx` `readAsDataURL`, `CraftItem.images`). Follow the same pattern for any new image field — do NOT add file-upload infra or an S3 bucket.

**Data-model facts you must know (from `prisma/schema.prisma`):**
- **There is no `Order` table. An order IS a `CraftItem`.** Sale/settlement state lives on `CraftItem`: `status`, `salePrice`, `escrowStatus` (`ESCROW_HELD | STAGE1_ADVANCE_PAID_40 | STAGE2_SETTLED_89`), `advanceAmount`, `finalSettlementAmount`, `advancePaid`, `finalPayoutQueued`, `createdAt`.
- `Demand` is currently minimal: `craftType, quantity, targetPriceMin/Max, location, festival, buyerName, notes, status (OPEN|MATCHED|FULFILLED), createdAt`. **Buyers are unauthenticated** — the board at `/buyer` is an open storefront; a demand carries free-text `buyerName`, no user id.
- `Notification`: `userId, type (DEMAND_ALERT|FESTIVAL|SCHEME|SYSTEM), title, message, read, relatedDemandId, channel, accepted, createdAt`.

**Finish gate:** `npm run build` must compile every route with **zero** TypeScript errors, and `npm run lint` must pass. After schema edits run `npx prisma generate`. Do a manual click-through of every screen you touched.

---

# PART A — BUG FIXES

## BUG 1–3 · `next/image` empty-string `src` crash in ProfileEditorModal

**File:** `src/components/ProfileEditorModal.tsx:225` (rendered by `src/app/artisan/dashboard/page.tsx:514`).

**Root cause (confirmed):** `photoUrl` is initialised to `""` (`useState(artisanData?.photoUrl || "")`, line 20; reset to `artisanData.photoUrl || ""` line 41). `<Image src={photoUrl} ... />` then receives an empty string, which Next 16 rejects with *"An empty string was passed to the src attribute"* and, once `photoUrl` is falsy in other paths, *"Image is missing required src property: {}"*. All three console errors are the same defect.

**Fix:**
1. Do not render `<Image>` with a falsy `src`. When `photoUrl` is empty, render a themed placeholder instead (a `bg-[var(--color-mint)]` circle with a `lucide-react` `User` or `Camera` icon in `text-primary`, filling the same `w-24 h-24 rounded-full` frame), and swap to `<Image>` only when `photoUrl` is a non-empty string:
   ```tsx
   {photoUrl ? (
     <Image src={photoUrl} alt="Profile" fill sizes="96px" className="object-cover" />
   ) : (
     <div className="w-full h-full flex items-center justify-center bg-[var(--color-mint)] text-primary">
       <User size={32} />
     </div>
   )}
   ```
2. `photoUrl` here is a **data URL** from `FileReader.readAsDataURL` (see `handlePhotoUpload`, line 201). `next/image` with a `data:` src needs `unoptimized` — add `unoptimized` to this `<Image>` (or use a plain `<img>` for the avatar, which is simpler and avoids the optimizer entirely for user-uploaded base64). Pick one and be consistent. Add `sizes="96px"` to silence the fill-sizing warning either way.
3. **Sweep the codebase for the same defect.** Grep for `<Image` and check every `src` that can be a nullable/DB/data-URL value (`photoUrl`, `images[0]`, `qrVerifiedImageUrl`, etc.). Apply the same "render nothing / render placeholder when falsy" guard wherever an empty string can reach `src`. Report each spot you fixed.

**Acceptance:** Open the artisan dashboard → Edit Profile with no photo set → **zero** console errors; a clean placeholder shows; uploading a photo renders it; saving persists it.

---

## BUG 4 & 6 · Admin tab rail glitches / tab click does not switch

**Files:** `src/lib/urlTab.ts` (`useUrlTab`), `src/components/AdminShell.tsx` (`TabBar`, ~line 94), consumers `src/app/admin/nodal/page.tsx:147` (`impact | audit`) and `src/app/admin/facilitator/page.tsx:140` (`qa | cluster`).

**Symptom:** Clicking the admin rail tabs flickers/"glitches"; sometimes a click does not change the active tab or the panel does not open.

**Diagnose then fix (reproduce first):** Likely contributors, verify each in the running app:
1. **Mount race in `useUrlTab`.** The initial URL read is deferred with `setTimeout(read, 0)`. A click that lands before that macrotask fires calls `select()` (sets state + `replaceState`), and then the pending `read` re-runs and can stomp the tab back — a visible flicker or a "dead" first click. Fix by reading the URL **synchronously on first render** via a `useState` initializer (guard `typeof window !== 'undefined'` for SSR), and drop the `setTimeout` for the initial read; keep only the `popstate` listener for back/forward. Do **not** reintroduce `useSearchParams`.
2. **Stale-closure guard.** Ensure `select` and the `popstate` handler always validate against the current `allowed` list and never set an out-of-range value.
3. **`kg-press` active-state / transform** on the `TabBar` buttons can swallow a tap on touch if it animates layout — confirm the button's `onClick` fires on every press (add a temporary `console.log`, then remove). If the transform is the culprit, scope it so it never blocks the click.
4. Confirm each panel is a **pure conditional render** off `tab` (`{tab === 'impact' ? <A/> : <B/>}`) with no unmount/refetch storm that makes the switch feel like "not opening."

**Acceptance:** On both `/admin/nodal` and `/admin/facilitator`, every tab switches on the **first** click, 10/10 presses, no flicker; deep-linking `?tab=audit` / `?tab=cluster` lands on the right tab with the rail highlighting it; browser back/forward moves between tabs correctly.

---

## BUG 5 · Notification dropdown renders overlapping / stacked text

**Files:** `src/components/NotificationsBell.tsx` (the header dropdown) and `src/app/artisan/notifications/page.tsx` (the full page). See the attached screenshot: notification titles and bodies are superimposed on top of one another instead of stacking as separate rows.

**Diagnose then fix (reproduce first — this must be verified visually):** The list items in `NotificationsBell` are normal-flow `<button>`s with `border-b`, so a persistent overlap points to one of:
1. Two lists painting in the same box (e.g. the full-page notification section bleeding through the dropdown, or `localAlerts` + `items` collapsing) — confirm only one list renders per surface.
2. A broken height/animation: the `animate-fade-in-up` entrance (`.animate-fade-in-up`, keyframe `kg-fade-up` in `globals.css`) leaving a residual `transform`/opacity, or a `max-h-80` scroll container whose children have collapsed height.
3. A stray `absolute`/negative-margin on a row.

Fix so **each notification is a discrete, non-overlapping card** with its own vertical space, the icon, title (truncate), timestamp, message, and channel/accepted chips laid out exactly as the current markup intends. The dropdown must scroll within `max-h-80` when long, never overlap. Apply the same audit to the full `/artisan/notifications` page (calendar section and notifications section must not overlap).

**Acceptance:** Open the bell with ≥3 notifications → every row is separated and legible, matches the screenshot's *intended* (not broken) layout; long lists scroll cleanly; the full notifications page shows the same clean stacking. Re-screenshot to confirm.

---

# PART B — FEATURES

> All three follow the existing theme, i18n, and data conventions from §0. Reference images are stored as data-URL strings (same as `CaptureModal`), never file uploads.

## FEATURE 1 · Reference image + material/colour on buyer demands, with AI matching

**Goal:** A buyer posting a demand can attach a **reference image** of the product they want and describe **material, colour, and free-text specifics**. The AI uses that (image + description) to match the right artisans, and the **artisan sees the image and description before accepting** the demand.

**Schema (`prisma/schema.prisma`, `model Demand`):** add
```prisma
referenceImageUrl String?   // data URL, buyer-supplied reference photo
material          String?   // e.g. "Tussar silk", "Cotton"
color             String?   // e.g. "Deep maroon"
description       String?   // free-text specifics (distinct from `notes`)
matchScore        Float?    // AI confidence when matched, 0–1
```
Migrate + `prisma generate`.

**Post form (`src/components/PostDemandModal.tsx`):**
- Add an image picker (reuse the `readAsDataURL` pattern; cap size, warn if the base64 is very large) with a live thumbnail + remove button, styled to theme.
- Add **Material** and **Colour** inputs and a **Description** textarea. Keep the existing craftType/quantity/price/festival fields.
- Send the new fields to `POST /api/demand`.

**API (`src/app/api/demand/route.ts`):**
- Accept, validate (length caps like the existing `trimmed()` helper; validate the image is a `data:image/...` string and within a sane byte limit), and persist the new fields.
- **AI matching:** extend `/api/demand/match` (`src/app/api/demand/match/route.ts`). It already keyword-matches `CraftItem` rows. Enhance the ranking to also weigh `material` and `color` against each item's `craftType`/`tags`/`descriptionEnglish`. When a `referenceImageUrl` is present and `GEMINI_CONFIGURED` (see `src/lib/gemini.ts`, `generateContentWithFallback`, and the vision pattern in `src/app/api/items/vision-verify/route.ts` — `inlineData` base64), do a Gemini vision pass to score visual similarity and fold it into `matchScore`. **Gracefully degrade** to keyword+material+colour ranking when Gemini is unconfigured or errors (reuse `classifyGeminiError`). Never block or fail the post because AI is down.

**Artisan side (before accept):** wherever the artisan reviews an incoming demand (the demand alert in `NotificationsBell` / `src/app/artisan/notifications/page.tsx`, and any demand-accept surface), render the **reference image thumbnail** (guard falsy `src` per Bug 1) and the **material / colour / description** so the artisan sees exactly what is wanted **before** accepting.

**Acceptance:** Post a demand with an image + "Tussar silk, deep maroon" description → it saves; `/buyer` shows it with the thumbnail; matched artisans see the image and description in their notification/demand view before accepting; with Gemini configured, `matchScore` reflects the reference; with Gemini off, matching still returns sensible keyword+material results and nothing throws.

---

## FEATURE 2 · Buyer order/demand tracking (Amazon/Flipkart-style), single + bulk

**Goal:** A buyer can track a demand through production stages — like an Amazon/Flipkart order timeline — clean and on-theme. Bulk orders show fulfilment **progress and rate** (units/day) as well.

**Model the stages on the existing data (no new Order table):** an order is a `CraftItem`; a bulk demand is a `Demand` fulfilled by many items. Define a canonical stage ladder and derive it from existing fields:
```
PLACED → ACCEPTED → IN_PRODUCTION → QUALITY_CHECK (qrVerified) →
DISPATCHED (escrowStatus STAGE1_ADVANCE_PAID_40 / status) →
DELIVERED (escrowStatus STAGE2_SETTLED_89 / status SOLD_FINAL)
```
Add to `CraftItem` only what the ladder truly can't derive:
```prisma
productionStage String?   // current stage key from the ladder
stageUpdatedAt  DateTime?
```
(and add `estimatedDeliveryAt DateTime?` if you surface an ETA). Migrate + `generate`. Prefer **deriving** stage from `status`/`escrowStatus`/`qrVerified` where possible; only persist `productionStage` when an artisan/admin advances it manually.

**UI — a reusable `OrderTimeline` component** (`src/components/ui/OrderTimeline.tsx`) built on the existing `ProgressStepper`/`ProgressBar` primitives:
- Horizontal (desktop) / vertical (mobile) stepper: filled `bg-primary` nodes for completed stages, mint for the current, muted for pending; each with a `lucide-react` icon, label (i18n), and timestamp. `rounded-2xl`, `shadow-card`, fully responsive.
- **Single order:** the ladder with the active stage highlighted.
- **Bulk order:** a fulfilment bar — `X of N units`, a `ProgressBar`, and a computed **rate** (units/day since `ACCEPTED`) plus a simple projected-completion line. Keep it calm and clean, not busy.

**Where it lives:** on `/buyer` (`src/app/buyer/page.tsx`), give each of the buyer's own demands (matched by `buyerName`, as the page already does) a "Track" view that renders `OrderTimeline`. Add a lightweight read endpoint (e.g. `GET /api/demand/track?demandId=` or extend `/api/demand/match`) that returns, per demand, the fulfilling item(s) and their derived stage(s), quantity fulfilled vs requested, and rate. Public/unauth like the rest of the buyer board.

**Acceptance:** A buyer opens a demand → sees a clean staged timeline with real stage + timestamps; a bulk demand shows `X/N`, a progress bar, and a units/day rate; the artisan/admin advancing an item moves the buyer's timeline forward; theme-consistent and responsive on a 360px screen.

---

## FEATURE 3 · Artisan earnings analytics — charts + before/after Karigari comparison

**Goal:** In the artisan **Earnings** page (`src/app/artisan/earnings/page.tsx`), add analytical visualisations using **`recharts`** (already installed): a **pie chart** of the earnings breakdown, a **bar graph** of monthly sales, and a **contrast comparison** of earnings **before vs. after using KARIGARI**. Data is tallied **monthly**, with the **overall lump-sum** total shown on the page.

**Data source:** the page already loads `/api/artisan/dashboard` (see `DashboardPayload` / `recentCaptures`). Do the tallying from settled rows there:
- **Monthly series:** group `recentCaptures` by `createdAt` month; per month sum the realised amount (`salePrice ?? getListingPrice(item)`), for settled/sold statuses only (mirror the existing `activityChip` status logic — never count an AI valuation as money received). If the dashboard payload doesn't already expose enough history, extend `src/app/api/artisan/dashboard/route.ts` to return a `monthlyEarnings: { month: string; amount: number; units: number }[]` array (last 12 months) computed server-side — cleaner than re-deriving on the client.
- **Before/after KARIGARI baseline:** use the artisan's self-reported pre-app income as the "before" line. `ArtisanProfile.annualIncome` exists; convert to a monthly baseline (`annualIncome / 12`) and compare against realised monthly KARIGARI earnings. If `annualIncome` is null, fall back to a benchmark from `src/lib/benchmarkData.ts` and clearly label it an estimate. Surface the uplift (e.g. "+X% vs. before KARIGARI") honestly — no invented numbers.

**Charts (recharts, theme-coloured — `primary`, mint, sage; accessible in light/dark; responsive `ResponsiveContainer`):**
1. **Pie:** earnings composition — advances received vs. final settlements cleared vs. pending payout (from the dashboard totals `advancesReceived`, `finalSettlementsCleared`, etc.).
2. **Bar:** monthly KARIGARI sales (last 12 months), rupee axis via `formatRupees`.
3. **Comparison:** grouped bar or dual line — "before KARIGARI" baseline vs. "with KARIGARI" per month, with the lump-sum total and % uplift called out in a `StatTile`/`Card` header.

Follow the `dataviz` conventions if that skill is available. Tooltips format rupees with `formatRupees`. Keep the page's existing structure; add a clearly-labelled **Analytics** section. Add all new labels to the four i18n files.

**Acceptance:** Earnings page shows a pie, a monthly bar, and a before/after comparison; figures reconcile with the existing totals on the page (no double counting); the overall lump-sum and the uplift vs. pre-app income are shown; charts are on-theme, responsive, and readable; empty/low-data artisans get a graceful "not enough data yet" state instead of broken charts.

---

## FINAL CHECKLIST (do not report done until all pass)

- [ ] `npm run build` — zero TS errors, all routes compile (Turbopack).
- [ ] `npm run lint` — clean.
- [ ] `npx prisma generate` run after every schema change; migrations created.
- [ ] Bugs 1–3: no `next/image` empty-`src` console errors anywhere (swept, not just ProfileEditorModal).
- [ ] Bugs 4 & 6: admin tabs switch on first click, no flicker, deep-link + back/forward correct.
- [ ] Bug 5: notification dropdown and page render discrete, non-overlapping rows (re-screenshotted).
- [ ] Feature 1: demand image + material/colour + description post, persist, show to artisan pre-accept; AI match with graceful degradation.
- [ ] Feature 2: single + bulk tracking timeline on `/buyer`, real stages, bulk rate.
- [ ] Feature 3: pie + monthly bar + before/after comparison + lump-sum, reconciled with existing totals.
- [ ] Every new string added to `en / hi / or / te`. No hardcoded English.
- [ ] Theme, spacing, and responsiveness match the rest of the app on a 360px viewport.
- [ ] Report, per item: files changed, root cause (bugs), and how you verified.
