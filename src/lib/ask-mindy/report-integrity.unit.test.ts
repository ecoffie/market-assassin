import { describe, it, expect } from 'vitest';
import { cleanReportForPublish, reportIntegrity, personTiedToRows } from './report-integrity';
import { checkRecords, type CandidateRecord } from './evidence-checks';
import type { CompetitionFacts } from '@/lib/opportunities/competition-facts';
import type { MarketReportResult } from '@/mcp/tools/market-report';
import fixture from './__fixtures__/fl-janitorial-recompetes-2026-11-24.json';

const checks = checkRecords(fixture.records as CandidateRecord[], fixture.scope, undefined, new Map(Object.entries(fixture.competition as Record<string, CompetitionFacts>)));
const report = (): MarketReportResult => ({
  subject: 'janitorial services', generated_for: null,
  summary: { total_market: 426e6, recompetes: 7, contacts: 6, total_market_basis: { state_scoped: false, window: 'FY2026' } },
  basis: null, reconciliation: null,
  sections: {
    market_size: null, top_agencies: [], top_agencies_total: 0, competition: { contractors: [], count: 0 },
    recompetes: { contracts: fixture.records as unknown[], count: 7 }, forecasts: { forecasts: [], count: 0 },
    contacts: fixture.contacts, agency_detail: null, set_aside_gap: null,
  },
  deliverable: { html: '', url: null, report_id: null },
  _meta: { grounded: true, degraded: false, sections_grounded: 4, sections_total: 7, saved: false, publication_state: 'publish' },
} as unknown as MarketReportResult);

describe('the Florida janitorial report as it was published (before the gate)', () => {
  it('fails integrity: ruled-out contracts in the table and a contacts label that matches no listed contract', () => {
    const f = reportIntegrity(report(), checks, { requestedState: 'FL', html: 'Total market (national)' });
    const failed = f.filter((x) => !x.pass).map((x) => x.reason).join(' ');
    expect(failed).toMatch(/4 contract\(s\) in the report's table were ruled out/);
    expect(failed).toMatch(/Veterans Affairs/);
  });
});

describe('cleanReportForPublish', () => {
  const { report: clean, removed } = cleanReportForPublish(report(), checks);
  const rows = clean.sections.recompetes.contracts as Array<{ piid: string }>;
  const contacts = clean.sections.contacts as unknown as { agency: string; people: Array<{ office_code: string }>; office_codes: string[] };

  it('keeps only the 3 pursuable contracts', () => {
    expect(rows.map((r) => r.piid).sort()).toEqual(['12639522C0010', '140R4024P0007', '697DCK22C00334']);
    expect(clean.sections.recompetes.count).toBe(3);
    expect(removed.recompetes).toBe(4);
  });

  it('keeps only the contact from the office that awarded a kept contract (FAA 697DCK), relabelled to that agency', () => {
    expect(contacts.people.map((p) => p.office_code)).toEqual(['697DCK']);
    expect(contacts.office_codes).toEqual(['697DCK']);
    expect(contacts.agency).toBe('Department of Transportation');
    expect(removed.contacts).toBe(5);
  });

  it('passes every integrity check after cleaning', () => {
    const f = reportIntegrity(clean, checks, { requestedState: 'FL', html: '<b>Total market (national)</b>' });
    expect(f.every((x) => x.pass)).toBe(true);
  });

  it('blocks a national total that the report does not label national', () => {
    const f = reportIntegrity(clean, checks, { requestedState: 'FL', html: '<b>Total market</b>' });
    expect(f.some((x) => !x.pass && /national/.test(x.reason))).toBe(true);
  });

  it('removes the contacts block entirely when no person ties to a kept contract', () => {
    const onlyBoR = checks.map((c) => (c.contract_id.includes('140R4024P0007') ? c : { ...c, verdict: 'out_of_scope' as const }));
    expect(cleanReportForPublish(report(), onlyBoR).report.sections.contacts).toBeNull();
  });
});

describe('personTiedToRows', () => {
  it('needs the office code at the start of the contract number', () => {
    expect(personTiedToRows({ office_code: '697DCK' }, [{ piid: '697DCK22C00334' }])).toBeTruthy();
    expect(personTiedToRows({ office_code: '697DCK' }, [{ piid: 'XX697DCK' }])).toBeUndefined();
    expect(personTiedToRows({ office_code: '' }, [{ piid: '697DCK22C00334' }])).toBeUndefined();
  });
});
