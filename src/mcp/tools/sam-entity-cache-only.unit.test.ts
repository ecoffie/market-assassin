/**
 * Research mode's lookup_sam_entity (Agent 1 request, Eric 2026-11-25: zero live SAM calls). Same inputs and
 * output shape as the MCP tool, served only from Mindy's SAM cache, with _meta.source='local_registry' + as_of.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { live, byName, byUei } = vi.hoisted(() => ({
  live: vi.fn(async () => { throw new Error('live SAM must not be called'); }),
  byName: vi.fn(),
  byUei: vi.fn(),
}));
vi.mock('@/lib/sam/entity-api', async (orig) => ({ ...(await orig<object>()), searchEntities: live, getEntityByUEI: live }));
vi.mock('@/lib/sam/entity-local-fallback', async (orig) => ({
  ...(await orig<object>()),
  lookupLocalEntitiesByName: (...a: unknown[]) => byName(...a),
  lookupLocalEntityByUEI: (...a: unknown[]) => byUei(...a),
}));
vi.mock('@/lib/sam/registered-poc', async (orig) => ({ ...(await orig<object>()), lookupCachedEntityPocs: async () => ({ status: 'absent' }) }));

import { lookupSamEntity } from './sam-entity';

const ENT = { ueiSAM: 'NORWICH00001', cageCode: '', legalBusinessName: 'ELIZABETH F SMITH LLC', dbaName: 'EFS DIGITAL', registrationStatus: 'Active', physicalAddress: { stateOrProvince: 'CT' }, naicsList: [] };
const AS_OF = '2026-11-20T00:00:00Z';

beforeEach(() => { live.mockClear(); byName.mockReset(); byUei.mockReset(); });

describe('lookupSamEntity(..., { cacheOnly: true })', () => {
  it('a DBA name resolves from the cache; source local_registry, as_of, no live call', async () => {
    byName.mockResolvedValue({ status: 'found', hits: [{ entity: ENT, asOf: AS_OF }] });
    const r = await lookupSamEntity({ name: 'EFS Digital', state: 'CT' }, { cacheOnly: true });
    expect(live).not.toHaveBeenCalled();
    expect(byName).toHaveBeenCalledWith('EFS Digital', 10, 'CT');
    expect(r.entity?.ueiSAM).toBe('NORWICH00001');
    expect(r._meta).toMatchObject({ grounded: true, degraded: false, source: 'local_registry', as_of: AS_OF, lookup_status: 'found' });
    expect(String(r._meta.source_note)).toMatch(/research mode: no live SAM call/);
  });
  it('a UEI resolves from the cache only', async () => {
    byUei.mockResolvedValue({ status: 'found', hit: { entity: ENT, asOf: AS_OF } });
    const r = await lookupSamEntity({ uei: 'norwich00001' }, { cacheOnly: true });
    expect(live).not.toHaveBeenCalled();
    expect(r._meta).toMatchObject({ grounded: true, source: 'local_registry', lookup_status: 'found' });
  });
  it('a cache miss is a cached-source miss, not "unregistered", and lists only the cache as checked', async () => {
    byName.mockResolvedValue({ status: 'absent' });
    const r = await lookupSamEntity({ name: 'EFS Digital' }, { cacheOnly: true });
    expect(live).not.toHaveBeenCalled();
    expect(r._meta).toMatchObject({ grounded: false, degraded: false, source: 'local_registry', lookup_status: 'not_found' });
    expect(r._meta.reconciliation?.sources_checked).toEqual([{ source: 'local_registry', hits: 0, status: 'ok' }]);
    expect(r._meta.reconciliation?.note).toMatch(/Live SAM was not consulted/);
  });
  it('an unreadable cache → degraded lookup_failed, not grounded', async () => {
    byName.mockResolvedValue({ status: 'unavailable', detail: 'down' });
    const r = await lookupSamEntity({ name: 'EFS Digital' }, { cacheOnly: true });
    expect(r._meta).toMatchObject({ grounded: false, degraded: true, lookup_status: 'lookup_failed' });
  });
  it('the default MCP behaviour is unchanged: live SAM is still tried first', async () => {
    byName.mockResolvedValue({ status: 'found', hits: [{ entity: ENT, asOf: AS_OF }] });
    await lookupSamEntity({ name: 'EFS Digital' });
    expect(live).toHaveBeenCalled();
  });
});
