# MASTER PROMPT — Build the KARIGARI Admin Dashboard (single admin, two dashboards)

> Paste this whole file into Claude Code as your task. It is self-contained. Follow it top to bottom.

---

## 0. ROLE & MISSION

You are a principal full-stack engineer working on **KARIGARI**, an SIH 2026 (MoSJE, Problem Statement 26090) prototype: an AI Fairness/Trust protocol for marginalized handloom artisans. Your single mission is to **build the Admin Dashboard as specified in `new_admin.md`** — an oversight system that proves the platform's AI (Voice Cataloger + Dynamic Pricing) works safely in the real world.

The spec file is the source of truth: **read `new_admin.md` in the project root first and implement every feature in it.** This prompt tells you *where* everything lives and *how* to build it so it matches the existing codebase.

**Structural decision (already made — follow exactly): there is ONE admin.** A single `ADMIN` role and login opens **two admin dashboards**:
- **`/admin/facilitator`** — the Field Facilitator view (Tier 1 in `new_admin.md`).
- **`/admin/nodal`** — the Central Nodal Officer view (Tier 2 in `new_admin.md`).

The same admin can open both and switch between them from the sidebar. **There is no "Local Admin" and no "Super Admin."** Those old roles/pages must be **deleted completely** (see §4). Do not create `FACILITATOR` or `NODAL_OFFICER` as separate roles — they are just the two dashboards, both accessed by the one `ADMIN` role.

Non-negotiable quality bar: every feature must be **dynamic (real DB data, no hard-coded fake numbers), working end-to-end, and smoothly rendered.** This is demo-day software judged live.

---

## 1. WHERE THE CODE IS (read carefully — there is a nested folder)

The connected folder is `KARIGARI-main`, but **the actual Next.js app lives one level down** in `KARIGARI-main/KARIGARI/`. All paths below are relative to that inner app root:

```
KARIGARI-main/
  package-lock.json        <- ignore (stray 92-byte file)
  KARIGARI/                <- ★ THE APP ROOT. cd here. Run npm commands here.
    new_admin.md           <- ★ THE SPEC. Read first.
    suggestion.md          <- extra context on the same admin dashboard (read it)
    documentation5.md      <- full project history (Days 1–6) — read for context
    README.md, AGENTS.md, CLAUDE.md
    package.json
    prisma/
      schema.prisma        <- data model (you WILL edit this)
      seed.ts              <- seed script (you WILL edit this)
    src/
      app/                 <- Next.js App Router
      components/
      lib/
```

**Before writing any code, `cd` into `KARIGARI-main/KARIGARI` and run:**
```bash
git status && git log --oneline -5      # know your starting point
npm install                              # ensure deps present
```
Do all work inside `KARIGARI-main/KARIGARI`.

---

## 2. TECH STACK & HARD CONVENTIONS (match these exactly)

- **Next.js 16.3.1, App Router, React 19, TypeScript.** ⚠️ Next 16 has breaking changes vs older versions. Per `AGENTS.md`, when unsure about an API read `node_modules/next/dist/docs/`. Specifically: **`cookies()` is async (`await cookies()`)** and **`searchParams` is a `Promise` you must `await`.** Follow the patterns in the existing files below rather than your training defaults.
- **Prisma 7.9** with the `@prisma/adapter-pg` adapter over **PostgreSQL**. The client singleton is `src/lib/prisma.ts` — import it as `import { prisma } from '@/lib/prisma'`. Path alias `@/` = `src/`.
- **Auth = custom JWT in an httpOnly cookie named `auth-token`**, signed with `process.env.JWT_SECRET || 'fallback-secret'`. ⚠️ The payload becomes just **`{ userId, role }`** — you are removing the `isSuperAdmin` flag entirely (§4). Never introduce NextAuth or any other auth lib.
- **Styling = Tailwind CSS v4** with a `@theme` block in `src/app/globals.css`. Use the existing design tokens — do not invent a new palette:
  - `--color-primary: #1A4731` (deep green) → classes `bg-primary`, `text-primary`, `hover:bg-primary-dark`, `primary-light`
  - `--color-background: #F5F0E8` (cream), `--color-sidebar: #1A1A1A`
  - stat accents: `--color-stat-teal/orange/blue/brown`
  - headings use `font-serif` (Playfair), body `font-sans` (Inter); cards use `shadow-card`, `rounded-2xl`, `border border-gray-100`
- **Charts = `recharts` (already installed).** Reuse the import/usage pattern from `src/app/admin/dashboard/page.tsx` **before you delete that file** (§4).
- **Icons = `lucide-react`.**
- **Class merging = `cn()` from `@/lib/utils`.**
- **AI = Google Gemini** via `generateContentWithFallback` in `src/lib/gemini.ts` (only if you need new AI calls — you mostly won't).
- **Audit trail = `logCraftItemEvent` from `@/lib/auditLogger`** — call it whenever you mutate a `CraftItem` so the immutable ledger stays complete.

### The exact auth snippets to copy

**API route (client-fetched):**
```ts
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
export const dynamic = 'force-dynamic';

const token = (await cookies()).get('auth-token');
if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
let decoded: any;
try { decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret'); }
catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }); }
if (decoded.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
```
Reference implementations (same auth block): `src/app/api/admin/dashboard/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/verify-batch/route.ts`. **Every admin API gate is simply `decoded.role !== 'ADMIN'`** — no super-admin branch.

**Server component page:** see `src/app/admin/audit-logs/page.tsx` (reads the cookie + `jwt.verify` directly, queries Prisma, sets `export const revalidate = 0`).

**Client dashboard page:** see `src/app/admin/dashboard/page.tsx` — `"use client"`, `fetch('/api/...', { cache: 'no-store' })`, and `setInterval` polling every 15s for live updates. (Lift what you need from it, then delete it per §4.)

---

## 3. GROUND TRUTH: the current data model (`prisma/schema.prisma`)

Read the file. What matters for this task:

**`enum Role { ADMIN, ARTISAN }`** — ✅ **keep exactly these two roles. Do NOT add `FACILITATOR`/`NODAL_OFFICER`.** One admin role only.

**`User`**: `id, name, email, passwordHash, role, accountStatus, patchBankBalance, patchBankIssued` + relations `artisanProfile`, `craftItems`, `schemeApplications`.

**`ArtisanProfile`**: `craftType, location, mobileNumber?, experienceYears, cooperativeId?, upiId?, healthScore, socialCategory?, annualIncome?, aadhaarLast4?, clusterName?, giTagCertified, giTagName?`.
- ✅ `mobileNumber` → use it for the "call the artisan" anti-exploitation feature.
- ✅ `annualIncome` → income baseline for the "Average Wage Increase" metric.
- ✅ `clusterName` / `location` → group artisans by cluster on the Facilitator view.

**`CraftItem`**: `id, artisanId, patchId?, craftType, descriptionOriginal?, descriptionEnglish?, aiGeneratedListing?, aiSuggestedCategory?, tags[], images[], rawMaterialCost?, laborDays?, fairnessScore?, fairWageFloor?, marketPriceMin/Max?, standardMarketPrice?, salePrice?, advancePaid, finalPayoutQueued, status, assignedAdminId?, createdAt`, relation `auditLogs`.
- ✅ `fairWageFloor` = **AI-suggested fair price**. `salePrice` = **actual/accepted price**. Compare these for the pricing-exploitation flag.
- ✅ `descriptionOriginal` = **raw regional-language transcript**; `descriptionEnglish` / `aiGeneratedListing` = **final English** → Voice QA side-by-side.
- ❌ **MISSING and required by `new_admin.md`: `pricingFlag Boolean` and `flagReason String?`.**
- ❌ **MISSING for truthful metrics:** no field marks voice-vs-manual cataloging, per-item language, or an audio blob URL.

**`AuditLog`**: `craftItemId, actorId?, actorRole, action, previousState?, newState?, comments?, createdAt` → powers the traceability/hash-ledger views.

---

## 4. KEY DECISIONS (already made for you — implement these, don't re-litigate)

1. **DELETE Local Admin and Super Admin entirely.** Required removals:
   - `src/app/admin/dashboard/page.tsx` (the old "Local Admin" home)
   - the entire `src/app/super-admin/` directory (the old "Super Admin" dashboard)
   - the demo Super-Admin login path and every `isSuperAdmin` / `SUPER_ADMIN` reference across the app
   **⚠️ Lift-before-delete:** these old files contain reusable pieces you need — the sidebar `NavItem` (bottom of `admin/dashboard/page.tsx`), the recharts setup (`admin/dashboard/page.tsx`), and the "Global Raw Ledger" per-log hash (`super-admin/dashboard/page.tsx`, `const fakeHash = "0x" + log.id.replace(/-/g,'').substring(0,16).toUpperCase()`). Extract these into the new pages or a shared component (e.g. `src/components/AdminShell.tsx` for the sidebar/header) **first**, then delete the old files.

2. **One admin, two dashboards.** Build `/admin/facilitator` and `/admin/nodal`, both gated `decoded.role === 'ADMIN'`. The single admin logs in once and switches between them via the sidebar. No role branching anywhere.

3. **Old Local-Admin sub-pages get consolidated.** `src/app/admin/users/`, `admin/verify/`, `admin/alerts/`, `admin/audit-logs/` are Local-Admin features. Fold their functionality into the new dashboards' tabs (they map cleanly — see §5) and remove them. If you keep any as a deep page, gate it to `ADMIN` and re-point its "Back to Dashboard" link (currently → `/admin/dashboard`, which will no longer exist) to `/admin/facilitator`. **No link may point to a deleted route.**

4. **PII display is per-view, not per-role** (there is only one admin now):
   - **Facilitator view shows real artisan contact** (name + `mobileNumber`) so the admin can call to stop exploitation — render an actual `tel:` link.
   - **Nodal view stays macro/aggregate** — counts, percentages, charts, and hash-chains; it never needs to render individual artisan PII. (You can drop the string-masking currently in `api/admin/dashboard/route.ts`; it existed only to hide artisans from a lower-trust admin that no longer exists.)

5. **Graceful fallbacks for legacy/missing data.** There is no stored audio blob and older rows won't have the new fields. Every screen must render cleanly when data is absent (Voice QA shows the transcript with a disabled "audio not captured" player; metrics fall back to computed estimates; never show `NaN` or crash). Match the "bulletproof for the demo" ethos in `src/app/api/items/voice-parse/route.ts`.

---

## 5. IMPLEMENTATION PLAN (phased — do in order, verify each phase)

### PHASE 1 — Data model & seed (`prisma/schema.prisma`, `prisma/seed.ts`)

1. **Leave `enum Role { ADMIN, ARTISAN }` unchanged.**
2. Add to `CraftItem` (required by `new_admin.md`):
   ```prisma
   pricingFlag Boolean @default(false)
   flagReason  String?
   ```
3. Add to `CraftItem` (so Nodal metrics are real, not faked):
   ```prisma
   catalogMethod String? // "VOICE" | "MANUAL"
   voiceLanguage String? // "Odia" | "Hindi" | "Telugu" | "English"
   audioUrl      String? // optional; null for legacy rows
   @@index([pricingFlag])
   ```
4. Apply and regenerate:
   ```bash
   npx prisma db push && npx prisma generate
   ```
5. **Update `prisma/seed.ts`** so the demo has believable, dynamic data:
   - Keep **one** admin account (the existing `superadmin@karigari.com` / `password123` row is fine — just make it a plain `role: 'ADMIN'`; you may rename the display name to "Cooperative Admin"). Do not seed any super-admin or facilitator/nodal role.
   - Add several `CraftItem`s across `catalogMethod` (mostly VOICE, some MANUAL) and `voiceLanguage` (mix of Odia/Hindi/Telugu) with distinct `createdAt`s.
   - Seed **at least one clearly exploited item**: `fairWageFloor` high (e.g. ₹5,000), `salePrice` ~₹1,500, `pricingFlag: true`, `flagReason: "Accepted price 70% below AI fair wage floor"`, and an artisan with a real `mobileNumber`.
   - Give artisans `annualIncome` baselines so the wage-increase metric computes.
   - Populate `descriptionOriginal` (regional script) ≠ `descriptionEnglish` so Voice QA shows a real translation pair.
   - Re-run the seed (check `package.json` / `prisma.config.ts` for the configured command; likely `npx prisma db seed` or `npx tsx prisma/seed.ts`).

### PHASE 2 — Pricing-flag logic at the source

The flag must be set dynamically, not only in seed. When an artisan's accepted price becomes known, compare it to `fairWageFloor` and set `pricingFlag`/`flagReason` when the accepted price is **>30% below** the fair floor (threshold per `new_admin.md`).
- Primary trigger point: **`src/app/api/admin/simulate-sale/route.ts`** (where `salePrice` is set). After computing `salePrice`, set `pricingFlag = salePrice < fairWageFloor * 0.7` with a descriptive `flagReason`, and `logCraftItemEvent(... action: 'PRICING_FLAG_RAISED' ...)` when flagged. (This route stays gated to `ADMIN`.)
- Also compute the discrepancy **on the fly** in the Facilitator queue so legacy rows without the stored flag still surface. Centralize the rule in one helper: `src/lib/pricing.ts` → `getPricingDiscrepancy(item)` returning `{ flagged, pctBelow, reason }`.

### PHASE 3 — Facilitator dashboard → `src/app/admin/facilitator/page.tsx`

A `"use client"` page with **tabs**, using the shared sidebar/header shell (`AdminShell`) and `StatCard`. Poll with `setInterval` for live updates. Gate: redirect to `/login` if not `ADMIN`. Tabs required by `new_admin.md`:

**Tab 1 — Pending QA** (the two human-in-the-loop safeguards):
- **Anti-Exploitation Pricing Queue** (`new_admin.md` §Tier1.1 + `suggestion.md` §1): a queue of flagged items showing craft, **AI Suggested Fair Price (`fairWageFloor`)**, **Accepted Price (`salePrice`)**, and a red badge with `% below fair wage`. Each row shows the artisan's **real name + `mobileNumber`** as a click-to-call `tel:` link ("Call to verify"), plus **"Approve Override"** (clears the flag) and **"Investigate/Hold."** Back these with a new endpoint (§6).
- **Voice QA Center** (`new_admin.md` §Tier1.2 + `suggestion.md` §2): for items pending review, a side-by-side card: an `<audio>` player fed by `audioUrl` (disabled with "audio not captured" when null), the **Raw Regional Transcript (`descriptionOriginal`)**, and the **Final AI English (`descriptionEnglish`/`aiGeneratedListing`)**, with a **"Publish"** action. Reuse the batch-approve flow in `src/app/admin/verify/page.tsx` + `src/app/api/admin/verify-batch/route.ts` as the pattern.

**Tab 2 — My Cluster** (`new_admin.md` §Tier1 Pages + §Tier1.3):
- A CRM-style list of artisans in the admin's cluster (scope by `clusterName`/`location` or `assignedAdminId`). Reuse the table pattern from `src/app/admin/users/page.tsx`, but **unmasked** (name, mobile, craft, health, items) — then delete the old page.
- A **"Add Product on Behalf of Artisan"** button (Assisted Onboarding, `new_admin.md` §Tier1.3) for artisans without smartphones. Reuse the capture UX (`src/components/CaptureModal.tsx` / `src/components/VoiceOnboarding.tsx`). ⚠️ `src/app/api/items/capture/route.ts` is gated to `role === 'ARTISAN'` — add an admin-capable path: either extend that route to also accept `ADMIN` **with an explicit `artisanId` in the body** (publish under that artisan), or add `src/app/api/admin/capture-on-behalf/route.ts`. Set `catalogMethod`/`voiceLanguage` on creation so metrics stay truthful.

Add a top strip of `StatCard`s (`variant="admin"`): e.g. Pending QA count, Active Pricing Flags, Artisans in Cluster, Items Published This Week — all from real queries.

### PHASE 4 — Nodal dashboard → `src/app/admin/nodal/page.tsx`

Macro/policy view (server component like the old `super-admin/dashboard`, or client + API — your call; keep it aggregate). Gate to `ADMIN`. Tabs required:

**Tab 1 — Impact Analytics** (`new_admin.md` §Tier2.1 + `suggestion.md` §3) using **recharts** (reuse the chart setup lifted from `admin/dashboard/page.tsx`):
- **Cataloging Method** — Voice vs Manual (count grouped by `catalogMethod`). Pie or bar.
- **Language Distribution** — pie over `voiceLanguage` (Odia/Hindi/Telugu…).
- **Average Wage Increase** — compare artisan `annualIncome` baseline vs income implied by AI fair prices/sales; render as a stat + bar. Compute server-side; never hard-code.
- Optionally keep a MoSJE "Community Breakdown (SC/ST/OBC/…)", but **driven by real `socialCategory` counts**, not static bars.

**Tab 2 — Global Audit / Traceability** (`new_admin.md` §Tier2.2): a Product/Patch-ID search that shows an item's immutable hash-chain (Created → Verified → Sold). **Reuse existing code:** the `patchId` search + timeline renderer in `src/app/admin/audit-logs/page.tsx`, and the per-log `fakeHash` ledger from the old `super-admin/dashboard/page.tsx`. Lift both into this tab, then delete the old pages.

### PHASE 5 — Wiring, navigation, cleanup

- **`src/app/api/auth/login/route.ts`:** remove the `superadmin@karigari.com` → `isSuperAdmin: true` special case (or keep the credential but issue a plain `{ userId, role: 'ADMIN' }`). The token payload is now just `{ userId, role }`.
- **`src/app/login/page.tsx`:** remove the "Local Admin / Super Admin" radio UI and the `SUPER_ADMIN` state. Keep the Artisan/Admin tabs. Redirects: `ADMIN` → `/admin/facilitator`, `ARTISAN` → `/artisan/dashboard`. Delete the `/super-admin/dashboard` redirect.
- **`src/app/page.tsx`:** the landing "For Admins" button currently links to `/admin/dashboard` (being deleted) — point it to `/admin/facilitator`.
- **Sidebar (`AdminShell`):** two `NavItem`s — "Facilitator" (`/admin/facilitator`) and "Nodal Oversight" (`/admin/nodal`) — plus Logout. Both pages share this shell so the admin can switch views.
- **Delete** `src/app/admin/dashboard/`, `src/app/super-admin/`, and the consolidated sub-pages (`admin/users`, `admin/verify`, `admin/alerts`, `admin/audit-logs`) once their features live in the new tabs. **Grep the repo for `super-admin`, `isSuperAdmin`, `SUPER_ADMIN`, and `/admin/dashboard` and fix or remove every hit.**

### PHASE 6 — Verification (do all of this before declaring done)

```bash
grep -rn "super-admin\|isSuperAdmin\|SUPER_ADMIN\|/admin/dashboard" src   # must return nothing meaningful
npx tsc --noEmit          # zero type errors
npm run lint              # clean
npm run build             # must compile (Next 16 production build)
```
Then `npm run dev` and manually verify:
1. Log in as the single admin (`superadmin@karigari.com` / `password123`) → lands on `/admin/facilitator`; sidebar switches to `/admin/nodal`.
2. **Facilitator:** Pending QA shows the flagged item with correct **% below fair wage** and a working `tel:` link; Voice QA shows transcript vs English; "Approve Override" clears the flag and writes an audit log; "Add on behalf" creates an item under the right artisan.
3. **Nodal:** all charts render with **real seeded numbers** (no `NaN`, no empty axes); Global Audit search on a seeded `patchId` returns the full timeline + hash chain.
4. Old routes are gone: visiting `/admin/dashboard` or `/super-admin/dashboard` 404s (or redirects); no "Back" link points to a dead route.
5. Artisan flows (`/artisan/dashboard`, capture, sell) still work unchanged.
6. Resize to mobile width — layouts stay usable.

Report what you changed, list new/edited/deleted files, and note anything you had to stub.

---

## 6. FILE CHECKLIST (your expected surface area)

**Schema/seed:** `prisma/schema.prisma`, `prisma/seed.ts`
**New libs:** `src/lib/pricing.ts` (discrepancy helper). *(No multi-role auth helper needed — every gate is just `role === 'ADMIN'`.)*
**New pages:** `src/app/admin/facilitator/page.tsx`, `src/app/admin/nodal/page.tsx`
**New shared component:** `src/components/AdminShell.tsx` (sidebar+header lifted from the old dashboard)
**New APIs (mirror existing route style, all gated `ADMIN`):**
- `src/app/api/admin/facilitator-queue/route.ts` — pending pricing flags + voice-QA items (unmasked, cluster-scoped)
- `src/app/api/admin/resolve-flag/route.ts` — approve override / hold (PATCH, writes audit log)
- `src/app/api/admin/cluster/route.ts` — artisans in the admin's cluster
- `src/app/api/admin/capture-on-behalf/route.ts` — assisted onboarding (or extend `src/app/api/items/capture/route.ts`)
- `src/app/api/admin/nodal-analytics/route.ts` — aggregated impact metrics
- (reuse existing) `verify-batch`, `simulate-sale`, `export-compliance`
**Edit:** `src/app/api/admin/simulate-sale/route.ts` (set pricingFlag), `src/app/api/auth/login/route.ts` (drop isSuperAdmin), `src/app/login/page.tsx` (drop super-admin UI + fix redirects), `src/app/page.tsx` (fix "For Admins" link)
**DELETE:** `src/app/admin/dashboard/`, `src/app/super-admin/`, and (after folding in) `src/app/admin/users/`, `admin/verify/`, `admin/alerts/`, `admin/audit-logs/`

---

## 7. GUARDRAILS (violating any of these fails the task)

- **One admin role only.** No `FACILITATOR`/`NODAL_OFFICER` roles, no `isSuperAdmin`, no `SUPER_ADMIN`, no `/super-admin`. Every admin gate is `decoded.role === 'ADMIN'`.
- **Lift reusable code before deleting** the old pages; never leave a dangling import or a link to a deleted route.
- **Don't break ARTISAN flows** or shared components (`StatCard`, `KarigariLogo`, `CaptureModal`, `prisma`, `auditLogger`).
- **No hard-coded fake metrics** on the new pages. Every number comes from a Prisma query. (The old dashboard's `disbursementData`, `DemoBar`, "14,200 / 20,000" were placeholders — do not carry them over; compute real values.)
- **Reuse the design system:** green/cream tokens, `font-serif` headings, `rounded-2xl`, `shadow-card`, recharts, lucide icons.
- **Facilitator view = real contact; Nodal view = aggregate** (§4.4).
- **Every `CraftItem` mutation writes an `AuditLog`** via `logCraftItemEvent`.
- **Honor Next.js 16:** `await cookies()`, `await searchParams`; when unsure open `node_modules/next/dist/docs/` and copy patterns from the reference files named above.
- **Keep it demo-bulletproof:** wrap AI/DB calls so a failure degrades gracefully instead of crashing the UI.

---

## 8. DEFINITION OF DONE

`new_admin.md` is fully implemented under a **single admin**: one `ADMIN` login opens **`/admin/facilitator`** (Pending QA with the anti-exploitation pricing queue + Voice QA, and My Cluster with assisted onboarding) and **`/admin/nodal`** (Impact Analytics charts + Global Audit hash-chain search). Both are dynamic, `ADMIN`-gated, styled to match the app, and backed by real seeded data. **Local Admin and Super Admin are gone** — no `super-admin`/`isSuperAdmin` references remain, no dead links exist, and `npm run build` passes with artisan flows still working. The pitch the dashboards must visibly support: *"One oversight console that protects artisans from exploitation, audits our AI's accuracy, and proves to the Ministry that the digital divide is closing."*
