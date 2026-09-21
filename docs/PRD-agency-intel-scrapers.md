# PRD: Agency Intelligence Scrapers

## Purpose
Build scrapers to collect **real public data** for agency pain points expansion (250 → 400+ agencies).

**DO NOT use AI/Groq to generate pain points.** All data must come from authoritative public sources.

---

## Data Sources to Scrape

### 1. Oversight.gov (OIG Reports)
**URL:** https://www.oversight.gov/reports/federal
**Data:** Inspector General reports, audits, investigations
**Method:** Puppeteer scraper (no API available)
**Output:** Top Management Challenges by agency

### 2. GAO High Risk List
**URL:** https://www.gao.gov/high-risk-list
**Data:** 38 high-risk areas with agency mappings
**Method:** Already hardcoded in `federal-oversight-data.ts`
**Output:** Already complete - just needs maintenance

### 3. Agency Budget Justifications
**URL:** Agency websites / congress.gov
**Data:** Congressional Justification documents (PDFs)
**Method:** PDF parsing (pdfjs-dist or similar)
**Output:** Budget priorities and program spending

### 4. Federal IT Dashboard
**URL:** https://itdashboard.gov
**Data:** IT investments, major projects, CIO priorities
**Method:** API available (data.gov)
**Output:** IT modernization challenges and projects

### 5. USASpending Contract Patterns
**URL:** api.usaspending.gov
**Data:** What agencies actually buy (contract types, categories)
**Method:** REST API (already have MCP)
**Output:** Procurement patterns by agency

---

## Implementation Priority

### Phase 1: Manual Data Expansion (THIS WEEK)
No new tools needed - just research and add to existing files:
- Expand `IG_CHALLENGES_BY_AGENCY` in `federal-oversight-data.ts`
- Expand `AGENCY_SPENDING_PRIORITIES` in `federal-oversight-data.ts`
- Add more agencies from public OIG reports

### Phase 2: Oversight.gov Scraper (NEXT)
```typescript
// src/lib/scrapers/oversight-gov.ts
interface OIGReport {
  agency: string;
  title: string;
  reportType: 'audit' | 'evaluation' | 'investigation' | 'semiannual';
  publishDate: string;
  url: string;
  recommendations?: string[];
}

async function scrapeOversightGov(agency?: string): Promise<OIGReport[]> {
  // Use Puppeteer to scrape https://www.oversight.gov/reports/federal
  // Filter by report type = "Top Management Challenges" or "Semiannual Report"
}
```

### Phase 3: IT Dashboard API Integration
```typescript
// src/lib/scrapers/it-dashboard.ts
interface ITInvestment {
  agency: string;
  projectName: string;
  totalLifecycleCost: number;
  status: 'green' | 'yellow' | 'red';
  riskLevel: string;
  description: string;
}

async function fetchITDashboardData(agency?: string): Promise<ITInvestment[]> {
  // Use public API from itdashboard.gov / data.gov
}
```

### Phase 4: Admin Endpoint
```bash
# Trigger data refresh
POST /api/admin/refresh-agency-intel?password=xxx

# Preview what would be added
GET /api/admin/refresh-agency-intel?password=xxx&mode=preview
```

---

## Data Quality Rules

1. **All data must have a source URL** - traceability required
2. **No AI-generated content** - only real public data
3. **Include publication date** - for freshness tracking
4. **Deduplicate across sources** - merge similar pain points
5. **Validate agency names** - match to canonical agency list

---

## Current State

| Source | Status | Agencies Covered |
|--------|--------|------------------|
| GAO High Risk List | ✅ Complete | 38 areas, all agencies |
| IG Challenges (manual) | ⚠️ 20 agencies | Need 80+ more |
| Budget Priorities (manual) | ⚠️ 10 agencies | Need 40+ more |
| Oversight.gov Scraper | ❌ Not built | Would cover 73 OIGs |
| IT Dashboard API | ✅ Built | 24 CFO Act agencies |
| USASpending API | ✅ Built | All agencies |
| GovInfo API | ✅ Built | All agencies (GAO reports) |
| Perplexity Verification | ✅ Built | Verification layer |

---

## Implementation Complete (April 19, 2026)

### Database Schema
**File:** `supabase/migrations/20260419_agency_intelligence.sql`

| Table | Purpose |
|-------|---------|
| `agency_intelligence` | Main intelligence storage (GAO, IG, IT, spending) |
| `intelligence_sync_runs` | Track sync operations |
| `intelligence_sources` | API source configuration |

### API Library
**Location:** `src/lib/agency-intelligence/`

| File | Purpose |
|------|---------|
| `types.ts` | TypeScript types for all data structures |
| `index.ts` | Main module exports and sync functions |
| `verifier.ts` | Perplexity verification layer |
| `fetchers/govinfo.ts` | GovInfo API (GAO reports, budget docs) |
| `fetchers/it-dashboard.ts` | IT Dashboard API (24 CFO agencies) |
| `fetchers/usaspending.ts` | USASpending API (spending patterns) |

### Admin Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/admin/apply-agency-intel-migration` | Check/apply database migration |
| `/api/admin/sync-agency-intel` | Sync data from all APIs |

**Usage:**
```bash
# Check migration status
GET /api/admin/apply-agency-intel-migration?password=xxx

# Check sync status
GET /api/admin/sync-agency-intel?password=xxx

# Preview sync (dry run)
GET /api/admin/sync-agency-intel?password=xxx&mode=preview

# Run full sync
POST /api/admin/sync-agency-intel?password=xxx

# Sync with Perplexity verification
POST /api/admin/sync-agency-intel?password=xxx&verify=true

# Sync specific source
POST /api/admin/sync-agency-intel?password=xxx&source=it-dashboard
```

### Environment Variables Required

| Variable | Purpose |
|----------|---------|
| `GOVINFO_API_KEY` | GovInfo API access (get from api.data.gov) |
| `PERPLEXITY_API_KEY` | Perplexity AI for fact verification |

---

## Success Criteria

- [x] Database schema for agency intelligence
- [x] IT Dashboard API integration (24 CFO Act agencies) — *API endpoint deprecated, skip for now*
- [x] USASpending API integration (all agencies) — **111 agencies, 111 contract_pattern records**
- [x] GovInfo API integration (GAO reports) — **446 gao_high_risk records** (POST method + topic mapping)
- [x] Perplexity verification layer
- [x] Admin endpoints for sync and status
- [x] **118 unique agencies** in intelligence database
- [x] **557 total records** from real public sources
- [x] All records traceable to source documents
- [x] **Merged into static JSON** — 307 agencies (was 250), 3,045 pain points, 2,611 priorities
- [x] **Unified API created** — `getUnifiedAgencyIntelligence()` combines static + database
- [ ] Automated refresh capability (monthly cron)
- [x] Zero AI-generated content

### Current Agency Coverage (April 19, 2026)

**Top 10 Agencies by Record Count:**
| Agency | Records |
|--------|---------|
| General Government (uncategorized) | 141 |
| Department of Homeland Security | 41 |
| Environmental Protection Agency | 36 |
| Department of Veterans Affairs | 29 |
| Department of Transportation | 28 |
| Department of Health and Human Services | 27 |
| Department of the Treasury | 23 |
| Department of Defense | 22 |
| Securities and Exchange Commission | 19 |
| Department of Commerce | 16 |

**Intelligence Types:**
- `gao_high_risk` — 446 records (GAO oversight reports)
- `contract_pattern` — 111 records (USASpending spending data)

---

## API Usage

### Check Sync Status
```bash
curl "https://tools.govcongiants.org/api/admin/sync-agency-intel?password=xxx"
```

### Preview Sync (Dry Run)
```bash
curl "https://tools.govcongiants.org/api/admin/sync-agency-intel?password=xxx&mode=preview"
```

### Run Full Sync
```bash
curl -X POST "https://tools.govcongiants.org/api/admin/sync-agency-intel?password=xxx"
```

### Sync with Perplexity Verification
```bash
curl -X POST "https://tools.govcongiants.org/api/admin/sync-agency-intel?password=xxx&verify=true"
```

### Query Agency Intel in Code
```typescript
import { getIntelligenceForBriefing, getAgencyIntelligence } from '@/lib/agency-intelligence';

// For briefing pipeline - get intel based on user's agencies
const intel = await getIntelligenceForBriefing(['DOD', 'VA'], 10);

// For specific agency lookup
const dodIntel = await getAgencyIntelligence('Department of Defense');
```

---

---

## Unified API Usage (NEW)

The unified API combines static JSON (307 agencies) with Supabase database (557 records) for the richest intelligence possible.

### Import

```typescript
import {
  getUnifiedAgencyIntelligence,
  getAgencyPainPointsUnified,
  getAgencyPrioritiesUnified,
  getUnifiedIntelligenceForAgencies,
  searchAgencies,
  getAllAgenciesList,
  getIntelligenceStats,
} from '@/lib/agency-intelligence';
```

### Functions

#### `getUnifiedAgencyIntelligence(agencyName: string)`
Returns combined intelligence from both sources:
```typescript
const intel = await getUnifiedAgencyIntelligence('Department of Defense');
// Returns:
// {
//   agencyName: 'Department of Defense',
//   painPoints: ['DoD Financial Management (Source: GAO)', ...],
//   priorities: ['FY2026 Contract Spending: $387B', ...],
//   gaoReports: ['DoD Contract Management', ...],
//   spendingPatterns: ['Total obligated: $387.1B', ...],
//   sources: ['static', 'database']
// }
```

#### `getAgencyPainPointsUnified(agencyName: string, limit?: number)`
Returns deduplicated pain points (default limit 20):
```typescript
const painPoints = await getAgencyPainPointsUnified('VA', 10);
// Returns: ['EHR modernization issues', 'Claims processing backlog', ...]
```

#### `getAgencyPrioritiesUnified(agencyName: string, limit?: number)`
Returns deduplicated priorities:
```typescript
const priorities = await getAgencyPrioritiesUnified('DHS', 10);
// Returns: ['Border security technology', 'Cybersecurity infrastructure', ...]
```

#### `getUnifiedIntelligenceForAgencies(agencies: string[])`
Batch fetch for multiple agencies (efficient for reports):
```typescript
const map = await getUnifiedIntelligenceForAgencies(['DOD', 'VA', 'DHS']);
// Returns: Map<string, UnifiedAgencyIntel>
```

#### `searchAgencies(query: string, limit?: number)`
Search agencies by name, pain points, or priorities:
```typescript
const matches = searchAgencies('cybersecurity', 10);
// Returns: ['Department of Homeland Security', 'Department of Defense', ...]
```

#### `getAllAgenciesList()`
Get all 307 agency names:
```typescript
const agencies = getAllAgenciesList();
// Returns: ['400 Years of African-American History Commission', ...]
```

#### `getIntelligenceStats()`
Get system stats:
```typescript
const stats = getIntelligenceStats();
// Returns: { staticAgencyCount: 307, staticPainPointCount: 3045, staticPriorityCount: 2611 }
```

---

*Created: April 19, 2026*
*Updated: April 19, 2026 — Merged to 307 agencies, unified API created, 3,045 pain points, 2,611 priorities*
