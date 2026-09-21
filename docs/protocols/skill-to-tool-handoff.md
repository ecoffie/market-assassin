# Skill-to-Tool Handoff Protocol

> How skills request data from MCP tools and handle responses

## Overview

Skills are high-level workflows (slash commands) that orchestrate multiple tool calls. This document defines the standard protocol for skill-to-tool communication.

---

## Request Format

### Standard Tool Request

```typescript
interface ToolRequest {
  // Identity
  skill: string;           // e.g., '/market-scan'
  requestId: string;       // UUID for tracking
  timestamp: string;       // ISO timestamp

  // Target
  tool: string;            // e.g., 'usaspending-mcp'
  method: string;          // e.g., 'get_spending_by_agency'

  // Parameters
  params: Record<string, any>;

  // Options
  options: {
    timeout: number;       // ms (default: 30000)
    retryOnFail: boolean;  // (default: true)
    maxRetries: number;    // (default: 3)
    cacheKey?: string;     // For caching results
    cacheTTL?: number;     // Cache TTL in seconds
  };
}
```

### Example Request

```typescript
const request: ToolRequest = {
  skill: '/market-scan',
  requestId: 'req_abc123',
  timestamp: '2026-04-05T10:30:00Z',

  tool: 'usaspending-mcp',
  method: 'get_spending_by_agency',

  params: {
    naics: '541512',
    fiscal_years: [2024, 2025, 2026]
  },

  options: {
    timeout: 30000,
    retryOnFail: true,
    maxRetries: 3,
    cacheKey: 'spending:541512:2024-2026',
    cacheTTL: 86400  // 24 hours
  }
};
```

---

## Response Format

### Standard Tool Response

```typescript
interface ToolResponse {
  // Identity
  requestId: string;       // Echo back for correlation
  tool: string;
  method: string;

  // Status
  success: boolean;
  cached: boolean;         // Was this from cache?
  timestamp: string;

  // Data (on success)
  data?: any;              // Tool-specific payload

  // Metadata
  meta: {
    queryTime: number;     // ms
    totalResults?: number;
    hasMore?: boolean;
    dataAsOf?: string;     // When source data was last updated
  };

  // Error (on failure)
  error?: {
    code: string;          // Error code
    message: string;       // Human-readable
    retryable: boolean;    // Should skill retry?
    retryAfter?: number;   // Seconds to wait before retry
  };
}
```

### Success Response Example

```typescript
const response: ToolResponse = {
  requestId: 'req_abc123',
  tool: 'usaspending-mcp',
  method: 'get_spending_by_agency',

  success: true,
  cached: false,
  timestamp: '2026-04-05T10:30:02Z',

  data: {
    naics: '541512',
    naics_description: 'Computer Systems Design Services',
    total_spending: 45_800_000_000,
    agencies: [
      { agency: 'Department of Defense', amount: 18_200_000_000, count: 4521 },
      { agency: 'Department of Veterans Affairs', amount: 5_100_000_000, count: 892 },
      // ...
    ]
  },

  meta: {
    queryTime: 1842,
    totalResults: 47,
    dataAsOf: '2026-04-04T00:00:00Z'
  }
};
```

### Error Response Example

```typescript
const response: ToolResponse = {
  requestId: 'req_abc123',
  tool: 'usaspending-mcp',
  method: 'get_spending_by_agency',

  success: false,
  cached: false,
  timestamp: '2026-04-05T10:30:05Z',

  meta: {
    queryTime: 5000
  },

  error: {
    code: 'RATE_LIMITED',
    message: 'USASpending API rate limit exceeded (100/min)',
    retryable: true,
    retryAfter: 60
  }
};
```

---

## Error Codes

### Standard Error Codes

| Code | Meaning | Retryable | Action |
|------|---------|-----------|--------|
| `RATE_LIMITED` | API rate limit hit | Yes | Wait `retryAfter` seconds |
| `TIMEOUT` | Request timed out | Yes | Increase timeout, retry |
| `SERVER_ERROR` | 5xx from API | Yes | Exponential backoff |
| `BAD_REQUEST` | Invalid parameters | No | Fix params |
| `NOT_FOUND` | Resource doesn't exist | No | Handle gracefully |
| `AUTH_FAILED` | API key invalid | No | Check configuration |
| `PARSE_ERROR` | Response parsing failed | No | Log, investigate |
| `CONNECTION_ERROR` | Network failure | Yes | Retry with backoff |

### Error Handling Flow

```
Tool Returns Error
        │
        ├── retryable = true?
        │         │
        │         ├── Yes: Retry up to maxRetries
        │         │         │
        │         │         ├── Success? → Continue
        │         │         │
        │         │         └── All retries failed?
        │         │                   │
        │         │                   ▼
        │         │         ┌─────────────────┐
        │         │         │ Check for cache │
        │         │         └────────┬────────┘
        │         │                  │
        │         │         ┌────────┴────────┐
        │         │         │                 │
        │         │         ▼                 ▼
        │         │   Cache exists?     No cache?
        │         │         │                 │
        │         │         ▼                 ▼
        │         │   Return cached    Return error
        │         │   (flag stale)     to skill
        │         │
        │         └── No: Return error to skill immediately
        │
        └── retryable = false? → Return error to skill
```

---

## Parallel Requests

Skills should make parallel requests when data is independent:

```typescript
// GOOD: Parallel requests
const [spending, opportunities, forecasts] = await Promise.all([
  callTool({
    tool: 'usaspending-mcp',
    method: 'get_spending_by_agency',
    params: { naics }
  }),
  callTool({
    tool: 'samgov-mcp',
    method: 'search_opportunities',
    params: { naics, state }
  }),
  callTool({
    tool: 'samgov-mcp',
    method: 'get_forecast',
    params: { naics }
  })
]);

// BAD: Sequential when parallel is possible
const spending = await callTool({ /* usaspending */ });
const opportunities = await callTool({ /* samgov */ }); // Wastes time
const forecasts = await callTool({ /* samgov */ });     // Wastes time
```

---

## Sequential Dependencies

When one call depends on another's results:

```typescript
// Step 1: Get agencies
const { data: spending } = await callTool({
  tool: 'usaspending-mcp',
  method: 'get_spending_by_agency',
  params: { naics }
});

// Step 2: For each top agency, get forecasts (depends on Step 1)
const topAgencies = spending.agencies.slice(0, 5);
const forecasts = await Promise.all(
  topAgencies.map(agency =>
    callTool({
      tool: 'samgov-mcp',
      method: 'get_forecast',
      params: { naics, agency: agency.agency }
    })
  )
);
```

---

## Caching Strategy

### When to Cache

| Data Type | Cache? | TTL | Reason |
|-----------|--------|-----|--------|
| Spending by agency | Yes | 24h | Slow-changing |
| Spending by state | Yes | 24h | Slow-changing |
| Expiring contracts | Yes | 12h | Moderate change |
| SAM opportunities | No | - | Must be real-time |
| Forecasts | Yes | 1 week | Updated weekly |
| Vendor awards | Yes | 1 week | Historical |

### Cache Key Format

```
{tool}:{method}:{param1}:{param2}:...

Examples:
- usaspending:spending_by_agency:541512:2024-2026
- usaspending:vendor_awards:J7M9HPTGJ1Y9
- samgov:forecast:541512:Army
```

### Stale Data Handling

When returning cached data after API failure:

```typescript
if (cached && apiError) {
  return {
    ...cachedResponse,
    meta: {
      ...cachedResponse.meta,
      stale: true,
      staleReason: apiError.message,
      cachedAt: cachedResponse.timestamp,
      staleSince: new Date().toISOString()
    }
  };
}
```

Skills should note stale data in output:
```markdown
*Note: Spending data is from cache (24 hours old) due to API unavailability*
```

---

## Timeout Guidelines

| Tool | Operation | Recommended Timeout |
|------|-----------|---------------------|
| usaspending-mcp | search_awards | 30s |
| usaspending-mcp | get_spending_by_agency | 20s |
| usaspending-mcp | get_expiring_contracts | 30s |
| samgov-mcp | search_opportunities | 15s |
| samgov-mcp | get_forecast | 10s |
| grantsgov-mcp | search_grants | 15s |
| multisite-mcp | search_nih | 20s |

---

## Logging

All tool calls should be logged:

```typescript
interface ToolCallLog {
  requestId: string;
  skill: string;
  tool: string;
  method: string;
  params: Record<string, any>;  // Sanitized (no secrets)
  startTime: string;
  endTime: string;
  durationMs: number;
  success: boolean;
  cached: boolean;
  errorCode?: string;
  resultCount?: number;
}
```

Log to console in development, structured logging in production.

---

## Best Practices

### DO

- Always set appropriate timeouts
- Use caching for slow-changing data
- Make parallel requests when possible
- Handle errors gracefully with fallbacks
- Log all tool calls for debugging
- Check `retryable` before retrying

### DON'T

- Don't retry non-retryable errors
- Don't ignore `retryAfter` hints
- Don't cache real-time data (active opportunities)
- Don't make sequential calls when parallel is possible
- Don't swallow errors silently

---

## Related Documentation

| Doc | Purpose |
|-----|---------|
| `data-flow-architecture.md` | Overall data flow |
| `tool-interfaces/*.md` | Specific tool specs |
| `component-registry.md` | Available tools |

---

*Last Updated: April 5, 2026*
