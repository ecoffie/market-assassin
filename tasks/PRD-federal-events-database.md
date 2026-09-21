# PRD: Federal Events Database

**Status:** Live in production (working subset), May 22 2026
**Owner:** Eric / Claude
**Related:** [`tasks/target-market-research-roadmap.md`](./target-market-research-roadmap.md) — Event Radar is Slices 4-5 of the Target Market Research roadmap

---

## TL;DR

We already have a working federal events database with three layers:

1. **`sam_events` table** (Supabase) — auto-populated daily from SAM.gov Special Notices
2. **`src/data/federal-events-sources.json`** — static catalog of 30 event sources + 12 annual conferences
3. **`/api/federal-events`** — read API consumed by Market Scanner Phase 3

This PRD captures what exists, what's stale or thin, and what to keep populating so future product work (Target Market Research Event Radar) builds on the existing foundation instead of duplicating it.

---

## What we have today

### 1. The `sam_events` table

```sql
-- supabase/migrations/20260414_usaspending_awards.sql
CREATE TABLE sam_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  notice_id TEXT NOT NULL,
  title TEXT NOT NULL,
  event_type TEXT,            -- 'industry_day' | 'rfi' | 'forecast' | 'webinar' | 'other'
  agency TEXT,
  event_date DATE,
  event_location TEXT,
  description TEXT,
  registration_url TEXT,
  contact_info TEXT,
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  source_notice_type TEXT,    -- 'Special Notice', 'Presolicitation', etc.
  CONSTRAINT unique_event_notice UNIQUE (notice_id)
);

CREATE INDEX idx_sam_events_type ON sam_events(event_type);
CREATE INDEX idx_sam_events_date ON sam_events(event_date DESC);
CREATE INDEX idx_sam_events_agency ON sam_events(agency);
```

### 2. The extraction cron

**Path:** `src/app/api/cron/extract-sam-events/route.ts`
**Schedule:** Daily at 07:00 UTC (from `vercel.json`)
**What it does:**
- Scans new SAM.gov Special Notices + Presolicitations
- Keyword-matches against the `EVENT_KEYWORDS` table:

| Type | Keywords |
|---|---|
| `industry_day` | "industry day", "vendor day", "industry conference", "vendor outreach", "market research event", "industry engagement" |
| `webinar` | "webinar", "virtual event", "online session", "video conference", "zoom meeting" |
| `rfi` | "request for information", "rfi", "sources sought", "market survey" |
| `forecast` | "forecast", "projection", "upcoming procurement", "planned acquisition" |

- Upserts into `sam_events` by `notice_id` (idempotent re-runs are safe)

### 3. The static catalog

**Path:** `src/data/federal-events-sources.json`
**Top-level keys:**

```json
{
  "lastUpdated": "2026-XX-XX",
  "eventSources": { /* 30 sources */ },
  "eventCategories": { /* 10 categories */ },
  "majorAnnualConferences": [ /* 12 events */ ],
  "recommendations": { /* persona-keyed nudges */ }
}
```

**Categories (10):**
```
industry_day, pre_solicitation, matchmaking, training,
certification, conference, sbir_sttr, technology_briefing,
networking, innovation
```

**Event sources (30 — partial list):**
- `apex_accelerators` (PTAC successor)
- `afcea_events` (military communications & cyber)
- `same_events` (Society of American Military Engineers)
- `carahsoft_events` (reseller-led federal events)
- `gsa_interact` (GSA's industry-engagement portal)
- `sba_events` (SBA OSBP outreach)
- `sam_gov_events`
- `govevents` (aggregator)
- ...22 more

**12 major annual conferences:**
- AFCEA TechNet Cyber
- AFCEA West
- SAME Federal Small Business Conference
- SAME JETC (Joint Engineer Training Conference)
- GSA Expo
- NDIA Annual Conference
- PSC Vision Federal Market Forecast
- Navy Gold Coast
- ACT-IAC Imagine Nation ELC
- NCMA World Congress
- DHS Industry Day
- WBENC National Conference

### 4. The read API

**Path:** `/api/federal-events`

| Query | Returns |
|---|---|
| `?agency=DOD` | All events from `sam_events` where agency matches + static sources for that agency |
| `?category=industry_day` | Filtered by category (works on both dynamic + static) |
| `?naics=541512` | NAICS-matched events |
| `?all=true` | Everything: sources + categories + conferences + dynamic events |

**Consumer:** `/api/market-scanner` (Phase 3) — answers "What events?" in the 6-question market scan.

---

## What's THIN or STarget Market ResearchE

### Gap 1: Sub-agency / office-level tagging is missing
`sam_events.agency` stores the parent agency name as a free-text field. When the Target Market Research surface lets a user save "AFRL — Wright-Patterson AFB" as a target, we can't match a SAM.gov event tagged `agency: Department of the Air Force` because the granularity is off by 2 levels.

**Fix:** Add columns to `sam_events`:
- `sub_agency_name TEXT`
- `office_code TEXT` (matches our SAM Federal Hierarchy office codes)
- `parent_agency_normalized TEXT` (canonicalized)

Backfill from `description` text using NER or a simple lookup against existing agency-aliases.

### Gap 2: Static catalog is a starting point, not exhaustive
30 sources covers the biggest umbrella orgs (AFCEA, SAME, NDIA). The full universe is closer to **150-200 sources** when you count:

- All 13 OSBP small-biz event programs (per agency)
- Service-specific (Army Contracting Command, Navy Gold Coast, etc.)
- State / regional APEX Accelerators (50 states × 1-3 offices each)
- NIH SBIR/STTR program-specific events
- SBA Federal Resource Partner events
- Veterans Affairs OSDBU outreach
- Tribal 8(a) outreach (BIA, NIGA)
- WID (Women in Defense) chapter events
- LGBTQ+ Chamber of Commerce federal contracting events
- Black/Hispanic/Asian/AAPI Chamber federal events

**Fix:** Quarterly maintenance task — review the static catalog, add 5-10 sources, verify URLs aren't dead.

### Gap 3: Annual conferences need yearly dates
`majorAnnualConferences[]` only stores `typical_month` like "September". A BD user needs the actual 2026 dates. Today nobody updates these.

**Fix:** Either (a) yearly Q4 manual refresh (cheapest), or (b) one-shot Claude run that takes the conference name + URL + scrapes the current year date.

### Gap 4: No event → target-account match logic
The data is there but there's no `findEventsForUserTargets(email)` helper. Until saved target lists ship (Slice 3 of the Target Market Research roadmap), this isn't blocking — but the moment they ship, we need this query.

**Fix when needed:**
```typescript
// src/lib/events/target-matcher.ts
export async function findEventsForUserTargets(
  userEmail: string,
  options?: { upcomingOnly?: boolean; horizonDays?: number }
): Promise<MatchedEvent[]> {
  const targets = await getUserTargetAccounts(userEmail);
  const targetAgencyNames = targets.map(t => t.agency_name);

  const events = await getSupabase()
    .from('sam_events')
    .select('*')
    .in('agency', targetAgencyNames) // crude — Gap 1 fix tightens this
    .gte('event_date', new Date().toISOString())
    .order('event_date', { ascending: true });

  return events.map(e => ({
    ...e,
    matched_targets: targets.filter(t => agenciesMatch(t.agency_name, e.agency)),
  }));
}
```

### Gap 5: No `event_attendees` / RSVP tracking yet
Future-state Mindy could let users say "I'm going to AFCEA TechNet" and surface other users with overlapping target agencies who are also attending. Community-flavored feature. Defer until we have 200+ Pro users.

---

## What we keep populating

| What | How often | Who | Why |
|---|---|---|---|
| `sam_events` table | Daily auto (cron) | Already running | Live SAM.gov data |
| `federal-events-sources.json` (sources) | Quarterly | Manual review | Catch dead URLs, add 5-10 new sources |
| `federal-events-sources.json` (annual conferences) | Yearly (Q4) | Manual refresh | Get next-year dates |
| `agency_aliases.json` | When new sub-agencies are missing | Reactive | Fix Gap 1 matches |

---

## Where this database fits in the product

### Today (production)
- Market Scanner Phase 3 calls `/api/federal-events` to answer "What events are happening in this market?"
- Returns combined dynamic (sam_events) + static (sources + conferences)

### Near future (Target Market Research roadmap Slice 3-4)
- When user saves an office to their Target Market Research, automatically attach next 3 upcoming events where they can meet someone from that office
- "Mindy says: AFCEA TechNet is in 6 weeks. Lt Col Smith from AFRL is likely attending. Buy your ticket now, then DM her on LinkedIn."

### Far future (Target Market Research roadmap Slice 5+)
- Scrape AFCEA / ACT-IAC / NDIA / WID public calendars and merge into `sam_events`
- "Who else from Mindy is going to GovCon Summit?" community layer
- Auto-suggest 1-on-1 meeting requests

---

## Why this matters strategically

Federal BD is a relationship game. The actual product question that wins recompetes:

> "I'm targeting Air Force. When can I be in the same room as the AF OSBP contact this quarter?"

GovWin doesn't answer this. SAM.gov doesn't answer this. The big primes have BD teams who manually track conferences. Small businesses don't — they go to SAM, see an opp posted today, write a proposal cold, and lose.

The events DB is the layer that turns Mindy from "AI tells you what to bid on" into "AI plus your Target Market Research builds federal BD relationships over 12-18 months." That's the durable moat.

---

## Don't reinvent (scope guard)

When future product work touches events, **DO NOT**:
- Create a new `events` table — `sam_events` is the table. Add columns to it.
- Create a parallel scraper — extend `extract-sam-events` cron with new sources.
- Add a new static catalog file — update `federal-events-sources.json`.
- Build a new API route for events — extend `/api/federal-events` query params.

This PRD exists so the next person (or me, in a fresh session) doesn't accidentally build event infrastructure #2.
