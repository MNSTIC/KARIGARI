# MASTER PROMPT — Fix KARIGARI Voice Assistant & Demand Map (properly, root-cause)

> Paste this whole file into Claude Code. These two bugs have survived two prior attempts because the previous fixes treated symptoms. This time, fix the **root cause** of each, then **actually test in the running app** before declaring done. App root: **`KARIGARI-main/KARIGARI/`** (`cd` there). Theme tokens in `src/app/globals.css` (primary `#24332C`, bg `#FCF8F7`, mint `#DCEBE0`); keep `useLanguage` i18n; Next 16 (`await cookies()`), React 19.

You MUST reproduce and verify both fixes with `npm run dev` and by reading the dev-server terminal + browser console. Do not report "fixed" from code inspection alone.

---

## BUG 1 — Voice assistant always says "Sorry, I could not hear that clearly"

### Why it happens (confirmed)
- `src/components/VoiceOnboarding.tsx` records mic audio with `MediaRecorder`, base64-encodes it, and POSTs the **audio** to `/api/voice-assistant`, which asks **Gemini to transcribe the audio**. When that Gemini call throws, the route (`src/app/api/voice-assistant/route.ts`, `catch` at lines 239–252) returns `FALLBACK_REPLY` = exactly that sentence. So the message is a **server-side AI failure**, not a microphone failure.
- The Gemini call is failing. `.env` `GEMINI_API_KEY` starts with `AQ.` — that is NOT a valid Google AI Studio key (those start with `AIza…`), so every Gemini request 401s. (Model names `gemini-3.7-flash`/`gemini-3.5-flash` may also 404 on the account.)
- Meanwhile, **the Capture flow already does browser speech-to-text correctly** in `src/components/CaptureModal.tsx` (lines ~182–230): it uses `window.SpeechRecognition || window.webkitSpeechRecognition`, sets `recognition.lang` from a language map, `interimResults`, `continuous`, and reads `onresult`. This works in the user's browser today.

### The proper fix: make the assistant HEAR via the browser, not via Gemini audio upload

**Rewrite `src/components/VoiceOnboarding.tsx` to use the Web Speech API for speech-to-text**, mirroring the working code in `CaptureModal.tsx`:
1. Replace the `MediaRecorder` + base64 pipeline with `webkitSpeechRecognition`:
   - `const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;` — if absent, show a clear message ("Voice input isn't supported in this browser — try Chrome") instead of failing silently.
   - Map the app language to a recognizer locale: `en→en-IN`, `hi→hi-IN`, `or→or-IN` (fallback `hi-IN` if unsupported), `te→te-IN`. Use the same `langMap` shape as CaptureModal.
   - `recognition.interimResults = true; recognition.continuous = false;` show the interim transcript live in the panel; on final result, set the transcript.
2. When recognition returns the final transcript, **display it** ("You said: …") and POST **`{ transcript, language, currentRoute }`** (NOT audio) to `/api/voice-assistant`. The route already accepts a `transcript` input (see lines 167–169) and builds the reply from it — the audio path is no longer needed for hearing.
3. Keep the reply text-to-speech via `window.speechSynthesis` (already implemented) so the answer is spoken back.
4. Handle `recognition.onerror` (e.g. `no-speech`, `not-allowed`) with distinct, honest UI messages: mic-permission-denied vs no-speech-detected vs unsupported — never the generic "could not hear" for a permission problem.

**Also make the REPLY robust (so voice is useful even before the key is fixed).** In `src/app/api/voice-assistant/route.ts`:
5. Detect an unusable key early: if `GEMINI_API_KEY` is missing or doesn't start with `AIza`, or the Gemini call throws an auth error (400/401/403 / `API_KEY_INVALID`), do NOT return the "could not hear" line. Instead return a **rules-based reply built from the real data** so the assistant still answers common questions offline:
   - It already loads the artisan's scheme eligibility (`loadEligibilitySnapshot` + `SCHEMES`). Use that: if the transcript mentions a scheme/benefit/eligibility, answer from the `SCHEMES` catalog (name + benefit + their verdict). If it mentions capture/list/sell/insights, point them to the right screen. Otherwise a short helpful default. Keep replies 1–2 sentences, romanized in the chosen language, and speak them.
   - Mark `engine: 'rules'` so it's clear the model wasn't used.
6. Keep the true Gemini path for when the key is valid, and add a guaranteed-available model to the fallback list (append `gemini-flash-latest` or `gemini-2.5-flash` to `VOICE_MODELS` and `FALLBACK_MODELS`), and log `error.status`+`error.message` on failure so the real cause is visible in the terminal.

### Human action (Claude Code cannot do this)
Replace `GEMINI_API_KEY` in `.env` with a real key from https://aistudio.google.com/apikey (starts with `AIza…`), then restart `npm run dev`. The rules-based reply (step 5) makes voice usable meanwhile, but the smart AI reply needs a valid key.

### Bug 1 — how to verify (do this, report results)
- Open the assistant, tap mic, say "Tell me about PM Vishwakarma." Confirm: (a) your words appear as a transcript ("You said: …") — proving it now hears you via the browser; (b) a spoken reply comes back (rules-based if the key is still invalid, AI-based once fixed). 
- Read the dev-server terminal and report the exact Gemini error line (e.g. `API_KEY_INVALID`) so the key issue is confirmed.
- Deny mic permission once and confirm the message says permission-denied, not "could not hear."

---

## BUG 2 — Demand map pins are in the wrong places (Kolkata near Vietnam, "you" in the sea)

### Why it happens (confirmed)
`src/app/artisan/insights/page.tsx` renders an **OpenStreetMap `export/embed.html?bbox=…` iframe** (line 277) and overlays absolutely-positioned pins whose left/top come from `toMapPercent(point, mapBbox)` (lines 194, 288–289, 322). The OSM embed **refits the requested `bbox` to the iframe's 16:9 aspect ratio**, so it displays a far wider area (Middle East → China) than `mapBbox` describes. The pin math uses the un-refitted `mapBbox`, so every pin is projected onto the wrong screen position. This overlay-on-iframe approach cannot be made reliable.

### The proper fix: use a real map (react-leaflet) with true lat/lng markers
Real markers are placed by coordinates by the map engine — no manual projection, no aspect-ratio drift.

1. Install: `npm i leaflet react-leaflet && npm i -D @types/leaflet` (react-leaflet v5 supports React 19).
2. Create a client component **`src/components/DemandMap.tsx`** (`"use client"`):
   - `import "leaflet/dist/leaflet.css";` and import `MapContainer, TileLayer, Marker, Popup, useMap` from `react-leaflet`, `L` from `leaflet`.
   - Props: `home: { lat: number; lon: number; label: string; supply?: number } | null` and `demands: Array<{ id; lat; lon; craftType; quantity; targetPriceMin?; targetPriceMax?; festival?; location; distanceKm?; mine: boolean; fresh: boolean }>`.
   - Use `<TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />`.
   - **Avoid the well-known broken default-marker-icon issue** by building markers with `L.divIcon({ html: '<div class="...">…</div>', className: '' })` — style them with the theme: home marker = primary green with a ring; "your craft" demand = green; "other crafts" = dark slate; "just posted" (fresh) = red. (This matches the existing legend.)
   - Home marker at `home` with a popup showing the location name + `supply` listed items. Demand markers at each `demand` with a `<Popup>` showing craftType, quantity, price band, festival, and `distanceKm` from home.
   - A `<FitBounds>` child using `useMap()` to `map.fitBounds(L.latLngBounds([...homeIfAny, ...demandLatLngs]).pad(0.2))` on mount/prop-change, so the view frames India/the artisan — never the whole of Asia. If only `home` exists, `map.setView([home.lat, home.lon], 6)`.
3. In `src/app/artisan/insights/page.tsx`:
   - Import it dynamically (leaflet needs `window`): `const DemandMap = dynamic(() => import("@/components/DemandMap"), { ssr: false });` (the page is already `"use client"`, so `ssr:false` is allowed).
   - Build the `home` prop from `locateCity(insights?.profileLocation)` and the `demands` prop by resolving each demand's `location` via `locateCity` (keep unresolved ones in the existing side list). Reuse `distanceKm` from `src/lib/indiaGeo.ts`.
   - **Delete** the OSM `<iframe>` (line ~269–280), the absolute-overlay pins (the `pins` block, home-pin block, lines ~284–340), `mapBbox` (lines 166–177), and the `toMapPercent` usage. Keep `locateCity` and `distanceKm`. `toMapPercent`/`MAP_BBOX` can be removed from `indiaGeo.ts` if nothing else uses them (grep first).
   - Keep the legend, "N open demands" count, the hover/active-pin detail (move it into the leaflet `<Popup>`), and the unmapped-demands side list.
4. **Make the artisan's home location resolvable** (root of "you're in the sea"): the test artisan's profile `location` is a placeholder ("Local Cluster"), which `locateCity` can't resolve. Make `location` a **required select of known cities** (keys of `CITY_COORDS` in `indiaGeo.ts`) in `src/app/register/page.tsx` and `src/components/ProfileEditorModal.tsx`, and set the seeded demo artisan's `location` to a real city (e.g. `"Pochampally"`) in `prisma/seed.ts`. If home still can't resolve, render the map framed on the demands with a "Set your town in your profile to see your position" prompt — never a guessed pin.

### Bug 2 — how to verify (do this, report results)
- Load `/artisan/insights` as the seeded artisan. Confirm: the map is framed on India (not Asia); the **home marker sits on the artisan's real city**; a demand labelled "Kolkata" sits **on Kolkata**, "Delhi" on Delhi, etc. (open a couple of popups and check the city matches the dot).
- Change the artisan's profile city and confirm the home marker moves to the new city and demand distances re-sort.

---

## GLOBAL
- Keep the green/cream theme and `useLanguage` (every new string translatable).
- Run `npx tsc --noEmit && npm run build` — must be clean; fix any error you introduce.
- Report: the exact Gemini error from the terminal, the list of files changed, the new deps added, and confirmation that you visually verified (a) the transcript appears when speaking and (b) the Kolkata/home markers land on the correct cities.

## SECURITY (tell the user)
`.env` has a live DB password + JWT secret in plaintext and an invalid Gemini key. Since the folder is shared, rotate the Supabase password and `JWT_SECRET`, use a fresh `AIza…` Gemini key, and confirm `.env` is in `.gitignore`.
