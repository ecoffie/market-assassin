# Market Assassin - Claude Project Context

## IMPORTANT: No Framer
**This project does NOT use Framer.** Do not use any Framer MCP tools (mcp__framer-mcp__*) for this project. This is a pure Next.js/React codebase.

---

## Related GovCon Projects (Quick Reference)

| Project | Location | Identifier | Purpose |
|---------|----------|------------|---------|
| **GovCon Funnels** | `/Users/ericcoffie/govcon-funnels` | "$82B hero page" | Marketing funnel (govcongiants.org) |
| **Market Assassin** | This project | "tools", "market assassin" | Dev/staging tools |
| **GovCon Shop** | `/Users/ericcoffie/govcon-shop` | "live shop", "production" | Live shop (shop.govcongiants.org) |
| **Action Planner** | `/Users/ericcoffie/Projects/govcon-planner` | "planner", "action planner" | Standalone planner ([github.com/ecoffie/action-planner](https://github.com/ecoffie/action-planner)) |

---

## Tool Development Roadmap

**See:** [`TOOL-BUILD.md`](./TOOL-BUILD.md) for comprehensive feature list and development priorities for all tools.

---

## Project Overview
**Name:** Market Assassin (GovCon Tools Platform)
**Purpose:** Development/staging environment for GovCon Giants tools
**Framework:** Next.js 16.1.1 with Turbopack
**Database:** Supabase
**Payments:** Stripe

## Project Location
```
/Users/ericcoffie/Market Assasin/market-assassin
```

**IMPORTANT:** This is the DEVELOPMENT project. The LIVE shop is at `/Users/ericcoffie/govcon-shop`. When making changes intended for production on shop.govcongiants.org, work in the govcon-shop folder instead.

## Tech Stack
- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backend:** Next.js API Routes
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth + Custom license/access tokens
- **Payments:** Stripe (payment links + webhooks)
- **Email:** Resend / SMTP
- **PDF Generation:** jsPDF

---

## Tools Built

### 1. Federal Market Assassin
**Location:** `/src/app/market-assassin/`, `/src/app/federal-market-assassin/`
**Purpose:** Market intelligence system for GovCon

**Features:**
- Enter 5 inputs + select target agencies
- Generates 4-8 strategic reports (Standard vs Premium)
- Reports: Pain Points, Government Buyers, Agency Spend, OSBP Contacts, Subcontracting, IDV Contracts, Similar Awards, Tribal Contracting

**Tiers:**
- Standard ($297): 4 reports
- Premium ($497): 8 reports

**Key Files:**
- `/src/app/market-assassin/page.tsx` - Main tool page
- `/src/app/api/reports/generate-all/route.ts` - Report generation API
- `/src/app/api/pain-points/route.ts` - Pain points API

---

### 2. Content Reaper
**Location:** `/src/app/content-generator/`, `/src/app/ai-content/`
**Purpose:** AI-powered LinkedIn post generator for GovCon

**Features:**
- Generate up to 30 LinkedIn posts per click
- 250 federal agencies supported (pain points database)
- GovCon-tuned AI model
- GEO Boost optimization
- Multiple content styles
- Bulk export: Export All as .docx (all tiers), Download All Visuals as .zip (Full Fix only)

**Tiers:**
- Content Engine ($197): Standard generation
- Full Fix ($397): Advanced AI, premium templates

**Key Files:**
- `/src/app/content-generator/page.tsx` - Main tool
- `/src/app/api/content-generator/generate/route.ts` - Generation API

---

### 3. Federal Contractor Database
**Location:** `/src/app/contractor-database/`
**Purpose:** Searchable database of federal contractors

**Features:**
- 3,500+ federal contractors
- SBLO contact information
- Teaming partner finder
- Vendor portal links
- Advanced filtering
- Export capabilities

**Price:** $497 (one-time)

**Key Files:**
- `/src/app/contractor-database/page.tsx` - Database interface
- `/src/app/api/contractors/route.ts` - Contractors API

---

### 4. Recompete Tracker
**Location:** `/src/app/expiring-contracts/`, `/src/app/recompete/`
**Purpose:** Track expiring federal contracts for recompete opportunities

**Features:**
- Contracts expiring in 12 months
- Prime contractor details
- NAICS code filtering
- Historical performance data
- Agency breakdown
- Export to CSV

**Price:** $397 (one-time)

**Key Files:**
- `/src/app/expiring-contracts/page.tsx` - Main tracker
- `/src/app/api/government-contracts/search/route.ts` - Contract search API

---

### 5. Opportunity Hunter
**Location:** `/src/app/opportunity-hunter/`, `/src/app/opportunity-scout/`
**Purpose:** Find government buyers for your products/services

**Features:**
- Agency spending analysis
- Prime contractor matching
- NAICS-based targeting
- Historical spend data
- Free tier + Pro ($49)

**Key Files:**
- `/src/app/opportunity-hunter/page.tsx` - Main tool
- `/src/app/api/usaspending/find-agencies/route.ts` - USASpending API

---

### 6. Action Planner Dashboard
**Location:** `/src/app/planner/`
**Purpose:** Task management for 2026 GovCon Action Plan

**Features:**
- 5 phases, 36 total tasks
- Progress tracking with visual indicators
- Task notes and due dates
- Resource library (videos, templates)
- PDF export

**Key Files:**
- `/src/app/planner/page.tsx` - Dashboard
- `/src/app/planner/phase/[phaseId]/page.tsx` - Phase detail
- `/src/app/planner/resources/page.tsx` - Resources library
- `/src/lib/supabase/planner.ts` - Planner utilities

---

## Free Resources / PDFs

| Resource | Location |
|----------|----------|
| SBLO Directory | `/src/app/sblo-directory/` |
| Tier-2 Directory | `/src/app/tier2-directory/` |
| December Spend Forecast | `/src/app/december-spend/` |
| AI Prompts (75+) | `/src/app/ai-prompts/` |
| 2026 Action Plan | `/src/app/action-plan-2026/` |
| Guides & Templates | `/src/app/guides-templates/` |
| Tribal Contractor List | `/src/app/tribal-list/` |
| Expiring Contracts CSV | `/src/app/expiring-contracts-csv/` |

---

## Directory Structure

```
src/
├── app/
│   ├── api/                      # API routes
│   │   ├── stripe-webhook/       # Stripe payment handling
│   │   ├── content-generator/    # AI content generation
│   │   ├── reports/              # Market Assassin reports
│   │   ├── contractors/          # Database APIs
│   │   ├── usaspending/          # USASpending integration
│   │   └── ...
│   ├── market-assassin/          # Market Assassin tool
│   ├── content-generator/        # Content Reaper tool
│   ├── contractor-database/      # Contractor Database
│   ├── expiring-contracts/       # Recompete Tracker
│   ├── opportunity-hunter/       # Opportunity Hunter
│   ├── planner/                  # Action Planner
│   ├── store/                    # Shop page
│   ├── bundles/                  # Bundle landing pages
│   ├── admin/                    # Admin panel
│   └── ...
├── components/
│   ├── BundleProductPage.tsx     # Bundle landing template
│   ├── ProductPageAppSumo.tsx    # Product page template
│   ├── PurchaseGate.tsx          # Access gate component
│   └── ...
└── lib/
    ├── products.ts               # Product config & Stripe URLs
    ├── send-email.ts             # Email templates
    └── supabase/
        ├── client.ts             # Supabase client
        ├── user-profiles.ts      # User/access management
        └── planner.ts            # Planner utilities
```

---

## Products & Pricing

### Individual Products
| Product | Price | Stripe Metadata |
|---------|-------|-----------------|
| Opportunity Hunter Pro | $49 | `tier: hunter_pro` |
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
| Bundle | Price | Value | Savings |
|--------|-------|-------|---------|
| Starter Bundle | $697 | $943 | $246 |
| Pro Giant Bundle | $997 | $1,388 | $391 |
| Ultimate Bundle | $1,497 | $1,788 | $291 |

---

## Access Control System

### Access Flags (user_profiles table)
| Flag | Products That Grant It |
|------|------------------------|
| `access_hunter_pro` | Opp Hunter Pro, Starter, Ultimate |
| `access_content_standard` | Content Reaper, Pro, Ultimate |
| `access_content_full_fix` | Content Full Fix, Ultimate |
| `access_assassin_standard` | MA Standard, Pro, Ultimate |
| `access_assassin_premium` | MA Premium, Ultimate |
| `access_recompete` | Recompete, Starter, Pro, Ultimate |
| `access_contractor_db` | Contractor DB, Starter, Pro, Ultimate |

### Purchase Flow
1. Customer clicks Buy → Stripe Checkout
2. Stripe webhook → `/api/stripe-webhook`
3. Webhook saves purchase, creates user profile, updates access flags
4. Sends license key email
5. Customer activates at `/activate`

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `/src/lib/products.ts` | Product config with Stripe URLs |
| `/src/app/api/stripe-webhook/route.ts` | Payment webhook handler |
| `/src/lib/supabase/user-profiles.ts` | User & access management |
| `/src/lib/send-email.ts` | All email templates |
| `/src/app/page.tsx` | Homepage |
| `/src/app/store/page.tsx` | Shop page |

---

## Environment Variables

```env
# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Email
SMTP_USER=hello@govconedu.com
SMTP_PASSWORD=...

# OpenAI (for content generator)
OPENAI_API_KEY=sk-...
```

---

## Common Development Tasks

### Run Development Server
```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"
npm run dev
```

### Build for Production
```bash
npm run build
```

### Adding a New Tool
1. Create page in `/src/app/{tool-name}/page.tsx`
2. Create API routes in `/src/app/api/{tool-name}/`
3. Add product to `/src/lib/products.ts`
4. Add access flag logic to `/src/lib/supabase/user-profiles.ts`
5. Add email template to `/src/lib/send-email.ts`
6. Update webhook to handle the new product

### Adding a New Report to Market Assassin
1. Create API route in `/src/app/api/{report-name}/route.ts`
2. Add to report generation in `/src/app/api/reports/generate-all/route.ts`
3. Update UI to display new report

---

## Action Planner Phases

| Phase | Tasks | Type |
|-------|-------|------|
| Phase 1: Setup | 12 | One-time |
| Phase 2: Bidding | 6 | Repeatable |
| Phase 3: Business Development | 7 | Repeatable |
| Phase 4: Business Enhancement | 7 | One-time |
| Phase 5: Contract Management | 4 | Ongoing |

**Total:** 36 tasks

---

## Content Reaper (Critical Details)

**Frontend:** Static HTML files in `public/content-generator/`
- `index.html` — Main content generator UI (~6000+ lines)
- `library.html` — Saved posts library
- `calendar.html` — Content calendar (FullCalendar)

**API Routes (Next.js):**
| Route | Purpose |
|-------|---------|
| `/api/agencies/lookup` | NAICS-based agency matching (USASpending API) |
| `/api/templates` | List content templates |
| `/api/generate` | Generate LinkedIn posts |
| `/api/generate-quote` | Generate quote card graphics |
| `/api/convert-post-to-carousel` | Convert post to carousel slides |
| `/api/usage` | Track daily post usage |
| `/api/usage/check` | Check usage limits |
| `/api/usage/increment` | Increment usage counter |
| `/api/verify-content-generator` | Verify user access by email |
| `/api/content-generator/generate` | Alternative generation endpoint |

**CDN Libraries (loaded in index.html `<head>`):**
- `docx@9.0.2` — .docx file generation for bulk post export
- `jszip@3.10.1` — zip bundling for bulk visual export
- `file-saver@2.0.5` — `saveAs()` for reliable blob downloads

**Bulk Export Functions (index.html):**
- `exportAllPostsToDocx()` — exports all `generatedPosts` to Word doc, one post per page, hashtags in LinkedIn blue. `parseMarkdownLine()` converts `**bold**`/`*italic*` to Word TextRuns. Blank lines get `spacing: { after: 200 }`, `- ` lines render as Word bullets.
- `downloadAllVisuals()` — generates quote card PNGs for each post (cycles 6 `quoteCardStyles` themes), bundles into .zip. Gated on `hasGraphicsAccess` (Full Fix tier only)

**Formatting Pipeline (index.html):**
- `renderMarkdown(text)` — HTML-escapes, strips leading whitespace, converts `**bold**` → `<strong>`, `*italic*` → `<em>`. Used for web display.
- `stripMarkdown(text)` — removes all `*` markers. Used for clipboard copy and graphic API calls.
- Two display functions: `displayQuickGeneratedPosts()` (quick flow) and `displayPosts()` (full flow with expand/collapse)

**CRITICAL:** `API_BASE` in all three HTML files MUST be `''` (empty string) for same-origin API calls. NEVER set it to an external URL like `govcon-content-generator.vercel.app` — that deployment is dead.

---

## Dual Access Control System

Access is managed in TWO places (both must be considered):

### 1. Vercel KV (`@vercel/kv`) — Primary for individual tools
- **Content Reaper:** `contentgen:{email}` key → checked by `hasContentGeneratorAccess()`
- **Market Assassin:** `ma:{email}` key → checked by `hasMarketAssassinAccess()`
- **Opportunity Hunter Pro:** `ospro:{email}` key
- **Contractor Database:** `dbtoken:{token}` + `dbaccess:{email}` keys
- **Recompete:** `recompete:{email}` key
- **Code:** `src/lib/access-codes.ts`

### 2. Supabase (`user_profiles` table) — Unified profile with boolean flags
- `access_content_standard`, `access_content_full_fix`
- `access_assassin_standard`, `access_assassin_premium`
- `access_hunter_pro`, `access_recompete`, `access_contractor_db`
- **Code:** `src/lib/supabase/user-profiles.ts`

### Checking user access (e.g., for support):
```bash
curl -s -X POST https://tools.govcongiants.org/api/verify-content-generator \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

---

## Related Projects

| Project | Location | Deploys To | Purpose |
|---------|----------|------------|---------|
| **Market Assassin** | This project | `tools.govcongiants.org` | All GovCon tools (active) |
| **Action Planner** | `/Users/ericcoffie/Projects/govcon-planner` | GitHub: `ecoffie/action-planner` | Standalone planner (extracted Feb 11) |
| **LinkedIn Deal Magnet** | `/Users/ericcoffie/Projects/linkedin-deal-magnet` | Dead Vercel deployment | Original Express backend (reference only) |
| **GovCon Funnels** | `/Users/ericcoffie/govcon-funnels` | `govcongiants.org` | Marketing funnel |
| **GovCon Shop** | `/Users/ericcoffie/govcon-shop` | `shop.govcongiants.org` | Live shop (production) |

---

## Notes for Claude

1. **This is the DEVELOPMENT project** - For live shop.govcongiants.org changes, use `/Users/ericcoffie/govcon-shop`

2. **Products file is key** - `/src/lib/products.ts` has all Stripe URLs and product configs

3. **Two Market Assassin pages** - `/market-assassin/` and `/federal-market-assassin/` (legacy)

4. **Access is email-based** - Users enter purchase email at `/activate` to see unlocked tools (no license key required)

5. **Webhook handles everything** - Stripe webhook does triple-write: Supabase purchases + user_profiles flags + Vercel KV

6. **No Node.js on dev machine** - Can't run `npm run build` locally. Vercel handles builds on push

7. **Content Reaper HTML uses same-origin API** - Never hardcode external API URLs in `public/content-generator/*.html`

8. **No Node.js on dev machine** - `npm`, `node`, `vercel` CLI are not available locally

9. **Two access systems** - Vercel KV (access-codes.ts) AND Supabase (user-profiles.ts). Check both when debugging access issues.

10. **linkedin-deal-magnet repo** - Contains agency knowledge base (31 agencies), viral hooks, and content templates. Reference only — don't deploy from there.

11. **Different Supabase databases** - market-assassin and govcon-shop have SEPARATE Supabase instances. They do NOT share `user_profiles` or `purchases` tables.

12. **KV store connected to BOTH projects** - Vercel KV `market-assassin-codes` is connected to both market-assassin and govcon-shop via Vercel Storage integration. KV backfills can run from either project now.

13. **Admin backfill endpoints** - `/api/admin/backfill-kv` reads Stripe checkout sessions and grants KV access based on tier/bundle metadata. Use for new customer onboarding issues.

14. **Action Planner standalone repo** - `github.com/ecoffie/action-planner` at `/Users/ericcoffie/Projects/govcon-planner`. Copy of planner extracted Feb 11. Planner files remain in market-assassin too — this is a copy, not a move. Uses its own Supabase instance, no MA dependencies.

---

## Agency Pain Points & Priorities System

**Database:** `src/data/agency-pain-points.json` — 250 agencies, 2,765 pain points, 2,500 spending priorities
**Admin Endpoint:** `/api/admin/build-pain-points` — generates pain points + priorities via Grok AI + USASpending + GAO/IG data
- Auth: `?password=galata-assassin-2026`
- `?mode=preview` — dry run showing gaps
- `?agency=X` — single agency generation
- `?type=priorities` — generate priorities instead of pain points

**Pain Points** = problems agencies struggle with (GAO findings, IG challenges, audit failures)
**Spending Priorities** = where agencies are actively spending money (funded programs, budget line items)

**Used by:**
- **Content Reaper** (`/api/content-generator/generate`) — both pain points and priorities fed into Step 2 prompt for thought leadership content
- **Market Assassin** (`/api/reports/generate-all`) — Pain Points report with cross-referencing, NAICS relevance scoring, and high-opportunity matches
- **Market Assassin** (AgencySelectionTable) — agency modal shows pain points + spending priorities sections
- **Opportunity Hunter** (`/api/pain-points`) — agency modal shows pain points + spending priorities
- **Pain Points API** (`/api/pain-points`) — returns both `painPoints` and `priorities` arrays

**Cross-Reference Engine (Market Assassin):**
- 10 areas: Cybersecurity, IT Modernization, Infrastructure, Data & Analytics, Workforce, Supply Chain, Healthcare, Energy & Climate, Compliance, Communications
- Finds agencies with BOTH a pain point AND spending priority in the same area → "high-opportunity match"
- NAICS keyword mapping scores relevance (high/medium/low) against user's NAICS code
- HTML/PDF report, CSV export, and agency modal all show priorities

**Business Types (CoreInputForm):**
- Women Owned, HUBZone, 8(a) Certified, Small Business, Native American/Tribal
- DOT Certified was removed (Feb 10, 2026) — it mapped to same codes as Small Business
- Veteran Status is a separate optional field: Not Applicable, Veteran Owned, Service Disabled Veteran

**Key Files:**
| File | Purpose |
|------|---------|
| `src/data/agency-pain-points.json` | 250 agencies with painPoints[] and priorities[] |
| `src/lib/utils/pain-points.ts` | `getPainPointsForAgency()`, `getPrioritiesForAgency()` |
| `src/lib/utils/pain-point-generator.ts` | Grok-powered generation |
| `src/lib/utils/federal-oversight-data.ts` | GAO High Risk, IG challenges, spending priorities seed data |
| `src/lib/utils/agency-list-builder.ts` | USASpending agency fetcher |
| `src/app/api/admin/build-pain-points/route.ts` | Admin pipeline endpoint |
| `src/components/federal-market-assassin/tables/AgencySelectionTable.tsx` | Agency modal with pain points + spending priorities |
| `src/components/federal-market-assassin/reports/ReportsDisplay.tsx` | Report display with dynamic month/quarter labels |
| `src/components/federal-market-assassin/forms/CoreInputForm.tsx` | Business type + PSC/NAICS input form |

---

## Recent Work History

### February 18, 2026 (Session 17)
- **Simplified Acquisition (SAT) Entry Point Analysis — Zero Extra API Calls**
  - Computes SAT (≤$250K) and micro-purchase (≤$10K) metrics during existing award aggregation in 3 routes: `find-agencies`, `government-contracts/search`, `agencies/lookup`
  - New fields on Agency type: `satSpending`, `satContractCount`, `microSpending`, `microContractCount`
  - DoD expansion distributes SAT metrics proportionally (same as spending) via updated `expandGenericDoDAgency()`
  - `satSummary` added to find-agencies JSON response
- **Market Assassin: Entry Points Tab (Premium)**
  - `SimplifiedAcquisitionReport` type with `SimplifiedAcquisitionAgency[]` — ranked by `satFriendlinessScore` (0-100 composite: 60% SAT%, 20% micro%, 20% volume)
  - Accessibility levels: high (>50% SAT), moderate (25-50%), low (<25%)
  - `generate-all/route.ts` builds report from `selectedAgencyData` SAT fields
  - New "Entry Points" tab in ReportsDisplay: summary cards, ranked agency table with color-coded badges, strategic recommendations
  - Tab is premium-locked (standard tier sees LockedSectionOverlay)
- **Market Assassin: "Easy Entry" Badge**
  - Amber badge in AgencySelectionTable next to agency names with >50% SAT contracts
  - Shows alongside existing budget trend badges
- **Opportunity Hunter: Blurred SAT Teaser**
  - Blurred "Entry Points" column in results table showing real-but-hidden SAT % values
  - Upgrade CTA banner: "Entry Point Analysis Available — Unlock with Market Assassin"
  - Blurred "Simplified Acquisition Analysis" section in agency modal with upgrade link
  - All users (free and Pro) see the blur — this is a Market Assassin feature, not OH Pro
- **Build Fix: `OfficeSpending` interface**
  - `government-contracts/search` uses typed `OfficeSpending` from `src/lib/government-contracts.ts` (not `any`)
  - Added `satSpending`, `satContractCount`, `microSpending`, `microContractCount` to interface
- **AgencySelectionTable: Sort Mode Pills**
  - 5 sort modes above table: $ Top Spending (default), Easy Entry (SAT %), Budget Growth, Contracts, A-Z
  - Cyan pill for active sort, click again to toggle asc/desc
  - "Top 10/20" buttons select from current sort order
- **Entry Points Tab: Sortable Column Headers**
  - All 6 columns (Agency, SAT %, SAT Contracts, Avg Award, Micro, Score) clickable to sort
  - Active column highlighted in cyan with direction arrow, default sort by Score desc

### February 18, 2026 (Session 16)
- **FY2026 Budget Data Expansion: 23 → 47 toptier agencies**
  - Added 24 independent agencies to `agency-budget-data.json` with verified OMB FY2026 data
  - Key additions: USAID (cut -47%), NRC (stable +3%), SEC (stable), FTC (declining -10%), EEOC (stable -4%), NLRB (stable -5%), CFTC (growing +12%), CPSC (declining -11%), MCC (cut -76%), Smithsonian (cut -27%), NARA (stable), GAO (stable), Peace Corps (stable), FDIC/CFPB/FCC/TVA (self-funded, stable)
- **Sub-Agency → Parent Toptier Mapping**
  - Added `SUB_AGENCY_PARENT_MAP` to `budget-authority.ts` — 175 entries mapping all sub-agencies to parent toptier
  - Covers all DoD commands (DARPA, DLA, DISA, combatant commands), HHS agencies (CDC, CMS, FDA, NIH), DHS (FEMA, CISA, CBP, ICE), and all other department sub-agencies
  - Updated `getBudgetForAgency()` with parent map fallback + fuzzy parent map fallback
  - **Coverage: 218/250 pain-point agencies (87%)** now resolve to budget trend data
  - Remaining 32 uncovered are tiny boards/commissions where budget trends aren't meaningful

### February 17, 2026 (Session 15)
- **Content Reaper: Generation Memory System**
  - localStorage-based history (`gcg_post_history`): stores angle, painPoint, templateKey, agency, timestamp per post
  - Max 100 entries, auto-prunes after 30 days, filtered by target agencies
  - `getGenerationHistory(agencies)`, `saveGenerationHistory(posts, agencies)`, `getPreviousAngles(agencies, limit)`
  - Both `quickGenerate()` and `generateContent()` read history before API call, send `previousAngles[]` in request body, save after success
  - Both `/api/generate` and `/api/content-generator/generate` accept `previousAngles` (sanitized, max 50), inject "DO NOT REPEAT" section into Step 2 prompt
- **Content Reaper: Visual Card Quote Variety**
  - `/api/generate-graphic` prompts rewritten: instead of "1-2 sentences" now asks AI to randomly pick from 5 formats (bold phrase, punchy question, stat hook, contrarian take, full sentence)
  - Word limit changed to "under 15 words" for punchier output
  - Temperature bumped from 0.7 → 0.9 for more creative variety
- **Content Reaper: Agency Persistence Fix**
  - `findAgencies()` now saves all found agency names to `target_agencies` in Supabase (was missing — `saveCompanyProfile()` never included agencies)
  - `generateContent()` now persists checked agencies to Supabase after generation so selections survive across sessions
  - Removed `.slice(0, 15)` cap from all 5 agency lookup paths — users now see full agency list from API instead of truncated 15
- **Content Reaper: Agency Selection Redesign (Quick Generate)**
  - Replaced plain name pills with checkbox cards showing spending amounts, contract counts, and FY26 budget trend badges
  - Cards in 2-column scrollable grid (`max-h-80`) with `has-[:checked]` styling for selected state
  - Three sort modes: $ Spending (default), Contracts, FY26 Trend (biggest budget growth first)
  - Select All / Clear All buttons, search filter (auto-shown at 10+ agencies)
  - `quickGenerate()` now reads checked agencies from DOM checkboxes via `getSelectedQuickAgencies()`
  - `quickAgencyData` module-level cache stores full agency objects from API; `budgetTrendCache` loaded from `/api/budget-authority`
  - Budget badges: green ▲ +X% / red ▼ -X% fetched non-blocking, cards re-render when data arrives

### February 15, 2026 (Session 14)
- **govcon-shop: Opportunity Hunter Email Gate + Contextual Upsell**
  - Email gate: shows 3 agencies free, blurs remaining with email capture overlay, unlocks up to 10 on submit
  - Created `/api/capture-opportunity-lead` — upserts to Supabase `leads` table with `source: 'opportunity-hunter'` and `context` JSONB (NAICS, business type, zip, agency count, spending)
  - Pro users and returning visitors (30-day localStorage) bypass gate entirely
  - Contextual upsell cards below results: Recompete Tracker ($397) + Starter Bundle ($697) with user's NAICS and top agencies
  - Fire-and-forget pattern — API errors never block user access
  - Fixed invisible form input text (added `text-gray-900`), fixed email gate overlay cutoff (`minHeight: 280px`)
- **govcon-shop: Blog donut chart rebuilt** — expanded from 4 to 7 segments (Task Orders 55%, Sole Source 30%, Micropurchases 4%, DIBBS 3%, Niche Sites 2%, Classified 1%, SAM 5%) with distinct colors
- **govcon-shop: Blog header branding** — added `shop.govcongiants.org` monospace text to nav on both blog index and article pages
- **govcon-shop: Store page "Which bundle is right for me?"** — three persona cards (Starter/Pro/Ultimate) with anchor links to bundle sections, plus "Best for:" buyer lines on each bundle card
- **Scout → Hunter rename** — renamed all "Scout Opportunities" → "Hunt Opportunities" across govcon-shop and market-assassin (button text, loading state, CSV filename, localStorage keys, variable names)
- **Fixed pre-existing build error** — removed `export const runtime = 'edge'` from `blog/[slug]/opengraph-image.tsx` (Edge runtime conflicts with `generateStaticParams` in Next.js 16)
- **Case study videos organized** — 11 videos total (7 student demos + 4 tutorials) in `docs/case-studies/`, transcripts with key quotes and repurposing ideas
- **Supabase migration** — added `context JSONB` and `updated_at` columns to govcon-shop `leads` table

### February 12, 2026 (Session 13)
- **Content Reaper .docx Export & Formatting Overhaul**
  - API route (`generate/route.ts`): stopped stripping `**bold**` and `*italic*` markdown markers — now preserved for .docx and web display
  - Added `renderMarkdown(text)` to `index.html` — converts `**bold**` → `<strong>`, `*italic*` → `<em>` with HTML entity escaping (XSS-safe)
  - Added `stripMarkdown(text)` — removes all `*` markers for clipboard copy and graphic API calls
  - Post card rendering changed from `<pre>` to `<div>` with `renderMarkdown()` for proper bold/italic display
  - Fixed hashtag display bug: `displayQuickGeneratedPosts` was rendering array via `${post.hashtags}` (comma-joined) → now uses `.join(' ')`
  - Fixed hashtag display in .docx export: `text: post.hashtags` → `Array.isArray(...) ? .join(' ') : post.hashtags`
  - Added "TEXT FORMATTING" section to Step 3 prompt: instructs AI to use `**bold**` for key terms and `*italic*` for tips/warnings across ALL templates
  - Left-justified all content: `.replace(/^[ \t]+/gm, '')` in both API route and frontend `renderMarkdown` — no indentation in any post
  - .docx export: blank lines now get `spacing: { after: 200 }` (was 80) for proper paragraph breaks
  - .docx export: lines starting with `- ` render as Word bullet paragraphs with `bullet: { level: 0 }`

### February 12, 2026 (Session 12)
- **FY2026 Budget Integration & Simulated Data Elimination**
  - Created budget authority data layer: `src/lib/utils/budget-authority.ts` with USASpending API integration
  - Created admin build endpoint: `/api/admin/build-budget-data` — fetches FY2025 vs FY2026 budget data for all toptier agencies
  - Created cached data file: `src/data/agency-budget-data.json` (populated by admin endpoint)
  - Created public API: `/api/budget-authority` — GET endpoint for all tools to query budget data
  - Added `AgencyBudgetData` and `BudgetCheckupReport` types to `federal-market-assassin.ts`
  - Extended `ComprehensiveReport` with optional `budgetCheckup` field
  - Wired budget data into report generation: `generate-all/route.ts` now builds budget checkup and uses budget growth as a scoring signal in `highOpportunityMatches`
  - New Budget Checkup tab in ReportsDisplay: summary cards, winners/losers table, agency detail section, BudgetComparisonChart
  - Created `BudgetComparisonChart.tsx` — grouped bar chart showing FY2025 vs FY2026 per agency with trend-colored bars
  - Updated `SpendingTrendChart.tsx` to accept `budgetComparison` prop — shows real FY budget bars instead of simulated Q4-spike pattern
  - Added budget trend badges to `AgencySelectionTable.tsx` — shows green/red badge next to agency names
  - Added Simulated Data Elimination backlog to `TOOL-BUILD.md` with 7 tracked items
  - **Agency toptier code mapping**: `src/data/agency-toptier-codes.json` — 49 agencies mapped to USASpending toptier codes
  - **12 files created/modified** across data, utility, API, type, and component layers

### February 11, 2026 (Session 11)
- **Extracted Action Planner into standalone repo** — `github.com/ecoffie/action-planner` at `/Users/ericcoffie/Projects/govcon-planner`
  - Copy (not move) — all planner files remain in market-assassin, live planner at `tools.govcongiants.org/planner` unchanged
  - 25 files: 17 copied from market-assassin + 8 new (package.json, layout, globals.css, redirect page, next.config, vercel.json, .env.example, README)
  - Zero MA dependencies: no Stripe, no KV, no OpenAI — only Supabase, jsPDF, nodemailer
  - Standalone Next.js 16 project another developer can clone and run independently

### February 10, 2026 (Session 10)
- **Agency Pain Points Database: 210 → 250 agencies** — 40 new agencies across Education, HUD, GSA, SBA, EPA, Treasury, Commerce, DoD, Intel, Independent
  - All 250 agencies have 10+ pain points (zero thin)
  - Total: 2,765 pain points, 2,500 spending priorities
  - All data grounded in GAO reports, IG audits, CRS analyses, FY2025-2026 budget justifications
- **Market Assassin UI fixes:**
  - Fixed mislabeled "priorities identified" → "pain points identified" in agency modal
  - Added Spending Priorities section (emerald green) to agency modal
  - Made Similar Awards dynamic: "December Hit List" → current month, "Q4 Spend" → current fiscal quarter
- **Removed DOT Certified business type** from all tools (6 files: type def, 2 set-aside maps, 3 dropdowns)
  - DOT Certified mapped to `['SBP']` which was already included in Small Business codes

### February 10, 2026 (Session 9)
- **Content Reaper: Thought leadership rewrite** — prompts now create expert content that attracts government decision makers, NOT sales pitches
  - Step 2: "Demonstrate deep insider knowledge" replaces "DIRECTLY connect services to pain points"
  - Step 3: "THOUGHT LEADERSHIP TONE" section — "NEVER say 'we can help' or 'our services'"
  - Company profile relabeled: "Core Services" → "Areas of Expertise", "Differentiators" → "Unique Perspective"
  - Templates updated: story-driven, stat-heavy, case-study all shifted to insight-sharing tone
  - Carousel CTA preserved — only post text changed, carousel last slide still has CTA
- **Opportunity Hunter: Priorities wired in** — modal now shows pain points + spending priorities
  - `/api/pain-points` now returns `priorities[]` and `priorityCount` in both GET and POST
  - `loadPainPoints` tries `/api/pain-points` first (250 agencies) before falling back to `/api/agency-knowledge-base` (31 agencies)
  - Modal split: purple "Pain Points" section + green "Spending Priorities" section with `$` bullets and FUNDED badges
- **Market Assassin: Enhanced priorities intelligence**
  - NAICS keyword mapping (15 sectors) scores each priority as high/medium/low relevance to user's NAICS
  - Cross-reference engine: 10 areas detect agencies with BOTH a pain point AND spending priority in same area
  - `highOpportunityMatches[]` sorted by NAICS-relevant + funded first
  - Agency modal: separate green "Spending Priorities" section with FUNDED badges
  - CSV export: priorities included as "Funded Priority" / "Planned Priority" rows
  - HTML/PDF report: new section with High-Opportunity Matches cards, Pain Points table, Spending Priorities table, stats grid
  - TypeScript types updated: `AgencyPainPointsReport` now includes `spendingPriorities`, `highOpportunityMatches`, enhanced summary

### February 9-10, 2026 (Session 8)
- **Agency Pain Points Database: 63 → 135 agencies** — built admin pipeline using USASpending + Grok AI + GAO/IG data
- **Spending Priorities: 1,350 total** — generated for all 135 agencies via admin endpoint
- **Priorities wired into Content Reaper and Market Assassin** — initial wiring (before Session 9 enhancements)

### February 9, 2026 (Session 7)
- **Content Reaper: Post originality overhaul** — posts were repetitive when generating 15-30 for the same agency
- Added `shuffleArray()` (Fisher-Yates) + 20 `CONTENT_LENSES` (seasonal, perspective, framework, trending, emotional)
- Pain points now shuffled and expanded: `shuffleArray(painPoints).slice(0, 7)` (was fixed `slice(0, 5)`)
- 3 random content lenses injected into Step 2 prompt each generation as "CONTENT VARIETY DIRECTIONS"
- Anti-repetition instruction added: "Each angle MUST use a completely different hook style..."
- `callGrokAPI` now accepts optional `temperature` param — Step 2 uses 0.85, Step 3 stays at 0.7
- Updated TOOL-BUILD.md: "Expand Agency Pain Points Database" added to MA, Content Gen, and Opp Hunter sections

### February 9, 2026 (Session 6)
- **Content Reaper: Bulk export feature** — "Export All as .docx" button (all tiers) and "Download All Visuals (.zip)" button (Full Fix only)
- .docx export: one post per page, LinkedIn formatting preserved, hashtags in blue (#0077B5)
- Visuals .zip: generates quote card PNG for each post via `renderQuoteCard()`, cycles 6 themes, progress indicator
- Added CDN libs: docx@9.0.2, jszip@3.10.1, file-saver@2.0.5
- "Generate More Posts" now resets dropdown to 10 (was keeping previous selection like 30)

### February 8, 2026 (Session 5)
- **govcon-shop: Fixed fix-access-flags** — `continue` after Supabase FK error was skipping KV updates (only 2/33 fixed). Removed Supabase insert, KV granting now unconditional
- **Fixed Content Reaper tier** — Ultimate Bundle customers now show "Full Fix" (was "Content Engine") in KV
- **Fixed Market Assassin tier** — Ultimate Bundle customers confirmed "Premium" in KV
- **All 33 customers KV-verified** — 33/33 kv_fixed, 0 errors
- **MA Standard entries are students** — $99/month subscription users, correctly showing Standard tier

### February 6, 2026 (Session 4)
- **govcon-shop: Cleaned up purchases table** — 74 → 35 records (removed 39 non-tool purchases)
- **govcon-shop: Fixed 4 legacy Stripe product IDs** in purchases table
- **govcon-shop: Rewrote activate-license** — KV fallback when no Supabase profile exists
- **govcon-shop: Discovered `user_profiles` FK constraint** — `user_id` references `auth.users`, can't create profiles without auth accounts
- **KV is primary access system** — all 33 tool customers verified via KV, activate page reads from KV
- **Revenue: $18,574** across 33 tool sales

### February 6, 2026 (Session 3)
- **Created `/api/admin/backfill-kv`** — pulls Stripe checkout sessions, grants KV access from tier/bundle metadata
- **Backfilled 32 customers** — 22 auto-granted via Stripe metadata, 10 Opp Hunter Pro manually granted via admin endpoint
- **Discovered govcon-shop and market-assassin use DIFFERENT Supabase databases**
- KV store connected to both projects now (was only market-assassin)

### February 6, 2026 (Sessions 1-2)
- **govcon-shop: Removed all LemonSqueezy code** — deleted `lemonsqueezy.ts`, both webhook routes
- **govcon-shop: Created `products.ts`** — Stripe product IDs, bundle config, reverse lookup map
- **govcon-shop: Created `user-profiles.ts`** — ported from market-assassin for access flag management
- **govcon-shop: Rewrote Stripe webhook** — triple-write: Supabase purchases + user_profiles flags + Vercel KV
- **govcon-shop: Rewrote activate-license** — reads user_profiles access flags, email-only (no license key input)
- **govcon-shop: Added universal purchase confirmation email** — covers 9/12 products that were missing emails
- **govcon-shop: Verified all 12 Stripe payment link metadata** — all `tier`/`bundle` values correct
- Fixed all Stripe checkout links in govcon-shop — 5 old/dead payment links replaced
- Updated 13 files across govcon-shop
- LemonSqueezy fully canceled — all payments now through Stripe directly

### February 5, 2026
- Removed PDF carousel download — LinkedIn no longer supports PDF carousels
- Made PNG slide images the primary/only download option in carousel preview modal
- Updated help text from "Upload PDF to LinkedIn" to "Upload images to LinkedIn"
- Fixed Content Reaper API URLs — replaced all hardcoded `govcon-content-generator.vercel.app` with relative paths (same-origin)
- Affected files: `public/content-generator/index.html`, `library.html`, `calendar.html`
- Verified Olga's (olga@olaexecutiveconsulting.com) Full Fix access is intact via API
- **Note:** Missing API endpoints: `/api/generate-carousel` (standalone builder) and `/api/upload-carousel` (save to library) — not yet implemented

### February 2, 2026
- Created bundle landing pages (`/bundles/starter`, `/bundles/pro`, `/bundles/ultimate`)
- Created `BundleProductPage.tsx` component
- Updated store page navigation

### January 30, 2026
- Completed Stripe integration
- Removed LemonSqueezy
- Fixed webhook to grant access without user_id
- Aligned bundle names

---

*Last Updated: February 18, 2026 (Session 17)*
