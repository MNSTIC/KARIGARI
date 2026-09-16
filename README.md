# KARIGARI Heritage 🇮🇳
**Smart India Hackathon (SIH) Prototype** | **Ministry of Social Justice and Empowerment (MoSJE)**

> *Empowering rural artisans through AI-driven market linkages, cryptographic provenance, and offline-first digital inclusion.*

## 🚨 The Problem (SIH Context)
Rural artisans in India face severe exploitation from long chains of middlemen. They lack the digital literacy to onboard onto complex e-commerce systems, and authentic handlooms are constantly undercut by cheap power-loom counterfeits. Furthermore, forcing rural users to download heavy mobile apps fails due to low device storage and intermittent internet.

## 💡 Our Solution
**Karigari** is an AI-driven Provenance and Fair-Wage Protocol. Instead of a traditional e-commerce app, it acts as a trust bridge connecting rural artisans directly to global buyers (and B2B networks) while guaranteeing fair pay.

### ✨ Core Innovations
1. **🎙️ AI Voice Onboarding (No Typing Required):** Artisans simply speak to the app in their native language. Gemini AI parses the audio into structured product data (labor days, raw materials) without requiring digital literacy.
2. **⚖️ AI Fair-Wage Engine:** Calculates a strict minimum `Fair Wage Floor` based on labor and materials. If an item routes through Karigari, the artisan immediately receives a **40% UPI Advance** before the item is even sold.
3. **📶 Offline-First SMS/WhatsApp Fallback:** Artisans without internet receive SMS alerts for high-demand signals in their region and can auto-list inventory simply by replying "YES".
4. **📸 Dual-Lock Provenance (QR + AI Vision):** 
   - A physical QR `patchId` is attached to the item by a Field Facilitator.
   - When a buyer scans it, they must take a live photo of the item. **Gemini Vision AI** compares the live photo against the original artisan upload to prevent tag-swapping and counterfeits.
5. **🏛️ Nodal Officer Audit Ledger:** A macro-level government dashboard that tracks regional economic health, strips PII for privacy, and maintains an immutable hash-ledger of every transaction for compliance.

## 🏗️ System Architecture
- **Framework:** Next.js 16 App Router (React 19, TypeScript, Tailwind v4)
- **Database:** PostgreSQL via Prisma 7 ORM (`PrismaPg` adapter)
- **AI Models:** Google Gemini (`@google/genai`) for Vision, Valuation and NLP, with a rule-based fallback on every path
- **Authentication:** Custom JWT-based Role-Based Access Control (RBAC)
- **Deployment Strategy:** Progressive Web App (PWA) to bypass Play Store friction.

*(For a deep dive into our state machine, routing, and database schema, see `ARCHITECTURE.md`)*

## 🚀 Local Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file based on `.env.example`:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/karigari"
   JWT_SECRET="your-secret"
   GEMINI_API_KEY="your-google-gemini-key"
   ```

3. **Database Setup**
   ```bash
   npx prisma db push
   npx prisma generate
   ```

4. **Run the Development Server**
   ```bash
   npm run dev
   ```
   *The platform will be available at `http://localhost:3000`.*

---
*Built with ❤️ for Smart India Hackathon.*

---

## V9 — Demand & Order Synchronisation

One lifecycle from a buyer's request to the artisan being credited, with the
buyer told at every step.

- **Structured demand capture.** Category, product type, size, customisation,
  required-by, delivery mode, purchase type, up to four reference photos, and a
  five-row flexibility matrix that tells the artisan what they may propose
  instead of what was literally asked for.
- **Multi-signal matching.** Craft, material, category, colour, location and
  capacity, renormalised over the signals the buyer actually filled in. The
  artisan is told *why* the demand reached them.
- **A real ready check.** Marking an order ready means scanning the piece's own
  QR patch and photographing it; the patch must resolve to a `CraftItem` owned
  by that artisan, and the photo is compared against its original capture through
  the same code path the buyer's delivery check uses. Passing binds the piece to
  the order. Failing writes nothing and costs the artisan no health.
- **Pack → Dispatch → Delivered**, each step gated on the one before it, each
  notifying the buyer.
- **A buyer notification feed**, because buyers have no account and previously
  learned nothing until they reloaded the board.

### Setup

No new environment variables. The V9 schema change lands with:

```bash
npx prisma db push
npx prisma generate
npm run seed      # optional; the seed script REPLACES all data
```

Two things worth knowing before you run them:

- **`prisma db push` needs the direct connection.** Against the pooled
  `DATABASE_URL` it hangs. Pass the non-pooled one:
  `npx prisma db push --url "$DIRECT_URL"`.
- **`npm run seed` is destructive.** It wipes and reseeds the whole database.

### Honesty notes

These are load-bearing, not disclaimers:

- The Razorpay charge is a flat **₹1** demo amount. Every price shown to a buyer
  or counted into an artisan's earnings is the *displayed* price, never that ₹1.
- RazorpayX is not enabled, so artisan payouts are recorded as `SIMULATED`
  settlements. The escrow ladder, the ledger fields and the audit trail are real;
  the bank credit at the end of it is not, and nothing in the UI says otherwise.
- When Gemini is unreachable, the photo comparison returns a fallback score and
  the UI says which path ran, rather than presenting a made-up number as a
  judgement.

---

## V10 — Google sign-in, passkeys & the 40% advance

### Sign-in

Three ways in. **Password sign-in is unchanged** — every existing account keeps
working exactly as before.

- **Google** — hand-rolled OAuth 2.0 authorization-code flow with PKCE. No
  `next-auth`: the `id_token` signature is verified against Google's JWKS with
  `node:crypto`. A Google sign-in on an email that already has a password
  account is **refused**, not auto-linked — controlling a mailbox should not be
  enough to take over an account.
- **Passkeys** — `@simplewebauthn`, usernameless where the authenticator
  supports it, with signature-counter clone detection. Available on accounts
  created with Google; a password account keeps its password.

Both are off by default and both degrade honestly: an unset flag or an
unconfigured key means the button does not render at all and the route returns a
plain 503, never a dead control or a stack trace.

### The 40% advance

When an artisan accepts a demand, the buyer owes a 40% fair-wage advance before
work starts. Until it is paid, the artisan's card shows a calm waiting state and
the log / ready / pack / dispatch endpoints return 409. The remaining 60% is
credited when the buyer confirms delivery; advance + balance reconstructs the
agreed price to the rupee.

### Google Cloud setup

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type **Web application**.
2. Under **Authorised redirect URIs**, add your callback **byte for byte**:
   `http://localhost:3000/api/auth/google/callback`. Scheme, port and the
   absence of a trailing slash all matter — a mismatch is rejected by Google
   before any of this app's code runs.
3. Copy the client ID and secret into `.env`.

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true
```

### WebAuthn setup

```env
WEBAUTHN_RP_ID=localhost                 # BARE hostname — no scheme, no port
WEBAUTHN_RP_NAME=KARIGARI
WEBAUTHN_ORIGIN=http://localhost:3000    # FULL origin, port included
NEXT_PUBLIC_PASSKEY_ENABLED=true
```

If those two disagree, every ceremony fails inside the browser in a way that
looks like a UI bug. `src/lib/passkey.ts` logs a loud warning at import time
when it spots the mismatch.

### Schema

```bash
npx prisma db push --url "$DIRECT_URL"   # bare db push hangs on the pooler
npx prisma generate
```

V10 widens `User.passwordHash` to nullable (Google and passkey accounts have no
password), adds `authProvider` / `googleId` / `emailVerified` / `avatarUrl`, a
`Passkey` table, and the advance ledger on `ArtisanOrder`. Every column is
nullable or defaulted, so existing rows are untouched — they keep their hashes
and read `authProvider = 'PASSWORD'`.

`db push` asks for `--accept-data-loss` because of the new unique index on
`googleId`. Nothing is lost: the column is brand new, every existing row gets
NULL, and Postgres permits unlimited NULLs in a unique index.

### Demo charges

**₹10** for a full purchase, **₹4** for the 40% advance. ₹4 is exactly 40% of
₹10, and both clear Razorpay's 100-paise minimum — which the old ₹1 charge did
not, since 40% of it is 40 paise.

Every price a buyer or artisan *sees* is the real rupee value. Only the charged
amount is a demo constant, and it is recorded in its own column
(`paidAmountPaise`, `advanceChargedPaise`) so the two can never be confused.

⚠ In live mode both are **real debits** into the platform's merchant account.

Operational procedures — rotating the Google secret, revoking a passkey for a
locked-out user, turning either feature off — are in
[docs/AUTH_V10_RUNBOOK.md](docs/AUTH_V10_RUNBOOK.md).

---

## V11 — AI Photo Studio & Shopify artisan shops

### Photo Studio

Step 2 of the capture flow is now a small studio instead of a silent
auto-enhance:

- **A lenient quality gate.** An instant on-phone blur and exposure check, then
  one Gemini verdict. A retake is asked for only when a photo is genuinely
  unusable, with a specific reason and an equally weighted **Use this photo
  anyway**. A soft photo from a cheap phone gets advice, not a wall. After one
  retake, it never asks again.
- **Choose the look.** The Original (always first, always kept), an Enhanced
  frame, and studio backgrounds made from the artisan's own cutout. Every look is
  labelled, and the craft itself is untouched in every one of them.
- **Provenance.** Buyer and QR checks compare against the camera frame, never
  the chosen look. The server also proves a studio look really is the camera
  frame's pixels before storing it as the listing photo.
- **Change it later** on `/artisan/market`. Locked once a buyer has paid.

```env
NEXT_PUBLIC_PHOTO_STUDIO_ENABLED=true   # false restores the pre-V11 single frame
SERVER_CUTOUT_ENABLED=false             # server background removal; see below
```

`SERVER_CUTOUT_ENABLED` runs `@imgly/background-removal-node` for phones that
cannot run the model locally. It is **AGPL-3.0**, and the deployed function is
about **124 MB** on Linux (the model is 84 MB) against a 250 MB limit — see the
runbook before turning it on.

AI-generated backgrounds are built but need a Gemini key **with image-generation
quota**. The free tier has none, so on a free key the studio simply offers the
canvas backgrounds.

### Shopify artisan shops

**One store, a collection per artisan.** Shopify's Admin API cannot create a
store per artisan. The platform runs ONE Shopify store; each artisan's "shop" is
a collection inside it (`karigari-<name>-<id>`), and the link they share is that
collection's page. Their name is the vendor on every product.

Setup, once:

1. **Create the store by hand** at shopify.com. In **Settings → General**, set
   the store currency to **Indian Rupee (INR)** — publishing refuses any other
   currency.
2. **Install a custom app:** Settings → Apps and sales channels → Develop apps →
   Create an app → Configure Admin API scopes:
   `read_products`, `write_products`, `read_publications`, `write_publications`,
   plus `read_inventory`, `write_inventory` if you set a location (recommended).
3. **Install the app** and copy the **Admin API access token** (`shpat_…`). It is
   shown once.
4. Add it to `.env` — **server-side only, never with a `NEXT_PUBLIC_` prefix**:

```env
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxxxxxxxxx
SHOPIFY_API_VERSION=2026-07
SHOPIFY_LOCATION_ID=                    # Settings → Locations; enables stock of 1 per piece
NEXT_PUBLIC_SHOPIFY_ENABLED=true        # shows the card in the Syndication Hub
```

5. Sign in as an admin and `POST /api/artisan/shopify/test`. It reports the shop,
   the currency, missing scopes and whether the Online Store channel exists.

What an artisan sees: a **Your Shopify shop** card in the Syndication Hub, with
**Publish to my shop**, **View in shop** and **Retry** per piece. A piece sold on
Karigari is taken off Shopify automatically. Orders placed on Shopify are
fulfilled from Shopify admin; they do not go through Karigari's escrow.

Honest scope: the Shopify client was tested against a stateful fake of the Admin
API and against an unreachable store, **not yet against a real store**. The
first real publish should be watched — see the runbook.

### Schema

```bash
npx prisma db push --url "$DIRECT_URL"   # bare db push hangs on the pooler
npx prisma generate                      # then RESTART `next dev`
```

V11 adds the Photo Studio and Shopify columns to `CraftItem` and a
`ShopifyShop` table. Every column is nullable or defaulted; existing rows are
untouched. A running dev server keeps the old Prisma client until restarted, and
routes that select the new fields silently return nothing until it is.

Operations — rotating the Shopify token, a publish stuck in `PUBLISHING`,
re-running failed publishes in bulk, turning either feature off — are in
[docs/PHOTO_STUDIO_RUNBOOK.md](docs/PHOTO_STUDIO_RUNBOOK.md).
