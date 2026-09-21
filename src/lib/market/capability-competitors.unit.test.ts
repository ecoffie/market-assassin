/**
 * Competitor filter — blocks name-substring false positives (Anadria/Outcomes, TPJ/Customized).
 */
import { describe, expect, it } from 'vitest';
import {
  filterCompetitorsFabricatedRelevance,
  competitorNameMatchesForbiddenAnchorToken,
  describeCompetitorDerivation,
  anchorTokensThatMustNotMatchNames,
} from '@/lib/market/capability-competitors';
import type { RecipientSearchRow } from '@/lib/bigquery/recipients';

function row(name: string, uei = 'ABC123'): RecipientSearchRow {
  return {
    recipient_uei: uei,
    recipient_name: name,
    city: 'Arlington',
    state: 'VA',
    total_obligated: 1_000_000,
    award_count: 1,
    distinct_agency_count: 1,
    distinct_naics_count: 1,
  };
}

describe('anchorTokensThatMustNotMatchNames', () => {
  it('flags Outcomes for Anadria-class anchors', () => {
    expect(anchorTokensThatMustNotMatchNames('outcomes')).toContain('outcomes');
    expect(anchorTokensThatMustNotMatchNames('organizational development')).toContain('organizational');
  });

  it('flags Customized when anchor includes customized', () => {
    expect(anchorTokensThatMustNotMatchNames('customized training')).toContain('customized');
  });
});

describe('filterCompetitorsFabricatedRelevance', () => {
  const fabricated = [
    row('Outcomes Management Group LLC'),
    row('Customized Learning Partners Inc'),
    row('Legitimate Federal Contractor LLC'),
  ];

  it('Anadria: drops competitors whose names contain Outcomes', () => {
    const filtered = filterCompetitorsFabricatedRelevance(fabricated, 'organizational development');
    expect(filtered.map((r) => r.recipient_name)).not.toContain('Outcomes Management Group LLC');
    expect(filtered.map((r) => r.recipient_name)).toContain('Legitimate Federal Contractor LLC');
  });

  it('TPJ: drops competitors whose names contain Customized', () => {
    const filtered = filterCompetitorsFabricatedRelevance(fabricated, 'instructional design');
    expect(filtered.map((r) => r.recipient_name)).not.toContain('Customized Learning Partners Inc');
  });

  it('does not drop legitimate contractors when only generic tokens are whole words', () => {
    const filtered = filterCompetitorsFabricatedRelevance(fabricated, 'cybersecurity');
    expect(filtered.map((r) => r.recipient_name)).toContain('Legitimate Federal Contractor LLC');
    expect(filtered.map((r) => r.recipient_name)).not.toContain('Outcomes Management Group LLC');
  });
});

describe('competitorNameMatchesForbiddenAnchorToken', () => {
  it('detects substring match in company name', () => {
    expect(competitorNameMatchesForbiddenAnchorToken('Strategic Outcomes LLC', 'outcomes')).toBe(true);
    expect(competitorNameMatchesForbiddenAnchorToken('Acme Federal LLC', 'outcomes')).toBe(false);
  });
});

describe('describeCompetitorDerivation', () => {
  it('returns none_unverified_anchor for low confidence', () => {
    expect(
      describeCompetitorDerivation({
        usedPscPeers: false,
        leadNaics: '541512',
        anchorConfidence: 'unverified',
        rowCount: 5,
      }),
    ).toBe('none_unverified_anchor');
  });

  it('returns naics_spend_overlap when rows exist', () => {
    expect(
      describeCompetitorDerivation({
        usedPscPeers: false,
        leadNaics: '541512',
        anchorConfidence: 'high',
        rowCount: 3,
      }),
    ).toBe('naics_spend_overlap');
  });

  it('returns none_insufficient_overlap when query ran but empty', () => {
    expect(
      describeCompetitorDerivation({
        usedPscPeers: false,
        leadNaics: '541512',
        anchorConfidence: 'medium',
        rowCount: 0,
      }),
    ).toBe('none_insufficient_overlap');
  });
});
