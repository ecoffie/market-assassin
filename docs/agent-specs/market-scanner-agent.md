# Market Scanner Agent Specification

> Autonomous market analysis with decision-making

## Purpose

The Market Scanner Agent is the primary autonomous workflow for comprehensive market intelligence. Unlike the `/market-scan` skill (which executes a fixed sequence), this agent makes decisions based on intermediate results.

---

## Trigger Conditions

| Trigger | Context |
|---------|---------|
| User requests market scan | Via skill, then escalates to agent if complex |
| Weekly scheduled scan | Market Intelligence ($49/mo) subscribers |
| Recompete alert | When recompete needs deeper analysis |
| New user onboarding | Generate initial market profile |

---

## Decision Tree

```
                              START
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Get User Profile      │
                    │ (NAICS, state, caps)  │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Query USASpending     │
                    │ (3-year spending)     │
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
          Total < $1M?              Total > $100M?
                │                       │
                ▼                       ▼
       ┌─────────────────┐    ┌─────────────────┐
       │ LOW VALUE       │    │ HIGH VALUE      │
       │ MARKET PATH     │    │ MARKET PATH     │
       │                 │    │                 │
       │ • Suggest       │    │ • Deep agency   │
       │   broader NAICS │    │   analysis      │
       │ • Check grants  │    │ • Competitor    │
       │ • Consider      │    │   mapping       │
       │   state work    │    │ • Recompete     │
       └────────┬────────┘    │   priority      │
                │             └────────┬────────┘
                │                      │
                └──────────┬───────────┘
                           │
                           ▼
                ┌───────────────────────┐
                │ Analyze Agency        │
                │ Concentration         │
                └───────────┬───────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
       Single Agency   Distributed    No Clear
         > 60%          (5+ at       Pattern
              │          >10% each)        │
              │             │             │
              ▼             ▼             ▼
       ┌───────────┐ ┌───────────┐ ┌───────────┐
       │CONCENTRATED│ │COMPETITIVE│ │FRAGMENTED │
       │            │ │           │ │           │
       │• Focus on  │ │• Cast     │ │• Look for │
       │  one agency│ │  wider net│ │  patterns │
       │• Deep      │ │• Multiple │ │• Consider │
       │  relationship│  pursuits │ │  teaming  │
       │  strategy  │ │• Volume   │ │           │
       └─────┬──────┘ └─────┬─────┘ └─────┬─────┘
              │             │             │
              └─────────────┼─────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Query SAM.gov         │
                │ (Active Opportunities)│
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Calculate Visibility  │
                │ Gap                   │
                └───────────┬───────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
        Gap > 70%     Gap 40-70%     Gap < 40%
              │             │             │
              ▼             ▼             ▼
       ┌───────────┐ ┌───────────┐ ┌───────────┐
       │ HIDDEN    │ │ PARTIAL   │ │ VISIBLE   │
       │ MARKET    │ │ VISIBILITY│ │ MARKET    │
       │           │ │           │ │           │
       │• Research │ │• Standard │ │• Focus on │
       │  agency   │ │  approach │ │  SAM.gov  │
       │  portals  │ │• Check    │ │• Speed    │
       │• IDIQs?   │ │  forecasts│ │  matters  │
       │• BPAs?    │ │           │ │           │
       └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
              │             │             │
              └─────────────┼─────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Query Forecasts       │
                │ (Top Agencies)        │
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Query Recompetes      │
                │ (Expiring Contracts)  │
                └───────────┬───────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
    Recompetes > $1M?             No Major Recompetes
              │                           │
              ▼                           │
       ┌───────────────┐                  │
       │ RECOMPETE     │                  │
       │ PRIORITY      │                  │
       │               │                  │
       │• Spawn        │                  │
       │  Recompete    │                  │
       │  Alert Agent  │                  │
       │• Track        │                  │
       │  incumbents   │                  │
       └───────┬───────┘                  │
               │                          │
               └────────────┬─────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Should Include Grants?│
                │ (Based on NAICS type) │
                └───────────┬───────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
     R&D NAICS?      Social Services?   Standard
     (541xxx)        (6xxxxx)           Contracting
              │             │             │
              ▼             ▼             ▼
       ┌───────────┐ ┌───────────┐       │
       │ Include   │ │ Include   │       │
       │ SBIR/STTR │ │ Grants.gov│       │
       │ NIH, NSF  │ │ Focus     │       │
       └─────┬─────┘ └─────┬─────┘       │
              │             │             │
              └─────────────┼─────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Generate Report       │
                │ (Adaptive Format)     │
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Recommend Actions     │
                │ (Based on findings)   │
                └───────────┬───────────┘
                            │
                            ▼
                          DONE
```

---

## State Management

The agent maintains state throughout execution:

```typescript
interface AgentState {
  // Input
  userId: string;
  naics: string;
  state?: string;

  // Intermediate Results
  spendingData?: {
    total: number;
    byAgency: AgencySpending[];
    trend: 'up' | 'down' | 'stable';
  };

  // Classifications
  marketType?: 'concentrated' | 'competitive' | 'fragmented' | 'niche';
  marketValue?: 'high' | 'medium' | 'low';
  visibilityType?: 'hidden' | 'partial' | 'visible';

  // Opportunities Found
  samOpportunities: Opportunity[];
  forecasts: Forecast[];
  recompetes: ExpiringContract[];
  grants?: Grant[];
  sbir?: NIHProject[];

  // Decisions Made
  decisions: {
    timestamp: string;
    decision: string;
    reason: string;
  }[];

  // Spawned Sub-Agents
  spawnedAgents: {
    agentType: string;
    agentId: string;
    status: 'running' | 'completed' | 'failed';
  }[];
}
```

### State Persistence

- **Session Storage:** Agent state persists within conversation
- **Resume Capability:** If interrupted, can resume from last checkpoint
- **Checkpoint Events:**
  - After spending analysis
  - After SAM.gov query
  - After gap calculation
  - Before report generation

---

## Handoff Protocol

### To Other Agents

```typescript
interface AgentHandoff {
  fromAgent: 'market-scanner';
  toAgent: string;
  reason: string;
  sharedContext: Partial<AgentState>;
  expectedReturn: 'immediate' | 'async' | 'fire-and-forget';
}
```

**Handoff Scenarios:**

| Condition | Handoff To | Return |
|-----------|-----------|--------|
| Major recompete found (>$1M) | Recompete Alert Agent | async |
| Competitor dominates market | Competitive Intel Agent | async |
| User asks about events | Event Discovery Agent | immediate |
| Gap > 80%, need portal research | (Future) Portal Research Agent | async |

### From Skills

The agent can be invoked by skills when complexity exceeds fixed sequence:

```typescript
// In /market-scan skill
if (
  complexNAICS ||           // Multiple related codes
  multiState ||             // Regional analysis
  userRequestedDeep ||      // "deep dive" in request
  previousScanExists        // Follow-up analysis
) {
  delegateToAgent('market-scanner', context);
}
```

---

## Adaptive Behaviors

### 1. NAICS Expansion

If initial NAICS yields < 10 results:
```
Try 3-digit prefix (541512 → 541)
If still low, suggest related NAICS codes
Log decision: "Expanded NAICS due to low results"
```

### 2. State Expansion

If state yields < 5 results:
```
Add border states automatically
For VA/MD/DC → Include all DMV
Log decision: "Expanded to regional search"
```

### 3. Time Range Adjustment

If market is seasonal:
```
Detect if spending clusters in certain months
Adjust historical window accordingly
Note seasonality in report
```

### 4. Report Depth Adjustment

Based on findings:
```
if (opportunities > 50) → Summarize, provide filters
if (opportunities < 5) → Deep analysis on each
if (concentrated market) → Agency deep dive
if (hidden market) → Research section prominent
```

---

## Output Formats

### Standard Report
Full markdown report (see `/market-scan` spec)

### Executive Summary
When requested or for scheduled scans:
```markdown
## [NAICS] Market - [Date]

**Bottom Line:** [One sentence assessment]

**Key Numbers:**
- Spend: $X.XB | Gap: XX% | Active Opps: N

**Top 3 Actions:**
1. [Action]
2. [Action]
3. [Action]

[Link to full report]
```

### Alert Format
For significant findings:
```markdown
🚨 **Market Alert: [NAICS]**

[Finding that triggered alert]

**Immediate Action:** [What to do]

[Link to details]
```

---

## Performance Constraints

| Metric | Limit |
|--------|-------|
| Total execution time | 60 seconds |
| API calls | 15 max |
| Spawned sub-agents | 3 max |
| Report length | 2000 words max |

### Timeout Handling

```
if (executionTime > 45s) {
  // Wrap up with available data
  // Note incomplete sections
  // Offer to continue later
}
```

---

## Error Recovery

| Error | Recovery |
|-------|----------|
| USASpending timeout | Use cached data, flag as stale |
| SAM.gov rate limit | Wait 60s, retry once |
| No data for NAICS | Suggest alternatives, don't fail |
| Agent spawn fails | Log, continue without sub-analysis |

---

## Logging

All agent decisions are logged:

```typescript
interface AgentLog {
  agentId: string;
  userId: string;
  startTime: string;
  endTime: string;

  inputs: {
    naics: string;
    state?: string;
  };

  decisions: {
    timestamp: string;
    checkpoint: string;
    decision: string;
    reason: string;
    data?: any;
  }[];

  outputs: {
    reportType: string;
    opportunitiesFound: number;
    alertsGenerated: number;
  };

  performance: {
    totalTime: number;
    apiCalls: number;
    cacheHits: number;
  };
}
```

---

## Related Documentation

| Doc | Purpose |
|-----|---------|
| `skill-specs/market-scan-spec.md` | Non-autonomous version |
| `recompete-alert-agent.md` | Sub-agent for recompetes |
| `competitive-intel-agent.md` | Sub-agent for competitors |
| `protocols/agent-orchestration-protocol.md` | Communication patterns |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-05 | Initial specification |

---

*Last Updated: April 5, 2026*
