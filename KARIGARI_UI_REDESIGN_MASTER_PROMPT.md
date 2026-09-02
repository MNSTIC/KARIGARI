# MASTER PROMPT — KARIGARI full UI redesign (reference-driven), smooth + responsive

> Paste into **Claude Code** AND **attach all 13 reference screenshots** in the same message. The images are the visual source of truth for look & feel; this doc is the spec + file map. App root: **`KARIGARI-main/KARIGARI/`** — `cd` there. Next.js 16 App Router, React 19, TS, Tailwind v4, Prisma 7 (Supabase). Keep the build green: run `npm run build` at the end (zero TS errors).

## ⚠️ THE ONE RULE ABOVE ALL: real data, never the mockups' data
The screenshots are for **theme, layout, spacing, typography, and component style ONLY**. **Ignore every value shown in them.** They contain placeholder/foreign data — `$450 USD`, "Andean Weave #42", "Oct 2023", "Anaya R.", USD prices. Your app is **INR and real Indian crafts**. Every screen must render the app's **actual data** from the existing APIs/DB (the 6 seeded artisans, their real CraftItems, real ₹ prices, real schemes/news/insights). Do not hardcode any mock content from the images. If a section has no real data yet, show a proper empty state — never fake rows.

## Provider/data note
Do NOT change any API, business logic, escrow, auth, or data model. This is a **presentation-layer redesign**: restyle the pages and add a shared shell, keep every fetch and data shape exactly as-is. Reuse `formatRupees` from `@/lib/pricing` for all money (and keep prices in the **sans** font — Playfair lacks the ₹ glyph, which is why ₹ can render as "?"). Keep `useLanguage()` i18n working on every restyled string.

---

## 1. DESIGN SYSTEM (formalize what's already in `src/app/globals.css`)
Your tokens already match the references — use them, don't invent new hex:
- **Canvas** `--color-background #FCF8F7` (warm cream). **Cards** `--color-card #FFFFFF`, `rounded-2xl`/`rounded-3xl`, `shadow-card`/`shadow-soft`, hairline `border-gray-100/200`.
- **Primary** `#24332C` (dark forest green): primary buttons, the big featured action card, active nav item, the circular header bell + avatar, filled pills. `primary-dark #1A2721` for hover. `primary-light #3D5145`.
- **Accents**: `mint #DCEBE0` / `sage #A9BFB0` soft-green chips; `yellow/orange` ramp for "VERIFYING"/warning/amber toggles; muted `red` ramp for alerts; the `stat-*` tokens for stat-card icon chips.
- **Type**: `font-serif` (Playfair) for display headings and big numbers (page titles "My Crafts", "Craft Details", stat figures); `font-sans` (Inter) for body; **small UPPERCASE letter-spaced labels** for section headers ("QUICK ACTIONS", "OVERVIEW", "TECHNIQUE MASTERY", "GLOBAL TREND REPORTS"). Match the reference's type hierarchy exactly.
- **Spacing/rhythm**: generous padding (p-5/p-6/p-8), 16–24px gaps, roomy cards, lots of breathing room like the mockups.
- Add reusable primitives (create `src/components/ui/`): `Card`, `SectionLabel` (uppercase tracked), `Pill`/`Badge` (status variants: minted=green, verifying=amber, sold=neutral, new=mint, deadline=red), `StatTile` (icon chip + label + serif number + delta), `SegmentedToggle` (the Master/Standard, Restock/Bulk Buy two-button control), `ProgressBar`, and `PageHeader`. Build pages FROM these so every screen is visually consistent.

## 2. SHARED SHELL — persistent bottom nav (mobile) → sidebar (desktop)
The biggest structural change. Add a **persistent navigation shell** in `src/app/artisan/layout.tsx` (it already wraps every artisan page and guards auth — extend it, keep the auth logic and `VoiceOnboarding`).
- **Mobile (< md):** a fixed **bottom tab bar** exactly like the references — icons + tiny labels, active tab in dark green, safe-area padding, subtle press animation. Tabs: **Home** (`/artisan/dashboard`), **Crafts** (`/artisan/market`), **Insights** (`/artisan/insights`), **Hub** (the AI Hub → `/artisan/news` or a new `/artisan/hub`, your call — see §3g), **Profile** (opens the profile editor / a profile route). Keep it to 5 items max; put Schemes, Materials, Earnings, Marketing on the Home dashboard as quick-action tiles and/or a "More" sheet so the bar stays clean. Ensure page content has bottom padding so the bar never overlaps.
- **Desktop (≥ md):** the same nav becomes a **left sidebar** (icons + labels, logo at top), content in a max-width column on the cream canvas. Same theme, no separate design — just responsive reflow, per the wide reference screenshots.
- **Header** (shared, sticky): serif wordmark left; right = dark-green circular **bell** (opens notifications) + circular **avatar** (uses the `Avatar` component; default initials avatar when no photo). Keep it consistent across all artisan pages (move the per-page headers into the shell where possible).
- The **floating mic button** (voice) stays bottom-right above the bottom nav, as in the dashboard reference.

## 3. PAGE-BY-PAGE RESTYLE (map each reference → each file; keep the data)
For each, restyle to match the corresponding screenshot while rendering real data:
- **(a) Artisan Dashboard — `src/app/artisan/dashboard/page.tsx`** (ref: "KARIGARI" home): identity card (avatar, name, cluster, Artisan Trust Health bar), **QUICK ACTIONS** grid = one big dark-green "Capture New Craft" featured card + smaller white tiles (Schemes, Insights, Raw Materials, Learn with AI, Live News, Influencer Marketing) — keep them symmetric & non-overlapping at every breakpoint; **OVERVIEW** = 2×2 StatTiles (My Captures / Advances Received / Items Sold / Total Earnings) with real ₹ values + deltas; floating mic.
- **(b) My Crafts — `src/app/artisan/market/page.tsx`** (ref: "My Crafts"): **pill filter tabs** ALL / (map to real statuses) LIVE / VERIFYING / SELLABLE / SOLD; large craft cards = image + status badge overlay + serif title + batch/material meta + Fair Wage Floor (₹) + Market Risk pill. Real listings only.
- **(c) Craft Details — the details/passport view** (`src/app/verify/[patchId]/VerificationClient.tsx` and the dashboard `DetailsModal`, and `src/app/marketplace/product/[id]/ProductClient.tsx`): hero image + VERIFIED badge; **Fair Value Ledger** card (Fair Wage Floor bar, Market Price Band with the slider marker, Authenticity star score); **Maker's Journey** narrative (the real AI description) + the two process thumbnails (use the QR-patch/verification images where present); bottom action bar (Edit Listing / Share Story). All ₹, real values.
- **(d) Earnings** (ref: "Earnings" screen): style the artisan earnings view (currently in the dashboard's earnings tracker / a new `/artisan/earnings`) — big **Total Balance** (₹), Request Advance, **Fair Wage Index** gauge, **Recent Activity** list with real +/- settlement rows and status chips (Settled/Processing/Deducted). Real escrow/settlement data.
- **(e) Market Insights — `src/app/artisan/insights/page.tsx`** (ref: "Market Insights"): Global Market Pulse header (+YoY, top category), Demand Heatmap (keep the existing map component), **Price Benchmarking** card with the Master/Standard `SegmentedToggle` and real ₹ bands, Seasonal Forecasts list. Move the standalone "List on ONDC" + "Export to Government" buttons in cleanly.
- **(f) Live News — `src/app/artisan/news/page.tsx`** (ref: "Live News & Community"): Local Fairs & Events horizontal cards, Global Craft News list rows (thumbnail + category tag + timestamp), Artisan Spotlights image cards. Real news from the existing Groq/RSS pipeline. **Recolor the news icon red** (per your earlier ask) consistently.
- **(g) AI Hub — Learn** (ref: "Karigari AI Hub"): style the Learn-with-AI surface as the Hub — a "Karigari AI Hub" header card, **Technique Mastery** horizontal-scroll video cards (play button + duration, from the real Learn-with-AI/YouTube results), **Global Trend Reports** card with palette swatches, **Business Literacy** module list. Wire the existing `LearningAssistantModal` chat behind it.
- **(h) Schemes — `src/app/artisan/schemes/page.tsx`** (ref: "Schemes"): "My Applications" progress-timeline card (real application steps), dark "Check Eligibility" card, Available Schemes list with NEW / DEADLINE PASSED badges. Real scheme data.
- **(i) Material Hub — `src/app/artisan/materials/page.tsx`** (ref: "Material Hub"): hero banner, Restock/Bulk Buy `SegmentedToggle`, Verified Suppliers list, Bulk Buying Groups progress card, Quality Guides. Real materials data from the Groq route.
- **(j) Influencer Marketing — `src/app/artisan/marketing/page.tsx`** (ref: "Influencer Marketing"): keep the opt-in toggle card + creator cards + Draft outreach (already built) — just align to the new card/typography system.
- **(k) Landing `src/app/page.tsx` + Marketplace `src/app/marketplace/page.tsx` + Creators `src/app/creators/page.tsx`**: apply the same visual language (serif display, cream canvas, green cards, rounded cards, soft shadows) so the public pages match. Desktop uses the same theme, responsive.

## 4. ANIMATIONS — minimal, tasteful, performant (do NOT overdo)
- **No heavy animation library.** Use CSS only (transitions + `@keyframes` in `globals.css`) to keep the bundle small and rendering fast. Optional: `@formkit/auto-animate` (~3KB) for list add/remove and tab-content swaps — allowed; framer-motion is NOT (too heavy for this goal).
- Add: gentle **page/section fade-up on mount** (stagger cards ~40–60ms via `animation-delay`, use an IntersectionObserver or CSS so off-screen work is cheap), **hover lift** on cards (`-translate-y-1`, shadow grow — already the pattern), **active-tab press** scale, smooth `bottom-nav` indicator slide, skeleton shimmer while loading, and micro-transitions on toggles/pills. Keep durations 150–300ms, ease-out. Respect `prefers-reduced-motion` (disable non-essential motion). Nothing bouncy or attention-grabbing — calm and premium, matching the editorial feel.

## 5. PERFORMANCE — make it butter-smooth (required, not optional)
- Reuse the earlier wins: memoized `t`/`changeLanguage` in `useLanguage`; list endpoints select narrow (no base64 in lists); images compressed; details/heavy data loaded on demand. Do not regress these.
- Lazy-load heavy/below-the-fold pieces with `next/dynamic` (modals, the demand map, charts). Add `loading.tsx` skeletons for every artisan route (styled in the new theme) so navigation feels instant.
- Images: `next/image` for `/public` and static assets with correct `sizes`; plain `<img>`/`unoptimized` for base64/data URLs; fixed aspect containers to kill layout shift. Use `content-visibility:auto` on long lists.
- Avoid re-render loops (correct effect deps), keep the bottom nav/shell in the layout so it doesn't remount per navigation, and use route-group loading so tab switches are snappy.
- After building, verify no unnecessary re-fetching and no jank on scroll/tab-switch.

## 6. RESPONSIVENESS
Mobile-first, matching the portrait references; then reflow up. No horizontal overflow at 360px; tap targets ≥44px; grids reflow 1→2→3/4 cols; the bottom nav becomes a sidebar at `md`; wide screens use a centered max-width column on the cream canvas (per the wide screenshots). Test 360px, 768px, 1280px.

---

## VERIFICATION CHECKLIST
1. `npm run build` green; no TS errors; no console errors at runtime.
2. Every screen matches its reference's **theme/layout** but shows **real app data in ₹** — zero mockup values leak in; ₹ renders correctly (sans font).
3. Persistent bottom nav on mobile / sidebar on desktop works across all artisan pages; header bell + avatar consistent; mic floats correctly.
4. All existing features still work (capture, escrow, syndication, schemes, news, insights, marketing, notifications) — logic untouched, only presentation changed.
5. Animations are subtle, consistent, honor `prefers-reduced-motion`; no bundle bloat (no framer-motion).
6. Butter-smooth: instant skeletons on navigation, no scroll jank, no layout shift, no re-render loops.
7. Fully responsive at 360/768/1280; i18n intact.
8. End with a summary: shared components created, files restyled, any deps added, and commands run.

### FILE MAP
**Create:** `src/components/ui/{Card,SectionLabel,Badge,StatTile,SegmentedToggle,ProgressBar,PageHeader,BottomNav,AppShell}.tsx`, `src/app/artisan/*/loading.tsx` skeletons, optionally `src/app/artisan/hub/page.tsx` and `src/app/artisan/earnings/page.tsx`, new `@keyframes` in `src/app/globals.css`.
**Edit:** `src/app/artisan/layout.tsx` (nav shell), `src/app/artisan/dashboard/page.tsx`, `src/app/artisan/market/page.tsx`, `src/app/artisan/insights/page.tsx`, `src/app/artisan/news/page.tsx`, `src/app/artisan/schemes/page.tsx`, `src/app/artisan/materials/page.tsx`, `src/app/artisan/marketing/page.tsx`, `src/app/artisan/notifications/page.tsx`, `src/app/verify/[patchId]/VerificationClient.tsx`, `src/app/marketplace/page.tsx`, `src/app/marketplace/product/[id]/ProductClient.tsx`, `src/app/page.tsx`, `src/app/creators/page.tsx`, `src/app/globals.css`.
**Do not touch:** any `/api/*` route, Prisma schema, escrow/auth/AI logic, data shapes — presentation only.
```
```
