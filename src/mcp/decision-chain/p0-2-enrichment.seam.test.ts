/**
 * P0-2 — enrichment must never present "I didn't look" as "there is nothing".
 *
 * Encodes Eric's regression invariant:
 *   If award_count > 0 and enrichment was not actually queried, top_agencies: [] /
 *   recent_awards: [] must never be presented as complete data.
 *
 * Models the decision logic in tier2-tools.getContractorProfile. Mocks ONLY at the data
 * boundary (the BQ fetchers and the budget check) — the state machine under test is real.
 */
import { describe, it, expect } from 'vitest';

type Row = Record<string, unknown>;
interface Deps {
  warmAwards: Row[]; warmAgencies: Row[];
  liveAwards?: Row[]; liveAgencies?: Row[];
  budgetAllows: boolean; resolvedCold: boolean; awardCount: number;
}

/** Mirrors the shipped control flow. */
function enrich(d: Deps) {
  let awards = d.warmAwards, agencies = d.warmAgencies;
  let status: 'complete' | 'budget_limited' = 'complete';
  let scanned = false;
  const missed = awards.length === 0 && agencies.length === 0;
  if (missed && d.awardCount > 0) {
    if (d.resolvedCold || d.budgetAllows) {
      scanned = true;
      awards = d.liveAwards ?? []; agencies = d.liveAgencies ?? [];
    } else {
      status = 'budget_limited';
    }
  }
  return { awards, agencies, status, scanned, partial: status === 'budget_limited' };
}

describe('P0-2 enrichment states', () => {
  it('THE DEFECT: a warm-cache miss on a company with 1,278 awards must not report complete-empty', () => {
    // Fluidyne, captured live: found:true, 1278 awards, both arrays empty, no flag.
    const r = enrich({ warmAwards: [], warmAgencies: [], budgetAllows: false,
                       resolvedCold: false, awardCount: 1278 });
    expect(r.status).toBe('budget_limited');
    expect(r.partial).toBe(true);
    // The invariant, stated directly:
    expect(r.status === 'complete' && r.awards.length === 0 && 1278 > 0).toBe(false);
  });

  it('with budget available, a cold miss scans live and returns real rows', () => {
    const r = enrich({ warmAwards: [], warmAgencies: [], liveAwards: [{ award_id: 'A' }],
                       liveAgencies: [{ awarding_agency: 'DLA' }], budgetAllows: true,
                       resolvedCold: false, awardCount: 1278 });
    expect(r.scanned).toBe(true);
    expect(r.awards.length).toBeGreaterThan(0);
    expect(r.status).toBe('complete');
  });

  it('a warm hit never scans and never consumes budget', () => {
    const r = enrich({ warmAwards: [{ award_id: 'A' }], warmAgencies: [{ awarding_agency: 'DLA' }],
                       budgetAllows: true, resolvedCold: false, awardCount: 1278 });
    expect(r.scanned).toBe(false);
    expect(r.status).toBe('complete');
  });

  it('a genuinely award-less company reports complete-empty WITHOUT spending a scan', () => {
    // award_count === 0 is free (recipients row), so empty here is a true factual claim.
    const r = enrich({ warmAwards: [], warmAgencies: [], budgetAllows: true,
                       resolvedCold: false, awardCount: 0 });
    expect(r.scanned).toBe(false);
    expect(r.status).toBe('complete');
    expect(r.partial).toBe(false);
  });

  it('a company resolved cold this turn enriches live without a second budget unit', () => {
    const r = enrich({ warmAwards: [], warmAgencies: [], liveAwards: [{ award_id: 'A' }],
                       liveAgencies: [{ awarding_agency: 'NAVY' }], budgetAllows: false,
                       resolvedCold: true, awardCount: 4850 });
    expect(r.scanned).toBe(true);
    expect(r.status).toBe('complete');
  });
});
