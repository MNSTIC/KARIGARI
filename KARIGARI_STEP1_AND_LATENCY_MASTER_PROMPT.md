# MASTER PROMPT — Capture Step-1 completeness gate + full latency/slow-render fix

> Paste into **Claude Code** (it has the repo). Two parts: (A) make Capture/Draft Step 1 confirm the three required facts before advancing, and (B) fix the app-wide slowness. Keep the build green and the green heritage theme. App root: **`KARIGARI-main/KARIGARI/`** — `cd` there.

**Stack:** Next.js **16.3.1** App Router (Turbopack), React 19, TS, Prisma 7 (+`@prisma/adapter-pg`), Tailwind v4. Draft/Capture parsing runs on **Gemini** (`@/lib/gemini` `generateContentWithFallback`); transcription on Groq Whisper. Shared helpers: `@/lib/voiceParse` (`parseCraftSpeech`, `transcribeAudio`), `@/lib/pricing` (`estimateCraftValuation`, `formatRupees`), `@/lib/translations` (`useLanguage`). After changes run `npm run build` (zero TS errors).

---

# PART A — Step 1 must confirm PRODUCT, TIME, and MATERIALS before Step 2

**Today's behaviour (the bug):** in `src/components/CaptureModal.tsx`, the Next button is gated only by `isProcessed` (≈ line 1244: `disabled={(step === 1 && !isProcessed) || …}`), and `isProcessed` flips true as soon as `/api/items/voice-parse` returns *anything*. Because `parseCraftSpeech` fills `laborDays`/`rawMaterialCost` with fallbacks (`FALLBACK_LABOR_DAYS=7`, `FALLBACK_MATERIAL_COST=1500`), an artisan who only says "a silk saree" still advances with invented numbers. It must instead detect what was actually stated and ask for the rest.

### A1. Parser returns a completeness verdict — `src/lib/voiceParse.ts`
- Extend `ParsedCraftSpeech` with:
  - `statedProduct: boolean`, `statedTime: boolean`, `statedMaterials: boolean`
  - `missing: string[]` (any of `"product" | "time" | "materials"` not clearly stated)
  - `followUpQuestion: string` — one short sentence, **in the artisan's chosen language**, naming only what's missing (e.g. "Please also tell me how many days it took and what materials you used.")
  - `technique: string | null` — extra cost-relevant context the artisan volunteered: **handmade vs machine, loom/tool used, thread/dye type, count/size**, etc.
- Update `buildPrompt(transcript, targetLanguage)` so the model must:
  1. Decide, per field, whether the artisan **explicitly stated** it (not guessed): the product/craft, the time taken, and the materials used. Return the three booleans + `missing`.
  2. Only estimate `laborDays`/`rawMaterialCost` for context, but **never treat an estimate as "stated"** — the booleans reflect what the human said.
  3. Extract `technique` (machine/handmade/loom/tools/thread) when present, else null.
  4. Write `followUpQuestion` in `languageName(targetLanguage)`, listing only the missing items; empty string when nothing is missing.
- Update `shape(...)` to populate the new fields. Keep the existing fallback numbers for downstream valuation, but set the booleans honestly. `parseCraftSpeech` signature stays the same (already takes `targetLanguage`). The IVR path (`/api/ivr/collect-item`) uses the same function — make sure the added fields are optional-safe there (it can ignore them).
- `src/app/api/items/voice-parse/route.ts` already returns `data: parsed` — no change needed beyond passing the richer object through.

### A2. Accumulate context + gate the Next button — `src/components/CaptureModal.tsx`
- Keep a **cumulative transcript** across Step-1 messages (a ref/state, e.g. `conversationTextRef`). Each time the artisan sends a message (typed via `processWithAI`, or a finished recording via `processAudioWithGroq`), **append** the new words to the running transcript and send the **combined** text to `/api/items/voice-parse` (so "a silk saree" + later "it took 12 days, pure silk thread" merge into one complete parse). Do not overwrite prior info with a partial message.
- After each parse:
  - If `data.missing.length > 0`: **do NOT set `isProcessed`**. Push an assistant bubble with `data.followUpQuestion` (localized) so the artisan is asked for exactly what's missing, and keep the composer active for another voice/text turn. Show a small checklist chip row — Product ✓/○, Time ✓/○, Materials ✓/○ — driven by the booleans, so they can see what's still needed.
  - If `data.missing.length === 0`: set the fields (craftType, laborDays, rawMaterialCost, descriptions, `technique`) and set `isProcessed = true`, then show the existing "AI understood …" summary bubble. Only now is Next enabled.
- Fold `technique` into what gets saved: append it to the English description/`aiGeneratedListing` context and pass it to the Step-3 valuation if practical (see A3). Reset the cumulative transcript when the modal closes/reopens (extend the existing reset logic).
- Keep everything in-app (no browser `alert`); keep the live SpeechRecognition preview already in place.

### A3. Use the extra context in cost (optional but requested)
- `estimateCraftValuation(craftType, laborDays, rawMaterialCost)` in `@/lib/pricing` is the single source. If low-risk, add an optional 4th arg `technique?: string` that nudges the labour/material factor (e.g. "machine-made" trims the labour premium, "handloom/handmade" keeps it). If touching the signature is risky, instead reflect technique in the description and leave the numeric model unchanged. Never recommend below the fair-wage floor.

### A4. Add dictionary keys (all 4 languages)
Add keys used above to `src/lib/translations.ts` for `en`, `hi`, `or`, `te`: e.g. `need_product`, `need_time`, `need_materials`, `checklist_product`, `checklist_time`, `checklist_materials`, `provide_missing_hint`. (The `followUpQuestion` text itself comes from the model in-language, so it needs no key.)

**Verify Part A:** say only "a Sambalpuri saree" → Next stays disabled and the assistant asks for time + materials (in the selected language), checklist shows Product ✓ / Time ○ / Materials ○; add "took 10 days, pure silk and natural dye" → all three ✓, Next enables, summary reflects the merged facts; a single complete sentence advances in one turn.

---

# PART B — Fix latency / slowness / slow rendering (ordered by impact)

The app is slow because large payloads and a large client bundle load on every screen. Do these in order; each is independent.

### B1. Compress captured images (biggest data-size win) — `src/components/CaptureModal.tsx`
Camera capture uses `canvasRef.toDataURL("image/png")` (≈ line 593) — full-resolution **PNG base64**, often multiple MB, stored verbatim in the DB and re-shipped by every list query.
- Add a `downscaleImage(dataUrl, maxEdge=1280, quality=0.8): Promise<string>` helper that draws the image onto a canvas capped at `maxEdge` on the long side and exports **`image/jpeg`** at ~0.8. Run it on: camera captures, file uploads, and the background-removal/enhancement output — so only compact JPEGs (target ≲200 KB) are saved into `images[]`.
- This shrinks the capture POST and, downstream, the dashboard/market/product/passport payloads with zero schema change.

### B2. Stop shipping base64 images + audit logs on the dashboard — `src/app/api/artisan/dashboard/route.ts`
`recentCaptures` uses `include: { auditLogs: … }` with **no `select`**, so it returns the full `images` (base64) array and every audit log for 10 items — multi-MB JSON the table never uses (the table shows craftType, patchId, date, status, action only).
- Replace the `recentCaptures` query with a **`select`** of only the fields the table + status logic need: `id, craftType, descriptionEnglish, patchId, status, isListedOnMarketplace, escrowStatus, advancePaid, finalPayoutQueued, fairWageFloor, createdAt, qrVerified` (add whatever the row/`describeArtisanMoney` reads). **Exclude `images` and `auditLogs`.**
- The **DetailsModal** (`src/app/artisan/dashboard/page.tsx`) is the only consumer of `item.images?.[0]` and `item.auditLogs`. Load those **on demand** when it opens: add/point to `GET /api/items/[id]` (auth-checked, returns that one item's `images` first entry + `auditLogs`) and fetch inside DetailsModal. This removes megabytes from the initial dashboard load.
- Apply the same "select only what's shown" rule to any other list endpoint returning `images` where the UI shows only a thumbnail (`items/market`, `artisan/listings`): keep `images` (needed for cards) but rely on B1's compression; do not also send `auditLogs` unless rendered.

### B3. Load only the active language's dictionary — `src/lib/translations.ts` (223 KB client module, imported by 25 components)
The whole 4-language dictionary is `"use client"` and ships to the browser. Cut it down:
- Split the four dictionaries into separate modules (`src/lib/i18n/en.ts`, `hi.ts`, `or.ts`, `te.ts`), each a plain object export. Keep `en` imported statically (the synchronous fallback), and **lazy-load** the selected non-English dictionary with a dynamic `import()` inside `useLanguage` when `language` changes; until it resolves, `t` falls back to `en` (it already does via `|| dictionary.en[key] || key`). This keeps the API identical and removes ~3/4 of the dictionary weight from first paint.
- Preserve the memoized `t`/`changeLanguage` (`useCallback`) from the earlier fix. Verify no component imports the old `dictionary` export directly; if some do, keep a compatibility re-export.
- If a full split is too invasive in one pass, the minimum acceptable version is: keep English in the main module and move `hi`/`or`/`te` behind a lazy `import()` so English-first users never download the other three.

### B4. Lazy-load heavy modals — dashboard and other pages
In `src/app/artisan/dashboard/page.tsx` (and similar pages), the big modals are imported eagerly into the route bundle: `CaptureModal` (44 KB), `AgentHandoffModal`, `ProfileEditorModal`, `DisputeModal`, `LearningAssistantModal`, `CompleteDraftModal`, plus `GovExportModal` on insights.
- Convert these to `const X = dynamic(() => import("@/components/X"), { ssr: false })` (the pattern already used for `DemandMap` in `insights/page.tsx`). They render only when opened, so their code should not be in the first paint. Guard so a `dynamic` modal is only mounted when its `isOpen` is true (or accept the lightweight loading fallback).

### B5. Kill fetch waterfalls for craft context
Materials, News, and Insights each call `GET /api/artisan/dashboard` **just to read `craftType`/`clusterName`**, then call their real endpoint — two round trips, the first now-heavy call included.
- Add a tiny `GET /api/artisan/profile-lite` returning only `{ craftType, clusterName }` (auth-checked, one indexed query), and use it in `materials/page.tsx`, `news/page.tsx`, and anywhere else that fetches the whole dashboard for those two strings. Smaller + faster than the full dashboard payload.

### B6. Perceived-speed: route skeletons
Add `loading.tsx` files for the artisan routes (`src/app/artisan/dashboard/`, `market/`, `insights/`, `materials/`, `news/`, `schemes/`) rendering a lightweight skeleton (header + a few shimmer cards in the heritage theme). Next shows these instantly on navigation while the client page hydrates/fetches, so screens stop feeling blank/slow.

### B7. Image rendering hygiene
- For base64/data-URL images, prefer a plain `<img>` (or `<Image unoptimized />`) over `next/image` optimization, which cannot optimize data URLs and adds overhead. Ensure every `<Image>`/`<img>` has explicit `width`/`height` or a fixed aspect container to avoid layout shift. Static assets in `/public` keep using `next/image`.
- Confirm no remaining render loops: the memoized `t` fix must be in; grep for `useEffect`/`useCallback` deps that include `t` and drop `t` where it forces refetches (mirror the materials/news fix).

### B8. Quick server wins
- Every DB route that must run per request already sets `export const dynamic = 'force-dynamic'` — keep it, but make sure list endpoints `select` narrowly (B2) so "dynamic" doesn't mean "huge".
- Ensure the Prisma singleton (`@/lib/prisma`) is used everywhere (no per-request `new PrismaClient`). Confirm pooled `DATABASE_URL` is used for queries (not `DIRECT_URL`).

---

## VERIFICATION CHECKLIST
1. `npm run build` — zero TS errors.
2. **Part A:** partial input keeps Next disabled and asks (in the chosen language) for exactly the missing item(s); complete input (one turn or several) enables Next; `technique` is captured and reflected in the description/summary.
3. **B1:** a captured photo saved to a listing is a compact JPEG (inspect the stored string / network payload is hundreds of KB, not multiple MB).
4. **B2:** the `/api/artisan/dashboard` response no longer contains base64 `images` or `auditLogs`; the dashboard table renders fast; opening "View Details" fetches images + timeline on demand and still works.
5. **B3:** first load of a page downloads only English (+ the active language if non-English) dictionary weight, not all four; switching language still works and persists.
6. **B4/B6:** dashboard first paint is quick; modals still open correctly; navigating between artisan tabs shows an instant skeleton.
7. **B5:** Materials/News/Insights make one lightweight profile call instead of pulling the full dashboard.
8. App feels responsive: no infinite spinners, no repeated network calls, no layout shift. End with a summary: files changed, payload-size before/after for the dashboard, and the commands run.

### FILE MAP
**Part A:** `src/lib/voiceParse.ts` (completeness + technique + follow-up), `src/components/CaptureModal.tsx` (cumulative transcript, gate, checklist), `src/lib/pricing.ts` (optional technique arg), `src/lib/translations.ts` (keys).
**Part B:** `src/components/CaptureModal.tsx` (image downscale), `src/app/api/artisan/dashboard/route.ts` (select, drop images/auditLogs), `src/app/api/items/[id]/route.ts` (new, on-demand details) + DetailsModal in `src/app/artisan/dashboard/page.tsx`, `src/lib/translations.ts` → `src/lib/i18n/{en,hi,or,te}.ts` (split + lazy), `src/app/artisan/dashboard/page.tsx` & others (dynamic modal imports), `src/app/api/artisan/profile-lite/route.ts` (new) + `materials/page.tsx` & `news/page.tsx`, `src/app/artisan/*/loading.tsx` (new skeletons).
**Do not touch:** marketplace/escrow/syndication logic, the Groq model chain, the working audio live-preview.
