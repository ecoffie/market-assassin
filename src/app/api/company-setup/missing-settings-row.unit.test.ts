/**
 * COMPANY SETUP — a missing prerequisite row must not turn a confirm into a silent no-op.
 *
 * The route wrote the confirmed codes with `.update().eq('user_email', …)`. For a user with
 * NO user_notification_settings row that matches zero rows, returns no error, and the route
 * answered `{ success: true, wrote: ['naics_codes', …] }` — so Learn M1's completion signal
 * (`naics_source = 'user_confirmed'`) could never be written for them. Measured on prod
 * 2026-09-26: 665 of 2,760 auth users (24.1%) have no settings row, 315 of the last 30
 * days' 495 signups (63.6%).
 *
 * These tests drive the real POST handler against an in-memory table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const db: { rows: Row[]; bizRows: Row[]; failInsert?: { code: string; message: string }; hideFromFirstUpdate?: boolean; nullCount?: boolean } = { rows: [], bizRows: [] };

function table(name: string) {
  const rows = name === 'user_notification_settings' ? db.rows : db.bizRows;
  let op: 'update' | 'insert' | 'upsert' | 'count' | null = null;
  let payload: Row = {};
  let opts: { ignoreDuplicates?: boolean; count?: string; head?: boolean } = {};
  let eq: [string, unknown] | null = null;
  const exec = () => {
    if (op === 'upsert') {
      // Mirrors PostgREST: ignoreDuplicates = INSERT … ON CONFLICT DO NOTHING (count = rows inserted).
      if (db.failInsert) return { data: null, count: null, error: db.failInsert };
      const i = rows.findIndex((r) => r.user_email === payload.user_email);
      if (i >= 0) {
        if (opts.ignoreDuplicates) return { data: null, count: 0, error: null };
        rows[i] = { ...rows[i], ...payload }; return { data: null, count: 1, error: null };
      }
      rows.push({ ...payload });
      return { data: null, count: 1, error: null };
    }
    if (op === 'count') {
      return { data: null, count: rows.filter((r) => eq && r[eq[0]] === eq[1]).length, error: null };
    }
    const hit = rows.filter((r) => eq && r[eq[0]] === eq[1]);
    hit.forEach((r) => Object.assign(r, payload));
    return { data: null, count: db.nullCount ? null : hit.length, error: null };
  };
  const q: Record<string, unknown> = {
    update(p: Row) { op = 'update'; payload = p; return q; },
    insert(p: Row) { op = 'insert'; payload = p; return q; },
    upsert(p: Row, o: typeof opts = {}) { op = 'upsert'; payload = p; opts = o; return q; },
    eq(c: string, v: unknown) { eq = [c, v]; return q; },
    select(_c?: string, o: typeof opts = {}) { if (o.head) op = 'count'; return q; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(exec()).then(res, rej); },
  };
  return q;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (n: string) => table(n) }) }));
vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async (_r: unknown, email: string) =>
    email ? { authenticated: true, email: String(email).toLowerCase() } : { authenticated: false, email: null, error: 'Email required' },
}));
vi.mock('@/lib/codes/validate-market-codes', () => ({ validateMarketCodesInput: () => ({ ok: true }) }));

const { POST } = await import('./route');

const confirmBody = {
  email: 'new@example.com',
  action: 'confirm',
  companyName: 'Acme Fences',
  description: 'We build fences',
  selection: { naicsCodes: ['238990'], keywords: ['fence'] },
};
const call = (body: unknown) =>
  POST(new NextRequest('https://getmindy.ai/api/company-setup', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => { db.rows = []; db.bizRows = []; db.failInsert = undefined; db.hideFromFirstUpdate = false; db.nullCount = false; });

describe('user WITHOUT a settings row', () => {
  it('confirm creates the row carrying the confirmed codes and user_confirmed provenance', async () => {
    const res = await call(confirmBody);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.success).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      user_email: 'new@example.com',
      naics_codes: ['238990'],
      naics_source: 'user_confirmed',
      company_name: 'Acme Fences',
    });
  });

  it('the created row gets the same free defaults /api/app/profile creates', async () => {
    await call(confirmBody);
    expect(db.rows[0]).toMatchObject({ treatment_type: 'free', alerts_enabled: true, briefings_enabled: false, alert_frequency: 'daily' });
  });

  it('a failed create is an error, never success', async () => {
    db.failInsert = { code: '42501', message: 'permission denied' };
    const res = await call(confirmBody);
    const j = await res.json();
    expect(res.status).toBe(500);
    expect(j.success).toBe(false);
  });

  it('a row created concurrently by another request is patched, never duplicated or overwritten', async () => {
    // The other request won the insert; ours hits ON CONFLICT DO NOTHING, then patches that row.
    db.rows.push({ user_email: 'new@example.com', alerts_enabled: false, treatment_type: 'free' });
    const res = await call(confirmBody);
    const j = await res.json();
    expect(j.success).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].naics_source).toBe('user_confirmed');
    expect(db.rows[0].alerts_enabled).toBe(false); // the racing row's own settings are kept
    expect(j.created_settings_row).toBe(false);
  });
});

describe('an unknown update count is a failure, never "no row"', () => {
  it('count NULL on the patch → 500, never success', async () => {
    db.nullCount = true;
    const res = await call(confirmBody);
    const j = await res.json();
    expect(res.status).toBe(500);
    expect(j.success).toBe(false);
  });
});

describe('user WITH a settings row', () => {
  it('updates in place and preserves every field it was not asked to change', async () => {
    db.rows.push({ user_email: 'new@example.com', naics_codes: ['541512'], alerts_enabled: false, keywords: ['old'], timezone: 'America/Denver' });
    const res = await call(confirmBody);
    expect(res.status).toBe(200);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ naics_codes: ['238990'], naics_source: 'user_confirmed', alerts_enabled: false, timezone: 'America/Denver' });
  });
});

describe('skip still writes nothing into the active profile', () => {
  it('skip with nothing typed creates no row', async () => {
    const res = await call({ email: 'new@example.com', action: 'skip' });
    expect(res.status).toBe(200);
    expect(db.rows).toHaveLength(0);
  });
  it('skip never claims user_confirmed', async () => {
    await call({ ...confirmBody, action: 'skip' });
    for (const r of db.rows) expect(r.naics_source).toBeUndefined();
  });
});
