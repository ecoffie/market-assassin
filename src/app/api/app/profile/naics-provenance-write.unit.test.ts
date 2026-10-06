/**
 * REGRESSION — onboarding / Map settings / "save research to profile" all POST here.
 * A save that changes the user's NAICS must record who chose them; placeholder codes must
 * never become a confirmed profile; an unrelated save must not upgrade provenance.
 *
 * Drives the real POST /api/app/profile handler against an in-memory Supabase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const db: { settings: Row | null; writes: Row[] } = { settings: null, writes: [] };

function builder(table: string) {
  const state: { op: 'select' | 'update' | 'insert'; payload?: Row } = { op: 'select' };
  const result = () => {
    if (table === 'user_notification_settings') {
      if (state.op === 'update' || state.op === 'insert') {
        db.writes.push(state.payload!);
        db.settings = { ...(db.settings ?? {}), ...state.payload };
        return { data: null, error: null };
      }
      return { data: db.settings, error: null };
    }
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    limit: () => b,
    order: () => b,
    update: (p: Row) => { state.op = 'update'; state.payload = p; return b; },
    insert: (p: Row) => { state.op = 'insert'; state.payload = p; return b; },
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
vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: () => ({ ok: true }),
}));
vi.mock('@/lib/api-auth', () => ({
  verifyUserSession: async () => ({ authenticated: true }),
  verifyMIAccess: async () => ({ hasAccess: false }),
}));
vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: async () => ({ workspaceId: null, asClient: false }),
  clientNotificationEmail: (id: string) => `client-${id}`,
}));
vi.mock('@/lib/app/derive-agencies-from-naics', () => ({
  deriveAgenciesFromProfile: async () => [],
}));
vi.mock('@/lib/utils/derive-keywords', () => ({
  deriveKeywordsFromNaics: async () => [],
}));

const EMAIL = 'user@example.com';
const PLACEHOLDER = ['541512', '541611', '541330', '541990', '561210'];

async function post(body: Row) {
  const { POST } = await import('./route');
  const res = await POST(new NextRequest('http://localhost/api/app/profile', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, ...body }),
    headers: { 'content-type': 'application/json' },
  }));
  expect(res.status).toBe(200);
  return db.writes[0]!;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  db.settings = { user_email: EMAIL, agencies: [], keywords: ['trucking'], aggregated_profile: {}, naics_codes: PLACEHOLDER, alert_frequency: 'daily' };
  db.writes = [];
});

describe('POST /api/app/profile — NAICS provenance', () => {
  it('onboarding replacing the placeholder with the user’s codes records user_confirmed', async () => {
    const w = await post({ naicsCodes: ['484121', '484110'], precise: true });
    expect(w.naics_codes).toEqual(['484121', '484110']);
    expect(w.naics_source).toBe('user_confirmed');
  });

  it('re-sending the unchanged placeholder never claims a confirmed profile', async () => {
    const w = await post({ naicsCodes: PLACEHOLDER, precise: true });
    expect(w).not.toHaveProperty('naics_source');
  });

  it('a first save that IS the placeholder is recorded as system_default', async () => {
    db.settings = null; // no row yet -> insert path
    const w = await post({ naicsCodes: PLACEHOLDER, precise: true });
    expect(w.naics_source).toBe('system_default');
  });
});
