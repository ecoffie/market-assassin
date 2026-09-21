# Intelligence System Agents

> Autonomous workflows that operate intelligence systems on schedule or trigger

## Overview

Agents are background processes that continuously gather, process, and deliver intelligence. They operate independently but contribute to the unified market intelligence platform.

---

## Agent 1: Recompete Tracker Agent

### Purpose
Continuously monitor expiring contracts and identify recompete opportunities.

### Trigger
- **Scheduled:** Nightly at 2 AM UTC
- **On-demand:** Via admin endpoint

### Data Flow
```
USASpending API
      │
      ▼
┌─────────────────┐
│ Query contracts │
│ expiring 6-24   │
│ months out      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Filter by:      │
│ • Value > $100K │
│ • Service codes │
│ • Active status │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Enrich with:    │
│ • Incumbent UEI │
│ • Option years  │
│ • Mod history   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Upsert to       │
│ recompete_      │
│ opportunities   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Match to user   │
│ profiles for    │
│ alert delivery  │
└─────────────────┘
```

### Implementation
```typescript
// src/lib/agents/recompete-tracker.ts

interface RecompeteAgentConfig {
  monthsAhead: number;        // Default: 18
  minValue: number;           // Default: 100000
  naicsCodes?: string[];      // Optional filter
  batchSize: number;          // Default: 100
}

interface RecompeteAgentResult {
  newContracts: number;
  updatedContracts: number;
  matchedProfiles: number;
  alertsQueued: number;
  errors: string[];
}

async function runRecompeteAgent(config: RecompeteAgentConfig): Promise<RecompeteAgentResult> {
  // 1. Query USASpending for expiring contracts
  // 2. Process in batches
  // 3. Upsert to database
  // 4. Match against user notification profiles
  // 5. Queue alerts for delivery
}
```

### Cron Entry
```typescript
// src/app/api/cron/recompete-sync/route.ts

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const result = await runRecompeteAgent({
    monthsAhead: 18,
    minValue: 100000,
    batchSize: 100
  });

  return NextResponse.json({ success: true, result });
}
```

### Vercel Cron Config
```json
{
  "crons": [
    {
      "path": "/api/cron/recompete-sync",
      "schedule": "0 2 * * *"
    }
  ]
}
```

---

## Agent 2: Forecast Scraper Agent

### Purpose
Scrape agency forecast pages and normalize into unified database.

### Trigger
- **Scheduled:** Weekly on Sundays at 3 AM UTC
- **On-demand:** Per-agency via admin endpoint

### Target Sources
| Agency | Source URL | Format |
|--------|------------|--------|
| GSA | acquisitiongateway.gov/forecast | HTML/JS |
| DHS | apfs-cloud.dhs.gov | HTML |
| VA | va.gov/osdbu/forecast | PDF/HTML |
| Army | army.mil/smallbusiness/forecast | HTML |
| Navy | neco.navy.mil | HTML (auth required) |
| Air Force | sbo.afmc.af.mil | HTML |
| DOE | energy.gov/osdbu/forecast | HTML |
| HHS | hhs.gov/grants/forecast | HTML |
| NASA | procurement.nasa.gov | HTML |
| EPA | epa.gov/contracts/forecast | HTML |

### Data Flow
```
Agency Forecast Pages
         │
         ▼
┌─────────────────┐
│ Scraper         │
│ (Puppeteer for  │
│ JS-heavy sites) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Parse & Extract │
│ • Title         │
│ • NAICS         │
│ • Est. Value    │
│ • Sol. Date     │
│ • Set-aside     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Normalize       │
│ • Date formats  │
│ • Value ranges  │
│ • Agency names  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Deduplicate     │
│ (by title +     │
│ agency + date)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Upsert to       │
│ agency_forecasts│
└─────────────────┘
```

### Implementation
```typescript
// src/lib/agents/forecast-scraper.ts

interface ForecastScraperConfig {
  agencies: string[];         // Which agencies to scrape
  headless: boolean;          // Puppeteer headless mode
  timeout: number;            // Page load timeout
  retries: number;            // Retry on failure
}

interface ScrapedForecast {
  sourceAgency: string;
  title: string;
  description?: string;
  naicsCode?: string;
  estimatedValueMin?: number;
  estimatedValueMax?: number;
  estimatedSolicitationDate?: Date;
  setAside?: string;
  placeOfPerformance?: string;
  contactName?: string;
  contactEmail?: string;
  sourceUrl: string;
}

const scrapers: Record<string, (page: Page) => Promise<ScrapedForecast[]>> = {
  'GSA': scrapeGSAForecast,
  'DHS': scrapeDHSForecast,
  'VA': scrapeVAForecast,
  // ... one scraper per agency format
};
```

---

## Agent 3: Budget Intelligence Agent

### Purpose
Extract procurement-relevant programs from Congressional Budget Justifications.

### Trigger
- **Scheduled:** Annual (February-May budget season)
- **On-demand:** Per-agency when new CBJ released

### Data Sources
| Agency | CBJ URL Pattern |
|--------|-----------------|
| DHS | dhs.gov/publication/congressional-budget-justification-fiscal-year-fy-{year} |
| Treasury | home.treasury.gov/.../fy-{year}-congressional-justification |
| VA | va.gov/budget/docs/summary/fy{year}BudgetInBrief.pdf |
| DOD | comptroller.defense.gov/Budget-Materials/ |
| HHS | hhs.gov/about/budget/fy{year}/index.html |

### Data Flow
```
Congressional Budget Justifications (PDF/HTML)
                    │
                    ▼
           ┌─────────────────┐
           │ Download/Fetch  │
           │ (Annual, 20+    │
           │ agencies)       │
           └────────┬────────┘
                    │
                    ▼
           ┌─────────────────┐
           │ PDF Extraction  │
           │ (pdf-parse or   │
           │ AI extraction)  │
           └────────┬────────┘
                    │
                    ▼
           ┌─────────────────┐
           │ AI Analysis     │
           │ • Find programs │
           │ • Extract $     │
           │ • Tag NAICS     │
           │ • Rate relevance│
           └────────┬────────┘
                    │
                    ▼
           ┌─────────────────┐
           │ Human Review    │
           │ (validation     │
           │ dashboard)      │
           └────────┬────────┘
                    │
                    ▼
           ┌─────────────────┐
           │ Store in        │
           │ budget_programs │
           └─────────────────┘
```

### Implementation
```typescript
// src/lib/agents/budget-intel.ts

interface BudgetProgram {
  agency: string;
  fiscalYear: number;
  programName: string;
  requestedAmount: number;
  description: string;
  keywords: string[];
  naicsRelevance: string[];
  documentUrl: string;
  pageReference: string;
  confidenceScore: number;
}

async function extractBudgetPrograms(
  pdfContent: Buffer,
  agency: string,
  fiscalYear: number
): Promise<BudgetProgram[]> {
  // 1. Parse PDF to text
  // 2. Send to AI for program extraction
  // 3. Structure results
  // 4. Score confidence
  // 5. Tag with relevant NAICS
}
```

---

## Agent 4: Event Aggregator Agent

### Purpose
Scrape live event calendars and populate upcoming events.

### Trigger
- **Scheduled:** Weekly on Mondays at 4 AM UTC
- **On-demand:** Via admin endpoint

### Target Sources
| Source | URL | Type |
|--------|-----|------|
| GSA Interact | interact.gsa.gov | HTML |
| SBA Events | sba.gov/events | HTML |
| APEX Accelerators | apexaccelerators.us/events | HTML |
| AFCEA | afcea.org/events | HTML |
| NDIA | ndia.org/events | HTML |
| Agency OSDBUs | Various | HTML |

### Implementation
```typescript
// src/lib/agents/event-aggregator.ts

interface FederalEvent {
  title: string;
  date: Date;
  endDate?: Date;
  location: string;
  isVirtual: boolean;
  agency?: string;
  category: 'industry_day' | 'matchmaking' | 'training' | 'conference';
  registrationUrl: string;
  cost: 'free' | number;
  description?: string;
  naicsRelevance?: string[];
}

async function scrapeEvents(): Promise<FederalEvent[]> {
  const events: FederalEvent[] = [];

  // Scrape each source
  events.push(...await scrapeGSAInteract());
  events.push(...await scrapeSBAEvents());
  events.push(...await scrapeAPEXEvents());
  events.push(...await scrapeAFCEAEvents());

  // Deduplicate by title + date
  return deduplicateEvents(events);
}
```

---

## Agent 5: Market Alert Agent

### Purpose
Match new intelligence against user profiles and deliver alerts.

### Trigger
- **Scheduled:** Daily at 6 AM user local time
- **Real-time:** When high-priority intel arrives

### Data Flow
```
New Intelligence
(from all agents)
       │
       ▼
┌─────────────────┐
│ Match against   │
│ user profiles:  │
│ • NAICS codes   │
│ • Agencies      │
│ • Keywords      │
│ • Set-asides    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Score relevance │
│ • Win probability│
│ • Lead time     │
│ • Competition   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Queue for       │
│ delivery at     │
│ user's local    │
│ 6 AM            │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Send via:       │
│ • Email         │
│ • SMS (opt-in)  │
│ • Dashboard     │
└─────────────────┘
```

---

## Agent 6: Competitive Intel Agent

### Purpose
Track competitor activity and contract wins.

### Trigger
- **Scheduled:** Weekly
- **On-demand:** When user adds competitor to watchlist

### Capabilities
- Monitor competitor contract wins
- Track competitor teaming patterns
- Identify contracts competitor might be recompeting
- Analyze win rates by agency/NAICS

### Implementation
```typescript
// src/lib/agents/competitive-intel.ts

interface CompetitorProfile {
  name: string;
  uei: string;
  recentWins: ContractWin[];
  activeContracts: Contract[];
  recompeteRisk: RecompeteOpportunity[];
  teamingPartners: string[];
  primaryAgencies: string[];
  primaryNaics: string[];
}

async function buildCompetitorProfile(uei: string): Promise<CompetitorProfile> {
  // 1. Query USASpending for recent awards
  // 2. Find active contracts and expirations
  // 3. Identify teaming patterns from subcontracts
  // 4. Analyze agency/NAICS concentrations
}
```

---

## Agent Registry

| Agent | Status | Schedule | Dependencies |
|-------|--------|----------|--------------|
| Recompete Tracker | 📋 Planned | Nightly | USASpending API |
| Forecast Scraper | 📋 Planned | Weekly | Puppeteer, Agency sites |
| Budget Intel | 📋 Planned | Annual | PDF parser, AI |
| Event Aggregator | 📋 Future | Weekly | Event site scrapers |
| Market Alert | ✅ Partial | Daily | Existing alerts system |
| Competitive Intel | 📋 Future | Weekly | USASpending API |

---

## Orchestration

Agents are orchestrated via Vercel Cron and can be monitored through:
- `/api/admin/agent-status` - View all agent statuses
- `/api/admin/trigger-agent?agent=recompete` - Manual trigger
- Supabase `agent_runs` table for history

```typescript
// src/lib/agents/orchestrator.ts

interface AgentRun {
  id: string;
  agentName: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed';
  result?: Record<string, unknown>;
  error?: string;
}
```

---

*Last Updated: April 5, 2026*
