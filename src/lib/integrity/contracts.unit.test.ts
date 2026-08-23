import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canDefendClaim, renderResult, ALL_MEASUREMENT_PROPERTIES } from './contracts';
import { FAILURE_CLASSES } from './failure-classes';

/**
 * PHASE 1 of Integrity OS is bounded by ONE hard constraint (Eric, 2026-08-23):
 *
 *   "Do not invent new integrity concepts. Every Phase 1 contract must trace directly to one
 *    or more of the 11 production failure classes discovered in the completed audit."
 *
 * These tests enforce that MECHANICALLY, not by review — otherwise the file drifts into
 * architecture astronautics the moment someone adds a concept that felt sensible. And every
 * behavioural test below reproduces a REAL incident, so the rules cannot be softened without
 * un-fixing a bug that actually shipped.
 */

const SRC = readFileSync(join(__dirname, 'contracts.ts'), 'utf8');

describe('the hard constraint: no invented concepts', () => {
  it('cites only INT-### ids that exist in the failure registry', () => {
    const cited = new Set(SRC.match(/INT-\d{3}/g) ?? []);
    const known = new Set(FAILURE_CLASSES.map((c) => c.id));
    expect(cited.size).toBeGreaterThan(0);
    for (const id of cited) {
      expect(known.has(id as `INT-${string}`), `${id} is cited but not in the registry`).toBe(true);
    }
  });

  it('every exported type traces to at least one class in its own doc comment', () => {
    // Each `export type X` must have an INT-### somewhere in the comment block above it.
    const blocks = SRC.split(/\nexport (?:type|interface|function) /).slice(0, -1);
    for (let i = 1; i < blocks.length; i++) {
      const preceding = blocks[i - 1];
      expect(
        /INT-\d{3}/.test(preceding),
        `an exported member has no INT-### traceability in its doc comment:\n${preceding.slice(-160)}`,
      ).toBe(true);
    }
  });

  it('does NOT introduce a score — a composite hides the uncertainty it should surface', () => {
    expect(SRC).not.toMatch(/integrityScore|healthScore|\bscore\s*[:=]/i);
  });
});

describe('INT-003 / INT-002 — no source ≠ zero, unknown is not a number', () => {
  it('refuses a claim whose source could not be established', () => {
    const r = canDefendClaim('coverage', { source: 'unavailable', population: 'complete', result: 'known' });
    expect(r.ok).toBe(false);
    expect(r.classId).toBe('INT-003');
  });

  it('renders an unavailable source as text, NEVER as 0', () => {
    // The real incident: forecasts?mode=coverage reported "0 sources / 80% gap" from a table
    // that does not exist. The real figures were 11 sources / 94.5%.
    const out = renderResult('unavailable', 'known', 0);
    expect(out).not.toBe('0');
    expect(out).toMatch(/unavailable/);
  });

  it('distinguishes a measured zero from an unknown', () => {
    expect(renderResult('established', 'measured_zero', 0)).toBe('0');
    expect(renderResult('established', 'unknown', null)).toBe('unknown');
    expect(canDefendClaim('measurement', { source: 'established', population: 'complete', result: 'unknown' }).classId)
      .toBe('INT-002');
  });
});

describe('INT-001 / INT-007 — a truncated read is not a population', () => {
  it('refuses a population claim built on a truncated read', () => {
    // user-breakdown reported 1,000 users when the truth was 10,667.
    const r = canDefendClaim('measurement', { source: 'established', population: 'truncated', result: 'known' });
    expect(r.ok).toBe(false);
    expect(r.classId).toBe('INT-001');
  });

  it('refuses a bounded display read as backing for a total', () => {
    expect(canDefendClaim('coverage', { source: 'established', population: 'bounded', result: 'known' }).ok).toBe(false);
  });

  it('allows a complete read', () => {
    expect(canDefendClaim('measurement', { source: 'established', population: 'complete', result: 'known' }).ok).toBe(true);
  });
});

describe('INT-010 — partial data corrupts ORDERING even when no count is shown', () => {
  it('refuses a ranking computed over a partial population', () => {
    // target-market-research ranked agencies from 6.6% of open notices.
    const r = canDefendClaim('ordering', {
      source: 'established', population: 'truncated', result: 'known', ordering: 'ranked_over_partial',
    });
    expect(r.ok).toBe(false);
  });

  it('catches it even when the population field alone would have passed', () => {
    // The subtle case: someone marks the population "sampled" but still ranks over it.
    const r = canDefendClaim('ordering', {
      source: 'established', population: 'sampled', result: 'known', ordering: 'ranked_over_partial',
    });
    expect(r.ok).toBe(false);
    expect(r.classId).toBe('INT-010');
  });
});

describe('INT-006 — no execution ≠ success', () => {
  it('refuses a no_op as success', () => {
    // planner/weekly-digest skipped EVERY user and returned success:true.
    const r = canDefendClaim('execution', {
      source: 'established', population: 'complete', result: 'known', execution: 'no_op',
    });
    expect(r.ok).toBe(false);
    expect(r.classId).toBe('INT-006');
  });

  it('accepts only evidence of the intended effect', () => {
    for (const state of ['no_op', 'partial', 'blocked', 'failed'] as const) {
      expect(canDefendClaim('execution', {
        source: 'established', population: 'complete', result: 'known', execution: state,
      }).ok, state).toBe(false);
    }
    expect(canDefendClaim('execution', {
      source: 'established', population: 'complete', result: 'known', execution: 'succeeded',
    }).ok).toBe(true);
  });
});

describe('INT-005 — a capped receipt is not an affected-row count', () => {
  it('refuses a mutation claim derived from a RETURNING payload', () => {
    // The recompete prune counted a payload capped at 1,000 over 137,186 candidates.
    const r = canDefendClaim('mutation', {
      source: 'established', population: 'complete', result: 'known', mutation: 'payload_derived',
    });
    expect(r.ok).toBe(false);
    expect(r.classId).toBe('INT-005');
  });

  it('accepts an exact affected-row count', () => {
    expect(canDefendClaim('mutation', {
      source: 'established', population: 'complete', result: 'known', mutation: 'exact_count',
    }).ok).toBe(true);
  });
});

describe('INT-011 — a permanently unreachable segment invalidates an audience claim', () => {
  it('refuses an audience claim when part of it can never be reached', () => {
    // weekly-alerts: ~1,028 users never queued on ANY cycle; re-running does not help.
    const r = canDefendClaim('population', {
      source: 'established', population: 'complete', result: 'known', reachability: 'segment_unreachable',
    });
    expect(r.ok).toBe(false);
    expect(r.classId).toBe('INT-011');
  });
});

describe('the four measurement properties are still the ones the audit used', () => {
  it('has exactly runs / complete / current / honest', () => {
    expect([...ALL_MEASUREMENT_PROPERTIES].sort()).toEqual(['complete', 'current', 'honest', 'runs']);
  });
});
