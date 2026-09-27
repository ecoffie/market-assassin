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

import { STORE, WRITES } from './__fixtures__/recording-supabase';

vi.mock('@supabase/supabase-js', async () => {
  const { fakeClient: make } = await import('./__fixtures__/recording-supabase');
  return { createClient: () => make() };
});
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
      expect(stored()).toEqual(kws(n));
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
    const body = await res.json();
    // Describes what the user did (had 58, adding 3), not "you entered 61".
    expect(body.error).toMatch(/You have 58 saved keywords; adding 3 would make 61/);
    expect(body.error).not.toMatch(/You entered/);
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

describe('ONE input behaves the same on every surface (shared normalization)', () => {
  // A realistic paste: comma, semicolon and newline separated, mixed case, one repeat.
  const PASTE = ['Cyber Security, cloud migration; FedRAMP\nFISMA, fedramp'];
  const EXPECTED = ['Cyber Security', 'cloud migration', 'FedRAMP', 'FISMA'];

  it('Settings, onboarding and add-keywords store the identical list', async () => {
    const results: Record<string, unknown> = {};

    seed([]);
    const settings = await (await import('@/app/api/alerts/preferences/route')).POST(
      req('http://x/api/alerts/preferences', { email: EMAIL, keywords: PASTE }));
    expect(settings.status).toBe(200);
    results.settings = [...stored()];

    seed([]);
    const onboarding = await (await import('@/app/api/app/profile/route')).POST(
      req('http://x/api/app/profile', { email: EMAIL, keywords: PASTE }));
    expect(onboarding.status).toBe(200);
    results.onboarding = [...stored()];

    seed([]);
    const add = await (await import('@/app/api/app/keywords/add/route')).POST(
      req('http://x/api/app/keywords/add', { email: EMAIL, keywords: PASTE }));
    expect(add.status).toBe(200);
    results.add = [...stored()];

    expect(results).toEqual({ settings: EXPECTED, onboarding: EXPECTED, add: EXPECTED });
  });

  it('an unusable entry is rejected identically on every surface, with nothing written', async () => {
    const BAD = ['cybersecurity, 541511'];
    for (const [name, mod, url] of [
      ['settings', '@/app/api/alerts/preferences/route', 'http://x/api/alerts/preferences'],
      ['onboarding', '@/app/api/app/profile/route', 'http://x/api/app/profile'],
      ['add', '@/app/api/app/keywords/add/route', 'http://x/api/app/keywords/add'],
    ] as const) {
      seed();
      const res = await (await import(mod)).POST(req(url, { email: EMAIL, keywords: BAD }));
      expect(res.status, name).toBe(400);
      expect((await res.json()).code, name).toBe('keyword_unusable');
      expect(WRITES, name).toEqual([]);
      expect(stored(), name).toEqual(PRIOR);
    }
  });

  it('the same over-limit paste is rejected on every surface (a comma blob is not "one keyword")', async () => {
    const blob = [Array.from({ length: KEYWORD_MAX_COUNT + 1 }, (_, i) => `term ${i}`).join(', ')];
    for (const [name, mod, url] of [
      ['settings', '@/app/api/alerts/preferences/route', 'http://x/api/alerts/preferences'],
      ['onboarding', '@/app/api/app/profile/route', 'http://x/api/app/profile'],
    ] as const) {
      seed();
      const res = await (await import(mod)).POST(req(url, { email: EMAIL, keywords: blob }));
      expect(res.status, name).toBe(400);
      expect((await res.json()).code, name).toBe('keyword_limit');
      expect(WRITES, name).toEqual([]);
    }
  });
});
