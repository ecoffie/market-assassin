import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * R1 part C — a Pro gate may read entitlement ONLY for the verified identity.
 *
 * Every route here used to call verifyMIAccess(<query/body/cookie email>), so naming a paying
 * customer's address unlocked their tier. The spy records every email the gate reads an
 * entitlement for. Under attack (logged out + victim email, forged cookie, claimed staff
 * address, user A's session claiming user B) it must NEVER read the victim's or the staff
 * address's entitlement:
 *   - strict gates (pricing-intel, competitor-awards, market-dossier, market-narrative,
 *     teaming/suggest, briefings/verify) answer 401;
 *   - public / Free-fallback routes (target-market-research, market-overview, generate-all)
 *     serve the Free view, and target-market-research refuses an explicit mismatch.
 * The legitimate caller's own entitlement is read, and only theirs.
 */

const accessReads: string[] = [];
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api-auth')>();
  return {
    ...real,
    verifyMIAccess: vi.fn(async (email: string | null) => {
      accessReads.push(String(email));
      return { tier: 'free', email, isStaff: false };
    }),
  };
});
const proReads: string[] = [];
vi.mock('@/lib/access/resolve-access', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/access/resolve-access')>();
  return { ...real, hasProAccess: vi.fn(async (email: string) => { proReads.push(email); return false; }) };
});

// Everything downstream gets an empty, fast world: no DB rows, no network.
function builder(): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'neq', 'in', 'not', 'is', 'or', 'ilike', 'like', 'gte', 'lte', 'gt', 'lt', 'order', 'limit', 'range', 'filter', 'contains', 'overlaps', 'textSearch', 'match', 'upsert', 'insert', 'update', 'delete']) b[m] = self;
  b.maybeSingle = async () => ({ data: null, error: null });
  b.single = async () => ({ data: null, error: null });
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej);
  return b;
}
const getUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => builder(), rpc: async () => ({ data: null, error: null }), auth: { getUser } }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.TWO_FACTOR_SECRET = 'r1-pro-gates-secret';

const realFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch; });
afterAll(() => { globalThis.fetch = realFetch; });

const { createMIAuthSessionToken } = await import('@/lib/two-factor-session');
const A = 'user-a@example.com';
const B = 'paying-b@example.com';
const STAFF = 'someone@govcongiants.com';
const tokA = createMIAuthSessionToken(A);

beforeEach(() => {
  accessReads.length = 0;
  proReads.length = 0;
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
});

type Who = { label: string; claim: string; headers?: Record<string, string>; cookie?: string };
const ATTACKS: Who[] = [
  { label: 'logged out + victim email', claim: B },
  { label: 'forged cookie for the victim', claim: B, cookie: `ma_access_email=${B}` },
  { label: 'claimed staff email, no session', claim: STAFF },
  { label: "A's session + B's email", claim: B, headers: { 'x-mi-auth-token': tokA } },
];
const OWNER: Who = { label: "A's own session", claim: A, headers: { 'x-mi-auth-token': tokA } };

function req(url: string, who: Who, body?: unknown) {
  const headers = new Headers(who.headers || {});
  if (who.cookie) headers.set('cookie', who.cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(url, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const noVictimRead = () => {
  expect(accessReads.filter((e) => e === B || e === STAFF)).toEqual([]);
  expect(proReads.filter((e) => e === B || e === STAFF)).toEqual([]);
};

type Strict = { name: string; call: (who: Who) => Promise<Response> };
const STRICT: Strict[] = [
  { name: 'GET /api/app/pricing-intel', call: async (w) => (await import('@/app/api/app/pricing-intel/route')).GET(req(`https://getmindy.ai/api/app/pricing-intel?email=${encodeURIComponent(w.claim)}&naics=541512`, w)) },
  { name: 'GET /api/app/competitor-awards', call: async (w) => (await import('@/app/api/app/competitor-awards/route')).GET(req(`https://getmindy.ai/api/app/competitor-awards?email=${encodeURIComponent(w.claim)}&name=Acme`, w)) },
  { name: 'GET /api/app/market-dossier', call: async (w) => (await import('@/app/api/app/market-dossier/route')).GET(req(`https://getmindy.ai/api/app/market-dossier?email=${encodeURIComponent(w.claim)}`, w)) },
  { name: 'POST /api/app/market-narrative', call: async (w) => (await import('@/app/api/app/market-narrative/route')).POST(req('https://getmindy.ai/api/app/market-narrative', w, { email: w.claim, naics: '541512' })) },
  { name: 'GET /api/teaming/suggest', call: async (w) => (await import('@/app/api/teaming/suggest/route')).GET(req(`https://getmindy.ai/api/teaming/suggest?email=${encodeURIComponent(w.claim)}&naics=541512`, w)) },
  { name: 'POST /api/briefings/verify', call: async (w) => (await import('@/app/api/briefings/verify/route')).POST(req('https://getmindy.ai/api/briefings/verify', w, { email: w.claim })) },
];

describe('strict Pro gates: 401 without a verified identity, never reading the victim', () => {
  for (const route of STRICT) {
    for (const who of ATTACKS) {
      it(`${route.name}: ${who.label} → 401`, async () => {
        const res = await route.call(who);
        expect(res.status).toBe(401);
        noVictimRead();
      });
    }
    it(`${route.name}: ${OWNER.label} → passes the identity gate as A`, async () => {
      const res = await route.call(OWNER);
      expect(res.status).not.toBe(401);
      noVictimRead();
      // Whatever entitlement is read is A's alone. (market-dossier returns before its tier check
      // when A has no profile rows, so an empty read list is also correct there.)
      expect([...accessReads, ...proReads].every((e) => e === A)).toBe(true);
      if (!route.name.includes('teaming') && !route.name.includes('dossier')) expect([...accessReads, ...proReads]).toEqual([A]);
    });
  }
});

describe('teaming/suggest page size is capped', () => {
  it('limit=10000 returns at most 50 rows', async () => {
    const { GET } = await import('@/app/api/teaming/suggest/route');
    const res = await GET(req('https://getmindy.ai/api/teaming/suggest?naics=541&limit=10000', OWNER));
    const j = await res.json();
    const rows = (j.suggestions || j.contractors || j.results || []) as unknown[];
    expect(rows.length).toBeLessThanOrEqual(50);
  });
});

describe('public / Free-fallback routes: a claimed email never raises the tier', () => {
  it('GET /api/market-overview: every attack is read as nobody (Free view)', async () => {
    const { GET } = await import('@/app/api/market-overview/route');
    for (const who of ATTACKS) {
      await GET(req(`https://getmindy.ai/api/market-overview?keyword=roofing&email=${encodeURIComponent(who.claim)}`, who));
    }
    noVictimRead();
    expect(accessReads).toEqual([]);
  });
  it("GET /api/market-overview: A's session is never refused and reads only A", async () => {
    const { GET } = await import('@/app/api/market-overview/route');
    const res = await GET(req(`https://getmindy.ai/api/market-overview?keyword=roofing&email=${A}`, OWNER));
    expect(res.status).not.toBe(401);
    // With an empty DB the route may return before the tier step; any read must be A's.
    expect(accessReads.every((e) => e === A)).toBe(true);
  });

  it("POST /api/app/target-market-research: A's session claiming B → 401", async () => {
    const { POST } = await import('@/app/api/app/target-market-research/route');
    const res = await POST(req('https://getmindy.ai/api/app/target-market-research', ATTACKS[3], { naicsCode: '541512', email: B }));
    expect(res.status).toBe(401);
    noVictimRead();
  });
  it('POST /api/app/target-market-research: unverified claims are served as Free, never read', async () => {
    const { POST } = await import('@/app/api/app/target-market-research/route');
    for (const who of ATTACKS.slice(0, 3)) {
      await POST(req('https://getmindy.ai/api/app/target-market-research', who, { naicsCode: '541512', email: who.claim })).catch(() => null);
    }
    noVictimRead();
    expect(accessReads).toEqual([]);
  }, 30_000);

  it('POST /api/reports/generate-all: the access cookie and body email are not identity', async () => {
    const { POST } = await import('@/app/api/reports/generate-all/route');
    for (const who of ATTACKS) {
      await POST(req('https://getmindy.ai/api/reports/generate-all', who, { inputs: { naicsCode: '541512', businessType: 'Small Business' }, selectedAgencies: ['x'], userEmail: who.claim })).catch(() => null);
    }
    noVictimRead();
    // Only A's session (the 4th attack carries it) may have been read — never B or staff.
    expect(accessReads.every((e) => e === A)).toBe(true);
  }, 30_000);
});

describe('the four in-app clients send the Mindy session to these gates', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const callsTo = (file: string, path: string) =>
    readFileSync(file, 'utf8').split(/(?:fetch|authedFetch)\(/).slice(1).filter((c) => c.slice(0, 160).includes(path)).map((c) => c.trimStart().slice(0, 500));
  const cases: Array<[string, string, RegExp]> = [
    ['src/components/app/panels/PricingIntelPanel.tsx', '/api/app/pricing-intel', /^`\/api\/app\/pricing-intel[\s\S]*?,\s*email\s*\)/],
    ['src/components/app/market/MarketDataMap.tsx', '/api/market-overview', /getMIApiHeaders\(\)/],
    ['src/app/app/onboarding/page.tsx', '/api/market-overview', /getMIApiHeaders\(\)/],
    ['src/app/federal-market-assassin/page.tsx', '/api/reports/generate-all', /getMIApiHeaders\(undefined/],
    ['src/app/federal-market-assassin/page.tsx', '/api/ma-usage', /getMIApiHeaders\((undefined, \{[^}]*\})?\)/],
  ];
  for (const [file, path, pattern] of cases) {
    it(`${file} → ${path}`, () => {
      const calls = callsTo(file, path);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c).toMatch(pattern);
    });
  }
  it('a typed or legacy address is never passed to getMIApiHeaders on these pages (it would purge another account\'s session)', () => {
    for (const f of ['src/app/market-intelligence/page.tsx', 'src/app/federal-market-assassin/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/getMIApiHeaders\((email|userEmail)\b/);
    }
  });
});

describe('source guard: these gates read entitlement only for the verified email', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const files = [
    'src/app/api/app/pricing-intel/route.ts',
    'src/app/api/app/competitor-awards/route.ts',
    'src/app/api/app/market-dossier/route.ts',
    'src/app/api/app/market-narrative/route.ts',
    'src/app/api/app/target-market-research/route.ts',
    'src/app/api/market-overview/route.ts',
    'src/app/api/reports/generate-all/route.ts',
    'src/app/api/briefings/verify/route.ts',
  ];
  for (const f of files) {
    it(f, () => {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const reads = [...code.matchAll(/(?:verifyMIAccess|hasProAccess)\(([^)]*)\)/g)].map((m) => m[1].trim());
      expect(reads.length).toBeGreaterThan(0);
      // identity.email (verifyClaimedIdentity) or `email` derived from getVerifiedIdentity in generate-all.
      for (const arg of reads) expect(arg).toMatch(/^(identity\.email|email)$/);
      if (!f.includes('generate-all')) expect(reads.every((a) => a === 'identity.email')).toBe(true);
      else expect(code).toMatch(/const email = verified\?\.email \?\? null;/);
    });
  }
});
