/**
 * GET /api/app/recompete-row — by-id Awarded pin for Share restore.
 *
 * Hermetic: mock supabase. Honest 404 / 400 / 500 — never empty-as-zero.
 * Fixture id is Charlie Whitfield's shared contract_id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHARLIE = 'CONT_AWD_36C24721F0485_3600_GS07F0168T_4730';

const FIXTURE_ROW = {
  contract_id: CHARLIE,
  piid: '36C24721F0485',
  incumbent_name: 'VA DECATUR INCUMBENT',
  incumbent_uei: 'UEI123456789',
  awarding_agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  awarding_sub_agency: 'VETERANS AFFAIRS',
  naics_code: '561210',
  naics_description: 'Facilities Support Services',
  potential_total_value: 575284,
  total_obligation: 400000,
  period_of_performance_current_end: '2027-03-15',
  set_aside_type: null,
  contract_type: 'DELIVERY ORDER',
  place_of_performance_city: 'Decatur',
  place_of_performance_state: 'GA',
  map_lat: 33.7748,
  map_lng: -84.2963,
  map_loc_source: 'task_order_city',
  last_synced_at: '2026-08-01T00:00:00Z',
};

type QueryState = {
  rows: Record<string, unknown>[];
  error: { message: string } | null;
  eqs: { col: string; val: unknown }[];
};

const state: QueryState = { rows: [], error: null, eqs: [] };

function makeBuilder() {
  let filtered = [...state.rows];
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = () => self();
  api.eq = (col: string, val: unknown) => {
    state.eqs.push({ col, val });
    filtered = filtered.filter((r) => String(r[col] ?? '') === String(val));
    return self();
  };
  api.limit = () => self();
  api.maybeSingle = async () => {
    if (state.error) return { data: null, error: state.error };
    return { data: filtered[0] ?? null, error: null };
  };
  // Thenable so `await db.from().select().eq().limit(1)` resolves to {data, error}.
  (api as { then: (res: (v: unknown) => void) => void }).then = (res) => {
    if (state.error) res({ data: null, error: state.error });
    else res({ data: filtered, error: null });
  };
  return api;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => makeBuilder() }),
}));

import { GET } from './route';

function req(qs: string) {
  return { nextUrl: new URL(`https://x.test/api/app/recompete-row?${qs}`) } as unknown as import('next/server').NextRequest;
}

describe('GET /api/app/recompete-row', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'y';
    state.rows = [FIXTURE_ROW];
    state.error = null;
    state.eqs = [];
  });

  it('finds Charlie’s award by contract_id and returns a toPin-shaped pin', async () => {
    const res = await GET(req(`id=${CHARLIE}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.pin).toBeTruthy();
    expect(body.pin.id).toBe(CHARLIE);
    expect(body.pin.sol).toBe('36C24721F0485');
    expect(body.pin.src).toBe('RECOMPETE');
    expect(body.pin.title).toBe('VA DECATUR INCUMBENT');
    expect(body.pin.loc).toMatch(/Decatur/);
    expect(body.pin.agency).toMatch(/VETERANS AFFAIRS/i);
    expect(state.eqs[0]).toEqual({ col: 'contract_id', val: CHARLIE });
  });

  it('falls back to piid when contract_id misses', async () => {
    const res = await GET(req('id=36C24721F0485'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.pin.id).toBe(CHARLIE);
    expect(state.eqs.map((e) => e.col)).toEqual(['contract_id', 'piid']);
  });

  it('returns 400 when id is missing — never an empty success', async () => {
    const res = await GET(req(''));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.pin).toBeUndefined();
    expect(body.error).toBe('missing id');
  });

  it('returns honest 404 for an unknown id — not empty-as-zero', async () => {
    const res = await GET(req('id=CONT_AWD_DOES_NOT_EXIST'));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.pin).toBeUndefined();
    expect(body.error).toBe('not found');
  });

  it('returns 500 on a query error — not a fabricated empty pin', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.error = { message: 'relation missing' };
    const res = await GET(req(`id=${CHARLIE}`));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.pin).toBeUndefined();
    expect(body.error).toBe('lookup failed');
    errSpy.mockRestore();
  });
});

describe('route is a sibling of recompete-detail, not an overload', () => {
  it('does not live in recompete-detail and reuses shared toPin', () => {
    const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
    expect(src).toContain("from '@/lib/recompete/map-pin'");
    expect(src).toContain('toPin');
    expect(src).toContain("eq('contract_id'");
    expect(src).toContain("eq('piid'");
    expect(src).not.toContain('buildOppIntel');
  });
});
