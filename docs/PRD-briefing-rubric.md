# PRD: Briefing Content Rubric

## Problem Statement

Currently Daily Brief and Weekly Deep Dive use the same USASpending data with different prompt depths. This creates:
1. Overlapping content between the two briefings
2. No clear distinction in VALUE to the user
3. Missing connection to what they can ACT ON NOW (SAM.gov solicitations)

## Proposed Solution

### Clear Content Split

| Briefing | Data Source | Purpose | User Action |
|----------|-------------|---------|-------------|
| **Daily Brief** | SAM.gov Opportunities API | Active solicitations matching user's NAICS | Bid NOW - deadlines matter |
| **Weekly Deep Dive** | USASpending API | Recompete intel on expiring contracts | Position for FUTURE bids |
| **Pursuit Brief** | Combined | Top targets with full capture strategy | Strategic planning |

---

## Daily Brief Rubric

### Data Source
- **Primary:** SAM.gov Opportunities API (`mcp__samgov__search_opportunities`)
- **Filter:** User's NAICS codes, posted in last 7 days
- **Enrichment:** Add incumbent info from USASpending if available

### Content Structure
```
NOTICE TYPE SUMMARY (Top 10 Active)
- RFP count, RFQ count, Sources Sought count, etc.
- Quick glance at opportunity types in today's brief

TOP 5 ACTIVE OPPORTUNITIES

For each:
- Title, Agency, NAICS, Set-Aside
- Notice Type Badge (RFP/RFQ/Sources Sought/Pre-Sol/Combined/Other)
- Posted Date (when released)
- Response Deadline (DAYS REMAINING)
- Estimated Value
- Incumbent (if recompete) - from USASpending lookup
- Quick Win Assessment: Why this is winnable for YOU
- SAM.gov Link (direct to opportunity)

TEAMING PLAYS (2)
- Based on active opps that need teaming

DEADLINES THIS WEEK
- Calendar view of response dates with notice type labels
```

### Selection Criteria (Ranked)
1. **Response deadline within 30 days** (urgency)
2. **Matches user's NAICS exactly** (relevance)
3. **Set-aside matches user's business type** (eligibility)
4. **Value $100K - $50M** (sweet spot for small/mid business)
5. **Has incumbent data** (displacement opportunity)

### What Makes It Valuable
- These are LIVE opportunities they can bid on TODAY
- Deadlines create urgency
- Direct links to SAM.gov to take action

---

## Weekly Deep Dive Rubric

### Data Source
- **Primary:** USASpending API (expiring contracts)
- **Filter:** User's NAICS, contracts ending in 6-18 months
- **Enrichment:** SAM.gov check for pre-solicitation activity

### Content Structure
```
RECOMPETE PIPELINE (6-8 opportunities)

For each:
- Contract Name, Agency, Incumbent
- Current Contract Value
- Contract End Date
- Competitive Landscape (bid history, incumbent tenure)
- Key Dates (estimated RFP, industry day, etc.)
- Displacement Angle (why incumbent is vulnerable)
- Recommended Approach (capture strategy)
- SAM.gov Status: "No activity yet" | "Sources Sought posted" | "RFP expected Q2"

MARKET SIGNALS (4)
- Trends affecting these opportunities

UPCOMING CALENDAR
- Estimated milestones for tracked opportunities

TEAMING OPPORTUNITIES
- Which primes are likely bidding, how to approach
```

### Selection Criteria (Ranked)
1. **Contract ends in 6-18 months** (actionable timeline)
2. **Multiple extensions or bridge** (procurement fatigue)
3. **Low historical competition** (<5 bidders)
4. **Incumbent vulnerability signals** (M&A, performance issues)
5. **Matches user capability** (NAICS + set-aside)

### What Makes It Valuable
- Strategic positioning BEFORE the RFP drops
- Time to build relationships, teaming, capabilities
- Competitive intelligence on incumbents

---

## Pursuit Brief Rubric

### Data Source
- **Combined:** Top opportunities from both Daily and Weekly
- **Focus:** User's highest-probability wins

### Content Structure
```
YOUR TOP 3 PURSUIT TARGETS

For each:
- Full opportunity details
- Win Probability Score (with breakdown)
- Capture Strategy (detailed)
- Key Contacts to Engage
- Teaming Partners to Approach
- Timeline with Action Items
- Competitive Threat Assessment
```

### Selection Criteria
1. Win probability score (calculated from all factors)
2. User's capability match
3. Timeline alignment (can they realistically pursue)

---

## Implementation Plan

### Phase 1: Daily Brief Rewrite (Week 1)
- [ ] Switch Daily Brief to SAM.gov Opportunities API
- [ ] Add response deadline countdown
- [ ] Add direct SAM.gov links
- [ ] Test with Eric's NAICS codes

### Phase 2: Weekly Deep Dive Enhancement (Week 1-2)
- [ ] Keep USASpending as primary
- [ ] Add "SAM.gov Status" field for each opportunity
- [ ] Improve competitive landscape analysis
- [ ] Add estimated milestone dates

### Phase 3: Pursuit Brief Integration (Week 2)
- [ ] Combine best from both sources
- [ ] Implement win probability scoring display
- [ ] Add detailed capture strategies

### Phase 4: User Feedback Loop (Week 3+)
- [ ] Track which opportunities users engage with
- [ ] Improve ranking based on user behavior
- [ ] A/B test content formats

---

## Technical Requirements

### API Integration
```typescript
// Daily Brief - SAM.gov Opportunities
const dailyOpps = await searchSamOpportunities({
  naics: user.naicsCodes,
  postedFrom: sevenDaysAgo,
  limit: 20
});

// Weekly Brief - USASpending + SAM.gov enrichment
const weeklyRecompetes = await getExpiringContracts({
  naics: user.naicsCodes,
  endDateRange: '6-18 months'
});

// Enrich with SAM.gov status
for (const contract of weeklyRecompetes) {
  contract.samStatus = await checkSamForSolicitation(contract);
}
```

### SAM.gov Status Check
```typescript
async function checkSamForSolicitation(contract: Contract): Promise<SamStatus> {
  // Search SAM.gov for matching solicitations
  const matches = await searchSamOpportunities({
    keywords: contract.description,
    agency: contract.agency
  });

  if (matches.length === 0) return { status: 'no_activity', message: 'No solicitation posted yet' };
  if (matches[0].type === 'sources_sought') return { status: 'sources_sought', noticeId: matches[0].id };
  if (matches[0].type === 'presolicitation') return { status: 'presolicitation', noticeId: matches[0].id };
  if (matches[0].type === 'solicitation') return { status: 'active_rfp', noticeId: matches[0].id, deadline: matches[0].responseDeadline };
}
```

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Email open rate | >40% | Email tracking |
| Click-through to SAM.gov | >15% | Link tracking |
| User feedback score | >4.5/5 | Survey |
| Unsubscribe rate | <2% | Email metrics |

---

## Questions to Resolve

1. **How many Daily Alerts does user also receive?** Need to avoid overlap between Daily Alerts (existing) and Daily Brief (new SAM.gov based)
2. **Should Daily Brief replace Daily Alerts?** Or complement them?
3. **Frequency:** Daily Brief every day, Weekly on Mondays?

---

*Created: April 3, 2026*
*Updated: April 4, 2026*
*Status: IMPLEMENTED*

---

## April 4, 2026 Implementation

### Daily Brief Enhancements (Deployed)

1. **Notice Type Badge** - Each opportunity card displays color-coded badge
   - RFP (green), RFQ (blue), Sources Sought (purple), Pre-Sol (orange), Combined (teal), Other (gray)

2. **Posted Date** - Shows when opportunity was released, not just deadline
   - Helps users avoid last-minute surprises

3. **Notice Summary Scope** - Label updated to "Notice Type Summary (Top 10 Active)"
   - Clarifies the summary represents top 10 active opportunities

**File Modified:** `src/app/api/admin/send-all-briefings/route.ts`
