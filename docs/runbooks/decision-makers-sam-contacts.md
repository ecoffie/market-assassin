# Runbook — `decision_makers_sam_contacts`

The Decision Makers source: named government points-of-contact on SAM notices.

| | |
|---|---|
| **Dataset** | `decision_makers` (`data_sources.key`) |
| **Source instance** | `decision_makers_sam_contacts` (`data_source_instances.source_key`) |
| **Producer** | `GET /api/cron/sync-gov-buyer-data?pull=contacts` → `runDecisionMakersSync()` |
| **Logic** | `src/lib/gov-contacts/buyer-contact-source.ts` (pure) · `buyer-contact-run.ts` (runner) |
| **Upstream** | `sam_opportunities.points_of_contact` — a LOCAL table, fed by `sync-sam-opportunities` |
| **Target** | `federal_contacts` (`role_category='contracting'`) |
| **Checkpoint** | `decision_makers_sync_state` (one row per lane) |
| **Alerts** | ops/Slack via `sendOpsAlert`, deduped on `ops_alert_state.alert_key = 'decision-makers-source-health'` |

---

## TWO sources, three physical generations — read this first

| | source 1 | source 2 |
|---|---|---|
| `source_key` | `decision_makers_sam_contacts` | `decision_makers_vendor_entity_pocs` |
| upstream | SAM **notice** POCs | SAM **entity registrations** |
| physical generations | `AllSamContacts` **and** `sam_opportunities_pointOfContact` | `sam_entities_pocs` |
| `contact_kind` | `government_buyer` | `vendor_entity_poc` |
| producer | `buyer-contact-run.ts`, cron `0 */2 * * *` | frozen legacy importer, unscheduled |
| currentness | measurable | **UNMEASURED — no oracle exists** |

⚠️ **`sam_opportunities_pointOfContact` is NOT a separate source.** It is the FIRST GENERATION of
source 1: same `<notice_id>::<slot>` key space, and the live drain has re-adopted 94.7% of it in
place. It is never archived and never relabelled.

### Three columns, three different questions — never conflate them

| column | question it answers | authoritative for |
|---|---|---|
| `source_table` | *which importer first wrote this row* | import lineage / history |
| `contact_kind` | *is this a government buyer or a vendor* | **customer + product semantics** |
| `data_source_instances` | *which upstream source owns it* | the control plane |

### The `contact_kind` contract

- Values: `government_buyer` · `vendor_entity_poc` · `NULL` (unclassified).
- **No DB default, ever.** `source` and `role_category` became meaningless precisely because
  every row inherited a value nobody asserted. Producers state the kind explicitly.
- Classification is STRUCTURAL (`src/lib/gov-contacts/contact-kind.ts`), never label-based. The
  two rules are mutually exclusive by construction: vendor needs `department_ind_agency IS NULL`,
  government needs `IS NOT NULL`.
- **Surface rule:** every customer government-buyer query goes through `governmentBuyersOnly()`.
  It FAILS CLOSED — an unclassified row is hidden, not shown. That is only safe because the
  canonical producer sets the kind on every write; `contact-name-parity.unit.test.ts` asserts
  both halves together.
- `buyer-detail`'s direct by-id lookup is scoped too. It is the one query with no scope of its
  own, and `isUsableContactCard` cannot cover it — `hasOrg` passes on a vendor row because the
  COMPANY sits in `sub_tier`.

### Held population semantics

Both instances derive `held_population` from `contact_kind`, never from `source_table`. Source 1
therefore covers BOTH government generations (175,078 + 30,439 = 205,517).

### ⚠️ Legacy importer danger

`scripts/populate-contracting-officers.js` writes source 1's key space while explicitly setting
`source_table`. A re-run would silently RELABEL rows the live producer owns and land them
unclassified. It is dry-run by default and needs BOTH `--legacy-replay` and
`--i-understand-this-relabels-live-rows`, guarded at the write. **Do not run it.**

## What this source is, and is not

It is a **derived** source. It does not call SAM; it flattens POC arrays out of the notice
corpus we already sync. So the *upstream* advance belongs to `sync-sam-opportunities`, and this
source deliberately **never writes `last_source_advance`** — claiming it would attribute another
producer's freshness to this one.

Coverage caveat (unchanged from the original design): SAM POCs are the contracting
officer/specialist only — never the program manager, engineer or end user.

---

## Schedule — ONE authority

`cron_jobs` row `sync-decision-makers` → `/api/cron/sync-gov-buyer-data?pull=contacts`.

**It used to have no schedule at all.** The only thing that ran it was an *unawaited* `fetch()`
inside `sync-sam-opportunities` (`route.ts` ~line 728), so a silent failure was invisible and
nothing recorded that it had stopped. That chained call now sends `pull=entities` only.

⚠️ **Never point a second schedule at `pull=contacts` or `pull=both`.** Two schedules advancing
one cursor is double-advancement; the lease will block the overlap, but the design intent is one
owner. The SB-entity half keeps its own separate checkpoint (`sam_entities_sync_state`) and is
unaffected.

---

## Checkpoint model — why the cursor is `created_at`

The backfill lane is a **keyset cursor over `(sam_opportunities.created_at, notice_id)`
ascending**. `decision_makers_sync_state.cursor_created_at` / `cursor_notice_id` hold the
position **already processed**; the next run reads strictly greater.

Three candidates were considered and two are provably unsafe:

| dimension | verdict |
|---|---|
| **offset / page** | ❌ The table grows at the head; every insert shifts the tail, so the next run's offset lands past rows it never read. This is the defect being replaced. |
| **`posted_date`** | ❌ Notices are ingested days after they are posted, so a notice can arrive **behind** an advanced cursor. Measured 2026-09-14 over all 207,986 rows: **34,906 (16.8%) were created >2 days after their posted_date**, 9,587 >14 days, worst case 30 days. Every one of those would be silently skipped. |
| **`created_at`** | ✅ Our own insertion time. 100% populated (0 nulls), written by a column DEFAULT so an upsert-update never rewrites it, and a new row always gets `now()` — strictly greater than any cursor already reached. A new arrival therefore **cannot** land behind the cursor whatever its posted_date. `notice_id` breaks ties so the ordering is total. |

`cursor IS NULL` means **never started**. `pass_completed_at IS NOT NULL` means **finished a
pass**. Never collapse those two into "no work".

---

## Two lanes

| lane | range | why |
|---|---|---|
| **REFRESH** | notices with `updated_at >= now() - refreshWindowDays` (default 3d) | Keeps live notices current. This is all the source used to do — and doing only this is why **125,515 rows (50.8%) had not been touched in 90+ days**. |
| **BACKFILL** | keyset drain from the cursor | Traverses history once, then stays traversed. `created_at` says nothing about in-place edits, which is exactly why REFRESH also exists. |

Refresh runs **first**: if the wall-clock budget cuts the run short, the lane protecting
currently-live notices is the one that already ran.

**Window sizing — the lane must have capacity for its whole window.** Measured 2026-09-14 on
the eligible corpus: **1,599** notices updated in the last day, **4,806** in 3 days, **17,628**
in 14 days. The defaults (3-day window, 12 × 500 = 6,000 rows of capacity) cover the window with
headroom, and 3 days means the lane still catches up after a day or two of missed runs. Widening
`refreshWindowDays` without raising `refreshPages` silently degrades the lane back into a
head-only sweep — the exact defect this source replaces.

---

## Clock semantics

| clock | advances when |
|---|---|
| `last_poll` | every real attempt |
| `last_successful_check` | the run completed with **zero** API/parse failures |
| `last_verified_ingest` | same condition — this source reads and writes in one pass, so the ingest *is* the check |
| `last_data_advance` | **only when rows actually mutated** (`inserted + updated > 0`) |
| `last_source_advance` | **never written here** — see "derived source" above |
| `held_population` | rows in `federal_contacts` excluding `source_table='sam_entities_pocs'` |
| `upstream_population` | `decision_makers_upstream_slots()` — POC slots passing the email-or-phone gate |

**A successful run over an unchanged corpus is a CHECK, not a data advance.** That is enforced
by `classifyWrites`: unchanged rows are not re-upserted at all, so `updated_at` means "this
row's content changed", not "a sweep passed over it".

### held vs upstream

`held_population` and `upstream_population` are both **row/slot** units so the deficit means
something. The residual gap is the **name-quality rejection** — SAM placeholder names
(`"Telephone: 7175503112"`) and buyer-lookup paragraphs — which every run reports as
`rejectedName` rather than folding into the population. A deficit is therefore explainable
instead of looking like lost ingest.

`held_population` deliberately **excludes** the 82,017 frozen `sam_entities_pocs` rows: those are
VENDOR registrant POCs keyed `<UEI>::<role>` carrying a company rather than a federal
department — a different source entirely. The frozen `sam_opportunities_pointOfContact` family
*is* included: it uses the same `<notice_id>::<idx>` key space, so it is inside this source's
universe, merely unvisited since 2026-05-28.

---

## Traversal coverage — "how much have we visited?"

Read from the **cursor**, never from `federal_contacts.updated_at`. A notice whose POCs are all
rejected leaves no row behind, so row presence under-reports traversal and row recency measures
the writer rather than the reader.

```bash
# eligible / visited / remaining, straight from the checkpoint
npm run db -- decision_makers_sync_state --select lane,cursor_created_at,cursor_notice_id,pass_completed_at,notices_scanned
```

Or just read a run's response: `coverage: { eligibleNotices, visitedNotices, remainingNotices,
percentVisited, oldestUnvisitedCreatedAt, complete }`.

---

## Operating it

```bash
# read-only rehearsal — ZERO persistent writes (no rows, no checkpoint, no lease, no clocks,
# no alert state). Still measures and reports coverage.
curl -s "https://getmindy.ai/api/cron/sync-gov-buyer-data?pull=contacts&dry=1&password=$ADMIN_PASSWORD" | jq

# a real run, with the knobs
curl -s "https://getmindy.ai/api/cron/sync-gov-buyer-data?pull=contacts&backfillPages=20&refreshPages=4&pageSize=500&budgetMs=210000&password=$ADMIN_PASSWORD" | jq
```

| param | default | notes |
|---|---|---|
| `pageSize` | 500 | notices per page |
| `refreshPages` | 12 | 6,000 rows of capacity — see the window sizing below |
| `backfillPages` | 20 | ~10,000 historical notices/run |
| `refreshWindowDays` | 3 | recent window |
| `budgetMs` | 210000 | soft; a lane stops at a page boundary |
| `dry` | off | `dry=1` ⇒ no persistent writes anywhere |

---

## Failure modes

| symptom | cause | action |
|---|---|---|
| `lockAcquired: false`, `errors: ["…lease…"]` | another run is in flight, or a crashed run's lease has not expired | wait; the lease TTL is 10 min and self-heals |
| `apiFailures > 0` | a page read failed | the cursor did **not** advance past it — the next run re-reads that position. No action unless it persists. |
| health `unmeasured` | no verified check has ever completed | check the cron row is enabled and the route is returning 200 |
| health `ingest_stale` | no verified check in > 3 days | the producer is down — check `cron_job_runs` for `sync-decision-makers` |
| health `draining` | catch-up in progress | **not an error.** Coverage debt is not a broken producer; it alerts on neither. |
| cursor not moving across runs | backfill exhausted (`pass_completed_at` set) or the budget is being hit | check `budgetExhausted` per lane in the response |

### Manual recovery

```sql
-- Restart the historical drain from the beginning (safe: all writes are idempotent on
-- source_row_key, so a re-drain re-derives identical rows and mutates nothing).
UPDATE decision_makers_sync_state
   SET cursor_created_at = NULL, cursor_notice_id = NULL,
       pass_completed_at = NULL, pass_number = pass_number + 1
 WHERE lane = 'backfill';

-- Force-release a wedged lease (only after confirming no run is in flight).
UPDATE decision_makers_sync_state SET lease_owner = NULL, lease_expires_at = NULL WHERE lane = 'backfill';
```

---

## Alerting

Source-specific, on the **ops/Slack** path, deduped by fingerprint, and the delivery result is
reported in the run payload so a failing alert path is itself visible.

⚠️ **The generic `check-data-freshness` watchdog was the only monitor over this corpus, and it
had been failing silently.** It returned **502 on 2026-08-28, 08-30, 09-09, 09-11 and 09-14** —
and in that route a 502 means *"staleness WAS detected AND the notification failed"*. It was
still on the email path, which internal ops notifications left in 2026-07. It now posts via
`sendOpsAlert` too. Do not "fix" either alert by making the route return 200.
