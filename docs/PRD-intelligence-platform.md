# PRD: GovCon Intelligence Platform v2

## Overview

Transform individual tools into a unified intelligence platform that tracks, monitors, and proactively alerts small businesses about opportunities - the way large contractors operate.

**Core Insight:** Large companies have regional/agency specialists who know every bid coming out. We need to give that capability to small businesses.

---

## Workflow Orchestration Applied

### Decision Checklist

| Feature | Necessary? | Traceable? | Verified? |
|---------|------------|------------|-----------|
| 45-Day Free Trial | Yes - hooks users, proves value | User feedback: "need to try before buy" | Will track conversion rates |
| Recompete Tracking | Yes - differentiates from competitors | User request + large contractor behavior | Will test with beta users |
| Weekly Bids Report | Yes - "what you missed" is high value | User request | Will measure open rates |
| Agency Segmentation | Yes - mirrors enterprise BD teams | Industry standard practice | Will test with power users |
| Multi-Site Aggregation | Yes - SAM.gov misses 20%+ of opps | Data: 85+ agency sites exist | Will verify coverage |

---

## Feature 1: Free Trial Funnel (21 Days Recommended)

### Trial Length Research

| Trial Length | Conversion Rate | Source |
|--------------|-----------------|--------|
| 7 days or less | ~40.4% | Short trials create urgency |
| 14 days | Most common (62%) | B2B standard |
| 14-21 days | Optimal for B2B | Balance engagement vs free-rider |
| 30+ days | ~30.6% | 71% worse than short trials |

**Decision: 21 days** (configurable - can A/B test)
- 3 weeks of daily alerts (~15 emails)
- 3 weekly bids reports
- Enough to prove value
- Still creates urgency

*Sources: [First Page Sage](https://firstpagesage.com/seo-blog/saas-free-trial-conversion-rate-benchmarks/), [Ordway Labs](https://ordwaylabs.com/blog/saas-free-trial-length-conversion/), [1Capture](https://www.1capture.io/blog/free-trial-conversion-benchmarks-2025)*

### Current State
- OH is gated (requires purchase or Pro subscription)
- Alerts/Briefings are free during beta (ends April 27)

### Target State
```
User Flow:
1. User arrives at Opportunity Hunter
2. Enters email + NAICS to unlock
3. Gets 21 days of FREE:
   - Daily Alerts (matching opportunities)
   - Weekly Briefings (market intel)
   - Recompete Snapshots
4. Day 14: "You've received 87 opportunities. Upgrade to keep access"
5. Day 18: "3 days left - don't lose your intel"
6. Day 21: Gated → must upgrade to continue
```

### Test Criteria
- [ ] User can sign up with just email + NAICS
- [ ] Alerts start within 24 hours
- [ ] Day 30/40 emails send correctly
- [ ] Day 45 access revokes properly
- [ ] Conversion rate tracked

### Technical Requirements
- `user_notification_settings.trial_start_date`
- `user_notification_settings.trial_end_date`
- Cron job to check trial expiration
- Email sequence (welcome, day 30, day 40, day 45)

---

## Feature 2: Recompete Contract Tracking

### Current State
- Static list of 9,450 expiring contracts
- No user-specific tracking
- No updates after initial load

### Target State
```
User Flow:
1. User browses Recompete Tracker
2. Clicks "Track This Contract" on interesting ones
3. Contract saved to their profile
4. System monitors indefinitely:
   - Award modifications (value changes)
   - Task order activity
   - Related Sources Sought
   - Incumbent news (from web)
   - Follow-on solicitation posted
5. User gets alerts when anything changes
```

### What "Related" Means
- Same incumbent + same NAICS
- Same agency/office
- Similar scope keywords
- Follow-on solicitation numbers

### Test Criteria
- [ ] User can save contracts to their tracker
- [ ] Saved contracts persist across sessions
- [ ] Modifications detected within 24h
- [ ] Related opps linked correctly
- [ ] Alert sent on change

### Technical Requirements
- `user_tracked_contracts` table
- Cron job: check USASpending for updates
- Cron job: search SAM.gov for related Sources Sought
- Web scraper: news about incumbent companies

---

## Feature 3: Contractor Database Tracking

### Current State
- 3,500+ contractors in database
- Static list, no user tracking
- No relationship monitoring

### Target State
```
User Flow:
1. User browses Contractor Database
2. Clicks "Track This Contractor" for teaming targets
3. Contractor saved to their network
4. System monitors:
   - New awards they win
   - Contract modifications
   - Subcontracting opportunities
   - Set-aside changes (lost 8(a), etc.)
   - New capabilities added
5. User gets alerts on changes
```

### Test Criteria
- [ ] User can save contractors
- [ ] New awards detected within 48h
- [ ] Set-aside status changes detected
- [ ] Alert sent on significant change

### Technical Requirements
- `user_tracked_contractors` table
- Cron job: check USASpending for new awards
- Cron job: check SAM.gov for entity updates

---

## Feature 4: Weekly Bids Report ("What You Missed")

### Current State
- Daily alerts for new opportunities
- No summary of "what's outstanding"

### Target State
```
Weekly Email (Every Monday):

📊 WEEKLY BIDS REPORT - Week of April 7, 2026

Your NAICS: 541512, 541611, 541330

OUTSTANDING OPPORTUNITIES:

📋 Sources Sought (respond by deadline to influence RFP)
├── VA IT Modernization - Due Apr 15 - $5M est
├── DOD Cyber Support - Due Apr 18 - $2M est
└── +12 more → [View All]

📝 Pre-Solicitations (coming soon)
├── HHS Data Analytics - Est. release Apr 20
├── DOE Cloud Migration - Est. release Apr 25
└── +8 more → [View All]

📄 Active RFPs (submit proposals)
├── Army Software Dev - Due Apr 22 - $10M
├── Navy Help Desk - Due Apr 30 - $3M
└── +5 more → [View All]

💰 Active RFQs (submit quotes)
├── GSA IT Equipment - Due Apr 10 - $500K
├── DOJ Consulting - Due Apr 12 - $200K
└── +3 more → [View All]

⏰ CLOSING THIS WEEK:
├── 3 opportunities close Monday
├── 5 opportunities close Friday
└── [View Closing Soon →]
```

### Test Criteria
- [ ] Email categorizes by notice type correctly
- [ ] Only shows user's NAICS matches
- [ ] "Outstanding" = posted, not yet closed
- [ ] Closing dates accurate
- [ ] Links work

### Technical Requirements
- New cron: `weekly-bids-report` (Monday 6 AM local)
- Query SAM.gov for all open opps by user NAICS
- Categorize by notice type (p, r, k, o, s, i)
- Format as digest email

---

## Feature 5: Agency/Region Segmentation

### Current State
- Users can filter by state
- No agency-specific tracking
- No saved searches

### Target State
```
User Profile:
- Primary NAICS: 541512
- Tracked Agencies: VA, DOD, HHS
- Tracked Regions: Florida, DC Metro, Texas
- Tracked Set-Asides: 8(a), SDVOSB

System then:
1. Monitors ALL opportunities from tracked agencies
2. Alerts on ANY bid from tracked agencies (even outside NAICS)
3. Weekly summary per agency
4. Comparison: "VA posted 47 opps this week, down 12% from last week"
```

### Test Criteria
- [ ] User can save agency preferences
- [ ] Alerts include agency-specific opps
- [ ] Weekly summary accurate
- [ ] Trend data calculated correctly

### Technical Requirements
- `user_notification_settings.tracked_agencies[]`
- `user_notification_settings.tracked_regions[]`
- Modify daily-alerts to include agency matches
- New cron: agency-activity-summary (weekly)

---

## Feature 6: Multi-Site Aggregation (85+ Agency Sites)

### The Problem
SAM.gov doesn't capture everything. Many agencies post on their own sites:
- DOE National Labs (each lab has own site)
- NIH grants portal
- DARPA opportunities
- NASA SEWP
- GSA eBuy
- Army CHESS
- Navy SeaPort
- And 70+ more...

### Target State
```
Aggregated Feed:
1. SAM.gov (primary)
2. Grants.gov (grants)
3. Agency-specific sites (scraped/API)

User sees unified results:
"Found 127 opportunities matching your profile"
- 89 from SAM.gov
- 23 from Grants.gov
- 15 from agency sites (DOE Labs, NIH, etc.)
```

### Priority Agency Sites (Phase 1)
| Agency | Site | Why |
|--------|------|-----|
| DOE Labs | Various | $20B+ in contracts, unique opps |
| NIH | grants.nih.gov | Major health/IT funding |
| DARPA | darpa.mil/work-with-us | Innovation opps |
| NASA SEWP | sewp.nasa.gov | Major IT vehicle |
| GSA eBuy | ebuy.gsa.gov | Schedule orders |

### Test Criteria
- [ ] Scraper runs without errors
- [ ] Deduplication works (no duplicates from SAM + agency)
- [ ] Source attribution correct
- [ ] Links to original posting work

### Technical Requirements
- Scraper service (Puppeteer or Playwright)
- `opportunity_sources` table
- Deduplication by title + agency + amount
- Rate limiting per site

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- [ ] 45-Day Free Trial funnel
- [ ] Weekly Bids Report email
- [ ] Database tables for tracking

### Phase 2: Tracking (Weeks 3-4)
- [ ] Recompete contract tracking
- [ ] Contractor database tracking
- [ ] Update detection crons

### Phase 3: Intelligence (Weeks 5-6)
- [ ] Agency/Region segmentation
- [ ] Saved search preferences
- [ ] Trend analysis

### Phase 4: Aggregation (Weeks 7-8)
- [ ] Multi-site scraper framework
- [ ] Priority 5 agency sites
- [ ] Unified search results

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Trial-to-Paid Conversion | 15% | Stripe subscriptions / trial starts |
| Tracked Contracts per User | 10+ | Avg saved contracts |
| Weekly Report Open Rate | 40%+ | Email analytics |
| Alert Engagement | 25%+ CTR | Click-through rate |
| Multi-Site Coverage | 20% more opps | Unique opps from non-SAM sources |

---

## Database Schema Changes

```sql
-- User tracking preferences
ALTER TABLE user_notification_settings ADD COLUMN
  tracked_agencies TEXT[] DEFAULT '{}',
  tracked_regions TEXT[] DEFAULT '{}',
  trial_start_date TIMESTAMPTZ,
  trial_end_date TIMESTAMPTZ;

-- Contract tracking
CREATE TABLE user_tracked_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  award_id TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  last_checked TIMESTAMPTZ,
  last_change TIMESTAMPTZ,
  notes TEXT,
  UNIQUE(user_email, award_id)
);

-- Contractor tracking
CREATE TABLE user_tracked_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  uei TEXT NOT NULL,
  company_name TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  last_checked TIMESTAMPTZ,
  last_change TIMESTAMPTZ,
  notes TEXT,
  UNIQUE(user_email, uei)
);

-- Multi-source opportunities
CREATE TABLE aggregated_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL, -- 'sam.gov', 'grants.gov', 'doe-lab-xyz'
  source_id TEXT NOT NULL,
  title TEXT,
  agency TEXT,
  naics TEXT[],
  amount_estimate NUMERIC,
  posted_date DATE,
  response_date DATE,
  notice_type TEXT,
  url TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, source_id)
);
```

---

## Pricing (Existing - No Changes)

New features enhance existing products, no new pricing tiers needed.

### Existing Products (Keep As-Is)
| Product | Price | New Features Added |
|---------|-------|-------------------|
| OH Free | $0 | → 45-day trial with alerts/briefings |
| OH Pro | $49 | → Weekly Bids Report included |
| Daily Alerts | $19/mo | → Weekly Bids Report included |
| Briefings | $49/mo | → Agency segmentation included |
| Recompete Tracker | $397 | → Contract tracking (save & monitor) |
| Contractor Database | $497 | → Contractor tracking (save & monitor) |
| Pro Giant Bundle | $997 | → All tracking + multi-site |
| Ultimate Bundle | $1,497 | → Everything + priority features |

### Feature-to-Product Mapping
| Feature | Available To |
|---------|-------------|
| 45-Day Trial | Everyone (new users) |
| Weekly Bids Report | OH Pro, Alerts, any purchaser |
| Contract Tracking | Recompete purchasers |
| Contractor Tracking | Database purchasers |
| Agency Segmentation | Briefings subscribers |
| Multi-Site Aggregation | Bundle purchasers (Pro Giant+) |

---

## Dependencies

- SAM.gov API (have)
- USASpending API (have)
- Grants.gov API (have)
- Web scraper infrastructure (need)
- Email service capacity for weekly digests (have)

---

## Feature 7: Federal Agency Hierarchy API (Tango-Style)

### Reference
Tango by MakeGov: https://tango.makegov.com/docs/federal-agency-hierarchy/

### What Tango Does
Unified federal organization lookup that consolidates:
1. **Federal Hierarchy** (SAM.gov - authoritative)
2. **USAspending** (codes/details)
3. **FPDS** (historical)

Key features:
- Search by name: `GET /api/organizations/?search=FEMA`
- Filter by code: `?cgac=069`, `?fpds_code=2100`
- Returns hierarchy path, parent relationships, office details
- Handles typos, abbreviations, context queries

### Why We Need This

**Current problem:** Users don't know how agencies are structured. They search "VA" but don't know about VHA, VBA, NCA, etc.

**Solution:** Build our own agency hierarchy that:
1. Maps every agency → sub-agencies → offices
2. Links to contracting activity (who buys what)
3. Shows spending by office
4. Connects to our NAICS/pain points data

### Target State

```
GET /api/agency-hierarchy?search=FEMA

{
  "results": [
    {
      "key": "uuid",
      "name": "Federal Emergency Management Agency",
      "short_name": "FEMA",
      "parent": "Department of Homeland Security",
      "cgac": "070",
      "fpds_code": "7022",
      "hierarchy_path": "DHS > FEMA",
      "offices": [
        {
          "name": "Office of the Chief Procurement Officer",
          "code": "70RSAT",
          "contracts_fy25": 847,
          "total_value_fy25": "$2.3B",
          "top_naics": ["541512", "541611", "236220"]
        }
      ],
      "pain_points": ["disaster response IT", "logistics support", "temporary housing"],
      "sblo_contact": {
        "name": "John Smith",
        "email": "john.smith@fema.dhs.gov",
        "phone": "202-555-1234"
      }
    }
  ]
}
```

### Data Sources We Have

| Source | What It Provides |
|--------|------------------|
| SAM.gov Federal Hierarchy API | Official hierarchy (we have this) |
| USAspending | Spending by agency/office |
| Our pain points JSON | 250 agencies, 2,765 pain points |
| Our SBLO database | 3,500+ contacts |

### Enhancements Over Tango

| Tango | Our Version |
|-------|-------------|
| Hierarchy + codes | + Pain points |
| Parent relationships | + SBLO contacts |
| Historical identifiers | + Spending data |
| Basic search | + NAICS relevance |
| API only | + MCP tool + Internal use |

### MCP Tool Design

```typescript
// MCP Tool: mcp__govcon__agency_hierarchy
{
  name: "agency_hierarchy",
  description: "Look up federal agency structure, offices, contacts, and spending",
  parameters: {
    search: "Agency name or abbreviation",
    cgac: "CGAC code (optional)",
    include_offices: "Include sub-offices (default true)",
    include_spending: "Include FY spending data",
    include_contacts: "Include SBLO contacts"
  }
}
```

### Internal Use Cases

1. **Market Assassin** - Auto-populate agency structure in reports
2. **Opportunity Hunter** - Show agency context when viewing opps
3. **Daily Alerts** - "This opp is from VHA, part of VA"
4. **Briefings** - Agency spending trends

### Implementation

**Phase 1: Build the data layer**
- Ingest Federal Hierarchy API into Supabase
- Link to existing pain_points and SBLO data
- Add USAspending aggregations

**Phase 2: Build the API**
- `/api/agency-hierarchy` endpoint
- Search, filter, include options
- Cache with 24h TTL

**Phase 3: MCP Tool**
- Add to samgov MCP server
- Or create new `govcon` MCP server

**Phase 4: Integration**
- Use in Market Assassin reports
- Use in Opportunity Hunter context
- Use in briefings generation

### Test Criteria
- [ ] Search "FEMA" returns correct hierarchy
- [ ] Search "VA" returns all 3 administrations
- [ ] CGAC lookup works
- [ ] Pain points linked correctly
- [ ] SBLO contacts included
- [ ] Spending data accurate

---

---

## Implementation Status

| Moat | Feature | Status | Notes |
|------|---------|--------|-------|
| 7 | Agency Hierarchy API | ✅ **COMPLETE** | Tango-style with pain points, contractors, spending |
| 6 | Multi-Site Aggregation | ⏳ In Progress | MCP built with 21 sources, needs data population |
| - | USASpending MCP | ✅ **FIXED** | 422 error fixed April 5 (added award_type_codes) |
| 1 | 21-Day Free Trial | ⏸️ After validation | Waiting on 800 users briefing validation |
| 2 | Weekly Bids Report | ⏸️ After validation | Monday digest |
| 3 | Recompete Tracking | ⏸️ After trial | Save + monitor contracts |
| 4 | Contractor Tracking | ⏸️ After trial | Monitor teaming targets |
| 5 | Agency Segmentation | ⏸️ After trial | Track specific agencies |

### Moat 7 Completion (April 4, 2026)

**Agency Hierarchy API v2** - Unified federal agency intelligence

**Features Built:**
- Search by name, abbreviation, or topic
- CGAC code lookup
- Pain points matching (250 agencies, 2,765 pain points)
- Contractor/SBLO contacts (2,768 contractors)
- USASpending integration (spending stats)
- 450+ agency alias mappings

**Files Created:**
- `src/lib/agency-hierarchy/` - Core module
- `src/data/agency-aliases.json` - Alias mappings
- `docs/agency-hierarchy-api.md` - API documentation
- `tests/test-agency-hierarchy.sh` - Test script

**API Endpoint:** `/api/agency-hierarchy`

---

*Created: April 3, 2026*
*Updated: April 5, 2026*
*Status: Moat 7 Complete, USASpending MCP Fixed, Moat 6 In Progress*
