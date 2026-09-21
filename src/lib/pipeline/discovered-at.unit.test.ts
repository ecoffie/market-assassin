/**
 * resolveDiscoveredAt honesty contract (#122, the decision-time metric).
 *
 * The resolver must NEVER fabricate a discovery moment: it returns an EARLIER real view when one
 * exists, floors to now() otherwise, floors to now() on any lookup error, and never fails the save.
 * So decision_time = created_at − discovered_at can only ever UNDERstate, never invent days.
 */
import { describe, it, expect } from 'vitest';
import { resolveDiscoveredAt } from './discovered-at';

const NOW = '2026-08-07T20:00:00.000Z';

// Minimal chainable Supabase stub: the terminal maybeSingle() resolves to a configured result.
function stub(result: { data?: { created_at: string } | null; error?: { message: string } | null }) {
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  for (const m of ['select', 'eq', 'or', 'order', 'limit']) chain[m] = ret;
  chain.maybeSingle = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  return { from: () => chain } as unknown as Parameters<typeof resolveDiscoveredAt>[0];
}

describe('resolveDiscoveredAt — honest floor, never fabricates', () => {
  it('returns an EARLIER logged view when one exists (a real decision-time gap)', async () => {
    const earlier = '2026-08-01T09:00:00.000Z';
    const got = await resolveDiscoveredAt(stub({ data: { created_at: earlier } }), {
      userEmail: 'u@x.com', noticeId: 'abc123', nowIso: NOW,
    });
    expect(got).toBe(earlier); // 6 days of decision time, grounded in a real view
  });

  it('floors to now() when NO earlier view is found (same-visit save = 0 days, honest)', async () => {
    const got = await resolveDiscoveredAt(stub({ data: null }), {
      userEmail: 'u@x.com', noticeId: 'abc123', nowIso: NOW,
    });
    expect(got).toBe(NOW);
  });

  it('floors to now() when the logged view is NOT actually earlier than now (never a future gap)', async () => {
    const later = '2026-08-09T00:00:00.000Z'; // after now — must be ignored
    const got = await resolveDiscoveredAt(stub({ data: { created_at: later } }), {
      userEmail: 'u@x.com', noticeId: 'abc123', nowIso: NOW,
    });
    expect(got).toBe(NOW);
  });

  it('floors to now() on a lookup ERROR — never fails the save', async () => {
    const got = await resolveDiscoveredAt(stub({ error: { message: 'db down' } }), {
      userEmail: 'u@x.com', noticeId: 'abc123', nowIso: NOW,
    });
    expect(got).toBe(NOW);
  });

  it('floors to now() with no notice id (nothing to look up)', async () => {
    const got = await resolveDiscoveredAt(stub({ data: { created_at: '2020-01-01T00:00:00.000Z' } }), {
      userEmail: 'u@x.com', noticeId: null, nowIso: NOW,
    });
    expect(got).toBe(NOW); // short-circuits BEFORE any query — the stub's earlier date is never read
  });
});
