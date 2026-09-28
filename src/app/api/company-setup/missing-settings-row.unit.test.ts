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
const db: { rows: Row[]; bizRows: Row[]; idRows: Row[]; failInsert?: { code: string; message: string }; hideFromFirstUpdate?: boolean; nullCount?: boolean } = { rows: [], bizRows: [], idRows: [] };

function table(name: string) {
  const rows = name === 'user_notification_settings' ? db.rows : name === 'user_identity_profile' ? db.idRows : db.bizRows;
  const isSettings = name === 'user_notification_settings';
  let op: 'update' | 'insert' | 'upsert' | 'count' | 'select' | null = null;
  let payload: Row = {};
  let opts: { ignoreDuplicates?: boolean; count?: string; head?: boolean } = {};
  const filters: Array<(r: Row) => boolean> = [];
  const match = (r: Row) => filters.every((f) => f(r));
  const exec = () => {
    if (op === 'upsert') {
      // Mirrors PostgREST: ignoreDuplicates = INSERT … ON CONFLICT DO NOTHING (count = rows inserted).
      if (db.failInsert && isSettings) return { data: null, count: null, error: db.failInsert };
      const i = rows.findIndex((r) => r.user_email === payload.user_email);
      if (i >= 0) {
        if (opts.ignoreDuplicates) return { data: null, count: 0, error: null };
        rows[i] = { ...rows[i], ...payload }; return { data: null, count: 1, error: null };
      }
      rows.push({ ...payload });
      return { data: null, count: 1, error: null };
    }
    if (op === 'count') return { data: null, count: rows.filter(match).length, error: null };
    if (op === 'select') return { data: rows.find(match) ?? null, error: null };
    const hit = rows.filter(match);
    hit.forEach((r) => Object.assign(r, payload));
    return { data: null, count: db.nullCount && isSettings ? null : hit.length, error: null };
  };
  const q: Record<string, unknown> = {
    update(p: Row) { op = 'update'; payload = p; return q; },
    insert(p: Row) { op = 'insert'; payload = p; return q; },
    upsert(p: Row, o: typeof opts = {}) { op = 'upsert'; payload = p; opts = o; return q; },
    eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
    is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return q; },
    select(_c?: string, o: typeof opts = {}) { if (o.head) op = 'count'; else if (!op) op = 'select'; return q; },
    maybeSingle() { return Promise.resolve(exec()); },
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

beforeEach(() => { db.rows = []; db.bizRows = []; db.idRows = []; db.failInsert = undefined; db.hideFromFirstUpdate = false; db.nullCount = false; });

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
    });
    // P0-I: company identity is NOT a notification setting — it lands in the Vault as user_entered.
    expect(db.rows[0]).not.toHaveProperty('company_name');
    expect(db.idRows).toEqual([expect.objectContaining({ user_email: 'new@example.com', legal_name: 'Acme Fences', legal_name_source: 'user_entered' })]);
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

describe('P0-I — company name is Vault identity, never a notification setting', () => {
  it('a SAM-grounded Vault name is not overwritten by the onboarding name; setup still succeeds and reports it kept', async () => {
    db.idRows.push({ user_email: 'new@example.com', legal_name: 'ACME FENCES LLC', legal_name_source: 'sam' });
    const res = await call(confirmBody);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.company_name).toEqual({ outcome: 'kept', reason: 'protected_sam' });
    expect(db.idRows[0]).toMatchObject({ legal_name: 'ACME FENCES LLC', legal_name_source: 'sam' });
    expect(db.rows[0]).toMatchObject({ naics_source: 'user_confirmed' }); // M1 codes still land
  });
  it('an earlier user_entered name is updated', async () => {
    db.idRows.push({ user_email: 'new@example.com', legal_name: 'Acme', legal_name_source: 'user_entered' });
    const j = await (await call(confirmBody)).json();
    expect(j.company_name).toMatchObject({ outcome: 'written' });
    expect(db.idRows[0]).toMatchObject({ legal_name: 'Acme Fences', legal_name_source: 'user_entered' });
  });
  it('a name typed and then skipped is still saved as the user’s own statement — without creating a settings row', async () => {
    const res = await call({ email: 'new@example.com', action: 'skip', companyName: 'Acme Fences' });
    expect(res.status).toBe(200);
    expect(db.idRows).toEqual([expect.objectContaining({ legal_name: 'Acme Fences', legal_name_source: 'user_entered' })]);
    expect(db.rows).toHaveLength(0);
  });
  it('no notification-settings write ever carries company_name', async () => {
    db.rows.push({ user_email: 'new@example.com' });
    await call(confirmBody);
    expect(db.rows.every((r) => !('company_name' in r))).toBe(true);
  });
});
