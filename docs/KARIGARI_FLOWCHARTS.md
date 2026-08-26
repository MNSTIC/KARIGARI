
# KARIGARI — Master System Flowcharts

> **Note:** These flowcharts are strictly modeled after the exact state transitions and architectural boundaries defined in the official WORKFLOW.md, incorporating the core Next.js routing, AI logic, and the Advanced SIH resilience layers.

---

## 1. The Overall Master Architecture

This high-level flowchart shows the interconnected flow of data from the initial rural upload, through government oversight, and ultimately to the final buyer and ONDC wholesale markets.

```mermaid
graph TD
  classDef fe fill:#EAF0EA,stroke:#3D624F,color:#16211B;
  classDef be fill:#FBEDE7,stroke:#8F412F,color:#3A1E16;
  classDef db fill:#ECE6DC,stroke:#8A7B63,color:#2A2418;
  classDef ai fill:#E3E9EF,stroke:#4D5D6C,color:#1C2733;
  classDef ext fill:#F6DBD3,stroke:#B14B39,color:#5A1E12;

  subgraph "Capture & Onboarding (Inclusion Layer)"
    PWA["Karigari PWA (Smartphone)"]:::fe
    SYNC["Offline IndexedDB Sync"]:::fe
    IVR["1800-KARIGARI Toll-Free AI IVR"]:::fe
    SMS["WhatsApp / SMS (Feature Phone)"]:::fe
  end

  subgraph "Core Backend (Next.js API)"
    API["State Machine & Routes"]:::be
    GEM["Gemini (Vision, Pricing, Voice)"]:::ai
    BHASH["Bhashini (Vernacular Voicebot)"]:::ai
    DB[("Prisma DB + Audit Ledger")]:::db
  end

  subgraph "Admin & Ministry"
    FAC["Facilitator (QR Minting & Field CRM)"]:::be
    NODAL["Nodal Officer (Analytics & Risk Radar)"]:::be
  end

  subgraph "Market & Buyers"
    ONDC["ONDC Beckn BPP (Cluster Pooling)"]:::ext
    BUYER["End Buyer (QR Verification)"]:::ext
    DEMAND["Public Demand Board"]:::ext
  end

  PWA -->|Online Capture| API
  PWA -.->|No Network| SYNC
  SYNC -.->|4G Restored| API
  IVR -->|Audio| BHASH
  BHASH -->|Transcript| API
  DEMAND -->|Fan-out| API
  API -->|Triggers Webhook| SMS
  SMS -->|Replies '1' to Sell| API

  API <--> GEM
  API <--> DB

  DB <--> FAC
  DB -->|Macro Aggregates| NODAL
  DB -->|B2B Bulk Listings| ONDC
  BUYER -->|Scan Passport QR| API
```

---

## 2. Artisan End-to-End Workflow

This chart tracks an artisan's exact path through the UI (/artisan/dashboard), incorporating the 6-step capture, pricing guards, handoff, and the new offline/telecom fallbacks.

```mermaid
graph TD
  classDef ui fill:#EAF0EA,stroke:#3D624F,color:#16211B;
  classDef api fill:#FBEDE7,stroke:#8F412F,color:#3A1E16;
  classDef db fill:#ECE6DC,stroke:#8A7B63,color:#2A2418;
  classDef flag fill:#F6DBD3,stroke:#B14B39,color:#5A1E12;

  START["Login /artisan/dashboard"]:::ui --> DASH["Dashboard & Insights"]:::ui
  
  DASH --> CAPTURE["CaptureModal (6 Steps)"]:::ui
  
  CAPTURE --> STT["POST /api/items/voice-parse"]:::api
  STT --> VIS["POST /api/items/vision-verify"]:::api
  VIS --> PRICE["estimateCraftValuation() - Fair Wage Floor"]:::api
  PRICE --> ASKING["Artisan Sets Asking Price"]:::ui
  
  ASKING --> CAP_API["POST /api/items/capture"]:::api
  CAP_API --> SYNC{"Is device online?"}
  SYNC -->|No| IDB[("Save to IndexedDB (Offline Sync)")]:::db
  SYNC -->|Yes| BENCH{"Asking Price < 70% of Floor?"}
  
  BENCH -->|Yes| FLAG[("Save Item (pricingFlag=true)")]:::flag
  BENCH -->|No| PENDING[("Status: PENDING_VERIFICATION")]:::db
  IDB -.->|Auto-flush on 4G| BENCH
  
  PENDING -.-> VER["Admin Mints QR Patch (VERIFIED)"]:::api
  
  VER --> XC["CrossCheckModal (Scan Attached Tag)"]:::ui
  XC --> TAG[("Status: TAG_ATTACHED")]:::db
  
  TAG --> HAND["AgentHandoffModal (Delivery OTP)"]:::ui
  HAND --> DAPPLY["POST /api/disbursement/apply"]:::api
  DAPPLY --> ROUTE{"Chosen Route"}
  
  ROUTE -->|KARIGARI_ADVANCE| ADV[("ADVANCE_PAID (Escrow)")]:::db
  ROUTE -->|MIDDLEMAN| MID[("SOLD_MIDDLEMAN")]:::db
  ROUTE -->|COOP_AUCTION| AUC[("LISTED_AUCTION")]:::db
  
  %% Fallbacks injected directly to status
  IVR_CALL["Toll-Free AI IVR Call"] -.->|Creates Item| PENDING
  WA_REPLY["WhatsApp Reply '1'"] -.->|Bypasses UI| ADV
```

---

## 3. Admin Workflow (Facilitator vs Nodal)

The system splits admin tasks strictly by operational scope: Field actions with PII (Facilitator) vs Government macro-oversight without PII (Nodal).

```mermaid
graph TD
  classDef ui fill:#EAF0EA,stroke:#3D624F,color:#16211B;
  classDef api fill:#FBEDE7,stroke:#8F412F,color:#3A1E16;
  classDef db fill:#ECE6DC,stroke:#8A7B63,color:#2A2418;

  ADMIN["Admin Login (role=ADMIN)"]:::ui --> SHELL{"Select View"}
  
  SHELL --> FAC["/admin/facilitator (Field Operations)"]:::ui
  SHELL --> NOD["/admin/nodal (Government Oversight)"]:::ui

  %% Facilitator
  FAC --> FQ["GET /api/admin/facilitator-queue"]:::api
  FQ --> VERIFY["POST /admin/verify-batch"]:::api
  VERIFY --> MINT[("Mint PatchId & Debit Bank")]:::db
  
  FQ --> FLAG_RES["PATCH /admin/resolve-flag"]:::api
  FLAG_RES --> INVESTIGATE["Call Artisan (Unmasked PII)"]:::ui
  INVESTIGATE --> OVERRIDE[("APPROVE_OVERRIDE (Clears Flag)")]:::db
  
  FAC --> AOB["POST /admin/capture-on-behalf"]:::api
  AOB --> AOB_DB[("Assisted Upload for No-Phone Artisan")]:::db

  %% Nodal
  NOD --> NA["GET /api/admin/nodal-analytics"]:::api
  NA --> METRICS["View Macro Impact (Wage Uplift, Voice Adoption)"]:::ui
  
  NOD --> AT["GET /api/admin/audit-trace"]:::api
  AT --> LEDGER[("View Hash-Ledger Provenance")]:::db
  
  NOD --> EXP["GET /api/admin/export-compliance"]:::api
  EXP --> CSV["Download Compliance CSV"]:::ui
```

---

## 4. Buyer Authentication Workflow

The exact sequence when a consumer scans a physical QR code (Public route, no authentication required).

```mermaid
graph TD
  classDef ui fill:#EAF0EA,stroke:#3D624F,color:#16211B;
  classDef api fill:#FBEDE7,stroke:#8F412F,color:#3A1E16;
  classDef db fill:#ECE6DC,stroke:#8A7B63,color:#2A2418;
  classDef flag fill:#F6DBD3,stroke:#B14B39,color:#5A1E12;
  classDef ai fill:#E3E9EF,stroke:#4D5D6C,color:#1C2733;

  SCAN["Scan QR Code"]:::ui --> VGET["GET /api/verify/patchId"]:::api
  VGET --> CLIENT["VerificationClient (Server Component)"]:::ui
  
  CLIENT --> VIEW["View Artisan Story & Fair Wage Proof"]:::ui
  VIEW --> CAM["VerificationCamera (Capture 1-3 Photos)"]:::ui
  
  CAM --> VAUTH["POST /api/verify-authenticity"]:::api
  VAUTH --> GEM["Gemini Vision Comparison"]:::ai
  
  GEM --> MATCH{"similarityScore >= 75 AND isAuthentic?"}
  
  MATCH -->|Yes| SOLD[("Status: SOLD_FINAL & Reset Counters")]:::db
  SOLD --> REVEAL["Reveal Success & Trigger Final Payout"]:::ui
  
  MATCH -->|No| GRACE{"Time < 5m AND Tries < 10?"}
  GRACE -->|Yes| SOFT["Soft Reject: 'Try a different angle'"]:::api
  SOFT --> CAM
  
  GRACE -->|No| PERM[("Status: FLAGGED (Counterfeit)")]:::flag
  PERM --> HEALTH[("Artisan healthScore -15")]:::flag
```

---

## 5. The Interconnected Modal State Machine

Every modal in the UI strictly maps to a single CraftItem status transition.

```mermaid
stateDiagram-v2
  [*] --> CaptureModal: Uploads Item
  
  CaptureModal --> PENDING_VERIFICATION: POST /api/items/capture
  
  PENDING_VERIFICATION --> VERIFIED: Admin verify-batch (Mints QR)
  
  VERIFIED --> CrossCheckModal: Artisan scans physical QR
  
  CrossCheckModal --> TAG_ATTACHED: POST /api/artisan/cross-check
  
  TAG_ATTACHED --> AgentHandoffModal: Enters Agent OTP
  
  AgentHandoffModal --> ADVANCE_PAID: Route = KARIGARI_ADVANCE
  AgentHandoffModal --> SOLD_MIDDLEMAN: Route = MIDDLEMAN
  AgentHandoffModal --> LISTED_AUCTION: Route = COOP_AUCTION
  
  ADVANCE_PAID --> SOLD_FINAL: Buyer QR Authenticity Pass
  LISTED_AUCTION --> SOLD_FINAL: Simulated Admin Sale
  
  ADVANCE_PAID --> FLAGGED: Buyer scan fails (Grace expired)
  SOLD_FINAL --> FLAGGED: Buyer scan fails (Grace expired)
  
  FLAGGED --> DisputeModal: Artisan disputes counterfeit
  DisputeModal --> APPLIED_FOR_REVIEW: POST /api/artisan/request-review
  APPLIED_FOR_REVIEW --> SOLD_FINAL: Admin clears dispute
```

---

## 6. ONDC B2B Cluster Pooling & Demand Notification

How individual items are aggregated for massive wholesale orders, and how demand filters down.

```mermaid
graph LR
  classDef api fill:#FBEDE7,stroke:#8F412F,color:#3A1E16;
  classDef db fill:#ECE6DC,stroke:#8A7B63,color:#2A2418;
  classDef ext fill:#F6DBD3,stroke:#B14B39,color:#5A1E12;

  subgraph "Notification Engine"
    DEMAND["POST /api/demand (Buyer Posts)"]:::api
    DEMAND --> RANK["craftMatchScore Ranking"]:::api
    RANK --> NROWS[("Notification: DEMAND_ALERT")]:::db
    NROWS --> SMS["WhatsApp / SMS Fallback (if no internet)"]:::ext
  end

  subgraph "Cluster Pooling (BPP)"
    A1["Artisan 1 (Ikat Saree)"]:::db --> BPP["ONDC Beckn Adapter (/api/ondc/catalog)"]:::api
    A2["Artisan 2 (Ikat Saree)"]:::db --> BPP
    A3["Artisan 3 (Ikat Saree)"]:::db --> BPP
    
    BPP --> AGGREGATE["Dynamic Bulk B2B Listing (Qty: 3)"]:::ext
    AGGREGATE --> BAPP["Buyer App (Paytm / Mystore)"]:::ext
    
    BAPP --> PAY["Purchase Bulk"]:::ext
    PAY --> SPLIT["Escrow Splitter"]:::api
    SPLIT -.->|Advance| A1
    SPLIT -.->|Advance| A2
    SPLIT -.->|Advance| A3
  end
```
