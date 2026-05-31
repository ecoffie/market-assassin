# Target Market Research + Event Radar — Roadmap

**Status:** Slices 1.5–5 shipped + verified in production (May 31 2026).
Remaining: Slice 5b PSC-input audit, Slice 6+ (far future).
**Owner:** Eric / Claude
**Phase 2 reframe:** Mindy's "Market Research" surface evolves into a
**Target Market Research workspace** for federal BD. Not just a one-time
research tool — a workspace for building, qualifying, and acting on
the 30-ish offices a BD person commits to working over 12-18 months.

**Vocabulary note:** Per the project rule (see memory
`mindy-vocabulary-rule`), we use plain federal-BD language. The phrase
is "Target Market Research" — what BD people actually say. We do NOT
use "Target Account List" / "TAL" / "account-based selling" / other
enterprise-SaaS sales jargon. Elon-style: if someone has to look up
the word, the word is wrong. Federal acronyms (NAICS, PSC, OSBP, etc.)
remain in plain BD use and are fine.

---

## The strategic insight

Federal BD is a relationship game. Big primes win recompetes because
they spent 18 months getting close to the OSBP, going to the right
conferences, responding to RFIs, being a known quantity before the
RFP drops.

Small BD people have nowhere to do this today. SAM.gov shows them
opportunities, USAspending shows them history, but **nothing tells
them which 30 offices to put on their target list and where to find
the decision-makers in person.**

That's the gap. That's the moat.

---

## What lives where (after full build-out)

| Surface | Function | Mental mode |
|---|---|---|
| Source Feed / Today's Intel | "What should I bid on this week?" | Tactical |
| Market Research | "Where in the market should I play?" | Strategic (discovery) |
| **My Targets** (new) | "These 30 offices are my Q3 focus" | Strategic (commitment) |
| Pipeline | "These 8 opps are in motion" | Tactical (execution) |
| **Event Radar** (new) | "Where can I meet the decision-makers?" | Strategic (relationships) |

Market Research feeds → My Targets feeds → Event Radar feeds → Pipeline.
That's the full BD funnel.

---

## Build sequence

### ✅ Slice 1.5 — Foundation (SHIPPED)

- Remove Recommended Opportunities from Market Research (duplicates
  Today's Intel)
- `/api/app/target-market-research` merging USAspending + SAM.gov so
  every agency row carries BOTH historical spend AND current office
  contact data
- All-agencies table (66+ rows, paginated) with 4 sort lenses:
  Top Spending · Easy Entry (SAT) · Budget Growth · Contracts
- Methodology dropdowns on BEST/STRONGEST/COMPETITION quick-picks so
  users can change the underlying rule (Tesla steering wheel)
- Drawer shows full office detail: sub-agency, office ID, contracting
  office, OSBP contact, SAM + USAspending deep links

### ✅ Slice 2 — Charts on top of the research workspace (SHIPPED)

Now that the data is right, the original Phase 2 charts ship:
- Spending by Agency (highlights user's saved targets vs. all)
- Set-Aside Mix donut
- 3-Year Trend
- Top 5 Primes

The hero metric becomes "8 of your 30 target agencies grew 15%+ YoY"
instead of generic market analytics.

### ✅ Slice 3 — Saved Target Lists (SHIPPED)

> Tables `user_target_list` + `user_target_outreach` live. My Targets
> sidebar panel + "Add to Targets" wired. PSC/NAICS provenance added
> May 31 (`source_naics`/`source_psc` columns + "from PSC D316" chip) —
> closes Slice 5b item #3.


Database:

```sql
CREATE TABLE user_target_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_email TEXT NOT NULL,

  -- Agency hierarchy (matches SAM Federal Hierarchy)
  agency_code TEXT NOT NULL,        -- 'AGENCY-DOD' or whatever code
  agency_name TEXT NOT NULL,        -- 'Department of Defense'
  sub_agency_code TEXT,             -- 'SUB-AF'
  sub_agency_name TEXT,             -- 'Department of the Air Force'
  office_code TEXT,                 -- 'BP01' — the leaf node
  office_name TEXT,                 -- 'Headquarters, EUSA'

  -- Target list state
  status TEXT DEFAULT 'targeting',  -- targeting / contacted / qualified / declined
  priority TEXT DEFAULT 'medium',   -- low / medium / high / critical
  notes TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_from TEXT,                  -- 'research_table' / 'opp_drawer' / 'manual'

  CONSTRAINT unique_target_per_user UNIQUE (user_email, office_code)
);

CREATE TABLE user_target_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_account_id UUID REFERENCES user_target_accounts(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,

  activity_type TEXT NOT NULL,      -- 'email' / 'call' / 'event' / 'rfi' / 'meeting' / 'note'
  contact_name TEXT,
  contact_role TEXT,                -- OSBP / Contracting Officer / SBA Liaison etc.
  subject TEXT,
  body TEXT,
  outcome TEXT,                     -- 'replied' / 'meeting_set' / 'no_response' / 'pass'
  follow_up_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

UI:

- New sidebar item under Pipeline: **My Targets** (33 offices · 8 contacted)
- Per-target page: account brief, activity timeline, "Log activity" button
- "Add to Targets" button on every agency row in Market Research

### ✅ Slice 4 — Event Radar v0 (SHIPPED)

> `/api/app/target-events` joins `sam_events` (cron-populated SAM
> Special Notices) + static catalog (`federal-events-sources.json`),
> matched per-target via agency-alias variants. Rendered in My Targets
> as Scheduled Events + Sources Sought panels.


Surface SAM.gov special notice types as events tied to target agencies.

```typescript
// SAM notice types of interest
const EVENT_NOTICE_TYPES = [
  'i',  // Industry Day
  'a',  // Award notice (good "we did it" signals)
  // Special notices announcing pre-RFP outreach
];
```

UI: "Upcoming events for your targets" section in My Targets panel.

### ✅ Slice 5 — Event Radar v1: AI Web Discovery (SHIPPED May 31 2026)

> **Status: live + verified in production.** A real discovery run for
> "Department of the Air Force" returned 8 events from 38 web results,
> all persisted to `sam_events`; second call hit the 7-day cache
> (`cached:true`, zero re-spend). Serper + Groq both confirmed healthy
> in prod.
>
> **What shipped (commit `5db736d`):**
> - `src/lib/events/ai-event-discovery.ts` — `searchEventsViaAI()`:
>   builds 4 targeted queries → Serper web search → **grounded** Groq
>   extraction (extracts only from returned snippets, no hallucinated
>   dates) → confidence-scored `DiscoveredEvent[]`.
> - `src/app/api/app/discover-events/route.ts` — POST endpoint:
>   Pro-gated, 7-day throttle per agency via `ai_event_discovery_runs`,
>   upserts into `sam_events` with `source='ai_web_search'` +
>   `confidence`, records each run.
> - `target-events` route surfaces AI rows as `source:'ai'` with
>   confidence so the UI badges them distinctly.
> - `MyTargetListPanel` — "🔍 Find more events with Mindy" button +
>   spinner; AI events render `✨ Mindy found` + `verify date` badge
>   (amber `⚠ verify date` when confidence < 0.6).
> - Migration `20260531_sam_events_ai_discovery.sql` — adds `source` /
>   `confidence` / `discovered_via` to `sam_events` (defaults keep the
>   SAM cron unaffected) + the `ai_event_discovery_runs` throttle table.
>
> **Product decisions baked in:** explicit button (not auto-fire on
> page load — cheaper, user-controlled); show-all-and-badge (persist
> every event, flag low-confidence) rather than hard confidence cutoff.
>
> **Differences from the original design below:** trigger is an
> explicit button, not auto-on-<3-events. `currentYear` is a constant
> (2026) passed into the lib since `Date.now()` context varies — bump
> annually. Otherwise matches the plan as written.

**Original plan:** Scrape AFCEA / ACT-IAC / NDIA / WID / etc. public
calendars. ~150 sources × maintenance forever.

**Better plan** (Eric, May 22 2026): Use AI to search the open web at
request time. The LLM does what a 150-scraper farm would do, on
demand, with better recall.

Flow:

1. User saves "Department of the Air Force" to their target list.
2. We query `sam_events` for AF-tagged events in next 90 days.
3. If we have < 3 events, fire an event-discovery agent:

```typescript
const events = await searchEventsViaAI({
  agency: "Department of the Air Force",
  agencyAliases: ["DAF", "USAF", "Air Force"],
  horizonDays: 90,
  preferredSources: ["AFCEA", "AFA", "ACT-IAC", "NDIA", "service-academies"],
});
```

The agent (Groq / Claude with web_search) returns structured events:

```jsonc
[
  {
    "name": "AFCEA Rocky Mountain Cyberspace Symposium",
    "date": "2026-08-12",
    "location": "Colorado Springs, CO",
    "url": "https://...",
    "agency_tags": ["DOD", "Department of the Air Force"],
    "discovered_via": "ai_web_search",
    "confidence": 0.92
  }
]
```

Persist into `sam_events` with `source = 'ai_web_search'` so future
users hit the cache. Cache TTL: 7 days per (agency, week).

**Why this wins over scrapers:**

| Scraper farm | AI web discovery |
|---|---|
| 150 scrapers × maintenance | 1 prompt × maintenance |
| Misses anything off-list | Catches anything on the public web |
| Breaks when a site redesigns | Adapts |
| Limited to sources we know about | Discovers new event series organically |
| Static schedule (weekly?) | Lazy — fires only when a user needs it |

**Cost:** Groq llama-3.3-70b with web_search ~$0.001 per query. With
~1000 users × 5 target agencies × monthly refresh = ~$50/mo.
Negligible compared to ~$200/mo of engineering time for 1 scraper.

Each AI-discovered event tagged with `source = 'ai_web_search'` and
`confidence` score — so the UI can show "Mindy found this — verify
date" badges and we can audit accuracy over time.

---

### Slice 5b — Beyond NAICS: PSC code support throughout

**Eric, May 22 2026:** "PSC codes are closer indicator of precise
business offering versus NAICS or often times too broad. We need to
allow for PSC code to do all the above in Target Market Research."

He's right. NAICS 541512 = "Computer Systems Design" = 50,000-company
bucket. PSC D316 = "IT and Telecom — Cyber Security and Data
Backup" = 500 companies. BD precision lives at the PSC layer.

**What already supports PSC:**
- `/api/usaspending/find-agencies` accepts `pscCode`
- `pscCode` flows through into the agency-discovery query
- PSC↔NAICS crosswalk exists at `src/lib/utils/psc-crosswalk.ts`

**What needs to change:**

1. **Slice 1.5C agency table UI** — surface PSC input alongside NAICS
   as a top-level filter. Two-column input: NAICS [_____] PSC [_____].
   At least one required.
2. **Slice 1.5B endpoint** — already wired (just pass `pscCode`
   through). Cache key currently `(naics, business_type, veteran)` —
   add `psc_code` to the composite key.
3. **Saved-targets table** (Slice 3) — store the PSC code that
   surfaced the target, not just NAICS. So a user with 5 saved
   targets can see "3 surfaced from PSC D316, 2 from NAICS 541512".
4. **AI Analyst prompt** — when generating bid/no-bid analysis, weight
   PSC alignment higher than NAICS match (since PSC is more precise).
5. **OpenAPI / MCP** (v3 work, see `PRD-mindy-as-ai-data-layer.md`) —
   every endpoint that accepts `naics` should also accept `psc`. AI
   agents reasoning about federal markets prefer the more precise
   classifier.

**Slice priority:** Make PSC a first-class citizen in Slice 1.5C
when we build the agency table. Don't ship the table NAICS-only and
retrofit later.

### Slice 6+ — Far future

- AI narrative: "Mindy says: your 8 Air Force targets buy 65% via IDV
  vehicles. Team with a SEWP V holder to short-circuit qualification."
- PowerPoint export: your target list as a customer pitch deck
- LinkedIn outreach templates per OSBP contact role
- Email sequences for warm intro campaigns
- Tracking: which targets converted to wins?

---

## What ISN'T this (scope guard)

- **Not a generic CRM.** Federal-specific. Agency hierarchy, OSBP
  contacts, SBA programs. Salesforce/HubSpot don't have this data.
- **Not an event-discovery tool for the general public.** The events
  matter only because they're attached to YOUR target list. GovEvents
  has 1000+ events; we surface the 3 that matter to your target list.
- **Not an automated outreach tool.** No bulk emails. No fake
  personalization. We give users the data; they make the call.
- **Not just market research with prettier charts.** Charts are
  decoration on top of the workspace, not the product.

---

## Why this is the right v2 direction

Today's Mindy = "AI tells you what to bid on" (tactical, one-shot).
Tomorrow's Mindy = "AI plus your Target Market Research workspace builds federal BD relationships
over 12-18 months" (strategic, recurring).

The first is replaceable by GovWin's $29K/yr product if they ever
build a cheap tier. The second is uniquely small-business-friendly
because no enterprise tool cares enough about events + OSBP outreach.

That's the durable moat.
