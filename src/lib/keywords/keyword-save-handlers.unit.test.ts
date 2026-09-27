import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { KEYWORD_MAX_COUNT, mergeDerivedKeywords } from './sanitize';

/**
 * "NEVER SILENTLY DISCARD KEYWORDS" — proven on the REAL save handlers, not on source text.
 *
 * Each handler runs against an in-memory Supabase that RECORDS every write. The contract:
 *   - at the limit (60) and below (53, the real list that was truncated) → saved intact;
 *   - one over (61) → an error response, ZERO writes to any table, existing settings unchanged.
 * Auth / workspace resolution are mocked to "this user, own workspace" — they are not under test.
 */

type Row = Record<string, unknown>;
type Write = { table: string; op: 'insert' | 'update' | 'upsert' | 'delete'; payload: unknown };

const STORE: Record<string, Row[]> = {};
const WRITES: Write[] = [];

function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let pendingWrite: Write | null = null;
      const rows = () => (STORE[table] || []).filter((r) => filters.every(([k, v]) => r[k] === v));
      const result = () => {
        if (pendingWrite) {
          WRITES.push(pendingWrite);
          const w = pendingWrite as Write;
          const payload = (Array.isArray(w.payload) ? w.payload : [w.payload]) as Row[];
          if (w.op === 'update') for (const r of rows()) Object.assign(r, payload[0]);
          if (w.op === 'insert' || w.op === 'upsert') {
            STORE[table] = STORE[table] || [];
            for (const p of payload) {
              const hit = STORE[table].find((r) => r.user_email === p.user_email);
              if (hit && w.op === 'upsert') Object.assign(hit, p); else STORE[table].push({ ...p });
            }
          }
          return { data: payload, error: null, count: payload.length };
        }
        const r = rows();
        return { data: r, error: null, count: r.length };
      };
      const b: Record<string, unknown> = {};
      const self = () => b;
      for (const m of ['select', 'order', 'limit', 'range', 'in', 'neq', 'gte', 'lte', 'or', 'ilike', 'like', 'is', 'not', 'contains']) b[m] = self;
      b.eq = (k: string, v: unknown) => { filters.push([k, v]); return b; };
      for (const op of ['insert', 'update', 'upsert', 'delete'] as const) {
        b[op] = (payload?: unknown) => { pendingWrite = { table, op, payload }; return b; };
      }
      b.maybeSingle = async () => { const r = result(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null }; };
      b.single = b.maybeSingle;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: null, error: null }) } },
  };
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient() }));
vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async (_req: unknown, email: string) => ({ authenticated: true, email }),
  verifyUserSession: async () => ({ authenticated: true }),
  verifyMIAccess: async () => ({ hasAccess: false }),
}));
vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: () => ({ ok: true }) }));
vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: async () => ({ workspaceId: null, asClient: false }),
  clientNotificationEmail: (id: string) => `client-${id}@workspace.local`,
}));
vi.mock('@/lib/app/derive-agencies-from-naics', () => ({ deriveAgenciesFromProfile: async () => [] }));
vi.mock('@/lib/mindy/apply-partner-referral', () => ({ applyPartnerReferralIfEligible: async () => null }));

const EMAIL = 'keyword-test@example.com';
const PRIOR = ['prior keyword one', 'prior keyword two'];
const kws = (n: number) => Array.from({ length: n }, (_, i) => `capability phrase ${i + 1}`);

function seed(keywords: string[] = PRIOR) {
  for (const k of Object.keys(STORE)) delete STORE[k];
  WRITES.length = 0;
  STORE.user_notification_settings = [{
    user_email: EMAIL, keywords: [...keywords], naics_codes: ['541511'], agencies: ['VA'], aggregated_profile: {},
  }];
}
const stored = () => STORE.user_notification_settings[0].keywords as string[];
const req = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  process.env.ADMIN_PASSWORD = 'pw';
  seed();
});

describe('POST /api/alerts/preferences (the Settings save)', () => {
  const post = async (keywords: string[]) => {
    const { POST } = await import('@/app/api/alerts/preferences/route');
    return POST(req('http://x/api/alerts/preferences', { email: EMAIL, keywords }));
  };

  for (const n of [53, KEYWORD_MAX_COUNT]) {
    it(`${n} keywords save intact`, async () => {
      const res = await post(kws(n));
      expect(res.status).toBe(200);
      expect(stored()).toEqual(kws(n));
    });
  }

  it(`${KEYWORD_MAX_COUNT + 1} keywords → error, zero writes, prior settings preserved`, async () => {
    const res = await post(kws(KEYWORD_MAX_COUNT + 1));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('keyword_limit');
    expect(WRITES).toEqual([]);
    expect(stored()).toEqual(PRIOR);
  });
});

describe('POST /api/app/profile (onboarding save)', () => {
  const post = async (keywords: string[]) => {
    const { POST } = await import('@/app/api/app/profile/route');
    return POST(req('http://x/api/app/profile', { email: EMAIL, keywords }));
  };

  for (const n of [53, KEYWORD_MAX_COUNT]) {
    it(`${n} keywords save intact`, async () => {
      const res = await post(kws(n));
      expect(res.status).toBe(200);
      expect(stored()).toEqual(kws(n)); // already lowercase: sanitize lowercases, nothing else changes
    });
  }

  it(`${KEYWORD_MAX_COUNT + 1} keywords → error, zero writes to any table, prior settings preserved`, async () => {
    const res = await post(kws(KEYWORD_MAX_COUNT + 1));
    expect(res.status).toBe(400);
    expect(WRITES).toEqual([]);
    expect(stored()).toEqual(PRIOR);
  });
});

describe('POST /api/app/keywords/add (additive merge)', () => {
  const post = async (keywords: string[]) => {
    const { POST } = await import('@/app/api/app/keywords/add/route');
    return POST(req('http://x/api/app/keywords/add', { email: EMAIL, keywords }));
  };

  it('a merge that lands exactly at the limit saves every keyword', async () => {
    seed(kws(KEYWORD_MAX_COUNT - 2));
    const res = await post(['new term alpha', 'new term beta']);
    expect(res.status).toBe(200);
    expect(stored()).toEqual([...kws(KEYWORD_MAX_COUNT - 2), 'new term alpha', 'new term beta']);
  });

  it('a merge one over the limit → error, zero writes, existing list untouched', async () => {
    seed(kws(KEYWORD_MAX_COUNT - 2));
    const res = await post(['new term alpha', 'new term beta', 'new term gamma']);
    expect(res.status).toBe(400);
    expect(WRITES).toEqual([]);
    expect(stored()).toEqual(kws(KEYWORD_MAX_COUNT - 2));
  });

  it('an existing row already over the limit is never trimmed by a read', async () => {
    seed(kws(KEYWORD_MAX_COUNT + 5));
    const res = await post(['capability phrase 1']); // already present → nothing to add
    expect(res.status).toBe(200);
    expect(WRITES).toEqual([]);
    expect(stored()).toHaveLength(KEYWORD_MAX_COUNT + 5);
  });
});

describe('POST /api/admin/set-user-profile', () => {
  const post = async (keywords: string[]) => {
    const { POST } = await import('@/app/api/admin/set-user-profile/route');
    return POST(req('http://x/api/admin/set-user-profile?password=pw', { email: EMAIL, keywords }));
  };

  it(`${KEYWORD_MAX_COUNT} keywords save intact`, async () => {
    const res = await post(kws(KEYWORD_MAX_COUNT));
    expect(res.status).toBe(200);
    expect(stored()).toEqual(kws(KEYWORD_MAX_COUNT));
  });

  it(`${KEYWORD_MAX_COUNT + 1} keywords → error, zero writes`, async () => {
    const res = await post(kws(KEYWORD_MAX_COUNT + 1));
    expect(res.status).toBe(400);
    expect(WRITES).toEqual([]);
    expect(stored()).toEqual(PRIOR);
  });
});

describe('vault prefill — the documented EXCEPTION (derived, not user input)', () => {
  it('fills only the remaining room, never trims existing keywords, and reports what did not fit', () => {
    const existing = kws(KEYWORD_MAX_COUNT - 1);
    const r = mergeDerivedKeywords(existing, ['derived a', 'derived b', 'capability phrase 1']);
    expect(r.merged).toEqual([...existing, 'derived a']);
    expect(r.skipped).toEqual(['derived b']);
  });

  it('an existing list already at/over the limit is kept whole and nothing is added', () => {
    const existing = kws(KEYWORD_MAX_COUNT + 3);
    const r = mergeDerivedKeywords(existing, ['derived a']);
    expect(r.merged).toEqual(existing);
    expect(r.skipped).toEqual(['derived a']);
  });
});
