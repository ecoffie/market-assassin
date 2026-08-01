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
| **DOE (+NNSA)** | 870 | `energy.gov/sites/default/files/YYYY-MM/OSBP Acquisition Forecast Public Version for Web.xlsx` | Monthly (cron `sync-forecasts`) | ⚠️ The file lives under a **dated directory** and moves each month. The cron 404s loudly when it does — check `energy.gov/osdbu/small-business-toolbox/acquisition-forecast` for the new URL and update `DOE_FORECAST_URL`. |

---

## MANUAL — a human must download

Every one of these hosts blocks unattended fetching (Akamai/F5 WAF) but serves
normally in a browser. **A 403 here means "download it yourself", not "dead".**

| Source | Rows | Where | Steps | Cadence |
|---|---|---|---|---|
| **Navy LRAE** (all commands) | 8,821 | `secnav.navy.mil/smallbusiness/Pages/lrae.aspx` | Download `Combined LRAE_<MM.YYYY>.xlsx`. Run `ingest-navy-lrae`. Covers NAVFAC (2,344 / $58B), NAVSUP WSS, NAVSEA, NAVAIR, NAVWAR, USMC. | Monthly — filename carries the edition date |
| **GSA Acquisition Gateway** | 6,687 | `acquisitiongateway.gov/forecast` | Public, **no login**. Click **Export CSV**. ⚠️ Hard cap of **3,000 rows per export** against ~7,650 total — filter by Agency and export in slices. Cross-file dedupe is automatic. | Monthly |
| **USACE districts** | 468 | Division sites, e.g. `lrd.usace.army.mil/Business-With-Us/Forecast-Opportunities/` | Download the division workbook (one sheet per district). Run `ingest-usace-forecast.ts --file <x> ` then `--write`. Great Lakes & Ohio River = 7 districts in one file. | Quarterly |
| **ONR + NRL** | 67 | `onr.navy.mil/media/document/onr-and-nrl-long-range-acquisition-estimate` | One of the few navy.mil hosts NOT WAF'd — actually fetchable. Same LRAE layout, existing parser handles it. | Quarterly |
| **Treasury** | 200 | `osdbu.forecast.treasury.gov/forecast` | Salesforce site; data via `webruntime/api/apex/execute?...**asGuest=true**` (unauthenticated). Headless-load the page and capture the payloads. | Monthly |

---

## BLOCKED — checked and closed (do not re-derive)

Each was verified on **2026-08-01**. Re-check only if you have new information.

| Source | Why it is closed |
|---|---|
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

**Vocabulary matters.** The Navy does not publish a "forecast" — it publishes a
**Long Range Acquisition Estimate (LRAE)**. Searching the wrong word returns
nothing. Other terms worth trying on a new agency: *Acquisition Forecast*,
*Procurement Forecast*, *Long Range Acquisition Forecast (LRAF)*, *Advance
Planning Briefing for Industry (APBI)*, *Forecast of Contracting Opportunities
(FCO)*.
