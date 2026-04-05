# Data Flow Architecture

> How components connect - the "nervous system" of Federal Market Scanner

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACE LAYER                               │
│                                                                              │
│   Market Assassin    Daily Alerts    Weekly Brief    Pursuit Brief          │
│        Tool           ($19/mo)        ($49/mo)        ($49/mo)              │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SKILLS LAYER (Claude)                               │
│                                                                              │
│   /market-scan    /visibility-gap    /recompete-analysis    /event-scan    │
│   /competitor-profile    /forecast-scan    /spending-analysis              │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AGENTS LAYER (Autonomous)                           │
│                                                                              │
│   Market Scanner Agent ──► Recompete Alert Agent ──► Event Discovery Agent  │
│          │                        │                         │               │
│          └────────────────────────┴─────────────────────────┘               │
│                               │                                              │
│                    Competitive Intel Agent                                   │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TOOLS LAYER (MCP)                                  │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ usaspending │  │   samgov    │  │  grantsgov  │  │  multisite  │        │
│  │    -mcp     │  │    -mcp     │  │    -mcp     │  │    -mcp     │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │                │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐        │
│  │ USASpending │  │   SAM.gov   │  │  Grants.gov │  │ NIH Reporter│        │
│  │    API      │  │     API     │  │     API     │  │     API     │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER (Supabase)                                │
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐  │
│  │ aggregated_         │  │ spending_cache      │  │ recompete_tracking │  │
│  │ opportunities       │  │                     │  │                    │  │
│  │ (all sources)       │  │ (24hr TTL)          │  │ (monitored)        │  │
│  └─────────────────────┘  └─────────────────────┘  └────────────────────┘  │
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐  │
│  │ event_calendar      │  │ user_profiles       │  │ scrape_log         │  │
│  │                     │  │                     │  │                    │  │
│  │ (aggregated)        │  │ (preferences)       │  │ (audit trail)      │  │
│  └─────────────────────┘  └─────────────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Sequences

### 1. Market Scan Request

```
User Request: "Scan HVAC market in Georgia"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ /market-scan skill receives: naics=238220, state=GA            │
└─────────────────────────────────────────────────────────────────┘
         │
         ├──────────────────────────────────────────────────────────┐
         │                                                          │
         ▼                                                          ▼
┌─────────────────────┐                              ┌─────────────────────┐
│ usaspending-mcp     │                              │ samgov-mcp          │
│                     │                              │                     │
│ get_spending_by_    │                              │ search_opportunities│
│ agency(238220, 3yr) │                              │ (238220, GA)        │
└─────────┬───────────┘                              └─────────┬───────────┘
          │                                                    │
          ▼                                                    ▼
┌─────────────────────┐                              ┌─────────────────────┐
│ Returns:            │                              │ Returns:            │
│ - $1.41B total      │                              │ - 23 active opps    │
│ - 847 awards        │                              │ - $180M posted      │
│ - Top: Army, VA,    │                              │                     │
│   GSA, Navy         │                              │                     │
└─────────┬───────────┘                              └─────────┬───────────┘
          │                                                    │
          └────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ VISIBILITY GAP CALCULATION                                      │
│                                                                 │
│ Total Spending:  $1.41B (USASpending)                          │
│ SAM Visibility:  $180M  (Active opportunities)                 │
│ Gap:             $1.23B (87% NOT visible on SAM)               │
└─────────────────────────────────────────────────────────────────┘
         │
         ├──────────────────────────────────────────────────────────┐
         │                                                          │
         ▼                                                          ▼
┌─────────────────────┐                              ┌─────────────────────┐
│ grantsgov-mcp       │                              │ samgov-mcp          │
│                     │                              │                     │
│ search_grants       │                              │ get_forecast        │
│ (HVAC keywords)     │                              │ (238220)            │
└─────────┬───────────┘                              └─────────┬───────────┘
          │                                                    │
          ▼                                                    ▼
┌─────────────────────┐                              ┌─────────────────────┐
│ Returns:            │                              │ Returns:            │
│ - 3 grants ($2.1M)  │                              │ - 8 forecasted      │
│ - DOE, HUD related  │                              │ - Q3 2026 expected  │
└─────────┬───────────┘                              └─────────┬───────────┘
          │                                                    │
          └────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ AGGREGATE & SCORE                                               │
│                                                                 │
│ 1. Combine all sources                                         │
│ 2. Deduplicate (source + external_id)                          │
│ 3. Score relevance to user profile                             │
│ 4. Sort by priority (closing soon, high value, good fit)       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ OUTPUT: Market Scan Report                                      │
│                                                                 │
│ ## HVAC Market - Georgia (238220)                              │
│                                                                 │
│ ### 3-Year Spending: $1.41B                                    │
│ - 87% NOT visible on SAM.gov                                   │
│ - Top Agencies: Army ($420M), VA ($380M), GSA ($290M)          │
│                                                                 │
│ ### Active Opportunities (23)                                  │
│ [table...]                                                      │
│                                                                 │
│ ### Forecasted (8)                                             │
│ [table...]                                                      │
│                                                                 │
│ ### Recommended Actions                                        │
│ 1. Target Army - 30% of spend, only 2 opps on SAM             │
│ 2. Register for VA industry day (May 15)                       │
│ 3. Monitor GSA Schedule 56 for HVAC task orders               │
└─────────────────────────────────────────────────────────────────┘
```

---

### 2. Daily Alerts Generation

```
CRON: 0 11 * * * (11 AM UTC daily)
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ /api/cron/daily-alerts                                          │
│                                                                 │
│ 1. Fetch all users with alert_tier = 'daily' or 'intelligence' │
│ 2. For each user, get their NAICS + state preferences          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ FOR EACH USER:                                                  │
│                                                                 │
│ ┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐ │
│ │ SAM.gov Query   │    │ Grants.gov      │    │ NIH Reporter │ │
│ │ (user NAICS,    │    │ Query           │    │ Query        │ │
│ │  state, 24hr)   │    │ (keywords)      │    │ (SBIR/STTR)  │ │
│ └────────┬────────┘    └────────┬────────┘    └──────┬───────┘ │
│          │                      │                     │         │
│          └──────────────────────┴─────────────────────┘         │
│                                 │                               │
│                                 ▼                               │
│          ┌─────────────────────────────────────────────┐        │
│          │ Merge + Dedupe + Score                      │        │
│          │                                             │        │
│          │ - Remove seen opportunities                 │        │
│          │ - Score against user profile                │        │
│          │ - Rank by relevance + close date            │        │
│          └─────────────────────────────────────────────┘        │
│                                 │                               │
│                                 ▼                               │
│          ┌─────────────────────────────────────────────┐        │
│          │ Generate Email                              │        │
│          │                                             │        │
│          │ - Top 5-10 opportunities                    │        │
│          │ - New forecasts if any                      │        │
│          │ - Recompete alerts if < 6 months            │        │
│          └─────────────────────────────────────────────┘        │
│                                 │                               │
│                                 ▼                               │
│          ┌─────────────────────────────────────────────┐        │
│          │ Send via Resend                             │        │
│          │ Log to briefing_log                         │        │
│          └─────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3. Recompete Alert Flow

```
CRON: 0 5 * * * (5 AM UTC daily)
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Recompete Alert Agent                                           │
│                                                                 │
│ Query USASpending for contracts expiring in 6-12 months        │
│ Filter by user NAICS codes                                     │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ FOR EACH EXPIRING CONTRACT:                                     │
│                                                                 │
│ 1. Check if already in recompete_tracking table                │
│ 2. If new: Add to tracking, set 6-month countdown              │
│ 3. If exists: Check milestone triggers                         │
│                                                                 │
│ Milestone Triggers:                                             │
│ - 12 months out → "Early Warning"                              │
│ - 6 months out  → "Active Monitoring"                          │
│ - 3 months out  → "High Alert"                                 │
│ - Sources sought posted → "Pre-Solicitation"                   │
│ - RFP posted → "Opportunity Live"                              │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Cross-Reference SAM.gov                                         │
│                                                                 │
│ Search for:                                                     │
│ - Sources sought matching contract keywords                    │
│ - RFIs mentioning incumbent                                    │
│ - New solicitations for same NAICS + agency                    │
│                                                                 │
│ If match found → Link opportunity to recompete record          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Alert Users                                                     │
│                                                                 │
│ - Market Intelligence ($49) users: Include in briefing         │
│ - If major recompete (>$1M): Priority alert                    │
│ - Update recompete_tracking status                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Communication Protocol

### Skill → Tool Handoff

```typescript
// Skill requests data from tool
interface ToolRequest {
  tool: string;           // e.g., 'usaspending-mcp'
  method: string;         // e.g., 'search_awards'
  params: {
    naics: string;
    state?: string;
    fiscal_year?: number;
    limit?: number;
  };
  timeout: number;        // ms
  retryOnFail: boolean;
}

// Tool returns standardized response
interface ToolResponse {
  success: boolean;
  data: any;              // Tool-specific data
  meta: {
    source: string;
    cached: boolean;
    queryTime: number;    // ms
    totalResults: number;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

### Agent → Skill Delegation

```typescript
// Agent delegates to skill
interface SkillDelegation {
  skill: string;          // e.g., '/visibility-gap'
  context: {
    parentAgent: string;
    sessionId: string;
    previousResults: any;
  };
  params: Record<string, any>;
  expectOutput: 'markdown' | 'json' | 'both';
}

// Skill returns to agent
interface SkillResult {
  output: string;         // Markdown report
  structured?: any;       // JSON data if requested
  suggestedNextSteps: string[];
  confidence: number;     // 0-1
}
```

### Agent → Agent Handoff

```typescript
// When one agent needs to spawn another
interface AgentHandoff {
  fromAgent: string;
  toAgent: string;
  reason: string;
  sharedContext: {
    naics: string;
    state: string;
    userProfile: any;
    previousFindings: any[];
  };
  expectedReturn: 'immediate' | 'async' | 'fire-and-forget';
}
```

---

## Caching Strategy

| Data Type | Cache Location | TTL | Invalidation |
|-----------|----------------|-----|--------------|
| USASpending queries | `spending_cache` | 24 hours | Daily refresh |
| SAM.gov opportunities | Real-time | None | Always fresh |
| Forecasts | `aggregated_opportunities` | 1 week | Weekly cron |
| Agency mappings | Memory | Session | Manual |
| User profiles | Supabase | Real-time | On change |
| Visibility gap calcs | `visibility_gaps` | 24 hours | Daily refresh |

---

## Error Handling

### API Failures

```
API Call Failed
      │
      ├── Rate Limited (429)?
      │         │
      │         ▼
      │    Wait 60s, retry (max 3)
      │
      ├── Server Error (5xx)?
      │         │
      │         ▼
      │    Retry with backoff (30s, 60s, 120s)
      │
      ├── Bad Request (4xx)?
      │         │
      │         ▼
      │    Log error, return partial results
      │
      └── Timeout?
                │
                ▼
           Use cached data if available
           Flag as "stale" in output
```

### Graceful Degradation

When a source fails:
1. Log the failure to `scrape_log`
2. Continue with other sources
3. Note missing source in output
4. Use cached data if < 24 hours old
5. Alert ops if consecutive failures > 3

---

## Monitoring Points

| Checkpoint | Metric | Alert Threshold |
|------------|--------|-----------------|
| API Health | Response time | > 5 seconds |
| Cache Hit Rate | % of cached responses | < 50% |
| Daily Alerts | Emails sent | < 80% of expected |
| Recompete Scan | Contracts found | 0 (if NAICS has historical) |
| User Queries | Error rate | > 5% |

---

## Related Documentation

| Doc | What It Covers |
|-----|----------------|
| `federal-market-scanner.md` | What Scanner does, value proposition |
| `tool-interfaces/*.md` | Detailed tool specifications |
| `agent-specs/*.md` | Agent decision trees |
| `protocols/*.md` | Communication patterns |

---

*Last Updated: April 5, 2026*
