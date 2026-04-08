# Forecast Intelligence System

> Early-warning procurement forecasts from federal agencies 6-18 months before solicitations

## Overview

Forecast Intelligence aggregates procurement forecasts from federal agency websites, providing advance notice of upcoming opportunities. Unlike SAM.gov (active solicitations) or USASpending (historical awards), forecasts reveal what agencies **plan to buy** before RFPs are released.

---

## Current Coverage

| Phase | Status | Agencies | Records | Spend Coverage |
|-------|--------|----------|---------|----------------|
| **Phase 1** | ✅ Active | DOE, NASA, DOJ | 4,729 | 9% |
| **Phase 2** | 📋 Planned | GSA Acquisition Gateway | ~5,000 | +8% |
| **Phase 3** | 📋 Planned | VA, DHS, HHS, Treasury | ~10,000 | +32% |
| **Phase 4** | 📋 Planned | DOD (multi-source) | ~20,000 | +40% |
| **Target** | - | All CFO Act Agencies | 40,000+ | 80%+ |

---

## Data Sources

### Phase 1: Direct Excel Downloads (Active)

| Agency | URL | Records | Format |
|--------|-----|---------|--------|
| DOE | energy.gov/management/doe-forecast-opportunities | 834 | Excel |
| NASA | hq.nasa.gov/office/procurement/forecast/Agencyforecast.xlsx | 306 | Excel |
| DOJ | justice.gov/media/1381791/dl | 3,589 | Excel |

### Phase 2-4: Puppeteer Scrapers (Planned)

| Agency | URL | Approach |
|--------|-----|----------|
| GSA | acquisitiongateway.gov/forecast | Angular SPA export |
| VA | vendorportal.ecms.va.gov | Authenticated session |
| DHS | apfs-cloud.dhs.gov/forecast | Dynamic portal |
| HHS | procurementforecast.hhs.gov | SBCX portal |
| Treasury | osdbu.forecast.treasury.gov | Angular SPA |
| DOD | Multiple service sites | Multi-source scraping |

---

## API Reference

### Base URL
```
https://tools.govcongiants.org/api/forecasts
```

### Endpoints

| Query | Purpose |
|-------|---------|
| `(no params)` | Summary stats |
| `?naics=541512` | By NAICS code (prefix or exact) |
| `?agency=DOE` | By source agency |
| `?state=FL` | By place of performance |
| `?setAside=8(a)` | By set-aside type |
| `?fiscalYear=FY2026` | By fiscal year |
| `?search=cybersecurity` | Full text search |
| `?mode=coverage` | Coverage dashboard |
| `?mode=sources` | Source health status |

### Example: NAICS Query

```bash
curl "https://tools.govcongiants.org/api/forecasts?naics=541512"
```

**Response:**
```json
{
  "success": true,
  "query": { "naics": "541512" },
  "pagination": { "total": 437, "limit": 50, "offset": 0 },
  "forecasts": [
    {
      "id": "uuid",
      "title": "IT Systems Support Services",
      "agency": "DOJ",
      "naics": "541512",
      "fiscalYear": "FY2026",
      "quarter": "Q2",
      "valueRange": "$5M - $25M",
      "setAside": "8(a)",
      "incumbent": "ABC Corp",
      "status": "forecast"
    }
  ],
  "aggregations": {
    "bySetAside": [
      { "type": "Small Business", "count": 156 },
      { "type": "8(a)", "count": 89 }
    ],
    "byAgency": [
      { "agency": "DOJ", "count": 198 },
      { "agency": "DOE", "count": 153 }
    ]
  }
}
```

### Example: Coverage Dashboard

```bash
curl "https://tools.govcongiants.org/api/forecasts?mode=coverage"
```

**Response:**
```json
{
  "success": true,
  "mode": "coverage",
  "summary": {
    "totalSources": 11,
    "activeSources": 3,
    "totalRecords": 4729,
    "estimatedSpendCoverage": "9.0%",
    "targetCoverage": "80%",
    "gap": "71.0%"
  },
  "phases": {
    "phase1": { "status": "active", "sources": ["DOE", "NASA", "DOJ"] },
    "phase2": { "status": "planned", "sources": ["GSA"] },
    "phase3": { "status": "planned", "sources": ["VA", "DHS", "HHS", "Treasury"] },
    "phase4": { "status": "planned", "sources": ["DOD"] }
  }
}
```

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `agency_forecasts` | Main forecast data (unified schema) |
| `forecast_sync_runs` | Sync operation tracking |
| `forecast_sources` | Source configuration and health |

### Views

| View | Purpose |
|------|---------|
| `forecast_coverage_dashboard` | Coverage and health overview |
| `forecasts_by_naics` | Aggregated by NAICS code |

### Key Fields in `agency_forecasts`

| Field | Type | Description |
|-------|------|-------------|
| source_agency | TEXT | DOE, NASA, DOJ, etc. |
| external_id | TEXT | Agency's tracking number |
| title | TEXT | Opportunity title |
| naics_code | TEXT | NAICS code |
| psc_code | TEXT | Product Service Code |
| fiscal_year | TEXT | FY2026, FY2027 |
| anticipated_quarter | TEXT | Q1, Q2, Q3, Q4 |
| estimated_value_min | BIGINT | Min value in dollars |
| estimated_value_max | BIGINT | Max value in dollars |
| set_aside_type | TEXT | 8(a), SDVOSB, etc. |
| incumbent_name | TEXT | Current contractor |
| pop_state | TEXT | Place of performance |
| status | TEXT | forecast, pre-sol, etc. |

---

## Slash Command

```bash
/forecasts                          # Summary stats
/forecasts 541512                   # IT services forecasts
/forecasts DOE                      # All DOE forecasts
/forecasts cybersecurity            # Search term
/forecasts 541512 --setAside=8(a)   # With filters
/forecasts --mode=coverage          # Coverage dashboard
```

---

## Sync Automation

### Manual Import
```bash
node scripts/import-forecasts.js              # Import all
node scripts/import-forecasts.js --source=DOE # Specific source
node scripts/import-forecasts.js --dry-run    # Preview only
```

### Cron Schedule (Planned)
```
Weekly: Sunday 2 AM UTC
  - Download fresh Excel files from DOE, NASA, DOJ
  - Parse and upsert to database
  - Update source stats
  - Log sync run results
```

---

## Integration Points

### Daily Briefings
```typescript
// Include upcoming forecasts in briefings
const forecasts = await fetchForecasts({ naics: profile.naicsCodes });
briefing.upcomingForecasts = forecasts.slice(0, 5);
```

### Market Scan
```typescript
// Add forecast context to market analysis
const forecastContext = await getForecasts({ naics, state });
return {
  ...currentOpportunities,
  upcomingForecasts: forecastContext.forecasts,
  coverage: forecastContext.coverage
};
```

### Federation Layer
```typescript
// /api/market-intelligence unified response
{
  "spending": { ... },
  "recompetes": { ... },
  "forecasts": {
    "upcoming": [...],
    "coverage": "9%",
    "topAgencies": [...]
  }
}
```

---

## Files

| File | Purpose |
|------|---------|
| `src/app/api/forecasts/route.ts` | API endpoint |
| `scripts/import-forecasts.js` | Import script (Phase 1) |
| `supabase/migrations/20260405_forecast_intelligence.sql` | Schema |
| `~/.claude/commands/forecasts.md` | Slash command |
| `docs/intelligence-systems/forecasts.md` | This documentation |

---

## Roadmap

### Phase 1 (Complete)
- [x] Database schema designed for scale
- [x] Unified parser for DOE, NASA, DOJ
- [x] API endpoint with filtering
- [x] Slash command
- [x] Documentation

### Phase 2 (Next)
- [ ] Puppeteer scraper for GSA Acquisition Gateway
- [ ] Handle Angular SPA pagination
- [ ] CSV export parsing

### Phase 3
- [ ] VA Vendor Portal scraper (requires auth)
- [ ] DHS APFS scraper
- [ ] HHS SBCX scraper
- [ ] Treasury Dynamic Forecast scraper

### Phase 4
- [ ] DOD multi-source strategy
- [ ] Army, Navy, Air Force individual scrapers
- [ ] Defense agency scrapers (DLA, DISA, DARPA)

### Automation
- [ ] Weekly cron job for Excel sources
- [ ] Health monitoring and alerts
- [ ] Automatic retry on failures

---

*Last Updated: April 5, 2026*
