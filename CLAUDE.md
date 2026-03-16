# Market Assassin - Claude Project Context

## Critical Rules

1. **No Framer.** Do not use any Framer MCP tools. This is a pure Next.js/React codebase.
2. **No Node.js on dev machine.** `npm`, `node`, `vercel` CLI are not available locally. Vercel handles builds on push.
3. **This is the DEVELOPMENT project.** Deploys to `tools.govcongiants.org`. For live `shop.govcongiants.org` changes, use `/Users/ericcoffie/govcon-shop`.
4. **Content Reaper `API_BASE` must be `''`** (empty string) in all `public/content-generator/*.html` files. Never set to an external URL — `govcon-content-generator.vercel.app` is dead.
5. **Different Supabase databases.** market-assassin and govcon-shop have SEPARATE Supabase instances. They do NOT share tables.
6. **KV store connected to BOTH projects** via Vercel Storage integration. KV backfills can run from either project.

---

## Project Overview

**Name:** Market Assassin (GovCon Tools Platform)
**Framework:** Next.js 16.1.1 with Turbopack, React 19, TypeScript, Tailwind CSS
**Database:** Supabase (PostgreSQL) | **Payments:** Stripe | **Email:** SMTP | **PDF:** jsPDF
**Roadmap:** See [`TOOL-BUILD.md`](./TOOL-BUILD.md)

---

## Related Projects

| Project | Location | Deploys To | Purpose |
|---------|----------|------------|---------|
| **Market Assassin** | This project | `tools.govcongiants.org` | Dev/staging tools |
| **GovCon Shop** | `/Users/ericcoffie/govcon-shop` | `shop.govcongiants.org` | Live shop (production) |
| **GovCon Funnels** | `/Users/ericcoffie/Projects/govcon-funnels` | `funnels.govcongiants.org` | Marketing funnel |
| **Action Planner** | `/Users/ericcoffie/Projects/govcon-planner` | GitHub: `ecoffie/action-planner` | Standalone planner (copy, not move) |
| **LinkedIn Deal Magnet** | `/Users/ericcoffie/Projects/linkedin-deal-magnet` | Dead | Reference only (31-agency knowledge base) |

---

## Tools Built

### 1. Federal Market Assassin
**Location:** `/src/app/market-assassin/`, `/src/app/federal-market-assassin/` (legacy)
**Purpose:** Market intelligence — 5 inputs + agency selection → 4-8 strategic reports
**Tiers:** Standard ($297, 4 reports) | Premium ($497, 8 reports)
**Key Files:** `market-assassin/page.tsx`, `api/reports/generate-all/route.ts`, `api/pain-points/route.ts`

### 2. Content Reaper
**Location:** `/src/app/content-generator/`, `/src/app/ai-content/`
**Purpose:** AI LinkedIn post generator — up to 30 posts/click, 250 agencies, bulk .docx/.zip export
**Tiers:** Content Engine ($197) | Full Fix ($397, advanced AI + visuals)
**Key Files:** `content-generator/page.tsx`, `api/content-generator/generate/route.ts`

### 3. Federal Contractor Database
**Location:** `/src/app/contractor-database/`
**Purpose:** 3,500+ federal contractors with SBLO contacts, filtering, export
**Price:** $497
**Key Files:** `contractor-database/page.tsx`, `api/contractors/route.ts`

### 4. Recompete Tracker
**Location:** `/src/app/expiring-contracts/`, `/src/app/recompete/`
**Purpose:** Track expiring federal contracts for recompete opportunities
**Price:** $397
**Key Files:** `expiring-contracts/page.tsx`, `api/government-contracts/search/route.ts`

### 5. Opportunity Hunter
**Location:** `/src/app/opportunity-hunter/`, `/src/app/opportunity-scout/`
**Purpose:** Find government buyers — agency spending analysis, NAICS targeting
**Price:** Free + Pro ($49)
**Key Files:** `opportunity-hunter/page.tsx`, `api/usaspending/find-agencies/route.ts`

### 6. Action Planner
**Location:** `/src/app/planner/`
**Purpose:** Task management — 5 phases, 36 tasks, progress tracking, PDF export
**Key Files:** `planner/page.tsx`, `planner/phase/[phaseId]/page.tsx`, `lib/supabase/planner.ts`

---

## Free Resources

All require email capture before download (via `ProductPageAppSumo` email gate → `/api/capture-lead`).

| Resource | Page | Download File |
|----------|------|---------------|
| SBLO Directory | `/src/app/sblo-directory/` | `/public/resources/sblo-contact-list.html` |
| Tier-2 Directory | `/src/app/tier2-directory/` | `/public/resources/tier2-supplier-list.html` |
| December Spend Forecast | `/src/app/december-spend/` | `/public/resources/december-spend-forecast.html` |
| AI Prompts (75+) | `/src/app/ai-prompts/` | `/public/resources/ai-prompts-govcon.html` |
| 2026 Action Plan | `/src/app/action-plan-2026/` | `/public/resources/action-plan-2026.html` |
| Guides & Templates | `/src/app/guides-templates/` | `/public/resources/govcon-guides-templates.html` |
| Tribal Contractor List | `/src/app/tribal-list/` | `/public/resources/tribal-contractor-list.csv` |
| Expiring Contracts CSV | `/src/app/expiring-contracts-csv/` | `/public/resources/expiring-contracts-sample.csv` |

**Templates:** `public/templates/capability-statement-template.html`, `email-scripts-sblo.html`, `proposal-checklist.html`

---

## Products & Pricing

### Individual Products
| Product | Price | Stripe Metadata |
|---------|-------|-----------------|
| Opportunity Hunter Pro | $49 | `tier: hunter_pro` |
| Alert Pro (subscription) | $19/mo | `tier: alert_pro` |
| Content Reaper | $197 | `tier: content_standard` |
| Market Assassin Standard | $297 | `tier: assassin_standard` |
| Content Reaper Full Fix | $397 | `tier: content_full_fix` |
| Recompete Tracker | $397 | `tier: recompete` |
| Federal Contractor Database | $497 | `tier: contractor_db` |
| Market Assassin Premium | $497 | `tier: assassin_premium` |

### Upgrades
| Upgrade | Price | Stripe Metadata |
|---------|-------|-----------------|
| MA Premium Upgrade | $200 | `tier: assassin_premium_upgrade` |
| Content Full Fix Upgrade | $200 | `tier: content_full_fix_upgrade` |

### Bundles
| Bundle | Price | Includes |
|--------|-------|----------|
| Starter ($697) | $943 value | Opp Hunter Pro, Recompete, Contractor DB |
| Pro Giant ($997) | $1,388 value | Contractor DB, Recompete, MA Standard, Content Gen, **1 Year Briefings** |
| Ultimate ($1,497) | $1,788 value | Content Full Fix, Contractor DB, Recompete, MA Premium, **Lifetime Briefings** |

### Memberships
| Membership | Price | Includes |
|------------|-------|----------|
| Federal Help Center | $99/mo | MA Standard + Daily Briefings (access revoked on cancel) |

---

## Access Control System

Access is managed in TWO places (both must be considered):

### Vercel KV (`@vercel/kv`) — Primary, gates actual tool access
| Tool | KV Key | Check Function |
|------|--------|----------------|
| Content Reaper | `contentgen:{email}` | `hasContentGeneratorAccess()` |
| Market Assassin | `ma:{email}` | `hasMarketAssassinAccess()` |
| Opportunity Hunter Pro | `ospro:{email}` | — |
| Alert Pro | `alertpro:{email}` | — |
| Contractor Database | `dbtoken:{token}` + `dbaccess:{email}` | — |
| Recompete | `recompete:{email}` | — |
| Daily Briefings | `briefings:{email}` | — |

**Code:** `src/lib/access-codes.ts`

### Supabase (`user_profiles` table) — Unified profile with boolean flags
`access_content_standard`, `access_content_full_fix`, `access_assassin_standard`, `access_assassin_premium`, `access_hunter_pro`, `access_recompete`, `access_contractor_db`, `access_briefings`

**Code:** `src/lib/supabase/user-profiles.ts`

### Purchase Flow (Triple-Write)
1. Customer buys via Stripe → webhook at `/api/stripe-webhook`
2. Webhook writes: Supabase `purchases` + `user_profiles` flags + Vercel KV
3. Sends confirmation email
4. Customer activates at `/activate` (email-only, no license key)

### Checking Access (for support)
```bash
curl -s -X POST https://tools.govcongiants.org/api/verify-content-generator \
  -H "Content-Type: application/json" -d '{"email":"user@example.com"}'
```

---

## Data Systems

### Agency Pain Points & Priorities
- **Database:** `src/data/agency-pain-points.json` — 250 agencies, 2,765 pain points, 2,500 spending priorities
- **Admin:** `/api/admin/build-pain-points?password=galata-assassin-2026` (`?mode=preview`, `?agency=X`, `?type=priorities`)
- **API:** `/api/pain-points` — returns `painPoints[]` and `priorities[]`
- **Used by:** Content Reaper (Step 2 prompt), Market Assassin (reports + cross-reference engine), Opportunity Hunter (agency modal)
- **Key files:** `src/lib/utils/pain-points.ts`, `src/lib/utils/pain-point-generator.ts`, `src/lib/utils/federal-oversight-data.ts`

### FY2026 Budget Authority
- **Cached data:** `src/data/agency-budget-data.json` — 47 toptier agencies
- **Sub-agency mapping:** `SUB_AGENCY_PARENT_MAP` in `budget-authority.ts` — 175 entries, 218/250 agencies (87%) resolve
- **Admin:** `/api/admin/build-budget-data?password=...&mode=build`
- **Public API:** `/api/budget-authority` — supports `?agency=`, `?type=winners|losers`, `?limit=N`
- **Key files:** `src/lib/utils/budget-authority.ts`, `src/data/agency-toptier-codes.json`

### SAT Entry Point Analysis
- Zero extra API calls — SAT (≤$250K) and micro (≤$10K) computed during existing award aggregation
- Agency type fields: `satSpending`, `satContractCount`, `microSpending`, `microContractCount`
- Market Assassin Premium: Entry Points tab with `satFriendlinessScore` (0-100)
- Opportunity Hunter: blurred SAT teaser → upgrade CTA to Market Assassin

---

## Content Reaper Internals

**Frontend:** Static HTML in `public/content-generator/` — `index.html` (~6000+ lines), `library.html`, `calendar.html`

**API Routes:**
| Route | Purpose |
|-------|---------|
| `/api/agencies/lookup` | NAICS-based agency matching |
| `/api/templates` | List content templates |
| `/api/generate` | Generate LinkedIn posts |
| `/api/generate-quote` | Generate quote card graphics |
| `/api/convert-post-to-carousel` | Post → carousel slides |
| `/api/usage`, `/api/usage/check`, `/api/usage/increment` | Usage tracking |
| `/api/verify-content-generator` | Verify access by email |
| `/api/content-generator/generate` | Alternative generation endpoint |

**CDN Libraries:** `docx@9.0.2` (.docx export), `jszip@3.10.1` (zip bundling), `file-saver@2.0.5` (`saveAs()`)

**Formatting:** API preserves `**bold**`/`*italic*` markdown. `renderMarkdown()` converts to HTML for display. `stripMarkdown()` removes markers for clipboard/graphics. Two display functions: `displayQuickGeneratedPosts()` (quick flow), `displayPosts()` (full flow).

**Generation:** Thought leadership tone (not sales pitches). 20 `CONTENT_LENSES` shuffled per generation. `previousAngles[]` from localStorage history prevents repetition. Temperature: Step 2 = 0.85, Step 3 = 0.7.

---

## Key Files & Directory Structure

| File | Purpose |
|------|---------|
| `src/lib/products.ts` | Product config with Stripe URLs (source of truth) |
| `src/app/api/stripe-webhook/route.ts` | Payment webhook — triple-write handler |
| `src/lib/supabase/user-profiles.ts` | User & access flag management |
| `src/lib/access-codes.ts` | Vercel KV access checking |
| `src/lib/send-email.ts` | All email templates |
| `src/app/page.tsx` | Homepage |
| `src/app/store/page.tsx` | Shop page |
| `src/components/BundleProductPage.tsx` | Bundle landing page template |
| `src/components/ProductPageAppSumo.tsx` | Product page template (includes email gate) |
| `src/components/federal-market-assassin/tables/AgencySelectionTable.tsx` | Agency selection with badges |
| `src/components/federal-market-assassin/reports/ReportsDisplay.tsx` | Report display with tabs |
| `src/components/federal-market-assassin/forms/CoreInputForm.tsx` | Business type + NAICS input |

```
src/
├── app/
│   ├── api/               # stripe-webhook, content-generator, reports, contractors, usaspending, admin
│   ├── market-assassin/   # Market Assassin tool
│   ├── content-generator/ # Content Reaper tool
│   ├── contractor-database/, expiring-contracts/, opportunity-hunter/, planner/
│   ├── store/, bundles/, admin/
│   └── [free resource pages]
├── components/            # BundleProductPage, ProductPageAppSumo, PurchaseGate, federal-market-assassin/
├── data/                  # agency-pain-points.json, agency-budget-data.json, agency-toptier-codes.json
└── lib/                   # products.ts, send-email.ts, access-codes.ts, supabase/, utils/
```

---

## Environment Variables

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SMTP_USER=hello@govconedu.com
SMTP_PASSWORD=...
OPENAI_API_KEY=sk-...
```

---

## Bug Prevention Rules

These patterns have caused production bugs. Follow them strictly:

1. **Never `continue` after Supabase failure** — always run KV operations unconditionally. Supabase FK constraints fail for users without auth accounts, but KV is the primary access system and must always execute.
2. **Never match comma-joined strings directly** — when filtering arrays of strings (agencies, tags, etc.), split on delimiters first then check set membership. Exact-match on `"Agency A, Agency B"` will never match individual entries.
3. **Formatting must be consistent server + client** — if the API preserves `**bold**`/`*italic*` markdown, the frontend must render it. If stripping whitespace, do it in BOTH the API route AND the display function.
4. **Always persist state after generation** — if you generate a briefing, report, or content, upsert it to the database immediately. Don't rely on downstream steps to save it. The chatbot/dashboard will try to read it later.
5. **Arrays must be `.join(' ')` not interpolated** — `${post.hashtags}` produces `"tag1,tag2"`. Always use `.join(' ')` or `.join(', ')`.
6. **Never `.slice()` user data silently** — if capping a list (agencies, results), make it explicit or configurable. Hidden `.slice(0, 15)` caps lose user data.

---

## Admin Endpoint Standard

All admin endpoints follow this pattern:
- **Auth:** `?password=galata-assassin-2026` (or `ADMIN_PASSWORD` env var)
- **GET** = read/preview (safe, no side effects)
- **POST** = execute (writes data)
- **Preview mode:** `?mode=preview` (default) shows what WOULD happen
- **Execute mode:** `?mode=execute` actually performs the operation
- **Response shape:** `{ success: boolean, message: string, data?: any, errors?: string[] }`
- **Location:** `/src/app/api/admin/{endpoint-name}/route.ts`

---

## Email Template Standard

- **Footer branding:** "GovCon Giants AI" (not "GovCon Giants")
- **From address:** `hello@govconedu.com`
- **Support email:** `service@govcongiants.com` (watch for missing 's' typo: `govcongiant.com`)
- **Phone:** 786-477-0477
- **Include:** activation link to `/activate`, "Manage preferences" link, "Unsubscribe" link
- **Product-specific templates:** each product gets its own `send{Product}Email` function in `send-email.ts`

---

## Data Sourcing Standards

- Government data must cite authoritative sources: GAO reports, IG audits, CRS analyses, USASpending API, SAM.gov, OMB budget documents
- Never use generic/unverified sources for agency-specific claims
- Document coverage percentage when expanding databases (e.g., "218/250 agencies = 87%")
- All agency data stored in `src/data/` as JSON, built via admin endpoints

---

## Common Development Tasks

### Adding a New Tool
1. Create page in `/src/app/{tool-name}/page.tsx`
2. Create API routes in `/src/app/api/{tool-name}/`
3. Add product to `/src/lib/products.ts`
4. Add access flag logic to `/src/lib/supabase/user-profiles.ts`
5. Add email template to `/src/lib/send-email.ts`
6. Update webhook to handle the new product

### Adding a New Market Assassin Report
1. Create API route in `/src/app/api/{report-name}/route.ts`
2. Add to `/src/app/api/reports/generate-all/route.ts`
3. Update ReportsDisplay UI

---

## Recent Work History

> Full session history (Sessions 1-18) is in MEMORY.md.

### Session 25 (Mar 16, 2026)
- **Alert Pro Subscription** — new $19/mo tier that includes OH Pro access
  - Alert Pro Product: `prod_U9rOClXY6MFcRu`, Price: `price_1TBXfuK5zyiZ50PBWbdLfZ3F`
  - Payment Link: `https://buy.stripe.com/8x24gA1oifvAcFv3OEfnO0y`
  - Webhook updated to grant `ospro:{email}` KV + `hunter_pro` access flag
- **Tools OH Synced with Shop** — email-gate-first flow (3 agencies → email → 10 agencies)
  - Weekly alerts auto-signup on email capture
  - Dual upgrade options: Alert Pro ($19/mo) vs Tool Only ($49)
- **GovCon Funnels /opp Redesign** — visual storytelling landing page
  - Hero with browser chrome tool mockup
  - Video demo section (placeholder)
  - Before/After comparison (4 pain points)
  - Sample alert email preview
  - Pricing comparison + Market Assassin upsell
  - Commit: `9da94d7`

### Session 24 (Mar 15, 2026)
- **Lindy Intelligence API** — unified endpoint for Lindy AI automation
  - `/api/lindy/intelligence?email=X` — returns briefings, recompetes, contractor activity, recommended actions
  - `/api/lindy` — API documentation endpoint
  - `/api/admin/send-test-briefing?email=X` — generates AND sends briefing email (not just saves)
  - Recommended actions include: deadline alerts, content angles, competitor watch, outreach suggestions
  - Data freshness metadata for polling optimization
- **Commit:** `c09f164`

### Session 23 (Mar 14, 2026)
- **Multi-NAICS Support** — users can enter comma-separated NAICS codes (e.g., "236, 238, 541511")
  - New utility: `src/lib/utils/naics-expansion.ts` with `parseNAICSInput()`, `expandNAICSCode()`, `expandNAICSCodes()`
  - Prefix expansion: "236" → all 236xxx codes, "23" → all construction codes
  - Updated `CoreInputForm.tsx` placeholder: "e.g., 236, 238320, 541511"
- **Smart Sampling for Agency Recommendations** — two-pass fetch strategy
  - Pass 1: 5K contracts by Award Amount (biggest contracts)
  - Pass 2: 5K contracts by Award Date (most recent)
  - Deduplication by Award ID prevents double-counting
  - Multi-NAICS searches get 10K total vs 5K for single NAICS
- **Alert Profile Multi-NAICS** — `save-profile/route.ts` now accepts:
  - `naicsCodes[]` array, `naicsInput` string, or `pscCode` (expands via crosswalk)
  - All inputs merged and expanded before saving
- **TypeScript Fix** — `generate-all/route.ts` now uses `getMarketAssassinTier(email)` instead of `auth.tier`
- **Commits:** `db482e2`, `edec40a`, `4f661e0`, `6e61cad`

### Session 22 (Mar 13, 2026)
- **Test Protocol Page** — password-protected QA dashboard at `/test-protocol`
  - 18 automated API smoke tests across 5 categories: health checks, access denial, data endpoints, lead capture, content library
  - 28-item manual QA checklist across 12 sections with localStorage persistence
  - Deploy health monitor: git commit SHA, hostname, last test run timestamp
  - Dark theme, summary bar, sequential test runner with 200ms delay, collapsible response previews
  - Reuses `/api/admin/verify-password` — no new API routes or dependencies
  - Files: `src/app/test-protocol/page.tsx` (server), `src/app/test-protocol/TestProtocolClient.tsx` (client)
- **GovCon Funnels Hydration Fix** — fixed `BootcampBanner.tsx` countdown timer hydration mismatch
  - `useState(Date.now())` caused server/client mismatch
  - Fixed: defer render until after mount (`mounted` state flag)

### Session 21 (Mar 11, 2026)
- **Daily Briefings E2E Testing** — debugged and fixed briefing generation returning 0 items
  - Fixed mock data field names to match TypeScript interfaces (`incumbent` → `incumbentName`, `currentValue` → `obligatedAmount`)
  - Updated seed endpoint with real USASpending contract numbers (W91RUS18C0024, W91QVN19F0222)
- **Recompete Action URLs** — changed from SAM.gov search to USASpending keyword search
  - `src/lib/briefings/diff-engine.ts` now links to `usaspending.gov/keyword_search/{contractNumber}`
- **Recompete Tracker USASpending Links** — `public/recompete.html`
  - Made Award IDs clickable links to USASpending
  - Added "View on USASpending" button at bottom of contract modal
- **"Last Updated" Bug Fix** — fixed misleading date display in Recompete Tracker
  - Was showing "Sep 2021" due to broken string-based date sorting
  - Fixed to properly sort Date objects and show newest contract start date
  - Renamed label from "Last Updated" to "Data Through" (more accurate)
  - Verified data is real: 554 contracts with 2025 start dates, all verified against USASpending API
- **Admin endpoints:**
  - `/api/admin/debug-snapshots?email=X` — inspect raw snapshot data for debugging
  - `/api/admin/seed-test-briefing?email=X` — seed mock data and generate briefing for testing

### Session 20 (Mar 11, 2026)
- **Briefing Log Persistence Fix** — `send-briefings` cron now upserts to `briefing_log` after generation + updates delivery status
- **Public Briefing API** — `GET /api/briefings/latest?email=X&days=N` returns briefing JSON, gated by KV
- **Briefing Dashboard** at `/briefings` — email gate, date sidebar, expandable item cards, empty/denied states
- **Lindy Setup Guide** at `/briefings/lindy-setup` — instructions for API polling or email forwarding to Lindy/Zapier/Make
- **Admin endpoints:**
  - `/api/admin/grant-briefings?grant=EMAIL` — quick single-email KV grant
  - `/api/admin/test-briefing?email=EMAIL` — generate + save one briefing (no delivery)
  - `/api/briefings/verify` — lightweight access check
- **Homepage** — added Daily Briefings card (6 cards, 3-col grid)
- **Branding** — all briefing footers updated to "GovCon Giants AI"

### Session 19 (Mar 8, 2026)
- **Daily Briefings System** — personalized daily GovCon intel emails
  - Web intelligence pipeline: FPDS health monitoring + SAM.gov fallback
  - Briefing generation with Groq API, delivery via cron
  - Cost: ~$2.85/user/month at scale
- **Federal Help Center Integration** — $99/mo membership handling
  - FHC members get MA Standard + Daily Briefings automatically
  - Stripe webhook handles `checkout.session.completed` for new members
  - Subscription cancellation revokes access (`customer.subscription.deleted`, `customer.subscription.updated`)
  - FHC Product IDs: `prod_TaiXlKb350EIQs`, `prod_TMUmxKTtooTx6C`
- **Product-specific email templates** — route to correct email per product
  - New templates: `sendContentReaperEmail`, `sendRecompeteEmail`, `sendBundleEmail`, `sendFHCWelcomeEmail`
- **Admin endpoints:**
  - `/api/admin/sync-fhc-members` — pull FHC subscribers from Stripe, grant access
  - `/api/admin/grant-briefings` — batch grant briefings to existing members
  - `/api/admin/user-audit` — check duplicates, bundle mismatches, fix access flags
  - `/api/admin/fpds-health` — FPDS API health monitoring

### Session 18 (Feb 21, 2026)
- Fixed all 8 free download pages — `checkoutUrl` pointing to actual resource files
- Added email gate to `ProductPageAppSumo` for free resources (captures leads to Supabase)
- Expanded `/free-resources` page: 5 → 11 resources
- Store page fixes: Content Reaper link, agency count 175 → 250

### Session 17 (Feb 18, 2026)
- SAT Entry Point Analysis — zero extra API calls, computed during existing aggregation
- Market Assassin Premium: Entry Points tab with satFriendlinessScore ranking
- AgencySelectionTable: 5 sort mode pills, "Easy Entry" badge for >50% SAT agencies
- Opportunity Hunter: blurred SAT teaser with Market Assassin upgrade CTA
- FY2026 budget data expanded: 23 → 47 toptier agencies, 175-entry sub-agency parent map

*Last Updated: March 16, 2026*
