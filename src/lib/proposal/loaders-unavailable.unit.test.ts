/** Unknown ≠ unavailable ≠ empty (CLAUDE.md rule 5): the Vault/settings loaders report a failed read instead
 * of letting it look like an empty profile, while keeping their old return shapes for existing callers. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  errors: {} as Record<string, string>,
  throwOn: null as string | null,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const result = () => {
        if (db.throwOn === table) throw new Error('network down');
        return db.errors[table] ? { data: null, error: { message: db.errors[table] } } : { data: db.rows[table] ?? null, error: null };
      };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'order']) q[m] = () => q;
      q.maybeSingle = async () => result();
      q.limit = async () => result();
      return q;
    },
  }),
}));

import { loadBidderProfile, loadBidderProfileResult, loadVaultContext, ALL_VAULT_SECTIONS } from './loaders';

beforeEach(() => {
  db.rows = {}; db.errors = {}; db.throwOn = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadBidderProfileResult', () => {
  it('ok: a row with data', async () => {
    db.rows.user_notification_settings = { naics_codes: ['561320'], set_aside_preferences: ['SDVOSB'], agencies: [], location_states: ['TN'], business_type: null };
    const r = await loadBidderProfileResult('a@example.com');
    expect(r.status).toBe('ok');
    expect(r.profile).toMatchObject({ naicsCodes: ['561320'], setAsides: ['SDVOSB'], locationStates: ['TN'] });
  });

  it('empty: no row', async () => {
    expect(await loadBidderProfileResult('a@example.com')).toEqual({ status: 'empty', profile: {} });
  });

  it('unavailable: a query error is not an empty profile', async () => {
    db.errors.user_notification_settings = 'column does not exist';
    expect(await loadBidderProfileResult('a@example.com')).toEqual({ status: 'unavailable', profile: {}, error: 'column does not exist' });
  });

  it('unavailable: a thrown failure is not an empty profile', async () => {
    db.throwOn = 'user_notification_settings';
    expect(await loadBidderProfileResult('a@example.com')).toMatchObject({ status: 'unavailable', profile: {}, error: 'network down' });
  });

  it('loadBidderProfile keeps its old contract ({} for empty and for failed)', async () => {
    expect(await loadBidderProfile('a@example.com')).toEqual({});
    db.errors.user_notification_settings = 'boom';
    expect(await loadBidderProfile('a@example.com')).toEqual({});
  });
});

describe('loadVaultContext.unavailable', () => {
  it('lists exactly the sections whose query failed; their fields still read empty (unchanged)', async () => {
    db.rows.user_identity_profile = { legal_name: 'Example Staffing Co' };
    db.errors.user_past_performance = 'timeout';
    db.errors.user_team_members = 'permission denied';
    const ctx = await loadVaultContext('a@example.com', 'exec_summary', { sections: ALL_VAULT_SECTIONS });
    expect(ctx.unavailable).toEqual(['past_performance', 'team']);
    expect(ctx.past_performance).toEqual([]);
    expect(ctx.team).toEqual([]);
    expect(ctx.identity).toEqual({ legal_name: 'Example Staffing Co' });
    expect(ctx.has_any).toBe(true);
  });

  it('no failure: no unavailable field at all (old shape)', async () => {
    const ctx = await loadVaultContext('a@example.com', 'exec_summary', { sections: ALL_VAULT_SECTIONS });
    expect(ctx).not.toHaveProperty('unavailable');
    expect(ctx.has_any).toBe(false);
  });
});
