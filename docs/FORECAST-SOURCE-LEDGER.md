# Forecast Source Ledger

**Why this exists (Eric, 2026-08-01):** *"We need to keep a ledger of sorts from
where we got all this information so we can refresh when stale. I want to assign
a team to work on this weekly."*

On 2026-08-01 a health sweep found **15 of 17 forecast sources had not synced in
36+ days** — four in 111–117 days. Nothing surfaced it, because the cron reported
`success` while only syncing DHS. Rows in `agency_forecasts` carried a NULL
`source_url`, so there was no record of where they came from or how to refresh
them.

This file is the answer to *"where did this row come from, and how do I get a
fresh one?"* — one row per source, with the exact URL and the exact steps.

## How to work this ledger (weekly)

1. Run the staleness check (below). Anything over its **Refresh cadence** is due.
2. Work the **AUTO** sources first — they need no human, just a cron that ran.
3. For **MANUAL** sources, follow the Steps column exactly; each was verified
   by hand on the date shown.
4. After ingesting, re-run the check and confirm `days_stale` reset to 0.
5. If a source has moved or broken, update its row **in the same commit** as the
   fix. A stale ledger is worse than none.

```sql
-- Staleness check. Run weekly; anything past its cadence is due.
SELECT source_agency, source_type, count(*) AS rows,
       max(last_synced_at)::date AS last_synced,
       (CURRENT_DATE - max(last_synced_at)::date) AS days_stale
FROM agency_forecasts
GROUP BY 1,2
ORDER BY days_stale DESC, rows DESC;
```

---

## AUTO — no human needed

These run unattended. If one goes stale, the **cron** is broken, not the source.

| Source | Rows | URL | Cadence | Notes |
|---|---|---|---|---|
| **DHS** | 993 | `apfs-cloud.dhs.gov/api/forecast/` | Daily (cron `sync-forecasts`) | Plain JSON API, ~739 records. The original working source. |
| **HHS (SBCX)** | 3,643 | `osdbu.hhs.gov/api/sbcxopportunities/?filter=` | Weekly | Plain unauthenticated JSON, ~3 MB, no browser needed. Covers IHS 2,231 · CDC 559 · FDA 516 · HRSA 178 · CMS · ACF · NIH. ⚠️ `totalContractRange` is an ENUM ("RANGE_7"), decoded via `HHS_VALUE_RANGES` — pinned from `/api/sbcxforecastchoices/`. |
| **NASA** | 146 | `hq.nasa.gov/office/procurement/forecast/NAF.html` | Quarterly (Oct + Apr) | 14-column grid rendered client-side, **no JSON endpoint** — scrape the table, click "Show All", then walk pagination (50/page × 3). Check the per-center counts in the page's own filter sidebar sum to the scraped total. |
| **EPA** | 50 | `ordspub.epa.gov/ords/forecast/f?p=122:1` | Quarterly | Oracle APEX. Route: page 1 → **Current Opportunities** → **By Record Number**. Session ids are embedded in the hrefs, so the links must be CLICKED in sequence — a hand-built `f?p=` URL returns an empty page. The other "By …" views are the SAME 50 records grouped differently, not extra data. ⚠️ "Place of Performance" is free text mixing state codes with "Region-wide"/"Contractor's Facility" — `epaPopState()` maps the 27 of 50 that name a real state; the rest stay unpinned by design. |
| **DOE (+NNSA)** | 870 | `energy.gov/sites/default/files/YYYY-MM/OSBP Acquisition Forecast Public Version for Web.xlsx` | Monthly (cron `sync-forecasts`) | ⚠️ The file lives under a **dated directory** and moves each month. The cron 404s loudly when it does — check `energy.gov/osdbu/small-business-toolbox/acquisition-forecast` for the new URL and update `DOE_FORECAST_URL`. |

---

## MANUAL — a human must download

Every one of these hosts blocks unattended fetching (Akamai/F5 WAF) but serves
normally in a browser. **A 403 here means "download it yourself", not "dead".**

| Source | Rows | Where | Steps | Cadence |
|---|---|---|---|---|
| **Navy LRAE** (all commands) | 8,821 | `secnav.navy.mil/smallbusiness/Pages/lrae.aspx` | Download `Combined LRAE_<MM.YYYY>.xlsx`. Run `ingest-navy-lrae`. Covers NAVFAC (2,344 / $58B), NAVSUP WSS, NAVSEA, NAVAIR, NAVWAR, USMC. | Monthly — filename carries the edition date |
| **GSA Acquisition Gateway** | 6,687 | `acquisitiongateway.gov/forecast` | Public, **no login**. Click **Export CSV**. ⚠️ Hard cap of **3,000 rows per export** against ~7,650 total — filter by Agency and export in slices. Cross-file dedupe is automatic. | Monthly |
| **USACE districts** ⚠️ | 468 of ~38 districts (7 done) | **DISTRICT** sites — `www.<district>.usace.army.mil`, e.g. `www.mvn.usace.army.mil/Business-With-Us/Small-Business/Acquisition-Forecast/` (New Orleans), `www.nwp.usace.army.mil` (Portland), `www.nad.usace.army.mil` (North Atlantic), `www.spa.usace.army.mil` (Albuquerque), `www.sam.usace.army.mil` (Mobile) | **Eric must download these in a browser — every automated path is blocked.** Most districts publish a PDF (`usace-district-parse.ts` handles it); Great Lakes & Ohio River publishes one XLSX workbook covering 7 districts (`usace-workbook-parse.ts`). Run `ingest-usace-forecast.ts --file <x>` then `--write`. **HAVE (468):** Louisville 150 · Huntington 130 · Detroit 52 · Nashville 51 · Chicago 49 · Pittsburgh 18 · Buffalo 18. **MISSING:** ~31 other districts. | Quarterly |
| **ONR + NRL** | 67 | `onr.navy.mil/media/document/onr-and-nrl-long-range-acquisition-estimate` | One of the few navy.mil hosts NOT WAF'd — actually fetchable. Same LRAE layout, existing parser handles it. | Quarterly |
| **Treasury** | 200 | `osdbu.forecast.treasury.gov/forecast` | Salesforce site; data via `webruntime/api/apex/execute?...**asGuest=true**` (unauthenticated). Headless-load the page and capture the payloads. | Monthly |

---

## Map coverage — the formula for "no pin"

**Eric, 2026-08-02: "we need a formula for how we handle no mapping."**

"0% mapped" was being read as ONE condition, so it got one response — usually a
shrug. Measured across 33,076 forecasts it is FIVE conditions, and three of them
are BUGS that were sitting behind an "it's a source limitation" explanation.

Policy + classifier: `src/lib/forecasts/map-coverage.ts`
Weekly audit: `npx tsx scripts/audit-forecast-map-coverage.ts` (read-only)

| Class | Meaning | Response |
|---|---|---|
| `NO_LOCATION_PUBLISHED` | The portal has no place field at all | **Accept.** Record here; never re-litigate. The only honest 0%. |
| `SUPPRESSED_BY_SOURCE` | "Cannot be disclosed" (USDA 1,625 · GSA 53) | **Accept**, and show the label — "withheld" is information, a blank is not. |
| `NOT_A_PLACE` | "TBD" · "Nationwide" · "Headquarters" · "VENDOR'S FACILITY" | **Accept.** Never invent a centroid: a nationwide IDIQ pinned to Kansas lies about scope. |
| `RECOVERABLE_FORMAT` | A real place in the wrong shape — "Washington, DC" in a state column | **Fix the PARSER**, then re-ingest. |
| `CORRUPT_STATE` | Non-state token in a state column — "DI"/"TE"/"NO"/"WE", a NAICS code | **Fix the PARSER.** Never guess the expansion. |

**The order matters — step 1 is the one that catches real bugs:**

1. **Does the SOURCE publish a place field at all?** No → accept forever. Yes →
   *a 0% is a bug until proven otherwise.* EPA and Treasury both sat at 0% while
   publishing locations; from the database side they looked identical to HHS.
2. Real place, wrong shape → fix the parser.
3. Non-state token in a state column → fix the parser, never guess.
4. Explicitly "no single place" → accept.
5. Deliberately withheld → accept, and label it.

**What we NEVER do:** place a pin we cannot defend. No office-address fallback
for forecasts (the buying office is not the place of performance), no state
centroid for "Nationwide", no expanding a truncated code. **An absent pin is a
fact; a wrong pin is a claim.**

### Open, found by the first run of this audit (8,889 fixable rows)

| Source | Fixable | What |
|---|---|---|
| **NAVY** | 5,040 | ⚠️ **Biggest single gap.** The LRAE has an "Anticipated Place of Performance" column captured into `raw_data` and never mapped to `pop_state` — the EPA bug at 200x scale. ~3,400 are genuinely TBD/"VENDOR'S FACILITY", but **~1,600 are real installations** in a base-code dialect (`ML: OCEANA`, `NW: BANGOR PDC`, `Philadelphia, PA (NSWC)`). Needs a base-name gazetteer, not a regex. |
| **USACE** | 2,484 | The enterprise DA file has no place column, but the district files carry `Project Location` / `Location` on ~120 rows. |
| **DOI/GSA/DOT** | ~670 | `CORRUPT_STATE` — "DI"/"TE"/"NO"/"WE" are the first two letters of a word, not USPS codes. ⚠️ `VI` in the same column IS real (US Virgin Islands, 149 rows) — do not lump them. |
| USDA · DHS · DOJ · others | ~700 | Assorted format issues; run the audit for the current breakdown. |

---

## BLOCKED — checked and closed (do not re-derive)

Each was verified on **2026-08-01**. Re-check only if you have new information.

| Source | Why it is closed |
|---|---|
| **DOJ** | Forecast is a **Power BI embed** (`app.high.powerbigov.us`). Found the report id and the `wabi-us-gov` query API, but detail rows render to CANVAS and only load on interaction; the model/export endpoints 401 without the embed's session token. Summary aggregates are reachable, the row detail is not. |
| **VA** | `vendorportal.ecms.va.gov/evp/fco/EntireVA.aspx` needs a **requested account + email approval** (Eric hit this 2026-08-01). The form itself also resisted automation. Biggest single gap in the table — 15,233 expiring contracts vs 1,390 forecasts — so worth revisiting once access lands. |
| **VA, DOT** (own sites) | **Migrated into GSA Gateway** as of Oct 2025. Their OSDBU pages went dark because the data moved — get them from the Gateway export instead. |
| **Army** (all commands) | No forecast file published. `osbp.army.mil` is a **dead domain** (NXDOMAIN); `army.mil/osbp` lists commands and event PDFs only. |
| **Air Force / AFMC / AFLCMC** | Email-request only. AFMC states it outright: *"To receive a list of contracts expiring in FY27-29, email afmc.sb.workflow@us.af.mil."* AFLCMC has an expiring-contracts XLSX but it 403s even with the exact URL. |
| **DOI/USDA/DOJ/DOL/NASA** (own scrapers) | Puppeteer scrapers **rotted** — they load the page and extract 0 rows. Deliberately unscheduled: a job that "succeeds" while importing nothing is the failure shape that hid this for 36 days. Get these from the Gateway export instead. |

### The Army/Air Force gap has a better answer than waiting

We already hold **24,115 Army + Air Force contracts expiring within 3 years**
($362B, 100% incumbent and NAICS coverage) in `recompete_opportunities`. That is
the same thing AFMC would email — a list of expiring contracts — and we have it
now. Prefer surfacing that over chasing the email.

---

## Three lessons that cost real time today

**1. A 403 is not a dead end.** It means blocked-to-the-machine. A browser
downloads it fine. USACE, Navy LRAE and the AFLCMC file are all 403 to `curl`
and all trivially downloadable by a human.

⚠️ **But "blocked-to-the-machine" is not always temporary — don't record a guess
about *why* as if it were a finding.** On 2026-08-01 this row said Akamai's 403s
"look like rate limiting, expected to clear. Retry later." Retried 2026-08-02:
still 403, from **curl, WebFetch, AND a real headless Chrome with a full browser
fingerprint** — every `*.usace.army.mil` host, HTML pages and PDFs alike, all
behind the same Akamai edge (`master-config-usace.dma.mil.edgekey.net`, errors
at `errors.edgesuite.net`). A control fetch of `energy.gov` returned 200, so it
is not the local network. Treat USACE as **permanently human-download**, not as
"retry tomorrow".

The same entry also carried a URL that never worked: `lrd.usace.army.mil` and
every other DIVISION-code host (`swd`, `nwd`, `sad`, `nad`, `spd`, `mvd`) is
**NXDOMAIN**. USACE publishes per **DISTRICT** — `www.mvn`, `www.nwp`,
`www.spa`, `www.sam` — which resolve fine. A URL recorded from memory instead of
from a working fetch sends the next person down a dead end and looks like the
site went away.

**2. Never guess URLs — find the page, then watch what it calls.** GSA Gateway
was written off twice as login-gated. That conclusion came from probing
`ag-dashboard.acquisitiongateway.gov`, a *different* app that bounces to
Login.gov (and to an `identitysandbox.gov` TEST IdP at that). The public tool
needs no auth and has an Export CSV button. Same mistake with Treasury: guessed
URLs returned 404, but the real page — two links deep from `home.treasury.gov`
on a dedicated subdomain — serves 400 records over an unauthenticated API.

**The right method:** search for the agency's actual forecast page → follow its
links → load it headless and watch the network calls. That is how the Navy LRAE
(8,821 rows) and Treasury (200 rows) were both found.

**3. The same mistake, twice, on the same source.** HHS was recorded as closed
TWICE — first from eight guessed URLs returning 403/404, then from seeing a JS
app and calling it "login-gated". It is neither: `osdbu.hhs.gov` is public, and
its forecast is a plain JSON API returning 3,643 records. Applying the method
properly (load the page → click through → watch the network) took ten minutes
and produced the single largest source after the Navy.

**4. Capturing a field is not mapping it.** A parser that stashes the source
record in `raw` looks complete and passes its own tests — but if nothing copies
that column into `pop_state`, the rows land on the map with no location. EPA sat
at **0% mapped while 27 of its 50 rows named a state in plain text**. Treasury
failed the same check for a different reason (a country-spelling guard).

The cheap check after ingesting ANY new source, before calling it done:

```sql
-- Any source at 0% is a mapping bug until proven a source limitation.
SELECT source_agency, count(*) AS rows,
       round(100.0*count(*) FILTER (WHERE map_lat IS NOT NULL)/count(*)) AS pct_mapped
FROM agency_forecasts GROUP BY 1 ORDER BY pct_mapped, rows DESC;
```

A 0% row is only acceptable once you've opened the portal and confirmed it
publishes no location at all — true for HHS, NASA and SSA, and false for EPA
and Treasury, which both looked identical from the database side.

**Vocabulary matters.** The Navy does not publish a "forecast" — it publishes a
**Long Range Acquisition Estimate (LRAE)**. Searching the wrong word returns
nothing. Other terms worth trying on a new agency: *Acquisition Forecast*,
*Procurement Forecast*, *Long Range Acquisition Forecast (LRAF)*, *Advance
Planning Briefing for Industry (APBI)*, *Forecast of Contracting Opportunities
(FCO)*.
