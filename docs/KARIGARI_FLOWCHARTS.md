# KARIGARI — Comprehensive System Flowcharts

This document provides the complete visual architecture for the KARIGARI platform, including the new "10/10 SIH" resilience layers (Offline Sync, Toll-Free IVR, WhatsApp Fallback, and ONDC Cluster Pooling).

---

## 1. The Grand Architecture (Overall System Flow)

This flowchart illustrates how all the actors, fallback systems, AI agents, and external integrations (ONDC, DigiLocker, Razorpay) connect at a high level.

```mermaid
graph TD
  classDef fe fill:#EAF0EA,stroke:#3D624F,color:#16211B;
  classDef be fill:#FBEDE7,stroke:#8F412F,color:#3A1E16;
  classDef ai fill:#E3E9EF,stroke:#4D5D6C,color:#1C2733;
  classDef gov fill:#ECE6DC,stroke:#8A7B63,color:#2A2418;
  classDef ext fill:#F6DBD3,stroke:#B14B39,color:#5A1E12;

  subgraph "Artisan Touchpoints (Inclusion Layer)"
    PWA["Karigari PWA (Smartphone)"]:::fe
    SYNC["Offline IndexedDB Sync"]:::fe
    SMS["WhatsApp / SMS Fallback (Feature Phone)"]:::fe
    IVR["Toll-Free AI IVR (No Phone/Basic)"]:::fe
  end

  subgraph "Backend Core & AI (Next.js)"
    API["Core API & State Machine"]:::be
    GEM["Gemini AI (Vision, Voice, Pricing)"]:::ai
    BHASH["Bhashini (Vernacular Voicebot)"]:::ai
    DB[("Prisma + PostgreSQL")]:::be
  end

  subgraph "Admin & Government Oversight"
    FAC["Field Facilitator (QR Minting)"]:::gov
    NODAL["Ministry Nodal Dashboard (Risk Radar)"]:::gov
  end

  subgraph "Downstream Markets & Buyers"
    ONDC["ONDC Beckn Adapter (B2B Bulk)"]:::ext
    BUYER["End Buyer (Scans Physical QR)"]:::ext
  end

  PWA -->|Online| API
  PWA -.->|Offline| SYNC
  SYNC -.->|4G Restored| API
  SMS -->|Twilio/Meta Webhook| API
  IVR -->|Audio| BHASH
  BHASH -->|Transcript| API

  API <--> GEM
  API <--> DB

  DB <--> FAC
  DB -->|Macro Data| NODAL

  DB -->|Cluster Pooling| ONDC
  BUYER -->|Scan Passport| API
```

---

## 2. Artisan Workflow (End-to-End)

This flowchart tracks the exact journey of an individual artisan, from onboarding to getting paid, including the edge cases.

```mermaid
graph TD
  classDef default fill:#f9f9f9,stroke:#333,stroke-width:2px;
  classDef action fill:#d4e6f1,stroke:#2980b9;
  classDef ai fill:#e8daef,stroke:#8e44ad;
  classDef flag fill:#fadbd8,stroke:#c0392b;
  classDef success fill:#d5f5e3,stroke:#27ae60;

  START(["Start: Artisan Logs In"]) --> DASH["Artisan Dashboard"]
  
  DASH --> CAPTURE["Initiate Cataloging"]:::action
  
  CAPTURE --> VOICECAPTURE["Step 1: Voice Dictation (Local Language)"]
  VOICECAPTURE -->|API Call| GEM_STT["Gemini AI: Extracts Craft, Labor Days, Material Cost"]:::ai
  
  GEM_STT --> PHOTOCAPTURE["Step 2: Upload/Take Photo"]
  PHOTOCAPTURE -->|API Call| GEM_VIS["Gemini AI: Authenticates Craft + Generates English Copy"]:::ai
  
  GEM_VIS --> VALUATION["Step 3: AI Fair Wage Calculation"]:::ai
  VALUATION --> PRICING["Artisan enters Asking Price"]
  
  PRICING --> GUARD{"Is Asking Price < 70% of Fair Wage?"}
  GUARD -->|Yes| FLAG["Save Item (pricingFlag = true)"]:::flag
  GUARD -->|No| PENDING["Save Item (PENDING_VERIFICATION)"]
  
  FLAG --> FAC_INTERVENTION["Facilitator Investigates (Calls Artisan)"]:::action
  FAC_INTERVENTION -->|Overridden| PENDING
  
  PENDING -.->|Waiting| VERIFIED["Admin Mints QR Patch (Status: VERIFIED)"]
  
  VERIFIED --> XC["Cross-Check Modal: Artisan confirms QR match"]:::action
  XC --> TAGGED["Status: TAG_ATTACHED"]
  
  TAGGED --> HANDOFF["Agent Handoff Modal (Give item to Delivery)"]:::action
  HANDOFF --> OTP["Input 4-Digit Agent OTP"]
  
  OTP --> ADV["Advance Paid (40% UPI Escrow)"]:::success
```

---

## 3. Admin Workflow (Facilitator & Nodal)

The Admin panel is split into two distinct views depending on the task: Field Operations (Facilitator) vs Government Oversight (Nodal).

```mermaid
graph LR
  classDef fac fill:#d1f2eb,stroke:#117a65;
  classDef nod fill:#fcf3cf,stroke:#b7950b;
  
  ADMIN(["Admin Login"]) --> SHELL{"Select View"}

  SHELL -->|Field Operations| FACILITATOR["Facilitator View"]:::fac
  SHELL -->|Oversight| NODAL["Nodal View"]:::nod

  %% Facilitator Flows
  FACILITATOR --> QUEUE["View Pending Verifications Queue"]
  QUEUE --> VERIFY_BATCH["Verify Batch & Mint QRs"]
  VERIFY_BATCH --> DEBIT["Debit Admin Patch Bank"]
  
  FACILITATOR --> FLAG_QUEUE["View Pricing Flags"]
  FLAG_QUEUE --> CALL["Call Artisan to confirm price"]
  CALL --> OVERRIDE["Approve Override or Keep Flagged"]
  
  FACILITATOR --> ASSIST["Assisted Onboarding (No Smartphone)"]
  ASSIST --> UPLOAD_BEHALF["Upload on behalf of Artisan"]

  %% Nodal Flows
  NODAL --> METRICS["View Macro Impact Metrics"]
  METRICS --> WAGE_UPLIFT["Fair Wage Uplift %"]
  METRICS --> VOICE_ADOPT["Voice Adoption vs Manual %"]
  
  NODAL --> RISK_RADAR["Predictive Risk Radar"]
  RISK_RADAR --> ALERT{"Cluster Exploitation Detected?"}
  ALERT -->|Yes| RED_FLAG["Flash RED: Middleman Activity Likely"]
  
  NODAL --> LEDGER["Immutable Audit Trace (Ledger)"]
  LEDGER --> EXPORT["Export Compliance CSV"]
```

---

## 4. Buyer Authentication & Market Flow

This is the flow executed when a buyer scans the physical product, ensuring it's not a counterfeit.

```mermaid
graph TD
  classDef buyer fill:#f0e68c,stroke:#b8860b;
  classDef ai fill:#e8daef,stroke:#8e44ad;
  classDef db fill:#d5f5e3,stroke:#27ae60;
  classDef flag fill:#fadbd8,stroke:#c0392b;

  SCAN(["Buyer Scans Physical QR Code"]) --> BROWSER["Opens Public Web Passport (No App Needed)"]:::buyer
  BROWSER --> PASSPORT["View Story, Artisan Name, and Fair-Wage Proof"]
  
  PASSPORT --> PROMPT["Prompt: 'Verify Authenticity to release final payout'"]
  PROMPT --> CAM["Buyer Takes Live Photo of the Weave"]:::buyer
  
  CAM --> API["POST /api/verify-authenticity"]
  API --> GEM["Gemini Vision: Compare Live Photo vs Original DB Photo"]:::ai
  
  GEM --> MATCH{"Similarity Score >= 75%?"}
  
  MATCH -->|Yes (Authentic)| SUCCESS["Status: SOLD_FINAL"]:::db
  SUCCESS --> PAYOUT["Trigger Razorpay API: Final Payout to Artisan"]:::db
  
  MATCH -->|No (Counterfeit/Blurry)| GRACE{"Attempts < 10 & Time < 5 mins?"}
  GRACE -->|Yes| RETRY["Soft Reject: Ask buyer to try different angle"]
  GRACE -->|No| PERM_FLAG["Status: FLAGGED (Counterfeit Suspected)"]:::flag
  PERM_FLAG --> HEALTH["Artisan Health Score Deducted (-15)"]:::flag
```

---

## 5. The Interconnected Modal State Machine

This diagram shows how the individual UI Modals are linked sequentially based on the `CraftItem.status`.

```mermaid
stateDiagram-v2
  %% State Machine of Modals
  [*] --> CaptureModal: User clicks "Catalog Item"
  
  CaptureModal --> PENDING_VERIFICATION: Submit
  
  PENDING_VERIFICATION --> VERIFIED: Admin Action
  
  VERIFIED --> CrossCheckModal: Artisan clicks "Attach Tag"
  
  CrossCheckModal --> TAG_ATTACHED: Confirms Physical Match
  
  TAG_ATTACHED --> AgentHandoffModal: Artisan clicks "Hand to Agent"
  
  AgentHandoffModal --> ADVANCE_PAID: Enters Agent OTP + Chooses Route
  
  ADVANCE_PAID --> BuyerScannerModal: Buyer Scans (Public)
  
  BuyerScannerModal --> SOLD_FINAL: Match Success
  BuyerScannerModal --> FLAGGED: Match Failed (Counterfeit)
  
  FLAGGED --> DisputeModal: Artisan clicks "Dispute Flag"
  DisputeModal --> APPLIED_FOR_REVIEW: Admin takes over
```

---

## 6. ONDC B2B Cluster Pooling Flow (Advanced)

How individual artisans serve massive B2B wholesale orders.

```mermaid
graph LR
  classDef sys fill:#aed6f1,stroke:#2874a6;
  
  A1["Artisan 1 (Saree)"] --> POOL["AI Clustering Engine"]:::sys
  A2["Artisan 2 (Saree)"] --> POOL
  A3["Artisan 3 (Saree)"] --> POOL
  
  POOL --> BPP["ONDC Beckn Adapter (BPP)"]:::sys
  BPP --> LISTING["Bulk Listing: 3 Sarees"]
  
  LISTING --> BUYER_APP["Paytm / Mystore (Buyer App)"]
  BUYER_APP --> PURCHASE["Boutique Buys Bulk"]
  
  PURCHASE --> ESCROW["Escrow Splitter"]:::sys
  ESCROW -->|Payment 1| A1
  ESCROW -->|Payment 2| A2
  ESCROW -->|Payment 3| A3
```
