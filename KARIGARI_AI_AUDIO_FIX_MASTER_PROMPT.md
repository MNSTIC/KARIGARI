# MASTER PROMPT — Fix Raw-Materials/News glitch, move 3 AIs to Groq, fix voice capture

> Paste into **Claude Code** (it has the repo). Small, surgical fixes — do not rewrite features. Keep the build green and the green heritage theme. App root: **`KARIGARI-main/KARIGARI/`** — `cd` there first.

**Stack reminder:** Next.js **16.3.1** App Router (Turbopack), React 19, TS, Prisma 7, Tailwind v4. Groq helper already exists at `src/lib/groq.ts` (`groqChatJSON`, `groqKey`, `GROQ_CHAT_MODELS`, `GROQ_WHISPER_MODEL`, `languageInstruction`, `languageName`). Gemini helper at `src/lib/gemini.ts` (`generateContentWithFallback`). Groq key is in `.env` as `GROQ_API_KEY` (valid `gsk_…`; the helper also accepts the legacy `GROK_KEY`). After any change run `npm run build` — zero TS errors.

Provider policy for this task:
- **Raw Materials, Live News, Karigari Assistant (Learn & Grow chat) → Groq** (via `groqChatJSON`).
- **Draft / Capture parsing → Gemini** (keep `generateContentWithFallback`). Audio transcription stays on **Groq Whisper** (that is a transcription engine, not the "AI" being switched).

---

## ⭐ FIX 1 — Raw Materials & Live News "just loading and glitching" (INFINITE RENDER LOOP)

**Root cause (verified):** `useLanguage()` in `src/lib/translations.ts` returns a **new `t` function on every render** (it is a plain arrow, not memoized). The Materials and News pages do:
```ts
const fetchData = useCallback(async () => { … }, [language, t]);   // t changes every render
useEffect(() => { const k = setTimeout(fetchData, 0); return () => clearTimeout(k); }, [fetchData]);
```
Because `t`'s identity changes each render, `fetchData` changes each render, the effect re-fires, `setLoading(true)` re-renders, and it loops forever — perpetual spinner + flicker, and it hammers `/api/artisan/generate-*` on repeat. The Groq routes themselves are fine; the key reaches `openai/gpt-oss-120b` / `qwen/qwen3.8-27b` / `whisper-large-v3`.

**Fix A (root, do this) — memoize the hook** in `src/lib/translations.ts`:
- Import `useCallback` (and `useMemo` if useful) alongside `useState`/`useEffect`.
- Wrap `t` in `useCallback((key: string) => dictionary[language]?.[key] || dictionary.en[key] || key, [language])` so its identity is stable per language.
- Wrap `changeLanguage` in `useCallback(…, [])`.
- Return the memoized versions. This alone breaks the loop for **all 18** components that use the hook, and is the correct fix.

**Fix B (belt-and-suspenders) — page deps:** in `src/app/artisan/materials/page.tsx` and `src/app/artisan/news/page.tsx`, change the `useCallback` dependency array from `[language, t]` to `[language]` (read `t` inside without depending on it). Keep the `setTimeout(fetchData, 0)` kickoff.

**Fix C — never hang:** in `src/lib/groq.ts` `groqChatJSON`, add an `AbortController` timeout (~30s) around each `fetch` so a stalled model rejects with a `GroqError` instead of leaving the page spinning. The pages already render a proper error + retry state on `success:false`, so this makes failures visible rather than infinite.

**Verify:** open Raw Materials and Live News → content loads once (no flicker, no repeated network calls in the Network tab); on a forced error you get the retry card, not a spinner.

---

## FIX 2 — Move Karigari Assistant (Learn & Grow chat) from Gemini to Groq

**File:** `src/app/api/artisan/chat/route.ts` (currently uses `generateContentWithFallback` from `@/lib/gemini`).
- Replace the Gemini call with `groqChatJSON` from `@/lib/groq`. Keep the same JSON contract (`{ reply, youtubeQuery? }`) and keep the existing YouTube lookup logic that runs after the model returns `youtubeQuery`.
- Accept a `language` field in the request body and append `languageInstruction(language)` to the prompt so the reply comes back in the artisan's chosen language (the modal should send `language` from `useLanguage()` — wire it in `src/components/LearningAssistantModal.tsx`).
- Keep the response shape identical so `LearningAssistantModal` needs no other change. On `GroqError`, return a graceful `{ reply: "<localized 'AI unavailable, try again'>" }` (HTTP 200 or 503) so the chat shows a message, never a blank bubble.
- Materials (`generate-materials`) and News (`generate-news`) are **already on Groq** via `groqChatJSON` — leave their provider as-is (only Fix 1 applies to them).

---

## FIX 3 — Voice capture/draft: show live text + stop mis-detecting language/words

Two problems: (a) the modal shows a static "🎙️ Voice recording sent" bubble instead of the words being spoken; (b) Whisper is called **without a language hint**, so it auto-detects and returns the wrong language/words for short Odia/Telugu/Hindi clips.

### 3.1 Pass the chosen language to Whisper (accuracy)
**File:** `src/lib/voiceParse.ts` → `transcribeAudio`.
- Change the signature to `transcribeAudio(audio: Blob, language?: string | null)`.
- Map the UI code to an ISO-639-1 hint and pass it to Groq Whisper: `en→en, hi→hi, te→te, or→or`. Add to the form: `form.append('language', iso)` (only when known), `form.append('temperature', '0')`, and a short `form.append('prompt', 'Indian handmade craft description')` for domain biasing. This stops the auto-detect drift.
- **File:** `src/app/api/items/voice-parse/route.ts` — pass `targetLanguage` into `transcribeAudio(audio, targetLanguage)` (the route already parses `targetLanguage` from the form/body; just forward it).

### 3.2 Keep draft/capture PARSING on Gemini
**File:** `src/lib/voiceParse.ts` → `parseCraftSpeech`. Per policy, capture/draft understanding uses **Gemini**. If the current implementation tries Groq before Gemini for the *text structuring* step, reorder so **Gemini (`generateContentWithFallback`) is the primary** parser for this path, with Groq only as a last-resort fallback. (Transcription still uses Groq Whisper — that is separate.) Do not change the IVR contract that shares this function; just the provider order.

### 3.3 Live speech-to-text in the capture modal (UX the user asked for)
**File:** `src/components/CaptureModal.tsx` (the mic flow: `toggleListening`, `processAudioWithGroq`, message push at ~line 250 that currently renders `🎙️ ${t('audio_recorded')}`).
- Add browser **`SpeechRecognition`** live transcription **in parallel** with the existing `MediaRecorder` capture, mirroring the working pattern in `src/components/LearningAssistantModal.tsx` (`window.SpeechRecognition || window.webkitSpeechRecognition`, `continuous=false`, `interimResults=true`).
- Set `recognition.lang` from the chosen UI language: `en→en-IN, hi→hi-IN, te→te-IN, or→or-IN` (fall back to `en-IN` if unsupported).
- While the artisan speaks, stream the interim transcript into the input/composer so they **see their words live** instead of a placeholder. Replace the static "🎙️ Voice recording sent" user bubble with the **actual spoken text** (use the live transcript; if empty because the browser lacks that language, fall back to the label).
- On stop: keep sending the recorded audio to `/api/items/voice-parse` **with `language`** for the authoritative transcription+parse (Whisper handles Odia/Telugu better than the browser). When the response returns, show the real `data.originalTranscript` in the conversation (not the placeholder), then the parsed summary bubble as today.
- Guard gracefully: if `SpeechRecognition` is unavailable, keep the current record→Whisper flow but still surface `data.originalTranscript` as the user-visible text once it returns, so the artisan always sees what was understood.
- Keep everything in-app (no browser `alert`); preserve the existing "too short / offline / mic denied" banners.

### 3.4 Make sure `language` is actually sent
Confirm `CaptureModal` and `CompleteDraftModal` include `language` (from `useLanguage()`) in every `/api/items/voice-parse` call (form field or JSON). The route and `parseCraftSpeech` already accept it; the client must supply it so both Whisper and the Gemini parse use the right language.

---

## VERIFICATION CHECKLIST
1. `npm run build` — zero TS errors; `useCallback` imported in `translations.ts`.
2. Raw Materials & Live News load **once**, no flicker, no repeated `/api/artisan/generate-*` calls (check Network tab). Force-fail (e.g. bad key) → retry card, not an endless spinner.
3. Learn & Grow AI replies come from Groq, in the selected language, with a matching video (unrelated-video handling unchanged); no blank bubbles on error.
4. In Capture/Draft: speaking shows **live text** of the words; the user bubble is the real transcript, not "Voice recording sent".
5. Speak in Hindi/Odia/Telugu with that language selected → Whisper returns the right language/words (language hint sent); the parsed craft/labour/cost reflect what was said.
6. Draft/capture parsing uses Gemini; Materials/News/Assistant use Groq. Theme + responsiveness intact.
7. End with a summary: files edited, what changed per file, and the commands run.

### FILE MAP
**Edit:** `src/lib/translations.ts` (memoize `t`/`changeLanguage`), `src/app/artisan/materials/page.tsx`, `src/app/artisan/news/page.tsx` (deps `[language]`), `src/lib/groq.ts` (fetch timeout), `src/app/api/artisan/chat/route.ts` (Gemini→Groq + language), `src/components/LearningAssistantModal.tsx` (send `language`), `src/lib/voiceParse.ts` (`transcribeAudio` language hint; Gemini-primary parse), `src/app/api/items/voice-parse/route.ts` (forward language to Whisper), `src/components/CaptureModal.tsx` (live SpeechRecognition + show real transcript + send `language`), `src/components/CompleteDraftModal.tsx` (send `language`).
**Do not touch:** the Groq model chain in `groq.ts` (verified reachable), the marketplace/escrow/syndication features.
