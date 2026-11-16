# Search cache — round 2: production timeouts, tie-break, storage path (2026-11-16)

Agent 3, branch `agent3/cache-tiebreak` (off `agent3/cache-hardening-on-rc3` f698d26d8). Eric's directive via Agent 5:
P1 timeouts on three paths, P2 cache validation on a dev branch, P3 bucket/trigger as reviewed drafts only (there is no
staging Supabase; previews use the production project, so neither is created or applied anywhere). No merge, no deploy.

## P1 — Do production, RC3 uncached and RC3 cached hit the same long-query timeouts?

Read-only, one pass per phrasing, sequential, under the heavy-test lock, all against the live production database from the
same machine. Production main = `origin/main` 0d11cf338 (serving getmindy.ai at measurement time; the search code is
unchanged since a6d61a73). RC3 = 5c5098165 + cache-hardening. Times are end-to-end FIND (Open now horizon).

| Business (long) | chars | Production main | RC3 uncached | RC3 cached |
|---|---|---|---|---|
| janitorial | 204 | timeout (8.7 s) | timeout (8.7 s) | 561 (2.1 s) |
| nursing | 179 | timeout (9.4 s) | timeout (8.8 s) | 345 (2.5 s) |
| hvac | 200 | timeout (9.1 s) | timeout (8.6 s) | 719 (3.0 s) |
| guards | 160 | 101 (7.7 s) | timeout (8.6 s) | 111 (2.1 s) |
| steel | 193 | timeout (8.7 s) | timeout (8.7 s) | 1018 (3.7 s) |
| grounds | 169 | timeout (8.8 s) | timeout (8.7 s) | 171 (2.2 s) |
| paving | 178 | timeout (17.7 s) | timeout (8.6 s) | 637 (4.0 s) |
| parts | 227 | 1772 (9.2 s) | 1772 (6.4 s) | 1772 (3.9 s) |
| fasteners | 197 | timeout (10.1 s) | timeout (8.6 s) | 939 (4.3 s) |
| electrical | 198 | timeout (9.7 s) | timeout (8.6 s) | 1067 (4.4 s) |
| valves | 159 | timeout (11.3 s) | 1397 (9.2 s) | 1397 (4.7 s) |
| aircraft | 206 | timeout (8.9 s) | timeout (8.7 s) | 1433 (4.6 s) |
| medical | 203 | timeout (14.7 s) | timeout (8.7 s) | 1301 (4.8 s) |
| IT | 169 | timeout (9.2 s) | timeout (8.8 s) | 1584 (4.9 s) |
| **timeouts** | | **12/14** | **12/14** | **0/14** |

Short phrasings: production main 0/14 timeouts; RC3 uncached 2/14; RC3 cached 0/14.

Production main was run twice per long phrasing; both passes gave the same outcome for every phrasing.

**What a customer sees today (production).** Open now is `unavailable` with error class `query_failed` and the raw database
message *"canceling statement due to statement timeout"*. It is not shown as zero, and Coming back / Coming soon still answer
(e.g. "open now unavailable · 2,044 coming back · 186 coming soon"). The friendlier "this search was too long, shorten it"
message exists only on the RC line (`search-failure.ts`, commit 293155b98); production does not have it.

**Severity: real but bounded.** Paragraph-length descriptions (about 160–230 characters) lose Open now on 12 of 14 trades;
one-sentence descriptions answer on all 14. How often real customers send paragraphs is **not measurable**: `mcp_call_log`
stores `args_redacted` empty for find_opportunities (275 calls, 51 non-staff users in the last 30 days). The Potato P2 host
rules tell hosts to pass "what they sell", which tends to be short, but a host can pass a paragraph.

**RC3 is not better uncached:** same 12/14 long timeouts, and it adds **2 short-phrasing timeouts production does not have**
(nursing short, steel short). Relevant to any RC3 decision, independent of the cache.

**Smallest safe production fix (proposed, not made):** port the failure classifier (293155b98) to main so a timeout says
"too long, shorten it to the products or services you sell" instead of the raw database text. Message-only; no change to
matching or ranking. It does not recover the results. Recovering them is what the cache does (0/14 timeouts, 2–5 s), or a
query-shape change that would need its own measurement.

## P2 — Cache validation (dev branch)

- **Tie-breaker applied:** `notice_id` as the final order after `response_deadline`, in the three FIND window queries and in
  both cache merge paths. Unit tests: 69 files / 913 tests pass; typecheck clean.
- **Cached vs uncached:** top 25 now **identical in order on 14/14** phrasings where SQL answers (was 0/14 identical before the
  tie-break; every difference had been between same-deadline rows). Counts identical 14/14. The other 14 SQL times out; the
  cache answers them.
- **Stale fallback:** measured on the preview in round 1 (older than 6 h → SQL + reload; >1,500 changed rows → SQL + rebuild;
  both returned to the snapshot path after the reload). The tie-break does not touch that logic; unit tests for it pass.
- **Memory limit:** project config (Vercel API) is Fluid compute, `functionDefaultMemoryType: standard`, no per-function
  override in vercel.json. Standard on Fluid is 2 GB / 1 vCPU (Vercel's published tiers; not separately probed). Peak
  measured 708 MB RSS (375 MB heap) after three snapshot builds in one instance → **within the limit, ~35%**. Caveats: a
  rebuild briefly holds old and new snapshots together, and Fluid runs concurrent requests in the same instance, so headroom
  under real traffic is lower than one isolated run shows.
- **Permissions, filters, freshness — not weakened, with one known gap:**
  - Permissions: same service-role reads of public SAM data as the SQL path; company-anchored searches always use SQL; the
    bucket code refuses a missing or public bucket on both read and write; the only new endpoint is preview-only (404
    elsewhere, CRON_SECRET).
  - Filters: every chained filter is replayed on the live queries; an unsupported query method throws (fails the horizon as
    unavailable) rather than being dropped; an uncacheable plan op falls back to SQL.
  - Freshness: snapshot candidates are re-verified live by id (structured filters, unchanged rows only); changed rows come
    from a live delta; older than 6 h or >1,500 changed → SQL.
  - **Gap:** the TEXT match for unchanged rows is evaluated on the snapshot's copy. A writer that edits title/description/SOW
    without stamping one of synced_at / description_checked_at / sow_checked_at / updated_at would leave that row's text
    stale for up to 6 h. That is exactly what the `snapshot_changed_at` trigger closes (draft, held for Eric).

## P3 — Bucket and trigger: reviewed drafts only

- Trigger: `migration-draft/snapshot_changed_at.up.sql` / `.down.sql` (unchanged; outside supabase/migrations so
  `npm run migrate` cannot pick it up). Not applied anywhere.
- Bucket: `infra-draft/bucket.mjs` — `status | create | delete --project-ref <ref> [--go]`. Dry-run without `--go`; refuses
  unless `--project-ref` equals the project the credentials point at; creates `public:false` only; refuses an existing
  public bucket; `delete` empties then deletes (the rollback). **Not run.**
- Storage path tested without touching production storage: `infra-draft/storage-mock-e2e.mts` swaps `client.storage` for an
  in-memory bucket and runs the REAL writer and loader. Results: write 8,821 rows (19.4 MB gzip, build 9.4 s); download +
  checksum verify 0.36 s; refuses public bucket (read and write), missing bucket, corrupted object; the holder loads from
  storage; FIND storage-vs-SQL identical on the 2 phrasings SQL answers, and the cache answers the 2 SQL times out on.
- A real test of either needs a staging Supabase project (Agent 5 is raising it with Eric).

## GO / NO-GO

- **Cache to production: NO-GO for now.** Blocked on Eric's decisions, not on evidence: (1) the trigger (without it, every SAM
  sync forces a per-instance rebuild, and the text-staleness gap above stays open); (2) a bucket in a real project (or
  accepting per-instance DB builds, about 10 s and ~64 MB of reads each); (3) a measurement of memory under concurrent
  traffic. The cache itself is correct on everything measured: identical results where SQL answers, 0 timeouts where it
  doesn't, safe fallback on staleness.
- **Production timeout message fix (port of 293155b98): GO to prepare as a separate small PR**, on Eric's approval. It is
  message-only and fixes what customers see today; it does not recover results.
- **RC3 as-is: flag for the RC3 decision** — uncached, it adds 2 short-phrasing timeouts that production does not have.

Raw outputs (scratchpad, not committed): main-long.json, main-short.json, local-parity.json, lifecycle.json, parity-*.json.
