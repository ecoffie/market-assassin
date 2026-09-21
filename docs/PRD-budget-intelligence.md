# Budget Intelligence System PRD

> Early-warning system for federal procurement opportunities 12-24 months before RFPs hit

## Overview

Budget Intelligence identifies contract opportunities at the earliest possible stage by analyzing:
1. **Congressional Budget Justifications (CBJs)** - Program-level funding 18+ months ahead
2. **Agency Pain Points** - Real challenges agencies are trying to solve
3. **Budget Authority** - Where the money is flowing (growing vs cutting)
4. **NDAA Mandates** - Congressional requirements driving new contracts
5. **Priorities** - Specific programs with known funding and timelines

---

## Existing Assets (Already Built)

| Asset | Size | Contents | Status |
|-------|------|----------|--------|
| `agency-pain-points.json` | 959KB | 250 agencies, 2,765 pain points, 2,500 priorities | ✅ Live |
| `agency-budget-data.json` | 20KB | 47 toptier agencies FY25/26 authority | ✅ Live |
| `agency-spending-complete.json` | 330KB | 3-year spending by agency/NAICS | ✅ Live |
| `/api/pain-points` | - | Pain points, priorities, NDAA items | ✅ Live |
| `/api/budget-authority` | - | FY budget trends | ✅ Live |

**Gap:** Data exists but isn't:
- Persisted in queryable database
- Mapped to NAICS codes
- Connected to timeline predictions
- Unified into single intelligence layer

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            USER LAYER                                   │
│                                                                         │
│   Skill: /budget-intel [agency|naics]                                   │
│   Dashboard: Budget Intelligence page                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API LAYER                                       │
│                                                                         │
│   /api/budget-intel                                                     │
│   ├── ?agency=DOD              Single agency intelligence               │
│   ├── ?naics=541512            NAICS-relevant programs                  │
│   ├── ?trend=growing           Agencies with growing budgets            │
│   ├── ?category=cybersecurity  Pain points by category                  │
│   └── ?mode=opportunities      Ranked opportunity predictions           │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      INTELLIGENCE LAYER                                 │
│                                                                         │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│   │ Budget       │  │ Pain Points  │  │ Program      │                 │
│   │ Authority    │  │ & Priorities │  │ Extractor    │                 │
│   │ Analyzer     │  │ Matcher      │  │ (AI/PDF)     │                 │
│   └──────────────┘  └──────────────┘  └──────────────┘                 │
│                                                                         │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│   │ NAICS        │  │ Timeline     │  │ Opportunity  │                 │
│   │ Mapper       │  │ Predictor    │  │ Ranker       │                 │
│   └──────────────┘  └──────────────┘  └──────────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       DATA LAYER                                        │
│                                                                         │
│   Supabase Tables:                                                      │
│   ├── budget_programs        CBJ line items + AI extraction             │
│   ├── agency_pain_points     Cached from JSON + manual additions        │
│   ├── budget_authority       FY trends per agency                       │
│   └── naics_program_mapping  Links programs → NAICS codes               │
│                                                                         │
│   JSON Files (existing):                                                │
│   ├── agency-pain-points.json                                           │
│   ├── agency-budget-data.json                                           │
│   └── agency-spending-complete.json                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       AGENT LAYER                                       │
│                                                                         │
│   Budget Intel Agent (Annual - Feb/May)                                 │
│   ├── Download new CBJs when released                                   │
│   ├── Extract programs via AI                                           │
│   ├── Map to NAICS codes                                                │
│   └── Update budget_programs table                                      │
│                                                                         │
│   Pain Points Refresh Agent (Quarterly)                                 │
│   ├── Analyze recent contracts for new pain points                      │
│   ├── Cross-reference with NDAA requirements                            │
│   └── Update agency-pain-points.json                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

```sql
-- budget_programs: Individual line items from CBJs
CREATE TABLE budget_programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Source identification
  agency TEXT NOT NULL,
  sub_agency TEXT,
  fiscal_year INTEGER NOT NULL,
  document_url TEXT,
  page_reference TEXT,

  -- Program details
  program_name TEXT NOT NULL,
  program_code TEXT,
  description TEXT,

  -- Funding
  requested_amount NUMERIC(15,2),
  enacted_amount NUMERIC(15,2),
  prior_year_amount NUMERIC(15,2),
  funding_trend TEXT, -- 'growing', 'stable', 'declining', 'new', 'cut'

  -- Classification
  keywords TEXT[], -- AI-extracted keywords
  naics_codes TEXT[], -- Mapped NAICS codes
  psc_codes TEXT[], -- Product Service Codes
  category TEXT, -- cybersecurity, infrastructure, modernization, etc.

  -- Intelligence
  procurement_likelihood NUMERIC(3,2), -- 0.00-1.00
  estimated_rfp_quarter TEXT, -- 'Q1 FY26', 'Q3 FY27'
  contract_type_likely TEXT, -- 'IDIQ', 'FFP', 'T&M'
  set_aside_likely TEXT,

  -- AI extraction metadata
  extraction_method TEXT, -- 'ai', 'manual', 'scrape'
  confidence_score NUMERIC(3,2),
  human_verified BOOLEAN DEFAULT false,

  -- Tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(agency, fiscal_year, program_name)
);

-- agency_budget_authority: FY-level budget trends
CREATE TABLE agency_budget_authority (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  agency TEXT NOT NULL,
  toptier_code TEXT,

  fiscal_year INTEGER NOT NULL,
  budget_authority NUMERIC(15,2),
  obligated NUMERIC(15,2),
  outlays NUMERIC(15,2),

  -- Trends
  prior_year_authority NUMERIC(15,2),
  change_amount NUMERIC(15,2),
  change_percent NUMERIC(5,4),
  trend TEXT, -- 'surging' (>30%), 'growing' (5-30%), 'stable' (-5 to 5%), 'declining' (-30 to -5%), 'cut' (<-30%)

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(agency, fiscal_year)
);

-- agency_pain_points_db: Persisted pain points (supplements JSON)
CREATE TABLE agency_pain_points_db (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  agency TEXT NOT NULL,
  sub_agency TEXT,

  pain_point TEXT NOT NULL,
  category TEXT, -- cybersecurity, infrastructure, modernization, compliance, workforce, other
  source TEXT, -- 'cbj', 'ndaa', 'gao', 'ig_report', 'manual', 'ai_inferred'
  source_url TEXT,

  -- NAICS relevance
  naics_codes TEXT[],

  -- Priority and timing
  urgency TEXT, -- 'critical', 'high', 'medium', 'low'
  estimated_resolution_fy INTEGER,

  -- Tracking
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(agency, pain_point)
);

-- naics_program_mapping: Links NAICS codes to budget programs
CREATE TABLE naics_program_mapping (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  naics_code TEXT NOT NULL,
  naics_description TEXT,

  program_id UUID REFERENCES budget_programs(id),
  agency TEXT NOT NULL,
  program_name TEXT NOT NULL,

  relevance_score NUMERIC(3,2), -- 0.00-1.00
  mapping_source TEXT, -- 'ai', 'manual', 'historical'

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(naics_code, program_id)
);

-- Indexes for fast queries
CREATE INDEX idx_budget_programs_agency ON budget_programs(agency);
CREATE INDEX idx_budget_programs_fy ON budget_programs(fiscal_year);
CREATE INDEX idx_budget_programs_naics ON budget_programs USING GIN(naics_codes);
CREATE INDEX idx_budget_programs_category ON budget_programs(category);
CREATE INDEX idx_budget_authority_agency ON agency_budget_authority(agency);
CREATE INDEX idx_pain_points_agency ON agency_pain_points_db(agency);
CREATE INDEX idx_pain_points_naics ON agency_pain_points_db USING GIN(naics_codes);
CREATE INDEX idx_naics_mapping_code ON naics_program_mapping(naics_code);

-- View: Budget intelligence summary by agency
CREATE VIEW agency_budget_intel AS
SELECT
  ba.agency,
  ba.fiscal_year,
  ba.budget_authority,
  ba.trend,
  COUNT(DISTINCT bp.id) as program_count,
  SUM(bp.requested_amount) as total_program_funding,
  COUNT(DISTINCT pp.id) as pain_point_count,
  ARRAY_AGG(DISTINCT bp.category) FILTER (WHERE bp.category IS NOT NULL) as categories
FROM agency_budget_authority ba
LEFT JOIN budget_programs bp ON ba.agency = bp.agency AND ba.fiscal_year = bp.fiscal_year
LEFT JOIN agency_pain_points_db pp ON ba.agency = pp.agency
GROUP BY ba.agency, ba.fiscal_year, ba.budget_authority, ba.trend;
```

---

## API Design: /api/budget-intel

### Endpoints

| Query | Response |
|-------|----------|
| `?agency=DOD` | Full budget intel for agency |
| `?naics=541512` | Programs relevant to NAICS |
| `?trend=growing` | Agencies with growing budgets |
| `?trend=surging` | Agencies with surging budgets (>30%) |
| `?category=cybersecurity` | Pain points/programs by category |
| `?mode=opportunities` | Ranked opportunity predictions |
| `?fy=2026` | Specific fiscal year data |

### Response Structure

```typescript
interface BudgetIntelResponse {
  success: boolean;
  query: {
    agency?: string;
    naics?: string;
    trend?: string;
    category?: string;
    fiscalYear?: number;
  };

  // Budget authority summary
  budgetAuthority?: {
    agency: string;
    fy2025: number;
    fy2026: number;
    change: {
      amount: number;
      percent: number;
      trend: string;
    };
  };

  // Identified programs
  programs: BudgetProgram[];

  // Pain points
  painPoints: {
    all: string[];
    byCategory: Record<string, string[]>;
    ndaaItems: string[];
  };

  // Priorities (with funding)
  priorities: Priority[];

  // Opportunity predictions
  opportunities?: OpportunityPrediction[];

  // Recommendations
  recommendations: string[];
}

interface BudgetProgram {
  programName: string;
  agency: string;
  fiscalYear: number;
  requestedAmount: number;
  fundingTrend: string;
  description: string;
  naicsCodes: string[];
  category: string;
  estimatedRfpQuarter?: string;
  procurementLikelihood: number;
  confidenceScore: number;
}

interface Priority {
  agency: string;
  description: string;
  fundingAmount?: number;
  fiscalYear?: string;
  naicsRelevance: string[];
  contractingOpportunities: string;
}

interface OpportunityPrediction {
  programName: string;
  agency: string;
  estimatedValue: number;
  estimatedRfpDate: string;
  naicsMatch: number;
  setAsideLikely: string;
  confidenceScore: number;
  earlyIndicators: string[];
}
```

---

## Skill: /budget-intel

### Usage

```bash
# Agency-focused
/budget-intel DOD
/budget-intel VA cybersecurity

# NAICS-focused
/budget-intel 541512
/budget-intel 541512 --agency=DOD

# Trend analysis
/budget-intel --trend=growing
/budget-intel --trend=surging --fy=2026

# Opportunity predictions
/budget-intel 541512 --mode=opportunities
```

### Skill Definition

```markdown
# /budget-intel [query] [options]

Get early-warning budget intelligence for federal procurement.

## Arguments
- query: Agency abbreviation (DOD, VA, HHS) or NAICS code (541512)

## Options
- --agency: Filter by agency when using NAICS query
- --trend: Filter agencies by budget trend (growing, surging, stable, declining)
- --category: Filter by pain point category (cybersecurity, infrastructure, modernization)
- --mode: Output mode (default, opportunities)
- --fy: Fiscal year (default: current and next)

## Examples
```
/budget-intel DOD                    # DOD budget intelligence
/budget-intel 541512                 # IT services opportunities
/budget-intel VA cybersecurity       # VA cyber pain points
/budget-intel --trend=surging        # Agencies with 30%+ budget growth
/budget-intel 541512 --mode=opportunities  # Ranked predictions
```

## Output
- Budget authority trends (FY25 vs FY26)
- Identified programs with funding
- Pain points and NDAA mandates
- Priority initiatives with timelines
- Opportunity predictions with confidence scores
```

---

## Agent: Budget Intel Agent

### Trigger
- **Scheduled:** Annual during budget season (Feb-May)
- **On-demand:** When new CBJ released
- **API:** `/api/admin/sync-budget-intel`

### Workflow

```
1. CHECK for new CBJ releases
   └── Monitor agency budget pages
   └── Check OMB releases

2. DOWNLOAD CBJ documents
   └── PDF for most agencies
   └── HTML for some

3. EXTRACT programs via AI
   └── Program name, funding, description
   └── Keywords and categories
   └── Contract opportunities mentioned

4. MAP to NAICS codes
   └── AI inference based on description
   └── Historical contract matching
   └── Manual mapping for key programs

5. PREDICT procurement timeline
   └── Based on budget cycle
   └── Historical patterns
   └── NDAA mandates

6. UPSERT to database
   └── budget_programs table
   └── naics_program_mapping

7. NOTIFY users
   └── Match against user profiles
   └── Queue alerts for delivery
```

### Configuration

```typescript
interface BudgetIntelAgentConfig {
  agencies: string[];           // Which agencies to process
  fiscalYear: number;           // Target FY
  minProgramValue: number;      // Min $ to include (default: 1M)
  aiModel: string;              // 'gpt-4o' | 'claude-3-opus'
  extractionPrompt: string;     // AI prompt for extraction
  naicsMappingConfidence: number; // Min confidence (default: 0.7)
}
```

---

## NAICS Mapping Strategy

### Automated Mapping (AI)

```typescript
async function mapProgramToNaics(program: BudgetProgram): Promise<NaicsMapping[]> {
  const prompt = `
    Given this federal budget program:

    Agency: ${program.agency}
    Program: ${program.programName}
    Description: ${program.description}

    Return the top 3 most relevant NAICS codes with confidence scores.
    Consider:
    - Primary service/product being acquired
    - Historical contracts for similar programs
    - Agency procurement patterns

    Format: [{ "naics": "541512", "confidence": 0.85, "reasoning": "..." }]
  `;

  // Call AI and parse response
}
```

### Historical Mapping

```typescript
async function inferNaicsFromHistory(
  agency: string,
  programKeywords: string[]
): Promise<NaicsMapping[]> {
  // Query USASpending for contracts with similar keywords
  // Extract most common NAICS codes
  // Return with confidence based on frequency
}
```

### Manual Mapping (High-Value Programs)

Pre-mapped critical programs:

| Agency | Program | NAICS Codes |
|--------|---------|-------------|
| DOD | JADC2 | 541512, 541519, 541330 |
| DOD | Hypersonic Weapons | 336414, 541715, 541330 |
| VA | EHRM | 541512, 541511, 541519 |
| DHS | Border Technology | 541512, 541330, 561621 |
| HHS | AI in Healthcare | 541512, 541511, 541715 |

---

## Opportunity Prediction Algorithm

```typescript
function predictOpportunity(
  program: BudgetProgram,
  painPoints: PainPoint[],
  recompetes: RecompeteOpportunity[]
): OpportunityPrediction {

  let score = 0;
  const indicators: string[] = [];

  // 1. Budget trend (max 25 points)
  if (program.fundingTrend === 'new') {
    score += 25;
    indicators.push('New program funding');
  } else if (program.fundingTrend === 'growing') {
    score += 20;
    indicators.push('Growing budget');
  }

  // 2. Pain point alignment (max 25 points)
  const matchingPainPoints = painPoints.filter(pp =>
    pp.naicsCodes.some(n => program.naicsCodes.includes(n))
  );
  if (matchingPainPoints.length > 2) {
    score += 25;
    indicators.push(`${matchingPainPoints.length} aligned pain points`);
  }

  // 3. NDAA mandate (max 20 points)
  if (program.keywords.some(k => k.includes('NDAA') || k.includes('mandate'))) {
    score += 20;
    indicators.push('Congressional mandate');
  }

  // 4. Recompete timing (max 15 points)
  const relatedRecompetes = recompetes.filter(r =>
    r.agency === program.agency &&
    program.naicsCodes.includes(r.naicsCode)
  );
  if (relatedRecompetes.length > 0) {
    score += 15;
    indicators.push(`${relatedRecompetes.length} related recompetes`);
  }

  // 5. Historical procurement pattern (max 15 points)
  // Based on how often this agency buys this NAICS

  return {
    programName: program.programName,
    agency: program.agency,
    estimatedValue: program.requestedAmount,
    confidenceScore: score / 100,
    earlyIndicators: indicators,
    // ... other fields
  };
}
```

---

## Integration with Existing Systems

### Daily Briefings Integration

```typescript
// In briefing pipeline, include budget intel
async function generateBriefing(profile: UserProfile): Promise<Briefing> {
  const budgetIntel = await fetchBudgetIntel({
    naics: profile.naicsCodes,
    agencies: profile.targetAgencies,
  });

  // Include top 3 budget opportunities in briefing
  briefing.budgetInsights = budgetIntel.opportunities.slice(0, 3);
}
```

### Market Scan Integration

```typescript
// In market-scan, add budget context
async function marketScan(naics: string, state: string) {
  const spending = await getSpendingData(naics, state);
  const budgetIntel = await getBudgetIntel({ naics });

  return {
    ...spending,
    budgetContext: {
      growingAgencies: budgetIntel.agencies.filter(a => a.trend === 'growing'),
      relevantPrograms: budgetIntel.programs,
      earlyOpportunities: budgetIntel.opportunities,
    }
  };
}
```

### Federation Layer

```typescript
// /api/market-intelligence unified query
{
  "spending": { ... },          // from market-scan
  "recompetes": { ... },        // from recompete API
  "budget": {                   // from budget-intel
    "growingAgencies": [...],
    "programs": [...],
    "opportunities": [...]
  },
  "forecasts": { ... },         // from agency-forecasts
  "events": { ... }             // from federal-events
}
```

---

## Implementation Priority

### Phase 1: API Unification (Day 1-2)
- [ ] Create `/api/budget-intel` endpoint
- [ ] Combine existing JSON data sources
- [ ] Add NAICS filtering to pain points
- [ ] Deploy and test

### Phase 2: Database Migration (Day 3-4)
- [ ] Run SQL migration
- [ ] Import existing JSON to database
- [ ] Add NAICS mappings for top 50 programs
- [ ] Verify queries work

### Phase 3: Intelligence Layer (Day 5-7)
- [ ] Build opportunity prediction algorithm
- [ ] Create NAICS mapping service
- [ ] Add timeline estimation
- [ ] Integrate with briefings

### Phase 4: Skill & Agent (Week 2)
- [ ] Create `/budget-intel` slash command
- [ ] Build CBJ extraction agent
- [ ] Set up annual refresh workflow
- [ ] Documentation

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Programs tracked | 500+ per fiscal year |
| NAICS mapping accuracy | >80% |
| Opportunity prediction accuracy | >60% (RFP within 6 months of prediction) |
| User engagement | 30% of briefing readers click budget insights |
| API response time | <500ms |

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/20260405_budget_intelligence.sql` | Database schema |
| `src/app/api/budget-intel/route.ts` | Main API endpoint |
| `src/lib/budget-intel/index.ts` | Core logic exports |
| `src/lib/budget-intel/naics-mapper.ts` | NAICS mapping service |
| `src/lib/budget-intel/opportunity-predictor.ts` | Prediction algorithm |
| `src/lib/agents/budget-intel-agent.ts` | CBJ extraction agent |
| `~/.claude/commands/budget-intel.md` | Slash command |
| `docs/intelligence-systems/budget-intel.md` | Documentation |

---

*Last Updated: April 5, 2026*
