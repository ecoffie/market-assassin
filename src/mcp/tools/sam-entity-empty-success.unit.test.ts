/**
 * CHAIN-1 — a live EMPTY result is not absence.
 *
 * THE INVARIANT: for identity resolution, a live empty result must be reconciled against
 * the local registry BEFORE Mindy may assert nonexistence. `grounded=false, degraded=false`
 * may ONLY mean both sources genuinely agreed there was no entity.
 *
 * Regression case: Fluidyne Corporation by NAME. Live SAM returns a successful 200 with
 * zero results; the mirror holds RG3VUTDYFNF8 (Active, NJ, synced same day, 8 award rows).
 * Before the fix this reported grounded=false degraded=false — "does not exist".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSearch = vi.fn();
const mockByUei = vi.fn();
const mockLocalName = vi.fn();
const mockLocalUei = vi.fn();

vi.mock('@/lib/sam/entity-api', () => ({
  searchEntities: (a: unknown) => mockSearch(a),
  getEntityByUEI: (u: string) => mockByUei(u),
}));
vi.mock('@/lib/sam/entity-local-fallback', () => ({
  localEntitiesByName: (n: string, l: number) => mockLocalName(n, l),
  localEntityByUEI: (u: string) => mockLocalUei(u),
  lookupLocalEntitiesByName: async (n: string, l: number) => {
    try {
      const hits = await mockLocalName(n, l);
      if (!hits?.length) return { status: 'absent' };
      return { status: 'found', hits };
    } catch (e) {
      return { status: 'unavailable', detail: String(e) };
    }
  },
  lookupLocalEntityByUEI: async (u: string) => {
    try {
      const hit = await mockLocalUei(u);
      if (!hit) return { status: 'absent' };
      return { status: 'found', hit };
    } catch (e) {
      return { status: 'unavailable', detail: String(e) };
    }
  },
}));

const { lookupSamEntity } = await import('./sam-entity');

const FLUIDYNE = {
  ueiSAM: 'RG3VUTDYFNF8', legalBusinessName: 'FLUIDYNE CORPORATION',
  registrationStatus: 'Active', physicalAddress: { stateOrProvince: 'NJ' },
};

beforeEach(() => {
  mockSearch.mockReset(); mockByUei.mockReset();
  mockLocalName.mockReset(); mockLocalUei.mockReset();
  mockLocalName.mockResolvedValue([]); mockLocalUei.mockResolvedValue(null);
});

describe('CHAIN-1 — live empty must be reconciled before asserting absence', () => {
  it('⚠️ THE REGRESSION: Fluidyne by NAME — live SAM empty, mirror has it → GROUNDED', async () => {
    mockSearch.mockResolvedValue({ entities: [] });               // successful 200, zero results
    mockLocalName.mockResolvedValue([{ entity: FLUIDYNE, asOf: '2026-08-25' }]);
    const r = await lookupSamEntity({ name: 'Fluidyne Corporation' });
    expect(r._meta.grounded).toBe(true);                          // was false — "does not exist"
    expect(r.entity?.legalBusinessName).toBe('FLUIDYNE CORPORATION');
    expect(r._meta.source).toBe('local_registry');                // provenance is honest
    expect(r._meta.as_of).toBe('2026-08-25');
  });

  it('the mirror is consulted on empty success, not only on throw', async () => {
    mockSearch.mockResolvedValue({ entities: [] });
    await lookupSamEntity({ name: 'Fluidyne Corporation' });
    expect(mockLocalName).toHaveBeenCalled();                     // the whole defect in one line
  });

  it('same for a UEI that live SAM returns empty for', async () => {
    mockByUei.mockResolvedValue(null);
    mockLocalUei.mockResolvedValue({ entity: FLUIDYNE, asOf: '2026-08-25' });
    const r = await lookupSamEntity({ uei: 'RG3VUTDYFNF8' });
    expect(r._meta.grounded).toBe(true);
    expect(r._meta.source).toBe('local_registry');
  });

  it('genuine absence still reads as absence — BOTH sources agreed', async () => {
    mockSearch.mockResolvedValue({ entities: [] });
    mockLocalName.mockResolvedValue([]);
    const r = await lookupSamEntity({ name: 'ZZQX NO SUCH COMPANY ZZZ' });
    expect(r._meta.grounded).toBe(false);
    expect(r._meta.degraded).toBe(false);
    expect(mockLocalName).toHaveBeenCalled();   // absence was ESTABLISHED, not assumed
  });

  it('a live HIT never gets overturned by the mirror', async () => {
    mockSearch.mockResolvedValue({ entities: [FLUIDYNE] });
    mockByUei.mockResolvedValue(FLUIDYNE);
    const r = await lookupSamEntity({ name: 'Fluidyne Corporation' });
    expect(r._meta.source).toBe('sam_live');
    expect(mockLocalName).not.toHaveBeenCalled();  // no needless mirror read on a live hit
  });

  it('if reconciliation ITSELF fails we degrade — we never claim absence', async () => {
    mockSearch.mockResolvedValue({ entities: [] });
    mockLocalName.mockRejectedValue(new Error('mirror unreachable'));
    const r = await lookupSamEntity({ name: 'Fluidyne Corporation' });
    expect(r._meta.grounded).toBe(false);
    expect(r._meta.degraded).toBe(true);          // an evidence gap, not a world fact
  });

  it('the DEFECT-7 throw path still falls back', async () => {
    mockSearch.mockRejectedValue(new Error('all API keys are rate-limited (429)'));
    mockLocalName.mockResolvedValue([{ entity: FLUIDYNE, asOf: '2026-08-24' }]);
    const r = await lookupSamEntity({ name: 'Fluidyne Corporation' });
    expect(r._meta.grounded).toBe(true);
    expect(r._meta.degraded).toBe(true);
    expect(r._meta.source).toBe('local_registry');
  });

  it('an empty query asks nobody', async () => {
    const r = await lookupSamEntity({});
    expect(r._meta.grounded).toBe(false);
    expect(mockLocalName).not.toHaveBeenCalled();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('name-search match_count counts the matches array, not the detail record', async () => {
    const sibling = { ...FLUIDYNE, ueiSAM: 'OTHERUEI00001', legalBusinessName: 'FLUIDYNE SERVICES LLC' };
    mockSearch.mockResolvedValue({ entities: [FLUIDYNE, sibling] });
    mockByUei.mockResolvedValue(FLUIDYNE);
    const r = await lookupSamEntity({ name: 'Fluidyne' });
    expect(r.matches).toHaveLength(2);
    expect(r._meta.match_count).toBe(2);
    // "Fluidyne" exact-stems to FLUIDYNE CORPORATION, not the longer SERVICES name.
    expect(r._meta.lookup_status).toBe('found');
    expect(r.entity?.ueiSAM).toBe('RG3VUTDYFNF8');
  });

  it('an ambiguous family never selects the first match', async () => {
    const a = { ...FLUIDYNE, ueiSAM: 'AAAA00000001', legalBusinessName: 'FLUIDYNE SUPPORT SERVICES LLC' };
    const b = { ...FLUIDYNE, ueiSAM: 'BBBB00000002', legalBusinessName: 'FLUIDYNE MANAGEMENT SERVICES LLC' };
    mockSearch.mockResolvedValue({ entities: [a, b] });
    const r = await lookupSamEntity({ name: 'Fluidyne' });
    expect(r.matches).toHaveLength(2);
    expect(r.entity).toBeNull();
    expect(r._meta.lookup_status).toBe('ambiguous');
    expect(mockByUei).not.toHaveBeenCalled();
  });

  it('an unsuccessful lookup is lookup_failed, not an unregistered business', async () => {
    mockSearch.mockRejectedValue(new Error('all API keys are rate-limited (429)'));
    mockLocalName.mockRejectedValue(new Error('mirror unreachable'));
    const r = await lookupSamEntity({ name: 'Fluidyne Corporation' });
    expect(r._meta.lookup_status).toBe('lookup_failed');
    expect(r._meta.grounded).toBe(false);
    expect(r._meta.degraded).toBe(true);
  });

  it('Monarch Yachts unique-picks the DBA row among live Monarch* legal names', async () => {
    const marine = {
      ueiSAM: 'MMWUEI000001',
      legalBusinessName: 'MONARCH MARINE WORKS INC',
      dbaName: 'Monarch Yachts',
      registrationStatus: 'Active',
    };
    const otherA = { ueiSAM: 'OTHER1XXXXXX', legalBusinessName: 'MONARCH INC', registrationStatus: 'Active' };
    const otherB = { ueiSAM: 'OTHER2XXXXXX', legalBusinessName: 'MONARCH CONSULTING LLC', registrationStatus: 'Active' };
    mockSearch.mockImplementation((a: { legalBusinessName?: string; dbaName?: string }) => {
      if (a.dbaName) return { entities: [] };
      return { entities: [otherA, marine, otherB] };
    });
    mockByUei.mockResolvedValue(marine);
    const r = await lookupSamEntity({ name: 'Monarch Yachts' });
    expect(r._meta.lookup_status).toBe('found');
    expect(r.entity?.legalBusinessName).toBe('MONARCH MARINE WORKS INC');
    expect(r.entity?.dbaName).toBe('Monarch Yachts');
    expect(r._meta.source).toBe('sam_live');
    expect(mockLocalName).not.toHaveBeenCalled();
  });

  it('Monarch Yachts still unique-picks when live legal hits omit DBA and the mirror has it', async () => {
    const liveMarine = {
      ueiSAM: 'MMWUEI000001',
      legalBusinessName: 'MONARCH MARINE WORKS INC',
      registrationStatus: 'Active',
    };
    const otherA = { ueiSAM: 'OTHER1XXXXXX', legalBusinessName: 'MONARCH INC', registrationStatus: 'Active' };
    mockSearch.mockResolvedValue({ entities: [otherA, liveMarine] });
    mockLocalName.mockResolvedValue([{
      entity: { ...liveMarine, dbaName: 'Monarch Yachts' },
      asOf: '2026-09-18',
    }]);
    mockByUei.mockResolvedValue({ ...liveMarine, dbaName: 'Monarch Yachts' });
    const r = await lookupSamEntity({ name: 'Monarch Yachts' });
    expect(r._meta.lookup_status).toBe('found');
    expect(r.entity?.ueiSAM).toBe('MMWUEI000001');
    expect(r._meta.source).toBe('sam_live');
  });
});
