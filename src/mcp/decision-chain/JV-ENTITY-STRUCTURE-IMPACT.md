# JV / entity structure — measured decision impact

**Measured 2026-08-24** against the Aug-2026 public extract (250K lines) and the live mirror.
Same rule as the two fields before it:

> Don't ask "how common is this field?" Ask **"how often would having this field change a
> Mindy decision?"**

## Q1 — how many entities are JVs?

**1,092 of 249,999 (0.44%)** by name pattern. Of those, 716 assert small somewhere.

Per-market share of asserted-small firms, 847 markets with ≥50 such firms:

| bucket | NAICS |
|---|---:|
| 0–1% | 721 |
| 1–5% | 125 |
| 5–20% | 1 |
| >20% | 0 |

The worst market is 541310 at **5.0%**. By prevalence alone this is a non-finding.

## Q2/Q3 — do related entities cluster in the same market?

**Yes — and this is where the signal is.** Grouping by `NAICS + exact street address` over
asserted-small firms:

- **5,684** groups contain more than one "firm"
- they contribute **6,733** redundant competitors

Real clusters, not artifacts:

| cluster | what it is |
|---|---|
| **818 St Augustines Dr, Winnebago NE** — 12 firms in 541611, and again across 561210 / 541513 / 541990 | Ho-Chunk Inc. and its subsidiaries — one ANC parent counted a dozen times |
| **1927 Watercrest Dr, Auburn AL** — 8 firms in 624310 | "California / Colorado / Missouri Vocational Experts" — the same firm registered per state |
| **Toa Baja, PR** — `OS-DB-JV`, `OS-DB-JV-2`, `OS-DB-JV-3` | three JVs, one address, all 561720-small |

⚠️ **A first pass reported 67,292 groups and 194,875 redundant competitors. That was wrong** —
the address key used indices 14/16/17/18, which is *city*, not street (street is **idx 15**,
city 17, state 18, zip 19). It grouped "310 unrelated firms in Washington DC" as one cluster.
Corrected to a street-level key, the real numbers are ~29× smaller.

## Q4 — the decision test

**Whole-NAICS: zero impact.** Of 967 markets with ≥1 asserted-small firm, **0** flip from ≥2 to
<2 after de-duplication. Counts shrink ~2% (541611: 17,817 → 17,438), which changes nothing:
a market with seventeen thousand sources is not near the Rule-of-Two boundary.

**Scoped pools (NAICS + state) — a real but narrow effect.** This is how Rule of Two is
actually applied:

| | |
|---|---:|
| NAICS+state pools | 38,895 |
| pools with ≥2 raw small sources | 30,480 |
| **pools that FLIP (≥2 → <2 after de-dup)** | **33 (0.11%)** |
| thin pools (2–4 raw) | 11,833 — of which 33 flip (0.3%) |

Examples: `331313|LA`, `322110|MD`, `333921|NV`, `112210|OK`, `335139|KY` — each shows
`raw=2 → independent=1`. In those 33 cases a set-aside recommendation would be justified by
"two small sources" that are **one organization at one address**.

## Verdict

**Real, but far smaller than the earlier fields.** For comparison:

| field | decision impact |
|---|---|
| `naicsException` | **13 markets, 100% of firms blanked** — 0.0% small-flagged across 127,366 firms |
| JV / entity structure | **33 of 30,480 scoped pools (0.11%)** flip |
| `purposeOfRegistration` | **0 markets** materially distorted |

So: **do not promote this above certification dates.** It does not justify materializing
structure fields now. What it does justify is a **narrow guard** — when a Rule-of-Two pool is
thin (2–4 sources) *and* two of them share a street address, the evidence should say so rather
than assert two independent sources.

## What was NOT done

- ❌ No structure/parent fields materialized — the measurement does not justify it yet.
- ❌ No de-duplication wired into any live count.
- ❌ Address matching is a **proxy** for relatedness, not proof: shared addresses also occur at
  registered-agent services and business incubators. A real parent/subsidiary signal needs the
  hierarchy fields, which remain unconfirmed in the layout.
