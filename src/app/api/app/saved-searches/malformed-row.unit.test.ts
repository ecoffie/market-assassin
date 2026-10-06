/**
 * The Map's unread badge (GET ?badge=1) and "mark all seen" (POST action=mark_seen) iterate EVERY open
 * saved search for the account. A single stored search whose filters the parser cannot read
 * ({ sapBuyer: true }, 2026-10-01) made both throw for the whole account.
 *   - badge: that search reports count=null + invalidFilters (unknown, never 0); others still count.
 *   - mark_seen: that search is SKIPPED and NOT written (no silent consumption of its missed interval);
 *     the others are still marked seen.
 * Real session verifier; in-memory Supabase fake. No production data.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const OWNER = 'customer@example.test';
const BAD = '72354a81-91a2-431e-96df-5f4b46c666a2';
const GOOD = '4651ee1d-0000-4000-8000-000000000001';
const SEARCHES = [
  { id: BAD, filters: { naics: '541510', sapBuyer: true }, last_seen_notice_ids: ['N-OLD'] },
  { id: GOOD, filters: { naics: '541510' }, last_seen_notice_ids: ['N-OLD'] },
];
let updates: Array<{ id: unknown; payload: Record<string, unknown> }> = [];

vi.mock('@/lib/app/workspace', () => ({
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
  getAppSupabase: () => ({
    from: (table: string) => {
      let payload: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'limit', 'gte', 'lte', 'in', 'or', 'not', 'ilike', 'like', 'is', 'contains', 'neq', 'filter', 'match', 'gt', 'lt']) {
        q[m] = () => q;
      }
      q.update = (p: Record<string, unknown>) => { payload = p; return q; };
      q.eq = (col: string, val: unknown) => {
        if (payload && col === 'id') { updates.push({ id: val, payload }); return Promise.resolve({ error: null }); }
        return q;
      };
      q.order = () => Promise.resolve({ data: [{ notice_id: 'N-OLD' }, { notice_id: 'N-NEW' }], error: null });
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(table === 'saved_searches' ? { data: SEARCHES, error: null } : { data: [], error: null }).then(resolve);
      return q;
    },
  }),
}));

let GET: (req: NextRequest) => Promise<Response>;
let POST: (req: NextRequest) => Promise<Response>;
let token: (email: string) => string;

beforeAll(async () => {
  process.env.TWO_FACTOR_SECRET = 'unit-test-secret-not-a-real-one';
  ({ GET, POST } = await import('./route'));
  const s = await import('@/lib/two-factor-session');
  token = (email) => s.createMIAuthSessionToken(email);
});
beforeEach(() => { updates = []; });

const headers = () => ({ 'x-mi-auth-token': token(OWNER), 'x-user-email': OWNER, 'content-type': 'application/json' });

describe('one malformed stored search does not break the account', () => {
  it('badge: reports the malformed search as unknown and still counts the others', async () => {
    const res = await GET(new NextRequest(`https://getmindy.ai/api/app/saved-searches?email=${OWNER}&badge=1`, { headers: headers() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.perSearch).toEqual([
      { id: BAD, count: null, invalidFilters: true },
      { id: GOOD, count: 1 },
    ]);
    expect(body.count).toBe(1);
  });

  it('mark_seen: skips and never writes the malformed search; marks the others', async () => {
    const res = await POST(new NextRequest('https://getmindy.ai/api/app/saved-searches', {
      method: 'POST', headers: headers(), body: JSON.stringify({ action: 'mark_seen', email: OWNER }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cleared).toBe(1);
    expect(body.skippedInvalidFilters).toEqual([BAD]);
    expect(updates.map((u) => u.id)).toEqual([GOOD]);
  });
});
