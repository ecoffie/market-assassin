/**
 * SEC-5d — the promotional partner trial: verified identity only, one per account ever,
 * never stacked on active Pro, never touches alerts. Drives claimPartnerReferral against an
 * in-memory store that ENFORCES the partner_referral_claims primary key (the atomic gate).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimPartnerReferral } from './partner-referral-claim';

type Row = Record<string, unknown>;
let settings: Map<string, Row>;
let claims: Map<string, Row>;
let failSettingsWrite = false;

function from(table: string) {
  const st: { op: string; payload?: Row; eq: Record<string, unknown>; count?: boolean } = { op: 'select', eq: {} };
  const store = table === 'user_notification_settings' ? settings : claims;
  const run = async () => {
    await Promise.resolve(); // yield so concurrent claims genuinely interleave
    const key = String(st.eq.user_email ?? st.payload?.user_email ?? '');
    if (st.op === 'select') return { data: store.get(key) ? { ...store.get(key) } : null, error: null };
    if (st.op === 'insert') {
      if (store.has(key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      store.set(key, { ...st.payload });
      return { data: null, error: null };
    }
    if (st.op === 'update') {
      if (table === 'user_notification_settings' && failSettingsWrite) return { data: null, count: null, error: { message: 'injected' } };
      if (!store.has(key)) return { data: null, count: 0, error: null };
      store.set(key, { ...store.get(key), ...st.payload });
      return { data: null, count: 1, error: null };
    }
    if (st.op === 'delete') { store.delete(key); return { data: null, error: null }; }
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { st.eq[c] = v; return b; },
    insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
    update: (p: Row, o?: { count?: string }) => { st.op = 'update'; st.payload = p; st.count = !!o?.count; return b; },
    delete: () => { st.op = 'delete'; return b; },
    maybeSingle: () => run(),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
  };
  return b;
}
const sb = { from } as unknown as SupabaseClient;
const NOW = Date.parse('2026-10-03T12:00:00Z');
const free = { hasActivePro: async () => false, now: () => NOW };
const pro = { hasActivePro: async () => true, now: () => NOW };

const UNSUB: Row = { user_email: 'unsub@example.com', alerts_enabled: false, alert_frequency: 'paused', briefings_enabled: false, paid_status: false, trial_source: null, invitation_source: null };
const freeRow = (email: string): Row => ({ user_email: email, alerts_enabled: true, alert_frequency: 'daily', briefings_enabled: false, paid_status: false, trial_source: null, invitation_source: null });

beforeEach(() => {
  settings = new Map();
  claims = new Map();
  failSettingsWrite = false;
});

describe('who may claim', () => {
  it('invalid partner code → no trial, nothing consumed', async () => {
    settings.set('a@example.com', freeRow('a@example.com'));
    expect((await claimPartnerReferral(sb, 'a@example.com', 'NOPE', 'mindy_session', free)).status).toBe('invalid_code');
    expect(claims.size).toBe(0);
    expect(settings.get('a@example.com')?.trial_ends_at).toBeUndefined();
  });

  it('verified NEW Free account (row created at onboarding) → exactly one trial, attributed', async () => {
    settings.set('new@example.com', freeRow('new@example.com'));
    const r = await claimPartnerReferral(sb, 'new@example.com', 'mdeat', 'mindy_session', free);
    expect(r.status).toBe('claimed');
    expect(settings.get('new@example.com')?.trial_ends_at).toBe(new Date(NOW + 30 * 864e5).toISOString());
    expect(settings.get('new@example.com')?.trial_source).toBe('partner_mdeat');
    expect(claims.get('new@example.com')?.partner_code).toBe('MDEAT');
  });

  it('verified EXISTING Free account → one trial', async () => {
    settings.set('old@example.com', { ...freeRow('old@example.com'), naics_codes: ['541512'] });
    expect((await claimPartnerReferral(sb, 'old@example.com', 'NCMBC', 'supabase_session', free)).status).toBe('claimed');
    expect(claims.get('old@example.com')?.partner_code).toBe('NCMBC');
  });

  it('no settings row yet → profile_required; nothing consumed and no row created', async () => {
    expect((await claimPartnerReferral(sb, 'norow@example.com', 'MDEAT', 'mindy_session', free)).status).toBe('profile_required');
    expect(claims.size).toBe(0);
    expect(settings.size).toBe(0);
  });

  it('active Paid/Pro/Team → no promotional trial stacked, nothing consumed', async () => {
    settings.set('paid@example.com', { ...freeRow('paid@example.com'), paid_status: true });
    expect((await claimPartnerReferral(sb, 'paid@example.com', 'MDEAT', 'mindy_session', pro)).status).toBe('not_eligible_active_pro');
    expect(claims.size).toBe(0);
    expect(settings.get('paid@example.com')?.trial_ends_at).toBeUndefined();
  });
});

describe('one promotional partner trial per account, ever', () => {
  it('same code replay → no second trial', async () => {
    settings.set('a@example.com', freeRow('a@example.com'));
    await claimPartnerReferral(sb, 'a@example.com', 'MDEAT', 'mindy_session', free);
    const first = settings.get('a@example.com')?.trial_ends_at;
    const r = await claimPartnerReferral(sb, 'a@example.com', 'MDEAT', 'mindy_session', { ...free, now: () => NOW + 864e5 });
    expect(r.status).toBe('already_claimed');
    expect(settings.get('a@example.com')?.trial_ends_at).toBe(first);
  });

  it('a different partner after the first trial → no second trial', async () => {
    settings.set('a@example.com', freeRow('a@example.com'));
    await claimPartnerReferral(sb, 'a@example.com', 'MDEAT', 'mindy_session', free);
    expect((await claimPartnerReferral(sb, 'a@example.com', 'NCMBC', 'mindy_session', free)).status).toBe('already_claimed');
    expect(settings.get('a@example.com')?.trial_source).toBe('partner_mdeat');
  });

  it('an EXPIRED prior partner trial is not renewed (the claim row, not expiry, is the record)', async () => {
    settings.set('a@example.com', freeRow('a@example.com'));
    claims.set('a@example.com', { user_email: 'a@example.com', partner_code: 'MDEAT', trial_ends_at: '2026-01-01T00:00:00Z' });
    expect((await claimPartnerReferral(sb, 'a@example.com', 'MDEAT', 'mindy_session', free)).status).toBe('already_claimed');
    expect(settings.get('a@example.com')?.trial_ends_at).toBeUndefined();
  });

  it('a historical pre-fix partner tag counts as consumed and the row is left byte-identical', async () => {
    const legacy = { ...freeRow('legacy@example.com'), trial_source: 'partner_mdeat', invitation_source: 'partner_mdeat', trial_ends_at: '2026-07-27T00:00:00Z' };
    settings.set('legacy@example.com', { ...legacy });
    const r = await claimPartnerReferral(sb, 'legacy@example.com', 'NCMBC', 'mindy_session', free);
    expect(r.status).toBe('already_claimed');
    expect(settings.get('legacy@example.com')).toEqual(legacy);
    expect(claims.size).toBe(0);
  });

  it('simultaneous claims → exactly one grant', async () => {
    settings.set('race@example.com', freeRow('race@example.com'));
    const results = await Promise.all(Array.from({ length: 5 }, () => claimPartnerReferral(sb, 'race@example.com', 'MDEAT', 'mindy_session', free)));
    expect(results.filter((r) => r.status === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'already_claimed')).toHaveLength(4);
  });

  it('a failed trial write releases the claim so the user can retry', async () => {
    settings.set('a@example.com', freeRow('a@example.com'));
    failSettingsWrite = true;
    expect((await claimPartnerReferral(sb, 'a@example.com', 'MDEAT', 'mindy_session', free)).status).toBe('error');
    expect(claims.size).toBe(0);
    failSettingsWrite = false;
    expect((await claimPartnerReferral(sb, 'a@example.com', 'MDEAT', 'mindy_session', free)).status).toBe('claimed');
  });
});

describe('alerts are never written', () => {
  it('unsubscribed user → claim the trial → still unsubscribed, alert fields byte-identical', async () => {
    settings.set('unsub@example.com', { ...UNSUB });
    expect((await claimPartnerReferral(sb, 'unsub@example.com', 'MDEAT', 'mindy_session', free)).status).toBe('claimed');
    const after = settings.get('unsub@example.com')!;
    for (const k of ['alerts_enabled', 'alert_frequency', 'briefings_enabled', 'paid_status']) expect(after[k]).toEqual(UNSUB[k]);
  });

  it('the only columns written are trial_ends_at, trial_source, invitation_source, updated_at', async () => {
    settings.set('a@example.com', freeRow('a@example.com'));
    const before = { ...settings.get('a@example.com')! };
    await claimPartnerReferral(sb, 'a@example.com', 'MDEAT', 'mindy_session', free);
    const after = settings.get('a@example.com')!;
    const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])).sort();
    expect(changed).toEqual(['invitation_source', 'trial_ends_at', 'trial_source', 'updated_at']);
  });
});
