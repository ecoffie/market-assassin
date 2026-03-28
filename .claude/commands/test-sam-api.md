# Test SAM.gov API

Test any of the SAM.gov APIs with sample queries.

## Usage

```
/test-sam-api [api-type]
```

Where `api-type` is one of:
- `opportunities` - Test SAM.gov Opportunities API (existing)
- `awards` - Test SAM.gov Contract Awards API
- `entity` - Test SAM.gov Entity Management API
- `subaward` - Test SAM.gov Subaward Reporting API
- `hierarchy` - Test SAM.gov Federal Hierarchy API
- `all` - Test all APIs

## Instructions

Based on the `$ARGUMENTS` provided:

### If `opportunities` or `all`:
1. Use `mcp__samgov__search_opportunities` with `naics="541512"` `state="FL"` `limit=5`
2. Report: number of results, sample titles, API response time

### If `awards` or `all`:
1. Call the admin test endpoint:
   ```bash
   curl "https://tools.govcongiants.org/api/admin/test-sam-awards?password=galata-assassin-2026&naics=541512"
   ```
2. Report: number of contracts found, sample incumbents, bid counts

### If `entity` or `all`:
1. Call the admin test endpoint:
   ```bash
   curl "https://tools.govcongiants.org/api/admin/test-sam-entity?password=galata-assassin-2026&name=Booz"
   ```
2. Report: entities found, SAM status, certifications

### If `subaward` or `all`:
1. Call the admin test endpoint:
   ```bash
   curl "https://tools.govcongiants.org/api/admin/test-sam-subaward?password=galata-assassin-2026&naics=541512"
   ```
2. Report: prime→sub relationships found, sample teaming data

### If `hierarchy` or `all`:
1. Call the admin test endpoint:
   ```bash
   curl "https://tools.govcongiants.org/api/admin/test-sam-hierarchy?password=galata-assassin-2026&agency=VA"
   ```
2. Report: organizational structure, offices found

## Output Format

For each API tested, provide:
- **Status:** Working / Error / Not Implemented Yet
- **Response Time:** Xs
- **Sample Data:** Brief summary
- **Rate Limit Status:** If applicable

## Reference

Full API documentation: `docs/sam-apis.md`
