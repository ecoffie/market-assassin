# PRD: Market Research Intelligence Integration

## Problem Statement

Federal contractors miss early positioning opportunities because they don't engage during the government's market research phase. According to GAO-15-8, companies that participate in Sources Sought, RFIs, and industry days have **75% higher win rates**.

Our briefings were focused on active solicitations and recompetes - missing the critical presolicitation window where requirements can be shaped.

## Solution: Market Research Framework Integration

Train all AI briefing models on GAO market research best practices to ensure recommendations prioritize early engagement opportunities.

---

## GAO Market Research Framework (GAO-15-8)

### The 4 Basic Market Research Elements

| Element | Description | Contractor Action |
|---------|-------------|-------------------|
| **Methods Used** | RFIs, Sources Sought, database searches, industry days | Know which channels the agency uses |
| **Timeframes** | When each method was employed | Understand procurement timeline |
| **Vendor Capability Analysis** | Assessment of market capabilities | Demonstrate your capabilities match |
| **Conclusion** | Decision based on analysis | Position before decision is made |

### Acquisition Timeline & Market Research Phases

```
PRESOLICITATION              PREAWARD                    POSTAWARD
(6-18 months out)            (RFP imminent)              (Contract awarded)
       │                           │                           │
       ▼                           ▼                           ▼
┌────────────────┐         ┌────────────────┐         ┌────────────────┐
│ Program Office │         │ Program +      │         │ Contracting    │
│                │         │ Contracting    │         │ Office         │
│ • Sources Sought│        │ • Draft RFP    │         │ • Task orders  │
│ • RFIs         │         │ • Industry Day │         │ • Price checks │
│ • Capability   │         │ • Final RFP    │         │               │
│   briefings    │         │                │         │               │
└────────────────┘         └────────────────┘         └────────────────┘
     ▲                           ▲
     │                           │
  SHAPE                       COMPETE
  REQUIREMENTS                FOR WIN
```

### Key Statistics

| Stat | Source | Application |
|------|--------|-------------|
| 75% of contracts with industry outreach receive multiple offers | GAO-15-8 | Prioritize early engagement |
| 9 of 12 contracts ($10M+) with RFI/industry day got multiple bids | GAO-15-8 | Emphasize RFI response |
| 48 hours is optimal RFI response window | Industry practice | Create urgency in recommendations |
| 6-18 months is prime positioning window | FAR Part 10 | Focus weekly brief on this timeline |

---

## Implementation Summary

### Files Modified

| File | Changes |
|------|---------|
| `docs/govcon-market-research.md` | **NEW** - Complete framework reference |
| `src/lib/briefings/delivery/ai-briefing-generator.ts` | Added market research context to SYSTEM_PROMPT |
| `src/lib/briefings/delivery/weekly-briefing-generator.ts` | Added presolicitation phase focus |
| `src/lib/briefings/delivery/pursuit-brief-generator.ts` | Added market research actions + scoring bonuses |

### AI Prompt Changes

#### Daily Brief (`ai-briefing-generator.ts`)

**Added context:**
```
MARKET RESEARCH CONTEXT (GAO-15-8):
Federal agencies conduct market research in 3 phases:
1. PRESOLICITATION: Sources Sought, RFIs - before developing requirements
2. PREAWARD: Industry days, capability briefings - before soliciting offers
3. POSTAWARD: Price reasonableness for task orders

KEY INSIGHT: Companies that engage early (respond to RFIs, attend industry days)
have 75% higher win rates.
```

**New ranking criteria:**
1. Active Sources Sought/RFI (market research window open)
2. Industry day scheduled
3. Active solicitation
4. Incumbent vulnerability
5. Large value
6. Timeline clarity
7. NAICS match

#### Weekly Deep Dive (`weekly-briefing-generator.ts`)

**Focus shift:** Contracts ENTERING market research phase (6-18 months out)

**New calendar items:**
- Sources Sought response deadlines
- Industry day dates
- Capability briefing windows

**New recommendations per opportunity:**
- "Respond to Sources Sought by [date]"
- "Monitor for industry day announcement"
- "Request capability briefing with [agency] PM"

#### Pursuit Brief (`pursuit-brief-generator.ts`)

**New scoring bonuses:**
- +10 if Sources Sought/RFI still open
- +5 if industry day scheduled
- +5 if contract in market research phase

**5-day action plan now starts with:**
1. Day 1: Respond to Sources Sought/RFI if active
2. Day 2: Draft teaming outreach to 3 potential primes
3. Day 3: Request capability briefing with PM
4. Day 4: Research incumbent contract performance
5. Day 5: Bid/No-Bid decision meeting

---

## Contractor Best Practices (for AI to recommend)

### Early Engagement Actions

| Action | Timing | Impact |
|--------|--------|--------|
| Respond to Sources Sought | Within 48 hours | Shape requirements |
| Attend industry days | All scheduled events | Build relationships |
| Request capability briefings | 6-12 months before RFP | Get on PM's radar |
| Monitor acquisitiongateway.gov | Weekly | Catch forecasts early |

### RFI Response Template (AI should reference)

```
SECTION 1: Company Overview
- Name, UEI, CAGE, Size Status
- Primary NAICS codes
- Certifications (8(a), SDVOSB, WOSB, HUBZone)

SECTION 2: Relevant Experience
- 3 similar contracts (agency, scope, value, dates)
- Key differentiators

SECTION 3: Technical Approach
- How you would address the requirement
- Unique capabilities or solutions

SECTION 4: Teaming
- Prime/sub partnerships in place
- Gap-filling strategy
```

### Industry Day Checklist (AI should recommend)

- [ ] Research the program and incumbent beforehand
- [ ] Prepare 3 specific questions about requirements
- [ ] Bring updated capability statement
- [ ] Identify teaming targets who will attend
- [ ] Plan follow-up within 48 hours

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| % of briefs mentioning Sources Sought | >30% | Content analysis |
| % of opportunities with market research phase noted | >50% | Brief audit |
| User engagement with early-stage opps | Track clicks | Link analytics |
| Win rate improvement | Baseline + 10% | User surveys |

---

## Future Enhancements

### Phase 2: Automated Market Research Tracking

- [ ] Monitor SAM.gov for Sources Sought notices matching user NAICS
- [ ] Track agency forecasts on acquisitiongateway.gov
- [ ] Alert users when industry days are announced
- [ ] Auto-generate RFI response drafts

### Phase 3: Market Research Calendar

- [ ] Unified calendar view of all market research deadlines
- [ ] Push notifications for 48-hour RFI windows
- [ ] Integration with user's calendar (Google, Outlook)

### Phase 4: Competitive Intelligence

- [ ] Track which competitors respond to Sources Sought
- [ ] Identify teaming opportunities based on RFI responses
- [ ] Monitor industry day attendance patterns

---

## Reference Documents

| Document | Purpose |
|----------|---------|
| `docs/govcon-market-research.md` | Full framework reference for AI |
| GAO-15-8 | Source report on market research practices |
| FAR Part 10 | Federal acquisition regulation on market research |
| `docs/PRD-briefing-rubric.md` | Briefing content structure |

---

*Created: April 3, 2026*
*Status: IMPLEMENTED*
*Source: GAO-15-8 "Market Research: Better Documentation Needed to Inform Future Procurements at Selected Agencies" (October 2014)*
