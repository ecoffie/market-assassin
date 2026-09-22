# P2 — deliverable resilience under transient upstream failure

Branch `fix/p2-deliverable-resilience`, from `8ceae74c`.

## Root cause

`guard()` collapsed a TIMEOUT and a genuinely empty result into the same shape,
and the grounding count tested only truthiness:

| | rows | groundedFlag | degraded |
|---|---|---|---|
| transient timeout | 0 | `false` | `true` |
| genuinely empty | 0 | `false` | `false` |

The only distinguishing signal was `_meta.degraded`, and `deliverableWorthy`
never consulted it. Because report ids are `randomBytes(16)`, a degraded run
published a **materially thinner answer at a NEW permanent share URL** — two
identical requests could yield two different client-facing artifacts, with
nothing on the page saying which was complete.

## Measured failure domain (investigation, no code changed)

54/54 controlled runs stable — **0 reproductions**, so the rate is <2%
(95% CI upper ≈ 5.5%). Latency p50 ≈ 10–11s, p90 ≈ 12.8s, max 14.5s against a
25s per-query budget. The failure is real but rare; the DANGER was its
indistinguishability, not its frequency.

## Required vs optional — derived from the report contract

`summary.total_market` is fed by `dominantSize ?? coverage ?? marketSize`, and
every other section is an attribute OF that market (who buys it, who holds it,
what recompetes, what is forecast). So:

- **REQUIRED**: the measurement behind `summary.total_market`. Without it the
  report has no subject. Its FAILURE withholds the deliverable.
- **OPTIONAL**: top_agencies · competition · recompetes · forecasts ·
  agency_detail · sba_goaling. Their failure may still publish, but only while
  the report clears the existing evidence bar, and their `failed` state is
  retained in the structured result.

## Publication is state-aware

| state | condition | publishes |
|---|---|---|
| `publish` | required ok + grounding ≥ 2 | yes |
| `insufficient_evidence` | required ok but thin | no |
| `measurement_failure` | **required FAILED — market UNKNOWN** | no |

## Not done, deliberately

**No retries.** The investigation measured 0 failures in 54 runs; adding latency
to every request to solve an unmeasured benefit is the wrong trade. Make
failures honest first, then measure whether a retry pays.

## ⚠️ Credits — observation only, no change in this PR

An incomplete execution **can still consume credits**: billing happens at the
transport (`runMeteredTool`) on tool success, independent of
`publication_state`. A run that withholds the deliverable for
`measurement_failure` therefore charges the caller for a report they cannot
share. That is a **commercial contract question** (refund? no-charge on
required-failure? credit-back?), not a code cleanup, and it needs a separate
decision. Recorded here so it is not lost.
