/**
 * Phase 0 — prove keyword-coverage window ≠ MARKET_SPEND_WINDOW.
 * Twin-truth guard from Owned Evidence Architecture.
 */
import { describe, expect, it } from 'vitest';
import {
  KEYWORD_COVERAGE_QUESTION,
  KEYWORD_COVERAGE_WINDOW_KIND,
  keywordCoverageWindowLabel,
} from './keyword-coverage-contract';
import {
  MARKET_SPEND_QUESTION,
  MARKET_SPEND_WINDOW_KIND,
  MARKET_SPEND_WINDOW_LABEL,
} from '@/lib/utils/usaspending-helpers';

describe('Phase 0 market-window semantic split', () => {
  it('keyword coverage and dashboard spend answer different questions', () => {
    expect(KEYWORD_COVERAGE_QUESTION).toBe('description_matched_fy_distribution');
    expect(MARKET_SPEND_QUESTION).toBe('category_or_code_market_size_3fy');
    expect(KEYWORD_COVERAGE_QUESTION).not.toBe(MARKET_SPEND_QUESTION);
  });

  it('window kinds are distinct', () => {
    expect(KEYWORD_COVERAGE_WINDOW_KIND).toBe('latest_complete_fy');
    expect(MARKET_SPEND_WINDOW_KIND).toBe('three_complete_fiscal_years');
    expect(KEYWORD_COVERAGE_WINDOW_KIND).not.toBe(MARKET_SPEND_WINDOW_KIND);
  });

  it('host labels cannot be confused', () => {
    const covLabel = keywordCoverageWindowLabel(2025);
    expect(covLabel).toContain('FY2025');
    expect(covLabel).toContain('1 complete fiscal year');
    expect(covLabel).toContain('description match');
    expect(MARKET_SPEND_WINDOW_LABEL).toContain('3 fiscal years');
    expect(covLabel).not.toBe(MARKET_SPEND_WINDOW_LABEL);
    expect(MARKET_SPEND_WINDOW_LABEL).not.toContain('description match');
  });
});
