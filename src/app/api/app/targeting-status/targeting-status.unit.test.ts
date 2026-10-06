/**
 * /api/app/targeting-status through the REAL route handlers. Supabase is a recording fake.
 * Proves: a new email signup with no targeting is TOLD why alerts have not started (server truth);
 * a starter-code profile is told its alerts run on starter codes; typed codes are offered with
 * titles and never written by this route; a rejection is persisted merge-preserving; a read error
 * is a 500, never a guessed state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
});
type Row = Record<string, unknown>;
const state = { settings: null as Row | null, business: null as Row | null, settingsError: null as { message: string } | null, updates: [] as Row[] };

function builder(table: string) {
  let mode: 'select' | 'update' = 'select';
  let payload: Row = {};
  const b: Record<string, unknown> = {};
  const proxy: Record<string, unknown> = new Proxy(b, { get: (t, p: string) => (p in t ? t[p] : () => proxy) });
  b.update = (p: Row) => { mode = 'update'; payload = p; return proxy; };
  b.maybeSingle = () => Promise.resolve(
    table === 'user_notification_settings'
      ? { data: state.settingsError ? null : state.settings, error: state.settingsError }
      : { data: state.business, error: null },
  );
  b.then = (resolve: (v: unknown) => unknown) => {
    if (mode === 'update') { state.updates.push(payload); return Promise.resolve({ error: null, count: 1 }).then(resolve); }
    return Promise.resolve({ data: [], error: null }).then(resolve);
  };
  return proxy;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: () => ({ ok: true }) }));

const { GET, POST } = await import('./route');
const get = async () => (await GET(new NextRequest('https://x/api/app/targeting-status?email=new@example.com'))).json();

beforeEach(() => { state.settings = null; state.business = null; state.settingsError = null; state.updates = []; });

describe('GET /api/app/targeting-status', () => {
  it('a new email signup with no targeting is told why personalized alerts have not started', async () => {
    state.settings = { naics_codes: [], keywords: [], naics_source: null, alerts_enabled: true, alert_frequency: 'daily', is_active: true };
    const j = await get();
    expect(j.state).toBe('none');
    expect(j.notice).toMatch(/alerts haven’t started/);
    expect(j.setupPath).toBe('/welcome/company');
  });

  it('starter codes with NULL provenance are named as starter codes, not a business profile', async () => {
    state.settings = { naics_codes: ['541512', '541611', '541330', '541990', '561210'], keywords: [], naics_source: null, alerts_enabled: true, alert_frequency: 'daily', is_active: true };
    const j = await get();
    expect(j.state).toBe('starter_codes');
    expect(j.notice).toMatch(/starter codes/);
  });

  it('offers typed codes with titles from either description source, minus stored and rejected', async () => {
    state.settings = {
      naics_codes: ['541611'], keywords: [], naics_source: null, alerts_enabled: true, alert_frequency: 'daily', is_active: true,
      business_description: 'We do 541611 and 484110.', aggregated_profile: { typed_code_decisions: { rejected: ['484121'] } },
    };
    state.business = { business_description: 'trucking 484121 and 484110' };
    const j = await get();
    expect(j.typedCodeOffers.map((o: { code: string }) => o.code)).toEqual(['484110']);
    expect(j.typedCodeOffers[0].title).toMatch(/Trucking/i);
    expect(state.updates).toHaveLength(0); // a read never writes
  });

  it('a settings read error is a 500, never a guessed "none"', async () => {
    state.settingsError = { message: 'boom' };
    const res = await GET(new NextRequest('https://x/api/app/targeting-status?email=new@example.com'));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/app/targeting-status', () => {
  const post = (body: Row) => POST(new NextRequest('https://x/api/app/targeting-status', { method: 'POST', body: JSON.stringify(body) }));

  it('persists a typed-code rejection without touching naics_codes or other profile keys', async () => {
    state.settings = { aggregated_profile: { alert_mode: 'focused' } };
    const res = await post({ email: 'new@example.com', action: 'reject_typed_code', code: '484110' });
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0])).toEqual(['aggregated_profile']);
    expect(state.updates[0].aggregated_profile).toMatchObject({ alert_mode: 'focused', typed_code_decisions: { rejected: ['484110'] } });
  });

  it('refuses an unknown code and any action other than reject', async () => {
    state.settings = { aggregated_profile: {} };
    expect((await post({ email: 'new@example.com', action: 'reject_typed_code', code: '999999' })).status).toBe(400);
    expect((await post({ email: 'new@example.com', action: 'accept_typed_code', code: '484110' })).status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});
