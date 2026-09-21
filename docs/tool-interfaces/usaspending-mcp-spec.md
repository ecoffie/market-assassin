# USASpending MCP Tool Specification

> Interface specification for the USASpending MCP server

## Overview

USASpending.gov is the official source of federal spending data, containing $7.5+ trillion in historical awards. This MCP server provides programmatic access to spending data, enabling the "backwards from money" approach of the Federal Market Scanner.

**Status:** ✅ WORKING - Configured in `~/.mcp.json`

**Priority:** HIGH - Core dependency for visibility gap analysis

---

## API Details

| Property | Value |
|----------|-------|
| Base URL | `https://api.usaspending.gov/api/v2` |
| Auth | None required (public API) |
| Rate Limit | 100 requests/minute |
| Timeout | 30 seconds recommended |
| Format | JSON |

### Important API Requirements

The `/search/spending_by_award/` endpoint **requires** `award_type_codes` in the filters:
- `A` = BPA Call
- `B` = Purchase Order
- `C` = Delivery Order
- `D` = Definitive Contract

This was fixed on April 5, 2026. Without this field, the API returns 422 Unprocessable Entity.

---

## MCP Tools (Implemented)

### 1. `search_contracts`

Search for contract awards by NAICS, state, set-aside, and fiscal year.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| naics | string | Yes | - | NAICS code (2, 4, or 6 digits) |
| state | string | No | - | State code (2 letters) |
| zipCode | string | No | - | ZIP code (derives state + bordering) |
| setAside | string | No | - | Set-aside type (8a, wosb, sdvosb, hubzone, small_business) |
| fiscalYear | number | No | 2025 | Fiscal year to search |
| includeBorderingStates | boolean | No | true | Include bordering states |
| limit | number | No | 100 | Max results (max 100) |

**Example:**
```
mcp__usaspending__search_contracts naics="541512" state="FL" limit=50
```

**Response Fields:**
- Award ID, Recipient Name, Award Amount
- Awarding Agency, Sub Agency, Office
- Contract Award Type, NAICS Code/Description
- Place of Performance State/City
- Start Date, End Date, Description

---

### 2. `get_office_spending`

Get spending aggregated by contracting office. Find which offices spend the most in your NAICS.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| naics | string | Yes | - | NAICS code |
| state | string | No | - | State filter |
| zipCode | string | No | - | ZIP code (derives state) |
| setAside | string | No | - | Set-aside type |
| fiscalYear | number | No | 2025 | Fiscal year |
| includeBorderingStates | boolean | No | true | Include bordering |
| limit | number | No | 20 | Top N offices |

**Example:**
```
mcp__usaspending__get_office_spending naics="236220" setAside="8a" state="VA"
```

**Response:**
```json
{
  "totalContracts": 127,
  "totalValue": 45230000,
  "offices": [
    {
      "officeCode": "W91ZLK",
      "officeName": "Army Corps of Engineers",
      "agency": "Department of Defense",
      "subAgency": "Army",
      "totalSpending": 12500000,
      "contractCount": 23
    }
  ]
}
```

**Use Case:** Target the offices that actually spend money in your NAICS.

---

### 3. `get_naics_info`

Look up NAICS code details and related codes.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| naicsCode | string | Yes | - | NAICS code to look up |

**Example:**
```
mcp__usaspending__get_naics_info naicsCode="541512"
```

---

### 4. `expand_search_criteria`

Get suggestions for expanding limited searches. Returns broader NAICS prefixes and bordering states.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| naics | string | Yes | - | Current NAICS code |
| state | string | No | - | Current state |
| zipCode | string | No | - | Current ZIP code |

**Example:**
```
mcp__usaspending__expand_search_criteria naics="541512" state="FL"
```

**Response:**
```json
{
  "currentNaics": "541512",
  "currentState": "FL",
  "naicsExpansions": [
    {"level": "4-digit", "code": "5415", "description": "Broader category"},
    {"level": "3-digit", "code": "541", "description": "Industry group"}
  ],
  "geographicExpansions": [
    {"level": "state", "states": ["FL"]},
    {"level": "bordering", "states": ["FL", "AL", "GA"]}
  ]
}
```

---

## Bordering States

The MCP automatically includes bordering states when `includeBorderingStates=true` (default). This increases result coverage:

- FL → AL, GA
- VA → KY, MD, NC, TN, WV, DC
- TX → AR, LA, NM, OK
- CA → AZ, NV, OR

---

## Set-Aside Codes

| Input | Maps To |
|-------|---------|
| `women_owned`, `wosb` | WOSB |
| `8a`, `8(a)` | 8A |
| `hubzone` | HZC |
| `sdvosb`, `service_disabled_veteran` | SDVOSB |
| `vosb`, `veteran_owned` | VOSB |
| `small_business`, `sb` | SBA |

---

## Error Handling

| Error Code | Meaning | Resolution |
|------------|---------|------------|
| 422 | Missing required field | Ensure `award_type_codes` is included (fixed in MCP) |
| 429 | Rate limited | Wait 60s, retry (max 3) |
| 500 | Server error | Exponential backoff |
| 400 | Bad request | Check parameters |

---

## MCP Server Configuration

Already configured in `~/.mcp.json`:
```json
{
  "mcpServers": {
    "usaspending": {
      "command": "node",
      "args": ["/Users/ericcoffie/mcp-servers/usaspending-mcp/index.js"]
    }
  }
}
```

**No env vars required** - USASpending is a public API.

---

## Integration with Other MCPs

### Parallel Queries
```javascript
// Run these in parallel for comprehensive market scan
Promise.all([
  mcp__usaspending__get_office_spending({ naics }),
  mcp__usaspending__search_contracts({ naics, state }),
  mcp__samgov__search_opportunities({ naics, state }),
  mcp__grantsgov__search_grants({ keyword: naicsDescription })
])
```

### Data Flow
1. **USASpending** → Historical awards, office spending patterns
2. **SAM.gov** → Active opportunities, forecasts
3. **Grants.gov** → Grant opportunities
4. **Multisite** → NIH, DARPA, DOE Labs opportunities

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-05 | **Fixed 422 error** - Added required `award_type_codes` to filters |
| 2026-04-05 | Updated default fiscal year to 2025 |
| 2026-04-05 | Initial specification |

---

*Last Updated: April 5, 2026*
