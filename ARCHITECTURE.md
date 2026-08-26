# Karigari — System Architecture (ground truth)

> Reverse-engineered directly from the repository: `prisma/schema.prisma`, all route handlers under `src/app/api`, the role pages under `src/app`, the modals under `src/components`, and the `src/lib` rules engines. UI→route bindings were confirmed by tracing every `fetch()`. Nothing is inferred beyond what the code executes.

## System facts

| Concern | Reality in code |
|---|---|
| Framework | Next.js **App Router** (TypeScript, React server + client components) |
| Data | **Prisma → PostgreSQL** via `PrismaPg` adapter. Models: `User`, `ArtisanProfile`, `CraftItem`, `AuditLog`, `SchemeApplication` |
| Auth | **JWT** (`jsonwebtoken`) in an **httpOnly cookie** `auth-token` (7d), password hashed with `bcryptjs` |
| RBAC | **No `middleware.ts`.** Every protected handler runs `jwt.verify()` then checks `decoded.role`; else `401/403` |
| Roles | Prisma `Role` enum is **`ADMIN | ARTISAN` only** — there is **no Buyer role** |
| Admin model | One `ADMIN` role, two dashboard views: **Facilitator** (field, unmasked PII) and **Nodal** (macro, no PII) |
| AI | Google **Gemini** (`@google/genai`) for vision/valuation/voice; **OpenAI Whisper** for STT. All fall back to simulated output if keys are absent |
| Payments | **No Stripe/Razorpay.** UPI concept + a simulated advance/final-payout ledger |

---

## 1. Artisan workflow

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"JetBrains Mono, ui-monospace, monospace","primaryColor":"#EAF0EA","primaryBorderColor":"#3D624F","primaryTextColor":"#16211B","lineColor":"#7A8A7E","fontSize":"13px"},"flowchart":{"curve":"basis","nodeSpacing":45,"rankSpacing":55}}}%%
graph TD
  classDef ui fill:#EAF0EA,stroke:#3D624F,color:#16211B;
  classDef api fill:#FBEDE7,stroke:#8F412F,color:#3A1E16;
  classDef db fill:#ECE6DC,stroke:#8A7B63,color:#2A2418;
  classDef ai fill:#E3E9EF,stroke:#4D5D6C,color:#1C2733;
  classDef flag fill:#F6DBD3,stroke:#B14B39,color:#5A1E12;
  classDef ext fill:#D8E4DC,stroke:#24332C,color:#14211B;

  START["Artisan visits Landing /"]:::ui --> AUTHCHK{"Has auth-token JWT cookie?"}
  AUTHCHK -->|No| REG["Register /register - ARTISAN tab"]:::ui
  AUTHCHK -->|Yes| DASH["Artisan Dashboard /artisan/dashboard"]:::ui
  PWA_SYNC["Offline IndexedDB Sync"]:::ext -. auto-flushes .-> CE
  IVR["Toll-Free AI IVR"]:::ext -. creates item .-> NEWITEM
  WA_HOOK["WhatsApp/SMS Webhook"]:::ext -. replies 1 to sell .-> RADV

  subgraph AUTH["Authentication and RBAC"]
    REG --> AREG["POST /api/auth/register<br/>bcrypt hash, sign JWT"]:::api
    LOG["Login /login"]:::ui --> ALOG["POST /api/auth/login<br/>verify + sign JWT"]:::api
    AREG --> COOKIE["Set httpOnly cookie<br/>auth-token, role=ARTISAN, 7d"]:::api
    ALOG --> COOKIE
  end
  AREG --> UDB[("User + ArtisanProfile<br/>role=ARTISAN")]:::db
  COOKIE --> DASH
  DASH --> GDASH["GET /api/artisan/dashboard<br/>role guard: ARTISAN"]:::api
  GDASH --> CIDB[("CraftItem aggregates:<br/>captures, advances, earnings")]:::db

  subgraph PROFILE["Profile Management"]
    DASH --> PROF["ProfileEditorModal"]:::ui
    PROF --> PPUT["PUT /api/artisan/profile<br/>upsert ArtisanProfile"]:::api
    PPUT --> PDB[("ArtisanProfile:<br/>socialCategory, upiId, income")]:::db
  end

  subgraph CAPTURE["Craft Capture and AI Valuation"]
    DASH --> CAP["CaptureModal"]:::ui
    CAP --> VP["POST /api/items/voice-parse<br/>Gemini STT + extract"]:::ai
    CAP --> VV["POST /api/items/vision-verify<br/>Gemini authenticity + copy"]:::ai
    CAP --> CE["POST /api/items/capture<br/>fair-wage engine"]:::api
    CE --> BENCH["validateArtisanClaim<br/>benchmark guardrail"]:::api
    CE --> NEWITEM[("CraftItem status<br/>PENDING_VERIFICATION")]:::db
    CE --> LOG1[("AuditLog: UPLOAD_CREATED")]:::db
  end
  NEWITEM -. hands off to .-> ADMINVER["ADMIN verify-batch mints patchId"]:::ext

  subgraph SELL["Handoff, Advance and Payout Routing"]
    DASH --> HAND["AgentHandoffModal"]:::ui
    HAND --> AVV["POST /api/artisan/vision-verify<br/>QR patch visual match"]:::ai
    HAND --> DAPPLY["POST /api/disbursement/apply<br/>selectedOption route"]:::api
    DAPPLY --> ROUTE{"Route chosen"}
    ROUTE -->|KARIGARI_ADVANCE| RADV[("ADVANCE_PAID<br/>advancePaid = fairWageFloor")]:::db
    ROUTE -->|MIDDLEMAN| RMID[("SOLD_MIDDLEMAN")]:::db
    ROUTE -->|COOP_AUCTION| RAUC[("LISTED_AUCTION")]:::db
    DAPPLY --> HS["healthScore +2.5<br/>accountStatus recompute"]:::api
    DASH --> XC["CrossCheckModal"]:::ui
    XC --> XCE["POST /api/artisan/cross-check<br/>status TAG_ATTACHED"]:::api
  end

  subgraph SCHEMES["Government Scheme Tracking"]
    SCH["Schemes /artisan/schemes"]:::ui --> GSCH["GET /api/artisan/schemes<br/>evaluateAllSchemes"]:::api
    SCH --> SAPPLY["POST /api/artisan/schemes/apply<br/>re-evaluated server-side"]:::api
    GSCH --> ELIG["loadEligibilitySnapshot<br/>rules engine schemes.ts"]:::api
    SAPPLY --> SADB[("SchemeApplication<br/>status APPLIED")]:::db
    SAPPLY -. opens .-> GOV["Official govt portal - EXTERNAL<br/>KARIGARI never submits"]:::ext
  end

  subgraph DISPUTE["Counterfeit Dispute"]
    DASH --> DISP["DisputeModal on FLAGGED item"]:::ui
    DISP --> RR["POST /api/artisan/request-review<br/>status APPLIED_FOR_REVIEW"]:::api
    RR --> RRDB[("CraftItem APPLIED_FOR_REVIEW")]:::db
  end

  RADV -. buyer scan sale .-> BUYER["Buyer QR verify /verify/patchId"]:::ext
  DASH --> VO["VoiceOnboarding<br/>/api/transcribe + /api/voice-assistant"]:::ai
  DASH --> INS["Insights /artisan/insights"]:::ui
  DASH --> MKT["Market /artisan/market<br/>ONDC listing UI - NOT YET IMPLEMENTED"]:::flag
```

**Routes:** `POST /api/auth/register`, `GET /api/artisan/dashboard`, `PUT /api/artisan/profile`, `POST /api/items/voice-parse`, `POST /api/items/vision-verify`, `POST /api/items/capture` → `PENDING_VERIFICATION`, `POST /api/artisan/vision-verify`, `POST /api/disbursement/apply` → `ADVANCE_PAID|SOLD_MIDDLEMAN|LISTED_AUCTION`, `POST /api/artisan/cross-check` → `TAG_ATTACHED`, `GET /api/artisan/schemes`, `POST /api/artisan/schemes/apply`, `POST /api/artisan/request-review` → `APPLIED_FOR_REVIEW`.

Fair-wage engine (in `/api/items/capture`): `fairWageFloor = laborDays*baseWage + rawMaterialCost + 10% overhead`. `/artisan/market` (ONDC) is **UI-only — [Not Yet Implemented]**.

---

## 2. Buyer workflow

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"JetBrains Mono, ui-monospace, monospace","primaryColor":"#EAF0EA","primaryBorderColor":"#3D624F","primaryTextColor":"#16211B","lineColor":"#7A8A7E","fontSize":"13px"},"flowchart":{"curve":"basis","nodeSpacing":45,"rankSpacing":55}}}%%
graph TD
  classDef ui fill:#EAF0EA,stroke:#3D624F,color:#16211B;
  classDef api fill:#FBEDE7,stroke:#8F412F,color:#3A1E16;
  classDef db fill:#ECE6DC,stroke:#8A7B63,color:#2A2418;
  classDef ai fill:#E3E9EF,stroke:#4D5D6C,color:#1C2733;
  classDef flag fill:#F6DBD3,stroke:#B14B39,color:#5A1E12;
  classDef ext fill:#D8E4DC,stroke:#24332C,color:#14211B;

  BSTART["No Buyer account exists<br/>role BUYER - NOT YET IMPLEMENTED"]:::flag

  subgraph PUBLIC["Real Buyer Touchpoint - Public QR Provenance - no auth"]
    QR["Scan patch QR to /verify/patchId"]:::ui
    QR --> VGET["Server component<br/>prisma.craftItem.findFirst"]:::api
    VGET --> VPUB["GET /api/verify/patchId<br/>public provenance + passportHash"]:::api
    VGET --> VITEM[("CraftItem + Artisan<br/>+ AuditLog timeline")]:::db
    VPUB --> VCLIENT["VerificationClient:<br/>authentic / fair-pay / story"]:::ui
    VCLIENT --> CAM["VerificationCamera<br/>capture 1 to 3 photos"]:::ui
    CAM --> VAUTH["POST /api/verify-authenticity<br/>Gemini image compare"]:::ai
    VAUTH --> DEC{"similarityScore >= 75<br/>and isAuthentic?"}
    DEC -->|Yes| SOLD[("status SOLD_FINAL<br/>reset scan counters")]:::db
    DEC -->|"No, within grace"| SOFT["Soft reject:<br/>under 5 min, under 10 tries"]:::api
    DEC -->|"No, grace expired"| FLAGN[("status FLAGGED<br/>healthScore -15")]:::flag
    SOFT --> CAM
    SOLD --> REVEAL["Post-purchase reveal:<br/>artisan story + fair pay proof"]:::ui
  end

  SOLD -. notifies .-> ARTDASH["Artisan earnings /artisan/dashboard"]:::ext
  FLAGN -. raises .-> ADMINQ["Admin facilitator queue"]:::ext
  SOLD -. feeds .-> AUDIT["Admin nodal audit-trace ledger"]:::ext

  subgraph MOCK["B2B Marketplace /buyer - UI SIMULATION ONLY, zero backend"]
    MSTART["/buyer dashboard<br/>hardcoded Rajesh Retailers"]:::flag
    MSTART --> MQ["Post New Demand - static button"]:::flag
    MQ --> MSIM["Simulate Artisan Match<br/>setState only, no API call"]:::flag
    MSIM --> MQUOTE["Quote to Accept to LogisticsMap<br/>nothing persisted"]:::flag
  end

  subgraph MISSING["Requested in brief but NOT YET IMPLEMENTED"]
    N1["Buyer signup / login / accounts"]:::flag
    N2["Catalog browse, search, category filters"]:::flag
    N3["Cart and wishlist"]:::flag
    N4["Stripe / Razorpay checkout + payment gateway"]:::flag
    N5["Order history, reviews, support / returns"]:::flag
  end
```

**Real (public, no auth):** `/verify/[patchId]` (SSR provenance) · `GET /api/verify/[patchId]` · `POST /api/verify-authenticity` → Gemini compare → `SOLD_FINAL` or, after a 5-min/10-try grace window, `FLAGGED` (artisan health −15).
**Mock:** `/buyer` B2B dashboard is a `setState`-only simulation, no backend.
**[Not Yet Implemented]:** buyer accounts, catalog/search/filters, cart, wishlist, Stripe/Razorpay checkout, order history, reviews, returns.

---

## 3. Admin workflow

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"JetBrains Mono, ui-monospace, monospace","primaryColor":"#EAF0EA","primaryBorderColor":"#3D624F","primaryTextColor":"#16211B","lineColor":"#7A8A7E","fontSize":"13px"},"flowchart":{"curve":"basis","nodeSpacing":45,"rankSpacing":55}}}%%
graph TD
  classDef ui fill:#EAF0EA,stroke:#3D624F,color:#16211B;
  classDef api fill:#FBEDE7,stroke:#8F412F,color:#3A1E16;
  classDef db fill:#ECE6DC,stroke:#8A7B63,color:#2A2418;
  classDef ai fill:#E3E9EF,stroke:#4D5D6C,color:#1C2733;
  classDef flag fill:#F6DBD3,stroke:#B14B39,color:#5A1E12;
  classDef ext fill:#D8E4DC,stroke:#24332C,color:#14211B;

  ALOGIN["Admin login /login - ADMIN tab"]:::ui --> AAUTH["POST /api/auth/login<br/>JWT role=ADMIN"]:::api
  AAUTH --> SHELL["AdminShell - one role,<br/>two views: Facilitator + Nodal"]:::ui
  SHELL --> GUARD["Per-route RBAC, no middleware:<br/>every /api/admin/* does<br/>jwt.verify + role==ADMIN else 403"]:::api

  subgraph FAC["Field Facilitator View /admin/facilitator"]
    GUARD --> FQ["GET /api/admin/facilitator-queue<br/>pricing + voice QA queues"]:::api
    GUARD --> FCL["GET /api/admin/cluster<br/>unmasked artisan CRM"]:::api
    GUARD --> VB["POST /api/admin/verify-batch<br/>mint patchId, debit patch bank"]:::api
    GUARD --> RF["PATCH /api/admin/resolve-flag<br/>APPROVE_OVERRIDE or INVESTIGATE"]:::api
    GUARD --> AOB["POST /api/admin/capture-on-behalf<br/>AssistedOnboardingModal"]:::api
    VB --> VBDB[("CraftItem VERIFIED<br/>patchBankBalance --")]:::db
    RF --> RFDB[("pricingFlag cleared/held<br/>+ AuditLog")]:::db
    AOB --> AOBDB[("CraftItem PENDING_VERIFICATION<br/>catalogMethod VOICE")]:::db
    FQ --> FQDB[("getPricingDiscrepancy<br/>fair-wage guardian")]:::db
  end

  subgraph NODAL["Central Nodal Officer View /admin/nodal"]
    GUARD --> NA["GET /api/admin/nodal-analytics<br/>macro impact, no PII"]:::api
    GUARD --> AT["GET /api/admin/audit-trace<br/>hash-ledger provenance chain"]:::api
    GUARD --> EXP["GET /api/admin/export-compliance<br/>CSV download"]:::api
    NA --> NADB[("aggregate CraftItem +<br/>ArtisanProfile + AuditLog")]:::db
    AT --> ATDB[("AuditLog chain via ledgerHash")]:::db
  end

  subgraph ORPHAN["Implemented endpoints with NO UI caller"]
    O1["POST /api/admin/simulate-sale<br/>drives status to SOLD_FINAL"]:::flag
    O2["POST /api/admin/ban-artisan<br/>gate: healthScore under 65"]:::flag
    O3["GET+POST /api/admin/payouts<br/>drives PAYOUT_COMPLETED"]:::flag
    O4["GET /api/users/admins<br/>PUBLIC route, no auth guard"]:::flag
  end

  VBDB -. enables .-> ARTHAND["Artisan handoff and advance"]:::ext
  RFDB -. protects .-> ARTPAY["Artisan fair wage floor"]:::ext
  ATDB -. audits .-> BUYERTL["Buyer QR provenance timeline"]:::ext
```

**Facilitator:** `GET /api/admin/facilitator-queue`, `GET /api/admin/cluster`, `POST /api/admin/verify-batch` (`PENDING_VERIFICATION`→`VERIFIED`, mints `patchId`, debits `patchBankBalance`), `PATCH /api/admin/resolve-flag`, `POST /api/admin/capture-on-behalf`.
**Nodal:** `GET /api/admin/nodal-analytics`, `GET /api/admin/audit-trace` (hash-ledger), `GET /api/admin/export-compliance` (CSV).
**Implemented but NO UI caller:** `POST /api/admin/simulate-sale` → `SOLD_FINAL`; `POST /api/admin/ban-artisan`; `GET|POST /api/admin/payouts` → `PAYOUT_COMPLETED`; `GET /api/admin/dashboard` (legacy). **Open endpoint (no guard):** `GET /api/users/admins`.

---

## 4. End-to-end (CraftItem status spine)

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"JetBrains Mono, ui-monospace, monospace","primaryColor":"#EAF0EA","primaryBorderColor":"#3D624F","primaryTextColor":"#16211B","lineColor":"#7A8A7E","fontSize":"13px"},"flowchart":{"curve":"basis","nodeSpacing":40,"rankSpacing":60}}}%%
graph LR
  classDef art fill:#EAF0EA,stroke:#3D624F,color:#16211B;
  classDef adm fill:#E3E9EF,stroke:#4D5D6C,color:#1C2733;
  classDef buy fill:#FBEDE7,stroke:#8F412F,color:#3A1E16;
  classDef sys fill:#ECE6DC,stroke:#8A7B63,color:#2A2418;
  classDef flag fill:#F6DBD3,stroke:#B14B39,color:#5A1E12;

  A1["ARTISAN registers + profile<br/>/api/auth/register"]:::art --> A2["Capture craft + AI valuation<br/>/api/items/capture"]:::art
  A2 --> S1[("PENDING_VERIFICATION")]:::sys
  S1 --> AD1["ADMIN verify-batch<br/>mints patchId, debits bank"]:::adm
  AD1 --> S2[("VERIFIED + patchId")]:::sys
  S2 --> A3["ARTISAN handoff:<br/>cross-check + route choice"]:::art
  A3 --> S3[("ADVANCE_PAID /<br/>SOLD_MIDDLEMAN /<br/>LISTED_AUCTION")]:::sys
  S3 --> B1["BUYER scans QR<br/>/verify/patchId"]:::buy
  B1 --> B2["AI authenticity camera<br/>/api/verify-authenticity"]:::buy
  B2 --> S4[("SOLD_FINAL")]:::sys
  B2 -. fail after grace .-> SF[("FLAGGED - healthScore -15")]:::flag
  SF --> A4["ARTISAN dispute<br/>/api/artisan/request-review"]:::art
  A4 --> S5[("APPLIED_FOR_REVIEW")]:::sys
  S4 --> AD2["ADMIN payouts - NO UI yet<br/>/api/admin/payouts"]:::adm
  AD2 --> S6[("PAYOUT_COMPLETED")]:::sys
  S4 --> AD3["ADMIN nodal: ledger + analytics"]:::adm
  S3 -. parallel track .-> SC["ARTISAN schemes:<br/>eligibility + apply tracker"]:::art
  LEDGER["Every transition writes an immutable AuditLog - hash-ledger provenance"]:::sys
  S1 -. logs .-> LEDGER
  S4 -. logs .-> LEDGER
  S6 -. logs .-> LEDGER
```

### CraftItem status machine
`PENDING_VERIFICATION → VERIFIED → TAG_ATTACHED → (ADVANCE_PAID | SOLD_MIDDLEMAN | LISTED_AUCTION | PENDING_DISBURSEMENT) → SOLD_FINAL → PAYOUT_COMPLETED`; penalty branch `FLAGGED → APPLIED_FOR_REVIEW`. Every transition writes an immutable `AuditLog` row (hash-ledger via `ledgerHash`).

---



---

## 5. Advanced SIH Workflows (Offline, Sync, Pooling, & Fallbacks)

To ensure **100% digital inclusion** and B2B scalability, KARIGARI implements four advanced resilience layers:

### 5.1 Offline Sync (PWA Local Storage)
**Goal:** Enable cataloging in zero-internet zones.
**Flow:**
1. Artisan opens the PWA (cached via service worker).
2. Uses the camera and dictates details.
3. If `navigator.onLine` is false, the app saves the `CraftItem` payload to the browser's **IndexedDB** (local storage).
4. The UI displays an `Offline Mode: Synced to Device` badge.
5. When the device reconnects to 4G, a background sync listener (or layout `useEffect`) automatically flushes the queue to `POST /api/items/capture`, generating the `UPLOAD_CREATED` audit logs retroactively.

### 5.2 WhatsApp / SMS Fallback (Low-Bandwidth Comm)
**Goal:** Reach artisans who have a feature phone or minimal data, bypassing the web app entirely.
**Flow:**
1. When a B2B buyer posts a bulk demand, the backend `notifyArtisansForDemand()` checks the artisan's connectivity.
2. If web is unreachable, the system triggers the **Twilio / Meta Cloud API Webhook** (`/api/webhooks/whatsapp`).
3. Artisan receives an SMS/WhatsApp: *"Demand for 50 Ikats. Reply 1 to accept."*
4. Artisan replies "1". The webhook parses the sender's number, matches the `ArtisanProfile`, and updates the `CraftItem` status to `ADVANCE_PAID` directly in the Prisma database.

### 5.3 Toll-Free AI IVR (Zero-Tech Fallback)
**Goal:** Absolute inclusion for the most marginalized artisans with no smartphone or SMS literacy.
**Flow:**
1. Artisan dials a toll-free number: **1800-KARIGARI**.
2. A **Bhashini-powered AI Voicebot** asks in the local dialect: *"What did you weave today?"*
3. The artisan replies, *"Two red silk sarees."*
4. The audio is transcribed and parsed via the same `/api/items/voice-parse` logic, and a `PENDING_VERIFICATION` item is inserted into the database. The NGO facilitator simply visits later to attach the physical QR patch.

### 5.4 Cluster Pooling (B2B ONDC Logistics)
**Goal:** Allow individual rural weavers to fulfill massive B2B wholesale orders by aggregating their inventory.
**Flow:**
1. An artisan uploads a saree. The AI Engine detects similar items uploaded by 9 other artisans in the same `clusterName` (e.g., *Pochampally Coop*).
2. The **ONDC Beckn Adapter** (`/api/ondc/catalog`) dynamically groups these 10 distinct items into a single **"Bulk B2B Listing"**.
3. A hotel chain on Paytm buys the bulk listing.
4. The Escrow disbursement API splits the incoming UPI payment into 10 separate micro-payouts, crediting each artisan individually while fulfilling the buyer's bulk requirement.


## Brief vs. code — gap analysis

| Assumed in brief | Status | What exists instead |
|---|---|---|
| Buyer signup / login / accounts | **[Not Yet Implemented]** | Anonymous public QR verification |
| Catalog browse / search / filters | **[Not Yet Implemented]** | Single-item passport pages by `patchId` |
| Cart & wishlist | **[Not Yet Implemented]** | — |
| Stripe / Razorpay checkout | **[Not Yet Implemented]** | UPI concept + simulated ledger |
| Order history / reviews / returns | **[Not Yet Implemented]** | AuditLog timeline on the passport page |
| ONDC B2B listing | **[UI stub]** | `/artisan/market`, no backend |
| Product moderation / disputes | **Implemented** | `resolve-flag`, `request-review`, grace-period flagging |
| Payout / commission tracking | **Partial** | Endpoints + ledger exist; payout button not wired |
| Artisan verification & RBAC | **Implemented** | `verify-batch`, per-route JWT role guards |
| Platform metrics & transaction logs | **Implemented** | `nodal-analytics`, `audit-trace`, CSV export |
