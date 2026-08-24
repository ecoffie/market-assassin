# Testing debt — source-text assertions that should be behavioural

## 1. `degraded-not-zero.unit.test.ts` — the UNAVAILABLE assertion

```ts
const SRC = read('src/app/gov/market-research/page.tsx');
expect(SRC).toContain("'UNAVAILABLE'");
```

**The requirement is right; the mechanism is wrong.** It asserts a *string literal exists in
the file*, not that a degraded response renders as unavailable.

It failed during the #1289 merge for a reason that had nothing to do with behaviour: my JSX
used `value="UNAVAILABLE"` (double quotes) while the guard looks for `'UNAVAILABLE'`. The
page was correct. I satisfied it by binding a named constant — which works, but **it makes
implementation syntax part of the contract.**

That is the exact failure class Task 0 documented: every `*.unit.test.ts` in `src/mcp/tools/`
uses `readFileSync` + `toContain`, and `capability-match-anchor.unit.test.ts` passed green
while `capability_market_match` returned Ammunition Manufacturing for a machine shop.

**Replace with:** render the component with a degraded response fixture and assert the
rendered output contains "UNAVAILABLE" and not "NOT MET". Then quote style, JSX shape, and
refactors stop mattering — only behaviour does.

**Do not delete the guard before the replacement exists.** It is protecting something real.

## 2. `determination_reason` (deferred, per Eric)

`'undetermined'` prevents a false negative but does not tell an agent what to do next. Two
distinct causes are currently collapsed:

| Cause | Meaning | Next action |
|---|---|---|
| `data_unavailable` | BigQuery/degradation (#1289) | **retry** — may resolve immediately |
| `partial_coverage` | sampling (DEFECT-9A) | **widen coverage** — retry alone will not help |

Plus the two conclusive states: `sufficient_positive_evidence` (≥2 found) and
`exhaustive_negative` (<2 with full coverage).

The internal distinction already exists — `dataDegraded` vs `sampleCoverage < 1` — so this is
surfacing it, not computing it. **Deferred until after live verification of 9A**, per Eric.
