/**
 * find_capable_contractors during a BigQuery outage (Data Core 2026-11-17).
 * Before: an unavailable BigQuery returned { ok:true, count:0, note:"No contractors found…" } —
 * unknown rendered as zero. Now: a dated last-good answer, or an explicit source_unavailable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mode: 'ok' | 'unavailable' | 'empty' = 'ok';
const snapshots = new Map<string, { value: unknown; fetchedAt: string }>();
const setCachedCalls: unknown[] = [];

vi.mock('@/lib/bigquery/cache', () => ({ bqUnavailable: () => false }));
vi.mock('@/lib/awards-ingest/read-warehouse-coverage', () => ({ loadAwardsWarehouseCoverage: vi.fn(async () => null) }));
vi.mock('@/lib/contractor/name-resolution', () => ({ resolveAwardCorpusByName: vi.fn(async () => ({ status: 'none', searched: '' })) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 5, limit: 12, resetAt: 0 })) }));
vi.mock('@/lib/bigquery/recipients', () => ({
  recipientSlug: (n: string) => n,
  findCapableSmallBusinesses: vi.fn(async () => {
    if (mode === 'ok') return { rows: [{ recipient_name: 'Acme', recipient_uei: 'U1', recipient_state: 'VA', total_obligated: 1e6, award_count: 3, won_set_aside: true, match_reason: 'naics' }], total: 1, unavailable: false };
    return { rows: [], total: null, unavailable: mode === 'unavailable' };
  }),
}));
vi.mock('@/lib/mcp/external-cache', () => ({
  LAST_GOOD_MAX_AGE_SECONDS: 2592000,
  getLastGood: vi.fn(async (_t: string, p: Record<string, unknown>) => snapshots.get(JSON.stringify(p)) ?? null),
  setCached: vi.fn(async (_t: string, p: Record<string, unknown>, v: unknown) => { setCachedCalls.push(v); snapshots.set(JSON.stringify(p), { value: v, fetchedAt: '2026-11-10T12:00:00.000Z' }); }),
}));

const { makeTier2Tools } = await import('./tier2-tools');
const run = (args: Record<string, unknown>) => makeTier2Tools('u@x.com').execute('find_capable_contractors', args);

beforeEach(() => { mode = 'ok'; snapshots.clear(); setCachedCalls.length = 0; });

describe('find_capable_contractors: an outage is never "none found"', () => {
  it('a BigQuery outage with no saved answer says the source is unavailable, not zero', async () => {
    mode = 'unavailable';
    const r = await run({ naics: '541512' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('source_unavailable');
    expect(String(r.note)).not.toMatch(/No contractors found/);
    expect(String(r.note)).toMatch(/NOT "none found"/);
  });

  it('a live success is snapshotted; a later outage serves that snapshot, dated and labelled', async () => {
    const live = await run({ naics: '541512' });
    expect(live).toMatchObject({ ok: true, count: 1, served_from: 'live' });
    expect(setCachedCalls).toHaveLength(1);
    mode = 'unavailable';
    const r = await run({ naics: '541512' });
    expect(r).toMatchObject({ count: 1, degraded: true, served_from: 'last_good', snapshot_at: '2026-11-10T12:00:00.000Z' });
    expect(String(r.note)).toMatch(/saved answer from 2026-11-10/);
    const { classifyBillingOutcome } = await import('@/lib/mcp/credit-integrity');
    expect(classifyBillingOutcome(r)).toBe('nonbillable_system_failure');
  });

  it('a genuine empty answer (BigQuery answered) still says none found and is not snapshotted', async () => {
    mode = 'empty';
    const r = await run({ naics: '999999' });
    expect(r).toMatchObject({ ok: true, count: 0 });
    expect(String(r.note)).toMatch(/No contractors found/);
    expect(setCachedCalls).toHaveLength(0);
  });
});
