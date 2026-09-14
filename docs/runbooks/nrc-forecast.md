# NRC Forecast of Contract Opportunities — runbook

| | |
|---|---|
| source_key | `forecast_nrc_gateway` |
| dataset | `forecast_intelligence` |
| ingest | **manual / controlled** (canonical machine path auth-gated) |
| source watch | `/api/cron/nrc-source-watch` — `5 15 * * *`, `timeout_ms` 50000 |
| ingest cron | **none** — deliberately not created |
| identity | **NRC sourceId** → `NRC_26_NNNN` (source-native, 89/89 verified) |
| held | **89** rows, 89/89 geocoded, 89/89 provenance |

## Sources

| Role | Locator |
|---|---|
| NRC landing page | `https://www.nrc.gov/about-nrc/contracting/small-business/forecast.html` |
| **Canonical data** | GSA Acquisition Gateway FCO — the machine path used for the 2026-06 snapshot, host `ag-dashboard.acquisitiongateway.gov` |
| Public tool | `https://www.acquisitiongateway.gov/forecast` — public, Export CSV (see the correction below) |
| Secondary artifact | `https://www.nrc.gov/docs/ML2604/ML26042A301.pdf` — FY2026 PDF, **edition signal only** |

NRC's own page states it: *"NRC uses the GSA Acquisition Gateway to post the forecast."*

## ⛔ Access condition (measured 2026-09-14)

`ag-dashboard.acquisitiongateway.gov` 302-chains to **`secure.login.gov`** demanding OpenID
Connect at **AAL2 (MFA)**. Classified **`auth_gated`** — not "unreachable", not "current".

**HTTP 200 is not access.** Every guessed path — `/api/forecast`, `/api/v3.0/forecast`,
`/forecast/api/search`, `/forecast/resources/<id>` — returns 200 with the **identical
19,603-byte Angular shell**. A byte-identical body across unrelated paths is a **soft-404**;
the watcher measures that signature and refuses to read it as data.

### ⚠️ A correction this runbook must carry

`docs/FORECAST-SOURCE-LEDGER.md` records this source being written off as "login-gated"
**twice**, both times from probing the `ag-dashboard` host — *"a different app"*. The **public
tool needs no auth and has an Export CSV button** (6,687 rows, 44 columns, ~3,000-row export cap).

**This session repeated that same error before catching it.** Both facts are true and must be
stated together: the **public tool** is open, while the **machine/API path these 89 rows were
ingested through** is gated. Re-establishing a supported export route is **coverage work**,
deliberately out of scope here.

**Never guess URLs.** The ledger's method: find the agency's real page → follow its links → load
it headless and watch the network calls. Guessing produced five 200s that were all the same shell.

## ⛔ Access policy — non-negotiable

**Do not automate around Login.gov.** No browser-session scraping around MFA, no persisted
personal Login.gov cookies, no replayed authenticated sessions, no personal-MFA automation, no
authentication bypass, and never treat the public JS shell as the underlying data API.

The only acceptable route is **supported machine access or an organization-owned authorized
credential**. Open questions for GSA: is FCO access available to commercial/vendor/research
organizations; does GSA offer API credentials, service accounts, org-owned access, approved
machine-to-machine access, or an authenticated export; can Mindy obtain a stable organizational
credential. **Not yet asked.** Until resolved, ingest stays manual/controlled.

## The PDF is an edition signal ONLY

FY2026, 34 pages, `Last-Modified: 2026-02-26`, ETag `"319e21d023a7dc1:0"`, valid `%PDF-`.
**Its data tables are scanned images** — pages 8/15/25 yield **0 text characters**; ~3,318 chars
extract from the whole document, all narrative front matter. It carries **no `NRC_26_`
identifiers**.

It must **never** populate `upstream_population`, `held_population`, or `last_source_advance`,
never claim record-level currentness, and **never be OCR'd into forecast records** — it cannot
establish source-native row identity for the held 89. A change in its fingerprint/metadata is an
informational signal that a new edition exists, requiring controlled verification.

## Provenance repair (2026-09-14)

All 89 rows had **no `raw_data`** — never stored (`import-forecast-refresh.js` doesn't populate
it), not corrupted. The originating snapshot survives in-repo
(`data/imports/forecasts-refresh-2026-06.csv`), so repair was defensible.

Proven before mutation: snapshot 89 rows / 89 distinct sourceIds / 0 blank / 0 duplicate ·
held 89 / 89 distinct · identity crosswalk **89/89** · **0 unexplained field drift**.

Repaired in one transaction (advisory lock, `FOR UPDATE` on all 89, 15 invariants before COMMIT):
`raw_data` ← the exact source row object, **stored verbatim, not normalized** (all 20 original
columns). Receipts: attempted 89 · repaired 89 · failed 0 · **forecastSemanticUpdates 0** ·
**geocodingChanges 0** · deletes 0.

### `source_url` stays NULL — deliberately

The originating importer sets `source_url: null` (line 114) and never recorded an endpoint. The
snapshot's `source` column names only a **host and date**: *"GSA Acquisition Gateway FCO API
(ag-dashboard.acquisitiongateway.gov), pulled 2026-06-25"*. **No exact URL is proven, so none was
fabricated.** The historical source is recorded here instead:

> **Historical source:** GSA Acquisition Gateway FCO API · **host:** `ag-dashboard.acquisitiongateway.gov`
> · **snapshot:** 2026-06-25 · **import:** 2026-06-26

## Clocks

`last_verified_ingest` = `2026-06-26T01:33:39.653Z` (the demonstrable one-shot import).
`last_data_advance` = the provenance-repair commit — a **real** data mutation.

**NULL and staying NULL:** `last_successful_check` (no evidence the 2026-06 import successfully
read the canonical live source — 89 rows existing is not that evidence), `last_source_advance`
(no live source advancement observed; repairing from a historical snapshot is not a source
check), `upstream_population`, `upstream_fingerprint`, both `*_revision` fields.

On a watch run while gated: **`last_poll` advances; nothing else moves.** Forecast rows are never
mutated.

## Recovery

A `machine_readable` probe sets **`unmeasured` + `required`**, never `current`, and alerts *"run a
fresh read-only audit before enabling automated ingestion."* Re-establish schema, population,
identity uniqueness, historical ID stability, field semantics, lifecycle semantics and
fingerprint/currentness **before** building or enabling ingest.

## Checks

```bash
npm run db -- data_source_instances --eq source_key=forecast_nrc_gateway
npm run db -- agency_forecasts --count --eq source_agency=NRC     # 89
curl -s "$HOST/api/cron/nrc-source-watch?dry=1&password=$ADMIN_PASSWORD" | jq '.canonicalSource, .pdfSignal.lastModified'
```
