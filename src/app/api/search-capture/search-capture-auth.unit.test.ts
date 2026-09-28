/**
 * SEC-4 — /api/search-capture must only let a VERIFIED identity touch that identity's
 * search history and alert targeting.
 *
 * Before: POST took `user_email` from the body and appended the search value to that
 * address's `user_notification_settings` keywords / naics / agencies — no auth at all, so
 * anyone could rewrite anyone's alert targeting. GET took `?email=` and returned that
 * address's last 100 searches plus its entire settings row.
 *
 * Invariant: the write/read target is the address the request PROVES (Mindy session token or
 * Supabase session). Never the body email, a query param, the plaintext `ma_access_email`
 * cookie, or a claimed staff address on its own.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Op = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };
const ops: Op[] = [];

function chain(table: string) {
  const rec: Op = { table, op: 'select', filters: [] };
  const q: Record<string, unknown> = {};
  const done = () => {
    ops.push(rec);
    if (rec.op === 'insert' || rec.op === 'update') return { data: null, error: null };
    if (table === 'user_notification_settings') return { data: { keywords: [], aggregated_profile: {} }, error: null };
    return { data: [], error: null };
  };
  Object.assign(q, {
    select: () => q,
    insert: (p: unknown) => { rec.op = 'insert'; rec.payload = p; return Promise.resolve(done()); },
    update: (p: unknown) => { rec.op = 'update'; rec.payload = p; return q; },
    eq: (c: string, v: unknown) => { rec.filters.push([c, v]); return rec.op === 'update' ? Promise.resolve(done()) : q; },
    order: () => q,
    limit: () => Promise.resolve(done()),
    maybeSingle: () => Promise.resolve(done()),
  });
  return q;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => chain(t), auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
process.env.TWO_FACTOR_SECRET = 'test-secret-sec4';

const VICTIM = 'victim@example.com';
const ATTACKER = 'attacker@example.com';

async function load() {
  const route = await import('./route');
  const { createMIAuthSessionToken } = await import('@/lib/two-factor-session');
  return { ...route, tokenFor: (e: string) => createMIAuthSessionToken(e) as string };
}

function post(body: Record<string, unknown>, headers: Record<string, string> = {}, qs = '') {
  return new NextRequest(`https://getmindy.ai/api/search-capture${qs}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}
const body = (email: string) => ({ user_email: email, tool: 'opportunity_hunter', search_type: 'keyword', search_value: 'drone lidar' });
const writes = () => ops.filter((o) => o.op === 'insert' || o.op === 'update');
const touched = () => ops.flatMap((o) => o.filters.map((f) => f[1]).concat(o.op === 'insert' ? [(o.payload as { user_email: string }).user_email] : []));

beforeEach(() => { ops.length = 0; });

describe('POST — forged or missing identity never mutates anyone', () => {
  it('no auth at all → 401, nothing written', async () => {
    const { POST } = await load();
    const res = await POST(post(body(VICTIM)));
    expect(res.status).toBe(401);
    expect(writes()).toHaveLength(0);
  });
  it('plaintext ma_access_email cookie naming the victim → 401', async () => {
    const { POST } = await load();
    const res = await POST(post(body(VICTIM), { cookie: `ma_access_email=${VICTIM}` }));
    expect(res.status).toBe(401);
    expect(writes()).toHaveLength(0);
  });
  it('a claimed staff address with no proof → 401', async () => {
    const { POST } = await load();
    const res = await POST(post(body('eric@govcongiants.com')));
    expect(res.status).toBe(401);
    expect(writes()).toHaveLength(0);
  });
  it("attacker's valid session + victim's email in the body → 401, victim untouched", async () => {
    const { POST, tokenFor } = await load();
    const res = await POST(post(body(VICTIM), { 'x-mi-auth-token': tokenFor(ATTACKER) }));
    expect(res.status).toBe(401);
    expect(writes()).toHaveLength(0);
    expect(touched()).not.toContain(VICTIM);
  });
  it('?email= query param naming the victim is not identity → 401', async () => {
    const { POST } = await load();
    const res = await POST(post(body(VICTIM), {}, `?email=${VICTIM}`));
    expect(res.status).toBe(401);
    expect(writes()).toHaveLength(0);
  });
  it('a forged/garbage token → 401', async () => {
    const { POST } = await load();
    const res = await POST(post(body(VICTIM), { 'x-mi-auth-token': 'eyJlbWFpbCI6InZpY3RpbUBleGFtcGxlLmNvbSJ9.forged' }));
    expect(res.status).toBe(401);
    expect(writes()).toHaveLength(0);
  });
});

describe('POST — a verified session writes only its own rows', () => {
  it('valid session for the same address → 200, history + targeting written for that address only', async () => {
    const { POST, tokenFor } = await load();
    const res = await POST(post(body(ATTACKER.toUpperCase()), { 'x-mi-auth-token': tokenFor(ATTACKER) }));
    expect(res.status).toBe(200);
    const ins = ops.find((o) => o.op === 'insert')!;
    expect((ins.payload as { user_email: string }).user_email).toBe(ATTACKER);
    expect(new Set(touched())).toEqual(new Set([ATTACKER]));
  });
});

describe('GET — search history and the settings row are not readable by email', () => {
  it('?email=victim with no auth → 401, nothing read', async () => {
    const { GET } = await load();
    const res = await GET(new NextRequest(`https://getmindy.ai/api/search-capture?email=${VICTIM}`));
    expect(res.status).toBe(401);
    expect(ops).toHaveLength(0);
  });
  it("attacker's session asking for the victim → 401, nothing read", async () => {
    const { GET, tokenFor } = await load();
    const res = await GET(new NextRequest(`https://getmindy.ai/api/search-capture?email=${VICTIM}`, { headers: { 'x-mi-auth-token': tokenFor(ATTACKER) } }));
    expect(res.status).toBe(401);
    expect(ops).toHaveLength(0);
  });
  it('own session → 200 with own history', async () => {
    const { GET, tokenFor } = await load();
    const res = await GET(new NextRequest(`https://getmindy.ai/api/search-capture?email=${ATTACKER}`, { headers: { 'x-mi-auth-token': tokenFor(ATTACKER) } }));
    expect(res.status).toBe(200);
    expect(new Set(touched())).toEqual(new Set([ATTACKER]));
  });
});
