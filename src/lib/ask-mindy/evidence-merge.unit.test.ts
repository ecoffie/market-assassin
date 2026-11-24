import { describe, it, expect } from 'vitest';
import { mergeStateEvidence } from './evidence-merge';
import type { MarketReportResult } from '@/mcp/tools/market-report';

const ev = (state: string, recs: Array<{ contract_id: string }>, agencies: Array<{ name: string; amount: number }>, pub = 'publish') => ({
  subject: 'x', generated_for: null, basis: null, reconciliation: null,
  summary: { total_market: 100, total_market_basis: { state_scoped: false, requested_state: state } },
  sections: {
    market_size: null, top_agencies: agencies, top_agencies_total: agencies.length,
    competition: { contractors: [{ recipient_uei: 'U1', recipient_name: 'Acme', total_obligated: 5 }], count: 1 },
    recompetes: { contracts: recs, count: recs.length }, forecasts: { forecasts: [], count: 0 },
    contacts: { people: [{ office_code: 'A1', name: 'P', email: 'e' }], office_codes: ['A1'] }, agency_detail: null, set_aside_gap: null,
  },
  deliverable: { html: '', url: null, report_id: null },
  _meta: { publication_state: pub },
}) as unknown as MarketReportResult;

describe('mergeStateEvidence', () => {
  const m = mergeStateEvidence([
    ev('VA', [{ contract_id: 'c1' }, { contract_id: 'c2' }], [{ name: 'DOT', amount: 10 }]),
    ev('MD', [{ contract_id: 'c2' }, { contract_id: 'c3' }], [{ name: 'DOT', amount: 5 }, { name: 'NAVY', amount: 20 }]),
  ], ['VA', 'MD']);
  it('dedupes contracts across states', () => {
    expect((m.sections.recompetes.contracts as Array<{ contract_id: string }>).map((r) => r.contract_id)).toEqual(['c1', 'c2', 'c3']);
  });
  it('sums agencies and competitors and re-ranks', () => {
    expect(m.sections.top_agencies).toEqual([{ name: 'NAVY', amount: 20 }, { name: 'DOT', amount: 15 }]);
    expect((m.sections.competition.contractors as Array<{ total_obligated: number }>)[0].total_obligated).toBe(10);
  });
  it('dedupes contacts and names every requested state on the headline basis', () => {
    expect((m.sections.contacts as unknown as { people: unknown[] }).people).toHaveLength(1);
    expect((m.summary.total_market_basis as { requested_state: string }).requested_state).toBe('VA, MD');
  });
  it('ignores a state whose measurement failed; all failed returns the failure', () => {
    const onlyMd = mergeStateEvidence([ev('VA', [{ contract_id: 'v' }], [], 'measurement_failure'), ev('MD', [{ contract_id: 'm' }], [])], ['VA', 'MD']);
    expect((onlyMd.sections.recompetes.contracts as Array<{ contract_id: string }>).map((r) => r.contract_id)).toEqual(['m']);
    expect(mergeStateEvidence([ev('VA', [], [], 'measurement_failure'), ev('MD', [], [], 'measurement_failure')], ['VA', 'MD'])._meta.publication_state).toBe('measurement_failure');
  });
});
