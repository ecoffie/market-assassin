# GovCon Giants - Tasks by Priority

**Last Updated:** June 4, 2026

---

## Session Handoff — 2026-06-04 (Government Buyer Market Research)

New REVERSE-search feature for federal contracting officers ("find businesses for a requirement"). Merged to `main`, deployed to prod, gated to `gov_buyer` users. PRD: `docs/PRD-gov-buyer-market-research.md`.

### Shipped (all live on prod)
- [x] **`sam_entities` registry** — SAM public entity data, sourced via bulk extract (not the rate-limited API). Migration `20260604_gov_buyer_combined.sql` (hand-run; this DB has no in-app DDL).
- [x] **Active Performer rubric** — scores firms by award history (LEFT-join BQ recipients). Tiers: Active Performer / Capable / Emerging / Registered-Only. Emerging INCLUDED in Rule-of-Two count by default + toggle (fairness rule — never bury new entrants).
- [x] **`/agency` buyer UI** — gated (.gov/.mil → magic link), NAICS+state+set-aside search, market-depth headline, tier breakdown, ranked firm table.
- [x] **`.docx` determination memo export** — the filable artifact (`/api/gov-buyer/market-research/export`).
- [x] **Gov people search groundwork** — `federal_contacts` + `role_category` column (ships `contracting` now; PM/engineer/end-user buckets await a source).
- [x] **`user_type` gate** — `gov_buyer` vs `seller` on `user_profiles`.

### Data coverage (as of June 4, 2026)
- **487,660 entities loaded** (was 160K) across the **6 top services sectors**: 54 (Professional/Tech), 23 (Construction), 33 (Manufacturing), 56 (Admin/Support), 81 (Other Services), 62 (Health). ~85% of where federal set-asides happen.
- Source: SAM `SAM_PUBLIC_MONTHLY_V2_20260503` extract (138MB ZIP). Re-run `SECTORS=.. node scripts/import-sam-entity-extract.mjs` to widen further; `--all-naics` for the full registry.
- Cert rates verified realistic across all sectors: 8(a) 1.2%, HUBZone 0.9%, WOSB 23%, SDVOSB 8.9%, VOSB 13%.
- **Cert source caveat:** 8(a)/HUBZone are SBA-vetted (field 118); WOSB/SDVOSB/VOSB are self-certified (field 32) — memo footnotes this; rubric weights vetted higher.

### Follow-ups (not blocking)
- [ ] **Widen to remaining sectors** if COs query retail/wholesale/transport/ag/finance (44,42,48,11,52...) — extract on disk, cheap re-run.
- [ ] **Monthly freshness** — re-run the bulk import each month (SAM refreshes 1st Sunday); daily API cron top-ups new registrations between extracts.
- [ ] **Cap-statement search (Path A)** — link seller `user_boilerplate_docs` uploads to UEI so buyers see them (PRD §6).
- [ ] **5-role gov people** — source PM/engineer/end-user contacts beyond the KO (PRD §7).
- [ ] **Cron Dispatcher (P1 infra)** — see backlog below; the gov-buyer sync is chained off `sync-sam-opportunities` as a band-aid for the 100-cron cap.

---

## Session Handoff — 2026-05-25 (long Mindy polish session)

### Completed (all live on prod unless noted)
- [x] **Market Research filter strip header** (NAICS · Business · Set-asides · States)
- [x] **MarketMapLoadingBanner** with cycling status messages + shimmer + ping dot
- [x] **Loading banner extended through child-chart settle** (2.5s grace after tmrRows arrive)
- [x] **Data accuracy disclaimer banner** above All Agencies table
- [x] **fpds-top-n cache fix** (any-empty leaderboard now stale, not just all-empty)
- [x] **Total $ column + 'Top Total $' sort lens** (with caveat — uses same sampling pipeline, still inaccurate for high-volume NAICS)
- [x] **'Top Spending' renamed to 'Top Set-Aside $'** (honest label)
- [x] **Drawer Total Spending + Set-Aside Spending tiles** with explanatory hints
- [x] **Leaderboard agency drill-down** (click 'Department of the Army' → filter All Agencies + scroll)
- [x] **Top 10 Funding Agencies leaderboard cut** (near-duplicate of Departments)
- [x] **'Start Here' 3-card row deleted** (broken picker showing Homeland $0/0 as 'best first')
- [x] **Pain pts badge clickable** in My Target List → expandable panel with documented issues + priorities
- [x] **Events split into 2 independent toggle buttons** (Scheduled Events purple, Sources Sought amber)
- [x] **SAT% shows 'SAT —' instead of misleading 0%** when sample has no small-dollar contracts
- [x] **Relationships NAICS/Agency inputs live-filter** (350ms debounce)
- [x] **Save+Attach on Discovery tabs** (Save also attaches to selected pursuit in one click)
- [x] **Contextual Teaming Candidates** — filters primes against user's saved target agencies; empty state nudges to save targets
- [x] **SAM.gov System Account application submitted** (eric ops, status: Pending Review)
- [x] **Vercel Static IPs enabled** for SAM allowlist (us-east-1: 34.203.20.143, 3.235.96.207)
- [x] **My Target List table** (`user_target_list` + `user_target_outreach`) created in Supabase

### Reverted — needs redo next session
- [ ] **Start Tracking triage flow** — broke /app with client-side React exception. Rolled back to pre-triage build, then `git revert` of `feb239b` + `939fa3f`. Code preserved in those reverted commits for resurrection. **Next session:** open DevTools console on the previously-broken deploy URL `market-assassin-9p34lmm7a-eric-coffies-projects.vercel.app`, get the actual stack trace, fix the specific line, redeploy. Likely culprits per code audit: TriageAgencyCard import order, useMemo dep array, or hook-order violation when triage modal mounts conditionally.
- [ ] **`user_dismissed_targets` table** was successfully created in Supabase already (NOT reverted). Safe to leave empty; triage code can reuse it on redo.

### Decisions made (and why)
- **Triage modal pattern over per-row buttons** — research showed per-row buttons invite overtracking (users click 20 buttons because it's cheap; capture nothing). Triage forces per-agency decision with rich context. Soft cap at 5.
- **Reverted broken triage rather than guess-fixing in prod** — followed our new "commit before deploy" rule and immediately rolled back when the crash hit. Diagnose with DevTools next session instead of guessing.
- **Honest "SAT —" dash instead of fake number** — for users on construction NAICS, SAT ratio is structurally wrong (sample skewed to mega-contracts). Tooltip explains. Real fix needs USAspending bulk-ingest pipeline (P2 backlog item) OR SAM Contract Data API (Pending Review).
- **Cut Funding Agencies leaderboard entirely** — 95% duplicate of Departments for SMB audience. Cleaner UX wins over preserving the awarding-vs-funding distinction.
- **Contextual Teaming filters by prime.agencies[] not USAspending live query** — fast (no extra API call), good enough. Future: USAspending recipient lookup per saved target for richer signal.
- **Loading banner uses 2.5s timer grace period, not child-state subscription** — the cheap path; child components don't currently expose loading flags upstream. Better v2: refactor to use loading callbacks.

### State at handoff
- Branch: `main`
- Working tree: clean (no uncommitted changes)
- Prod deploy: `market-assassin-nz69587kb` (10m ago, `7c5fc75 fix(research): keep loading banner visible until child charts settle`)
- Aliases: getmindy.ai, tools.govcongiants.org, mi.govcongiants.com (all 200)
- Supabase: `user_target_list`, `user_target_outreach`, `user_dismissed_targets` tables all live in main DB
- Dev server: not running

### Next session priorities (in order)
1. **Diagnose triage crash** (task #47): open DevTools console, get stack trace, fix specific line, resurrect from `git show feb239b -- src/components/app/panels/triage/StartTrackingModal.tsx` etc.
2. **SAT/Entry Accessibility table** in Reports view where 'Start Here' used to be (task #41) — after triage stable
3. **Check SAM System Account status weekly** (task #20) — if approved → can build real office-level data layer
4. **Other ideas surfaced this session:**
   - Map "Reports" view is still confusing — needs an audit similar to what we did for Map view
   - Bigger USAspending bulk-ingest pipeline (P2 todo entry already written) becomes relevant if SAM access doesn't land

### Notes for next session
- The user has SAM Joint Account Holder still set as himself (against video instruction). May get rejected for self-approval. If so: pick a teammate (Branden was the planned choice), have them register a SAM account, edit the request.
- Vercel Static IPs cost $100/mo (us-east-1 only, dropped us-west-1 to save $50/mo). Live now.
- Memory `commit-before-deploy.md` saved — future sessions should commit then deploy, not the reverse. Saved us tonight when we needed to rollback.
- The user appreciates honest disclaimers over fake data. Pattern: when something's structurally inaccurate, surface a tooltip/banner explaining why instead of hiding the limitation behind nice-looking numbers.

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

### USAspending Bulk Ingest → SAT% Precompute Pipeline
**Goal:** Replace runtime SAT% calculation (broken by USAspending API sampling bias — shows 0% / dash for large NAICS like construction) with a precomputed lookup table powered by USAspending's bulk award archive downloads.

**Why this exists:** Investigation 2026-05-25 found that find-agencies samples ~10K awards sorted by Amount desc, so for high-volume NAICS the sample is all mega-contracts; ZERO fall under the $350K SAT threshold; computed SAT% = 0. MA's Federal Market Assassin shows correct numbers (Coast Guard 95.5% etc.) only because the user happened to search a smaller NAICS where the sample captures the right awards. Same bug, different surface.

**Research finding (2026-05-25):** No public source publishes pre-aggregated "% under $350K per agency × NAICS." Closest is USAspending's free Award Data Archive (https://www.usaspending.gov/download_center/award_data_archive) which provides transaction-level `Contracts_Full_FYxxxx.zip` per agency. ~5GB total for FY2024+FY2025, ~50M rows.

**Architecture (locked):**
- **New analytics Supabase project** (`usaspending-analytics`) — holds 50M-row `usaspending_awards` raw table + ingest jobs + heavy aggregation queries. App never reads from it.
- **Main Supabase (market-assassin)** — adds small `agency_sat_stats` table (~5K rows) that the app reads at request time. Populated by a "publish" step at end of each precompute.
- **Granularity:** sub-agency level for civilian (Coast Guard ≠ FEMA), parent-agency level for DoD (Navy total, not split into NAVFAC/NAVSEA — DoD has too many sub-agencies to enumerate quarterly).
- **Scope:** 25 cabinet departments + their major sub-agencies (~30-50 ZIPs per FY).
- **Refresh:** Monthly delta for current FY using `Contracts_Delta` files + one-shot ingest for closed FYs.
- **Triggers:** Monthly cron (1st of month) + admin manual endpoint `/api/admin/recompute-sat?password=`.

**Consumers (read from `agency_sat_stats` in main DB):**
- Mindy `find-agencies` (replaces broken runtime calc)
- My Target List SAT badge
- Market Map drawer SAT % tile
- MA `ReportsDisplay` "Entry Accessibility" table

**Engineering ETA:** ~11hr total, split into 4 phases:
- Phase 1 (~4hr): Create analytics Supabase project, schema migration, one-shot script to download FY2024 closed data, parse, load
- Phase 2 (~3hr): SAT% computation query + summary table publish step to main DB
- Phase 3 (~2hr): Update find-agencies + UI consumers to read from `agency_sat_stats`
- Phase 4 (~2hr): Monthly delta cron + admin manual trigger endpoint

**Prerequisite from Eric:** Create new Supabase project named `usaspending-analytics` (us-east-1, free tier to start), share `URL`, `service_role_key`, `anon_key`.

**Potential blocker / decision point:** SAM.gov System Account application is currently Pending Review (submitted 2026-05-24, see [`oauth-branding-runbook.md`](./oauth-branding-runbook.md) and task notes). If SAM access is approved in <3 weeks, the SAM Contract Data API gives clean office-level real-time award data that makes this whole bulk-ingest approach redundant. **Recommendation:** check SAM status weekly; if still pending after 3 weeks, proceed with bulk-ingest build. If SAM approves first, scrap this and use SAM data directly.

**Interim state (shipped 2026-05-25):** Honest 'SAT —' dash + tooltip explaining the sampling skew. Users no longer see misleading 0%.

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
