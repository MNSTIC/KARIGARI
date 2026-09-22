# KARIGARI — ANTIGRAVITY MASTER PROMPT
## Artisan Onboarding & Activation System (v1)

> **For: Antigravity / Gemini 3.1, agentic mode, on the KARIGARI repository.**
> **Read Sections 0 → 7 completely before writing any code.** Sections 8 → 15 are the build,
> executed in order as seven phases with a checkpoint after each. Section 16 onward is the copy
> deck, the key registry and the verification contract.
>
> This document is self-contained. Every file path, token, component name, model name and
> convention in it was verified against the repository. **Where this document states a fact about
> the codebase, trust it over your own assumption — but always open the named file before editing
> it.**

---

# 0. HOW TO EXECUTE THIS

## 0.1 Operating rules for the agent

1. **Plan first.** Produce your implementation plan from Section 5 (architecture) and Sections
   8–14 (phases) *before* touching code. Do not begin Phase 1 until the plan exists.
2. **One phase at a time.** Each phase ends with: its verification checklist passing, the quality
   gates green, and a one-paragraph summary of what changed. Then continue to the next phase.
3. **Read before you write.** Every phase lists the files you must open first. Open all of them.
   Never edit a file you have not read in this session.
4. **Never invent.** If this document does not specify a value — a colour, a copy string, a
   threshold, an API shape — it is specified somewhere in the repo, and you must go find it. Do
   not guess, do not improvise a "sensible default", and do not leave a `TODO`.
5. **Additive only.** This feature must not change any existing behaviour. Every new column is
   nullable or defaulted; every new prop is optional with a safe default; no existing component's
   signature changes except where a phase explicitly says so.
6. **No new npm dependencies.** Everything needed is installed. No tour library (no Shepherd,
   Intro.js, Driver.js, react-joyride), no animation library, no state library, no i18n library.
   If you believe you need one, you have misread the brief.
7. **Stop and ask** if a phase's instruction genuinely contradicts the code you find. Do not
   silently "fix" the contradiction.

## 0.2 Quality gates — run after EVERY phase

```bash
cd KARIGARI-main/KARIGARI
npx tsc --noEmit        # 0 errors
npm run lint            # 0 errors, 0 new warnings
npm run build           # succeeds, no new warnings
```

Then, with `npm run dev`, in the browser: load every page the phase touched, in **all four
languages**, at **360 px and 1440 px**, with the console open. Zero React warnings. Zero uncaught
errors. Zero hydration mismatches.

## 0.3 The one-sentence brief

> Build an onboarding system that takes a rural artisan from "I just signed up" to "the app told me
> my work is worth ₹4,200 and 89.36% of that comes to me" **in under three minutes, without typing
> a word**, and then keeps them coming back — without ever being in the way.

---

# 1. MISSION & SUCCESS CRITERIA

## 1.1 What this is

A **post-signup onboarding and activation system for artisans only**, plus one minimal,
non-intrusive artisan cue on the public landing page.

## 1.2 What "success" means, concretely

| # | Criterion | How it is judged |
|:--|:--|:--|
| S1 | A first-time artisan reaches the **fair-wage price reveal** (CaptureModal Step 3) within 3 minutes of first landing on the dashboard | walk it yourself with a stopwatch |
| S2 | The artisan can complete the entire First Moment **without typing a single character** | try it with the keyboard physically unavailable |
| S3 | A returning artisan on day 2 sees a **clear, honest next step** — never a blank dashboard, never a repeat of yesterday's tour | log in twice |
| S4 | A **buyer** visiting the landing page is never blocked, interrupted, or asked to choose a role | load `/` in a clean profile and try to reach `/marketplace` |
| S5 | Nothing in the system fires **twice** for the same artisan, on any device | complete onboarding, then open the app on a second browser profile with the same account |
| S6 | Every onboarding surface works in **Hindi, Odia and Telugu**, and can be **listened to** rather than read | switch language, press every listen button |
| S7 | The system **graduates**: once activated, the onboarding UI disappears entirely and hands off to the existing badge / skill-stage progression | complete all activation steps |
| S8 | An artisan can find out **everything the platform offers** on demand, without ever being force-fed it | open the Guide from any page |

## 1.3 Non-goals — do not build these

- ❌ Buyer onboarding. Buyers have no accounts in this app (see §6.5). Out of scope entirely.
- ❌ Admin / facilitator onboarding.
- ❌ A modal, interstitial, or role-chooser on the landing page.
- ❌ A multi-step "product tour" that walks the artisan around the app on first load.
- ❌ Gamification with points, streaks, coins, confetti storms, or mascots.
- ❌ Any change to the CaptureModal's capture logic, the pricing engine, or the escrow maths.

---

# 2. WHO THE USER IS — AND THE RESEARCH THIS IS BUILT ON

## 2.1 The artisan

A weaver, potter, or metalworker in a rural cluster in Odisha, Telangana, Rajasthan or West Bengal.
Assume, as the design baseline:

- **Low text literacy in English; often low text literacy in their own script too.** They speak
  Odia, Hindi or Telugu fluently. They do not read long paragraphs.
- **Strong numerical literacy.** They have negotiated prices their whole working life. They read
  ₹ figures instantly and accurately — often better than they read words.
- **An entry-level Android phone**, shared, low storage, screen around 360 px wide.
- **Intermittent connectivity.** The app is already offline-first; onboarding must be too.
- **They may not be holding the phone.** Registration is frequently done *for* them by a Sahayak
  (SHG field volunteer) or a literate relative. The person tapping at 10:00 may not be the person
  using the app at 18:00.
- **Deep, justified suspicion of anyone promising them money.** Middlemen have underpaid them for
  generations. An overclaiming onboarding screen destroys trust permanently.

## 2.2 The research base — the SARAL guidelines

This design is built on *Actionable UI Design Guidelines for Smartphone Applications Inclusive of
Low-Literate Users* (Tuli et al., **Proceedings of the ACM on Human-Computer Interaction / CSCW
2021**). Its thirteen guidelines are the design contract for every screen you build. **Each one maps
to a concrete requirement in this document:**

| Guideline | What it says | Where it lands in this build |
|:--|:--|:--|
| **G1** Multiple modes of interaction | text + audio + graphics together, never one alone | every onboarding screen has an icon, ≤2 lines of text, **and** a Listen button (§10.4) |
| **G2** Leverage numerical literacy | use numbers; they read those even when text is hard | the headline of the promise screen is a **number** (89.36%, ₹, "1 of 3") (§15) |
| **G3** Minimalist, clean interface | minimise text and components per screen; maximise whitespace | **one idea per screen**, hard cap of 2 lines of body copy (§17.2) |
| **G4** Incorporate visual cues | bold, colour-coding, highlighting — not text alone | state carried by icon + theme colour, never by wording alone (§11.3) |
| **G5** Avoid jargon | everyday words, no domain or technical terms | the **banned-words list** in §15.2 is non-negotiable |
| **G6** Break down information | small chunks across screens, not dense pages | First Moment is **3 screens**; features are revealed over days, not at once (§12) |
| **G7** Simplify navigation | flatten hierarchies; prefer linear | onboarding is strictly **linear**, no nested menus, no branching (§10.2) |
| **G8** Accessible assistance | help reachable from **every** screen | the Guide hub is in the rail and reachable everywhere (§13) |
| **G9** Short, simple instructions | brief, gradual, step-by-step; never multi-step recall | **one instruction per screen**, never "first do X then Y" (§17.2) |
| **G10** Audio/video help | voice over text-only documentation | Listen buttons everywhere; spoken copy is written to be *heard*, not read (§15.3) |
| **G11** Culturally responsive design | local language, culturally appropriate icons and colour | four languages from screen one; the existing heritage palette; no Western office metaphors (§17.3) |
| **G12** Leverage human facilitators | bring family, peers, trained helpers into the system | **"Ask a person" is a first-class option**, wired to the real cluster and facilitator network (§13.3) |
| **G13** Enable customisation | let users save preferences | language choice is persisted **server-side**, so it survives the device change in §2.1 (§9) |

**G12 is the one most products cannot do and Karigari can.** The platform already has SHG
facilitators, a cluster page, and a `ResourceRequest` model. An onboarding that can say *"ask
someone in your cluster"* and actually route the request is a genuine differentiator — build it.

## 2.3 The activation principles this follows

Standard product-onboarding practice, adapted to the above:

- **Time-to-value beats completeness.** The first session has exactly one job: reach the aha. Every
  other feature can wait days.
- **Endowed progress.** The activation path starts with one step already complete ("Account
  created ✓"), because a checklist that starts at 0 % is abandoned more often than one that starts
  at 20 %.
- **Real state, not clicks.** Every checkbox reflects a **database row**, not "the user saw a
  screen". A checklist that can be satisfied by dismissing things teaches nothing.
- **Progressive disclosure over tours.** Feature discovery is spread across first-visits to each
  page, budgeted so it can never pile up.
- **Graduation.** Onboarding that never ends becomes furniture. This one removes itself and hands
  off to the permanent progression layer.

**Sources:** [Tuli et al., CSCW 2021 — Actionable UI Design Guidelines for Low-Literate
Users](https://anupriyatuli.github.io/publications/2021_CSCW.pdf) · [Medhi et al., ACM TOCHI —
Designing Mobile Interfaces for Novice and Low-Literacy
Users](https://dl.acm.org/doi/10.1145/1959022.1959024) · [Microsoft Research — Sophistication with
Limitation: Smartphone Usage by Emergent Users in
India](https://www.microsoft.com/en-us/research/uploads/prod/2022/05/compass22-34-taps.pdf)

---

# 3. THE PRODUCT — WHAT KARIGARI ACTUALLY OFFERS

**You must understand this before you can write onboarding copy.** This inventory was read from the
repository, not imagined. Every item exists and works.

## 3.1 The core promise

Karigari is an **AI-driven market-linkage, provenance and fair-wage platform for marginalised
artisans**, built for Smart India Hackathon 2026 under the Ministry of Social Justice &
Empowerment (PS 26090). It replaces the middleman with a verifiable digital chain: the artisan
speaks, the AI catalogues, a physical QR patch proves the object, and the money settles straight to
the artisan's own UPI.

## 3.2 The five things that make it different — these ARE the onboarding content

| # | The differentiator | Where it lives in the code | How to say it to an artisan |
|:--|:--|:--|:--|
| **D1** | **You speak. The app writes the listing.** Voice capture in Odia / Hindi / Telugu / English → Gemini + Groq produce title, description, tags, category and a price band. No typing, no forms. | `CaptureModal.tsx` Step 1, `voiceParse.ts`, `speechCapture.ts`, `/api/items/voice-parse`, `/api/items/smart-draft` | *"Speak in your language. We write it for you."* |
| **D2** | **89.36% of every sale reaches you, direct to your UPI.** Non-custodial escrow: 40% released on dispatch, 49.36% on delivery. No admin touches the money. | `escrow.ts` (`ADVANCE_RATE`, `FINAL_SETTLEMENT_RATE`, `ARTISAN_TOTAL_RATE`), `/api/payments/settle-escrow` | *"Out of every ₹100, ₹89 comes to you."* |
| **D3** | **Money before the buyer pays in full.** 40% advance the moment the piece is dispatched. | `advanceFor()`, `STAGE1_ADVANCE_PAID_40` | *"You get 40% as soon as you send it."* |
| **D4** | **A QR passport on every piece.** The artisan attaches a printed patch, re-photographs the finished work wearing it, and AI matches it to the original capture. A buyer scans it and sees the maker, the village, the labour days and the real fair-pay split. | `qrPatch.ts`, `QrAttachModal.tsx`, `/verify/[patchId]`, `buyerVerify.ts` | *"Your name travels with your work."* |
| **D5** | **It works without internet.** Captures, photos and voice notes are saved on the phone and upload themselves when signal returns. | `offlineQueue.ts`, `offlineSync.ts`, `OfflineSyncProvider.tsx`, `SyncStatusChip.tsx` | *"No network? Keep working. It saves on your phone."* |

## 3.3 The full surface inventory — for the Guide hub (§13), NOT for the first session

Verified from `src/app/artisan/` and `src/components/`:

| Route | Plain-language purpose |
|:--|:--|
| `/artisan/dashboard` | Home — money this month, your pieces, what to do next |
| `/artisan/market` | Your own pieces: drafts, patches to attach, what is listed |
| `/artisan/workshop` | Raw material suppliers, tool & repair help, equipment schemes, scrap pooling |
| `/artisan/insights` | What buyers are asking for near you; festival demand |
| `/artisan/schemes` | Government schemes you qualify for, with the form assistant |
| `/artisan/learn` | Short lessons for your craft; your skill level |
| `/artisan/news` | Craft-sector news that affects your trade |
| `/artisan/orders` | Buyer orders you accepted; daily updates; ready → packed → dispatched |
| `/artisan/cluster` | Your SHG / village group; borrow and lend material |
| `/artisan/motifs` | Register your village's patterns; licence them to brands |
| `/artisan/design-lab` | Try a pattern on screen before you cut cloth |
| `/artisan/earnings` | Money received, your buyers, your production credit record |
| `/artisan/marketing` | Optional: let a creator promote your work for 5% of that sale |
| `/artisan/notifications` | Everything the app has told you |

**Note one thing that is NOT a route:** logging a sale made at a haat or to a walk-in buyer
lives **inside `/artisan/earnings`**, as the `<OfflineSale />` panel — there is no
`/artisan/log-sale` page. Do not create one, do not link to one, and do not give it a coach
note of its own.

Plus, inside those: the **production credit record** you can send to a bank
(`CreditProfileCard.tsx`, `/credit/[token]`), **recognition badges** (`RecognitionPanel.tsx`,
`badges.ts`), **skill stages** (`skillStage.ts`), **anonymous cluster benchmarks**
(`clusterBenchmark.ts`), and the **floating voice assistant** (`VoiceOnboarding.tsx`) available on
every artisan page.

---

# 4. THE AHA MOMENT & THE HABIT LOOP — THE DESIGN THESIS

## 4.1 The aha moment, named precisely

> **The artisan speaks one sentence about a piece they made, and the app replies with a price —
> including a fair-wage floor that says, in effect, "do not accept less than this."**

In code, that is **`CaptureModal.tsx`, Step 3** — the panel that renders
`price_ai_suggests` (the AI band) and `price_fair_floor_note` (the fair-wage floor), and, when the
artisan has logged real haat sales, `local_market_signal_label` above them.

Why this and not something else:

- It is **reciprocal**: they gave something (their voice), the app gave something back (a number).
- It is **numeric**, which per G2 is the register they trust most.
- It is **emotionally load-bearing**: for a person whose price has always been set by someone else,
  an app that names a floor beneath which their work should not go is not a feature, it is a
  position.
- It happens in **90 seconds**, entirely by voice.

**Every design decision in this document is subordinate to getting a first-time artisan to that
screen as fast as honestly possible.**

## 4.2 The second aha (day 2–7)

> **A buyer scans the QR patch and the artisan's name, village and photograph appear on the
> buyer's phone.**

This is the retention aha. Reaching it requires: list → admin verify → attach patch → re-photograph
→ publish. That is the **activation path** (§11), and it is why the checklist has five steps rather
than one.

## 4.3 The habit loop

```
        ┌──────────────────────────────────────────────────┐
        │  TRIGGER   a notification, a festival, a demand    │
        │            match, or the restock nudge            │
        └───────────────────────┬──────────────────────────┘
                                ▼
        ┌──────────────────────────────────────────────────┐
        │  ACTION    speak one piece into the app (~90 s)    │
        └───────────────────────┬──────────────────────────┘
                                ▼
        ┌──────────────────────────────────────────────────┐
        │  REWARD    a price, a fair-wage floor, a badge,    │
        │            a real ₹ figure in Earnings            │
        └───────────────────────┬──────────────────────────┘
                                ▼
        ┌──────────────────────────────────────────────────┐
        │  INVESTMENT  the portfolio, the credit record and  │
        │              the skill stage all grow — each       │
        │              raising the cost of leaving           │
        └──────────────────────────────────────────────────┘
```

The onboarding system's job is to **complete this loop once, deliberately, with the artisan
watching** — and then get out of the way, because the triggers (`NotificationTicker`,
`SupplyNudgeCard`, demand alerts, SMS) already exist and run on their own.

## 4.4 Why this onboarding is not a tour

A conventional 6-step highlight tour would fail this user on four counts: it is text-heavy (violates
G1/G3/G9), it teaches features before value, it requires remembering steps out of context (G9), and
it is the single most-skipped pattern in consumer software. **Instead: one guided action, then
just-in-time context, then an always-available guide.**

---

# 5. THE ARCHITECTURE — FIVE LAYERS

Build them in this order. Each is independently valuable; each degrades safely if a later one is
absent.

```
LAYER 0 — THE DOOR                         public landing page, 2 tiny additions
  A one-line caption under the artisan CTA, and a language offer bar.
  Buyers never see a blocker. Artisans see themselves named.
        │
        ▼  (register → /artisan/dashboard)
LAYER 1 — THE FIRST MOMENT                 3 screens, ~60–90 seconds, once ever
  Language + mic check → the promise in one number → "let's list your first piece".
  Ends by opening CaptureModal at Step 1. Skippable at every point.
        │
        ▼
LAYER 2 — THE ACTIVATION PATH              a calm dashboard card, days 1–7
  5 steps, each tied to a real database row. Starts at 1/5 already done.
  Removes itself completely when finished.
        │
        ▼
LAYER 3 — JUST-IN-TIME COACH NOTES         first visit to each page, max 1 per session
  One sentence per surface, with a Listen button. Dismiss = never again.
        │
        ▼
LAYER 4 — THE GUIDE HUB                    always available, never forced
  Every feature in plain language, grouped, listenable — plus "ask a person".
        │
        ▼
LAYER 5 — GRADUATION                       hands off to badges + skill stage
  The onboarding UI disappears; the permanent progression layer takes over.
```

---

# 6. CODEBASE GROUND TRUTH

## 6.1 Where the code is

```
KARIGARI-main/KARIGARI/        <-- the Next.js app root. package.json name: "karigari-app"
```

The parent `KARIGARI-main/` contains an unrelated throwaway `package.json`. **Never run `npm` or
`prisma` from there.**

## 6.2 Stack

| Concern | Implementation |
|:--|:--|
| Framework | **Next.js 16.3.1** App Router · **React 19.2.8** · TypeScript 5 · `next build --webpack` |
| Database | **PostgreSQL** · **Prisma 7.10** with `@prisma/adapter-pg` · singleton at `src/lib/prisma.ts` |
| AI | Gemini via `generateContentWithFallback()` in `gemini.ts`; Groq via `groqChatJSON()` in `groq.ts` |
| Auth | JWT in httpOnly cookie `auth-token`; roles are **`ADMIN | ARTISAN` only** |
| Styling | **Tailwind v4**, `@theme` block in `src/app/globals.css` |
| Icons | **lucide-react 1.31** |
| i18n | `useLanguage()` from `src/lib/translations.ts` → `src/lib/i18n/{en,hi,or,te}.ts` |
| Offline | `idb` → `offlineQueue.ts`, `offlineQueueStore.ts`, `offlineSync.ts`; PWA via `@ducanh2912/next-pwa` |
| Speech in | `useSpeechCapture()` hook + `speechCapture.ts` (`getRecognizer`, `recognizerAvailable`, `RECOGNIZER_LANG`, `MAX_RECORDING_MS`) |
| Speech out | `window.speechSynthesis`, currently inlined in `VoiceOnboarding.tsx` — **you will extract this** (§10.4) |
| Images | **base64 data URLs in Postgres.** No S3, no bucket, no upload service. |

## 6.3 Next.js 16 / React 19 rules — breaking any of these produces a build error or a hydration bug

- `cookies()` is async → `const cookieStore = await cookies();`
- `params` is a Promise in server components → `const { id } = await params;`
- **Never use `useSearchParams()` in a client page.** The house pattern reads
  `window.location.search` inside a **deferred** effect, so no `<Suspense>` boundary is needed. See
  `src/lib/urlTab.ts` and `VerificationClient.tsx`.
- **No synchronous `setState` in an effect body.** Every page here opens with
  `const kickoff = setTimeout(() => { … }, 0); return () => clearTimeout(kickoff);` — follow it
  exactly. Your onboarding gate **must** use this pattern or it will flash.
- Any date or relative time rendered on both server and client needs an **explicit locale and time
  zone** (`toLocaleString('en-IN', { …, timeZone: 'Asia/Kolkata' })`) or it throws a hydration
  mismatch. See `STAMP_FORMAT` in `VerificationClient.tsx` and `src/lib/relativeTime.ts`.
- `import { prisma } from '@/lib/prisma'` — never `new PrismaClient()`.
- After `prisma generate`, **restart the dev server** or you get `Unknown argument` from a cached
  client.
- `<Image>` on a data URL needs `unoptimized`, and an empty `src` must be guarded — use
  `imageProps()` from `src/lib/marketplace.ts`.

## 6.4 The theme — your only palette

Defined in the `@theme` block of `src/app/globals.css`. **Open it first.** Its own header states the
character:

> *"a warm off-white canvas, near-black ink instead of forest green, and maroon / terracotta as the
> only two accents"* … *"**nothing in this design is allowed to be bright.**"*

```
Surfaces   --color-background #F6F3EE   --color-card #FFFFFF   --color-sidebar #F1EDE6
           --color-pill #ECE7E0
Ink        --color-primary #1A1A1A   --color-primary-dark #2E2926   --color-primary-light #4A423C
Accents    --color-maroon #5A1A1A   --color-maroon-soft #7E2A22
           --color-rust #C2632F     --color-rust-deep #B45309    --color-pink #F8D9CE
Neutrals   --color-sage #D9D0C4     --color-mint #ECE7E0   (both WARM NEUTRALS now, not green)
Stat       --color-stat-teal #4A5241  --color-stat-orange #C2632F
           --color-stat-blue #4D5D6C  --color-stat-brown #9A7B3F
Gray       50 #FAF8F5 · 100 #F1EDE6 · 200 #E4DED5 · 300 #D2CBC1 · 400 #A39C93
           500 #6E675F · 600 #55504A · 700 #3D3934 · 800 #2A2724 · 900 #1A1A1A
Green      50 #EFF0E8 · 100 #E2E5D6 · 500 #566049 · 600 #49523E · 700 #3C4433
Blue       50 #E9EDF0 · 100 #D6DDE4 · 500 #4D5D6C · 700 #37424D
Orange     50 #FBEDE3 · 100 #F4DCC9 · 500 #C2632F · 700 #94481F
Red        50 #FBE9E5 · 100 #F6D6CE · 500 #8C2B22 · 700 #5A1A1A
Yellow     50 #F6EEDD · 500 #9A7B3F · 700 #7C6231
Type       --font-serif (Fraunces→Playfair→Georgia→Inter) · --font-sans (Inter) · --font-mono (Plex Mono)
Shadow     --shadow-card (resting) · --shadow-soft (raised)
```

**Never write a raw hex.** Always `var(--color-…)` or the Tailwind class that maps to it. If you
think you need a colour that is not above, you have misread the palette.

Editorial primitives in `globals.css` — use these instead of inventing styles:
`.kg-label` (tracked uppercase mono micro-label) · `.kg-display` (serif figures and titles) ·
`.kg-offset` (hard stacked shadow) · `.kg-rule-maroon` · `.kg-rail` / `.kg-scroll-x` (snap rails) ·
`.kg-enter` `.kg-fade` `.kg-slide-in` `.animate-fade-in-up` `.kg-stagger` (entrance) ·
`.kg-shimmer` (loading) · `.kg-lift` (clickable cards) · `.kg-press` (buttons and pills).
All motion already sits behind a `prefers-reduced-motion` guard at the bottom of `globals.css` —
**stay inside these classes so your animation inherits it.**

## 6.5 Domain facts that will bite you if you forget them

1. **Buyers have no `User` row.** `Role` is `ADMIN | ARTISAN`. Buyer identity is a free-text name
   matched case-insensitively (`Demand.buyerName`, `CraftItem.buyerName`, …). This is *why* buyer
   onboarding is out of scope — there is no buyer account to onboard.
2. **There is no `Order` table.** A storefront purchase **is** the `CraftItem` row. A demand
   commitment is a separate `ArtisanOrder` row.
3. **A `CraftItem` is one physical piece**, not a stocked SKU.
4. **Presence of a timestamp is the idempotency guard** throughout this schema (`paidAt`,
   `packedAt`, `qrVerifiedAt`, `settledAt`…). Follow the same pattern for every new step you add:
   an `updateMany` whose predicate includes `{ theTimestamp: null }`.
5. **Cluster key resolution**, used everywhere: `artisanProfile.shgGroupLink` when present,
   otherwise `` `auto:${location}` ``. Reuse exactly this; do not invent a second definition.
6. **Money that did not move is never shown as received.** Read the doc comments on
   `CraftItem.paidAmountPaise` and `ArtisanOrder.advanceDueAmount` before writing any ₹ copy.

## 6.6 Existing components you must NOT confuse or duplicate

| Name | What it actually is | Your relationship to it |
|:--|:--|:--|
| `VoiceOnboarding.tsx` | **Misleadingly named.** It is the floating voice *assistant* bubble, mounted on every artisan route by `src/app/artisan/layout.tsx`. It is **not** onboarding. | Do not modify it. **Extract** its `speakText` helper into a shared hook (§10.4) without changing its behaviour. Suppress the bubble only while the First Moment overlay is open (§10.6). |
| `AssistedOnboardingModal.tsx` | An **admin/facilitator** tool: a Sahayak captures a craft on behalf of an artisan, from `/admin/facilitator`. | Do not touch. Do not reuse. Do not rename. |
| `SupplyNudgeCard.tsx` | The restock nudge on the dashboard. **This is your style reference** for a calm, dismissible, server-backed inline card. Read it before building Layer 2. | Model your Activation card on its structure, tone and dismissal semantics. |
| `RecognitionPanel.tsx` + `badges.ts` + `skillStage.ts` | The permanent progression layer. | Layer 5 hands off to this. Do not duplicate its logic. |
| `NotificationTicker.tsx` | The three gliding strips at the top of the dashboard. | Do not add a fourth lane. Do not put onboarding in it. |
| `AutoTranslator.tsx` | Mounted globally in `src/app/layout.tsx`; machine-translates untranslated DOM text at runtime. | A **safety net, not a substitute**. Every string you add still needs a real key in all four dictionaries. |
| `CaptureModal.tsx` | The 4-step capture flow. Step 1 voice/text → Step 2 photos → **Step 3 price (the aha)** → Step 4 success. | You open it and you enhance its Step 4 success screen (§11.6). You change nothing else inside it. |

## 6.7 i18n — a hard requirement

Every user-facing string goes in **all four** dictionaries: `src/lib/i18n/en.ts` (statically
imported, the synchronous fallback), `hi.ts`, `or.ts`, `te.ts` (lazily imported, cached).

- Read with `const { t } = useLanguage();` then `t("key")`.
- Interpolate with the existing `{placeholder}` convention. There is a helper:
  `fill(template, values)` exported from `src/components/buyer/passportFormat.ts`.
- **Never hardcode an English string in JSX.** A missing key renders the key — a visible bug.
- API responses and DB-stored text stay English; translate at render.
- Provide **real** Hindi / Odia / Telugu translations. Copying English across is a failure.

## 6.8 Auth pattern for new routes

```ts
import { requireArtisan } from '@/lib/artisanAuth';

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;   // send it back verbatim
  const artisanId = auth.artisan.userId;
  …
}
```

## 6.9 Tests — there is no test framework, and you must not add one

`src/lib/__tests__/` uses plain `.mjs` files that compile the real TS module with esbuild's JS API
and assert with `node:assert/strict`. Read `orderStage.test.mjs` before writing any test. Add an
npm script per test beside the existing `verify:schemes`. **No jest, no vitest, no mocha.**

---

# 7. DATA MODEL

Add **one** model. Everything else is derived from rows that already exist.

```prisma
/// One artisan's onboarding and activation state.
///
/// SERVER-SIDE, NOT localStorage, and that is the whole point: registration is
/// frequently completed for an artisan by an SHG facilitator on the
/// facilitator's phone, and the artisan then opens the app on their own. A
/// device-local flag would replay the whole First Moment for them as a
/// stranger, or — worse — mark it done on a phone they will never hold again.
/// Per-device dismissals still exist (see the coach-note budget), but anything
/// that must be true "once, ever, for this person" lives here.
///
/// Written only by /api/artisan/onboarding. Nothing else writes this table.
model ArtisanOnboarding {
  id               String    @id @default(uuid())
  artisanId        String    @unique
  artisan          User      @relation(fields: [artisanId], references: [id])

  /// PENDING | COMPLETED | SKIPPED. PENDING is the only state that shows the
  /// First Moment. SKIPPED is deliberate and permanent: an artisan who dismissed
  /// it is never shown it again, because asking twice is how a product teaches
  /// someone that dismissing does not work.
  firstMomentStatus String   @default("PENDING")
  firstMomentAt     DateTime?

  /// The language chosen on screen 1, mirrored here so it follows the account
  /// across devices (SARAL G13). `translations.ts` still owns the live
  /// per-device choice in localStorage; this is the durable default applied on
  /// first load of a new device.
  preferredLanguage String?

  /// True once the artisan successfully produced a transcript in the mic check.
  /// Not a gate on anything — it is the signal that voice capture works on this
  /// person's phone, which the Guide uses to decide whether to keep offering it.
  voiceChecked      Boolean  @default(false)

  /// Route keys whose one-time coach note has been seen and dismissed, e.g.
  /// "earnings", "workshop". Append-only. A string[] rather than a table
  /// because there are at most ~15 and nothing ever queries across artisans.
  seenCoachMarks    String[]

  /// Set when the artisan dismissed the activation card. The card stays gone,
  /// but activation itself keeps being computed — the Guide still shows real
  /// progress, because hiding a card is not the same as abandoning a goal.
  activationHiddenAt DateTime?

  /// Set the first time all five activation steps are satisfied. Presence is
  /// the idempotency guard for the graduation moment, which must fire once.
  activatedAt       DateTime?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([firstMomentStatus])
}
```

Add to `model User`:

```prisma
  onboarding ArtisanOnboarding?
```

Then:

```bash
npx prisma db push && npx prisma generate
# RESTART the dev server
```

**The row is created lazily** — on the first `GET /api/artisan/onboarding` — never in the
registration route. Registration is already the slowest, most fragile path in the app and must not
grow a write that can fail.

## 7.1 Activation state is DERIVED, never stored

The five activation steps are computed on every read from live rows. **Do not add columns for
them.** A stored copy would drift the moment an admin verifies a piece or a buyer pays.

| # | Step | Satisfied when | Source |
|--:|:--|:--|:--|
| 1 | Account created | always true | the `User` row exists |
| 2 | Profile ready for payouts | `artisanProfile.photoUrl` **and** `artisanProfile.upiId` are both non-null | `ArtisanProfile` |
| 3 | First craft listed | ≥ 1 `CraftItem` for this artisan | `CraftItem` count |
| 4 | Patch attached & verified | ≥ 1 `CraftItem` with `qrVerified === true` | `CraftItem` |
| 5 | Live on the marketplace | ≥ 1 `CraftItem` with `isListedOnMarketplace === true` | `CraftItem` |

Compute in **one** `Promise.all` of aggregate queries. Never a row-by-row loop, never an N+1.

---

# 8. PHASE 1 — LAYER 0: THE DOOR (landing page)

## 8.1 The constraint

The landing page serves **two audiences at once**. A buyer must be able to arrive, browse and
leave without ever being asked who they are. An artisan must, within two seconds, see something
that names *their* situation.

**Therefore: no modal, no interstitial, no role-chooser, no overlay, no auto-playing anything.**
The entire intervention is **two one-line additions**. If your diff on this phase is more than
about 60 lines, you have overbuilt it.

## 8.2 Read first

`src/app/page.tsx` (481 lines) · `src/components/ui/LanguageSwitcher.tsx` ·
`src/lib/translations.ts` · `src/app/globals.css`

## 8.3 Addition 1 — the artisan caption

In the hero (around line 244 of `src/app/page.tsx`) there are two CTAs: **"Explore Marketplace"**
(primary, dark) and **"Join as an Artisan"** (secondary, outline). **Do not change either button —
not the label, not the order, not the hierarchy, not the styling.**

Add **one line of `.kg-label` micro-copy directly beneath the CTA pair**, centred, in
`text-gray-500`:

> **"Speak in your language. We build the listing. No typing."**  (`t("landing_artisan_caption")`)

Why this works: a buyer's eye slides past it as a tagline. An artisan reads a description of their
exact problem. It is one line, it blocks nothing, and it is honest — that is literally what D1 does.

Mark-up requirements:
- Sits inside the existing hero container, after the CTA `div`, with `mt-5`.
- `.kg-label` class, `text-gray-500`, `max-w-[34rem]`, centred.
- Must not shift the hero's vertical rhythm on mobile — check at 360 px that nothing below moves
  more than ~20 px and nothing overflows.

## 8.4 Addition 2 — the language offer bar

**The single highest-value artisan signal on this page**, and it is invisible to most buyers.

Behaviour:

1. On first load only, in a **deferred effect** (never during render), read
   `navigator.language` / `navigator.languages`.
2. If a language matching `hi`, `or`, or `te` is present **and** the current app language is `en`
   **and** the artisan has not dismissed the bar before, render a slim bar directly beneath the
   nav.
3. The bar contains: a `Globe` icon (lucide, 16px), one line in **the target script**, and two
   controls — a switch button and a dismiss `X`.

Copy, in the target language, e.g. for Odia:

> **ଓଡ଼ିଆରେ ଦେଖନ୍ତୁ** · [ଓଡ଼ିଆ] [✕]

Rules:
- The bar is `bg-[var(--color-pill)]`, `border-b border-gray-200/70`, one line, `min-h-[44px]`.
  Never sticky. Never covering content. It scrolls away with the page.
- Switching calls `changeLanguage()` from `useLanguage()` — **never** writes `localStorage`
  directly. `LanguageSwitcher.tsx` documents exactly why: a direct write leaves every other
  subscriber stale.
- Dismissal persists in `localStorage` under `karigari_lang_offer_dismissed`, wrapped in
  try/catch (it throws in private mode). A dismissed bar never returns.
- **Never auto-switch the language.** Offering is respectful; switching without consent is not,
  and it would break a buyer who happens to have a Hindi locale.
- Must not exist in the server-rendered HTML at all. Render `null` until the deferred effect has
  run, or you will get a hydration mismatch.

## 8.5 Addition 3 — intent hand-off (one attribute)

Change the artisan CTA's `href` from `/register` to `/register?role=artisan`.

In `src/app/register/page.tsx`, read that param in a **deferred effect** reading
`window.location.search` (**not** `useSearchParams` — see §6.3), and use it only to pre-select the
existing `role` state to `'ARTISAN'`. That is already the default, so this changes nothing visible
today; it exists so the intent survives, and so analytics can later tell the two doors apart.
**Do not add any other behaviour to the register page in this phase.**

## 8.6 Explicitly out of scope on the landing page

- ❌ Changing which CTA is primary. (It is arguably worth testing later. Not now, not silently.)
- ❌ A "For artisans" page, section, or tab.
- ❌ A video, carousel, or animated demo.
- ❌ Anything that appears over the fold content.
- ❌ Any change to `/buyer`, `/marketplace`, or `/creators`.

## 8.7 Verification — Phase 1

- [ ] `/` in a clean browser profile with an `en-US` locale: **no bar**, caption present, layout
      unchanged from before (compare screenshots)
- [ ] `/` with browser language set to Hindi: bar appears in Devanagari, switch works, dismiss
      persists across reload
- [ ] A buyer can go `/` → `/marketplace` → a product page with **zero** interruptions
- [ ] No hydration warning in the console on `/` in any language
- [ ] 360 px: caption wraps to at most two lines; bar is one line; nothing overflows horizontally
- [ ] Gates green

---

# 9. PHASE 2 — DATA MODEL + API

## 9.1 Read first

`prisma/schema.prisma` (the `ArtisanProfile`, `CraftItem` and `User` models, and the doc-comment
style used throughout) · `src/lib/artisanAuth.ts` · `src/app/api/artisan/dashboard/route.ts` ·
`src/lib/supplyReminder.ts` (for the lazy-state pattern)

## 9.2 Schema

Apply §7 exactly, including the doc comments. Then `npx prisma db push && npx prisma generate` and
**restart the dev server**.

Match the house doc-comment style: every model and every non-obvious column explains **why it
exists and who writes it**. Read the comments already in `schema.prisma` before writing yours.

## 9.3 `src/lib/onboarding.ts` — pure domain module

```ts
export const ACTIVATION_STEPS = ['account', 'profile', 'first_craft', 'patch', 'listed'] as const;
export type ActivationStepKey = (typeof ACTIVATION_STEPS)[number];

export type FirstMomentStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED';

/** Every route that can show a one-time coach note. Keys are stable and stored. */
export const COACH_ROUTES = [
  'market', 'workshop', 'insights', 'schemes', 'learn', 'orders',
  'cluster', 'earnings', 'motifs', 'design-lab', 'marketing', 'news',
] as const;
export type CoachRouteKey = (typeof COACH_ROUTES)[number];
export function isCoachRoute(v: unknown): v is CoachRouteKey;
/** "/artisan/earnings?tab=buyers" -> "earnings"; unknown route -> null. */
export function coachKeyForPath(pathname: string): CoachRouteKey | null;

export interface ActivationInputs {
  hasPhoto: boolean;
  hasUpi: boolean;
  craftItemCount: number;
  qrVerifiedCount: number;
  listedCount: number;
}

export interface ActivationStep {
  key: ActivationStepKey;
  done: boolean;
  /** i18n keys — never English strings. */
  titleKey: string;
  whyKey: string;
  /** Where the artisan goes to do it. `null` for `account`, which is already done. */
  href: string | null;
  /** True for the single step the artisan should do NEXT. Exactly one, or none. */
  isNext: boolean;
}

export interface ActivationState {
  steps: ActivationStep[];
  doneCount: number;
  totalCount: number;
  /** 0..1. */
  progress: number;
  complete: boolean;
}

/** Pure, deterministic, no I/O. The first not-done step is the one marked isNext. */
export function resolveActivation(inputs: ActivationInputs): ActivationState;
```

Step definitions:

| key | titleKey | whyKey | href |
|:--|:--|:--|:--|
| `account` | `onb_step_account` | `onb_step_account_why` | `null` |
| `profile` | `onb_step_profile` | `onb_step_profile_why` | `/artisan/dashboard?edit=profile` |
| `first_craft` | `onb_step_craft` | `onb_step_craft_why` | `/artisan/dashboard?capture=1` |
| `patch` | `onb_step_patch` | `onb_step_patch_why` | `/artisan/market` |
| `listed` | `onb_step_listed` | `onb_step_listed_why` | `/artisan/market` |

`/artisan/dashboard?edit=profile` is an **existing** deep link — `src/app/artisan/layout.tsx`
already routes the avatar there to open `ProfileEditorModal`. Reuse it; do not invent a new one.

`?capture=1` is **new**: in Phase 3 you will make the dashboard open `CaptureModal` when that param
is present (§10.7).

Add `src/lib/__tests__/onboarding.test.mjs` per §6.9: all-false inputs → 1/5 done and `profile` is
next; all-true → complete, no `isNext`; partial combinations; and the invariant that **at most one**
step is ever `isNext`.

## 9.4 `src/app/api/artisan/onboarding/route.ts`

**`GET`** — `requireArtisan`, then:

1. Lazily upsert the `ArtisanOnboarding` row (`upsert` on `artisanId`, `create: {}`). This is the
   only creation site.
2. One `Promise.all` gathering: the profile's `photoUrl`/`upiId`, and three `count`s on `CraftItem`
   (total, `qrVerified: true`, `isListedOnMarketplace: true`).
3. `resolveActivation(...)`.
4. If `activation.complete` **and** `activatedAt` is null, set `activatedAt` with an `updateMany`
   whose predicate includes `{ activatedAt: null }` — the idempotency pattern from §6.5.4 — and
   return `justActivated: true` on **that one response only**. This is what triggers the graduation
   moment (§14) exactly once, on whichever device is open.

Response:

```ts
{
  success: true,
  onboarding: {
    firstMomentStatus: FirstMomentStatus,
    preferredLanguage: string | null,
    voiceChecked: boolean,
    seenCoachMarks: string[],
    activationHidden: boolean,
    activatedAt: string | null,
  },
  activation: ActivationState,
  justActivated: boolean,
}
```

**`PATCH`** — a narrow, allow-listed action union. **Reject anything not in this list with 400.**

```ts
| { action: 'first_moment_complete'; language?: 'en'|'hi'|'or'|'te'; voiceChecked?: boolean }
| { action: 'first_moment_skip' }
| { action: 'coach_seen'; route: CoachRouteKey }
| { action: 'activation_hide' }
| { action: 'activation_show' }
```

Rules:
- `first_moment_complete` / `first_moment_skip` set `firstMomentStatus` and `firstMomentAt`
  **only when the current status is `PENDING`** — monotonic, like every other status in this
  schema. A second call is a silent no-op returning success, never an error.
- `coach_seen` validates `route` with `isCoachRoute`, then appends to `seenCoachMarks` **only if
  absent** (read-modify-write inside a single `$transaction`, or use Postgres array append — either
  way it must be safe against two tabs). Unknown route → 400.
- `language` validated against the four codes; anything else ignored, not stored.
- Every branch returns the same shape as `GET` so the client can replace its state wholesale.

**No other verbs. No DELETE. No route parameters.**

## 9.5 `src/lib/useOnboarding.ts` — the single client-side source of truth

```ts
export interface OnboardingState { /* the GET payload, plus: */ loading: boolean; error: boolean; }

/** Module-level shared store + useSyncExternalStore, exactly like
 *  src/lib/offlineQueueStore.ts — so five mounted consumers make ONE request. */
export function useOnboarding(): OnboardingState & {
  completeFirstMoment(language?: Language, voiceChecked?: boolean): Promise<void>;
  skipFirstMoment(): Promise<void>;
  markCoachSeen(route: CoachRouteKey): Promise<void>;
  hideActivation(): Promise<void>;
  refresh(): Promise<void>;
};
```

Requirements:
- **One fetch per session**, shared across every consumer. Read `offlineQueueStore.ts` and copy its
  structure: module-level state, a `Set` of listeners, `useSyncExternalStore`, and a
  `SERVER_SNAPSHOT` that includes **every** field (omitting one causes a `useSyncExternalStore`
  warning).
- Optimistic local update on every mutation, with a rollback if the request fails. An artisan who
  taps "skip" must see it vanish instantly even on a 3G connection.
- A failed fetch must **fail closed**: `firstMomentStatus` behaves as `COMPLETED` and no coach notes
  fire. **If the API is down, the artisan sees no onboarding at all — never a broken one.** State
  this in a comment; it is the most important line in the file.
- `refresh()` is called after the dashboard's own payload reloads, so a newly-verified patch ticks
  its step without a page reload.

## 9.6 Verification — Phase 2

- [ ] `GET /api/artisan/onboarding` as a fresh artisan → row created, `firstMomentStatus: PENDING`,
      activation 1/5, `profile` is `isNext`
- [ ] Add a photo + UPI → 2/5, `first_craft` is next
- [ ] Call `PATCH first_moment_skip` twice → both succeed, status stays `SKIPPED`
- [ ] `PATCH coach_seen` with a bogus route → 400, array unchanged
- [ ] `PATCH coach_seen` with the same valid route twice → one entry in the array
- [ ] Satisfy all five steps → `justActivated: true` on exactly **one** response; every later call
      returns `false` with `activatedAt` set
- [ ] Two browser tabs → one network request per tab, state stays consistent
- [ ] `onboarding.test.mjs` passes
- [ ] Gates green

---

# 10. PHASE 3 — LAYER 1: THE FIRST MOMENT

## 10.1 What it is

A **full-screen, three-screen, ~75-second** sequence that runs **once**, the first time an artisan
lands on `/artisan/dashboard` with `firstMomentStatus === 'PENDING'`. It ends by opening the
CaptureModal.

It is full-screen on purpose — this is the one moment where focus is correct, because the artisan
just arrived and has nothing else in progress. Every *later* layer is non-blocking.

## 10.2 The three screens — one idea each (SARAL G3, G6, G7, G9)

### Screen 1 — "Which language do you speak?" + mic check

- Four large tap targets, each ≥ 72 px tall, showing the language **in its own script**:
  `English` · `हिंदी` · `ଓଡ଼ିଆ` · `తెలుగు`. No flags (a flag is not a language). Tapping calls
  `changeLanguage()` immediately, so **the rest of the sequence is already in their language.**
- Below it, one instruction and a big circular mic button: **"Tap and say your name."**
- Uses the existing `useSpeechCapture()` hook. On a successful transcript, show it back in large
  serif type — *"नमस्ते, लक्ष्मी"* — with a tick. That is the moment the artisan learns the mic
  works and that the app understood them.
- **The mic check is optional and never blocking.** A denied permission, an unsupported browser, a
  silent room, a missing recogniser for that language (`RECOGNIZER_LANG[lang] === null`) — every
  one of these shows a calm line and a **"Continue"** button. Never an error tone, never a retry
  loop, never a dead end.
- Success sets `voiceChecked: true` in the final PATCH.

### Screen 2 — the promise, as a number (SARAL G2)

- The hero element is **a number**, in `.kg-display`, very large:

  > **₹89**
  > *out of every ₹100 comes to you*

  Computed from `ARTISAN_TOTAL_RATE` in `src/lib/escrow.ts` — **never hardcoded**. Render as
  `Math.round(ARTISAN_TOTAL_RATE * 100)`.
- Three short supporting lines, each with one lucide icon, each **one line** (D1, D3, D4 from §3.2):
  - 🎤 *Speak in your language. We write the listing.*
  - 💰 *40% as soon as you send the piece.*
  - 🔖 *A QR tag proves your name travels with your work.*
- Nothing else. No illustration that needs loading. No paragraph.

### Screen 3 — the invitation

- One line: **"Let's list your first piece."**
- One sub-line: **"About two minutes. You only have to talk."**
- One large primary button: **"Start"** → PATCH `first_moment_complete`, close the overlay, open
  `CaptureModal` at Step 1.
- One quiet secondary: **"I'll do it later"** → same PATCH, close, land on the dashboard with the
  Activation card visible.

## 10.3 Component contract

`src/components/onboarding/FirstMoment.tsx`

```tsx
export function FirstMoment({
  artisanName,
  onFinish,     // (opts: { startCapture: boolean }) => void
  onSkip,       // () => void
}: FirstMomentProps)
```

- `"use client"`.
- Rendered by `src/app/artisan/dashboard/page.tsx` only, behind
  `onboarding.firstMomentStatus === 'PENDING' && !onboarding.loading`.
- Mounted via `next/dynamic` with `ssr: false` so it never reaches the server bundle and never
  flashes for a returning artisan.

## 10.4 The Listen button — extract, don't duplicate (SARAL G1, G10)

`VoiceOnboarding.tsx` already contains a working `speakText` using `window.speechSynthesis`, with a
deliberate `en-IN` voice choice documented in a comment (Windows and Android usually ship no Odia or
Telugu voice, but the Indian English voice reads romanised text convincingly).

**Extract it, unchanged in behaviour, into `src/lib/useSpeak.ts`:**

```ts
export interface SpeakController {
  speak(text: string): void;
  stop(): void;
  speaking: boolean;
  /** False when the browser has no speechSynthesis at all. */
  supported: boolean;
}
export function useSpeak(): SpeakController;
```

Then:
- Refactor `VoiceOnboarding.tsx` to consume it. **Its behaviour must not change at all** — same
  voice selection, same rate 0.9, same pitch 1.0, same cancel-before-speak.
- Build `src/components/onboarding/ListenButton.tsx`: a small round icon button
  (`Volume2` / `VolumeX`), `aria-label` from `t("onb_listen")`, that renders **nothing** when
  `supported === false`. A dead button is worse than no button.
- Put a `ListenButton` on **every** onboarding screen, every coach note, and every Guide entry.

## 10.5 Visual design — must look like it was always there

- Full-screen: `fixed inset-0 z-[120]`, background `bg-[var(--color-background)]`. Not a dark
  scrim — this is a place, not an interruption over somewhere else.
- The content column: `mx-auto max-w-[520px] px-6`, vertically centred, generous whitespace (G3).
- Titles in `.kg-display`. Micro-labels in `.kg-label`. Body in `--font-sans`, `text-[16px]`,
  `leading-relaxed`, `text-gray-700`.
- Primary button: the house form —
  `kg-press kg-label min-h-[54px] rounded-xl bg-primary text-white hover:bg-primary-dark`, full
  width on mobile.
- Progress: three dots, the active one `bg-primary`, the rest `bg-[var(--color-gray-300)]`. Plus
  the numeral **"1 / 3"** in `.kg-label` beside them (G2 — the numeral carries more than the dots).
- Transitions: `.kg-fade` between screens. Nothing bouncy, nothing that spins.
- Skip: a plain text button, top-right, always visible on all three screens, reading
  `t("onb_skip")`. **Never disabled, never hidden, never delayed, never shamed** ("No thanks, I
  don't want more money" is a dark pattern and is forbidden — see §17.1).

## 10.6 Interaction rules

- **Focus trap**: focus moves to the overlay on mount, cycles inside it, and returns to the
  triggering element on close. `Esc` = skip.
- Suppress the floating `VoiceOnboarding` bubble while the overlay is open. Do this **without
  editing `VoiceOnboarding.tsx`'s logic** — the cleanest way is a condition in
  `src/app/artisan/layout.tsx` beside the existing `!pathname?.startsWith("/artisan/learn")` check,
  driven by the shared `useOnboarding()` state.
- Scroll-lock the body while open; restore on close.
- **Offline**: the whole sequence must run with no network. The PATCH at the end is fire-and-forget
  with a local optimistic update — if it fails, the overlay still closes and the local state says
  completed. Re-showing it because a request failed would be the worst possible outcome.
- Total time budget: a first-time artisan who taps without hesitation must be able to reach
  CaptureModal Step 1 in **under 75 seconds**. Time it.

## 10.7 Two small host changes

**`src/app/artisan/dashboard/page.tsx`:**
1. Mount `<FirstMoment />` behind the gate in §10.3.
2. Support `?capture=1`: in the existing deferred kick-off effect, read
   `window.location.search` (**not** `useSearchParams`) and if `capture=1` is present, call
   `setIsModalOpen(true)` and strip the param with `window.history.replaceState` — the same pattern
   `src/app/marketplace/page.tsx` already uses for its filters. This is what lets the Activation
   card's "List your first craft" button work from anywhere.

**`src/app/artisan/layout.tsx`:** the `VoiceOnboarding` suppression from §10.6. Nothing else.

## 10.8 Verification — Phase 3

- [ ] Register a brand-new artisan → lands on the dashboard → First Moment appears once
- [ ] Complete it → CaptureModal opens at Step 1 → reach **Step 3 and see a real price band and
      fair-wage floor** — **stopwatch this end to end; it must be under 3 minutes**
- [ ] Reload the dashboard → First Moment does **not** reappear
- [ ] Second browser profile, same account → still does not reappear (this proves §7's server-side
      decision)
- [ ] Skip on screen 1 → never returns; the Activation card is visible instead
- [ ] Deny microphone permission → calm message, Continue works, sequence completes
- [ ] Switch to Odia on screen 1 → screens 2 and 3 render in Odia
- [ ] Listen button reads each screen aloud; hidden entirely in a browser without `speechSynthesis`
- [ ] Airplane mode → whole sequence runs and closes cleanly
- [ ] Keyboard only: Tab cycles inside the overlay, `Esc` skips, focus returns correctly
- [ ] 360 px: no screen scrolls; every tap target ≥ 44 px
- [ ] `prefers-reduced-motion: reduce` → no transitions, everything still usable
- [ ] Gates green

---

# 11. PHASE 4 — LAYER 2: THE ACTIVATION PATH

## 11.1 What it is

A calm inline card on the dashboard showing the five real steps from §7.1. It is the bridge from
"I signed up" to "my work is live and a buyer can scan it".

**Read `src/components/SupplyNudgeCard.tsx` first.** It is the reference implementation for this
kind of card in this codebase: muted, inline, not a modal, not red, server-backed state plus a
per-device dismissal, honest about what it knows. Match its structure and its tone.

## 11.2 Placement

`src/app/artisan/dashboard/page.tsx`, immediately **below** the overview + capture-card grid and
**above** `<TrustAndReportsCard />` (around line 375). That is the first thing below the fold-line
content, which is right: it is important but not more important than the artisan's money.

Render only when: `activation.complete === false` **and** `activationHidden === false` **and**
`onboarding.loading === false`. Otherwise render `null` — **no skeleton, no placeholder, no
reserved space**, or a returning activated artisan gets a layout shift for nothing.

## 11.3 Design (SARAL G3, G4)

```
┌──────────────────────────────────────────────────────────────┐
│  GETTING STARTED                                    2 of 5 ✓  │   .kg-label row
│                                                               │
│  ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                      │   ProgressBar
│                                                               │
│  ✓  Account created                                           │   done: muted, ticked
│  ✓  Photo and UPI added                                       │
│  ▶  List your first craft                        [ Start  ]   │   NEXT: emphasised + action
│     Speak about one piece. We write the rest.                 │   the "why", one line
│  ·  Attach the QR tag                                         │   later: quiet, no button
│  ·  Go live on the marketplace                                │
│                                                               │
│  [ 🔊 ]                                            Hide       │
└──────────────────────────────────────────────────────────────┘
```

- `Card tone="muted"` `radius="2xl"` `pad="md"` from `src/components/ui/Card.tsx`.
- Header row: `.kg-label` "GETTING STARTED" on the left; **"2 of 5"** on the right (G2 — the
  numerals, not just the bar).
- `ProgressBar` from `src/components/ui/ProgressBar.tsx`. Fill `var(--color-rust)` — terracotta is
  the theme's "movement / up-trend" accent per `globals.css`.
- **Exactly one step carries an action button** — the `isNext` one. Completed steps are ticked and
  muted (`text-gray-500`, `CheckCircle2` in `var(--color-green-600)`). Future steps are quiet
  (`text-gray-400`, a small dot), with **no button** — offering step 5 before step 3 is how a
  checklist teaches helplessness.
- **The "why" line renders only on the `isNext` step.** Five explanations at once is a wall of text
  (G3/G6). One explanation, at the moment it is relevant, is guidance.
- A `ListenButton` reads the current step and its why-line aloud.
- "Hide" → PATCH `activation_hide`. Per-account, not per-device: an artisan who hid it on the
  Sahayak's phone should not meet it again on their own. The Guide still shows real progress (§13).

## 11.4 Component contract

`src/components/onboarding/ActivationCard.tsx`

```tsx
export function ActivationCard({
  activation,   // ActivationState
  onHide,       // () => void
  onAction,     // (step: ActivationStep) => void
}: ActivationCardProps)
```

The card is **presentational**. It does not fetch. The dashboard passes state down from
`useOnboarding()`. `onAction` navigates to `step.href` (or opens the capture modal directly when the
href is `?capture=1` on the current page).

## 11.5 Keeping it honest and live

- After the dashboard payload reloads (it already refetches on the `karigari:queue-flushed` event
  from `OfflineSyncProvider.tsx`), call `onboarding.refresh()` so a step that just became true ticks
  without a reload.
- When a step ticks over while the card is on screen, animate **only** that row with `.kg-fade`.
  No confetti. No sound. No toast. A quiet tick is more dignified and more believable.
- **Never fake a tick.** A step is done when the database says so. Dismissing something, viewing
  something, or clicking "Start" ticks nothing.

## 11.6 The first-craft celebration — CaptureModal Step 4

`CaptureModal.tsx`'s Step 4 success screen currently contains **three hardcoded English strings**:
`"Upload Successful!"`, `"Your craft has been saved to your digital portfolio."`, and
`"Back to Dashboard"`. (The offline branch beside it is correctly translated — compare them.)

In this phase:
1. Replace all three with `t()` keys and add them to all four dictionaries (§16). This is a real
   i18n bug and fixing it is in scope.
2. **Only when this is the artisan's first ever craft** (`activation.steps.first_craft.done ===
   false` at modal-open time), add one extra line beneath the confirmation:
   > **"Your first piece is saved. Next: attach the QR tag so buyers can check it is really
   > yours."** with a button to `/artisan/market`.

   One line. No badge animation, no modal-on-modal, no score. The artisan just did something real;
   the app acknowledges it and points at the next real thing.
3. Change nothing else in `CaptureModal.tsx`. Not the steps, not the gates, not the pricing, not
   the photo pipeline.

## 11.7 Verification — Phase 4

- [ ] Fresh artisan → card shows **1 of 5**, `profile` is next with a button, steps 3–5 quiet and
      buttonless
- [ ] Add photo + UPI via the existing profile editor → card moves to 2 of 5 without a reload
- [ ] "Start" on `first_craft` opens CaptureModal
- [ ] Complete a capture → Step 4 shows the translated copy + the first-piece line; card → 3 of 5
- [ ] Attach and verify a patch → 4 of 5; publish → 5 of 5 → **card disappears entirely**
- [ ] "Hide" → gone; reload → still gone; second device → still gone
- [ ] Exactly one action button is ever visible
- [ ] `ListenButton` reads the current step in the selected language
- [ ] An already-activated artisan sees **no card and no layout shift** on load
- [ ] Gates green

---

# 12. PHASE 5 — LAYER 3: JUST-IN-TIME COACH NOTES

## 12.1 The problem this solves

There are 14 artisan surfaces (§3.3). A tour of all of them on day one would be the exact "annoying"
failure the brief forbids. So: **teach each page the first time the artisan actually opens it**, and
**budget it hard** so curiosity is never punished.

## 12.2 The anti-annoyance contract — these limits are absolute

1. **One coach note per page, ever.** Dismissed → stored in `seenCoachMarks` → never shown again on
   any device.
2. **Maximum ONE coach note per session.** An artisan who clicks through six pages in five minutes
   sees **one** note, not six. Track the session count in `sessionStorage`
   (`karigari_coach_shown_session`), wrapped in try/catch.
3. **Never on the dashboard.** The dashboard has the Activation card; two teaching surfaces on one
   page is clutter.
4. **Never during the First Moment**, and never on the same page load that the First Moment closed.
5. **Never over content.** It is an inline card at the top of the page body, in normal flow. It
   pushes content down; it does not cover it.
6. **Never auto-dismissing.** It waits. It does not fade away while being read — this user reads
   slowly, and a disappearing message is a message they will think they imagined.
7. **Never blocking.** No overlay, no scrim, no focus steal, no disabled background.
8. If `onboarding.loading` or the API failed → **no note at all**.

## 12.3 Content — one sentence per surface

Each note is: a lucide icon, one **bold** line naming what the page is for, one line of what to do
first, a `ListenButton`, and a dismiss `X`. **Two lines maximum** (G3, G9). Copy is in §15.5.

## 12.4 Component contract

`src/components/onboarding/CoachNote.tsx`

```tsx
/** Renders nothing unless this exact route is due a note under every §12.2 rule. */
export function CoachNote({ route }: { route: CoachRouteKey })
```

- `"use client"`. Reads `useOnboarding()`; self-gating — the host page just mounts it.
- Styling: `Card tone="muted"` `pad="sm"`, `border-l-2 border-[var(--color-rust)]`, `.kg-enter`,
  `mb-6`. Quiet. It should read as a note in the margin, not a banner.
- Dismiss → optimistic hide, then PATCH `coach_seen`.

## 12.5 Wiring

Add `<CoachNote route="..." />` as the **first child inside `<Shell>`** on each of the 12 routes in
`COACH_ROUTES`. One line per page. **Change nothing else on those pages.**

Note the two edge cases:
- `/artisan/earnings` is tabbed (`?tab=buyers`). Show the note only on the default tab.
- `/artisan/workshop` is tabbed too. Same rule.

## 12.6 Verification — Phase 5

- [ ] Visit `/artisan/earnings` for the first time → one note; dismiss → reload → gone
- [ ] In the same session visit workshop, insights, schemes, learn → **no further notes**
- [ ] New session (close tab, reopen) → the next unseen page shows exactly one note
- [ ] Second device, same account → already-dismissed pages stay silent
- [ ] Dashboard → never a note
- [ ] Kill the API (return 500) → no notes anywhere, no console errors, pages fully usable
- [ ] Note pushes content down; nothing is covered; no layout shift after it is dismissed
- [ ] All four languages; `ListenButton` works
- [ ] Gates green

---

# 13. PHASE 6 — LAYER 4: THE GUIDE HUB

## 13.1 Why it exists

This is how the brief's *"let them know everything on what our platform offers"* is satisfied
**without** forcing it. Everything is available, on demand, in one flat, listenable place
(SARAL G7 flat navigation, G8 help from everywhere).

## 13.2 Placement

- A nav entry in `src/components/ui/Sidebar.tsx`, in the `shell_group_my_workshop` group, **last**:
  `{ href: "/artisan/guide", label: "nav_guide", icon: <LifeBuoy size={19} strokeWidth={1.6} /> }`.
- The page: `src/app/artisan/guide/page.tsx` + `loading.tsx` (5 lines, returns `<RouteSkeleton />` —
  every artisan route has one).

## 13.3 Structure

**A. "Where you are"** — a compact reprise of the activation state (even when the card is hidden)
plus the current skill stage from `skillStage.ts`. Real numbers only.

**B. "What Karigari does for you"** — the five differentiators from §3.2, each: icon, one bold
line, one plain line, `ListenButton`. This is the *why*, and it comes first, because an artisan who
does not believe the platform will not explore it.

**C. "Everything here"** — the 14 surfaces from §3.3, grouped in three plain-language groups, each
row: icon, name, one-line purpose, a link, a `ListenButton`. Flat list, no accordions, no nesting.

Groups (plain language, not product taxonomy):
- **Selling your work** — Marketplace · Your pieces · Orders · Influencer marketing
- **Money and proof** — Earnings (this is also where a haat sale is logged, via the existing `OfflineSale` panel) · Your buyers · Production record · QR tags · Motif register
- **Growing** — Learn · Market insights · Schemes · Workshop resources · Cluster · Design Lab

**D. "Ask a person"** — SARAL **G12**, and the part most products cannot build. Three real options,
each wired to something that exists:
1. **Ask your cluster** → posts a `ResourceRequest` via the existing
   `/api/artisan/resource-request`, scoped by the §6.5.5 cluster key. Show the **real** member
   count from `/api/artisan/cluster-members`; when it is 0, say so honestly and suggest adding an
   SHG link in the profile.
2. **Ask the voice assistant** → opens the existing `VoiceOnboarding` bubble.
3. **Replay the introduction** → the **only** way to re-run the First Moment. A button the artisan
   presses themselves is not an interruption. It resets `firstMomentStatus` to `PENDING` locally and
   opens the overlay; it does **not** rewrite the server status, so nothing else changes.

## 13.4 Rules

- No feature is described in more than **two lines**.
- No jargon (§15.2). "Escrow", "provenance", "syndication", "activation", "onboarding" never appear
  on this page in any language.
- Every row is a real, working link. A row for a feature that does not exist is a lie — and every
  feature in §3.3 was verified to exist.
- The page must be fully usable **offline** (it is static content plus already-cached state).

## 13.5 Verification — Phase 6

- [ ] `/artisan/guide` renders, is in the rail, highlights correctly when active
- [ ] Every one of the 14 links navigates to a real page
- [ ] "Where you are" matches the Activation card's numbers exactly
- [ ] "Ask your cluster" creates a real `ResourceRequest` visible on `/artisan/cluster`
- [ ] Cluster of 0 → honest message, no fake count
- [ ] "Replay the introduction" re-runs the First Moment; afterwards nothing else is re-triggered
- [ ] Every `ListenButton` speaks; all four languages
- [ ] Page works offline
- [ ] Gates green

---

# 14. PHASE 7 — LAYER 5: GRADUATION & POLISH

## 14.1 The graduation moment

When `justActivated: true` comes back **once** from the API (§9.4):

- Replace the Activation card, in place, with a single quiet panel for that one render:
  > **"You're set up."**
  > *Your work is live and buyers can check it. Here's what you've earned so far.*
  > → a button to `/artisan/earnings`
- It is dismissible and **does not return**. `activatedAt` guarantees once-only.
- No confetti, no sound, no full-screen takeover, no badge popup. The dignity of the moment is the
  point: this artisan's work is now on a public marketplace with their name on it.

## 14.2 The handoff

After graduation the dashboard shows the **existing** `RecognitionPanel` (badges + cluster
benchmark) and the skill stage — which are already built and already permanent. **Do not duplicate,
wrap, or restyle them.** The onboarding's last act is to point at them once and then be gone
forever.

Verify the seam: an activated artisan's dashboard must contain **zero** onboarding components in the
React tree. Check with the React DevTools component tree, not by eye.

## 14.3 Polish pass

- [ ] **Reduced motion**: every onboarding surface respects `prefers-reduced-motion`. Because all
      motion is inside the `kg-*` classes, this should be free — confirm it.
- [ ] **Contrast**: every text/background pair on every new surface ≥ 4.5:1. Measure with DevTools;
      do not eyeball. The muted palette has less headroom than it looks.
- [ ] **Tap targets** ≥ 44 px everywhere; ≥ 56 px for the primary action on First Moment screens.
- [ ] **Screen reader**: the First Moment overlay is `role="dialog"` `aria-modal="true"` with an
      `aria-labelledby` pointing at its title. Coach notes are `role="note"`. The activation
      progress is `role="progressbar"` with `aria-valuenow` / `aria-valuemin` / `aria-valuemax`.
- [ ] **Hydration**: zero mismatches on `/`, `/artisan/dashboard` and every coached route, in all
      four languages. This is the most likely defect in this whole build — check every page.
- [ ] **Bundle**: `FirstMoment` and the Guide page are `next/dynamic` where they are not needed on
      first paint. Confirm the dashboard's first-load JS has not grown meaningfully
      (`npm run build` prints per-route sizes — compare against the baseline you recorded).
- [ ] **The 3-minute test**, run properly: a stopwatch, a fresh account, a 360 px viewport, network
      throttled to Fast 3G, and no keyboard. Record the actual time in your report.

---

# 15. THE COPY DECK

**The English below is the final copy. Use it verbatim.** Do not "improve" it, lengthen it, add
exclamation marks, or make it friendlier. It is written to be short enough to *hear* (G10) and plain
enough to survive translation into three scripts.

## 15.1 Voice rules

| Rule | Why |
|:--|:--|
| **Second person, active, present.** "You get 40%." Not "40% will be disbursed." | G5 |
| **Under 12 words per line.** Hard cap. | G3, G9 |
| **One instruction per screen.** Never "first do X, then Y". | G9 |
| **Numbers over adjectives.** "₹89 of every ₹100" beats "a generous share". | G2 |
| **No superlatives, no hype.** No "amazing", "revolutionary", "powerful", "seamless". | §2.1 trust |
| **Never promise money that has not moved.** "You get 40% when you send it" is a rule of the system. "You will earn ₹50,000" is a lie. | §6.5.6 |
| **No exclamation marks** anywhere in onboarding copy. | dignity |
| **No emoji in copy strings.** Icons are lucide components, not characters in a sentence. | consistency |

## 15.2 Banned words — in all four languages

These never appear in any onboarding string. Where the concept is needed, use the plain phrase:

| Banned | Say instead |
|:--|:--|
| onboarding, activation, journey, workflow | *(nothing — never name the mechanism to the user)* |
| escrow | "the money is held safely until you send the piece" |
| provenance, authentication | "proof that you made it" |
| catalogue (verb), digitise | "add your piece" |
| syndication, multi-channel | "we also put it on other shops" |
| GI tag *(unless the profile is genuinely certified)* | "your village's traditional pattern" |
| credit score, CIBIL | "your work record" |
| AI-powered, ML, algorithm | "the app" |
| dashboard, portfolio, module | "home", "your pieces", "lesson" |
| unlock, level up, streak, points | *(nothing — no game language)* |
| seamless, effortless, revolutionary | *(nothing)* |

## 15.3 Written to be heard

Every string carries a `ListenButton`. So: no parentheses, no slashes, no "e.g.", no abbreviations
except ₹ and %, and no sentence that only parses visually. Read each line aloud before you commit
it. If it sounds like a form, rewrite it.

## 15.4 First Moment — verbatim English

**Screen 1**
```
onb_lang_title      Which language do you speak?
onb_mic_title       Now tap and say your name.
onb_mic_hint        We use your voice so you never have to type.
onb_mic_heard       We heard you.
onb_mic_denied      The microphone is off. You can still continue.
onb_mic_unsupported This phone cannot listen yet. You can still continue.
onb_mic_retry       Try again
onb_continue        Continue
```

**Screen 2**
```
onb_promise_amount  ₹{amount}
onb_promise_of      out of every ₹100 comes to you
onb_promise_1       Speak in your language. We write the listing.
onb_promise_2       You get 40% as soon as you send the piece.
onb_promise_3       A QR tag proves your name travels with your work.
```
`{amount}` = `Math.round(ARTISAN_TOTAL_RATE * 100)` from `escrow.ts`. **Never a literal 89.**

**Screen 3**
```
onb_start_title     Let's list your first piece.
onb_start_body      About two minutes. You only have to talk.
onb_start_cta       Start
onb_start_later     I'll do it later
```

**Shared**
```
onb_skip            Skip
onb_listen          Listen
onb_stop_listening  Stop
onb_step_of         {current} of {total}
```

## 15.5 Activation card + coach notes — verbatim English

**Activation**
```
onb_activation_title       GETTING STARTED
onb_activation_count       {done} of {total}
onb_activation_hide        Hide
onb_step_account           Account created
onb_step_account_why       You are in. Nothing more to do here.
onb_step_profile           Add your photo and UPI number
onb_step_profile_why       Your money goes straight to this UPI number.
onb_step_craft             List your first craft
onb_step_craft_why         Speak about one piece. We write the rest.
onb_step_patch             Attach the QR tag
onb_step_patch_why         Print the tag, put it on the piece, photograph it again.
onb_step_listed            Go live on the marketplace
onb_step_listed_why        Buyers can now find and buy this piece.
onb_activation_done_title  You're set up.
onb_activation_done_body   Your work is live and buyers can check it.
onb_activation_done_cta    See your earnings
```

**Coach notes** — `onb_coach_<route>_title` / `onb_coach_<route>_body`:

| route | title | body |
|:--|:--|:--|
| `market` | Your pieces live here | Finish drafts, attach tags, and see what is listed. |
| `workshop` | Material, tools and help | Find suppliers, get a tool repaired, or ask your cluster. |
| `insights` | What buyers want near you | See which crafts people are asking for this month. |
| `schemes` | Government help you qualify for | We check the rules for you and help fill the form. |
| `learn` | Short lessons for your craft | A few minutes each. Works without internet. |
| `orders` | Orders buyers placed with you | Update the buyer as you work, then send the piece. |
| `cluster` | Your group | Borrow material, lend material, ask for help. |
| `earnings` | Every rupee you have received | Money from the app, from demands, and from your own sales. |
| `motifs` | Your village's patterns | Register a pattern so brands must ask before using it. |
| `design-lab` | Try a pattern before you cut cloth | Describe an idea and change it on screen. |
| `marketing` | Let a creator promote your work | Only if you want to. They take 5% of that sale. |
| `news` | News about your trade | Prices, schemes and events that affect your craft. |

**Landing page**
```
landing_artisan_caption    Speak in your language. We build the listing. No typing.
landing_lang_offer         See this in {language}
landing_lang_switch        {language}
landing_lang_dismiss       Close
```

**CaptureModal Step 4** (replacing the three hardcoded strings)
```
capture_success_title      Saved.
capture_success_body       Your piece is in your portfolio.
capture_success_back       Back to home
capture_first_piece_next   Next: attach the QR tag so buyers can check it is really yours.
capture_first_piece_cta    Attach the tag
```

## 15.6 Translation requirements

For **every** key: real Hindi (Devanagari), Odia (Odia script) and Telugu (Telugu script).

- Translate the **meaning**, not the words. "Getting started" is not "प्रारंभ हो रहा है".
- Keep the ≤12-word cap in the target language too. Devanagari and Odia run longer than English —
  if a translation will not fit two lines at 360 px, **shorten the English first** and retranslate,
  rather than letting it overflow.
- Keep `₹`, `%` and digits as-is. `AutoTranslator.tsx` handles numeral transliteration at runtime;
  do not pre-convert digits in the dictionaries.
- Preserve every `{placeholder}` exactly, including case. A dropped placeholder renders a literal
  brace to the artisan.
- Use the register a field officer would use speaking to an artisan — respectful, plain, not
  bureaucratic Hindi and not English transliterated into Devanagari.
- Where a term genuinely has no local equivalent in trade use (QR, UPI), transliterate it into the
  target script rather than translating it into something nobody says.

---

# 16. i18n KEY REGISTRY

Every key below goes in **all four** of `src/lib/i18n/en.ts`, `hi.ts`, `or.ts`, `te.ts`.
Count them at the end of each phase and confirm the four files gained the same number of keys.

**First Moment (18):** `onb_lang_title` `onb_mic_title` `onb_mic_hint` `onb_mic_heard`
`onb_mic_denied` `onb_mic_unsupported` `onb_mic_retry` `onb_continue` `onb_promise_amount`
`onb_promise_of` `onb_promise_1` `onb_promise_2` `onb_promise_3` `onb_start_title`
`onb_start_body` `onb_start_cta` `onb_start_later` `onb_step_of`

**Shared (3):** `onb_skip` `onb_listen` `onb_stop_listening`

**Activation (16):** `onb_activation_title` `onb_activation_count` `onb_activation_hide`
`onb_step_account` `onb_step_account_why` `onb_step_profile` `onb_step_profile_why`
`onb_step_craft` `onb_step_craft_why` `onb_step_patch` `onb_step_patch_why` `onb_step_listed`
`onb_step_listed_why` `onb_activation_done_title` `onb_activation_done_body`
`onb_activation_done_cta`

**Coach notes (24):** `onb_coach_<route>_title` and `onb_coach_<route>_body` for each of the 12
routes in `COACH_ROUTES`

**Landing (4):** `landing_artisan_caption` `landing_lang_offer` `landing_lang_switch`
`landing_lang_dismiss`

**Capture Step 4 (5):** `capture_success_title` `capture_success_body` `capture_success_back`
`capture_first_piece_next` `capture_first_piece_cta`

**Guide (~30):** `nav_guide` `guide_title` `guide_lede` `guide_where_you_are`
`guide_what_we_do` `guide_everything` `guide_group_selling` `guide_group_money`
`guide_group_growing` `guide_ask_person` `guide_ask_cluster` `guide_ask_cluster_count`
`guide_ask_cluster_none` `guide_ask_cluster_hint` `guide_ask_assistant` `guide_replay`
`guide_diff_1_title` … `guide_diff_5_body` (the five differentiators, title + body), plus one
`guide_surface_<route>` line per surface.

**Total: roughly 100 keys × 4 languages.**

---

# 17. THE ANTI-ANNOYANCE CONTRACT

The brief says *"not annoying"*. That is a design requirement with testable limits, not a vibe.
These are the limits.

## 17.1 Forbidden patterns — do not implement any of these

- ❌ **Confirm-shaming.** The skip option says "Skip". It does not say "No thanks, I don't want more
  money."
- ❌ **A skip that is hidden, greyed, delayed, tiny, or below the fold.**
- ❌ **Anything modal after the First Moment.** Every later layer is inline.
- ❌ **Auto-playing audio.** The `ListenButton` is always a deliberate tap.
- ❌ **Auto-switching the language.**
- ❌ **Re-showing anything the artisan dismissed.** Ever. On any device.
- ❌ **Blocking a feature until onboarding is done.** Nothing is gated.
- ❌ **A red or alarming colour** anywhere in onboarding. Nothing here is an error.
- ❌ **A badge, dot, or counter** on the Guide nav entry. It is a door, not a notification.
- ❌ **Nagging on a schedule.** No "come back and finish setup" emails, SMS, or notifications. The
  Activation card sits quietly until it is satisfied or hidden. (The existing `SupplyNudgeCard`
  already owns the one legitimate re-engagement nudge in this product.)
- ❌ **Progress that is not real.** No step ticks because something was viewed or dismissed.

## 17.2 Hard budgets

| Budget | Limit |
|:--|:--|
| First Moment screens | **3** |
| First Moment total time, unhesitating | **≤ 75 seconds** |
| Signup → fair-wage price reveal | **≤ 3 minutes** |
| Body copy per onboarding screen | **≤ 2 lines** |
| Words per line | **≤ 12** |
| Instructions per screen | **1** |
| Coach notes per session | **1** |
| Coach notes per page, lifetime | **1** |
| Blocking surfaces after the First Moment | **0** |
| New npm dependencies | **0** |

## 17.3 Cultural fit (SARAL G11)

- Icons are objects the artisan handles: a microphone, a rupee, a tag, a camera, a person. **No**
  rockets, lightbulbs, trophies, graduation caps, briefcases, or handshakes.
- Colour stays inside the heritage palette (§6.4). No green "success" splash that is brighter than
  anything else in the product.
- No metaphors that require office or internet culture ("dashboard", "pipeline", "onboarding").
- The person in any illustration or avatar placeholder is not a stock Western figure. Prefer no
  figure at all over a wrong one.

---

# 18. ACCESSIBILITY & LOW-LITERACY CHECKLIST

Run this against every new surface before closing a phase.

- [ ] Every screen readable **without reading**: icon + number + spoken audio carry the meaning (G1)
- [ ] Every interactive element has a visible label **or** an `aria-label`
- [ ] Tap targets ≥ 44 px; primary actions ≥ 56 px
- [ ] Contrast ≥ 4.5:1 for every text/background pair, measured in DevTools
- [ ] Full keyboard operation; visible focus rings; logical tab order
- [ ] The First Moment overlay traps focus, closes on `Esc`, restores focus on close
- [ ] `role="dialog"` + `aria-modal` + `aria-labelledby` on the overlay; `role="note"` on coach
      notes; `role="progressbar"` with `aria-valuenow`/`min`/`max` on the activation bar
- [ ] `aria-live="polite"` on anything that changes without a click (a step ticking over)
- [ ] `prefers-reduced-motion: reduce` honoured everywhere
- [ ] Works at 360 px with no horizontal scroll and no clipped text in **all four** languages —
      Devanagari and Odia are the ones that overflow, so test those specifically
- [ ] Works entirely offline
- [ ] Works with `speechSynthesis` absent (Listen buttons vanish, nothing breaks)
- [ ] Works with the microphone denied
- [ ] Works with `localStorage` and `sessionStorage` throwing (private mode)

---

# 19. FINAL VERIFICATION — THE WHOLE SYSTEM

## 19.1 The two scripted walkthroughs

**Walkthrough A — the artisan, first session.** Fresh account, 360 px viewport, Fast 3G throttling,
Odia selected, **stopwatch running, keyboard physically unavailable.**

1. `/` → the caption is visible; the language bar offers Odia → accept
2. "Join as an Artisan" → register → land on the dashboard
3. First Moment: pick Odia, say a name, see the ₹ promise, tap Start
4. CaptureModal opens → speak one piece → photos → **Step 3: the price and the fair-wage floor**
5. **Record the elapsed time.** It must be under 3 minutes. If it is not, report exactly where the
   time went — do not quietly cut a screen to make the number.
6. Finish the capture → Step 4 shows the first-piece line → dashboard shows 3 of 5

**Walkthrough B — the buyer.** Clean profile, English locale.

1. `/` → no bar, no modal, no role question, nothing blocking
2. `/marketplace` → a product → scan or open a `/verify/[patchId]` page
3. **Confirm not one onboarding element appeared at any point.**

## 19.2 System-wide checks

- [ ] `git diff --stat` contains only files this document names
- [ ] All four dictionaries gained the **same** number of keys — diff the key lists
- [ ] Grep for hardcoded English inside the new components: **zero** hits outside the `en.ts`
      dictionary
- [ ] Grep the new components for raw hex colours: **zero** hits
- [ ] Grep for `useSearchParams`: **zero** new hits
- [ ] Grep the four dictionaries for every banned word in §15.2: zero hits in new keys
- [ ] `npm run build` per-route sizes: the dashboard's first-load JS has not grown meaningfully
- [ ] `onboarding.test.mjs` passes; `npm run test:all` passes
- [ ] Zero console warnings or errors on every touched page, in every language
- [ ] An activated artisan's dashboard contains **zero** onboarding components in the React tree

## 19.3 What to report at the end

1. Files created and files modified, with line counts.
2. The measured Walkthrough A time, and where the seconds went.
3. Key counts per dictionary, and confirmation they match.
4. Screenshots: landing (en + or), the three First Moment screens, the Activation card at 1/5 and
   4/5, one coach note, the Guide hub, and the graduation panel — at 360 px and 1440 px.
5. Measured contrast ratios for every new text/background pair.
6. Anything you found in the existing code that is wrong but that you **did not touch** — named
   only, for the human to decide.
7. Any place where you had to deviate from this document, and exactly why.

---

# 20. THE DO-NOT LIST — READ THIS LAST, BEFORE YOU START

1. **Do not add an npm dependency.** No tour library. No animation library. No i18n library.
2. **Do not modify** `AssistedOnboardingModal.tsx`, `NotificationTicker.tsx`, `SupplyNudgeCard.tsx`,
   `RecognitionPanel.tsx`, `badges.ts`, `skillStage.ts`, `escrow.ts`, or `pricing.ts`.
3. **Do not change** `VoiceOnboarding.tsx`'s behaviour. Extract `speakText` and consume it —
   nothing else.
4. **Do not change** any CaptureModal logic. Only the Step 4 strings and the one first-piece line.
5. **Do not add a token** to `globals.css`. Every colour you need exists.
6. **Do not use `useSearchParams`.** Read `window.location.search` in a deferred effect.
7. **Do not store activation state in the database.** It is derived (§7.1).
8. **Do not use `localStorage` for anything that must be true once per person.** Only the language
   offer dismissal and the per-session coach budget are device-local, and both are stated in this
   document. Everything else is server-side, because of §2.1's shared-phone reality.
9. **Do not build buyer onboarding.** Buyers have no accounts.
10. **Do not gate any feature** behind onboarding completion.
11. **Do not fabricate a number, a name, a scheme amount, or a translation.** If you do not have it,
    go and find it in the repo, or say you could not.
12. **Do not skip the 3-minute stopwatch test.** It is the only measurement that tells you whether
    this system does its job.

---

*End of prompt. Seven phases, five layers, one aha moment. Build Phase 1 now, then stop and report.*


