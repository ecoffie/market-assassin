# POTETO — Credit Integrity ✓

**INPUT → VALIDATE → METER → EXECUTE → OUTCOME → CHARGE** · surface: every priced MCP tool (via `runMeteredTool`); gold masters `build_pursuit_dossier`, `generate_market_report`
Merged PR #1631 (head `d21863a2`, merge `2574fe8d`) and PR #1632 (head `473a2c72`, merge `3af16007`). Production deployment `dpl_gUKu35dKtk2xcr7VTQQWrK41qK34` serving `getmindy.ai` / `mcp.getmindy.ai` at `3af16007` (build-stamp verified). Verified 2026-09-22 on the synthetic account `credit-integrity-acceptance@getmindy.ai`, not customer credits. **FROZEN.**

## The invariant

| outcome | charge |
|---|---|
| **INVALID** — the paid job cannot be attempted (required identity absent) | **0**, tool never runs |
| **FAILURE** — Mindy's required measurement / lookup did not complete | **0** |
| **EMPTY** — the research completed and established no evidence | **CHARGE** |
| **SUCCESS** — the deliverable was produced | **CHARGE** |

**Empty is knowledge. Failure is unknown.** Zero rows is a paid answer; a timeout is not zero; an invalid request is not a valid no-match.

## Production before
- `build_pursuit_dossier` called with `solicitation=` (not a schema key): the SDK's zod parse stripped it, the tool returned an empty miss in **1 ms**, the ledger recorded **−100** (2026-09-22T17:04:56.985Z, balance 42,403 → 42,303), and the call log said `success`. It was the only sub-50 ms charge among all 55 charged dossier calls, and it was Eric's. No customer was affected.
- `generate_market_report` `measurement_failure` was billed whenever any optional section grounded (`_meta.grounded=true` → DEFECT-7's `degraded && !grounded` did not fire).
- Found during hosted verification of #1631: a genuinely empty keyword market (`insufficient_evidence`, `sections_failed=[]`, 0 grounded) was charged **0**, because `coverage === null` was counted as `degraded`.

## Root causes → fixes
- **Metering already debits AFTER execution, in one atomic RPC** (`mcp_debit_credits`). Nothing is reserved up front, so there is no refund or compensating credit and nothing can be restored twice. Both PRs change only *whether* that one debit happens.
- **Invalid input (#1631):** `preflightPaidInput` checks the identity sets declared in `REQUIRED_ONE_OF` (`build_pursuit_dossier` → `solicitation_number` | `notice_id`) before the tool gate, the paywall capture and the payer lookup. It returns `invalid_input` and logs `rejected_invalid_input`. This is a declared rule, not special handling for the word `solicitation`. No alias was added.
- **Structured outcome (#1631):** `classifyBillingOutcome` reads `_meta.billing_outcome` (and never the prose) before the debit. DEFECT-7 is preserved as the fallback.
- **Empty vs failed (#1632), fixed at each layer where the two collapsed:**
  - `market-report`: `degraded` means `requiredMeasurement.status === 'failed'`, and `billing_outcome` is an explicit function of `publication_state` (`publish` → success, `insufficient_evidence` → no_result, `measurement_failure` → nonbillable).
  - `codeMarketSize({ strict: true })`, the NAICS-axis required measurement, throws on an HTTP error, network error or malformed body instead of returning null. Lenient callers (`micc/mrr`, lead injection) are unchanged.
  - `mapKeywordCoverageBqRow` throws on a missing or non-numeric `transaction_count` instead of coercing it to a measured zero.
  - `build_pursuit_dossier`: a lookup that throws **or reports `_meta.degraded`** is a system failure, not "no such notice".

## Production after (hosted MCP, merge `3af16007`)
| class | case | result |
|---|---|---|
| INVALID | dossier, no recognized identity (×3 incl. 2 repeats) | 0 each, `invalid_input`, `rejected_invalid_input`, tool not executed |
| EMPTY | keyword `qzxv hovercraft ballast widget` | `insufficient_evidence`, no URL, `degraded:false`, `billable_no_result`, **100** |
| EMPTY | NAICS `112112` (real code; zero FY2025 contract awards per USASpending) | `insufficient_evidence`, no URL, `sections_failed:[]`, **100** |
| EMPTY | dossier lookup completes, no notice | `grounded:false`, `degraded:false`, **100** |
| SUCCESS | `drones` report | `publish`, share URL minted, **100** |
| SUCCESS | dossier `36C24226Q0857` | grounded, package-named CO (Spivack) present, no incumbent named, **100** |
| — | concurrency: 4 billable calls against 200 | exactly 200 charged, end 0, never negative |
| — | ledger | only positive row = the 700 `admin_grant`; 7 debits, all `tool_call` −100; **0 + 700 − 700 = 0** |

**FAILURE states cannot be forced on the hosted surface** without a fault hook, and none was added. They were proven at merge `3af16007` with the hermetic suite (the real tools, upstreams injected, through the real `runMeteredTool`) and the live-ledger leg (real `mcp_debit_credits` / ledger / call log, synthetic account): required keyword failure, required NAICS failure (strict), and a dossier lookup that throws or reports degraded were each **0**; replays **0**; concurrent drain 400 → 0.

Locks at `3af16007`: 644/644 across Credit Integrity, P2, P3, journey, Market Report Presentation Truth, resilience, Incumbent Evidence Truth, package-named contacts, metering and commercial refusal. Full suite before merge: 7,014 passed.

## Locks
- `src/lib/mcp/credit-integrity.unit.test.ts` — 4 gold-master tests fail if `metered.ts` is reverted (#1631); 11 empty-vs-failed tests fail if the 4 source files are reverted (#1632).
- `src/lib/market/empty-vs-failed-coverage.unit.test.ts` — malformed BQ count; `codeMarketSize` strict vs lenient.
- `src/lib/mcp/credit-integrity.live.test.ts` — opt-in `CREDIT_INTEGRITY_LIVE=1`, writes only to the synthetic account and drains it to 0.
- `src/lib/sam/entity-failover.unit.test.ts` — the DEFECT-7 source lock, repointed to the rule's new home in `credit-integrity.ts`.

## Notes
- The hosted transport grants the one-time `signup_grant` (+100) on an account's **first** MCP call. During the first hosted run this looked like an invalid call had credited 100. It hadn't: that call has no ledger row. Reconcile against ledger `reason`, never balance deltas alone.
- The "building construction and renovation" thin-market fixture now **publishes** in production; use a genuinely empty keyword or `112112` for EMPTY.
- Tool prices unchanged (dossier 100, market report 100).

## Deliberately unresolved (not this Poteto)
- **1-character keyword:** returns `NO_MATCHES_MEASURED` and bills as `insufficient_evidence`. This is a separate input-quality question; the tool declares no minimum.
- **Other `solicitation_number` / `notice_id` tools** (proposal / documents) are not in `REQUIRED_ONE_OF`. Each needs proof that it can do no useful work without the identity.
- **No historical refunds.** The only invalid-input charge found was Eric's own.
