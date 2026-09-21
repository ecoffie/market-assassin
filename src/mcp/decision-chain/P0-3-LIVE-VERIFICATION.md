# P0-3 live verification — 5 of 6 conditions pass. One needs your call.

Merged `edda5a96`, deployed, re-run against production 2026-08-24.

## The headline: the false zero is gone

| | Before | After |
|---|---|---|
| `market_depth` | **0** | **196** |
| `capable_depth` | **0** | **132** |
| `rule_of_two_met` | **false** | **true** |
| `grounded` | false | **true** |
| `businesses` | `[]` | **231 firms** |
| counts | all 0 | capable 132 · emerging 64 · registered_only 35 |

The response went from an empty array to 99,492 characters. **The Rule of Two is now MET for
561720 Small Business**, which is the correct answer for a market with 20,074 registered
small firms and 10 known active performers.

## Acceptance conditions

| # | Condition | Result |
|---|---|---|
| 1 | No longer reports zero | **PASS** — 196 / 132 |
| 2 | Known **N** firms excluded | **PASS** — all 3 absent (J&J, Fedcap, Didlake) |
| 3 | Unknown stays distinct from N | **PASS** — caveat states it explicitly |
| 4 | Flows through `marketDepth → capableDepth → recommendation` | **PASS** — 196 → 132 → `rule_of_two_met: true` |
| 5 | Caveat names SAM per-NAICS self-represented status | **PASS** — verbatim below |
| 6 | Known **Y** firms present in eligible population | **FAIL — see below** |

Live caveat text:

> *"Small-business status is SAM's per-NAICS representation for 561720 (sbaSmallBusiness),
> SELF-CERTIFIED by the entity in its SAM registration — not an SBA size determination and not
> a socioeconomic certification. Source: sam_bulk_extract:SAM_PUBLIC_MONTHLY_V2_20260802.ZIP.
> Firms where SAM supplied no status for this NAICS are excluded from the small-business pool;
> that is 'not stated', not 'not small'."*

Field lineage is now in the answer — the thing whose absence made the original false zero
invisible.

## Condition 6 — the two Y firms are eligible but did not surface

`OS-DB-JV-2 LLC` (JQBZNZDZNAN3) and `NMI ALASKA, INC.` (LXL9TVM47G59) are **not** in the 231
returned rows. Checked directly against the DB — both pass every filter condition:

| | registration_status | exclusion_flag | `naics_codes` has 561720 | `sb_status` | passes new filter |
|---|---|---|---|---|---|
| OS-DB-JV-2 | Active | false | true | **Y** | **true** |
| NMI ALASKA | Active | false | true | **Y** | **true** |

So this is **not an exclusion defect** — the new filter accepts them. They are in the eligible
population of 20,074 and did not make the scored/returned set.

**Most likely cause, NOT yet confirmed:** `market-research.ts` pulls a bounded candidate pool
(`POOL_TARGET = max(limit*10, 1000)`, paged) out of 20,074 eligible rows, then scores it. Which
1,000 of 20,074 arrive is decided by the DB page, not by merit — the file's own comment warns
about exactly this ("rather than letting an arbitrary DB page decide before scoring ever
runs"). With the population now 20,074 instead of 0, that bound binds hard.

**I have not verified this.** It is a hypothesis with a plausible mechanism, and per the P0-1
discipline I am not changing the sampling logic on an unverified cause.

## Assessment

**The P0-3 defect — a size question answered from socioeconomic-certification data — is
fixed and live-verified.** Depth is real, the recommendation flipped correctly, N firms are
excluded, provenance is stated.

Condition 6 is a **different, pre-existing issue**: candidate-pool sampling over a large
eligible population. It was invisible while the population was 0. Two specific known
performers not surfacing does not invalidate a depth of 196 or a `rule_of_two_met: true` — but
it does mean **the returned `businesses` list is not the top-N by merit**, and a user reading
it as "the best available small businesses" would be misled.

**Recommendation:** close P0-3 on conditions 1–5, and file candidate-pool sampling as its own
defect with the reproduction above. Do not widen the pool or change scoring inside the P0-3
closure — that is the "fix the formula preemptively" move Eric ruled out.
