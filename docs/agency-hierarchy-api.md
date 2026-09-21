# Agency Hierarchy API v2

**Endpoint:** `/api/agency-hierarchy`

Unified federal agency intelligence combining:
- SAM.gov Federal Hierarchy (official org structure)
- Pain Points database (250 agencies, 2,765 pain points)
- Contractor/SBLO contacts (2,768 contractors)
- Agency aliases (450+ abbreviation mappings)
- CGAC/FPDS code lookups
- USASpending.gov spending data

Inspired by [Tango by MakeGov](https://tango.makegov.com), enhanced with GovCon-specific intelligence.

---

## Quick Examples

```bash
# Search by abbreviation
curl "https://tools.govcongiants.org/api/agency-hierarchy?search=VA"

# Search by topic
curl "https://tools.govcongiants.org/api/agency-hierarchy?search=cybersecurity"

# Lookup by CGAC code
curl "https://tools.govcongiants.org/api/agency-hierarchy?cgac=069"

# Get agency with pain points
curl "https://tools.govcongiants.org/api/agency-hierarchy?agency=FEMA"

# Get spending data
curl "https://tools.govcongiants.org/api/agency-hierarchy?mode=spending&agency=DOD"

# Find buying offices for NAICS
curl "https://tools.govcongiants.org/api/agency-hierarchy?naics=541512&mode=buying"
```

---

## Endpoints

### 1. Search Agencies
```
GET /api/agency-hierarchy?search=<query>
```

Search by name, abbreviation, or topic. Returns ranked results from all sources.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| search | string | Search term (name, abbreviation, topic) |
| include | string | Comma-separated: painPoints,contractors,children,hierarchy |
| limit | number | Max results (default: 10) |

**Example:**
```bash
curl "https://tools.govcongiants.org/api/agency-hierarchy?search=FEMA"
```

**Response:**
```json
{
  "success": true,
  "mode": "search",
  "query": "FEMA",
  "totalResults": 1,
  "results": [{
    "name": "Federal Emergency Management Agency",
    "shortName": "FEMA",
    "cgacCode": "069",
    "parent": "Department of Homeland Security",
    "parentPath": "Department of Homeland Security > FEMA",
    "level": "agency",
    "painPoints": [
      "Disaster response IT modernization",
      "Emergency communications infrastructure",
      "Grant management systems"
    ],
    "priorities": [
      "$5.2B for BRIC grants in FY2026",
      "$2.1B for Public Assistance programs"
    ],
    "contractors": [{
      "company": "CDW Corporation",
      "sblo": "John Smith",
      "email": "jsmith@cdw.com",
      "contractValue": "$1.2B"
    }],
    "matchType": "alias",
    "matchScore": 95,
    "sources": ["pain_points", "contractors"]
  }]
}
```

---

### 2. Direct Agency Lookup
```
GET /api/agency-hierarchy?agency=<name_or_alias>
```

Get detailed info for a specific agency.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| agency | string | Agency name or abbreviation |
| naics | string | Optional: also return buying offices for this NAICS |
| include | string | Comma-separated options |

**Example:**
```bash
curl "https://tools.govcongiants.org/api/agency-hierarchy?agency=VA&naics=541512"
```

---

### 3. CGAC Code Lookup
```
GET /api/agency-hierarchy?cgac=<code>
```

Lookup agency by CGAC code (3-digit identifier).

**Example:**
```bash
curl "https://tools.govcongiants.org/api/agency-hierarchy?cgac=069"
```

---

### 4. Get All Departments
```
GET /api/agency-hierarchy?mode=departments
```

List all top-level federal departments with pain point counts.

**Response:**
```json
{
  "success": true,
  "mode": "departments",
  "totalDepartments": 24,
  "departments": [{
    "name": "Department of Defense",
    "shortName": "DOD",
    "cgacCode": "097",
    "painPointsCount": 11,
    "prioritiesCount": 10,
    "childAgencies": 15
  }]
}
```

---

### 5. Get Hierarchy Tree
```
GET /api/agency-hierarchy?agency=<code>&mode=tree
```

Get full organizational hierarchy for an agency.

**Example:**
```bash
curl "https://tools.govcongiants.org/api/agency-hierarchy?agency=VA&mode=tree"
```

---

### 6. Get Buying Offices
```
GET /api/agency-hierarchy?naics=<code>&mode=buying
```

Find offices that purchase a specific NAICS code.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| naics | string | NAICS code |
| agency | string | Optional: filter to specific agency |
| limit | number | Max results (default: 10) |

**Example:**
```bash
curl "https://tools.govcongiants.org/api/agency-hierarchy?naics=541512&mode=buying"
```

**Response:**
```json
{
  "success": true,
  "mode": "buying",
  "naics": "541512",
  "totalFound": 156,
  "offices": [{
    "name": "Office of Information Technology",
    "code": "36VA",
    "agency": "3600",
    "department": "036"
  }],
  "relatedAgencies": [{
    "agency": "Department of Veterans Affairs",
    "relevantPainPoints": ["Cybersecurity modernization", "EHR interoperability"]
  }]
}
```

---

### 7. Search Offices
```
GET /api/agency-hierarchy?office=<name>&mode=offices
```

Search contracting offices by name.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| office | string | Office name search |
| agency | string | Optional: filter to agency |
| state | string | Optional: state code (e.g., "FL") |
| limit | number | Max results |

---

### 8. Get Spending Data
```
GET /api/agency-hierarchy?mode=spending
GET /api/agency-hierarchy?mode=spending&agency=<name>
```

Get spending statistics from USASpending.gov.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| agency | string | Optional: specific agency |
| fy | number | Optional: fiscal year (default: current) |

**Example (overall summary):**
```bash
curl "https://tools.govcongiants.org/api/agency-hierarchy?mode=spending"
```

**Example (specific agency):**
```bash
curl "https://tools.govcongiants.org/api/agency-hierarchy?mode=spending&agency=VA&fy=2026"
```

**Response:**
```json
{
  "success": true,
  "mode": "spending",
  "agency": "VA",
  "fiscalYear": 2026,
  "data": {
    "totalObligations": 312000000000,
    "totalObligationsFormatted": "$312.0B",
    "totalOutlays": 298000000000,
    "totalOutlaysFormatted": "$298.0B",
    "contractCount": 45000
  }
}
```

---

### 9. Get Service Stats
```
GET /api/agency-hierarchy?mode=stats
```

Get statistics about the data sources.

**Response:**
```json
{
  "success": true,
  "mode": "stats",
  "data": {
    "agencies": 250,
    "painPoints": 2765,
    "priorities": 2500,
    "aliases": 450,
    "contractors": 2768,
    "sources": [
      "SAM.gov Federal Hierarchy",
      "Pain Points Database",
      "Contractor Database",
      "Agency Aliases",
      "USASpending.gov"
    ]
  }
}
```

---

## Common Aliases

| Abbreviation | Full Name |
|--------------|-----------|
| DOD | Department of Defense |
| VA | Department of Veterans Affairs |
| DHS | Department of Homeland Security |
| HHS | Department of Health and Human Services |
| DOE | Department of Energy |
| DOJ | Department of Justice |
| DOT | Department of Transportation |
| USDA | Department of Agriculture |
| GSA | General Services Administration |
| FEMA | Federal Emergency Management Agency |
| FBI | Federal Bureau of Investigation |
| NASA | NASA |
| EPA | Environmental Protection Agency |
| SBA | Small Business Administration |

See `src/data/agency-aliases.json` for complete list (450+ mappings).

---

## CGAC Codes

| Code | Agency |
|------|--------|
| 007 | Department of Agriculture |
| 012 | Department of Defense |
| 013 | Department of Commerce |
| 014 | Department of Energy |
| 015 | Department of Health and Human Services |
| 016 | Department of Homeland Security |
| 028 | Department of Veterans Affairs |
| 047 | General Services Administration |
| 068 | Environmental Protection Agency |
| 069 | FEMA |
| 080 | NASA |

---

## Data Sources

1. **SAM.gov Federal Hierarchy API** - Official organizational structure
2. **Pain Points Database** - 250 agencies, 2,765 pain points from FY2026 budget docs
3. **Contractor Database** - 2,768 federal contractors with SBLO contacts
4. **Agency Aliases** - 450+ abbreviation → full name mappings
5. **USASpending.gov** - Spending aggregations and trends

---

## Error Handling

All errors return:
```json
{
  "success": false,
  "error": "Error message here"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Missing required parameter |
| 404 | Agency not found |
| 500 | Internal error |

---

## Integration Examples

### Use in Market Assassin Reports
```typescript
import { getAgency, getPainPointsForAgency } from '@/lib/agency-hierarchy';

const agencyInfo = await getAgency('VA');
// Returns pain points, priorities, contractors
```

### Use in Daily Briefings
```typescript
import { searchAgencies } from '@/lib/agency-hierarchy';

const results = await searchAgencies('cybersecurity', {
  includePainPoints: true,
  limit: 5
});
// Returns agencies with cybersecurity pain points
```

---

*Created: April 4, 2026*
*Version: 2.0*
