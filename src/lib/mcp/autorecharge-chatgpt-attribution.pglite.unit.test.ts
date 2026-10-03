/**
 * ChatGPT-attributed auto-recharge suppression — the DATABASE half, executed against the
 * REAL migration chain in an in-process Postgres (PGlite). Never touches a real database.
 *
 * OWNER-APPROVED INVARIANT (frozen):
 *   An automatic payment is permitted only if the account would still be eligible if every
 *   ChatGPT-originated debit since the last successful recharge were removed from the
 *   eligibility calculation.
 *
 * S = mcp_credit_balance.chatgpt_spend_since_recharge. Eligible iff
 *   balance < T  AND  balance + S < T     (T = current threshold_credits)
 *
 * ⚠️ PGlite is a SINGLE connection: "parallel" calls below are issued concurrently from JS
 * but execute one at a time, so row-lock contention between real backends is NOT exercised
 * here. The concurrency guarantee rests on S being written in the SAME guarded UPDATE as
 * the debit (one statement = one row lock); the concurrency test proves the accounting is
 * exact under interleaved issuance, not lock behaviour.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const mig = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8');
const MIGRATION = mig('20261003_mcp_autorecharge_chatgpt_attribution.sql');
const db = new PGlite();
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

let poolId = '';

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;`);
  // The real prior schema, in the order the runner applies it (lexical = chronological).
  for (const f of [
    '20260605_coach_mode_orgs.sql',
    '20260712_mcp_credit_ledger.sql',
    '20260712_mcp_credit_topups.sql',
    '20260716_mcp_autorecharge.sql',
    '20260908_org_stripe_linkage.sql',
    '20260908_mcp_credit_pool.sql',
    '20260909_mcp_pool_debit.sql',
    '20260915_credit_pools_purchased.sql',
    '20260915_credit_pools_grant_paths.sql',
  ]) {
    await db.exec(mig(f));
  }
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // idempotent re-apply

  const org = await one<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id`,
  );
  const pool = await one<{ pool_id: string }>(
    `INSERT INTO mcp_credit_pool (org_id, balance) VALUES ($1, 10000) RETURNING pool_id`, [org!.id],
  );
  poolId = pool!.pool_id;
}, 60_000);

// ---- helpers -------------------------------------------------------------------------
let seq = 0;
const freshUser = () => `u${++seq}@x.com`;

async function setup(user: string, opts: { balance: number; threshold?: number; enabled?: boolean; card?: boolean }) {
  if (opts.balance > 0) await db.query(`SELECT mcp_grant_credits($1, $2, 'signup_grant')`, [user, opts.balance]);
  await db.query(
    `INSERT INTO mcp_autorecharge (user_email, enabled, threshold_credits, refill_package, stripe_customer_id, stripe_payment_method_id)
     VALUES ($1, $2, $3, 'refill', $4, $5)`,
    [user, opts.enabled ?? true, opts.threshold ?? 100, opts.card === false ? null : 'cus_1', opts.card === false ? null : 'pm_1'],
  );
}
const debit = async (user: string, amount: number, channel?: 'chatgpt') =>
  (await one<{ ok: boolean; new_balance: number }>(
    channel
      ? `SELECT * FROM mcp_debit_credits(p_user => $1, p_amount => $2, p_reason => 'tool_call', p_tool => 't', p_api_key_id => NULL, p_channel => $3)`
      : `SELECT * FROM mcp_debit_credits(p_user => $1, p_amount => $2, p_reason => 'tool_call', p_tool => 't', p_api_key_id => NULL)`,
    channel ? [user, amount, channel] : [user, amount],
  ))!;
const chatgpt = (user: string, amount: number) => debit(user, amount, 'chatgpt');
const claim = async (user: string) =>
  (await one<{ claimed: boolean; reason: string }>(`SELECT * FROM mcp_autorecharge_claim($1, 90, 3)`, [user]))!;
/** Clear debounce + daily-cap state so the next claim tests ELIGIBILITY only. */
const clearDebounce = (user: string) =>
  db.query(`UPDATE mcp_autorecharge SET last_attempt_at = NULL, attempts_today = 0 WHERE user_email = $1`, [user]);
const apply = async (key: string, user: string, credits: number, reason: string) =>
  (await one<{ applied: boolean; new_balance: number }>(`SELECT * FROM mcp_apply_credit($1, $2, $3, $4)`, [key, user, credits, reason]))!;
const state = async (user: string) =>
  (await one<{ balance: number; s: number; purchased: number }>(
    `SELECT balance, chatgpt_spend_since_recharge AS s, purchased_balance AS purchased FROM mcp_credit_balance WHERE user_email = $1`, [user],
  ))!;
const settings = async (user: string) =>
  (await one<{ last_attempt_at: string | null; attempts_today: number; claimed_chatgpt_spend: number | null }>(
    `SELECT last_attempt_at, attempts_today, claimed_chatgpt_spend FROM mcp_autorecharge WHERE user_email = $1`, [user],
  ))!;
const setThreshold = (user: string, t: number) =>
  db.query(`UPDATE mcp_autorecharge SET threshold_credits = $2 WHERE user_email = $1`, [user, t]);
const gate = async (b: number, s: number, t: number) =>
  (await one<{ g: string }>(`SELECT mcp_recharge_gate($1, $2, $3) AS g`, [b, s, t]))!.g;

// ---- schema ---------------------------------------------------------------------------
describe('schema', () => {
  it('S column defaults to 0 and rejects negatives', async () => {
    const u = freshUser();
    await setup(u, { balance: 10 });
    expect((await state(u)).s).toBe(0);
    await expect(db.query(`UPDATE mcp_credit_balance SET chatgpt_spend_since_recharge = -1 WHERE user_email = $1`, [u])).rejects.toThrow();
  });

  it('exactly ONE mcp_debit_credits exists (old 5-arg overload dropped — no PostgREST ambiguity)', async () => {
    const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'mcp_debit_credits'`);
    expect(r!.n).toBe(1);
  });

  it('legacy 5-arg call (named AND positional) still works and leaves S unchanged + ledger channel NULL', async () => {
    const u = freshUser();
    await setup(u, { balance: 100 });
    expect(await debit(u, 7)).toEqual({ ok: true, new_balance: 93 });
    const pos = await one<{ ok: boolean; new_balance: number }>(`SELECT * FROM mcp_debit_credits($1, 3, 'tool_call', 't', NULL)`, [u]);
    expect(pos).toEqual({ ok: true, new_balance: 90 });
    expect((await state(u)).s).toBe(0);
    const ch = await db.query<{ channel: string | null }>(`SELECT channel FROM mcp_credit_ledger WHERE user_email = $1 AND delta < 0`, [u]);
    expect(ch.rows.map((r) => r.channel)).toEqual([null, null]);
  });

  it('a ChatGPT debit writes channel=chatgpt on the ledger and S += amount; insufficient debit touches nothing', async () => {
    const u = freshUser();
    await setup(u, { balance: 100 });
    expect(await chatgpt(u, 40)).toEqual({ ok: true, new_balance: 60 });
    expect(await chatgpt(u, 61)).toEqual({ ok: false, new_balance: 60 });
    expect(await state(u)).toMatchObject({ balance: 60, s: 40 });
    const ch = await one<{ channel: string }>(`SELECT channel FROM mcp_credit_ledger WHERE user_email = $1 AND delta < 0`, [u]);
    expect(ch!.channel).toBe('chatgpt');
  });

  it('the pool guard trigger accepts the combined UPDATE and keeps purchased bounds (allowance-first)', async () => {
    const u = freshUser();
    await setup(u, { balance: 50 });
    await apply('pi_purchase_bounds', u, 100, 'stripe_topup'); // purchased 100, allowance 50
    await chatgpt(u, 80); // 50 allowance + 30 purchased
    expect(await state(u)).toEqual({ balance: 70, s: 80, purchased: 70 });
  });

  it('mcp_recharge_gate truth table', async () => {
    expect(await gate(100, 0, 100)).toBe('sufficient');
    expect(await gate(99, 0, 100)).toBe('eligible');
    expect(await gate(99, 1, 100)).toBe('chatgpt_caused'); // H == T is NOT eligible
    expect(await gate(50, 49, 100)).toBe('eligible');
    expect(await gate(0, 0, 100)).toBe('eligible');
  });
});

// ---- named owner scenarios -----------------------------------------------------------
describe('owner scenarios', () => {
  it('ChatGPT-only depletion → chatgpt_caused, all the way to zero', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100 });
    await chatgpt(u, 150);
    expect(await claim(u)).toEqual({ claimed: false, reason: 'chatgpt_caused' });
    await chatgpt(u, 50);
    expect(await state(u)).toMatchObject({ balance: 0, s: 200 });
    expect(await claim(u)).toEqual({ claimed: false, reason: 'chatgpt_caused' });
  });

  it('normal-only depletion → eligible (behaviour unchanged), snapshot 0', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100 });
    await debit(u, 150);
    expect(await claim(u)).toEqual({ claimed: true, reason: 'ok' });
    expect((await settings(u)).claimed_chatgpt_spend).toBe(0);
  });

  it('ChatGPT → 1-credit normal call stays suppressed', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100 });
    await chatgpt(u, 150); // 50, S 150
    await debit(u, 1); // 49, H 199
    expect(await claim(u)).toEqual({ claimed: false, reason: 'chatgpt_caused' });
    expect((await state(u)).s).toBe(150); // normal debit does NOT reset S
  });

  it('ChatGPT → enough normal use to independently cross: eligible only once balance + S < T', async () => {
    const u = freshUser();
    await setup(u, { balance: 1000, threshold: 100 });
    await chatgpt(u, 30); // 970, S 30
    await debit(u, 900); // 70, H 100 == T
    expect(await claim(u)).toEqual({ claimed: false, reason: 'chatgpt_caused' });
    await debit(u, 1); // 69, H 99 < T
    expect(await claim(u)).toEqual({ claimed: true, reason: 'ok' });
    expect((await settings(u)).claimed_chatgpt_spend).toBe(30);
  });

  it('normal → ChatGPT: ChatGPT crossing the threshold is suppressed', async () => {
    const u = freshUser();
    await setup(u, { balance: 1000, threshold: 100 });
    await debit(u, 880); // 120 sufficient
    expect(await claim(u)).toEqual({ claimed: false, reason: 'sufficient' });
    await chatgpt(u, 50); // 70, H 120
    expect(await claim(u)).toEqual({ claimed: false, reason: 'chatgpt_caused' });
  });

  it('already below threshold before ChatGPT → stays eligible (ChatGPT never blocks an independent need)', async () => {
    const u = freshUser();
    await setup(u, { balance: 1000, threshold: 100 });
    await debit(u, 950); // 50, eligible on its own
    expect(await claim(u)).toEqual({ claimed: true, reason: 'ok' });
    await clearDebounce(u);
    await chatgpt(u, 20); // 30, H 50 < 100
    expect(await claim(u)).toEqual({ claimed: true, reason: 'ok' });
  });

  it('enabling auto-recharge after ChatGPT depletion does not erase S → stays suppressed', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100, enabled: false });
    await chatgpt(u, 180);
    expect(await claim(u)).toEqual({ claimed: false, reason: 'disabled' });
    await db.query(`UPDATE mcp_autorecharge SET enabled = true WHERE user_email = $1`, [u]);
    expect(await claim(u)).toEqual({ claimed: false, reason: 'chatgpt_caused' });
    expect((await state(u)).s).toBe(180);
  });

  it('disabled / paused / no card refuse BEFORE the new gate (unchanged reasons)', async () => {
    const a = freshUser();
    await setup(a, { balance: 10, threshold: 100, card: false });
    expect(await claim(a)).toEqual({ claimed: false, reason: 'no_card' });
    const b = freshUser();
    await setup(b, { balance: 500, threshold: 100 });
    await db.query(`UPDATE mcp_autorecharge SET paused = true WHERE user_email = $1`, [b]);
    expect(await claim(b)).toEqual({ claimed: false, reason: 'paused' });
    expect(await claim('nobody@x.com')).toEqual({ claimed: false, reason: 'no_settings' });
  });

  it('threshold change: uses the CURRENT T — raising creates eligibility only when balance + S < new T; lowering → sufficient', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100 });
    await chatgpt(u, 60); // 140, S 60, H 200
    expect(await claim(u)).toEqual({ claimed: false, reason: 'sufficient' });
    await setThreshold(u, 150); // 140 < 150 but H 200 >= 150
    expect(await claim(u)).toEqual({ claimed: false, reason: 'chatgpt_caused' });
    await setThreshold(u, 250); // H 200 < 250 → legitimately eligible
    expect(await claim(u)).toEqual({ claimed: true, reason: 'ok' });
    await clearDebounce(u);
    await setThreshold(u, 50);
    expect(await claim(u)).toEqual({ claimed: false, reason: 'sufficient' });
  });

  it('grants (Pro monthly / top-up / admin) leave S unchanged → suppression persists', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100 });
    await chatgpt(u, 180); // 20, S 180
    await apply(`pro:${u}:2026-10`, u, 30, 'pro_monthly');
    await db.query(`SELECT mcp_grant_credits($1, 20, 'admin_grant')`, [u]);
    await apply('cs_topup_1', u, 10, 'stripe_topup');
    expect(await state(u)).toMatchObject({ balance: 80, s: 180 });
    expect(await claim(u)).toEqual({ claimed: false, reason: 'chatgpt_caused' });
  });

  it('suppressed claims consume neither the debounce slot nor a daily attempt, and take no snapshot', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100 });
    expect(await claim(u)).toMatchObject({ reason: 'sufficient' });
    await chatgpt(u, 150);
    for (let i = 0; i < 5; i++) expect(await claim(u)).toMatchObject({ reason: 'chatgpt_caused' });
    expect(await settings(u)).toEqual({ last_attempt_at: null, attempts_today: 0, claimed_chatgpt_spend: null });
  });
});

describe('successful recharge resets the window (snapshot subtraction)', () => {
  it('forgives exactly the snapshot; ChatGPT spend during claim→grant carries over; double apply resets once', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100 });
    await chatgpt(u, 40); // 160, S 40
    await debit(u, 101); // 59, H 99
    expect(await claim(u)).toEqual({ claimed: true, reason: 'ok' });
    expect((await settings(u)).claimed_chatgpt_spend).toBe(40);

    await chatgpt(u, 10); // during the claim→grant window: 49, S 50

    // engine grant
    expect(await apply('pi_ok_1', u, 500, 'auto_recharge')).toEqual({ applied: true, new_balance: 549 });
    expect(await state(u)).toMatchObject({ balance: 549, s: 10 }); // 50 − 40
    expect((await settings(u)).claimed_chatgpt_spend).toBeNull();

    // webhook backstop for the SAME PaymentIntent → no-op, no second reset
    expect(await apply('pi_ok_1', u, 500, 'auto_recharge')).toEqual({ applied: false, new_balance: 549 });
    expect(await state(u)).toMatchObject({ balance: 549, s: 10 });
  });

  it('a declined PaymentIntent resets nothing (no grant reaches mcp_apply_credit); the next claim re-snapshots', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100 });
    await chatgpt(u, 20); // 180, S 20
    await debit(u, 100); // 80, H 100 → chatgpt_caused
    expect(await claim(u)).toMatchObject({ reason: 'chatgpt_caused' });
    await debit(u, 5); // 75, H 95
    expect(await claim(u)).toEqual({ claimed: true, reason: 'ok' });
    // …card declined: no apply.
    expect(await state(u)).toMatchObject({ balance: 75, s: 20 });
    await clearDebounce(u);
    await chatgpt(u, 2); // 73, S 22, H 95
    expect(await claim(u)).toEqual({ claimed: true, reason: 'ok' });
    expect((await settings(u)).claimed_chatgpt_spend).toBe(22);
    await apply('pi_ok_2', u, 500, 'auto_recharge');
    expect((await state(u)).s).toBe(0);
  });

  it('an auto_recharge grant with no claim snapshot forgives nothing', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100 });
    await chatgpt(u, 30);
    await apply('pi_orphan', u, 500, 'auto_recharge');
    expect((await state(u)).s).toBe(30);
  });
});

describe('pooled billing', () => {
  it('a pool debit by the member touches neither the member\'s balance nor S', async () => {
    const u = freshUser();
    await setup(u, { balance: 200, threshold: 100 });
    await chatgpt(u, 10);
    const before = await state(u);
    const r = await one<{ ok: boolean }>(
      `SELECT * FROM mcp_debit_pool($1, $2, 300, 'tool_call', 't', NULL)`, [poolId, u],
    );
    expect(r!.ok).toBe(true);
    expect(await state(u)).toEqual(before);
  });
});

describe('concurrency (interleaved issuance; see header re PGlite single connection)', () => {
  it('S equals the exact sum of ChatGPT debits and balance is exact', async () => {
    const u = freshUser();
    await setup(u, { balance: 10_000, threshold: 100 });
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 60; i++) {
      ops.push(chatgpt(u, 3));
      ops.push(debit(u, 2));
    }
    await Promise.all(ops);
    expect(await state(u)).toMatchObject({ balance: 10_000 - 60 * 5, s: 180 });
    const led = await one<{ s: number }>(
      `SELECT COALESCE(SUM(-delta), 0)::int AS s FROM mcp_credit_ledger WHERE user_email = $1 AND channel = 'chatgpt'`, [u],
    );
    expect(led!.s).toBe(180);
  });
});

describe('OPEN QUESTION — literal rule', () => {
  it('indefinite suppression: S never decays without an auto-recharge, so manual top-ups + Claude usage can never re-qualify the account', async () => {
    const u = freshUser();
    await setup(u, { balance: 1000, threshold: 50 });
    await chatgpt(u, 100); // 900, S 100
    await debit(u, 900); // 0, H 100 >= 50
    expect(await claim(u)).toMatchObject({ reason: 'chatgpt_caused' });
    for (let month = 0; month < 3; month++) {
      await apply(`cs_manual_${month}`, u, 30, 'stripe_topup'); // paid manual top-up
      await debit(u, 30); // Claude spends it all
      expect(await state(u)).toMatchObject({ balance: 0, s: 100 });
      expect(await claim(u)).toMatchObject({ claimed: false, reason: 'chatgpt_caused' });
    }
  });
});

// ---- property tests ------------------------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property', () => {
  it('no ChatGPT debit ever flips not-eligible → eligible; claim eligible ⇔ (balance excluding ChatGPT debits since last successful recharge) < T', async () => {
    const rand = mulberry32(20261003);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    let checks = 0;
    let flipsChecked = 0;
    let eligibleSeen = 0;
    let suppressedSeen = 0;

    for (let run = 0; run < 60; run++) {
      const u = freshUser();
      let T = int(20, 300);
      const start = int(0, 600);
      await setup(u, { balance: start, threshold: T });
      // Independent JS model: balance, and ChatGPT spend since the last successful recharge.
      let bal = start;
      let chatSinceRecharge = 0;

      for (let step = 0; step < 35; step++) {
        const op = rand();
        if (op < 0.3) {
          const a = int(1, 120);
          const gBefore = await gate(bal, chatSinceRecharge, T);
          const r = await chatgpt(u, a);
          if (r.ok) { bal -= a; chatSinceRecharge += a; }
          const gAfter = await gate(bal, chatSinceRecharge, T);
          if (gBefore !== 'eligible') { expect(gAfter).not.toBe('eligible'); flipsChecked++; }
        } else if (op < 0.55) {
          const a = int(1, 120);
          const r = await debit(u, a);
          if (r.ok) bal -= a;
        } else if (op < 0.62) {
          await one(`SELECT * FROM mcp_debit_pool($1, $2, 1, 'tool_call', 't', NULL)`, [poolId, u]);
        } else if (op < 0.7) {
          const a = int(1, 200);
          const reason = ['pro_monthly', 'stripe_topup', 'admin_grant'][int(0, 2)];
          await apply(`g:${u}:${step}`, u, a, reason);
          bal += a;
        } else if (op < 0.76) {
          T = int(20, 300);
          await setThreshold(u, T);
        } else {
          await clearDebounce(u);
          const c = await claim(u);
          const expectEligible = bal < T && bal + chatSinceRecharge < T;
          expect(c.claimed).toBe(expectEligible);
          if (!expectEligible) expect(c.reason).toBe(bal >= T ? 'sufficient' : 'chatgpt_caused');
          checks++;
          if (c.claimed) {
            eligibleSeen++;
            if (rand() < 0.75) {
              const pack = int(100, 600);
              await apply(`pi:${u}:${step}`, u, pack, 'auto_recharge');
              bal += pack;
              chatSinceRecharge = 0; // successful recharge closes the window
            } // else: declined — nothing resets
          } else if (c.reason === 'chatgpt_caused') suppressedSeen++;
        }
        const s = await state(u);
        expect(s.balance).toBe(bal);
        expect(s.s).toBe(chatSinceRecharge);
      }
    }
    // The generator must actually exercise every branch, or the property is vacuous.
    expect(checks).toBeGreaterThan(200);
    expect(flipsChecked).toBeGreaterThan(50);
    expect(eligibleSeen).toBeGreaterThan(10);
    expect(suppressedSeen).toBeGreaterThan(10);
  }, 120_000);
});
