import { describe, it, expect } from 'vitest';
import {
  KEYWORD_COVERAGE_PRIMARY_SENSE,
  KEYWORD_COVERAGE_SENSES_AVAILABLE,
  assertActionObligationGrain,
  buildKeywordCoverageSql,
  coerceBqNumber,
  descriptionMatchPattern,
  escapeRe2Literal,
  mapKeywordCoverageBqRow,
  senseMatchSql,
} from './keyword-coverage-bq';

describe('descriptionMatchPattern — phrase, not OR-expansion', () => {
  it('wraps a single word in word boundaries', () => {
    expect(descriptionMatchPattern('patrol')).toBe('\\bpatrol\\b');
  });

  it('keeps "patrol boat" as one phrase', () => {
    expect(descriptionMatchPattern('patrol boat')).toBe('\\bpatrol boat\\b');
    expect(descriptionMatchPattern('patrol boat')).not.toMatch(/patrol\|boat/);
  });

  it('does not add synonyms', () => {
    expect(descriptionMatchPattern('guard')).toBe('\\bguard\\b');
  });

  it('escapes regex metacharacters so the keyword is literal', () => {
    expect(escapeRe2Literal('c++')).toBe('c\\+\\+');
    expect(descriptionMatchPattern('c++')).toBe('\\bc\\+\\+\\b');
  });

  it('rejects too-short keywords', () => {
    expect(descriptionMatchPattern('a')).toBeNull();
    expect(descriptionMatchPattern('  ')).toBeNull();
  });
});

describe('BQ SQL contract', () => {
  it('sums obligation_amount and never award-level snapshots', () => {
    const sql = buildKeywordCoverageSql();
    expect(() => assertActionObligationGrain(sql)).not.toThrow();
    expect(sql).toContain('obligation_amount');
    expect(sql).not.toMatch(/total_obligated/);
    expect(sql).not.toMatch(/current_award_value/);
    expect(sql).not.toMatch(/potential_award_value/);
  });

  it('matches description only — not NAICS or PSC titles', () => {
    const sql = buildKeywordCoverageSql();
    expect(sql).toContain(senseMatchSql('work_text', 'description'));
    expect(sql).not.toContain(senseMatchSql('industry_title'));
    expect(sql).not.toContain(senseMatchSql('product_psc'));
    expect(sql).not.toMatch(/naics_description.*@pattern/);
    expect(sql).not.toMatch(/psc_description.*@pattern/);
  });

  it('does not silently exclude IDVs unless asked', () => {
    expect(buildKeywordCoverageSql()).not.toContain('STARTS_WITH(award_id');
    expect(buildKeywordCoverageSql({ awardIdPrefix: 'CONT_AWD_' })).toContain('STARTS_WITH(award_id, @awardPrefix)');
  });

  it('preserves Senses v2 predicate builders without using them in v1 SQL', () => {
    expect(KEYWORD_COVERAGE_SENSES_AVAILABLE).toEqual(['work_text', 'industry_title', 'product_psc']);
    expect(KEYWORD_COVERAGE_PRIMARY_SENSE).toBe('work_text');
    expect(senseMatchSql('industry_title')).toContain('naics_description');
    expect(senseMatchSql('product_psc')).toContain('psc_description');
  });
});

describe('mapKeywordCoverageBqRow', () => {
  it('maps snake_case warehouse fields to camelCase action grain', () => {
    const row = mapKeywordCoverageBqRow({
      transaction_count: '762',
      unique_award_count: 484,
      total_market: { value: '902600000' },
      max_action_date: '2025-09-30',
      naics: [{ code: '336611', name: 'Ship Building and Repairing', amount: '709000000' }],
      psc: [{ code: '1905', name: 'Combat Ships and Landing Vessels', amount: 400000000 }],
      agencies: [{ name: 'Department of Defense', amount: 800000000 }],
    }, { keyword: 'patrol', fiscalYear: 2025 });
    expect(row.transactionCount).toBe(762);
    expect(row.uniqueAwardCount).toBe(484);
    expect(row.totalMarket).toBe(902600000);
    expect(row.naics[0].code).toBe('336611');
    expect(row.pscs[0].code).toBe('1905');
    expect(row.naicsCount).toBe(1);
    expect(row.pscCount).toBe(1);
  });

  it('throws on a missing row — that is NOT_ESTABLISHED, not zero matches', () => {
    expect(() => mapKeywordCoverageBqRow(undefined, { keyword: 'patrol', fiscalYear: 2025 }))
      .toThrow(/no row/);
  });
});

describe('coerceBqNumber', () => {
  it('does not turn unknown into a fake zero for objects without value', () => {
    expect(coerceBqNumber(0)).toBe(0);
    expect(coerceBqNumber('12.5')).toBe(12.5);
    expect(coerceBqNumber({ value: '-100' })).toBe(-100);
  });
});
