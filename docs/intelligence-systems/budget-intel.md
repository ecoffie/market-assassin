# Budget Intelligence System

> Early-warning system for federal procurement opportunities 12-24 months before RFPs hit

## Overview

Budget Intelligence identifies contract opportunities at the earliest possible stage by analyzing:
- **Congressional Budget Justifications (CBJs)** - Program-level funding 18+ months ahead
- **Agency Pain Points** - Real challenges agencies are trying to solve
- **Budget Authority** - Where the money is flowing (growing vs cutting)
- **NDAA Mandates** - Congressional requirements driving new contracts
- **Priorities** - Specific programs with known funding and timelines

---

## Data Sources

| Source | Type | Count | Update Frequency |
|--------|------|-------|------------------|
| Pain Points | JSON → DB | 2,765 pain points | Quarterly |
| Priorities | JSON → DB | 2,500 priorities | Quarterly |
| Budget Authority | JSON → DB | 47 agencies × 2 FYs | Annual |
| Budget Programs | DB | TBD (CBJ extraction) | Annual |
| NAICS Mappings | DB | Auto-generated | Continuous |

---

## API Reference

### Base URL
```
https://tools.govcongiants.org/api/budget-intel
```

### Endpoints

| Query | Purpose |
|-------|---------|
| `?agency=DOD` | Full intel for specific agency |
| `?naics=541512` | Programs/pain points relevant to NAICS |
| `?trend=growing` | Agencies with growing budgets |
| `?trend=surging` | Agencies with 30%+ budget growth |
| `?category=cybersecurity` | Pain points by category |
| `?naics=541512&mode=opportunities` | Ranked opportunity predictions |
| (no params) | Summary stats |

### Example: Agency Query

```bash
curl "https://tools.govcongiants.org/api/budget-intel?agency=DOD"
```

**Response:**
```json
{
  "success": true,
  "query": { "agency": "DOD" },
  "agency": {
    "name": "Department of Defense",
    "abbreviation": "DOD",
    "toptierCode": "097"
  },
  "budgetAuthority": {
    "fy2025": 848300000000,
    "fy2026": 961600000000,
    "change": {
      "amount": 113300000000,
      "percent": 1.134,
      "trend": "growing"
    }
  },
  "painPoints": {
    "all": ["...", "..."],
    "byCategory": {
      "cybersecurity": ["..."],
      "modernization": ["..."],
      "infrastructure": ["..."]
    },
    "ndaaItems": ["FY2026 NDAA: AI/ML security policy..."],
    "total": 11
  },
  "priorities": [
    {
      "agency": "Department of Defense",
      "description": "$170B in procurement funding for FY2026...",
      "fundingAmount": 170000000000,
      "fiscalYear": "FY2026",
      "keywords": ["procurement"]
    }
  ],
  "recommendations": [
    "DOD budget growing 13% - excellent time for new contracts",
    "5 NDAA mandates creating procurement pressure"
  ]
}
```

### Example: NAICS Query with Opportunities

```bash
curl "https://tools.govcongiants.org/api/budget-intel?naics=541512&mode=opportunities"
```

**Response:**
```json
{
  "success": true,
  "query": { "naics": "541512", "mode": "opportunities" },
  "naicsInfo": {
    "code": "541512",
    "description": "Computer Systems Design Services",
    "relevantCategories": ["cybersecurity", "modernization", "infrastructure"]
  },
  "agencies": [
    {
      "agency": "Department of Defense",
      "budgetTrend": "growing",
      "budgetAuthority": 961600000000,
      "painPointCount": 8,
      "relevantPainPoints": ["Cybersecurity modernization...", "..."],
      "topPriorities": [...]
    }
  ],
  "opportunities": [
    {
      "agency": "Department of Defense",
      "naicsCode": "541512",
      "confidenceScore": 0.85,
      "earlyIndicators": [
        "Growing budget",
        "8 aligned pain points",
        "3 funded priorities",
        "2 NDAA mandates"
      ],
      "estimatedTimeline": "Q3-Q4 FY2026",
      "recommendedAction": "High priority - monitor forecasts"
    }
  ],
  "summary": {
    "relevantAgencies": 35,
    "totalPainPoints": 127,
    "growingAgencies": 8
  }
}
```

---

## Categories

Pain points and priorities are categorized:

| Category | Keywords | Relevant NAICS |
|----------|----------|----------------|
| `cybersecurity` | cyber, security, zero trust, CMMC | 541512, 541511, 541519 |
| `infrastructure` | infrastructure, facility, cloud, network | 541512, 541519, 541330, 236220 |
| `modernization` | modernization, digital, AI, automation | 541512, 541511, 541715 |
| `compliance` | compliance, regulatory, NDAA, mandate | 541611, 541613, 541690 |
| `workforce` | workforce, recruitment, training | 541611, 561210, 561320 |
| `logistics` | logistics, supply chain, procurement | 541614, 561210 |
| `research` | research, R&D, SBIR, prototype | 541330, 541690, 541715 |
| `operations` | operations, maintenance, O&M | 541611, 541614, 561210 |

---

## Budget Trends

| Trend | Definition | Implication |
|-------|------------|-------------|
| `surging` | >30% increase | Major new program starts expected |
| `growing` | 5-30% increase | Good time for new contracts |
| `stable` | -5% to +5% | Steady procurement, focus recompetes |
| `declining` | -5% to -30% | Fewer new starts, efficiency focus |
| `cut` | >30% decrease | Contract consolidation, survival mode |

---

## Slash Command

```bash
/budget-intel DOD                    # Agency intel
/budget-intel 541512                 # NAICS intel
/budget-intel VA cybersecurity       # Agency + category
/budget-intel --trend=surging        # Growing agencies
/budget-intel 541512 --mode=opportunities  # Predictions
```

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `budget_programs` | CBJ line items with funding |
| `agency_budget_authority` | FY-level budget trends |
| `agency_pain_points_db` | Persisted pain points |
| `agency_priorities_db` | Funded priorities |
| `naics_program_mapping` | Links NAICS → programs |
| `budget_intel_sync_runs` | Sync operation tracking |

### Key Views

| View | Purpose |
|------|---------|
| `agency_budget_intel` | Combined budget + programs + pain points |
| `naics_budget_opportunities` | Programs grouped by NAICS |

---

## Integration Points

### Daily Briefings
```typescript
// Include budget insights in briefings
const budgetIntel = await fetchBudgetIntel({ naics: profile.naicsCodes });
briefing.budgetInsights = budgetIntel.opportunities.slice(0, 3);
```

### Market Scan
```typescript
// Add budget context to market analysis
const budgetContext = await getBudgetIntel({ naics });
return {
  ...spendingData,
  growingAgencies: budgetContext.agencies.filter(a => a.trend === 'growing'),
  earlyOpportunities: budgetContext.opportunities
};
```

### Federation Layer
```typescript
// /api/market-intelligence unified response
{
  "spending": { ... },
  "recompetes": { ... },
  "budget": {
    "growingAgencies": [...],
    "programs": [...],
    "opportunities": [...]
  }
}
```

---

## Files

| File | Purpose |
|------|---------|
| `src/app/api/budget-intel/route.ts` | API endpoint |
| `src/data/agency-pain-points.json` | Pain points source (959KB) |
| `src/data/agency-budget-data.json` | Budget authority source |
| `scripts/import-budget-intel.js` | Database import script |
| `supabase/migrations/20260405_budget_intelligence.sql` | Schema |
| `~/.claude/commands/budget-intel.md` | Slash command |
| `docs/PRD-budget-intelligence.md` | Full PRD |

---

## Usage

### Run Migration (first time)
```sql
-- In Supabase SQL Editor
-- Paste contents of supabase/migrations/20260405_budget_intelligence.sql
```

### Import Data
```bash
node scripts/import-budget-intel.js
```

### Test API
```bash
# Summary stats
curl "https://tools.govcongiants.org/api/budget-intel"

# Agency intel
curl "https://tools.govcongiants.org/api/budget-intel?agency=DOD"

# NAICS opportunities
curl "https://tools.govcongiants.org/api/budget-intel?naics=541512&mode=opportunities"

# Trending agencies
curl "https://tools.govcongiants.org/api/budget-intel?trend=surging"
```

---

*Last Updated: April 5, 2026*
