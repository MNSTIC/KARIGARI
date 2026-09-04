# MASTER PROMPT — KARIGARI Capture Step-1 Smart-Draft Revamp V7

> Paste into **Claude Code** (it has this repo). Revamp **Step 1 of Capture New Craft** so the AI documents each piece with **product-aware, bare-minimum questioning** that becomes the *actual gate* to Step 2 — while spending the fewest possible Gemini turns (Gemini allows only ~20 voice messages/hour). **Most of the infrastructure already exists** (`SmartDraftAssistant` + `/api/items/smart-draft`) — this is a targeted revamp, not a greenfield build. Read §1 before touching code. Keep the theme, i18n, graceful degradation, and the build green; run §V after.

---

## 0. ORIENTATION

**App root:** `KARIGARI-main/KARIGARI/` — `cd` there. Next.js 16.3.1 (Turbopack), React 19.2, TS 5, Prisma 7.9, Tailwind v4. i18n via `useLanguage()` from `@/lib/translations`; **every new string → all four locale files** `src/lib/i18n/{en,hi,or,te}.ts`. Theme tokens in `globals.css` (`primary`, mint, sage). Gemini helper: `GEMINI_CONFIGURED`, `generateContentWithFallback` from `@/lib/gemini`. Artisan auth: `requireArtisan()` from `@/lib/artisanAuth`.

**The exact files that own Step 1 (read all four first):**
1. `src/components/CaptureModal.tsx` — the modal. Step 1 chat + the **old gate**. State: `facts {product,time,materials}`, `isProcessed` (enables **Next**), `primaryInputMethod: 'voice'|'text'`, `craftType`, `englishDescription`, `technique`, `craftDetails`. `applyParse(data)` sets `facts` from `statedProduct/Time/Materials`, and only sets `isProcessed=true` (→ Next enabled) when `missing.length === 0`. It also renders `<SmartDraftAssistant .../>` (~line 1210) **in parallel**.
2. `src/lib/voiceParse.ts` — `parseCraftSpeech()` + `buildPrompt()`. Extracts the **base 3 facts** (product/time/materials), plus `technique`, and returns `missing[]` + `followUpQuestion`. Backs both the app and the toll-free IVR (`/api/ivr/collect-item`) — **do not break the IVR contract**.
3. `src/app/api/items/smart-draft/route.ts` — the **product-aware documenter**. Already: extracts bare-minimum (craft type, specific material, technique, labour days) via a domain cheat-sheet (incl. "which silk? Muga/Tussar/Mulberry/Eri"), caps rounds (clamps `maxRounds` to [1,3]), has a **protected-designation proof guard** (`status='verification_needed'` + gentle `verificationNote`, e.g. Muga claimed from non-Assam), and degrades to `readyToProceed:true` when `!GEMINI_CONFIGURED`. Accepts an (unused-by-client) `artisanLocation`.
4. `src/components/SmartDraftAssistant.tsx` — the follow-up UI. Round caps `MAX_ROUNDS_VOICE=2`, `MAX_ROUNDS_TEXT=3`, chosen by `inputMethod`. **Explicitly "Never blocks Step 1"** and has a Skip button; `onExtracted` feeds material/technique back to the modal.

**The core problem to fix:** there are **two questioners running in parallel** — `voiceParse.followUpQuestion` (old 3-fact) and `SmartDraftAssistant` (product-aware) — and **the product-aware one does not gate anything**. Step 2 unlocks on the old 3-fact check alone, so the deeper product data ("which silk", loom, alloy) is optional and often skipped. The revamp unifies them into **one** flow where the product-aware check **is** the gate, asked in the **fewest turns**.

---

## 1. WHAT TO CHANGE (targeted, surgical)

### 1.1 Consolidate to ONE question that names every gap at once (save voice quota)
In `src/app/api/items/smart-draft/route.ts`, change the questioning strategy from "ask the ONE most useful detail per turn" to **"ask a single consolidated question that lists every bare-minimum gap for THIS product together."** Rationale: a voice artisan should answer all gaps in **one** recording, not two. Update the prompt:
- Replace the "Ask at MOST one short follow-up per turn" rule with: *"When anything bare-minimum is missing, ask ONE warm, plain question that bundles ALL the missing points together (e.g. 'Two quick things — which silk did you use, and roughly how many days did it take?'). Do not drip-feed one detail at a time."*
- Keep the hard cap but restate intent: **voice → aim to finish in 1 clarifying question (2 messages total)**; **text → at most 2 (3 messages total)**. Only ask a second question if a **protected-label proof** genuinely needs one (§1.3). The `maxRounds` clamp `[1,3]` stays as the safety net.
- Keep "Err on the side of stopping — this is not an interview" and the "never invent facts / null when unstated" rules.
- Keep the JSON `responseSchema` and the graceful `proceedResult()` fallback exactly as-is.

### 1.2 Make the product-aware check the REAL gate to Step 2 (unify the two questioners)
- In `CaptureModal.tsx`, Step 1's **Next** must require BOTH: (a) the base facts are present enough to price (product stated + a labour/material number to work with), AND (b) `SmartDraftAssistant` has reached `status === 'complete'` / `readyToProceed === true` (or the artisan pressed **Skip**, or Gemini is unconfigured so smart-draft auto-proceeds). Drive `isProcessed`/Next-enabled from a combined readiness flag, not from the old `missing.length===0` alone.
- **Suppress the duplicate question.** When `SmartDraftAssistant` is active (Gemini configured, `ready===true`), do **not** also render `voiceParse.followUpQuestion` as a second assistant bubble in `applyParse` — that produces two overlapping questioners. Let voice-parse still establish the base facts silently (product/time/materials, technique, description) and let SmartDraft own the visible follow-up. When Gemini is **unconfigured**, fall back to the old `followUpQuestion` path so nothing regresses.
- Feed SmartDraft's `onExtracted` (`material`, `technique`, `estimatedLaborDays`, `specialNotes`) into the modal's `craftDetails`/`technique`/`laborDays` so Step 2/pricing sees the sharpened data. It already partially wires `onExtracted` — make sure the extracted material/technique actually flow into the state used downstream (`craftDetails`, the Step-3 valuation inputs).
- **Preserve the round cap as a non-block:** if the cap is hit and the artisan still hasn't clarified, SmartDraft flips to `complete` and Step 2 unlocks (never trap the artisan). The "until the AI is satisfied" behaviour is bounded by the cap by design — keep that.

### 1.3 Ground the protected-label ("fishy") guard in a real GI list
Create `src/lib/giLabels.ts`: a curated list of India's protected/GI craft designations that imply an authorised-user/region claim — each `{ label, aliases[], region, note }`. Seed the well-known ones: **Muga silk (Assam)**, **Sambalpuri Ikat (Odisha)**, **Pochampally Ikat (Telangana)**, **Kanjivaram/Kancheepuram silk (Tamil Nadu)**, **Banarasi silk (UP)**, **Pashmina (Kashmir)**, **Channapatna toys (Karnataka)**, **Kondapalli toys (AP)**, **Bidriware (Karnataka)**, **Madhubani (Bihar)**, **Kalamkari (AP/TS)**, **Chanderi / Maheshwari (MP)**, **Bagh print (MP)**, **sandalwood carving (CITES)**, etc. Keep it a plain data module (no React/Prisma imports) so both the route and any test can use it.
- In the smart-draft route, pass the matched GI entry (label + expected region) into the prompt context so the model's "verification_needed" decision is grounded: trigger a **gentle, non-blocking** `verificationNote` only when a claimed protected label **contradicts** the artisan's `artisanLocation` (e.g. Muga claimed far from Assam) or is otherwise clearly inconsistent. **Default is NOT to ask for proof** — most listings sail through. Never block, never accuse; frame as "keep your GI authorisation handy for buyers who ask — this does not block your listing."
- **Wire `artisanLocation` through** (it's currently accepted by the route but never sent): `SmartDraftAssistant` should receive the artisan's location as a prop from `CaptureModal` (the modal already loads the profile/identity) and include it in the POST body. Without it, the GI-mismatch check can't fire.

### 1.4 Keep the whole thing cheap and non-regressive
- **No extra Gemini calls than today.** Smart-draft already runs once per turn; do not add a separate "analyze the product" call — fold product analysis into the same single request (it already extracts craftType/material/technique). The revamp reduces turns, it must not add round-trips.
- Voice quota guard: keep `inputMethod='voice'` → the stricter cap, and prefer the consolidated single question so a voice artisan records at most one clarifying answer.
- IVR untouched: `voiceParse.parseCraftSpeech` keeps its current contract; the smart-draft layer is app-only (`/api/ivr/collect-item` does not call it).

---

## §V — VERIFICATION PASS (run after; fix everything before reporting done)

1. **Build & lint:** `npm run build` (Turbopack) zero TS errors; `npm run lint` clean; no unused imports. New i18n keys present in all four locales.
2. **Single-question behaviour (typed):** open Capture → type "a silk saree" → the AI asks **one** consolidated question that bundles the gaps (e.g. which silk + rough days) rather than two separate ones. Answer it → status flips to complete → **Next enables**.
3. **Gate works:** with Gemini configured, Step 2 does **not** unlock until SmartDraft reaches complete / Skip is pressed; a bare "a silk saree" with no follow-up answer does **not** unlock Step 2 on its own.
4. **Voice cap:** with `inputMethod='voice'`, the flow finishes within **2 AI messages** (initial + one consolidated follow-up); it never asks a third unless a protected-label proof genuinely triggers it.
5. **GI guard (worst-case only):** simulate "Muga silk" with a non-Assam `artisanLocation` → a **gentle, non-blocking** `verificationNote` appears; the listing still proceeds. A normal "Tussar silk saree, 10 days" → **no** proof request, straight to complete.
6. **Graceful degrade:** with Gemini unconfigured (`GEMINI_CONFIGURED=false`), Step 1 falls back to the old voice-parse 3-fact flow and Step 2 still unlocks — no dead end, no double questioner.
7. **No regression:** the toll-free IVR path (`/api/ivr/collect-item` → `parseCraftSpeech`) is unchanged; downstream Step-3 pricing still receives craftType/material/technique/labour days (now sharper).
8. **Report:** files changed; how you verified 2–7; confirm no extra Gemini round-trips were added and the voice cap holds.

**Guard-rails for the implementer:** do not remove the Skip button or the round cap (they are the "never trap the artisan" safety net); do not make the GI proof mandatory or blocking; do not add a second Gemini call for "product analysis" — reuse the one smart-draft request; keep `originalTranscript` verbatim (it goes on the public product passport).
