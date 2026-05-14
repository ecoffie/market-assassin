# GovCon Giants - Tasks by Priority

**Last Updated:** May 14, 2026

---

## P0 - CRITICAL (This Week)

*No critical items - security audit complete!*

### Signup Health Monitoring System - Enterprise Grade
**Status:** ✅ COMPLETE - Deployed May 14, 2026

**Features Built:**
- [x] Synthetic monitoring (automated tests against signup endpoints)
- [x] Funnel analytics (track drop-offs at each wizard step)
- [x] Error rate tracking by type (auth_failed, validation, api_error, etc.)
- [x] Health score calculation (0-100) with degraded/critical states
- [x] HTML dashboard view at `?format=html`
- [x] Event logging in save-profile API

**Admin Endpoints:**
- Dashboard: `/api/admin/signup-health?password=xxx&format=html`
- JSON: `/api/admin/signup-health?password=xxx`
- Migration: `/api/admin/apply-signup-events-migration?password=xxx`

**Database Tables (pending migration):**
- `signup_events` — Individual funnel event tracking
- `signup_health_metrics` — Daily aggregated health metrics

**What It Tracks:**
| Event | When Logged |
|-------|-------------|
| `signup_started` | When user hits save-profile API |
| `signup_completed` | When profile successfully saved |
| `signup_failed` | On auth/validation/database errors |

**Health Scoring:**
- 95%+ success rate → 100 (healthy)
- 80-94% → 80 (healthy)
- 50-79% → 50 (degraded)
- <50% → 20 (critical)

---

### SAM.gov Sync Pipeline - Production Grade
**Status:** ✅ COMPLETE - Deployed May 14, 2026

**Features Built:**
- [x] Resumable sync with checkpoint tracking (per-page offsets)
- [x] Multiple cron schedules (1 AM full, 9 AM resume, 1 PM delta, 3 PM watchdog)
- [x] Watchdog cron with auto-recovery (triggers delta/full based on health)
- [x] Health monitoring dashboard (`/api/admin/sam-sync-status?format=html`)
- [x] Stale record cleanup only runs after successful FULL sync
- [x] Retry with exponential backoff (3 retries, 5s→10s→20s)

**Cron Schedule (UTC):**
| Time | Type | Purpose |
|------|------|---------|
| 1 AM | full | Complete 30-day sync |
| 9 AM | resume | Continue from last failed checkpoint |
| 1 PM | delta | Quick refresh of recent changes |
| 3 PM | watchdog | Health check + auto-recovery |

**Admin Endpoints:**
- Status: `/api/admin/sam-sync-status?password=xxx&format=html`
- Watchdog: `/api/cron/sam-sync-watchdog?password=xxx`
- Trigger sync: `/api/cron/sync-sam-opportunities?type=delta&password=xxx`

**Current Health (May 14, 2026):**
- Health Score: 100/100
- Active Records: 29,695
- Cache Age: ~11 hours
- Consecutive Failures: 0

---

## P1 - HIGH (This Sprint)

### MI Operating System - Skills and Agents
**Status:** Started (specs written, PRDs created)

**Why High:** Foundation for scalable team operations.

**Next Actions:**
- [ ] Review MI Operating System Roadmap (`tasks/MI-OPERATING-SYSTEM-ROADMAP.md`)
- [ ] Review Dashboard Clarity Skill with current admin dashboard
- [ ] Use Launch Memo Skill for May 30 bootcamp/MI launch
- [ ] Generate Annelle/Sikander qualified outreach list via Customer Qualification Agent
- [ ] Identify Eric's next founder-call list via 10-10 Forever Customer Strategy

### Wire MI Internal Launch Command Center
**Status:** ✅ V2 COMPLETE - Live data connected

**Connected Data Sources:**
- [x] MI Growth Brief (user engagement, email metrics, behavioral queues)
- [x] Customer Qualification Agent (purchase-based scoring, 10-10 candidates)
- [x] Launch Manager Brief (domain policy, launches, owner actions)

**Live Queues:**
| Queue | Source | Count |
|-------|--------|-------|
| Setup Invite | Growth Brief | 25 |
| Profile Nudge | Growth Brief | 25 |
| Activation Rescue | Growth Brief | 25 |
| Pro Upgrade | Growth Brief | 25 |
| Founder Calls | Qualification Agent | 10 |
| Sales Outreach | Qualification Agent | 14 |
| Rescue Queue | Qualification Agent | 1 |

**Remaining (Low Priority):**
- [ ] Add owner-updated launch action tracking
- [ ] Add "Mark Contacted" buttons on queue items

### Update Email Templates for Correct Domains
**Status:** Needed for domain migration

- [ ] Sales/content CTAs → `govcongiants.com`
- [ ] Product/account CTAs → `getmindy.ai` (was `mi.govcongiants.com`)
- [ ] Audit all email templates in `src/lib/send-email.ts`

---

## P2 - MEDIUM (Next 2 Weeks)

### Batch Enroll Bootcamp Attendees
**Status:** 8,804 emails ready in `data/bootcamp-attendees-to-enroll.txt`

**When:** After 2-3 weeks verifying current 457 users

```bash
cat data/bootcamp-attendees-to-enroll.txt | while read email; do
  curl -s -X POST "https://tools.govcongiants.org/api/alerts/save-profile" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\", \"naicsCodes\": [\"541512\", \"541611\", \"541330\"], \"businessType\": \"\", \"source\": \"free-signup\"}"
done
```

### Domain Migration to `getmindy.ai`
**Status:** Domain purchased May 13, 2026

Not blocking anything - `mi.govcongiants.com` works fine. Brand improvement.

- [ ] Configure DNS for `getmindy.ai`
- [ ] Add compatibility redirects from `mi.govcongiants.com` → `getmindy.ai`
- [ ] Update Supabase auth redirect URLs
- [ ] Update email templates for `getmindy.ai` links
- [ ] Update social/YouTube/LinkedIn URLs

### SEO Contractor Pages Improvements
- [ ] Add Search Console data to candidate scorer
- [ ] Add MI usage events tracking
- [ ] Add route-crawl canonical status
- [ ] Fix public contractor page canonicals to `govcongiants.com`

### Recompete Tracker: Expand to 2027 Data
**Current:** 9,450 contracts, all 2026 expirations
**Target:** Add contracts expiring through Oct 2027 (18-month window)

```bash
# Fetch and preview 2027 data
node scripts/fetch-2027-contracts.js

# Fetch and merge into contracts-data.js
node scripts/fetch-2027-contracts.js --merge
```

- [ ] Run 2027 fetch script
- [ ] Verify data quality (no duplicates)
- [ ] Update cron job date range
- [ ] Deploy with expanded dataset
- [ ] Update "Data Through" display

---

## P3 - LOW (Backlog)

### Phase 1A: 21-Day Free Trial System
- [ ] Add `trial_start_date`, `trial_end_date` columns
- [ ] Create trial signup flow
- [ ] Email sequence (welcome, day 14, day 18, day 21)
- [ ] Trial expiration cron

### Phase 1B: Weekly Bids Report
- [ ] New cron `weekly-bids-report` (Monday 6 AM local)
- [ ] Query SAM.gov for all open opps by user NAICS
- [ ] Categorize by notice type
- [ ] Format as digest email

### BD Assist Enhancements
- [ ] Add Teaming tab UI
- [ ] Connect Intel tab to Daily Briefings
- [ ] Add more forecast sources (DOD, HHS, USDA)

### Phase 3-4 Forecast Scrapers (Puppeteer)
| Agency | Source | Est. Coverage |
|--------|--------|---------------|
| HHS | procurementforecast.hhs.gov | $12B |
| Treasury | osdbu.forecast.treasury.gov | $2B |
| EPA | ordspub.epa.gov | $1.5B |
| USDA | forecast.edc.usda.gov | $4B |
| DOD | Multi-source | $40B |

### Teaming Network Visualization
**Blocked:** Waiting on SAM.gov System Account approval (1-4 weeks)

---

## DEFERRED - Infrastructure Scaling

### QStash Queue Architecture (For 10K+ Users)
**When:** Approaching 10K users or hitting cron limits

Replace multiple Vercel crons with queue-based processing:
- 1 cron enqueues all users → QStash processes in parallel
- Eliminates 100-cron Vercel limit
- Better retry handling and observability

### Supabase-Backed Access Links
**When:** KV costs become significant or need audit logging

Move access link tokens from KV to Supabase:
- Store hashed tokens in `mi_access_links` table
- KV becomes optional cache only
- Adds audit trail of link usage

### Mindy Mobile App (React Native)
**When:** User demand justifies 2-3 month build
**Decision:** May 14, 2026 - Eric chose Option 3 (React Native) for true native feel

Build native iOS/Android apps:
- React Native rebuild of MI dashboard
- Reuse existing APIs and backend
- Push notifications for daily briefings
- App Store ($99/yr Apple) + Play Store ($25 one-time)
- Estimated: 2-3 months development

---

## COMPLETED (Reference)

### May 13, 2026
- [x] **Command Center V2 - Live Data Wiring** - Connected real-time data to Command Center
  - Wired MI Growth Brief (behavioral queues: setupInvite, profileNudge, activationRescue, proUpgrade)
  - Wired Customer Qualification Agent (purchase-based queues: founderCalls, salesOutreach, rescueCandidates)
  - Added 4 segment stat cards (10-10 Candidates, Activation, Rescue, Total Purchasers)
  - Added Founder Call Queue with email/score/why display (top 8)
  - Added Sales Outreach Queue with email/score/why display (top 8)
  - Added Rescue Queue (at-risk paid customers)
  - Live: `mi.govcongiants.com/admin/launch-command-center`
- [x] **Customer Qualification Agent** - Built scoring system for outreach prioritization
  - Scores based on purchases (30pts Ultimate, 25pts MI Pro, 20pts multiple)
  - Scores based on engagement (15pts profile, 10pts NAICS, 10pts briefings)
  - Segments: 10-10 Candidate, White-glove, MI Pro Upgrade, Rescue, Activation
  - API: `/api/admin/qualify-customers` with CSV export
  - Commit: `8f0ca70`
- [x] **MI Daily Brief Generator** - Transform dashboard metrics into actionable brief
  - Health Score (0-100) with Decision Levers
  - Answers 10 key questions from MI OS
  - Copy to Slack button for team sharing
  - Commit: `e9fddd0`
- [x] **API Security Audit COMPLETE** - Hardened 31 routes with `verifyUserOwnsEmail`
  - Routes now verify authenticated user owns the email they're querying
  - 19 routes use `verifyUserOwnsEmail`, 12 use `requireMIAuthSession`
  - Commit: `0a648f7` (24 files, 813 insertions)
- [x] Daily Alerts Schedule moved earlier (1 AM - 6 AM ET)
- [x] Upstash KV upgraded to Pay As You Go
- [x] Upstash QStash installed (Pay As You Go)
- [x] Fixed 141 failed alerts from KV quota

### May 9-10, 2026
- [x] Created canonical route map
- [x] Confirmed MI sales pages belong in funnels repo
- [x] Built MI Internal Launch Command Center V1 shell
- [x] Converted agent specs into implementation PRDs
- [x] Built read-only MI Growth Brief endpoint
- [x] Built Launch Manager brief generator
- [x] Built SEO Contractor Pages candidate scorer
- [x] Created Team Alignment Slack Brief

### April 20, 2026
- [x] Fixed Briefing Type Collision (unique constraint)
- [x] Fixed Daily Briefings Dedupe
- [x] Fixed Pursuit Logging
- [x] Fixed Weekly-Alerts Batching
- [x] Fixed Precompute Capacity (10→25 profiles/run)
- [x] Fixed Rollout Tracking

### April 19, 2026
- [x] Expanded agency intelligence: 250→307 agencies
- [x] Added 280 pain points from GAO reports
- [x] Added 111 priorities from spending patterns

### April 16, 2026
- [x] Added SBIR + Grants tabs to MI Dashboard
- [x] Created `/api/grants` and `/api/sbir` endpoints

### April 14, 2026
- [x] Fixed Supabase lazy initialization build errors
- [x] Created `usaspending_awards` table
- [x] Created `sam_events` table

### April 11, 2026
- [x] Deployed BD Assist Platform Phase 1 & 2
- [x] Built Federal Market Scanner (6-question intelligence)
- [x] Built Pipeline Tracker Kanban
- [x] Built Teaming CRM

### April 6, 2026
- [x] Forecast Intelligence: 7,764 forecasts from 13 agencies
- [x] GSA Acquisition Gateway CSV import script

### Earlier Sessions
- [x] Agency Hierarchy API v2 (Moat 7)
- [x] SAM.gov API Integration (Phase 1-4)
- [x] Multisite Aggregation scrapers
- [x] Daily Briefings system (all 3 types)
- [x] USASpending MCP fix

---

## Quick Reference

**Projects:**
- Market Assassin (tools): `~/Market Assasin/market-assassin`
- GovCon Shop (production): `~/govcon-shop`
- GovCon Funnels (marketing): `~/govcon-funnels`

**Resume:** `/continue`

**Health Check:**
```
HTML: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026&format=html
JSON: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026
```

---

## Key Specs (for reference)

| Spec | Location |
|------|----------|
| Canonical Domain Map | `tasks/CANONICAL-DOMAIN-ROUTE-MAP.md` |
| MI Operating System Roadmap | `tasks/MI-OPERATING-SYSTEM-ROADMAP.md` |
| Dashboard Clarity Skill | `tasks/skills/dashboard-clarity-skill.md` |
| Launch Memo Skill | `tasks/skills/launch-memo-skill.md` |
| API Security Audit PRD | `tasks/PRD-api-security-audit-agent.md` |
| MI Growth Ops Agent PRD | `tasks/PRD-mi-growth-ops-agent.md` |
