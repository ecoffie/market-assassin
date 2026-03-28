# SAM.gov API Reference

Complete reference for SAM.gov APIs used in GovCon Giants tools.

---

## Overview

**FPDS.gov retired February 24, 2026.** All federal contract data now flows through SAM.gov APIs.

| API | Purpose | Tool Integration | Status |
|-----|---------|------------------|--------|
| Opportunities API | Active solicitations | Opportunity Hunter | ✅ Working |
| Contract Awards API | Historical contracts, bids, mods | Recompete Tracker | ✅ USASpending fallback |
| Entity Management API | Contractor registration, certs | Contractor Database | ✅ Working |
| Subaward Reporting API | Prime→Sub relationships | Market Assassin | ⏳ Needs System Account |
| Federal Hierarchy API | Agency org structure | Market Assassin | ✅ Working |

### System Account Requirement

**Contract Awards** and **Subaward** APIs require a SAM.gov **System Account** (not just a public API key).

- Public API key works for: Opportunities, Entity, Federal Hierarchy
- System Account required for: Contract Awards, Subaward
- System Account request: 1-4 weeks approval time

**Current workaround:** USASpending.gov API provides bid count data without authentication. We use it as the primary source for Contract Awards until System Account is approved.

---

## Authentication

All SAM.gov APIs use API key authentication.

```bash
# Header format
Authorization: Bearer YOUR_API_KEY

# Or query parameter (deprecated but still works)
?api_key=YOUR_API_KEY
```

### API Keys

| API | Env Variable | Registration |
|-----|--------------|--------------|
| Opportunities | `SAM_API_KEY` | Existing - works |
| Contract Awards | `SAM_CONTRACT_AWARDS_API_KEY` | Same key MAY work |
| Entity Management | `SAM_ENTITY_API_KEY` | Same key MAY work |
| Subaward | `SAM_SUBAWARD_API_KEY` | Same key MAY work |
| Federal Hierarchy | `SAM_HIERARCHY_API_KEY` | Same key MAY work |

**Note:** Test with existing `SAM_API_KEY` first. If rate limited or rejected, register for additional keys at [api.sam.gov](https://api.sam.gov).

---

## Rate Limits

| Tier | Requests/Day | Requests/Min |
|------|--------------|--------------|
| Standard | 1,000 | 10 |
| Elevated | 10,000 | 100 |
| Enterprise | Unlimited | Contact GSA |

**Our Strategy:**
- Cache responses in Supabase (24h TTL)
- Batch requests where possible (up to 100 NAICS)
- Fall back to USASpending if SAM rate limited
- Implement exponential backoff on 429 errors

---

## API 1: Opportunities API (Existing)

**Base URL:** `https://api.sam.gov/opportunities/v2`

### Search Opportunities

```bash
GET /search
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `api_key` | string | API key |
| `postedFrom` | date | YYYY-MM-DD |
| `postedTo` | date | YYYY-MM-DD |
| `naics` | string | Single NAICS code (NOT comma-separated) |
| `state` | string | State code (FL, VA, etc.) |
| `setAside` | string | SBA, 8A, WOSB, SDVOSB, HUBZone |
| `keywords` | string | Search terms |
| `limit` | number | Max 100 |

**Example:**
```bash
curl "https://api.sam.gov/opportunities/v2/search?api_key=XXX&naics=541512&state=FL&limit=25"
```

**Response:**
```json
{
  "totalRecords": 150,
  "opportunitiesData": [
    {
      "noticeId": "abc123",
      "title": "IT Support Services",
      "solicitationNumber": "W912HQ-26-R-0001",
      "department": "DEPT OF DEFENSE",
      "subtier": "ARMY",
      "office": "W7N6 ACC-APG DIR",
      "postedDate": "2026-03-20",
      "responseDeadLine": "2026-04-15",
      "naicsCode": "541512",
      "classificationCode": "D302",
      "setAside": "Total Small Business Set-Aside",
      "pointOfContact": [...],
      "description": "..."
    }
  ]
}
```

### Get Opportunity Details

```bash
GET /search?noticeId={noticeId}
```

---

## API 2: Contract Awards API (NEW - FPDS Replacement)

**Base URL:** `https://api.sam.gov/contract-awards/v1`

> **Note:** This API requires a SAM.gov System Account. We use USASpending.gov as the primary source until System Account is approved. See [USASpending Fallback](#usaspending-fallback) section.

### Search Awards

```bash
GET /contracts/search
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `naics_code` | string | NAICS code |
| `agency_code` | string | Agency code (e.g., 3600 for VA) |
| `vendor_uei` | string | Contractor UEI |
| `date_signed_from` | date | Start date |
| `date_signed_to` | date | End date |
| `extent_competed` | string | Competition type |
| `page` | number | Page number |
| `size` | number | Results per page (max 100) |

**Example:**
```bash
curl "https://api.sam.gov/prod/contract-data/v1/contracts/search?api_key=XXX&naics_code=541512&size=50"
```

**Response Fields:**

| Field | Type | Use For |
|-------|------|---------|
| `piid` | string | Contract ID |
| `contract_award_unique_key` | string | Unique identifier |
| `recipient_name` | string | Contractor name |
| `recipient_uei` | string | UEI (replaces DUNS) |
| `awarding_agency_name` | string | Agency |
| `naics_code` | string | NAICS |
| `total_obligation` | number | Contract value |
| `current_total_value_of_award` | number | Current value |
| `base_and_exercised_options_value` | number | Total potential |
| `period_of_performance_start_date` | date | Start |
| `period_of_performance_current_end_date` | date | Current end |
| `period_of_performance_potential_end_date` | date | Potential end |
| `number_of_offers_received` | number | **BID COUNT** |
| `extent_competed` | string | Competition type |
| `type_of_contract_pricing` | string | FFP, T&M, etc. |
| `modification_number` | string | Mod number |

### Get Contract Family (Base + Mods)

```bash
GET /contracts/{piid}/family
```

Returns base award plus all modifications. Useful for:
- Tracking total modifications (trouble indicator)
- Finding original award vs current value
- Identifying option exercises

### Competition Types (`extent_competed`)

| Code | Description | Bid Opportunity |
|------|-------------|-----------------|
| `A` | Full and Open | Standard competition |
| `B` | Not Available for Competition | None |
| `C` | Not Competed | Sole source |
| `D` | Full and Open (Excl. Sources) | Limited |
| `E` | Follow-On to Competed | Incumbent advantage |
| `F` | Competed under SAP | Simplified |
| `G` | Not Competed under SAP | Small purchase |
| `CDO` | Competed under BPA | BPA holders only |
| `NDO` | Not Competed under BPA | Incumbent only |

### Key Intelligence Queries

```bash
# Expiring contracts by NAICS (recompete targets)
GET /contracts/search?naics_code=541512&period_of_performance_current_end_date_from=2026-03-01&period_of_performance_current_end_date_to=2027-03-01

# Low competition contracts (sole source and 1-2 bidders)
GET /contracts/search?naics_code=541512&number_of_offers_received_to=2

# Competitor's contract portfolio
GET /contracts/search?recipient_uei=XXXXXXXXX

# Recent modifications (trouble indicators)
GET /contracts/{piid}/family
```

---

## API 3: Entity Management API

**Base URL:** `https://api.sam.gov/entity-information/v3`

### Search Entities

```bash
GET /entities
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `legalBusinessName` | string | Company name |
| `ueiSAM` | string | UEI |
| `cageCode` | string | CAGE code |
| `registrationStatus` | string | Active, Inactive, Expired |
| `naicsCode` | string | NAICS filter |
| `stateCode` | string | State |
| `sbaBusinessTypes` | string | 8(a), WOSB, etc. |
| `page` | number | Page number |
| `size` | number | Results per page |

**Example:**
```bash
curl "https://api.sam.gov/entity-information/v3/entities?api_key=XXX&legalBusinessName=Booz&stateCode=VA"
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `ueiSAM` | string | Unique Entity ID |
| `cageCode` | string | CAGE code |
| `legalBusinessName` | string | Legal name |
| `dbaName` | string | Doing business as |
| `registrationStatus` | string | Active/Inactive/Expired |
| `registrationExpirationDate` | date | SAM expiration |
| `physicalAddress` | object | Business address |
| `mailingAddress` | object | Mailing address |
| `purposeOfRegistration` | string | Federal, grants, etc. |
| `entityStructure` | string | LLC, Corp, etc. |
| `naicsList` | array | All NAICS codes |
| `pscList` | array | PSC codes |
| `sbaBusinessTypes` | array | Certifications |
| `entityCertifications` | object | Detailed cert info |
| `pocList` | array | Points of contact |

### Certification Types (`sbaBusinessTypes`)

| Code | Description |
|------|-------------|
| `2X` | 8(a) Program |
| `XX` | HUBZone |
| `XY` | SDVOSB |
| `23` | WOSB |
| `A2` | EDWOSB |
| `27` | Small Business |

### Get Entity Details

```bash
GET /entities/{ueiSAM}
```

Returns full entity profile including all certifications with expiration dates.

---

## API 4: Subaward Reporting API

**Base URL:** `https://api.sam.gov/prod/subaward/v1`

### Search Subawards

```bash
GET /subawards
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `prime_award_piid` | string | Prime contract ID |
| `prime_awardee_uei` | string | Prime contractor UEI |
| `sub_awardee_uei` | string | Sub contractor UEI |
| `naics_code` | string | NAICS filter |
| `date_submitted_from` | date | Start date |
| `date_submitted_to` | date | End date |
| `page` | number | Page number |
| `size` | number | Results per page |

**Example:**
```bash
curl "https://api.sam.gov/prod/subaward/v1/subawards?api_key=XXX&prime_awardee_uei=XXXXX"
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `prime_award_piid` | string | Prime contract ID |
| `prime_awardee_name` | string | Prime contractor |
| `prime_awardee_uei` | string | Prime UEI |
| `sub_awardee_name` | string | Sub contractor |
| `sub_awardee_uei` | string | Sub UEI |
| `sub_award_amount` | number | Subaward value |
| `sub_award_date` | date | Subaward date |
| `naics_code` | string | NAICS |
| `place_of_performance_state` | string | State |

### Teaming Intelligence Queries

```bash
# Who does this prime use as subs?
GET /subawards?prime_awardee_uei=XXXXX

# Which primes use this sub?
GET /subawards?sub_awardee_uei=XXXXX

# Teaming in a specific market
GET /subawards?naics_code=541512&place_of_performance_state=VA
```

---

## API 5: Federal Hierarchy API

**Base URL:** `https://api.sam.gov/prod/federalorganizations/v1`

### Get Agency Structure

```bash
GET /orgs
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fhorgid` | string | Org ID |
| `fhorgname` | string | Org name search |
| `fhorgtype` | string | Department, Agency, Office |
| `status` | string | Active, Inactive |
| `fhparentorgid` | string | Parent org ID |
| `page` | number | Page number |
| `size` | number | Results per page |

**Example:**
```bash
curl "https://api.sam.gov/prod/federalorganizations/v1/orgs?api_key=XXX&fhorgname=Veterans"
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `fhorgid` | string | Unique org ID |
| `fhorgname` | string | Organization name |
| `fhorgtype` | string | Type (Dept/Agency/Office) |
| `fhparentorgid` | string | Parent org ID |
| `fhparentorgname` | string | Parent name |
| `agencycode` | string | FPDS agency code |
| `oldfpdsofficecode` | string | Legacy FPDS office |
| `cgac` | string | Treasury agency code |
| `status` | string | Active/Inactive |

### Common Agency Codes

| Agency | Code | Name |
|--------|------|------|
| DOD | 9700 | Department of Defense |
| VA | 3600 | Veterans Affairs |
| DHS | 7000 | Homeland Security |
| HHS | 7500 | Health and Human Services |
| GSA | 4700 | General Services Admin |
| NASA | 8000 | NASA |
| DOE | 8900 | Energy |
| DOJ | 1500 | Justice |

---

## Caching Strategy

### Supabase Cache Table

```sql
CREATE TABLE sam_api_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL,  -- MD5 hash of query
  api_type TEXT NOT NULL,           -- opportunities, awards, entity, subaward, hierarchy
  query_params JSONB NOT NULL,
  response_data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER DEFAULT 0
);

CREATE INDEX idx_cache_key ON sam_api_cache(cache_key);
CREATE INDEX idx_cache_expires ON sam_api_cache(expires_at);
```

### TTL by API Type

| API | Cache TTL | Rationale |
|-----|-----------|-----------|
| Opportunities | 1 hour | Changes frequently |
| Contract Awards | 24 hours | Historical data, stable |
| Entity | 24 hours | Registration changes rare |
| Subaward | 24 hours | Quarterly reporting |
| Hierarchy | 7 days | Rarely changes |

---

## Error Handling

### Common Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Bad request | Check parameters |
| 401 | Unauthorized | Check API key |
| 403 | Forbidden | Key not authorized for this API |
| 404 | Not found | Record doesn't exist |
| 429 | Rate limited | Wait + exponential backoff |
| 500 | Server error | Retry with backoff |
| 503 | Service unavailable | Fall back to USASpending |

### Fallback Strategy

```typescript
async function fetchContractData(naics: string) {
  try {
    // Try SAM.gov first
    return await fetchSAMContractAwards(naics);
  } catch (error) {
    if (error.status === 429 || error.status >= 500) {
      // Fall back to USASpending
      console.log('SAM.gov unavailable, falling back to USASpending');
      return await fetchUSASpendingAwards(naics);
    }
    throw error;
  }
}
```

---

## MCP Tool Reference

We have an MCP server for SAM.gov Opportunities API:

```typescript
// Available MCP tools
mcp__samgov__search_opportunities({ naics, state, keywords, setAside, limit })
mcp__samgov__get_opportunity({ noticeId })
mcp__samgov__check_api_health()
mcp__samgov__search_entities({ query, state, naics, uei })
mcp__samgov__get_forecast({ naics, agency, fiscalYear })
```

**Note:** Contract Awards, Subaward, and Hierarchy APIs are not yet in MCP server. Use direct HTTP calls.

---

## Testing Endpoints

### Admin Test Routes

| Endpoint | API | Purpose |
|----------|-----|---------|
| `/api/admin/test-sam-opportunities` | Opportunities | Test opp search |
| `/api/admin/test-sam-awards` | Contract Awards | Test awards search |
| `/api/admin/test-sam-entity` | Entity | Test entity lookup |
| `/api/admin/test-sam-subaward` | Subaward | Test subaward search |
| `/api/admin/test-sam-hierarchy` | Hierarchy | Test org lookup |

### Test Values

```bash
# Known-good test values
NAICS: 541512 (Computer Systems Design)
Agency: 3600 (VA)
State: VA
UEI: Look up Booz Allen or Lockheed

# Test commands
curl "https://tools.govcongiants.org/api/admin/test-sam-awards?password=galata-assassin-2026&naics=541512"
```

---

## USASpending Fallback

When SAM.gov Contract Awards API is unavailable (requires System Account) or rate limited, we fall back to USASpending.gov.

**USASpending API:** `https://api.usaspending.gov/api/v2`

### Key Endpoints

```bash
# Search awards by NAICS
POST /api/v2/search/spending_by_award/
{
  "filters": {
    "award_type_codes": ["A", "B", "C", "D"],
    "naics_codes": { "require": ["541512"] }
  },
  "page": 1,
  "limit": 25
}

# Get award details (includes bid count)
GET /api/v2/awards/{generated_internal_id}/
```

### Bid Count Data Location

USASpending award details include competition data in `latest_transaction_contract_data`:

```json
{
  "latest_transaction_contract_data": {
    "number_of_offers_received": "3",
    "extent_competed": "A",
    "extent_competed_description": "FULL AND OPEN COMPETITION",
    "small_business_competitive": false
  }
}
```

### Implementation Files

| File | Purpose |
|------|---------|
| `src/lib/sam/usaspending-fallback.ts` | USASpending API wrapper |
| `src/lib/sam/contract-awards.ts` | Uses USASpending as primary source |
| `src/app/api/admin/test-usaspending/route.ts` | Test endpoint |

### Test USASpending

```bash
curl "https://tools.govcongiants.org/api/admin/test-usaspending?password=galata-assassin-2026&naics=541512"
```

**Response includes:**
- `numberOfOffersReceived` - Bid count
- `competitionLevel` - sole_source, low, medium, high
- `extentCompetedDescription` - Human-readable competition type

---

## Related Documentation

- [Briefings System](./briefings-system.md) - How briefings use SAM data
- [Ecosystem](./ecosystem.md) - Full system architecture
- [USASpending API](https://api.usaspending.gov) - Fallback data source
- [SAM.gov Developer Portal](https://api.sam.gov) - Official docs

---

*Last Updated: March 25, 2026*
