# Market Intelligence System

Complete reference for the GovCon Giants Market Intelligence system.

---

## Overview

The Market Intelligence system delivers personalized government contracting intelligence to users via email. It aggregates data from multiple sources (USASpending, SAM.gov), applies relevance scoring, and generates formatted reports tailored to each user's NAICS codes and target agencies.

**Status:** DEMO/TRIAL during 3/28 bootcamp

---

## Daily Alerts vs Market Intelligence

**IMPORTANT:** These are TWO SEPARATE systems with clear value differentiation:

| System | Price | Value Prop | Access |
|--------|-------|------------|--------|
| **Daily Alerts** | $19/mo | "Don't miss opportunities" - Volume play | Alert Pro subscription |
| **Market Intelligence** | $49/mo | "Know WHICH opportunities to pursue" - Strategy play | Pro/Ultimate bundles |

### Daily Alerts ($19/mo)
- SAM.gov + Grants.gov opportunities matching NAICS/keywords
- **Notice Type Badges:** Color-coded RFP (green), RFQ (blue), Sources Sought (purple), Pre-Sol (orange), Combined (teal)
- **Posted Date:** Shows when opportunity was released
- **Urgency Badges:** 🔥 3 DAYS LEFT (red + highlighted row), ⚡ X days (orange), 📅 2 weeks (yellow)
- Deduplication (won't resend same opp in 7 days)
- PSC crosswalk for broader matching
- User configures at `/alerts/preferences`
- Cron: `/api/cron/daily-alerts`
- **NOT included:** Win Probability, AI analysis, teaming recommendations

### Market Intelligence ($49/mo)
- Everything in Daily Alerts PLUS:
- **Win Probability Scoring** (0-100% fit with breakdown)
- **AI-Generated Analysis** per opportunity
- **3 Report Types:** Daily Brief, Weekly Deep Dive, Pursuit Brief
- USASpending contract data with bid counts
- Competitive landscape analysis
- Teaming plays and capture strategies
- Only in Pro ($997) / Ultimate ($1,497) bundles or explicit briefings purchase

### Value Ladder Logic
```
Free Opp Hunter → $19 Alerts (volume) → $49 Intelligence (strategy) → $997 Pro Bundle
```
Users hit $19 limit when they realize seeing opportunities isn't enough—they need to know which ones to pursue.

---

## The 3 Report Types

| Report | Description | Frequency |
|--------|-------------|-----------|
| **Daily Brief** | Daily Market Intel with Notice Type Summary, Top 5 Active Opportunities (with notice type badges + posted dates) + Teaming Plays + Key Deadlines | Daily |
| **Weekly Deep Dive** | Full analysis of 10 Opportunities with competitive landscape, key dates, teaming plays, market signals, calendar | Weekly |
| **Pursuit Brief** | Single opportunity deep dive with score (e.g., 68/100 CONDITIONAL), working hypothesis, priority intel, outreach targets, 5-day action plan, risk assessment | On-demand |

### Test Endpoint
```bash
# Send all 3 report types to a user
curl "https://tools.govcongiants.org/api/admin/send-all-briefings?password=galata-assassin-2026&email=user@example.com"
```

### Slash Command
```
/test-briefings                      # Send to eric@govcongiants.com
/test-briefings user@example.com     # Send to specific email
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CRON SCHEDULE (UTC)                         │
├─────────────────────────────────────────────────────────────────────┤
│  6:00 AM  │ aggregate-profiles    │ Sync user search history       │
│  7:00 AM  │ snapshot-opportunities│ Fetch SAM.gov opportunities    │
│  7:15 AM  │ snapshot-recompetes   │ Fetch expiring contracts       │
│  7:30 AM  │ snapshot-awards       │ Fetch recent contract awards   │
│  7:45 AM  │ snapshot-contractors  │ Fetch contractor DB updates    │
│  8:00 AM  │ web-intelligence      │ Gather web signals via Serper  │
│  7:00 AM  │ send-briefings        │ Generate & deliver briefings   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
src/lib/briefings/
├── delivery/                    # Core delivery system
│   ├── generator.ts             # Main briefing generation
│   ├── sender.ts                # Email/SMS delivery
│   ├── email-template.ts        # HTML email templates
│   ├── types.ts                 # TypeScript definitions
│   └── index.ts                 # Exports
│
├── pipelines/                   # Data collection pipelines
│   ├── sam-gov.ts               # SAM.gov API integration
│   ├── fpds-recompete.ts        # FPDS expiring contracts
│   ├── contract-awards.ts       # USASpending awards
│   ├── contractor-db.ts         # Contractor database
│   └── index.ts                 # Exports
│
├── market-assassin/             # MA-specific briefings
│   ├── generator.ts             # MA briefing generator
│   ├── data-aggregator.ts       # MA data aggregation
│   ├── email-templates.ts       # MA email format
│   └── types.ts                 # MA types
│
├── contractor-db/               # Contractor DB briefings
│   ├── generator.ts             # DB briefing generator
│   ├── data-aggregator.ts       # DB data aggregation
│   └── email-templates.ts       # DB email format
│
├── recompete/                   # Recompete briefings
│   └── generator.ts             # Recompete generator
│
├── chat/                        # AI Chat integration
│   ├── engine.ts                # Chat processing
│   └── identity.ts              # AI persona config
│
├── web-intel/                   # Web intelligence
│   └── types.ts                 # Web signal types
│
├── diff-engine.ts               # Change detection
├── win-probability.ts           # Opportunity scoring
└── capture-search.ts            # Search history capture
```

---

## Database Schema

### Core Tables

#### `user_notification_settings`
User watchlist and delivery preferences.

| Column | Type | Description |
|--------|------|-------------|
| user_email | TEXT | Primary identifier (unique) |
| aggregated_profile | JSONB | Combined profile data |
| naics_codes | TEXT[] | Watched NAICS codes |
| agencies | TEXT[] | Watched agencies |
| keywords | TEXT[] | Search keywords |
| zip_codes | TEXT[] | Location preferences |
| watched_companies | TEXT[] | Competitor tracking |
| watched_contracts | TEXT[] | Contract tracking |
| naics_weights | JSONB | NAICS frequency scores |
| agency_weights | JSONB | Agency frequency scores |
| timezone | TEXT | User timezone (default: America/New_York) |
| sms_enabled | BOOLEAN | SMS delivery flag |
| phone_number | TEXT | E.164 format phone |
| preferred_delivery_hour | INTEGER | Local hour (0-23) |

#### `briefing_snapshots`
Daily data snapshots for change detection.

| Column | Type | Description |
|--------|------|-------------|
| user_email | TEXT | User identifier |
| snapshot_date | DATE | Snapshot date |
| tool | TEXT | Source tool name |
| raw_data | JSONB | Snapshot data |
| diff_data | JSONB | Computed differences |
| item_count | INTEGER | Items in snapshot |

**Tool values:** `opportunity_hunter`, `recompete`, `market_assassin`, `contractor_db`, `web_intelligence`

#### `briefing_log`
Delivery tracking and content storage.

| Column | Type | Description |
|--------|------|-------------|
| user_email | TEXT | Recipient |
| briefing_date | DATE | Briefing date |
| briefing_content | JSONB | Full briefing data |
| briefing_html | TEXT | Rendered HTML |
| delivery_status | TEXT | pending/sent/failed |
| email_sent_at | TIMESTAMPTZ | Delivery timestamp |
| retry_count | INTEGER | Retry attempts (max 3) |
| items_count | INTEGER | Items in briefing |
| tools_included | TEXT[] | Data sources used |

---

## Cron Jobs

### `/api/cron/send-briefings`

Main briefing delivery job. Runs at 7 AM UTC daily.

**Flow:**
1. Verify Vercel cron header or CRON_SECRET
2. Retry failed briefings from previous 3 days (max 3 retries)
3. Resolve the audience from `user_notification_settings` plus `smart_user_profiles`
4. Apply rollout mode:
   - `beta_all` sends to the full eligible audience
   - `rollout` sends to a sticky program cohort with cooldown and fallback caps
   - rollout cohorts are intended to receive all 3 brief types before rotating
5. Deduplicate by email address
6. Check `briefing_log` to prevent duplicate sends for the same user/day
7. Generate an AI briefing for each selected user
8. Skip users with no opportunities
9. Persist the generated briefing to `briefing_log`
10. Send the email and update delivery status
11. Save daily metrics and run post-send validation

**Current audience behavior:**
- During broad beta, the system can run in `beta_all`
- For conversion testing, switch to `rollout`
- Rollout mode prioritizes program-ready users with NAICS data and limits fallback users when possible
- Rotation is guarded by cohort progress, not just a simple timer

**Rollout control endpoint:**
```bash
# Preview current rollout state
curl "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD"

# Enable controlled rollout
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD&mode=rollout&cohortSize=250&stickyDays=14&cooldownDays=21&maxFallbackPercent=15&requiredDailyBriefs=2&requiredWeeklyDeepDives=2&requiredPursuitBriefs=2&includeSmartProfiles=true"

# Rotate to a fresh cohort
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD&rotate=true"
```

**Program cohort completion rules:**
- keep the cohort active for at least 14 days
- require at least 2 successful `daily brief` sends per member
- require at least 2 successful `weekly deep dive` sends per member
- require at least 2 successful `pursuit brief` sends per member
- manual rotation is blocked until the cohort is complete unless `force=true` is used

**Test manually:**
```bash
# Test for specific email
curl "https://tools.govcongiants.org/api/admin/send-test-briefing?password=galata-assassin-2026&email=user@example.com&test=true"

# Trigger full cron
curl -H "Authorization: Bearer $CRON_SECRET" "https://tools.govcongiants.org/api/cron/send-briefings"
```

### Snapshot Crons

| Endpoint | Schedule | Data Source |
|----------|----------|-------------|
| `/api/cron/snapshot-opportunities` | 7:00 AM | SAM.gov API |
| `/api/cron/snapshot-recompetes` | 7:15 AM | FPDS/USASpending |
| `/api/cron/snapshot-awards` | 7:30 AM | USASpending awards |
| `/api/cron/snapshot-contractors` | 7:45 AM | Contractor database |
| `/api/cron/web-intelligence` | 8:00 AM | Serper web search |

---

## Briefing Generation

### Win Probability Scoring

Each opportunity is scored 0-100% based on fit:

| Factor | Max Points | Logic |
|--------|------------|-------|
| NAICS Match | 25 | Exact match, prefix, or related |
| Set-Aside | 25 | Matches user certifications |
| Agency Experience | 15 | Has past performance |
| Contract Size | 15 | Within typical range |
| Capability Match | 10 | Keyword matching |
| Contract Vehicle | 10 | Holds required vehicle |

**Tiers:**
- Excellent: 75%+ (green badge)
- Good: 60-74% (lime badge)
- Moderate: 45-59% (yellow badge)
- Low: 30-44% (orange badge)
- Poor: <30% (no badge)

### Relevance Filtering

Items are filtered by relevance score:
- Minimum threshold: 20 points
- Exception: High urgency items (≥80) always included
- Deadlines within 7 days boost urgency to 90+

### Categories

| Category | Icon | Description |
|----------|------|-------------|
| new_opportunity | 🎯 | New SAM.gov opportunities |
| deadline_alert | ⏰ | Upcoming deadlines |
| amendment | 📝 | Contract amendments |
| new_award | 🏆 | Recent contract awards |
| competitor_win | ⚔️ | Competitor activity |
| recompete_alert | 🔄 | Expiring contracts |
| timeline_change | 📅 | Schedule changes |
| teaming_signal | 🤝 | Teaming opportunities |
| sblo_update | 📋 | SBLO updates |
| certification_change | 📜 | Certification news |
| spending_shift | 💰 | Budget changes |
| web_signal | 🌐 | Web intelligence |

---

## Email Delivery

### Configuration

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=hello@govconedu.com  # or alerts@govcongiants.com
SMTP_PASSWORD=***
```

### Template Structure

```html
<!-- Header with branding -->
<div style="background: linear-gradient(135deg, #1e3a8a, #7c3aed);">
  GovCon Giants Daily Intel
</div>

<!-- FREE PREVIEW Banner (beta) -->
<div style="background: #10b981;">
  🎁 FREE PREVIEW - Daily Intelligence Briefing
</div>

<!-- Summary stats -->
<div>
  15 urgent alerts • 8 new opportunities • 3 deadline alerts
</div>

<!-- Top items with win probability -->
<div class="item">
  <span class="badge excellent">85% Fit</span>
  <h3>Contract Title</h3>
  <p>Agency • NAICS • $Value</p>
</div>

<!-- CTA -->
<a href="https://tools.govcongiants.org/briefings">
  View Full Briefing
</a>
```

---

## SMS Delivery

### Configuration

```env
TWILIO_ACCOUNT_SID=***
TWILIO_AUTH_TOKEN=***
TWILIO_PHONE_NUMBER=+1***
TWILIO_MESSAGING_SERVICE_SID=***
```

### Message Format

```
GovCon Briefing: 8 urgent alerts, 15 total items.
Top: [headline]. View: shop.govcongiants.org/briefings
```

**Limits:** 160 characters with truncation warning

---

## Admin Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/send-test-briefing` | GET | Send test briefing to one email |
| `/api/admin/trigger-briefings` | GET | Preview/execute batch send |
| `/api/admin/generate-ma-briefing` | GET | Generate MA briefing |
| `/api/admin/generate-recompete-briefing` | GET | Generate Recompete briefing |
| `/api/admin/generate-contractor-db-briefing` | GET | Generate Contractor DB briefing |
| `/api/admin/grant-briefings` | GET | Grant access to user |
| `/api/admin/grant-briefings-all` | GET | Batch grant access |
| `/api/admin/seed-test-briefing` | GET | Create test data |

**Authentication:** `?password=galata-assassin-2026` or `ADMIN_PASSWORD` env

**Preview mode:** `?mode=preview` (safe)
**Execute mode:** `?mode=execute` (performs action)

---

## User-Facing Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/briefings/latest` | GET | Fetch user's latest briefing |
| `/api/briefings/verify` | GET | Check briefing access |
| `/api/briefings/preferences` | GET/POST | Delivery preferences |
| `/api/briefings/test-sms` | POST | Send test SMS |
| `/api/briefings/sms-webhook` | POST | Twilio callbacks |

---

## Frontend Pages

| Page | Purpose |
|------|---------|
| `/briefings` | Briefings dashboard |
| `/briefings/lindy-setup` | AI chat configuration |
| `/alerts/preferences` | Alert & briefing preferences |

---

## Timezone Support

Briefings deliver between 6-10 AM local time:

| Timezone | UTC Offset |
|----------|------------|
| America/New_York | -5 (EST) / -4 (EDT) |
| America/Chicago | -6 (CST) / -5 (CDT) |
| America/Denver | -7 (MST) / -6 (MDT) |
| America/Los_Angeles | -8 (PST) / -7 (PDT) |
| America/Phoenix | -7 (no DST) |
| Pacific/Honolulu | -10 |
| America/Anchorage | -9 |

---

## Retry Logic

**Failed briefings are retried:**
- Up to 3 attempts within 3 days
- Tracked via `retry_count` column
- Errors logged in `error_message`

**Retry process:**
1. Query `briefing_log` for failed entries (past 3 days, retry_count < 3)
2. Attempt regeneration and delivery
3. Increment retry_count on failure
4. Mark as sent on success

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/briefings/delivery/generator.ts` | Main generation logic |
| `src/lib/briefings/delivery/sender.ts` | Email/SMS delivery |
| `src/lib/briefings/win-probability.ts` | Scoring algorithm |
| `src/lib/briefings/diff-engine.ts` | Change detection |
| `src/app/api/cron/send-briefings/route.ts` | Cron handler |
| `src/lib/supabase/briefings-schema.sql` | Database schema |

---

## Troubleshooting

### Briefings not sending

1. **Check snapshot data exists:**
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     "https://tools.govcongiants.org/api/cron/snapshot-opportunities"
   ```

2. **Verify user profile exists:**
   - Check `user_notification_settings` table has naics_codes populated

3. **Test specific user:**
   ```bash
   curl "https://tools.govcongiants.org/api/admin/send-test-briefing?password=galata-assassin-2026&email=user@example.com&test=true"
   ```

4. **Check logs:**
   ```bash
   vercel logs --prod | grep briefing
   ```

### Common issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 0 items generated | No snapshot data | Run snapshot crons first |
| No users processed | All filtered by timezone | Wait for correct delivery window |
| Email not delivered | SMTP credentials | Check SMTP_* env vars |
| SMS fails | Phone format | Ensure E.164 format (+1...) |

---

## Cost Analysis

At scale (~1000 users):
- SAM.gov API: Free (government API)
- Serper web search: ~$50/month
- SMTP: ~$10/month
- Twilio SMS: ~$0.0079/message
- **Total: ~$2.85/user/month**

---

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) - Project configuration
- [lessons.md](../tasks/lessons.md) - Development patterns
- [MEMORY.md](../MEMORY.md) - Session history

---

---

## Changelog

### April 4, 2026 (PM) - Daily Alerts Enhancement

**Daily Alerts ($19/mo) Enhancements:**
- Added color-coded Notice Type Badges: RFP (green), RFQ (blue), Sources Sought (purple), Pre-Sol (orange), Combined (teal)
- Added Posted Date field: `📅 Posted Apr 07, 2026`
- Enhanced Urgency System:
  - 🔥 3 DAYS LEFT (red background + highlighted row) for ≤3 days
  - ⚡ X days (orange badge) for ≤7 days
  - 📅 2 weeks (yellow badge) for ≤14 days
- Row highlighting for urgent opportunities
- Maintains clear value distinction (no Win Probability to preserve $49 tier value)

**Product Differentiation Strategy:**
- $19/mo = "Don't miss opportunities" (volume play)
- $49/mo = "Know WHICH opportunities to pursue" (strategy play with Win Probability + AI)

**File:** `src/app/api/cron/daily-alerts/route.ts`

### April 4, 2026 (AM) - Daily Brief Enhancement

**Daily Brief ($49/mo) Enhancements:**
- Added Notice Type Badge to each opportunity card (RFP/RFQ/Sources Sought/Pre-Sol/Combined/Other)
- Added Posted Date field showing when opportunity was released
- Updated Notice Summary label to "Notice Type Summary (Top 10 Active)" for clarity
- Color-coded badge CSS classes: `.type-rfp`, `.type-rfq`, `.type-sources-sought`, `.type-presol`, `.type-combined`, `.type-other`

**File:** `src/app/api/admin/send-all-briefings/route.ts`

---

*Last Updated: April 4, 2026*
