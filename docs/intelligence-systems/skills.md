# Intelligence System Skills

> Slash commands that invoke intelligence system capabilities

## Overview

Skills are user-facing commands that orchestrate intelligence gathering across multiple systems. Each skill produces actionable output for federal contractors.

---

## Skill 1: `/market-scan`

### Purpose
Full market analysis for a NAICS code and location.

### Invokes
- Spending Intelligence API
- Agency Intelligence API
- Active opportunities (SAM.gov)

### Input
```
/market-scan 541512 FL
/market-scan 238220 GA --set-aside=SDVOSB
```

### Parameters
| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| naics | Yes | - | NAICS code (3-6 digits) |
| state | No | All | State code |
| set-aside | No | All | SBA, 8A, WOSB, SDVOSB, HUBZone |
| timeframe | No | 3 | Years of spending history |

### Output
```markdown
## Market Scan: NAICS 541512 in Florida

### Spending Analysis (3 Years)
- **Total Spending:** $13.4B
- **Visibility Gap:** 85% (only 15% posted on SAM.gov)
- **Market Type:** Robust

### Top Agencies
1. DOD - $5.2B (39%)
2. VA - $2.1B (16%)
3. DHS - $1.8B (13%)

### Active Opportunities
- SAM.gov: 23 active
- Grants.gov: 5 relevant
- Sources Sought: 8 open

### Recommendations
- Get on GSA Schedule (40% of VA spend)
- Target OASIS+ for DOD
- Attend VA Tampa Industry Day (May 15)
```

### Implementation
```typescript
// ~/.claude/commands/market-scan.md
---
description: Full market analysis for NAICS and location
arguments:
  - name: naics
    description: NAICS code
    required: true
  - name: state
    description: State code
    required: false
---

Perform a comprehensive market scan for NAICS $ARGUMENTS.naics in state $ARGUMENTS.state.

1. Query /api/market-scan for spending data
2. Query /api/agency-sources for agency intelligence
3. Query /api/federal-events for relevant events
4. Synthesize into actionable recommendations
```

---

## Skill 2: `/recompete-scan`

### Purpose
Find expiring contracts matching user profile.

### Invokes
- Recompete Intelligence API
- Agency Intelligence API

### Input
```
/recompete-scan 541512 FL
/recompete-scan 541512 --months=12 --min-value=1000000
```

### Parameters
| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| naics | Yes | - | NAICS code |
| state | No | All | State filter |
| months | No | 18 | Months ahead to scan |
| min-value | No | 0 | Minimum contract value |

### Output
```markdown
## Recompete Opportunities: NAICS 541512

### Summary
- **Contracts Expiring:** 47 in next 18 months
- **Total Value:** $892M
- **Top Incumbents:** Booz Allen (8), SAIC (6), Leidos (5)

### High-Value Targets (>$10M)
| Incumbent | Agency | Value | Expires | Lead Time |
|-----------|--------|-------|---------|-----------|
| Booz Allen | VA | $45M | Mar 2027 | 11 mo |
| SAIC | DHS | $32M | Jun 2027 | 14 mo |

### Recommended Actions
1. Contact Booz Allen re: VA recompete (11 months out)
2. Research SAIC's DHS incumbent performance
3. Attend VA industry day for teaming opportunities
```

---

## Skill 3: `/agency-intel`

### Purpose
Deep dive on a specific agency's procurement patterns.

### Invokes
- Agency Intelligence API
- Budget Intelligence API (future)
- Event Intelligence API

### Input
```
/agency-intel VA
/agency-intel "Department of Defense" --focus=vehicles
```

### Parameters
| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| agency | Yes | - | Agency name or abbreviation |
| focus | No | all | vehicles, pain-points, spending, events |

### Output
```markdown
## Agency Intelligence: Department of Veterans Affairs

### Procurement Profile
- **Hidden Market:** 78% (only 22% on SAM.gov)
- **Primary Method:** GSA Schedule (40%)
- **Top Vehicles:** T4NG2, VETS 2, CIO-SP4

### Spending Breakdown
| Channel | Percentage |
|---------|------------|
| GSA Schedule | 40% |
| IDIQ Vehicles | 30% |
| SAM.gov Posted | 22% |
| Direct Awards | 8% |

### Pain Points
1. Legacy system integration
2. EHRM implementation delays
3. Cybersecurity compliance
4. Veteran health data management

### Priorities (FY2026)
1. Electronic Health Record Modernization
2. Zero Trust Architecture
3. Telehealth expansion

### Upcoming Events
- VA Tampa Industry Day - May 15
- VA Innovation Challenge - June 2026
- VETS 2 Vendor Forum - Q3 2026

### Recommendations
- Get on GSA Schedule (required for 40% of spend)
- Pursue T4NG2 position for IT services
- Focus proposals on EHRM integration experience
```

---

## Skill 4: `/event-finder`

### Purpose
Find relevant networking and procurement events.

### Invokes
- Event Intelligence API
- Agency Intelligence API (for agency mapping)

### Input
```
/event-finder 541512
/event-finder DOD --type=industry_day
/event-finder --state=FL --months=3
```

### Parameters
| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| naics | No | - | Filter by NAICS relevance |
| agency | No | - | Filter by agency |
| type | No | all | industry_day, matchmaking, training, conference |
| state | No | - | Geographic filter |
| months | No | 6 | Timeframe ahead |

### Output
```markdown
## Upcoming Events for NAICS 541512

### Industry Days (High Value)
| Event | Agency | Date | Location | Register |
|-------|--------|------|----------|----------|
| VA Tampa Industry Day | VA | May 15 | Tampa, FL | [Link] |
| CISA Cyber Summit | DHS | Jun 3 | DC | [Link] |

### Matchmaking Events
- SBA Matchmaker - June 10 (Virtual)
- Georgia APEX Matchmaking - April 22 (Atlanta)

### Training (Free)
- APEX Accelerator: Proposal Writing - May 1
- SBA: Understanding Set-Asides - May 8

### Major Conferences
| Conference | Date | Cost | Value |
|------------|------|------|-------|
| AFCEA West | Feb 2027 | $500 | Very High |
| NDIA Annual | Nov 2026 | $400 | High |

### Recommendations
1. VA Tampa Industry Day is highest priority (your NAICS)
2. Register for APEX training (free, builds capability)
3. Consider AFCEA West for DOD networking
```

---

## Skill 5: `/forecast-scan`

### Purpose
Find forecasted/planned procurements before solicitation.

### Invokes
- Forecast Intelligence API
- Budget Intelligence API
- Recompete Intelligence API

### Input
```
/forecast-scan 541512
/forecast-scan DOE --type=budget
/forecast-scan VA --timeframe=FY2027
```

### Parameters
| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| naics | No | - | NAICS filter |
| agency | No | - | Agency filter |
| type | No | all | official, budget, recompete |
| timeframe | No | 12mo | Forecast horizon |

### Output
```markdown
## Forecast Intelligence: NAICS 541512

### Official Agency Forecasts (15 found)
| Title | Agency | Est. Value | Sol. Date | Set-Aside |
|-------|--------|------------|-----------|-----------|
| Cyber Operations Support | DHS/CISA | $50-100M | Q3 2026 | Full & Open |
| IT Modernization | VA | $25M | Q4 2026 | SDVOSB |

### Budget Signals (FY2026 CBJ)
| Program | Agency | Funding | Relevance |
|---------|--------|---------|-----------|
| EHRM Phase 3 | VA | $200M | High |
| Zero Trust Implementation | DOD | $150M | Medium |

### Recompete Pipeline (18 months)
| Incumbent | Contract | Expires | Value |
|-----------|----------|---------|-------|
| Booz Allen | VA IT Support | Mar 2027 | $45M |

### Total Forecast Value: $520M across 32 opportunities

### Recommended Actions
1. Position for DHS/CISA Cyber Ops (Q3 solicitation)
2. Build VA EHRM experience now
3. Contact Booz Allen re: VA recompete teaming
```

---

## Skill 6: `/intel-brief`

### Purpose
Generate comprehensive market intelligence briefing.

### Invokes
All intelligence systems via federation layer.

### Input
```
/intel-brief 541512 FL
/intel-brief --profile (uses saved user profile)
```

### Output
Generates a full market intelligence briefing combining all systems:
- Spending analysis
- Agency intelligence
- Recompete opportunities
- Forecasts
- Events
- Recommendations

---

## Skill Registry

| Skill | Status | Dependencies | Effort |
|-------|--------|--------------|--------|
| `/market-scan` | ✅ Live | market-scan API | Done |
| `/agency-intel` | ✅ Live | agency-sources API | Done |
| `/event-finder` | ✅ Live | federal-events API | Done |
| `/recompete-scan` | 📋 Planned | recompete API | 2 days |
| `/forecast-scan` | 📋 Planned | forecast API, budget API | 1 week |
| `/intel-brief` | 📋 Planned | Federation layer | 3 days |

---

*Last Updated: April 5, 2026*
