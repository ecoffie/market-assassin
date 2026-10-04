import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * R1 part B — /api/lindy/intelligence and /api/lindy/match return a user's own
 * briefings and profile, so they may serve ONLY the proven identity:
 *   a verified session, or a Mindy connection key issued with the briefings:read scope.
 * The fake database records every user_email the routes read, so each test proves
 * whose rows were touched, not just the status code.
 */

const reads: string[] = [];
function builder() {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ['select', 'order', 'limit', 'gte', 'lte', 'in', 'not', 'is', 'neq', 'or', 'ilike', 'like', 'range', 'filter', 'contains', 'lt', 'gt']) b[m] = chain;
  b.eq = (col: string, val: unknown) => { if (col === 'user_email') reads.push(String(val)); return b; };
  b.maybeSingle = async () => ({ data: null, error: null });
  b.single = async () => ({ data: null, error: null });
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res, rej);
  return b;
}
const getUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => builder(), auth: { getUser } }),
}));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => false }));

// The key table: raw key → { owner, scopes }. verifyApiKey runs for real against it.
const KEYS: Record<string, { user_email: string; scopes: string[] }> = {};
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({
    from: () => {
      let hash = '';
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, v: string) => { if (col === 'key_hash') hash = v; return q; },
        is: () => q,
        update: () => ({ eq: () => ({ then: () => undefined }) }),
        maybeSingle: async () => {
          const { hashApiKey } = await import('@/lib/mcp/api-keys');
          for (const [raw, row] of Object.entries(KEYS)) {
            if (hashApiKey(raw) === hash) return { data: { id: `id-${raw.slice(-4)}`, ...row }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return q;
    },
  }),
  getReadClient: () => ({ from: () => builder() }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.TWO_FACTOR_SECRET = 'r1-lindy-unit-secret';

const { createMIAuthSessionToken } = await import('@/lib/two-factor-session');
const { keyAllows, verifyApiKey, BRIEFINGS_READ_SCOPE } = await import('@/lib/mcp/api-keys');
const intelligence = await import('@/app/api/lindy/intelligence/route');
const match = await import('@/app/api/lindy/match/route');

const A = 'user-a@example.com';
const B = 'victim-b@example.com';
const STAFF = 'someone@govcongiants.com';
const A_BRIEFINGS_KEY = 'mcp_live_' + 'a'.repeat(60) + 'brf1';
const A_MCP_KEY = 'mcp_live_' + 'b'.repeat(60) + 'mcp1';
KEYS[A_BRIEFINGS_KEY] = { user_email: A, scopes: [BRIEFINGS_READ_SCOPE] };
KEYS[A_MCP_KEY] = { user_email: A, scopes: [] };

beforeEach(() => {
  reads.length = 0;
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
});

type Who = { label: string; claim: string; headers?: Record<string, string>; cookie?: string };
const ATTACKS: Who[] = [
  { label: 'logged out + victim email', claim: B },
  { label: 'forged cookie for the victim', claim: B, cookie: `ma_access_email=${B}` },
  { label: 'claimed staff email, no session', claim: STAFF },
  { label: "A's session + B's email", claim: B, headers: { 'x-mi-auth-token': createMIAuthSessionToken(A) } },
  { label: "A's briefings key + B's email", claim: B, headers: { authorization: `Bearer ${A_BRIEFINGS_KEY}` } },
  { label: "A's MCP key (wrong scope)", claim: A, headers: { authorization: `Bearer ${A_MCP_KEY}` } },
];
const OWNERS: Who[] = [
  { label: "A's session", claim: A, headers: { 'x-mi-auth-token': createMIAuthSessionToken(A) } },
  { label: "A's briefings key, no email", claim: '', headers: { authorization: `Bearer ${A_BRIEFINGS_KEY}` } },
  { label: "A's briefings key + A's email", claim: A, headers: { authorization: `Bearer ${A_BRIEFINGS_KEY}` } },
];

function req(url: string, who: Who, body?: unknown) {
  const headers = new Headers(who.headers || {});
  if (who.cookie) headers.set('cookie', who.cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(url, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const intelUrl = (claim: string) => `https://getmindy.ai/api/lindy/intelligence${claim ? `?email=${encodeURIComponent(claim)}` : ''}`;
const matchBody = (claim: string) => ({ ...(claim ? { email: claim } : {}), user_kb: { capabilities: ['cybersecurity'] } });

describe('GET /api/lindy/intelligence', () => {
  for (const who of ATTACKS) {
    it(`${who.label} → 401, no user data read`, async () => {
      const res = await intelligence.GET(req(intelUrl(who.claim), who));
      expect(res.status).toBe(401);
      expect(reads).toEqual([]);
      const body = JSON.stringify(await res.json());
      expect(body).not.toContain(B);
    });
  }
  for (const who of OWNERS) {
    it(`${who.label} → 200 with only A's data`, async () => {
      const res = await intelligence.GET(req(intelUrl(who.claim), who));
      expect(res.status).toBe(200);
      expect((await res.json()).user_email).toBe(A);
      expect(reads.length).toBeGreaterThan(0);
      expect(new Set(reads)).toEqual(new Set([A]));
    });
  }
});

describe('POST /api/lindy/match', () => {
  for (const who of ATTACKS) {
    it(`${who.label} → 401, no briefing read`, async () => {
      const res = await match.POST(req('https://getmindy.ai/api/lindy/match', who, matchBody(who.claim)));
      expect(res.status).toBe(401);
      expect(reads).toEqual([]);
    });
  }
  for (const who of OWNERS) {
    it(`${who.label} → reads only A's briefing`, async () => {
      const res = await match.POST(req('https://getmindy.ai/api/lindy/match', who, matchBody(who.claim)));
      expect(res.status).toBe(200);
      expect(new Set(reads)).toEqual(new Set([A]));
    });
  }
});

describe('key purposes are least-privilege in both directions', () => {
  it('keyAllows: legacy [] and mcp keys are MCP-only; briefings keys are briefings-only', () => {
    expect(keyAllows([], 'mcp')).toBe(true);
    expect(keyAllows(['mcp'], 'mcp')).toBe(true);
    expect(keyAllows([BRIEFINGS_READ_SCOPE], 'mcp')).toBe(false);
    expect(keyAllows([BRIEFINGS_READ_SCOPE], BRIEFINGS_READ_SCOPE)).toBe(true);
    expect(keyAllows([], BRIEFINGS_READ_SCOPE)).toBe(false);
  });
  it('verifyApiKey: the MCP edge default refuses a briefings key; the briefings purpose refuses an MCP key', async () => {
    expect(await verifyApiKey(A_BRIEFINGS_KEY)).toBeNull();
    expect(await verifyApiKey(A_MCP_KEY)).toMatchObject({ userEmail: A });
    expect(await verifyApiKey(A_MCP_KEY, BRIEFINGS_READ_SCOPE)).toBeNull();
    expect(await verifyApiKey(A_BRIEFINGS_KEY, BRIEFINGS_READ_SCOPE)).toMatchObject({ userEmail: A });
  });
});
