# MASTER PROMPT — Offline PWA capture + Creator/Influencer Affiliate Engine

> Paste into **Claude Code** (it has the repo). Two big features plus an error/responsive pass. Keep the build green and the green heritage theme. App root: **`KARIGARI-main/KARIGARI/`** — `cd` there. Next.js **16.3.1** App Router, React 19, TS, Prisma 7 (`@prisma/adapter-pg`, Supabase Postgres), Tailwind v4, deployed on Vercel.

**Provider policy (unchanged):** capture/draft parsing = Gemini; Whisper = Groq; Raw Materials / Live News / Learn-with-AI / affiliate outreach = **Groq** (`@/lib/groq` → `groqChatJSON`). After changes run `npm run build` (zero TS errors). Schema changes need `npx prisma db push` against Supabase — add only nullable/defaulted columns and new tables (safe on the live DB).

**Key facts I already verified in the repo, use them:**
- PWA is wired via `@ducanh2912/next-pwa` in `next.config.ts` (`dest:"public"`, `register:true`, `disable` in dev). A manifest exists at `public/manifest.json` (icons at `/icons/karigari-logo.png`). **The manifest is NOT linked in `src/app/layout.tsx` `metadata`, and there are no apple/theme-color/viewport tags** — installability is incomplete. No IndexedDB/offline queue exists yet (`CaptureModal.tsx` only checks `navigator.onLine` for audio).
- There is **no `Order` model** — an order lives on `CraftItem` (escrow fields, `salePrice`, `status`). Do not invent an Order table; attach affiliate fields to `CraftItem`.
- Escrow math is centralized in `@/lib/escrow`: `ADVANCE_RATE=0.4`, `FINAL_SETTLEMENT_RATE=0.4936`, `PLATFORM_FEE_RATE=0.035`, helpers `advanceFor/finalSettlementFor/platformFeeFor`, statuses `ESCROW_HELD → STAGE1_ADVANCE_PAID_40 → STAGE2_SETTLED_89`. Checkout = `src/app/api/payments/create-checkout/route.ts`; settlement = `src/app/api/payments/settle-escrow/route.ts` (DELIVERED branch is where creator payout goes).
- Storefront buy flow: `src/app/marketplace/product/[id]/ProductClient.tsx` `buyNow()` POSTs `{craftItemId}` to create-checkout and reads the URL via `window.location.search` (no `useSearchParams`, to avoid a Suspense boundary — follow that pattern for `?ref=`).
- Landing nav already uses `t('nav_home')`, `t('nav_buyer')`, etc. in `src/app/page.tsx`. Dashboard quick-actions are a 6-tile grid at `src/app/artisan/dashboard/page.tsx` (~line 266, `grid-cols-1 md:grid-cols-3 lg:grid-cols-[1.5fr_1fr_1fr]`). i18n lives in `src/lib/i18n/{en,hi,or,te}.ts`. Platform icons already exist in `public/icons/`.

---

# FEATURE 1 — Offline-first PWA (install + offline capture + background sync)

Goal: an artisan loads the app once online (installs to home screen), and can later launch and **capture drafts with zero network**; queued items flush automatically when connectivity returns.

## 1.1 Make it installable & offline-capable
- **`src/app/layout.tsx`**: add PWA metadata so the manifest and icons are actually linked. In the `metadata` export add `manifest: "/manifest.json"`, `themeColor: "#24332C"` (use `viewport`/`themeColor` per Next 16 — put `themeColor` in a `viewport` export if the build requires it), `appleWebApp: { capable: true, statusBarStyle: "default", title: "Karigari" }`, and apple-touch-icon. Align `manifest.json` `theme_color` to the heritage `#24332C` and confirm the icon files exist (add PNG 192/512 if missing).
- **`next.config.ts`** (`@ducanh2912/next-pwa`): enable real offline behavior — `cacheOnFrontEndNav: true`, `aggressiveFrontEndNavCaching: true`, `reloadOnOnline: true`, and a **document fallback** so a cold offline launch serves the app shell instead of the browser's offline error. Add `workboxOptions.runtimeCaching` for: the app shell/navigation (NetworkFirst with a cache fallback), static assets (StaleWhileRevalidate), and Google Fonts. Create an offline fallback page `src/app/~offline/page.tsx` (or the library's `fallbacks: { document: "/offline" }` + `src/app/offline/page.tsx`) in the heritage theme. Keep `disable: process.env.NODE_ENV === "development"` (SW only in prod build) — so **test offline on the Vercel deployment, not `next dev`**.

## 1.2 Offline capture queue (IndexedDB + background sync)
- Add a tiny IndexedDB helper `src/lib/offlineQueue.ts` (use the `idb` package — `npm i idb` — or raw IndexedDB). API: `queueCapture(payload)`, `listQueued()`, `removeQueued(id)`, `countQueued()`. Store the exact `/api/items/capture` POST body (craftType, laborDays, rawMaterialCost, descriptions, tags, **compressed** images, askingPrice) plus a local id + createdAt.
- **`src/components/CaptureModal.tsx`** `handleSaveUpload`: before POSTing, check `navigator.onLine`. If **offline**, write the payload to the IndexedDB queue instead of calling the API, jump to the success step, and surface a clear indicator: a cloud-with-slash icon + **"1 item saved to your phone — will upload when you're online"** (pluralize from `countQueued()`). If **online**, POST as today.
- **Flush logic** `src/lib/offlineSync.ts` + a mount-level hook (e.g. in `src/app/artisan/dashboard/page.tsx` or a small client provider in `layout`): register a Background Sync tag when supported (`serviceWorker.ready → sync.register('karigari-capture-sync')`) **and** — because Background Sync is Chromium-only — also flush on the `window 'online'` event and on app load: read the queue, POST each to `/api/items/capture`, `removeQueued` on success, and refresh the dashboard. Show a small "Syncing N saved items…" toast, then "All items uploaded".
- **UI indicator**: a persistent, unobtrusive **offline/queue badge** in the artisan header (online = nothing or a subtle dot; offline = "Offline — N saved on phone"). Drive it off `navigator.onLine` + `online`/`offline` listeners + `countQueued()`.
- Honesty: images are stored compressed (reuse `downscaleImage` from `@/lib/imageEnhance`) so the IndexedDB payload stays small; the queue is per-device and clears as it uploads.

## 1.3 Verify offline
On the Vercel prod build: load once online → install to home screen → turn off network → relaunch (app shell loads, no dinosaur) → capture a draft (saves to phone, badge shows count) → go online (queue auto-flushes, item appears on the dashboard/marketplace).

---

# FEATURE 2 — Creator / Influencer Micro-Affiliate Engine

Artisans opt into promotion; local creators register, get a unique `?ref=<handle>` link, and earn a **5% commission paid directly to their UPI at delivery** (non-custodial, exactly like the artisan payout). Build **UI first**, then wire the tracking + payout.

## 2.1 Schema (`prisma/schema.prisma`) — new tables + affiliate fields on CraftItem
```prisma
model Creator {
  id            String   @id @default(uuid())
  name          String
  handle        String   @unique          // "shreya_styles"
  platform      String   @default("INSTAGRAM") // INSTAGRAM | YOUTUBE | NIFT_STUDENT
  profileUrl    String?
  photoUrl      String?
  nicheCategory String                     // "Handloom Sarees" | "Tribal Jewelry" | ...
  location      String?
  upiId         String                     // direct VPA for the 5% payout
  bio           String?
  totalClicks   Int      @default(0)
  totalSales    Int      @default(0)
  earningsTotal Float    @default(0)
  status        String   @default("ACTIVE")
  createdAt     DateTime @default(now())
  clicks        AffiliateClick[]
  @@index([handle])
  @@index([nicheCategory])
}
model AffiliateClick {
  id          String   @id @default(uuid())
  creatorId   String
  creator     Creator  @relation(fields: [creatorId], references: [id])
  craftItemId String?
  ipHash      String?
  createdAt   DateTime @default(now())
  @@index([creatorId])
  @@index([createdAt])
}
```
On `CraftItem` add (nullable): `affiliateCreatorId String?`, `affiliateHandle String?`, `affiliateCommission Float?` (the 5% amount, set at checkout, paid at delivery). Run `npx prisma db push`.

## 2.2 Economics (keep totals sane, document it)
When an item is bought through a creator link, at **delivery** pay the creator **5%** of gross **directly to their UPI**, alongside the artisan's settlement. Add `CREATOR_RATE = 0.05` to `@/lib/escrow`. Keep the artisan's total generous (~84–85%) by taking the 5% from the platform-side portion, not from the artisan's advance — document the split in a comment so it always sums to ≤100% (artisan ≈84.36%, creator 5%, platform 3.5%, logistics remainder). Never reduce the 40% dispatch advance.

## 2.3 Backend APIs (new)
- `POST /api/creators/register` — `{name, handle, platform, nicheCategory, upiId, profileUrl?, photoUrl?, location?, bio?}` → creates a `Creator` (handle unique, slugified), returns `{success, handle, affiliateUrlTemplate: ".../marketplace?ref=<handle>", creatorId}`. Validate handle uniqueness with a friendly error.
- `GET /api/creators` — list active creators (name, handle, platform, niche, photo, totals) for the public portal + the artisan discovery tab; support `?niche=` and `?location=` filters.
- `POST /api/creators/track` — `{handle, craftItemId?}` → find creator, increment `totalClicks`, insert an `AffiliateClick` (hash the IP, never store raw), return `{ok:true}`. Idempotent-ish (don't hard-fail on unknown handle — just no-op).
- `GET /api/creators/stats?handle=` — aggregated real metrics from the DB (`totalClicks`, `totalSales`, gross volume, `earningsTotal`, `payoutUpi`).
- `POST /api/creators/match-outreach` — **Groq** (`groqChatJSON`, honest, JSON-only): given a creator + an artisan/craft, return `{matchScore, personalizedDm, targetHashtags[]}` for a collaboration message. Label it as an AI-drafted suggestion in the UI. (This is a helper for artisans/admins, not an auto-sender — no DMs are actually sent.)

## 2.4 Attribution through checkout → creator payout
- **`ProductClient.tsx`** (and `src/app/marketplace/page.tsx`): read `?ref=<handle>` from `window.location.search` on mount; persist it (e.g. `sessionStorage` `karigari_ref`) so it survives navigation to the product page. On page view with a ref, call `POST /api/creators/track`. Pass `ref` in the `buyNow()` body to create-checkout.
- **`create-checkout/route.ts`**: accept optional `ref`; if it resolves to a Creator, set `affiliateCreatorId`, `affiliateHandle`, and precompute `affiliateCommission = round(price * CREATOR_RATE)` on the item, and put `ref` in Stripe metadata. Artisan payout logic is unchanged.
- **`settle-escrow/route.ts`** DELIVERED branch: if the item has an `affiliateCreatorId`, in the SAME `$transaction` that settles the artisan, also "pay" the creator their `affiliateCommission` **directly to the creator's UPI** (programmatic settlement, same honesty framing as the artisan payout — Stripe test mode, real rails not wired), bump `Creator.totalSales`/`earningsTotal`, and write an immutable `logCraftItemEvent({ action: "AFFILIATE_COMMISSION_PAID", actorId: "SMART_ESCROW_ENGINE", actorRole: "SYSTEM", newState: { handle, amount } })`. No admin ever touches it.

## 2.5 Frontend — UI FIRST, all responsive & theme-consistent

**(a) Landing nav — replace "Home" with "Creator Affiliation".** In `src/app/page.tsx`, change the first nav link from `t('nav_home')` → a new `t('nav_creator_affiliation')` label linking to `/creators` (keep the rest: Buyer, Marketplace, For Artisans, For Admins). Add the i18n key in all four `src/lib/i18n/*.ts`.

**(b) Public Creator portal `src/app/creators/page.tsx`** (new, `"use client"`):
- Hero: *"Earn 5% promoting verified Indian heritage — 0% middlemen."*
- **Creators showcase grid**: all creators from `GET /api/creators` — photo/avatar (reuse the `Avatar` component), name, `@handle`, platform icon, niche, and their totals (clicks/sales). Filter by niche/location.
- **"Register as a Creator" form**: name, handle, platform (Instagram/YouTube/NIFT student), niche, location, UPI, profile URL, optional photo (compress via `downscaleImage`). POSTs `/api/creators/register`; on success show their **affiliate link** with 1-click copy and a mini live stats panel (from `/api/creators/stats`).
- Fully responsive (cards reflow 1→2→3 cols), heritage theme.

**(c) Artisan dashboard quick-action tile.** In `src/app/artisan/dashboard/page.tsx`, add a **7th** quick-action card **"Influencer Marketing & Advertisement"** (icon e.g. `Megaphone`/`Users`) linking to `/artisan/marketing`. Keep the grid **symmetric and non-overlapping**: with 7 tiles the last row is uneven, so either make this tile span two columns as a featured card, or adjust the grid so rows stay balanced at each breakpoint (test md and lg). Match the existing tile styling exactly (`rounded-3xl p-8 min-h-[160px]`, hover lift).

**(d) Artisan marketing tab `src/app/artisan/marketing/page.tsx`** (new):
- A master **opt-in toggle**: "Enable influencer promotion for my listings" (persist on the artisan profile — add a nullable `promotionOptIn Boolean @default(false)` to `ArtisanProfile`, or store per-item; profile-level is simplest).
- When opted in: **nearby creators list** from `GET /api/creators?niche=<their craft family>&location=<their state>` with each creator's card + a **"Draft outreach message"** button that calls `/api/creators/match-outreach` and shows the AI-drafted collaboration DM + hashtags (copyable). Show which of the artisan's listings already have affiliate sales.
- Responsive, theme-consistent, clear empty states.

**(e) Endorsement badge on the digital passport.** In `src/app/verify/[patchId]/VerificationClient.tsx`, when the page is reached with `?ref=<handle>`, render the amber "Curated & Recommended by @handle" badge (as in the reference) above the fold. Read the ref from the URL (client), keep it accessible.

---

# FEATURE 3 — Error sweep + responsiveness

- After building the above, run `npm run build` and fix every TS/lint error introduced. Grep for `params`/`cookies()` async usage in any new route (Next 16). Ensure all new API routes use `export const dynamic = 'force-dynamic'`, the `@/lib/prisma` singleton, and consistent auth (`auth-token` cookie).
- Responsive pass on the **new** surfaces (creators portal, marketing tab, dashboard grid with the 7th tile) and re-check existing pages the changes touch: no horizontal overflow at 360px width, tap targets ≥44px, grids reflow, the quick-actions grid stays symmetric at sm/md/lg. Use the heritage tokens (`primary #24332C`, mint, sage, `rounded-2xl`, `shadow-card`).

---

## VERIFICATION CHECKLIST
1. `npm run build` green; `npx prisma db push` applied `Creator`, `AffiliateClick`, and the new `CraftItem`/`ArtisanProfile` columns to Supabase; `npm i idb` (and any deps) recorded in `package.json`.
2. PWA: on the Vercel deployment, the app installs to home screen; offline relaunch loads the shell (no browser error); an offline capture saves to the phone with a visible "N saved" badge; reconnecting auto-uploads the queue and the item appears.
3. Landing nav shows **Creator Affiliation** (not Home) → `/creators`; the portal lists creators and registration returns a working `?ref=` link with live stats.
4. Dashboard has a clean, symmetric **Influencer Marketing & Advertisement** tile → `/artisan/marketing`, where opt-in reveals nearby creators + AI-drafted outreach.
5. Buying via `.../marketplace?ref=<handle>` (then a product) logs a click, and on DELIVERED settlement the creator's 5% is paid directly to their UPI (audit log `AFFILIATE_COMMISSION_PAID`) while the artisan still gets ~84%+ — totals ≤100%, 40% dispatch advance untouched.
6. Passport shows the endorsement badge when arrived via `?ref=`.
7. No new console/build errors; new UI responsive down to 360px. End with a summary: files created/edited, schema/env/deps changes, and the exact commands run.

### FILE MAP
**Create:** `src/lib/offlineQueue.ts`, `src/lib/offlineSync.ts`, `src/app/offline/page.tsx`, `src/app/creators/page.tsx`, `src/app/artisan/marketing/page.tsx`, `src/app/api/creators/register/route.ts`, `src/app/api/creators/route.ts`, `src/app/api/creators/track/route.ts`, `src/app/api/creators/stats/route.ts`, `src/app/api/creators/match-outreach/route.ts`.
**Edit:** `next.config.ts` (PWA offline options), `public/manifest.json` (theme color), `src/app/layout.tsx` (manifest + apple/theme/viewport metadata), `src/components/CaptureModal.tsx` (offline queue on submit + indicator), `src/app/artisan/dashboard/page.tsx` (7th quick-action tile + offline badge + sync-on-mount), `src/app/page.tsx` (Home → Creator Affiliation), `prisma/schema.prisma` (Creator/AffiliateClick + CraftItem/ArtisanProfile fields), `src/lib/escrow.ts` (CREATOR_RATE), `src/app/api/payments/create-checkout/route.ts` (ref attribution), `src/app/api/payments/settle-escrow/route.ts` (5% creator payout at delivery), `src/app/marketplace/product/[id]/ProductClient.tsx` + `src/app/marketplace/page.tsx` (capture `?ref=`, track, pass to checkout), `src/app/verify/[patchId]/VerificationClient.tsx` (endorsement badge), `src/lib/i18n/{en,hi,or,te}.ts` (new nav + labels).
**Do not touch:** the working escrow/artisan-payout rates (only ADD the creator split from the platform side), the Groq model chain, attach-verify/syndication flows.
