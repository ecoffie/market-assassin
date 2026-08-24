# Future audit class — "not retrieved" silently becoming "none"

**Not part of this PRD.** Recorded from the P0-2 root cause so it is not lost.

## The truth rule (Mindy-wide)

> **`[]` means we looked and found none.**
> **`budget_limited` / `degraded` means we did not look.**

Collapsing the two makes a tool confidently assert a falsehood. P0-2's
`get_contractor_profile` told users "no recent awards" for a company with 1,278 awards and
$58.1M obligated — and for Lockheed Martin at $221B — because a cacheOnly miss returns `[]`
by design and nothing distinguished that from a real empty result.

## Patterns to grep when this audit runs

| Pattern | Why it hides the distinction |
|---|---|
| `.catch(() => [])` / `.catch(() => null)` | swallows a real error into an empty-looking success |
| `cacheOnly` on an authenticated/metered path | a cache miss returns `[]` without scanning or throwing (`lib/bigquery/cache.ts`) |
| `?? []` on a fetch result | same collapse, quieter |
| graceful-degrade branches in `queryCached` | BQ quota-exceeded also returns `[]` — correct for SEO, a lie for a paid tool |
| any tool returning a populated header with empty bodies | the internal contradiction is the tell (P0-2: `agencies_served: 1` beside `top_agencies: []`) |

## What a fix looks like

Three states, never two: **data · genuinely-none · not-retrieved**. The third must be
explicit in the payload (`enrichment_status`, `partial`, `degraded`) AND say what the empty
array does not mean.

## Related, already filed

- **DEFECT-7** — `lookup_sam_entity` returns `grounded:false, degraded:true` for every
  query including "Lockheed Martin". Honest in `_meta`, but reads as "no such entity".
- **DEFECT-8** — `extracted_naics_codes` conflates "can do X" with "looked at X".

Both are instances of the same family: **a payload that is technically honest in metadata
while being misleading in its primary shape.**

---

## Companion rule (DEFECT-9A, 2026-08-24) — existence vs absence

> **Mindy may conclusively assert EXISTENCE from partial observation.**
> **Mindy may assert ABSENCE only after EXHAUSTIVE observation.**

Broader than Rule of Two, and the same family as unknown ≠ none. `market_depth` was computed
from an unordered 1,000-row slice of populations up to 56,744 and presented as a property of
the market. Finding ≥2 capable firms in that slice genuinely proves they exist; finding <2
proves nothing unless everyone was examined.

**Sampling is acceptable for discovery. It is not acceptable when the result is presented as a
measurement of the population.**

Patterns to grep when this audit runs:

| Pattern | Why it hides the distinction |
|---|---|
| `LIMIT`/`.range()` feeding a `count`, `depth`, `total`, or `_met` field | a sample presented as a population |
| a boolean carrying "not found" and "does not exist" in one value | no way to express undetermined |
| any metric named like a population (`*_depth`, `*_count`, `total_*`) computed over a bounded fetch | mis-naming is the defect |
