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
- **Framework:** Next.js 14 App Router (React, TypeScript)
- **Database:** PostgreSQL via Prisma ORM
- **AI Models:** Google Gemini 1.5 (`@google/genai`) for Vision, Valuation, and NLP
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
