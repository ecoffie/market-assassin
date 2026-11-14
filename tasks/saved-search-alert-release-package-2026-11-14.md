# Saved-search alert release package — reconciliation, notices, rollback (Agent 3, 2026-11-14)

**Status: prepared, NOT approved.** Round 3 (2026-11-14): the combined #2040 + #2043 recount over all 60 watches is §6 and
supersedes the "after" column in §2; the release sequence (§3) and rollback (§5) are updated for three separately
reviewable changes: alert parity (#2043), agency correction (C1, #2045), C2 presentation (not built). `SAVED_SEARCH_OPEN_CANONICAL` stays off. No migration applied, no notice sent, no
watch modified. Owners are numbered (same numbering as Agent 2's remediation table for its 17 owners; 18+ added here).
The number → email key is held privately outside this public repo (`~/docs/agent3/alert-parity-owner-key-2026-11-14.json`).

## 1. Reconciliation: PR #2043 (evaluator parity) × Agent 2's 26-watch remediation (PR #2040 follow-up)

| | Watches | Owners |
|---|---|---|
| Changed by evaluator parity (#2043) | 36 | 21 |
| Agent 2 remediation (11 pause + 15 correct) | 26 | 17 |
| In both | 2 (`027283a9`, `332eef89`) | |
| **Any change (union)** | **60** | **34** |
| Owners affected by both PRs on different watches | | 2 (owners 5, 7) |

They barely overlap because they fix different defects: #2040's remediation fixes stored KEYS the cron ignores
(multi set-aside, notice type, contract value, FSC); #2043 changes how TEXT and AGENCY are read. All 11 whole-market
pauses evaluate identically under both engines (9,193 each) — #2043 does not fix them; only the pause + notice does.

**The overlap is not additive.** `027283a9` ("My market, Full & Open, Small Business"): today 1,610; #2043 alone 665
(restores Full & Open); #2040 alone 543 (restores Small Business); **both: 1,208** (the Map ORs the two). Each PR
measured itself with the other's filter still ignored. Rule: every number quoted to a customer is measured on the
merged code with both changes, via the prod preview (`?mode=preview&openEngine=canonical`), never from either PR alone.

**#2043 depends on #2040 for full parity.** The Map API, like the cron, does not read `setAsideMulti`; parity tests pass
because both sides ignore it. One meaning across Map and alerts requires #2040's key translation to land first.

## 2. Per-watch table (counts = last 30 days, live, read-only)

| Watch | Owner | Source | Change | Today | After both | Notice |
|---|---|---|---|---|---|---|
| `3df4e769` | 1 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `434b1e74` | 1 | #2040 | Correct stored keys (#2040 table) | 830 | per #2040 table | per #2040 table |
| `6dda3cd3` | 1 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `d8794f46` | 2 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `54fd0605` | 3 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `c75b5e65` | 4 | #2040 | Correct stored keys (#2040 table) | 8 | per #2040 table | per #2040 table |
| `1b018df4` | 5 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `5e4bcd5a` | 5 | #2040 | Correct stored keys (#2040 table) | 3 | per #2040 table | per #2040 table |
| `994c599e` | 5 | #2043 | 0 → matches (agency now recognized) | 0 | 77 | required |
| `88d24ae2` | 6 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `02dc20b6` | 7 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `0678583e` | 7 | #2043 | Narrower (subset of today) | 115 | 3 | required |
| `64eb46b6` | 7 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `c3f908e3` | 7 | #2043 | Whole-market overmatch removed | 8,880 | 1 | required |
| `e9c0f9be` | 7 | #2043 | Narrower (subset of today) | 2,573 | 6 | required |
| `ff372605` | 7 | #2043 | Narrower (subset of today) | 594 | 40 | required |
| `749d017b` | 8 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `ab8bb3c8` | 8 | #2040 | Correct stored keys (#2040 table) | 3 | per #2040 table | per #2040 table |
| `ae5ddb00` | 8 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `c11fcdb7` | 9 | #2040 | Correct stored keys (#2040 table) | 0 | per #2040 table | per #2040 table |
| `027283a9` | 10 | both | Narrower (subset of today) | 1,610 | 1,208 | required |
| `1c3b715a` | 11 | #2040 | Correct stored keys (#2040 table) | 240 | per #2040 table | per #2040 table |
| `32acc010` | 12 | #2040 | Correct stored keys (#2040 table) | 1,637 | per #2040 table | per #2040 table |
| `9860bcf9` | 12 | #2040 | Correct stored keys (#2040 table) | 109 | per #2040 table | per #2040 table |
| `4692743e` | 13 | #2040 | Correct stored keys (#2040 table) | 131 | per #2040 table | per #2040 table |
| `5b867c2f` | 13 | #2040 | Correct stored keys (#2040 table) | 85 | per #2040 table | per #2040 table |
| `7d3a2556` | 13 | #2040 | Correct stored keys (#2040 table) | 9,193 | per #2040 table | per #2040 table |
| `fa66531f` | 14 | #2040 | Correct stored keys (#2040 table) | 0 | per #2040 table | per #2040 table |
| `332eef89` | 15 | both | Matches → 0 (verified) | 1 | 0 | recommendation |
| `39fbb6e0` | 16 | #2040 | Correct stored keys (#2040 table) | 0 | per #2040 table | per #2040 table |
| `4f3df70a` | 17 | #2040 | Pause (alerts on the whole Open market) | 9,193 | — | required (with pause) |
| `b4e40d05` | 18 | #2043 | Matches → 0 (verified) | 26 | 0 | recommendation |
| `bf35f82a` | 18 | #2043 | Changed (some gained, some lost) | 451 | 118 | required |
| `3e2511ad` | 19 | #2043 | Whole-market overmatch removed | 7,924 | 20 | required |
| `4dcfa6ea` | 19 | #2043 | Narrower (subset of today) | 201 | 14 | required |
| `386e228b` | 20 | #2043 | Whole-market overmatch removed | 8,880 | 189 | required |
| `61d1ca1f` | 20 | #2043 | Whole-market overmatch removed | 8,880 | 1 | required |
| `9ca2d2de` | 20 | #2043 | Whole-market overmatch removed | 8,880 | 260 | required |
| `b032f39f` | 20 | #2043 | Whole-market overmatch removed | 8,880 | 0 | required |
| `e00435f7` | 21 | #2043 | Changed (some gained, some lost) | 2,678 | 35 | required |
| `741adbff` | 22 | #2043 | Changed (some gained, some lost) | 169 | 87 | required |
| `e4460582` | 22 | #2043 | Changed (some gained, some lost) | 21 | 19 | required |
| `03a84411` | 23 | #2043 | Changed (some gained, some lost) | 51 | 43 | required |
| `22a140c6` | 23 | #2043 | Changed (some gained, some lost) | 51 | 43 | required |
| `02b35d34` | 24 | #2043 | 0 → matches (agency now recognized) | 0 | 18 | required |
| `9da3488e` | 24 | #2043 | 0 → matches (agency now recognized) | 0 | 16 | required |
| `caf96deb` | 24 | #2043 | 0 → matches (agency now recognized) | 0 | 21 | required |
| `fdcc7cf8` | 25 | #2043 | Narrower (subset of today) | 87 | 22 | required |
| `0bf23482` | 26 | #2043 | Changed (some gained, some lost) | 258 | 121 | required |
| `574a9289` | 26 | #2043 | Narrower (subset of today) | 24 | 1 | required |
| `c4988fe6` | 27 | #2043 | Narrower (subset of today) | 848 | 830 | required |
| `e9f648f6` | 28 | #2043 | More matches (superset of today) | 2 | 39 | required |
| `fc24136b` | 29 | #2043 | Changed (some gained, some lost) | 2,067 | 143 | required |
| `55f30f29` | 30 | #2043 | Changed (some gained, some lost) | 57 | 37 | required |
| `08096951` | 31 | #2043 | Narrower (subset of today) | 258 | 28 | required |
| `ba24fc15` | 31 | #2043 | Changed (some gained, some lost) | 675 | 390 | required |
| `3ed7a107` | 32 | #2043 | Changed (some gained, some lost) | 6 | 10 | required |
| `c2adcce1` | 32 | #2043 | Changed (some gained, some lost) | 6 | 10 | required |
| `ff7ba678` | 33 | #2043 | Narrower (subset of today) | 32 | 6 | required |
| `0e41b9aa` | 34 | #2043 | Changed (some gained, some lost) | 24 | 25 | required |

"After both" for #2040-only rows is Agent 2's measured figure (their table); for #2043 rows it is the canonical
evaluator (those watches carry no key #2040 changes). Re-measure all rows on merged code before any notice.

## 3. Release sequence (each step needs its own approval; updated round 3)

Three changes, each separately reviewable and releasable: **#2040** (map save + Agent 2's remediation), **#2043** (alert
parity, flag-gated), **C1 / #2045** (agency matching). **C2** (related-market presentation) is design review only.

1. **#2040**: merge; run Agent 2's 15 corrections (dry run → approval → write, per-record snapshot in §5). No customer
   impact on its own for 12 of 15 (see §6: Open-off or same count).
2. **C1 / #2045**: after Agent 1's compatibility review and Eric's approval, merge + deploy. It changes the Map, MCP and
   Ask Mindy immediately (narrowing only). With the #2043 flag off it does not change alerts (the legacy evaluator does
   not use `resolveBuyer`). Measured over all 186 alerting watches, C1 changes the plan of exactly one: `61d1ca1f`
   (owner 20, a HUD agency watch), whose combined count goes 1 → 0 because its one remaining match is a Federal Housing
   Finance Agency notice. Release C1 before the notices so that owner is told the true figure (0, not 1).
3. **C2**: decide before notices. Today it touches 1 alerting watch (`0e41b9aa`); deciding first avoids a second notice.
4. **#2043**: merge (inert). Apply `20261114_saved_search_open_engine.sql` via the runner; `db:check` the column.
5. Prod preview on the deployed code (`?mode=preview&openEngine=canonical`): every one of the 60 rows must match §6
   within normal daily drift; any row off by more is re-investigated before notices. Regenerate notice numbers from it.
6. Resolve the 3 unexpected expansions (§6) for owners 32 and 34: disclose the Texas reading, decide the capability-list
   rule, or notify explicitly.
7. `/email-audit` on the 27 recipients (caps, suppressions, recent sends). Approval of final copy + list.
8. Send ONE consolidated notice per owner, at least 3 days before activation.
9. Flip `SAVED_SEARCH_OPEN_CANONICAL=true` + redeploy; pause Agent 2's 11 at the same time.
10. Watch 3 daily runs: transitioned searches send 0 on day 1, then only genuinely new notices; no
    `search_needs_refinement` among existing searches; per-owner send counts in the expected band.

## 4. Customer notices (drafts, not sent; one email per owner, one block per affected search)

Plain letter, from Mindy, no em dashes. `{…}` = filled per owner from the re-measured table.

**Subject:** Your Mindy saved searches will match exactly what you saved

> Hi {first_name},
>
> We are making Mindy read saved searches the same way the Opportunity Map does, so your alerts show what you see on
> the Map. {n} of your saved searches are affected. The change takes effect on {activation_date}. You do not need to do
> anything unless a search below says so.
>
> {one block per search}
>
> You can open and edit any of these searches on the Map: {map_link}. If something looks wrong, reply to this email and
> we will look at it with you.
>
> Mindy

Blocks:

| Change | Block text |
|---|---|
| Whole-market overmatch removed | **"{search_name}"**: this alert was sending almost every new federal notice (about {today} in the last 30 days) instead of the ones your search describes. It will now send only matching notices: about {after} over the same period. |
| Narrower | **"{search_name}"**: you will get fewer alerts. It matched {today} notices in the last 30 days and will match {after}, the same results the Map shows for this search. |
| Changed | **"{search_name}"**: your results will change. It matched {today} notices in the last 30 days and will match {after}. Some notices you saw before will drop out and some new ones will appear, matching what the Map shows for this search. |
| 0 → matches | **"{search_name}"**: this alert has not been sending anything because the agency name was not recognized. It now recognizes {agency} and would have sent you {after} notices in the last 30 days. |
| More matches | **"{search_name}"**: you will get more alerts: {after} in the last 30 days instead of {today}, the same results the Map shows. |
| Matches → 0 | **"{search_name}"**: no open notice matches this search with the filters you chose right now. The notices it sent before did not match what you saved. Your alert stays on and will tell you when a real match posts. |
| Typo (recommendation) | **"{search_name}"**: your search says "{typed}". We think you meant "{suggested}", which finds {suggested_count} current notices. Reply "yes" and we will update it, or edit it on the Map. Until then it stays as you saved it. |
| Paused (Agent 2) | **"{search_name}"**: this alert was sending every new federal notice because one of its filters was not being applied. We have paused it so it stops filling your inbox. Add what you sell, an industry code or an agency on the Map and turn it back on: {map_link}. |
| Corrected keys (Agent 2) | **"{search_name}"**: a filter you chose ({filter}) was not being applied to your alerts. It is now, so you will get {after} notices over a typical month instead of {today}. |

Matches → 0 is said only where verified: the one #2043 row lost 26 notices that blind labeling judged all unrelated
to the search. The typo row is a recommendation: nothing is changed without the owner's yes.

## 5. Rollback plan (per record)

| What changes | Written by | Snapshot BEFORE (read-only export, private) | Rollback |
|---|---|---|---|
| Evaluator engine for all alerting searches | #2043 flag | `id, last_seen_notice_ids, last_alerted_at, total_alerts_sent, open_engine` for every alerting search, taken immediately before the flip | Unset `SAVED_SEARCH_OPEN_CANONICAL` + redeploy. The next run re-baselines each search on legacy (stamps `open_engine='legacy'`, no catch-up email). Exact prior seen-state restorable from the snapshot if ever needed. Column is additive and stays. |
| Stored filters of Agent 2's 15 corrections | #2040 remediation | Full `filters` JSON per watch | Restore the exact JSON per id (one row each), then the cron evaluates the restored filters on its next run. |
| Pause of Agent 2's 11 | #2040 remediation | `alerts_enabled`, `alert_frequency` per watch | Re-enable per id. Note: re-enabling restores whole-market alerts. |
| Typo correction (1 watch) | only after the owner says yes | `filters` JSON | Restore JSON. |
| Agency matching (C1, #2045) | code deploy | none needed (no data written) | Revert the PR + redeploy. Map, MCP and Ask Mindy agency results return to the previous matching on the next request. No stored data to restore. |
| C2 presentation | not built | n/a | Would be a code revert; retrieval and labels are unchanged by design, so nothing is lost. |
| Notices | email | n/a | Cannot be recalled. Mitigation: send only after the prod preview numbers are final; a correction email goes only to owners whose numbers were wrong. |

Trigger to roll back: any transitioned search sending on day 1; a send-volume spike for any owner; a
`search_needs_refinement` on an existing search; an owner reporting missing notices that the Map shows.

## 6. Combined impact recount: #2040 + #2043 together (round 3, 2026-11-14)

**Method (read-only).** A local scratch merge of `main` + #2040 (`33aa35eb5`) + #2043 (`2aa4abb3d`), never pushed. Per
watch, Open horizon, the alert cron's exact query (`savedSearchOpenEvaluation`, 30-day posted window):

- **today** = legacy evaluator on the stored filters (what alerts use now)
- **#2043 only** = canonical evaluator on the stored filters
- **#2040 only** = legacy evaluator on Agent 2's corrected filters
- **both** = canonical evaluator on Agent 2's corrected filters

"Corrected filters" = the stored filters passed through #2040's own `__watchFilterPlan` (the real `WATCH_SCOPE_JS`,
evaluated in a sandbox): `setAsideMulti` → `setAside`, `noticeMulti` → `noticeType` merged, map-only keys (contract value,
FSC, strategy where map-only) removed. Applied only to Agent 2's 15 corrections; Agent 2's 11 pauses are shown as paused.
Script: `scripts/_recount-combined.ts` in the scratch merge (kept privately with the results; it needs both PRs' code).

**Coming Soon (forecasts) is unchanged by both PRs.** The forecast query reads only `q`, `agency`, `naics`, `state`
(`SAVED_SEARCH_FORECAST_KEYS`, `fetchForecastMatches`); neither PR changes those keys. So a watch with Open switched off
has no customer-visible change from either PR.

**Counts moved since the first table** (live data): the whole-market figure is now 9,198, not 9,193.

### Summary

| Outcome after both | Watches |
|---|---|
| Paused (Agent 2) | 11 |
| Goes silent on Open | 3 |
| Expands, UNEXPECTED | 3 |
| 0 → matches | 4 |
| More matches | 1 |
| Changed (gains and losses) | 12 |
| Narrower | 14 |
| No visible change | 7 |
| No visible change (Open off; Coming Soon only) | 5 |
| **Total** | **60** |

**Owner notification list, reconciled.** 27 of 34 owners have a customer-visible change and need a
notice. Seven owners drop off the list (owners 4, 9, 11, 12, 13, 14, 16): every one of their watches is
either Open-off (Coming Soon only, unchanged) or returns the same count; their filter cleanup needs no notice. Owners
whose notice covers changes from BOTH PRs: 5 and 7 (different watches), 10 and 15 (the same watch, `027283a9` / `332eef89`).
Two owners' notices (owners 32 and 34) are HELD until the unexpected expansions below are decided. (Saved search text is not quoted next to a watch in this public file; it is in the private key.)

### Watches that go silent (Open, today > 0 → 0)

| Watch | Owner | Today | #2043 only | #2040 only | Both | Verified |
|---|---|---|---|---|---|---|
| `332eef89` | 15 | 1 | 0 | 1 | 0 | misspelled "janitoral": loses its one correct notice (real undermatch; typo recommendation, never auto-applied) |
| `b4e40d05` | 18 | 26 | 0 | 26 | 0 | 26 legacy hits all judged unrelated by blind labeling |
| `b032f39f` | 20 | 8,885 | 0 | 8,885 | 0 | buyer has 0 notices in the window (checked directly); legacy matched the whole market |

`c75b5e65` (owner 4) drops 8 → 0 on Open once its set-asides apply, but its Open horizon is off, so the customer sees no
change. The 11 Agent 2 pauses stop alerts by design and are not counted here.

### Watches that expand

| Watch | Owner | Today | Both | Assessment (sampled the notices it would gain) |
|---|---|---|---|---|
| `3ed7a107` | 32 | 6 | 10 | **unexpected**: a single place-name search gains Fort Benning GA, Fort Stewart GA, Fort Leonard Wood MO and an Alaska FAA notice. Canonical reads Texas as a state and the state filter matches place of performance OR buying-office state (Army MICC and FAA regional offices sit in Texas). |
| `c2adcce1` | 32 | 6 | 10 | **unexpected**: same as `3ed7a107` |
| `0e41b9aa` | 34 | 24 | 25 | **unexpected**: a 6-word facilities-services capability list that admits on any one word; gains MQ-9 instructor services, wet-blade hours, child care |
| `994c599e` | 5 | 0 | 77 | expected: IT NAICS watch whose exclusion-only text made legacy return 0 |
| `02b35d34` | 24 | 0 | 18 | expected: Air Force now recognized as a buyer |
| `9da3488e` | 24 | 0 | 16 | expected: Army now recognized |
| `caf96deb` | 24 | 0 | 21 | expected: Veterans Affairs now recognized |
| `e9f648f6` | 28 | 2 | 39 | expected: a product word + its NAICS; gains are that product |

The three unexpected expansions come from moving alerts onto the Map's canonical engine (#2043): the Map already shows
these results for the same search today. They are shared-planner behaviour (geography definition; capability-list
matching, assessment R2/R3), not a defect in either PR. Recommendation: do not activate for
these 3 watches' owners until the geography wording is disclosed to them (Texas) and the capability-list rule is decided;
or notify them explicitly that their results will include these. Their gains are a small share of their results
(3ed7a107/c2adcce1: 7 gained of 10; 0e41b9aa: 3 gained of 25).

### Per-watch table (60)

| Watch | Owner | PR | Open emailed | Today | #2043 only | #2040 only | Both | +/- vs today | Outcome | Notice |
|---|---|---|---|---|---|---|---|---|---|---|
| `3df4e769` | 1 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `6dda3cd3` | 1 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `d8794f46` | 2 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `54fd0605` | 3 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `1b018df4` | 5 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `88d24ae2` | 6 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `02dc20b6` | 7 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `64eb46b6` | 7 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `749d017b` | 8 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `ae5ddb00` | 8 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `4f3df70a` | 17 | #2040 | yes | 9,198 | 9,198 | — | — | — | Paused (Agent 2) | required |
| `332eef89` | 15 | both | yes | 1 | 0 | 1 | 0 | +0 / -1 | Goes silent on Open | required |
| `b4e40d05` | 18 | #2043 | yes | 26 | 0 | 26 | 0 | +0 / -26 | Goes silent on Open | required |
| `b032f39f` | 20 | #2043 | yes | 8,885 | 0 | 8,885 | 0 | +0 / -3,000 | Goes silent on Open | required |
| `3ed7a107` | 32 | #2043 | yes | 6 | 10 | 6 | 10 | +7 / -3 | Expands, UNEXPECTED | HOLD (fix first) |
| `c2adcce1` | 32 | #2043 | yes | 6 | 10 | 6 | 10 | +7 / -3 | Expands, UNEXPECTED | HOLD (fix first) |
| `0e41b9aa` | 34 | #2043 | yes | 24 | 25 | 24 | 25 | +3 / -2 | Expands, UNEXPECTED | HOLD (fix first) |
| `994c599e` | 5 | #2043 | yes | 0 | 77 | 0 | 77 | +77 / -0 | 0 → matches | required |
| `02b35d34` | 24 | #2043 | yes | 0 | 18 | 0 | 18 | +18 / -0 | 0 → matches | required |
| `9da3488e` | 24 | #2043 | yes | 0 | 16 | 0 | 16 | +16 / -0 | 0 → matches | required |
| `caf96deb` | 24 | #2043 | yes | 0 | 21 | 0 | 21 | +21 / -0 | 0 → matches | required |
| `e9f648f6` | 28 | #2043 | yes | 2 | 39 | 2 | 39 | +37 / -0 | More matches | required |
| `bf35f82a` | 18 | #2043 | yes | 451 | 118 | 451 | 118 | +3 / -336 | Changed (gains and losses) | required |
| `3e2511ad` | 19 | #2043 | yes | 7,929 | 20 | 7,929 | 20 | +8 / -2,988 | Changed (gains and losses) | required |
| `386e228b` | 20 | #2043 | yes | 8,885 | 189 | 8,885 | 189 | +126 / -2,937 | Changed (gains and losses) | required |
| `9ca2d2de` | 20 | #2043 | yes | 8,885 | 260 | 8,885 | 260 | +161 / -2,901 | Changed (gains and losses) | required |
| `e00435f7` | 21 | #2043 | yes | 2,678 | 35 | 2,678 | 35 | +17 / -2,660 | Changed (gains and losses) | required |
| `741adbff` | 22 | #2043 | yes | 169 | 87 | 169 | 87 | +8 / -90 | Changed (gains and losses) | required |
| `e4460582` | 22 | #2043 | yes | 21 | 19 | 21 | 19 | +1 / -3 | Changed (gains and losses) | required |
| `03a84411` | 23 | #2043 | yes | 51 | 43 | 51 | 43 | +7 / -15 | Changed (gains and losses) | required |
| `22a140c6` | 23 | #2043 | yes | 51 | 43 | 51 | 43 | +7 / -15 | Changed (gains and losses) | required |
| `0bf23482` | 26 | #2043 | yes | 258 | 121 | 258 | 121 | +62 / -199 | Changed (gains and losses) | required |
| `55f30f29` | 30 | #2043 | yes | 57 | 37 | 57 | 37 | +9 / -29 | Changed (gains and losses) | required |
| `ba24fc15` | 31 | #2043 | yes | 675 | 390 | 675 | 390 | +112 / -397 | Changed (gains and losses) | required |
| `434b1e74` | 1 | #2040 | yes | 830 | 830 | 123 | 123 | +0 / -707 | Narrower | required |
| `0678583e` | 7 | #2043 | yes | 115 | 3 | 115 | 3 | +0 / -112 | Narrower | required |
| `c3f908e3` | 7 | #2043 | yes | 8,885 | 1 | 8,885 | 1 | +0 / -2,999 | Narrower | required |
| `e9c0f9be` | 7 | #2043 | yes | 2,573 | 6 | 2,573 | 6 | +0 / -2,567 | Narrower | required |
| `ff372605` | 7 | #2043 | yes | 594 | 40 | 594 | 40 | +0 / -554 | Narrower | required |
| `027283a9` | 10 | both | yes | 1,610 | 665 | 543 | 1,208 | +0 / -402 | Narrower | required |
| `4dcfa6ea` | 19 | #2043 | yes | 201 | 14 | 201 | 14 | +0 / -187 | Narrower | required |
| `61d1ca1f` | 20 | #2043 | yes | 8,885 | 1 | 8,885 | 1 | +0 / -2,999 | Narrower | required |
| `fdcc7cf8` | 25 | #2043 | yes | 87 | 22 | 87 | 22 | +0 / -65 | Narrower | required |
| `574a9289` | 26 | #2043 | yes | 24 | 1 | 24 | 1 | +0 / -23 | Narrower | required |
| `c4988fe6` | 27 | #2043 | yes | 848 | 830 | 848 | 830 | +0 / -18 | Narrower | required |
| `fc24136b` | 29 | #2043 | yes | 2,067 | 143 | 2,067 | 143 | +0 / -1,924 | Narrower | required |
| `08096951` | 31 | #2043 | yes | 258 | 28 | 258 | 28 | +0 / -230 | Narrower | required |
| `ff7ba678` | 33 | #2043 | yes | 32 | 6 | 32 | 6 | +0 / -26 | Narrower | required |
| `5e4bcd5a` | 5 | #2040 | yes | 3 | 3 | 3 | 3 | +0 / -0 | No visible change | not needed |
| `ab8bb3c8` | 8 | #2040 | yes | 3 | 3 | 3 | 3 | +0 / -0 | No visible change | not needed |
| `c11fcdb7` | 9 | #2040 | yes | 0 | 0 | 0 | 0 | +0 / -0 | No visible change | not needed |
| `32acc010` | 12 | #2040 | yes | 1,637 | 1,637 | 1,637 | 1,637 | +0 / -0 | No visible change | not needed |
| `9860bcf9` | 12 | #2040 | yes | 109 | 109 | 109 | 109 | +0 / -0 | No visible change | not needed |
| `fa66531f` | 14 | #2040 | yes | 0 | 0 | 0 | 0 | +0 / -0 | No visible change | not needed |
| `39fbb6e0` | 16 | #2040 | yes | 0 | 0 | 0 | 0 | +0 / -0 | No visible change | not needed |
| `c75b5e65` | 4 | #2040 | no | 8 | 8 | 0 | 0 | +0 / -8 | No visible change (Open off; Coming Soon only) | not needed |
| `1c3b715a` | 11 | #2040 | no | 240 | 240 | 240 | 240 | +0 / -0 | No visible change (Open off; Coming Soon only) | not needed |
| `4692743e` | 13 | #2040 | no | 131 | 131 | 5 | 5 | +0 / -126 | No visible change (Open off; Coming Soon only) | not needed |
| `5b867c2f` | 13 | #2040 | no | 85 | 85 | 5 | 5 | +0 / -80 | No visible change (Open off; Coming Soon only) | not needed |
| `7d3a2556` | 13 | #2040 | no | 9,198 | 9,198 | 9,198 | 9,198 | +0 / -0 | No visible change (Open off; Coming Soon only) | not needed |

+/- counts compare notice ids and are capped at 3,000 ids per side, so a whole-market "today" shows at most -3,000.

**With C1 (#2045) added to the merge** (recount re-run with C1's `buyer.ts` + aliases): 59 of 60 rows identical. `61d1ca1f`
(owner 20) "both" goes 1 → 0; the 1 was a Federal Housing Finance Agency notice matched through the word "housing". With
C1 it joins "goes silent": a HUD watch with no HUD notice in the window under its filters. Its notice text should use the
"Matches → 0" block.

## 7. Round 4 update (2026-11-14): C1 live, any-word correction measured, held owners

**C1 released.** PR #2045 merged as `cff898226`, production deployment `dpl_HPJ8TnsJD4GngFS5nTEmfZkqcLD7`
(market-assassin-j8osmhxz5). Effect on the 60 watches once #2043 is active: `61d1ca1f` (owner 20) 1 → 0, as in §6. The
legacy alert evaluator (flag off, today) does not use this matching, so no current alert changed.

**Any-word correction (draft PR #2047, not merged).** Over all 186 alerting watches under #2043's canonical recipe, one
count changes: `0e41b9aa` (owner 34) 25 → 19. Its 6 removed notices are the unrelated ones listed in §6 (MQ-9 instructor
services, wet-blade flight hours, child care, aircraft test stands). Its direct matches go 6 → 3; it still alerts. The
other 59 of the 60 are unchanged.

**Updated combined "after" for the held and changed rows** (both PRs + C1 live + #2047 if merged):

| Watch | Owner | Today | After #2040 + #2043 (+ C1) | After also #2047 |
|---|---|---|---|---|
| `61d1ca1f` | 20 | 8,885 | 0 | 0 |
| `0e41b9aa` | 34 | 24 | 25 | 19 |
| `3ed7a107` | 32 | 6 | 10 | 10 |
| `c2adcce1` | 32 | 6 | 10 | 10 |

The notification list is unchanged: 27 of 34 owners. Owners 32 and 34 stay HELD.

### Held owners: plain-language explanation (draft, NOT sent; no criteria changed)

Owner 32 (two watches searching a state by name):

> Your saved search for Texas will start following the Opportunity Map. On the Map, a Texas search shows notices for
> work performed in Texas and notices issued by buying offices located in Texas, because many federal notices do not
> say where the work will be done. Some of those offices buy for other states: for example, an Army contracting office
> in Texas runs base operations contracts at Fort Benning (Georgia), Fort Stewart (Georgia) and Fort Leonard Wood
> (Missouri). With this change your alert would have shown about 10 notices over the last 30 days instead of 6, and
> some of the new ones are for work outside Texas. If you only want work performed in Texas, reply and we will help
> you set that up; nothing changes until you tell us.

Owner 34 (one facilities-services watch with six service words):

> Your saved search lists several services. Until now, a notice could match on any one of those words, so some alerts
> were unrelated (for example, aircraft instructor services and a child-care program). We are correcting this so that
> very common words only count when they appear together with another word from your search. Over the last 30 days
> your alert would have shown 19 notices instead of 25, and the 6 removed were the unrelated ones. Your saved search
> itself does not change.

Both explanations are drafts for approval. The owner-34 text assumes #2047 is merged before activation; if it is not,
that owner keeps the §6 behaviour and the text must not be sent.
