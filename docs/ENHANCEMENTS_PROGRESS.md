# KARIGARI V12 Enhancement Programme — Progress Ledger

Branch: feat/v12-enhancements
Baseline commit: c70097a (c70097ada1c3d31199342953c7f9dcd85f6c7125, branched from `feat/gov-catalog-export`)
Baseline gates: tsc PASS | lint 293 (115 errors, 178 warnings — all pre-existing) | build PASS

Spec: `KARIGARI_ENHANCEMENTS_V12_MASTER_PROMPT.md` at the app root.

| Phase | Feature | Status | Commit | Date | Notes |
|:--|:--|:--|:--|:--|:--|
| 0 | Baseline & ledger | DONE | (this commit) | 2026-09-16 | No feature code. Baseline gate numbers below. |
| 1 | Hybrid Income Tracker (offline sale ledger) | PENDING | — | — | — |
| 2 | Buyer Intelligence ("My Buyers" CRM) | PENDING | — | — | — |
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

A commit cannot contain its own hash, so the newest DONE row reads `(this commit)`;
each phase backfills the previous row's short sha when it updates this file.

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
