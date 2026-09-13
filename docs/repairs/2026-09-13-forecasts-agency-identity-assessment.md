# Potato 0E — Forecasts agency identity: ASSESSED, NO REPAIR REQUIRED

**Date:** 2026-09-13 · **Site:** `src/lib/forecasts/query.ts:159-162`
**Verdict: the substring defect does NOT reproduce here. No fix applied.**

The instruction was explicit — *"Do not assume it is broken merely because it looks
similar. First reproduce the customer-facing behavior using real forecast queries."*
It was reproduced, and it does not misfire.

---

## The shape looks identical to the `agency_intelligence` bug

```ts
q = q.ilike('source_agency', `%${agencyTerms[0]}%`);
```

## But the data makes it safe

`agency_forecasts.source_agency` stores a **controlled vocabulary of ~20 short
ABBREVIATIONS**, not long-form names:

`NAVY · DOI · USDA · HHS · USACE · DHS · VA · DOE · DOT · GSA · DOJ · NASA ·
Treasury · DOL · NRC · SSA · EPA · ONR · NSF · NRL`

`agency_intelligence` broke because `%VA%` could hide inside a long name
("Preser**va**tion", "Na**va**jo"). There are no long strings here to hide in.

## Measured live (`queryForecasts`, production data)

| Query | Rows | Agencies returned | False positives |
|---|---:|---|---|
| `VA` | 1,390 | `["VA"]` | **0** |
| `EPA` | 50 | `["EPA"]` | **0** |
| `SSA` | 60 | `["SSA"]` | **0** |
| `HHS` | 689 | `["HHS"]` | **0** |
| `DHS` | 1,634 | `["DHS"]` | **0** |

All five requested probes return **exactly their own agency**. The collision class
that broke `agency_intelligence` does not exist on this column.

## What IS imperfect (and why it is not this Potato)

1. **Canonical long-form names return 0 forecasts** — `"Department of Veterans
   Affairs"` → **0**, `"Environmental Protection Agency"` → **0**. This is a
   *vocabulary mismatch*, the opposite failure from the read-path bug: it returns
   nothing rather than something wrong. **No customer is shown another agency's
   data.**
   - Not currently reachable in a harmful way: the map's forecast filter placeholder
     is **`"Agency (e.g. NAVY)"`** (`opportunity-map/forecasts/route.ts:130`), which
     teaches the abbreviation convention, and the MCP parameter is documented as
     *"Source agency, case-insensitive partial."* The UI, the data and the tool
     contract all agree.
2. **A partial fragment can span agencies** — `SA` → `GSA` + `SSA`; `NR` → `NRC`,
   `NRL`, `ONR`. This is the *documented* "case-insensitive partial" contract
   working as specified, and no caller passes two-letter fragments.

## Recommendation (deferred, not urgent)

Threading `resolveAgency()` here would let a user type "Department of Veterans
Affairs" and get VA's 1,390 forecasts. That is a **usability improvement**, not a
correctness repair — and it needs a canonical-name → abbreviation map that does not
exist yet (the resolver returns canonical long-form names; this column stores
abbreviations). Doing it now would mean inventing a third mapping, which the
instruction explicitly forbids.

**Filed as a follow-up candidate. Not fixed, because nothing is wrong.**

## Remaining `ilike` agency-identity sites (recorded, untouched)

`gov-buyer/acquisition-context.ts:115` · `market/recompete-match.ts:144` ·
`briefings/pipelines/multisite.ts:134` · `recompete/query.ts:194` ·
`utils/agency-forecasts-live.ts:137`. None assessed in this pass.
