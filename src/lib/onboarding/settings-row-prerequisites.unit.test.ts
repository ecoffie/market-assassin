/**
 * P0-H — missing user_notification_settings rows (24.1% of signed-up users on 2026-09-27).
 * Drives the REAL route handlers against an in-memory database that records every operation.
 *
 *  - saves no longer depend on a settings row (the row was only an existence gate);
 *  - no route reports success for a write that matched nothing;
 *  - rows are created only through ensureFreeSettingsRow, only on an explicit, authenticated
 *    action, never with alerts turned on as a side effect, and never over an existing row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { table: string; op: string; payload?: Row; opts?: Record<string, unknown> };
const db: { tables: Record<string, Row[]>; ops: Op[] } = { tables: {}, ops: [] };
const T = (n: string) => (db.tables[n] ??= []);

function from(name: string) {
  const rows = T(name);
  let op = 'select'; let payload: Row = {}; let opts: Record<string, unknown> = {};
  const eqs: [string, unknown][] = [];
  const match = (r: Row) => eqs.every(([c, v]) => r[c] === v);
  const run = () => {
    db.ops.push({ table: name, op, payload, opts });
    if (op === 'upsert') {
      const key = String(opts.onConflict || 'id').split(',');
      const i = rows.findIndex((r) => key.every((k) => r[k] === payload[k]));
      if (i >= 0) { if (opts.ignoreDuplicates) return { data: null, count: 0, error: null }; rows[i] = { ...rows[i], ...payload }; return { data: { id: 'x', ...rows[i] }, count: 1, error: null }; }
      rows.push({ ...payload }); return { data: { id: 'x', ...payload }, count: 1, error: null };
    }
    if (op === 'insert') { rows.push({ ...payload }); return { data: null, count: 1, error: null }; }
    const hit = rows.filter(match);
    if (op === 'update') { hit.forEach((r) => Object.assign(r, payload)); return { data: null, count: hit.length, error: null }; }
    if (op === 'head') return { data: null, count: hit.length, error: null };
    return { data: hit, count: hit.length, error: null };
  };
  const q: Record<string, unknown> = {
    select(_c?: string, o: Record<string, unknown> = {}) { if (op === 'select') op = o.head ? 'head' : 'select'; return q; },
    update(p: Row, o: Record<string, unknown> = {}) { op = 'update'; payload = p; opts = o; return q; },
    upsert(p: Row, o: Record<string, unknown> = {}) { op = 'upsert'; payload = p; opts = o; return q; },
    insert(p: Row) { op = 'insert'; payload = p; return q; },
    eq(c: string, v: unknown) { eqs.push([c, v]); return q; },
    maybeSingle() { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return Promise.resolve({ ...r, data: d }); },
    single() { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return Promise.resolve({ ...r, data: d }); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return q;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from }) }));
vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email: String(email).toLowerCase() }),
}));
vi.mock('@/lib/two-factor-session', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireMIAuthSession: () => ({ ok: true, session: { email: 'me@example.com' } }),
}));
vi.mock('@/lib/access-links', () => ({ createSecureAccessUrl: async () => 'https://getmindy.ai/prefs?t=x' }));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';

const settingsOps = () => db.ops.filter((o) => o.table === 'user_notification_settings');
const settingsCreates = () => settingsOps().filter((o) => o.op === 'insert' || o.op === 'upsert');
const req = (url: string, init?: RequestInit) => new NextRequest(url, init as never);

beforeEach(() => { db.tables = {}; db.ops = []; });

describe('saves do not depend on a settings row', () => {
  it('opportunities/save: a company/buyer/recompete save succeeds for a user with no settings row', async () => {
    const { POST } = await import('@/app/api/opportunities/save/route');
    for (const source of ['company_map', 'buyer_map', 'recompete_map']) {
      const res = await POST(req('https://getmindy.ai/api/opportunities/save', { method: 'POST', body: JSON.stringify({
        email: 'me@example.com', noticeId: `id-${source}`, requestPursuitBrief: false, source, opportunityData: { noticeId: `id-${source}`, title: 't' } }) }));
      expect(res.status).toBe(200);
    }
    expect(T('user_saved_opportunities')).toHaveLength(3);
    expect(settingsOps()).toHaveLength(0);   // the gate is gone and nothing reaches for the row
  });

  it('save-redirect no longer references the settings row at all', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/api/opportunities/save-redirect/route.ts', 'utf8');
    expect(src).not.toMatch(/from\('user_notification_settings'\)/);
    expect(src).not.toMatch(/reason=user_not_found/);
  });
});

describe('alerts/unsubscribe', () => {
  it('GET for an address with no settings row reports the truth, not "Unsubscribed", and creates nothing', async () => {
    const { GET } = await import('@/app/api/alerts/unsubscribe/route');
    const html = await (await GET(req('https://getmindy.ai/api/alerts/unsubscribe?email=nobody@example.com'))).text();
    expect(html).toContain('No alerts for this address');
    expect(html).not.toContain("You've been unsubscribed");
    expect(settingsCreates()).toHaveLength(0);
  });

  it('GET with an existing row pauses it and says Unsubscribed', async () => {
    T('user_notification_settings').push({ user_email: 'me@example.com', alerts_enabled: true, alert_frequency: 'daily' });
    const { GET } = await import('@/app/api/alerts/unsubscribe/route');
    const html = await (await GET(req('https://getmindy.ai/api/alerts/unsubscribe?email=me@example.com'))).text();
    expect(html).toContain("You've been unsubscribed");
    expect(T('user_notification_settings')[0]).toMatchObject({ alerts_enabled: false, alert_frequency: 'paused' });
  });

  it('GET never reflects the raw email into the page (SEC-5)', async () => {
    const { GET } = await import('@/app/api/alerts/unsubscribe/route');
    const html = await (await GET(req('https://getmindy.ai/api/alerts/unsubscribe?email=' + encodeURIComponent('<script>alert(1)</script>')))).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('POST (authenticated) with no row creates a PAUSED row — never an alerts-on one', async () => {
    const { POST } = await import('@/app/api/alerts/unsubscribe/route');
    const res = await POST(req('https://getmindy.ai/api/alerts/unsubscribe', { method: 'POST', body: JSON.stringify({ email: 'me@example.com' }) }));
    expect(res.status).toBe(200);
    expect(T('user_notification_settings')).toHaveLength(1);
    expect(T('user_notification_settings')[0]).toMatchObject({ alerts_enabled: false, alert_frequency: 'paused', briefings_enabled: false, treatment_type: 'free' });
  });

  it('POST with an existing row leaves every other field alone', async () => {
    T('user_notification_settings').push({ user_email: 'me@example.com', alerts_enabled: true, alert_frequency: 'daily', treatment_type: 'briefings', timezone: 'America/Denver' });
    const { POST } = await import('@/app/api/alerts/unsubscribe/route');
    await POST(req('https://getmindy.ai/api/alerts/unsubscribe', { method: 'POST', body: JSON.stringify({ email: 'me@example.com' }) }));
    expect(T('user_notification_settings')).toHaveLength(1);
    expect(T('user_notification_settings')[0]).toMatchObject({ alerts_enabled: false, alert_frequency: 'paused', treatment_type: 'briefings', timezone: 'America/Denver' });
  });
});

describe('sms/disable and search-capture never report a change that did not happen', () => {
  it('sms/disable with no row: success, but changed:false — and no row is created', async () => {
    const { POST } = await import('@/app/api/app/sms/disable/route');
    const j = await (await POST(req('https://getmindy.ai/api/app/sms/disable', { method: 'POST', body: JSON.stringify({ email: 'me@example.com' }) }))).json();
    expect(j).toMatchObject({ success: true, changed: false, sms_enabled: false, reason: 'no_settings_row' });
    expect(settingsCreates()).toHaveLength(0);
  });

  it('sms/disable with a row: changed:true', async () => {
    T('user_notification_settings').push({ user_email: 'me@example.com', sms_enabled: true, phone_verified: true });
    const { POST } = await import('@/app/api/app/sms/disable/route');
    const j = await (await POST(req('https://getmindy.ai/api/app/sms/disable', { method: 'POST', body: JSON.stringify({ email: 'me@example.com' }) }))).json();
    expect(j).toMatchObject({ success: true, changed: true });
    expect(T('user_notification_settings')[0]).toMatchObject({ sms_enabled: false, phone_verified: false });
  });

  it('search-capture with no row: history saved, profile_updated:false with the reason, no row created', async () => {
    const { POST } = await import('@/app/api/search-capture/route');
    const j = await (await POST(req('https://getmindy.ai/api/search-capture', { method: 'POST', body: JSON.stringify({ user_email: 'me@example.com', tool: 'opportunity_hunter', search_type: 'keyword', search_value: 'fence' }) }))).json();
    expect(j).toMatchObject({ success: true, profile_updated: false, profile_reason: 'no_settings_row' });
    expect(T('user_search_history')).toHaveLength(1);
    expect(settingsCreates()).toHaveLength(0);
  });

  it('search-capture with a row: profile_updated:true', async () => {
    T('user_notification_settings').push({ user_email: 'me@example.com', keywords: ['roof'], aggregated_profile: {} });
    const { POST } = await import('@/app/api/search-capture/route');
    const j = await (await POST(req('https://getmindy.ai/api/search-capture', { method: 'POST', body: JSON.stringify({ user_email: 'me@example.com', tool: 'opportunity_hunter', search_type: 'keyword', search_value: 'fence' }) }))).json();
    expect(j).toMatchObject({ success: true, profile_updated: true });
    expect(T('user_notification_settings')[0].keywords).toEqual(['roof', 'fence']);
  });
});

describe('ensureFreeSettingsRow invariants', () => {
  it('missing → Free defaults; existing → untouched (even with paused); failures surface', async () => {
    const { ensureFreeSettingsRow } = await import('./ensure-free-settings-row');
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient('u', 'k') as never;
    expect(await ensureFreeSettingsRow(sb, 'New@Example.com')).toEqual({ outcome: 'created' });
    expect(T('user_notification_settings')[0]).toMatchObject({ user_email: 'new@example.com', treatment_type: 'free', alerts_enabled: true, briefings_enabled: false, alert_frequency: 'daily' });
    T('user_notification_settings')[0].alerts_enabled = false;
    expect(await ensureFreeSettingsRow(sb, 'new@example.com', { paused: true })).toEqual({ outcome: 'existed' });
    expect(T('user_notification_settings')).toHaveLength(1);
    expect(T('user_notification_settings')[0].alerts_enabled).toBe(false);
    expect((await ensureFreeSettingsRow(sb, 'not-an-email')).outcome).toBe('failed');
  });

  it('is the only settings-row creator in the routes it covers', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/app/api/company-setup/route.ts', 'src/app/api/alerts/unsubscribe/route.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/ensureFreeSettingsRow\(/);
      expect(src).not.toMatch(/from\('user_notification_settings'\)\s*\.(insert|upsert)\(/);
    }
  });
});
