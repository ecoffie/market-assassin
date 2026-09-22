# HHS follow-ups — filed 2026-09-13, deliberately OUT of scope for HHS activation

Both items were found while activating HHS as a living Forecast source. Neither is
a source-reliability defect, and neither blocked the activation. They are recorded
here so they do not stay hidden as implementation details.

---

## 1. HHS map coverage — 0 of 5,504 rows carry `map_lat`

**Measured 2026-09-13:** no HHS forecast row has been geocoded, so none appear on
the opportunity map.

This is a **product/enrichment coverage** issue, not source reliability. The HHS
payload carries no place-of-performance fields at all (unlike Navy, which supplies
`pop_state`/`pop_city`), so geocoding HHS would need a different input — most
likely the division/office, which gives a coarse location at best.

**Do not fix this inside a source-activation Potato.** It needs its own decision:
is a division-level pin useful, or is a missing pin more honest than a wrong one?

Related: `src/lib/forecasts/map-coverage.ts` already classifies map gaps and
distinguishes "cannot be disclosed" from "not yet geocoded".

---

## 2. Lineage debt — the writer of the original 3,643 rows is absent from the repo

The pre-existing HHS rows were written around **2026-08-01** by a process that no
longer exists in the codebase. It stamped `source_type: 'sbcx_api'`, a value
**nothing in the repository writes** — the only other occurrence is a unit-test
fixture. The in-repo scraper (`src/lib/forecasts/scrapers/hhs-sbcx.ts`) is a
Puppeteer HTML-table reader that stamps `source_type: 'puppeteer'` and builds a
composite `buildDeterministicExternalId('HHS-SBCX', [...])` id — it did NOT write
these rows.

**This is lineage debt, not operational dependence.** Everything the missing script
knew has since been re-derived and proven in-repo:

| what | status |
|---|---|
| source endpoint | proven live (5,376 records, JSON, no auth) |
| identity contract | proven (uuid, 100% populated, 0 duplicates) |
| normalization | proven (matches the held corpus exactly) |
| derived quarter/FY | reproduced at 100% / 99.97% against the live corpus |
| reconciliation | reproducible, tested, gated |
| producer | now in-repo: `hhs-ingest.ts` + `/api/cron/hhs-forecast-sync` |

**Do not spend time reconstructing the missing one-off script.** There is nothing
left to learn from it.

The general lesson is worth keeping, though: a corpus whose writer has vanished
forces archaeology at the exact moment you most need certainty. That archaeology
is what surfaced the award-vs-solicitation field bug — had the writer been in the
repo, the derivation would have been read in a minute instead of inferred from
data.
