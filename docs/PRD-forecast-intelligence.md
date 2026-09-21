# PRD: Forecast Intelligence System

> Phase 4 of Federal Market Scanner - Predicting procurement opportunities before they're posted

## Problem Statement

85% of federal spending never appears as a SAM.gov solicitation until 30-60 days before award. By then, it's too late to build relationships or position for the win. Contractors need **predictive intelligence** - knowing what agencies will buy 6-18 months before solicitation.

## Vision

Build a forecasting engine that combines multiple public data sources to predict:
1. **What** agencies will buy (programs, services, products)
2. **When** they'll buy it (budget cycles, contract expirations)
3. **How much** they'll spend (budget justifications, historical patterns)
4. **Who** is buying (offices, contracting officers)

---

## Data Sources for Forecast Intelligence

### Tier 1: Contract Expiration Data (Recompetes)

**Source:** USASpending.gov / SAM.gov Contract Data

| Data Point | Value |
|------------|-------|
| ~85,000 contracts recompete every 18 months | $180B+ in predictable opportunities |
| Period of Performance end dates | 12-18 month advance notice |
| Option year patterns | Signal agency satisfaction |
| Modification history | Indicates scope changes |

**API:** USASpending API (we already have this via `usaspending-mcp`)

**Implementation:**
```sql
-- Find contracts expiring in next 18 months by NAICS
SELECT
  recipient_name,
  awarding_agency_name,
  awarding_office_name,
  naics_code,
  total_obligation,
  period_of_performance_current_end_date,
  contract_award_unique_key
FROM contracts
WHERE naics_code LIKE '5415%'
  AND period_of_performance_current_end_date BETWEEN NOW() AND NOW() + INTERVAL '18 months'
ORDER BY total_obligation DESC
```

---

### Tier 2: Congressional Budget Justifications (CBJs)

**Source:** Agency budget documents submitted to Congress

| Agency | CBJ URL Pattern | Key Sections |
|--------|-----------------|--------------|
| DHS | dhs.gov/publication/congressional-budget-justification-fiscal-year-fy-{year} | IT, Cybersecurity, Infrastructure |
| Treasury | home.treasury.gov/about/budget-financial-reporting.../fy-{year}-congressional-justification | Fiscal Service, IRS Modernization |
| HHS | hhs.gov/about/budget/index.html | CMS, CDC, NIH programs |
| DOD | comptroller.defense.gov/Budget-Materials/ | Procurement, RDT&E |
| VA | va.gov/budget/products.asp | EHRM, IT Modernization |
| GSA | gsa.gov/reference/reports/budget-performance | TMF, Shared Services |

**What CBJs Reveal:**
- New program initiatives with funding
- IT modernization priorities
- Contract support requirements
- Staffing vs. contractor ratios
- Multi-year procurement plans

**Implementation:**
- Scrape PDFs annually (budget season: Feb-May)
- Extract program names, dollar amounts, NAICS-relevant keywords
- Store in `budget_program_forecasts` table
- Match to user NAICS profiles

---

### Tier 3: Agency Strategic Plans & IT Portfolios

**Source:** IT Dashboard, Agency Strategic Plans

| Source | URL | Data |
|--------|-----|------|
| IT Dashboard | itdashboard.gov | Major IT investments by agency |
| FITARA Scores | oversight.house.gov | Agency IT health |
| Agency Strategic Plans | {agency}.gov/strategic-plan | 4-year priorities |
| CPIC Data | cio.gov | Capital planning investments |

**GovTribe FY2026 IT Budget Breakdown** (Reference):
- DOD: Largest IT spender
- DHS: Cybersecurity focus
- HHS: Healthcare IT modernization
- VA: EHRM (Electronic Health Record Modernization)

**Key Insight:** $100B+ annual federal IT spend, 80% on legacy maintenance = massive modernization opportunity

---

### Tier 4: Pre-Award Signals

**Source:** SAM.gov, Agency Portals

| Signal | Meaning | Lead Time |
|--------|---------|-----------|
| Sources Sought | Agency researching market | 3-6 months |
| RFI | Requirements gathering | 2-4 months |
| Draft RFP | Near-final requirements | 1-2 months |
| Industry Day | Solicitation imminent | 1-3 months |
| Pre-solicitation | Coming soon | 30-60 days |

**We already capture this** via SAM.gov MCP with notice types: `['p', 'r', 'k', 'o', 's', 'i']`

---

### Tier 5: Agency Forecast Pages (Official)

| Agency | Forecast Tool | Notes |
|--------|---------------|-------|
| GSA | acquisitiongateway.gov/forecast | Centralized but incomplete |
| DHS | apfs-cloud.dhs.gov | DHS-specific |
| VA | va.gov/osdbu/forecast | Good data |
| Army | army.mil/smallbusiness/forecast | Army-specific |
| Navy | neco.navy.mil | Requires CAGE |
| Air Force | sbo.afmc.af.mil | AFMC only |

**Challenge:** No unified API. Must scrape each.

---

## Architecture

### Database Schema

```sql
-- Recompete tracking (from USASpending)
CREATE TABLE recompete_opportunities (
  id UUID PRIMARY KEY,
  contract_id TEXT NOT NULL,
  incumbent_name TEXT,
  incumbent_uei TEXT,
  awarding_agency TEXT,
  awarding_office TEXT,
  naics_code TEXT,
  psc_code TEXT,
  total_value DECIMAL,
  current_end_date DATE,
  estimated_recompete_date DATE, -- 12 months before end
  location_state TEXT,
  last_updated TIMESTAMPTZ,
  UNIQUE(contract_id)
);

-- Budget program forecasts (from CBJs)
CREATE TABLE budget_forecasts (
  id UUID PRIMARY KEY,
  agency TEXT NOT NULL,
  program_name TEXT NOT NULL,
  fiscal_year INT,
  requested_amount DECIMAL,
  description TEXT,
  keywords TEXT[], -- For NAICS matching
  source_url TEXT,
  extracted_date DATE
);

-- Agency official forecasts (scraped)
CREATE TABLE agency_forecasts (
  id UUID PRIMARY KEY,
  agency TEXT NOT NULL,
  title TEXT,
  description TEXT,
  naics_code TEXT,
  psc_code TEXT,
  estimated_value TEXT, -- Often ranges
  estimated_solicitation_date DATE,
  estimated_award_date DATE,
  set_aside TEXT,
  place_of_performance TEXT,
  source_url TEXT,
  scraped_date DATE
);

-- Unified forecast view
CREATE VIEW unified_forecasts AS
SELECT
  'recompete' as forecast_type,
  contract_id as source_id,
  incumbent_name || ' contract expiring' as title,
  awarding_agency as agency,
  naics_code,
  total_value as estimated_value,
  estimated_recompete_date as forecast_date
FROM recompete_opportunities
WHERE estimated_recompete_date > NOW()

UNION ALL

SELECT
  'budget_program' as forecast_type,
  id::text as source_id,
  program_name as title,
  agency,
  NULL as naics_code,
  requested_amount as estimated_value,
  make_date(fiscal_year, 10, 1) as forecast_date -- FY start
FROM budget_forecasts

UNION ALL

SELECT
  'official_forecast' as forecast_type,
  id::text as source_id,
  title,
  agency,
  naics_code,
  estimated_value::decimal,
  estimated_solicitation_date as forecast_date
FROM agency_forecasts;
```

### API Design

```
GET /api/forecasts
  ?naics=541512           # Filter by NAICS
  ?agency=DOD             # Filter by agency
  ?timeframe=12           # Months ahead (default 12)
  ?type=recompete         # recompete | budget | official | all
  ?minValue=1000000       # Minimum value filter
  ?state=FL               # Place of performance

Response:
{
  "forecasts": [
    {
      "type": "recompete",
      "title": "Booz Allen IT Support - VA expiring",
      "agency": "Veterans Affairs",
      "incumbent": "Booz Allen Hamilton",
      "naics": "541512",
      "value": 45000000,
      "forecastDate": "2027-03-15",
      "confidence": "high", // Based on contract end date
      "source": "USASpending contract data"
    },
    {
      "type": "budget_program",
      "title": "VA EHRM Phase 3 Expansion",
      "agency": "Veterans Affairs",
      "naics": null, // Match by keywords
      "value": 200000000,
      "forecastDate": "2026-10-01",
      "confidence": "medium", // Budget may change
      "source": "FY2026 Congressional Budget Justification"
    }
  ],
  "summary": {
    "totalForecasts": 47,
    "totalValue": 2100000000,
    "byType": { "recompete": 32, "budget": 10, "official": 5 },
    "byTimeframe": { "0-6mo": 12, "6-12mo": 20, "12-18mo": 15 }
  }
}
```

---

## Implementation Phases

### Phase 4a: Recompete Intelligence (Quick Win)
- [x] USASpending API already integrated
- [ ] Create `recompete_opportunities` table
- [ ] Nightly job to identify expiring contracts
- [ ] `/api/forecasts?type=recompete` endpoint
- [ ] Add to Daily Alerts matching

**Effort:** 1-2 days
**Value:** 85,000 predictable opportunities

### Phase 4b: Budget Intelligence
- [ ] Identify CBJ URLs for top 20 agencies
- [ ] PDF extraction pipeline (annual)
- [ ] Keyword-to-NAICS mapping
- [ ] `budget_forecasts` table
- [ ] Manual review/validation workflow

**Effort:** 1 week
**Value:** Early insight into new programs

### Phase 4c: Official Forecast Scraping
- [ ] Map agency forecast page structures
- [ ] Build scrapers for top 10 agencies
- [ ] Weekly scrape schedule
- [ ] `agency_forecasts` table
- [ ] Deduplication logic

**Effort:** 2-3 weeks
**Value:** Most accurate short-term forecasts

### Phase 4d: AI-Enhanced Prediction
- [ ] Train model on historical patterns
- [ ] Predict solicitation timing from signals
- [ ] Confidence scoring
- [ ] Anomaly detection (budget spikes, etc.)

**Effort:** Future
**Value:** Competitive moat

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Recompetes identified | 10,000+ per quarter |
| Budget programs tracked | 500+ across agencies |
| Forecast accuracy (30-day) | 70%+ |
| User engagement | 3x increase in tool usage |
| Lead time advantage | 6+ months before SAM.gov |

---

## References

- [USASpending API](https://api.usaspending.gov/)
- [GovInfo Budget Documents](https://www.govinfo.gov/app/collection/budget/2026)
- [GovTribe FY2026 IT Budget](https://resources.govtribe.com/fy-2026-it-budget-breakdown)
- [SAM.gov Contract Data](https://sam.gov/fpds)
- [Federal IT Dashboard](https://itdashboard.gov/)

---

*Last Updated: April 5, 2026*
