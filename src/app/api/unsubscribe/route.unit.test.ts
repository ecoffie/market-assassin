/**
 * /api/unsubscribe: GET never writes (mail scanners pre-fetch links); POST with a valid signature unsubscribes
 * (form button or RFC 8058 one-click); an unsigned/tampered link changes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  process.env.EMAIL_ACTION_SECRET = 'test-secret';
  return { writes: [] as Array<{ table: string; op: string; row?: unknown; filter?: Record<string, unknown> }> };
});
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const filter: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        upsert: async (row: unknown) => { h.writes.push({ table, op: 'upsert', row }); return { error: null }; },
        update: (row: unknown) => { h.writes.push({ table, op: 'update', row, filter }); return b; },
        eq: async (c: string, v: unknown) => { filter[c] = v; return { count: 1, error: null }; },
      });
      return b;
    },
  }),
}));

import { GET, POST } from './route';
import { unsubscribeUrl } from '@/lib/email/unsubscribe';

const signed = () => new URL(unsubscribeUrl('pat@example.com', 'daily_alert'));
const req = (url: URL, init?: RequestInit) => {
  const r = new Request(url, init) as unknown as Parameters<typeof GET>[0];
  (r as unknown as { nextUrl: URL }).nextUrl = url;
  return r;
};

beforeEach(() => { h.writes.length = 0; });

describe('/api/unsubscribe', () => {
  it('GET with a valid link shows the confirm page and writes NOTHING', async () => {
    const r = await GET(req(signed()));
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('Unsubscribe from Mindy emails?');
    expect(body).toContain('<form method="post"');
    expect(body).toContain('Manage preferences');
    expect(h.writes).toEqual([]);
  });
  it('GET with a tampered or bare link: invalid page, nothing written', async () => {
    const u = signed(); u.searchParams.set('e', Buffer.from('victim@example.com').toString('base64url'));
    expect((await GET(req(u))).status).toBe(400);
    expect((await GET(req(new URL('https://getmindy.ai/api/unsubscribe?email=victim@example.com')))).status).toBe(400);
    expect(h.writes).toEqual([]);
  });
  it('POST from the confirm button: suppression (unsubscribe) + alerts/briefings off', async () => {
    const u = signed();
    const form = new URLSearchParams({ e: u.searchParams.get('e')!, t: u.searchParams.get('t')!, s: 'daily_alert' });
    const r = await POST(req(new URL('https://getmindy.ai/api/unsubscribe'), { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("You're unsubscribed");
    expect(h.writes[0]).toMatchObject({ table: 'email_suppressions', op: 'upsert', row: { user_email: 'pat@example.com', reason: 'unsubscribe', source: 'unsubscribe_page', email_type: 'daily_alert' } });
    expect(h.writes[1]).toMatchObject({ table: 'user_notification_settings', op: 'update', row: { alerts_enabled: false, briefings_enabled: false }, filter: { user_email: 'pat@example.com' } });
  });
  it('RFC 8058 one-click POST (e/t in the URL, body List-Unsubscribe=One-Click) → 200 plain', async () => {
    const r = await POST(req(signed(), { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('unsubscribed');
    expect(h.writes[0]).toMatchObject({ row: { source: 'list_unsubscribe_one_click' } });
  });
  it('POST with a tampered signature writes nothing', async () => {
    const u = signed(); u.searchParams.set('t', '0'.repeat(64));
    const r = await POST(req(u, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(r.status).toBe(400);
    expect(h.writes).toEqual([]);
  });
});
