/**
 * REGRESSION — an email signup must not be given a business profile it never chose.
 *
 * Measured 2026-10-06: every September–October signup holding the 5-code placeholder
 * (541512/541611/541330/541990/561210) came through THIS handler (email provider,
 * treatment_type=free, row created at /app/setup-password) with naics_source NULL — 64 of 64.
 * Google/Microsoft signups never got the placeholder. The daily-alert cron reads stored
 * codes as targeting, so those accounts were mailed generic IT/admin work "matched to their
 * profile" while every reader of naics_source saw "unknown", not "default".
 *
 * Drives the real POST handler against an in-memory Supabase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const writes: Array<{ table: string; op: string; payload: Row }> = [];
let existing: Row | null = null;

function builder(table: string) {
  const state: { op: string; payload?: Row } = { op: 'select' };
  const result = () => {
    if (state.op !== 'select') writes.push({ table, op: state.op, payload: state.payload! });
    return { data: state.op === 'select' ? existing : null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
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
vi.mock('@/lib/api-auth', () => ({
  verifyUserSession: async () => ({ authenticated: true, email: 'new.user@example.com', createdAt: null }),
}));
vi.mock('@/lib/attribution/claim-from-request', () => ({ scheduleAttributionClaim: () => {} }));

const PLACEHOLDER = ['541512', '541611', '541330', '541990', '561210'];

async function completeSignup() {
  const { POST } = await import('./route');
  const res = await POST(new NextRequest('http://localhost/api/auth/mindy-complete-signup', { method: 'POST' }));
  expect(res.status).toBe(200);
}

describe('POST /api/auth/mindy-complete-signup — no unchosen profile', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    writes.length = 0;
    existing = null;
  });

  it('a brand-new email signup gets a settings row WITHOUT placeholder codes', async () => {
    await completeSignup();
    const inserts = writes.filter((w) => w.table === 'user_notification_settings' && w.op === 'insert');
    expect(inserts).toHaveLength(1);
    const row = inserts[0].payload;
    expect(row.user_email).toBe('new.user@example.com');
    // The defect: naics_codes = PLACEHOLDER with no naics_source.
    expect(row.naics_codes ?? []).not.toEqual(PLACEHOLDER);
    expect(row.naics_codes ?? []).toEqual([]);
  });

  it('never writes placeholder codes without system_default provenance', async () => {
    await completeSignup();
    for (const w of writes) {
      const codes = (w.payload.naics_codes as string[] | undefined) ?? [];
      if ([...codes].sort().join(',') === [...PLACEHOLDER].sort().join(',')) {
        expect(w.payload.naics_source).toBe('system_default');
      }
    }
  });

  it('an existing account is not given codes by completing signup', async () => {
    existing = { user_email: 'new.user@example.com', treatment_type: 'free' };
    await completeSignup();
    for (const w of writes) expect(w.payload).not.toHaveProperty('naics_codes');
  });
});
