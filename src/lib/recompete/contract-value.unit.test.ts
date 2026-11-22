import { describe, it, expect } from 'vitest';
import { contractCeiling } from './contract-value';
import { annotateRecompeteRow } from './annotate';
import { contractSize } from '@/lib/alerts/coming-back-to-market';

// 36C24825C0020 as stored by the USASpending recompete sync (2026-11-22): the obligated amount copied into
// potential_total_value. The award record's real ceiling (base + all options) is 17,386,875.96.
const SYNC_ROW = {
  contract_id: 'CONT_AWD_36C24825C0020_3600_-NONE-_-NONE-',
  contract_type: 'DEFINITIVE CONTRACT',
  period_of_performance_current_end: '2026-11-23',
  total_obligation: 8442784,
  potential_total_value: 8442784,
};

describe('contractCeiling — the obligated amount is never relabelled a ceiling', () => {
  it('an obligation copy is not established', () => {
    expect(contractCeiling(SYNC_ROW)).toEqual({ ceiling: null, basis: 'not_established' });
  });
  it('a source ceiling above the obligation is kept', () => {
    expect(contractCeiling({ potential_total_value: 17386875.96, total_obligation: 8442784 }))
      .toEqual({ ceiling: 17386875.96, basis: 'source_reported' });
  });
  it('missing, zero, non-numeric or below-obligation values are not established', () => {
    for (const r of [{}, { potential_total_value: 0 }, { potential_total_value: 'abc' }, { potential_total_value: 5, total_obligation: 9 }]) {
      expect(contractCeiling(r).ceiling).toBeNull();
    }
  });
  it('a numeric string from PostgREST numeric is read', () => {
    expect(contractCeiling({ potential_total_value: '200', total_obligation: '100' }).ceiling).toBe(200);
  });
});

describe('every display surface inherits it through annotateRecompeteRow', () => {
  it('the annotated row carries no ceiling and says so', () => {
    const a = annotateRecompeteRow(SYNC_ROW);
    expect(a.potential_total_value).toBeNull();
    expect(a.ceiling_basis).toBe('not_established');
    expect(a.total_obligation).toBe(8442784);
  });
  it('the Coming back alert labels the amount as obligated, not "Potential value (ceiling)"', () => {
    const a = annotateRecompeteRow(SYNC_ROW);
    expect(contractSize(a)).toEqual({ amount: 8442784, kind: 'obligated', obligated: 8442784 });
  });
});
