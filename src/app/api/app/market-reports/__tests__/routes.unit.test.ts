/**
 * Owner link controls for hosted market reports (report sharing Option 1, Eric 2026-11-22).
 *
 * Pins:
 * - strong auth;
 * - not-yours and missing get the IDENTICAL 404 (no subject, status or counts);
 * - the owner keeps access after the public link is revoked or expires;
 * - revoke and expiry never delete the report, and DELETE is the only removal;
 * - extend allows only 30/90/365 days, with no "never";
 * - a revoked link blocks the public page and PDF.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeMarketReportsDb } from '@/lib/market/__tests__/fake-market-reports-db';

const db = fakeMarketReportsDb();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db.client }));

const verify = vi.fn();
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: (...a: unknown[]) => verify(...a) }));

import { GET as LIST } from '../route';
import { GET as VIEW, DELETE as DEL } from '../[id]/route';
import { POST as REVOKE } from '../[id]/revoke/route';
import { POST as EXTEND } from '../[id]/extend/route';
import { GET as PUBLIC_PAGE } from '@/app/reports/[id]/route';
import { REPORT } from '@/app/reports/[id]/pdf/__tests__/fixture';

const DAY = 86_400_000;
const ID = REPORT.id;
const OTHER = 'zzz999zzz999zzz999zzz9';
const req = (path: string, email = 'sue@example.com', init: RequestInit = {}) => new Request(`https://getmindy.ai${path}?email=${encodeURIComponent(email)}`, init);
const p = (id: string) => ({ params: Promise.resolve({ id }) });

function seed(over: Record<string, unknown> = {}) {
  db.rows.push({ ...REPORT, expires_at: new Date(Date.now() + 30 * DAY).toISOString(), revoked_at: null, ...over });
}

beforeEach(() => {
  db.rows.length = 0;
  db.state.missingLinkColumns = false;
  db.state.failNext = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  verify.mockReset().mockImplementation(async (_r: unknown, email: string, opts: { requireStrongAuth?: boolean }) => {
    expect(opts).toEqual({ requireStrongAuth: true }); // existing strong auth, no new auth system
    if (email === 'weak@example.com') return { authenticated: false, error: 'strong_auth_required' };
    // A signed email-action link (?token=&ts=) authenticates as method 'token'.
    if (email === 'link@example.com') return { authenticated: true, email, method: 'token' };
    return { authenticated: true, email, method: 'session' };
  });
});

describe('auth', () => {
  it('every owner route requires strong auth (401) and an email (400)', async () => {
    seed();
    expect((await LIST(req('/api/app/market-reports', 'weak@example.com'))).status).toBe(401);
    expect((await VIEW(req(`/x/${ID}`, 'weak@example.com'), p(ID))).status).toBe(401);
    expect((await REVOKE(req(`/x/${ID}`, 'weak@example.com', { method: 'POST' }), p(ID))).status).toBe(401);
    expect((await EXTEND(req(`/x/${ID}`, 'weak@example.com', { method: 'POST', body: '{"days":30}' }), p(ID))).status).toBe(401);
    expect((await DEL(req(`/x/${ID}`, 'weak@example.com', { method: 'DELETE' }), p(ID))).status).toBe(401);
    expect((await LIST(new Request('https://getmindy.ai/api/app/market-reports'))).status).toBe(400);
    expect(db.rows[0].revoked_at).toBeNull();
  });
});

describe('signed email-action links cannot operate the controls', () => {
  it('a token-authenticated caller gets 401 on list, view, revoke, extend and delete, and nothing changes', async () => {
    seed({ owner_email: 'link@example.com' });
    const E = 'link@example.com';
    const res = [
      await LIST(req('/api/app/market-reports', E)),
      await VIEW(req(`/x/${ID}`, E), p(ID)),
      await REVOKE(req(`/x/${ID}`, E, { method: 'POST' }), p(ID)),
      await EXTEND(req(`/x/${ID}`, E, { method: 'POST', body: '{"days":30}' }), p(ID)),
      await DEL(req(`/x/${ID}`, E, { method: 'DELETE' }), p(ID)),
    ];
    for (const r of res) {
      expect(r.status).toBe(401);
      expect(await r.json()).toMatchObject({ error: 'session_required' });
    }
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].revoked_at).toBeNull();
  });
});

describe('not-yours and missing are identical (no metadata leaks)', () => {
  it('view, revoke, extend and delete answer the same 404 body for another owner and for a missing id', async () => {
    seed();
    const calls: Array<[string, (id: string, email: string) => Promise<Response>]> = [
      ['view', (id, e) => VIEW(req(`/x/${id}`, e), p(id))],
      ['revoke', (id, e) => REVOKE(req(`/x/${id}`, e, { method: 'POST' }), p(id))],
      ['extend', (id, e) => EXTEND(req(`/x/${id}`, e, { method: 'POST', body: '{"days":30}' }), p(id))],
      ['delete', (id, e) => DEL(req(`/x/${id}`, e, { method: 'DELETE' }), p(id))],
    ];
    for (const [name, call] of calls) {
      const notYours = await call(ID, 'eve@example.com');
      const missing = await call(OTHER, 'eve@example.com');
      expect(notYours.status, name).toBe(404);
      expect(missing.status, name).toBe(404);
      const a = await notYours.text();
      expect(a, name).toBe(await missing.text());
      for (const leak of ['drones', 'Acme', 'revoked', 'expires', 'live']) expect(a, name).not.toContain(leak);
    }
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].revoked_at).toBeNull();
  });

  it('the list shows only the caller’s own reports, without payloads', async () => {
    seed();
    db.rows.push({ ...REPORT, id: OTHER, owner_email: 'eve@example.com', subject: 'secret' });
    const j = await (await LIST(req('/api/app/market-reports'))).json();
    expect(j.reports.map((r: { id: string }) => r.id)).toEqual([ID]);
    expect(j.reports[0]).toMatchObject({ status: 'live', url: `https://getmindy.ai/reports/${ID}`, subject: 'drones' });
    expect(JSON.stringify(j)).not.toContain('payload');
    expect(JSON.stringify(j)).not.toContain('secret');
  });

  it('a storage failure on the list is a 503, never an empty list', async () => {
    db.state.failNext = 'down';
    expect((await LIST(req('/api/app/market-reports'))).status).toBe(503);
  });
});

describe('the owner keeps access after the public link stops working', () => {
  it('revoke → the public page answers 410, the owner view still returns the report', async () => {
    seed();
    const r = await REVOKE(req(`/x/${ID}`, 'sue@example.com', { method: 'POST' }), p(ID));
    expect(r.status).toBe(200);
    expect((await r.json()).report.status).toBe('revoked');
    expect(db.rows).toHaveLength(1); // revoking never deletes
    expect((await PUBLIC_PAGE(new Request(`https://getmindy.ai/reports/${ID}`), p(ID))).status).toBe(410);
    const v = await VIEW(req(`/x/${ID}`), p(ID));
    expect(v.status).toBe(200);
    const j = await v.json();
    expect(j.report.status).toBe('revoked');
    expect(j.html).toContain('drones');
    expect(j.html).toContain('Acme Corp');
  });

  it('an expired link: the public page answers 410, the owner view still works, the row is kept', async () => {
    seed({ expires_at: new Date(Date.now() - DAY).toISOString() });
    expect((await PUBLIC_PAGE(new Request(`https://getmindy.ai/reports/${ID}`), p(ID))).status).toBe(410);
    const j = await (await VIEW(req(`/x/${ID}`), p(ID))).json();
    expect(j.report.status).toBe('expired');
    expect(j.html).toContain('drones');
    expect(db.rows).toHaveLength(1);
  });

  it('revoking twice is harmless and keeps the first revocation time', async () => {
    seed({ revoked_at: '2026-11-01T00:00:00.000Z' });
    const j = await (await REVOKE(req(`/x/${ID}`, 'sue@example.com', { method: 'POST' }), p(ID))).json();
    expect(j.report.revoked_at).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('extend', () => {
  const ext = (days: unknown) => EXTEND(req(`/x/${ID}`, 'sue@example.com', { method: 'POST', body: JSON.stringify({ days }) }), p(ID));

  it('only 30, 90 or 365 days; no "never"', async () => {
    seed();
    for (const bad of [0, 7, 1000, null, 'never', -30]) expect((await ext(bad)).status, String(bad)).toBe(400);
    for (const ok of [30, 90, 365]) expect((await ext(ok)).status, String(ok)).toBe(200);
  });

  it('counts from the later of now and the current expiry', async () => {
    const cur = Date.now() + 10 * DAY;
    seed({ expires_at: new Date(cur).toISOString() });
    const j = await (await ext(30)).json();
    expect(Math.abs(Date.parse(j.report.expires_at) - (cur + 30 * DAY))).toBeLessThan(2000);
  });

  it('an expired link can be brought back by extending (from now)', async () => {
    seed({ expires_at: new Date(Date.now() - 5 * DAY).toISOString() });
    const j = await (await ext(30)).json();
    expect(j.report.status).toBe('live');
    expect(Math.abs(Date.parse(j.report.expires_at) - (Date.now() + 30 * DAY))).toBeLessThan(5000);
  });

  it('a revoked link cannot be extended; a link with no expiry has nothing to extend', async () => {
    seed({ revoked_at: new Date().toISOString() });
    expect(await (await ext(30)).json()).toMatchObject({ error: 'link_revoked' });
    db.rows.length = 0;
    seed({ expires_at: null });
    const r = await ext(30);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'link_has_no_expiry' });
    expect(db.rows[0].expires_at).toBeNull();
  });
});

describe('delete', () => {
  it('is the only removal; afterwards the public link and the owner view both 404', async () => {
    seed();
    expect((await DEL(req(`/x/${ID}`, 'sue@example.com', { method: 'DELETE' }), p(ID))).status).toBe(200);
    expect(db.rows).toHaveLength(0);
    expect((await PUBLIC_PAGE(new Request(`https://getmindy.ai/reports/${ID}`), p(ID))).status).toBe(404);
    expect((await VIEW(req(`/x/${ID}`), p(ID))).status).toBe(404);
  });
});
