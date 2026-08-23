# Decision-chain tests

**Why this exists:** every `*.unit.test.ts` in `src/mcp/tools/` asserts that *source text
exists* (`readFileSync` + `expect(src).toContain(...)`). Those tests never call a tool, so they
cannot detect a wrong answer. `capability-match-anchor.unit.test.ts` passed while
`capability_market_match` returned Ammunition Manufacturing for a machine shop.

That is why FM-U10 was "fixed" twice and reopened as PARTIAL.

**These tests assert on RETURNED VALUES.**

---

## The rule that keeps this honest

> **Never mock above the data boundary.**
> If a test mocks the function that contains the bug, it cannot fail for the right reason.

`assess_market_depth → runMarketResearch → Supabase/BigQuery/KV`

Mocking `runMarketResearch` would test the mock. P0-3 is "five real performers computed as
zero" — the defect lives in the computation, so the computation must be real.

**Mock only at the data boundary. Everything above it is real product code.**

---

## Two layers

| Layer | Runs | Network | Proves |
|---|---|---|---|
| **seam** (`*.seam.test.ts`) | every PR, CI | none — data boundary stubbed | normalization, joins, anchor selection, arithmetic |
| **live** (`*.live.test.ts`) | nightly + before closing a defect | real deployed MCP | the PRD's **confirmed live signal** |

**A defect closes on a confirmed live signal, never on a green suite.**
Seam tests gate the merge. Live tests gate the close. Both are required.

---

## Red-first requirement

**A new decision-chain test must be observed FAILING against unfixed code before the fix
lands.** Capture the failure. Then fix until the *same test* goes red → green.

Rationale: a harness whose stubs accidentally remove the production conditions responsible for
a bug will pass on day one and prove nothing. If the test never went red, it never tested.

---

## Adding a chain

Each test asserts that **identity and truth survive a hop**:

| Chain | Assertion |
|---|---|
| capability → market | derived market contains the company's actual NAICS |
| report → contractor | every emitted name resolves when passed back in |
| contractor → awards | a firm with awards returns awards |
| market → depth | depth is consistent with the award population |
| notice → vehicle | a claimed link has stated evidence and confidence |

## What NOT to do

- Do not add more `expect(src).toContain(...)` tests. They cannot satisfy a behavioural
  acceptance criterion.
- Existing source-text tests **stay** — they are useful as *architectural guards* ("this
  defensive constant still exists"). They are not regression tests and must not be counted as
  behavioural coverage.
