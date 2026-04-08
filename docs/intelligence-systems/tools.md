# Intelligence System Tools

> MCP tools and API endpoints that power the intelligence platform

## Overview

Tools are the atomic units of functionality - either MCP server tools or REST API endpoints. They're invoked by skills, agents, and plugins to gather and transform data.

---

## MCP Tools (External Data Sources)

### SAM.gov Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `mcp__samgov__search_opportunities` | Search active opportunities | naics, keywords, state, setAside, postedFrom, postedTo |
| `mcp__samgov__get_opportunity` | Get opportunity details | noticeId |
| `mcp__samgov__check_api_health` | Verify API status | - |
| `mcp__samgov__search_entities` | Find contractors | query, uei, state, naics |
| `mcp__samgov__get_forecast` | Planned procurements | naics, agency, fiscalYear |

**Usage Example:**
```typescript
// Search for IT opportunities in Florida
const opps = await mcp__samgov__search_opportunities({
  naics: '541512',
  state: 'FL',
  setAside: 'SBA',
  postedFrom: '01/01/2026'
});
```

**Important Rules:**
- No comma-separated NAICS codes
- Date format: `MM/dd/yyyy`
- Rate limit: 10/min, 1000/day

---

### USASpending Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `mcp__usaspending__search_contracts` | Search contract awards | naics, state, zipCode, setAside, fiscalYear, includeBorderingStates |
| `mcp__usaspending__get_office_spending` | Spending by contracting office | naics, state, fiscalYear, setAside |
| `mcp__usaspending__get_naics_info` | NAICS code details | naicsCode |
| `mcp__usaspending__expand_search_criteria` | Get broader search suggestions | naics, state, zipCode |

**Usage Example:**
```typescript
// Get contracts in construction for Rhode Island
const contracts = await mcp__usaspending__search_contracts({
  naics: '236220',
  state: 'RI',
  fiscalYear: 2025,
  includeBorderingStates: true
});
```

---

### Grants.gov Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `mcp__grantsgov__search_grants` | Search grant opportunities | keyword, agency, category, status, rows |
| `mcp__grantsgov__get_grant` | Grant details | oppNum |
| `mcp__grantsgov__check_api_health` | API status | - |
| `mcp__grantsgov__list_agencies` | All grant agencies | - |
| `mcp__grantsgov__list_categories` | Funding categories | - |
| `mcp__grantsgov__search_forecasted` | Upcoming grants | keyword, agency, category |

**Usage Example:**
```typescript
// Search for cybersecurity grants from DOD
const grants = await mcp__grantsgov__search_grants({
  keyword: 'cybersecurity',
  agency: 'DOD',
  status: 'posted',
  rows: 50
});
```

---

### Multisite Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `mcp__multisite__search_multisite` | Search aggregated opps | keywords, naics, source, opportunityType, setAside, state |
| `mcp__multisite__get_multisite_stats` | Aggregation stats | - |
| `mcp__multisite__get_source_health` | Scraper health status | - |
| `mcp__multisite__search_nih` | NIH RePORTER direct | keywords, agencies, activityCodes, fiscalYears |
| `mcp__multisite__trigger_scrape` | Manual scrape trigger | source, dryRun, limit |
| `mcp__multisite__list_sources` | Available sources | - |

**Usage Example:**
```typescript
// Search NIH for SBIR opportunities
const nihOpps = await mcp__multisite__search_nih({
  keywords: 'artificial intelligence',
  activityCodes: ['R43', 'R44'], // SBIR Phase I and II
  agencies: ['NCI', 'NIMH']
});
```

---

### Stripe Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `mcp__stripe__search_customers` | Find by email | email, limit |
| `mcp__stripe__get_customer` | Customer details | customerId, email |
| `mcp__stripe__list_payments` | Payment history | customerId, email, limit |
| `mcp__stripe__check_subscription` | Subscription status | email |
| `mcp__stripe__list_products` | All products | active |
| `mcp__stripe__recent_charges` | Recent revenue | days, limit |
| `mcp__stripe__webhook_status` | Webhook health | - |
| `mcp__stripe__revenue_summary` | Revenue report | days |

---

### Vimeo Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `mcp__vimeo__vimeo_upload` | Upload video | file_path, name, description, privacy, folder_id |
| `mcp__vimeo__vimeo_bulk_upload` | Batch upload | directory, pattern, privacy, folder_id |
| `mcp__vimeo__vimeo_list_videos` | List videos | folder_id, per_page |
| `mcp__vimeo__vimeo_get_video` | Video details | video_id |
| `mcp__vimeo__vimeo_update_video` | Update metadata | video_id, name, description, privacy |
| `mcp__vimeo__vimeo_list_folders` | List folders | - |
| `mcp__vimeo__vimeo_create_folder` | Create folder | name |
| `mcp__vimeo__vimeo_add_to_folder` | Add to folder | video_id, folder_id |

---

## Internal API Endpoints

### Intelligence APIs (Live)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/market-scan` | GET | Full market analysis |
| `/api/agency-sources` | GET | Agency procurement patterns |
| `/api/federal-events` | GET | Event sources and calendar |
| `/api/budget-authority` | GET | FY budget data by agency |
| `/api/pain-points` | GET | Agency pain points database |

---

### Market Scan API

```
GET /api/market-scan?naics={code}&state={state}

Parameters:
- naics (required): NAICS code (3-6 digits)
- state (optional): State code (2 letters)
- setAside (optional): SBA, 8A, WOSB, SDVOSB, HUBZone
- months (optional): History period (default: 36)

Response:
{
  "summary": {
    "threeYearSpending": 13375786940.65,
    "visibilityGap": 85.2,
    "marketType": "robust"
  },
  "topAgencies": [...],
  "gapAnalysis": {...},
  "rankedOpportunities": [...],
  "recommendations": [...]
}
```

---

### Agency Sources API

```
GET /api/agency-sources

Endpoints:
- ?agency=DOD           Single agency lookup
- ?agencies=DOD,VA,HHS  Multiple agencies
- ?search=cyber         Search agencies
- ?category=defense     Filter by category
- ?list=true            List all 250 agencies
- ?categories=true      List all categories
- ?all=true             Full data dump
- ?vehicles=true        Vehicle types info
- ?tips=true            General recommendations

Response (single agency):
{
  "agency": "Department of Defense",
  "abbreviation": "DOD",
  "category": "defense",
  "spendingBreakdown": {
    "samPosted": 15,
    "hiddenMarket": 85,
    "breakdown": {
      "gsaSchedule": 30,
      "idiqVehicles": 45,
      "directAwards": 10
    }
  },
  "topVehicles": [...],
  "painPoints": [...],
  "recommendations": [...]
}
```

---

### Federal Events API

```
GET /api/federal-events

Endpoints:
- ?agency=DOD           Events for agency
- ?naics=541512         Events for NAICS
- ?category=industry_day Filter by category
- ?sources=true         All 30 event sources
- ?categories=true      Category definitions
- ?conferences=true     Major annual conferences
- ?all=true             Everything

Response:
{
  "relevantAgencies": ["DOD", "VA", "DHS"],
  "eventSources": [...],
  "categories": {...},
  "recommendations": [...]
}
```

---

### Recompete Intelligence APIs (Live)

| Endpoint | Status | Purpose |
|----------|--------|---------|
| `/api/recompete` | ✅ Live | Query expiring contracts |
| `/api/admin/sync-recompete` | ✅ Live | Sync data from USASpending |

### Planned Intelligence APIs

| Endpoint | Status | Purpose |
|----------|--------|---------|
| `/api/budget-intel` | 📋 Planned | Budget program analysis |
| `/api/agency-forecasts` | 📋 Planned | Official agency forecasts |
| `/api/market-intelligence` | 📋 Planned | Unified federation layer |

---

### Recompete API (Live)

```
GET /api/recompete

Parameters:
- naics (optional): NAICS filter
- agency (optional): Agency filter
- state (optional): Place of performance state
- months (optional): Months ahead (default: 18)
- minValue (optional): Minimum contract value
- incumbent (optional): Search by incumbent name

Response:
{
  "contracts": [
    {
      "contractId": "W9127821D0015",
      "incumbent": "Burns & McDonnell",
      "incumbentUEI": "ABC123...",
      "agency": "Department of Defense",
      "office": "US Army Engineer District Mobile",
      "naics": "541330",
      "totalValue": 249000000,
      "startDate": "2021-04-05",
      "endDate": "2026-04-04",
      "optionsExercised": 2,
      "optionsRemaining": 1,
      "leadTimeMonths": 12
    }
  ],
  "summary": {
    "totalContracts": 47,
    "totalValue": 892000000,
    "avgLeadTime": 14
  }
}
```

---

### Budget Intel API (Planned)

```
GET /api/budget-intel

Parameters:
- agency (optional): Agency filter
- fiscalYear (optional): FY filter (default: current)
- keywords (optional): Program keyword search

Response:
{
  "programs": [
    {
      "agency": "Veterans Affairs",
      "programName": "EHRM Phase 3",
      "fiscalYear": 2026,
      "requestedAmount": 200000000,
      "description": "Electronic Health Record Modernization expansion",
      "naicsRelevance": ["541512", "541511"],
      "confidenceScore": 0.85
    }
  ],
  "summary": {
    "totalPrograms": 42,
    "totalFunding": 1250000000
  }
}
```

---

### Market Intelligence API (Planned - Federation)

```
GET /api/market-intelligence

Parameters:
- naics (required): NAICS code
- state (optional): State filter
- agency (optional): Agency focus

Response:
{
  "query": { "naics": "541512", "state": "FL" },

  "spending": {
    "source": "/api/market-scan",
    "threeYearTotal": 13400000000,
    "topAgencies": ["DOD", "VA", "HHS"]
  },

  "agencies": {
    "source": "/api/agency-sources",
    "relevantAgencies": 5,
    "avgHiddenMarket": 78
  },

  "recompetes": {
    "source": "/api/recompete",
    "expiring18Months": 47,
    "totalValue": 892000000
  },

  "forecasts": {
    "source": "/api/agency-forecasts",
    "officialForecasts": 15,
    "budgetPrograms": 8
  },

  "events": {
    "source": "/api/federal-events",
    "upcomingCount": 12
  },

  "recommendations": [...]
}
```

---

## Admin Tools

### Cron Endpoints

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| `/api/cron/daily-alerts` | 11 AM, 12 PM, 2 PM, 4 PM UTC | Daily opportunity alerts |
| `/api/cron/send-briefings` | 7 AM UTC | Daily briefings |
| `/api/cron/weekly-alerts` | 11 PM Sunday UTC | Weekly digest |
| `/api/cron/health-check` | Every hour | System health check |
| `/api/cron/recompete-sync` | 2 AM UTC (planned) | Recompete data sync |
| `/api/cron/forecast-scrape` | 3 AM Sunday (planned) | Forecast page scraping |

### Admin Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/admin/abuse-report` | View/clear abuse flags |
| `/api/admin/build-pain-points` | Rebuild pain points data |
| `/api/admin/build-budget-data` | Rebuild budget data |
| `/api/admin/trigger-alerts` | Manual alert trigger |
| `/api/admin/send-test-briefing` | Test briefing generation |
| `/api/admin/agent-status` | View agent run status (planned) |
| `/api/admin/trigger-agent` | Manual agent trigger (planned) |

**Auth:** All admin endpoints require `?password=galata-assassin-2026`

---

## Tool Registry

| Tool Type | Count | Status |
|-----------|-------|--------|
| SAM.gov MCP | 5 | ✅ Live |
| USASpending MCP | 4 | ✅ Live |
| Grants.gov MCP | 6 | ✅ Live |
| Multisite MCP | 6 | ✅ Live |
| Stripe MCP | 8 | ✅ Live |
| Vimeo MCP | 8 | ✅ Live |
| Internal APIs | 5 | ✅ Live |
| Planned APIs | 4 | 📋 Planned |
| Admin Tools | 8 | ✅ Live |
| Cron Jobs | 4 | ✅ Live |
| **Total** | **58** | |

---

*Last Updated: April 5, 2026*
