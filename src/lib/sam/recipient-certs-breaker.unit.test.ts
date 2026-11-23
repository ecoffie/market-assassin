/**
 * The cert backfill must STOP the moment SAM says every key is unusable (2026-11-22: Vercel logged
 * 275 "EVERY SAM KEY UNUSABLE" errors in 24h on /api/cron/backfill-recipient-certs — the drain loop
 * swallowed the all-keys-429 throw as one bad UEI and kept calling SAM every 6.5s for its whole
 * budget, burning the shared quota customers' lookup_sam_entity calls need).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getEntityByUEI = vi.fn();
vi.mock('@/lib/sam/entity-api', () => ({
  getEntityByUEI: (...a: unknown[]) => getEntityByUEI(...a),
  transformEntity: (x: unknown) => x,
}));
vi.mock('@/lib/bigquery/client', () => ({
  BQ_TABLES: { recipients: 'recipients' },
  bqQuery: vi.fn(async () => ['U1', 'U2', 'U3', 'U4', 'U5'].map((recipient_uei) => ({ recipient_uei }))),
}));
// Minimal Supabase stub: harvest finds nothing cached, no UEI checked yet, upserts succeed.
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ limit: async () => ({ data: [], error: null }) }),
        in: async () => ({ data: [], error: null }),
      }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

import { drainCertBackfill, isSamKeysUnavailableError, refreshCertForUeiDetailed } from './recipient-certs';

const QUOTA = () => new Error('SAM entity lookup unavailable: all API keys are rate-limited (429).');

beforeEach(() => { getEntityByUEI.mockReset(); });

describe('cert backfill — all-keys-unusable circuit breaker', () => {
  it('stops after the FIRST all-keys-429 instead of calling SAM for every queued UEI', async () => {
    getEntityByUEI.mockRejectedValue(QUOTA());
    const r = await drainCertBackfill({ limit: 5, rateMs: 0, budgetMs: 60_000 });
    expect(getEntityByUEI).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ attempted: 1, failed: 1, samUnavailable: true });
  });

  it('stops mid-batch when the quota runs out after some successes', async () => {
    getEntityByUEI
      .mockResolvedValueOnce({ legalBusinessName: 'A', has8a: true })
      .mockResolvedValueOnce(null)
      .mockRejectedValue(QUOTA());
    const r = await drainCertBackfill({ limit: 5, rateMs: 0, budgetMs: 60_000 });
    expect(getEntityByUEI).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ attempted: 3, certified: 1, noCert: 1, failed: 1, samUnavailable: true });
  });

  it('a single UEI failing for another reason does NOT stop the batch', async () => {
    getEntityByUEI
      .mockRejectedValueOnce(new Error('SAM entity lookup failed (500): boom'))
      .mockResolvedValue(null);
    const r = await drainCertBackfill({ limit: 5, rateMs: 0, budgetMs: 60_000 });
    expect(getEntityByUEI).toHaveBeenCalledTimes(5);
    expect(r).toMatchObject({ attempted: 5, failed: 1, noCert: 4, samUnavailable: false });
  });

  it('classifies the entity-api throw and keeps refreshCertForUei non-throwing', async () => {
    expect(isSamKeysUnavailableError(QUOTA())).toBe(true);
    expect(isSamKeysUnavailableError(new Error('SAM entity lookup unavailable: all API keys were rejected by SAM (401 — check)'))).toBe(true);
    expect(isSamKeysUnavailableError(new Error('SAM entity lookup failed (500): x'))).toBe(false);
    getEntityByUEI.mockRejectedValue(QUOTA());
    await expect(refreshCertForUeiDetailed('U1')).resolves.toEqual({ cert: null, samUnavailable: true });
  });
});
