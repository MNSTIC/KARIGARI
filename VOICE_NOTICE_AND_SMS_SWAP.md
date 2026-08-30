# MASTER PROMPT — Fix spurious "AI is busy" notice + move the SMS/WhatsApp demo into Insights

> Paste into Claude Code. App root: **`KARIGARI-main/KARIGARI/`** (`cd` there). Theme tokens in `src/app/globals.css` (primary `#24332C`, primary-light `#3D5145`, mint `#DCEBE0`, sage `#A9BFB0`). Keep `useLanguage` i18n. Verify in the running app.

Three changes.

---

## FIX 1 — The "AI is busy right now… try again in a minute" message shows on every voice answer

### Root cause (confirmed)
The voice assistant is running in **rules mode on every call** because the Gemini key is invalid, so it always takes the degraded path — and that path returns BOTH a real answer and a "busy" notice, so the UI shows both.
- `src/app/api/voice-assistant/route.ts`, the `degrade()` builder (lines ~209–223): it always sets `notice = replyFor(noticeKind, …)` ("The AI is busy right now…") and returns it alongside `reply: rules ? buildRulesReply(rules) : notice` with `engine: rules ? 'rules' : 'fallback'`. So when the rules engine produced a real reply, `notice` is still populated.
- `src/components/VoiceOnboarding.tsx`, `applyResponse` (line ~168): `setNotice(data.notice ?? null)` renders that notice as a warning strip even though `data.reply` is a complete, correct answer.

The rules answer ("bbsr, you qualify for AHVY…") IS the intended answer — telling the user to "try again in a minute" is misleading, because retrying will keep hitting rules mode until a valid key is added.

### Fix
1. **Route (`voice-assistant/route.ts`, `degrade()`):** only surface a `notice` when there is **no real answer** — i.e. when we fell back to the generic text because we never got a transcript. When the rules engine answered (`rules` is set / `engine === 'rules'`), **omit `notice`** (return `notice: undefined`). Concretely: `notice: rules ? undefined : notice`. Keep `reply` as-is.
2. **Client (`VoiceOnboarding.tsx`, `applyResponse`):** as a safeguard, only show the strip when there's genuinely no usable reply — e.g. render `notice` only if it exists AND (`!data.reply` || `data.engine === 'fallback'`). With the route fix this becomes belt-and-suspenders, but it guarantees a valid answer never appears next to a "busy" warning.
3. Do **not** remove the rules-mode behaviour or the notice entirely — a true "no transcript / couldn't hear" case should still show a helpful message. Only the case "rules answered successfully" must be silent.

> Note for the user (not a code change): the assistant stays in rules mode until `GEMINI_API_KEY` in `.env` is a valid `AIza…` key. The rules answers are correct; this fix just stops the misleading warning.

### Fix 1 acceptance
Ask the assistant a scheme question: you get the spoken/'typed' rules answer with **no "AI is busy" strip**. (A genuine no-speech/empty case still shows its own message.)

---

## FIX 2 — Move the "Demo: Offline SMS / WhatsApp Fallback" demo from the Dashboard into Insights (replace the KARIGARI Alerts card)

Today:
- **Insights** (`src/app/artisan/insights/page.tsx`) renders the "KARIGARI Alerts" card via `<WhatsAppSimulation …/>` inside the SMS auto-pilot `<section>` (component used at lines ~391–397; imported at line 9).
- **Dashboard** (`src/app/artisan/dashboard/page.tsx`) has the green **"Demo: Offline SMS / WhatsApp Fallback"** banner (lines ~187–196) whose "Run Simulation" button opens a self-contained WhatsApp-chat modal gated by `isWhatsappSimOpen` (state at line 30; modal JSX at ~lines 388–440).

Do a clean cut-and-paste:
1. **In Insights:** remove the `<WhatsAppSimulation …/>` usage (~391–397) from the SMS auto-pilot section. **Keep** that section's header ("SMS AUTO-PILOT", ~373–380) and the "No internet? No problem" info box (~382–389). In place of the removed card, render the **"Demo: Offline SMS / WhatsApp Fallback" banner** + its "Run Simulation" button, and bring over the modal: add the `isWhatsappSimOpen` state and the modal JSX (the block gated by `isWhatsappSimOpen`) so the button opens the same WhatsApp-chat simulation. Pass it the data insights already has (`insights?.craftType`, the latest alert / `simulationDemand`) so the simulated alert reflects a real demand where available.
2. **In Dashboard:** delete the banner (~187–196), the `isWhatsappSimOpen` state (line 30), and the modal JSX (~388–440). Remove any now-unused imports (e.g. `X` if only the modal used it — check first).
3. If `src/components/WhatsAppSimulation.tsx` is no longer imported anywhere after step 1, delete it (grep to confirm it's unused). If the modal you moved actually reused `WhatsAppSimulation`, keep the component and just relocate the banner/trigger instead — inspect before deleting.
4. Ensure no dead references remain (grep the repo for `WhatsAppSimulation`, `isWhatsappSimOpen`, `simulationDemand`) and that both pages still compile.

### Fix 2 acceptance
Insights → SMS auto-pilot shows the "Demo: Offline SMS / WhatsApp Fallback" banner; "Run Simulation" opens the WhatsApp-chat modal and plays the alert. The Dashboard no longer shows that banner. No console errors, no leftover imports.

---

## FIX 3 — Recolor the moved banner slab to the app theme (blend, don't clash)

The banner is currently a bright emerald/teal gradient that doesn't match the UI:
`class="… bg-gradient-to-r from-green-500 to-teal-600 …"` (dashboard line ~188), with a `text-green-700 … hover:bg-green-50` button (line ~193).
Recolor **only the slab and its button** to the theme:
- Slab background → the brand green, e.g. `bg-primary` or `bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-light)]`. Keep the text white (`text-white`, `text-white/80` for the subtitle).
- Button → `bg-white text-primary hover:bg-[var(--color-mint)]` (white button, primary-green label) so it reads as the same design system.
Do not change the banner's copy, layout, or the modal — only its colors.

### Fix 3 acceptance
The banner uses the KARIGARI green/mint palette and visually blends with the rest of Insights (no bright emerald/teal).

---

## GLOBAL
- Keep i18n (`useLanguage`) and theme tokens; no hardcoded off-theme colors.
- `npx tsc --noEmit && npm run build` must pass.
- Report: files changed, confirmation the banner+modal now live in Insights (not Dashboard), the WhatsAppSimulation card is gone, the banner is themed, and the "AI is busy" strip no longer appears alongside a real answer.
