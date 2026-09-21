# P0-3 Task 0 — trace. Found the exact hop where five becomes zero.

**No fix written.** Traced first, per the P0-1 discipline. The Rule-of-Two formula is NOT
broken; the population never reaches it.

## Reproduction (live, 2026-08-23)

`assess_market_depth(naics: "561720", set_aside: "SBA")` →
`market_depth: 0, capable_depth: 0, rule_of_two_met: false`, every count 0, `businesses: []`,
`grounded: false`, **`degraded: false`** (so nothing threw — it genuinely computed zero).

Authoritative population, same scope, via `search_past_contracts(561720, SBA, FY2025)`:
**10 distinct performers**, far more than the PRD's "five":

| Performer | UEI | Lifetime award |
|---|---|---|
| J & J MAINTENANCE INC | Y4TKSMDNTRN6 | $175.9M |
| B & O JOINT VENTURE LLC | MJQAHD8GV6D1 | $111.8M |
| FEDCAP REHABILITATION SERVICES | VZ7NXF5HQ269 | $109.8M |
| NMI ALASKA, INC. | LXL9TVM47G59 | $79.4M |
| HUNTSVILLE REHABILITATION FOUNDATION | L75EWKZBQY35 | $78.4M |
| DIDLAKE INC | YMZ1PCB5LEM9 | $74.1M |
| OS-DB-JV-2 LLC | JQBZNZDZNAN3 | $60.4M |

## The hop, isolated

`src/lib/gov-buyer/market-research.ts:359-365` builds the source pool from `sam_entities`:

```ts
.from('sam_entities')
.contains('naics_codes', [params.naics])     // filter 1
.eq('registration_status', 'Active')         // filter 2
.eq('exclusion_flag', false);                // filter 3
if (params.state) q = q.eq('physical_state', ...);
if (params.setAside) q = q.contains('certifications', [params.setAside]);   // filter 4  <-- HERE
```

Measured against the real table for NAICS 561720:

| After filter | Rows surviving |
|---|---|
| `naics_codes @> ['561720']` | 27,513 |
| `+ registration_status = 'Active'` | 21,933 |
| `+ exclusion_flag = false` | 21,933 |
| **`+ certifications @> ['SBA']`** | **0** |

**21,933 → 0 in one filter.** The population is fine right up to the certification match.

## Why: `'SBA'` is not a value in that column

The complete `certifications` vocabulary in `sam_entities` for this NAICS:

| Value | Firms |
|---|---|
| WOSB | 7,745 |
| VOSB | 4,819 |
| SDVOSB | 3,976 |
| 8(a) | 860 |
| HUBZone | 450 |

No `SBA`. No generic small-business value at all.

## The defect is wider than one bad argument

`tool-registry.ts:844` advertises:

> `set_aside: "Normalized label: '8(a)','HUBZone','SDVOSB','WOSB','EDWOSB','Small Business'."`

Tested every advertised value against the real data:

| Advertised | Matches | |
|---|---|---|
| 8(a) | 860 | works |
| HUBZone | 450 | works |
| SDVOSB | 3,976 | works |
| WOSB | 7,745 | works |
| **EDWOSB** | **0** | **advertised, never matches** |
| **Small Business** | **0** | **advertised, never matches** |
| **SBA** | **0** | not advertised, but is what a caller naturally passes |

**Three of the tool's own documented values silently return zero.** `VOSB` (4,819 firms)
exists in the data but is NOT advertised.

This is not a Rule-of-Two bug and not an FM-03 regression. FM-03 changed the gate from
`marketDepth` to `capableDepth`; both are computed from a pool that is already empty. The
gate change is a red herring for this defect.

## Why it is silent

`.contains()` on a non-existent value is a legitimate query returning zero rows — no error,
no exception, so `degraded: false`. The tool then reports `market_depth: 0` as a *finding*:
"no small businesses in this market." For a set-aside determination that is the most
dangerous possible wrong answer — it argues AGAINST setting the requirement aside when
21,933 registered firms and at least 10 active performers exist.

Same family as the P0-2 defect and the recorded `unknown-vs-none` audit class: **"I did not
match" presented as "there are none."**

## Options, none chosen — this needs a decision

1. **Map the input vocabulary** — translate `SBA`/`Small Business`/`EDWOSB` to what the data
   actually contains. But there is *no* generic small-business certification in
   `sam_entities`, so "Small Business" cannot map to a value; it would have to mean
   "any of the socioeconomic certs" or "no cert filter at all". Those are different
   questions with different Rule-of-Two consequences.
2. **Validate and reject** — fail fast on a set_aside value that cannot match, rather than
   returning a confident zero. Safe, and small.
3. **Fix the advertised vocabulary** — align `tool-registry.ts:844` with reality (drop
   EDWOSB/Small Business, add VOSB). Necessary regardless of 1 or 2.

**Open question for Eric:** what should `set_aside: "Small Business"` MEAN? SAM has no
such certification. Candidate readings — (a) any socioeconomic cert, (b) no cert filter,
relying on size standards Mindy does not currently model, (c) unsupported, reject it. This
is a domain decision about what a Rule-of-Two determination is allowed to assert, not a code
choice, and it is the reason no fix is written yet.
