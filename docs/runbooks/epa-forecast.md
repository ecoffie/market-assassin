# EPA Acquisition Forecast — runbook

| | |
|---|---|
| source_key | `forecast_epa_apex` |
| dataset | `forecast_intelligence` |
| ingest | **manual / controlled** (upstream unreadable) |
| reachability watch | `/api/cron/epa-source-watch` — `50 14 * * *` |
| ingest cron | **none** — deliberately not created |
| identity | **EPA Record Number** → `EPA-<recordNumber>` (source-native) |
| held | **50** rows, 27 geocoded |

## Canonical source

| | |
|---|---|
| Catalog / landing | [EPA contracts](https://www.epa.gov/contracts) · [data.gov record](https://catalog.data.gov/dataset/epa-acquisition-forecast-database) |
| Canonical application | `https://ofmpub.epa.gov/apex/forecast/f?p=forecast` |
| Redirects toward | `ordspub.epa.gov` → CNAME `ordspubproxy.epa.gov` (134.67.21.32) |
| Format | **Oracle APEX application** |
| Downloadable dataset | **none** — data.gov lists the portal as the only distribution, marked non-public, metadata last updated 2021-12-15 |
| Steward | `belles.richard@epa.gov` |

## ⛔ Current access condition (measured 2026-09-14)

| Host | Result |
|---|---|
| `www.epa.gov` | 200 |
| `ofmpub.epa.gov` | 200 / 302 (entry point is healthy) |
| `ordspub.epa.gov` | **000 — TCP reset on every path** (`/`, `/ords/`, `/ords/forecast/`, the app URL) |
| `ordspubproxy.epa.gov` | **000** |

TLS completes (~0.46s), *then* the peer resets. **Not** header-sensitive, **not** HTTP/2-sensitive,
unchanged with a cookie jar across 8 bounded attempts. An **independent third-party vantage also
times out (408)** — so this is **EPA-side infrastructure, not a Mindy egress block** (contrast SSA,
where we were singled out). It is **intermittent**: some attempts return the first 302 before dying.

**The prior audit's explanation — "302 redirect chain, follow APEX session" — is disproven.** The
chain is real (5 hops, each minting a fresh APEX session id) but following it correctly fixes
nothing; the host itself refuses the connection. **Do not spend more time tuning headers or session
handling until the APEX application is actually reachable.**

## ⚠️ What counts as "reachable"

**Not** any of: `ofmpub` returning the first 302 · TLS succeeding · one redirect succeeding ·
HTTP 200 whose body is a proxy/error/login page.

Recovery requires the chain to **land on the APEX application** and return a response carrying real
application markers (`apex`, `f?p=`, `Record Number`, `p_flow_id`, …). The watcher requires ≥2
markers and a non-trivial body; otherwise it reports `apex_invalid_payload`.

## Failure classification

`discovery_unreachable` · `redirect_started` · `apex_transport_reset` *(today)* · `apex_timeout` ·
`apex_http_error` · `apex_invalid_payload` · `reachable_pending_verification`

**Never collapsed to "0 records" or "source empty."** Unknown is not zero.

## Watch semantics

A blocked run is a **successful watch** (`success: true`, `sourceReachability: "blocked"`) — the
job's purpose is to measure a known-unavailable source, so it must not mark itself `error` daily.
*Job success ≠ source health. Job success ≠ data advancement.*

Clocks while blocked: **`last_poll` advances. Nothing else moves.**
`last_successful_check`, `last_verified_ingest`, `last_data_advance` are pinned;
`last_source_advance`, `upstream_population` and `upstream_fingerprint` stay **NULL**;
`held_population` stays 50. **Forecast rows are never mutated.**

One alert per distinct condition via the shared `shouldSendAlert`/`fingerprint` gate.

## Why three instance fields are NULL (and must stay that way)

There is **no row in `forecast_sync_runs` for EPA** — no receipt proves the 2026-08-01 import
successfully *read* the source.

- `last_successful_check` — **NULL.** Rows landing is not proof the source was read cleanly.
- `upstream_population` — **NULL.** 50 rows *stored* is not proof 50 was the *complete* upstream
  population. Never infer one from the other.
- `upstream_fingerprint` — **NULL.** No fingerprint was recorded at pull time, and fingerprinting
  the held DB rows and labelling it "upstream" would be a fabricated measurement.
- `last_source_advance` — **NULL.** EPA exposes no source clock (no Last-Modified, ETag, edition,
  or publication date) through this application.

`last_verified_ingest` / `last_data_advance` **are** set to `2026-08-01T22:39:44.705Z`: the rows
demonstrably landed, and that was a real data advance.

## ⛔ Do NOT build the ingest producer from the held shape

The stored `raw_data` preserves the Aug-1 source columns:

`NAICS Code · Description · Record Number · Estimated Dollars · Target Award Year ·
Procurement Method · Place Of Performance · Target Award Quarter`

That is **historical evidence, not proof of the live schema.** When the source recovers, run a fresh
**read-only** audit first and establish: current population · actual schema · identity uniqueness ·
**cross-release Record Number stability** · lifecycle vocabulary · field mapping · null semantics ·
whether any source clock/fingerprint is obtainable. Only then build the producer.

## Held state (do not degrade because the source is down)

| | |
|---|---|
| Physical rows | **50** (50 distinct ids, 0 dupes, 0 nulls) |
| Identity | 50/50 reproduce deterministically from `raw_data.record_number` |
| `raw_data` | 50/50 valid JSON objects, no corruption |
| Mindy enrichment | **27** rows with `map_lat`/`map_lng`/`map_loc_source='state'` — **must be preserved** |
| FY spread | FY2026 22 · FY2027 21 · FY2028 4 · FY2029 2 · FY2030 1 |
| Lifecycle | held status uniformly `forecasted`; EPA's vocabulary is **unknown** while unreadable → absence ≠ deletion, **DELETE = 0** |

## Follow-up (non-blocking)

Ask the data.gov steward `belles.richard@epa.gov` whether (1) EPA is aware of the APEX availability
issue, (2) a supported machine-readable distribution exists, (3) an API/CSV/XLSX replacement is
planned. **Not yet sent.** Phase II closure does not depend on a reply.

## Checks

```bash
npm run db -- data_source_instances --eq source_key=forecast_epa_apex
npm run db -- agency_forecasts --count --eq source_agency=EPA        # 50
curl -s "$HOST/api/cron/epa-source-watch?dry=1&password=$ADMIN_PASSWORD" | jq '.sourceReachability, .failureClass'
```
