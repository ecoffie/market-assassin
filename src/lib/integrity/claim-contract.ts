/**
 * INTEGRITY OS — PHASE 3: evidence travels with a consequential result.
 *
 * ⚠️ DELIBERATELY NARROW (Eric, 2026-08-23): "I would NOT put Claim Contracts underneath
 * ordinary feature-usage counters, page views, operational diagnostics, or every number in
 * Mindy. The 11/11 controls and Instrumentation Integrity are sufficient there unless evidence
 * proves otherwise."
 *
 * The test for adding a surface here is a strict one:
 *
 *   > Which decisions are consequential enough that the evidence must travel with the result?
 *
 * Only three classes qualify today: **government acquisition intelligence**, **Institute
 * research/publication claims**, and the handful of **executive product decisions** that
 * actually reallocate engineering resources. Phase 3 starts with the FIRST one, and with a
 * single claim inside it.
 *
 * WHY government acquisition first: a contractor acting on a wrong opportunity count loses a
 * day. A contracting officer citing a wrong supplier count in a Rule-of-Two determination has
 * made an acquisition decision on undefendable evidence. That is the highest bar Mindy faces,
 * so it is where evidence-carrying earns its complexity.
 */

/** What population the value describes (INT-001 / INT-007). */
export type ClaimPopulation = 'complete' | 'bounded' | 'sampled';

/** Whether the value was measured at all (INT-002 / INT-003). */
export type ClaimState = 'known' | 'measured_zero' | 'unknown' | 'unavailable';

/**
 * A consequential claim, carrying its own evidence.
 *
 * Every field exists because a specific failure class made its absence dangerous — this is not
 * a generic metadata envelope.
 */
export interface Claim<T = number> {
  /** The value itself. `null` whenever `state` is not known/measured_zero. */
  value: T | null;
  state: ClaimState;
  population: ClaimPopulation;
  /** Where the evidence came from, in words a government user can evaluate. */
  source: string;
  /** Exactly what set this describes — the PREDICATE, not the table (the audit's core lesson). */
  describes: string;
  /** ISO timestamp of measurement. A number with no age is not defensible. */
  measuredAt: string;
  /**
   * What this claim does NOT establish. Required, and non-empty for any government-facing
   * claim: the honest limits are the difference between intelligence and a guess.
   */
  limitations: string[];
  /** Present only for sampled claims. */
  sampleSize?: number;
  /** Methodology id when one governs (e.g. an OBS-### standard). */
  methodology?: string;
}

/** Build a claim that was genuinely measured. */
export function knownClaim<T>(value: T, meta: Omit<Claim<T>, 'value' | 'state'>): Claim<T> {
  return { ...meta, value, state: value === 0 ? 'measured_zero' : 'known' } as Claim<T>;
}

/**
 * Build a claim whose evidence could NOT be established.
 *
 * `value` is forced to null — INT-003: an unavailable source must never render as 0, and this
 * is the shape that makes rendering a number impossible rather than merely discouraged.
 */
export function unavailableClaim<T>(
  reason: string,
  meta: Pick<Claim<T>, 'source' | 'describes' | 'measuredAt'>,
): Claim<T> {
  return {
    ...meta,
    value: null,
    state: 'unavailable',
    population: 'complete',
    limitations: [reason],
  };
}

/**
 * May this claim be presented as a defensible figure?
 *
 * Mirrors `canDefendClaim` in contracts.ts, at the value level rather than the evidence level.
 */
export function isDefensible(c: Claim<unknown>): boolean {
  return (c.state === 'known' || c.state === 'measured_zero') && c.value !== null;
}

/**
 * The one-line answer to "Why does Mindy say this?" — the eventual external surface.
 *
 * Deliberately plain text: a government user should be able to read it without a legend.
 */
export function explainClaim(c: Claim<unknown>): string {
  if (!isDefensible(c)) {
    return `Unavailable — ${c.limitations[0] || 'supporting evidence could not be established'}.`;
  }
  const scope = c.population === 'sampled'
    ? `sampled (n=${c.sampleSize ?? '?'})`
    : c.population === 'bounded' ? 'bounded subset' : 'complete for the stated query';
  return [
    `${c.value} — ${c.describes}.`,
    `Source: ${c.source}. Population: ${scope}. Measured: ${c.measuredAt.slice(0, 10)}.`,
    c.methodology ? `Methodology: ${c.methodology}.` : '',
    c.limitations.length ? `Not established: ${c.limitations.join('; ')}.` : '',
  ].filter(Boolean).join(' ');
}
