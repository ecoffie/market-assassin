/**
 * Executes the REAL migration chain in an in-process Postgres (PGlite) and proves the
 * database half of pooled team credits (tasks/PRD-pooled-team-credits.md):
 *
 *   · replenishment tops a pool up to its monthly allowance — never stacked, never
 *     refilled by spending, a mid-month upgrade grants only the difference, and an
 *     annual pool is simply replenished again next month;
 *   · the one-time personal → pool transfer moves ALLOWANCE only, is idempotent, and
 *     refuses (atomically) to touch purchased credits.
 *
 * Never touches a real database. Runs in `npm run test:unit` and the pre-push gate.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const mig = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8');
const MIGRATION = mig('20260929_pooled_team_credits.sql');
const db = new PGlite();
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

let poolId = '';
let orgId = '';

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;`);
  // The real prior schema this migration builds on, in the order the runner applies it.
  for (const f of [
    '20260605_coach_mode_orgs.sql',
    '20260712_mcp_credit_ledger.sql',
    '20260908_org_stripe_linkage.sql',
    '20260908_mcp_credit_pool.sql',
    '20260915_credit_pools_purchased.sql',
  ]) {
    await db.exec(mig(f));
  }
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // idempotent re-apply

  const org = await one<{ id: string }>(
    `INSERT INTO organizations (name, slug, seat_limit, pool_monthly_credits, pool_plan_key)
     VALUES ('Acme', 'acme', 2, 1000, 'team') RETURNING id`,
  );
  orgId = org!.id;
  const pool = await one<{ pool_id: string }>(
    `INSERT INTO mcp_credit_pool (org_id) VALUES ($1) RETURNING pool_id`, [orgId],
  );
  poolId = pool!.pool_id;
}, 60_000);

const replenish = (key: string, ceiling: number) =>
  one<{ applied: boolean; granted: number; new_balance: number }>(
    `SELECT * FROM mcp_replenish_pool($1, $2, $3, 'pool_monthly')`, [key, poolId, ceiling],
  );
const poolBalance = async () =>
  (await one<{ balance: number }>(`SELECT balance FROM mcp_credit_pool WHERE pool_id = $1`, [poolId]))!.balance;
const spend = (n: number) =>
  db.query(`UPDATE mcp_credit_pool SET balance = balance - $2 WHERE pool_id = $1`, [poolId, n]);

describe('schema', () => {
  it('adds seat/allowance config with sane constraints', async () => {
    await expect(db.query(`UPDATE organizations SET seat_limit = 0 WHERE id = $1`, [orgId])).rejects.toThrow();
    await expect(db.query(`UPDATE organizations SET pool_monthly_credits = -1 WHERE id = $1`, [orgId])).rejects.toThrow();
  });

  it('allows only one pending invite per org + email', async () => {
    await db.query(
      `INSERT INTO org_member_invites (org_id, invited_email, invited_by, token_hash, expires_at)
       VALUES ($1, 'a@x.com', 'owner@x.com', 'h1', now() + interval '7 days')`, [orgId],
    );
    await expect(db.query(
      `INSERT INTO org_member_invites (org_id, invited_email, invited_by, token_hash, expires_at)
       VALUES ($1, 'a@x.com', 'owner@x.com', 'h2', now() + interval '7 days')`, [orgId],
    )).rejects.toThrow();
  });
});

describe('mcp_replenish_pool', () => {
  const m1 = `pool:${'org'}:2026-10`;
  const m2 = `pool:${'org'}:2026-11`;

  it('tops an empty pool up to the monthly allowance and writes a pool-sentinel ledger row', async () => {
    const r = await replenish(m1, 1000);
    expect(r).toMatchObject({ applied: true, granted: 1000, new_balance: 1000 });
    const row = await one<{ user_email: string; delta: number; charged_pool_id: string }>(
      `SELECT user_email, delta, charged_pool_id FROM mcp_credit_ledger WHERE reason = 'pool_monthly' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(row).toEqual({ user_email: `pool:${poolId}`, delta: 1000, charged_pool_id: poolId });
  });

  it('is a no-op on a re-run at the same ceiling (no double grant)', async () => {
    const r = await replenish(m1, 1000);
    expect(r).toMatchObject({ applied: false, granted: 0 });
    expect(await poolBalance()).toBe(1000);
  });

  it('never refills what was spent within the month', async () => {
    await spend(400);
    const r = await replenish(m1, 1000);
    expect(r!.granted).toBe(0);
    expect(await poolBalance()).toBe(600);
  });

  it('a mid-month upgrade grants only the difference, not the spent amount', async () => {
    const r = await replenish(m1, 3500);
    expect(r!.granted).toBe(2500); // 3500 − 1000 already granted, NOT 3500 − 600
    expect(await poolBalance()).toBe(3100);
  });

  it('a lower ceiling never grants', async () => {
    const r = await replenish(m1, 500);
    expect(r!.granted).toBe(0);
  });

  it('replenishes monthly (annual subscriptions included): next month tops back up to the allowance', async () => {
    await spend(3000); // 100 left
    const r = await replenish(m2, 3500);
    expect(r!.granted).toBe(3400);
    expect(await poolBalance()).toBe(3500);
  });

  it('raises on a missing pool instead of silently doing nothing', async () => {
    await expect(db.query(
      `SELECT * FROM mcp_replenish_pool('k', gen_random_uuid(), 100, 'pool_monthly')`,
    )).rejects.toThrow(/no pool/);
  });
});

describe('mcp_transfer_personal_to_pool', () => {
  const user = 'owner@acme.com';

  beforeAll(async () => {
    // 1,500 balance, 500 of it purchased → 1,000 allowance.
    await db.query(`INSERT INTO mcp_credit_balance (user_email, balance, purchased_balance) VALUES ($1, 1500, 500)`, [user]);
  });

  const transfer = (key: string, amount: number) =>
    one<{ applied: boolean; moved: number; personal_balance: number; pool_balance: number }>(
      `SELECT * FROM mcp_transfer_personal_to_pool($1, $2, $3, $4, '{"test":true}'::jsonb)`,
      [key, user, poolId, amount],
    );

  it('refuses to move more than the allowance and changes nothing', async () => {
    const before = await poolBalance();
    await expect(transfer('mig:too-much', 1200)).rejects.toThrow(/exceeds allowance/);
    const bal = await one<{ balance: number; purchased_balance: number }>(
      `SELECT balance, purchased_balance FROM mcp_credit_balance WHERE user_email = $1`, [user],
    );
    expect(bal).toEqual({ balance: 1500, purchased_balance: 500 });
    expect(await poolBalance()).toBe(before);
    // The failed call's claim row was rolled back with it, so the key is reusable.
    expect(await one(`SELECT 1 FROM mcp_pool_grants WHERE idempotency_key = 'mig:too-much'`)).toBeUndefined();
  });

  it('moves allowance only, keeps purchased credits, writes both ledger sides', async () => {
    const before = await poolBalance();
    const r = await transfer('mig:owner', 800);
    expect(r).toMatchObject({ applied: true, moved: 800, personal_balance: 700, pool_balance: before + 800 });
    const bal = await one<{ balance: number; purchased_balance: number }>(
      `SELECT balance, purchased_balance FROM mcp_credit_balance WHERE user_email = $1`, [user],
    );
    expect(bal).toEqual({ balance: 700, purchased_balance: 500 });
    const out = await one<{ delta: number }>(`SELECT delta FROM mcp_credit_ledger WHERE reason = 'pool_migration_out'`);
    const inn = await one<{ delta: number; user_email: string }>(`SELECT delta, user_email FROM mcp_credit_ledger WHERE reason = 'pool_migration_in'`);
    expect(out!.delta).toBe(-800);
    expect(inn).toEqual({ delta: 800, user_email: `pool:${poolId}` });
    const audit = await one<{ credits: number; source_email: string; details: { test: boolean } }>(
      `SELECT credits, source_email, details FROM mcp_pool_grants WHERE idempotency_key = 'mig:owner'`,
    );
    expect(audit).toEqual({ credits: 800, source_email: user, details: { test: true } });
  });

  it('is idempotent: a replay moves nothing', async () => {
    const before = await poolBalance();
    const r = await transfer('mig:owner', 800);
    expect(r).toMatchObject({ applied: false, moved: 0, personal_balance: 700 });
    expect(await poolBalance()).toBe(before);
  });
});
