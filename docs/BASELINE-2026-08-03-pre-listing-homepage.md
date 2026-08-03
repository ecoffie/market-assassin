# Pre-swap baseline — captured 2026-08-03

Snapshot taken **before** the listing page becomes the home page (planned end of week).
This exists because the comparison it enables cannot be reconstructed afterward.

Source: `user_engagement` (Supabase), 30 days ending 2026-08-03.
Queries were **explicitly paged** — an unpaged select returns 1,000 rows and undercounts
this table by ~47x (1,000 vs 46,676). Any figure here that disagrees with a single-select
query is not wrong; the single select was truncated.

## Headline

| Metric | Value |
|---|---|
| Total events (30d) | **46,676** |
| Distinct users (30d) | **1,128** |
| Events, last 7d | **9,202** |
| `opportunity_map` events (30d) | **0** |

**The map recorded zero events in thirty days.** Not low usage — no instrumentation. The
map had no `track()` calls at all until PR #831 merged on 2026-08-03; the 14 events
previously visible against it were leaking in from other surfaces. Map data begins
2026-08-03 and has no history before that date. Do not compare post-swap map numbers to
any pre-2026-08-03 figure — there is nothing there to compare to.

## Engagement by source (30d)

| Source | Events | Users |
|---|---:|---:|
| daily_alert | 18,342 | 1,010 |
| market_intelligence | 15,053 | 369 |
| source_feed | 4,422 | 28 |
| market_intel_dashboard | 4,415 | 18 |
| weekly_alert | 1,697 | 373 |
| mindy_insight | 1,184 | 77 |
| daily_alerts | 955 | 102 |
| pipeline | 181 | 19 |
| todays_intel | 133 | 15 |
| forecasts | 73 | 10 |
| onboarding | 69 | 11 |
| settings | 56 | 13 |
| market_research | 52 | 10 |
| grants | 22 | 6 |
| pricing_intel | 16 | 5 |
| sidebar | 6 | 4 |
| **opportunity_map** | **0** | **0** |

Note `daily_alert` and `daily_alerts` are separate strings for the same idea — a naming
split worth collapsing before anyone sums this column by hand.

## Weekly trend

| Week | Events | Users |
|---|---:|---:|
| most recent 7d | 9,202 | 759 |
| −1 | 13,323 | 904 |
| −2 | 13,759 | 772 |
| −3 | 9,669 | 262 |
| −4 | 723 | 149 |

Week −4 is small because the table itself was filling up, not because usage was low.
Treat weeks −3 through 0 as the usable comparison window.

## `page_view` by source (30d)

The closest proxy for "which surface do people land on":

| Source | Views | Users |
|---|---:|---:|
| market_intelligence | 8,749 | 369 |
| mindy_insight | 1,122 | 77 |
| pipeline | 143 | 19 |
| market_intel_dashboard | 104 | 18 |
| forecasts | 64 | 10 |
| grants | 21 | 6 |

## What is NOT in here, and why

**GA4 numbers for the current home page.** The home page has zero `track()` calls, so it
does not appear above at all — it exists only in GA4. Pulling it is blocked:

- `GCP_SA_JSON` is set and the service account authenticates fine.
- The **GA4 Data API is enabled** — a probe returns `PERMISSION_DENIED` (wrong property
  id), *not* `SERVICE_DISABLED`.
- The **Admin API is disabled** on project `market-assasin` (project number
  1074909804476), and the service account is read-only so it cannot enable it. That API
  is the only way to map a measurement id to a numeric property id.
- `GA4_PROPERTY_ID` is unset in `.env.local` and in Vercel, and appears nowhere in either
  repo.

Live measurement id on getmindy.ai: `G-PZCDFBZ9WL`. A measurement id is not a property id;
the Data API needs the numeric one.

**To unblock (about 30 seconds):** GA4 Admin → Property Settings → copy the numeric
PROPERTY ID, then `vercel env add GA4_PROPERTY_ID`. With that one value the Data API
works immediately — nothing else is missing.

## How to redo this after the swap

Query `user_engagement` for the same 30-day shape, **with explicit paging**, and compare
per-source. The specific number that tests the product claim is the ratio:

    listing_open / cards_shown        (both now emitted by opportunity_map)

`cards_shown` is the denominator — 40 opens is excellent against 200 cards shown and
dismal against 20,000. Neither figure means anything alone.
