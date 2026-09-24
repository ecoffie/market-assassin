/**
 * Recompete performance Gate 1 (2026-09-24): the 1,000-pin page must not depend on the query plan.
 *
 * The page orders by expiry date. Before this gate that was the ONLY key, so when more than 1,000
 * matching contracts share expiry dates, WHICH tied contracts made the cut was whatever order the
 * plan produced. Measured on prod: "software license" produced 5 DIFFERENT pages across 6 valid plans
 * of the same query (tasks/recompete-gate1-2026-09-24.md). contract_id is now the tie-breaker.
 *
 * This drives the REAL route against an in-memory PostgREST stand-in whose order()/limit()/range()/
 * in()/eq(data_source) are executed for real (search filters are no-ops: every fixture row matches).
 * A different INPUT order stands in for a different plan: JS sort is stable, so ties come back in the
 * order the "plan" produced them — exactly the plan-dependence being guarded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
let FIXTURE: Row[] = [];

class Q {
  private f: Array<(r: Row) => boolean> = [];
  private o: Array<[string, boolean]> = [];
  private lim = Infinity; private from = 0; private to = Infinity; private head = false; private count = false;
  select(_c?: string, opts?: { head?: boolean; count?: string }) { this.head = !!opts?.head; this.count = !!opts?.count; return this; }
  eq(c: string, v: unknown) { if (c === 'data_source') this.f.push((r) => r.data_source === v); return this; }
  in(c: string, vals: unknown[]) { this.f.push((r) => vals.includes(r[c])); return this; }
  not(c: string) { if (c === 'map_lat') this.f.push((r) => r.map_lat != null); return this; }
  is(c: string, v: unknown) { if (c === 'map_lat' && v === null) this.f.push((r) => r.map_lat == null); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.o.push([c, o?.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.from = a; this.to = b; return this; }
  gte() { return this; } lte() { return this; } or() { return this; } ilike() { return this; } like() { return this; } neq() { return this; }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
    let rs = FIXTURE.filter((r) => this.f.every((fn) => fn(r)));
    const n = rs.length;
    if (this.o.length) rs = [...rs].sort((a, b) => { for (const [c, asc] of this.o) { if (String(a[c]) < String(b[c])) return asc ? -1 : 1; if (String(a[c]) > String(b[c])) return asc ? 1 : -1; } return 0; });
    const end = Math.min(this.to + 1, this.from + this.lim, this.from + 1000);   // PostgREST: ≤1,000 rows/response
    const out = this.head ? { data: null, count: n, error: null } : { data: rs.slice(this.from, end), count: this.count ? n : null, error: null };
    return Promise.resolve(out).then(res, rej);
  }
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => new Q() }) }));

const DAY = '2026-11-30';
function fixture(): Row[] {
  const rows: Row[] = [];
  // 1,200 regular contracts ALL expiring the same day → the tie crosses the 1,000-pin cap.
  for (let i = 0; i < 1200; i++) rows.push({ contract_id: `CONT_${String(i).padStart(5, '0')}`, period_of_performance_current_end: DAY, data_source: 'usaspending', map_lat: 38, map_lng: -77, naics_code: '541512' });
  // 250 follow-ons (> the 100-id chunk) expiring later — never in the capped page, always merged in.
  for (let i = 0; i < 250; i++) rows.push({ contract_id: `FOLLOW_${String(i).padStart(4, '0')}`, period_of_performance_current_end: '2030-01-01', data_source: 'usaspending_followon', map_lat: 38, map_lng: -77, naics_code: '541512' });
  return rows;
}
function shuffled(rows: Row[], seed: number): Row[] {
  const a = [...rows]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
async function callRoute(): Promise<{ pins: Array<{ id: string }>; totalInView: number; capped: boolean }> {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest('https://getmindy.ai/api/app/recompete-map?bbox=-125,24,-66.9,49.6&naics=541512'));
  return res.json();
}

describe('the 1,000-pin page is identical under any plan (expiry → contract_id)', () => {
  const base = fixture();
  beforeEach(() => { vi.resetModules(); });

  it('three different "plans" (input orders) return the byte-identical page, and it is the lowest 1,000 contract_ids', async () => {
    const pages: string[] = [];
    for (const seed of [1, 7, 42]) {
      FIXTURE = shuffled(base, seed);
      const d = await callRoute();
      const regular = d.pins.filter((p) => p.id.startsWith('CONT_'));
      expect(regular).toHaveLength(1000);
      pages.push(JSON.stringify(regular.map((p) => p.id)));
    }
    expect(new Set(pages).size).toBe(1);
    const expected = base.filter((r) => String(r.contract_id).startsWith('CONT_')).map((r) => String(r.contract_id)).sort().slice(0, 1000);
    expect(JSON.parse(pages[0])).toEqual(expected);
  });

  it('control: with expiry as the ONLY key the same fixture DOES change page across plans (the test would catch a regression)', () => {
    const pageOld = (rows: Row[]) => [...rows].filter((r) => r.data_source !== 'usaspending_followon')
      .sort((a, b) => String(a.period_of_performance_current_end).localeCompare(String(b.period_of_performance_current_end)))
      .slice(0, 1000).map((r) => r.contract_id).join(',');
    expect(pageOld(shuffled(base, 1))).not.toBe(pageOld(shuffled(base, 7)));
  });

  it('follow-ons: the identical 250-id set on every plan, merged after the page, in contract_id order (crosses the 100-id chunk)', async () => {
    const sets: string[] = [];
    for (const seed of [3, 11]) {
      FIXTURE = shuffled(base, seed);
      const d = await callRoute();
      const fo = d.pins.filter((p) => p.id.startsWith('FOLLOW_')).map((p) => p.id);
      expect(fo).toHaveLength(250);
      expect(fo).toEqual([...fo].sort());
      sets.push(fo.join(','));
    }
    expect(sets[0]).toBe(sets[1]);
  });
});
