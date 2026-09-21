# Engineering standard — decision integrity

**These are design constraints for Mindy's decision engine, not lessons from individual
defects.** Each was derived from a production defect that produced a confident, grounded,
plausible-looking wrong answer.

---

## 1. unknown ≠ none

> **`[]` means we looked and found none. `degraded` / `budget_limited` / a missing key means
> we did not look.**

An empty result is a **factual claim**. An unavailable one is an **operational state**.
Collapsing them makes the system assert a falsehood.

**Where it was violated**

| Defect | Symptom |
|---|---|
| P0-2 | `get_contractor_profile` returned `top_agencies: []` for Lockheed Martin ($221B, 4,850 awards) because a `cacheOnly` miss returns `[]` by design |
| P0-3 | `certifications @> ['SBA']` matched nothing, so `market_depth: 0` was reported as "no small businesses" for a market with 20,074 |
| #1289 | A BigQuery failure scored every firm `registered_only`, producing "Rule of Two NOT met" from a quota error |
| DEFECT-7 | `lookup_sam_entity` returns `degraded:true` — honest in `_meta`, reads as "no such entity" |

**Required shape:** three states, never two — **data · genuinely-none · not-retrieved** — with
the third explicit in the payload AND stating what the empty value does not mean.

**Grep for:** `.catch(() => [])`, `?? []`, `?? 0`, `cacheOnly` on an authenticated path, a
populated header beside empty bodies.

---

## 2. Existence may be proven from partial observation; absence requires exhaustion

> **Mindy may conclusively assert EXISTENCE from a sample. Mindy may assert ABSENCE only after
> exhaustive observation.**

Asymmetric by nature. Finding ≥2 capable firms in 1.2% of a market proves they exist. Finding
0 in 1.2% proves nothing.

**Where it was violated:** DEFECT-9A — `market_depth` computed from an unordered 1,000-row
slice of populations up to 56,744, in 377 of 971 NAICS (38.8%), and named as a market property.

**Required shape:** a population metric is either exhaustive or labelled as a sample with its
coverage published. A negative conclusion carries `conclusive: false` unless coverage is 100%.

**Corollary — sampling is acceptable for discovery, never for measurement.** A bounded
candidate list is fine. A bounded *count* presented as a population is not.

**Grep for:** `LIMIT` / `.range()` feeding a `count`, `depth`, `total`, or `_met` field; a
boolean carrying both "not found" and "does not exist".

---

## 3. Live verification requires provenance of the executing code path

> **A live acceptance test is valid only if the response can be shown to originate from the
> deployed code path under test.**

**Where it was violated:** three consecutive "live" verifications of 9A read stale 6-hour KV
entries. Two wrong root causes were diagnosed and shipped on that evidence.

**Deployment freshness and code-path execution are different facts.** The deploy finished 2.8
minutes after the merge — the code was live *and not executing*, short-circuited by a cache
written before it.

**Required:** cold cache, cache-key version bump, a `code_version` marker in the response, or
another explicit provenance signal. Timing inference is not provenance.

---

## 4. Raw retention prevents information loss; typed materialization establishes product meaning

> **Keep the source payload so nothing is unrecoverable. Give product meaning only to typed,
> normalized fields.**

`raw_data` is a **provenance store, not a query surface.** If product code queries it directly,
every consumer invents its own interpretation and the schema stops meaning anything.

**Where it was violated:** SAM ingestion discarded 140 of 157 raw fields, `raw_data` was empty
on all 910,123 rows, and `sbaSmallBusiness` — the field P0-3 needed — arrived on every sync
and was thrown away. Recovering it cost a full registry re-import.

**Required:** persist the raw payload with source type, snapshot version, and ingestion
timestamp. Materialize a field into a typed column when it carries product meaning. Never let
`raw_data` become the API.

---

## The common signature

Every defect above produced a **plausible-looking value**:

`top_agencies: []` · `market_depth: 0` · `eligible_population: 1000` · `rule_of_two_met: false`

None looked like an error. **A fabricated, stale, or unmeasured value is indistinguishable
from a measured one unless the code refuses to produce it.** That refusal is what these four
rules encode.
