# Target Accounts CRM + Event Radar — Roadmap

**Status:** Planning, May 22 2026
**Owner:** Eric / Claude
**Phase 2 reframe:** Mindy's "Market Research" surface evolves into a
**Target Account List (TAL) builder** for federal BD. Not a research
tool. A workspace for building, qualifying, and acting on the 30-ish
offices a small BD person commits to working over 12-18 months.

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

### Slice 1.5 — Foundation (this session)

- Remove Recommended Opportunities from Market Research (duplicates
  Today's Intel)
- `/api/app/target-accounts` merging USAspending + SAM.gov so every
  agency row carries BOTH historical spend AND current office contact
  data
- All-agencies table (66+ rows, paginated) with 4 sort lenses:
  Top Spending · Easy Entry (SAT) · Budget Growth · Contracts
- Methodology dropdowns on BEST/STRONGEST/COMPETITION quick-picks so
  users can change the underlying rule (Tesla steering wheel)
- Drawer shows full office detail: sub-agency, office ID, contracting
  office, OSBP contact, SAM + USAspending deep links

### Slice 2 — Charts on top of TAL (next session, ~3 hrs)

Now that the data is right, the original Phase 2 charts ship:
- Spending by Agency (highlights user's saved targets vs. all)
- Set-Aside Mix donut
- 3-Year Trend
- Top 5 Primes

The hero metric becomes "8 of your 30 target agencies grew 15%+ YoY"
instead of generic market analytics.

### Slice 3 — Saved Target Lists (1 week, ~6 hrs)

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

  -- TAL state
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

### Slice 4 — Event Radar v0 (1 week)

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

### Slice 5 — Event Radar v1 (2 weeks)

Scrape public conference calendars + match by agency:

| Source | What's there |
|---|---|
| AFCEA International | AFCEA TechNet, AFCEA West, AFCEA Defensive Cyber Ops, etc. |
| ACT-IAC | Federal CIO summits, ELC, Imagine Nation |
| NDIA | Major Range & Test Facility, Special Operations, etc. |
| WID (Women in Defense) | Annual conferences |
| ASPE (Acquisition Solutions Professional Education) | Pricing & cost training |
| SBA SBA Federal Events Calendar | OSBP outreach events |
| GovEvents.com | Aggregator |

Each scraped event tagged with sponsoring agencies + likely attendees.
Match to user's target list → "DOD-AF · Lt Col Smith likely at AFCEA
TechNet · Sep 12 · Anaheim".

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
  has 1000+ events; we surface the 3 that matter to your TAL.
- **Not an automated outreach tool.** No bulk emails. No fake
  personalization. We give users the data; they make the call.
- **Not just market research with prettier charts.** Charts are
  decoration on top of the workspace, not the product.

---

## Why this is the right v2 direction

Today's Mindy = "AI tells you what to bid on" (tactical, one-shot).
Tomorrow's Mindy = "AI plus your TAL builds federal BD relationships
over 12-18 months" (strategic, recurring).

The first is replaceable by GovWin's $29K/yr product if they ever
build a cheap tier. The second is uniquely small-business-friendly
because no enterprise tool cares enough about events + OSBP outreach.

That's the durable moat.
