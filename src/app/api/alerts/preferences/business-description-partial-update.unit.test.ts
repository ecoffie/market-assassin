/**
 * INVARIANT: a partial update changes only explicitly submitted fields.
 *
 * POST /api/alerts/preferences used to rewrite user_business_profiles.
 * business_description on EVERY keywords save — the user's own text became
 * "Federal contractor: …", and `keywords: []` (the profile reset) set it NULL.
 * These tests drive the real route handler against an in-memory Supabase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const db: { settings: Row | null; business: Row | null; businessWrites: Row[] } = {
  settings: null,
  business: null,
  businessWrites: [],
};

function builder(table: string) {
  const state: { op: 'select' | 'update' | 'insert' | 'upsert'; payload?: Row } = { op: 'select' };
  const result = () => {
    if (table === 'user_notification_settings') {
      if (state.op === 'update' || state.op === 'insert') {
        db.settings = { ...(db.settings ?? {}), ...state.payload };
      }
      return { data: db.settings, error: null };
    }
    if (table === 'user_business_profiles') {
      if (state.op === 'upsert') {
        db.businessWrites.push(state.payload!);
        db.business = { ...(db.business ?? {}), ...state.payload };
        return { data: null, error: null };
      }
      return { data: db.business, error: null };
    }
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    update: (p: Row) => { state.op = 'update'; state.payload = p; return b; },
    insert: (p: Row) => { state.op = 'insert'; state.payload = p; return b; },
    upsert: (p: Row) => { state.op = 'upsert'; state.payload = p; return b; },
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  };
  return b;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => builder(table) }),
}));
vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async (_req: unknown, email: string) => ({ authenticated: true, email }),
}));
vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: async () => ({ workspaceId: null, asClient: false }),
  clientNotificationEmail: (id: string) => `client-${id}`,
}));
vi.mock('@/lib/app/derive-agencies-from-naics', () => ({
  deriveAgenciesFromProfile: async () => [],
}));

const EMAIL = 'user@example.com';
const USER_TEXT = 'We are an SDVOSB doing HVAC maintenance for VA medical centers.';

async function post(body: Row) {
  const { POST } = await import('./route');
  const req = new NextRequest('http://localhost/api/alerts/preferences', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, ...body }),
    headers: { 'content-type': 'application/json' },
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
}

beforeEach(() => {
  db.settings = {
    user_email: EMAIL,
    agencies: ['Department of Veterans Affairs'],
    keywords: ['hvac'],
    aggregated_profile: {},
    naics_codes: ['238220'],
  };
  db.business = { user_email: EMAIL, business_description: USER_TEXT };
  db.businessWrites = [];
});

describe('POST /api/alerts/preferences — business_description is a partial update', () => {
  it('a keywords-only save leaves a user-written description untouched', async () => {
    await post({ keywords: ['hvac', 'boiler repair'] });
    expect(db.business?.business_description).toBe(USER_TEXT);
    expect(db.businessWrites).toHaveLength(0);
  });

  it('keywords: [] (profile reset) does not NULL the description', async () => {
    await post({ naicsCodes: [], pscCodes: [], keywords: [], targetAgencies: [], locationStates: [] });
    expect(db.business?.business_description).toBe(USER_TEXT);
    expect(db.businessWrites).toHaveLength(0);
  });

  it('a blank description sent alongside keywords is not a clear', async () => {
    await post({ keywords: ['hvac'], businessDescription: null });
    expect(db.business?.business_description).toBe(USER_TEXT);
    await post({ keywords: ['hvac'], businessDescription: '   ' });
    expect(db.business?.business_description).toBe(USER_TEXT);
  });

  it('an explicit non-blank description is written', async () => {
    await post({ businessDescription: '  New text from the settings form.  ' });
    expect(db.business?.business_description).toBe('New text from the settings form.');
  });

  it('a derived description still fills an EMPTY description', async () => {
    db.business = { user_email: EMAIL, business_description: null };
    await post({ keywords: ['hvac', 'boiler repair'] });
    expect(db.business?.business_description).toBe('Federal contractor: hvac, boiler repair.');
  });

  it('a previously auto-derived description is refreshed from the new keywords', async () => {
    db.business = { user_email: EMAIL, business_description: 'Federal contractor: hvac.' };
    await post({ keywords: ['hvac', 'chillers'] });
    expect(db.business?.business_description).toBe('Federal contractor: hvac, chillers.');
  });

  it('a settings save that omits both fields does not touch the description', async () => {
    await post({ frequency: 'weekly' });
    expect(db.businessWrites).toHaveLength(0);
  });
});

describe('POST /api/alerts/save-profile — empty signup box is not a clear', () => {
  it('writes business_description only for a non-blank description', () => {
    const src = readFileSync('src/app/api/alerts/save-profile/route.ts', 'utf8');
    expect(src).not.toMatch(/business_description:\s*cleanBusinessDescription\s*\|\|\s*null/);
    expect(src).toMatch(/if \(cleanBusinessDescription\) \{/);
  });
});
