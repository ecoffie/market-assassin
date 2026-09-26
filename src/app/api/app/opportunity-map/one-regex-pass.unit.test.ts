/**
 * #1696 OPEN-COLD-START — one regex pass per Open request.
 *
 * Measured 2026-09-26: a text query ("software license") is a `~*` over title / description /
 * sow_text / department / solicitation_number — ~1 s of CPU per pass on a 2-core database. Every
 * Open request with market counts ran that pass TWICE (headline-count walk + viewport). A cold page
 * load aborts its first Open round and re-fires; the aborted request's statements keep running, so
 * the passes pile up and Open crosses PostgREST's 8 s `authenticator` statement_timeout → HTTP 500
 * "canceling statement due to statement timeout". Reproduced: 4 concurrent Opens → 4/4 500 (cold
 * preview AND warm production); after the fix 4/4 and 6/6 → 200.
 *
 * This drives the REAL route against an in-memory PostgREST stand-in that executes the bbox,
 * order, range and count for real (text predicates are no-ops: every fixture row "matches") and
 * records every query. The guard: when the filtered set fits one page, NO bbox query runs — and
 * the derived pins equal what the viewport query would have returned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
let FIXTURE: Row[] = [];
let FAIL_WITH: { message: string; code: string } | null = null;
type Rec = { table: string; cols: string; bbox: boolean; head: boolean; ids: number };
let LOG: Rec[] = [];

class Q {
  private f: Array<(r: Row) => boolean> = [];
  private o: Array<[string, boolean]> = [];
  private lim = Infinity; private from = 0; private to = Infinity; private head = false; private count = false;
  private cols = ''; private bbox = false; private ids = 0;
  constructor(private table: string) {}
  select(c?: string, opts?: { head?: boolean; count?: string }) { this.cols = c ?? ''; this.head = !!opts?.head; this.count = !!opts?.count; return this; }
  not(c: string) { if (c === 'map_lat') this.f.push((r) => r.map_lat != null); return this; }
  is(c: string, v: unknown) { if (c === 'map_lat' && v === null) this.f.push((r) => r.map_lat == null); return this; }
  gte(c: string, v: number) { if (c === 'map_lat' || c === 'map_lng') { this.bbox = true; this.f.push((r) => r[c] != null && (r[c] as number) >= v); } return this; }
  lte(c: string, v: number) { if (c === 'map_lat' || c === 'map_lng') this.f.push((r) => r[c] != null && (r[c] as number) <= v); return this; }
  in(c: string, vals: unknown[]) { this.ids = vals.length; this.f.push((r) => vals.includes(r[c])); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.o.push([c, o?.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.from = a; this.to = b; return this; }
  eq() { return this; } gt() { return this; } lt() { return this; } or() { return this; } ilike() { return this; }
  like() { return this; } neq() { return this; } contains() { return this; } match() { return this; } filter() { return this; }
  maybeSingle() { return Promise.resolve({ data: null, error: null }); }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
    if (this.table !== 'sam_opportunities') return Promise.resolve({ data: [], count: 0, error: null }).then(res, rej);
    LOG.push({ table: this.table, cols: this.cols, bbox: this.bbox, head: this.head, ids: this.ids });
    if (FAIL_WITH) return Promise.resolve({ data: null, count: null, error: FAIL_WITH }).then(res, rej);
    let rs = FIXTURE.filter((r) => this.f.every((fn) => fn(r)));
    const n = rs.length;
    if (this.o.length) rs = [...rs].sort((a, b) => { for (const [c, asc] of this.o) { if (String(a[c]) < String(b[c])) return asc ? -1 : 1; if (String(a[c]) > String(b[c])) return asc ? 1 : -1; } return 0; });
    const end = Math.min(this.to + 1, this.from + this.lim, this.from + 1000); // PostgREST: ≤1,000 rows/response
    const out = this.head ? { data: null, count: n, error: null } : { data: rs.slice(this.from, end), count: this.count ? n : null, error: null };
    return Promise.resolve(out).then(res, rej);
  }
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => new Q(t) }) }));

function fixture(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      notice_id: `n${String(i).padStart(5, '0')}`,
      solicitation_number: `SOL${Math.floor(i / 2)}`,            // two notices per listing
      title: `Software license renewal ${i}`, department: 'VETERANS AFFAIRS, DEPARTMENT OF',
      response_deadline: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T17:00:00+00:00`,
      posted_date: '2026-09-01', naics_code: '511210',
      map_lat: i % 5 === 0 ? null : 30 + (i % 20),                // every 5th row is unmapped
      map_lng: -120 + (i % 50),
    });
  }
  return rows;
}
const BBOX = '-110,32,-80,45';
async function callRoute(qs: string) {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest(`https://getmindy.ai/api/app/opportunity-map?bbox=${BBOX}&sources=sam&${qs}`));
  return { status: res.status, body: await res.json() };
}
const viewportQueries = () => LOG.filter((r) => r.bbox);

describe('#1696 — a text query evaluates its regex once per Open request', () => {
  beforeEach(() => { vi.resetModules(); LOG = []; FAIL_WITH = null; });

  it('filtered set ≤ 1,000 rows: no second (viewport) pass, and the pins are exactly set ∩ bbox by deadline', async () => {
    FIXTURE = fixture(600);
    const { status, body } = await callRoute('q=software%20license');
    expect(status).toBe(200);
    expect(viewportQueries()).toHaveLength(0);                       // ← the regression guard
    // Everything the old viewport query would have returned, computed independently:
    const inBbox = FIXTURE.filter((r) => r.map_lat != null && (r.map_lat as number) >= 32 && (r.map_lat as number) <= 45
      && (r.map_lng as number) >= -110 && (r.map_lng as number) <= -80);
    const listings = new Set(inBbox.map((r) => r.solicitation_number));
    expect(body.totalInView).toBe(body.pins.length);
    expect(new Set(body.pins.map((p: { sol: string }) => p.sol))).toEqual(listings);
    const mapped = FIXTURE.filter((r) => r.map_lat != null);
    expect(body.totalForFilters).toBe(new Set(mapped.map((r) => r.solicitation_number)).size);
    expect(body.unmappedForFilters).toBe(FIXTURE.length - mapped.length);
  });

  it('filtered set > 1,000 rows: today\'s viewport query runs (a capped LIMIT is plan-ordered; JS cannot reproduce it)', async () => {
    FIXTURE = fixture(2600);
    const { status } = await callRoute('q=software%20license');
    expect(status).toBe(200);
    expect(viewportQueries()).toHaveLength(1);
  });

  it('no regex in the plan (NAICS only): unchanged — the viewport query runs as before', async () => {
    FIXTURE = fixture(300);
    await callRoute('naics=511210');
    expect(viewportQueries()).toHaveLength(1);
  });

  it('pan (counts=0): unchanged — only the viewport query, no walk', async () => {
    FIXTURE = fixture(300);
    await callRoute('q=software%20license&counts=0');
    expect(viewportQueries()).toHaveLength(1);
    expect(LOG.filter((r) => !r.bbox && !r.head)).toHaveLength(0);
  });

  it('a legitimate zero stays zero (200, not an error)', async () => {
    FIXTURE = [];
    const { status, body } = await callRoute('q=software%20license');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.totalForFilters).toBe(0);
    expect(body.pins).toEqual([]);
  });

  it('a statement timeout stays a failure (500 with the reason), never a zero market', async () => {
    FIXTURE = fixture(50);
    FAIL_WITH = { message: 'canceling statement due to statement timeout', code: '57014' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, body } = await callRoute('q=software%20license');
    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/statement timeout/);
    expect(body.totalForFilters).toBeUndefined();
    expect(err.mock.calls.some((c) => c.join(' ').includes('57014'))).toBe(true); // reason reaches the logs
    err.mockRestore();
  });
});
