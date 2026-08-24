# P0-2 Task 0 — trace. Root cause found; it is NOT the PRD's hypothesis.

**Reproduced live 2026-08-23, and it is SYSTEMIC, not Fluidyne-specific.**

| Query | found | award_count | agencies_served | top_agencies | recent_awards |
|---|---|---|---|---|---|
| FLUIDYNE CORPORATION | true | 1,278 | 1 | **[]** | **[]** |
| LOCKHEED MARTIN CORPORATION | true | 4,850 | 4 | **[]** | **[]** |

$221B and 4,850 awards also returns empty bodies. **Every caller of this tool gets a
populated header over an empty body.** The PRD filed this as a Fluidyne identity-path
problem; it is not an identity problem at all — identity resolves correctly, which is why
the header is right.

## The actual mechanism

`src/lib/chat/tier2-tools.ts:167-170`

```ts
const [awards, agencies] = await Promise.all([
  getRecentAwardsForRecipient(childUeis, profile.rollup_uei, 5, resolvedCold).catch(() => []),
  getTopAgenciesForRecipient(childUeis, profile.rollup_uei, 5, resolvedCold).catch(() => []),
]);
```

The 4th argument is `liveBq`, and it is passed **`resolvedCold`** — true only when the
*profile* lookup itself had to go cold this turn.

`src/lib/bigquery/recipients.ts:459` → `cacheOnly: !liveBq`
`src/lib/bigquery/cache.ts:95-98`:

```ts
const cacheOnly = opts.cacheOnly ?? true;
if (cacheOnly) {
  return [];        // cache MISS on a cacheOnly call returns [] — never scans, never throws
}
```

So the failing path is:

1. Profile resolves from **warm cache** (the common case — these are popular companies).
2. `resolvedCold = false`.
3. Awards/agencies therefore run **cache-only**.
4. Their cache keys (`rollup:{uei}:top-agencies:5:v4-m`, `...:recent-awards:...`) are
   **separate** from the profile's key and were never warmed.
5. Cache miss → `return []` → empty arrays, no error, no flag.

**The `.catch(() => [])` is a red herring** — nothing throws. The empty array is the
designed return value of a cache miss under `cacheOnly`.

## Why it is self-perpetuating

`cacheOnly` never scans, so it also **never writes the cache**. A key that is cold stays
cold forever on this path. The only way these keys warm is if some *other* caller requests
them with `liveBq=true`. That is why the defect is permanent rather than intermittent, and
why it hits mega-primes as readily as small firms.

## Why the guard exists (do not simply flip it)

The `cacheOnly` default is deliberate — `src/lib/bigquery/cache.ts:59-67` documents it as
**SEO-SAFE-BY-DEFAULT**, added after `tasks/bigquery-cost-spike-2026-06.md`. It stops
crawler traffic on the public long-tail (`/awards`, `/contractors`, `/agencies`, `/top`)
from driving cold-miss BigQuery cost storms. **Removing it would re-open a known cost
incident.**

The comment even states the intended split: *"Authenticated Mindy paths pass
`cacheOnly:false` to opt INTO live BQ."* **That is exactly what this call site fails to
do.** An authenticated, metered MCP tool (10 credits) is running on the SEO-safe default.

So this is not a bug in the guard. It is a call site on the wrong side of it.

## The fix, stated as a question of authority — not yet written

`getContractorProfile` is authenticated and metered. It has the authority the guard was
designed to grant. The narrow fix is to pass `true` for `liveBq` on the two enrichment
calls rather than `resolvedCold`.

**Cost must be sized before that ships**, because it converts a free path into a scanning
path. Two mitigating facts, both from the code: the queries are already scan-capped by
`AWARDS_SCAN_MAX_BYTES`, and `getTopAgenciesForRecipient` was deliberately optimised
(comment at recipients.ts:462: *"NO COUNT(DISTINCT award_id) … ~doubled the scan
5.9→3.0 GiB on mega-primes"*). Results are cached after the first live call, so the cost is
once-per-company, not per-request.

**Open question for Eric:** whether every `get_contractor_profile` call should be allowed to
trigger a cold BQ scan, or whether it should be gated by the same `allowColdLookup()` budget
already used for the profile lookup itself (`tier2-tools.ts:140`). The second is more
conservative and reuses machinery that exists. I have NOT chosen — it is a cost decision.

## Also worth noting

`agencies_served: 1` for Fluidyne and `4` for Lockheed come from `profile.distinct_agency_count`
(the recipients row, free) — so the header knows there ARE agencies while the body shows
none. That internal contradiction is the tell, and no honest-miss flag reports it.
