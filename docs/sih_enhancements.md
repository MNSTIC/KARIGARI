# KARIGARI → SIH26090 Enhancement Roadmap

> **Problem Statement:** SIH26090 — *AI-Driven Market Linkage and Smart Cataloging Mobile Application for Marginalized Artisans*
> **Ministry:** Ministry of Social Justice and Empowerment (MoSJE)
> **Category:** Software | Miscellaneous

---

## Current Architecture Snapshot

Your existing Karigari architecture is strong — it covers the **Capture-to-Sell pipeline**, hierarchical role dashboards, digital footprint ledger, and counterfeit detection. However, the SIH PS keywords emphasize three pillars that need architectural alignment:

| SIH PS Keyword | Current Coverage | Gap |
|---|---|---|
| **Market Linkage** | Partially covered (B2B/ONDC simulated) | Needs real marketplace integration, geo-demand matching |
| **Smart Cataloging** | Gemini Vision does cross-check only | No structured catalog generation, taxonomy, or searchable product index |
| **Marginalized Artisans** | Fair wage floor, advances | Needs stronger accessibility, vernacular UX, and inclusion metrics |

---

## Enhancements for SIH-Ready Architecture

### 1. Smart Cataloging Engine (Core PS Requirement)

**Gap:** The current system captures craft details via voice and runs a cross-check, but never generates a **structured, searchable product catalog** — a primary ask of the PS.

**Enhancement:**
- Auto-generate a **standardized product card** from the Phase 1 voice capture: product name, craft type (GI tag category), material, technique, region, dimensions, and AI-predicted price range.
- Build a **taxonomy classifier** that maps each craft to a hierarchical category tree (e.g., `Textiles > Handloom > Ikat > Pochampally`).
- Create a **public catalog API** that external marketplaces (ONDC, GeM, Amazon Karigar) can query with filters like region, craft type, price range, and availability.
- Implement **visual similarity search** — given a product image, find visually similar crafts in the catalog (critical for buyer discovery).

---

### 2. AI-Powered Market Linkage & Geo-Demand Matching

**Gap:** The 3-channel routing engine (B2B, ONDC, Karigari Advance) is simulated. There is no intelligent demand-supply matching.

**Enhancement:**
- Implement a **Demand Heatmap Engine** that aggregates buyer search trends, regional purchase history, and festival/seasonal demand spikes to recommend optimal selling channels to artisans.
- Add a **Buyer Discovery Feed** — a reverse marketplace where verified buyers post "demand requests" (e.g., "Need 50 Pochampally Ikat sarees for Diwali collection") and the system auto-matches them to artisan clusters with capacity.
- Build **Dynamic Pricing Advisor** — AI suggests optimal listing price per channel based on comparable sales, current demand, and the Fair Wage Floor as minimum.
- Integrate **ONDC Seller Node** (even as a staging mock with proper protocol adherence) to demonstrate real B2C/B2B routing.

---

### 3. Vernacular-First Accessibility & Inclusion Layer

**Gap:** Client-side language switching exists, but MoSJE's focus on **marginalized artisans** demands deeper accessibility.

**Enhancement:**
- **Fully voice-driven UI navigation** — not just craft capture, but the entire app flow (dashboard, sales status, payouts) navigable via voice commands in 10+ scheduled languages.
- **Pictographic UI mode** for low-literacy users — icon-heavy dashboard with minimal text, audio tooltips on tap.
- **WhatsApp/SMS fallback channel** — artisans without smartphones get catalog updates, sale notifications, and payout confirmations via WhatsApp Business API or SMS gateway.
- **Inclusion Analytics Dashboard** (Super Admin) — track artisan onboarding by SC/ST/OBC/Minority/PwD category, mapping to MoSJE's marginalization metrics.

---

### 4. Trust & Provenance Enhancement (GI Tag Integration)

**Gap:** Counterfeit detection exists but is reactive (consumer flags). The PS implies proactive **authenticity cataloging**.

**Enhancement:**
- Integrate **GI (Geographical Indication) Tag Registry** — auto-validate if an artisan's claimed craft type matches their registered GI zone.
- Generate a **Digital Provenance Certificate** per product — a public page showing: artisan identity, craft origin, materials used, AI verification score, admin sign-off, and blockchain-anchored hash.
- Add **NFC/RFID tag support** alongside QR — for premium crafts, physical NFC tags linked to the digital passport enable tap-to-verify for urban buyers.

---

### 5. Analytics & Government Reporting Module

**Gap:** Super Admin dashboard tracks admin performance but lacks the **policy-grade reporting** MoSJE would expect.

**Enhancement:**
- **Artisan Income Uplift Reports** — track pre-Karigari vs post-Karigari income per artisan cluster, exportable as PDF/CSV for ministry review.
- **Regional Craft Economy Dashboard** — live map showing craft production volume, sales velocity, average artisan income, and market penetration by district.
- **Impact KPIs aligned to MoSJE metrics:** number of marginalized artisans onboarded, income increase %, digital literacy improvement, market access expansion.
- **Auto-generated compliance reports** for PMEGP, SFURTI, and other MoSJE schemes.

---

### 6. Replacement of Gemini API with DINOv2 for Visual Intelligence

**Gap:** The current architecture relies entirely on **Google Gemini Pro Vision API** for the cross-check gate (Phase 3) and counterfeit detection. This introduces:
- **API cost dependency** — per-call pricing scales poorly with thousands of artisan verifications daily.
- **Internet requirement** — every visual verification needs a round-trip to Google's cloud, which fails in low-connectivity rural areas.
- **Vendor lock-in** — the entire visual pipeline is tied to a single proprietary API.

**Enhancement — Adopt DINOv2 (Meta's Self-Supervised Vision Transformer):**

| Aspect | Gemini Vision API (Current) | DINOv2 (Proposed) |
|---|---|---|
| **Deployment** | Cloud API (Google) | On-device / Edge server |
| **Cost** | Per-call pricing | Zero marginal cost after deployment |
| **Offline capability** | ❌ Requires internet | ✅ Fully offline inference |
| **Latency** | 500ms–2s (network dependent) | <100ms (on-device) |
| **Customizability** | Black box | Fine-tunable on Indian craft dataset |
| **Visual similarity** | General purpose | SOTA feature extraction for visual similarity |

**Implementation:**
- Deploy **DINOv2 ViT-S/14** (lightweight variant, ~22M params) as a **feature extraction backbone** — it produces rich 384-dim embeddings from craft images.
- Use these embeddings for:
  - **Cross-check verification:** Cosine similarity between original blueprint embedding and tagged-item photo embedding. Threshold ≥ 0.75 = PASS.
  - **Smart catalog visual search:** Index all craft embeddings in a FAISS vector store. Buyers search by image → instant visual similarity results.
  - **Counterfeit clustering:** Detect patterns of similar-looking fakes across regions using embedding-space clustering (DBSCAN).
- Fine-tune DINOv2 on a curated **Indian Handcraft Dataset** (GI-tagged craft images from NIFT/WDC archives) to boost accuracy on textile patterns, weave structures, and motif recognition.
- Package the model as a **TFLite / ONNX Runtime** module that runs on the artisan's phone or on a lightweight edge server (Raspberry Pi) at the cooperative office.

> [!IMPORTANT]
> DINOv2 is not a replacement for Gemini's NLP capabilities (voice parsing, fair wage calculation). It specifically replaces the **vision verification pipeline** — cross-check gate, visual similarity search, and counterfeit detection. Gemini NLP or a lighter LLM can still handle voice-to-text parsing.

---

### 7. Offline-First Architecture with Background Sync (Off-Sync)

**Gap:** The current architecture explicitly acknowledges this: *"We migrated directly to Supabase PostgreSQL, so the app currently requires an active internet connection to mint crafts."* This is a **critical failure point** for the PS — marginalized artisans in remote villages often have zero or intermittent connectivity.

**Enhancement — Implement Offline-First with Background Sync (Off-Sync Protocol):**

**Architecture:**
```
┌────────────────────────────────────────────────────┐
│                  ARTISAN'S DEVICE                  │
│                                                    │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│  │ App UI   │───▶│ Local DB │───▶│ Sync Queue   │  │
│  │ (React)  │    │ (SQLite/ │    │ (Pending Ops)│  │
│  │          │◀───│  IndexDB)│◀───│              │  │
│  └──────────┘    └──────────┘    └──────┬───────┘  │
│                                         │          │
└─────────────────────────────────────────┼──────────┘
                                          │
                              ◄ Network Available ►
                                          │
                                          ▼
                              ┌───────────────────┐
                              │   Sync Service     │
                              │  (Conflict Resolver │
                              │   + CRDT Merge)    │
                              └─────────┬─────────┘
                                        │
                                        ▼
                              ┌───────────────────┐
                              │  Supabase Cloud    │
                              │  (PostgreSQL)      │
                              └───────────────────┘
```

**Implementation:**

1. **Local-First Database:**
   - Use **SQLite (via `sql.js` or `wa-sqlite`)** in the browser/PWA or **WatermelonDB** for React Native.
   - All CRUD operations (craft capture, status updates, payout records) write to local DB first — **zero latency, zero network dependency**.

2. **Sync Queue & Background Sync:**
   - Every local write generates a **sync operation** (timestamped, with operation type: CREATE / UPDATE / DELETE) pushed to an ordered queue.
   - When network is detected (via `navigator.onLine` + periodic heartbeat), a **Background Sync worker** (Service Worker / WorkManager on Android) drains the queue → pushes ops to Supabase.
   - Use **exponential backoff** for failed syncs. Queue persists across app restarts.

3. **Conflict Resolution (CRDT-inspired):**
   - **Last-Write-Wins (LWW)** for simple fields (name, description, price).
   - **Server-Authoritative** for critical state transitions (PENDING → VERIFIED → TAG_ATTACHED). The server rejects stale transitions.
   - **Merge** for append-only data (ledger entries, audit logs) — local entries are union-merged with server entries on sync.

4. **Offline Capabilities Unlocked:**
   - ✅ Artisan can capture crafts (voice + photos) with zero internet.
   - ✅ DINOv2 runs cross-check locally (see Enhancement #6).
   - ✅ Dashboard shows locally cached data with "last synced" timestamp.
   - ✅ Payout notifications queued and delivered on next sync.
   - ⚠️ Admin verification requires eventual sync (admin may be online at cooperative office).

5. **PWA + Service Worker:**
   - Full **Progressive Web App** shell — installable, works offline, caches all static assets.
   - Service Worker intercepts API calls → serves from local DB when offline → queues mutations for sync.

> [!TIP]
> The Off-Sync architecture directly addresses the PS requirement for **marginalized artisans in remote areas** and is a strong differentiator in SIH evaluation. Judges will specifically probe whether the app works without internet — this makes it bulletproof.

---

## Summary — Enhancement Priority Matrix

| # | Enhancement | SIH PS Alignment | Effort | Impact |
|---|---|---|---|---|
| 1 | Smart Cataloging Engine | 🔴 Critical (PS core) | Medium | High |
| 2 | Market Linkage & Geo-Demand | 🔴 Critical (PS core) | High | High |
| 3 | Vernacular Accessibility | 🟡 High (MoSJE focus) | Medium | High |
| 4 | GI Tag & Provenance | 🟡 High (trust layer) | Low | Medium |
| 5 | Govt Analytics & Reporting | 🟡 High (MoSJE value) | Medium | High |
| **6** | **DINOv2 replacing Gemini Vision** | 🟢 **Differentiator** | **Medium** | **Very High** |
| **7** | **Offline-First Sync (Off-Sync)** | 🔴 **Critical (rural access)** | **High** | **Very High** |

> [!CAUTION]
> Enhancements **#6 (DINOv2)** and **#7 (Off-Sync)** are architecturally coupled — DINOv2's on-device inference is what makes offline visual verification possible. Implement them together as a unified "Edge Intelligence" module.
