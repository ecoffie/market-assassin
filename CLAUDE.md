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
9. **Unified notification table:** All alert/briefing code uses `user_notification_settings` (not the old `user_alert_settings` or `user_briefing_profile` tables which were dropped). The `smart-profile` service (`src/lib/smart-profile/`) is **dead code** - its `user_briefing_profile` table was never deployed.
10. **Daily briefings MUST use fast GREEN builder.** `send-briefings-fast` must use `buildSamGreenBriefing()` (instant, no AI), NOT `generateDailyBriefFromSam()` which calls Claude API (~4s/user, causes timeouts). Run `tests/test-briefing-architecture.sh` to verify.
11. **Briefing log MUST include briefing_type in all queries.** The `briefing_log` table has a unique constraint on `(user_email, briefing_date, briefing_type)`. All INSERT/UPDATE/SELECT must filter by `briefing_type` ('daily', 'weekly', 'pursuit') to avoid collisions between briefing types.
12. **Weekly-alerts uses batching.** `BATCH_SIZE=15` users per cron run to avoid Vercel 60s timeout. Deduplication checks `alert_log` for `alert_type='weekly'`.

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

**Day-of-Week Guards (April 16, 2026):**
All cron endpoints have **explicit day guards** that prevent sending on wrong days:

| Endpoint | Allowed Day | UTC Day # | Guard Response |
|----------|-------------|-----------|----------------|
| `precompute-weekly-briefings` | Saturday | 6 | `{"skipped": true, "dayOfWeek": X}` |
| `send-weekly-fast` | Sunday | 0 | `{"skipped": true, "dayOfWeek": X}` |
| `precompute-pursuit-briefs` | Sunday | 0 | `{"skipped": true, "dayOfWeek": X}` |
| `send-pursuit-fast` | Monday | 1 | `{"skipped": true, "dayOfWeek": X}` |

Test mode (`?test=true&email=...`) bypasses day guards for manual testing.

**Monitor Briefing Health:**
```bash
# Check what was sent today
curl "https://tools.govcongiants.org/api/admin/briefing-status?password=galata-assassin-2026"
```

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

**Email Products (April 16, 2026):**

| Product | Price | Emails Included |
|---------|-------|-----------------|
| **Daily Alerts** | $19/mo | Daily Alerts (simple opportunity list) |
| **Market Intelligence** | $49/mo | Daily Market Intel + Weekly Deep Dive + Pursuit Brief |

**Email Template Generators:**

| Email | Function | Colors | Header |
|-------|----------|--------|--------|
| Daily Alerts ($19/mo) | `send-notifications/route.ts` | Purple banner | "🎯 X New Opportunities" |
| Daily Market Intel ($49/mo) | `generateDailyEmailHtmlFromSam()` | **Green** `#059669→#10b981` | "📋 Active Solicitations" |
| Weekly Deep Dive ($49/mo) | `generateAIEmailTemplate()` | Navy→Purple `#1e3a8a→#7c3aed` | "📊 Weekly Deep Dive" |
| Pursuit Brief ($49/mo) | `generateCombinedPursuitEmailHtml()` | Navy→Purple | "YOUR TOP 3 PURSUIT TARGETS" |
| ~~Bid Target~~ | `bid-target-email-template.ts` | DEPRECATED | Not sending |

**Design Systems:**
- **GREEN** (`#059669→#10b981`): Daily Market Intel — "bid now" SAM.gov opportunities
- **NAVY→PURPLE** (`#1e3a8a→#7c3aed`): Weekly Deep Dive + Pursuit — strategic intelligence
- **PURPLE BANNER**: Daily Alerts — simple opportunity list
- **RED BANNER** (`#dc2626→#ef4444`): "🎯 Market Intelligence • FREE PREVIEW during beta" — on all $49/mo emails

**SAM.gov Recompete Matching (April 16, 2026):**

Weekly Deep Dive cross-references USASpending expiring contracts with SAM.gov opportunities using score-based matching:

| Factor | Points | Description |
|--------|--------|-------------|
| NAICS match | +20 | Required baseline |
| Agency match | +15 | First word of agency name |
| Incumbent name | +30 | SAM.gov mentions the incumbent |
| 50%+ keywords | +25 | At least half of significant words match |
| 30-49% keywords | +10 | Partial keyword match |
| Timing (≤12 mo) | +15 | SAM.gov posted within 12 months of expiration |
| Timing (≤18 mo) | +10 | Posted within 18 months |
| Timing (≤24 mo) | +5 | Posted within 24 months |
| Contract # ref | +40 | SAM.gov mentions predecessor contract number |

**Minimum score: 40** (NAICS + one strong factor) to show "SAM.gov STATUS" in email.

**Recompete Timeline Research:**
- Agencies start planning: 12-18 months before expiration
- Sources Sought/RFI: 6-12 months before RFP
- Pre-solicitation: 3-6 months before
- RFP posting: 2-4 months before expiration
- Total window: Solicitations appear **6-18 months** before contract expires

**Two-Stage Fetch & Score System (April 19, 2026):**

Weekly briefing precompute now uses a two-stage approach for better opportunity matching:

**Stage 1: Cast Wide Net (Fetch)**
For each NAICS profile, aggregates search criteria from ALL users in that group:
- NAICS codes (primary, from user profiles)
- PSC codes (derived via crosswalk from NAICS)
- Keywords (aggregated from all users in group)
- Target agencies (aggregated from all users in group)

Fetches from USASpending using OR logic across NAICS + PSC + keywords.

**Stage 2: Score & Rank (Filter)**

| Factor | Points |
|--------|--------|
| NAICS match | +25 |
| PSC match in description | +15 |
| Keyword in title | +20 |
| Keyword in description | +10 |
| Target agency match | +15 |
| Expiring <6 months | +10 |
| Expiring <1 year | +5 |
| Low bids (1-2) | +15 |
| Value $10M+ | +10 |
| Value $1M+ | +5 |

Top 15 highest-scoring opportunities selected for each template.

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

**Unified Market Intelligence UI (April 16, 2026):**
- `/briefings` — Single unified dashboard with 4 tabs: **BRIEFINGS | FORECASTS | SBIR | GRANTS**
- `/alerts/preferences` — Now redirects to `/briefings`
- Settings panel accessible via gear icon in dashboard header
- Onboarding wizard for new users (NAICS → Agencies → Geography → Delivery)
- Demo video: `https://vimeo.com/1181569155`

**MI Dashboard Tabs:**
| Tab | Color | Purpose | Data Source |
|-----|-------|---------|-------------|
| BRIEFINGS | Purple | Daily/Weekly/Pursuit intel | Pre-computed templates |
| FORECASTS | Amber | 7,764 agency forecasts 6-18mo ahead | `agency_forecasts` table |
| SBIR | Blue | SBIR/STTR small business R&D | NIH RePORTER API + Multisite |
| GRANTS | Emerald | $700B+ federal grant funding | Grants.gov REST API |

**New APIs (April 16, 2026):**
| API | Purpose | Auth Required |
|-----|---------|---------------|
| `/api/grants` | Grants.gov search wrapper | No |
| `/api/sbir` | NIH RePORTER + Multisite SBIR/STTR | No |

**New Components:**
- `src/components/briefings/GrantsPanel.tsx` — Grants search UI
- `src/components/briefings/SbirPanel.tsx` — SBIR/STTR search UI

**Dashboard Features (April 21, 2026):**
- **Search bar** — Find opportunities by title, agency, keywords with highlighting
- **Advanced filters** — Search, Notice Type, Urgency, Set-Aside, NAICS, State, Agency
- **Profile-based filtering** — Clicking from stats bar auto-filters by user's profile
- **CSV export** — Download filtered briefing data as spreadsheet
- **Print/PDF** — Browser print dialog for PDF export
- **Email feedback** — Thumbs up/down buttons in emails track helpfulness

**Forecasts Search Filters (April 21, 2026):**
- NAICS Code, Agency, State (NEW), Set-Aside, Keyword
- Auto-loads user profile when switching to FORECASTS tab
- Database has `pop_state`, `program_office`, `contracting_office` fields

**Feedback System:**
- API: `/api/briefings/feedback` (GET for email links, POST for programmatic)
- Pages: `/briefings/feedback/thanks`, `/briefings/feedback/error`
- Table: `briefing_feedback` (user_email, briefing_date, briefing_type, rating)

**UI Components:**
- `src/components/briefings/MarketIntelligenceHeader.tsx` — Dashboard header with MI branding
- `src/components/briefings/OnboardingWizard.tsx` — 4-step setup wizard
- `src/components/briefings/SettingsPanel.tsx` — Slide-out settings panel (all preferences)
- `src/components/briefings/SampleOpportunitiesPicker.tsx` — Sample opportunity picker wizard

**Profile Calibration Features (April 19, 2026):**

| Feature | API | Purpose |
|---------|-----|---------|
| AI Code Suggestions | `POST /api/suggest-codes` | Generate NAICS/PSC suggestions from business description |
| PSC/NAICS Search | `GET /api/suggest-codes?q=` | Direct keyword search for codes |
| Sample Opportunities | `POST /api/sample-opportunities` | Browse 29K+ real opportunities by description |
| Profile Extraction | `POST /api/sample-opportunities` (action: extract) | Extract NAICS/PSC/keywords from user selections |

**Sample Opportunities Picker Flow:**
1. User clicks "Browse Sample Opportunities" in Settings
2. Describes their business in free text
3. System shows 30 diverse real opportunities from `sam_opportunities` table
4. User selects opportunities that fit (minimum 3)
5. System extracts patterns (NAICS, PSC, keywords, agencies, set-asides)
6. User applies extracted profile to their settings

**Key Files:**
| File | Purpose |
|------|---------|
| `src/app/api/suggest-codes/route.ts` | AI code suggestion API (Groq Llama 3.3 70B) |
| `src/app/api/sample-opportunities/route.ts` | Sample opportunity picker API |
| `src/components/briefings/SampleOpportunitiesPicker.tsx` | 3-step picker wizard UI |
| `tests/test-suggest-codes.sh` | 23 test cases for code suggestions |
| `tests/test-sample-opportunities.sh` | 17 test cases for sample picker |

**Business Intelligence Storage (April 19, 2026):**

User profile data from the calibration wizard is now stored for:
- Better opportunity matching across all tools
- Customer insights and product intelligence
- Understanding user needs for fine-tuned products

**Database Table: `user_business_profiles`**
| Column | Type | Purpose |
|--------|------|---------|
| `business_description` | TEXT | Free-text business description from wizard |
| `extracted_naics_codes` | JSONB | NAICS codes from opportunity selections |
| `extracted_psc_codes` | JSONB | PSC codes from opportunity selections |
| `extracted_keywords` | JSONB | Keywords extracted from selections |
| `extracted_agencies` | JSONB | Target agencies from selections |
| `extracted_set_asides` | JSONB | Set-aside preferences |
| `opportunities_shown` | INT | How many samples were shown |
| `opportunities_selected` | INT | How many the user selected |
| `tools_used` | TEXT[] | Which tools the user has accessed |
| `reports_generated` | INT | Behavioral tracking |

**PSC Codes + Keywords in Briefings:**

Daily briefings now use the user's full profile for matching:
- NAICS codes (primary)
- PSC codes (industry classification)
- Keywords (catch mislabeled opportunities)

The `fetchSamOpportunitiesFromCache` function accepts all three and uses OR logic for broader matching.

**Admin Endpoint:**
`/api/admin/apply-business-intel-migration?password=xxx` — Check migration status

**Cron Schedule (ET):**
| Job | Times (ET) | Purpose |
|-----|------------|---------|
| daily-alerts | 7 AM, 8 AM, 10 AM, 12 PM | Timezone coverage (1 email/user/day, deduped) |
| precompute-briefings | 10:00-11:30 PM (prev night) | Daily templates by NAICS profile |
| send-briefings-fast | 3:00-4:30 AM (every 10 min) | Send daily briefings |
| precompute-weekly-briefings | Sat 4:00-6:00 PM | Weekly templates by NAICS profile |
| send-weekly-fast | Sun 3:00-4:30 AM (every 10 min) | Send weekly briefings |
| precompute-pursuit-briefs | Sun 4:00-6:00 PM | Pursuit templates by NAICS profile |
| send-pursuit-fast | Mon 3:00-4:30 AM (every 10 min) | Send pursuit briefs |
| weekly-alerts | 7 PM Sunday | Weekly digest |

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
| Watchdog Cron | Runs 5 AM, 5:30 AM, 6 AM ET daily to monitor health |
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

### 10. BD Assist (Enterprise Platform)
**Location:** `/src/app/bd-assist/`, `/src/components/bd-assist/`
**Purpose:** Unified BD department platform for enterprise contractors
**Price:** $199/mo (FREE lifetime for Ultimate Bundle buyers)
**Status:** Phase 1-2 complete (April 10, 2026)

**Features:**
- **Federal Market Scanner** — 6-question market intelligence (Who's buying? How? Who has it? What's available? Events? Who to talk to?)
- **Pipeline Tracker** — Kanban board with 6 stages (tracking → pursuing → bidding → submitted → won/lost)
- **Teaming CRM** — Partner management with outreach tracking
- **Intel Dashboard** — Daily briefs, opportunities, deadlines

**Database Tables:**
- `user_pipeline` — Opportunity tracking with stage history
- `pipeline_history` — Audit trail of stage changes
- `user_teaming_partners` — Teaming partner CRM

**API Endpoints:**
| Endpoint | Purpose |
|----------|---------|
| `GET/POST/PATCH/DELETE /api/pipeline` | Pipeline CRUD |
| `GET /api/pipeline/stats` | Pipeline metrics by stage |
| `GET/POST/PATCH/DELETE /api/teaming` | Teaming partners CRUD |
| `GET /api/market-scanner` | 6-question market scan |

**Key Files:**
| File | Purpose |
|------|---------|
| `src/app/bd-assist/page.tsx` | Main dashboard with tabs |
| `src/components/bd-assist/PipelineBoard.tsx` | Kanban board |
| `src/components/bd-assist/MarketScanner.tsx` | 6-question scanner UI |
| `src/app/api/market-scanner/route.ts` | Scanner API (870 lines) |
| `supabase/migrations/20260410_bd_assist_pipeline.sql` | Database schema |

**Live URL:** https://tools.govcongiants.org/bd-assist

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

### Agency Pain Points & Intelligence (April 19, 2026)

**Static Data:** `src/data/agency-pain-points.json`
- **307 agencies** (expanded from 250)
- **3,045 pain points** (+280 from GAO reports)
- **2,611 priorities** (+111 from spending patterns)

**Database:** `agency_intelligence` table in Supabase
- **557 records** from real public APIs
- **446 gao_high_risk** records (GovInfo API)
- **111 contract_pattern** records (USASpending API)

**Unified API:** `src/lib/agency-intelligence/index.ts`
```typescript
import { getUnifiedAgencyIntelligence, getAgencyPainPointsUnified } from '@/lib/agency-intelligence';
const intel = await getUnifiedAgencyIntelligence('Department of Defense');
```

**Merge Script:**
```bash
node scripts/merge-agency-intelligence.js --preview  # Preview
node scripts/merge-agency-intelligence.js --merge    # Apply
```

**Admin:** `/api/admin/sync-agency-intel?password=xxx`
**API:** `/api/pain-points`

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
| `src/app/api/suggest-codes/route.ts` | AI code suggestion (Groq Llama 3.3 70B) |
| `src/app/api/sample-opportunities/route.ts` | Sample opportunity picker for profile calibration |
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
| `/api/admin/tool-health` | **AI Tool Health Dashboard** — unified monitoring |
| `/api/admin/apply-tool-errors-migration` | Apply tool_errors database migration |

---

## AI Tool Health Dashboard (April 19, 2026)

**Purpose:** Unified monitoring for all AI-powered tools to track errors, success rates, and API provider health.

### Dashboard API

```bash
# Get dashboard data (last 7 days)
curl "https://tools.govcongiants.org/api/admin/tool-health?password=galata-assassin-2026"

# Get specific tool data
curl "https://tools.govcongiants.org/api/admin/tool-health?password=galata-assassin-2026&tool=content_reaper"

# Include resolved errors
curl "https://tools.govcongiants.org/api/admin/tool-health?password=galata-assassin-2026&unresolvedOnly=false"

# Resolve an error
curl -X POST "https://tools.govcongiants.org/api/admin/tool-health?password=galata-assassin-2026" \
  -H "Content-Type: application/json" \
  -d '{"action": "resolve", "errorId": "uuid", "notes": "Fixed by..."}'

# Check all provider health
curl -X POST "https://tools.govcongiants.org/api/admin/tool-health?password=galata-assassin-2026" \
  -H "Content-Type: application/json" \
  -d '{"action": "check_providers"}'
```

### Monitored Tools

| Tool Name | API Endpoint | AI Provider |
|-----------|--------------|-------------|
| `content_reaper` | `/api/content-generator/generate` | Groq |
| `code_suggestions` | `/api/suggest-codes` | Groq |
| `briefings` | `/api/cron/*-briefings` | Groq |
| `market_scanner` | `/api/market-scanner` | Groq |
| `sample_opportunities` | `/api/sample-opportunities` | Groq |

### Error Types

| Type | Description |
|------|-------------|
| `ai_timeout` | AI provider didn't respond in time |
| `ai_rate_limit` | Hit API rate limits (429 errors) |
| `ai_token_limit` | Exceeded token limits |
| `api_error` | External API failures |
| `validation` | Invalid input/request |
| `internal` | Server-side errors |

### Provider Status

Tracks health of external APIs:
- **groq** — Primary AI provider
- **openai** — Secondary AI provider
- **sam_gov** — SAM.gov Opportunities API
- **usaspending** — USASpending.gov API
- **grants_gov** — Grants.gov API

### Database Tables

| Table | Purpose |
|-------|---------|
| `tool_errors` | Per-error log with stack traces |
| `tool_health_metrics` | Daily aggregates by tool |
| `api_provider_status` | Real-time provider health |

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/tool-errors.ts` | Error logging library |
| `src/app/api/admin/tool-health/route.ts` | Dashboard API |
| `supabase/migrations/20260419_tool_errors.sql` | Database schema |

### Integration Example

```typescript
import { logToolError, recordToolSuccess, ToolNames, classifyError, AIProviders } from '@/lib/tool-errors';

// Log an error
await logToolError({
  tool: ToolNames.CONTENT_REAPER,
  errorType: classifyError(error),
  errorMessage: error.message,
  aiProvider: AIProviders.GROQ,
  aiModel: 'llama-3.3-70b-versatile',
});

// Record success
recordToolSuccess(ToolNames.CONTENT_REAPER).catch(() => {});
```

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
9. **Supabase LIKE uses `%` not `*`** — For pattern matching, use `naics_code.like.236%` not `naics_code.like.236*`. The `*` wildcard returns 0 results.

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

*Last Updated: April 21, 2026 — MI Dashboard Advanced Filters (NAICS, State, Agency), Forecasts State Filter*
