/**
 * SEC-3: a signed-in user cannot use POST /api/briefings/preferences to change anything but
 * their delivery preferences. Drives the real handler and records every database write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Write = { op: string; table: string; payload: Record<string, unknown>; eq?: [string, unknown] };
const writes: Write[] = [];
let existingRow = true;

function table(name: string) {
  let w: Write | null = null;
  const q: Record<string, unknown> = {
    update(p: Record<string, unknown>) { w = { op: 'update', table: name, payload: p }; writes.push(w); return q; },
    upsert(p: Record<string, unknown>) { w = { op: 'upsert', table: name, payload: p }; writes.push(w); return q; },
    insert(p: Record<string, unknown>) { w = { op: 'insert', table: name, payload: p }; writes.push(w); return q; },
    select() { return q; },
    eq(c: string, v: unknown) { if (w) w.eq = [c, v]; return q; },
    single() {
      return Promise.resolve({ data: { timezone: 'America/Chicago', briefing_frequency: 'weekly', preferred_delivery_hour: 9, sms_enabled: false, phone_number: null }, error: null });
    },
    then(res: (v: unknown) => unknown) {
      return Promise.resolve({ data: null, count: w && w.op === 'update' ? (existingRow ? 1 : 0) : null, error: null }).then(res);
    },
  };
  return q;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (n: string) => table(n) }) }));
vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email: String(email).toLowerCase() }),
}));
vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: async () => ({ workspaceId: null, asClient: false }),
  clientNotificationEmail: () => 'client@x.test',
}));

const { POST } = await import('./route');
const call = (body: unknown) => POST(new NextRequest('https://getmindy.ai/api/briefings/preferences', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => { writes.length = 0; existingRow = true; });

const FORBIDDEN: Record<string, Record<string, unknown>> = {
  tier: { treatment_type: 'briefings' },
  'payment state': { paid_status: true },
  'subscription state': { subscription_status: 'active' },
  'stripe identity': { stripe_customer_id: 'cus_x' },
  'account identity': { user_email: 'victim@example.com' },
  'briefings entitlement': { briefings_enabled: true },
  'alerts toggle': { alerts_enabled: true },
  'alert cadence': { alert_frequency: 'daily' },
  'trial state': { trial_ends_at: '2099-01-01' },
  'targeting (unrelated)': { naics_codes: ['541512'] },
  'SMS consent bypass': { sms_enabled: true, phone_number: '5555550100' },
  'SMS verification': { phone_verified: true },
  'unknown column': { is_admin: true },
};

describe('a signed-in user cannot mutate protected fields', () => {
  for (const [label, extra] of Object.entries(FORBIDDEN)) {
    it(`${label} → 400, named, and nothing is written`, async () => {
      const res = await call({ email: 'me@example.com', timezone: 'America/Chicago', ...extra });
      const j = await res.json();
      expect(res.status).toBe(400);
      for (const k of Object.keys(extra)) expect(j.rejected).toContain(k);
      expect(writes).toHaveLength(0);
    });
  }
});

describe('allowed preferences still work', () => {
  it('writes ONLY the allowlisted, mapped fields to the caller\'s own row, via update', async () => {
    const res = await call({ email: 'Me@Example.com', timezone: 'America/Chicago', email_frequency: 'weekly', preferred_delivery_hour: 9 });
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe('update');
    expect(writes[0].eq).toEqual(['user_email', 'me@example.com']);
    expect(Object.keys(writes[0].payload).sort()).toEqual(['briefing_frequency', 'preferred_delivery_hour', 'timezone', 'updated_at']);
    expect(writes[0].payload).not.toHaveProperty('briefings_enabled');
  });

  it('validates values', async () => {
    for (const bad of [{ timezone: 'Mars/Olympus' }, { email_frequency: 'hourly' }, { preferred_delivery_hour: 24 }, { preferred_delivery_hour: '7' }, {}]) {
      const res = await call({ email: 'me@example.com', ...bad });
      expect(res.status).toBe(400);
    }
    expect(writes).toHaveLength(0);
  });
});

describe('no silent success, no row created with defaults', () => {
  it('missing settings row → 409, never an upsert/insert (DB defaults would turn briefings on)', async () => {
    existingRow = false;
    const res = await call({ email: 'me@example.com', timezone: 'America/Chicago' });
    expect(res.status).toBe(409);
    expect(writes.every((w) => w.op === 'update')).toBe(true);
  });
});
