import { describe, expect, it } from 'vitest';
import { evidence, unknown, value } from './grounding';
import { buildDecisionBrief } from './decision-brief';
import { buildEvidenceBuckets } from './evidence-buckets';

const ev = evidence('fixture', { naics: '236220' });

describe('buildDecisionBrief', () => {
  it('maps an undetermined empty-office result to DATA UNAVAILABLE, not Sources Sought', () => {
    const brief = buildDecisionBrief({
      determination: value('undetermined', ev),
      recommendation: value('Insufficient evidence to support a set-aside — sample incomplete.', ev),
      buyerAwardCount: 0,
      buyerHistoryEmpty: true,
      buyerHistoryUnknown: false,
      installationContextPresent: false,
      supplierScopeLabel: 'Wyoming small-business capacity for NAICS 111110',
      supplierEvidenceClass: 'contextual',
      pricingUnknown: false,
      pricingDegraded: false,
    });
    expect(brief.state).toBe('DATA UNAVAILABLE');
    expect(brief.nextAction).not.toMatch(/Sources Sought/i);
    expect(brief.doesNotSupport).toMatch(/set-aside/i);
  });

  it('maps Rule-of-Two met to SUPPORTED without exposing sample_coverage', () => {
    const brief = buildDecisionBrief({
      determination: value('met', ev),
      recommendation: value('Rule of Two supported: 2 distinct parent-deduplicated capable small businesses.', ev),
      buyerAwardCount: 8,
      buyerHistoryEmpty: false,
      buyerHistoryUnknown: false,
      installationContextPresent: false,
      supplierEvidenceClass: 'contextual',
      pricingUnknown: false,
      pricingDegraded: false,
    });
    expect(brief.state).toBe('SUPPORTED');
    expect(brief.nextAction).toMatch(/set-aside/i);
    expect(JSON.stringify(brief)).not.toMatch(/sample_coverage/);
  });

  it('scrubs raw sample_coverage from decision copy while preserving the meaning', () => {
    const brief = buildDecisionBrief({
      determination: value('undetermined', ev),
      recommendation: value(
        'Insufficient evidence to support a set-aside — sample_coverage=0.05 (< 1) — sample is not exhaustive.',
        ev,
      ),
      buyerAwardCount: 12,
      buyerHistoryEmpty: false,
      buyerHistoryUnknown: false,
      installationContextPresent: false,
      supplierEvidenceClass: 'contextual',
      pricingUnknown: false,
      pricingDegraded: false,
    });
    expect(brief.state).toBe('MORE RESEARCH NEEDED');
    expect(JSON.stringify(brief)).not.toMatch(/sample_coverage/);
    expect(brief.supports).toMatch(/not exhaustive/i);
    expect(brief.supports).toMatch(/Insufficient evidence/i);
  });

  it('does not treat every abstention as Sources Sought', () => {
    const brief = buildDecisionBrief({
      determination: value('undetermined', ev),
      recommendation: value('Insufficient evidence to support a set-aside — truncated sample.', ev),
      buyerAwardCount: 12,
      buyerHistoryEmpty: false,
      buyerHistoryUnknown: false,
      installationContextPresent: true,
      predecessorEvidenceClass: 'contextual',
      supplierEvidenceClass: 'contextual',
      pricingUnknown: false,
      pricingDegraded: false,
    });
    expect(brief.state).toBe('MORE RESEARCH NEEDED');
    expect(brief.nextAction).not.toMatch(/Sources Sought/i);
    expect(brief.nextAction).toMatch(/installation/i);
  });

  it('maps a failed determination to DATA UNAVAILABLE or MORE RESEARCH NEEDED, never yes/no', () => {
    const brief = buildDecisionBrief({
      determination: unknown('assess_market_depth failed', [ev]),
      recommendation: value('Insufficient evidence to support a set-aside — assess_market_depth failed.', ev),
      buyerAwardCount: null,
      buyerHistoryEmpty: false,
      buyerHistoryUnknown: true,
      installationContextPresent: false,
      pricingUnknown: true,
      pricingDegraded: false,
    });
    expect(['DATA UNAVAILABLE', 'MORE RESEARCH NEEDED']).toContain(brief.state);
    expect(brief.state).not.toMatch(/YES|NO/);
  });
});

describe('buildEvidenceBuckets', () => {
  it('keeps buyer history distinct from installation context and capacity', () => {
    const buckets = buildEvidenceBuckets({
      awards: [
        {
          contractNumber: 'FA461022F0114',
          recipient: 'CM Construction',
          awardingAgency: 'Department of the Air Force',
          awardingOffice: 'FA4610',
          evidenceClass: 'in_scope',
        },
        {
          contractNumber: 'W912PL26CA005',
          recipient: 'Korte',
          awardingAgency: 'Department of the Army',
          awardingOffice: 'W912PL',
          evidenceClass: 'contextual',
        },
      ],
      predecessorEvidenceClass: 'contextual',
      predecessorId: 'W912PL26CA005',
      supplierScopeLabel: 'California small-business capacity for NAICS 236220',
      supplierEvidenceClass: 'contextual',
    });
    expect(buckets.buyerHistory.rows.map((row) => row.contractNumber)).toEqual(['FA461022F0114']);
    expect(buckets.installationContext.rows.some((row) => row.contractNumber === 'W912PL26CA005')).toBe(true);
    expect(buckets.broaderMarketCapacity.summary).toMatch(/California small-business capacity/);
    expect(buckets.buyerHistory.rows).not.toEqual(buckets.installationContext.rows);
  });
});
