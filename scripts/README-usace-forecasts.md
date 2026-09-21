# USACE district forecasts — manual drop

USACE forecasts are the one federal forecast source that **cannot be fetched
automatically**. This is the runbook.

## Why it's manual

Verified 2026-08-01, all three automated routes are closed:

| route | result |
|---|---|
| District PDFs (`*.usace.army.mil/Portals/...`) | **403** — Akamai edge WAF |
| HQ MILCON forecast page | **403** — same WAF |
| `business.defense.gov` DoD forecasts | **403**, and the page is under `/Archived-Pages/` |
| `acquisition.gov/procurement-forecasts` | link directory only — **no Army/USACE entry**, no consolidated dataset |
| DHS APFS API (`apfs-cloud.dhs.gov`) | works (739 records) but is **DHS-only** |

The block is an Akamai bot-protection product sitting in front of the origin.
Defeating it is not something we build. But the documents are public and serve
normally **in a browser** — so a human downloads, and this script parses.

## Runbook

**1. Download the district's forecast.** Search
`"<district> USACE acquisition forecast"` — most districts publish under
`Business-With-Us → Small Business → Acquisition Forecast`. PDF or XLSX both work.

**2. Dry-run it.** This writes nothing:

```bash
npx tsx scripts/ingest-usace-forecast.ts \
  --file ~/Downloads/spl-forecast.pdf \
  --district "ENDIST LOS ANGELES"
```

Check the output before going further:

- **`parsed N rows`** — if 0, the district's layout differs from the ones
  handled; re-run with `--dump` to see the raw text and extend the parser.
  Zero rows means the *parser* needs work, not that the district is thin.
- **`field coverage`** — naics/value/FY/set-aside fill rates. Low coverage
  means the columns weren't recognised.
- **`district joins to:`** — confirms the name matches a real office so the
  rows light up the office rollup and early-signal badge. A warning here means
  the rows will store but stay disconnected.
- **the first 10 rows** — read them. Titles should be project names, not
  fragments or page furniture.

**3. Write, once it looks right:**

```bash
npx tsx scripts/ingest-usace-forecast.ts \
  --file ~/Downloads/spl-forecast.pdf \
  --district "ENDIST LOS ANGELES" --write
```

## District naming

Use the `dodaac_directory_display.display_name` spelling so the rows join to the
office work — `ENDIST LOUISVILLE`, not "Louisville District". The dry run tells
you whether it matched. To list the real names:

```sql
SELECT dodaac, display_name FROM dodaac_directory_display
WHERE display_name ILIKE 'ENDIST%' ORDER BY display_name;
```

## Re-drops are safe

`external_id` is `USACE-<district>-<title>`, so re-ingesting a republished PDF
**updates in place** rather than duplicating the district. Districts typically
republish quarterly.

## What happens after ingest

Rows land in `agency_forecasts` with `source_agency='USACE'` and
`source_type='district_pdf'`, so they inherit everything already built:

- `GET /api/forecasts?office=ENDIST%20LOUISVILLE`
- `GET /api/forecasts?mode=offices` — the ranked "which commands to target" rollup
- the forecast map layer
- the early-signal join (27 of USACE's 48 offices carry a band)
