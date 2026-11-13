/** SEO cold-lookup usage metrics (2026-11-13): measurement must never change a budget decision. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  store: new Map<string, number>(), hll: new Map<string, Set<string>>(), ops: [] as string[], pipelineFails: false,
}));
vi.mock('@vercel/kv', () => {
  const kv = {
    incr: vi.fn(async (k: string) => { const v = (m.store.get(k) ?? 0) + 1; m.store.set(k, v); return v; }),
    expire: vi.fn(async () => 1),
    get: vi.fn(async (k: string) => m.store.get(k) ?? null),
    pfcount: vi.fn(async (k: string) => m.hll.get(k)?.size ?? 0),
    pipeline: () => {
      const q: Array<() => void> = [];
      const p = {
        incr: (k: string) => { q.push(() => { m.ops.push(`incr ${k}`); m.store.set(k, (m.store.get(k) ?? 0) + 1); }); return p; },
        expire: (k: string) => { q.push(() => m.ops.push(`expire ${k}`)); return p; },
        pfadd: (k: string, v: string) => { q.push(() => { const s = m.hll.get(k) ?? new Set(); s.add(v); m.hll.set(k, s); }); return p; },
        exec: async () => { if (m.pipelineFails) throw new Error('KV down'); q.forEach((f) => f()); return []; },
      };
      return p;
    },
  };
  return { kv };
});

import { recordColdDecision, recordColdOutcome, readKindDay, mergeDemandHistory, DEMAND_OPEN, DEMAND_CLOSE } from './lookup-metrics';
import { takeSeoColdBudget } from './seo-unavailable';

const NOW = new Date('2026-11-14T12:00:00Z');
beforeEach(() => { m.store.clear(); m.hll.clear(); m.ops = []; m.pipelineFails = false; delete process.env.SEO_CONTRACTOR_COLD_LOOKUPS_PER_DAY; });

describe('recording', () => {
  it('counts allowed vs refused and unique ids requested vs looked up', async () => {
    await recordColdDecision('award', true, 'A1', NOW);
    await recordColdDecision('award', true, 'A1', NOW);   // same id twice: unique stays 1
    await recordColdDecision('award', false, 'A2', NOW);  // refused: requested, not looked up
    await recordColdOutcome('award', 'found', NOW);
    await recordColdOutcome('award', 'missing', NOW);
    m.store.set('rl:seo-award-cold:2026-11-14', 3);
    const d = await readKindDay('award', '2026-11-14');
    expect(d).toEqual({ attempts: 3, allowed: 2, refused: 1, uniqueRequested: 2, uniqueLookedUp: 1, outcomes: { found: 1, missing: 1, failed: 0 } });
  });
  it('every metric key expires (4 days), so nothing grows forever', async () => {
    await recordColdDecision('contracts', true, 'x/1', NOW);
    const incrs = m.ops.filter((o) => o.startsWith('incr ')).map((o) => o.slice(5));
    for (const k of incrs) expect(m.ops).toContain(`expire ${k}`);
  });
});

describe('measurement never changes the budget decision', () => {
  it('a KV failure in the metrics pipeline still returns the real decision', async () => {
    m.pipelineFails = true;
    process.env.SEO_CONTRACTOR_COLD_LOOKUPS_PER_DAY = '1';
    expect(await takeSeoColdBudget('contractor', NOW, 'slug-a')).toBe(true);
    expect(await takeSeoColdBudget('contractor', NOW, 'slug-b')).toBe(false);
  });
  it('budget decisions are recorded with the requested id', async () => {
    process.env.SEO_CONTRACTOR_COLD_LOOKUPS_PER_DAY = '1';
    await takeSeoColdBudget('contractor', NOW, 'slug-a');
    await takeSeoColdBudget('contractor', NOW, 'slug-b');
    const d = await readKindDay('contractor', '2026-11-14');
    expect(d).toMatchObject({ attempts: 2, allowed: 1, refused: 1, uniqueRequested: 2, uniqueLookedUp: 1 });
  });
});

describe('daily history in data_sources', () => {
  it('replaces the same date, keeps order, caps at 60 days', () => {
    const notes = (h: unknown[]) => `x\n\n${DEMAND_OPEN}\n${JSON.stringify({ history: h })}\n${DEMAND_CLOSE}`;
    const days = Array.from({ length: 60 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`.replace(/-(3\d|[4-6]\d)$/, (d) => d) }));
    const merged = mergeDemandHistory(notes(days), { date: '2026-11-14' });
    expect(merged).toHaveLength(60);
    expect(merged.at(-1)).toEqual({ date: '2026-11-14' });
    const again = mergeDemandHistory(notes([{ date: '2026-11-14', v: 1 }]), { date: '2026-11-14', v: 2 } as never);
    expect(again).toEqual([{ date: '2026-11-14', v: 2 }]);
  });
  it('starts a history when there is none', () => {
    expect(mergeDemandHistory(null, { date: '2026-11-14' })).toEqual([{ date: '2026-11-14' }]);
  });
});
