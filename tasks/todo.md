# GovCon Giants - Current Tasks

## Session State (March 29, 2026)

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
- **Daily Briefs** (9 AM UTC) - Recompete intel, awards, teaming leads
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
