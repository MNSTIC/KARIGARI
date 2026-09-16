# KARIGARI — MASTER PROMPT V12: THE 12-FEATURE ENHANCEMENT PROGRAMME (CHECKPOINTED)

> **Paste this entire file into Claude Code as your task.** It is self-contained.
> It is deliberately split into **14 numbered PHASES with a hard STOP after each one**.
> You implement ONE phase, verify it, commit it, write the ledger, print the STOP block, and **halt**.
> The human then either says "continue" or comes back in a later session and says
> `Resume KARIGARI enhancements from PHASE <n>`.
>
> **Do not batch phases. Do not "get ahead". A phase that is not verified is not done.**

---

## 0. HOW TO USE THIS FILE — READ THIS SECTION COMPLETELY BEFORE TOUCHING CODE

### 0.1 The execution contract

1. Run **PHASE 0** (baseline + ledger). It writes no feature code. Then STOP.
2. On each subsequent invocation, read `docs/ENHANCEMENTS_PROGRESS.md`, find the first phase whose
   status is not `DONE`, and execute exactly that one phase.
3. At the end of every phase you MUST, in this order:
   - run the **Quality Gates** (§4.2) and fix everything they surface,
   - run the phase's own **Verification Checklist**,
   - update `docs/ENHANCEMENTS_PROGRESS.md`,
   - `git add -A && git commit` with the phase's commit message,
   - print the **STOP BLOCK** (§4.4),
   - **stop producing output and take no further action.**
4. If you run out of context mid-phase: do **not** leave the tree broken. Revert the incomplete
   work (`git checkout -- .` for uncommitted edits), record in the ledger what was attempted and
   what the next concrete step is, and print the STOP block with status `PARTIAL`.

### 0.2 Phase map, dependency order, and rough cost

| Phase | Feature | Depends on | Est. tokens | Schema change |
|:--|:--|:--|:--|:--|
| **0** | Baseline, branch, ledger | — | very small | no |
| **1** | Hybrid Income Tracker (offline sale ledger) | 0 | large | yes |
| **2** | Buyer Intelligence ("My Buyers" CRM) | 1 | medium | yes |
| **3** | Production Credit Score + bank share link | 1, 2 | medium | yes |
| **4** | Buyer Discovery Page (QR passport + product page) | — | large | no |
| **5** | AI Learning Pathways (skill stages, offline cache) | — | medium | yes |
| **6** | Proactive Supply Intelligence (20-day reminder) | 1 | small | yes |
| **7** | Sync Status Indicator ("Synced 2 min ago") | — | small | no |
| **8** | Workshop Resources (rename + repair + tool schemes) | — | large | yes |
| **9** | Recognition & Anonymous Cluster Benchmarks | 1, 2, 3 | medium | yes |
| **10** | Design Lab (AI concept + SVG motif composer) | — | large | yes |
| **11** | Digital Craft IP Registry (motif fingerprint + licensing) | 10 | very large | yes |
| **12** | Scrap-to-Wealth (circular economy module) | 8 | large | yes |
| **13** | Influencer commission model — artisan-funded 5% opt-in | — | medium | yes |

Phases are ordered so that **no phase ever breaks a later one**. Do not reorder. If the human asks
for a specific phase out of order, check its `Depends on` column first and say plainly what is
missing rather than faking the dependency.

### 0.3 The single most important instruction in this document

> **Every number, name, date, badge, score, price, chart point and list item rendered anywhere
> must trace to a row in PostgreSQL, a value the artisan entered, or a named constant in `src/lib/`.**

That means, concretely, and with no exceptions:

- **No placeholder data.** No `const MOCK_BUYERS = [...]`. No `Math.random()`. No "₹8,000" typed
  into JSX. No sample supplier names, recycler names, YouTube video IDs, award names or scheme
  amounts invented by you.
- **Three states per surface, always.** Every new panel must render correctly when there is
  (a) real data, (b) **no** data yet, (c) **not enough** data to be meaningful. State (c) must name
  its own threshold to the artisan — "needs 3 sales, you have 1" — never a hidden fudge.
- **A statistic with n < threshold is not shown.** Medians, benchmarks and comparisons have
  documented minimum sample sizes in this document. Below them you show the empty state, not a
  number computed from one row.
- **Every AI output is labelled and degrades.** Anything from Gemini or Groq is shown as an
  estimate/suggestion with its basis, and every AI path has a deterministic rule-based fallback so
  the feature still works with `GEMINI_API_KEY` and `GROQ_API_KEY` absent. An AI failure never
  blanks a page and never crashes a request.
- **Money that did not move is never shown as money received.** This codebase already draws that
  line hard (see the doc comments in `prisma/schema.prisma` on `paidAmountPaise`, `advanceDueAmount`
  and `settledAmount`). Offline income, platform escrow income and demand-order credits are three
  separate streams and must stay separately labelled everywhere. A simulated payout is labelled
  simulated.

---

## 1. ROLE & MISSION

You are a **principal full-stack engineer** on **KARIGARI** — an AI-driven market-linkage,
provenance and fair-wage platform for marginalised artisans, built for **Smart India Hackathon 2026,
PS 26090, Ministry of Social Justice & Empowerment**.

This is software judged live, in front of people who will scan a QR code on a real object and click
around unprompted. The quality bar is therefore: **dynamic, correct under every input, visually
identical in character to what already exists, and free of errors, warnings and console noise.**

**Scope discipline.** Work only inside the app root. Do not refactor unrelated code. Do not
reformat files you did not need to change. Do not add npm dependencies — everything needed is
already installed (§2.10). Do not change the visual theme.

---

## 2. REPO ORIENTATION — GROUND TRUTH

### 2.1 The nested-folder trap

The repository root contains a **second** folder. The Next.js app root is:

```
KARIGARI-main/KARIGARI/          <-- package.json name: "karigari-app". ALL work happens here.
```

`KARIGARI-main/` itself holds only `india.glb`, a scratch `remove_arrows_text.mjs` and its own
throwaway `package.json`. Never run `npm` or `prisma` from there.

First command of every session:

```bash
cd KARIGARI-main/KARIGARI && git status && git log --oneline -5 && node -v
```

### 2.2 Stack

| Concern | Implementation |
|:--|:--|
| Framework | **Next.js 16.3.1** App Router, **React 19.2.8**, TypeScript 5, `next build --webpack` |
| Database | **PostgreSQL** via **Prisma 7.10** with `@prisma/adapter-pg`; singleton at `src/lib/prisma.ts` |
| AI — vision/valuation/NLP | **Google Gemini** `@google/genai` → `generateContentWithFallback()` in `src/lib/gemini.ts`; gated by `GEMINI_CONFIGURED`; model fallback lists + timeouts already defined there |
| AI — structured JSON / speech | **Groq** → `groqChatJSON<T>()`, `isGroqConfigured()`, `GROQ_WHISPER_MODEL`, `languageInstruction()` in `src/lib/groq.ts` |
| Auth | JWT in httpOnly cookie `auth-token`; roles are **`ADMIN | ARTISAN` only** — there is no buyer account |
| Styling | **Tailwind v4**, `@theme` block in `src/app/globals.css` |
| Charts | **recharts 3.10**, always behind `next/dynamic` with `ssr: false` (see `src/app/artisan/earnings/page.tsx`) |
| Icons | **lucide-react 1.31** |
| i18n | `useLanguage()` from `src/lib/translations.ts` → `src/lib/i18n/{en,hi,or,te}.ts` |
| Offline | `idb` 8 → `src/lib/offlineQueue.ts`, `offlineQueueStore.ts`, `offlineSync.ts`; PWA via `@ducanh2912/next-pwa` |
| Payments | `razorpay` 2.9 + RazorpayX payouts; `src/lib/razorpay.ts`, `razorpayPayout.ts`, `escrow.ts` |
| SMS/IVR | `twilio` 6 → `src/lib/sms.ts`, `twilioIvr.ts` |
| Images | **base64 data URLs stored in Postgres `String[]` / `String` columns. There is no S3, no bucket, no upload service.** |

### 2.3 Next.js 16 / React 19 rules — violating any of these produces a build error or a hydration bug

- `cookies()` is async: `const cookieStore = await cookies();`
- `params` is a Promise in server components: `const { id } = await params;`
- **Never** use `useSearchParams()` in a client page. The house pattern is to read
  `window.location.search` inside a **deferred** effect, so no `<Suspense>` boundary is needed —
  see `src/lib/urlTab.ts` and `src/app/verify/[patchId]/VerificationClient.tsx`.
- **No synchronous `setState` in an effect body.** Every page here kicks off with
  `const kickoff = setTimeout(() => { ... }, 0); return () => clearTimeout(kickoff);`. Follow it.
- Any date/number rendered on both server and client must be formatted with an **explicit locale and
  time zone** or it will throw a hydration mismatch. The house format is
  `toLocaleString('en-IN', { …, timeZone: 'Asia/Kolkata' })` — see `STAMP_FORMAT` in
  `VerificationClient.tsx`. Relative times ("2 min ago") must render a neutral placeholder on the
  server and fill in inside an effect.
- `import { prisma } from '@/lib/prisma'` — never `new PrismaClient()`.
- After any `prisma generate`, **restart the dev server** or you get `Unknown argument` errors from a
  cached client.
- `<Image>` on a data URL needs the `unoptimized` prop, and an empty `src` must be guarded — use the
  existing `imageProps()` helper in `src/lib/marketplace.ts`.

### 2.4 Design tokens — the CURRENT theme (older prompt files in this repo quote the retired green palette; ignore those)

The theme is **"Heritage Tech, editorial light"**: warm off-white paper, near-black ink, maroon and
terracotta as the only accents. Never write a raw hex value; always use a token.

```
Ink        --color-primary #1A1A1A   --color-primary-dark #2E2926   --color-primary-light #4A423C
Surfaces   --color-background #F6F3EE   --color-card #FFFFFF   --color-sidebar #F1EDE6   --color-cream
Accents    --color-maroon #5A1A1A   --color-maroon-soft #7E2A22   --color-rust #C2632F   --color-rust-deep
           --color-pink #F8D9CE (the one soft note)   --color-pill #ECE7E0 (inactive pills)
Legacy     --color-sage / --color-mint  now render as warm neutrals, NOT green. Safe to keep using.
Stat       --color-stat-teal / -orange / -blue / -brown
Ramp       --color-gray-50 … -900  (warm neutral, overrides Tailwind defaults)
Status     red-* = maroon family, orange-* = terracotta, green-* = muted olive, blue/yellow/amber/purple
Type       --font-serif (Fraunces → Playfair → Georgia → Inter)  --font-sans (Inter)  --font-mono (IBM Plex Mono)
Shadow     --shadow-card (resting)   --shadow-soft (raised)
```

**Nothing in this design is allowed to be bright.** No saturated blues, no emerald, no brand colour
from another product, no gradient that was not already in the file.

Editorial primitives in `globals.css`, use them rather than re-inventing:

`.kg-label` (tracked uppercase mono micro-label) · `.kg-display` (serif figures/titles) ·
`.kg-offset` (hard stacked shadow) · `.kg-rule-maroon` · `.kg-scroll-x` / `.kg-rail` (snap rails) ·
`.kg-enter` `.kg-fade` `.kg-slide-in` `.animate-fade-in-up` `.kg-stagger` (entrance) ·
`.kg-shimmer` (loading) · `.kg-lift` (clickable card hover) · `.kg-press` (buttons/pills) ·
`.kg-list-item`. All motion is already wrapped in a `prefers-reduced-motion` guard at the bottom of
`globals.css` — keep new animation inside these classes so it inherits that.

### 2.5 UI primitives you must reuse instead of hand-rolling

From `src/components/ui/`:

| Component | Use it for |
|:--|:--|
| `Card` | every surface. Props: `tone="default|muted|primary|plain"`, `pad="none|sm|md|lg"`, `radius="2xl|3xl"`, `interactive`, `as="div|article|section|li"` |
| `PageTitle`, `PageLede` | the big serif page opener + grey sub-line every page starts with |
| `SectionEyebrow`, `SectionHeading`, `SectionLabel` | tracked mono section labels and headings with the maroon rule |
| `StatTile` (`label`, `value`, `icon`, `delta`), `HeadlineStat` | the overview figure row |
| `StatCard` | accent-tinted metric card |
| `Badge` (+ `BadgeVariant`), `statusBadge(status)`, `VerifiedOriginBadge`, `PatchIdChip` | every status pill. **Extend `statusBadge()` when you add a status string** |
| `SegmentedToggle`, `PillTabs`, `FilterTabs`, `Pill` | mode switches and filter rows |
| `ProgressBar`, `BandMarker`, `ProgressStepper`, `OrderTimeline` | progress, price bands, lifecycle ladders |
| `Avatar`, `StarRating`, `ProductCard`, `ArticleCard`, `DarkCard`, `NoticeItem`, `FormField`, `RouteSkeleton`, `AssistantChat`, `KarigariLogo` | as named |
| `AppShell` / `Shell` | `AppShell` is the chrome (rail + `TopBar` + drawer), mounted in `src/app/artisan/layout.tsx`. `Shell` is the page-body wrapper every page content sits in |
| `Sidebar` | `ARTISAN_GROUPS` / `ADMIN_GROUPS` nav arrays + `groupsForRole()` / `homeForRole()`. Nav labels are **i18n keys**, resolved at render |
| `TopBar` | sticky header: search → `OfflineQueueBadge` → `LanguageMenu` → `NotificationsBell` → avatar |

Every new artisan page needs a sibling `loading.tsx` (5 lines, returns `<RouteSkeleton />`) — all
twelve existing artisan routes have one.

### 2.6 i18n — a hard requirement, not a nicety

Every user-facing string goes in **all four** dictionaries: `src/lib/i18n/en.ts`, `hi.ts`, `or.ts`,
`te.ts` (Hindi, Odia, Telugu). `en.ts` is the synchronous fallback and is statically imported; the
other three are lazily `import()`ed and cached. Read strings with `const { t } = useLanguage()` and
`t("key")`; interpolate with the existing `{amount}` / `{band}` placeholder convention.

- **Never hardcode an English string in JSX.** A missing key renders the key, which is a visible bug.
- API responses and DB-stored text stay English (the existing convention) — translate at render.
- Provide **real** Hindi/Odia/Telugu translations, not the English string copied across. Where a term
  is genuinely untranslated in trade usage (e.g. "QR"), keep it transliterated in the native script.

### 2.7 Auth

```ts
import { requireArtisan } from '@/lib/artisanAuth';

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;          // send it back verbatim
  const artisanId = auth.artisan.userId;
  …
}
```

Admin routes verify `decoded.role === 'ADMIN'` the same way. **Public routes are public** — the
storefront, `/verify/[patchId]`, the demand board and every new public page in this document have no
session; buyer identity is a free-text name, matched case-insensitively, exactly as
`Demand.buyerName`, `CraftItem.buyerName`, `Review.buyerName`, `Ticket.buyerName` and
`BuyerNotification.buyerName` already do. Client helpers: `src/lib/buyerIdentity.ts`
(`readBuyerName`, `readBuyerContact`, `rememberBuyer`).

### 2.8 Audit logging

Any change to a `CraftItem`'s state **must** call `logCraftItemEvent()` from `@/lib/auditLogger`
(writes an `AuditLog` row with `previousState` / `newState`). The nodal-officer audit ledger and the
buyer passport both read these rows, so a silent mutation breaks two features at once.

### 2.9 Existing domain libraries — read before you compute anything yourself

| File | What it owns |
|:--|:--|
| `escrow.ts` | `ADVANCE_RATE 0.4`, `FINAL_SETTLEMENT_RATE 0.4936`, `PLATFORM_FEE_RATE 0.035`, `CREATOR_RATE 0.05`, `ARTISAN_TOTAL_RATE`, `advanceFor()`, `finalSettlementFor()`, `platformFeeFor()`, `creatorCommissionFor()`, `artisanSharePctFor()`, `rupees()`, the `ESCROW_*` status constants |
| `pricing.ts` | `formatRupees()`, `getListingPrice()`, `estimateCraftValuation()`, `getPricingDiscrepancy()`, the fair-wage tolerance constants |
| `storefrontSale.ts` | `SOLD_STATUSES`, `SETTLED_ESCROW`, and the one place a `CraftItem` becomes an order |
| `orderStage.ts` | `resolveStage()`, `advanceOrderStatus()` — the monotonic order ladder |
| `notifications.ts` | `craftMatchScore()`, `scoreArtisanForDemand()`, `notifyArtisansForDemand()`, `notifyArtisanOfFestival()` — and the **dedupe-then-create** idempotency pattern you will copy in Phase 6 |
| `artisanHealth.ts` | `HEALTH_MAX 100`, `HEALTH_REWARD_VERIFIED 2.5`, `HEALTH_PENALTY_GUILTY 15`, `clampHealth()` |
| `schemes.ts` | `SchemeKey` union, `SCHEMES`, `SCHEME_BY_KEY`, `evaluateScheme()`, `evaluateAllSchemes()`, `EligibilityContext`, `PM_VISHWAKARMA_TRADES`, `resolveLegacySchemeKey()` |
| `suppliers.ts` | `CURATED_SUPPLIERS`, `MaterialFamily`, `familiesForCraft()`, `suppliersForCraft()` |
| `benchmarkData.ts` | `craftBenchmarks`, `validateArtisanClaim()` |
| `marketplace.ts` | `MarketItem`, `marketPrice()`, `imageProps()`, `categoryFor()` |
| `buyerVerify.ts` | `provenanceReference()` — **always compares against `originalImageUrl`, never the enhanced/styled look** |
| `giLabels.ts`, `festivals.ts`, `indiaGeo.ts`, `gender.ts`, `qrPatch.ts`, `affiliateRef.ts`, `creators.ts`, `shopify.ts`, `syndication.ts`, `auditLogger.ts`, `artisanIdentity.ts`, `urlTab.ts`, `useNetworkQuality.ts`, `pollingIntervals.ts`, `utils.ts` (`cn()`) | as named — check before duplicating logic |

### 2.10 Data-model realities that will bite you if you forget them

1. **There is no `Order` table.** A storefront purchase *is* the `CraftItem` row — payment, escrow
   and the pack/dispatch/deliver timestamps all live on it. A **demand** commitment is a separate
   `ArtisanOrder` row. Two different mechanics; they share only the buyer-facing six-rung ladder.
2. **A `CraftItem` is one physical piece**, not a SKU with stock. Selling it anywhere must remove it
   from everywhere else.
3. **Buyers have no `User` row.** That is why `BuyerNotification` exists separately from
   `Notification` (whose `userId` is a required FK). Never make `Notification.userId` nullable.
4. **Images are data URLs in Postgres.** Never hold many full-resolution ones in memory in a route;
   downscale on the client (`clientImagePrep.ts`, `imagePrep.ts`) before sending.
5. **`paidAmountPaise` ≠ `salePrice`.** Razorpay collects a small demo charge; every displayed figure
   and every escrow tranche comes from the real price. Same split for
   `ArtisanOrder.advanceChargedPaise` vs `advanceDueAmount`. **Never conflate them.**
6. **Presence of a timestamp is the idempotency guard** throughout this schema (`paidAt`, `packedAt`,
   `dispatchedAt`, `deliveredAt`, `settledAt`, `advancePaidAt`, `qrVerifiedAt`). Follow that pattern
   for every new step you add: an `updateMany` with `{ theTimestamp: null }` in the predicate, so a
   double click cannot double-write.
7. **Statuses are monotonic.** Nothing walks an order backwards.
8. **`qrExemptAt` is a one-time demo grandfather column that the application never writes.** Leave it
   alone.
9. **Cluster key resolution** (used by `/artisan/cluster` and `ResourceRequest.clusterName`):
   `artisanProfile.shgGroupLink` when present, otherwise `` `auto:${location}` ``. Reuse exactly this
   rule wherever a new feature needs a cluster; do not invent a second definition.
10. **No new npm dependencies.** In particular: no chart library besides recharts, no PDF library
    (use a print stylesheet + `window.print()`), no hashing library (write the perceptual hash by
    hand in TypeScript), no canvas/drawing library (compose SVG), no date library.

### 2.11 How tests work in this repo — there is no test framework, and you must not add one

`src/lib/__tests__/` contains exactly one file today: `orderStage.test.mjs`. **Read it before writing
any test.** Its header documents the convention and the reason for it:

> *Plain Node, no test framework: this repo has none, and adding one for a single pure function would
> be a heavier dependency than the test it runs.*

The pattern is: an `.mjs` file that uses `esbuild`'s JS API (already a transitive dependency, and
allow-listed in `package.json`) to compile the real `src/lib/*.ts` module into a temp dir, imports the
compiled output, and asserts with `node:assert/strict`. It leaves no build artefact in the repo and
always tests the real module rather than a copy.

Every test this programme asks for must follow that pattern exactly:

- file: `src/lib/__tests__/<module>.test.mjs`
- run: `node src/lib/__tests__/<module>.test.mjs`
- add an npm script next to the existing `verify:schemes`, e.g.
  `"test:credit": "node src/lib/__tests__/creditScore.test.mjs"`, plus a `"test:all"` that chains
  every one of them with `&&`.
- **Do not** add jest, vitest, mocha, `node --test` globs, or any test runner dependency.

Run `npm run test:all` as part of the quality gates from the first phase that adds a test onward.

### 2.12 Accessibility and polish rules that the gates will not catch for you

- No `alert()`, `confirm()` or `prompt()`. Use an in-page banner/toast in the house style.
- Every live region (`syncing`, `saved`, `error`) gets `role="status"` and `aria-live="polite"`;
  destructive/blocking errors get `role="alert"`.
- Every icon-only control gets an `aria-label`. Every modal traps focus, closes on `Esc`, and
  restores focus to its trigger. Follow `CaptureModal.tsx` / `PostDemandModal.tsx`.
- Tap targets ≥ 40 px; the artisan is on a phone, one-handed, possibly outdoors.
- Every list gets stable `key`s from real ids — never the array index.
- Test at 360 px width. The rails are horizontal-snap (`.kg-rail`) for a reason.
- `console.warn` is acceptable for a degraded AI path (the codebase does this). `console.error` in a
  normal flow is a bug. Zero React warnings in the console.

---

## 3. THE CHECKPOINT PROTOCOL

### 3.1 The ledger file — `docs/ENHANCEMENTS_PROGRESS.md`

Created in Phase 0, updated at the end of every phase. Exact format:

```markdown
# KARIGARI V12 Enhancement Programme — Progress Ledger

Branch: feat/v12-enhancements
Baseline commit: <sha>
Baseline gates: tsc <PASS|N errors> | lint <PASS|N> | build <PASS|FAIL>

| Phase | Feature | Status | Commit | Date | Notes |
|:--|:--|:--|:--|:--|:--|
| 0 | Baseline & ledger | DONE | abc1234 | 2026-09-16 | — |
| 1 | Hybrid Income Tracker | PENDING | — | — | — |
| … | … | PENDING | — | — | — |

## Phase <n> detail
- Schema: <models/fields added, or "none">
- Files created: <list>
- Files modified: <list>
- i18n keys added: <count> (all 4 dictionaries)
- Gates: tsc PASS | lint PASS | build PASS
- Manual verification: <checklist result, one line per item>
- Known follow-ups: <or "none">
```

Status vocabulary: `PENDING` · `IN_PROGRESS` · `DONE` · `PARTIAL` · `BLOCKED`.

### 3.2 Quality gates — run ALL of these at the end of EVERY phase

```bash
cd KARIGARI-main/KARIGARI
npx tsc --noEmit          # must be 0 errors
npm run lint              # must be 0 errors AND 0 new warnings
npm run build             # must succeed with no new warnings
npm run test:all          # from Phase 3 onward, once unit tests exist (see §2.11)
npm run verify:schemes    # from Phase 8 onward
```

Then, with `npm run dev` running, in the browser:

- load every page the phase touched, in **all four languages**,
- open the console: **zero** React warnings, zero uncaught errors, zero failed requests,
- resize to 360 px and check no horizontal overflow,
- exercise the empty state and the not-enough-data state deliberately (delete/hide rows if needed),
- if the phase touched an AI path: unset the key (`GEMINI_API_KEY=` / `GROQ_API_KEY=`), restart,
  confirm the feature still works in reduced form and says so.

**A phase with a failing gate is not committed and not marked DONE.** Fix it in the same phase.

### 3.3 Schema-change ritual (phases that change `prisma/schema.prisma`)

Apply **only that phase's** schema fragment, then:

```bash
npx prisma db push && npx prisma generate
# then RESTART the dev server
```

Every new model and every non-obvious new field gets a `///` doc comment in the house style — read
the existing comments in `schema.prisma` first; they explain *why the column exists and who writes
it*, which is the standard here. State the single writer of each new column explicitly.

### 3.4 The STOP BLOCK — print this verbatim (filled in) and then stop

```
═══════════════════════════════════════════════════════════
  PHASE <n> — <FEATURE NAME>  :  <DONE | PARTIAL | BLOCKED>
═══════════════════════════════════════════════════════════
  Schema        : <models/fields, or "no change">
  Files created : <n>  |  Files modified : <n>
  i18n keys     : <n> × 4 languages
  Gates         : tsc PASS | lint PASS | build PASS
  Commit        : <sha> "<message>"
  Ledger        : docs/ENHANCEMENTS_PROGRESS.md updated

  Verified manually:
    ✓ <checklist item>
    ✓ <checklist item>
    …

  Next phase    : PHASE <n+1> — <name>  (est. <size>)
  To continue   : say "continue" — or, in a new session, paste
                  this file and say:
                  "Resume KARIGARI enhancements from PHASE <n+1>"
═══════════════════════════════════════════════════════════
```

Then **halt**. Do not begin the next phase. Do not summarise the remaining roadmap. Do not ask a
question that invites you to keep going.

---

# PHASE 0 — BASELINE, BRANCH, LEDGER

**No feature code in this phase.** You are establishing a known-good starting point so that every
later "is this my bug?" question has an answer.

### Steps

1. `cd KARIGARI-main/KARIGARI`
2. `git status` — if the tree is dirty, **stop and report**; do not commit someone else's work in
   progress. If it is clean: `git rev-parse HEAD` and record the sha.
3. `git checkout -b feat/v12-enhancements` (if it already exists, check it out and say so).
4. `npm install` (should be a no-op; `postinstall` runs `prisma generate`).
5. Record the **baseline** gate results — run all three of §3.2 and write down the numbers **even if
   they are not zero**. Pre-existing errors are not yours to fix in this programme, but they must be
   known, or you will spend a later phase chasing them.
6. Read these files end to end before Phase 1. You will need them repeatedly:
   `prisma/schema.prisma`, `src/app/globals.css`, `src/components/ui/AppShell.tsx`,
   `src/components/ui/Sidebar.tsx`, `src/components/ui/TopBar.tsx`, `src/lib/escrow.ts`,
   `src/lib/pricing.ts`, `src/lib/storefrontSale.ts`, `src/lib/notifications.ts`,
   `src/lib/offlineQueue.ts`, `src/lib/offlineQueueStore.ts`, `src/app/artisan/earnings/page.tsx`,
   `src/app/api/artisan/dashboard/route.ts`, `docs/CONTRACT.md`.
7. Create `docs/ENHANCEMENTS_PROGRESS.md` with all 14 rows in the §3.1 format — Phase 0 `DONE`, the
   rest `PENDING`.
8. Gates → commit → STOP block.

**Commit:** `chore(v12): baseline, branch and progress ledger for the 12-feature programme`

### Verification checklist
- [ ] `docs/ENHANCEMENTS_PROGRESS.md` exists with 14 rows and the recorded baseline gate numbers
- [ ] On branch `feat/v12-enhancements`, working tree clean
- [ ] Baseline `tsc` / `lint` / `build` results recorded verbatim in the ledger

---

# PHASE 1 — HYBRID INCOME TRACKER (Offline Sale Ledger) ⭐

### 1.1 Why this exists

The PS says *"reducing dependency on periodic physical fairs"* — reducing, not abolishing. An artisan
who sells a dupatta at the local haat today has no way to record it, so their dashboard understates
their real income and the pricing engine has no ground truth from the physical market. This phase
lets them log a sale in one tap, keeps online and offline income **separately labelled** in one
place, and feeds real local sale prices into the pricing assistant.

Three things it must achieve, and the demo depends on all three:
1. total income (online + offline) visible in one place, never merged into a single ambiguous figure;
2. offline prices become a **real market signal** for price suggestions — with an honest minimum
   sample size;
3. the artisan sees, from their own data, that the same piece earns more online. No lecture, no
   invented comparison.

### 1.2 Schema

```prisma
/// One sale the artisan made away from the platform — a haat stall, a walk-in
/// customer, an exhibition, or a middleman pickup.
///
/// Deliberately NOT a `CraftItem`. A CraftItem is a piece Karigari catalogued,
/// photographed, QR-verified and can vouch for; an OfflineSale is the artisan's
/// own bookkeeping, unverified by anyone, and it must never be presented as
/// platform-settled income. When it names a catalogued piece, `craftItemId`
/// links them and that piece leaves the marketplace (status SOLD_OFFLINE) —
/// one physical object cannot be sold twice.
///
/// Written by POST /api/artisan/offline-sales and by the offline queue replay.
/// Nothing else writes this table.
model OfflineSale {
  id             String     @id @default(uuid())
  artisanId      String
  artisan        User       @relation(fields: [artisanId], references: [id])
  /// The catalogued piece, when the artisan picked one. Null for a sale of
  /// something that was never listed — which is the common case at a haat.
  craftItemId    String?    @unique
  craftItem      CraftItem? @relation(fields: [craftItemId], references: [id])
  /// What was sold, in the artisan's own words. Always set, even when
  /// `craftItemId` is too, so a later delete of the piece cannot orphan the
  /// ledger line.
  craftTypeLabel String
  /// Rupees actually received, for the whole line. Whole rupees: this is cash
  /// in a hand, and a paisa figure here would never reconcile.
  amount         Int
  quantity       Int        @default(1)
  /// HAAT | WALK_IN | EXHIBITION | MIDDLEMAN | OTHER. Guarded against an
  /// allow-list in the route; an unknown value falls back to OTHER rather than
  /// failing the log — an artisan must never lose a sale to a validation error.
  channel        String     @default("HAAT")
  buyerName      String?
  /// When the sale happened, which is not when it was logged: signal at a haat
  /// is poor and most rows arrive that evening. Never in the future.
  soldAt         DateTime
  notes          String?
  /// MANUAL | VOICE — digital-inclusion telemetry, same convention as
  /// `CraftItem.catalogMethod`.
  captureMethod  String     @default("MANUAL")
  /// The language the artisan spoke, when `captureMethod` is VOICE.
  voiceLanguage  String?
  createdAt      DateTime   @default(now())

  @@index([artisanId, soldAt])
  @@index([craftTypeLabel])
}
```

Also add to `model User`: `offlineSales OfflineSale[]`
Also add to `model CraftItem`: `offlineSale OfflineSale?`

`@unique` on `craftItemId` is the concurrency guard: one piece, at most one offline sale row.

### 1.3 New status string — `SOLD_OFFLINE`

A catalogued piece sold at a haat must disappear from the storefront. Add the status and wire it
through **every** consumer:

**Why a new status rather than reusing `SOLD_MIDDLEMAN`** — and do not "simplify" this away:
`SOLD_MIDDLEMAN` already exists and `statusBadge()` labels it *"Sold off-platform"*. But it carries the
middleman meaning that is the whole exploitation narrative of this project. A weaver selling a dupatta
directly to a customer at a haat has **cut the middleman out**, which is the opposite. Conflating the
two would make the platform's own impact metrics wrong. So:

- `src/lib/storefrontSale.ts` → add `'SOLD_OFFLINE'` to `SOLD_STATUSES`, leaving `SOLD_MIDDLEMAN`
  exactly as it is.
- `src/components/ui/Badge.tsx` → add a case to `statusBadge()`: label **"Sold offline"** (distinct
  from the existing "Sold off-platform"), `variant: "neutral"`. This is not an escrow success state
  and must not borrow the green "settled" pill.
- When the artisan picks `channel: 'MIDDLEMAN'` in the log form, the piece still goes to
  `SOLD_OFFLINE` — the channel is recorded on the `OfflineSale` row, where it belongs, and
  `SOLD_MIDDLEMAN` stays reserved for the platform's own middleman-routing decision path.
- `src/app/api/items/market/route.ts` and any other query that lists sellable pieces → confirm they
  filter on `SOLD_STATUSES` and not on a hand-written status list. **Grep for every literal
  `'SOLD_FINAL'` and `'SOLD_MIDDLEMAN'` in `src/` and fix any place that enumerates statuses inline.**
- `src/lib/shopify.ts` → if the piece has `shopifyStatus === 'LIVE'`, call the existing
  `withdrawSoldPiece()` so it is set to draft on Shopify too. Failure to withdraw must not fail the
  log — record `shopifySyncError` and carry on, exactly as the publish route does.
- Escrow columns are **never** written by this path. No `advancePaid`, no `escrowStatus`, no
  `paidAt`, no payout ref. Karigari moved no money.
- Call `logCraftItemEvent()` with action `SOLD_OFFLINE_LOGGED`.

### 1.4 Files to create

**`src/lib/offlineSales.ts`** — the domain module. Pure functions, no Prisma imports of its own where
avoidable, so it is unit-reasonable:

```ts
export const OFFLINE_CHANNELS = ['HAAT','WALK_IN','EXHIBITION','MIDDLEMAN','OTHER'] as const;
export type OfflineChannel = (typeof OFFLINE_CHANNELS)[number];
export function isOfflineChannel(v: unknown): v is OfflineChannel
export function channelLabelKey(c: OfflineChannel): string      // i18n key, not English
/** Minimum offline rows for a craft before a median is a signal, not an anecdote. */
export const MIN_PRICE_SAMPLES = 3;
/** Rows older than this stop counting toward the price signal. */
export const PRICE_SIGNAL_WINDOW_DAYS = 180;
export interface OfflinePriceSignal {
  craftTypeLabel: string;
  sampleSize: number;
  median: number;      // per unit: amount / quantity, rounded
  min: number;
  max: number;
  windowDays: number;
}
/** Null when sampleSize < MIN_PRICE_SAMPLES. Never a number from one row. */
export function buildPriceSignal(rows: {amount:number; quantity:number; soldAt:Date}[]): OfflinePriceSignal | null
/** Per-unit realised price for a piece sold ONLINE, for the honest comparison. */
export function onlineUnitPrice(item: {salePrice?:number|null; askingPrice?:number|null}): number | null
```

Median, not mean — one middleman sale at a distress price must not drag the signal. Use per-unit
values (`amount / quantity`), guard `quantity < 1`, and `rupees()`-style rounding.

**`src/app/api/artisan/offline-sales/route.ts`**

- `GET` → `{ success, sales: [...], totals: { offlineTotal, offlineCount, thisMonth, lastMonth },
  signal: OfflinePriceSignal | null, comparison: {...} | null }`.
  `comparison` is non-null **only** when the artisan has at least one online-settled sale **and** at
  least `MIN_PRICE_SAMPLES` offline rows of the same `craftTypeLabel` (case-insensitive trim). It
  carries `{ craftTypeLabel, offlineMedian, onlineMedian, deltaPct, onlineSampleSize,
  offlineSampleSize }`. Below either threshold it is `null` and the UI shows "log a few more sales to
  see this comparison" naming the shortfall. **Never compute a delta from one row on either side.**
- `POST` → body `{ craftItemId?, craftTypeLabel, amount, quantity, channel, buyerName?, soldAt,
  notes?, captureMethod?, voiceLanguage? }`.
  Validation, all server-side, each with its own message:
  - `amount` integer ≥ 1 and ≤ 10_000_000 (a typo of ₹15,00,000 for ₹1,500 must be caught — warn
    above 20× the artisan's own median, but let them confirm and proceed; their sale, their number);
  - `quantity` integer 1..999;
  - `soldAt` parseable, not in the future, not more than 2 years back;
  - `channel` via `isOfflineChannel`, else `OTHER`;
  - `craftTypeLabel` trimmed, 1..120 chars, required even when `craftItemId` is given (default it
    from the piece's `craftType` on the client);
  - when `craftItemId` is given: it must belong to **this** artisan, must not already be in
    `SOLD_STATUSES`, must not already have an `offlineSale`. Do the status change and the row insert
    in **one `prisma.$transaction`**; on a conflict return `409` with a clear message, never a 500.
- `DELETE?id=` → only the owner's own row, within 24 h of `createdAt` (after that it is ledger
  history); if the row delisted a piece, restore that piece's previous status from its `AuditLog`
  `previousState` inside the same transaction, and log the reversal.

**`src/app/api/artisan/offline-sales/parse/route.ts`** — vernacular voice → structured fields.

- Body: `{ transcript: string, language?: 'en'|'hi'|'or'|'te' }`.
- Path A (`isGroqConfigured()`): `groqChatJSON` with `languageInstruction(language)`, asking for
  `{ amount, quantity, craftTypeLabel, buyerName, channel, soldAt }`, every field nullable, plus a
  `confidence` 0..1. Temperature 0.
- Path B (always, as fallback **and** as a cross-check): a deterministic parser in
  `src/lib/offlineSaleParse.ts` handling Indian number words and scripts —
  `sau/hazaar/hajaar/lakh`, `सौ/हज़ार/लाख`, `ଶହ/ହଜାର/ଲକ୍ଷ`, `వంద/వేయి/లక్ష`, Devanagari/Odia/Telugu
  digit ranges, `₹`, `rs`, `rupees`, `1.5k`, `dedh/deed` (1.5), `dhai` (2.5). Test it in
  `src/lib/__tests__/offlineSaleParse.test.mjs` following the §2.11 convention, with a table of at
  least 20 utterances across the four languages plus the adversarial cases (no number at all, two
  numbers, a date and an amount in one sentence, a phone number that must **not** be read as a price).
- The route **never auto-submits**. It returns a draft; the artisan sees the parsed fields in the
  form, corrects them, and taps save. Show the raw transcript above the form so they can see what was
  heard. If both paths fail, return the transcript with all fields null and let them type — a parse
  failure must never lose the utterance.

**`src/app/artisan/log-sale/page.tsx`** + **`loading.tsx`**

Full page, not a modal (it must work offline and survive a reload). Layout, in house style:

- `PageTitle` "Log a sale" / `PageLede` one honest line: this records a sale made outside Karigari,
  for the artisan's own records.
- Big mic button first (the artisan is semi-literate by assumption) → records → transcribes with the
  existing voice pipeline → calls the parse route → fills the form. Reuse the recorder used by
  `VoiceOnboarding.tsx` / `CaptureModal.tsx`; do not write a third recorder.
- Form: a piece picker (a `.kg-rail` of the artisan's sellable catalogue thumbnails, plus a "not in
  my catalogue" option that reveals a free-text field), amount (large numeric keypad-friendly input,
  `inputMode="numeric"`), quantity stepper, channel as a `SegmentedToggle`, optional buyer name,
  date defaulting to today with a "yesterday" shortcut, notes.
- A live summary card showing `formatRupees(amount)` and — **only if the comparison exists** — the
  same craft's online median beside it, with the difference stated plainly and its sample sizes
  printed under it (`based on 4 offline and 6 online sales`).
- Save → optimistic row + success state with a "log another" button.
- **Offline support.** If `navigator.onLine === false` or the POST fails with a network error, queue
  it. Extend `src/lib/offlineQueue.ts`: bump `DB_VERSION` to `2`, add a second object store
  `'offlineSales'` in the `upgrade()` callback **without touching the existing `captures` store**
  (the upgrade must be additive — an artisan with queued captures must not lose them), and add
  `queueOfflineSale()` / `listQueuedOfflineSales()` / `removeQueuedOfflineSale()` /
  `countQueuedOfflineSales()` mirroring the existing four functions. Extend `flushQueue()` in
  `src/lib/offlineSync.ts` to drain both stores and return counts per kind; keep the existing
  `FlushResult` shape backward-compatible by adding fields rather than renaming them.

### 1.5 Files to modify

| File | Change |
|:--|:--|
| `src/components/ui/Sidebar.tsx` | add `/artisan/log-sale` to `ARTISAN_GROUPS` → `shell_group_my_workshop`, label key `nav_log_sale`, icon `ReceiptIndianRupee` (lucide) |
| `src/app/api/artisan/dashboard/route.ts` | add `offlineEarnings`, `offlineSalesCount`, `pastWeekOfflineEarnings` to the payload as a **separate stream** (mirror exactly how `demandEarnings` is handled — it must NOT be folded into `totalEarnings`); add offline rows into the `monthlyEarnings` buckets as a **distinct series key** so the chart can stack them, not overwrite them |
| `src/app/artisan/earnings/page.tsx` | headline becomes three labelled figures: `Online (settled)` / `Demand orders` / `Offline (self-logged)` plus a `Total income` figure that names its three parts on hover/focus. Add a "Log an offline sale" CTA |
| `src/components/EarningsAnalytics.tsx` | add the offline series to the monthly chart as a separate stacked bar/line with its own legend entry and a distinct token colour (`--color-stat-brown`); the tooltip must name each stream |
| `src/app/artisan/dashboard/page.tsx` | one `StatTile` for total income across streams, with the breakdown in its `delta` line |
| `src/app/api/items/price-estimate/route.ts` and `src/app/api/items/price-market/route.ts` | blend the offline signal: when `buildPriceSignal()` returns non-null for this craft, include it in the response as `localMarketSignal` and show it in the pricing UI as **"Real local sales: median ₹X from N sales in the last 6 months"**. It **informs** the band; it does not silently replace the AI band, and it is never shown when null |
| `src/components/CaptureModal.tsx` (price step) + `src/components/SmartDraftAssistant.tsx` | render `localMarketSignal` when present, above the AI band, labelled as the artisan's own real sales |
| `src/lib/storefrontSale.ts`, `src/components/ui/Badge.tsx`, `src/lib/shopify.ts` | as §1.3 |

### 1.6 i18n keys (all four dictionaries)

`nav_log_sale`, `log_sale_title`, `log_sale_lede`, `log_sale_speak_cta`, `log_sale_heard`,
`log_sale_pick_piece`, `log_sale_not_in_catalogue`, `log_sale_what_sold`, `log_sale_amount`,
`log_sale_quantity`, `log_sale_channel`, `channel_haat`, `channel_walk_in`, `channel_exhibition`,
`channel_middleman`, `channel_other`, `log_sale_buyer`, `log_sale_date`, `log_sale_yesterday`,
`log_sale_notes`, `log_sale_save`, `log_sale_saved`, `log_sale_another`, `log_sale_queued_offline`,
`log_sale_amount_high_warning`, `log_sale_future_date`, `log_sale_piece_already_sold`,
`earnings_stream_online`, `earnings_stream_demand`, `earnings_stream_offline`,
`earnings_total_income`, `offline_vs_online_title`, `offline_vs_online_body`,
`offline_vs_online_samples`, `offline_vs_online_not_enough`, `local_market_signal_label`,
`local_market_signal_body`, `status_sold_offline`.

### 1.7 Edge cases you must handle and be able to demonstrate

1. Artisan with **zero** offline sales → the page renders, the earnings stream shows ₹0 labelled
   "none logged yet", no comparison card, no median anywhere.
2. Exactly **1** and **2** offline sales → still no median, no comparison; the copy names the
   shortfall ("1 more sale and we can show your local median").
3. A logged sale of a piece that is **currently in a buyer's cart / paid but unshipped** → refuse
   with a clear message; `paidAt` set means the piece is spoken for.
4. Two devices logging the same piece at once → the `@unique` + transaction makes the second a `409`
   with a human message, not a 500.
5. Logged **while offline**, then the piece gets bought online before the queue drains → the replay
   gets a `409`; the queued row must be surfaced to the artisan as "could not be saved — this piece
   sold online on <date>" with the amount preserved so they can re-log it against a different piece.
   Use the existing `markAttempt()` / `lastError` machinery; do not silently drop it.
6. Amount typed with commas, ₹, spaces, or Devanagari digits → normalised before validation.
7. Deleting a row that delisted a piece, inside 24 h → the piece comes back with its **previous**
   status, not a guessed one.
8. `soldAt` in a different month from `createdAt` → it lands in the month it was **sold**, in both the
   chart and the monthly totals.

### 1.8 Verification checklist

- [ ] Log an offline sale by **voice** in Hindi ("pandrah sau rupaye ka dupatta becha") → form
      pre-filled with 1500 → save → appears in earnings as offline income
- [ ] Log one by typing, for a catalogued piece → piece disappears from `/marketplace` and from
      `/artisan/market` sellable list, badge reads "Sold offline", `AuditLog` row exists
- [ ] Earnings page shows three separately labelled streams; the total names its parts; the chart has
      a distinct offline series with a working tooltip
- [ ] With 1 offline sale: no median, no comparison, shortfall message names the number needed
- [ ] With ≥3 of one craft: median appears; the pricing step of a new capture shows
      "Real local sales: median ₹X from N sales"
- [ ] Airplane mode → log a sale → "saved on this phone" → back online → it uploads and appears
- [ ] Queued sale whose piece sold online meanwhile → surfaced as a failed row with its amount intact
- [ ] `GROQ_API_KEY` unset → voice still parses via the rule-based parser; parser unit tests pass
- [ ] All four languages; 360 px; zero console warnings

**Commit:** `feat(v12/1): hybrid income tracker — offline sale ledger, voice logging, local price signal`

---

# PHASE 2 — BUYER INTELLIGENCE ("My Buyers")

### 2.1 Why this exists

PS impact goal: *financial independence, increasing average annual income.* Knowing who buys from you
is how a business grows. The differentiator against a conventional CRM is that **the artisan types
nothing** — the buyer network is a by-product of sales that already happened.

### 2.2 Schema

One new model, so that "trending searches" is a real measurement rather than a guess:

```prisma
/// One marketplace search, recorded so demand signals are measured rather than
/// assumed.
///
/// There is no buyer account, so there is no searcher identity here and none is
/// wanted: the only question this table answers is "what are people looking for
/// this month". `ipHash` is a salted digest — the same reasoning as
/// `AffiliateClick.ipHash` — used solely to keep one person refreshing a page
/// from registering as a trend.
model MarketplaceSearch {
  id          String   @id @default(uuid())
  /// Lower-cased, trimmed, collapsed whitespace. Raw input is never stored.
  term        String
  /// How many items the search returned. A term with zero results is the most
  /// valuable row in this table: it is unmet demand.
  resultCount Int
  ipHash      String?
  createdAt   DateTime @default(now())

  @@index([term])
  @@index([createdAt])
}
```

### 2.3 Implementation

**First, note what does not exist.** `/marketplace` today has a **category** filter and a
**verified-only** toggle (see the `shown` memo in `src/app/marketplace/page.tsx`) but **no free-text
search box**, and `/api/items/market` accepts only `id` and `listed=1` — there is no `q` param to
hook into. So this phase adds the search box as well, which buyers need anyway:

- **`src/app/marketplace/page.tsx`** — add a search input beside the existing filters, in the house
  style (a `Card`-less rounded input with a `Search` icon, matching `TopBar`'s search). It filters the
  already-loaded `items` client-side across `craftType`, tags, category and artisan name (the page
  already loads the full listed set, so no new fetch). Sync the term into the URL with the existing
  `window.history.replaceState` pattern the page uses for its other filters — not `useSearchParams`.
- **`src/app/api/market/search-log/route.ts`** (POST, **public**) — body
  `{ term: string, resultCount: number }`. Normalises the term (trim, lowercase, collapse
  whitespace, clamp to 80 chars), ignores terms under 3 chars, hashes the caller IP with a salt from
  `process.env.JWT_SECRET` (write `saltedIpHash()` in `src/lib/searchLog.ts` and **also refactor
  `AffiliateClick`'s existing inline hashing to use it**, so there is one implementation), skips a
  repeat of the same `(term, ipHash)` inside 10 minutes, and writes one `MarketplaceSearch` row.
  Always returns `204` — a logging endpoint must never surface an error to a buyer.
- The page calls it **debounced at 900 ms**, only once the term has settled, only when the term is
  ≥ 3 chars, with `keepalive: true` and `.catch(() => {})`. Never on every keystroke, never blocking
  the filter (the filtering is local and instant; the log is a side effect).

**`src/app/api/artisan/buyers/route.ts`** (GET, `requireArtisan`) — the aggregation. Three sources,
unioned and keyed on a **normalised buyer identity** (`buyerName.trim().toLowerCase()`, collapse
internal whitespace) because buyers have no accounts and type their name by hand each time:

1. `CraftItem` where `artisanId` = me, `buyerName` not null, and `paidAt` not null **or** status in
   `SOLD_STATUSES` — storefront sales;
2. `ArtisanOrder` where `artisanId` = me and `settledAt` not null → `demand.buyerName` — demand
   commissions (include `demand.purchaseType`, `demand.quantity`);
3. `OfflineSale` where `artisanId` = me and `buyerName` not null — haat/walk-in buyers.

Return:

```ts
{
  success: true,
  buyers: Array<{
    key: string;             // normalised
    displayName: string;     // the most recent spelling the buyer used
    firstPurchaseAt: string;
    lastPurchaseAt: string;
    purchaseCount: number;
    totalValue: number;      // realised only — see below
    channels: ('STOREFRONT'|'DEMAND'|'OFFLINE')[];
    isRepeat: boolean;       // purchaseCount >= 2
    isB2B: boolean;          // any linked Demand.purchaseType in BULK|WHOLESALE
    items: Array<{ id?: string; title: string; amount: number; at: string; channel: string }>;
  }>,
  summary: {
    totalBuyers, repeatBuyers, b2bBuyers, repeatRatePct,
    revenueByChannel: { storefront, demand, offline },
    monthly: Array<{ month: 'YYYY-MM', buyers: number, newBuyers: number, revenue: number }>, // 12 months
    topBuyers: [...],        // top 5 by totalValue
  },
  demandSignals: {
    source: 'SEARCHES' | 'DEMANDS' | 'NONE',
    window: 30,
    terms: Array<{ term: string, count: number, zeroResultShare: number }>,
  }
}
```

Rules that matter:

- `totalValue` is **realised money only**: for storefront rows `advancePaid + finalPayoutQueued`, for
  demand rows `settledAmount`, for offline rows `amount`. Never `salePrice` on an unsettled row, and
  never an AI valuation. Label the figure "received", not "sales".
- `demandSignals.source = 'SEARCHES'` when there are ≥ 5 `MarketplaceSearch` rows in the last 30 days
  whose term matches this artisan's craft by `craftMatchScore() > 0`; terms are returned only with
  `count >= 2`. Otherwise fall back to `'DEMANDS'`: open `Demand` rows from the last 30 days scored
  against the artisan's craft with the existing `craftMatchScore()`, returned as
  `{ term: category ?? craftType, count }`. If neither has data, `'NONE'` and an empty array.
  **The UI must name the source** — "from 41 buyer searches this month" vs "from 6 open buyer
  requests" — because they mean different things and a judge will ask.
- Single query per source (three `findMany`s), aggregation in JS. Do not `findMany` per buyer.
- Cap `items` at the 10 most recent per buyer in the payload.

**`src/app/artisan/earnings/page.tsx`** — add a tab, using the existing `src/lib/urlTab.ts` helper so
the tab is deep-linkable as `/artisan/earnings?tab=buyers` and survives a reload (this is the pattern
the admin dashboards already use, and `Sidebar` supports a `tab` match). Tabs: `Money` (existing
content) · `My buyers` (new). Keep the existing page as the default tab; do not restructure it.

**`src/components/MyBuyers.tsx`** — the panel:

- Four `StatTile`s: Total buyers · Repeat buyers (with `repeatRatePct` in the `delta`) · B2B buyers ·
  Received from buyers.
- `FilterTabs`: All · Repeat · B2B · Offline.
- Buyer list as `Card as="li"` rows inside a `ul`: `Avatar` with initials, display name, channel
  `Badge`s, purchase count, received total, last purchase as a fixed-format IST date, expandable to
  the item list. `.kg-stagger` on the list.
- A "New vs repeat buyers by month" chart from `summary.monthly`, behind `next/dynamic` + `ssr:false`
  like `EarningsAnalytics`.
- A "What buyers are looking for" card from `demandSignals`, each term with its count, sorted, and a
  quiet line naming the source and window. Terms with a high `zeroResultShare` get a subtle maroon
  marker and the copy "nobody is listing this" — that is the actionable one.
- Empty state: an honest, warm panel — "Your buyer list builds itself as you sell. Nothing to show
  yet." plus a link to the marketplace listing flow. **No sample buyers.**

### 2.4 i18n keys

`buyers_tab`, `money_tab`, `buyers_title`, `buyers_lede`, `buyers_total`, `buyers_repeat`,
`buyers_b2b`, `buyers_received`, `buyers_repeat_rate`, `buyers_filter_all`, `buyers_filter_repeat`,
`buyers_filter_b2b`, `buyers_filter_offline`, `buyers_channel_storefront`, `buyers_channel_demand`,
`buyers_channel_offline`, `buyers_first_bought`, `buyers_last_bought`, `buyers_purchases`,
`buyers_empty_title`, `buyers_empty_body`, `buyers_monthly_chart_title`, `buyers_new_vs_repeat`,
`demand_signals_title`, `demand_signals_source_searches`, `demand_signals_source_demands`,
`demand_signals_none`, `demand_signals_unmet`.

### 2.5 Edge cases

1. Same buyer with different capitalisation/spacing across three purchases → **one** row, count 3,
   most recent spelling shown.
2. A storefront sale with `buyerName` null (older rows) → excluded from the buyer list but **still
   counted** in `revenueByChannel`, so the totals on this tab reconcile with the Money tab. Show a
   quiet footnote when any such rows exist: "N earlier sales have no buyer name recorded."
3. A demand order accepted but not settled → not a buyer yet; excluded from `totalValue`. Do not show
   a promise as income.
4. 300 buyers → paginate/virtualise the list (slice to 50 with a "show more"); the summary stays exact.
5. Names with Devanagari/Odia/Telugu characters → normalisation must be `toLowerCase()` +
   whitespace collapse only; **do not** strip non-ASCII, or two different buyers merge into one.
6. Search logging must survive a malformed `q` (very long string, control chars) — clamp to 80 chars.

### 2.6 Verification checklist

- [ ] `/artisan/earnings?tab=buyers` deep-links, survives reload, and the sidebar highlights correctly
- [ ] A buyer who bought twice with different capitalisation appears once with count 2
- [ ] An offline sale with a buyer name appears with the Offline channel badge
- [ ] Received totals on the Buyers tab reconcile with the Money tab (check the arithmetic by hand)
- [ ] Search the marketplace 6× for a term → it appears under "What buyers are looking for" with
      source "buyer searches"; searching a term with no results marks it unmet
- [ ] With no search rows → falls back to open-demand signals and says so
- [ ] Brand-new artisan → honest empty state, no fabricated buyers
- [ ] Gates clean, four languages, 360 px

**Commit:** `feat(v12/2): passive buyer intelligence — My Buyers tab, real search-trend signals`

---

# PHASE 3 — PRODUCTION CREDIT SCORE + BANK SHARE LINK ⭐

### 3.1 Why this exists

PS background: *financial assistance is provided* — but an unbanked artisan has no credit history, so
they fall back on a middleman's high-interest advance. Every listing, sale and fulfilled order on
Karigari is a verifiable production record. This phase turns that record into a score the artisan can
hand to a MUDRA loan officer.

**Honesty boundary, non-negotiable.** Karigari is not a credit bureau, this is not a CIBIL score, and
no bank has endorsed it. The UI must say: *"A production record, not a credit rating. Karigari does
not lend and does not decide loans."* Never render the word CIBIL. Never imply a bank has approved
anything.

### 3.2 Schema

```prisma
/// A shareable, read-only snapshot of one artisan's production record.
///
/// The snapshot is FROZEN at creation: a loan officer who opens the link a week
/// later must see the figures the artisan showed them, not a silently changed
/// set. `token` is the capability — the public page has no session and no other
/// identifier, so the token is generated with `crypto.randomUUID()` twice
/// concatenated (32 hex bytes of entropy) and is never derived from the
/// artisan's id.
///
/// Written by POST /api/artisan/credit-profile. Revoked by DELETE. Nothing else
/// writes this table.
model CreditProfileShare {
  id         String    @id @default(uuid())
  artisanId  String
  artisan    User      @relation(fields: [artisanId], references: [id])
  token      String    @unique
  /// The whole computed profile at share time, including the score, every
  /// component, the sample counts and the algorithm version.
  snapshot   Json
  /// Bumped whenever the scoring formula changes, so an old snapshot can be
  /// rendered with the caveat that the method has moved on.
  version    Int       @default(1)
  /// Who it was made for, in the artisan's words ("SBI Rourkela branch").
  sharedWith String?
  viewCount  Int       @default(0)
  lastViewedAt DateTime?
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())

  @@index([artisanId])
}
```

Add to `model User`: `creditShares CreditProfileShare[]`

### 3.3 The scoring module — `src/lib/creditScore.ts`

This is the heart of the phase. It must be a **pure, deterministic, documented** function over real
counts. No AI, no randomness, no hidden constants.

```ts
export const CREDIT_ALGO_VERSION = 1;
export const SCORE_MIN = 300;
export const SCORE_MAX = 900;
/** Below this many recorded events the score is withheld entirely. */
export const MIN_EVENTS_FOR_SCORE = 5;

export interface CreditInputs {
  verifiedListings: number;       // CraftItem qrVerified === true
  totalListings: number;
  realisedEarnings: number;       // escrow advance+final, whole rupees
  demandEarnings: number;         // ArtisanOrder.settledAmount sum
  offlineEarnings: number;        // OfflineSale.amount sum  (weighted lower — unverified)
  ordersAccepted: number;         // ArtisanOrder count
  ordersDelivered: number;        // ArtisanOrder deliveredAt/status DELIVERED|COMPLETED
  ordersOnTime: number;           // delivered where deadline == null || deliveredAt <= deadline
  activeMonths: number;           // distinct YYYY-MM with any listing/sale/order event
  accountAgeMonths: number;
  buyerVerifiedScans: number;     // ArtisanProfile.verifiedGenuineCount
  guiltyTickets: number;          // Ticket RESOLVED_GUILTY
  healthScore: number;            // ArtisanProfile.healthScore, 0..HEALTH_MAX
}

export interface CreditComponent {
  key: 'production'|'revenue'|'fulfilment'|'consistency'|'trust';
  labelKey: string;
  /** 0..weight. Never above weight, never below 0. */
  points: number;
  weight: number;
  /** The real figures behind the points, for the "how this is calculated" panel. */
  basis: Record<string, number>;
  /** True when this component had too little data and scored 0 by absence. */
  insufficient: boolean;
}

export interface CreditProfile {
  eligible: boolean;              // false when events < MIN_EVENTS_FOR_SCORE
  eventCount: number;
  score: number | null;           // null when !eligible — NEVER a default 300
  band: 'BUILDING'|'FAIR'|'GOOD'|'STRONG' | null;
  components: CreditComponent[];
  inputs: CreditInputs;
  version: number;
  computedAt: string;
}

export function computeCreditProfile(inputs: CreditInputs): CreditProfile;
```

Weighting (document each line in a comment explaining *why* it is that weight):

| Component | Weight | Basis |
|:--|:--:|:--|
| `production` | 150 | verified listings, saturating: `150 * min(1, verifiedListings / 20)`. Verified only — an unverified draft is not production |
| `revenue` | 150 | `platformRevenue = realised + demand`; `offline` counts at **0.5** weight because nobody verified it. `150 * min(1, weighted / 100000)`, log-free and saturating so a single large sale cannot max it |
| `fulfilment` | 120 | `ordersAccepted >= 3` required, else `insufficient`. `80 * (delivered/accepted) + 40 * (onTime/delivered)` |
| `consistency` | 80 | `80 * min(1, activeMonths / 12)` |
| `trust` | 100 | `60 * (healthScore/HEALTH_MAX) + 40 * min(1, buyerVerifiedScans/10)`, then subtract `25 * guiltyTickets`, floored at 0 |

`score = SCORE_MIN + sum(points)` → range 300..900. Bands: `<450 BUILDING`, `450–599 FAIR`,
`600–749 GOOD`, `≥750 STRONG`. `eventCount = verifiedListings + ordersAccepted + soldCount +
offlineSalesCount`. When `eventCount < MIN_EVENTS_FOR_SCORE`, return `eligible: false`, `score: null`
and per-component `insufficient` flags — and the UI shows a **progress-to-eligibility** panel listing
exactly what is missing, which is more useful to the artisan than a made-up 300.

Add `src/lib/__tests__/creditScore.test.mjs` (§2.11 convention) covering: all-zero input, exactly at
the eligibility boundary, a saturating input (100 listings), a guilty-ticket floor at 0, and
monotonicity — sweep one input upward across its range and assert the score never decreases.

### 3.4 Routes

- **`GET /api/artisan/credit-profile`** — gathers the inputs with one `Promise.all` of aggregate
  queries (`count`, `aggregate`, `groupBy` — no row-by-row loops), calls `computeCreditProfile`,
  returns the profile plus the artisan's active shares.
- **`POST /api/artisan/credit-profile`** — body `{ sharedWith?, expiresInDays? (default 30, max 90) }`;
  refuses when `!eligible`; freezes the snapshot; returns the absolute URL. Cap at **5 active shares**
  per artisan (revoke-then-create beyond that, with a clear message).
- **`DELETE /api/artisan/credit-profile?id=`** — sets `revokedAt`.
- **`GET /api/credit/[token]`** — **public**. Returns the frozen snapshot plus the artisan's name,
  village, craft and `photoUrl`. Increments `viewCount` / `lastViewedAt`. Returns `410 Gone` for
  revoked or expired. **Never** returns `mobileNumber`, `upiId`, `bankAccountNumber`, `aadhaarLast4`,
  `annualIncome`, `socialCategory`, `gender` or the buyer names — a share link for a bank must not
  become a PII leak. Write this exclusion as an explicit allow-list of fields, not a delete-list.

### 3.5 UI

**`src/components/CreditProfileCard.tsx`**, placed on `/artisan/dashboard` (below the trust card) and
in full on `/artisan/earnings?tab=credit`:

- A radial/arc score gauge drawn as **inline SVG** (no new dependency), 300→900, needle at the score,
  band label under it, in `--color-maroon` for the arc and `--color-rust` for the marker.
- Five component bars with their real basis figures underneath, using `ProgressBar`.
- A "How this is calculated" disclosure that prints the actual formula and the actual inputs. Judges
  will open this; it must be exact.
- The honesty line from §3.1, always visible, never in a collapsed section.
- "Share with a bank" → a small form (who for, how long) → the link, with copy-to-clipboard, a
  `react-qr-code` QR (already a dependency) so a loan officer can scan it off the artisan's phone, and
  a list of active shares with view counts and a revoke button.
- Ineligible state: the progress-to-eligibility panel. No gauge, no number.

**`src/app/credit/[token]/page.tsx`** — public, server-rendered, print-friendly:

- Header: Karigari wordmark, "Production Record", the artisan's name/village/craft/photo, the
  generation date, the expiry, and a "verified by Karigari" note that states precisely what Karigari
  verified (QR-attached pieces and settled payments) and what it did not.
- The frozen score, the components, and a table of the underlying counts.
- A print stylesheet (`@media print`) so `window.print()` produces a clean one-page A4 record —
  **this replaces a PDF; do not add a PDF library.**
- `410` state: a plain "this link has been revoked or has expired" page. No data.
- `robots` meta `noindex, nofollow`, and `export const dynamic = 'force-dynamic'`.

### 3.6 i18n keys

`credit_title`, `credit_lede`, `credit_disclaimer`, `credit_score`, `credit_band_building`,
`credit_band_fair`, `credit_band_good`, `credit_band_strong`, `credit_component_production`,
`credit_component_revenue`, `credit_component_fulfilment`, `credit_component_consistency`,
`credit_component_trust`, `credit_how_calculated`, `credit_insufficient_title`,
`credit_insufficient_body`, `credit_need_more`, `credit_share_cta`, `credit_share_for`,
`credit_share_days`, `credit_share_created`, `credit_share_copy`, `credit_share_revoke`,
`credit_share_views`, `credit_share_expired`, `credit_public_title`, `credit_public_verified_note`,
`credit_public_print`, `credit_offline_weight_note`.

### 3.7 Edge cases

1. Brand-new artisan (0 events) → ineligible panel, no score, share button disabled with a reason.
2. Exactly 5 events → eligible; check the score is sensible (low but real) and every component that
   is genuinely empty is flagged `insufficient` rather than silently scoring 0.
3. `ordersAccepted` = 0 but 12 storefront sales → fulfilment `insufficient`; score computed from the
   other four; the UI explains why one bar is grey.
4. A guilty ticket → trust component drops; verify it floors at 0 and never goes negative.
5. 100 % offline income, nothing on-platform → the score reflects the 0.5 weighting and the UI states
   that self-logged sales count for less because nobody verified them. This is the honest answer to
   the obvious judge question.
6. Revoked link, expired link, garbage token → `410` / `404`, no stack trace, no data.
7. Two shares created in the same second → distinct tokens (the uniqueness is on the token).
8. The public page must render with `GEMINI_API_KEY` absent and with no network at all — it touches no
   AI service.

### 3.8 Verification checklist

- [ ] New artisan → ineligible panel naming exactly what is missing; no number rendered
- [ ] Artisan with real history → gauge, five components, every basis figure matches a hand-checked
      query
- [ ] "How this is calculated" prints the real formula and the real inputs
- [ ] Create a share → open the link in a private window → frozen snapshot, correct expiry, view count
      increments; **no PII** in the HTML or the JSON (inspect both)
- [ ] `window.print()` gives a clean single page
- [ ] Revoke → the link returns the 410 page
- [ ] Change a sale after sharing → the shared page still shows the old figures (frozen)
- [ ] `creditScore.test.ts` passes, including the monotonicity case
- [ ] Gates clean, four languages, 360 px

**Commit:** `feat(v12/3): production credit score, frozen bank-share snapshot and public record page`

---

# PHASE 4 — BUYER DISCOVERY PAGE (the QR-scan moment) ⭐

### 4.1 Why this exists

This is what a judge sees when they scan the patch on the physical object you hand them. PS asks for
direct B2B connection; the minimalist-UI requirement applies to the **artisan's** screens, so the
buyer-facing passport is allowed to be rich. It must be beautiful, information-dense, and every claim
on it must be traceable.

Two surfaces, both enhanced, sharing components: `/verify/[patchId]` (`VerificationClient.tsx`) and
`/marketplace/product/[id]` (`ProductClient.tsx`). No schema change.

### 4.2 Section 1 — The Craft Story

New `src/components/buyer/CraftStory.tsx`, rendered on both surfaces:

- Artisan: name, `Avatar` (`photoUrl`), village (`location`), `craftType`, `experienceYears`,
  `clusterName`, and the GI label via `src/lib/giLabels.ts` when `giTagCertified` — **only** when the
  flag is actually set. A GI claim on a non-certified profile is the single most damaging thing this
  page could print.
- The making: `laborDays`, material (from `descriptionEnglish` / `aiCatalog` / `tags` — whichever is
  actually populated), `catalogMethod` + `voiceLanguage` rendered as a quiet, proud line ("Catalogued
  by voice, in Odia") because that IS the inclusion story.
- Fair pay: `artisanSharePctFor(price)` as the headline share, the `fairWageFloor` vs the listing
  price on a `ProgressBar` with a `BandMarker`, and — post-sale — what the artisan **actually
  received** (`advancePaid + finalPayoutQueued`). Pre-sale that figure is ₹0 and must be labelled
  "not yet sold", never shown as an expected payout.
- A single "what this means" disclosure explaining the 40 % / 49.36 % escrow ladder in one short
  paragraph, from the `escrow.ts` constants — never hardcoded percentages in JSX.
- Bio: `artisanProfile.description` when present. When absent, render **nothing** — the codebase
  already fixed a bug where a Rajasthani potter was described as a Pochampally weaver. Do not
  reintroduce a fallback bio.

### 4.3 Section 2 — The Product Timeline

New `src/components/buyer/ProvenanceTimeline.tsx` — a vertical stepper derived **entirely from real
timestamps and real `AuditLog` rows**:

| Step | Proof column | Rendered when |
|:--|:--|:--|
| Raw material sourced | `rawMaterialProofUrl` | non-null (show a "bill on file" chip, not the bill) |
| Handcrafted & catalogued | `createdAt` + `catalogMethod` | always |
| AI quality check | `photoQualityScore`, `photoQualitySource` | `photoQualitySource === 'AI'` |
| Admin verified | `AuditLog` row with the approval action | that row exists |
| QR patch attached & matched | `qrVerifiedAt`, `qrVerifiedImageUrl` | `qrVerified` |
| Listed | `isListedOnMarketplace`, `syndicatedAt`, `shopifyPublishedAt` | whichever are set |
| Paid (escrow held) | `paidAt` | non-null |
| Packed / Dispatched / Delivered | `packedAt` / `dispatchedAt` / `deliveredAt` | each, non-null |

Rules: a step with no timestamp renders as **pending** (grey, no date) — never as complete, never with
a guessed date. Dates use the existing `STAMP_FORMAT` (IST, explicit) to stay hydration-safe. Reuse
`OrderTimeline` / `ProgressStepper` if they fit; extend rather than fork. If `qrExemptAt` is set,
that step must read "QR check waived (demo catalogue)" — **not** as passed. That column exists
precisely so a waiver stays distinguishable from a pass; honour it.

### 4.4 Section 3 — Authenticity, framed as three layers

Replace any copy that implies the AI authenticates the craft. The correct framing, and the one to
print:

1. **Human capture** — an SHG/field volunteer or the artisan recorded the piece at the workshop
   (timestamped, and geotagged where available).
2. **Admin review** — a facilitator approved the listing before it went live.
3. **AI consistency check** — Gemini Vision confirms the delivered piece matches the original
   capture, and reports a **similarity score**, which is what it actually is.

Show the real `similarityScore` when a verification has run (`Demand.deliveryScanScore`, or the
buyer-scan result), labelled "image similarity", with the comparison reference being
`originalImageUrl` via `provenanceReference()` — never the enhanced or preset look. Do not print an
accuracy percentage for the model anywhere. Do not use the words "authenticated by AI".

### 4.5 Section 4 — "Want something similar?"

- On both surfaces, a card that opens `PostDemandModal` **prefilled** from this item:
  `craftType`, `category` (via `categoryFor()`), `productType`, `material`, `color`, and one reference
  image (`images[0]`) — so the buyer's request starts from the thing they are looking at.
- `PostDemandModal.tsx` must gain an optional `initial?: Partial<DemandDraft>` prop. Default it to
  `{}` so every existing call site is untouched. The prefill must be **editable**; nothing is
  silently submitted.
- On submit, the existing `/api/demand` route already fans out via `notifyArtisansForDemand()` — do
  not duplicate that logic. After success, show what happened truthfully: "N artisans who make this
  were notified" using the real `created` count from the fanout response, or "no artisan match yet —
  your request is on the board" when it is 0.
- Also add a "more from this artisan" rail: up to 6 of the same artisan's other listed pieces, real
  rows from `/api/items/market`, horizontally snapped (`.kg-rail`), hidden entirely when there are
  none.

### 4.6 Presentation quality

- **Image gallery.** Real `images[]` plus `imageVariants.variants` thumbnails; keyboard-navigable
  (arrow keys), swipeable, with a main frame and a thumb strip. `unoptimized` on data URLs, empty-src
  guarded via `imageProps()`. No lightbox library — a simple full-width modal in the house style.
- **A dark hero is allowed, a dark theme is not.** Use `Card tone="primary"` / `DarkCard` for a
  premium charcoal hero band. Do **not** add a `prefers-color-scheme` fork or a second token set —
  that would fracture the design system across the rest of the app. If the human explicitly asks for a
  dark-mode toggle later, that is its own phase.
- Motion via `.kg-enter` / `.kg-stagger` / `.kg-lift` only, so `prefers-reduced-motion` keeps working.
- Performance: the passport is opened on a judge's phone on conference wifi. Keep it server-rendered
  where it already is, lazy-load the gallery beyond the first image, and do not add a chart to this
  page.
- SEO/meta on the product page: real title/description from the item; `noindex` on `/verify/[patchId]`
  (it is a per-object page, not content).

### 4.7 i18n keys

`story_title`, `story_made_by`, `story_village`, `story_craft`, `story_experience`,
`story_catalogued_by_voice`, `story_labor_days`, `story_material`, `story_fair_share`,
`story_fair_floor`, `story_artisan_received`, `story_not_yet_sold`, `story_escrow_explainer`,
`timeline_title`, `timeline_pending`, `timeline_material_sourced`, `timeline_crafted`,
`timeline_ai_quality`, `timeline_admin_verified`, `timeline_qr_attached`, `timeline_qr_waived`,
`timeline_listed`, `timeline_paid`, `timeline_packed`, `timeline_dispatched`, `timeline_delivered`,
`trust_layers_title`, `trust_layer_human`, `trust_layer_admin`, `trust_layer_ai`,
`trust_similarity_label`, `similar_request_title`, `similar_request_body`, `similar_request_cta`,
`similar_request_notified`, `similar_request_no_match`, `more_from_artisan`.

### 4.8 Edge cases

1. An item with **one** image, no variants, no bill, no QR, never sold → the page still reads as a
   complete, honest passport. Every absent thing is absent, not faked.
2. An artisan profile with no photo, no bio, no cluster → no empty cards, no placeholder text.
3. `qrExemptAt` set → the waiver wording, not a green tick.
4. A sold piece → received figure real; buy button gone; status badge correct.
5. A demand posted from the page when Gemini is down → the demand still saves (the matcher degrades),
   and the confirmation says what really happened.
6. `patchId` that does not exist → the existing `notFound()`; a patch whose item was deleted → same.
7. Very long artisan bio / craft name → clamped with `line-clamp`, no layout break at 360 px.
8. Data-URL images of 2–3 MB → the gallery must not freeze; render the thumbnail from
   `imageVariants.thumb` when available.

### 4.9 Verification checklist

- [ ] Scan a real patch QR on a phone → passport loads under 3 s on a throttled connection, hero +
      story + timeline + gallery all correct
- [ ] Timeline: pending steps are grey and dateless; completed steps show real IST timestamps that
      match the DB
- [ ] An item with `qrExemptAt` shows "waived", not "verified"
- [ ] Fair-pay block: pre-sale shows ₹0 received labelled "not yet sold"; post-sale matches
      `advancePaid + finalPayoutQueued`
- [ ] No string anywhere claims AI authentication or a model accuracy figure
- [ ] "Want something similar?" prefills, is editable, posts, and reports the **real** notified count
- [ ] "More from this artisan" hides when empty
- [ ] Gallery keyboard + swipe; reduced-motion respected; zero hydration warnings in the console
- [ ] Gates clean, four languages, 360 px

**Commit:** `feat(v12/4): buyer discovery page — craft story, provenance timeline, 3-layer trust, similar-request`

---

# PHASE 5 — AI LEARNING PATHWAYS (skill stages, offline cache)

### 5.1 Why this exists

PS impact goal: *"improve digital literacy."* A direct hit. `/artisan/learn` already exists with
masterclass prompt cards and the docked assistant; this phase adds **three tracks**, a **real skill
stage computed from the artisan's own record**, and **offline availability**.

Read `src/app/artisan/learn/page.tsx` first and preserve its two deliberate design decisions
(documented in its header comment): masterclass cards do **not** pre-fetch videos, and "Active
Assignments" are the artisan's real outstanding work. Do not break either.

### 5.2 Schema

```prisma
/// One learning item the artisan marked done, and one recommendation set cached
/// for them.
///
/// Progress is stored, skill stage is NOT: the stage is derived from the
/// artisan's production record on every read (see src/lib/skillStage.ts), so it
/// can never drift out of step with the sales and listings it claims to
/// summarise. Storing it would create a second source of truth for a number
/// already knowable.
model LearningProgress {
  id         String   @id @default(uuid())
  artisanId  String
  artisan    User     @relation(fields: [artisanId], references: [id])
  /// Stable key: `track:slug` — e.g. `business:pricing-basics`. Never a title,
  /// which is translated and would not match across languages.
  moduleKey  String
  /// STARTED | COMPLETED. Presence of COMPLETED is what the progress bar counts.
  status     String   @default("STARTED")
  updatedAt  DateTime @updatedAt
  createdAt  DateTime @default(now())

  @@unique([artisanId, moduleKey])
  @@index([artisanId])
}
```

Add to `model User`: `learningProgress LearningProgress[]`

### 5.3 `src/lib/skillStage.ts` — derived, real, and explained

```ts
export type SkillStage = 'BEGINNER' | 'INTERMEDIATE' | 'PRO';
export interface StageInputs {
  verifiedListings: number;
  itemsSold: number;
  realisedEarnings: number;
  ordersDelivered: number;
  modulesCompleted: number;
}
export interface StageResult {
  stage: SkillStage;
  /** 0..1 toward the NEXT stage. 1 when already PRO. */
  progress: number;
  /** The concrete, real gaps — "3 more verified listings", "₹12,000 more in sales". */
  nextRequirements: Array<{ labelKey: string; have: number; need: number }>;
}
export function resolveSkillStage(i: StageInputs): StageResult;
```

Thresholds (all-of, not any-of, so the stage means something):

| Stage | Requires |
|:--|:--|
| BEGINNER | default |
| INTERMEDIATE | ≥ 5 verified listings **and** ≥ 1 sale |
| PRO | ≥ 20 verified listings **and** ≥ 10 sales **and** ≥ ₹50,000 realised **and** ≥ 3 modules completed |

`progress` is the **minimum** of the per-criterion ratios (so it reflects the binding constraint, not
an average that flatters). `nextRequirements` lists only the unmet criteria, with real have/need
numbers. The badge in the UI shows the stage; tapping it shows the requirements. **No fake percentage
bar.**

Reuse this stage in Phase 9 (badges) and on the marketplace credibility chip — compute it in one
place.

### 5.4 Recommendations — real links, never fabricated videos

**`src/app/api/artisan/learning-recommendations/route.ts`** (GET, `requireArtisan`, cached):

- Inputs: `craftType`, `clusterName`, resolved `skillStage`, and the artisan's real gaps (drafts
  unfinished, patches unattached, profile fields blocking scheme eligibility — the same signals
  `/artisan/learn` already reads).
- Three tracks, 3–4 items each: `business` (pricing, packaging, customer handling, bulk orders),
  `design` (motifs, colour, finishing, fusion), `digital` (using the phone, UPI, reading an order,
  answering a buyer).
- AI path: Groq (`groqChatJSON`) or Gemini returns, per item,
  `{ title, whyItHelps, searchQuery, track, level }`. Temperature ≤ 0.3.
- **Absolutely no video IDs, channel names, durations, view counts or thumbnails may be generated.**
  A hallucinated YouTube ID is a dead embed in front of a judge. Each card links out to
  `https://www.youtube.com/results?search_query=<encoded searchQuery>` and opens in a new tab with
  `rel="noopener noreferrer"`. The card's art is a lucide icon + a token-coloured block, not a
  fake thumbnail.
- Fallback path (no AI key, or an AI error): a **curated, committed** table in
  `src/lib/learningCatalog.ts` — hand-written `{ track, level, titleKey, searchQuery }` entries
  parameterised by craft family via the existing `familiesForCraft()` in `suppliers.ts`. These are
  real search queries written by a human (you), which is honest, and they are i18n keys so they
  translate. The response marks `source: 'AI' | 'CURATED'` and the UI says which.
- Response shape: `{ success, source, generatedAt, stage, tracks: { business: [...], design: [...],
  digital: [...] } }`.

### 5.5 Offline cache

- New `src/lib/learningCache.ts` using `idb` (already a dependency), its **own** database
  (`karigari-learning`, version 1) so it cannot interfere with the capture outbox's version history.
- Store the last recommendation payload with `generatedAt`. On page load: render the cached payload
  immediately if present, then revalidate in the background; if the fetch fails, keep the cached one
  and show "saved on this phone · generated <date>".
- TTL 7 days for revalidation urgency, but **never** discard a stale entry while offline — stale
  content beats an empty page in a village with no signal.
- Wrap every IndexedDB call in try/catch (it throws in some private modes) and degrade to
  memory-only.

### 5.6 UI changes to `src/app/artisan/learn/page.tsx`

- Header gains the skill-stage chip (`Badge`) + a `ProgressBar` toward the next stage, with the
  `nextRequirements` list in a disclosure.
- Three track sections (`SectionHeading` + `.kg-rail` of cards), each card: track label, title, "why
  this helps you" line, a `level` pill, an outbound "Watch on YouTube" link, and a "Mark as done"
  toggle writing `LearningProgress`.
- Keep the existing masterclass cards and Active Assignments exactly as they are; the new tracks go
  **below** the masterclasses and **above** assignments.
- A source/freshness footnote: "Suggestions generated by AI for your craft" or "Standard suggestions
  for <craft family>", plus the offline note when served from cache.
- Empty/degraded: if both AI and cache are unavailable on a first-ever visit, the curated fallback
  still renders — this page can never be blank.

### 5.7 i18n keys

`learn_stage_beginner`, `learn_stage_intermediate`, `learn_stage_pro`, `learn_stage_progress`,
`learn_stage_next_title`, `learn_need_listings`, `learn_need_sales`, `learn_need_earnings`,
`learn_need_modules`, `learn_track_business`, `learn_track_design`, `learn_track_digital`,
`learn_why_helps`, `learn_watch_youtube`, `learn_mark_done`, `learn_done`, `learn_source_ai`,
`learn_source_curated`, `learn_offline_cached`, `learn_level_basic`, `learn_level_growing`,
`learn_level_advanced`, plus one `titleKey` per curated catalogue entry (name them
`learn_cat_<track>_<slug>`).

### 5.8 Edge cases

1. New artisan, no craft type set → recommendations fall back to the generic craft family; the stage
   is BEGINNER with all four requirements listed.
2. AI returns 5 items for one track and 0 for another → pad from the curated catalogue; never render
   an empty track section.
3. AI returns a `searchQuery` with unsafe characters → encode; strip control chars; cap at 120 chars.
4. Marking a module done twice / from two tabs → `@@unique` upsert, idempotent.
5. Offline first visit ever → curated content renders, marked as standard suggestions.
6. IndexedDB blocked → page works, no cache note shown, no console error beyond one `console.warn`.
7. Stage boundary: exactly 5 listings + 1 sale → INTERMEDIATE (inclusive thresholds); verify the
   progress value is 1.0 at the boundary, not 0.99.

### 5.9 Verification checklist

- [ ] Stage chip matches a hand-counted query of the artisan's verified listings and sales
- [ ] Tapping the chip lists the real unmet requirements with correct have/need numbers
- [ ] All three tracks render; every "Watch on YouTube" link opens a real search results page
- [ ] No fabricated thumbnails, durations, channels or video IDs anywhere in the DOM
- [ ] Mark done → persists across reload; progress toward PRO updates
- [ ] Unset both AI keys → curated content renders, labelled "standard suggestions"
- [ ] Load once online, go offline, reload → cached content with the "saved on this phone" note
- [ ] Gates clean, four languages, 360 px

**Commit:** `feat(v12/5): AI learning pathways — derived skill stages, three tracks, offline cache`

---

# PHASE 6 — PROACTIVE SUPPLY INTELLIGENCE (the 20-day reminder)

### 6.1 Why this exists

PS calls the app a *"virtual business manager."* A business manager notices when you have stopped
producing. If an artisan has not catalogued anything in 20 days, nudge them toward verified raw
material and toward credit, in their own language.

**There is no cron infrastructure in this repo and you must not invent one** (no Vercel cron file, no
`setInterval` in a module, no external scheduler). The established pattern is a **lazy, idempotent,
dedupe-then-create** check performed on a request the artisan is already making — exactly what
`notifyArtisanOfFestival()` does, called from `/api/artisan/insights`. Copy that pattern.

### 6.2 Schema

```prisma
/// When an artisan was last nudged about restocking, and when they last asked
/// to be left alone.
///
/// A row per artisan, created on first evaluation. Kept out of ArtisanProfile
/// because it is scheduler bookkeeping rather than anything about the artisan,
/// and because a "remind me later" must not touch a profile row that scheme
/// eligibility reads.
///
/// Written only by src/lib/supplyReminder.ts.
model SupplyReminderState {
  id            String    @id @default(uuid())
  artisanId     String    @unique
  artisan       User      @relation(fields: [artisanId], references: [id])
  lastRemindedAt DateTime?
  /// Set by "remind me later"; no reminder is written while this is in the
  /// future. Presence, not a boolean, so the snooze expires by itself.
  snoozedUntil  DateTime?
  remindCount   Int       @default(0)
  updatedAt     DateTime  @updatedAt
}
```

Add to `model User`: `supplyReminderState SupplyReminderState?`

### 6.3 `src/lib/supplyReminder.ts`

```ts
/** Days of no new catalogue entry before the artisan is nudged. */
export const SUPPLY_IDLE_DAYS = 20;
/** Never nudge an account younger than this — a new artisan is not "idle". */
export const MIN_ACCOUNT_AGE_DAYS = 21;
/** Minimum gap between two reminders, so this can never become nagging. */
export const REMINDER_COOLDOWN_DAYS = 14;
/** How long "remind me later" lasts. */
export const SNOOZE_DAYS = 7;

export interface SupplyCheckResult {
  created: boolean;
  reason: 'CREATED' | 'ACTIVE' | 'TOO_NEW' | 'COOLDOWN' | 'SNOOZED' | 'NO_PROFILE';
  idleDays: number | null;
  lastActivityAt: Date | null;
}

/** Idempotent. Safe to call on every dashboard load. */
export async function checkSupplyReminder(artisanId: string): Promise<SupplyCheckResult>;
export async function snoozeSupplyReminder(artisanId: string): Promise<void>;
```

`lastActivityAt` = the **latest** of: newest `CraftItem.createdAt`, newest `OfflineSale.soldAt`
(Phase 1 — an artisan selling at haats every week is not idle), newest `ArtisanOrder.createdAt`. Use
three `findFirst({ orderBy: desc, select: { … } })` queries in one `Promise.all`, not a full scan.

Notification row: `type: 'SUPPLY_REMINDER'`, `channel: 'IN_APP'`, English `title`/`message` (the
existing DB convention), deduped the way the festival path does — `findFirst` on
`{ userId, type, createdAt: { gte: cooldownCutoff } }` before creating.

### 6.4 Vernacular rendering

Notification text is stored in English (every existing row is). Do **not** change that convention.
Instead add a client-side translation layer for the new type:

- In `src/components/NotificationsBell.tsx` and `src/app/artisan/notifications/page.tsx`, when
  `type === 'SUPPLY_REMINDER'`, render `t('notif_supply_title')` / `t('notif_supply_body')` with
  `{days}` interpolated from `idleDays` — falling back to the stored English string if the key is
  missing. Store `idleDays` in the message text in a parseable way, or better: since `Notification`
  has no params column, put the number in the title (`"No new listing in 23 days"`) and parse it with
  a tight regex, with the raw string as fallback. Document the choice in a comment.
- Two actions on the notification: **"Browse suppliers"** → `/artisan/materials` (which becomes
  `/artisan/workshop` in Phase 8 — if Phase 8 is already done, link there and rely on its redirect
  either way) and **"See credit schemes"** → `/artisan/schemes`. Plus **"Remind me later"** →
  `POST /api/artisan/supply-reminder` with `action: 'snooze'`.

### 6.5 Wiring

- `src/app/api/artisan/dashboard/route.ts` — call `checkSupplyReminder()` once per request,
  **fire-and-forget and never blocking**: `void checkSupplyReminder(artisanId).catch(() => {})`. It
  must not add latency to the dashboard or fail the response. Also return
  `supplyStatus: { idleDays, lastActivityAt }` so the dashboard can show an inline nudge card without
  waiting for the bell.
- New `src/app/api/artisan/supply-reminder/route.ts` — `GET` returns the current
  `SupplyCheckResult`; `POST { action: 'snooze' }` snoozes.
- `src/app/artisan/dashboard/page.tsx` — when `idleDays >= SUPPLY_IDLE_DAYS`, show one calm
  `Card tone="muted"` nudge above the captures list with the two links and a dismiss. Not a modal.
  Not red. This is a helpful reminder, not an alarm.

### 6.6 i18n keys

`notif_supply_title`, `notif_supply_body`, `supply_nudge_title`, `supply_nudge_body`,
`supply_nudge_browse_suppliers`, `supply_nudge_schemes`, `supply_nudge_snooze`,
`supply_nudge_dismiss`, `supply_nudge_days`.

### 6.7 Edge cases

1. Account created 3 days ago with zero listings → **no** reminder (`TOO_NEW`). Verify by backdating a
   test user's `createdAt`.
2. Idle 25 days, reminded yesterday → `COOLDOWN`, no second row.
3. Snoozed → nothing for 7 days, then it may fire again.
4. Idle on listings but logged 4 offline sales last week → **not** idle. This is the case that proves
   the feature understands the artisan's real life.
5. Ten dashboard loads in a minute → exactly **one** notification row. Test it.
6. A draft started but never submitted → `CraftItem.createdAt` exists, so they count as active. That
   is correct: they are working.
7. No `ArtisanProfile` (incomplete registration) → `NO_PROFILE`, no reminder, no crash.

### 6.8 Verification checklist

- [ ] Backdate a test artisan's newest item to 25 days ago → reload dashboard → exactly one
      notification + the inline nudge card
- [ ] Reload ten more times → still one row (check with a count query)
- [ ] Snooze → nudge and notification gone; backdate `snoozedUntil` → it returns
- [ ] Log an offline sale → nudge disappears (activity is activity)
- [ ] New account → never nudged
- [ ] Notification renders translated in all four languages, with the day count correct
- [ ] Dashboard response time unchanged (the check is fire-and-forget) — measure it
- [ ] Gates clean

**Commit:** `feat(v12/6): proactive supply intelligence — idempotent 20-day restock reminder`

---

# PHASE 7 — SYNC STATUS INDICATOR ("Synced 2 min ago")

### 7.1 Why this exists

Small UI, large credibility. A rural user needs to know their work is safe. Today the header shows
`OfflineQueueBadge`, which is deliberately **silent** when everything is fine. That is right for a
queue count, but it means the artisan never gets the reassurance of "your work is saved". Add a
persistent, quiet status chip.

No schema change.

### 7.2 Implementation

**`src/lib/offlineQueueStore.ts`** — extend `OfflineQueueState` with:

```ts
/** Epoch ms of the last confirmed round-trip to the server. Null before any. */
lastSyncedAt: number | null;
/** Set when a flush attempt failed, so the chip can say so. Cleared on success. */
lastSyncError: string | null;
```

Persist `lastSyncedAt` to `localStorage` under `karigari_last_synced` so it survives a reload (wrap
in try/catch — the file already documents that `localStorage` throws in private mode). Add
`markSynced()` / `markSyncError(msg)` setters. Keep `SERVER_SNAPSHOT` in sync with the new fields or
`useSyncExternalStore` will warn.

**Who calls `markSynced()`:**
- `flushQueue()` in `src/lib/offlineSync.ts`, on a successful drain — including a drain with nothing
  to send, because a successful reachability check is still proof of a live connection;
- `NotificationsBell`'s `load()` in its success path. Note what the code actually does: the bell
  fetches **once on mount** (deferred `setTimeout(load, 0)`) and has **no polling timer** —
  `src/lib/pollingIntervals.ts` exports only `ADMIN_POLL_MS`, used on the admin side. So this gives
  you one confirmed round-trip per navigation, which is the right granularity.
- **Do not add a new polling timer anywhere.** The chip's job is to report the freshness of the last
  confirmed round-trip, not to manufacture one. The 30 s interval in the chip re-renders the
  *relative string* only; it makes no network request.

**`src/components/SyncStatusChip.tsx`** — the chip, placed in `TopBar` immediately left of
`LanguageMenu` (keep `OfflineQueueBadge` where it is; the two are complementary — count vs freshness,
and the badge stays silent when idle):

| State | Icon | Copy | Tone |
|:--|:--|:--|:--|
| offline | `CloudOff` | "Offline — N saved on phone" / "Offline" | `amber-50` / `amber-800` / `amber-200` border |
| syncing | `RefreshCw` spinning | "Syncing…" | `--color-mint` / primary |
| synced | `CloudCheck` (or `CheckCircle2`) | "Synced <relative>" | `--color-green-50` / `green-700` |
| error | `CloudAlert` (or `AlertTriangle`) | "Not synced — retry" (tappable → `flushQueue()`) | `red-50` / `red-700` |

**Hydration safety is the whole trick here.** A relative time cannot be server-rendered. So:

- render a neutral `"—"` / the icon only on the server and on the first client paint;
- fill in the relative string inside the deferred-`setTimeout(…, 0)` effect the codebase uses;
- refresh it on a 30 s interval, cleared on unmount;
- put the relative formatter in `src/lib/relativeTime.ts` as a pure function
  `relativeKeyAndValue(ms: number): { key: string; value: number }` returning an **i18n key + number**
  (`rel_just_now`, `rel_minutes`, `rel_hours`, `rel_days`) — never an English string, and never
  `Intl.RelativeTimeFormat` with an implicit locale.
- On desktop show the full label; below `sm` show the icon only, with the label in `aria-label` and
  `title` (same responsive approach `OfflineQueueBadge` already takes).
- `role="status"` + `aria-live="polite"`, and the error state `role="alert"`.

### 7.3 Demo affordance

Add nothing fake, but make the live demo easy: the chip's tooltip states plainly what is cached
(catalogue browsing, a started listing, a voice note, a logged offline sale) so when the presenter
turns off wifi the screen itself explains what is happening. Also confirm `/offline` (the existing
offline fallback page) links back sensibly and mentions the queue.

### 7.4 i18n keys

`sync_offline`, `sync_offline_with_count`, `sync_syncing`, `sync_synced`, `sync_error`,
`sync_retry`, `sync_tooltip`, `rel_just_now`, `rel_minutes`, `rel_hours`, `rel_days`.

### 7.5 Edge cases

1. First ever load, never synced → chip shows the online/offline state without a time, not
   "Synced NaN ago".
2. Clock skew / a `lastSyncedAt` in the future → clamp to "just now".
3. `localStorage` unavailable → chip still works, just resets on reload.
4. Offline with 0 queued vs offline with 3 queued → two different strings.
5. Flush fails with a 500 → error state, tappable retry, and `lastSyncError` cleared on the next
   success.
6. Rapid online/offline toggling → no duplicate flushes (the existing single-flight guard in
   `OfflineSyncProvider` already covers this; verify it still holds).
7. Zero console warnings from `useSyncExternalStore` — if you added a field to the state you must add
   it to the server snapshot too.

### 7.6 Verification checklist

- [ ] Chip reads "Synced just now" after a load, then "Synced 2 min ago" without a reload
- [ ] Airplane mode → amber offline state with the queued count; queue something → count rises
- [ ] Back online → "Syncing…" → "Synced just now"; the queued item uploads
- [ ] Hard reload → the last-synced time is remembered
- [ ] **Zero hydration warnings** in the console on every page (this is the one that usually breaks)
- [ ] 360 px → icon-only with a correct `aria-label`
- [ ] Gates clean, four languages

**Commit:** `feat(v12/7): persistent sync status chip with hydration-safe relative time`

---

# PHASE 8 — WORKSHOP RESOURCES (rename + tool/repair help + equipment schemes)

### 8.1 Why this exists

Middleman dependency is not only about markets — it is about tools, spare parts and dye. Rename the
Raw Materials tab to **Workshop Resources** and make it cover the whole supply side: materials,
repair and tooling help, and the government schemes that actually fund equipment.

**The honesty problem, and its solution.** There is no verified directory of loom-repair shops in
India that this project has access to, and **you must not invent one**. Instead:
1. Materials stay as they are — the existing curated + AI-sourced list, which already carries its
   `sample: true` caveat and says so on screen. Do not remove that caveat.
2. Repair/tooling becomes a **cluster request**, using the real `ResourceRequest` model: "I need my
   loom reed repaired" is broadcast to the artisan's own cluster, where someone genuinely knows a
   person. That is real, working, and truer to how this actually happens in a village.
3. AI may **suggest search directions** (what to ask for, typical local terms, what a fair rate looks
   like in the artisan's own words) but every AI suggestion is labelled and no business name or phone
   number is ever generated.
4. Equipment **schemes** are real, sourced, and cited.

### 8.2 Route rename — with a redirect, not a break

- Move `src/app/artisan/materials/` → `src/app/artisan/workshop/` (`page.tsx` + `loading.tsx`).
- Add a permanent redirect in `next.config.ts` `redirects()`:
  `{ source: '/artisan/materials', destination: '/artisan/workshop', permanent: true }`.
  Read the existing `next.config.ts` first — it is 208 lines, wraps the config in the
  `@ducanh2912/next-pwa` initialiser, and currently has **no** `redirects()`, so you are adding the
  key. Make sure you add it to the object that is actually passed through the PWA wrapper, not to a
  copy, and verify the redirect with `curl -I` after restarting.
- `src/components/ui/Sidebar.tsx` → change the entry's `href` to `/artisan/workshop` and its `label`
  to a **new** key `nav_workshop_resources`. **Leave `nav_raw_materials` in all four dictionaries** —
  grep first; other surfaces may use it.
- Grep the whole of `src/` for `'/artisan/materials'` and fix every link (the voice assistant's route
  table in `src/app/api/voice-assistant/route.ts` and `VoiceOnboarding.tsx` very likely contain one;
  Phase 6's nudge does too).

### 8.3 Page structure — `src/app/artisan/workshop/page.tsx`

`PageTitle` "Workshop Resources", and a `SegmentedToggle`/`FilterTabs` of four sections, tab state via
`src/lib/urlTab.ts` so each is deep-linkable:

1. **Materials** — the existing content, untouched in behaviour (keep the Restock/Bulk sub-toggle, the
   curated+AI merge, the degraded-AI notice and the sample caveat).
2. **Repair & tooling** — new, §8.4.
3. **Equipment funding** — new, §8.5.
4. **Scrap & waste** — a placeholder section header only in this phase; Phase 12 fills it. If Phase 12
   is not yet run, **do not render an empty tab** — render it only when the Phase 12 code exists.
   (Simplest: add the tab in Phase 12.)

### 8.4 Repair & tooling

**`src/app/api/artisan/tooling/route.ts`** (GET):

- Resolves the artisan's cluster key (§2.10 rule 9) and returns:
  - open `ResourceRequest` rows in that cluster whose `resourceName` matches a tooling term, so the
    artisan sees who nearby needs and offers what;
  - an AI "what to ask for" brief: given `craftType` + `location`, Groq/Gemini returns
    `{ commonFaults: [{ part, symptom, whoFixesIt }], localTerms: [string], questionsToAsk: [string],
    typicalCostBand: { low, high, note } | null }`. **`typicalCostBand` must be `null` unless the
    model can name a basis, and the UI must label it "AI estimate — verify locally".** No shop names,
    no phone numbers, no addresses — instruct the model explicitly and **strip** any digit sequence
    of 6+ characters and any `@`/URL from the output server-side as a hard guard.
  - `source: 'AI' | 'CURATED'`, with a curated per-craft-family fallback table in
    `src/lib/toolingGuide.ts` (hand-written, i18n keys, no invented businesses).

**UI:**
- "Ask my cluster" primary action → posts a `ResourceRequest` via the existing
  `/api/artisan/resource-request` route with `resourceName` prefixed/typed as a tooling need. Reuse
  the cluster page's request component if one exists; otherwise a small form in the house style.
  Show the real count of cluster members it will reach (from `/api/artisan/cluster-members`), and when
  that count is 0 say so honestly and suggest adding an SHG link to their profile.
- The AI brief as a `Card tone="muted"` with the label and the caveat.
- Cross-link: "Need to buy a tool instead?" → the Equipment funding tab.

### 8.5 Equipment funding — real schemes, cited or hidden

`src/lib/schemes.ts` currently ships six schemes: `pm_vishwakarma`, `nsfdc`, `nbcfdc`, `gem_seller`,
`ahvy`, `ondc`. Equipment-focused schemes (PMEGP, MUDRA, SFURTI) are **not** in there yet.

Do this, carefully:

1. Extend the `Scheme` interface with:
   ```ts
   /** True when this scheme's primary use is buying or repairing equipment. */
   equipmentFunding?: boolean;
   /** The official page the figures came from. Required for any new scheme. */
   sourceUrl?: string;
   /** ISO date the figures were last checked against `sourceUrl`. */
   verifiedOn?: string;
   ```
   Backfill `equipmentFunding: true` on `pm_vishwakarma` (its toolkit component) — check its existing
   entry first and only claim what its own rule set already claims.
2. Add `pmegp`, `mudra`, `sfurti` to the `SchemeKey` union and to `SCHEMES`, each with real
   eligibility `Rule`s in the existing `Rule` shape, wired into `evaluateAllSchemes()` and
   `resolveLegacySchemeKey()`.
3. **Every figure must be fetched and cited.** Use `WebFetch` on the official portal
   (`kviconline.gov.in` / `www.mudra.org.in` / `sfurti.msme.gov.in` and the MSME/MoSJE scheme pages),
   put the URL in `sourceUrl` and today's date in `verifiedOn`, and use the figures **you actually
   read there**.
4. **If a fetch fails or a figure cannot be confirmed, do not guess.** Either omit that field (and let
   the UI render the scheme without an amount) or set `verifiedOn: null` and have
   `evaluateAllSchemes()` exclude unverified schemes from the artisan-facing list entirely. Write this
   rule into the code as a guard, not as a comment. **A wrong loan figure in front of a ministry judge
   is the worst possible outcome of this phase.**
5. Add a `verify:schemes` case to the existing `scripts/verify-schemes.ts` that asserts every scheme
   with a money figure has a `sourceUrl` and a `verifiedOn`, and fails the script otherwise. Run it.

**UI:** the Equipment funding tab lists `evaluateAllSchemes(ctx).filter(s => s.equipmentFunding)`
using the **existing** scheme card components from `/artisan/schemes` (import them; do not fork the
rendering), with the existing eligibility checker and `SchemeFormAssistant` wired up unchanged, plus
the source citation and check date printed on each card. Keep `/artisan/schemes` working exactly as
before — the new schemes appear there too, which is correct.

### 8.6 i18n keys

`nav_workshop_resources`, `workshop_title`, `workshop_lede`, `workshop_tab_materials`,
`workshop_tab_repair`, `workshop_tab_funding`, `repair_title`, `repair_lede`, `repair_ask_cluster`,
`repair_cluster_reach`, `repair_no_cluster`, `repair_add_shg_hint`, `repair_common_faults`,
`repair_local_terms`, `repair_questions`, `repair_cost_band`, `repair_cost_caveat`,
`repair_ai_label`, `repair_curated_label`, `repair_open_requests`, `funding_title`, `funding_lede`,
`funding_source`, `funding_checked_on`, `funding_none_eligible`, plus keys for every curated tooling
entry (`tooling_<family>_<slug>`).

### 8.7 Edge cases

1. Old bookmark / QR / voice command to `/artisan/materials` → redirects, does not 404.
2. Artisan with no cluster (no SHG link, unique location) → cluster reach 0, honest message, the
   materials and funding tabs still fully useful.
3. AI returns a phone number anyway → the server-side strip removes it. **Test this deliberately** by
   stubbing the model output.
4. No equipment scheme is eligible for this artisan → the tab explains which requirement blocks each
   one, using the existing `RuleFailure` machinery, rather than showing nothing.
5. `WebFetch` blocked in the environment → schemes without verified figures are hidden and the tab
   says a source could not be confirmed. The page must not display an unverified amount.
6. Deep-link `/artisan/workshop?tab=funding` works and the sidebar highlight is right.

### 8.8 Verification checklist

- [ ] `/artisan/materials` → 308 redirect to `/artisan/workshop`; no dead links anywhere (grep proves it)
- [ ] Materials tab behaves exactly as before, sample caveat intact
- [ ] "Ask my cluster" creates a real `ResourceRequest` visible on `/artisan/cluster` to another
      member of the same cluster
- [ ] AI brief renders with its label and caveat; with keys unset the curated guide renders instead
- [ ] Stubbed AI output containing "call 9876543210" → the number is stripped before render
- [ ] Every equipment scheme card shows a `sourceUrl` and a check date; `npm run verify:schemes` passes
- [ ] An ineligible scheme explains the blocking rule
- [ ] Gates clean, four languages, 360 px

**Commit:** `feat(v12/8): workshop resources — route rename, cluster-sourced repair help, cited equipment schemes`

---

# PHASE 9 — RECOGNITION & ANONYMOUS CLUSTER BENCHMARKS

### 9.1 Why this exists

Retention and motivation — and a defensible answer when a judge asks how you keep artisans engaged.

**The hazard, stated plainly:** a leaderboard naming the highest earner in a small village creates
real-world conflict. The MD file flags this and it is correct. The answer is not a disclaimer, it is a
**technical control: k-anonymity.** Benchmarks are cluster aggregates, shown only when enough peers
contribute, and never with a name, a rank or a position.

### 9.2 Schema

```prisma
/// One earned recognition badge.
///
/// Awarded by `evaluateBadges()` from the artisan's own real record — never by
/// an admin, never manually, never for logging in. The @@unique is the whole
/// idempotency story: the evaluator runs on every dashboard load and simply
/// cannot double-award.
model ArtisanBadge {
  id         String   @id @default(uuid())
  artisanId  String
  artisan    User     @relation(fields: [artisanId], references: [id])
  /// Stable key from src/lib/badges.ts. Titles are i18n keys, never stored.
  key        String
  /// The real figures that earned it, frozen — so a badge can always explain
  /// itself even after the underlying rows change.
  basis      Json
  awardedAt  DateTime @default(now())

  @@unique([artisanId, key])
  @@index([artisanId])
}
```

Add to `model User`: `badges ArtisanBadge[]`

### 9.3 `src/lib/badges.ts`

```ts
export const BADGES = [
  { key: 'FIRST_SALE',        labelKey: 'badge_first_sale',        icon: 'Sparkles'   },
  { key: 'TEN_SALES',         labelKey: 'badge_ten_sales',         icon: 'Package'    },
  { key: 'REPEAT_MAGNET',     labelKey: 'badge_repeat_magnet',     icon: 'Users'      },
  { key: 'FAIR_WAGE_KEEPER',  labelKey: 'badge_fair_wage_keeper',  icon: 'Scale'      },
  { key: 'VERIFIED_TEN',      labelKey: 'badge_verified_ten',      icon: 'ShieldCheck'},
  { key: 'ON_TIME_FIVE',      labelKey: 'badge_on_time_five',      icon: 'Clock'      },
  { key: 'CLUSTER_HELPER',    labelKey: 'badge_cluster_helper',    icon: 'HandHeart'  },
  { key: 'VOICE_PIONEER',     labelKey: 'badge_voice_pioneer',     icon: 'Mic'        },
] as const;

export interface BadgeInputs { /* real counts, mirroring CreditInputs where they overlap */ }
export interface BadgeAward { key: string; basis: Record<string, number> }
/** Pure. Returns every badge currently earned; the caller upserts. */
export function evaluateBadges(i: BadgeInputs): BadgeAward[];
/** Badges not yet earned, with the real gap, for the "how to earn" list. */
export function badgeProgress(i: BadgeInputs): Array<{ key: string; have: number; need: number }>;
```

Criteria — all from real rows, all stated on screen:

| Badge | Earned when |
|:--|:--|
| FIRST_SALE | ≥ 1 settled sale (escrow, demand or offline — offline counts, it is still a sale they made) |
| TEN_SALES | ≥ 10 settled sales across all three streams |
| REPEAT_MAGNET | ≥ 1 buyer with ≥ 2 purchases (Phase 2's aggregation) |
| FAIR_WAGE_KEEPER | ≥ 5 listings **and** every listed piece priced ≥ its `fairWageFloor` |
| VERIFIED_TEN | `verifiedGenuineCount` ≥ 10 |
| ON_TIME_FIVE | ≥ 5 `ArtisanOrder`s delivered, all within `deadline` (null deadline counts as on time) |
| CLUSTER_HELPER | ≥ 3 `ResourceRequest`s accepted **by** this artisan |
| VOICE_PIONEER | ≥ 5 items with `catalogMethod` in `VOICE`/`IVR` |

Evaluate lazily on the dashboard request (`void`-ed, like Phase 6) and eagerly at the moments a badge
could newly be earned — after `/api/payments/settle-escrow`, after a demand order is settled, after
`/api/artisan/offline-sales` POST, after a buyer verification succeeds. Upsert with
`skipDuplicates`-style handling of the unique constraint.

When a badge is newly awarded, write a `Notification` (`type: 'SYSTEM'`) so it surfaces in the bell —
deduped by the same title check.

### 9.4 Benchmarks — `src/app/api/artisan/benchmarks/route.ts`

```ts
/** Minimum peers with activity before a cluster figure may be shown. */
export const MIN_COHORT = 5;
```

- Resolve the artisan's cluster key with the canonical §2.10 rule 9.
- Cohort = artisans sharing that key **with at least one settled sale in the last 90 days**.
- If `cohort < MIN_COHORT`, widen **once**, by geography. Note what `src/lib/indiaGeo.ts` actually
  provides: `CITY_COORDS`, `locateCity(location)` and `distanceKm(a, b)` — **coordinates, not a
  state mapping**, so do not try to derive a state from it. Widen instead to *"artisans of the same
  craft family within `REGION_RADIUS_KM = 150`"*: resolve each candidate's `location` with
  `locateCity()`, keep those within the radius, and group craft with the existing
  `familiesForCraft()` from `src/lib/suppliers.ts`. Scope label: `'REGION'`.
- If the artisan's own `location` cannot be resolved by `locateCity()`, skip the widening step
  entirely (do not fall back to a platform-wide comparison — comparing a Sambalpuri weaver to a
  Kutch potter is not information).
- If the widened cohort is still `< MIN_COHORT`, return
  `{ available: false, scope: null, cohortSize, minCohort }` and the UI says "not enough artisans
  nearby yet to compare privately" — **not** a number, and not a number in the JSON either.
- When available, return **medians** (not means — one large seller must not set the bar) of: monthly
  realised earnings, listings per month, fulfilment rate, average listing price; plus the artisan's
  own values, plus `cohortSize` and `scope: 'CLUSTER' | 'REGION'`.
- **Never** return names, ids, ranks, percentiles finer than a quartile, or a count small enough to
  identify someone. Return quartile position at most (`'BELOW' | 'MIDDLE' | 'ABOVE'`).
- Copy rule: encouraging and factual. "Median in your cluster: ₹8,000/month. You: ₹12,400." No
  "you're #1", no "you're the worst", no arrows pointing at anyone.

### 9.5 UI

**`src/components/RecognitionPanel.tsx`** on `/artisan/dashboard` (and the full version at
`/artisan/earnings?tab=recognition` if the tab count stays reasonable — otherwise dashboard only):

- Earned badges as a `.kg-rail` of small `Card tone="muted"` chips with the lucide icon, the
  translated label, the award date (IST), and the frozen basis on tap ("earned with 12 sales").
- Unearned badges greyed with their **real** remaining gap from `badgeProgress()`. No mystery badges.
- Benchmark card: two figures side by side with `ProgressBar`s, the scope label, the cohort size
  ("compared with 9 artisans in your cluster"), and the privacy note ("no names are ever shown, and
  we only compare when at least 5 artisans are active").
- Unavailable state as above.

Also surface the Phase 5 skill stage here so the artisan sees stage + badges + benchmark as one
"where I stand" block, computed once and passed down.

### 9.6 i18n keys

`recognition_title`, `recognition_lede`, `badge_first_sale`, `badge_ten_sales`,
`badge_repeat_magnet`, `badge_fair_wage_keeper`, `badge_verified_ten`, `badge_on_time_five`,
`badge_cluster_helper`, `badge_voice_pioneer`, `badge_earned_on`, `badge_earned_with`,
`badge_locked_gap`, `benchmark_title`, `benchmark_scope_cluster`, `benchmark_scope_state`,
`benchmark_scope_region`, `benchmark_cohort`, `benchmark_privacy_note`, `benchmark_unavailable`, `benchmark_you`,
`benchmark_median`, `benchmark_monthly_earnings`, `benchmark_listings`, `benchmark_fulfilment`,
`benchmark_avg_price`, `notif_badge_earned`.

### 9.7 Edge cases

1. Artisan alone in their cluster → widen to the 150 km craft-family region → still too few →
   unavailable state with the cohort size and the threshold named. **Verify no figure leaks** in the
   JSON either.
2. A cohort of exactly 5 → shown; exactly 4 → not shown. Test both.
3. All badges earned → no locked section rendered.
4. FAIR_WAGE_KEEPER with one piece priced below floor → **not** awarded; if it was previously awarded
   it **stays** awarded (badges are historical achievements, never revoked — document this choice in
   the code, because the alternative silently punishes an artisan for a later price experiment).
5. Ten dashboard loads → no duplicate badge rows, no duplicate notifications.
6. An artisan whose only income is offline → FIRST_SALE earns; the benchmark cohort excludes them if
   they have no **settled platform** sale, and the copy must not imply they are inactive. Handle this
   deliberately: cohort membership requires platform activity (that is what is being compared), but
   the artisan's own displayed figure includes their real streams with the difference labelled.
7. `location` that `locateCity()` cannot resolve → skip the widening step entirely and go straight to
   the unavailable state. Never fall back to a platform-wide average.

### 9.8 Verification checklist

- [ ] Make a first sale → FIRST_SALE appears, once, with a bell notification
- [ ] Locked badges show real gaps ("3 more sales"), never a hidden condition
- [ ] Badge basis on tap matches the figures at award time even after more sales land
- [ ] Cluster of 4 → unavailable state, no numbers in the UI **or** the API response
- [ ] Cluster of 5+ → medians shown, with cohort size and privacy note; no name, id or rank anywhere
      in the payload (inspect the JSON)
- [ ] Price a piece below its fair-wage floor → FAIR_WAGE_KEEPER not newly awarded; an existing one
      is not revoked
- [ ] Gates clean, four languages, 360 px

**Commit:** `feat(v12/9): recognition badges and k-anonymous cluster benchmarks`

---

# PHASE 10 — DESIGN LAB (AI concept + deterministic SVG motif composer)

### 10.1 Why this exists

An artisan experimenting with a new pattern commits real silk to it. A dry run on screen saves
material. The original idea asked for "a canvas tool"; a full canvas editor is weeks of work and a
liability on demo day.

**What you will build instead, and it is better:** a **deterministic motif composer**. The AI
produces a *pattern grammar* — a small structured spec — and the client renders it as **inline SVG**
with live controls (grid density, motif scale, rotation, palette, border). The artisan manipulates
real geometry, the result is reproducible from the spec, and there is **no new dependency** and no
generated-image hallucination. A `#` of sliders over an SVG is a real tool; a fake AI painting is not.

**Two honesty rules, absolute:**
- A generated SVG is a **concept sketch**, labelled as such, and may **never** be written into a
  `CraftItem.images[]`, `originalImageUrl`, or anything a buyer's authenticity comparison reads.
  `provenanceReference()` must never be able to reach one.
- The app never claims the concept is a traditional motif of any particular community. It is a
  starting point the artisan edits.

### 10.2 Schema

```prisma
/// One design concept an artisan explored before committing material.
///
/// `spec` is the pattern grammar (see src/lib/motifSpec.ts) and is the source of
/// truth — the SVG is a pure function of it, so a saved concept re-renders
/// identically without storing a large string. `svg` is cached only so the
/// concept list can show a thumbnail without re-running the renderer.
///
/// Explicitly NOT a product photograph and never referenced by any provenance
/// comparison. Written by POST /api/artisan/design-lab.
model DesignConcept {
  id          String   @id @default(uuid())
  artisanId   String
  artisan     User     @relation(fields: [artisanId], references: [id])
  /// What the artisan asked for, in their own words.
  prompt      String
  /// The language they said it in.
  promptLanguage String?
  title       String
  /// MotifSpec — grid, motif, repeat, palette, stroke, border.
  spec        Json
  /// AI | FALLBACK — whether a model produced the spec or the rule-based
  /// composer did, so the UI never over-claims.
  source      String   @default("AI")
  /// ≤ 40 KB inline SVG thumbnail. Null when it could not be produced.
  svgThumb    String?
  /// Set when the artisan started a listing from this concept, for the
  /// "did the lab lead to real work" question a judge will ask.
  usedForItemId String?
  createdAt   DateTime @default(now())

  @@index([artisanId, createdAt])
}
```

Add to `model User`: `designConcepts DesignConcept[]`

### 10.3 `src/lib/motifSpec.ts` — the grammar and the renderer

```ts
export const MOTIFS = ['diamond','fish','temple','lotus','chevron','dot-grid','ikat-blur','stripe','peacock-eye','kalash'] as const;
export const REPEATS = ['grid','brick','half-drop','mirror','diagonal'] as const;

export interface MotifSpec {
  v: 1;
  motif: (typeof MOTIFS)[number];
  repeat: (typeof REPEATS)[number];
  /** 2..16 */
  grid: number;
  /** 0.2..1.0 — motif size within its cell */
  scale: number;
  /** 0..359 */
  rotation: number;
  /** 2..6 hex colours, validated */
  palette: string[];
  /** 0..4 px */
  strokeWidth: number;
  border: 'none'|'temple'|'stripe'|'zigzag';
  background: string;
}

export function defaultSpec(craftFamily: string): MotifSpec;
export function validateSpec(raw: unknown): MotifSpec;     // clamps every field, never throws
export function renderMotifSvg(spec: MotifSpec, size?: number): string;  // pure, deterministic
```

`renderMotifSvg` builds an `<svg>` with a `<defs><pattern>` per motif and tiles it — pure string
construction, no DOM, so it works server-side for the thumbnail and client-side for the live preview.
Each motif is a small hand-written path/shape set. Keep it under ~250 lines; ten simple motifs drawn
well beat forty drawn badly. Output must be **sanitised by construction**: numbers clamped, colours
matched against `/^#[0-9a-fA-F]{6}$/`, no text nodes, no `<foreignObject>`, no `<script>`, no
external `href`. Never interpolate model output into the SVG directly.

Add `src/lib/__tests__/motifSpec.test.mjs` (§2.11 convention): `validateSpec` clamps every
out-of-range field and rejects bad colours without throwing; `renderMotifSvg` is deterministic (same
spec → byte-identical string) and its output contains no `<script`, no `foreignObject` and no `http`.

### 10.4 `src/app/api/artisan/design-lab/route.ts`

- `POST { prompt, language, craftType? }`:
  - AI path: `groqChatJSON` (or Gemini) → `{ title, spec, motifNotes, paletteNames, materialNote,
    laborDaysEstimate }`, constrained by listing the allowed `motif`/`repeat`/`border` values in the
    prompt and demanding hex colours. **Run every response through `validateSpec()`** — a model that
    returns `motif: "elephant"` must degrade to the nearest allowed value, not crash.
  - Fallback path: `defaultSpec(familyForCraft)` seeded deterministically from the prompt text (a
    simple string hash choosing motif/repeat/palette from committed palettes in
    `src/lib/motifPalettes.ts`, which you write with named traditional-adjacent palettes described
    generically — "indigo & madder", "turmeric & iron black"). `source: 'FALLBACK'`, labelled in the UI.
  - Returns the spec, never the SVG (the client renders it).
- `GET` → the artisan's saved concepts (paginated, newest first).
- `PATCH { id, spec?, title? }` → save an edited spec; re-validate; regenerate `svgThumb` server-side
  with `renderMotifSvg(spec, 240)` and reject if over 40 KB.
- `DELETE?id=` → owner only.

### 10.5 `src/app/artisan/design-lab/page.tsx` + `loading.tsx`

- `PageTitle` "Design Lab", `PageLede` one line: try a pattern before you cut cloth.
- **Describe** step: voice button (reuse the existing recorder) or text. Sends to the route.
- **Compose** step: large SVG preview (`dangerouslySetInnerHTML` is acceptable **only** because the
  SVG is produced by our own pure renderer from a validated spec — say so in a comment) with controls
  beside it: grid slider, scale slider, rotation slider, palette swatch editor (tap a swatch → a
  small picker limited to the committed palettes plus a free hex input that is validated), motif
  `PillTabs`, repeat `SegmentedToggle`, border toggle. Every change re-renders instantly and updates
  the URL-free local state; debounce persistence.
- **Notes** panel: the AI's motif notes, palette names, material note and labour estimate, each
  labelled "AI suggestion".
- Actions: **Save concept** · **Download SVG** (client-side blob, no dependency) ·
  **Start a listing from this** → navigates to the dashboard capture flow with the concept id, which
  prefills the **description draft only** (craft type, suggested tags, the artisan's own prompt text).
  It prefills words, never photographs. Set `usedForItemId` when the item is created.
- Saved concepts rail with thumbnails.
- Sidebar: add `/artisan/design-lab` to `shell_group_my_workshop`, key `nav_design_lab`, icon
  `Palette`.

### 10.6 i18n keys

`nav_design_lab`, `lab_title`, `lab_lede`, `lab_describe`, `lab_speak`, `lab_generate`,
`lab_source_ai`, `lab_source_fallback`, `lab_grid`, `lab_scale`, `lab_rotation`, `lab_palette`,
`lab_motif`, `lab_repeat`, `lab_border`, `lab_border_none`, `lab_border_temple`,
`lab_border_stripe`, `lab_border_zigzag`, `lab_notes`, `lab_material_note`, `lab_labor_estimate`,
`lab_ai_suggestion`, `lab_save`, `lab_saved`, `lab_download`, `lab_start_listing`,
`lab_concept_disclaimer`, `lab_my_concepts`, `lab_empty`, plus one key per motif
(`motif_diamond`, …) and per palette.

### 10.7 Edge cases

1. Empty or single-word prompt → still produces a valid spec (fallback seeding) and says it needs more
   detail to do better.
2. Model returns malformed JSON / an unknown motif / `grid: 400` / `palette: ["red"]` → `validateSpec`
   clamps and substitutes; the page never errors. **Test each of these with a stubbed response.**
3. A prompt attempting injection into the SVG (`"><script>`) → impossible by construction; verify the
   rendered SVG contains no `<script` and no prompt text at all.
4. 16×16 grid with a complex motif on a low-end phone → cap total drawn elements (grid² × motif
   parts) and reduce detail above a threshold; the preview must stay under ~16 ms per re-render.
   Measure it.
5. No AI keys → the whole page works in fallback mode, labelled.
6. Save 50 concepts → list paginates; `svgThumb` size cap enforced.
7. "Start a listing" must **never** attach the SVG as an image — assert this in the code path and
   verify the created `CraftItem` has an empty `images[]` until the artisan photographs the real piece.

### 10.8 Verification checklist

- [ ] Describe a design by voice in Odia → a spec comes back → the SVG renders
- [ ] Every slider and control changes the SVG live, smoothly, at 360 px and on desktop
- [ ] Same spec renders byte-identical twice (determinism test passes)
- [ ] Stubbed malformed AI responses (5 cases) all clamp without an error
- [ ] Rendered SVG contains no `<script`, no prompt text, no external URL
- [ ] Save → reload → concept reappears with its thumbnail and re-renders identically
- [ ] Download gives a valid `.svg` that opens in a browser
- [ ] "Start a listing" prefills text only; the new item's `images[]` is empty
- [ ] AI keys unset → fallback mode, labelled
- [ ] Gates clean, four languages

**Commit:** `feat(v12/10): design lab — AI pattern grammar + deterministic SVG motif composer`

---

# PHASE 11 — DIGITAL CRAFT IP REGISTRY (motif fingerprint, cluster ownership, licensing)

### 11.1 Why this exists, and what it must NOT claim

The idea: register a craft's distinctive motifs to the village that owns the tradition, so a brand
that wants to use them licenses them and the money goes back to the cluster.

**This is the highest-risk phase in the programme.** A judge will immediately ask you to *show* the
pattern extraction, *show* a registered fingerprint, and *show* a licensing transaction. So the build
must be genuinely functional, and the claims must be scrupulously narrow:

| Never say | Say instead |
|:--|:--|
| "GI tag granted / registered" | "digital provenance record" |
| "IP protected" / "legally protected" | "timestamped registration on Karigari" |
| "blockchain" | "content-addressed hash chain" — and only if you actually build one |
| "we detect counterfeits" | "we flag visually similar registrations for human review" |

A prominent, always-visible disclaimer component is part of the deliverable: *"A Karigari motif
record is a timestamped digital registration, not a Geographical Indication and not a legal
intellectual-property right. GI registration is granted only by the Geographical Indications
Registry, Government of India."*

### 11.2 Schema

```prisma
/// A registered motif fingerprint, owned by the CLUSTER rather than by one
/// artisan: a tradition belongs to the village that carries it, and attributing
/// it to whoever happened to photograph it first would be the exact
/// appropriation this feature exists to resist.
///
/// `hash` is a 64-bit perceptual hash (see src/lib/motifHash.ts) as 16 hex
/// chars. Perceptual, not cryptographic, on purpose: two photographs of the
/// same sari must collide, which is the whole point, and SHA-256 never would.
/// Near-duplicate detection is Hamming distance over `hash`.
///
/// Written by POST /api/motif/register. Status is moved only by an admin.
model MotifRegistration {
  id           String   @id @default(uuid())
  /// Resolved cluster key — shgGroupLink or `auto:<location>`, per the app-wide rule.
  clusterKey   String
  /// The artisan who submitted it, for credit and contact. NOT the owner.
  submittedById String
  submittedBy  User     @relation(fields: [submittedById], references: [id])
  craftItemId  String?
  craftItem    CraftItem? @relation(fields: [craftItemId], references: [id])
  /// Human name the cluster gave the motif.
  name         String
  /// 16 hex chars. Not unique: a legitimate re-registration of a variant is
  /// normal, and uniqueness would be enforced on a value that is meant to
  /// collide. Duplicates are surfaced for review instead.
  hash         String
  /// `{ motifs: string[], symmetry: string, repeatUnit: string, palette: string[],
  ///    confidence: number, source: 'AI'|'HEURISTIC' }` — the structured description.
  descriptors  Json
  /// Downscaled ≤320px crop the hash was computed from, for human review.
  referenceImageUrl String?
  /// PENDING | REGISTERED | FLAGGED_DUPLICATE | REJECTED
  status       String   @default("PENDING")
  /// Set when review found an existing near-identical registration.
  duplicateOfId String?
  /// Hamming distance to `duplicateOfId`, so a reviewer sees how close.
  duplicateDistance Int?
  adminNote    String?
  reviewedById String?
  reviewedAt   DateTime?
  /// Whether the cluster is open to licensing enquiries for this motif.
  licensable   Boolean  @default(true)
  registeredAt DateTime @default(now())

  licences     MotifLicence[]

  @@index([clusterKey])
  @@index([hash])
  @@index([status])
}

/// A brand's request to use a registered motif, and the fee recorded against it.
///
/// Money here follows the platform's existing honesty convention: `payoutMode`
/// is RAZORPAYX only when a real payout ran, SIMULATED otherwise, and a
/// SIMULATED row is never described as paid. Nothing is auto-approved: a human
/// on the cluster's behalf accepts or declines.
model MotifLicence {
  id            String   @id @default(uuid())
  motifId       String
  motif         MotifRegistration @relation(fields: [motifId], references: [id])
  /// Free-text enquirer identity — the public page has no accounts, same
  /// convention as Demand.buyerName.
  licenseeName  String
  licenseeContact String
  /// What they want to use it for, in their words.
  intendedUse   String
  /// Units/volume they described. Unparsed free text, deliberately.
  scope         String?
  /// Fee the cluster asked for, in rupees. Null until a figure is agreed.
  feeAmount     Int?
  /// REQUESTED | ACCEPTED | DECLINED | PAID | WITHDRAWN
  status        String   @default("REQUESTED")
  /// RAZORPAYX | SIMULATED — never null once status is PAID.
  payoutMode    String?
  payoutRef     String?
  decidedById   String?
  decidedAt     DateTime?
  paidAt        DateTime?
  createdAt     DateTime @default(now())

  distributions MotifPayoutShare[]

  @@index([motifId])
  @@index([status])
}

/// How one licence fee was split across the cluster's artisans.
///
/// Equal shares among artisans who have a registered, non-duplicate motif in
/// that cluster, computed at payout time and frozen — a later joiner must not
/// retroactively dilute a settled distribution.
model MotifPayoutShare {
  id         String       @id @default(uuid())
  licenceId  String
  licence    MotifLicence @relation(fields: [licenceId], references: [id])
  artisanId  String
  artisan    User         @relation(fields: [artisanId], references: [id])
  amount     Int
  payoutMode String
  payoutRef  String?
  createdAt  DateTime     @default(now())

  @@unique([licenceId, artisanId])
  @@index([artisanId])
}
```

Add to `model User`: `motifRegistrations MotifRegistration[]`, `motifPayoutShares MotifPayoutShare[]`
Add to `model CraftItem`: `motifRegistrations MotifRegistration[]`

### 11.3 `src/lib/motifHash.ts` — real perceptual hashing, written by hand, no dependency

```ts
/** Side length of the grayscale grid the hash is computed over. */
export const HASH_GRID = 9;      // 9x8 difference hash -> 64 bits
export const HASH_BITS = 64;
/** At or below this Hamming distance two images are treated as the same motif. */
export const DUPLICATE_DISTANCE = 6;
/** Above this they are unrelated; between the two is "similar", for review. */
export const SIMILAR_DISTANCE = 14;

/** Client-side: data URL -> 16-hex dHash. Uses canvas; returns null if blocked. */
export async function hashImageDataUrl(dataUrl: string): Promise<string | null>;
/** Pure: Hamming distance between two 16-hex hashes. Throws on bad input. */
export function hammingDistance(a: string, b: string): number;
export function classifyDistance(d: number): 'DUPLICATE' | 'SIMILAR' | 'DISTINCT';
```

Algorithm (dHash — simple, robust to scale and mild colour shift, and explainable to a judge in one
sentence): draw to a 9×8 canvas, convert to grayscale with the standard luma weights, compare each
pixel to its right neighbour, emit 1 when brighter → 64 bits → 16 hex chars.

**Do the hashing on the client**, at registration time, from the already-downscaled image. A route
that decodes several full-size data-URL images will exhaust memory — the codebase already worries
about this (`clientImagePrep.ts` exists for exactly this reason). The server re-validates the hash
**format** but trusts the client for the value, and that is acceptable because the hash is a
discovery aid reviewed by a human, not an authorisation.

Tests in `src/lib/__tests__/motifHash.test.mjs` (§2.11 convention): identical input → distance 0; a
known pair of fixture hex strings → the expected distance; malformed hash (wrong length, non-hex) →
throws; `classifyDistance` boundaries asserted at exactly 6, 7, 14 and 15. (Only the pure functions
are tested here — `hashImageDataUrl` needs a canvas and is verified in the browser.)

### 11.4 Descriptors — AI, labelled, optional

`src/app/api/motif/describe/route.ts`: Gemini Vision on the reference crop returns
`{ motifs: string[], symmetry: string, repeatUnit: string, palette: string[], confidence: number }`.
`source: 'AI'`. On no key / error / timeout, fall back to a heuristic: dominant colours extracted
**client-side** from the canvas (a simple k-bucket histogram, ~40 lines, no dependency) plus the
item's existing `tags` and `aiCatalog.category`, marked `source: 'HEURISTIC'`. **Never present a
heuristic as an AI reading**, and never show a confidence figure the model did not give.

### 11.5 Routes

- `POST /api/motif/register` (artisan) — body `{ craftItemId?, name, hash, descriptors,
  referenceImageUrl }`. Validates hash format; resolves `clusterKey`; compares against **all**
  registrations (`select: { id, hash, clusterKey, status }` only — never load images) and computes the
  minimum distance. If `DUPLICATE` against a row in **another** cluster → status
  `FLAGGED_DUPLICATE` with `duplicateOfId`/`duplicateDistance`, and a `Ticket`-style admin surface
  entry (reuse the existing facilitator tickets tab pattern rather than a new admin page).
  If `DUPLICATE` within the **same** cluster → reject politely as already registered, pointing at the
  existing record. Otherwise `PENDING`.
- `GET /api/motif/registry?cluster=&q=` — **public**, paginated. Returns names, hashes, descriptors,
  the reference crop, the cluster's **display** name, and the submitting artisan's name — never their
  contact details, never their id.
- `POST /api/motif/licence` — **public**. Creates a `MotifLicence` in `REQUESTED`. Rate-limit by
  `ipHash` (max 5/hour) using the same salted-hash helper as Phase 2. Notifies the cluster's artisans
  with a `Notification` each (`type: 'SYSTEM'`), deduped.
- `PATCH /api/artisan/motif-licence` — the submitting artisan (acting for the cluster) accepts with a
  `feeAmount`, or declines with a reason. Monotonic status, timestamp-guarded.
- `POST /api/admin/motif-review` — admin sets `REGISTERED` / `REJECTED` / resolves a duplicate flag,
  with an `adminNote`. Writes an `AuditLog` row when a `craftItemId` is attached.
- `POST /api/admin/motif-licence-payout` — on an `ACCEPTED` licence, computes the equal split across
  the cluster's registered artisans, writes frozen `MotifPayoutShare` rows and the licence's
  `paidAt`/`payoutMode` in **one transaction**, guarded by `paidAt: null`. Uses the existing
  `razorpayPayout.ts` when configured (`payoutMode: 'RAZORPAYX'`), otherwise records
  `SIMULATED` with a `SIM_<licenceId>-<artisanId>` ref — exactly the convention `settle-escrow` uses.
  Never round money away: distribute the remainder rupee-by-rupee to the earliest registrants so the
  shares sum **exactly** to `feeAmount`. Assert that in code.

### 11.6 UI

- **`src/app/artisan/motifs/page.tsx`** + `loading.tsx` — the artisan's cluster registry: register a
  motif from one of their own pieces (pick a piece → auto-crop suggestion → name it → hash computed
  in-browser with a visible progress state → submit), the cluster's registered motifs, pending and
  flagged states with plain explanations, and incoming licence requests with accept/decline.
  Sidebar entry `nav_motifs`, icon `Fingerprint`, in `shell_group_my_workshop`.
- **`src/app/motif/[id]/page.tsx`** — public motif record: the crop, the name, the cluster, the
  descriptors, the registration timestamp (IST), the fingerprint shown as 16 hex chars in the mono
  face (it looks like what it is), the disclaimer, and a licence enquiry form. `noindex`.
- **`src/components/MotifDisclaimer.tsx`** — the §11.1 text, used on every motif surface.
- **Admin**: extend the existing facilitator tickets tab with a "Motif reviews" filter rather than
  building a new admin page — side-by-side crops, the distance, and the two decisions.
- **Village trust view**: on the artisan motifs page, a small ledger card — total licence fees
  received by the cluster, this artisan's own share, each row labelled `RAZORPAYX` or `SIMULATED`. If
  the total is 0, say so; do not show a projected figure.

### 11.7 i18n keys

`nav_motifs`, `motif_title`, `motif_lede`, `motif_disclaimer`, `motif_register_cta`,
`motif_pick_piece`, `motif_name`, `motif_hashing`, `motif_fingerprint`, `motif_descriptors`,
`motif_symmetry`, `motif_repeat_unit`, `motif_palette`, `motif_source_ai`, `motif_source_heuristic`,
`motif_status_pending`, `motif_status_registered`, `motif_status_flagged`, `motif_status_rejected`,
`motif_already_registered`, `motif_flagged_explain`, `motif_licensable`, `motif_licence_request`,
`motif_licence_use`, `motif_licence_scope`, `motif_licence_contact`, `motif_licence_submitted`,
`motif_licence_accept`, `motif_licence_decline`, `motif_licence_fee`, `motif_licence_status_*`,
`motif_trust_ledger`, `motif_trust_total`, `motif_trust_your_share`, `motif_payout_simulated`,
`motif_payout_real`, `motif_trust_empty`.

### 11.8 Edge cases

1. Register the **same photo twice** → distance 0 → rejected as already registered, pointing at the
   existing record. Not a duplicate row, not a crash.
2. Register a **crop/resized** version → distance small → same outcome. (This is the demo that proves
   the hash works — do it live.)
3. Register a genuinely different motif → `DISTINCT` → PENDING. Verify the distance is > 14 for a
   clearly different fabric.
4. Same motif registered by **two different clusters** → the second is `FLAGGED_DUPLICATE`, both
   records visible to the admin, and neither cluster is told the other "stole" anything. The copy
   must be neutral: this is a review, not an accusation.
5. Canvas blocked / hashing unavailable → registration is disabled with a clear reason, never
   submitted without a hash.
6. A licence fee of ₹1,000 split across 3 artisans → 334/333/333, summing to exactly 1000. Assert it.
7. A cluster with exactly 1 registered artisan → they receive the whole fee; the ledger says so.
8. Double "pay out" click → the `paidAt: null` guard makes the second a no-op.
9. `feeAmount` null on an ACCEPTED licence → payout refused with a clear message.
10. The public motif page must load with no session, no AI key and no Razorpay config.

### 11.9 Verification checklist

- [ ] Register a motif from a real piece → fingerprint appears; `motifHash.test.ts` passes
- [ ] Re-register the same image, and a resized crop of it → both correctly rejected as existing
- [ ] Register from a second test cluster with the same image → `FLAGGED_DUPLICATE` with the distance,
      visible in the admin review filter, neutral copy on both sides
- [ ] Public `/motif/[id]` renders with the disclaimer and **no** artisan contact details in the HTML
      or the JSON
- [ ] Submit a licence enquiry as a public visitor → cluster artisans get a notification → accept with
      a fee → admin pays out → shares sum exactly to the fee, each labelled SIMULATED
- [ ] Rate limit: 6 enquiries in an hour → the 6th is refused
- [ ] No string anywhere claims a GI tag, legal protection, or a blockchain
- [ ] Gates clean, four languages, 360 px

**Commit:** `feat(v12/11): digital craft motif registry — perceptual fingerprints, cluster ownership, licensing ledger`

---

# PHASE 12 — SCRAP-TO-WEALTH (circular economy module)

### 12.1 Why this exists

Textile offcuts, wood shavings and clay waste are burned or dumped. Individually a kilo is worthless;
pooled across a cluster it is a saleable lot. This is supplementary income from material an artisan
already has.

**Scope honesty.** There is no recycler directory and no market price feed available to this project.
So: artisans **log** scrap, the platform **pools** it per cluster and material, a pool becomes
**listed** when it passes a real weight threshold, and recyclers **enquire** through a public page. No
price is shown until a real figure is entered at sale time. No recycler names are invented.

### 12.2 Schema

```prisma
/// One artisan's logged scrap, and the cluster pool it feeds.
///
/// Weight is the unit of account and is entered by the artisan, so it is
/// self-reported and labelled as such everywhere. `pooledLotId` is set when the
/// aggregator claims it; a claimed row is frozen — withdrawing scrap from a
/// pool that has already been listed to a recycler would misstate the lot.
model ScrapLot {
  id           String     @id @default(uuid())
  artisanId    String
  artisan      User       @relation(fields: [artisanId], references: [id])
  clusterKey   String
  /// Free text, but normalised against SCRAP_MATERIALS in src/lib/scrap.ts so
  /// pooling actually groups. An unrecognised material pools under OTHER.
  material     String
  /// Grams, not kilos: a stored float of 0.3 kg reconciles badly across a
  /// hundred contributors, and grams keep the arithmetic integral.
  grams        Int
  photoUrl     String?
  notes        String?
  /// LOGGED | POOLED | SOLD | WITHDRAWN
  status       String     @default("LOGGED")
  pooledLotId  String?
  pool         ScrapPool? @relation(fields: [pooledLotId], references: [id])
  loggedAt     DateTime   @default(now())

  @@index([clusterKey, material, status])
  @@index([artisanId])
}

/// A cluster's pooled scrap of one material.
///
/// Promoted to LISTED automatically the moment `totalGrams` crosses the
/// material's threshold — that promotion is arithmetic on real logged weight,
/// not an editorial decision. `salePriceRupees` stays null until a real sale is
/// recorded; the public page shows "price not set" rather than an estimate,
/// because this project has no market feed to estimate from.
model ScrapPool {
  id             String     @id @default(uuid())
  clusterKey     String
  material       String
  totalGrams     Int        @default(0)
  contributorCount Int      @default(0)
  /// OPEN | LISTED | SOLD
  status         String     @default("OPEN")
  listedAt       DateTime?
  soldAt         DateTime?
  salePriceRupees Int?
  /// Who bought it, as they identified themselves. No directory, no accounts.
  recyclerName   String?
  recyclerContact String?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  lots           ScrapLot[]
  enquiries      ScrapEnquiry[]
  shares         ScrapPayoutShare[]

  @@unique([clusterKey, material, status])
  @@index([status])
}

/// A recycler's enquiry against a listed pool. Public, unauthenticated.
model ScrapEnquiry {
  id           String    @id @default(uuid())
  poolId       String
  pool         ScrapPool @relation(fields: [poolId], references: [id])
  recyclerName String
  contact      String
  offerRupees  Int?
  message      String?
  /// RECEIVED | ACCEPTED | DECLINED
  status       String    @default("RECEIVED")
  ipHash       String?
  createdAt    DateTime  @default(now())

  @@index([poolId])
}

/// Pro-rata distribution of a sold pool, by contributed grams, frozen at payout.
model ScrapPayoutShare {
  id         String    @id @default(uuid())
  poolId     String
  pool       ScrapPool @relation(fields: [poolId], references: [id])
  artisanId  String
  artisan    User      @relation(fields: [artisanId], references: [id])
  grams      Int
  amount     Int
  payoutMode String
  payoutRef  String?
  createdAt  DateTime  @default(now())

  @@unique([poolId, artisanId])
  @@index([artisanId])
}
```

Add to `model User`: `scrapLots ScrapLot[]`, `scrapShares ScrapPayoutShare[]`

The `@@unique([clusterKey, material, status])` is what makes "one OPEN pool per cluster+material"
true at the database level rather than by convention — note that a SOLD pool and a new OPEN pool can
coexist, which is what you want.

### 12.3 `src/lib/scrap.ts`

```ts
export const SCRAP_MATERIALS = ['COTTON_OFFCUT','SILK_OFFCUT','WOOL_YARN','JUTE','WOOD_SHAVING','BAMBOO','CLAY','METAL_SCRAP','LEATHER','PAPER','OTHER'] as const;
export type ScrapMaterial = (typeof SCRAP_MATERIALS)[number];
/** Minimum pooled weight, in grams, before a lot is worth a recycler's trip.
 *  Each figure is a judgement call and is documented as one — not a market fact. */
export const LOT_THRESHOLD_GRAMS: Record<ScrapMaterial, number> = { … };
export function normaliseMaterial(raw: string): ScrapMaterial;
export function materialLabelKey(m: ScrapMaterial): string;
export function formatWeight(grams: number): { value: number; unitKey: string };  // g under 1000, else kg
/** Pro-rata split that sums EXACTLY to the sale price. Remainder to the largest
 *  contributors first, ties broken by earliest log. */
export function splitProRata(price: number, contributions: {artisanId: string; grams: number; at: Date}[]): Array<{artisanId: string; amount: number}>;
```

Test `splitProRata` in `src/lib/__tests__/scrap.test.mjs` (§2.11 convention): the returned amounts sum
**exactly** to the price for prices 1, 7, 1000 and 99,999 across 1, 2, 3 and 7 uneven contributors; a
zero-gram contributor gets 0; identical contributions split evenly; no amount is ever negative.

### 12.4 Routes

- `POST /api/artisan/scrap` — log a lot. Validates `grams` 1..500_000, material via
  `normaliseMaterial`, optional photo (downscaled client-side). Then, **in one transaction**:
  find-or-create the `OPEN` pool for `(clusterKey, material)`, attach the lot, recompute
  `totalGrams`/`contributorCount` from the lots (recompute, never `increment` — a recompute cannot
  drift), and if `totalGrams >= LOT_THRESHOLD_GRAMS[material]`, set the pool `LISTED` with
  `listedAt`, and notify the cluster's contributors (`Notification`, deduped).
- `GET /api/artisan/scrap` — this artisan's lots, their cluster's pools with real totals and progress
  toward each threshold, their share entitlement (grams / totalGrams as a percentage), and their
  received total.
- `DELETE /api/artisan/scrap?id=` — withdraw a lot, **only** while its pool is `OPEN`; recompute the
  pool and demote it from `LISTED` to `OPEN` if the weight drops back below the threshold (that
  demotion must be possible, and must be logged).
- `GET /api/scrap/pools` — **public**. `LISTED` pools only: cluster **display** area (district-level,
  not an exact village — do not publish a precise location for a group of low-income people),
  material, total weight, contributor count, `listedAt`. No artisan names, no contacts.
- `POST /api/scrap/enquiry` — public, `ipHash` rate-limited (5/hour), notifies the cluster.
- `POST /api/admin/scrap-sale` — admin records a real sale: `salePriceRupees`, `recyclerName`,
  `recyclerContact`, marks the pool `SOLD`, writes frozen `ScrapPayoutShare` rows via
  `splitProRata`, and pays out through `razorpayPayout.ts` when configured, else `SIMULATED` with a
  `SIM_<poolId>-<artisanId>` ref. Guarded by `soldAt: null`. All lots → `SOLD`.

### 12.5 UI

- A **"Scrap & waste"** tab on `/artisan/workshop` (add it here, in this phase — Phase 8 deliberately
  left it out so no empty tab ever shipped):
  - "Log scrap" form: material `PillTabs`, weight with a g/kg toggle (stored as grams), optional
    photo, notes.
  - Cluster pool cards: material, current weight, `ProgressBar` toward the threshold with the real
    numbers ("7.2 kg of 15 kg"), contributor count, status badge, and this artisan's share
    percentage. `LISTED` pools show the enquiry count.
  - Earnings line: total received from scrap, each row labelled `SIMULATED` or real, kept **separate**
    from craft income everywhere (it is a fourth stream; do not fold it into the Phase 1 total without
    its own label).
  - Empty state: an honest explanation of how pooling works, with the thresholds shown, and no
    invented figures.
- **`src/app/scrap/page.tsx`** — public board of listed pools + the enquiry form. `noindex`.
- Admin: one section in the facilitator dashboard to record a sale and trigger the distribution.

### 12.6 i18n keys

`workshop_tab_scrap`, `scrap_title`, `scrap_lede`, `scrap_log_cta`, `scrap_material`,
`scrap_weight`, `scrap_unit_g`, `scrap_unit_kg`, `scrap_photo`, `scrap_notes`, `scrap_logged`,
`scrap_withdraw`, `scrap_pool_title`, `scrap_pool_progress`, `scrap_pool_contributors`,
`scrap_pool_status_open`, `scrap_pool_status_listed`, `scrap_pool_status_sold`, `scrap_your_share`,
`scrap_received`, `scrap_enquiries`, `scrap_public_title`, `scrap_public_lede`,
`scrap_enquiry_name`, `scrap_enquiry_contact`, `scrap_enquiry_offer`, `scrap_enquiry_message`,
`scrap_enquiry_sent`, `scrap_price_not_set`, `scrap_payout_simulated`, `scrap_empty`,
`scrap_how_it_works`, plus one key per material.

### 12.7 Edge cases

1. First lot in a cluster → pool created, progress shown, not listed.
2. Weight crossing the threshold exactly → listed; one gram below → not. Test both.
3. Withdrawing a lot that drops a `LISTED` pool below threshold → demoted to `OPEN`, contributors
   notified, and the public board no longer shows it.
4. Withdrawing from a `SOLD` pool → refused.
5. Two artisans logging simultaneously into the same cluster+material → the `@@unique` plus a
   transaction means one pool, correct total. Test with two concurrent requests.
6. Pro-rata of ₹1 across 3 contributors → 1/0/0, summing to 1. Never ₹0.33.
7. A contributor with 0 g (shouldn't exist, but guard it) → 0, no divide-by-zero.
8. Unrecognised material typed → pools under OTHER, and the UI says so rather than silently mislabelling.
9. The public board shows district-level areas only — verify no village name or artisan name is in the
   payload.
10. `LOT_THRESHOLD_GRAMS` must be presented as Karigari's own operating minimum, never as a market
    standard.

### 12.8 Verification checklist

- [ ] Log scrap from two accounts in the same cluster → one pool, correct combined weight and
      contributor count
- [ ] Cross the threshold → pool lists automatically, contributors notified, appears on `/scrap`
- [ ] Withdraw below the threshold → demoted, removed from the public board
- [ ] Public enquiry → cluster notified; rate limit works at the 6th attempt
- [ ] Admin records a ₹4,000 sale across 3 uneven contributors → shares sum to exactly 4000, each
      labelled SIMULATED, each visible on the contributing artisan's page
- [ ] `splitProRata` tests pass, including the ₹1 case
- [ ] No price is displayed anywhere before a real sale figure exists
- [ ] Public payload contains no artisan name and no village-level location
- [ ] Scrap income is a separately labelled stream, not merged into craft earnings
- [ ] Gates clean, four languages, 360 px

**Commit:** `feat(v12/12): scrap-to-wealth — cluster pooling, threshold listing, exact pro-rata distribution`

---

# PHASE 13 — INFLUENCER MARKETING: ARTISAN-FUNDED, OPT-IN 5 % COMMISSION

### 13.1 What is being corrected, and why this is delicate

The intended model, confirmed by the project owner, is:

> **It is the artisan's choice.** If an artisan wants influencer promotion, they opt in, and they give
> a **5 % cut of the sale price** on items sold through a creator's link.

The code today says the opposite. `src/lib/escrow.ts` currently documents `CREATOR_RATE = 0.05` as
*"Taken from the platform-side remainder above, NOT from the artisan's share"*, and
`ARTISAN_TOTAL_RATE` is a flat `0.8936` regardless of attribution. So the **narrative and the
arithmetic disagree**, and a judge who reads either one will find the other.

This phase makes the code match the real model, and — because a ministry judge will absolutely probe
a deduction from a marginalised artisan's earnings — makes the deduction **explicit, opt-in,
quantified before consent, and only ever applied to sales the creator actually brought in.**

### 13.2 The rate model

```ts
// src/lib/escrow.ts — replace the flat rates with an attribution-aware pair.

/** Stage 1 is unchanged by promotion: the artisan's upfront cash must never
 *  shrink because they accepted marketing help. */
export const ADVANCE_RATE = 0.4;

/** Stage 2 on a DIRECT sale — no creator involved. */
export const FINAL_SETTLEMENT_RATE = 0.4936;

/** Stage 2 on a PROMOTED sale. The creator's 5% comes out of this tranche and
 *  only this tranche, so the arithmetic is visible in one place:
 *  0.4936 - 0.05 = 0.4436. */
export const FINAL_SETTLEMENT_RATE_PROMOTED = 0.4436;

export const CREATOR_RATE = 0.05;

/** 89.36% direct, 84.36% promoted. */
export const ARTISAN_TOTAL_RATE = ADVANCE_RATE + FINAL_SETTLEMENT_RATE;
export const ARTISAN_TOTAL_RATE_PROMOTED = ADVANCE_RATE + FINAL_SETTLEMENT_RATE_PROMOTED;

export function finalSettlementFor(gross: number, promoted = false): number;
export function artisanTotalRateFor(promoted: boolean): number;
export function artisanSharePctFor(gross: number | null | undefined, promoted = false): number;
```

Keep the **optional parameter defaulting to `false`** so every existing call site compiles and keeps
its current behaviour, then update the call sites deliberately. Do not remove
`FINAL_SETTLEMENT_RATE`; rows settled before this change were settled at that rate and their history
must stay readable.

### 13.3 Snapshot the rate on the row — the correctness point that matters

The deduction must depend on whether the sale **was** promoted, decided at checkout, **not** on the
artisan's profile flag as read later. An artisan who opts out next month must not retroactively
change a settled sale, and one who opts in must not have last month's direct sales re-priced.

Add to `model CraftItem`:

```prisma
  /// Which rate pair this sale was priced at, snapshotted by
  /// /api/payments/create-order. DIRECT | PROMOTED. Null on rows that predate
  /// this column, which the settlement engine must read as DIRECT — that is what
  /// they were.
  commissionModel      String?
  /// The artisan's total share as a fraction, frozen at checkout. Read by the
  /// settlement engine and by every figure shown to the artisan or the buyer, so
  /// a later change to the constants above can never rewrite a completed sale.
  artisanShareRate     Float?
  /// ARTISAN | PLATFORM — who funded the creator's 5% on this sale. Written
  /// only when `affiliateCreatorId` is set.
  creatorFundedBy      String?
```

`/api/payments/create-order` sets all three at the moment it resolves `affiliate`:
`promoted = Boolean(affiliate)`; `commissionModel = promoted ? 'PROMOTED' : 'DIRECT'`;
`artisanShareRate = artisanTotalRateFor(promoted)`; `creatorFundedBy = promoted ? 'ARTISAN' : null`;
and `finalSettlementAmount = finalSettlementFor(price, promoted)`.
`advanceAmount` is unchanged.

`/api/payments/settle-escrow` reads `artisanShareRate` / `commissionModel` **from the row** and never
recomputes from the live constants. A null `commissionModel` means DIRECT.

**Attribution integrity:** a sale is PROMOTED only when the buyer genuinely arrived through the
creator's link **and** the artisan had `promotionOptIn` true at that moment. Check both in
`create-order`; if `promotionOptIn` is false, ignore the `?ref=` for commission purposes entirely —
no creator commission, no deduction, and log that decision. An affiliate link must never be able to
reduce a non-participating artisan's earnings.

### 13.4 Informed consent — the opt-in must show the real money

`src/app/artisan/marketing/page.tsx` — the opt-in toggle (`ArtisanProfile.promotionOptIn`) becomes a
two-step confirmation that shows the artisan **their own numbers**:

- A comparison table computed from **one of their real listed pieces** (their median listing price, or
  the highest-priced listed piece — state which):
  | | Direct sale | Through a creator |
  |:--|--:|--:|
  | Listing price | ₹X | ₹X |
  | Advance on dispatch (40 %) | ₹A | ₹A *(unchanged)* |
  | Final settlement | ₹F | ₹F′ |
  | **You receive** | **₹T (89.36 %)** | **₹T′ (84.36 %)** |
  | Creator's share | — | ₹C (5 %) |
  | Difference | — | **−₹D** |
- Every figure from `advanceFor()` / `finalSettlementFor()` on a real price. If they have no listed
  piece, use a clearly-labelled ₹5,000 illustration — and say it is an illustration.
- Plain-language framing that is neither a hard sell nor a scare: promotion is optional, the 5 % comes
  out of the artisan's own share, it applies **only** to sales a creator's link actually brings, the
  advance is unaffected, and it can be switched off at any time (with the note that sales already in
  flight keep the terms they were sold under — because that is what the snapshot does).
- Require an explicit checkbox before the toggle commits. Write an `AuditLog`-style trail: since
  `AuditLog` is keyed to a `CraftItem`, add a `Notification` (`type: 'SYSTEM'`) recording the opt-in
  or opt-out with its timestamp, and log it server-side. If you prefer a real audit row, add a
  `ProfileAuditLog` model — but do **not** bend `AuditLog`'s required `craftItemId`.

### 13.5 Every surface that prints the share

Grep for `artisanSharePctFor`, `ARTISAN_TOTAL_RATE`, `89.36`, `89.4`, `0.8936` and `SETTLEMENT_LABEL`
across `src/` and update **all** of them to be attribution-aware:

| Surface | Correct behaviour |
|:--|:--|
| `/marketplace` cards, `ProductClient` | a listed (unsold) piece shows the **direct** share, because that is what a direct buyer's purchase pays. When the visitor arrived via `?ref=`, show the promoted share and say a creator referred them — the buyer pays the same either way and is entitled to know the split |
| `/verify/[patchId]` passport | **post-sale**, use the row's frozen `artisanShareRate`; pre-sale, the direct rate |
| `/artisan/earnings`, dashboard | realised figures are already actual money; where a *projected* share is shown, use the row's frozen rate |
| `/artisan/marketing` | the attributed-sales list shows, per sale, the creator's commission and the artisan's actual share — the real deduction, per row |
| `/creators` public page | states plainly that the 5 % is funded by the participating artisan, who opts in. Do not describe it as a platform-funded bonus |
| `escrow.ts` doc comments | **rewrite them.** The current comment asserts the opposite of the new model and would be the single most damaging thing left in the file |
| `docs/CONTRACT.md`, `README.md` (the escrow/affiliate sections) | update to the real model |

### 13.6 i18n keys

`promo_optin_title`, `promo_optin_lede`, `promo_compare_direct`, `promo_compare_promoted`,
`promo_row_price`, `promo_row_advance`, `promo_row_final`, `promo_row_you_receive`,
`promo_row_creator`, `promo_row_difference`, `promo_advance_unchanged`, `promo_only_on_referred`,
`promo_can_switch_off`, `promo_inflight_note`, `promo_illustration_note`, `promo_confirm_checkbox`,
`promo_enable`, `promo_disable`, `promo_enabled_on`, `promo_disabled_on`, `share_direct_label`,
`share_promoted_label`, `share_referred_by`, `creator_funded_by_artisan`.

### 13.7 Worked examples — the code must reproduce these exactly

With `rupees()` = `Math.round`:

| Gross | Advance (40 %) | Final direct (49.36 %) | Artisan direct | Final promoted (44.36 %) | Artisan promoted | Creator (5 %) |
|--:|--:|--:|--:|--:|--:|--:|
| 1,000 | 400 | 494 | **894** | 444 | **844** | 50 |
| 4,500 | 1,800 | 2,221 | **4,021** | 1,996 | **3,796** | 225 |
| 12,000 | 4,800 | 5,923 | **10,723** | 5,323 | **10,123** | 600 |
| 999 | 400 | 493 | **893** | 443 | **843** | 50 |

Compute these values yourself from the constants and confirm the table before writing the UI; if any
cell differs, the rounding in your implementation differs from `rupees()` and you must fix the code,
not the table.

Add `src/lib/__tests__/escrow.test.mjs` following the §2.11 convention (esbuild + `node:assert`, no
framework), asserting:

- the four worked rows above, exactly;
- for every gross from 100 to 100,000 in steps of 37:
  `Math.abs( (promotedFinal + creatorCommission) - directFinal ) <= 1`.
  This is provable rather than approximate: `0.4436 + 0.05 = 0.4936` exactly, so the two roundings can
  differ from the single rounding by at most one rupee. It is the assertion that proves the creator's
  cut comes out of the artisan's tranche and the platform's share is untouched;
- `artisanTotalRateFor(false) === 0.8936` and `artisanTotalRateFor(true) === 0.8436`;
- `finalSettlementFor(x)` with no second argument equals `finalSettlementFor(x, false)` for the whole
  sweep — i.e. the default really is backward-compatible.

### 13.8 Edge cases

1. `?ref=` present but the artisan has **not** opted in → direct rates, no creator commission, no
   `affiliateCreatorId` written. Verify with a real request.
2. Opted in, but the buyer arrived directly → direct rates.
3. Artisan opts out **after** a promoted sale is paid but **before** settlement → the frozen
   `artisanShareRate` on the row still governs. This is the test that proves the snapshot works.
4. Rows with `commissionModel` null (all existing rows) → treated as DIRECT everywhere, including in
   the settlement engine and the earnings figures. No migration of historical rows.
5. An invalid/unknown `?ref=` handle → no attribution, direct rates (the existing route already
   resolves the creator; confirm the null path).
6. A creator's payout failing at settlement → the artisan's tranches must still settle; the creator
   payout retries independently, exactly as the current code separates them. Verify the artisan is
   never blocked by a creator's bad VPA.
7. The opt-in comparison for an artisan with no listed piece → the labelled illustration.
8. Every displayed percentage comes from the constants; grep proves no literal `89.4` or `84.6`
   survives in JSX.

### 13.9 Verification checklist

- [ ] `escrow.test.ts` passes, including the four worked rows and the 100→100,000 sweep
- [ ] Buy a piece from an opted-in artisan via `?ref=handle` → row has `commissionModel: PROMOTED`,
      `artisanShareRate: 0.8436`, `creatorFundedBy: ARTISAN`; settlement pays 40 % + 44.36 % and the
      creator 5 %
- [ ] Buy the same artisan's piece directly → DIRECT, 40 % + 49.36 %, no creator row
- [ ] Buy from a **non**-opted-in artisan via `?ref=` → DIRECT, no commission, decision logged
- [ ] Opt out after a promoted sale → that sale still settles at the promoted rate it was sold under
- [ ] Opt-in screen shows the artisan's **own** real price and the exact rupee difference, and
      requires the checkbox
- [ ] Marketing page lists each attributed sale with its real commission and real artisan share
- [ ] `escrow.ts` comments, `/creators`, `README.md` and `docs/CONTRACT.md` all describe the
      artisan-funded opt-in model; no file still claims the platform funds it
- [ ] Grep: no hardcoded `89.4` / `84.6` / `0.8936` in any component
- [ ] Gates clean, four languages

**Commit:** `feat(v12/13): artisan-funded opt-in creator commission with per-sale rate snapshot`

---

# APPENDIX A — CONSOLIDATED SCHEMA CHANGES (reference only; apply per phase)

| Phase | New models | Modified models |
|:--|:--|:--|
| 1 | `OfflineSale` | `User.offlineSales`, `CraftItem.offlineSale` |
| 2 | `MarketplaceSearch` | — |
| 3 | `CreditProfileShare` | `User.creditShares` |
| 4 | — | — |
| 5 | `LearningProgress` | `User.learningProgress` |
| 6 | `SupplyReminderState` | `User.supplyReminderState` |
| 7 | — | — |
| 8 | — | `Scheme` interface in `src/lib/schemes.ts` (not Prisma): `equipmentFunding`, `sourceUrl`, `verifiedOn`; `SchemeKey` += `pmegp`, `mudra`, `sfurti` |
| 9 | `ArtisanBadge` | `User.badges` |
| 10 | `DesignConcept` | `User.designConcepts` |
| 11 | `MotifRegistration`, `MotifLicence`, `MotifPayoutShare` | `User.motifRegistrations`, `User.motifPayoutShares`, `CraftItem.motifRegistrations` |
| 12 | `ScrapLot`, `ScrapPool`, `ScrapEnquiry`, `ScrapPayoutShare` | `User.scrapLots`, `User.scrapShares` |
| 13 | — | `CraftItem.commissionModel`, `CraftItem.artisanShareRate`, `CraftItem.creatorFundedBy` |

**New status strings introduced:** `CraftItem.status` += `SOLD_OFFLINE` (Phase 1) — and it must be
added to `SOLD_STATUSES` and to `statusBadge()`.

Every added column is **nullable or defaulted**, so `prisma db push` is non-destructive and every
existing row keeps its meaning. Never make an existing column required. Never drop a column in this
programme.

# APPENDIX B — SHARED GUARDRAILS CHECKLIST (re-read before every commit)

- [ ] No hardcoded/fake/sample data on any surface; every figure traces to a row or a named constant
- [ ] Empty state **and** not-enough-data state exist and name their own thresholds
- [ ] Medians (not means) for every market/benchmark statistic, with a minimum sample size enforced
- [ ] Money that did not move is never shown as received; SIMULATED payouts labelled SIMULATED
- [ ] The four income streams (escrow / demand / offline / scrap) stay separately labelled
- [ ] No new npm dependency
- [ ] Every AI path degrades to a deterministic fallback and is labelled as AI when it is AI
- [ ] No fabricated business names, phone numbers, video IDs, recycler names, or scheme amounts
- [ ] No claim of GI registration, legal IP protection, credit rating, blockchain, or AI authentication
- [ ] Every new string in all four dictionaries, with real translations
- [ ] `logCraftItemEvent()` on every `CraftItem` state change
- [ ] Timestamp-presence idempotency guards on every new step; `@@unique` where a double-write is
      conceivable
- [ ] Public routes leak no PII: explicit field allow-lists, not delete-lists
- [ ] `role="status"` / `aria-live`, `aria-label` on icon buttons, focus trapping in modals
- [ ] No `alert()` / `confirm()` / `prompt()`
- [ ] Dates and relative times hydration-safe (explicit locale + IST, or filled in an effect)
- [ ] `unoptimized` + empty-src guard on every data-URL `<Image>`
- [ ] Works at 360 px; motion inside the `kg-*` classes so reduced-motion is honoured
- [ ] `npx tsc --noEmit` · `npm run lint` · `npm run build` all clean
- [ ] Zero React warnings and zero uncaught errors in the browser console

# APPENDIX C — RESUME PROMPT (for a later session)

> Paste this file again, then say:
>
> **"Resume KARIGARI enhancements from PHASE `<n>`.** Read
> `KARIGARI-main/KARIGARI/docs/ENHANCEMENTS_PROGRESS.md` first, confirm the working tree is clean and
> that the previous phase's commit is present, then execute **only** PHASE `<n>` per the master
> prompt — gates, ledger update, commit, STOP block. Do not start PHASE `<n+1>`."

If the ledger and the git log disagree, trust the **git log** and correct the ledger, saying what you
changed and why.

# APPENDIX D — DEMO ORDER (for the human, once phases are done)

The order to walk a judge through, which is also a good smoke test of the whole programme:

1. **Artisan dashboard** — sync chip, supply nudge, credit score card, badges, skill stage.
2. **Log an offline sale by voice** in Odia → earnings shows three labelled streams and the
   offline-vs-online difference from real data.
3. **Design Lab** — describe a pattern, manipulate the SVG live, start a listing from it.
4. **Register the motif** → then re-register a resized crop and watch the fingerprint catch it.
5. **Hand the judge the physical piece** → they scan the patch → craft story, provenance timeline,
   three-layer trust framing, "want something similar".
6. **Credit profile** → share link → open it on the judge's own phone from the QR.
7. **Workshop Resources** → cluster repair request, cited equipment schemes, scrap pool progress.
8. **My Buyers** → repeat buyers, real search trends, unmet demand terms.
9. **Turn the wifi off** → browse, start a listing, log a sale → turn it on → watch it sync.
10. **Q&A backstops**: k-anonymous benchmarks, the artisan-funded opt-in commission with its real
    rupee comparison, and the honest limits of the motif registry.

---

*End of master prompt. Phase 0 starts now — and stops when it is done.*



