/**
 * GET /api/app/saved-searches?email=&id= — the Map's ?ss= deep link reads ONE saved search.
 *
 * The id is a pointer, not a credential. The real session verifier runs here (signed with a test
 * secret), and the table is an in-memory set of rows filtered by exactly the .eq() calls the
 * service makes — so "another account's id is not returned" is a property of the query, not of a
 * mock that was told to return null.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

const ROWS = [
  { id: '6e376442-819e-420f-b149-ef62861814ca', user_email: 'owner@example.test', name: 'Navy Shipbuilding', mode: 'open',
    filters: { naics: '336611,336612', agency: 'DEFENSE', status: 'active' }, bbox: null, alerts_enabled: true,
    alert_frequency: 'daily', last_alerted_at: null, last_seen_notice_ids: [], total_alerts_sent: 10,
    created_at: '2026-09-21T12:28:00Z', updated_at: '2026-10-04T11:00:51Z' },
];
const queries: Array<Array<[string, unknown]>> = [];

vi.mock('@/lib/app/workspace', () => ({
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
  getAppSupabase: () => ({
    from: (table: string) => {
      expect(table).toBe('saved_searches');
      const eqs: Array<[string, unknown]> = [];
      queries.push(eqs);
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { eqs.push([col, val]); return q; },
        maybeSingle: async () => ({
          data: ROWS.find((r) => eqs.every(([c, v]) => (r as Record<string, unknown>)[c] === v)) ?? null,
          error: null,
        }),
      };
      return q;
    },
  }),
}));

let GET: (req: NextRequest) => Promise<Response>;
let token: (email: string) => string;

beforeAll(async () => {
  process.env.TWO_FACTOR_SECRET = 'unit-test-secret-not-a-real-one';
  ({ GET } = await import('./route'));
  const s = await import('@/lib/two-factor-session');
  token = (email) => s.createMIAuthSessionToken(email);
});

function req(email: string, id: string, tok?: string) {
  return new NextRequest(`https://getmindy.ai/api/app/saved-searches?email=${encodeURIComponent(email)}&id=${encodeURIComponent(id)}`, {
    headers: tok ? { 'x-mi-auth-token': tok, 'x-user-email': email } : {},
  });
}
const ID = ROWS[0].id;

describe('GET ?id= — owner-scoped', () => {
  it('the owner gets exactly that search', async () => {
    const res = await GET(req('owner@example.test', ID, token('owner@example.test')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.search).toMatchObject({ id: ID, mode: 'open', filters: ROWS[0].filters, bbox: null });
    expect(queries.at(-1)).toEqual([['id', ID], ['user_email', 'owner@example.test']]);
  });

  it('another account with a VALID session gets the same 404 as a deleted id', async () => {
    const foreign = await GET(req('someone@example.test', ID, token('someone@example.test')));
    const deleted = await GET(req('owner@example.test', '00000000-0000-4000-8000-000000000000', token('owner@example.test')));
    expect(foreign.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(await foreign.json()).toEqual(await deleted.json());
  });

  it('a malformed id is the same 404, and never reaches the database', async () => {
    const before = queries.length;
    const res = await GET(req('owner@example.test', "x' or 1=1", token('owner@example.test')));
    expect(res.status).toBe(404);
    expect(queries.length).toBe(before);
  });

  it('no session, or a session for a different email than claimed, is 401 — the id alone grants nothing', async () => {
    expect((await GET(req('owner@example.test', ID))).status).toBe(401);
    expect((await GET(req('owner@example.test', ID, token('someone@example.test')))).status).toBe(401);
  });
});
