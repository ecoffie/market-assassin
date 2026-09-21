# Session 2026-08-06 — forecast map coverage + moat health

**Resume with:** `/continue` or point a new session at this file.
**State:** both work items complete, shipped as PRs, awaiting merge. Nothing blocked.

---

## Open right now — the only things needing action

| PR | What | Status |
|---|---|---|
| [#1018](https://github.com/ecoffie/market-assassin/pull/1018) | Forecast map coords stamped at write time | **Open, needs merge** |
| [#1023](https://github.com/ecoffie/market-assassin/pull/1023) | Change-log writer reports failure + silence alarm | **Open, needs merge** |

### Post-merge verification (do this after merging)

```bash
# 1. #1023 — heartbeat probe should appear, ok:true, recent timestamp
curl -s "https://getmindy.ai/api/cron/db-health-watch?password=$ADMIN_PASSWORD" | jq '.probes[] | select(.name=="moat-heartbeat")'

# 2. #1023 — after the next :25 tick, last_status should read 'success' not 'dispatched'
#    (check cron_jobs row sync-recompete-contracts)

# 3. #1018 — after the next forecast sync, new DHS rows should arrive WITH map_lat
#    populated, without anyone running the backfill by hand.
```

Worktrees still on disk (delete once merged):
- `.claude/worktrees/fix-forecast-map-write-time`
- `.claude/worktrees/moat-heartbeat`

---

## What shipped to prod already

**Forecast map drain:** 18,693 → **18,748 pinned** (+55). DHS Aug 3–5 went 0/44 → 41/44.
Only `map_lat` / `map_lng` / `map_loc_source` written. Idempotent, re-runnable.

---

## Moat health (checked this session)

`recompete_changes` — the append-only diff log, the actual moat per the strategy artifact.

| Metric | Value (2026-08-06) |
|---|---|
| Entries | 10,402 |
| Contracts tracked | 7,908 |
| Recording since | 2026-07-17 |
| Cadence | ~500/day, 20 of 21 days |
| Writer | `sync-recompete-contracts`, hourly `:25`, enabled |

Breakdown: ~2,800 expiry slips · ~7,600 ceiling raises · 27 novations (UEI changes).

**The strategy doc's "the log reads empty today" is out of date** — it's queryable now.
7,908 contracts have a recorded change that exists nowhere else on earth.

⚠️ **Gap pattern is NOT weekends.** Sat Jul 18 was the busiest day (1,035); the near-zero
days are Mondays. Volume tracks the staleness-shard rotation, not the federal calendar.

---

## Forecast map — the settled picture (don't re-derive this)

**33,090 forecasts · 18,748 pinned (57%) · 14,342 correctly unmapped.**

The unmapped pile is NOT a backlog. It was classified 2026-08-02 in
`src/lib/forecasts/map-coverage.ts` — read that before touching anything:

| Class | Policy |
|---|---|
| `NO_LOCATION_PUBLISHED` | accept |
| `SUPPRESSED_BY_SOURCE` | accept — surface the label |
| `NOT_A_PLACE` | accept |
| `RECOVERABLE_FORMAT` | fix the parser |
| `CORRUPT_STATE` | fix the parser, never guess |

*"An absent pin is a fact; a wrong pin is a claim."*

**Things NOT to do** (each was tried this session and is wrong):
- ❌ USACE district-office lookup — `map-coverage.ts` forbids the office-address fallback;
  the buying office is not the place of performance. It also names the exact over-count
  (2,484 "fixable" when 2,349 are `NO_LOCATION_PUBLISHED`).
- ❌ HHS `75H7xx` → IHS Area Office mapping — disproved by pulling the live API. Those are
  HHS-wide procurement codes with no decoder. Would have invented cities for 2,231 rows.
- ❌ Nulling `pop_city` on "Cannot be disclosed" — `/api/forecasts/unplaced` deliberately
  returns it raw so the drawer can say WHY there's no pin.
- ❌ Changing the deterministic jitter — it's shared with the SAM opps layer by design.

Full post-mortem with the reasoning: `~/Bootcamp/docs/forecast-map-remediation-plan.md`

---

## Verified findings worth keeping

- **HHS 3,643 forecasts are genuinely unmappable.** Pulled the live API
  (`osdbu.hhs.gov/api/sbcxopportunities`, 3,762 records): 26 fields, zero location fields.
  The scraper is correct. Also: live API returns 3,762 vs 3,643 in DB — a 119-row gap
  worth investigating sometime (stale sync or dedupe).
- **NASA's source file has no location column** (`tmp/forecasts/nasa-agency.xlsx`, 28 cols).
  `Buying Office` is 306/306 populated but ITPO (102 rows) is a procurement office, not a site.
- **USACE CWMS spread analysis** — 4,500 real points from `geospatial.sec.usace.army.mil`,
  keyed by `DB_OFFICE_ID`. Only compact districts can carry one pin honestly:
  SAJ Jacksonville p90 = 135mi (Everglades centroid is genuinely where the work is);
  NWDM Omaha p90 = **563mi, 4% within 100mi** (centroid is empty Nebraska).
  Useful only if a district *project* layer is ever built — never for office pinning.

---

## Process lesson from this session

Every estimate made from inference was inflated; only the one from a direct query held:
**~12,000 → ~4,700 → ~682 → 55 actual.**

Root cause: the local `market-assassin` checkout was **40+ commits stale**, so greps
returned false negatives and I argued against what Eric could see in the live product.

**Rule: `git pull` before concluding anything from a grep. A negative grep on a stale repo
is not evidence. When the user describes the running product, the product wins.**
