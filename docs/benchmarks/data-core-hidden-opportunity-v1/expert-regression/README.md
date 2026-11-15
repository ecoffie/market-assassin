# Eric's expert labels: permanent store

`expert_labels.jsonl` is the single permanent record of every relevance judgment Eric has made. It is **append-only**.
Today it holds 47 judgments from 2026-11-14 (18 Direct, 10 Related, 19 Not relevant), with his 2026-11-15 repair ruling applied to S30.
The same 47 are preserved in `../labels.jsonl` and in the v1 review page database (artifact `ALfvurSY5XuhbNCamX1RAi`, collection `reviews`). Both were checked identical, 47/47.

## Rules (enforced in code, `expert.py`)

| Rule | Where | Check |
|---|---|---|
| Eric's label beats his rulings, which beat AI reviewers | `apply_expert()`, called last in `v7/scripts/r16.labels()` (and every round derived from it) | `python3 -I check_expert.py precedence` exits 1 on any violation |
| Never re-ask Eric about a notice he has judged | `filter_new(pairs)` before building any human review sheet | the drop count is printed by the sheet builder |
| New judgments are appended, never overwritten. A conflict with his earlier label goes to him as a decision | `add_labels(rows, source)` returns conflicts and does not write them | — |
| Development only: exposed to Agent 3, never in the sealed holdout | the holdout lives in `~/mindy-bench-sealed/` | — |

`build_expert_regression.py` is the one-time builder (run 2026-11-15). It refuses to overwrite the store.

## Regression check for a search version

`python3 -I check_expert.py candidate <runner.json> ...` reports where each of Eric's notices lands: in the top 20, matched but below the top 20, or not retrieved.
These are fixture runs of Nov 14 notices, counted per phrasing (short + long):

| Version | Eric-Direct in top 20 | Eric-Direct not retrieved | Eric-Not-relevant in top 20 |
|---|---|---|---|
| RC1 `8c4ba2ea1` | 4 | 8 | 2 |
| RC2 `065451a66` | 11 | 8 | 1 |
| RC3 `5c5098165` | 10 | 8 | **0** |

The 8 Eric-Direct misses are the same in every version:
- parts: VALVE,THROTTLE `f8b01216`, BEARING `c29f7956`, KNOB `8fb40125`
- nursing: `7292f1b6`
- HVAC: `28d5fb2c`

That is a retrieval gap no candidate has closed.
