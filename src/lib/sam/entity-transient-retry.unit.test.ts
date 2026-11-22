/**
 * lookup_sam_entity retries live SAM once on a TRANSIENT failure before falling back to the local registry
 * (Ask Mindy Backend Spec, Tools: "retry live SAM.gov before using the mirror"). Before this, one 5xx or network
 * blip sent the lookup straight to the local copy, labelled degraded, although SAM would have answered a moment later.
 * Exactly one retry (the SAM key quota is shared); a 4xx is an answer and is never retried.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const makeSAMRequest = vi.fn();
vi.mock('./utils', () => ({
  getSAMAPIConfig: vi.fn(() => ({ apiType: 'entity', baseUrl: 'https://api.sam.gov/entity-information/v3', apiKey: 'k1', cacheTTLHours: 24 })),
  makeSAMRequest: (...a: unknown[]) => makeSAMRequest(...a),
  getAllDistinctSAMKeys: vi.fn(() => ['k1']),
}));
vi.mock('@/lib/sam/entity-local-fallback', () => ({
  lookupLocalEntitiesByName: vi.fn(async () => ({ hits: [], status: 'ok' as const })),
  lookupLocalEntityByUEI: vi.fn(async () => ({ status: 'not_found' as const })),
}));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: false } }));

const { searchEntities, isTransientSamError } = await import('./entity-api');
const { lookupSamEntity } = await import('../../mcp/tools/sam-entity');

const ok = { data: { entityData: [{ entityRegistration: { ueiSAM: 'N1N9JPDYHVC7', legalBusinessName: 'CYRUS TEST CO', registrationStatus: 'A' } }], totalRecords: 1 }, error: null, fromCache: false };
const err = (status: number) => ({ data: null, error: { status, message: `HTTP ${status}`, retryable: status >= 500, fallbackAvailable: true }, fromCache: false });

beforeEach(() => { makeSAMRequest.mockReset(); });

describe('transient SAM failures are retried once', () => {
  it('503 then 200 → the live answer, no fallback, exactly two calls', async () => {
    makeSAMRequest.mockResolvedValueOnce(err(503)).mockResolvedValueOnce(ok);
    const r = await searchEntities({ uei: 'N1N9JPDYHVC7', size: 1 });
    expect(r.entities[0]?.ueiSAM).toBe('N1N9JPDYHVC7');
    expect(makeSAMRequest).toHaveBeenCalledTimes(2);
  });

  it('a network failure (reported as 500) is retried too', async () => {
    makeSAMRequest.mockResolvedValueOnce(err(500)).mockResolvedValueOnce(ok);
    await expect(searchEntities({ uei: 'N1N9JPDYHVC7', size: 1 })).resolves.toMatchObject({ entities: [expect.anything()] });
    expect(makeSAMRequest).toHaveBeenCalledTimes(2);
  });

  it('two transient failures → throws after exactly two calls (no retry storm)', async () => {
    makeSAMRequest.mockResolvedValue(err(502));
    await expect(searchEntities({ uei: 'N1N9JPDYHVC7', size: 1 })).rejects.toThrow(/502/);
    expect(makeSAMRequest).toHaveBeenCalledTimes(2);
  });

  it('a 4xx is an answer, never retried', async () => {
    makeSAMRequest.mockResolvedValue(err(400));
    await expect(searchEntities({ uei: 'N1N9JPDYHVC7', size: 1 })).rejects.toThrow(/400/);
    expect(makeSAMRequest).toHaveBeenCalledTimes(1);
  });

  it('isTransientSamError: 5xx only', () => {
    expect([500, 502, 503, 504].every(isTransientSamError)).toBe(true);
    expect([400, 401, 404, 429].some(isTransientSamError)).toBe(false);
    expect(isTransientSamError(undefined)).toBe(false);
  });
});

describe('through lookup_sam_entity', () => {
  it('a blip followed by success is a live, non-degraded answer', async () => {
    makeSAMRequest.mockResolvedValueOnce(err(503)).mockResolvedValueOnce(ok);
    const r = await lookupSamEntity({ uei: 'N1N9JPDYHVC7' });
    expect(r._meta.degraded).toBe(false);
    expect(r.entity?.ueiSAM).toBe('N1N9JPDYHVC7');
    expect(r._meta.lookup_status).toBe('found');
  });
});
