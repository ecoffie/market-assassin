import { describe, it, expect } from 'vitest';
import {
  classifyAdvancement,
  ADVANCEMENT_ORACLES,
  type AdvancementOracle,
} from './advancement';

const NOW = '2026-09-12T12:00:00.000Z';
const oracle = (over: Partial<AdvancementOracle> = {}): AdvancementOracle => ({
  key: 'test_ds',
  table: 'test_table',
  column: 'posted_date',
  kind: 'source_date',
  staleDays: 3,
  rationale: 'test',
  ...over,
});

describe('C1 advancement — healthy', () => {
  it('a currently advancing dataset is healthy (real sam_opportunities shape)', () => {
    const r = classifyAdvancement({ oracle: oracle(), observed: '2026-09-12', now: NOW });
    expect(r.status).toBe('healthy');
    expect(r.dataAgeDays).toBe(0);
  });

  it('advancement within budget stays healthy', () => {
    const r = classifyAdvancement({ oracle: oracle(), observed: '2026-09-10', now: NOW });
    expect(r.status).toBe('healthy');
  });
});

describe('C1 advancement — THE INVARIANT: job success is not data advancement', () => {
  it('a cron-success fixture with non-advancing data does NOT return healthy', () => {
    const r = classifyAdvancement({
      oracle: oracle(),
      observed: '2026-06-01',        // data frozen for months
      lastBuilt: '2026-09-12',        // job ran today
      jobReportedSuccess: true,       // and reported 200
      now: NOW,
    });
    expect(r.status).not.toBe('healthy');
    expect(r.detail).toContain('not treated as advancement');
  });

  it('jobReportedSuccess can never upgrade a stale dataset', () => {
    const withJob = classifyAdvancement({
      oracle: oracle(), observed: '2026-01-01', jobReportedSuccess: true, now: NOW,
    });
    const withoutJob = classifyAdvancement({
      oracle: oracle(), observed: '2026-01-01', jobReportedSuccess: false, now: NOW,
    });
    expect(withJob.status).toBe(withoutJob.status);
  });

  it('a recent run over frozen data reports BOTH the stale data and the ahead stamp', () => {
    // NOTE: this expectation was corrected during implementation. The original
    // asserted `ingest_broken`, but a recent stamp over frozen data IS the
    // stamp-ahead shape — the two conditions are the same input, not rivals.
    // The control reports the claim defect as the status (it is why a human
    // believed the data was fresh) and keeps the stale fact in the detail line.
    const r = classifyAdvancement({
      oracle: oracle(), observed: '2026-06-01', lastBuilt: '2026-09-11', now: NOW,
    });
    expect(r.status).toBe('stamp_ahead');
    expect(r.stampAhead).toBe(true);
    expect(r.detail).toContain('the data is ALSO');   // stale fact not lost
    expect(r.dataAgeDays).toBeGreaterThan(oracle().staleDays);
  });

  it('stale data with a stamp that does NOT overclaim is ingest_broken', () => {
    // Stamp and data agree (both old) -> no claim defect, just a dead pipeline.
    const r = classifyAdvancement({
      oracle: oracle(), observed: '2026-06-01', lastBuilt: '2026-06-01', now: NOW,
    });
    expect(r.status).toBe('upstream_stale');
    expect(r.stampAhead).toBe(false);
  });

  it('frozen data with no recent run is upstream_stale', () => {
    const r = classifyAdvancement({ oracle: oracle(), observed: '2026-06-01', now: NOW });
    expect(r.status).toBe('upstream_stale');
  });
});

describe('C1 advancement — UNKNOWN IS NEVER STALE', () => {
  it('an unreadable oracle returns unmeasured, not stale', () => {
    const r = classifyAdvancement({ oracle: oracle(), observed: null, now: NOW });
    expect(r.status).toBe('unmeasured');
    expect(r.detail).toContain('NOT stale');
  });

  it('an unparseable value returns unmeasured, not stale', () => {
    const r = classifyAdvancement({ oracle: oracle(), observed: 'not-a-date', now: NOW });
    expect(r.status).toBe('unmeasured');
  });

  it('unmeasured reports null ages rather than zero (no fabrication)', () => {
    const r = classifyAdvancement({ oracle: oracle(), observed: null, now: NOW });
    expect(r.dataAgeDays).toBeNull();
    expect(r.stampAheadDays).toBeNull();
  });
});

describe('C1 advancement — stamp_ahead (the agency_pain_points census defect)', () => {
  it('reproduces the real shape: stamp 2026-08-01, newest row 2026-04-19', () => {
    const r = classifyAdvancement({
      oracle: oracle({ key: 'agency_pain_points', table: 'agency_intelligence', column: 'created_at', staleDays: 120 }),
      observed: '2026-04-19',
      lastBuilt: '2026-08-01',
      now: NOW,
    });
    expect(r.status).toBe('stamp_ahead');
    expect(r.stampAhead).toBe(true);
    expect(r.stampAheadDays).toBe(104);
    expect(r.detail).toContain('AHEAD of the data');
    // The real row is ALSO past its own budget (146d vs 120d). Both findings survive.
    expect(r.dataAgeDays).toBe(146);
    expect(r.detail).toContain('the data is ALSO 146d old');
  });

  it('a stamp matching the data is NOT flagged (the bq_awards good shape)', () => {
    const r = classifyAdvancement({
      oracle: oracle(), observed: '2026-09-11', lastBuilt: '2026-09-11', now: NOW,
    });
    expect(r.status).toBe('healthy');
  });

  it('small skew within tolerance is not a finding', () => {
    const r = classifyAdvancement({
      oracle: oracle(), observed: '2026-09-10', lastBuilt: '2026-09-11', now: NOW,
    });
    expect(r.status).toBe('healthy');
  });
});

describe('C1 oracle registry — census-justified scope only', () => {
  it('covers exactly the three datasets the controls plan justified', () => {
    expect(ADVANCEMENT_ORACLES.map((o) => o.key).sort())
      .toEqual(['agency_pain_points', 'recompete_opportunities', 'sam_opportunities']);
  });

  it('excludes the deliberately deprioritized datasets', () => {
    const keys = ADVANCEMENT_ORACLES.map((o) => o.key);
    for (const excluded of ['alert_log', 'briefing_log', 'user_engagement', 'sam_entities']) {
      expect(keys).not.toContain(excluded);
    }
  });

  it('every oracle states WHY its column is the right one (no blind created_at)', () => {
    for (const o of ADVANCEMENT_ORACLES) {
      expect(o.rationale.length).toBeGreaterThan(40);
    }
  });

  it('recompete does not use the future-dated PoP-end column', () => {
    const rec = ADVANCEMENT_ORACLES.find((o) => o.key === 'recompete_opportunities')!;
    expect(rec.column).not.toBe('period_of_performance_current_end');
    expect(rec.rationale).toContain('2032');
  });
});
