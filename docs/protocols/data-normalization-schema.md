# Data Normalization Schema

> Unified data format for opportunities from all sources

## Overview

The Federal Market Scanner aggregates opportunities from multiple sources (SAM.gov, Grants.gov, NIH Reporter, forecasts, recompetes). This document defines the normalized format that enables:

1. Unified search across all sources
2. Consistent scoring and ranking
3. Deduplication
4. Source-agnostic user interfaces

---

## Normalized Opportunity Schema

```typescript
interface NormalizedOpportunity {
  // === IDENTITY ===
  id: string;                    // Internal UUID
  externalId: string;            // Source's ID (notice ID, grant number, etc.)
  source: SourceId;              // Which source this came from
  sourceUrl: string;             // Link to original listing

  // === CLASSIFICATION ===
  opportunityType: OpportunityType;
  status: OpportunityStatus;

  // === CORE FIELDS ===
  title: string;
  description?: string;          // May be truncated
  agency: string;                // Normalized agency name
  subAgency?: string;            // Bureau/office level

  // === CODES ===
  naicsCode?: string;            // Primary NAICS
  naicsCodes?: string[];         // All applicable NAICS
  pscCode?: string;              // Product/Service Code
  cfda?: string;                 // For grants

  // === VALUE ===
  estimatedValue?: number;       // In USD
  valueRange?: {
    min: number;
    max: number;
  };
  awardCeiling?: number;         // Max possible award

  // === DATES ===
  postedDate?: string;           // ISO date
  closeDate?: string;            // ISO date (deadline)
  responseDeadline?: string;     // ISO datetime with timezone
  archiveDate?: string;          // When it leaves active status

  // === LOCATION ===
  placeOfPerformance?: {
    state?: string;              // 2-letter code
    city?: string;
    zip?: string;
    country?: string;            // Default 'USA'
    remote?: boolean;            // Telework eligible
  };

  // === SET-ASIDES ===
  setAside?: SetAsideType;
  setAsideDescription?: string;

  // === CONTACTS ===
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
    title?: string;
  };
  contractingOffice?: string;

  // === METADATA ===
  rawData?: Record<string, any>; // Original source data
  scrapedAt: string;             // When we captured it
  updatedAt: string;             // Last update
  contentHash: string;           // For change detection

  // === SCORING (computed) ===
  relevanceScore?: number;       // 0-100, user-specific
  priorityScore?: number;        // 0-100, urgency-based
}
```

---

## Enums

### SourceId

```typescript
type SourceId =
  | 'sam_gov'          // SAM.gov opportunities
  | 'sam_forecast'     // Acquisition Gateway forecasts
  | 'grants_gov'       // Grants.gov
  | 'nih_reporter'     // NIH RePORTER (SBIR/STTR)
  | 'recompete'        // Derived from USASpending
  | 'nsf_sbir'         // NSF SBIR/STTR
  | 'darpa_baa'        // DARPA BAAs
  | 'event'            // Federal events (industry days, etc.)
  ;
```

### OpportunityType

```typescript
type OpportunityType =
  // Contracts
  | 'solicitation'     // Active RFP/RFQ
  | 'presolicitation'  // Sources sought, RFI, draft RFP
  | 'award'            // Contract award notice
  | 'modification'     // Contract modification
  | 'forecast'         // Planned procurement

  // Grants & Research
  | 'grant'            // Grant opportunity
  | 'cooperative_agreement'
  | 'sbir_sttr'        // Small Business Innovation Research

  // Special
  | 'recompete'        // Expiring contract (derived)
  | 'event'            // Industry day, conference
  | 'other'
  ;
```

### OpportunityStatus

```typescript
type OpportunityStatus =
  | 'active'           // Currently accepting responses
  | 'forecasted'       // Not yet posted
  | 'closed'           // Past deadline
  | 'cancelled'        // Withdrawn
  | 'awarded'          // Award made
  | 'archived'         // No longer relevant
  ;
```

### SetAsideType

```typescript
type SetAsideType =
  | 'SBA'              // Small Business
  | '8A'               // 8(a) Program
  | 'WOSB'             // Women-Owned Small Business
  | 'EDWOSB'           // Economically Disadvantaged WOSB
  | 'SDVOSB'           // Service-Disabled Veteran-Owned
  | 'VOSB'             // Veteran-Owned Small Business
  | 'HUBZone'          // HUBZone
  | 'ISBEE'            // Indian Small Business Economic Enterprise
  | 'FULL_OPEN'        // Full and Open Competition
  | 'MULTIPLE'         // Multiple set-asides
  | 'OTHER'
  ;
```

---

## Source Mappings

### SAM.gov → Normalized

```typescript
function normalizeSamOpportunity(sam: SamOpportunity): NormalizedOpportunity {
  return {
    id: generateUUID(),
    externalId: sam.noticeId,
    source: 'sam_gov',
    sourceUrl: `https://sam.gov/opp/${sam.noticeId}/view`,

    opportunityType: mapSamNoticeType(sam.type),
    // p = presolicitation, r = sources sought, k = combined synopsis
    // o = solicitation, s = special notice, i = intent to sole source

    status: sam.active ? 'active' : 'closed',

    title: sam.title,
    description: sam.description?.substring(0, 5000),
    agency: normalizeAgencyName(sam.fullParentPathName),
    subAgency: sam.organizationName,

    naicsCode: sam.naicsCode,
    pscCode: sam.classificationCode,

    estimatedValue: parseValue(sam.award?.amount),

    postedDate: sam.postedDate,
    closeDate: sam.responseDeadLine,
    archiveDate: sam.archiveDate,

    placeOfPerformance: {
      state: sam.placeOfPerformance?.state?.code,
      city: sam.placeOfPerformance?.city?.name,
      zip: sam.placeOfPerformance?.zip,
      country: sam.placeOfPerformance?.country?.code || 'USA'
    },

    setAside: mapSamSetAside(sam.typeOfSetAsideDescription),

    contact: {
      name: sam.pointOfContact?.[0]?.fullName,
      email: sam.pointOfContact?.[0]?.email,
      phone: sam.pointOfContact?.[0]?.phone
    },

    contractingOffice: sam.officeAddress?.city,

    rawData: sam,
    scrapedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contentHash: hashContent(sam)
  };
}
```

### Grants.gov → Normalized

```typescript
function normalizeGrantOpportunity(grant: GrantsGovOpp): NormalizedOpportunity {
  return {
    id: generateUUID(),
    externalId: grant.opportunityNumber,
    source: 'grants_gov',
    sourceUrl: `https://www.grants.gov/search-results-detail/${grant.opportunityId}`,

    opportunityType: grant.opportunityCategory === 'D' ? 'grant' : 'cooperative_agreement',
    status: mapGrantStatus(grant.oppStatus),

    title: grant.opportunityTitle,
    description: grant.synopsis?.synopsisDesc,
    agency: normalizeAgencyName(grant.agencyName),
    subAgency: grant.agencyCode,

    cfda: grant.cfdaNumber,

    estimatedValue: grant.awardCeiling,
    valueRange: {
      min: grant.awardFloor || 0,
      max: grant.awardCeiling || 0
    },

    postedDate: grant.postDate,
    closeDate: grant.closeDate,

    setAside: mapGrantEligibility(grant.eligibleApplicants),

    rawData: grant,
    scrapedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contentHash: hashContent(grant)
  };
}
```

### NIH RePORTER → Normalized

```typescript
function normalizeNIHProject(project: NIHProject): NormalizedOpportunity {
  return {
    id: generateUUID(),
    externalId: project.appl_id.toString(),
    source: 'nih_reporter',
    sourceUrl: `https://reporter.nih.gov/project-details/${project.appl_id}`,

    opportunityType: detectNIHType(project.project_num),
    // R43/R41 = SBIR/STTR Phase I
    // R44/R42 = SBIR/STTR Phase II

    status: project.is_active ? 'active' : 'archived',

    title: project.project_title,
    description: project.abstract_text,
    agency: `NIH - ${project.agency_ic_fundings?.[0]?.name}`,
    subAgency: project.agency_ic_fundings?.[0]?.code,

    naicsCode: '541714', // R&D in Biotechnology

    estimatedValue: project.award_amount || sumFunding(project.agency_ic_fundings),

    postedDate: project.award_notice_date,
    closeDate: project.budget_end,

    placeOfPerformance: {
      state: project.organization?.org_state,
      city: project.organization?.org_city
    },

    rawData: project,
    scrapedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contentHash: hashContent(project)
  };
}
```

### Recompete (USASpending) → Normalized

```typescript
function normalizeRecompete(contract: ExpiringContract): NormalizedOpportunity {
  return {
    id: generateUUID(),
    externalId: contract.award_id,
    source: 'recompete',
    sourceUrl: `https://www.usaspending.gov/award/${contract.award_id}`,

    opportunityType: 'recompete',
    status: 'forecasted',  // Not yet solicited

    title: `Recompete: ${contract.description || contract.piid}`,
    description: `Contract ${contract.piid} expiring ${contract.period_of_performance_end}. ` +
                 `Current incumbent: ${contract.recipient_name}. ` +
                 `Value: $${contract.current_value.toLocaleString()}.`,

    agency: normalizeAgencyName(contract.awarding_agency),
    subAgency: contract.awarding_sub_agency,

    naicsCode: contract.naics_code,
    pscCode: contract.psc_code,

    estimatedValue: contract.current_value,

    closeDate: contract.period_of_performance_end,  // Contract expiration

    placeOfPerformance: {
      state: contract.place_of_performance_state
    },

    setAside: mapUSASpendingSetAside(contract.type_of_set_aside),

    rawData: {
      piid: contract.piid,
      incumbent: contract.recipient_name,
      incumbent_uei: contract.recipient_uei,
      original_value: contract.current_value,
      start_date: contract.period_of_performance_start
    },

    scrapedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contentHash: hashContent(contract)
  };
}
```

---

## Deduplication

### Duplicate Detection

```typescript
interface DedupeKey {
  source: SourceId;
  externalId: string;
}

// Primary key for deduplication
const dedupeKey = `${opportunity.source}:${opportunity.externalId}`;

// Content change detection
const contentChanged = existingOpp.contentHash !== newOpp.contentHash;
```

### Cross-Source Matching

Sometimes the same opportunity appears in multiple sources. Match on:

1. **Same solicitation number** across SAM.gov and forecasts
2. **Same grant number** across Grants.gov statuses
3. **Similar title + agency + NAICS** (fuzzy match)

```typescript
function findCrossSourceMatch(opp: NormalizedOpportunity): string | null {
  // Check for exact solicitation number match
  if (opp.rawData?.solicitationNumber) {
    const match = await db.query(`
      SELECT id FROM aggregated_opportunities
      WHERE raw_data->>'solicitationNumber' = $1
      AND source != $2
    `, [opp.rawData.solicitationNumber, opp.source]);

    if (match) return match.id;
  }

  // Fuzzy match on title + agency (for forecasts → solicitations)
  // ...

  return null;
}
```

---

## Database Schema

```sql
CREATE TABLE aggregated_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,

  opportunity_type TEXT,
  status TEXT DEFAULT 'active',

  title TEXT NOT NULL,
  description TEXT,
  agency TEXT,
  sub_agency TEXT,

  naics_code TEXT,
  naics_codes TEXT[],
  psc_code TEXT,
  cfda TEXT,

  estimated_value NUMERIC,
  value_min NUMERIC,
  value_max NUMERIC,

  posted_date DATE,
  close_date DATE,
  archive_date DATE,

  pop_state TEXT,
  pop_city TEXT,
  pop_zip TEXT,
  pop_country TEXT DEFAULT 'USA',

  set_aside TEXT,

  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contracting_office TEXT,

  raw_data JSONB,
  content_hash TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Indexes
  CONSTRAINT unique_source_external UNIQUE (source, external_id)
);

-- Performance indexes
CREATE INDEX idx_agg_opp_naics ON aggregated_opportunities(naics_code);
CREATE INDEX idx_agg_opp_agency ON aggregated_opportunities(agency);
CREATE INDEX idx_agg_opp_status ON aggregated_opportunities(status);
CREATE INDEX idx_agg_opp_source ON aggregated_opportunities(source);
CREATE INDEX idx_agg_opp_close_date ON aggregated_opportunities(close_date);
CREATE INDEX idx_agg_opp_posted_date ON aggregated_opportunities(posted_date);

-- Full-text search
CREATE INDEX idx_agg_opp_fts ON aggregated_opportunities
  USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));
```

---

## Scoring

### Relevance Score (User-Specific)

```typescript
function calculateRelevanceScore(
  opp: NormalizedOpportunity,
  profile: UserProfile
): number {
  let score = 0;

  // NAICS match: 0-30 points
  if (profile.naicsCodes?.includes(opp.naicsCode)) {
    score += 30;
  } else if (opp.naicsCodes?.some(n => profile.naicsCodes?.includes(n))) {
    score += 20;
  }

  // State match: 0-20 points
  if (profile.states?.includes(opp.placeOfPerformance?.state)) {
    score += 20;
  }

  // Set-aside match: 0-25 points
  if (profile.setAsides?.includes(opp.setAside)) {
    score += 25;
  }

  // Agency match (past work): 0-15 points
  if (profile.pastAgencies?.includes(opp.agency)) {
    score += 15;
  }

  // Capability keyword match: 0-10 points
  const keywordMatches = countKeywordMatches(opp, profile.capabilities);
  score += Math.min(keywordMatches * 2, 10);

  return Math.min(score, 100);
}
```

### Priority Score (Urgency-Based)

```typescript
function calculatePriorityScore(opp: NormalizedOpportunity): number {
  let score = 50;  // Base

  // Time urgency: -20 to +30
  const daysUntilClose = daysBetween(new Date(), opp.closeDate);
  if (daysUntilClose < 7) score += 30;       // Urgent
  else if (daysUntilClose < 14) score += 20;
  else if (daysUntilClose < 30) score += 10;
  else if (daysUntilClose > 90) score -= 10;
  else if (daysUntilClose > 180) score -= 20;

  // Value bonus: 0-20
  if (opp.estimatedValue > 1_000_000) score += 20;
  else if (opp.estimatedValue > 500_000) score += 15;
  else if (opp.estimatedValue > 100_000) score += 10;

  // Type boost
  if (opp.opportunityType === 'solicitation') score += 10;
  if (opp.opportunityType === 'recompete') score += 5;

  return Math.max(0, Math.min(score, 100));
}
```

---

## Related Documentation

| Doc | Purpose |
|-----|---------|
| `skill-to-tool-handoff.md` | How skills request this data |
| `data-flow-architecture.md` | Where normalized data flows |
| `component-registry.md` | Which tools produce this data |

---

*Last Updated: April 5, 2026*
