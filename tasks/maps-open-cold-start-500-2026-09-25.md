# OPEN-COLD-START — first Open request after a fresh deploy returns HTTP 500 (2026-09-25)

**Status:** recorded, not fixed. Found during #1693 browser acceptance. Out of scope for #1693 (that PR does not change the Open API).

## What was measured
| When | Request | Result |
|---|---|---|
| First load after preview deploy `3df770a3` | `GET /api/app/opportunity-map` (restored search "software license") | HTTP 500 |
| First load after preview deploy `b144acbc` | same | HTTP 500 after **10,689 ms** (browser Resource Timing) |
| Same tab, minutes later, same URL | replay ×1 | 200 in 3,097 ms |
| Same tab, all three horizons concurrently | ×3 rounds | Open 200 in 4.6–5.0 s (3/3) |
| curl, preview and prod | same query | 200 in 2.9–3.7 s |

- Vercel logs for the preview show two `GET /api/app/opportunity-map 500` at 01:49:14–15 with **no log message**. The handler returns `{success:false,error:<message>}` with status 500 from `src/app/api/app/opportunity-map/route.ts` (two catch blocks: ~line 175 and ~line 491), but the error text is only in the response body, which was not captured.
- The Recompete and Forecast requests in the same round succeeded.

## Hypothesis (unverified)
A cold function plus the first DB round trip (connection setup, or a statement timeout near 10 s) on the Canonical Discovery Open path. Not reproduced warm.

## Next step when picked up
1. Log `error.message` / `error.cause` in both 500 branches (`console.error`), so Vercel logs carry the reason.
2. Force a cold start (redeploy a preview) and capture the 500 response body.
3. Check whether production shows the same class (`vercel logs --environment production --status-code 500`, filter `/api/app/opportunity-map`).

## User impact today
After #1693 (`b144acbc`) the page says **"Open couldn't load"** and paints the horizons that did load. Before that, the header read "still loading Open" indefinitely.
