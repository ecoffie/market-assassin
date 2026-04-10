# Market Assassin - Claude Project Context

## Critical Rules

1. **No Framer.** Do not use any Framer MCP tools. This is a pure Next.js/React codebase.
2. **This is the DEVELOPMENT project.** Deploys to `tools.govcongiants.org`. For live `shop.govcongiants.org` changes, use `/Users/ericcoffie/govcon-shop`.
3. **Content Reaper `API_BASE` must be `''`** (empty string) in all `public/content-generator/*.html` files. Never set to an external URL.
4. **Different Supabase databases.** market-assassin and govcon-shop have SEPARATE Supabase instances. They do NOT share tables.
5. **KV store connected to BOTH projects** via Vercel Storage integration. KV backfills can run from either project.
6. **SAM.gov API does NOT support comma-separated NAICS codes.** Must make parallel requests for each NAICS code and merge results. See `src/lib/briefings/pipelines/sam-gov.ts`.
7. **FPDS.gov retired Feb 24, 2026.** All federal contract data now flows through SAM.gov APIs. See `docs/sam-apis.md` for full reference.
8. **Always run QA tests before deploying.** Use `npm run deploy` (runs tests first) or `npm run test:pre-deploy`.
9. **Unified notification table:** All alert/briefing code uses `user_notification_settings` (not the old `user_alert_settings` or `user_briefing_profile` tables which were dropped).

---

## Pre-Deploy QA

**ALWAYS run before deployment:**

```bash
# Safe deploy (runs tests first, blocks on failure)
npm run deploy

# Or run tests manually
npm run test:pre-deploy
```

**What it checks:**
- TypeScript compilation
- SAM.gov date format (MM/dd/yyyy not YYYY-MM-DD)
- Critical API endpoints
- Daily Alerts pipeline
- Market Intelligence pipeline
- Access control rules
- Environment variables

**Test files:** `tests/test-pre-deploy.sh`, `tests/run-all-tests.sh`

---

## SAM.gov API Integration

**Reference:** [`docs/sam-apis.md`](./docs/sam-apis.md)

### API Status (April 5, 2026)

| API | Status | Source | System Account Required |
|-----|--------|--------|------------------------|
| Opportunities | ✅ Working | SAM.gov | No |
| Entity Management | ✅ Working | SAM.gov | No |
| Federal Hierarchy | ✅ Working | SAM.gov | No |
| Contract Awards | ✅ Working | **USASpending MCP** | No |
| Subaward | ⏳ Waiting | SAM.gov | Yes |

**Note:** USASpending MCP fixed April 5, 2026 (added required `award_type_codes` filter).

### Rate Limits & Caching

- **Standard tier:** 1,000 requests/day, 10/min
- **Cache TTL:** 24h for awards/entity, 1h for opportunities
- **Cache table:** `sam_api_cache` in Supabase
- **Fallback:** USASpending API (primary for Contract Awards)

### Key Rules

1. **No comma-separated NAICS** — make parallel requests
2. **Always cache responses** — 24h TTL minimum
3. **USASpending is primary for Contract Awards** — has bid count data
4. **Use MCP tools when available** — `mcp__samgov__*` for opportunities

### Env Variables

```env
SAM_API_KEY=xxx                    # Opportunities (existing)
SAM_CONTRACT_AWARDS_API_KEY=xxx    # Needs System Account
SAM_ENTITY_API_KEY=xxx             # Same as SAM_API_KEY
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/sam/utils.ts` | Shared rate limit, cache, error handling |
| `src/lib/sam/contract-awards.ts` | Contract Awards wrapper (uses USASpending) |
| `src/lib/sam/usaspending-fallback.ts` | USASpending API for bid counts |
| `src/lib/sam/entity-api.ts` | Entity Management API wrapper |
| `src/lib/sam/subaward-api.ts` | Subaward Reporting API wrapper |
| `src/lib/sam/federal-hierarchy.ts` | Federal Hierarchy API wrapper |
| `src/lib/sam/index.ts` | Unified exports |

---

## Agency Hierarchy API v2 (Moat 7)

**Reference:** [`docs/agency-hierarchy-api.md`](./docs/agency-hierarchy-api.md)

Unified federal agency intelligence combining SAM.gov, pain points, contractors, and spending data. Inspired by Tango by MakeGov, enhanced with GovCon-specific intel.

### Quick Examples

```bash
# Search by abbreviation
curl "https://tools.govcongiants.org/api/agency-hierarchy?search=VA"

# CGAC code lookup
curl "https://tools.govcongiants.org/api/agency-hierarchy?cgac=069"

# Get spending data
curl "https://tools.govcongiants.org/api/agency-hierarchy?mode=spending&agency=DOD"

# Find buying offices for NAICS
curl "https://tools.govcongiants.org/api/agency-hierarchy?naics=541512&mode=buying"

# Service stats
curl "https://tools.govcongiants.org/api/agency-hierarchy?mode=stats"
```

### Data Sources

| Source | Contents |
|--------|----------|
| SAM.gov Federal Hierarchy | Official org structure |
| Pain Points Database | 250 agencies, 2,765 pain points |
| Contractor Database | 2,768 contractors with SBLO contacts |
| Agency Aliases | 450+ abbreviation mappings |
| USASpending.gov | Spending aggregations |

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/agency-hierarchy/index.ts` | Unified exports |
| `src/lib/agency-hierarchy/unified-search.ts` | Main search service |
| `src/lib/agency-hierarchy/pain-points-linker.ts` | Pain points matching |
| `src/lib/agency-hierarchy/spending-stats.ts` | USASpending integration |
| `src/data/agency-aliases.json` | Abbreviation mappings |
| `src/data/agency-pain-points.json` | Pain points database |
| `src/app/api/agency-hierarchy/route.ts` | API endpoint |

### Test Script

```bash
./tests/test-agency-hierarchy.sh local  # Test local dev
./tests/test-agency-hierarchy.sh prod   # Test production
```

### Test Endpoints

```bash
# Test Contract Awards (uses USASpending)
curl "https://tools.govcongiants.org/api/admin/test-sam-awards?password=galata-assassin-2026&naics=541512"

# Test USASpending directly
curl "https://tools.govcongiants.org/api/admin/test-usaspending?password=galata-assassin-2026&naics=541512"

# Test Entity Lookup
curl "https://tools.govcongiants.org/api/admin/test-sam-entity?password=galata-assassin-2026&name=Booz"

# Test Hierarchy
curl "https://tools.govcongiants.org/api/admin/test-sam-hierarchy?password=galata-assassin-2026&agency=VA"

# Test Subaward (blocked until System Account)
curl "https://tools.govcongiants.org/api/admin/test-sam-subaward?password=galata-assassin-2026&prime_uei=XXX"
```

---

## Project Overview

**Name:** Market Assassin (GovCon Tools Platform)
**Framework:** Next.js 16.1.1 with Turbopack, React 19, TypeScript, Tailwind CSS
**Database:** Supabase (PostgreSQL) | **Payments:** Stripe | **Email:** SMTP | **PDF:** jsPDF
**Roadmap:** See [`TOOL-BUILD.md`](./TOOL-BUILD.md)
**Session History:** See [`MEMORY.md`](./MEMORY.md)

---

## Related Projects

| Project | Location | Deploys To | Purpose |
|---------|----------|------------|---------|
| **Market Assassin** | This project | `tools.govcongiants.org` | Dev/staging tools |
| **GovCon Shop** | `/Users/ericcoffie/govcon-shop` | `shop.govcongiants.org` | Live shop (production) |
| **GovCon Funnels** | `/Users/ericcoffie/govcon-funnels` | `govcongiants.org` | Marketing site |
| **LinkedIn Deal Magnet** | `/Users/ericcoffie/Linkedin App` | `linkedin-deal-magnet.vercel.app` | Profile optimizer (separate product) |

---

## Tools Built

### 1. Federal Market Assassin
**Location:** `/src/app/market-assassin/`
**Purpose:** Market intelligence — 5 inputs + agency selection → 4-8 strategic reports
**Tiers:** Standard ($297, 4 reports) | Premium ($497, 8 reports)
**Key Files:** `market-assassin/page.tsx`, `api/reports/generate-all/route.ts`

### 2. Content Reaper
**Location:** `/src/app/content-generator/`, `public/content-generator/`
**Purpose:** AI LinkedIn post generator — up to 30 posts/click, 250 agencies, bulk .docx/.zip export
**Tiers:** Content Engine ($197) | Full Fix ($397)
**Key Files:** `public/content-generator/index.html`, `api/content-generator/generate/route.ts`

### 3. Federal Contractor Database
**Location:** `/src/app/contractor-database/`
**Purpose:** 3,500+ federal contractors with SBLO contacts, filtering, export
**Price:** $497

### 4. Recompete Tracker
**Location:** `/public/recompete.html`
**Purpose:** Track expiring federal contracts for recompete opportunities
**Price:** $397
**Features:** Pagination, CSV/Excel/PDF export, location filtering, mobile responsive

### 5. Opportunity Hunter
**Location:** `/src/app/opportunity-hunter/`
**Purpose:** Find government buyers — agency spending analysis, NAICS targeting
**Price:** Free + Pro ($19/mo)

### 6. Action Planner
**Location:** `/src/app/planner/`
**Purpose:** Task management — 5 phases, 36 tasks, progress tracking, PDF export

### 7. Daily Briefings (All 3 Types)
**Location:** `/src/lib/briefings/`
**Purpose:** Personalized GovCon intel emails with win probability scoring
**Features:** Smart profiles, engagement tracking, shared cohort rollout across all 3 briefing types

**Enterprise Pre-computation Architecture (April 9, 2026):**
Instead of generating 928 individual briefings per type, we pre-compute 49 templates (one per unique NAICS profile) for ALL 3 briefing types.

| Metric | Before | After |
|--------|--------|-------|
| LLM Calls/week | 928 × 3 = **2,784** | 49 × 3 = **147** (95% reduction) |
| Time per briefing | 52+ seconds | ~40 seconds (template) |
| Sending time | N/A | ~100ms/user |
| Total capacity | ~1 user/run | **500+ users/run** |
| Rollout mode | `rollout` (250) | **`beta_all` (927 users)** |

**All 3 Briefing Types Pre-computed:**

| Briefing | Pre-compute Cron | Send Cron | Schedule |
|----------|------------------|-----------|----------|
| Daily Brief | `precompute-briefings` | `send-briefings-fast` | Daily 2-4 AM → 7-8:30 AM |
| Weekly Deep Dive | `precompute-weekly-briefings` | `send-weekly-fast` | Sat 8-10 PM → Sun 7-8:30 AM |
| Pursuit Brief | `precompute-pursuit-briefs` | `send-pursuit-fast` | Sun 8-10 PM → Mon 7-8:30 AM |

**Prefix Fallback for Custom Profiles:**
Users with custom NAICS profiles (via preferences page) get briefings immediately via 3-digit prefix matching. For example, a user with `236, 237, 238` matches templates with any construction code (`236xxx`, `237xxx`, `238xxx`).

**Database Tables:**
- `briefing_templates` — Pre-computed briefings by NAICS profile hash (supports `daily`, `weekly`, `pursuit` types)
- `briefing_precompute_runs` — Tracks nightly template generation jobs

**Key Files:**
- `api/cron/precompute-briefings/route.ts` — Daily templates (2-4 AM)
- `api/cron/send-briefings-fast/route.ts` — Send daily briefings (7-8:30 AM)
- `api/cron/precompute-weekly-briefings/route.ts` — Weekly templates (Sat 8-10 PM)
- `api/cron/send-weekly-fast/route.ts` — Send weekly briefings (Sun 7-8:30 AM)
- `api/cron/precompute-pursuit-briefs/route.ts` — Pursuit templates (Sun 8-10 PM)
- `api/cron/send-pursuit-fast/route.ts` — Send pursuit briefs (Mon 7-8:30 AM)
- `src/lib/briefings/delivery/ai-briefing-generator.ts` — Supports `naicsOverride` for profile-based generation

### 8. Daily Alerts System
**Location:** `/src/app/api/cron/daily-alerts/`, `/src/app/alerts/`
**Purpose:** Automated opportunity alert emails based on user NAICS/keywords
**Price:** $19/mo (FREE during beta through April 27, 2026)
**Value Prop:** "Don't miss opportunities" (volume play)
**Free for:** Any product purchaser (except OH free tier)
**Features:**
- **Notice Type Badges:** Color-coded RFP (green), RFQ (blue), Sources Sought (purple), Pre-Sol (orange), Combined (teal)
- **Posted Date:** Shows when opportunity was released
- **Urgency Badges:** 🔥 3 DAYS LEFT (red + highlighted row), ⚡ X days (orange), 📅 2 weeks (yellow)
- Deduplication (won't resend same opp in 7 days)
- Retry logic (3 attempts for failed emails)
- Timezone-aware delivery (~6 AM local time)
- Keywords search (catch mislabeled opportunities)
- PSC crosswalk (auto-generate related PSC codes from NAICS)
- FREE PREVIEW banners on emails
- **NOT included:** Win Probability, AI analysis (reserved for $49/mo Market Intelligence)

**Key Files:**
- `api/cron/daily-alerts/route.ts` — Main alerts cron handler
- `api/cron/precompute-briefings/route.ts` — Pre-compute templates by NAICS profile
- `api/cron/send-briefings-fast/route.ts` — Send using pre-computed templates (~100ms/user)
- `alerts/preferences/page.tsx` — Redirects to `/briefings` (unified UI)
- `api/alerts/preferences/route.ts` — Preferences API

**Unified Market Intelligence UI (April 9, 2026):**
- `/briefings` — Single unified dashboard with Market Intelligence branding
- `/alerts/preferences` — Now redirects to `/briefings`
- Settings panel accessible via gear icon in dashboard header
- Onboarding wizard for new users (NAICS → Agencies → Geography → Delivery)
- Demo video: `https://vimeo.com/1181569155`

**Dashboard Features (April 9, 2026):**
- **Search bar** — Find opportunities by title, agency, keywords with highlighting
- **Filter buttons** — All, Urgent, Opportunities, Teaming with counts
- **CSV export** — Download filtered briefing data as spreadsheet
- **Print/PDF** — Browser print dialog for PDF export
- **Email feedback** — Thumbs up/down buttons in emails track helpfulness

**Feedback System:**
- API: `/api/briefings/feedback` (GET for email links, POST for programmatic)
- Pages: `/briefings/feedback/thanks`, `/briefings/feedback/error`
- Table: `briefing_feedback` (user_email, briefing_date, briefing_type, rating)

**UI Components:**
- `src/components/briefings/MarketIntelligenceHeader.tsx` — Dashboard header with MI branding
- `src/components/briefings/OnboardingWizard.tsx` — 4-step setup wizard
- `src/components/briefings/SettingsPanel.tsx` — Slide-out settings panel (all preferences)

**Cron Schedule (UTC):**
| Job | Times | Purpose |
|-----|-------|---------|
| daily-alerts | 11 AM, 12 PM, 2 PM, 4 PM | Timezone coverage |
| precompute-briefings | 2:00, 2:30, 3:00, 3:30, 4:00 AM | Daily templates by NAICS profile |
| send-briefings-fast | 7:00-8:30 AM (every 10 min) | Send daily briefings |
| precompute-weekly-briefings | Sat 8:00, 8:30, 9:00, 9:30, 10:00 PM | Weekly templates by NAICS profile |
| send-weekly-fast | Sun 7:00-8:30 AM (every 10 min) | Send weekly briefings |
| precompute-pursuit-briefs | Sun 8:00, 8:30, 9:00, 9:30, 10:00 PM | Pursuit templates by NAICS profile |
| send-pursuit-fast | Mon 7:00-8:30 AM (every 10 min) | Send pursuit briefs |
| weekly-alerts | 11 PM Sunday | Weekly digest |

**Briefing rollout model:**
- `beta_all` = full eligible briefing audience
- `rollout` = controlled 250-user program cohort
- default cohort settings: `stickyDays=14`, `cooldownDays=21`, `maxFallbackPercent=15`
- rotation requires the full program experience twice:
  - `daily brief` x2
  - `weekly deep dive` x2
  - `pursuit brief` x2
- admin endpoint: `/api/admin/briefing-rollout`

**Automated Backup System (April 9, 2026):**
Enterprise-grade failsafe for 9,000+ users:

| Component | Purpose |
|-----------|---------|
| Dead Letter Queue | Failed briefings retry up to 3x with exponential backoff |
| Watchdog Cron | Runs 9 AM, 9:30 AM, 10 AM UTC daily to monitor health |
| Self-Healing | Auto-triggers precompute if <80% template coverage |
| Alert Escalation | Warning (5% failure) → Critical (15% failure) |

**Database Tables:**
- `briefing_dead_letter` — Retry queue with exponential backoff (15min × 2^retry)
- `briefing_system_health` — Health metrics with auto-computed scores

**Key Files:**
- `api/cron/briefing-watchdog/route.ts` — Central monitoring and auto-recovery
- `api/admin/briefing-dead-letter/route.ts` — Admin view/manage retry queue
- `supabase/migrations/20260409_briefing_backup_system.sql` — Schema

**Admin Endpoint:**
```
GET /api/admin/briefing-dead-letter?password=galata-assassin-2026
POST { action: "retry", id: "xxx" } — Force retry specific entry
POST { action: "clear", status: "exhausted" } — Clear by status
POST { action: "stats" } — Get summary statistics
```

### 9. Forecast Intelligence System
**Location:** `/src/app/forecasts/`, `/src/lib/forecasts/`
**Purpose:** Aggregate procurement forecasts from 13 federal agencies (6-18 months before solicitation)
**Status:** Phase 1-2 complete (April 6, 2026) — **7,764 forecasts**
**Live URL:** https://tools.govcongiants.org/forecasts

**Database Tables:**
- `agency_forecasts` — Main forecast data (unified schema)
- `forecast_sync_runs` — Track sync operations
- `forecast_sources` — Agency source configurations

**Current Data (April 6, 2026):**
| Agency | Source | Records |
|--------|--------|---------|
| DOJ | justice.gov Excel | 3,140 |
| DOI | GSA Acquisition Gateway CSV | 2,039 |
| DOE | energy.gov Excel | 833 |
| DHS | Puppeteer scraper | 683 |
| NASA | nasa.gov Excel | 294 |
| VA | GSA Acquisition Gateway CSV | 268 |
| GSA | GSA Acquisition Gateway CSV | 164 |
| NRC | GSA Acquisition Gateway CSV | 79 |
| DOT | GSA Acquisition Gateway CSV | 68 |
| SSA | Excel (SBF Report) | 60 |
| NSF | PDF (Acquisition Forecast) | 56 |
| DOL | GSA Acquisition Gateway CSV | 47 |
| **Total** | | **7,764** |

**Phase 3-4 Sources (Puppeteer, pending):**
| Agency | Source | Est. Coverage |
|--------|--------|---------------|
| HHS | procurementforecast.hhs.gov | $12B |
| Treasury | osdbu.forecast.treasury.gov | $2B |
| EPA | ordspub.epa.gov | $1.5B |
| USDA | forecast.edc.usda.gov | $4B |
| DOD | Multi-source | $40B |

**Key Files:**
| File | Purpose |
|------|---------|
| `src/app/forecasts/page.tsx` | Search UI with filters |
| `src/app/api/forecasts/route.ts` | API endpoint |
| `src/lib/forecasts/types.ts` | TypeScript types |
| `src/lib/forecasts/scrapers/` | Puppeteer scrapers (DHS working, others pending) |
| `scripts/import-forecasts.js` | Excel import script (DOE, NASA, DOJ) |
| `scripts/import-gsa-forecasts.js` | GSA Acquisition Gateway CSV import |
| `scripts/import-nsf-forecasts.js` | NSF PDF data import (hardcoded from PDF) |
| `scripts/import-ssa-forecasts.js` | SSA Excel (.xlsm) import |
| `supabase/migrations/20260405_forecast_intelligence.sql` | Schema |

**Import Commands:**
```bash
# Preview (no database writes)
node scripts/import-forecasts.js --dry-run

# Import all Phase 1 sources
node scripts/import-forecasts.js

# Import specific source
node scripts/import-forecasts.js --source=DOE
```

---

## Products & Pricing

| Product | Price | KV Key | Stripe Metadata |
|---------|-------|--------|-----------------|
| Opportunity Hunter Pro | $19/mo | `ospro:{email}` | `tier: hunter_pro` |
| Daily Alerts | $19/mo | `alertpro:{email}` | `tier: alert_pro` |
| Daily Briefings | $49/mo | `briefings:{email}` | `tier: briefings` |
| Content Reaper | $197 | `contentgen:{email}` | `tier: content_standard` |
| Market Assassin Standard | $297 | `ma:{email}` | `tier: assassin_standard` |
| Content Reaper Full Fix | $397 | `contentgen:{email}` | `tier: content_full_fix` |
| Recompete Tracker | $397 | `recompete:{email}` | `tier: recompete` |
| Federal Contractor Database | $497 | `dbaccess:{email}` | `tier: contractor_db` |
| Market Assassin Premium | $497 | `ma:{email}` | `tier: assassin_premium` |

### Market Intelligence Pricing (Post-Beta: April 27, 2026)

| User Type | Daily Alerts ($19/mo) | Daily Briefings ($49/mo) |
|-----------|----------------------|--------------------------|
| OH Free users (no purchase) | ❌ Pay $19/mo | ❌ Pay $49/mo |
| OH Pro ($19/mo) subscribers | ✅ Included | ❌ Pay $49/mo |
| Any product buyer (excl OH free) | ✅ Free | ❌ Pay $49/mo |
| Pro Giant ($997) | ✅ Free | ✅ 1 year free |
| Ultimate ($1,497) | ✅ Free | ✅ Lifetime free |
| Beta users (no purchase) | 30 days free → $19/mo | 30 days free → $49/mo |

**Beta End Date:** April 27, 2026

### Bundles
| Bundle | Price | Includes |
|--------|-------|----------|
| Starter ($697) | $943 value | Opp Hunter Pro, Recompete, Contractor DB |
| Pro Giant ($997) | $1,388 value | Contractor DB, Recompete, MA Standard, Content Gen, 1 Year Briefings |
| Ultimate ($1,497) | $1,788 value | Content Full Fix, Contractor DB, Recompete, MA Premium, Lifetime Briefings |

### Memberships
| Membership | Price | Includes |
|------------|-------|----------|
| Federal Help Center | $99/mo | MA Standard + Alert Pro + OH Pro (revoked on cancel) |

---

## Rate Limiting & Abuse Detection

### Rate Limits
| Scope | Limit | Window | KV Key |
|-------|-------|--------|--------|
| Report generation (email) | 50 | 24 hours | `rl:report:{email}` |
| Content generation (email) | 10 | 24 hours | `rl:content:{email}` |
| Authenticated IP fallback | 30 | 1 hour | `rl:ip:{ip}` |
| Unauthenticated IP | 5 | 1 hour | `rl:ip:unauth:{ip}` |
| Admin endpoints | 30 | 1 minute | `rl:admin:{ip}` |

### Abuse Thresholds
| Level | Count | Action |
|-------|-------|--------|
| Warning | 100 | Console log |
| Flagged | 250 | Stored in `abuse:flag:{email}`, added to `abuse:flagged` set |
| Blocked | 500+ | API returns 403, logged to console |

### Admin Endpoint
`/api/admin/abuse-report?password=galata-assassin-2026`
- GET: View all flagged users
- GET `?email=X`: Check specific user
- POST `{ action: "clear", email: "X" }`: Clear flag

---

## Access Control System

### Vercel KV — Primary (gates actual tool access)
**Code:** `src/lib/access-codes.ts`

### Supabase `user_profiles` — Secondary (boolean flags)
**Code:** `src/lib/supabase/user-profiles.ts`

### Purchase Flow (Triple-Write)
1. Customer buys via Stripe → webhook at `/api/stripe-webhook`
2. Webhook writes: Supabase `purchases` + `user_profiles` flags + Vercel KV
3. Sends confirmation email
4. Customer activates at `/activate` (email-only)

---

## Data Systems

### Agency Pain Points
- **Database:** `src/data/agency-pain-points.json` — 250 agencies, 2,765 pain points, 2,500 priorities
- **Admin:** `/api/admin/build-pain-points?password=galata-assassin-2026`
- **API:** `/api/pain-points`

### FY2026 Budget Authority
- **Cached data:** `src/data/agency-budget-data.json` — 47 toptier agencies
- **Admin:** `/api/admin/build-budget-data?password=...&mode=build`
- **API:** `/api/budget-authority`

### Win Probability Scoring
- **File:** `src/lib/briefings/win-probability.ts`
- **Factors:** NAICS (25), Set-Aside (25), Agency (15), Size (15), Capability (10), Vehicle (10)
- **Tiers:** excellent (75%+), good (60-74%), moderate (45-59%), low (30-44%), poor (<30%)

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/products.ts` | Product config with Stripe URLs (source of truth) |
| `src/app/api/stripe-webhook/route.ts` | Payment webhook — triple-write handler |
| `src/lib/supabase/user-profiles.ts` | User & access flag management |
| `src/lib/access-codes.ts` | Vercel KV access checking |
| `src/lib/rate-limit.ts` | Rate limiting functions |
| `src/lib/abuse-detection.ts` | Abuse tracking and flagging |
| `src/lib/send-email.ts` | All email templates |
| `src/lib/briefings/` | Daily briefing system |
| `src/lib/smart-profile/` | User profile learning system |
| `src/app/api/cron/daily-alerts/route.ts` | Daily alerts cron (FREE during beta) |
| `src/app/api/cron/precompute-briefings/route.ts` | Pre-compute daily templates by NAICS |
| `src/app/api/cron/send-briefings-fast/route.ts` | Send daily briefings (~100ms/user) |
| `src/app/api/cron/precompute-weekly-briefings/route.ts` | Pre-compute weekly templates by NAICS |
| `src/app/api/cron/send-weekly-fast/route.ts` | Send weekly briefings (~100ms/user) |
| `src/app/api/cron/precompute-pursuit-briefs/route.ts` | Pre-compute pursuit templates by NAICS |
| `src/app/api/cron/send-pursuit-fast/route.ts` | Send pursuit briefs (~100ms/user) |
| `src/app/alerts/preferences/page.tsx` | Alert/briefing preferences UI |
| `src/lib/utils/psc-crosswalk.ts` | PSC-NAICS crosswalk for broader search |
| `docs/govcon-market-research.md` | GAO market research framework for AI prompts |
| `docs/PRD-market-research-intelligence.md` | PRD for market research integration |

---

## Admin Endpoint Standard

- **Auth:** `?password=galata-assassin-2026` (or `ADMIN_PASSWORD` env var)
- **GET** = read/preview (safe)
- **POST** = execute (writes data)
- **Preview mode:** `?mode=preview` (default)
- **Execute mode:** `?mode=execute`
- **Response:** `{ success: boolean, message: string, data?: any, errors?: string[] }`

### Key Admin Endpoints
| Endpoint | Purpose |
|----------|---------|
| `/api/admin/abuse-report` | View/clear abuse flags |
| `/api/admin/build-pain-points` | Rebuild agency pain points |
| `/api/admin/build-budget-data` | Rebuild budget data |
| `/api/admin/trigger-alerts` | Manually trigger alert emails |
| `/api/admin/send-test-briefing` | Generate and send test briefing |
| `/api/admin/grant-briefings` | Batch grant briefings access |
| `/api/admin/test-sam-awards` | Test SAM Contract Awards API |
| `/api/admin/test-sam-entity` | Test SAM Entity Management API |
| `/api/admin/test-sam-subaward` | Test SAM Subaward API |
| `/api/admin/test-sam-hierarchy` | Test SAM Hierarchy API |
| `/api/admin/test-market-intel-pipeline` | **Full Market Intel pipeline testing** |
| `/api/admin/sync-alert-to-notification` | Sync users between alert/notif tables |
| `/api/admin/send-naics-reminder` | Send NAICS setup reminder emails |
| `/api/cron/health-check` | Automated API health tests |

---

## Bug Prevention Rules

1. **Never `continue` after Supabase failure** — always run KV operations unconditionally.
2. **Never match comma-joined strings directly** — split on delimiters first.
3. **Formatting must be consistent server + client** — markdown must render correctly.
4. **Always persist state after generation** — upsert to database immediately.
5. **Arrays must be `.join(' ')` not interpolated** — avoid `${array}` producing comma-joined.
6. **Never `.slice()` user data silently** — make caps explicit or configurable.
7. **Use unified `user_notification_settings` table** — Old tables (`user_alert_settings`, `user_briefing_profile`) were dropped. All code uses unified table now.
8. **Always add fallback NAICS** — If user has no NAICS, use defaults: `541512, 541611, 541330, 541990, 561210`.

---

## Email Template Standard

- **Footer branding:** "GovCon Giants AI"
- **From address:** `hello@govconedu.com`
- **Support email:** `service@govcongiants.com`
- **Phone:** 786-477-0477
- **Include:** activation link, "Manage preferences", "Unsubscribe"

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
GROQ_API_KEY=gsk_...
```

---

## 🔔 Pending Tasks

### Batch Enroll Bootcamp Attendees (April 12-19, 2026)

**Status:** Waiting 2-3 weeks to verify alerts working with current 457 users

**Action:** Enroll 8,804 bootcamp attendees from `data/bootcamp-attendees-to-enroll.txt`

```bash
# Run this after verifying alerts are working
cat data/bootcamp-attendees-to-enroll.txt | while read email; do
  curl -s -X POST "https://tools.govcongiants.org/api/alerts/save-profile" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\", \"naicsCodes\": [\"541512\", \"541611\", \"541330\"], \"businessType\": \"\", \"source\": \"free-signup\"}"
done
```

**Source:** All GHL contacts with any "bootcamp" tag (contract-vehicles-bootcamp, jan31-bootcamp, feb-proposal-bootcamp, etc.)

---

## JTED 2026 Presentation & Guide

**Event:** AEC Industry Day at MacDill AFB — April 1, 2026

### Presentation
- **File:** `presentations/JTED-2026-Revised.html` (98 slides)
- **PowerPoint:** `presentations/JTED-2026-Compressed.pptx` (8MB, image-based)
- **Export script:** `node presentations/export-slides-compressed.js`
- **Status:** Complete with QR code

### Companion Guide (Complete)
- **Intel Pack PDF:** `presentations/JTED-2026-Intel-Pack.pdf`
- **Slides PDF:** `presentations/JTED-2026-Slides.pdf`
- **Landing page:** `govcongiants.org/jted-2026` (deployed)
- **GHL tag:** `jted-2026-landing`

### Key Files
| File | Purpose |
|------|---------|
| `presentations/JTED-2026-Revised.html` | 98-slide HTML source |
| `presentations/JTED-2026-Compressed.pptx` | PowerPoint (8MB) |
| `presentations/JTED-2026-Intel-Pack.pdf` | Companion guide |
| `presentations/export-slides-compressed.js` | JPEG export + PPTX |

---

*Last Updated: April 9, 2026*
