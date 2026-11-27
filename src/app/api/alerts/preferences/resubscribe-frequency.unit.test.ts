/**
 * Re-subscribe restores a REAL cadence (Agent 4, 2026-11-27). Unsubscribe sets alert_frequency='paused'; turning
 * alerts back on without naming a cadence must restore the one stored at unsubscribe time (else 'daily'), never
 * leave alerts "on" but paused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const db: { settings: Row | null; suppression: Row | null; writes: Row[]; deleted: number } = { settings: null, suppression: null, writes: [], deleted: 0 };

function builder(table: string) {
  const state: { op: 'select' | 'update' | 'insert' | 'upsert' | 'delete'; payload?: Row } = { op: 'select' };
  const result = () => {
    if (table === 'user_notification_settings') {
      if (state.op === 'update' || state.op === 'insert' || state.op === 'upsert') {
        db.writes.push(state.payload!);
        db.settings = { ...(db.settings ?? {}), ...state.payload };
      }
      return { data: db.settings, error: null };
    }
    if (table === 'email_suppressions') {
      if (state.op === 'delete') { db.deleted++; db.suppression = null; return { data: null, error: null }; }
      return { data: db.suppression, error: null };
    }
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b,
    update: (p: Row) => { state.op = 'update'; state.payload = p; return b; },
    insert: (p: Row) => { state.op = 'insert'; state.payload = p; return b; },
    upsert: (p: Row) => { state.op = 'upsert'; state.payload = p; return b; },
    delete: () => { state.op = 'delete'; return b; },
    maybeSingle: async () => result(), single: async () => result(),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
  };
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/app/workspace', () => ({ resolveActiveWorkspace: async () => ({ workspaceId: null, asClient: false }), clientNotificationEmail: (id: string) => `client-${id}` }));
vi.mock('@/lib/app/derive-agencies-from-naics', () => ({ deriveAgenciesFromProfile: async () => [] }));

const EMAIL = 'user@example.com';
async function post(body: Row) {
  const { POST } = await import('./route');
  const res = await POST(new NextRequest('http://localhost/api/alerts/preferences', {
    method: 'POST', body: JSON.stringify({ email: EMAIL, ...body }), headers: { 'content-type': 'application/json' },
  }));
  expect(res.status).toBe(200);
  return db.writes.at(-1)!;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  db.settings = { user_email: EMAIL, agencies: [], keywords: [], aggregated_profile: {}, naics_codes: ['541512'], alerts_enabled: false, alert_frequency: 'paused' };
  db.suppression = null; db.writes = []; db.deleted = 0;
});

describe('re-enabling alerts after an unsubscribe', () => {
  it('restores the cadence stored at unsubscribe time and clears the unsubscribe suppression', async () => {
    db.suppression = { reason: 'unsubscribe', metadata: { via: 'unsubscribe_page', previous_alert_frequency: 'mwf' } };
    const w = await post({ alertsEnabled: true });
    expect(w).toMatchObject({ alerts_enabled: true, alert_frequency: 'mwf' });
    expect(db.deleted).toBe(1);
  });
  it('no stored cadence → the default (daily), never paused', async () => {
    const w = await post({ alertsEnabled: true });
    expect(w).toMatchObject({ alerts_enabled: true, alert_frequency: 'daily' });
  });
  it('an explicit cadence wins; an already-active cadence is left alone', async () => {
    db.suppression = { reason: 'unsubscribe', metadata: { previous_alert_frequency: 'mwf' } };
    expect(await post({ alertsEnabled: true, frequency: 'weekly' })).toMatchObject({ alert_frequency: 'weekly' });
    db.settings = { ...db.settings, alert_frequency: 'tth', alerts_enabled: true };
    expect((await post({ alertsEnabled: true })).alert_frequency).toBeUndefined();
  });
});
