# Event Aggregator MCP Tool Specification

> Aggregate federal events from multiple public sources

## Overview

Federal events (industry days, conferences, matchmaking, PTAC workshops) are critical for building relationships and getting early intelligence on upcoming procurements. This MCP server aggregates events from multiple reliable public sources into a unified searchable format.

**Priority:** HIGH - Events are where relationships are built before solicitations drop

---

## Event Sources

### Tier 1: Reliable Public APIs/Feeds

| Source | Type | Coverage | URL |
|--------|------|----------|-----|
| SAM.gov Special Notices | API | Industry days in solicitations | sam.gov |
| SBA Events | API | Small business workshops, matchmaking | sba.gov/events |
| GSA Events | RSS | GSA-hosted conferences | gsa.gov/events |
| PTAC Locator | Web | Regional procurement workshops | aptac-us.org |

### Tier 2: Agency Calendars

| Source | Type | Coverage |
|--------|------|----------|
| DoD OSBP Events | Web/RSS | Defense small business |
| VA OSDBU Events | Web | Veteran affairs procurement |
| NASA OSBP | Web | NASA small business |
| DOE OSDBU | Web | Energy procurement |
| HHS OSDBU | Web | Health & Human Services |

### Tier 3: Industry Organizations

| Source | Type | Coverage |
|--------|------|----------|
| NCMA Events | Web | Contract management |
| PSC Events | Web | Professional services council |
| ACT-IAC | Web | IT/Acquisition |

---

## MCP Tools

### 1. `search_events`

Search for federal events by keyword, date range, location, or agency.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| keywords | string | No | - | Search in title/description |
| agency | string | No | - | Filter by agency |
| state | string | No | - | Filter by state (for in-person) |
| event_type | string | No | - | Type filter (see enum below) |
| date_from | string | No | Today | Start date (ISO) |
| date_to | string | No | +90 days | End date (ISO) |
| virtual_only | boolean | No | false | Only virtual events |
| free_only | boolean | No | false | Only free events |
| limit | number | No | 50 | Max results |

**Event Types:**
- `industry_day` - Pre-solicitation industry days
- `conference` - Multi-day conferences
- `workshop` - Training/PTAC workshops
- `matchmaking` - Buyer/seller matchmaking
- `webinar` - Online presentations
- `forecast` - Forecast briefings
- `networking` - Networking events

**Example:**
```
mcp__events__search_events keywords="cybersecurity" state="VA" date_from="2026-04-01" event_type="industry_day"
```

**Response:**
```typescript
interface SearchEventsResponse {
  success: boolean;
  events: FederalEvent[];
  meta: {
    total: number;
    sources_queried: string[];
    query_time_ms: number;
  };
}

interface FederalEvent {
  id: string;                    // Internal UUID
  external_id: string;           // Source's ID
  source: EventSource;

  // Core
  title: string;
  description?: string;
  event_type: EventType;

  // Timing
  start_date: string;            // ISO date
  end_date?: string;             // ISO date (if multi-day)
  start_time?: string;           // HH:MM in local timezone
  end_time?: string;
  timezone?: string;

  // Location
  format: 'in_person' | 'virtual' | 'hybrid';
  venue?: string;
  address?: string;
  city?: string;
  state?: string;
  virtual_url?: string;

  // Organization
  agency?: string;
  host_organization?: string;

  // Registration
  registration_url?: string;
  registration_deadline?: string;
  cost?: number;                 // 0 = free
  cost_description?: string;

  // Relevance
  naics_codes?: string[];        // If specified
  keywords?: string[];           // Extracted topics

  // Metadata
  source_url: string;
  scraped_at: string;
}

type EventSource =
  | 'sam_gov'
  | 'sba_events'
  | 'gsa_events'
  | 'ptac'
  | 'dod_osbp'
  | 'va_osdbu'
  | 'nasa_osbp'
  | 'doe_osdbu'
  | 'hhs_osdbu'
  | 'ncma'
  | 'psc'
  | 'act_iac';

type EventType =
  | 'industry_day'
  | 'conference'
  | 'workshop'
  | 'matchmaking'
  | 'webinar'
  | 'forecast'
  | 'networking'
  | 'other';
```

---

### 2. `get_event_details`

Get full details for a specific event.

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| event_id | string | Yes | Event ID from search |

**Response:**
```typescript
interface EventDetailsResponse {
  success: boolean;
  event: FederalEvent & {
    full_description?: string;   // Complete description
    agenda?: string;             // If available
    speakers?: Speaker[];
    attachments?: Attachment[];
    related_solicitation?: string; // SAM.gov notice ID if linked
  };
}

interface Speaker {
  name: string;
  title?: string;
  organization?: string;
}

interface Attachment {
  name: string;
  url: string;
  type: string;  // pdf, doc, etc.
}
```

---

### 3. `get_industry_days`

Specialized search for industry days (pre-solicitation events).

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| naics | string | No | - | NAICS code filter |
| agency | string | No | - | Agency filter |
| days_ahead | number | No | 60 | Look ahead window |
| limit | number | No | 25 | Max results |

**Example:**
```
mcp__events__get_industry_days naics="541512" agency="Army" days_ahead=90
```

**Response:** Same as `search_events` but filtered to `event_type='industry_day'`

---

### 4. `get_ptac_workshops`

Find PTAC (Procurement Technical Assistance Center) workshops by state.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| state | string | Yes | - | State code |
| topic | string | No | - | Topic filter (e.g., "proposal writing") |
| days_ahead | number | No | 30 | Look ahead window |

**Example:**
```
mcp__events__get_ptac_workshops state="GA" topic="sam.gov"
```

---

### 5. `get_upcoming_conferences`

Find major federal procurement conferences.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| category | string | No | - | Category: defense, it, small_business, healthcare |
| months_ahead | number | No | 6 | Look ahead window |
| limit | number | No | 20 | Max results |

---

### 6. `check_sources_health`

Check status of all event sources.

**Response:**
```typescript
interface SourceHealthResponse {
  sources: {
    source: EventSource;
    status: 'healthy' | 'degraded' | 'down';
    last_successful_scrape: string;
    events_count: number;
    response_time_ms: number;
    error?: string;
  }[];
}
```

---

## Source Integration Details

### SAM.gov Industry Days

Extract from Special Notices (type 's') containing keywords:
- "industry day"
- "pre-solicitation conference"
- "vendor day"
- "sources sought conference"
- "market research event"

```typescript
// Query pattern
const samQuery = {
  noticeType: 's',  // Special notice
  keywords: 'industry day OR pre-solicitation conference OR vendor day',
  postedFrom: today,
  postedTo: plus90days
};
```

---

### SBA Events API

**Endpoint:** `https://www.sba.gov/events-api/v1/events`

```typescript
interface SBAEvent {
  id: number;
  title: string;
  description: string;
  event_type: string;
  start_date: string;
  end_date: string;
  timezone: string;
  location: {
    venue: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  };
  registration_url: string;
  cost: string;
  recurring: boolean;
}
```

**Rate Limit:** Unknown, assume 60/min

---

### GSA Events

**RSS Feed:** `https://www.gsa.gov/rss/events.xml`

Parse RSS for:
- Title
- Description
- Link (registration URL)
- pubDate
- category (event type)

---

### PTAC Network

**Source:** `https://www.aptac-us.org/find-a-ptac/`

Each PTAC has their own event calendar. Scrape state-by-state:
- Georgia PTAC: `https://www.georgiaptac.org/events`
- Virginia PTAC: `https://www.virginiaptac.org/events`
- etc.

**Approach:** Firecrawl with extraction schema for event data.

---

## Database Schema

```sql
CREATE TABLE federal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  source TEXT NOT NULL,

  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT,

  start_date DATE NOT NULL,
  end_date DATE,
  start_time TIME,
  end_time TIME,
  timezone TEXT DEFAULT 'America/New_York',

  format TEXT DEFAULT 'in_person',
  venue TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  virtual_url TEXT,

  agency TEXT,
  host_organization TEXT,

  registration_url TEXT,
  registration_deadline DATE,
  cost NUMERIC DEFAULT 0,
  cost_description TEXT,

  naics_codes TEXT[],
  keywords TEXT[],

  source_url TEXT,
  raw_data JSONB,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_source_event UNIQUE (source, external_id)
);

-- Indexes
CREATE INDEX idx_events_date ON federal_events(start_date);
CREATE INDEX idx_events_state ON federal_events(state);
CREATE INDEX idx_events_agency ON federal_events(agency);
CREATE INDEX idx_events_type ON federal_events(event_type);
CREATE INDEX idx_events_source ON federal_events(source);

-- Full-text search
CREATE INDEX idx_events_fts ON federal_events
  USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));
```

---

## Cron Schedule

| Job | Schedule | Sources |
|-----|----------|---------|
| sync-sam-industry-days | 0 6 * * * | SAM.gov special notices |
| sync-sba-events | 0 7 * * * | SBA Events API |
| sync-gsa-events | 0 7 * * 1 | GSA RSS (weekly) |
| sync-ptac-events | 0 8 * * 1 | PTAC network (weekly) |
| sync-agency-calendars | 0 9 * * 1 | DoD, VA, NASA, etc. |
| cleanup-past-events | 0 0 * * 0 | Archive past events |

---

## MCP Server Structure

```
/Users/ericcoffie/mcp-servers/events/
├── index.js              # MCP server entry
├── package.json
├── sources/
│   ├── sam-industry-days.js
│   ├── sba-events.js
│   ├── gsa-rss.js
│   ├── ptac-network.js
│   └── agency-calendars.js
├── lib/
│   ├── normalizer.js     # Normalize to FederalEvent schema
│   ├── deduper.js        # Cross-source dedup
│   └── db.js             # Supabase client
└── schemas/
    └── event-extraction.json  # Firecrawl schema
```

---

## Error Handling

| Error | Recovery |
|-------|----------|
| Source timeout | Use cached data, flag stale |
| Source down | Skip, use other sources |
| Rate limited | Exponential backoff |
| Parse error | Log, continue with other events |

---

## Integration with Skills

### `/event-discovery` skill uses:
```
1. search_events(keywords from user NAICS description)
2. get_industry_days(user NAICS, user state)
3. get_ptac_workshops(user state)
4. Merge, dedupe, score by relevance
5. Output calendar view
```

### Daily Alerts integration:
```
1. Query events starting in next 14 days
2. Filter by user NAICS/state/agency preferences
3. Include in daily alert email
```

---

## Build Priority

1. **SAM.gov industry days** - Already have samgov-mcp, just need keyword filter
2. **SBA Events API** - Public API, straightforward
3. **GSA RSS** - Simple RSS parsing
4. **PTAC network** - Requires Firecrawl, more complex

---

## Related Documentation

| Doc | Purpose |
|-----|---------|
| `federal-market-scanner.md` | How events fit in Scanner |
| `data-flow-architecture.md` | Event data flow |
| `skill-specs/event-discovery-spec.md` | Skill that uses this tool |
| `component-registry.md` | Tool registry |

---

*Last Updated: April 5, 2026*
