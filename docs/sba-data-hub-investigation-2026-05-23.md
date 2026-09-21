# SBA Data Hub & data.sba.gov — Investigation Notes (2026-05-23)

**Trigger:** Eric — "look at the sba data" (after the federal construction SAT mix came back genuinely empty)
**Status:** Investigation complete. One usable CSV dataset identified; full Goaling Report API access not available publicly.

## The two SBA surfaces I investigated

### 1. SBA Data Hub (https://datahub.certify.sba.gov/)

The pretty dashboard Eric pointed to. Filters by Funding Department / Agency / NAICS / Vendor District / SBA Region, charts Small Business / SDB / WOSB / SDVOSB / HUBZone / 8(a) dollars over time.

**What it actually is:**
- A Create React App SPA at `datahub.certify.sba.gov` (just the loading shell + branding)
- That iframes / proxies to a **Streamlit app** at `oppl.certify.sba.gov` (the actual interactive dashboard)
- Streamlit + Snowflake stack (per the bundle's Apache 2.0 Streamlit copyright)

**Why this matters for us:**
- Streamlit apps don't expose REST APIs — they're server-rendered Python over WebSocket
- There's no documented API endpoint to call from our code
- No CSV download from the dashboard itself

**Verdict:** Dead end for direct integration. Beautiful BI tool for humans, not a data API.

### 2. data.sba.gov (the SBA's open-data portal)

Different surface — the official SBA CKAN portal.

**What it actually is:**
- A full CKAN open-data portal (same platform as data.gov)
- Standard CKAN JSON API at `https://data.sba.gov/api/3/action/*`
- Browsable + searchable dataset catalog

**Worked endpoints:**
- `package_list` — returns all dataset slugs
- `package_search?q=...` — full-text search across datasets
- `package_show?id=<slug>` — full metadata + resource URLs for a dataset

**No auth required, no rate limits documented.**

## What's actually downloadable that helps us

Only TWO datasets matched our needs in a broad search:

### A. WOSB-eligible NAICS list (small, useful, simple)

- Slug: `eligible-naics-for-the-women-owned-small-business-federal-contracting-program`
- Format: CSV (one file: `wosb_naics_2022.csv`)
- Direct URL: https://data.sba.gov/dataset/4f496731-c087-4759-ac87-28d8a4e0a7f2/resource/4ca6c873-7ab7-4708-8cdf-1e3fcd03ef07/download/wosb_naics_2022.csv
- Updated: March 2022 (stale; SBA updates this every few years)
- License: Public domain

**What we'd do with it:**
- Import once into a tiny `wosb_eligible_naics` table (or static JSON file in `src/data/`)
- On the user's WOSB profile, surface "Your NAICS X is eligible for WOSB set-aside competition" as a positive signal in the AgencyDrawer

### B. FY23 Federal Contracting Data by Race/Ethnicity (the real prize)

- Slug: `fy23-federal-contracting-data-by-race-ethnicity`
- Format: CSV (`disaggregated_by_agency_fy23.csv`, 22 KB, 200 rows)
- Direct URL: https://data.sba.gov/dataset/3302152a-9ac5-49c9-ba72-c01cab38f01e/resource/b2f16b6c-1780-4e93-abca-1cf8a7c54e72/download/disaggregated_by_agency_fy23.csv
- Updated: May 2024
- Source: SBA Small Business Goaling Report (the master document)
- License: Public domain

**Schema:**
```
FUNDING_DEPARTMENT_NAME,category,dollars,total,pct
```

**`category` values:**
- Asian American Owned Small Business
- Black American Owned Small Business
- Hispanic American Owned Small Business
- Native American Owned Small Business
- Subcontinent Asian American Owned Small Business
- Other Minority Owned Small Business
- Other Small Business
- Not a Small Business

**Example row:**
```
AGRICULTURE, DEPARTMENT OF,Asian American Owned Small Business,215658879.48,11584201962.44,0.01861663670741
```

So for USDA in FY23, $215.7M (1.86% of $11.58B total contracting) went to Asian American Owned Small Business firms.

## What this gives us

A **real "Set-Aside Mix by Agency" data table** that we can:

1. Ingest as a one-time CSV import into a `sba_goaling_fy23` table
2. Display in the AgencyDrawer when a user opens an office — show what % of THAT specific agency's spend went to each socioeconomic SB category last FY
3. Power a new "Best agencies for [my certification]" view — sort by % of dollars going to my socioeconomic category

**Better than the current SAT mix donut for the SMB user.** The current donut answers "what % of spend is under $350K?" The new view would answer "what % of THIS agency's spend went to small businesses LIKE YOU (woman-owned / black-owned / Hispanic-owned / etc.)?"

The latter is way more actionable.

## What's NOT in the public data

The Data Hub dashboard surfaces these dimensions that the CKAN CSV doesn't have:

- **NAICS code breakdown** — we can't get "% of NAICS 236220 spend by socioeconomic category"
- **Sub-agency / contracting office** breakdown — only top-level departments
- **Year-over-year trends** — only FY23 snapshot
- **WOSB / SDVOSB / HUBZone / 8(a)** breakdown — the CSV groups by race/ethnicity not by certification type
- **Vendor district** — no geographic breakdown

To get any of these we'd need either:
1. The SAM Contract Awards API (`typeOfSetAsideName` field — blocked on System Account per docs/sam-contract-awards-api-investigation-2026-05-22.md)
2. USAspending category aggregations with the `recipient_type_names` filter (which IS documented but adds complexity)
3. A direct relationship with SBA's data team to access the Snowflake source

## Recommendation: ship the FY23 CSV in a focused 2-hour session

Concrete plan when we come back to this:

1. **Migration:** `supabase/migrations/<date>_sba_goaling_fy23.sql`
   - Schema: `funding_department TEXT, category TEXT, dollars NUMERIC, total NUMERIC, pct NUMERIC, fiscal_year INT`
   - Primary key: `(funding_department, category, fiscal_year)`

2. **Import script:** `scripts/import-sba-goaling.js`
   - Fetches the SBA CKAN CSV (or processes a local copy)
   - Maps to schema, upserts into `sba_goaling_fy23`
   - Runs idempotently — re-running with the same FY23 file is a no-op

3. **Endpoint:** `/api/sba-goaling?agency=<NAME>`
   - Returns the 8-row breakdown for that agency
   - Cached forever (data is FY-snapshot; no need to refresh until SBA publishes FY24)

4. **AgencyDrawer integration:** new "Small Business Mix" section showing the 8 categories as a horizontal stacked bar + the user's eligible category highlighted

5. **NEW Market Map tile:** "Top 5 Agencies for [Your Certification]" — replaces or augments the SAT mix donut for users with a small-biz certification on their profile

6. **WOSB-eligible NAICS check:** small bonus — flag in AgencyDrawer when the user's NAICS is on the WOSB eligibility list

## Why I'm capturing instead of building today

You've been shipping for ~12 hours. The fix-pile in the last hour (chart data alignment, SAT mix copy, NAICS expansion, FPDS leaderboards) is significant. Stopping to integrate the SBA CSV is another 2-hour focused session that deserves its own clean start, not an exhausted-end-of-night attempt.

Also: the SAT mix donut now tells the truth (amber teaming-pivot copy for NAICS where no SAT-eligible spend exists). So the immediate user-visible bug is fixed. Layering SBA data on top is an enhancement, not a regression fix.

## Files captured

- `docs/sam-contract-awards-api-investigation-2026-05-22.md` — the new SAM API
- `docs/sam-contract-awards-transition.md` — FPDS sunset reference
- `docs/sba-data-hub-investigation-2026-05-23.md` — this doc
- `tasks/TODO-migrate-to-sam-contract-awards-api.md` — SAM migration plan
- Task #235 (pending) — SBA Data Hub integration → use THIS doc as the basis

## Two CSV download URLs to bookmark for next session

```
# FY23 federal contracting by race/ethnicity (the Goaling Report slice)
https://data.sba.gov/dataset/3302152a-9ac5-49c9-ba72-c01cab38f01e/resource/b2f16b6c-1780-4e93-abca-1cf8a7c54e72/download/disaggregated_by_agency_fy23.csv

# WOSB-eligible NAICS codes (2022 vintage)
https://data.sba.gov/dataset/4f496731-c087-4759-ac87-28d8a4e0a7f2/resource/4ca6c873-7ab7-4708-8cdf-1e3fcd03ef07/download/wosb_naics_2022.csv
```

Both wget-able with no auth, no headers, no rate limit.
