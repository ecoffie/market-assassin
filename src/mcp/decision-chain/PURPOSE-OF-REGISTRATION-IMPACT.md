# purpose-of-registration impact — measured, no re-sync needed

Eric flagged this as potentially P0-adjacent: *"Before we celebrate a market-depth number
like 20,074 small businesses, we should know how many are actually registered for All Awards
rather than Federal Assistance Only."*

Measured directly from the extract already on disk (field index 6, present on 100% of rows).

## Whole registry — the concern is real at scale

| Code | Meaning | Entities | Share |
|---|---|---|---|
| **Z2** | All Awards | 644,889 | **72.0%** |
| **Z1** | **Federal Assistance Only (grants)** | **249,945** | **27.9%** |
| Z3 | IGT only | 555 | 0.1% |
| Z5 | Fed Assistance + IGT | 26 | 0.0% |
| Z4 | All Awards + IGT | 14 | 0.0% |

**28% of the registry — 249,971 entities — cannot receive procurement awards.** Mindy has no
way to exclude them today. For any market count sourced from `sam_entities` without this field,
roughly one in four "contractors" is a grants-only registrant.

## 561720 — the concern does NOT apply here

| Code | Firms marked small for 561720 | Share |
|---|---|---|
| **Z2 All Awards** | **24,819** | **100.0%** |
| Z1 Federal Assistance Only | 10 | 0.04% |
| Z3 IGT only | 1 | 0.00% |

**Procurement-eligible: 24,819 of 24,830.** Eleven grants-only firms in the pool.

So the P0-3 headline survives essentially unchanged. The Rule-of-Two conclusion for 561720
Small Business does not depend on this field — the market is ~100% procurement-registered,
which makes sense for janitorial services (grants-only registrants skew to
research/nonprofit/education).

**This is the useful outcome of measuring rather than assuming.** The concern was
well-founded registry-wide and would have been the right call in a research-heavy NAICS; it
happens not to bite in this one.

## Why it is still worth persisting

1. **Registry-wide it is a 28% error term** on any contractor count that does not filter it.
2. **It is NAICS-dependent** — 0.04% here, but a 541715 (R&D) or 611310 (universities) market
   would look very different. A future market-depth run in those codes would be materially
   wrong.
3. **It costs one column.** The field is already in every extract row and every API payload.

## Note on the count discrepancy

This probe reports **24,830** firms marked Y for 561720 from the raw extract, while the DB
query earlier reported **20,074** for `small_business_naics @> ['561720']` among
active/non-excluded entities. The difference is expected and explainable — the DB figure is
filtered to `registration_status='Active'` and `exclusion_flag=false`, while the extract
probe counts every row regardless of status. **Not reconciled row-by-row**; flagged rather
than assumed.

## Recommendation

Add `purpose_of_registration` (code + description) in the same pass as `raw_data`. Do NOT
retro-fit a filter into `market-research.ts` yet — for 561720 it changes nothing, and the
right move is to persist the field, then measure its effect across representative NAICS
before altering any depth calculation.
