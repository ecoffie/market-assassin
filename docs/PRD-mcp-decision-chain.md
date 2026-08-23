# PRD: Mindy MCP — Decision-Chain Integrity

**Filed 2026-08-23.** Six defects found live against the deployed MCP while building a
machine-shop demo. All have reproductions. **Root causes below are HYPOTHESES, not findings —
verify each before implementing.**

## Purpose

A government contractor must be able to move from **question → decision** without Mindy
changing the truth between steps. Today they cannot: the tools work individually and fail at
the seams.

**Every recent failure has occurred BETWEEN otherwise-working components:**
- capability text → market classification
- market report → contractor lookup
- market population → depth calculation

This PRD establishes a new test category — **decision-chain tests** — alongside unit tests.
Unit tests prove each tool works. **Decision-chain tests prove a contractor can actually get
from question to decision.**

## Non-goals

- Do NOT patch downstream where the damage is already done. FM-U10 (`capability-match-anchor.unit.test.ts`)
  documents this exact class being "fixed" twice and reopened as PARTIAL. **A third downstream
  exception is the failure mode to avoid.**
- Do NOT encode the hypothesised root causes as fact. Each acceptance test below asserts
  **behaviour**, not implementation.

---

## THE GATE — the machine-shop decision chain

**No P0 is done because its unit test passes.** After both P0s, this end-to-end journey must
run clean:

```
capability text → market → report → competitor/incumbent → contractor profile → awards/agencies
```

**Fixture:** a 12-person NJ machine shop. CNC turning, milling, fabrication, made-to-print parts.

**Must hold at every hop:** the entity identified in step N resolves in step N+1, and no step
contradicts the step before it.

**The gate must be EXECUTABLE IN CI. Not a manual checklist.** Where the five-hop test lives and
which harness runs it is an implementation decision — inspect the existing test infrastructure
and choose the least duplicative home. **The requirement is that it runs automatically and
fails the build, not that it lives in any particular place.**

---

## P0-1 · Capability text → correct market

**Reproduction (live 2026-08-23):**

| Input | Lead keyword | Lead NAICS returned | Vocabulary |
|---|---|---|---|
| "small machine shop, CNC machining, turning, milling, 12 employees" | `small` | **332993 Ammunition Mfg** (55% of $16.3B) | "small diameter bomb", "JDAM", "propelling charges" |
| same, minus "small", keeps "made-to-print" | `milling fabrication made-to-print` | **333244 Printing Machinery** | "copier", "Ricoh", "managed print" |

Competitors returned included SMALL DOG ELECTRONICS, SMALLWOOD PRISON DENTAL SERVICES, RICOH USA.
**332710 Machine Shops never appeared in either run.**

### TASK 0 — trace the anchor before touching anything

**Do this first. Do not start from the hypothesis below.**

Trace the actual selection path end to end: **capability text → derived keywords → keyword
coverage → lead keyword → lead NAICS.** Identify the precise line where the anchor is chosen.
Write down what you find before proposing a fix.

**Why this is Task 0 and not a caveat:** the hypothesis below is an inference from reading
`company-keywords.ts`, not a traced execution. **The reporter did not confirm how the lead
keyword becomes the lead NAICS.** If the anchor is selected elsewhere in the chain, the stopword
theory is a wrong turn — and starting from it will bias the investigation toward a filter that
may not be the control point.

**Hypothesis (to confirm or discard AFTER Task 0):** `company-keywords.ts` has a `brand_exclude`
filter (MINDY-004) that strips the company NAME from keywords — correct shape, works. There
appears to be no equivalent filter for generic business words, so `small` / `precision` /
`family owned` can survive to become the lead. `capability-market-match.ts:137`
`GENERIC_SERVICES` filters generic NAICS *downstream*.

**Acceptance:**
1. For representative machine-shop capability text, **332710 appears in the returned market.**
2. A single generic token can **never** be the anchor. Adversarial set, all must fail to anchor:
   `small` · `large` · `precision` · `quality` · `professional` · `certified` · `family owned` ·
   `services` · `solutions` · `company` · `group`.
3. **Hyphenated terms of art are preserved atomically.** `made-to-print` must not match
   `printing`. Same for `build-to-print`, `made-to-order`, `mission-critical`.
4. Fix is **upstream of** `GENERIC_SERVICES`, not another entry in it.
5. FM-U10's existing EOD assertions still pass.

---

## P0-2 · Contractor profile completeness

**Reproduction (live 2026-08-23):**
```
search_contractors(keyword "Fluidyne")
  → FLUIDYNE CORPORATION, uei RG3VUTDYFNF8, $58,141,683, 1278 awards, 73 NAICS   ✅

get_contractor_profile("FLUIDYNE CORPORATION")
  → found:true, same uei, same totals
  → top_agencies: []      recent_awards: []                                       ❌

get_contractor_award_history("FLUIDYNE CORPORATION")
  → history: null, grounded:false, award_count 0                                  ❌
```
Reproduced identically on LOUGHMILLER MACHINE, TOOL & DESIGN ($43.4M, 284 awards, both arrays empty).

**Data gap is ruled out** — the index holds the firm, its UEI, its totals, and its first/last
award dates.

### REQUIRED BEFORE IMPLEMENTATION — identity-path investigation

**P0-2 and P1-1 may be the same defect. Resolve that question before writing either fix.**

Trace normalization along the full identity path:

```
emitted contractor name → lookup input → canonical identity (UEI?) → award join
```

At each hop, record what the identity actually is and how it is compared. **If both failures
collapse to one normalization defect, fix that layer once** — and keep **separate regression
tests for both symptoms**, so a future change cannot silently reopen one while the other stays
green.

**Acceptance:**
1. **Invariant:** if `search_contractors` resolves a contractor with `award_count > 0`, then
   `get_contractor_profile` for that same entity **must not** return empty `top_agencies` or
   `recent_awards`.
2. Same invariant for `get_contractor_award_history` — it must not return `grounded:false` for
   an entity the index reports as having awards.
3. Test asserts against the **authoritative population**, not a hardcoded row count.
4. If a genuine data gap exists for some entities, the tool must **say so distinctly** rather
   than returning a populated header with empty bodies.

---

## P0-3 · Rule-of-Two / market-depth correctness

**Reproduction (live 2026-08-23):**
```
assess_market_depth(naics 561720, set_aside "Small Business")
  → market_depth 0, capable_depth 0, all counts 0, businesses [], grounded:false
```
But FY2025 561720 small-business set-aside awards include:
TLS Joint Venture $23.6M + $19.3M · Dynamic-HHS JV $8.6M + $6.7M · Titan Facility Services $5.6M.
**Five performers, ~$63M, reported as zero.**

**Acceptance:**
1. **Reconcile the computed metric against its authoritative population** — do not assert a
   hardcoded expected count. The test derives the expected floor from the award data and
   asserts the metric is consistent with it.
2. A market with N performers in the award data cannot report `capable_depth 0`.
3. If a market genuinely has no qualified performers, the caveat must distinguish
   **"no performers"** from **"lookup returned nothing."**
4. This is the buyer-side Rule-of-Two demo for SAME — **a wrong answer here is given in front
   of government contracting personnel.**

**Why this is P0, not a quality issue.** Rule of Two is a legal standard: two or more capable
small businesses at a fair market price means the requirement **should be set aside**. A tool
reporting **zero performers where five exist** does not merely display something wrong — **it
can drive the wrong acquisition conclusion.** That is the same severity class as wrong-market
classification and broken incumbent lookup.

---

## P1-1 · Entity normalization invariant

**Reproduction (live 2026-08-23):**
```
generate_market_report(naics 332710)
  → emits "LOUGHMILLER MACHINE, TOOL &amp; DESIGN"        (HTML-escaped)

get_contractor_profile("LOUGHMILLER MACHINE, TOOL &amp; DESIGN")  → found:false   ❌
get_contractor_profile("LOUGHMILLER MACHINE, TOOL & DESIGN")      → found:true    ✅
```

**The general rule this establishes:**

> **Anything emitted by one Mindy tool must be valid input to the next.
> Output → input round-trip must preserve entity identity.**

**Acceptance:**
1. Every entity name emitted by any tool resolves identically when passed to any tool that
   accepts that entity.
2. Round-trip test covers at minimum: `&`, `'`, `"`, `<`, `>`, accented characters, and
   trailing legal suffixes (`INC.` / `INC` / `, LLC`).
3. This is a **generic invariant test across tools**, not a patch to `get_contractor_profile`.

---

## P2-1 · Buyer vocabulary

**Reproduction:** `get_market_vocabulary(["332710"])` → `fabrication, assemblies, locks,
adapter, assembly, ring, river, test`. (`river` is noise; `ring`/`test` are not procurement terms.)

Meanwhile `generate_market_report` surfaced the real phrase from a live forecast:
**"build-to-print fabrication of products via processes utilized by Machine Shops."**

**Define what useful vocabulary IS before changing the extractor.** Proposed definition, to be
confirmed: a term is useful if it is **a phrase a buyer writes in a requirement** — multi-word,
domain-specific, and it would appear in a capability statement without looking absurd.

**Acceptance:**
1. Returned terms are predominantly **phrases / terms of art**, not high-frequency unigrams.
2. Generic verbs and nouns (`test`, `ring`, `river`, `assembly`) do not dominate the list.
3. The definition of "useful" is written down and the test asserts against it.

---

## P2-2 · Notice → vehicle linkage (NEW CAPABILITY, not a bug fix)

**The gap, demonstrated:**
```
search_sam_opportunities("healthcare environmental cleaning")
  → "European Healthcare Environmental Cleaning", HT9406-26-R-E006, closes 2026-09-09
```
Nothing connects it to **HT940824D0001 / D0008 / D0009** — the parent IDIQs already holding the
CONUS orders (TLS JV, Dynamic-HHS JV, Titan Facility Services).

**Both halves exist in different tools. The synthesis is left to the user — and the synthesis is
the expert's actual value.** This is the most-endorsed insight from the audience:

> *"Some contracts are already wired to an entity although they give the appearance of being
> competed to hit the market survey and due diligence gates."*
> — Tim Teal, Retired Government Senior Executive (5 reactions)

### ⛔ EVIDENCE-DESIGN GATE — scaffold only, do not implement

**`/from-prd` may scaffold this. Implementation is BLOCKED** until the evidence model is decided
by the product owner.

**Why blocked:** what counts as sufficient evidence for a notice → predecessor-vehicle
relationship is a product/research decision, not something an implementer should quietly invent.
A wrong threshold here produces confidently-stated incumbent claims that are false — the worst
possible failure for a tool whose value is that its answers are grounded.

**Direction (not yet a specification — thresholds to be set after inspecting what the data
actually contains):** an evidence hierarchy, strongest first —
1. Solicitation / agency identifiers and explicit references in the notice itself
2. Deterministic procurement relationships (shared parent PIID, order-under-IDIQ)
3. Corroborated metadata (NAICS + office + period + scope language, in agreement)
4. **Semantic similarity — candidate generation ONLY, never proof**

**Do not set thresholds before seeing the data.** The next step on P2-2 is an inspection of what
evidence actually exists in the award and notice records, then a decision — not code.

**Acceptance (applies once unblocked):**
1. **Evidence and confidence are defined and returned.** What counts as a link — shared parent
   PIID, matching NAICS + office + scope language, or something stricter?
2. **A fuzzy semantic match must never be stated as a confident incumbent relationship.** Low
   confidence must surface as low confidence, or not at all.
3. Never invent a vehicle relationship that is not in the award record.

---

## Implementation order

**P0-1 → P0-2 → P0-3 → [DECISION-CHAIN GATE, CI-executable] → P1-1 → P2-1 → ⛔ STOP at P2-2 evidence-design gate**

**P0-1 begins with Task 0 (trace the anchor). P0-2 begins with the identity-path
investigation, which may also resolve P1-1.**

**The gate is mandatory.** After the three P0s, run the machine-shop journey end to end. Unit
tests passing is not the bar — **the journey is the product.**

**P2-2 is scaffold-only.** Work stops at the evidence-design gate pending a product decision.

## Production verification & rollback

**All six defects were found live, not in tests.** Tests passing is therefore not evidence the
fix works. **Every P0 and P1 names its live reproduction, its expected result, the signal that
confirms it after deploy, and the condition that triggers rollback.**

Run each verification **against the deployed MCP**, not a local build.

| # | Live repro (exact call) | Expected after fix | Post-deploy confirmation | Rollback if |
|---|---|---|---|---|
| **P0-1** | `capability_market_match` with `"small machine shop, CNC machining, turning, milling, 12 employees"` | Market contains **332710**. Lead keyword is not `small`. Vocabulary contains no munitions terms. | Log the derived lead keyword + lead NAICS for every call for 48h. Alert on any single-token generic lead. | Any run returns a lead NAICS whose 2-digit prefix differs from the capability's true sector, **or** FM-U10 EOD assertions regress. |
| **P0-2** | `get_contractor_profile("FLUIDYNE CORPORATION")` | `top_agencies` and `recent_awards` both non-empty. | Count profile calls returning `found:true` with an empty body array. **Target: zero.** | That count is non-zero for any entity where `search_contractors` reports `award_count > 0`. |
| **P0-3** | `assess_market_depth(naics 561720, set_aside "Small Business")` | `capable_depth ≥ 2`, businesses list non-empty, `rule_of_two_met` consistent with the award population. | Log every `capable_depth 0` result with its NAICS. Reconcile nightly against award data. | Any market reports `capable_depth 0` while award data shows ≥2 performers in scope. |
| **P1-1** | `get_contractor_profile("LOUGHMILLER MACHINE, TOOL &amp; DESIGN")` | Resolves identically to the decoded form. | Round-trip probe: take N names emitted by `generate_market_report`, feed each back to `get_contractor_profile`. **Target: 100% resolve.** | Round-trip resolution drops below 100% on names containing `&`, quotes, or accents. |

**Rollback is per-defect, not per-deploy.** These fixes touch different layers; one regressing
must not force reverting the others. **If the identity-path investigation collapses P0-2 and
P1-1 into a single fix, they roll back together** — and both regression tests must be part of
the same gate.

**Ordering with production:** deploy → run the live repro → confirm the signal → only then mark
the defect closed. **Do not close a defect on a green test suite alone.**

## Decision-chain tests — the new category

Add alongside the existing unit tests. Each asserts that **identity and truth survive a hop**:

| Chain | Assertion |
|---|---|
| capability → market | the derived market contains the company's actual NAICS |
| report → contractor | every name emitted resolves when passed back in |
| contractor → awards | a firm with awards returns awards |
| market → depth | depth is consistent with the award population |
| notice → vehicle | a claimed link has stated evidence and confidence |

## Why this matters commercially

Mindy's thesis is that it gives the ordinary contractor what only a KO or a 20-year capture
person knows. Tested against six real expert claims from the audience, it delivered **2 fully,
1 partly, 3 not at all.** The tool already replaces the expert's **research**. These fixes are
what let it start replacing the expert's **synthesis**.
