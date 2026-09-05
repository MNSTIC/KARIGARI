# KARIGARI — Final Polish Master Prompt (Speed, Low-Bandwidth, Robustness, Bug Sweep)

You are working inside the KARIGARI Next.js 15 / React 19 app (App Router, TypeScript, Prisma + Postgres, Tailwind, next-pwa). All features are shipped; this pass is about making the platform FAST on weak devices, USABLE on weak internet, ROBUST against bugs, and CONSISTENT across every page/tab/button. Nothing is to be hard-coded, mocked, or shortcut-inlined.

Priorities, in strict order:
1. **AI response speed** — every AI call in the codebase must return faster.
2. **Low-bandwidth resilience** — the app must load and function on 2G/edge-of-signal connections.
3. **Bug sweep** — no error codes, no broken buttons, no wrong rendering left.
4. **Interactivity/responsiveness** — fast on the cheapest Android phone possible.

Work in the four phases below IN ORDER. Do not begin a phase until the previous phase compiles, `npm run build` succeeds, and you have measured a real before/after improvement where the phase demanded one.

---

## PHASE 1 — AI SPEED (highest priority)

### 1.1 Audit every AI call site
Do not skip any. Grep and enumerate:
```
grep -rln "generateContentWithFallback\|ai.models.generateContent\|groqChatCompletion\|@google/genai\|groq" src/
```
Confirmed hot paths:
- `src/app/api/items/vision-verify/route.ts`
- `src/app/api/items/attach-verify/route.ts`
- `src/app/api/items/smart-draft/route.ts`
- `src/app/api/items/voice-parse/route.ts`
- `src/app/api/items/price-research/route.ts`
- `src/app/api/items/price-estimate/route.ts`
- `src/app/api/items/price-market/route.ts`
- `src/app/api/items/claims-check/route.ts`
- `src/app/api/items/catalog/route.ts`
- `src/app/api/artisan/chat/route.ts`
- `src/app/api/artisan/insights/route.ts`
- `src/app/api/artisan/generate-materials/route.ts`
- `src/app/api/artisan/generate-news/route.ts`
- `src/app/api/artisan/vision-verify/route.ts`
- `src/app/api/verify-authenticity/route.ts`
- `src/app/api/voice-assistant/route.ts`
- `src/app/api/buyer/orders/verify/route.ts`
- `src/app/api/buyer/verify-item/route.ts` (if present)
- `src/app/api/demand/match/route.ts`
- `src/app/api/demand/recommend/route.ts`
- `src/app/api/creators/match-outreach/route.ts`

For each, apply the fixes below where relevant. Do NOT change the response shape or contract — the front end already depends on it.

### 1.2 `src/lib/gemini.ts` — the core changes

1. **Reorder `FALLBACK_MODELS` fastest-first.** The current list starts with `gemini-3.7-flash` which returned 503 in prior tests; that means one bad call now serialises across two slow rejections before landing on something responsive. Reorder to:
   ```ts
   export const FALLBACK_MODELS = [
     'gemini-3.1-flash-lite',   // ~1.3s, most reliable
     'gemini-3.5-flash',         // ~2s with thinking disabled
     'gemini-flash-latest',
     'gemini-3.7-flash',
   ];
   ```
   For text-only, small-JSON calls this is a wall-clock win. Keep the current list as `FALLBACK_MODELS_QUALITY` for callers that need the strongest reasoning (currently: `smart-draft`, `claims-check`, `insights`) and let `generateContentWithFallback` take an optional `{ models?: string[] }` override — do not fork the function.

2. **Disable "thinking" on every non-reasoning call.** For Gemini 2.5/3.x flash-family, thinking adds 2–8 seconds of latency for a JSON classification. Pass:
   ```ts
   thinkingConfig: { thinkingBudget: 0 }
   ```
   in the config for every call whose output is a small JSON classification (vision-verify, attach-verify, price-estimate, voice-parse, price-research, buyer verify, demand match, catalog). Keep thinking enabled ONLY on `smart-draft`, `claims-check`, `insights`, `generate-materials`, `generate-news`, `artisan/chat`, `voice-assistant` — where reasoning quality matters.

3. **Per-model hard timeout.** Add an `AbortController` per model attempt with a 6-second timeout for thinking-off calls, 15 seconds for thinking-on calls. On timeout, fall through to the next model rather than dangling the whole request behind Google's default 60s. Wire it as:
   ```ts
   const controller = new AbortController();
   const timer = setTimeout(() => controller.abort(), timeoutMs);
   try {
     return await ai.models.generateContent({ model, contents, config: { ...rest, abortSignal: controller.signal } });
   } finally { clearTimeout(timer); }
   ```
   Do NOT swallow abort errors — treat them as retryable (same class as 503), fall to the next model.

4. **`responseMimeType: 'application/json'` everywhere the caller expects JSON.** Grep for `.replace(/^```(?:json)?\s*/i,'')` — every site that strips markdown fences is a site that forgot to force the JSON mime. Add it in the config. This lets you delete the fence-stripping regex — one fewer failure mode when the model wraps output differently.

5. **In-memory response cache for idempotent prompts.** Add a small LRU (Map with size cap 200, TTL 5 min) keyed on a SHA-1 of `(model, prompt-text, first-image-digest)`. Apply ONLY to `price-research`, `price-market`, `price-estimate`, `catalog`, `voice-parse`, `smart-draft`, `insights` — never to vision-verify or authenticity checks (those must run fresh every time). Same-prompt repeats within a 5-minute window return the cached JSON.

6. **Compress inline image payloads before sending to Gemini.** Every vision call currently ships the raw uploaded 2 MB data URL. Add a shared helper `src/lib/imagePrep.ts`:
   - Downscale to max 1024 px on longest edge.
   - Re-encode as JPEG q=0.72.
   - Strip EXIF.
   - Return a base64 payload typically ≤ 200 KB.
   Run this on the SERVER at the entry of every vision route BEFORE the Gemini call — this cuts multipart upload time to Google's endpoint by 5–10× on weak links. Use `sharp` (already common in Next.js projects — add to deps only if not present) OR do it purely with `@napi-rs/canvas`/`node:zlib`/`node:buffer` if `sharp` is not desired. If `sharp` is used, do the same client-side downscale via `<canvas>` before upload so bandwidth is saved on the artisan's end too — see 2.4.

### 1.3 Streaming for chat / voice / long-form AI

For `src/app/api/artisan/chat/route.ts` and `src/app/api/voice-assistant/route.ts`, switch to streaming. Return a `ReadableStream` of NDJSON chunks (or SSE) instead of one big `NextResponse.json`. Consume it in the corresponding client with a `for await (const chunk of ...)` and progressively append tokens. This does not lower total time-to-completion but drops perceived latency from "10s of silence" to "first tokens in ~300ms". Keep the non-streaming JSON return as a fallback when the client sends `Accept: application/json` (mid-flight parsers, tests).

### 1.4 Parallelise every serial AI call chain
Grep for consecutive `await generateContentWithFallback(` in the same handler. Notable case: `smart-draft` currently sequences description → tags → category. If the outputs are independent, wrap them in `Promise.all` — three 1.5s calls become one 1.5s wall-clock instead of 4.5s. Do NOT parallelise calls that consume each other's output.

### 1.5 Groq path (`src/lib/groq.ts`)
- Prefer Groq for text-only, latency-sensitive JSON classifications (Groq's flash models are typically 3–8× faster than Gemini). Route `voice-parse`, `catalog`, `price-research`, `demand/match`, `demand/recommend` through Groq FIRST with a Gemini fallback — not the other way round.
- Cap Groq requests at 3 s per attempt; on timeout fall to Gemini as today.
- Never use Groq for vision — it has no image input. Vision remains Gemini-only.

### 1.6 Client-side loading UX
- Add optimistic skeletons on every AI-triggered card. Grep for `Loader2` — where it stands alone on a blank card, replace with a shimmering skeleton matching the shape of the eventual content. Users perceive skeletons 30–40% faster than spinners.
- Debounce (350 ms) every AI call that fires from a text input change (`price-estimate`, `voice-parse` when driven by inline edits) — kill in-flight requests when the input changes again with `AbortController`. Grep for `useEffect(...fetch...)` on input-driven values.

### 1.7 Measure it
For each hot path above, log `console.time`/`console.timeEnd` in dev and record the before/after (median of 5 runs) in the final report. If a change does NOT reduce median time by ≥ 25% on that route, revert it — do not keep code whose only merit is "should be faster in theory".

---

## PHASE 2 — LOW BANDWIDTH / OFFLINE ROBUSTNESS

### 2.1 Payload budget audit
Run `npm run build` and read the `.next/build-manifest.json` + the Route (Size / First Load JS) table Next.js prints. Identify every route whose First Load JS > 200 KB gzip. Priority targets:
- `/artisan/dashboard`
- `/artisan/market`
- `/marketplace`
- `/buyer`
- `/admin/facilitator` and `/admin/nodal`
- The Craft Capture flow (`CaptureModal.tsx` is 93 KB source alone).

For each oversized route:
1. Convert every non-critical child component to `next/dynamic` with `ssr: false, loading: () => <Skeleton />`. Priority: `Recharts` charts, `react-leaflet` maps, `VoiceOnboarding`, `AssistedOnboardingModal`, `CaptureModal`, `SmartDraftAssistant`, `AgentHandoffModal`, `SchemeFormAssistant`, `@imgly/background-removal` (already lazy — confirm it stays that way).
2. Move all AI SDKs (`@google/genai`, `@google/generative-ai`, `groq-sdk`) OUT of any client-imported module. Grep the client bundle for these — they must exist only in `/api/**` server routes.
3. Split `src/lib/i18n/*.ts` — each language file is 55–108 KB. Dynamically import the active locale ONLY, not all four. Load the locale by `await import(`./i18n/${locale}.ts`)` in the language provider, keyed on the user's selection.

### 2.2 Image discipline
- Every `<img>` and `next/image` in the app: audit for missing `sizes`, missing `loading="lazy"`, missing `placeholder="blur"`. For data-URL captures where `blurDataURL` isn't practical, use a tiny hand-generated 10x10 JPEG blur placeholder.
- Add client-side image compression BEFORE any upload (BuyerOrders verify, CaptureModal capture, QrAttachModal attach, ProfileEditor). Shared helper `src/lib/clientImagePrep.ts`:
  ```ts
  export async function prepareImage(file: File, opts?: { maxEdge?: number; quality?: number }): Promise<string> { /* canvas downscale → JPEG dataURL */ }
  ```
  Default: 1600 px max edge, JPEG q=0.78. Enforce ≤ 800 KB result. If bigger, drop quality to 0.65 and retry. Use this everywhere `readFileAsDataUrl` is currently used.

### 2.3 Prisma `select` audit
Every API route: replace `include:` and unbounded selects with explicit `select:` that names ONLY the columns the client actually renders. Especially the dashboard endpoints (`/api/artisan/dashboard`, `/api/admin/dashboard`, `/api/buyer/orders`, `/api/marketplace`, `/api/creators/stats`). Cutting even 3 KB per row × 40 rows is 120 KB the phone doesn't download.

### 2.4 API response compression + caching headers
- Add `Cache-Control: private, max-age=15, stale-while-revalidate=60` on read-only dashboard/analytics endpoints so a re-poll within 15 s serves from the browser cache. Do NOT cache mutating routes or auth-scoped user data beyond the user's own session.
- Set `Content-Encoding: gzip` at the Vercel/Next layer — verify it's on for JSON responses ≥ 1 KB. If a self-hosted target, add `Accept-Encoding` handling in the middleware.

### 2.5 Service worker precache expansion
Already using `@ducanh2912/next-pwa` — see `next.config.ts`. Extend the runtime caching rules with:
- API GETs that back the artisan/marketplace/buyer dashboards: `NetworkFirst` with `networkTimeoutSeconds: 3` and a 24 h cache, so a 2G tap gives the cached view within 3 s and the fresh one arrives on refresh.
- Thumbnail route `/api/items/*/thumbnail`: `CacheFirst`, 30 days.
- Leave the 24 MB `@imgly/background-removal` model excluded — do not precache it.

### 2.6 Offline queue drainage
`src/lib/offlineQueue.ts` exists. Confirm:
- All craft captures (`/api/items/capture`), all order-log posts (`/api/artisan/orders/log`), all bill uploads (feature 3) go through the queue when navigator.offline is true.
- The queue drains automatically on `online` event, in FIFO order, with idempotency keys so a retried POST is not duplicated by the server. Add an `Idempotency-Key` header (UUID generated at enqueue) that the server checks against a small `IdempotencyKey` Prisma table (create it if missing: `{ key: string @unique, createdAt: DateTime, expiresAt: DateTime }`, TTL 24 h).

### 2.7 Network-condition-aware behaviour
Read `navigator.connection.effectiveType` on the client (fallback: assume 4g) and expose it through a `useNetworkQuality()` hook. On `slow-2g` or `2g`:
- Skip the `background-removal` enhancement offer entirely (24 MB download is ludicrous).
- Reduce polling intervals (facilitator's `POLL_MS = 15000`) to 45 s.
- Serve low-res images: request `/api/items/*/thumbnail?w=200` variant instead of the full data URL. Extend the thumbnail route to accept a `?w=` query and downscale accordingly.
- Show a small "Slow connection — reduced media" pill in the top bar so the user knows why.

---

## PHASE 3 — BUG SWEEP (every page, every tab, every button)

Run this checklist end-to-end. For every issue found, fix it and log it in the final report with the file:line and the failing case.

### 3.1 TypeScript + Build
- `npx tsc --noEmit` — must be clean. Fix every error found, no `@ts-ignore` unless the reason is documented on the line above.
- `npm run lint` — clean. Fix any warning that indicates a real bug (unused catch, missing dep in useEffect that could stale-close).
- `npm run build` — clean. Any `Failed to compile` output must be fixed at the source, not silenced.

### 3.2 Runtime error scan
Open every page in the app in dev + Chrome DevTools, walk through every tab and button, and record every red console message. Fix each root cause:
- Uncaught Promise rejection → add `.catch` and surface a user-friendly toast/message.
- Hydration mismatch → find the branch that reads `window`/`Date`/`localStorage` during render and move it into a `useEffect` guarded by `typeof window !== 'undefined'`.
- 404 on an API GET → the endpoint or its route file is missing; add it or fix the caller URL.
- 500 on a POST → open the server log, find the throw, fix.

Priority routes to walk (must all work):
- `/`, `/login`, `/register`
- `/artisan/dashboard`, `/artisan/market`, `/artisan/orders`, `/artisan/materials`, `/artisan/insights`, `/artisan/schemes`, `/artisan/learn`, `/artisan/notifications`, `/artisan/cluster`, `/artisan/earnings`, `/artisan/marketing`, `/artisan/news`
- `/buyer`, `/buyer/verify` (if present)
- `/marketplace`, `/marketplace/product/[id]`
- `/creators`
- `/admin/facilitator?tab=qa`, `?tab=cluster`, `?tab=tickets` (if present)
- `/admin/nodal?tab=impact`, `?tab=audit`
- `/verify/[patchId]` and `/verify/[patchId]?scan=1`
- `/offline`

Every button on every page:
- Click every button. Does it do what its label says?
- Does it show a loading state during the async work?
- Does it become disabled during that work so a double-click can't double-submit?
- If it opens a modal, does the modal close cleanly? Does its state reset between opens?
- If it navigates, does the destination render without a 404?

### 3.3 Hardcoded content audit
- Grep for hard-coded English literals in JSX that should route through `useLanguage()/t(...)`. In every component that already imports `useLanguage`, EVERY user-facing string must go through `t(...)`. Fix any that don't and add the key to `src/lib/i18n/en.ts`.
- Grep for hard-coded currency, dates, quantities in UI. Prices go through `formatRupees` from `src/lib/pricing.ts`. Dates go through `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`.
- Grep for hard-coded artisan names, buyer names, phone numbers, cluster names in components — these are demo residue and must come from the API.
- Grep for `TODO`, `FIXME`, `XXX`, `HACK` and either resolve or move to a tracked issue with a comment explaining why.

### 3.4 Layout / responsive audit
Test each page at three widths: 320 px (small Android), 375 px (typical phone), 768 px (tablet), and 1280 px (desktop). Fix:
- Any horizontal overflow — the whole page must scroll only vertically.
- Any tap target < 44 px × 44 px — bump padding to hit that minimum. Same target the existing `min-h-[44px]` pattern uses across the codebase.
- Any text so small it wraps to 5+ lines on 320 px — increase the container width or shrink the text sensibly.
- Any modal that doesn't fit on 320 px — make it a full-screen sheet on `sm:` and below.
- Any overlapping element in dark mode — verify contrast against `[data-theme="dark"]`.

### 3.5 Logic errors specific to KARIGARI
- Health-score bounds: pass a boundary test (0-floor on penalty, 100-cap on reward) for the flow in `src/lib/artisanHealth.ts` (or wherever the constants live).
- Escrow math: `advanceAmount + finalSettlementAmount + affiliateCommission + platform-fee ≈ paidAmount`. Add a Prisma-side sanity assertion in `settle-escrow` route: throw if the sum drifts by more than 1 paise.
- Order stages: `resolveStage` in `src/lib/orderStage.ts` — confirm every combination of (status × escrowStatus × qrVerified × productionStage) resolves to a defined stage. Add unit tests in `src/lib/__tests__/orderStage.test.ts` (or an `.mjs` runner if there's no test framework yet) covering all 32 combinations.
- Auth: every `/api/admin/**` route must call the JWT verify + role === 'ADMIN' guard. Any route missing that guard is a bug — add it.
- Every route with `dynamic = 'force-dynamic'` should stay dynamic; any route without it that reads cookies must add it. Grep both.

### 3.6 Accessibility quick pass
- Every `<button>` without accessible text needs `aria-label`.
- Every `<img>` and `<Image>` needs an alt.
- Focus rings must be visible on keyboard-only navigation — grep for `outline-none` without a `focus-visible:ring` sibling and fix.

---

## PHASE 4 — INTERACTIVITY / DEVICE PERFORMANCE

### 4.1 Rendering
- Wrap top-level lists in `startTransition` when the source data updates (React 19). Grep for `.map(` producing > 20 rows in one render — dashboard cards, marketplace grid, admin queues.
- Use `useDeferredValue` on any live-search input that filters a big list (creators, marketplace search).
- Apply `content-visibility: auto` on off-screen sections (cards below the fold on `/artisan/market`, `/marketplace`, `/admin/facilitator`).
- Memoise heavy list rows with `React.memo` when their props are stable — but don't scattershot memoize everything, only components rendering > 20 times per screen.

### 4.2 Startup
- Preload critical fonts (already Google Fonts) with `<link rel="preload" as="font" crossOrigin="anonymous">` for the primary weight only. Do not preload every weight.
- Preload the first route the user lands on for each role: `next/link` `prefetch={true}` on the login redirect target.
- Move the 3D globe (`india_clean.glb`, 50 MB) OUT of any startup path. Confirm it's only fetched from the landing page's hero, and only when the hero enters the viewport (Intersection Observer). If it's not essential, remove the fetch entirely.

### 4.3 Bundle deletion
- `npx depcheck` — remove every unused dependency.
- `@google/generative-ai` and `@google/genai` are BOTH in deps. Pick one (the newer `@google/genai` — already used by `src/lib/gemini.ts`), delete the other, and update every import. This removes a whole duplicate SDK from the client bundle if anywhere it leaked in.

### 4.4 Final metrics
Report:
- Median AI wall-clock per route (before → after) — must show ≥ 25% reduction on the routes edited in Phase 1.
- First Load JS per priority route (before → after) — must drop for every route flagged in 2.1.
- Lighthouse mobile score on `/artisan/dashboard` and `/buyer` (throttled to Fast 3G, 4× CPU slowdown): Performance ≥ 85, Accessibility ≥ 95.
- Bundle size summary from `.next/analyze` if next-bundle-analyzer is added (add it as a devDependency; run `ANALYZE=true npm run build` once).

---

## DELIVERABLE

At the end, produce a single report with these sections:
1. **AI speed table** — one row per route edited, showing before/after median ms and what changed.
2. **Bundle size table** — same, per route.
3. **Bug list** — every issue found in Phase 3 with the fix reference (file:line, one-line description).
4. **Regressions guarded** — a list of the flows you re-tested end-to-end to confirm nothing broke (login → buyer verify → admin ticket resolve → artisan health-score update → craft capture with bill → QR scan → payment).
5. **What was NOT done and why** — anything you skipped, and the specific evidence for why the trade-off wasn't worth it (e.g., "attempted to inline the 3D globe reader, reverted: 800 ms cold cost with no perceptible visual win").

Constraints, restated:
- No hard-coding of images, names, prices, patch IDs, or seed rows.
- No mocked AI responses.
- Every user-facing string goes through i18n.
- Every change must reduce a measurable metric OR fix a documented bug — no cosmetic churn.
- Preserve every existing API contract; changes are internal.

END OF PROMPT.
