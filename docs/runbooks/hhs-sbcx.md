# Runbook — HHS SBCX forecast (AUTOMATED)

**Status: fully automated. No routine human action required.**

## What this source is

The HHS Small Business Customer Experience (SBCX) opportunity forecast, served as
plain unauthenticated JSON:

```
GET https://osdbu.hhs.gov/api/sbcxopportunities/?filter=
```

~4.4 MB, single response, no pagination, no auth, no browser needed.

⚠️ The repo twice recorded this source as *"login-gated SPA — no file, no API."*
That was wrong. The site is public; the forecast lives at
`/industry/opportunity-forecast`, and its "View All" fires this API. **A 404 on a
URL you invented is evidence of nothing** — find the page, follow its links, watch
what it calls.

## Identity — PROVEN

HHS publishes a real per-record `uuid`. Measured on the live payload:
5,376 records, **5,376 distinct uuids, 100% populated, 0 duplicates**, byte-stable
across repeated pulls. The held corpus already stores it as
`external_id = 'HHS-' + UPPERCASE(uuid)`.

This is why HHS can be automated and Navy cannot: Navy's identity contract was
lost, HHS's was recorded.

## Currentness — no upstream watermark exists

HHS exposes **no** ETag, **no** Last-Modified, **no** `updated_at`, **no** version
field, and sends `cache-control: no-store`. So:

- `last_source_advance` stays **NULL** — nothing defensible to derive it from
- `latest_upstream_revision` / `latest_held_revision` stay **NULL** — do NOT invent
  a revision string
- Currentness = **canonical content fingerprint** + uuid-population reconciliation

The fingerprint canonicalizes before hashing (records sorted by uuid, object keys
sorted, source data only, no Mindy fields, no poll timestamp), so formatting or
ordering churn is not mistaken for a content change. Truncated SHA-256, 32 of 64
hex chars.

## Field ownership

**HHS owns 16 fields** (`HHS_SOURCE_OWNED_FIELDS`) — title, description, naics,
values, offices, POCs, incumbent, status, bureau, source_url.

**Mindy owns the derived fields** (`HHS_DERIVED_FIELDS`): `anticipated_quarter`
and `fiscal_year`. HHS publishes month/year INPUTS; the quarter/FY labels are
Mindy's interpretation. They are populated on NEW rows only, and are never diffed
and never overwritten by source reconciliation.

⚠️ The derivation is `hhsQuarter(targetAwardMonth)` / `hhsFy(targetAwardYear)` —
**AWARD**, not solicitation. Recovered empirically against the live corpus:
3,479/3,479 (100%) and 3,478/3,479 (99.97%); the single miss is a source typo
(`targetAwardYear = 2042`) correctly rejected by the 2020-2040 guard. An earlier
reconstruction used SOLICITATION timing and produced 2,915 false diffs that would
have flipped the convention on ~1,700 rows and erased a held value with NULL on
1,175 more.

## Lifecycle: rows absent from today's payload are RETAINED

164 held rows are not in the current feed. HHS publishes **no deletion or
withdrawal semantics**, so absence is not proof a record died — 56 of them have
titles still present upstream under new uuids (reissued), 108 have no current
representation. They are retained and reported as `historicalRetained`.

**Do NOT delete a row merely because today's API omits it.**

## Population semantics — read this before calling HHS "behind"

```
raw upstream        5,376   what the API returns
usable upstream     5,340   after parse rejection
parse rejected         36   title < 4 chars — counted, never silently dropped
current represented 5,340   current source records Mindy holds
historical retained   164   withdrawn upstream, kept by us
physical rows       5,504   5,340 + 164
```

`upstream_population` and `held_population` both track the **5,340 current**
figure. Comparing the physical 5,504 against the raw 5,376 would make a healthy
source look inconsistent.

## Operating it

The cron is `hhs-forecast-sync`. `?dry=1` runs the full plan and writes nothing.

A healthy unchanged run returns `inserted: 0, updated: 0, unchanged: 5340,
dataAdvanced: false` and does **not** advance `last_data_advance`.

## Lineage debt (known, not operational)

The 3,643 pre-existing rows were written by a one-off process around 2026-08-01
whose writer is **absent from the repository** (it stamped `source_type:
'sbcx_api'`, which nothing in the codebase writes). This is lineage debt, not an
operational dependency: the endpoint, identity, normalization, derivation and
reconciliation are all now proven and in-repo. **Do not spend time reconstructing
the missing script.**

## Known gap — not a source problem

**0 HHS rows carry `map_lat`.** None have been geocoded, so they do not appear on
the opportunity map. That is a product/enrichment coverage issue, filed separately;
it is not a source-reliability defect and was deliberately out of scope here.
