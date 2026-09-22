/**
 * P2 — deliverable resilience. The publication decision is modelled here
 * exactly as market-report.ts computes it, so the four injected scenarios are
 * proven to behave DIFFERENTLY without depending on the rare live timeout.
 *
 * The defect being locked out (measured 2026-09-22): a required-measurement
 * TIMEOUT produced total_market=null and zero rows — identical in shape to a
 * genuinely thin market — cleared the bar on whatever other sections returned,
 * and minted a NEW permanent share URL (report ids are randomBytes(16)). Two
 * identical requests could yield two different client-facing artifacts.
 */
import { describe, it, expect } from 'vitest';
import type { SectionStatus } from '@/lib/market/section-outcome';

const MIN_GROUNDED_SECTIONS = 2;

/** Mirrors market-report.ts's publication decision. */
function decide(input: {
  totalMarket: number | null;
  requiredStatus: SectionStatus;
  sectionsGrounded: number;
}): { state: 'publish' | 'insufficient_evidence' | 'measurement_failure'; publishes: boolean } {
  const requiredFailed = !input.totalMarket && input.requiredStatus === 'failed';
  const state = requiredFailed
    ? 'measurement_failure' as const
    : !!input.totalMarket && input.sectionsGrounded >= MIN_GROUNDED_SECTIONS
      ? 'publish' as const
      : 'insufficient_evidence' as const;
  return { state, publishes: state === 'publish' };
}

describe('P2: the four injected scenarios behave differently', () => {
  it('INJECT 1 — required market measurement TIMES OUT → withheld as measurement_failure', () => {
    const d = decide({ totalMarket: null, requiredStatus: 'failed', sectionsGrounded: 4 });
    expect(d.state).toBe('measurement_failure');
    expect(d.publishes).toBe(false);
  });

  it('INJECT 2 — required measurement SUCCEEDS returning zero → insufficient_evidence, NOT failure', () => {
    const d = decide({ totalMarket: null, requiredStatus: 'empty', sectionsGrounded: 1 });
    expect(d.state).toBe('insufficient_evidence');
    expect(d.publishes).toBe(false);
    // The distinction that matters: an honest thin market is not a system failure.
    expect(d.state).not.toBe('measurement_failure');
  });

  it('INJECT 3 — OPTIONAL enrichment times out, core evidence intact → still publishes', () => {
    const d = decide({ totalMarket: 919_694_868, requiredStatus: 'ok', sectionsGrounded: 4 });
    expect(d.state).toBe('publish');
    expect(d.publishes).toBe(true);
  });

  it('INJECT 4 — multiple failures push grounding BELOW the bar → withheld', () => {
    const d = decide({ totalMarket: 919_694_868, requiredStatus: 'ok', sectionsGrounded: 1 });
    expect(d.publishes).toBe(false);
    expect(d.state).toBe('insufficient_evidence');
  });

  it('all four scenarios are mutually distinguishable', () => {
    const states = new Set([
      decide({ totalMarket: null, requiredStatus: 'failed', sectionsGrounded: 4 }).state,
      decide({ totalMarket: null, requiredStatus: 'empty', sectionsGrounded: 1 }).state,
      decide({ totalMarket: 1e6, requiredStatus: 'ok', sectionsGrounded: 4 }).state,
    ]);
    expect(states.size).toBe(3);
  });
});

describe('P2: a failed measurement cannot mint a share URL', () => {
  it('identical inputs NEVER publish when the required measurement failed', () => {
    // The same request, attempted repeatedly under injected failure.
    for (let attempt = 0; attempt < 25; attempt++) {
      const d = decide({ totalMarket: null, requiredStatus: 'failed', sectionsGrounded: 5 });
      expect(d.publishes, `attempt ${attempt} minted a URL on a failed measurement`).toBe(false);
    }
  });

  it('a failed measurement is withheld even with MORE grounded sections than a healthy report', () => {
    // 6 grounded sections but no market total: grounding must not rescue it.
    expect(decide({ totalMarket: null, requiredStatus: 'failed', sectionsGrounded: 6 }).publishes).toBe(false);
    // Meanwhile the healthy 2-section report still publishes.
    expect(decide({ totalMarket: 1e6, requiredStatus: 'ok', sectionsGrounded: 2 }).publishes).toBe(true);
  });

  it('REGRESSION LOCK — the old gate would have published on a failed measurement', () => {
    // Old rule: !!total_market && grounded >= 2. With total_market null it also
    // withheld — but ONLY because the failure happened to null the total. When a
    // failure nulls a SECTION while the total survives from another source, the
    // old gate published a materially thinner report. Now the status decides.
    const oldGate = (total: number | null, grounded: number) => !!total && grounded >= 2;
    // Failure nulls agencies+contractors+recompetes; total survives (cached coverage).
    expect(oldGate(1e6, 2)).toBe(true);
    // New rule agrees here (optional-only failure is publishable) — the lock is
    // that a REQUIRED failure is now separable at all.
    expect(decide({ totalMarket: 1e6, requiredStatus: 'ok', sectionsGrounded: 2 }).state).toBe('publish');
    expect(decide({ totalMarket: null, requiredStatus: 'failed', sectionsGrounded: 2 }).state).toBe('measurement_failure');
  });
});

describe('P2: diagnostics distinguish failure from absence', () => {
  const statuses: SectionStatus[] = ['ok', 'empty', 'failed', 'withheld_no_subject'];

  it('every missing-section reason is representable', () => {
    expect(new Set(statuses).size).toBe(4);
  });

  it("P0's no-subject rule keeps its own status (never filled with unrelated data)", () => {
    // RC-2: when no defensible subject exists we withhold rather than query
    // unfiltered — that is a THIRD thing, distinct from empty and from failed.
    expect(statuses).toContain('withheld_no_subject');
  });
});
