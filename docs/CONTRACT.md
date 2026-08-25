Markdown
# KARIGARI Cooperative Platform: Master Specification & Architecture

## 1. Project Overview & Mission

**KARIGARI** is an AI-powered decision engine and decentralized supply chain verification platform tailored for traditional artisan cooperatives. It bridges physical craftsmanship with verifiable digital provenance, transparent fair-wage pricing algorithms, and immediate financial liquidity.

### Core Objectives:
*   **Artisan Empowerment:** Low-barrier, voice-first digital onboarding in regional languages; eliminates middleman exploitation by providing algorithmic valuation and same-day cash advance applications.
*   **Cooperative Administration:** Macro-level dashboard oversight over artisans, cataloged inventory, fair-wage compliance metrics, disbursement approvals, and anti-counterfeiting tracking.
*   **Consumer & Buyer Trust:** Direct-to-consumer provenance verification via physical NFC/QR patch scans landing on an immutable "Digital Product Passport" (DPP).

---

## 2. System Architecture & Workflow Diagram

```mermaid
graph TD
    subgraph Artisan_Portal ["1. Artisan Workflow"]
        A1[Login / Register] --> A2[AI Voice Input: Describe in Regional Language]
        A2 -. Speech-to-Text & Auto-Tagging .-> A3[Mandatory Craft Photos Upload]
        A3 --> A4[Raw Material Bill Upload<br/>*Optional: Increases Fairness Score*]
        A4 --> A5[Scan Physical Karigari Patch<br/>*NFC/QR Linking*]
        A5 --> A6[Review & Submit Capture]
        A6 --> A7{Decision Engine<br/>*Animated Reveal*}
        A7 -- Option A: Middleman --> A8[Notify Middleman]
        A7 -- Option B/C: Auction / Karigari Advance --> A9[Route Application to Admin Queue]
    end

    subgraph Admin_Portal ["2. Cooperative Admin Workflow"]
        B1[Admin Authentication] --> B2[Global Dashboard Snapshot]
        B2 --> B3[Left Sidebar: Granular Module Toggles]
        A9 --> B4[Pending Disbursements Queue]
        B3 --> B4
        B4 --> B5[Approve Advance & Trigger Payout]
        B3 --> B6[Patch Inventory & Counterfeit Resolution]
    end

    subgraph Buyer_Flow ["3. Direct Buyer Verification"]
        C1[Scan Physical Patch on Craft<br/>*NFC/QR*] --> C2[Direct URL Bypass to Digital Passport]
        C2 --> C3[Digital Passport UI]
        C3 --> C4[Verify Authenticity, Provenance & Fair Pay]
    end

    subgraph Backend_Ledger ["4. Backend, AI & Antigravity Ledger"]
        D1[(PostgreSQL + Prisma ORM<br/>Relational Data)]
        D2((FastAPI AI Microservice<br/>Whisper + NLP))
        D3{{Antigravity Ledger<br/>Smart Contracts}}
        
        A2 -.- D2
        A6 -.- D1
        B2 -.- D1
        B5 -.- D3
        C4 -.- D3
    end
    
3. Technology Stack
Layer	Technology	Purpose
Frontend Framework	Next.js (App Router, React)	Responsive UI, SSR, dynamic routing, and fast execution
Styling & Animation	Tailwind CSS	Utility-first styling and smooth CSS scroll animations
Icons & Charts	Lucide React, Recharts	Icons, metric visualizations, line/donut charts
Hardware APIs	Web Audio API, HTML5 QR / Web NFC	In-browser microphone recording and patch scanning
App Backend	Next.js API Routes / Node.js	Auth, session control, database CRUD, workflow orchestration
AI Microservices	FastAPI (Python)	High-performance API for ML processing
AI Models	OpenAI Whisper, NLP Models	Regional speech-to-English translation and auto-tagging
Relational Database	PostgreSQL with Prisma ORM	Stores profiles, item catalogs, ledgers, and transactions
Media Storage	AWS S3 / Cloud Storage	Secure hosting for craft photos, audio, and optional bills
Trust Ledger	Antigravity / EVM Smart Contracts	Immutable audit trail, hash verification, and fair-pay logging
4. End-to-End User Workflows
A. The Landing Page (/)
Navigation Bar: KARIGARI Logo, How it Works, For Artisans, For Admins, and Login / Sign Up actions.

Hero Section: Value proposition, call-to-action buttons for Artisans and Admins, and dynamic visual preview cards showcasing Fair Wage Floor and Market Price Bands.

Note: The Buyer flow is intentionally excluded from the main site navigation to keep the landing page focused on onboarding.

B. The Buyer Flow (/verify/[patchId])
Direct Access: Triggered exclusively when a consumer scans the physical NFC tag or QR code on a craft.

Digital Passport Display:

Authenticity status validation.

Artisan profile, cooperative origin, craft type, materials, and production duration.

Fair Pay Confirmation: Direct comparison between the calculated Fair Wage Floor and the actual payout received by the artisan.

C. The Artisan Portal (/artisan/dashboard & Capture Modal)
Dashboard Overview: Displays metrics alongside recent captures and status badges.

5-Step Item Capture Process:

AI Voice Input: Artisan taps to record description in their regional language. AI transcribes, translates to English, and auto-generates descriptive tags.

Mandatory Craft Photos: Enforced multi-angle photo uploads of the finished craft.

Optional Raw Material Proof: Upload receipt/bill of raw material purchases. (Uploading increases the craft's algorithmic Fairness Score).

Patch Scan: Physical NFC/QR scan linking the unique Karigari security tag to the digital item record.

Review & Submit: Confirmation of translated text, tags, images, and patch association.

Decision Engine Reveal:

Submitting the capture triggers a smooth CSS transition displaying calculated Fair Wage Floor, Market Price Band, and Credit Risk Score.

Compares payouts: Local Middleman vs. Cooperative Auction vs. KARIGARI Same-Day Advance.

D. The Cooperative Admin Portal (/admin/dashboard)
Global Overview Dashboard: Macro stats, Fair Wage Compliance donut chart, Disbursement Trend line chart, and real-time Counterfeit/Duplicate alerts.

Sidebar Navigation Toggles: Modular views for Artisans, Captures & Items, Advances & Repayments, Patch Inventory, and Counterfeit Alerts.

5. API Data Contracts & Endpoints
A. Core JSON Schemas
Craft Item Object
JSON
{
  "id": "item_12345",
  "artisanId": "art_987",
  "patchId": "PATCH-9F8X-71A2",
  "descriptionOriginal": "కొత్త చీర. సిల్క్. పోచంపల్లి...",
  "descriptionEnglish": "New Saree. Silk. Pochampally cooperative.",
  "tags": ["Saree", "Silk", "Ikat", "Pochampally"],
  "images": ["[https://storage.karigari.coop/items/img1.jpg](https://storage.karigari.coop/items/img1.jpg)"],
  "rawMaterialProofUrl": "[https://storage.karigari.coop/bills/bill1.jpg](https://storage.karigari.coop/bills/bill1.jpg)",
  "fairnessScore": 94,
  "fairWageFloor": 7100,
  "marketPriceMin": 8800,
  "marketPriceMax": 11200,
  "status": "PENDING_DISBURSEMENT",
  "createdAt": "2026-08-15T19:30:00Z"
}
Disbursement Application Object
JSON
{
  "disbursementId": "disb_555",
  "itemId": "item_12345",
  "artisanId": "art_987",
  "selectedOption": "KARIGARI_ADVANCE",
  "cashToday": 5382,
  "totalPayoutExpected": 9800,
  "status": "PENDING_ADMIN_APPROVAL",
  "appliedAt": "2026-08-15T19:32:00Z"
}
B. REST API Endpoints
Artisan Routes

GET /api/artisan/dashboard -> Returns metrics and recent captures.

POST /api/items/capture -> Accepts multipart/form-data (audio, images, patchId); returns the created CraftItem object with valuation bands.

POST /api/disbursement/apply -> Accepts { itemId, selectedOption }; routes to Admin queue.

Admin Routes

GET /api/admin/dashboard -> Returns aggregate statistics and compliance breakdown.

GET /api/admin/disbursements/pending -> Returns array of pending applications.

POST /api/admin/disbursements/approve -> Accepts { disbursementId }; updates status and logs transaction to the Antigravity Smart Contract.

AI Microservice (FastAPI)

POST /ai/process-capture -> Accepts audio stream; returns { descriptionEnglish, tags, suggestedFairWage, suggestedMarketBand }.

6. Smart Contract Specification (Antigravity Ledger)
Only cryptographic hashes and financial verification proofs are stored on-chain to maximize efficiency and maintain immutable transparency. Using NFC and dual-tags as physical data carriers provides secure, standard-compliant links to these decentralized on-chain passports.

Solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IKarigariPassport
 * @dev Interface for the KARIGARI Digital Passport and Fair Wage verification.
 */
interface IKarigariPassport {
    
    struct CraftProof {
        address artisanWallet;
        string itemDataHash;      // IPFS/Storage SHA-256 hash of metadata
        uint256 fairWageFloor;     // Minimum fair wage floor (fiat/token units)
        uint256 finalPayout;       // Actual amount disbursed to the artisan
        uint256 timestamp;         // Block timestamp of disbursement
        bool isAuthentic;          // Authenticity validation flag
    }

    event PassportMinted(
        string indexed patchId, 
        address indexed artisanWallet, 
        uint256 finalPayout, 
        string itemDataHash
    );

    /**
     * @notice Mints an immutable digital passport upon cooperative disbursement approval.
     * @param patchId Unique hardware patch identifier.
     * @param itemDataHash SHA-256 hash of item metadata and images.
     * @param artisanWallet Address of the artisan receiving payment.
     * @param fairWageFloor Calculated minimum fair wage floor.
     * @param finalPayout Final verified payout amount disbursed to artisan.
     */
    function mintDigitalPassport(
        string calldata patchId,
        string calldata itemDataHash,
        address artisanWallet,
        uint256 fairWageFloor,
        uint256 finalPayout
    ) external;

    /**
     * @notice Fetches verification data for a scanned physical item.
     * @param patchId Unique hardware patch identifier.
     * @return CraftProof struct with proof parameters.
     */
    function getVerificationData(string calldata patchId) external view returns (CraftProof memory);
}