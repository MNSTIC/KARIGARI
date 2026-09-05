# KARIGARI — The Whole Codebase, Explained Like You're 10

> A friendly tour of every important part of the KARIGARI app: what it is, what each
> file does, and how it all fits together. No computer-science degree required.
> If you can understand a shop, a notebook, and a robot helper, you can understand this app.

---

## How to read this guide — the "secret decoder" for the words we use

Programmers use scary words for simple things. Here is our cheat-sheet. Whenever
you see one of these words later, just think of the everyday thing next to it.

| Scary word | Think of it as… |
|---|---|
| **App / Frontend** | The **screens** you tap and look at (like a shop window) |
| **Backend / API** | The **waiters** who run to the kitchen to fetch or save things |
| **Database** | A **giant notebook** where the app writes down everything it must remember |
| **Table** (in the database) | One **page** in that notebook, e.g. the "people" page or the "products" page |
| **Prisma** | The **translator** between the app and the notebook |
| **Component** | A **LEGO block** for building screens (a button, a card, a pop-up) |
| **Page** | A whole **screen** built out of LEGO blocks |
| **Library** | A **toolbox** someone else already built that we borrow |
| **AI model (Gemini/Groq)** | A **smart robot helper** we ask questions to |
| **JWT cookie** | A **wristband** that proves who you are so you don't log in on every screen |
| **Route** | One **job** a waiter knows how to do (e.g. "save this photo") |

That's the whole decoder. Keep it handy. 🙂

---

## 1. What is KARIGARI? (the big idea)

Imagine a **village artisan** — someone who weaves beautiful sarees or makes clay pots by hand.
They are amazing at making things, but they have three big problems:

1. **Middlemen cheat them.** A trader buys their saree cheap and sells it for a lot, keeping the profit.
2. **Selling online is hard.** They may not read English, may not type well, and may have bad internet.
3. **Fakes copy them.** Cheap machine-made copies pretend to be real handloom, and steal their customers.

**KARIGARI is like a super-honest helper that fixes all three.** It:

- Lets an artisan **talk** to the app in their own language instead of typing.
- **Cleans up their photos** and **writes their product description** for them, using a robot helper.
- Works out a **fair price** so nobody underpays them.
- Gives them **money in advance** (before the item even sells).
- Puts a **special QR sticker** on each item so a buyer can scan it and know it's 100% real.
- Even works **without internet** and can reach artisans by **SMS** or a **phone call**.

So KARIGARI is not just a shopping app. It's a **"trust bridge"**: it connects the maker
directly to the buyer, proves the item is real, and makes sure the maker gets paid fairly.

> The app's own README says it best: *"Fair pay. Proven craft. Every time."*

---

## 2. The tech stack (the tools we cook with)

Every app is built out of tools. Here are ours, and what each one is *for*, in plain words.
The full list lives in **`package.json`** (the app's shopping list of tools).

| Tool | What it really is | Why we use it |
|---|---|---|
| **Next.js** | The **kitchen + dining room in one building** | Runs both the screens (frontend) and the waiters (backend) together |
| **React** | The **screen builder** | Turns our LEGO blocks into what you see and tap |
| **TypeScript** | **JavaScript with a spell-checker** | Catches silly mistakes *before* they reach users |
| **Tailwind CSS** | A **box of paint and rulers** | Colors, spacing, and layout for every screen |
| **PostgreSQL** | The **giant notebook** (the database itself) | Where all the real data is stored |
| **Prisma** | The **translator** for the notebook | Lets our code read/write the notebook safely |
| **Google Gemini** | A **smart robot** that can see *and* read | Checks photos are real, understands voice, writes descriptions |
| **Groq + Whisper** | A **super-fast robot ear** | Turns the artisan's spoken words into text, very quickly |
| **@imgly/background-removal** | A **magic eraser** | Removes the messy background from product photos, right on the phone |
| **bcryptjs** | A **password scrambler** | Stores passwords scrambled so nobody can read them |
| **jsonwebtoken (JWT)** | A **wristband printer** | Proves who is logged in |
| **Razorpay** | A **cash register** | Collects payment from buyers |
| **Twilio** | A **phone + SMS operator** | Sends text messages and runs the toll-free phone line |
| **next-pwa + Workbox** | An **"install me" + offline kit** | Makes the app installable and usable with no internet |
| **idb (IndexedDB)** | A **notebook that lives on your phone** | Saves your work offline until internet comes back |
| **Leaflet** | A **map** | Shows where craft clusters and demand are |
| **Recharts** | A **graph drawer** | Draws the earnings and analytics charts |
| **react-qr-code / qrcode / jsqr** | A **QR sticker maker + scanner** | Creates and reads the anti-fake QR tags |
| **lucide-react** | A **sticker sheet of icons** | The little pictures on buttons |

**One golden rule the whole app follows:** every robot helper (Gemini, Groq, Razorpay,
Twilio) is **optional**. If its key/password isn't set up, the app **doesn't crash** — it
politely falls back to a simple backup answer. More on this in Section 12.

---

## 3. The map of the project folder

Here's the building, floor by floor. You mostly care about the **`src`** floor — that's
where all the real code lives.

```
KARIGARI/
├── package.json          ← the shopping list of tools
├── next.config.ts        ← settings for the whole app (incl. offline mode)
├── prisma/
│   ├── schema.prisma     ← the DESIGN of the notebook (all tables & fields)
│   └── seed.ts           ← fills the notebook with fake demo data to show off
├── public/               ← pictures, icons, logos, sample product photos
│   ├── icons/            ← app icons and platform logos (Amazon, Flipkart…)
│   └── seed/             ← demo craft photos (madhubani, pashmina, dhokra…)
├── scripts/              ← little helper programs run by hand (cleanups, checks)
├── docs/                 ← extra documents (flowcharts, notes)
└── src/                  ← ★ THE REAL APP ★
    ├── app/              ← the SCREENS + the WAITERS
    │   ├── page.tsx           ← the public home page
    │   ├── layout.tsx         ← the frame wrapped around every screen
    │   ├── login/ register/   ← sign-in screens
    │   ├── artisan/           ← all the maker's screens (dashboard, earnings…)
    │   ├── admin/             ← the government officer screens
    │   ├── marketplace/       ← the public shop
    │   ├── buyer/             ← the bulk-buyer screens
    │   ├── verify/            ← the "scan the QR to check it's real" screen
    │   └── api/               ← ★ ALL 78 WAITERS (backend jobs) ★
    ├── components/       ← the LEGO blocks (buttons, pop-ups, cards)
    │   └── ui/                ← the smallest, most reused blocks
    ├── lib/              ← ★ THE BRAINS (rules, math, robot-helpers) ★
    │   └── i18n/              ← the dictionaries for 4 languages
    └── types/            ← extra "shape" definitions for TypeScript
```

**The three most important folders to understand are:**

- **`src/lib`** — the **brains**. All the clever rules and robot-helper code.
- **`src/app/api`** — the **waiters**. 78 little jobs that fetch or save data.
- **`src/app`** (the rest) — the **screens** people actually see.

We'll tour each one below.

---

## 4. The database — the app's giant notebook

The notebook's design lives in **`prisma/schema.prisma`**. It has **13 pages (tables)**.
Here's what each page remembers, in one line each.

| Page (table) | What it remembers | Fun way to think about it |
|---|---|---|
| **User** | Everyone's login: name, email, scrambled password, role (ARTISAN or ADMIN) | The **member list** |
| **ArtisanProfile** | Extra facts about a maker: craft type, village, UPI id, health score, gender, cluster | The maker's **ID card** |
| **CraftItem** | One handmade product: photos, price, status, QR patch, who bought it | The **product tag** on each item (the busiest page by far!) |
| **AuditLog** | Every important event, forever | The app's **diary that can't be erased** |
| **SchemeApplication** | Which government schemes an artisan applied to | A **form tracker** |
| **Demand** | A bulk order a buyer wants ("I need 50 sarees") | A **wish posted on a board** |
| **ArtisanOrder** | A maker saying "I'll make those 50 sarees" | A **promise to fill a wish** |
| **OrderLog** | Progress notes on that promise ("half done, here's a photo") | **Status updates** |
| **Review** | A buyer's star rating and comment | **Feedback stickers** |
| **ResourceRequest** | "I need wool, can a neighbour lend some?" | A **help-a-neighbour board** |
| **Notification** | Alerts for a maker (a demand match, a festival) | The **bell messages** |
| **Creator** | An influencer who promotes crafts for a small cut | A **shop's promoter** |
| **AffiliateClick** | A record that someone clicked a promoter's link | A **counter** on the promoter's poster |

### The most important page: `CraftItem` and its "status"

A `CraftItem` is one product, and the single most important thing on it is its **status** —
the stage of its life. It moves through stages like a caterpillar becoming a butterfly:

```
PENDING_VERIFICATION   → a maker just uploaded it; waiting for an officer to check
   ↓
VERIFIED               → officer approved it and printed a unique QR tag (patchId)
   ↓
TAG_ATTACHED           → maker stuck the QR on the real item and re-photographed it
   ↓
ADVANCE_PAID  (or SOLD_MIDDLEMAN / LISTED_AUCTION)  → maker chose how to sell
   ↓
SOLD_FINAL             → a buyer scanned the QR, AI confirmed it's real, sale done
   ↓
PAYOUT_COMPLETED       → the money was settled

⚠ Side path: FLAGGED → APPLIED_FOR_REVIEW
   (if a buyer's scan fails, the item is flagged as maybe-fake, and the maker can appeal)
```

**Every single time** an item changes status, the app writes a line in the **AuditLog** diary.
That's how the government officer can later prove exactly what happened to every item —
nothing can be secretly changed.

---

## 5. The three kinds of people, and the story of one saree

There are only **two real login roles** in the code (`ADMIN` and `ARTISAN`), but **three
kinds of people** use the app:

- **The Artisan (maker)** — logs in, uploads crafts, gets paid.
- **The Admin (government helper)** — one login, but **two views**:
  - **Facilitator view** — the field worker who visits villages, checks items, prints QR tags.
  - **Nodal view** — the big-boss officer who watches overall numbers and the diary (but never sees private info).
- **The Buyer** — does **not** even need an account. They just scan a QR or shop the public store.

### 🧵 Follow one saree from start to finish

This is the whole app in one story. Each step names the file that does the work.

1. **Lakshmi speaks to the app.** She taps the mic and says, in Odia, *"I wove a Sambalpuri saree, it took 14 days, silk thread cost 4000 rupees."*
   → Her voice becomes text via **`src/lib/voiceParse.ts`** (using the Groq/Gemini robots).

2. **The app cleans her photo and prices it.** The magic eraser (**`src/lib/imageEnhance.ts`**) removes the messy background. The price brain (**`src/lib/pricing.ts`**) works out a **fair wage floor** and a market price range.

3. **She saves it.** The waiter **`src/app/api/items/capture/route.ts`** saves a new `CraftItem` with status `PENDING_VERIFICATION` and writes a diary line.

4. **A field officer approves it.** In the Facilitator view, they approve it via **`src/app/api/admin/verify-batch/route.ts`**, which prints a **unique QR tag** and changes status to `VERIFIED`.

5. **She sticks the QR on the real saree** and re-photographs it. The AI checks the new photo matches the original, so nobody can swap tags.

6. **She picks how to sell + gets an advance.** Via **`src/app/api/disbursement/apply/route.ts`**, if she chooses "Karigari Advance", she is **paid the fair-wage floor immediately** — before it even sells.

7. **A buyer scans the QR.** On the `/verify/[patchId]` screen they take a live photo. The waiter **`src/app/api/verify-authenticity/route.ts`** asks Gemini to compare it with the original. If it matches (score ≥ 75), status becomes `SOLD_FINAL`. If it keeps failing, it's `FLAGGED` as maybe-fake.

8. **Money is split fairly.** The escrow rules (**`src/lib/escrow.ts`**) make sure the maker keeps about **89 of every 100 rupees**, with zero middleman.

9. **The officer sees it all in the diary.** Every step above wrote an `AuditLog` line, so the Nodal officer can audit the whole journey.

That's KARIGARI. Everything else is a helper around this story.

---

## 6. The big features, and exactly where they live

The hackathon problem statement asked for three "AI-driven" features. KARIGARI built those
**and a lot more**. Here's each feature, what it does in kid-words, and the files that do it.

### 6.1 🎙️ Talk instead of type (Voice Auto-Cataloguer)
**What it does:** The maker speaks in Odia/Hindi/Telugu/English. The app writes down their
words, translates them, works out what the product is, how long it took, and the material
cost — and even asks a follow-up question if something's missing.
**Where:** the brain is **`src/lib/voiceParse.ts`**; the waiters are
**`src/app/api/items/voice-parse/route.ts`** and (for phone calls) **`src/app/api/ivr/collect-item/route.ts`**.
**How:** the audio goes to **Groq Whisper** (fast) to become text; if the language isn't
supported (Odia isn't!), it falls back to **Gemini**, which does handle Odia. Then a second
robot call turns the sentence into neat fields. If both robots are down, the maker's exact
spoken words are still saved.

### 6.2 📸 Make photos look professional (AI Image Studio)
**What it does:** Turns a messy phone photo (bad light, cluttered room) into a clean
catalogue-style photo on a white background.
**Where:** **`src/lib/imageEnhance.ts`**.
**How:** a machine-learning "magic eraser" (`@imgly/background-removal`) runs **on the
phone itself** (no internet needed, private), cuts out the product, adds a soft shadow so
it doesn't look like a sticker, fixes the color/brightness, and sharpens it. If the phone
is too weak, it just does the light-fix and skips the cut-out — it never gets stuck.

### 6.3 💰 A fair price, both ways (Dynamic Pricing + anti-cheat guard)
**What it does:** Suggests a fair price. It protects the maker two ways: it warns if the
price is **too low** (a middleman squeezing them) *or* **too high** (which would gouge the buyer).
**Where:** **`src/lib/pricing.ts`** (the math) and **`src/lib/benchmarkData.ts`** (sanity limits).
**How:** `fair wage floor = (days × daily wage) + material cost + 10% overhead`. The market
price is 1.2×–1.6× that floor, with a festival bump on silk. If a maker types a price far
outside the fair range, the item is **flagged for a human to check** before it goes live.
`benchmarkData.ts` also rejects impossible claims (e.g. "a saree took 200 days").

### 6.4 🔒 Prove it's real (Dual-Lock QR + AI Vision)
**What it does:** Stops fakes. Each real item gets a physical QR sticker; when a buyer scans
it, they must take a **live photo**, and the AI checks it matches the original.
**Where:** QR minted in **`src/app/api/admin/verify-batch/route.ts`**; the buyer's check is
**`src/app/api/verify-authenticity/route.ts`**; the camera block is **`src/components/VerificationCamera.tsx`**.
**How:** Gemini compares the two photos and returns a similarity score. ≥ 75 = real → sold.
There's a **5-minute grace window** and up to 10 tries (so a bad angle doesn't fail an honest
buyer). If it still fails, the item is `FLAGGED` and the maker's "health score" drops 15.
A real match on a flagged item restores their score.

### 6.5 🤝 Fair money with no middleman (Escrow + Advance + Payments)
**What it does:** Of every ₹100 a buyer pays, about **₹89 goes straight to the maker**, in
two parts (40% on dispatch, ~49% on delivery). A promoter, if any, gets ₹5 from the
*platform's* share — never from the maker's.
**Where:** the split rules are **`src/lib/escrow.ts`**; the cash register is **`src/lib/razorpay.ts`**;
the waiters are **`src/app/api/payments/create-order`**, **`verify-payment`**, and **`settle-escrow`**.
**How (honest note):** Razorpay only *collects* money into the platform account, so the
final pay-out to the maker's UPI is recorded as a **"programmatic settlement"** — the ledger
and diary are 100% real, but the actual bank transfer is simulated in this prototype. The
code is very careful to never *pretend* a simulated payment was a real bank credit. (Also,
for the demo, the card is only charged **₹1**, while all the displayed prices stay real.)

### 6.6 📶 Works with no internet (Offline-First PWA)
**What it does:** The app can be **installed** like a real app and keeps working with zero
internet. A maker can catalogue items offline; they upload themselves when signal returns.
**Where:** offline settings in **`next.config.ts`**; the on-phone queue in
**`src/lib/offlineQueue.ts`**; the auto-uploader in **`src/lib/offlineSync.ts`**; wired in by
**`src/components/OfflineSyncProvider.tsx`**.
**How:** a "service worker" caches the app so it opens offline. New captures are saved in the
phone's own IndexedDB notebook and **replayed** to the server automatically when the `online`
event fires. A row is only deleted after the server confirms it saved — so nothing is ever lost.

### 6.7 📱 Reach people with no smartphone (SMS + Toll-Free Phone Line)
**What it does:** Even makers with a basic phone can take part. They get an **SMS** when a
buyer wants their craft, and reply "1" to accept. Or they can **call a toll-free number** and
just talk.
**Where:** SMS in **`src/lib/sms.ts`** + **`src/app/api/sms/inbound/route.ts`**; the phone
line ("IVR") in **`src/lib/twilioIvr.ts`** + the **`src/app/api/ivr/`** waiters.
**How:** Twilio sends the SMS and runs the phone menu. A phone call's audio goes through the
*same* `voiceParse.ts` brain as the app, so the phone and the app always understand a sentence
the same way. Security: phone webhooks are signature-checked so nobody can fake a call.

### 6.8 🏛️ Government schemes made easy (Eligibility Engine)
**What it does:** Automatically tells a maker which government help-schemes they qualify for
(PM Vishwakarma, NSFDC, GeM seller, etc.) and helps them apply.
**Where:** **`src/lib/schemes.ts`** (the rules) + **`src/lib/artisanEligibility.ts`** (the glue)
+ the **`src/app/api/artisan/schemes/`** waiters + the **`/artisan/schemes`** screen.
**How:** pure, readable rules — **no AI black box** — so the answer is auditable and never
wrong-in-a-mystery-way. If a rule can't be checked from stored data, the maker ticks a
self-declaration box instead of it being silently auto-passed.

### 6.9 🛒 One listing, many shops (Marketplace Syndication / ONDC / GeM)
**What it does:** The maker's single listing can be broadcast to many places (Paytm & Magicpin
via ONDC, the government's GeM, Amazon Karigar) **without opening any seller accounts**.
**Where:** **`src/lib/syndication.ts`**, **`src/lib/ondcCatalog.ts`**, **`src/lib/gemCatalog.ts`**,
**`src/lib/gemGuidance.ts`**; waiters in **`src/app/api/ondc/catalog`** and **`src/app/api/artisan/syndicate`**.
**How (honest note):** it generates the correct data files for each platform and shows a price
comparison (proving "buy direct = cheapest"). It marks items broadcast-ready; it doesn't
literally push to those live marketplaces in the prototype — and the code says so plainly.

### 6.10 📣 Influencers who help (Creator Affiliate Program)
**What it does:** Local influencers can promote crafts with a special link and earn a **5%
commission** (paid from the platform's cut, never the maker's).
**Where:** **`src/lib/creators.ts`**, **`src/lib/affiliateRef.ts`**; the **`src/app/api/creators/`**
waiters; the **`/creators`** screen.
**How:** a link carries `?ref=handle`. When a buyer arrives through it and buys, the sale is
tagged to that creator and their commission is settled on delivery.

### 6.11 👥 Neighbours helping neighbours (Clusters, Demand Board, Bulk Orders)
**What it does:** Individual weavers can team up ("cluster pooling") to fill a big order
together, post/borrow materials, and respond to bulk buyer demands.
**Where:** **`src/lib/notifications.ts`** (matching demands to makers), the **Demand**,
**ArtisanOrder**, **ResourceRequest** tables; waiters under **`src/app/api/demand/`**,
**`src/app/api/artisan/`**, and **`src/app/api/buyer/orders/`**; screens like **`/artisan/cluster`**.
**How:** when a buyer posts a demand, the app scores which makers match best (a "Sambalpuri"
weaver ranks above a generic "silk" weaver) and alerts them in-app + by SMS.

---

## 7. The BRAINS — a tour of `src/lib`

`src/lib` is where the clever thinking lives, kept separate from the screens so it can be
reused everywhere and tested easily. Here are the **important brain files** in depth, then
the smaller helpers grouped together.

### The big brains (read these to understand the app)

- **`prisma.ts`** — Opens the one connection to the notebook (database). Everything that
  reads/writes data goes through this. It reuses a single connection so the app stays fast.
- **`pricing.ts`** — The **fair-price engine**. Calculates the fair-wage floor and market
  band, and decides if a price is suspiciously low or high. One source of truth so every
  screen quotes the same number.
- **`escrow.ts`** — The **money-splitting rules**. Defines exactly how ₹100 is divided
  (₹40 advance + ~₹49 final to the maker, small fees to the platform, ₹5 to a creator if any).
- **`gemini.ts`** — The **connection to Google's smart robot**. Cleverly tries several AI
  models in order, and if one is busy (503) or missing, it moves to the next. It clearly tells
  the difference between "robot is busy, try again" and "the password is wrong".
- **`groq.ts`** — The **connection to the fast robot** (used for quick text + audio). Also
  walks a list of models until one answers, and reads the API key under two possible names so
  an old setup keeps working.
- **`voiceParse.ts`** — The **speech→product brain**. Turns spoken words (in 4 languages) into
  neat product fields, with follow-up questions for anything missing. Used by both the app and
  the phone line, so they never disagree.
- **`imageEnhance.ts`** — The **photo magic eraser + beautifier**, running on the phone.
- **`schemes.ts`** — The **government-scheme rulebook** (pure rules, no AI).
- **`syndication.ts`** — The rules for broadcasting one listing to many marketplaces, plus the
  "buy direct is cheapest" price comparison.
- **`notifications.ts`** — Matches buyer demands to the right makers and creates their alerts
  (and triggers the SMS).
- **`offlineQueue.ts`** + **`offlineSync.ts`** — The **offline safety net**: save captures on
  the phone, then auto-upload them when internet returns.
- **`sms.ts`** + **`twilioIvr.ts`** — The **SMS sender** and the **toll-free phone-line plumbing**.
- **`razorpay.ts`** + **`razorpayPayout.ts`** + **`razorpayMode.ts`** — The **payment**
  helpers: collecting money, the (simulated) pay-out, and telling test-mode from live-mode.
- **`auditLogger.ts`** — The tiny helper that writes a line in the **unerasable diary**
  (AuditLog) every time something important happens.
- **`artisanAuth.ts`** — The **bouncer** for maker-only waiters: checks the wristband (JWT)
  and that the role is ARTISAN.

### The smaller helpers (grouped, one line each)

**Identity & auth helpers**
`authClient.ts` (log out from anywhere), `artisanIdentity.ts` (load the signed-in maker's
name/photo once per session), `buyerIdentity.ts` (remember a buyer by name, since buyers have
no account), `gender.ts` (tidy up gender for the women-only GeM scheme).

**Money & selling helpers**
`benchmarkData.ts` (reject impossible price claims), `orderStage.ts` (work out a buyer-facing
"where's my order" ladder), `marketplace.ts` (the exact shape the public shop expects),
`creators.ts` + `affiliateRef.ts` (influencer handles and their `?ref=` links).

**Export & government helpers**
`gemCatalog.ts` + `gemGuidance.ts` (GeM catalogue file + step-by-step how-to),
`ondcCatalog.ts` (the ONDC "Beckn" data format), `giLabels.ts` (flags protected craft names
like "Muga silk"), `artisanEligibility.ts` (glue between the DB and the scheme rules).

**Content & language helpers**
`translations.ts` + the **`i18n/`** folder (`en`, `hi`, `or`, `te` dictionaries — only English
is bundled by default to keep the app light), `festivals.ts` (a calendar of festivals to nudge
sellers before demand spikes), `suppliers.ts` (a reliable raw-material supplier directory),
`voiceRules.ts` (simple backup answers for the voice assistant when the robot is down),
`indiaGeo.ts` (city coordinates for the map).

**Small utilities**
`utils.ts` (a tiny helper to combine CSS class names), `urlTab.ts` (keep the highlighted tab in
sync with the web address), `offlineQueueStore.ts` (one shared "am I online / how many items
waiting" reading for the whole app).

---

## 8. The WAITERS — a tour of `src/app/api` (78 jobs)

Every file named `route.ts` under `src/app/api` is **one job a waiter can do**. The folder
path *is* the web address. For example `src/app/api/items/capture/route.ts` answers requests
to `/api/items/capture`. Almost every protected waiter starts the same way: **check the
wristband (JWT), check the role, then do the job, then write a diary line.**

Here they are, grouped by who uses them:

**🔑 Login (`api/auth/…`)**
`register` (make an account + print a wristband), `login` (check password + print wristband),
`logout` (tear off the wristband), `me` (who am I?).

**🧵 Making & listing items (`api/items/…`)**
`capture` (save a new craft + price it), `voice-parse` (speech → fields),
`vision-verify` (is this photo a real handmade craft?), `smart-draft` / `complete-draft`
(AI helps write the listing), `price-estimate` / `price-market` / `price-research`
(pricing help), `catalog` / `market` (the public shop feed), `attach-verify` (match the
photo-with-QR to the original), `capture` … plus `[id]` (read/update one item) and its
`thumbnail`.

**👩‍🎨 The maker's own area (`api/artisan/…`)**
`dashboard` (all their numbers), `profile` / `profile-lite` (edit their ID card),
`orders` (their bulk-order promises), `schemes` + `schemes/apply` (government help),
`insights` (market tips), `notifications` (their bell), `cluster-members` (their team),
`syndicate` (broadcast a listing), `gem-export` (government file), `generate-materials` /
`generate-news` (AI content), `vision-verify` / `cross-check` (QR checks),
`request-review` (appeal a fake-flag), `promotion` / `resource-request`.

**🏛️ The government officer (`api/admin/…`)**
`verify-batch` (approve items + print QR tags), `facilitator-queue` (what needs checking),
`cluster` (maker CRM, real names — field view), `resolve-flag` (decide on a flagged item),
`capture-on-behalf` (help a maker who can't use the app), `nodal-analytics` (big-picture
numbers, no private info), `audit-trace` (walk the unerasable diary),
`export-compliance` (download a CSV report), plus `payouts`, `ban-artisan`, `simulate-sale`,
`dashboard` (some of these have no button yet — see the ARCHITECTURE notes).

**🛍️ Buyers & selling (`api/buyer/…`, `api/payments/…`, `api/verify…`)**
`buyer/orders` (+ `verify`, `delivered`), the 3-step **payments** flow
(`create-order` → `verify-payment` → `settle-escrow`), `verify/[patchId]` (public "is it
real?" info), `verify-authenticity` (the live-photo AI check), `reviews` (leave/read feedback).

**📣 Everything else**
`demand/…` (the buyer wish-board + matching), `creators/…` (influencer program),
`ondc/catalog` (broadcast format), `ivr/…` (the toll-free phone line),
`sms/inbound` (replies to SMS), `disbursement/apply` (pick how to sell + get advance),
`voice-assistant` (the floating helper), `users/admins`.

> 💡 The repo's **`ARCHITECTURE.md`** is a great companion here — it maps every screen to the
> exact waiter it calls, and even honestly lists which brief features are "Not Yet Implemented."

---

## 9. The SCREENS — a tour of `src/app` pages

Any file called `page.tsx` is a **screen**; a `loading.tsx` next to it is the **"please wait"
placeholder** shown while data loads. `layout.tsx` is a **frame** wrapped around a group of
screens.

- **`layout.tsx`** (top level) — the outer frame for the whole app. Loads the fonts, sets the
  app up to be **installable** (PWA), and mounts the offline auto-uploader once for everything.
- **`page.tsx`** — the **public home page**. Shows real listed items, a live stats strip, and a
  demand map (never fake numbers — if nothing's listed, it says so).
- **`login/` and `register/`** — sign-in and sign-up screens (with an Artisan tab and Admin tab).
- **`artisan/`** — the maker's world, all wrapped in **`artisan/layout.tsx`** (which acts as a
  **guard**: not logged in as a maker? you're bounced to login). Screens include:
  `dashboard`, `earnings`, `insights`, `market`, `marketing`, `materials`, `news`,
  `notifications`, `orders`, `schemes`, `learn`, `cluster`.
- **`admin/`** — the officer world: **`admin/facilitator`** (field view) and **`admin/nodal`**
  (big-boss view).
- **`marketplace/`** — the public shop, and **`marketplace/product/[id]`** for one item.
- **`buyer/`** — the bulk-buyer dashboard (a simulation of a B2B buyer like "Rajesh Retailers").
- **`verify/[patchId]`** — the page a buyer lands on after scanning a QR: the item's story,
  proof of fair pay, and the live-photo authenticity check.
- **`offline/`** — the friendly page shown when you open the app with no internet.
- **`globals.css`** — the app's master paint file (colors, fonts, base styles).

---

## 10. The LEGO BLOCKS — a tour of `src/components`

These are reusable pieces the screens are built from. The tiniest, most-reused ones live in
**`src/components/ui/`** (buttons, cards, badges, the sidebar, star ratings, charts helpers,
the language switcher, etc.).

The bigger "feature" blocks (each is a self-contained piece of a feature):

- **`CaptureModal.tsx`** — the big **"add a craft" wizard** (talk, photo, price). The largest
  component in the app, because it drives the whole capture experience.
- **`VoiceOnboarding.tsx`** — the floating **voice assistant** bubble.
- **`VerificationCamera.tsx`** — the **live-photo camera** for the buyer's authenticity check.
- **`AgentHandoffModal.tsx`** — the **"how do you want to sell + get advance"** step.
- **`QrAttachModal.tsx`** — walks the maker through **sticking the QR** on and re-photographing.
- **`SellModal.tsx`**, **`CompleteDraftModal.tsx`**, **`SmartDraftAssistant.tsx`** — listing helpers.
- **`AssistedOnboardingModal.tsx`** — lets a field officer **onboard a maker on their behalf**.
- **`ProfileEditorModal.tsx`** — edit the maker's ID card.
- **`SchemeFormAssistant.tsx`**, **`GovExportModal.tsx`** — government scheme + export helpers.
- **`PostDemandModal.tsx`**, **`DemandRecommendation.tsx`**, **`DemandMap.tsx`** — the buyer
  demand board + map.
- **`BuyerOrders.tsx`**, **`OrderTimeline`** (in `ui/`) — order tracking.
- **`EarningsAnalytics.tsx`**, **`ReviewSection.tsx`**, **`NotificationsBell.tsx`** — dashboards
  and feedback.
- **`WhatsAppSimulation.tsx`** — shows how the SMS/WhatsApp flow looks to a maker.
- **`OfflineSyncProvider.tsx`**, **`OfflineQueueBadge.tsx`** — the offline status + auto-upload.
- **`AdminShell.tsx`**, **`LogisticsMap.tsx`**, **`HeritageMarquee.tsx`** — layout & decoration.

---

## 11. The setup & config files (the "settings")

- **`package.json`** — the shopping list of tools + the commands (`npm run dev` to start,
  `npm run build`, `npm run seed` to load demo data).
- **`prisma/schema.prisma`** — the design of the notebook (all 13 tables).
- **`prisma/seed.ts`** / **`seed.ts`** — fill the notebook with demo makers and products so
  the app looks alive in a demo. (Demo login: `artisan@karigari.com` / `password123`.)
- **`next.config.ts`** — app-wide settings, including all the clever **offline/PWA** rules.
- **`.env` / `.env.example`** — the **secret passwords** (database URL, JWT secret, Gemini key,
  Twilio, Razorpay). `.env.example` is a safe template; the real `.env` is never shared.
- **`eslint.config.mjs`**, **`postcss.config.mjs`**, **`tsconfig`** (implied) — code-quality and
  styling tooling.
- **`scripts/`** — one-off helper programs run by hand (e.g. `verify-schemes.ts` checks the
  scheme rules, `seed-demand-board.ts` adds demo demands, `sms-dryrun.ts` tests SMS safely).

---

## 12. Two golden patterns that repeat everywhere

If you remember only two things about *how* this codebase is written, remember these — they
show up in almost every file and they're what make it trustworthy.

### Pattern A: "The robot always has a backup"
Every AI/external helper can fail (no internet, wrong key, too busy). This code **never lets
that crash the app**. Instead it degrades gracefully:

- Gemini busy? → try the next AI model (`gemini.ts`, `groq.ts`).
- Whisper can't do Odia? → fall back to Gemini for the audio (`voiceParse.ts`).
- All robots down? → keep the maker's exact words and use safe placeholder numbers, marked
  as placeholders so nothing downstream is fooled.
- Twilio not set up? → the demand still posts; the SMS is simply skipped (`sms.ts`).
- Razorpay not set up? → the buy button returns an honest "checkout not configured" (`razorpay.ts`).

### Pattern B: "Be honest about what's real vs pretend"
This is a prototype, and the code is refreshingly honest about it — which is exactly what
judges want to see. It **never dresses up a simulation as the real thing**:

- The final pay-out to a maker's bank is a **recorded settlement**, not a real transfer — and
  the code refuses to label a simulated payment as a confirmed bank credit (`escrow.ts`).
- The demo charge is **₹1**, on purpose, while every displayed price stays the real one
  (`razorpay.ts`).
- Marketplace "syndication" produces the correct files but doesn't literally push to Amazon/
  Paytm in the prototype — and the comments say so (`syndication.ts`, `ondcCatalog.ts`).
- The whole **`AuditLog` diary**, the escrow ladder, the pricing math, the QR checks, the
  offline queue, and the auth are **all genuinely real**.

---

## 13. Mini glossary (words you'll hear the team say)

- **patchId** — the unique code on an item's physical QR sticker (e.g. `PATCH-MTK9...`).
- **Fair Wage Floor** — the lowest fair price for an item = labour + materials + 10%.
- **Health Score** — a maker's trust score (starts at 100; fake-flags lower it, real sales raise it).
- **Escrow** — money held safely and released in stages (dispatch, then delivery).
- **PWA** — a website that installs and works like a phone app, even offline.
- **IVR** — the "press 1 for…" automated phone line.
- **ONDC / GeM** — India's open shopping network / the government e-marketplace.
- **JWT / auth-token** — the wristband cookie that proves you're logged in.
- **Seed data** — fake demo data loaded so the app looks full during a demo.
- **Route handler** — one waiter (`route.ts`) that answers one web address.

---

### The one-sentence summary
**KARIGARI is a Next.js app where an artisan can *talk* to add a handmade craft, a robot cleans
the photo and sets a fair price, a QR-sticker + AI photo-check proves it's real, the maker gets
paid ~89% with no middleman, and it all works even by SMS, phone call, or with no internet —
with an unerasable diary so the government can trust every step.**

*You now understand the whole codebase. Go build something great. 🇮🇳*
