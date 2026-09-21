/**
 * Blank PSC filtering through the real SAM transform + MCP response path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./utils', () => ({
  getSAMAPIConfig: vi.fn(),
  makeSAMRequest: vi.fn(),
  getAllDistinctSAMKeys: vi.fn(() => []),
}));

vi.mock('@/lib/sam/entity-local-fallback', () => ({
  lookupLocalEntitiesByName: vi.fn(async () => ({ hits: [], status: 'ok' as const })),
  lookupLocalEntityByUEI: vi.fn(async () => ({ entity: null, status: 'ok' as const, hit: null })),
}));

vi.mock('@/lib/mcp/flags', () => ({
  mcpFlags: { aiHint: false },
}));

const getEntityByUEI = vi.fn();
vi.mock('./entity-api', async () => {
  const actual = await vi.importActual<typeof import('./entity-api')>('./entity-api');
  return {
    ...actual,
    getEntityByUEI: (...args: unknown[]) => getEntityByUEI(...args),
  };
});

const { transformEntity } = await import('./entity-api');
const { lookupSamEntity } = await import('../../mcp/tools/sam-entity');

function entityWithPsc(pscList: Array<{ pscCode: string; pscDescription: string }>) {
  return {
    entityRegistration: {
      ueiSAM: 'N1N9JPDYHVC7',
      cageCode: '1ABC2',
      legalBusinessName: 'CYRUS TEST CO',
      registrationStatus: 'A',
    },
    coreData: {
      entityInformation: {},
      businessTypes: { sbaBusinessTypeList: [] },
    },
    assertions: {
      goodsAndServices: {
        naicsList: [],
        pscList,
      },
    },
    pointsOfContact: {},
  };
}

describe('transformEntity + lookup_sam_entity blank PSC contract', () => {
  beforeEach(() => {
    getEntityByUEI.mockReset();
  });

  it('transformEntity turns a sole blank PSC object into an empty array', () => {
    const e = transformEntity(entityWithPsc([{ pscCode: '', pscDescription: '' }]));
    expect(e.pscList).toEqual([]);
  });

  it('transformEntity keeps real PSC rows and drops blank companions', () => {
    const e = transformEntity(
      entityWithPsc([
        { pscCode: '', pscDescription: '' },
        { pscCode: 'D307', pscDescription: 'IT AND TELECOM' },
      ]),
    );
    expect(e.pscList).toEqual([{ pscCode: 'D307', pscDescription: 'IT AND TELECOM' }]);
  });

  it('MCP lookup_sam_entity drops blank PSC rows on the response boundary', async () => {
    // Simulate a path that still carries a blank PSC object into the MCP layer.
    getEntityByUEI.mockResolvedValue({
      ueiSAM: 'N1N9JPDYHVC7',
      cageCode: '1ABC2',
      legalBusinessName: 'CYRUS TEST CO',
      registrationStatus: 'Active',
      naicsList: [],
      pscList: [{ pscCode: '', pscDescription: '' }],
      certifications: { sbaBusinessTypes: [], naicsSmallBusiness: {}, certificationExpirations: [] },
      pointsOfContact: [],
      isActive: true,
      daysUntilExpiration: null,
      has8a: false,
      hasSDVOSB: false,
      hasWOSB: false,
      hasHUBZone: false,
    });

    const result = await lookupSamEntity({ uei: 'N1N9JPDYHVC7' });
    expect(result.entity?.pscList).toEqual([]);
    expect(result._meta.grounded).toBe(true);
    expect(result._meta.lookup_status).toBe('found');
  });
});
