# 50-state matchmaker / APEX events feed — design note (post-Mindy-Day)

Status: design only, no code. Owner: Data Core (Agent 3). Follows #2527 (state filter + hand-kept regional catalog
for CT, VA, MD, DC, FL).

## Goal

`search_federal_events` with `state` / `near` returns, for every state, the local events a small business can attend:
APEX Accelerator training and matchmaking, SBA district matchmakers, and state procurement matchmakers. Every row comes
from the organizer's own page, carries a date only when that page states one, and the answer says which states are
covered and how fresh the data is (internally).

## 1. Sources per state

One **source registry** row per organizer feed (a small table, `regional_event_sources`), never per event:

| field | meaning |
|---|---|
| `state` | 2-letter |
| `organizer`, `organizer_url` | the official organizer (APEX center, SBA district office, state procurement office) |
| `kind` | `apex` · `matchmaker` · `industry_day` · `conference` |
| `adapter` | how to read it (below) |
| `feed_url` | the machine-readable endpoint the adapter reads |
| `enabled`, `last_ok_at`, `last_error`, `last_event_count` | operations; internal |

Adapters, in priority order (measured 2026-11-27):

1. **eCenterDirect** (`<center>.ecenterdirect.com`). Used by many APEX centers (e.g. Virginia, Maryland). The calendar
   page is script-rendered, but the page itself calls a public JSON endpoint:
   `GET /events/feed?source=conferences&start=YYYY-MM-DD&end=YYYY-MM-DD` → `[{id, title, start, end}]`
   (verified for virginiaapex and mdapex). Event detail URL: `/events/<id>`; location from `/events/eventinfo` or the
   detail page.
2. **The Events Calendar REST** (WordPress "tribe"): `GET /wp-json/tribe/events/v1/events?start_date=…&per_page=50`
   → structured `{title, start_date, end_date, url, venue}` (verified for ctapex.org).
3. **iCal** (`?ical=1` on Events Calendar sites, `.ics` exports): RFC 5545 VEVENTs.
4. **University / platform calendars with a JSON feed** (e.g. `events.ucf.edu/.../upcoming/feed.json`), per platform.
5. **Static organizer page** (no feed): hand-kept row like today's catalog, undated unless the page text states a
   date. Used for SBA district matchmakers and state procurement fairs, which are announced as one-off pages.

Discovery: start from the APEX Accelerators directory (apexaccelerators.us) to enumerate centers per state; SBA
district offices from sba.gov district pages; state procurement offices from each state's procurement portal. Every
source is added by a person after opening the organizer page (no automated crawling of unknown sites, no AI rows).

## 2. Refresh cadence and the no-date rule

- A cron (`sync-regional-events`, a `cron_jobs` row, never `vercel.json`) runs **daily**, reading each enabled source
  over a 120-day window. It upserts events by `(source_id, external_id)` into `regional_events` and marks events that
  disappeared from the feed as `removed_at` (kept for history, never shown).
- **No date unless stated:** an event row exists only when the feed states a start date. A static-page source with no
  stated date stays a standing organizer row whose reader text is "check the organizer page". A past date is never
  shown as next. No date is inferred from a "typical month".
- `verified_at` / `last_ok_at` are internal (no-date rule for customer text); they drive staleness, not copy.
- A source failing 3 consecutive days alerts ops (the existing data-age alarm pattern: unknown is never fresh) and its
  events are reported as "not currently confirmed", never silently dropped.

## 3. Per-state coverage reporting

`regional_coverage` (already in the #2527 tool shape) is computed from the registry, not hand-kept:

- `covered`: states with ≥1 enabled source that read OK within 3 days.
- `stale`: states whose sources all failed for >3 days (shown as coverage gap, not as "no events").
- `not_covered`: no source yet → fallback to the APEX directory link.
- Internal admin view: per state, sources / last OK / events in window — feeds `/admin/data-inventory` as a
  `source_corpus` dataset with per-source advancement (avoids the "dataset-level clock hides dead sources" trap).

## 4. Script-loaded calendars (e.g. Virginia)

Do not run a headless browser in production. A script-rendered calendar almost always fetches a JSON endpoint; the
adapter calls that endpoint directly (Virginia's eCenterDirect page calls `/events/feed`, verified to return dated
events from 2026-12-01). If a calendar has no readable endpoint, the source stays a static organizer row (undated,
"check the organizer page") until a feed is found. Never scrape rendered HTML for dates.

## 5. Out of scope / guardrails

- No AI-discovered events in this feed (the optional AI pass stays agency-scoped and labelled).
- No customer contact, no writes outside `regional_event_sources` / `regional_events`.
- Migrations: additive, applied with `--only` after Eric's OK; first bulk load sized and approved first (rule 11).

## 6. Rollout

1. Migration (2 tables) + adapters 1–3 + registry seeded for the 5 states already hand-kept (CT, VA, MD, DC, FL).
2. Cron + data-age alarm + admin coverage view.
3. Add states in batches from the APEX directory; each batch reviewed (sources opened by a person).
4. Retire the hand-kept `regional-events-catalog.json` rows once each state's registry source reads OK.

## Immediate note (not part of this design's build)

Virginia's row in #2527 is undated because its calendar looked unreadable; the `/events/feed` endpoint above shows
dated Virginia APEX events (first: 2026-12-01, "Finding Government Contracting Opportunities", Virginia Beach). The
feed build will pick it up automatically; a one-line catalog update can do it sooner if wanted.
