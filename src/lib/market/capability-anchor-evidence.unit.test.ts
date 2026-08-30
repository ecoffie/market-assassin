/**
 * Identity is the gate on evidence.
 *
 * A name search that returns rows is NOT corroboration. `ilike '%Building Consultants%'`
 * matches every firm carrying that string, and merging their NAICS invents a registration
 * profile for a company that may not be the caller's — a fabricated market wearing the
 * costume of evidence. These tests pin the three outcomes that gate matters on: uniquely
 * resolved, collided, and absent.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { normalizeEntityName, resolveIdentity } from './capability-anchor-evidence';

const localEntitiesByName = vi.fn();
const getContractorHistoryByUei = vi.fn();

vi.mock('@/lib/sam/entity-local-fallback', () => ({
  localEntitiesByName: (...args: unknown[]) => localEntitiesByName(...args),
}));
vi.mock('@/lib/contractor/history-by-uei', () => ({
  getContractorHistoryByUei: (...args: unknown[]) => getContractorHistoryByUei(...args),
}));

const entity = (uei: string, legalBusinessName: string, primaryNaics?: string) => ({
  entity: { ueiSAM: uei, legalBusinessName, primaryNaics },
  asOf: '2026-08-01',
});

describe('normalizeEntityName', () => {
  it('treats legal suffix and punctuation variants as the same name', () => {
    const forms = ['Building Consultants, Inc.', 'BUILDING CONSULTANTS INC', 'Building Consultants, LLC', 'The Building Consultants Co.'];
    const normalized = new Set(forms.map(normalizeEntityName));
    expect([...normalized]).toEqual(['building consultants']);
  });

  it('does not collapse genuinely different names', () => {
    expect(normalizeEntityName('Building Consultants')).not.toBe(normalizeEntityName('Building Consultants Group'));
  });
});

describe('resolveIdentity', () => {
  it('one entity → unique', () => {
    const r = resolveIdentity('Brave One Contract Agency', [{ uei: 'SYNTH0BRV001', legalName: 'Brave One Contract Agency LLC' }]);
    expect(r).toMatchObject({ status: 'unique', uei: 'SYNTH0BRV001', candidates: 1 });
  });

  it('the same entity returned twice is still one entity', () => {
    const r = resolveIdentity('Acme', [
      { uei: 'SYNTH0ACM001', legalName: 'Acme LLC' },
      { uei: 'SYNTH0ACM001', legalName: 'Acme LLC' },
    ]);
    expect(r.status).toBe('unique');
    expect(r.candidates).toBe(1);
  });

  it('COLLISION: two entities with the same legal name resolve to nothing', () => {
    const r = resolveIdentity('Building Consultants, Inc.', [
      { uei: 'SYNTH0BCI001', legalName: 'Building Consultants, Inc.' },
      { uei: 'SYNTH0BCI002', legalName: 'BUILDING CONSULTANTS INC' },
    ]);
    expect(r.status).toBe('ambiguous');
    expect(r.uei).toBeNull();
    expect(r.candidates).toBe(2);
  });

  it('SIMILAR NAMES: an exact normalized match wins over substring neighbours', () => {
    const r = resolveIdentity('Undergrid', [
      { uei: 'SYNTH0UGX001', legalName: 'Undergrid LLC' },
      { uei: 'SYNTH0UGH001', legalName: 'Undergrid Networks Holdings' },
      { uei: 'SYNTH0UGS001', legalName: 'Undergrid Solutions Group' },
    ]);
    expect(r).toMatchObject({ status: 'unique', uei: 'SYNTH0UGX001' });
    expect(r.candidates).toBe(3);
  });

  it('SIMILAR NAMES: no exact match among several neighbours stays ambiguous', () => {
    const r = resolveIdentity('Undergrid', [
      { uei: 'SYNTH0UGH001', legalName: 'Undergrid Networks Holdings' },
      { uei: 'SYNTH0UGS001', legalName: 'Undergrid Solutions Group' },
    ]);
    expect(r.status).toBe('ambiguous');
    expect(r.uei).toBeNull();
  });

  it('rows without a UEI cannot resolve anyone', () => {
    const r = resolveIdentity('Ghost Co', [{ uei: '', legalName: 'Ghost Co' }]);
    expect(r).toMatchObject({ status: 'none', uei: null, candidates: 0 });
  });

  it('no rows → none', () => {
    expect(resolveIdentity('Nobody', []).status).toBe('none');
  });
});

describe('resolveIdentity — UEI format is the production boundary', () => {
  it('malformed UEI cannot resolve uniquely', () => {
    for (const uei of ['not-a-uei', 'SYNTH-BMA-01']) {
      const r = resolveIdentity('Acme', [{ uei, legalName: 'Acme LLC' }]);
      expect(r.status, uei).toBe('none');
      expect(r.uei, uei).toBeNull();
    }
  });

  it('11-character UEI cannot resolve uniquely', () => {
    const r = resolveIdentity('Acme', [{ uei: 'SYNTH0BMA00', legalName: 'Acme LLC' }]);
    expect('SYNTH0BMA00').toHaveLength(11);
    expect(r.status).toBe('none');
    expect(r.uei).toBeNull();
  });

  it('13-character UEI cannot resolve uniquely', () => {
    const r = resolveIdentity('Business Management Associates, Inc', [
      { uei: 'BMA1BIZMGMT01', legalName: 'Business Management Associates, Inc' },
    ]);
    expect('BMA1BIZMGMT01').toHaveLength(13);
    expect(r.status).toBe('none');
    expect(r.uei).toBeNull();
  });

  it('valid 12-character UEI can resolve uniquely', () => {
    const r = resolveIdentity('Business Management Associates, Inc', [
      { uei: 'SYNTH0BMA001', legalName: 'Business Management Associates, Inc' },
    ]);
    expect('SYNTH0BMA001').toHaveLength(12);
    expect(r).toMatchObject({ status: 'unique', uei: 'SYNTH0BMA001' });
  });
});

describe('loadAnchorEvidence — only a unique identity contributes NAICS', () => {
  beforeEach(() => {
    vi.resetModules();
    localEntitiesByName.mockReset();
    getContractorHistoryByUei.mockReset();
    getContractorHistoryByUei.mockResolvedValue({
      history: { summary: { totalObligations: 12_000_000 }, topNaics: [{ naics: '236220' }] },
    });
  });

  const load = async (name: string | undefined) => {
    const { loadAnchorEvidence } = await import('./capability-anchor-evidence');
    return loadAnchorEvidence(name);
  };

  it('unique identity returns SAM + award NAICS', async () => {
    localEntitiesByName.mockResolvedValue([entity('SYNTH0BCI001', 'Building Consultants, Inc.', '236220')]);
    const ev = await load('Building Consultants, Inc.');
    expect(ev.identity).toBe('unique');
    expect(ev.identityUei).toBe('SYNTH0BCI001');
    expect(ev.samNaics).toContain('236220');
    expect(ev.awardNaics).toContain('236220');
    expect(ev.awardObligatedUsd).toBe(12_000_000);
  });

  it('COLLISION returns no NAICS at all — not a merged profile', async () => {
    localEntitiesByName.mockResolvedValue([
      entity('SYNTH0BCI001', 'Building Consultants, Inc.', '236220'),
      entity('SYNTH0BCI002', 'BUILDING CONSULTANTS INC', '541330'),
    ]);
    const ev = await load('Building Consultants, Inc.');
    expect(ev.identity).toBe('ambiguous');
    expect(ev.identityUei).toBeNull();
    expect(ev.samNaics).toEqual([]);
    expect(ev.awardNaics).toEqual([]);
    expect(ev.identityCandidates).toBe(2);
    expect(getContractorHistoryByUei).not.toHaveBeenCalled();
  });

  it('SIMILAR NAMES with no exact hit returns no NAICS', async () => {
    localEntitiesByName.mockResolvedValue([
      entity('SYNTH0UGH001', 'Undergrid Networks Holdings', '237130'),
      entity('SYNTH0UGS001', 'Undergrid Solutions Group', '541512'),
    ]);
    const ev = await load('Undergrid');
    expect(ev.identity).toBe('ambiguous');
    expect(ev.samNaics).toEqual([]);
  });

  it('no match at all is honest emptiness, not an error', async () => {
    localEntitiesByName.mockResolvedValue([]);
    const ev = await load('Nonexistent Widget Co');
    expect(ev.identity).toBe('none');
    expect(ev.samNaics).toEqual([]);
    expect(ev.awardObligatedUsd).toBeNull();
  });

  it('an empty client name never triggers a lookup', async () => {
    const ev = await load('   ');
    expect(ev.identity).toBe('none');
    expect(localEntitiesByName).not.toHaveBeenCalled();
  });

  it('a failed award lookup degrades to SAM-only, it does not throw', async () => {
    localEntitiesByName.mockResolvedValue([entity('SYNTH0BRV001', 'Brave One Contract Agency', '811310')]);
    getContractorHistoryByUei.mockRejectedValue(new Error('bigquery down'));
    const ev = await load('Brave One Contract Agency');
    expect(ev.identity).toBe('unique');
    expect(ev.samNaics).toContain('811310');
    expect(ev.awardNaics).toEqual([]);
  });

  it('a 13-character identifier is not corroboration — award lookup is not attempted', async () => {
    localEntitiesByName.mockResolvedValue([
      entity('BMA1BIZMGMT01', 'Business Management Associates, Inc', '541611'),
    ]);
    const ev = await load('Business Management Associates, Inc');
    expect(ev.identity).toBe('none');
    expect(ev.identityUei).toBeNull();
    expect(ev.samNaics).toEqual([]);
    expect(getContractorHistoryByUei).not.toHaveBeenCalled();
  });

  it('11-character and hyphenated identifiers also cannot corroborate', async () => {
    for (const uei of ['SYNTH0BMA00', 'SYNTH-BMA-01']) {
      localEntitiesByName.mockReset();
      getContractorHistoryByUei.mockReset();
      localEntitiesByName.mockResolvedValue([entity(uei, 'Acme LLC', '541611')]);
      const ev = await load('Acme LLC');
      expect(ev.identity, uei).toBe('none');
      expect(ev.identityUei, uei).toBeNull();
      expect(getContractorHistoryByUei).not.toHaveBeenCalled();
    }
  });
});
