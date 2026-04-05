# Federal Market Scanner

> Master Reference Document - The "Brain" of Market Intelligence

## Purpose

Complete market visibility for federal contractors beyond SAM.gov. The Federal Market Scanner solves the **85% visibility gap** - the fact that most federal spending never appears as a solicitation on SAM.gov.

## Value Proposition

| Problem | Scanner Solution |
|---------|------------------|
| 85% of spending not on SAM.gov | Backwards from USASpending data |
| Scattered across 20+ portals | Unified view from all sources |
| Miss recompete opportunities | 12-month expiration tracking |
| Don't know what events matter | Targeted event discovery |
| Competitors win before you see it | Early warning intelligence |

## Core Philosophy: Backwards from Money

Instead of scraping opportunity portals (reactive), we start with **where money actually flows** (proactive):

```
Traditional Approach:
  SAM.gov → Find Opportunity → Hope it fits

Scanner Approach:
  USASpending (who's buying) →
  Identify Agencies →
  Find their portals/events →
  Target before solicitation
```

---

## Data Sources

### Tier 1: Spending Intelligence (Primary)

| Source | Type | Coverage | Update | MCP Tool |
|--------|------|----------|--------|----------|
| USASpending | Awards | $7.5T historical | Daily | `usaspending-mcp` |
| SAM.gov | Opportunities | Active solicitations | Real-time | `samgov-mcp` |
| Acquisition Gateway | Forecasts | Planned procurements | Weekly | `samgov-mcp` |

### Tier 2: Expanded Opportunities

| Source | Type | Coverage | Update | MCP Tool |
|--------|------|----------|--------|----------|
| Grants.gov | Grants | $700B/year | Daily | `grantsgov-mcp` |
| NIH RePORTER | SBIR/STTR | $45B research | Daily | `multisite-mcp` |
| SBIR.gov | Small Business R&D | Cross-agency | Weekly | Future |

### Tier 3: Events & Intelligence

| Source | Type | Coverage | Update | Tool |
|--------|------|----------|--------|------|
| Agency Calendars | Industry Days | All agencies | Weekly | Event Aggregator |
| GSA Events | Conferences | GSA-hosted | Monthly | Event Aggregator |
| SBA Events | Small Business | Regional | Weekly | Event Aggregator |

### Explicitly Excluded

| Source | Reason |
|--------|--------|
| DLA DIBBS | Product-specific (commodities) |
| Navy NECO | Requires CAGE, product-specific |
| Unison | Reverse auctions, short windows |
| IDIQ Portals (CHESS, SeaPort, etc.) | Can't bid without vehicle |

---

## User Journey

### Step 1: Profile Input
User provides:
- Primary NAICS code(s)
- State/Region
- Agency preferences (optional)
- Set-aside eligibility (8(a), WOSB, SDVOSB, HUBZone)

### Step 2: Spending Analysis
Scanner queries USASpending:
- 3-year historical spending for NAICS
- Top agencies by spend volume
- Geographic distribution
- Seasonal patterns

### Step 3: Visibility Gap Calculation
Compare:
- Total spending (USASpending)
- vs. SAM.gov opportunities posted
- = Gap percentage (typically 70-90%)

### Step 4: Source Identification
For each high-spend agency:
- Where do they post? (SAM, grants.gov, agency portal)
- What forecasts exist?
- What contracts are expiring (recompetes)?

### Step 5: Event Discovery
Find relevant:
- Industry days
- Pre-solicitation conferences
- Matchmaking events
- PTAC workshops

### Step 6: Intelligence Delivery
Output:
- Market scan report
- Visibility gap analysis
- Upcoming opportunities (forecasts + recompetes)
- Event calendar
- Recommended actions

---

## Components

### Skills (Slash Commands)

| Skill | Purpose | Inputs |
|-------|---------|--------|
| `/market-scan` | Full market analysis | NAICS, state |
| `/visibility-gap` | SAM vs spending comparison | NAICS |
| `/recompete-analysis` | Expiring contract tracking | NAICS, agency |
| `/competitor-profile` | Competitor intelligence | Company name/UEI |
| `/event-discovery` | Relevant events | NAICS, state, date range |
| `/forecast-scan` | Upcoming procurements | NAICS, agency |

### Tools (MCP Servers)

| Tool | Status | Purpose |
|------|--------|---------|
| `samgov-mcp` | ✅ Active | Opportunities, entities, forecasts |
| `grantsgov-mcp` | ✅ Active | Grant opportunities |
| `multisite-mcp` | ✅ Active | NIH, aggregated sources |
| `usaspending-mcp` | ✅ Active | Spending data, awards |
| `/api/agency-sources` | ✅ Active | Agency procurement sources |
| `/api/federal-events` | ✅ Active | Federal events aggregator |
| `recompete-tracker` | To Build | Expiration monitoring |

### Agents (Autonomous Workflows)

| Agent | Purpose | Trigger |
|-------|---------|---------|
| Market Scanner | Full analysis with decisions | User request, weekly schedule |
| Recompete Alert | Expiration monitoring | Daily scan, 6-month threshold |
| Event Discovery | Event matching | Weekly scan |
| Competitive Intel | Competitor tracking | User request, award alerts |
| Visibility Gap | Gap analysis | Market scan sub-task |

---

## Integration Points

### Existing Products

| Product | Integration |
|---------|-------------|
| Market Assassin Pro ($29/mo) | Scanner powers market analysis |
| Market Intelligence ($49/mo) | Scanner feeds daily/weekly briefs |
| Daily Alerts ($19/mo) | Scanner expands opportunity sources |

### Data Flow

```
USASpending API
     │
     ▼
┌─────────────────┐
│ Federal Market  │──────► Daily Alerts
│    Scanner      │──────► Weekly Deep Dive
│   (Backend)     │──────► Pursuit Briefs
└─────────────────┘──────► Market Assassin Reports
     │
     ├── samgov-mcp
     ├── grantsgov-mcp
     ├── multisite-mcp (NIH, etc.)
     └── event-aggregator
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `aggregated_opportunities` | Normalized opps from all sources |
| `spending_cache` | USASpending query cache (24hr) |
| `recompete_tracking` | Monitored expiring contracts |
| `event_calendar` | Aggregated federal events |
| `visibility_gaps` | Cached gap analyses |

---

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Sources integrated | 10+ | 7 (SAM, Grants, NIH, Forecasts, USASpending, Agency Sources, Events) |
| Visibility gap calculation | < 5 sec | TBD |
| Recompete tracking accuracy | > 95% | TBD |
| Event coverage | Major agencies | TBD |
| User satisfaction (NPS) | > 50 | TBD |

---

## Build Priority

### Phase 1: Foundation ✅ COMPLETE
- [x] NIH RePORTER integration
- [x] Multisite pipeline
- [x] USASpending MCP configuration
- [x] Spending analysis skill (`/api/market-scan`)
- [x] Visibility gap calculation (built into market-scan)

**API Endpoint:** `GET /api/market-scan?naics={code}&state={state}`

**Example Response:**
```json
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

### Phase 2: Agency Source Mapping ✅ COMPLETE
- [x] Visibility gap calculation (in market-scan)
- [x] Agency source mapping (`/api/agency-sources`)
- [ ] Recompete tracker enhancement

**API Endpoint:** `GET /api/agency-sources?agency={abbrev}`

**Features:**
- 21 federal agencies with procurement patterns
- Spending breakdown (SAM vs hidden market)
- Top vehicles (OASIS+, Alliant 3, SeaPort-NxG, etc.)
- Secondary sources (DLA DIBBS, agency portals)
- Actionable recommendations

**Example:** `?agency=DOD` returns 85% hidden market, GSA Schedule tips, vehicle list

### Phase 3: Event Aggregator ✅ COMPLETE
- [x] Event aggregator (`/api/federal-events`)
- [ ] Competitor profiling
- [ ] Market Scanner agent

**API Endpoint:** `GET /api/federal-events?naics={code}` or `?agency={abbrev}`

**Features:**
- 15 event sources (GSA Interact, SBA, PTAC, agency OSDBUs)
- 7 event categories (industry_day, matchmaking, training, etc.)
- 5 major annual conferences
- NAICS-to-agency mapping for relevant events
- Recommendations by contractor stage

**Example:** `?naics=541512` returns 10 sources for DOD, VA, DHS, NASA

### Phase 4: Automation
- [ ] Weekly market scans (scheduled)
- [ ] Recompete alerts
- [ ] Event notifications

---

## Related Documentation

| Doc | Purpose |
|-----|---------|
| `docs/data-flow-architecture.md` | Component connections |
| `docs/tool-interfaces/*.md` | MCP tool specifications |
| `~/.claude/skill-specs/*.md` | Skill definitions |
| `docs/agent-specs/*.md` | Agent orchestration |
| `docs/protocols/*.md` | Communication patterns |
| `docs/component-registry.md` | Index of all components |

---

*Last Updated: April 5, 2026*
