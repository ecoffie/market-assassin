/**
 * Card chat, charge once per question: the DATABASE functions themselves, executed in a real Postgres
 * (PGlite, in-process) against the production body of mcp_debit_credits read from its migration file.
 *
 * The route tests mock these functions; this file proves the functions do what the mocks assume:
 * one claim per turn, a free replay of a saved answer, one debit per completed turn, and no debit without a
 * saved, recoverable answer (the save and the debit commit or roll back together).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(process.cwd(), 'supabase/migrations');
const N = 'a'.repeat(32), N2 = 'b'.repeat(32);
const S1 = '33333333-3333-4333-8333-333333333333';
const id = (d: string) => `${d.repeat(8)}-${d.repeat(4)}-4${d.repeat(3)}-8${d.repeat(3)}-${d.repeat(12)}`;

/** The live mcp_debit_credits definition (20261003 reproduces the body prod runs). */
function prodDebitFunction(): string {
  const src = readFileSync(join(MIG, '20261003_mcp_autorecharge_chatgpt_attribution.sql'), 'utf8');
  const start = src.indexOf('CREATE OR REPLACE FUNCTION mcp_debit_credits(');
  const end = src.indexOf('END $$;', start);
  if (start < 0 || end < 0) throw new Error('mcp_debit_credits body not found');
  return src.slice(start, end + 'END $$;'.length);
}

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as T[];
type Claim = { outcome: string; claim_token: string | null; answer: string | null; cited_sources: Array<{ title: string }>; session_id: string | null };
type Done = { outcome: string; credits_charged: number; new_balance: number | null };
const claim = async (t: string, o: { user?: string; notice?: string; q?: string; replay?: boolean; lease?: number } = {}) =>
  (await rows<Claim>('SELECT * FROM card_chat_claim_turn($1,$2,$3,$4,$5,$6,$7)',
    [t, o.user ?? 'u@x.com', o.notice ?? N, S1, o.q ?? 'When is it due?', o.lease ?? 300, o.replay ?? false]))[0];
const complete = async (t: string, tok: string | null, o: { credits?: number; answer?: string; user?: string } = {}) =>
  (await rows<Done>('SELECT * FROM card_chat_complete_turn($1,$2,$3,$4,$5::jsonb,$6,$7)',
    [t, tok, o.user ?? 'u@x.com', o.answer ?? 'Due Dec 4.', JSON.stringify([{ title: 'SAM.gov notice X' }]), S1, o.credits ?? 10]))[0];
const fail = async (t: string, tok: string | null, why = 'x') => (await rows<{ f: boolean }>('SELECT card_chat_fail_turn($1,$2,$3) AS f', [t, tok, why]))[0].f;
const balance = async (u = 'u@x.com') => (await rows<{ balance: number }>('SELECT balance FROM mcp_credit_balance WHERE user_email=$1', [u]))[0].balance;
const ledger = async (u = 'u@x.com') => rows<{ delta: number; reason: string; tool_name: string }>('SELECT delta, reason, tool_name FROM mcp_credit_ledger WHERE user_email=$1', [u]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE mcp_credit_balance (user_email text PRIMARY KEY, balance int NOT NULL CHECK (balance >= 0),
      chatgpt_spend_since_recharge int NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
    CREATE TABLE mcp_credit_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_email text, delta int, reason text,
      tool_name text, api_key_id uuid, balance_after int, channel text, created_at timestamptz DEFAULT now());
    INSERT INTO mcp_credit_balance(user_email, balance) VALUES ('u@x.com', 100), ('poor@x.com', 5);`);
  await db.exec(prodDebitFunction());
  const mig = readFileSync(join(MIG, '20261114_card_chat_turns.sql'), 'utf8');
  await db.exec(mig);
  await db.exec(mig); // the migration is idempotent
}, 60_000);

// The steps share one database and run in order, like a customer's session.
describe('card_chat_turns: one charge per question', () => {
  const T1 = id('1');
  let tok1 = '';

  it('a replay probe for an unknown turn claims nothing and creates no row', async () => {
    expect((await claim(T1, { replay: true })).outcome).toBe('not_completed');
    expect((await rows<{ n: number }>('SELECT count(*)::int n FROM card_chat_turns'))[0].n).toBe(0);
  });
  it('the first request claims the turn; a concurrent duplicate sees in_progress with no token', async () => {
    const c = await claim(T1);
    expect(c.outcome).toBe('claimed');
    tok1 = c.claim_token!;
    const dup = await claim(T1);
    expect(dup).toMatchObject({ outcome: 'in_progress', claim_token: null });
  });
  it('the same turn id with another question, user or opportunity is a mismatch (never replayed)', async () => {
    expect((await claim(T1, { q: 'Different question' })).outcome).toBe('mismatch');
    expect((await claim(T1, { user: 'other@x.com' })).outcome).toBe('mismatch');
    expect((await claim(T1, { notice: N2 })).outcome).toBe('mismatch');
  });
  it('a wrong claim token can neither complete nor charge', async () => {
    expect((await complete(T1, id('4'))).outcome).toBe('lost_claim');
    expect(await balance()).toBe(100);
  });
  it('completion saves the answer + sources and debits 10 once, through mcp_debit_credits', async () => {
    expect(await complete(T1, tok1)).toMatchObject({ outcome: 'charged', credits_charged: 10, new_balance: 90 });
    const [row] = await rows<{ status: string; answer: string; cited_sources: Array<{ title: string }>; completed_at: unknown }>('SELECT * FROM card_chat_turns WHERE turn_id=$1', [T1]);
    expect(row).toMatchObject({ status: 'completed', answer: 'Due Dec 4.' });
    expect(row.cited_sources[0].title).toBe('SAM.gov notice X');
    expect(await ledger()).toEqual([{ delta: -10, reason: 'card_chat_turn', tool_name: 'ask_mindy_card' }]);
  });
  it('completing again (a retried RPC) changes nothing and charges nothing', async () => {
    expect((await complete(T1, tok1)).outcome).toBe('already_completed');
    expect(await balance()).toBe(90);
  });
  it('a retry or a replay probe of the completed turn returns the saved answer and session, free', async () => {
    expect(await claim(T1)).toMatchObject({ outcome: 'completed', answer: 'Due Dec 4.', session_id: S1, claim_token: null });
    expect(await claim(T1, { replay: true })).toMatchObject({ outcome: 'completed', answer: 'Due Dec 4.' });
    expect(await balance()).toBe(90);
    expect(await ledger()).toHaveLength(1);
  });

  it('a failed turn is free, cannot be replayed, and can be asked again; the old attempt is locked out', async () => {
    const T2 = id('2');
    const first = await claim(T2, { q: 'Summarize the scope.' });
    expect(await fail(T2, first.claim_token, 'client_disconnected')).toBe(true);
    expect((await claim(T2, { q: 'Summarize the scope.', replay: true })).outcome).toBe('not_completed');
    const again = await claim(T2, { q: 'Summarize the scope.' });
    expect(again.outcome).toBe('claimed');
    expect(again.claim_token).not.toBe(first.claim_token);
    expect(await fail(T2, first.claim_token, 'late')).toBe(false);
    expect((await complete(T2, first.claim_token)).outcome).toBe('lost_claim');
    expect((await complete(T2, again.claim_token)).outcome).toBe('charged');
    expect(await balance()).toBe(80);
    expect((await rows<{ attempts: number }>('SELECT attempts FROM card_chat_turns WHERE turn_id=$1', [T2]))[0].attempts).toBe(2);
  });

  it('a request that died (expired lease) can be taken over; the dead request can no longer charge', async () => {
    const T3 = id('5');
    const dead = await claim(T3, { q: 'Who held it?', lease: 0 });
    expect((await claim(T3, { q: 'Who held it?', replay: true })).outcome).toBe('in_progress'); // a probe never claims
    expect((await claim(T3, { q: 'Who held it?' })).outcome).toBe('claimed');
    expect((await complete(T3, dead.claim_token)).outcome).toBe('lost_claim');
    expect(await balance()).toBe(80);
  });

  it('Pro (0 credits): saved for replay, never debited', async () => {
    const T4 = id('6');
    const c = await claim(T4, { q: 'Pro question' });
    expect(await complete(T4, c.claim_token, { credits: 0 })).toMatchObject({ outcome: 'not_billable', credits_charged: 0 });
    expect(await balance()).toBe(80);
  });

  it('the ledger refuses (balance fell below the price mid-turn): saved, 0 charged, never negative', async () => {
    const T5 = id('7');
    const c = await claim(T5, { user: 'poor@x.com', q: 'q' });
    expect(await complete(T5, c.claim_token, { user: 'poor@x.com', answer: 'A.' })).toMatchObject({ outcome: 'insufficient_balance', credits_charged: 0 });
    expect(await balance('poor@x.com')).toBe(5);
  });

  it('an empty answer cannot complete a turn, and the table forbids a completed turn without an answer', async () => {
    const T6 = id('8');
    const c = await claim(T6, { q: 'q6' });
    await expect(complete(T6, c.claim_token, { answer: '   ' })).rejects.toThrow();
    await expect(rows("UPDATE card_chat_turns SET status='completed', answer=NULL WHERE turn_id=$1", [T6])).rejects.toThrow();
    expect(await balance()).toBe(80);
  });

  it('if saving the answer fails, the debit rolls back with it (no charge without a recoverable answer)', async () => {
    const T7 = id('9');
    const c = await claim(T7, { q: 'q7' });
    await db.exec(`CREATE FUNCTION card_turn_test_boom() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status = 'completed' THEN RAISE EXCEPTION 'disk full'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER card_turn_test_boom BEFORE UPDATE ON card_chat_turns FOR EACH ROW EXECUTE FUNCTION card_turn_test_boom();`);
    try {
      await expect(complete(T7, c.claim_token, { answer: 'Real answer' })).rejects.toThrow(/disk full/);
    } finally {
      await db.exec('DROP TRIGGER card_turn_test_boom ON card_chat_turns;');
    }
    expect(await balance()).toBe(80);
    expect(await ledger()).toHaveLength(2); // T1 and T2 only
    expect((await rows<{ status: string }>('SELECT status FROM card_chat_turns WHERE turn_id=$1', [T7]))[0].status).toBe('in_progress');
  });
});
