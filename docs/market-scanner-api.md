# Federal Market Scanner API

**Endpoint:** `/api/market-scanner`

**Purpose:** Answer 6 critical market intelligence questions for any NAICS + Location combination in a single API call.

---

## Overview

The Federal Market Scanner integrates data from multiple federal sources to provide comprehensive market intelligence:

- **USASpending.gov** - Spending analysis, incumbent data
- **SAM.gov** - Active opportunities, entity data, contract awards
- **Grants.gov** - Grant opportunities
- **Agency Sources API** - Procurement methods, vehicles
- **Federal Events API** - Industry days, matchmaking
- **Federal Hierarchy API** - OSDBU contacts, contracting officers
- **Forecast Intelligence** - Planned procurements (6-18 months ahead)
- **Contractor Database** - SBLO contacts, teaming partners

---

## Request Format

### Endpoint
```
GET /api/market-scanner?naics={code}&state={state}
```

### Parameters

| Parameter | Required | Format | Description |
|-----------|----------|--------|-------------|
| `naics` | Yes | 5-6 digit code | NAICS code (min 5 digits for accuracy) |
| `state` | No | 2-letter code | State abbreviation (e.g., GA, FL, TX) |

### Examples

```bash
# Georgia construction market
GET /api/market-scanner?naics=238220&state=GA

# Nationwide IT services
GET /api/market-scanner?naics=541512

# Florida engineering
GET /api/market-scanner?naics=541330&state=FL
```

---

## Response Format

```typescript
{
  "success": true,

  // Input echo
  "input": {
    "naics": "238220",
    "naicsDescription": "Plumbing, Heating, and Air-Conditioning Contractors",
    "state": "GA",
    "stateName": "Georgia"
  },

  // 1. WHO is buying?
  "whoIsBuying": {
    "agencies": [
      {
        "name": "Department of Veterans Affairs",
        "annualSpend": 45000000,
        "department": "Veterans Health Administration"
      }
    ],
    "totalSpend": 150000000,
    "topBuyer": "Department of Veterans Affairs",
    "concentration": "concentrated" // or "distributed", "balanced"
  },

  // 2. HOW are they buying?
  "howAreTheyBuying": {
    "breakdown": [
      {
        "method": "GSA Schedule",
        "percentage": 40,
        "actionRequired": "Get on GSA Schedule (SIN research required)"
      },
      {
        "method": "IDIQ/BPA Vehicles",
        "percentage": 30,
        "actionRequired": "Target vehicle holders for subcontracting"
      }
    ],
    "primaryMethod": "GSA Schedule",
    "visibilityGap": 70,
    "recommendation": "70% of spending is hidden from SAM.gov. Focus on GSA Schedule, IDIQ vehicles, and direct agency outreach."
  },

  // 3. WHO has the contracts now?
  "whoHasItNow": {
    "incumbents": [
      {
        "company": "ABC Contractors Inc",
        "agency": "Department of Veterans Affairs",
        "contractValue": 5000000,
        "expirationDate": "2026-09-30",
        "isRecompete": true,
        "setAside": "Small Business Set-Aside",
        "daysUntilExpiration": 180
      }
    ],
    "totalRecompetes": 12,
    "urgentRecompetes": 4,
    "lowCompetitionCount": 8
  },

  // 4. WHAT opportunities exist RIGHT NOW?
  "whatIsAvailable": {
    "samGov": {
      "count": 15,
      "types": ["Presolicitation", "Combined Synopsis/Solicitation", "Sources Sought"]
    },
    "grantsGov": {
      "count": 3
    },
    "gsaEbuy": {
      "count": 0,
      "note": "Requires GSA Schedule to access"
    },
    "forecasts": {
      "count": 8,
      "timeframe": "6-18 months ahead"
    }
  },

  // 5. WHAT events should you attend?
  "whatEvents": [
    {
      "name": "VA OSDBU Industry Day",
      "date": "Quarterly",
      "location": "GA or Virtual",
      "type": "Industry Day"
    }
  ],

  // 6. WHO do I talk to?
  "whoToTalkTo": {
    "osdubuContacts": [
      {
        "agency": "Department of Veterans Affairs",
        "name": "John Smith",
        "title": "Small Business Liaison",
        "email": "john.smith@va.gov",
        "phone": "555-1234"
      }
    ],
    "sbSpecialists": [
      {
        "agency": "Department of Veterans Affairs",
        "office": "Office of Small and Disadvantaged Business Utilization"
      }
    ],
    "contractingOfficers": [],
    "teamingPartners": [
      {
        "agency": "Partner Company LLC",
        "name": "Jane Doe",
        "email": "jane@partner.com",
        "phone": "555-5678"
      }
    ]
  },

  "generatedAt": "2026-04-10T15:30:00.000Z",
  "processingTimeMs": 3500
}
```

---

## Data Sources Integration

### 1. WHO is buying? (USASpending API)

**Source:** `https://api.usaspending.gov/api/v2/search/spending_by_award/`

**Logic:**
- Queries last 3 fiscal years (FY22-FY25)
- Aggregates by awarding agency
- Includes bordering states (if state specified)
- Calculates concentration:
  - **Concentrated:** Top agency >60% of spending
  - **Distributed:** Top agency <30% and 5+ agencies
  - **Balanced:** Everything else

**Fallback:** Returns empty agencies array if API fails

---

### 2. HOW are they buying? (Agency Sources API)

**Source:** `/api/agency-sources?agencies={top_agencies}`

**Logic:**
- Fetches procurement patterns for top 3 buying agencies
- Identifies key methods:
  - **GSA Schedule:** >20% = Critical
  - **IDIQ Vehicles:** >15% = Important
  - **SAM Posted:** Direct visibility percentage
  - **Hidden Market:** 100 - SAM Posted
- Generates actionable recommendation

**Fallback:** Assumes 30% SAM visibility, 70% hidden market

---

### 3. WHO has it now? (SAM.gov Contract Awards + USASpending)

**Source:** `/lib/sam/contract-awards.ts` (uses USASpending as primary)

**Logic:**
- Queries expiring contracts (18-month window)
- Identifies recompetes (within 540 days)
- Flags urgent (within 180 days)
- Detects low competition (≤2 bidders or sole source)

**Fallback:** Returns empty incumbents array if API fails

---

### 4. WHAT is available? (Multi-source)

**SAM.gov Opportunities:**
- Source: `https://api.sam.gov/opportunities/v2/search`
- Last 30 days posted
- All notice types: p, r, k, o, s, i
- Requires: `SAM_API_KEY` env var

**Grants.gov:**
- Source: `https://apply07.grants.gov/grantsws/rest/opportunities/search`
- Searches by NAICS description keywords
- Status: posted only

**Forecasts:**
- Source: Supabase `agency_forecasts` table
- 7,764 forecasts from 13 agencies
- 6-18 month advance notice

**GSA eBuy:**
- Placeholder (no public API)
- Note: Requires GSA Schedule access

**Fallback:** Each source returns 0 count independently

---

### 5. WHAT events? (Federal Events API)

**Source:** `/api/federal-events?naics={naics}`

**Logic:**
- Maps NAICS to relevant agencies
- Returns industry days, matchmaking, training
- Location filtered by state if provided

**Fallback:** Returns OSDBU Events Calendar as generic option

---

### 6. WHO to talk to? (Multiple sources)

**OSDBU Contacts:**
- Source: Supabase `federal_contractors` table
- Filters by top buying agencies
- Returns SBLO name, email, phone

**SB Specialists:**
- Derived from top agencies
- Office name: "Office of Small and Disadvantaged Business Utilization"

**Contracting Officers:**
- Placeholder (requires office search enhancement)

**Teaming Partners:**
- Source: SAM.gov Entity Management API
- Finds entities with matching NAICS in same state
- Returns POCs from SAM registration

**Fallback:** Returns empty arrays for unavailable data

---

## Performance

**Target Response Time:** <5 seconds

**Optimization:**
- Parallel API calls (6 questions fetch simultaneously)
- 15-30 second timeouts on external APIs
- Graceful degradation (missing data sources don't block response)

**Measured Performance:**
- Typical: 3-4 seconds
- Worst case: 8 seconds (all sources slow)

---

## Error Handling

### Validation Errors (400)

```json
{
  "success": false,
  "error": "naics parameter is required",
  "usage": "GET /api/market-scanner?naics=238220&state=GA"
}
```

```json
{
  "success": false,
  "error": "NAICS code must be at least 5 digits for accurate results"
}
```

### Processing Errors (500)

```json
{
  "success": false,
  "error": "Failed to generate market scan",
  "processingTimeMs": 1500
}
```

---

## Integration Examples

### JavaScript/TypeScript

```typescript
async function scanMarket(naics: string, state?: string) {
  const url = new URL('/api/market-scanner', 'https://tools.govcongiants.org');
  url.searchParams.set('naics', naics);
  if (state) url.searchParams.set('state', state);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.success) {
    console.log(`Market Intelligence for ${data.input.naicsDescription}`);
    console.log(`Total Spending: $${data.whoIsBuying.totalSpend.toLocaleString()}`);
    console.log(`Top Buyer: ${data.whoIsBuying.topBuyer}`);
    console.log(`Opportunities: ${data.whatIsAvailable.samGov.count} on SAM.gov`);
  }
}

// Usage
scanMarket('541512', 'VA');
```

### Python

```python
import requests

def scan_market(naics: str, state: str = None):
    params = {'naics': naics}
    if state:
        params['state'] = state

    response = requests.get(
        'https://tools.govcongiants.org/api/market-scanner',
        params=params
    )
    data = response.json()

    if data['success']:
        print(f"Market Intelligence for {data['input']['naicsDescription']}")
        print(f"Total Spending: ${data['whoIsBuying']['totalSpend']:,}")
        print(f"Opportunities: {data['whatIsAvailable']['samGov']['count']} on SAM.gov")

# Usage
scan_market('541512', 'VA')
```

### cURL

```bash
# Basic scan
curl "https://tools.govcongiants.org/api/market-scanner?naics=238220&state=GA"

# Nationwide scan
curl "https://tools.govcongiants.org/api/market-scanner?naics=541512"

# Pretty print with jq
curl -s "https://tools.govcongiants.org/api/market-scanner?naics=541330&state=FL" | jq
```

---

## Use Cases

### 1. Market Entry Assessment
**Question:** "Should we enter this market?"

**Relevant Fields:**
- `whoIsBuying.totalSpend` - Market size
- `whoIsBuying.concentration` - Competition landscape
- `howAreTheyBuying.visibilityGap` - Barrier to entry
- `whatIsAvailable` - Current opportunity volume

**Decision Logic:**
```typescript
if (totalSpend > 50_000_000 && visibilityGap < 50 && samGov.count > 10) {
  return "Strong market - enter via competitive bidding";
} else if (visibilityGap > 70 && hasGSASchedule) {
  return "Hidden market - GSA Schedule required";
}
```

---

### 2. Recompete Tracking
**Question:** "Which contracts are coming up for recompete?"

**Relevant Fields:**
- `whoHasItNow.totalRecompetes` - Total pipeline
- `whoHasItNow.urgentRecompetes` - Within 6 months
- `whoHasItNow.lowCompetitionCount` - Winnable targets
- `whoHasItNow.incumbents[]` - Specific opportunities

**Filtering:**
```typescript
const urgentWinnable = response.whoHasItNow.incumbents.filter(inc =>
  inc.isRecompete &&
  inc.daysUntilExpiration! <= 180 &&
  inc.contractValue >= 1_000_000
);
```

---

### 3. Agency Targeting
**Question:** "Which agencies should we focus on?"

**Relevant Fields:**
- `whoIsBuying.agencies[]` - Ranked by spending
- `howAreTheyBuying.breakdown[]` - Procurement methods per agency
- `whoToTalkTo.osdubuContacts[]` - Direct contacts

**Prioritization:**
```typescript
const topTargets = response.whoIsBuying.agencies
  .filter(a => a.annualSpend > 10_000_000)
  .slice(0, 3)
  .map(a => ({
    agency: a.name,
    spend: a.annualSpend,
    contact: response.whoToTalkTo.osdubuContacts.find(c => c.agency === a.name)
  }));
```

---

### 4. Teaming Partner Search
**Question:** "Who should we team with?"

**Relevant Fields:**
- `whoHasItNow.incumbents[]` - Current contractors
- `whoToTalkTo.teamingPartners[]` - SAM-registered partners
- `whoIsBuying.topBuyer` - Target agency

**Strategy:**
```typescript
const partnerStrategy = {
  prime: response.whoHasItNow.incumbents.find(i => i.contractValue > 5_000_000),
  subs: response.whoToTalkTo.teamingPartners.filter(p => p.email),
  approach: response.howAreTheyBuying.visibilityGap > 60 ? 'relationship' : 'competitive'
};
```

---

## Environment Variables Required

```env
# SAM.gov API (for opportunities)
SAM_API_KEY=your_sam_api_key_here

# Supabase (for forecasts, contractors)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional (for relative URL resolution)
NEXT_PUBLIC_BASE_URL=https://tools.govcongiants.org
```

---

## Rate Limits

**External APIs:**
- **USASpending:** No documented limit (public API)
- **SAM.gov:** 1,000 requests/day, 10/minute
- **Grants.gov:** No documented limit
- **Supabase:** Based on plan (generous)

**Caching Strategy:**
- Market scanner responses: 1 hour TTL (recommended)
- Spending data: 24 hours (changes daily at most)
- Contract awards: 24 hours
- Forecasts: 7 days

---

## Future Enhancements

### Phase 2 (Planned)
- [ ] Add MCP tool integration (`mcp__samgov__search_opportunities`)
- [ ] Include Grants.gov MCP tool (`mcp__grantsgov__search_grants`)
- [ ] Add USASpending MCP tool (`mcp__usaspending__search_contracts`)
- [ ] Add response caching (Redis/KV store)
- [ ] Add webhook support for market change alerts

### Phase 3 (Backlog)
- [ ] Historical trend analysis (3-year comparison)
- [ ] Competition difficulty scoring (proprietary algorithm)
- [ ] AI-generated market entry strategy
- [ ] Automated capability gap analysis
- [ ] LinkedIn contact enrichment for teaming partners

---

## Related APIs

| API | Purpose | Relationship |
|-----|---------|--------------|
| `/api/market-scan` | Spending + visibility gap | Question 1 & 2 data source |
| `/api/agency-sources` | Procurement methods | Question 2 data source |
| `/api/federal-events` | Events calendar | Question 5 data source |
| `/api/agency-hierarchy` | Org structure + contacts | Question 6 data source |
| `/api/forecasts` | Planned procurements | Question 4 data source |

---

## Support

**Issues:** Report bugs via GitHub Issues or email service@govcongiants.com

**Rate Limit Increase:** Contact service@govcongiants.com for enterprise API key

**Custom Integration:** Available for Pro Giant ($997) and Ultimate ($1,497) customers

---

*Last Updated: April 10, 2026*
