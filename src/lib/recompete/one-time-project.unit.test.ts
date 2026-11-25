import { describe, it, expect, vi } from 'vitest';
import { isOneTimeConstruction, NOT_ONE_TIME_CONSTRUCTION_OR } from './one-time-project';
import { annotateRecompeteRow } from './annotate';

// 36C24825C0020 as stored (2026-11-22): DB trigger says 'high'.
const RENOVATE_5_WEST = {
  contract_id: 'CONT_AWD_36C24825C0020_3600_-NONE-_-NONE-', contract_type: 'DEFINITIVE CONTRACT',
  naics_code: '236220', psc_code: 'Y1DA', recompete_likelihood: 'high',
  period_of_performance_current_end: '2026-11-23', total_obligation: 8442784,
};

describe('isOneTimeConstruction', () => {
  it('36C24825C0020 (Y1DA hospital construction, definitive) is one-time', () => {
    expect(isOneTimeConstruction(RENOVATE_5_WEST)).toBe(true);
  });
  it('PSC Z2* (repair/alteration) is one-time; Z1* (maintenance, often recurring) is not', () => {
    expect(isOneTimeConstruction({ contract_type: 'DEFINITIVE CONTRACT', psc_code: 'Z2DA' })).toBe(true);
    expect(isOneTimeConstruction({ contract_type: 'DEFINITIVE CONTRACT', psc_code: 'Z1DA' })).toBe(false);
  });
  it('the PSC decides over a construction NAICS (elevator maintenance J035 under 236220 is not one-time)', () => {
    expect(isOneTimeConstruction({ contract_type: 'DEFINITIVE CONTRACT', naics_code: '236220', psc_code: 'J035' })).toBe(false);
  });
  it('with no PSC, NAICS 236/237 counts; 238 specialty trades alone do not', () => {
    expect(isOneTimeConstruction({ contract_type: 'DEFINITIVE CONTRACT', naics_code: '237310' })).toBe(true);
    expect(isOneTimeConstruction({ contract_type: 'DEFINITIVE CONTRACT', naics_code: '238220' })).toBe(false);
  });
  it('task orders and unknown contract types are never relabelled', () => {
    expect(isOneTimeConstruction({ ...RENOVATE_5_WEST, contract_type: 'DELIVERY ORDER' })).toBe(false);
    expect(isOneTimeConstruction({ ...RENOVATE_5_WEST, contract_type: null })).toBe(false);
  });
});

describe('read-time override through annotateRecompeteRow (every display surface)', () => {
  it('36C24825C0020 reads not_recurring with a basis, not high', () => {
    const a = annotateRecompeteRow(RENOVATE_5_WEST);
    expect(a.recompete_likelihood).toBe('not_recurring');
    expect(a.recompete_likelihood_basis).toMatch(/One-time construction/);
  });
  it('a recurring services contract keeps its stored likelihood', () => {
    const a = annotateRecompeteRow({ ...RENOVATE_5_WEST, naics_code: '561210', psc_code: 'S216' });
    expect(a.recompete_likelihood).toBe('high');
    expect('recompete_likelihood_basis' in a).toBe(false);
  });
});

describe('the likelihood filter agrees with the display', () => {
  it('the exclusion is the complement, NULL-safe', () => {
    expect(NOT_ONE_TIME_CONSTRUCTION_OR).toContain('contract_type.not.ilike.*DEFINITIVE*');
    expect(NOT_ONE_TIME_CONSTRUCTION_OR).toContain('or(psc_code.is.null,psc_code.not.like.Y*)');
    expect(NOT_ONE_TIME_CONSTRUCTION_OR).toContain('or(psc_code.is.null,psc_code.not.like.Z2*)');
  });
  it('queryExpiringContracts attaches it whenever likelihood is filtered, and only then', async () => {
    const ors: string[] = [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['select', 'gte', 'lte', 'gt', 'lt', 'eq', 'in', 'is', 'not', 'ilike', 'order', 'range', 'filter']) builder[m] = vi.fn(chain);
    builder.or = vi.fn((s: string) => { ors.push(s); return builder; });
    builder.limit = vi.fn(async () => ({ data: [], error: null, count: 0 }));
    builder.then = undefined;
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => builder }) }));
    vi.resetModules();
    const { queryExpiringContracts } = await import('./query');
    await queryExpiringContracts({ likelihood: 'high', limit: 5 });
    expect(ors).toContain(NOT_ONE_TIME_CONSTRUCTION_OR);
    ors.length = 0;
    await queryExpiringContracts({ limit: 5 });
    expect(ors).not.toContain(NOT_ONE_TIME_CONSTRUCTION_OR);
    vi.doUnmock('@supabase/supabase-js');
  });
});
