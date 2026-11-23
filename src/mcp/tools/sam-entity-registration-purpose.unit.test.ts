/**
 * lookup_sam_entity — registration purpose readiness (2026-11-23, C9K6EE9JVDK7).
 * Z1 (Federal Assistance Awards) must carry a warning; Z2 must not; an absent purpose is
 * UNKNOWN with no warning (a mirror record never carries the field).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockByUei = vi.fn();
const mockLocalUei = vi.fn();

vi.mock('@/lib/sam/entity-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sam/entity-api')>('@/lib/sam/entity-api');
  return { ...actual, searchEntities: vi.fn(), getEntityByUEI: (u: string) => mockByUei(u) };
});
vi.mock('@/lib/sam/entity-local-fallback', () => ({
  lookupLocalEntitiesByName: async () => ({ status: 'absent' }),
  lookupLocalEntityByUEI: async (u: string) => {
    const hit = await mockLocalUei(u);
    return hit ? { status: 'found', hit } : { status: 'absent' };
  },
}));
vi.mock('@/lib/sam/registered-poc', () => ({
  lookupCachedEntityPocs: async () => ({ status: 'absent' }),
  REGISTERED_POC_LABEL: 'registered SAM POC',
}));

const { transformEntity } = await import('@/lib/sam/entity-api');
const { lookupSamEntity } = await import('./sam-entity');

function raw(code: string | undefined, desc: string | undefined, naics: unknown[]) {
  return {
    entityRegistration: {
      ueiSAM: 'C9K6EE9JVDK7', legalBusinessName: 'RBA ENGINEERING INTERNATIONAL PLLC', registrationStatus: 'Active',
      ...(code ? { purposeOfRegistrationCode: code } : {}),
      ...(desc ? { purposeOfRegistrationDesc: desc } : {}),
    },
    coreData: { businessTypes: { sbaBusinessTypeList: [], businessTypeList: [] } },
    assertions: { goodsAndServices: { naicsList: naics, pscList: [] } },
  };
}

beforeEach(() => {
  mockByUei.mockReset();
  mockLocalUei.mockReset();
  mockLocalUei.mockResolvedValue(null);
});

describe('lookup_sam_entity registration_readiness', () => {
  it('Z1 → warning present, contract_awards not_registered, no placeholder NAICS row', async () => {
    mockByUei.mockResolvedValue(transformEntity(raw('Z1', 'Federal Assistance Awards', [{ naicsCode: null, naicsDescription: null }])));
    const res = await lookupSamEntity({ uei: 'C9K6EE9JVDK7' });
    expect(res._meta.lookup_status).toBe('found');
    expect(res.registration_readiness?.contract_awards).toBe('not_registered');
    expect(res.registration_readiness?.warning).toContain('purposeOfRegistrationCode Z1');
    expect(res.registration_readiness?.warning).toContain('not registered for contract awards');
    expect(res.entity?.naicsList).toEqual([]);
    expect(JSON.stringify(res)).not.toContain('"naicsCode":""');
  });

  it('Z2 → no warning', async () => {
    mockByUei.mockResolvedValue(transformEntity(raw('Z2', 'All Awards', [{ naicsCode: '541330', sbaSmallBusiness: 'Y' }])));
    const res = await lookupSamEntity({ uei: 'C9K6EE9JVDK7' });
    expect(res.registration_readiness?.contract_awards).toBe('registered');
    expect(res.registration_readiness?.warning).toBeUndefined();
  });

  it('purpose field missing → no warning, contract_awards unknown, note says unknown', async () => {
    mockByUei.mockResolvedValue(transformEntity(raw(undefined, undefined, [])));
    const res = await lookupSamEntity({ uei: 'C9K6EE9JVDK7' });
    expect(res.registration_readiness?.contract_awards).toBe('unknown');
    expect(res.registration_readiness?.warning).toBeUndefined();
    expect(res.registration_readiness?.note).toMatch(/unknown/);
  });

  it('no entity → no registration_readiness block', async () => {
    mockByUei.mockResolvedValue(null);
    const res = await lookupSamEntity({ uei: 'C9K6EE9JVDK7' });
    expect(res.entity).toBeNull();
    expect(res.registration_readiness).toBeUndefined();
  });
});
