# MCP Decision-Chain Integrity — implementation plan

**From:** `docs/PRD-mcp-decision-chain.md`
**Scaffolded:** 2026-08-23
**Sequence:** P0-1 → P0-2 → P0-3 → [CI GATE] → P1-1 → P2-1 → ⛔ STOP at P2-2

> **A defect closes on a confirmed live signal, never on a green suite.**

---

## ⚠️ BLOCKING FINDING — read before task 1

**The existing MCP tests cannot detect any of these six defects, and this is why FM-U10
reopened twice.**

Every `*.unit.test.ts` in `src/mcp/tools/` uses `readFileSync` + `expect(src).toContain(...)`.
**They assert that source text exists. They never call a tool.**

`capability-match-anchor.unit.test.ts` asserts `expect(src).toContain('GENERIC_SERVICES')`.
**That test passes today** — it passed while `capability_market_match` returned Ammunition
Manufacturing for a machine shop. It proves a constant is still in the file. Nothing more.

**Consequences:**
- Every acceptance criterion in the PRD is **behavioural**. None can be expressed in the
  existing style. **A behavioural harness is a prerequisite, not a preference.**
- There is **no `.github/workflows/` directory**. "CI-executable" has no CI to execute in.
- `tests/run-all-tests.sh` does not invoke vitest, so `npm test` skips the unit tests entirely.

---

## Task 0 — behavioural test harness  ⬅ PREREQUISITE FOR EVERYTHING

- [ ] Create a harness that **invokes MCP tools and asserts on returned values**
- [ ] Decide fixture strategy: recorded fixtures for determinism vs live calls for truth
      (**recommend recorded fixtures for CI + a separate live smoke job** — the PRD requires
      live confirmation before a defect closes)
- [ ] Wire `vitest` into `tests/run-all-tests.sh` so `npm test` actually runs it
- [ ] Create `.github/workflows/` with a job that runs the suite and **fails the build**
- [ ] Leave existing source-text tests in place (they catch deletion of constants) but
      **do not add more of them**

---

## P0-1 · Capability text → correct market

### Task 0 (per PRD) — trace the anchor. DO THIS FIRST.
- [ ] Trace: capability text → derived keywords → keyword coverage → lead keyword → lead NAICS
- [ ] Identify the exact line where the anchor is selected
- [ ] **Write down what you find.** Confirm or discard the stopword hypothesis — do not start from it

### Implementation (only after the trace)
- [ ] Fix at the confirmed control point, **upstream of `GENERIC_SERVICES`**
- [ ] Behavioural test: machine-shop capability text → market contains **332710**
- [ ] Adversarial test: `small`·`large`·`precision`·`quality`·`professional`·`certified`·
      `family owned`·`services`·`solutions`·`company`·`group` — none may anchor
- [ ] Hyphenation test: `made-to-print` must not match `printing`; same for `build-to-print`,
      `made-to-order`, `mission-critical`
- [ ] FM-U10 EOD assertions still pass
- [ ] **Live verification:** call deployed MCP with the machine-shop text → 332710 present

---

## P0-2 · Contractor profile completeness

### Identity-path investigation — REQUIRED BEFORE IMPLEMENTATION
- [ ] Trace: emitted contractor name → lookup input → canonical identity (UEI?) → award join
- [ ] Record what the identity is at each hop and how it is compared
- [ ] **Decide: is P1-1 the same defect?** If yes, fix the normalization layer once

### Implementation
- [ ] Invariant: `search_contractors` reports `award_count > 0` ⇒ `get_contractor_profile`
      must not return empty `top_agencies` / `recent_awards`
- [ ] Same invariant for `get_contractor_award_history` (must not return `grounded:false`)
- [ ] Assert against the **authoritative population**, not a hardcoded row count
- [ ] Genuine data gaps must be **stated distinctly**, not returned as empty bodies
- [ ] **Live verification:** `get_contractor_profile("FLUIDYNE CORPORATION")` → both arrays non-empty

---

## P0-3 · Rule-of-Two / market-depth correctness

- [ ] Reconcile computed depth against the **authoritative award population** (not a fixture)
- [ ] A market with N performers in award data cannot report `capable_depth 0`
- [ ] Caveats must distinguish **"no performers"** from **"lookup returned nothing"**
- [ ] Check interaction with FM-03 (`market-depth-calibration.unit.test.ts`) — that fix made
      Rule of Two gate on `capableDepth`; confirm this defect is not a side effect of it
- [ ] **Live verification:** `assess_market_depth(561720, "Small Business")` → `capable_depth ≥ 2`

---

## 🚦 DECISION-CHAIN GATE — mandatory, CI-executable

**After all three P0s. Not a manual checklist.**

- [ ] Machine-shop journey end to end:
      `capability → market → report → competitor/incumbent → profile → awards/agencies`
- [ ] Fixture: 12-person NJ machine shop, CNC turning/milling/fabrication/made-to-print
- [ ] Assert at every hop: entity from step N resolves in step N+1; no step contradicts the last
- [ ] Five chain assertions from the PRD table
- [ ] **Runs in CI and fails the build**

---

## P1-1 · Entity normalization invariant

*(May already be resolved by the P0-2 identity-path work. If so, keep a separate regression
test for this symptom.)*

- [ ] Generic cross-tool round-trip: every emitted entity name resolves when passed back in
- [ ] Cover `&`, `'`, `"`, `<`, `>`, accents, and suffix variants (`INC.`/`INC`/`, LLC`)
- [ ] **Not** a patch to `get_contractor_profile` — an invariant across tools
- [ ] **Live verification:** name emitted by `generate_market_report` → resolves in
      `get_contractor_profile` unmodified

---

## P2-1 · Buyer vocabulary

- [ ] **Write down the definition of "useful vocabulary" first**, then change the extractor
- [ ] Returned terms are predominantly phrases / terms of art, not high-frequency unigrams
- [ ] Generic tokens (`test`, `ring`, `river`, `assembly`) must not dominate
- [ ] Test asserts against the written definition

---

## ⛔ P2-2 · Notice → vehicle linkage — SCAFFOLD ONLY

**Implementation BLOCKED pending a product decision on the evidence model.**

- [ ] Scaffold structure only
- [ ] **Next step is an inspection of what evidence the award/notice records actually contain**
- [ ] **Do not set thresholds before seeing the data**
- [ ] Do not implement until the owner decides what constitutes sufficient evidence

Direction recorded in the PRD (not a spec): explicit identifiers → deterministic procurement
relationships → corroborated metadata → semantic similarity **as candidate generation only,
never as proof.**

---

## Production verification

Per the PRD table. For each P0/P1: **deploy → run the live repro → confirm the signal →
only then close.** Rollback is per-defect, except P0-2/P1-1 which roll together if they
share a cause.
