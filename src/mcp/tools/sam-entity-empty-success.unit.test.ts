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
});
