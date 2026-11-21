import { describe, it, expect } from 'vitest';
import {
  buildEmphasizeBullets,
  buildUnderstandNext,
  citedAgencyFindings,
  statedFocusFromText,
  UNDERSTAND_CAI_NEXT_PROMPT,
} from './understand-customer';

describe('statedFocusFromText', () => {
  it('pulls distinctive tokens from a cybersecurity title', () => {
    const focus = statedFocusFromText(
      'Cybersecurity Assessment and Continuous Monitoring Support',
      null,
    );
    expect(focus).toContain('cybersecurity');
    expect(focus).toContain('monitoring');
    expect(focus.every((t) => t !== 'and' && t !== 'the')).toBe(true);
  });
});

describe('buildEmphasizeBullets', () => {
  it('returns suggestion-status bullets when agency research shares notice wording', () => {
    const bullets = buildEmphasizeBullets({
      opportunityText: 'cybersecurity continuous monitoring zero trust assessment',
      painPoints: [
        'Aging cybersecurity infrastructure and lack of continuous monitoring capability',
        'Unrelated facilities maintenance backlog across regional campuses',
      ],
      priorities: ['Expand zero trust architecture adoption across enterprise networks'],
    });
    expect(bullets.length).toBeGreaterThanOrEqual(1);
    expect(bullets.some((b) => /Suggest emphasizing|not a buyer fact/i.test(b))).toBe(true);
    expect(bullets.every((b) => !/actually cares|they are looking for/i.test(b))).toBe(true);
    expect(bullets.every((b) => !/facilities maintenance/i.test(b))).toBe(true);
  });

  it('returns empty when there is no wording overlap (honest miss)', () => {
    const bullets = buildEmphasizeBullets({
      opportunityText: 'janitorial floor waxing custodial services',
      painPoints: ['Cybersecurity workforce shortage'],
      priorities: ['Zero trust network modernization'],
    });
    expect(bullets).toEqual([]);
  });
});

describe('buildUnderstandNext', () => {
  it('ends UNDERSTAND with CURRENT INTELLIGENCE ask — not set-aside-first', () => {
    const next = buildUnderstandNext();
    expect(next).toHaveLength(1);
    expect(next[0].prompt).toBe(UNDERSTAND_CAI_NEXT_PROMPT);
    expect(next[0].requires_confirmation).toBe(true);
    expect(next[0].tool).toBe('get_current_acquisition_intelligence');
    expect(next[0].prompt.toLowerCase()).not.toMatch(/set-aside|8\(a\)|sdvosb|hubzone|wosb/);
    expect(next[0].prompt.toLowerCase()).toMatch(/changed|buying/);
  });
});

describe('citedAgencyFindings — only cited GAO / IG findings are stated (Ask Mindy Backend Spec)', () => {
  const cited = { claim: 'Cutter maintenance backlog is delaying patrols', provenance: 'SOURCE_FACT', source_url: 'https://www.gao.gov/products/gao-25-106544', document_number: 'GAO-25-106544', published_at: '2025-04-10' };
  const citedNoNumber = { ...cited, claim: 'Shipyard capacity limits repair schedules', document_number: null };
  const legacy = { claim: 'Aging fleet needs modernization', provenance: 'LEGACY_MANUAL', source_url: null, document_number: null, published_at: null };
  const interpretation = { claim: 'Derived: staffing is the constraint', provenance: 'MINDY_INTERPRETATION', source_url: null, document_number: null, published_at: null };

  it('keeps cited findings with report number, date and link; withholds the rest', () => {
    const r = citedAgencyFindings({
      painPoints: ['x', 'y', 'z'],
      painPointCitations: [cited, legacy, interpretation],
      gaoReports: ['Old GovInfo title (GAO, 1998) [LEGACY_GOVINFO — not living Institute]'],
    });
    expect(r.cited_findings).toEqual([{ claim: cited.claim, document_number: 'GAO-25-106544', published_at: '2025-04-10', source_url: cited.source_url }]);
    expect(r.pain_points).toEqual(['Cutter maintenance backlog is delaying patrols (Source: GAO-25-106544)']);
    expect(r.withheld_unsourced).toBe(3);
  });

  it('a cited finding without a report number names its source host, never invents a number', () => {
    const r = citedAgencyFindings({ painPointCitations: [citedNoNumber] });
    expect(r.pain_points).toEqual(['Shipyard capacity limits repair schedules (Source: www.gao.gov)']);
    expect(r.cited_findings[0].document_number).toBeNull();
  });

  it('static-file strings with no citations at all are withheld, not shown', () => {
    const r = citedAgencyFindings({ painPoints: ['Static claim A (Source: GAO)', 'Static claim B'] });
    expect(r.pain_points).toEqual([]);
    expect(r.cited_findings).toEqual([]);
    expect(r.withheld_unsourced).toBe(2);
  });

  it('nothing on file → nothing stated, nothing withheld', () => {
    expect(citedAgencyFindings({})).toEqual({ pain_points: [], cited_findings: [], withheld_unsourced: 0 });
  });
});
