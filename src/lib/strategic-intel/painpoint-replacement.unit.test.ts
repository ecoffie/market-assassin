import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertProposedOutputPath,
  highRiskCandidates,
  instituteCandidates,
  partitionCandidates,
  rejectReason,
  type HighRiskList,
  type ReplacementCandidate,
} from './painpoint-replacement';

const ROOT = resolve(__dirname, '../../..');

const good: ReplacementCandidate = {
  agency: 'Department of Defense',
  pain_point: 'DOD Contract Management (GAO High-Risk List, GAO-25-107743, February 2025)',
  origin: 'gao_high_risk_2025',
  document_number: 'GAO-25-107743',
  source_url: 'https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970305',
  publication_date: '2025-02-25',
  agency_resolution_method: 'curated_area_table:title_named',
  requires_review: false,
};

describe('replacement guards', () => {
  it('accepts a fully cited, exactly resolved candidate', () => {
    expect(rejectReason(good)).toBeNull();
  });
  it('rejects a pre-2001 source (the 1993-2000 GovInfo class)', () => {
    expect(rejectReason({ ...good, publication_date: '1998-03-02' })?.reason).toBe('pre_2001_source');
    expect(rejectReason({ ...good, publication_date: '2000-12-31' })?.reason).toBe('pre_2001_source');
    expect(rejectReason({ ...good, publication_date: '2001-01-01' })).toBeNull();
  });
  it('rejects a missing or unparseable date', () => {
    expect(rejectReason({ ...good, publication_date: undefined })?.reason).toBe('missing_publication_date');
    expect(rejectReason({ ...good, publication_date: 'FY2026' })?.reason).toBe('missing_publication_date');
  });
  it('rejects an item without a URL', () => {
    expect(rejectReason({ ...good, source_url: undefined })?.reason).toBe('missing_url');
    expect(rejectReason({ ...good, source_url: '' })?.reason).toBe('missing_url');
    expect(rejectReason({ ...good, source_url: 'www.gao.gov/x' })?.reason).toBe('missing_url');
  });
  it('rejects a missing or non-GAO document number', () => {
    expect(rejectReason({ ...good, document_number: undefined })?.reason).toBe('missing_document_number');
    expect(rejectReason({ ...good, document_number: 'OIG-26-3' })?.reason).toBe('missing_document_number');
  });
  it('rejects an unresolved agency', () => {
    expect(rejectReason({ ...good, agency: 'Department of the' })?.reason).toBe('unresolved_agency');
    expect(rejectReason({ ...good, agency: 'for Agency' })?.reason).toBe('unresolved_agency');
    expect(rejectReason({ ...good, agency: 'United States Postal Service' })?.reason).toBe('unresolved_agency');
    expect(rejectReason({ ...good, agency_resolution_method: 'unresolved' })?.reason).toBe('unresolved_agency');
  });
  it('rejects an agency that is an alias or fragment rather than the canonical name', () => {
    // Even if a resolver could map it, the candidate must CARRY the canonical name.
    expect(rejectReason({ ...good, agency: 'DOD' })?.reason).toBe('unresolved_agency');
    expect(rejectReason({ ...good, agency: 'Department of Veterans' })?.reason).toBe('unresolved_agency');
  });
  it('rejects an agency established by substring matching, by name', () => {
    expect(rejectReason({ ...good, agency_resolution_method: 'substring' })?.reason).toBe('substring_agency');
  });
  it('partition reports every rejection — none silently dropped', () => {
    const { accepted, rejected } = partitionCandidates([good, { ...good, publication_date: '1997-01-01' }, { ...good, source_url: '' }]);
    expect(accepted).toHaveLength(1);
    expect(rejected.map((r) => r.reason)).toEqual(['pre_2001_source', 'missing_url']);
  });
});

describe('(a) GAO-25-107743 area table', () => {
  const list = JSON.parse(readFileSync(join(ROOT, 'data/gao/high-risk-list-GAO-25-107743.json'), 'utf8')) as HighRiskList;
  it('is the current 38-area edition', () => {
    expect(list._about.document_number).toBe('GAO-25-107743');
    expect(list.areas).toHaveLength(38);
    expect(new Set(list.areas.map((a) => a.url)).size).toBe(38);
  });
  it('never attaches multi-agency or government-wide areas to an agency', () => {
    const { candidates, unmappedAreas } = highRiskCandidates(list);
    expect(unmappedAreas).toHaveLength(15);
    const unmappedNs = new Set(unmappedAreas.map((u) => u.n));
    expect(candidates.some((c) => unmappedNs.has(c.high_risk_area!))).toBe(false);
  });
  it('22 accepted, USPS rejected by the resolver guard, program-owner mappings flagged for review', () => {
    const { accepted, rejected } = partitionCandidates(highRiskCandidates(list).candidates);
    expect(accepted).toHaveLength(22);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].candidate.agency).toBe('United States Postal Service');
    expect(accepted.filter((c) => c.requires_review)).toHaveLength(10);
    for (const c of accepted) expect(c.source_url).toMatch(/^https:\/\/files\.gao\.gov\/reports\/GAO-25-107743\//);
  });
});

describe('(b) institute_sources rows', () => {
  it('only resolved GAO reports pass; unresolved and pre-2001 are rejected', () => {
    const base = {
      source_org: 'GAO', source_type: 'gao_report', title: 'T', source_url: 'https://www.gao.gov/products/gao-26-106756',
      document_number: 'GAO-26-106756', publication_date: '2026-09-10',
    };
    const cands = instituteCandidates([
      { ...base, id: '1', canonical_agency: 'Department of Agriculture', resolution_method: 'exact_name' },
      { ...base, id: '2', canonical_agency: null, resolution_method: 'unresolved' },
      { ...base, id: '3', canonical_agency: 'Department of Agriculture', resolution_method: 'exact_name', publication_date: '1999-01-01' },
      { ...base, id: '4', source_org: 'Congress', canonical_agency: 'Department of Agriculture', resolution_method: 'exact_name' },
    ]);
    expect(cands).toHaveLength(3); // Congress row is not a GAO candidate
    const { accepted, rejected } = partitionCandidates(cands);
    expect(accepted.map((a) => a.institute_source_id)).toEqual(['1']);
    expect(accepted[0].pain_point).toBe('T (Source: GAO-26-106756)');
    expect(accepted[0].agency_resolution_method).toBe('institute_resolver:exact_name');
    expect(rejected.map((r) => r.reason).sort()).toEqual(['pre_2001_source', 'unresolved_agency']);
  });
});

describe('output path guard', () => {
  it('refuses the served JSON and anything under src/', () => {
    expect(() => assertProposedOutputPath('src/data/agency-pain-points.json', ROOT)).toThrow(/served/);
    expect(() => assertProposedOutputPath('src/data/proposed.json', ROOT)).toThrow(/src/);
    expect(() => assertProposedOutputPath('./src/../src/data/agency-pain-points.json', ROOT)).toThrow();
  });
  it('allows the proposal file under tasks/', () => {
    expect(assertProposedOutputPath('tasks/painpoints-replacement-candidates-2026-11-17.json', ROOT))
      .toBe(join(ROOT, 'tasks/painpoints-replacement-candidates-2026-11-17.json'));
  });
});
