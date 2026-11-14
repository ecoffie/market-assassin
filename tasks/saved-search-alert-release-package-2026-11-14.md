# Saved-search alert release package — reconciliation, notices, rollback (Agent 3, 2026-11-14)

**Status: prepared, NOT approved.** `SAVED_SEARCH_OPEN_CANONICAL` stays off. No migration applied, no notice sent, no
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

## 3. Release sequence (each step needs its own approval)

1. Merge #2040; run Agent 2's 15 corrections (dry run → approval → write, with the per-record snapshot in §5).
2. Decide the search-accuracy corrections (`fix/agent3-search-accuracy`, `tasks/search-accuracy-assessment-2026-11-14.md`).
   C2 changes janitorial-type watches again; deciding it BEFORE notices avoids a second notice to the same owners.
3. Merge #2043 (inert). Apply `20261114_saved_search_open_engine.sql` via the runner; `db:check` the column.
4. Prod preview with both changes: recompute "after" for all 60 rows; regenerate notices from those numbers.
5. `/email-audit` on the 34 recipients (caps, suppressions, recent sends). Approval of final copy + list.
6. Send ONE consolidated notice per owner, at least 3 days before activation.
7. Flip `SAVED_SEARCH_OPEN_CANONICAL=true` + redeploy; pause Agent 2's 11 at the same time.
8. Watch 3 daily runs: transitioned searches send 0 on day 1, then only genuinely new notices; no
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
| Notices | email | n/a | Cannot be recalled. Mitigation: send only after the prod preview numbers are final; a correction email goes only to owners whose numbers were wrong. |

Trigger to roll back: any transitioned search sending on day 1; a send-volume spike for any owner; a
`search_needs_refinement` on an existing search; an owner reporting missing notices that the Map shows.
