# Market Assassin - Session History

This file contains detailed session history for the Market Assassin project. For current project context, see [CLAUDE.md](./CLAUDE.md).

---

## Session 39 (Apr 9, 2026)

### Enterprise Pre-computation for ALL 3 Briefing Types

**Goal:** Apply the same pre-computation architecture from Daily Briefs to Weekly Deep Dive and Pursuit Brief, enabling delivery to all 928 users.

#### The Problem

Session 38 fixed Daily Briefs with pre-computation (49 templates vs 928 individual generations), but:
- Weekly Deep Dive still used per-user generation (52+ seconds each)
- Pursuit Brief still used per-user generation (52+ seconds each)
- Rollout was stuck at 250 users due to these two briefings

#### The Solution

Applied Microsoft/Oracle-style enterprise pre-computation to ALL 3 briefing types:

| Briefing | Pre-compute Cron | Send Cron | Schedule |
|----------|------------------|-----------|----------|
| Daily Brief | `precompute-briefings` | `send-briefings-fast` | Daily 2-4 AM → 7-8:30 AM |
| Weekly Deep Dive | `precompute-weekly-briefings` | `send-weekly-fast` | Sat 8-10 PM → Sun 7-8:30 AM |
| Pursuit Brief | `precompute-pursuit-briefs` | `send-pursuit-fast` | Sun 8-10 PM → Mon 7-8:30 AM |

#### Results

| Metric | Before | After |
|--------|--------|-------|
| LLM Calls/week | 928 × 3 = **2,784** | 49 × 3 = **147** (95% reduction) |
| Time per briefing | 52+ seconds | ~40s (template) + ~100ms (send) |
| Users per cron run | ~1 | **500+** |
| Rollout mode | `rollout` (250 users) | **`beta_all` (927 users)** |

#### Files Created

- `src/app/api/cron/precompute-weekly-briefings/route.ts` — Weekly templates by NAICS profile (Sat 8-10 PM)
- `src/app/api/cron/send-weekly-fast/route.ts` — Match users to weekly templates, send emails (Sun 7-8:30 AM)
- `src/app/api/cron/precompute-pursuit-briefs/route.ts` — Pursuit templates by NAICS profile (Sun 8-10 PM)
- `src/app/api/cron/send-pursuit-fast/route.ts` — Match users to pursuit templates, send emails (Mon 7-8:30 AM)

#### vercel.json Updates

- Removed old `weekly-deep-dive` and `pursuit-brief` crons
- Added 5 precompute-weekly-briefings runs (Sat 8, 8:30, 9, 9:30, 10 PM UTC)
- Added 10 send-weekly-fast runs (Sun 7-8:30 AM, every 10 min)
- Added 5 precompute-pursuit-briefs runs (Sun 8, 8:30, 9, 9:30, 10 PM UTC)
- Added 10 send-pursuit-fast runs (Mon 7-8:30 AM, every 10 min)

#### Rollout Switch

Changed briefing rollout from `rollout` (250-user cohorts) to `beta_all` (all 927 users):
```bash
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=galata-assassin-2026" \
  -d '{"mode":"beta_all"}'
# Response: {"success":true,"selectedUsers":927}
```

#### Key Insight

The enterprise pre-computation pattern works identically for all 3 briefing types:
1. **Pre-compute phase:** Generate 49 templates (one per unique NAICS profile hash)
2. **Send phase:** Match each user to their template via MD5 hash (~100ms)
3. **Result:** 95% reduction in LLM calls, 500+ users per cron run

#### Prefix Fallback for Custom Profiles

When users create custom NAICS profiles via the preferences page (e.g., `236, 237, 238` for construction), they may not have an exact template match. To handle this:

1. **Prefix extraction:** Extract 3-digit NAICS prefixes from both user profile and templates
2. **Fallback matching:** If exact hash doesn't match, try prefix matching
3. **Immediate delivery:** Users get briefings via prefix match until their exact profile is processed

**Functions added:**
- `extractNaicsPrefixes()` — Extracts 3-digit industry prefixes
- `buildPrefixMap()` — Maps prefixes to best-matching template

**API enhancement:**
- `POST /api/alerts/preferences` now stores `naics_profile_hash` and `profile_updated_at` when NAICS codes change

**Result:** Zero users miss briefings due to custom profiles.

---

## Session 38 (Apr 8, 2026)

### Enterprise Pre-computation Architecture for Briefings

**Goal:** Fix briefing delivery to handle 928+ users when individual generation takes 52+ seconds per user (impossible within Vercel's 60s timeout).

#### The Problem

- 928 users with briefings enabled
- Each briefing took 52-111 seconds to generate (LLM + data fetching)
- Vercel timeout: 60 seconds
- Previous approach: generate per-user = impossible at scale

#### The Solution

Implemented Microsoft/Oracle-style enterprise pre-computation:

1. **Analyzed NAICS distribution**: 928 users → only 49 unique NAICS profiles
2. **Pre-compute by profile**: Generate 49 templates instead of 928 individual briefings
3. **Match at send time**: Users match to templates via MD5 hash (~100ms)

#### Results

| Metric | Before | After |
|--------|--------|-------|
| LLM Calls/day | 928 | **49** (95% reduction) |
| Time per briefing | 52-111s | ~40s (template generation) |
| Send time per user | N/A | ~100ms |
| Users per cron run | ~1 | **500+** |

#### Files Created

- `src/app/api/cron/precompute-briefings/route.ts` - Generates 10 templates per run
- `src/app/api/cron/send-briefings-fast/route.ts` - Matches users to templates, sends emails
- `supabase/migrations/20260408_briefing_templates.sql` - Database schema
- `scripts/apply-briefing-templates-migration.sql` - Reference SQL

#### Database Tables Added

- `briefing_templates` - Pre-computed briefings by NAICS profile hash
- `briefing_precompute_runs` - Tracks nightly template generation

#### Cron Schedule (vercel.json)

| Job | Times (UTC) | Purpose |
|-----|-------------|---------|
| precompute-briefings | 2:00, 2:30, 3:00, 3:30, 4:00 AM | Generate templates (10 per run) |
| send-briefings-fast | 7:00-8:30 AM (every 10 min) | Match users → send emails |

#### Key Insight

The top 4 NAICS profiles cover **881 of 928 users (95%)**:
- Profile 1: 530 users
- Profile 2: 345 users
- Profile 3: 3 users
- Profile 4: 3 users

Remaining 45 profiles serve just 47 users total.

---

## Session 37 (Apr 6, 2026)

### Briefings Rollout - Full Program Cohorts

**Goal:** Move briefings from broad beta to a controlled cohort rollout without rotating users before they experience the full product.

#### What Changed

1. **Production rollout deployed**
   - Switched from `beta_all` to `rollout`
   - First active cohort: 250 users
   - All 250 were profile-ready, 0 fallback

2. **Rollout model upgraded from daily-only to program-wide**
   - Shared cohort now gates:
     - Daily Brief
     - Weekly Deep Dive
     - Pursuit Brief
   - Added KV-backed per-user progress tracking

3. **Rotation rules tightened**
   - Minimum cohort window: 14 days
   - Required before normal rotation:
     - `daily brief` sent 2 times
     - `weekly deep dive` sent 2 times
     - `pursuit brief` sent 2 times
   - Manual rotation now blocked unless complete, unless forced

4. **Admin rollout endpoint expanded**
   - `/api/admin/briefing-rollout`
   - Now returns:
     - config
     - active cohort
     - cohort progress
     - remaining users by brief type
     - recommended next cohort sample

#### Production Verification

- Rollout config saved live:
  - `mode=rollout`
  - `cohortSize=250`
  - `stickyDays=14`
  - `cooldownDays=21`
  - `maxFallbackPercent=15`
  - `requiredDailyBriefs=2`
  - `requiredWeeklyDeepDives=2`
  - `requiredPursuitBriefs=2`
- Live deployment:
  - `market-assassin-2gzpzduq1-eric-coffies-projects.vercel.app`

#### Key Files Modified

- `src/lib/briefings/delivery/rollout.ts`
- `src/app/api/admin/briefing-rollout/route.ts`
- `src/app/api/cron/send-briefings/route.ts`
- `src/app/api/cron/weekly-deep-dive/route.ts`
- `src/app/api/cron/pursuit-brief/route.ts`
- `docs/briefing-rollout-runbook.md`
- `docs/briefings-system.md`
- `DEPLOYMENT.md`
- `API-REFERENCE.md`
- `CLAUDE.md`

#### Operational Note

The current cohort was originally created under the earlier rollout version, but rotation is now guarded by completion, so it will not rotate early just because of the old timer value.

---

## Session 37 (Apr 6, 2026)

### Forecast Intelligence - Phase 2-4 Scraper Testing

**Goal:** Run Puppeteer scrapers for remaining agencies (GSA, VA, HHS, DHS, Treasury, EPA, USDA, DOD)

#### Results

**Working:**
- ✅ **DHS** - 683 records imported via API interception method

**Broken (page structures changed):**
- ❌ GSA (acquisitiongateway.gov) - 0 records
- ❌ VA (vendorportal.ecms.va.gov) - 0 records
- ❌ HHS (procurementforecast.hhs.gov) - timeout
- ❌ Treasury (osdbu.forecast.treasury.gov) - 0 records
- ❌ EPA (ofmpub.epa.gov) - 0 records
- ❌ USDA (forecast.edc.usda.gov) - 0 records
- ❌ DOD (all 6 sub-sources) - 0 records

#### Fixes Applied

1. **Schema Mapping Fix** (`scripts/run-scrapers-tsx.ts:48-87`)
   - Changed `agency` → `source_agency`
   - Changed `id` → `external_id`
   - Updated upsert conflict key from `id` to `source_agency,external_id`

2. **Agency Key Mapping** (`scripts/run-scrapers-tsx.ts:20-32`)
   - Added `agencyKeyMap` to handle case sensitivity (e.g., `TREASURY` → `Treasury`)

#### Final Database State
| Agency | Records | Notes |
|--------|---------|-------|
| DOE | 833 | Phase 1 Excel |
| NASA | 294 | Phase 1 Excel |
| DOJ | 3,140 | Phase 1 Excel |
| DHS | 683 | Phase 3 Puppeteer (API interception) |
| **Total** | **4,950** | |

#### Key Files Modified
- `scripts/run-scrapers-tsx.ts` — Schema mapping + agency key fixes

---

## Session 36 (Apr 5, 2026)

### Forecast Intelligence - Phase 1 Import Fixes

**Goal:** Complete Phase 1 forecast imports (DOE, NASA, DOJ)

#### The Problem
Initial imports failed with "ON CONFLICT DO UPDATE command cannot affect row a second time" error because `external_id` generation used `Date.now()`, which created identical IDs for all records in a batch.

#### Fixes Applied

1. **Fixed DOE Parser ID Generation** (`scripts/import-forecasts.js`)
   - Changed from `Date.now()` to contract number as identifier
   - Fixed header row from 16 to 17 (DOE Excel format change)
   ```javascript
   const contractNum = getCol('Current Contract') || getCol('Contract Number');
   external_id: contractNum ? `DOE-${contractNum}` : null
   ```

2. **Fixed NASA Parser ID Generation**
   ```javascript
   external_id: id || null  // was: id || `NASA-${naicsCode}-${Date.now()}`
   ```

3. **Fixed DOJ Parser ID Generation**
   ```javascript
   external_id: trackingNum || null  // was: trackingNum || `DOJ-${naicsCode}-${Date.now()}`
   ```

4. **Added Deduplication Logic** - DOJ Excel had 245 actual duplicate rows
   ```javascript
   const deduped = new Map();
   for (const record of records) {
     deduped.set(record.external_id, record);
   }
   const uniqueRecords = Array.from(deduped.values());
   ```

#### Final Import Results
| Agency | Records | Notes |
|--------|---------|-------|
| DOE | 833 | energy.gov Excel |
| NASA | 294 | nasa.gov Excel |
| DOJ | 3,140 | justice.gov Excel (245 dupes removed) |
| **Total** | **4,267** | |

#### Key Files Modified
- `scripts/import-forecasts.js` — ID generation + deduplication

---

## Session 35 (Mar 30, 2026)

### JTED 2026 Package - COMPLETE

**Event:** JTED 2026 AEC Industry Day at MacDill AFB — April 1, 2026

#### Deliverables Created
| File | Size | Purpose |
|------|------|---------|
| `JTED-2026-Revised.html` | - | 98-slide HTML source |
| `JTED-2026-Compressed.pptx` | 8MB | PowerPoint (JPEG slides) |
| `JTED-2026-Intel-Pack.pdf` | - | Companion guide |
| `JTED-2026-Slides.pdf` | - | Slides PDF |

#### Landing Page Deployed
- **URL:** `govcongiants.org/jted-2026`
- **Thank You:** `govcongiants.org/jted-2026/thank-you`
- **GHL Tag:** `jted-2026-landing`
- **Downloads:** Intel Pack + Slides (email gated)

#### PowerPoint Export Process
1. Initial attempt: pandoc (failed - only 2 slides, no formatting)
2. Second attempt: python-pptx text extraction (wrong - small text)
3. Third attempt: Puppeteer screenshots (failed - scroll position bug)
4. **Final solution:** Puppeteer with `display:none` isolation + 2x deviceScaleFactor + JPEG compression
   - Script: `export-slides-compressed.js`
   - Result: 98 unique slides, 38MB → 8MB (79% smaller)

#### Intel Pack Contents
1. 10 Expiring A/E/C Contracts ($10B+ combined)
2. 5 Teaming Plays with word-for-word scripts
3. SAM.gov Alert Setup (step-by-step)
4. USASpending Recompete Tracking
5. Top 5 SAT Agencies for Construction
6. Sources Sought Response Template
7. IDIQ/MACC Vehicles Open for Bid
8. 4 AI Prompts for GovCon
9. Glossary of A/E/C Terms
10. Key Resources & Links

#### Key Files
| File | Purpose |
|------|---------|
| `presentations/export-slides-compressed.js` | JPEG export + PPTX creation |
| `govcon-funnels/src/app/jted-2026/page.tsx` | Landing page |
| `govcon-funnels/public/downloads/` | PDF files |

---

## Session 34 (Mar 28, 2026)

### Market Intelligence Pipeline Fix - Two Table Problem

**MAJOR FIX:** Daily Briefings were only reaching 32/394 users (8%) because snapshot crons and send-briefings only queried `user_notification_settings`, missing the 394 users in `user_alert_settings`.

#### The Problem
| Table | Users | What queried it |
|-------|-------|-----------------|
| `user_alert_settings` | 394 | Daily Alerts cron ✅ |
| `user_notification_settings` | 32 | Snapshot crons, Send Briefings ❌ |

#### The Fix
- **`send-briefings/route.ts`** — Now queries BOTH tables, deduplicates by email
- **`snapshot-recompetes/route.ts`** — Now queries BOTH tables + fallback NAICS
- **`snapshot-awards/route.ts`** — Now queries BOTH tables + fallback NAICS
- **Stripe webhook** — Auto-enrolls ALL purchasers in `user_alert_settings`
- **Purchase emails** — Added "BONUS: Free Daily Alerts" section to all confirmation emails

#### Fallback NAICS Codes
For users without NAICS codes set:
```typescript
['541512', '541611', '541330', '236220', '238210']
```
- Includes construction (236, 238) per Eric's request
- Ensures ALL users get relevant intel even without personalization

#### New Admin Endpoints
| Endpoint | Purpose |
|----------|---------|
| `/api/admin/test-market-intel-pipeline` | Full pipeline status + per-user testing |
| `/api/admin/sync-alert-to-notification` | Sync users between tables |
| `/api/admin/send-naics-reminder` | Send NAICS setup reminder emails |

#### Documentation Updated
- `tasks/lessons.md` — 5 new lessons (two-table problem, fallback NAICS, auto-enrollment, snapshot pipeline, testing checklist)
- `docs/ecosystem.md` — Market Intel pipeline diagram, cron schedule
- `CLAUDE.md` — New endpoints, bug prevention rules

#### Key Takeaways
1. Always query BOTH user tables for Market Intel
2. Always provide fallback NAICS for users without codes
3. Test full pipeline with `/api/admin/test-market-intel-pipeline`
4. Construction NAICS (236, 238) now included in coverage

---

## Session 33 (Mar 26, 2026)

### Daily Alerts vs Market Intelligence Clarification

**IMPORTANT DISTINCTION established:**
- **Daily Alerts** = FREE for everyone (beta) - simple SAM.gov opportunity notifications
- **Market Intelligence** = Premium (Pro/Ultimate bundles only) - 3 report types with deep analysis

### SAM.gov API Integration (Phase 1-4)

Full SAM.gov API integration to replace retired FPDS.gov. Implemented 4 APIs with USASpending fallback.

- **Phase 1:** Contract Awards API (USASpending fallback)
- **Phase 2:** Entity Management API
- **Phase 3:** Federal Hierarchy API
- **Phase 4:** Subaward API (blocked on System Account)

---

## Session 31 (Mar 23, 2026)

### Alerts & Briefings System Overhaul (Later)

Made daily alerts and briefings **FREE FOR EVERYONE** during beta. Complete system improvements:

#### Daily Alerts (`/api/cron/daily-alerts`)
- **Removed paywall** — All users get daily alerts free (removed Stripe/KV subscription checks)
- **Deduplication** — Won't resend same opportunity within 7 days (tracks `noticeId` in `alert_log.opportunities_data`)
- **Retry logic** — 3 attempts for failed emails with `retry_count` column
- **Timezone-aware delivery** — ~6 AM local time using UTC offset calculation
- **Keywords search** — Catch mislabeled opportunities by searching title/description
- **PSC crosswalk** — Auto-generates related PSC codes from NAICS using existing `getPSCsForNAICS()` function
- **Clean NAICS display** — Filters out non-numeric values (e.g., "236210, Industrial, Building" → "236210")
- **Removed state filter** — Always searches nationwide
- **FREE PREVIEW banners** — Added to emails so users know it's beta/test mode

#### Daily Briefings (`/api/cron/send-briefings`)
- **Made free for everyone** — Pulls from BOTH `user_notification_settings` AND `user_notification_settings` tables
- **Deduplication** — Checks `briefing_log` before sending
- **Retry logic** — 3 attempts within 3 days
- **Timezone-aware delivery** — 6-10 AM local time
- **FREE PREVIEW banner** — Added to email template

#### Preferences Page Redesign (`/alerts/preferences`)
- **New frequency radio buttons:** Daily / Weekly / Paused
- **New briefings section** with opt-in checkbox
- **New keywords field** for catching mislabeled opportunities
- **Clean NAICS codes** — Numeric only on load/save
- **Removed state filter** — Nationwide by default
- **FREE PREVIEW banners** — On both alerts and briefings sections
- **Clear unsubscribe option**

#### SQL Migrations Created
| File | Changes |
|------|---------|
| `alerts-schema-update.sql` | timezone, retry_count, alert_type columns |
| `briefings-schema-update.sql` | retry_count column |
| `keywords-schema-update.sql` | keywords TEXT[] column |

#### Cron Schedule (vercel.json)
| Job | Schedule (UTC) | Description |
|-----|----------------|-------------|
| send-briefings | 7 AM | Daily briefings |
| daily-alerts | 11 AM, 12 PM, 2 PM, 4 PM | Timezone coverage (4 runs) |
| weekly-alerts | 11 PM Sunday | Weekly digest |

#### Key Files Modified
- `src/app/api/cron/daily-alerts/route.ts` — Complete rewrite (639+ lines)
- `src/app/api/cron/send-briefings/route.ts` — Complete rewrite (394 lines)
- `src/app/alerts/preferences/page.tsx` — Complete redesign
- `src/app/api/alerts/preferences/route.ts` — Added keywords support
- `src/lib/briefings/delivery/email-template.ts` — FREE PREVIEW banner
- `vercel.json` — Added 3 more daily-alerts cron runs

---

### JTED Conference Presentation - Final Polish (Earlier)

Built and polished "State of the Union for Small Business" presentation for JTED Conference & MacDill AFB Industry Day (April 1, 2026).

**Presentation File:** `presentations/JTED-2026-Slides.html` (53 slides)

#### Screenshot Integration (Full-Size Hero Treatment)
User feedback: "the images should be the size of the slide not the afterthought"

Fixed all screenshot slides to use full-width centered images:
- Slide 31: SAM.gov pie chart (showing SAM is just one slice of opportunities)
- Slide 32: USASpending agency spend analysis dashboard
- Slide 33: OpenClaw Discord daily briefing screenshot
- Slide 35: LinkedIn analytics (110K impressions in 7 days)

**Image styling:**
```html
<div style="display: flex; justify-content: center; align-items: center; flex: 1;">
  <img src="images/X.png" style="max-width: 90%; max-height: 65vh; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.4);">
</div>
```

#### A/E/C IDIQ Restructure
Replaced generic IDIQ content with Southern US / A/E/C-focused opportunities using Recompete Tracker data:
- **Slide 27 - Construction IDIQs:** NAVFAC Southeast $1.01B (expiring Sep 2026)
- **Slide 28 - Engineering IDIQs:** DOE $55B ceiling, NAVFAC A/E vehicles
- **Slide 29 - Heavy/Civil IDIQs:** USACE Jacksonville, Galveston, Huntsville
- **Slide 30 - SAT Opportunities:** $350K threshold, 5-10 day decisions

#### New Slides Added
- Slide 3: "What You'll Walk Away With" (takeaways upfront)
- Slide 33: CPARS & Past Performance with GSA graphic

#### Images Created (`presentations/images/`)
| File | Source | Purpose |
|------|--------|---------|
| `sam-gov-search.png` | Encore Funding `myth-samgov.png` | SAM is just one slice |
| `usaspending-dashboard.png` | market-assassin `agency spend analysis.png` | Agency dashboard |
| `openclaw-discord.png` | presentations `discord.png` | Daily briefing |
| `linkedin-analytics.png` | presentations `linkedin.png` | 110K impressions |
| `cpars-past-performance.png` | Encore Funding `myth-experience.png` | GSA PP requirements |

### Key Takeaways
- A/E/C contractors want specific, actionable intel (contract numbers, values, dates)
- Screenshots should be hero elements, not sidebar afterthoughts
- Real Recompete Tracker data adds credibility vs generic talking points

---

## Session 30 (Mar 20, 2026)

### Win Probability Scoring for Daily Briefings
- Added intelligent fit scoring to opportunity alerts (0-100%)
- New file: `src/lib/briefings/win-probability.ts`
- **6 scoring factors:**
  - NAICS Match (0-25 pts) — exact, prefix, or related
  - Set-Aside Eligibility (0-25 pts) — matches user certifications
  - Agency Experience (0-15 pts) — has past performance with agency
  - Contract Size Fit (0-15 pts) — within user's typical range
  - Capability Match (0-10 pts) — keywords match profile
  - Contract Vehicle (0-10 pts) — user holds required vehicle
- **Tiers:** excellent (75%+), good (60-74%), moderate (45-59%), low (30-44%), poor (<30%)
- Color-coded badges in email: green, lime, yellow, orange
- Shows fit summary for opportunities ≥45%
- Updated types in `src/lib/briefings/delivery/types.ts`

### Rate Limiting & Abuse Detection (Complete)
- **Report generation:** 50/day per user (email-based via KV)
- **Unauthenticated IPs:** 5/hour (stricter than 30/hour for authenticated)
- **Abuse thresholds:**
  - Warning: 100 generations (console log)
  - Flag: 250 generations (stored in `abuse:flag:{email}`)
  - Block: 500+ generations (blocks API access)
- **Admin endpoint:** `/api/admin/abuse-report`
  - `GET ?password=XXX` — view all flagged users
  - `GET ?password=XXX&email=X` — check specific user
  - `POST { action: "clear", email: "X" }` — clear flag after review
- **Auto-block:** `isUserBlocked(email)` check in `generate-all/route.ts`
- Updated `src/lib/rate-limit.ts` with `checkUnauthenticatedIPRateLimit()` and usage getters
- Updated `src/lib/abuse-detection.ts` with full flagging system

### Usage API Fix
- Replaced stub endpoints that returned hardcoded `limit: 999`
- Now returns real KV-based usage data
- Files fixed:
  - `/api/usage/route.ts`
  - `/api/usage/check/route.ts`
  - `/api/usage/increment/route.ts`

### Recompete Tracker Verification
- Confirmed all requested features already implemented:
  - Pagination (25/50/100/All selector)
  - CSV export with user email watermark
  - Excel export via SheetJS
  - PDF export with GovCon Giants branding
  - Location filtering (regions + state checkboxes + "Near Me")
  - Mobile responsive (3 breakpoints: 1024px, 768px, 400px)

### Action Planner Status Review
- Mostly complete, needs YouTube video IDs from Eric
- Weekly digest cron not yet configured in vercel.json
- Password reset email path incomplete

### LinkedIn Lead Magnet Status
- Separate project at `/Users/ericcoffie/Linkedin App`
- MVP complete (Profile Optimizer phase)
- Not part of Market Assassin codebase

### Commits
- `c7a3f9b` — Rate limiting, abuse detection, usage API fix

---

## Session 29 (Mar 18, 2026)

### Alerts Signup Bug Fix
- User reported "Failed to save alert profile" error from `/alerts/signup`
- **Root causes identified:**
  1. `source: 'free-signup'` wasn't recognized as free tier (only `'opportunity-hunter-free'` was)
  2. Upsert attempted to insert `source` column which doesn't exist in `user_notification_settings` table
- **Fixes applied to `src/app/api/alerts/save-profile/route.ts`:**
  - Added `|| source === 'free-signup'` to `isFreeSource` check
  - Removed `source` field from database upsert
  - Added lazy initialization for Supabase
- Commits: `97f99eb`, `63eeb92`
- Tested and confirmed working

### Daily Health Check System
- Built automated health check at `/api/cron/health-check`
- **12 tests across 5 categories:**
  - Critical Flows: Alerts Signup (Free), Profile API (GET), Profile Setup Page, Alerts Signup Page
  - Page Health: Homepage, Store, Opportunity Hunter
  - Data APIs: USASpending Proxy, Pain Points, Contractors
  - Access Control: Content Generator Access Denied
  - Lead Capture: Lead Capture API
- **Features:**
  - Password auth (`galata-assassin-2026`) or CRON_SECRET bearer token
  - JSON and HTML output formats
  - Email alerts on failures (to `service@govcongiants.com`)
  - Response time tracking
  - Critical vs non-critical test classification
- Added to `vercel.json` cron: `0 12 * * *` (daily at 12:00 UTC with `?email=true`)
- Commit: `d2875bf`

### Lead Capture Test Fix
- Initial test failed with "Invalid resource ID"
- Investigation revealed `/api/capture-lead` requires valid `resourceId` from `FREE_RESOURCES` list
- Fixed test to use `resourceId: 'ai-prompts'` instead of `source: 'health-check'`
- Commits: `da554fe`, `89a9ab9`
- **Final result: 12/12 tests passing (100% pass rate)**

### Health Check Access URLs
```
HTML: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026&format=html
JSON: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026
```

### Content Reaper Length Optimization
- Researched LinkedIn 2026 best practices (1,200-1,700 chars optimal)
- Updated all 11 templates with strict character/word limits
- Added 25+ additional AI filler patterns to strip
- Added `trimPost()` function for oversized posts
- Added `getPostMetrics()` for char/word counts
- Reduced Grok max_tokens from 2000 to 600
- Tested: Posts now 1,100-1,200 chars (status: `optimal`)
- Commit: `089537c`

### Key Files
| File | Change |
|------|--------|
| `src/app/api/alerts/save-profile/route.ts` | Fixed free-signup recognition, removed invalid column |
| `src/app/api/cron/health-check/route.ts` | NEW: Automated health check system |
| `vercel.json` | Added health-check cron job |
| `src/app/api/content-generator/generate/route.ts` | Updated templates with strict length limits |
| `src/lib/utils/humanize-post.ts` | Added trimPost(), getPostMetrics(), expanded filler patterns |

---

## Session 27 (Mar 17, 2026)

### Smart User Profile System
- Built personalized briefing system that learns from user behavior
- **40+ profile fields:** location, business, certifications, capabilities, engagement
- **Engagement scoring (0-100):** +2/open, +5/click, -2/day inactivity after 7 days
- **Learned preferences:** clicked_naics[], clicked_agencies[], clicked_companies[]
- **Weighted preference calculation:** topNaics, topAgencies, topCompanies

### Profile Service (`src/lib/smart-profile/`)
- `types.ts` — SmartUserProfile, BriefingUserProfile, ProfileUpdatePayload
- `service.ts` — getSmartProfile, updateProfile, getBriefingProfile, recordInteraction
- `index.ts` — exports

### API Endpoints
- `GET/POST /api/profile` — profile CRUD with completeness breakdown
- `GET/POST /api/profile/track` — interaction tracking + email open pixel

### UI Components
- `/profile/setup` — 5-step onboarding wizard
- `/profile/complete` — completion confirmation page

### Briefing Generator Integration
- Contractor DB, Market Assassin, Recompete generators now use smart profiles
- Fall back to explicit preferences if no click history

### Commits
- `d170aec`, `c396fca`, `8070d6f`, `e74fb7f`, `393464b`

---

## Session 26 (Mar 16, 2026)

### Contractor DB Briefing System
- Built full Contractor Database briefing matching Eric's intel format
- Module: `/src/lib/briefings/contractor-db/`
- Admin endpoint: `/api/admin/generate-contractor-db-briefing`
- Full and condensed formats

---

## Session 25 (Mar 16, 2026)

### Opportunity Hunter Redesign & Alert Pro Integration
- **OH Pro now included with Alert Pro** — purchasing $19/mo Alert Pro automatically grants OH Pro access
- Updated webhook (`stripe-webhook/route.ts`):
  - Sets `ospro:{email}` KV flag when Alert Pro purchased
  - Calls `updateAccessFlags(email, 'hunter_pro')` for Supabase
  - Alert Pro Product ID: `prod_U9rOClXY6MFcRu`
  - Alert Pro Price ID: `price_1TBXfuK5zyiZ50PBWbdLfZ3F`
  - Payment Link: `https://buy.stripe.com/8x24gA1oifvAcFv3OEfnO0y`

### Tools OH Synced with Shop Version
- Copied shop's email-gate-first flow to tools.govcongiants.org
- Flow: Show 3 agencies → email capture → show 10 agencies
- Added weekly alerts auto-signup on email gate submission
- Added dual upgrade options after email gate:
  - Alert Pro ($19/mo): Unlimited daily alerts + all agencies
  - Tool Only ($49): All agencies, weekly alerts only
- Alert confirmation banner shows "Weekly Alerts Activated"

### /opp Landing Page Visual Redesign
- Complete overhaul of govcongiants.org/opp
- Hero with browser chrome tool mockup showing interface preview
- "See It In Action" video demo section with placeholder
- Before/After comparison showing 4 pain points solved
- Sample alert email preview (realistic inbox look)
- Pricing comparison: Free tier vs Alert Pro ($19/mo)
- Market Assassin upsell section at bottom
- Deployed: commit `9da94d7`

### Key Stripe/Product Info
| Item | ID/URL |
|------|--------|
| Alert Pro Product | `prod_U9rOClXY6MFcRu` |
| Alert Pro Price | `price_1TBXfuK5zyiZ50PBWbdLfZ3F` |
| Alert Pro Payment Link | `https://buy.stripe.com/8x24gA1oifvAcFv3OEfnO0y` |
| OH Pro Payment Link | `https://buy.stripe.com/7sIaGqevYeIcdri147` |

### Product Hierarchy (Updated)
| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | 10 agencies, 5 opps/week alerts |
| Tool Pro | $49 one-time | All agencies, pain points, export, weekly alerts |
| Alert Pro | $19/mo | All agencies + unlimited daily alerts (includes Tool Pro) |

---

## Session 24 (Mar 15, 2026)

### Lindy Intelligence API
- Unified endpoint for Lindy AI automation
- `/api/lindy/intelligence?email=X` — returns briefings, recompetes, contractor activity, recommended actions
- `/api/lindy` — API documentation endpoint
- `/api/admin/send-test-briefing?email=X` — generates AND sends briefing email
- Recommended actions include: deadline alerts, content angles, competitor watch, outreach suggestions
- Data freshness metadata for polling optimization

### Commits
- `c09f164` — Lindy Intelligence API

---

## Session 23 (Mar 14, 2026)

### Multi-NAICS Support & Smart Sampling
- **Multi-NAICS input** — users can now enter comma-separated NAICS codes (e.g., "236, 238, 541511")
- Created `src/lib/utils/naics-expansion.ts`:
  - `parseNAICSInput()` — parse comma/space-separated input
  - `expandNAICSCode()` — expand prefix to all matching 6-digit codes (e.g., "236" → all 236xxx)
  - `expandNAICSCodes()` — batch expansion with deduplication
  - NAICS_DATABASE covers construction (23x), IT (51x), professional services (54x), admin (56x)
- Updated agency finder (`find-agencies/route.ts`) with smart sampling:
  - Two-pass fetch: 5K by Award Amount + 5K by Award Date
  - Deduplication by Award ID prevents double-counting
  - Multi-NAICS searches get 10,000 contracts total (vs 5,000 single)
- Updated `CoreInputForm.tsx` placeholder: "e.g., 236, 238320, 541511"

### Alert Profile Multi-NAICS
- Updated `save-profile/route.ts` to accept:
  - `naicsCodes[]` — direct array
  - `naicsInput` — comma-separated string
  - `pscCode` — expands via PSC→NAICS crosswalk
- All inputs merged and expanded before saving to `user_notification_settings`

### TypeScript Fix
- Fixed `auth.tier` error in `generate-all/route.ts`
- Changed to use `getMarketAssassinTier(email)` function instead

### Contract Query Analysis
- 541511 (IT): 12,795 total contracts → 39% coverage with 5K sample
- 8(a) set-aside: 729 contracts → 100% coverage
- Construction SB (multi-NAICS): 8,004 contracts → 62% coverage with 5K
- Smart sampling ensures both big contracts AND recent small awards captured

### Commits
- `db482e2` — Fix TypeScript error: use getMarketAssassinTier instead of auth.tier
- `edec40a` — Add multi-NAICS support with prefix expansion and PSC crosswalk
- `4f661e0` — Add multi-NAICS support to Market Assassin agency lookup
- `6e61cad` — Add smart sampling for agency recommendations

---

## Session 19 (Mar 8, 2026)

### Daily GovCon Intelligence Briefings
- Built complete briefings system for personalized daily intel emails
- Web intelligence pipeline with FPDS health monitoring + SAM.gov fallback
- Briefing generation using Groq API, scheduled delivery via Vercel cron
- Cost analysis: ~$2.85/user/month at scale

### Federal Help Center Integration
- FHC $99/mo membership now auto-grants MA Standard + Daily Briefings
- Stripe webhook handles new subscriptions (`checkout.session.completed`)
- Subscription cancellation revokes access automatically
  - Listens to `customer.subscription.deleted` and `customer.subscription.updated`
  - Revokes `access_assassin_standard`, `access_briefings` in Supabase
  - Deletes `ma:{email}`, `briefings:{email}` from KV
- FHC Product IDs: `prod_TaiXlKb350EIQs` (39 active), `prod_TMUmxKTtooTx6C` (8 active)
- Total: 47 FHC members, $4,623 MRR

### Email System Fixes
- Fixed purchase confirmation emails - now routes to correct template per product
- New email templates created:
  - `sendContentReaperEmail()` - Content Reaper access
  - `sendRecompeteEmail()` - Recompete Tracker access
  - `sendBundleEmail()` - Bundle purchases with all tool links
  - `sendFHCWelcomeEmail()` - FHC welcome with MA + Briefings info

### Admin Endpoints
- `/api/admin/sync-fhc-members` - Pull FHC subscribers from Stripe, grant access
- `/api/admin/grant-briefings` - Batch grant briefings to MA Standard users
- `/api/admin/user-audit` - Check duplicates, bundle mismatches, cleanup redundant flags
- `/api/admin/fpds-health` - FPDS API health monitoring and testing

### Access Control Updates
- Added `access_briefings` flag to user_profiles
- Added `briefings:{email}` KV key
- Bundle access updated:
  - Pro Giant ($997): includes 1 year briefings
  - Ultimate ($1,497): includes lifetime briefings
- Premium includes Standard (redundant Standard flags cleaned up)

---

## Session 18 (Feb 21, 2026)

### Free Resource Pages
- Fixed all 8 free download pages with correct `checkoutUrl` pointing to resource files
- Added email gate to `ProductPageAppSumo` for free resources (captures leads to Supabase)
- Expanded `/free-resources` page from 5 to 11 resources

### Store Page Fixes
- Content Reaper link corrected
- Agency count updated from 175 to 250

---

## Session 17 (Feb 18, 2026)

### SAT Entry Point Analysis
- Zero extra API calls - SAT (≤$250K) and micro (≤$10K) computed during existing award aggregation
- Agency type fields: `satSpending`, `satContractCount`, `microSpending`, `microContractCount`
- Market Assassin Premium: Entry Points tab with `satFriendlinessScore` (0-100)
- Opportunity Hunter: blurred SAT teaser with Market Assassin upgrade CTA

### FY2026 Budget Data
- Expanded from 23 to 47 toptier agencies
- 175-entry sub-agency parent map (218/250 agencies resolve, 87%)

### AgencySelectionTable
- 5 sort mode pills
- "Easy Entry" badge for agencies with >50% SAT spending

---

## Session 16 (Feb 15, 2026)

### Agency Pain Points System
- Built comprehensive pain points database: 250 agencies, 2,765 pain points, 2,500 spending priorities
- Admin endpoint: `/api/admin/build-pain-points`
- Public API: `/api/pain-points`
- Used by Content Reaper, Market Assassin, and Opportunity Hunter

---

## Session 15 (Feb 12, 2026)

### Market Assassin Premium Reports
- Added 4 additional premium reports (8 total vs 4 standard)
- Entry Points analysis
- Competitive landscape
- Budget authority integration

---

## Session 14 (Feb 9, 2026)

### Content Reaper Enhancements
- Bulk export to .docx and .zip
- 30 posts per generation
- 250 agency support
- Content calendar feature

---

## Session 13 (Feb 6, 2026)

### Opportunity Hunter Pro
- Agency spending analysis
- NAICS targeting
- Pro tier ($49) with advanced filters

---

## Session 12 (Feb 3, 2026)

### Recompete Tracker
- Expiring contracts search
- Filtering by agency, NAICS, value
- Export functionality

---

## Session 11 (Jan 31, 2026)

### Federal Contractor Database
- 3,500+ contractors loaded
- SBLO contact information
- Search and filter functionality

---

## Session 10 (Jan 28, 2026)

### Action Planner
- 5 phases, 36 tasks
- Progress tracking
- PDF export with jsPDF

---

## Sessions 1-9 (Jan 2026)

### Foundation Work
- Initial Next.js setup with Turbopack
- Supabase integration
- Stripe payment flow
- Basic Market Assassin tool
- Content Reaper v1
- Email system with nodemailer
- KV access control system

---

*Last Updated: April 9, 2026*
