# Federal Market Intelligence System

> Modular intelligence platform for federal contractors

## Quick Reference

| Doc | Purpose |
|-----|---------|
| [Architecture](../federal-market-intelligence-architecture.md) | System overview, data flow |
| [Skills](./skills.md) | Slash commands for users |
| [Agents](./agents.md) | Background automation |
| [Plugins](./plugins.md) | External data connectors |
| [Tools](./tools.md) | MCP tools and API endpoints |
| [Budget Intel](./budget-intel.md) | Budget intelligence system |
| [Forecast Intel](./forecasts.md) | Procurement forecasts (Phase 1-4) |
| [Operations Automation](../automation/README.md) | Internal skills, tools, agents, and build plan |

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       USER INTERFACE                             │
│                                                                  │
│    Skills: /market-scan  /recompete-scan  /agency-intel         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INTELLIGENCE SYSTEMS                          │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Spending │ │ Agency   │ │ Event    │ │ Recompete│            │
│  │ Intel    │ │ Intel    │ │ Intel    │ │ Intel    │            │
│  │ ✅ LIVE  │ │ ✅ LIVE  │ │ ✅ LIVE  │ │ ✅ LIVE  │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                                                  │
│  ┌──────────┐ ┌──────────┐                                      │
│  │ Budget   │ │ Forecast │                                      │
│  │ Intel    │ │ Intel    │                                      │
│  │ ✅ LIVE  │ │ 🔧 P1    │ (9% coverage, building to 80%)       │
│  └──────────┘ └──────────┘                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AGENTS (Background)                         │
│                                                                  │
│  • Recompete Tracker (nightly)                                  │
│  • Forecast Scraper (weekly)                                    │
│  • Budget Intel (annual)                                        │
│  • Event Aggregator (weekly)                                    │
│  • Market Alert (daily)                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PLUGINS (Connectors)                        │
│                                                                  │
│  ✅ USASpending  ✅ SAM.gov  ✅ Grants.gov  ✅ Multisite        │
│  📋 Agency Scraper  📋 PDF Extractor  ✅ Stripe  ✅ Vimeo       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       TOOLS (58 Total)                           │
│                                                                  │
│  • 37 MCP Tools (SAM, USASpending, Grants, Multisite, etc.)     │
│  • 9 Internal APIs (market-scan, agency-sources, etc.)          │
│  • 8 Admin Endpoints (abuse, alerts, agents)                    │
│  • 4 Cron Jobs (alerts, briefings, sync)                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Status Summary

| System | API | Agent | Status |
|--------|-----|-------|--------|
| Spending Intelligence | `/api/market-scan` | - | ✅ Live |
| Agency Intelligence | `/api/agency-sources` | - | ✅ Live |
| Event Intelligence | `/api/federal-events` | Event Aggregator | ✅ Live |
| Recompete Intelligence | `/api/recompete` | `/api/admin/sync-recompete` | ✅ Live |
| Budget Intelligence | `/api/budget-intel` | Budget Intel Agent | ✅ Live |
| Forecast Intelligence | `/api/forecasts` | Forecast Scraper | 🔧 Phase 1 (9%) |
| Federation Layer | `/api/market-intelligence` | - | 📋 Planned |

---

## Build Priority

1. ~~**Recompete Intelligence** (2-3 days)~~ ✅ COMPLETE
   - Database migration + API + Sync Agent
   - Uses existing USASpending API
   - 9,481 contracts, $74.3T tracked

2. ~~**Budget Intelligence** (1 week)~~ ✅ COMPLETE
   - 250 agencies, 2,765 pain points, 2,500 priorities
   - NAICS mapping and opportunity predictions
   - Budget trends (surging/growing/stable/declining)

3. **Forecast Intelligence** (4 phases) 🔧 IN PROGRESS
   - Phase 1: DOE, NASA, DOJ (4,729 records, 9% coverage) ✅
   - Phase 2: GSA Acquisition Gateway (+8%)
   - Phase 3: VA, DHS, HHS, Treasury (+32%)
   - Phase 4: DOD multi-source (+40%)
   - Target: 80% federal spend coverage

4. **Federation Layer** (2 days)
   - After above systems exist
   - Unified query across all

---

## Quick Links

### Live Endpoints
- [Market Scan](https://tools.govcongiants.org/api/market-scan?naics=541512&state=FL)
- [Agency Sources](https://tools.govcongiants.org/api/agency-sources?list=true)
- [Federal Events](https://tools.govcongiants.org/api/federal-events?sources=true)
- [Recompete](https://tools.govcongiants.org/api/recompete?stats=true)
- [Budget Intel](https://tools.govcongiants.org/api/budget-intel?agency=DOD)
- [Forecasts](https://tools.govcongiants.org/api/forecasts) (Phase 1)
- [Forecasts Coverage](https://tools.govcongiants.org/api/forecasts?mode=coverage)

### Documentation
- [Federal Market Scanner PRD](../federal-market-scanner.md)
- [Budget Intelligence PRD](../PRD-budget-intelligence.md)
- [Forecast Intelligence PRD](../PRD-forecast-intelligence.md)
- [Architecture Overview](../federal-market-intelligence-architecture.md)

---

## Getting Started

### For Users
```bash
# Use skills in Claude Code
/market-scan 541512 FL
/agency-intel VA
/event-finder DOD --type=industry_day
/budget-intel DOD
/budget-intel 541512 --mode=opportunities
/forecasts 541512
/forecasts --mode=coverage
```

### For Developers
```bash
# Test live APIs
curl "https://tools.govcongiants.org/api/market-scan?naics=541512&state=FL"
curl "https://tools.govcongiants.org/api/agency-sources?agency=DOD"
curl "https://tools.govcongiants.org/api/federal-events?naics=541512"
curl "https://tools.govcongiants.org/api/recompete?stats=true"
curl "https://tools.govcongiants.org/api/budget-intel?agency=DOD"
curl "https://tools.govcongiants.org/api/budget-intel?naics=541512&mode=opportunities"
curl "https://tools.govcongiants.org/api/budget-intel?trend=surging"
curl "https://tools.govcongiants.org/api/forecasts?naics=541512"
curl "https://tools.govcongiants.org/api/forecasts?mode=coverage"
```

---

*Last Updated: April 5, 2026*
