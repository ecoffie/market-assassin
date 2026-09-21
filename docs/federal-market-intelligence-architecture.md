# Federal Market Intelligence Architecture

> Modular Intelligence Systems that Operate Independently and Federate Together

## Philosophy

Each intelligence system is:
1. **Independent** - Has its own API, data source, update schedule
2. **Self-contained** - Delivers value standalone
3. **Federated** - Contributes to unified market view
4. **Cacheable** - Doesn't require real-time queries to other systems

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FEDERAL MARKET INTELLIGENCE                       │
│                         (Unified Query Layer)                        │
│                    GET /api/market-intelligence                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────┬───────────┬───┴───┬───────────┬───────────┐
        │           │           │       │           │           │
        ▼           ▼           ▼       ▼           ▼           ▼
┌───────────┐ ┌───────────┐ ┌───────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│ SPENDING  │ │  AGENCY   │ │ EVENT │ │ RECOMPETE │ │  BUDGET   │ │ FORECAST  │
│  INTEL    │ │  INTEL    │ │ INTEL │ │   INTEL   │ │   INTEL   │ │   INTEL   │
│           │ │           │ │       │ │           │ │           │ │           │
│USASpending│ │250 Agency │ │30 Evt │ │ Contract  │ │   CBJ     │ │  Agency   │
│ + SAM.gov │ │ Profiles  │ │Sources│ │ Expiring  │ │ Analysis  │ │ Forecasts │
└───────────┘ └───────────┘ └───────┘ └───────────┘ └───────────┘ └───────────┘
     │             │           │           │             │             │
     ▼             ▼           ▼           ▼             ▼             ▼
┌───────────┐ ┌───────────┐ ┌───────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│/api/      │ │/api/      │ │/api/  │ │/api/      │ │/api/      │ │/api/      │
│market-scan│ │agency-    │ │federal│ │recompete  │ │budget-    │ │agency-    │
│           │ │sources    │ │-events│ │           │ │intel      │ │forecasts  │
└───────────┘ └───────────┘ └───────┘ └───────────┘ └───────────┘ └───────────┘
     ✅            ✅           ✅          📋            📋            📋
   LIVE          LIVE         LIVE       PLANNED       PLANNED       PLANNED
```

---

## Intelligence System 1: Spending Intelligence ✅ LIVE

### Purpose
"Where is the money actually going?"

### Data Source
- USASpending.gov API (contract awards, $7.5T historical)
- SAM.gov API (active opportunities)

### Standalone Value
- 3-year spending analysis by NAICS/state
- Top agencies by spend volume
- Visibility gap calculation (SAM vs total spend)
- Geographic distribution

### API
```
GET /api/market-scan?naics=541512&state=FL

Response:
{
  "summary": {
    "threeYearSpending": 13375786940.65,
    "visibilityGap": 99.99,
    "marketType": "robust"
  },
  "topAgencies": [...],
  "gapAnalysis": {...},
  "rankedOpportunities": [...]
}
```

### Update Frequency
- Real-time (queries live APIs)
- Cache: 24 hours for spending data

---

## Intelligence System 2: Agency Intelligence ✅ LIVE

### Purpose
"How does each agency buy?"

### Data Source
- Static JSON with 250 agency profiles
- Pain points database (2,765 entries)
- Vehicle mappings

### Standalone Value
- Hidden market % per agency
- Top vehicles to pursue
- Procurement patterns (GSA Schedule %, IDIQ %, direct %)
- Agency-specific tips and pain points

### API
```
GET /api/agency-sources?agency=DOD

Response:
{
  "agency": "Department of Defense",
  "hiddenMarket": 85,
  "spendingBreakdown": {...},
  "topVehicles": ["OASIS+", "Alliant 3", "SeaPort-NxG"],
  "painPoints": ["Legacy system integration", "Cybersecurity compliance"],
  "recommendations": [...]
}
```

### Update Frequency
- Static (manual refresh quarterly)
- Pain points: updated as discovered

---

## Intelligence System 3: Event Intelligence ✅ LIVE

### Purpose
"What networking opportunities exist?"

### Data Source
- 30 curated event sources
- 12 major annual conferences
- Agency OSDBU calendars

### Standalone Value
- Industry days by agency/NAICS
- Matchmaking events
- Training opportunities (APEX Accelerators)
- Conference calendar

### API
```
GET /api/federal-events?naics=541512

Response:
{
  "relevantAgencies": ["DOD", "VA", "DHS"],
  "eventSources": [...],
  "upcomingConferences": [...],
  "recommendations": [...]
}
```

### Update Frequency
- Static sources (manual refresh monthly)
- Could add live scraping of event calendars

---

## Intelligence System 4: Recompete Intelligence 📋 PLANNED

### Purpose
"What contracts are expiring that I can capture?"

### Data Source
- USASpending contract awards
- Period of performance end dates
- Modification history

### Standalone Value
- ~85,000 contracts recompete every 18 months
- 12-18 month advance warning
- Incumbent identification
- Contract value and scope
- Option exercise patterns (signals satisfaction)

### API
```
GET /api/recompete?naics=541512&state=FL&months=18

Response:
{
  "expiringContracts": [
    {
      "incumbent": "Booz Allen Hamilton",
      "agency": "VA",
      "office": "VA Technology Acquisition Center",
      "value": 45000000,
      "endDate": "2027-03-15",
      "estimatedRecompeteDate": "2026-03-15",
      "naics": "541512",
      "description": "IT Support Services"
    }
  ],
  "summary": {
    "totalContracts": 47,
    "totalValue": 892000000,
    "avgContractSize": 19000000
  }
}
```

### Update Frequency
- Nightly batch from USASpending
- Table: `recompete_opportunities`

### Implementation
```sql
CREATE TABLE recompete_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id TEXT UNIQUE NOT NULL,
  incumbent_name TEXT,
  incumbent_uei TEXT,
  awarding_agency TEXT,
  awarding_sub_agency TEXT,
  awarding_office TEXT,
  naics_code TEXT,
  psc_code TEXT,
  description TEXT,
  total_obligation DECIMAL,
  period_of_performance_start DATE,
  period_of_performance_end DATE,
  place_of_performance_state TEXT,
  place_of_performance_city TEXT,
  options_exercised INT,
  options_remaining INT,
  last_modification_date DATE,
  data_source TEXT DEFAULT 'usaspending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recompete_naics ON recompete_opportunities(naics_code);
CREATE INDEX idx_recompete_end_date ON recompete_opportunities(period_of_performance_end);
CREATE INDEX idx_recompete_state ON recompete_opportunities(place_of_performance_state);
```

---

## Intelligence System 5: Budget Intelligence 📋 PLANNED

### Purpose
"What are agencies planning to spend on?"

### Data Source
- Congressional Budget Justifications (CBJs)
- Agency strategic plans
- IT Dashboard investments

### Standalone Value
- New program identification
- Funding levels by program
- IT modernization priorities
- Multi-year procurement signals
- Staffing vs. contractor ratios

### API
```
GET /api/budget-intel?agency=VA&fiscalYear=2026

Response:
{
  "agency": "Veterans Affairs",
  "fiscalYear": 2026,
  "totalRequest": 369800000000,
  "itSpending": 8200000000,
  "keyPrograms": [
    {
      "name": "EHRM Phase 3",
      "amount": 200000000,
      "description": "Electronic Health Record Modernization expansion",
      "naicsRelevance": ["541512", "541511", "518210"],
      "status": "ongoing"
    }
  ],
  "priorities": ["Cybersecurity", "Cloud migration", "Legacy modernization"],
  "sourceDocument": "https://va.gov/budget/fy2026-cbj.pdf"
}
```

### Update Frequency
- Annual (budget season: February-May)
- Manual extraction + AI assistance
- Table: `budget_programs`

### Implementation
```sql
CREATE TABLE budget_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency TEXT NOT NULL,
  fiscal_year INT NOT NULL,
  program_name TEXT NOT NULL,
  program_code TEXT,
  requested_amount DECIMAL,
  enacted_amount DECIMAL,
  description TEXT,
  keywords TEXT[],
  naics_relevance TEXT[],
  document_url TEXT,
  page_reference TEXT,
  extracted_date DATE,
  confidence_score DECIMAL, -- How confident is extraction
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agency, fiscal_year, program_name)
);

CREATE INDEX idx_budget_agency ON budget_programs(agency);
CREATE INDEX idx_budget_fy ON budget_programs(fiscal_year);
CREATE INDEX idx_budget_keywords ON budget_programs USING GIN(keywords);
```

---

## Intelligence System 6: Forecast Intelligence 📋 PLANNED

### Purpose
"What has the agency officially announced as coming?"

### Data Source
- Agency forecast pages (scraped)
- Acquisition Gateway (where available)
- APFS (DHS), agency OSDBUs

### Standalone Value
- Official planned procurements
- Estimated solicitation dates
- Set-aside designations
- Place of performance
- Agency contact information

### API
```
GET /api/agency-forecasts?naics=541512&agency=DHS

Response:
{
  "forecasts": [
    {
      "title": "Cybersecurity Operations Center Support",
      "agency": "DHS/CISA",
      "naics": "541512",
      "estimatedValue": "50M-100M",
      "estimatedSolicitationDate": "2026-Q3",
      "setAside": "Full and Open",
      "placeOfPerformance": "Washington, DC",
      "contactName": "John Smith",
      "contactEmail": "john.smith@dhs.gov",
      "sourceUrl": "https://apfs-cloud.dhs.gov/...",
      "lastScraped": "2026-04-01"
    }
  ],
  "summary": {
    "totalForecasts": 23,
    "byQuarter": { "Q3-2026": 8, "Q4-2026": 10, "Q1-2027": 5 }
  }
}
```

### Update Frequency
- Weekly scrape of top 20 agency forecast pages
- Table: `agency_forecasts`

### Implementation
```sql
CREATE TABLE agency_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agency TEXT NOT NULL,
  forecast_id TEXT, -- Agency's internal ID if available
  title TEXT NOT NULL,
  description TEXT,
  naics_code TEXT,
  psc_code TEXT,
  estimated_value_min DECIMAL,
  estimated_value_max DECIMAL,
  estimated_value_text TEXT,
  estimated_solicitation_date DATE,
  estimated_award_date DATE,
  set_aside TEXT,
  place_of_performance_state TEXT,
  place_of_performance_city TEXT,
  contract_type TEXT,
  competition_type TEXT,
  small_business_goal BOOLEAN,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  source_url TEXT,
  scraped_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_agency, forecast_id)
);

CREATE INDEX idx_forecast_naics ON agency_forecasts(naics_code);
CREATE INDEX idx_forecast_agency ON agency_forecasts(source_agency);
CREATE INDEX idx_forecast_sol_date ON agency_forecasts(estimated_solicitation_date);
```

---

## Federation Layer: Unified Market Intelligence

### Purpose
Query all intelligence systems in one call, get unified market picture.

### API
```
GET /api/market-intelligence?naics=541512&state=FL

Response:
{
  "query": { "naics": "541512", "state": "FL" },
  "timestamp": "2026-04-05T10:30:00Z",

  "spending": {
    "source": "/api/market-scan",
    "threeYearTotal": 13375786940,
    "topAgencies": ["DOD", "VA", "HHS"],
    "visibilityGap": 85
  },

  "agencies": {
    "source": "/api/agency-sources",
    "relevantAgencies": 5,
    "topVehicles": ["OASIS+", "CIO-SP4"],
    "avgHiddenMarket": 78
  },

  "events": {
    "source": "/api/federal-events",
    "upcomingCount": 12,
    "nextIndustryDay": "VA Tampa - May 15",
    "relevantConferences": 3
  },

  "recompetes": {
    "source": "/api/recompete",
    "expiring18Months": 47,
    "totalValue": 892000000,
    "topIncumbents": ["Booz Allen", "SAIC", "Leidos"]
  },

  "budgetSignals": {
    "source": "/api/budget-intel",
    "newPrograms": 8,
    "totalFunding": 450000000,
    "priorities": ["Cloud", "AI", "Zero Trust"]
  },

  "forecasts": {
    "source": "/api/agency-forecasts",
    "officialForecasts": 15,
    "totalEstimatedValue": 320000000,
    "avgLeadTime": "6 months"
  },

  "recommendations": [
    "Target VA recompetes - 12 contracts expiring in your NAICS",
    "Attend VA Tampa Industry Day on May 15",
    "FY2026 budget shows $200M for VA EHRM expansion",
    "Get on GSA Schedule - 40% of VA spending uses it"
  ]
}
```

---

## Data Flow

```
                    ┌──────────────────┐
                    │  External APIs   │
                    │                  │
                    │ • USASpending    │
                    │ • SAM.gov        │
                    │ • Grants.gov     │
                    │ • Agency sites   │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │  Cron Job  │  │  Cron Job  │  │  Cron Job  │
     │  (Nightly) │  │  (Weekly)  │  │  (Annual)  │
     │            │  │            │  │            │
     │ Recompete  │  │ Forecast   │  │  Budget    │
     │  Sync      │  │  Scrape    │  │ Extraction │
     └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
           │               │               │
           ▼               ▼               ▼
     ┌─────────────────────────────────────────┐
     │              Supabase                    │
     │                                          │
     │ • recompete_opportunities                │
     │ • agency_forecasts                       │
     │ • budget_programs                        │
     │ • spending_cache                         │
     └─────────────────────────────────────────┘
                         │
                         ▼
     ┌─────────────────────────────────────────┐
     │         Individual APIs                  │
     │                                          │
     │ /api/market-scan      (live + cache)    │
     │ /api/agency-sources   (static)          │
     │ /api/federal-events   (static)          │
     │ /api/recompete        (from DB)         │
     │ /api/budget-intel     (from DB)         │
     │ /api/agency-forecasts (from DB)         │
     └─────────────────────────────────────────┘
                         │
                         ▼
     ┌─────────────────────────────────────────┐
     │      /api/market-intelligence            │
     │                                          │
     │   Unified query across all systems       │
     │   Combines, ranks, recommends            │
     └─────────────────────────────────────────┘
```

---

## Build Priority

| System | Status | Effort | Value |
|--------|--------|--------|-------|
| Spending Intelligence | ✅ LIVE | Done | High |
| Agency Intelligence | ✅ LIVE | Done | High |
| Event Intelligence | ✅ LIVE | Done | Medium |
| Recompete Intelligence | 📋 Next | 2-3 days | Very High |
| Budget Intelligence | 📋 Planned | 1 week | High |
| Forecast Intelligence | 📋 Planned | 2-3 weeks | Medium |
| Federation Layer | 📋 After above | 2 days | High |

**Recommendation:** Build Recompete Intelligence next - highest value, uses existing USASpending API, most predictable opportunity type.

---

*Last Updated: April 5, 2026*
