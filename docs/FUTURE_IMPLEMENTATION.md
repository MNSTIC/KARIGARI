# Karigari - Future Implementation & Scaling Strategy

This document outlines the roadmap to take the Karigari SIH prototype to a 10/10 production-ready National Digital Infrastructure, specifically focusing on compliance, integrations, and predictive analytics.

---

## 1. Legality of DigiLocker & Aadhaar KYC

### The Legal Framework
Following the 2018 Supreme Court ruling, private entities **cannot** directly use the core Aadhaar authentication API (biometric/OTP) to establish identity unless they are a regulated entity (like a bank or telecom) or specifically authorized by UIDAI as a Sub-AUA (Authentication User Agency). 

However, **using the DigiLocker API is completely legal for private platforms** under the following conditions:
1. **User Consent (OAuth 2.0):** The artisan must explicitly log into DigiLocker and grant your platform permission to read their documents.
2. **Registered Requester:** The platform must register as a "Requester" on the DigiLocker partner portal.

### Implementation for SIH vs. Production
*   **Income Certificates:** These are issued by state revenue departments. If the artisan has it in their DigiLocker, Karigari can fetch it legally with their consent to prove PM Vishwakarma eligibility.
*   **The Hackathon Pitch:** You do not need production UIDAI keys for the SIH presentation. You should build a **Mock OAuth Flow**. 
*   **What to tell Judges:** *"For production, Karigari will register as a DigiLocker Requester. The artisan authorizes us via OAuth to fetch their state-issued Income Certificate and Aadhaar XML. This completely legal, consent-driven architecture allows us to 1-click verify PM Vishwakarma eligibility without handling raw biometric data."*

---

## 2. Implementing Step 2: ONDC Beckn Protocol Adapter

Converting our database to talk to the Open Network for Digital Commerce (ONDC).

*   **Can it be vibe-coded?** Absolutely. 
*   **Time Required:** ~30 to 45 minutes.
*   **ML Required:** None. This is pure data transformation.
*   **How it works:** ONDC uses the "Beckn Protocol." We simply need to create an API endpoint (e.g., `POST /api/ondc/search`) that acts as a BPP (Buyer App Provider). When a buyer app (like Paytm) broadcasts a search for "Handloom Sarees," our endpoint intercepts the webhook, queries our Prisma `CraftItem` database, and maps our database fields into the highly specific nested JSON format that Beckn requires. 
*   **Hackathon Value:** Having a working `/api/ondc/catalog` endpoint that outputs valid Beckn JSON proves to judges that your platform is a true "Open Network" node, not a closed silo.

---

## 3. Implementing Step 5: Predictive Analytics (Risk Radar)

Building a dashboard that predicts middleman exploitation before it spreads.

*   **Can it be vibe-coded?** Yes, very easily.
*   **Time Required:** 1 to 2 hours.
*   **ML Required:** For a hackathon, we do not need heavy neural networks. We can use a deterministic **Statistical Anomaly Detection (Z-Score)** or a lightweight moving-average algorithm directly in TypeScript.
*   **How it works:** 
    1. We write a Prisma aggregate query that groups all recent transactions by `clusterName` (e.g., "Odisha Ikat Cluster").
    2. We calculate the `FairWageDelta` for each transaction: `(salePrice - fairWageFloor)`.
    3. We track the 7-day moving average of this Delta. 
    4. If the Delta in a specific district suddenly drops by more than 15% (e.g., artisans are suddenly accepting much less money than the AI benchmark), it triggers a **RED** anomaly alert on the Nodal Admin Dashboard.
*   **Hackathon Value:** Instead of telling judges "we have data," you tell them "Our algorithm uses real-time moving averages to detect localized exploitation, allowing the Ministry to deploy field officers to a specific village *before* poverty deepens."

---

## 4. Hardware Integrations (Long Term)

*   **NFC / RFID Embedded Tags:** Moving beyond paper QR codes. For GI-tagged crafts (e.g., Pashmina, Kanjeevaram), a waterproof ₹5 NFC thread is woven into the fabric. Buyers tap their phone to launch the authenticity verification, making physical tag-swapping mathematically impossible.
*   **Bhashini API Integration:** Replacing Google Gemini's NLP with the Government of India's Bhashini translation API to ensure sovereign control over rural language processing.
