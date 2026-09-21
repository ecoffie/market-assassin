/**
 * INTEGRITY OS — PHASE 1: from incident taxonomy to enforced contracts.
 *
 * ⚠️ HARD CONSTRAINT (Eric, 2026-08-23): "Do not invent new integrity concepts. Every Phase 1
 * contract must trace directly to one or more of the 11 production failure classes discovered
 * in the completed audit." Every type below carries the `INT-###` ids that justify it. If you
 * cannot name the class, the concept does not belong here — that is what keeps this from
 * becoming an architecture-astronaut project.
 *
 * An earlier draft of this file was written BEFORE the audit finished and deliberately
 * reverted for being ahead of the evidence. This version is written after: 118 locations
 * examined, 0 unresolved, 11 observed classes.
 *
 * MISSION: Mindy should never make a consequential claim without being able to establish the
 * evidence supporting it.
 *
 * NOT IN PHASE 1, on purpose: no score, no dashboard, no AI. Platform Health already renders
 * the surface; this is the enforcement layer underneath it.
 */

/**
 * SOURCE STATE — can we establish the underlying relation at all?
 *
 * Traces to INT-003 (missing relation masquerading as empty): a query against a table that
 * does not exist returns `count=null, HTTP 204, error=null` — NO error — so `|| 0` fabricated
 * "0 sources / 80% coverage gap" from a relation that was never there.
 * Also INT-004 (legacy classification): a source can exist and still no longer describe the
 * product, which is why `stale_semantics` is distinct from `unavailable`.
 */
export type SourceState =
  /** The relation exists, the query ran, and its shape still matches the product. */
  | 'established'
  /** The relation could not be established (missing table, dead endpoint). NEVER render as 0. */
  | 'unavailable'
  /** It ran, but its classification no longer matches how the product works today. */
  | 'stale_semantics';

/**
 * POPULATION STATE — what set of rows does this value actually describe?
 *
 * Traces to INT-001 (truncated list treated as population) and INT-007 (a monitor observing an
 * incomplete population). `truncated` and `complete` look IDENTICAL in a response body, which
 * is why the distinction must be carried explicitly rather than inferred.
 */
export type PopulationState =
  /** The whole population the predicate describes. Only this may be presented as a total. */
  | 'complete'
  /** A deliberate, documented subset (a display `.limit()`), with the reason recorded. */
  | 'bounded'
  /** A statistical sample — carries a margin of error; never stated as an exact figure. */
  | 'sampled'
  /** Known-incomplete: a cap was hit. MUST NOT be presented as a population. */
  | 'truncated';

/**
 * RESULT STATE — the difference between "measured as none" and "we could not tell".
 *
 * Traces to INT-002 (`null → 0` fabricated measurement): `count ?? 0` destroyed the only signal
 * separating *missing* from *empty* and recorded nine days of fake zeros.
 *
 * The rule this encodes: **no source ≠ zero**.
 */
export type ResultState =
  /** Measured against an established source. The value means what it says. */
  | 'known'
  /** Measured, and the answer genuinely is none. NOT the same as `unknown`. */
  | 'measured_zero'
  /** The query ran but we cannot vouch for the value. Render as "unknown", never a number. */
  | 'unknown';

/**
 * EXECUTION STATE — did the work actually happen?
 *
 * Traces to INT-006 (no work performed but operation reports success): `weekly-digest` skipped
 * EVERY user, because its table does not exist, and returned `success: true`.
 *
 * The rule this encodes: **no execution ≠ success**. `succeeded` requires evidence of the
 * intended effect, not merely the absence of an exception.
 */
export type ExecutionState =
  /** The intended effect happened AND we can point at evidence of it. */
  | 'succeeded'
  /** Ran without error but performed NO work. This is not a success. */
  | 'no_op'
  /** Did part of the intended work; the remainder is known-outstanding. */
  | 'partial'
  /** Could not run — a dependency (source, credential, migration) was unavailable. */
  | 'blocked'
  /** Ran and failed. The honest, easy case. */
  | 'failed';

/**
 * MUTATION IMPACT — how many rows a write actually affected.
 *
 * Traces to INT-005 (capped RETURNING payload treated as a write count): the UPDATE touches
 * every matching row, but `.select()` returns at most 1,000 of them, so counting the payload
 * under-reported a prune against a 137,186-row candidate set.
 */
export type MutationImpact =
  /** An exact affected-row count from the database (`{ count: 'exact' }`). Trustworthy. */
  | 'exact_count'
  /** Derived from a RETURNING payload that could be capped. NOT a reliable total. */
  | 'payload_derived'
  /** The write ran; the affected-row count is genuinely unknown. Say so. */
  | 'unknown';

/**
 * ORDERING INTEGRITY — is a ranking trustworthy?
 *
 * Traces to INT-010 (partial population corrupts ORDERING, not just counts). This is the class
 * that is invisible to every count-based check: `target-market-research` ranked agencies from
 * 6.6% of open notices. No population figure was displayed, so nothing looked wrong — but WHICH
 * AGENCY APPEARED FIRST was decided by whichever rows landed in the first page.
 */
export type OrderingIntegrity =
  /** Ranked over the complete population. Safe to present as "top N". */
  | 'ranked_over_complete'
  /** Ranked over a partial read — the ORDER may be wrong even if no count is shown. */
  | 'ranked_over_partial'
  /** Not an ordered claim. */
  | 'not_ordered';

/**
 * AUDIENCE REACHABILITY — can every intended recipient still be reached?
 *
 * Traces to INT-011 (truncation BEFORE batching = a permanently unreachable segment). Ordinary
 * truncation is fixed by running again; this is not. `weekly-alerts` (~1,028 users),
 * `send-alert-invite`, `grant-briefings-all` (~1,185) and `align-treatment-types` (~786) all
 * truncated the audience BEFORE filtering/batching, so the tail never reached the cursor.
 */
export type AudienceReachability =
  /** Every member of the intended audience can be reached across runs. */
  | 'fully_reachable'
  /** A segment is permanently unreachable — re-running does NOT help. */
  | 'segment_unreachable'
  /** Not an audience-processing operation. */
  | 'not_applicable';

/**
 * The four measurement properties. Pagination is ONE of them.
 * Traces to INT-001 (complete), INT-002 (honest), INT-003 (runs), INT-004 (current).
 */
export type MeasurementProperty = 'runs' | 'complete' | 'current' | 'honest';

export const ALL_MEASUREMENT_PROPERTIES: MeasurementProperty[] = [
  'runs', 'complete', 'current', 'honest',
];

/**
 * THE CLAIM — the core primitive.
 *
 * The audit found that these are all the same kind of object, differing only in shape:
 *   measurement ("10,667 users")   · absence ("0 sources")   · ordering ("top markets")
 *   population ("who gets this")   · execution ("job succeeded")
 *   coverage ("94.5%")             · mutation ("137,186 updated")
 *   eligibility ("these qualify")
 *
 * Each form is traceable to the incident that revealed it:
 *   measurement INT-001 (1,000 users vs 10,667) · absence INT-003 (0 sources vs 11)
 *   ordering    INT-010 (agencies ranked from 6.6% of notices)
 *   population/eligibility INT-011 (~1,028 users never queued on any cycle)
 *   execution   INT-006 (weekly-digest skipped everyone, reported success)
 *   coverage    INT-003 (94.5% reported as 0.0%)
 *   mutation    INT-005 (prune counted a capped RETURNING payload)
 */
export type ClaimKind =
  | 'measurement' | 'absence' | 'ordering' | 'population'
  | 'execution' | 'coverage' | 'mutation' | 'eligibility';

/**
 * The evidence carried alongside a claim. Optional fields appear only for the claim shapes
 * that need them: `execution` INT-006 · `mutation` INT-005 · `ordering` INT-010 ·
 * `reachability` INT-011. The three required fields cover INT-001/002/003.
 */
export interface ClaimEvidence {
  source: SourceState;
  population: PopulationState;
  result: ResultState;
  /** Present only on execution claims (INT-006). */
  execution?: ExecutionState;
  /** Present only on mutation claims (INT-005). */
  mutation?: MutationImpact;
  /** Present only on ordering claims (INT-010). */
  ordering?: OrderingIntegrity;
  /** Present only on audience-processing claims (INT-011). */
  reachability?: AudienceReachability;
}

/**
 * CAN THIS CLAIM BE DEFENDED? — the single question Integrity OS exists to answer.
 *
 * Every rule below is a class from the audit, not an opinion. A claim that fails any of them
 * must be rendered as unavailable/unknown, never as a plausible value.
 */
export function canDefendClaim(kind: ClaimKind, e: ClaimEvidence): { ok: boolean; reason?: string; classId?: string } {
  // INT-003 — no source ≠ zero.
  if (e.source === 'unavailable') {
    return { ok: false, reason: 'source could not be established', classId: 'INT-003' };
  }
  // INT-004 — it ran, but no longer describes the product.
  if (e.source === 'stale_semantics') {
    return { ok: false, reason: 'classification no longer matches the current product', classId: 'INT-004' };
  }
  // INT-002 — unknown is not a number.
  if (e.result === 'unknown') {
    return { ok: false, reason: 'result is unknown — must not render as a value', classId: 'INT-002' };
  }
  // INT-001 / INT-007 — a truncated read is not a population.
  if (e.population === 'truncated') {
    return { ok: false, reason: 'population is truncated — not a total', classId: 'INT-001' };
  }
  // A measurement/coverage/absence claim asserts something about a WHOLE population.
  if ((kind === 'measurement' || kind === 'coverage' || kind === 'absence') && e.population === 'bounded') {
    return { ok: false, reason: 'a bounded read cannot back a population claim', classId: 'INT-001' };
  }
  // INT-010 — a ranking over partial data is wrong even when no count is displayed.
  if (kind === 'ordering' && e.ordering === 'ranked_over_partial') {
    return { ok: false, reason: 'ranking computed over a partial population', classId: 'INT-010' };
  }
  // INT-006 — success requires evidence of the intended effect.
  if (kind === 'execution' && e.execution !== 'succeeded') {
    return { ok: false, reason: `execution state is "${e.execution}", not success`, classId: 'INT-006' };
  }
  // INT-005 — a capped receipt is not an affected-row count.
  if (kind === 'mutation' && e.mutation !== 'exact_count') {
    return { ok: false, reason: 'write impact not backed by an exact affected-row count', classId: 'INT-005' };
  }
  // INT-011 — an audience claim is false if part of the audience can never be reached.
  if ((kind === 'population' || kind === 'eligibility') && e.reachability === 'segment_unreachable') {
    return { ok: false, reason: 'a segment of the audience is permanently unreachable', classId: 'INT-011' };
  }
  return { ok: true };
}

/**
 * Render a result for humans. INT-002/INT-003: `unavailable` must never come out as "0", and
 * `unknown` must never come out as a number. A missing result is preferable to a misleading one.
 */
export function renderResult(source: SourceState, state: ResultState, value: number | null): string {
  if (source === 'unavailable') return 'unavailable — source could not be established';
  if (source === 'stale_semantics') return 'unavailable — measurement is out of date with the product';
  if (state === 'unknown' || value === null) return 'unknown';
  return String(value);
}
