/**
 * Prepaid entitlements — the DATABASE half, against the REAL migration chain in an
 * in-process Postgres (PGlite). Never touches a real database.
 *
 * Proves: the table's CHECKs bind the grant schedule to the recorded access end date; one
 * active schedule per account; the production credit RPC (mcp_apply_credit) refuses a
 * second grant for an already-claimed month (October), grants the next one once; and the
 * claim lookup pattern matches exactly that account's month.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { claimLikePattern, monthlyGrantKey } from './prepaid-entitlements';

const mig = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8');
const MIGRATION = mig('20261005_mcp_prepaid_entitlements.sql');
const db = new PGlite();
const EMAIL = 'delmarbennett@revoconstruction.com';

const row = (o: Record<string, unknown> = {}) => ({
  user_email: EMAIL, monthly_credits: 1500, first_month: '2026-10-01', last_month: '2027-03-01',
  access_starts_on: '2026-10-05', access_ends_on: '2027-04-05', source: 'invoice', created_by: 'test', ...o,
});
const insert = (o: Record<string, unknown> = {}) => {
  const r = row(o);
  const cols = Object.keys(r);
  return db.query(
    `INSERT INTO mcp_prepaid_entitlements (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(r),
  );
};
const apply = async (month: string) =>
  (await db.query<{ applied: boolean; new_balance: number }>(
    `SELECT * FROM mcp_apply_credit($1, $2, 1500, 'pro_monthly')`, [monthlyGrantKey(EMAIL, month), EMAIL],
  )).rows[0];
const balance = async () =>
  (await db.query<{ balance: number }>(`SELECT balance FROM mcp_credit_balance WHERE user_email = $1`, [EMAIL])).rows[0]?.balance;

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;`);
  for (const f of [
    '20260605_coach_mode_orgs.sql',
    '20260712_mcp_credit_ledger.sql',
    '20260712_mcp_credit_topups.sql',
    '20260716_mcp_autorecharge.sql',
    '20260819_mcp_signup_grant_idempotent.sql',
    '20260908_org_stripe_linkage.sql',
    '20260908_mcp_credit_pool.sql',
    '20260909_mcp_pool_debit.sql',
    '20260915_credit_pools_grant_paths.sql',
    '20260915_credit_pools_purchased.sql',
  ]) await db.exec(mig(f));
  await db.exec(`CREATE TABLE mcp_pool_grants (grant_key TEXT PRIMARY KEY, pool_id UUID NOT NULL,
    amount INTEGER NOT NULL, granted_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  await db.exec(mig('20260929_pooled_team_credits.sql'));
  await db.exec(mig('20261003_mcp_autorecharge_chatgpt_attribution.sql'));
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // idempotent re-apply
}, 60_000);

describe('mcp_prepaid_entitlements constraints', () => {
  it('accepts the 6-month schedule whose access ends 2027-04-05', async () => {
    await insert();
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mcp_prepaid_entitlements WHERE status = 'active'`);
    expect(r.rows[0].n).toBe(1);
  });

  it('rejects a second active schedule for the same account', async () => {
    await expect(insert()).rejects.toThrow();
  });

  it.each([
    ['access ends inside the last granted month', { access_ends_on: '2027-03-31' }],
    ['access runs into an ungranted month', { access_ends_on: '2027-05-01' }],
    ['first month is not the access start month', { first_month: '2026-11-01' }],
    ['month not on the 1st', { last_month: '2027-03-15' }],
    ['last month before first', { first_month: '2026-10-01', last_month: '2026-09-01' }],
    ['email not normalized', { user_email: 'Delmar@Example.com' }],
    ['unknown source', { source: 'stripe' }],
  ])('rejects: %s', async (_label, o) => {
    await expect(insert({ user_email: 'other@example.com', ...o })).rejects.toThrow();
  });
});

describe('monthly key against the production credit RPC', () => {
  it('October already granted → a retry is refused; November grants once', async () => {
    expect((await apply('2026-10')).applied).toBe(true); // the existing October grant
    expect(await balance()).toBe(1500);
    expect((await apply('2026-10')).applied).toBe(false); // retry / Stripe path / catch-up
    expect(await balance()).toBe(1500);
    expect((await apply('2026-11')).applied).toBe(true);
    expect((await apply('2026-11')).applied).toBe(false);
    expect(await balance()).toBe(3000);
  });

  it('claim pattern matches that month (add + ceiling keys) and nothing else', async () => {
    await db.query(`INSERT INTO mcp_credit_topups (idempotency_key, user_email, credits, reason) VALUES
      ($1, 'a_b@x.com', 0, 'sponsor_monthly'), ('pro:axb@x.com:2026-12', 'axb@x.com', 1500, 'pro_monthly')`,
      [`${monthlyGrantKey('a_b@x.com', '2026-12')}:c8000`]);
    const hits = async (email: string, month: string) =>
      (await db.query<{ k: string }>(`SELECT idempotency_key AS k FROM mcp_credit_topups WHERE idempotency_key LIKE $1`,
        [claimLikePattern(email, month)])).rows.map((r) => r.k).sort();
    expect(await hits(EMAIL, '2026-10')).toEqual([monthlyGrantKey(EMAIL, '2026-10')]);
    expect(await hits(EMAIL, '2026-12')).toEqual([]);
    expect(await hits('a_b@x.com', '2026-12')).toEqual(['pro:a_b@x.com:2026-12:c8000']); // not axb@x.com
  });
});
