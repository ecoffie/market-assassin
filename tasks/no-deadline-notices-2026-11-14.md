# Active SAM notices with no response deadline (Agent 3, 2026-11-14)

**Status:** read-only investigation (Eric, 2026-11-14). Search eligibility unchanged. Production data ~21:00Z.

## 1. What they are

9,712 rows have `active = true` and `response_deadline IS NULL`. No "open" search surface shows them
(production open = `active AND response_deadline > now()`, `map-filters.ts:201`). All were posted between
2026-09-18 and 2026-11-14.

| Notice type | Rows | Archive date still in the future | Share of that type (active, posted last 60 days) with no deadline |
|---|---|---|---|
| Award Notice | 8,407 | 2,936 | 97.4% |
| Justification (sole-source J&A) | 1,024 | 343 | 100% |
| Presolicitation | 157 | 137 | 6.4% |
| Special Notice | 99 | 76 | 5.4% |
| Sources Sought | 17 | 14 | 0.6% |
| Consolidate/(Substantially) Bundle | 8 | 6 | 100% |
| Solicitation, Combined Synopsis/Solicitation | 0 | | 0% |

## 2. Is the date somewhere else?

No. Every one of the 9,712 rows has a `raw_data.responseDeadLine` key and it is empty in all of them: SAM.gov itself
published no response date. `archive_date` is present on all rows, but it is SAM's display-removal date, not a
response deadline, and must not be presented as one. **The missing deadline is not an ingestion or normalization
defect.**

## 3. A real normalization defect found alongside: `active` is not cleared

The sync's stale cleanup (`sync-sam-opportunities` → `staleCleanupMode`) only REPORTS unless
`SAM_STALE_CLEANUP=apply`, and that variable is **not set in production** (checked). So rows are never flipped to
inactive when SAM's dates pass:

| Active rows | Count | Archive date already passed |
|---|---|---|
| With a deadline | 32,391 | 8,908 |
| Without a deadline | 9,712 | 6,200 |

Open search is barely affected (it also requires a future deadline), but anything that counts "active" notices
over-counts, and 6,200 of the 9,712 are past SAM's own archive date. Turning cleanup on is a bulk write (15,000+ rows)
and needs a dry run and Eric's go-ahead; not proposed in this pass.

## 4. Actionable or not (sample of 20 across the non-award types)

| Type | What the sample shows | Actionable for a contractor? |
|---|---|---|
| Award Notice (8,407) | Contract awarded | No bid. Intelligence (who won, value); belongs with awards / competitive intel |
| Justification (1,024) | Sole-source justification | No bid. Intelligence; at most a capability-statement challenge |
| Presolicitation (157) | Mix: "solicitation to follow" (USACE snow removal, DHA OMNIBUS on-ramp, Chesterton sewer rehab) and "intent to sole source" | Yes, as an early signal; some are sole-source notices |
| Special Notice (99) | DLA Distribution business forecast, sole-source modification, shortlist announcement, solicitation-number change | Mixed: forecasts are useful early signals, shortlists and number changes are not |
| Sources Sought (17) | Space Force construction CSO open until 2030, VA RFIs, Army hand-tools AOI | Yes: respondable now |
| Consolidate/Bundle (8) | FAR 7.107 consolidation notices | Informational |

Roughly **233** rows (non-award types with an archive date still in the future) are the candidates that could be
actionable. The other ~9,400 are award or justification notices.

## 5. Recommendation (no change made)

1. **Award Notices and Justifications stay out of Open.** They are not biddable. If surfaced, it belongs in an
   awards / competitive-intelligence view, not Open.
2. **The ~233 non-award notices inside their archive window are candidates for a separate, clearly labelled group**
   ("No response date published", e.g. under Open or as an early-signal category). Never mixed into Open's deadline
   order, never shown as closing soon, never given an invented date. Before that: Agent 4 labels a sample (actionable
   vs not), since sole-source intents and shortlists sit beside real early signals.
3. **Separately, decide on `SAM_STALE_CLEANUP=apply`** (bulk write, dry run first): it is the actual data defect.
