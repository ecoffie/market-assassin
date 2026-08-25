# Incident: 11,772 contractor pages published a zero they could not prove

**Opened:** 2026-08-24 · **Status:** Option A built (PR pending) · cache warm **NOT executed**

---

## Impact

getmindy.ai search impressions, 28-day windows:

| Window | Impressions | Clicks |
|---|---:|---:|
| May 29 – Jun 26 | **36,257** | 206 |
| Jun 26 – Jul 24 | 20,665 | 120 |
| Jul 24 – Aug 21 | **5,100** | 71 |

**~86% loss from the June peak.** The contractor programmatic SEO surface — the whole
point of 36,453 sitemap URLs — collapsed to single-digit impressions per page.

---

## Cause

`queryCached()` defaults to `cacheOnly: true` and returns `[]` on a cache **miss**. That
`[]` was indistinguishable from a genuine zero-row result. With live BigQuery reads
disabled (a deliberate cost decision), every awards read took that path.

Result: 11,772 `/contractors/<x>/contracts` pages rendered
**"Showing contracts 1–0 of 0 total"** beneath titles reading
**"Senture LLC — 29 Federal Contracts ($399M)"**.

The title survives because it is built from the **rollup** row, which is cached
separately and stayed warm. `generateMetadata()` also runs independently of the page
body, so nothing reconciled the two. Google crawled eleven thousand pages contradicting
their own headlines and demoted the cluster.

**The data was never missing.** Senture's UEI holds 330 award rows in BigQuery, and its
rollup row is correct.

### ⚠️ Correction to the first diagnosis — kept deliberately

My initial report claimed the page queried a **"wrong UEI, `PZCDFBZ9WL`"**. That is
false. `PZCDFBZ9WL` is the **Google Analytics tag id** (`G-PZCDFBZ9WL`), which I
pattern-matched out of the page HTML with a regex for UEI-shaped strings.

The UEIs are correct: `rollup_uei` and `child_ueis` both hold `GC51JCDRQP95`, which
matches real awards.

This correction stays in the record on purpose. A "wrong UEI" story is a **data-quality**
diagnosis; the real defect is a **cache-contract** one. If the wrong story outlived the
fix, the next person would go hunting for a UEI-mapping bug that does not exist, and the
actual failure mode — a silent empty masquerading as a fact — would keep its cover.

---

## Option A — fail-closed presentation (built)

- `cacheOnly` misses call `markUnavailable()` and log `COLD MISS`
- Four-state API: `bqResultState()` → `hit | empty | unavailable | failed`, plus
  `bqUnavailable()`. A zero row count is no longer self-describing.
- `getPaginatedAwardsForRecipient()` returns `{ rows, total, available }`
- `generateMetadata()` re-checks availability — unavailable yields a neutral title, an
  honest description, and `noindex, follow`
- Body renders an honest unavailable state linking to the parent profile (which works —
  964 words)
- **Never 404s or redirects.** A cold cache makes every page look past-the-end; 404ing
  would have deleted 11,772 legitimate URLs and thrown away the automatic recovery.
- Sitemap gates `/contracts` on one cheap cache probe

Recovery is automatic: every check is per-request, so indexing resumes the moment the
cache is warm. No manual resubmission.

**11 unit tests** pin the semantics, including that the three zero-row states are not
interchangeable and that an unavailable page is never 404'd.

---

## Option B — bounded cache warm (dry-run only, NOT executed)

### Pagination: confirmed a real gap

The cache key is `rollup:<uei>:awards-page:<page>:<pageSize>:v2-m` — **page number is
part of the key**, so page 2+ are separate entries. A page-1-only warm would have left
every deep page unavailable. Good catch.

### Scope

| Measure | Value |
|---|---:|
| Recipients with ≥1 billable award | **274,579** |
| Billable award rows (`obligation_amount > 0`) | **54,938,799** |
| Pages if every page is warmed | **1,324,159** |
| **Pages within the 20-page indexable cap** | **419,985** |
| Recipients with < 50 awards (one page each) | 244,843 (**89%**) |
| Recipients with exactly 50 | 386 |
| Recipients with > 50 | 29,350 |
| Recipients with 0 | **0** |
| Largest single recipient | **4,149,416 awards** (~83,000 pages) |

**Warm to the indexable cap (20 pages), not to exhaustion.** Pages past 20 are already
`noindex` by design, and one outlier recipient would otherwise contribute 83,000 entries
on its own.

### Cost — the useful surprise

| Query | Scan | Cost |
|---|---:|---:|
| All indexable award pages (windowed, ≤1,000 rows/recipient) | **16.57 GB** | **$0.101** |
| Per-recipient totals | 1.32 GB | $0.008 |
| **Total** | **17.89 GB** | **≈ $0.11** |

Warming **all 20 pages costs exactly the same as warming page 1** — BigQuery bills bytes
scanned per column, not rows returned. The windowed variant scans an identical 16.57 GB.

**~230× under the $25 threshold.** Retain `maximumBytesBilled` at **20 GB** — comfortably
above the 17.89 GB actual, hard-failing anything unexpected.

### Cache lifetime and invalidation

- TTL: existing `DEFAULT_TTL_SECONDS`
- Invalidation: the `DATA_VERSION` prefix in `buildKey()`. **A bump cold-starts every key
  at once** — which is exactly how this outage would recur. With Option A merged the
  failure is now fail-closed (noindex + honest state) rather than a false zero, but the
  warm must be re-run after any bump.
- Estimated cache footprint: ~420K entries; 89% are single-page recipients

---

## ⚠️ Second inconsistency found (separate from this incident)

Even fully warmed, Senture's page will read "29 Federal Contracts" above **124 rows
across 3 pages**. All three numbers are correct measurements of different things:

| Figure | Value | What it counts |
|---|---:|---|
| `rollup.award_count` (in the title) | **29** | distinct awards, rollup basis |
| `COUNT(DISTINCT award_id)` | 23 | distinct contracts |
| Rows the table lists | **124** | award **modifications** (`obligation_amount > 0`) |
| All rows incl. $0 mods | 330 | everything |
| `rollup.total_obligated` | $399,095,920 | rollup |
| `SUM(obligation_amount)` billable | $429,353,782 | awards table |

A user who counts the rows will not get 29. **This is a labelling problem, not a data
problem** — the table lists *actions*, the headline counts *contracts*. Worth fixing
(e.g. "23 contracts · 124 actions"), but deliberately **not** bundled into this incident.

---

## Sibling audit

**Six** call sites are hard-locked to cache-only with the identical failure mode:

| Cache key | Surface | State today |
|---|---|---|
| `awards-page` | /contracts | **cold — caused this incident** |
| `awards-total` | /contracts headline | **cold** |
| `all-naics` | /naics | warm (renders 2,006 words) |
| `all-agencies` | /agencies | warm (renders 787 words) |
| `similar` | related contractors | unverified |
| `canonical-of` | slug resolution | warm (redirects work) |

This is a **partial** outage. The same fail-closed contract must be extended to the other
five before the incident closes, or the next `DATA_VERSION` bump reproduces it elsewhere.

**Live BigQuery deliberately NOT enabled globally.** Pages stay `cacheOnly`, so crawler
traffic can never generate a recurring bill.

---

## Execution plan (awaiting approval)

1. Run the bounded warm — one query, ≤20 GB billed, ~$0.11
2. Read back and checksum against BigQuery for Senture (`GC51JCDRQP95`: 124 billable
   rows, 3 pages, $429,353,782.14) plus recipients with <50, exactly 50, and >50 awards
3. Verify `/contracts` renders real rows, correct totals, working pagination, and
   `index, follow`
4. Merge Option A as permanent fail-closed protection
5. Simulate a cold miss and confirm `noindex` + unavailable state + sitemap exclusion +
   `COLD MISS` log — never "0 contracts"
6. Extend the contract to the remaining five call sites


---

## ⚠️ Scope reconciliation — the write side was never measured

Eric held execution on this, correctly. I had priced the **BigQuery scan** and treated the
job as approved because it was cheap. But the scan is not the constraint — **420,000 cache
writes** are, and I had not measured them at all. "BigQuery charges the same" does not make
the writes free or safe.

### The population was wrong

I proposed warming **274,579 recipients** — every recipient in BigQuery. The public
`/contracts` URLs come from `getTopRecipientsForSitemap()`, which is **`LIMIT 12000`**
ordered by `total_obligated`, minus the thin-content gate. That reconciles with the 11,772
observed URLs.

| | Proposed (wrong) | **Eligible population** |
|---|---:|---:|
| Recipients | 274,579 | **12,000 → 9,639 with awards** |
| Cache page entries | 419,985 | **62,758** |
| Rows cached | 54.9M | **2,920,041** |

**85% smaller** before any other change.

### Serialized cache size — the number that actually matters

Measured, not assumed: **287 bytes/row** average (p50 description 95 chars, p95 264),
×1.45 for JSON overhead.

| Page cap | Entries | Rows | Payload | % of 3 GB limit |
|---|---:|---:|---:|---:|
| 1 page (50 awards) | 9,639 | 428,876 | **170 MB** | 5.5% |
| **3 pages (150)** | **23,492** | **1,053,467** | **418 MB** | **13.6%** |
| 5 pages (250) | 32,739 | 1,479,196 | 587 MB | 19.1% |
| 20 pages (1000) | 62,758 | 2,920,041 | **1,159 MB** | **37.7%** |

### Cache provider — live state

- **Vercel KV (Upstash Redis)**
- **485,772 keys** already stored
- **2.4 MB used of a 3.00 GB limit**
- `maxmemory_policy` reports **empty** — no eviction policy visible

That last two lines are the risk: the 20-page cap would take the store from **2.4 MB to
~1.16 GB**, a ~470× increase, making this job the dominant consumer. With no confirmed
eviction policy, filling 38% of the limit in one batch is not a safe default — and it could
evict entries other surfaces depend on.

### Recommendation: 3-page cap, not 20

- **418 MB (13.6%)** instead of 1.16 GB (37.7%)
- Covers **Senture's 124 awards in full** (3 pages)
- **89% of eligible recipients need only 1 page**
- Pages 4–20 stay `noindex` by design and fall back to the honest unavailable state, which
  Option A now renders correctly rather than as a false zero
- Raise the cap later on evidence (server logs showing deep-page traffic), not speculation

### TTL — the stampede Eric flagged

`DEFAULT_TTL_SECONDS` is a **uniform 90 days**. Warming 23,492 entries in one run means
they all expire within the same window and cold-miss together, recreating this outage
wholesale.

**Fix: jitter the TTL** — 90 days ± up to 20 days, deterministic per key so a re-run is
idempotent. Spreads expiry across a ~40-day band instead of a single day.

### Batching and resumability

- Batch size **250 recipients**, sequential; Redis pipelined per batch
- Concurrency **1** — this is a one-off, not a latency-sensitive path
- **Idempotent by construction**: keys are deterministic (`rollup:<uei>:awards-page:<n>:50:v2-m`),
  so a re-run overwrites rather than duplicating
- **Resumable**: skip a recipient whose page-1 key already exists, so a failed batch resumes
  without rewriting completed entries
- Expected runtime ~**10–20 min** for 23,492 entries at pipelined Redis write rates
- **Empty pages are never written** — only pages containing rows

### Still to confirm before execution

- [ ] Vercel KV **write/command quota** on the current plan (dashboard, not inferable from `INFO`)
- [ ] `maxmemory_policy` — reported empty; confirm what happens at the limit
- [ ] Whether the 485,772 existing keys include anything that must not be evicted
