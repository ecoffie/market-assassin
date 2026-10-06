/**
 * REGRESSION — a user's own NAICS save must record that the user chose them, and
 * placeholder codes must never read as a choice.
 *
 * Measured 2026-10-06: after the one-off provenance backfill (2026-08-25), no settings save
 * wrote `naics_source`. 86 September signups who saved their OWN codes were stored with NULL
 * provenance — indistinguishable from an untouched placeholder.
 *
 * Drives the real POST /api/alerts/preferences handler against an in-memory Supabase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const db: { settings: Row | null; writes: Row[] } = { settings: null, writes: [] };

function builder(table: string) {
  const state: { op: 'select' | 'update' | 'insert' | 'upsert'; payload?: Row } = { op: 'select' };
  const result = () => {
    if (table === 'user_notification_settings') {
      if (state.op === 'update' || state.op === 'insert') {
        db.writes.push(state.payload!);
        db.settings = { ...(db.settings ?? {}), ...state.payload };
      }
      return { data: db.settings, error: null };
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
const PLACEHOLDER = ['541512', '541611', '541330', '541990', '561210'];

async function post(body: Row) {
  const { POST } = await import('./route');
  const res = await POST(new NextRequest('http://localhost/api/alerts/preferences', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, ...body }),
    headers: { 'content-type': 'application/json' },
  }));
  expect(res.status).toBe(200);
  return db.writes.at(-1)!;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  db.settings = { user_email: EMAIL, agencies: [], keywords: [], aggregated_profile: {}, naics_codes: PLACEHOLDER, naics_source: null };
  db.writes = [];
});

describe('POST /api/alerts/preferences — NAICS provenance', () => {
  it('replacing the placeholder with the user’s own codes records user_confirmed', async () => {
    const w = await post({ naicsCodes: ['484121', '484110'] });
    expect(w.naics_codes).toEqual(['484121', '484110']);
    expect(w.naics_source).toBe('user_confirmed');
  });

  it('re-sending the unchanged placeholder (a frequency save) never claims a choice', async () => {
    const w = await post({ naicsCodes: PLACEHOLDER, frequency: 'weekly' });
    expect(w.naics_source).not.toBe('user_confirmed');
    expect(w).not.toHaveProperty('naics_source');
  });

  it('saving the exact placeholder set over other codes is system_default, not a choice', async () => {
    db.settings = { ...db.settings, naics_codes: ['238220'], naics_source: 'user_confirmed' };
    const w = await post({ naicsCodes: [...PLACEHOLDER].reverse() });
    expect(w.naics_source).toBe('system_default');
  });

  it('an unrelated save leaves an existing derived_suggestion as it was', async () => {
    db.settings = { ...db.settings, naics_codes: ['238220'], naics_source: 'derived_suggestion' };
    const w = await post({ naicsCodes: ['238220'], keywords: ['boilers'] });
    expect(w).not.toHaveProperty('naics_source');
  });
});
