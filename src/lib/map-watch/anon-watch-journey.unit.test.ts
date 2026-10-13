/**
 * Option A (Eric, 2026-10-10) — the whole signed-out → signed-in journey, through the REAL route
 * handlers and the REAL sign-in hook, over one in-memory `saved_searches` table.
 *
 *   save signed out → decline alerts → close & reopen (list by this browser's anon id)
 *   → sign in (scheduleAttributionClaim, which every verified sign-in route calls)
 *   → the watch is on the account with the SAME filters and alerts OFF.
 *
 * Also: repeat sign-in creates nothing; another browser / account cannot claim it; a watch id alone
 * opens or claims nothing. SIMULATED: the database and the session are in-memory fakes (labelled) —
 * this is not production acceptance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown> & { id: string; user_email: string; alerts_enabled: boolean };
const T: { rows: Row[]; seq: number } = { rows: [], seq: 0 };

function table() {
  const conds: Array<[string, string, unknown]> = [];
  let mode: 'select' | 'insert' | 'update' = 'select';
  let payload: Record<string, unknown> | null = null;
  let countMode = false;
  const match = (r: Row) => conds.every(([op, k, v]) => (op === 'eq' ? r[k] === v : (v as unknown[]).includes(r[k])));
  const run = () => {
    if (mode === 'insert') {
      const row = { id: `w${++T.seq}`, created_at: new Date().toISOString(), alert_frequency: 'daily', ...payload } as Row;
      T.rows.push(row); return { data: [row], error: null };
    }
    const hit = T.rows.filter(match);
    if (mode === 'update') { hit.forEach((r) => Object.assign(r, payload)); return { data: null, error: null, count: countMode ? hit.length : null }; }
    return { data: hit.map((r) => ({ ...r })), error: null, count: hit.length };
  };
  const q: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (o?.count) countMode = true; return q; },
    insert: (p: Record<string, unknown>) => { mode = 'insert'; payload = p; return q; },
    update: (p: Record<string, unknown>, o?: { count?: string }) => { mode = 'update'; payload = p; countMode = !!o?.count; return q; },
    eq: (k: string, v: unknown) => { conds.push(['eq', k, v]); return q; },
    in: (k: string, v: unknown[]) => { conds.push(['in', k, v]); return q; },
    not: () => q, order: () => q, limit: () => q,
    single: () => { const r = run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null }); },
    maybeSingle: () => { const r = run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null }); },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}
const fakeDb = { from: () => table() };

let sessionEmail: string | null = null;
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb }));
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => fakeDb, getReadClient: () => fakeDb }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIP: () => '1.2.3.4' }));
vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: () => (sessionEmail
    ? { ok: true, session: { email: sessionEmail } }
    : { ok: false, response: new Response(JSON.stringify({ success: false }), { status: 401 }) }),
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => fn() }));
vi.mock('@/lib/attribution/share-attribution', async (orig) => ({
  ...(await orig<typeof import('@/lib/attribution/share-attribution')>()),
  claimAnonAttribution: async () => ({ ok: true }),
}));

const { POST, GET } = await import('@/app/api/app/map-watch/route');
const { claimAttributionFromRequest } = await import('@/lib/attribution/claim-from-request');

const BROWSER_A = 'anon:3f2b8c1e-7a4d-4b8e-9c1f-2a6d5e8b7c90';
const BROWSER_B = 'anon:9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const FILTERS = { q: 'MINDY AUDIT TEST roofing', naics: '238160', horizons: { open: true, recompete: false, forecast: true } };

const post = (body: unknown) => POST(new NextRequest('https://getmindy.ai/api/app/map-watch', { method: 'POST', body: JSON.stringify(body) }));
const list = async (qs: string) => (await (await GET(new NextRequest(`https://getmindy.ai/api/app/map-watch?${qs}`))).json()) as { watches: Row[] };
/** A verified sign-in from a browser carrying `mindy_anon` (what mi-session / mi-login / complete-signup do). */
const signIn = (email: string, anonCookie: string | null) => {
  sessionEmail = email;
  return claimAttributionFromRequest({ cookies: { get: (n: string) => (n === 'mindy_anon' && anonCookie ? { value: anonCookie } : undefined) } }, email, null);
};

beforeEach(() => { T.rows = []; T.seq = 0; sessionEmail = null; });

describe('[SIMULATED] save signed out → decline → reopen → sign in', () => {
  it('the watch reaches the account with the same filters and alerts OFF', async () => {
    const saved = await (await post({ anonId: BROWSER_A, mode: 'open', filters: FILTERS, bbox: null })).json();
    expect(saved).toMatchObject({ success: true, alertsEnabled: false });
    // declined: no claim call at all. Close and reopen: the browser lists its own watch.
    const reopened = await list(`anonId=${encodeURIComponent(BROWSER_A)}`);
    expect(reopened.watches.map((w) => [w.id, w.filters, w.alerts_enabled])).toEqual([[saved.id, FILTERS, false]]);
    // and can open it by id (the ?ss= path for a signed-out browser)
    expect((await list(`anonId=${encodeURIComponent(BROWSER_A)}&id=${saved.id}`)).watches).toHaveLength(1);

    await signIn('owner@example.com', BROWSER_A);
    const acct = T.rows.filter((r) => r.user_email === 'owner@example.com');
    expect(acct).toHaveLength(1);
    expect(acct[0]).toMatchObject({ id: saved.id, filters: FILTERS, alerts_enabled: false });
    expect((await list(`anonId=${encodeURIComponent(BROWSER_A)}`)).watches).toHaveLength(0);
  });

  it('signing in again (or retrying) duplicates nothing and subscribes no one', async () => {
    await post({ anonId: BROWSER_A, mode: 'open', filters: FILTERS });
    await signIn('owner@example.com', BROWSER_A);
    await signIn('owner@example.com', BROWSER_A);
    sessionEmail = 'owner@example.com';
    const retry = await (await post({ action: 'claim', anonId: BROWSER_A })).json();
    expect(retry).toMatchObject({ success: true, claimed: 0, alertsOn: 0 });
    expect(T.rows).toHaveLength(1);
    expect(T.rows[0].alerts_enabled).toBe(false);
  });

  it('a later sign-in to ANOTHER account on the same browser cannot take an already-claimed watch', async () => {
    await post({ anonId: BROWSER_A, mode: 'open', filters: FILTERS });
    await signIn('owner@example.com', BROWSER_A);
    await signIn('someone-else@example.com', BROWSER_A);
    expect(T.rows[0].user_email).toBe('owner@example.com');
  });

  it('another browser cannot claim, list or open it — even knowing the watch id', async () => {
    const saved = await (await post({ anonId: BROWSER_A, mode: 'open', filters: FILTERS })).json();
    await signIn('intruder@example.com', BROWSER_B);
    expect(T.rows[0].user_email).toBe(BROWSER_A);
    expect((await list(`anonId=${encodeURIComponent(BROWSER_B)}&id=${saved.id}`)).watches).toHaveLength(0);
    sessionEmail = 'intruder@example.com';
    const r = await (await post({ action: 'claim', anonId: BROWSER_B, enableAlerts: true, watchId: saved.id })).json();
    expect(r).toMatchObject({ claimed: 0, alertsOn: 0 });
    expect(T.rows[0]).toMatchObject({ user_email: BROWSER_A, alerts_enabled: false });
  });

  it('a sign-in with no anon cookie (storage cleared) claims nothing — the recovery limit', async () => {
    await post({ anonId: BROWSER_A, mode: 'open', filters: FILTERS });
    await signIn('owner@example.com', null);
    expect(T.rows[0].user_email).toBe(BROWSER_A);
  });

  it('the explicit opt-in turns alerts on for that ONE watch only', async () => {
    const one = await (await post({ anonId: BROWSER_A, mode: 'open', filters: FILTERS })).json();
    await post({ anonId: BROWSER_A, mode: 'open', filters: { ...FILTERS, q: 'second' } });
    sessionEmail = 'owner@example.com';
    const r = await (await post({ action: 'claim', anonId: BROWSER_A, enableAlerts: true, watchId: one.id })).json();
    expect(r).toMatchObject({ claimed: 2, alertsOn: 1 });
    expect(T.rows.map((x) => [x.id === one.id, x.alerts_enabled])).toEqual([[true, true], [false, false]]);
  });

  it('enableAlerts without a watch id, or a watch id without enableAlerts, turns nothing on', async () => {
    const one = await (await post({ anonId: BROWSER_A, mode: 'open', filters: FILTERS })).json();
    sessionEmail = 'owner@example.com';
    await post({ action: 'claim', anonId: BROWSER_A, enableAlerts: true });
    await post({ action: 'claim', anonId: BROWSER_A, watchId: one.id });
    expect(T.rows[0]).toMatchObject({ user_email: 'owner@example.com', alerts_enabled: false });
  });
});
