# GovCon Giants - Current Tasks

## Session State (April 9, 2026)

### ✅ COMPLETED: BD Assist API & MCP Infrastructure

**Status:** Deployed to production (April 9, 2026)

**New APIs Live:**
| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/api/pipeline` | Opportunity tracking CRUD | ✅ Working |
| `/api/teaming` | Saved partners management | ✅ Working |
| `/api/teaming/suggest` | AI partner suggestions | ✅ Working |
| `/api/admin/data-health` | Data coverage dashboard | ✅ Working (80% coverage) |

**Database Tables Created:**
- `user_pipeline` — Opportunity tracking with stages
- `pipeline_history` — Audit trail for stage changes
- `user_teaming_partners` — Saved teaming partners

**Migration:** `supabase/migrations/20260410_pipeline_tracker.sql`

**Data Extensibility System:**
- Central registry: `src/lib/data-sources/registry.ts`
- Documents all data sources with coverage tracking
- Easy to add new sources following documented pattern

**bdassist-mcp Server:**
- Location: `/Users/ericcoffie/mcp-servers/bdassist/`
- 14 tools: Intel (5), Pipeline (4), Teaming (5)
- Added to Claude config at `~/.claude.json`

**Next Steps:**
- [ ] Build BD Assist dashboard UI
- [ ] Add more forecast sources (DOD, HHS, USDA)
- [ ] Capture strategy API

---

## Previous Session State (April 6, 2026)

### ✅ COMPLETED: Forecast Intelligence System - Phase 1-2

**Status:** 7,764 forecasts from 13 agencies (April 6, 2026)

**Data Sources:**
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

**Key Achievement:** Discovered GSA Acquisition Gateway CSV export (acquisitiongateway.gov/forecast) - single source for 7 agencies with 2,698 records.

**Import Scripts:**
- `scripts/import-forecasts.js` - Excel import (DOE, NASA, DOJ)
- `scripts/import-gsa-forecasts.js` - GSA Acquisition Gateway CSV import
- `scripts/import-nsf-forecasts.js` - NSF PDF data import (hardcoded from PDF)
- `scripts/import-ssa-forecasts.js` - SSA Excel (.xlsm) import

**Files Created/Modified:**
- `scripts/import-gsa-forecasts.js` - NEW: Parses CSV with value ranges, set-asides, dates
- `src/lib/forecasts/scrapers/` - Puppeteer scrapers (DHS working, others return 0)
- Updated `CLAUDE.md` with Forecast Intelligence section

**Phase 3-4 Pending (Puppeteer scrapers):**
- HHS, Treasury, EPA, USDA, DOD - require SPA login or different approach
- Alternative: Re-download GSA Acquisition Gateway CSV periodically

---

### Previous: Multisite Aggregation - Phase 1 (Scrapers + Crons)

**Scrapers Built:**
1. **NIH RePORTER** - Working, 100 opportunities scraped
2. **DARPA BAA** (via Grants.gov) - Working, 6 BAAs scraped
3. **NSF SBIR** (via SBIR.gov) - API rate limited (429), will retry automatically

**Cron Jobs Configured (vercel.json):**
- NIH Reporter: `0 4 * * *` (4 AM UTC daily)
- DARPA BAA: `0 5 * * *` (5 AM UTC daily)
- NSF SBIR: `0 6 * * *` (6 AM UTC daily)

**Database State:**
- `aggregated_opportunities`: **106 rows** (100 NIH + 6 DARPA)
- `multisite_sources`: 24 sources configured
- `scrape_log`: Audit trail working

**Files Created:**
- `src/lib/scrapers/apis/sbir-gov.ts` - SBIR.gov API client
- `src/lib/scrapers/apis/darpa-baa.ts` - SAM.gov DARPA scraper (not used)
- `src/lib/scrapers/apis/grantsgov-darpa.ts` - Grants.gov DARPA scraper (active)
- Updated `src/lib/scrapers/index.ts` - Exports new scrapers
- Updated `src/app/api/cron/snapshot-multisite/route.ts` - Uses new scrapers

**Deferred (6 months):**
- Daily Briefings integration - will revisit after multisite scraping stabilizes

**MCP Tools:**
```bash
mcp__multisite__search_multisite     # Search all sources
mcp__multisite__get_multisite_stats  # Stats (106 total opps)
mcp__multisite__get_source_health    # Source health status
mcp__multisite__trigger_scrape       # Manual trigger
```

---

### Previous: Multisite Database Setup

---

### ✅ COMPLETED: USASpending MCP Fix

**Problem:** USASpending MCP was returning 422 Unprocessable Entity errors.

**Root Cause:** The USASpending API requires `award_type_codes` in the filters (mandatory field).

**Fix Applied:**
- Added `award_type_codes: ["A", "B", "C", "D"]` to filters in `/Users/ericcoffie/mcp-servers/usaspending-mcp/index.js`
- Updated default fiscal year from 2024 to 2025
- Award type codes: A=BPA Call, B=Purchase Order, C=Delivery Order, D=Definitive Contract

**Test Command:**
```bash
mcp__usaspending__search_contracts with naics="541512" state="FL" limit=5
```

---

## Previous Session (April 4, 2026)

### ✅ COMPLETED: Moat 7 - Agency Hierarchy API v2

**Built unified federal agency intelligence API** combining:
- SAM.gov Federal Hierarchy (official org structure)
- Pain Points Database (250 agencies, 2,765 pain points)
- Contractor/SBLO contacts (2,768 contractors)
- Agency aliases (450+ abbreviation mappings)
- USASpending.gov (spending aggregations)

**Files Created:**
- `src/lib/agency-hierarchy/` - Core module (index, unified-search, pain-points-linker, spending-stats)
- `src/data/agency-aliases.json` - 450+ alias mappings (VA→Veterans Affairs, etc.)
- `docs/agency-hierarchy-api.md` - Full API documentation
- `tests/test-agency-hierarchy.sh` - 15 automated tests

**API Endpoint:** `/api/agency-hierarchy`

**Example Usage:**
```bash
# Search by abbreviation
curl "https://tools.govcongiants.org/api/agency-hierarchy?search=VA"

# CGAC code lookup
curl "https://tools.govcongiants.org/api/agency-hierarchy?cgac=069"

# Get spending data
curl "https://tools.govcongiants.org/api/agency-hierarchy?mode=spending&agency=DOD"

# Find buying offices for NAICS
curl "https://tools.govcongiants.org/api/agency-hierarchy?naics=541512&mode=buying"
```

**Test:** `./tests/test-agency-hierarchy.sh local` or `./tests/test-agency-hierarchy.sh prod`

---

## 📋 NEXT PRIORITY: Ship Daily Briefings

**Goal:** Get Daily Briefings working reliably for current users before expanding

**Current Status:**
- ✅ Briefings code working
- ✅ 457 users enrolled
- ⏳ Monitoring delivery for 2-3 weeks

**After Briefings Ship:**
1. Batch enroll 8,804 bootcamp attendees
2. Recompete Tracker: Add 2027 data
3. 21-Day Free Trial system
4. Restore and finish DSBS Profile Scorer after Federal Market Scanner is complete

---

## 🔮 DEFERRED: Market Intelligence Expansion

**Pushed to future date - after briefings ship successfully**

### Moat 6 - Multi-Site Aggregation
**Goal:** Scrape 85+ agency sites that SAM.gov doesn't capture (DOE Labs, NIH, DARPA, etc.)

**Status:** MCP built, needs data population

**Multisite MCP Ready:**
- ✅ MCP server at `/Users/ericcoffie/mcp-servers/multisite/`
- ✅ Configured in `~/.mcp.json`
- ✅ 21 sources defined (Tier 1-3)
- ❌ 0 opportunities in database - scrapers need to run

### Phase 3-4 Forecast Scrapers (Puppeteer)
| Agency | Source | Est. Coverage |
|--------|--------|---------------|
| HHS | procurementforecast.hhs.gov | $12B |
| Treasury | osdbu.forecast.treasury.gov | $2B |
| EPA | ordspub.epa.gov | $1.5B |
| USDA | forecast.edc.usda.gov | $4B |
| DOD | Multi-source | $40B |

### Post-FMS Follow-Up
- DSBS Profile Scorer
  - keep off the tools/store page until Federal Market Scanner is shipped
  - revisit positioning, UX, and scoring logic after FMS launch

---

## Previous Session State (April 3, 2026)

### 🔥 CRITICAL FIX: Daily Briefings Now Working

**Problem:** Briefings were being logged as "sent" in database but no one received them for 3 weeks.

**Root Causes Found & Fixed:**

1. **JSON Parsing Error** - AI responses from Claude contained control characters that broke `JSON.parse()`
   - **Fix:** Added `extractAndParseJSON()` helper with robust sanitization in `ai-briefing-generator.ts`

2. **Timezone Filter Blocking 90%+ Users** - Only sent if local time 6-10 AM, but cron ran at wrong time
   - **Fix:** Removed timezone filter entirely - briefings now go to ALL users

3. **Cron Schedule Wrong** - Was running at 10 AM UTC (5-6 AM ET)
   - **Fix:** Changed to 7 AM UTC (2-3 AM ET) so users see briefings when they wake up

4. **Small Batch Sizes** - Only 10 users/batch, max 200 users/run
   - **Fix:** Increased to 25/batch, 1000 max users per run

**Files Modified:**
- `src/lib/briefings/delivery/ai-briefing-generator.ts` - Added JSON sanitization
- `src/app/api/cron/send-briefings/route.ts` - Removed timezone filter, increased batches
- `vercel.json` - Changed cron from `0 10 * * *` to `0 7 * * *`
- `src/app/api/admin/enable-briefings-all/route.ts` - New admin endpoint

**Verification:** 9 briefings sent successfully via trigger-briefings. Check if zach@govcongiants.com received email.

**Current Cron Schedule:**
| Job | Schedule (UTC) | Local (ET) |
|-----|----------------|------------|
| send-briefings | 7 AM | 2-3 AM |
| daily-alerts | 11 AM, 12 PM, 2 PM, 4 PM | 6-7 AM, 7-8 AM, 9-10 AM, 11 AM-12 PM |

---

## 📋 ACTIVE: Intelligence Platform Moat Strategy

**PRD:** `docs/PRD-intelligence-platform.md`

### Priority Order:
1. **NOW:** Moat 1 & 2 - Validate with 800 users (30 days) ← FIXING BRIEFINGS
2. **NEXT:** Moat 3 - Proprietary Knowledge Base (RAG)
3. **THEN:** Moat 4 - GovCon Data API
4. **LAST:** Part 2 - Lead conversion for 8,000

### Phase 1A: 21-Day Free Trial (PENDING - After briefings confirmed)
- [ ] Add `trial_start_date`, `trial_end_date` columns
- [ ] Create trial signup flow
- [ ] Email sequence (welcome, day 14, day 18, day 21)
- [ ] Trial expiration cron

### Phase 1B: Weekly Bids Report (PENDING)
- [ ] New cron `weekly-bids-report` (Monday 6 AM local)
- [ ] Query SAM.gov for all open opps by user NAICS
- [ ] Categorize by notice type
- [ ] Format as digest email

---

## 📋 FUTURE TASKS (After Moat Phases)

### Recompete Tracker: Expand to 2027 Data
**Priority:** After Moat 1 & 2 validation
**Current state:** 9,450 contracts, all 2026 expirations
**Target:** Add contracts expiring through Oct 2027 (18-month window)

**Why:** Recompete tracking should be 12-18 months out for proper positioning

**Script ready:** `scripts/fetch-2027-contracts.js`
```bash
# Fetch and preview 2027 data
node scripts/fetch-2027-contracts.js

# Fetch and merge into contracts-data.js
node scripts/fetch-2027-contracts.js --merge
```

**Tasks:**
- [ ] Run 2027 fetch script
- [ ] Verify data quality (no duplicates, proper formatting)
- [ ] Update cron job date range to include 2027
- [ ] Deploy with expanded dataset
- [ ] Update "Data Through" display to show Oct 2027

---

## Previous Session State (March 30, 2026)

### 🎯 PRIORITY: JTED 2026 Companion Guide & Landing Page

**Event:** JTED 2026 AEC Industry Day at MacDill AFB — April 1, 2026

**Full plan saved at:** `presentations/JTED-2026-PLAN.md`

#### Completed Tasks (Session 36 - March 30, 2026)
- [x] Pulled real expiring contract data from USASpending for 10 A/E/C contracts ($10B+ combined)
- [x] Created JTED Intel Pack HTML guide (`presentations/JTED-2026-Intel-Pack.html`)
- [x] Exported Intel Pack to PDF (`JTED-2026-Intel-Pack.pdf`)
- [x] Exported presentation slides to PDF (`JTED-2026-Slides.pdf`)
- [x] Created landing page at `/jted-2026` on govcon-funnels
- [x] Created thank-you page with download links at `/jted-2026/thank-you`
- [x] QR code slide already in presentation (slide 97) pointing to govcongiants.org/jted-2026

#### Pending: Deploy
- [ ] Deploy govcon-funnels to make /jted-2026 live

#### Guide Sections (Actionable Intel - NOT a copy of slides)
1. **10 Expiring A/E/C Contracts** — Daily briefing format with incumbent, value, why vulnerable
2. **5 Teaming Plays** — Specific primes to approach with suggested openers
3. **How to Set Up SAM.gov Alerts** — Step-by-step with screenshots
4. **How to Track Recompetes** — USASpending.gov walkthrough
5. **Top 5 SAT Agencies for Construction** — With search prefixes
6. **Sources Sought Response Template** — Copy-paste template
7. **IDIQ/MACC Vehicles Open for Bid** — Air Force RAES, NAVFAC MACC II, etc.
8. **AI Prompts for GovCon** — 4 copy-paste prompts
9. **Glossary & Resources**

#### Downloads (Landing Page)
1. A/E/C Federal Intel Pack (actionable guide)
2. Presentation Slides PDF (separate file)

#### Presentation Status
- **File:** `presentations/JTED-2026-Revised.html` (98 slides)
- **PDF:** `presentations/JTED-2026-Slides.pdf` (also in govcon-funnels/public/downloads/)
- **Completed:** Full content, QR code slide, SAM alerts, recompete tracking, all sections

#### Intel Pack Status
- **HTML:** `presentations/JTED-2026-Intel-Pack.html` (10 sections of actionable intel)
- **PDF:** `presentations/JTED-2026-Intel-Pack.pdf` (also in govcon-funnels/public/downloads/)
- **Contents:** 10 expiring contracts, 5 teaming plays, SAM alerts guide, Sources Sought template, AI prompts, glossary

#### Landing Page Status
- **URL:** govcongiants.org/jted-2026
- **Thank You:** govcongiants.org/jted-2026/thank-you (with download links)
- **Source tag:** `jted-2026-landing`

---

### 🔔 REMINDER: Batch Enroll Bootcamp Attendees (April 12-19, 2026)

**After 2-3 weeks of testing alerts with current 457 users, enroll the remaining bootcamp attendees.**

**Action:** Run this command to enroll 8,804 bootcamp attendees:
```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"
cat data/bootcamp-attendees-to-enroll.txt | while read email; do
  curl -s -X POST "https://tools.govcongiants.org/api/alerts/save-profile" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\", \"naicsCodes\": [\"541512\", \"541611\", \"541330\"], \"businessType\": \"\", \"source\": \"free-signup\"}"
done
```

**File location:** `data/bootcamp-attendees-to-enroll.txt` (8,804 emails)
**Source:** GHL contacts with any "bootcamp" tag

---

### Session 35 - Cron Fix & Bootcamp Enrollment (March 29, 2026)

#### Completed
- [x] Fixed cron health check (16/16 passing, was 15/16)
- [x] Migrated all code from `user_alert_settings` → `user_notification_settings`
- [x] Fixed `send-briefings`, `daily-alerts`, `trigger-alerts`, `save-profile`, `unsubscribe`, `briefings/preferences`
- [x] Enrolled 58 Contract Vehicles Bootcamp attendees (Mar 28)
- [x] Pulled 8,804 total bootcamp attendees from GHL (all tags containing "bootcamp")
- [x] Saved to `data/bootcamp-attendees-to-enroll.txt` for future batch enrollment

#### Pending
- [ ] Verify alerts/briefings working with current 457 users (2-3 weeks)
- [ ] Batch enroll 8,804 bootcamp attendees after verification

---

## Previous Session State (March 28, 2026)

### Just Completed - Market Intelligence Pipeline Fix

**MAJOR FIX:** Daily Alerts and Daily Briefs now reach ALL 394+ users

#### What Was Wrong
- Daily Alerts queried `user_alert_settings` (394 users) ✅
- Daily Briefs/Snapshots ONLY queried `user_notification_settings` (32 users) ❌
- 362 users (94%) were missing Daily Briefs entirely

#### What We Fixed
- [x] `send-briefings/route.ts` - Now queries BOTH tables, deduplicates by email
- [x] `snapshot-recompetes/route.ts` - Now queries BOTH tables + fallback NAICS
- [x] `snapshot-awards/route.ts` - Now queries BOTH tables + fallback NAICS
- [x] Added fallback NAICS codes: `541512, 541611, 541330, 236220, 238210`
- [x] Added construction NAICS (236, 238) to coverage
- [x] Auto-enroll ALL purchasers in alert_settings via Stripe webhook
- [x] Added "BONUS: Free Daily Alerts" section to all purchase emails

#### New Admin Endpoints
- `/api/admin/test-market-intel-pipeline` - Full pipeline status/testing
- `/api/admin/sync-alert-to-notification` - Sync users between tables
- `/api/admin/send-naics-reminder` - Send NAICS setup reminder emails

#### Documentation Updated
- [x] `tasks/lessons.md` - 5 new lessons (two-table problem, fallback NAICS, etc.)
- [x] `docs/ecosystem.md` - Market Intel pipeline diagram
- [x] `CLAUDE.md` - New endpoints + bug prevention rules

#### Market Intelligence Pricing (Finalized)

**Beta Period:** Now through April 27, 2026 (FREE for everyone)

**Post-Beta Pricing:**
| User Type | Daily Alerts ($19/mo) | Daily Briefings ($49/mo) |
|-----------|----------------------|--------------------------|
| OH Free users (no purchase) | ❌ Pay $19/mo | ❌ Pay $49/mo |
| OH Pro ($19/mo) subscribers | ✅ Included | ❌ Pay $49/mo |
| Any product buyer (excl OH free) | ✅ Free | ❌ Pay $49/mo |
| Pro Giant ($997) | ✅ Free | ✅ 1 year free |
| Ultimate ($1,497) | ✅ Free | ✅ Lifetime free |
| Beta users (no purchase) | 30 days free → $19/mo | 30 days free → $49/mo |

**Schedule:**
- **Daily Alerts** (4x/day) - SAM.gov opportunities matching user NAICS
- **Daily Briefs** (7 AM UTC) - Recompete intel, awards, teaming leads
- **Weekly Pursuit Brief** (Monday 10 AM UTC) - Auto-selects TOP opportunity
- **Weekly Deep Dive** (Sunday 10 AM UTC) - Comprehensive market analysis

#### Test Endpoints
```bash
# Test full pipeline
curl "https://tools.govcongiants.org/api/admin/test-market-intel-pipeline?password=galata-assassin-2026"

# Test specific user
curl "https://tools.govcongiants.org/api/admin/test-market-intel-pipeline?password=galata-assassin-2026&email=user@example.com"

# Send test component
curl -X POST "https://tools.govcongiants.org/api/admin/test-market-intel-pipeline?password=galata-assassin-2026&email=user@example.com&component=briefs"
```

### Previously Completed - SAM.gov API Integration (Phase 1-4)

Full SAM.gov API integration to replace retired FPDS.gov. Implemented 4 APIs with USASpending fallback.

#### Phase 1: Contract Awards API
- [x] Created `src/lib/sam/contract-awards.ts` - Core wrapper
- [x] Created `src/lib/sam/usaspending-fallback.ts` - Fallback for bid counts
- [x] USASpending as primary source (no System Account needed)
- [x] Bid count data working (numberOfOffersReceived)
- [x] Competition level classification (sole_source, low, medium, high)
- [x] Admin test endpoint: `/api/admin/test-sam-awards`
- [x] USASpending test endpoint: `/api/admin/test-usaspending`

#### Phase 2: Entity Management API
- [x] Created `src/lib/sam/entity-api.ts`
- [x] Search entities by name, UEI, CAGE, NAICS
- [x] SAM status verification
- [x] Certification lookups (8a, SDVOSB, WOSB, HUBZone)
- [x] Admin test endpoint: `/api/admin/test-sam-entity`

#### Phase 3: Federal Hierarchy API
- [x] Created `src/lib/sam/federal-hierarchy.ts`
- [x] Agency structure lookups
- [x] Office search by NAICS
- [x] Buying offices summary
- [x] Admin test endpoint: `/api/admin/test-sam-hierarchy`
- [x] Public endpoint: `/api/agency-hierarchy`

#### Phase 4: Subaward API
- [x] Created `src/lib/sam/subaward-api.ts`
- [x] Prime→Sub relationship mapping
- [x] Teaming network builder
- [x] Admin test endpoint: `/api/admin/test-sam-subaward`
- [ ] **BLOCKED:** Requires SAM.gov System Account (requested, waiting 1-4 weeks)

#### Shared Infrastructure
- [x] Created `src/lib/sam/utils.ts` - Rate limiting, caching, error handling
- [x] Created `src/lib/sam/index.ts` - Unified exports
- [x] Supabase cache table: `sam_api_cache`
- [x] Rate limit: 1,000 requests/day with in-memory tracking
- [x] Cache TTL: 24h for awards/entity, 1h for opportunities

### Waiting On
- [ ] SAM.gov System Account approval (1-4 weeks)
  - Entity reactivated ✅
  - Request submitted ✅
  - Once approved: Contract Awards + Subaward APIs will use SAM.gov directly

### Pending
- [ ] Teaming network visualization (blocked on Subaward API access)
- [ ] Enrich Recompete Tracker static data with bid counts
- [ ] Create JTED landing page with downloadable handout (`/jted`)

---

## API Status

| API | Status | Source | Requires System Account |
|-----|--------|--------|------------------------|
| Opportunities | ✅ Working | SAM.gov | No |
| Entity Management | ✅ Working | SAM.gov | No |
| Federal Hierarchy | ✅ Working | SAM.gov | No |
| Contract Awards | ✅ Working | **USASpending** | Yes (using fallback) |
| Subaward | ⏳ Waiting | SAM.gov | Yes |

## Test Endpoints

```bash
# Contract Awards (uses USASpending)
curl "https://tools.govcongiants.org/api/admin/test-sam-awards?password=galata-assassin-2026&naics=541512"

# USASpending direct
curl "https://tools.govcongiants.org/api/admin/test-usaspending?password=galata-assassin-2026&naics=541512"

# Entity lookup
curl "https://tools.govcongiants.org/api/admin/test-sam-entity?password=galata-assassin-2026&name=Booz"

# Federal Hierarchy
curl "https://tools.govcongiants.org/api/admin/test-sam-hierarchy?password=galata-assassin-2026&agency=VA"

# Subaward (blocked until System Account)
curl "https://tools.govcongiants.org/api/admin/test-sam-subaward?password=galata-assassin-2026&prime_uei=XXX"
```

---

## Previous Session Work

### Session 34 (Mar 28, 2026)
- Fixed Market Intelligence pipeline (two-table problem)
- All 394+ users now receive Daily Alerts AND Daily Briefs
- Added construction NAICS (236, 238) to coverage
- Auto-enroll all purchasers in alerts
- Added bonus section to purchase emails
- Created 3 new admin endpoints for pipeline testing

### Session 33 (Mar 26, 2026)
- Daily Alerts vs Market Intelligence clarification
- SAM.gov API integration (Phase 1-4)

### Session 31 (Mar 23, 2026)
- Alerts & Briefings System Overhaul
- Made daily alerts FREE FOR EVERYONE during beta
- Added deduplication, retry logic, timezone-aware delivery
- Added PSC crosswalk for broader search

---

## Health Check Access
```
HTML: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026&format=html
JSON: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026
```

---

## Quick Reference

**Projects:**
- Market Assassin (tools): `~/Market Assasin/market-assassin`
- GovCon Shop (production): `~/govcon-shop`
- GovCon Funnels (marketing): `~/govcon-funnels`

**Resume command:** `/continue`

**Last updated:** March 28, 2026 (Session 34)
