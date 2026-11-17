/**
 * The real mcp_grant_signup_credits function: one introductory grant per account across registration and MCP.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

import { PGLITE_HOOK_TIMEOUT_MS } from '@/test/pglite-timeouts';

// PGlite boot + migrations can exceed the 10s default hook limit under full-suite load (see the constant).
vi.setConfig({ hookTimeout: PGLITE_HOOK_TIMEOUT_MS });

const mig = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8');
const db = new PGlite();
const grant = async (email: string, amount = 100) =>
  (await db.query<{ granted: number; balance: number }>(`SELECT * FROM mcp_grant_signup_credits($1, $2)`, [email, amount])).rows[0];
const balance = async (email: string) =>
  (await db.query<{ balance: number }>(`SELECT balance FROM mcp_credit_balance WHERE user_email = $1`, [email])).rows[0]?.balance ?? null;
const signupRows = async (email: string) =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mcp_credit_ledger WHERE user_email = $1 AND reason = 'signup_grant'`, [email])).rows[0].n;

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;`);
  for (const f of ['20260712_mcp_credit_ledger.sql', '20260819_mcp_signup_grant_idempotent.sql']) await db.exec(mig(f));
}, 60_000);

describe('one introductory grant per account, whichever door runs first', () => {
  it('registration first, then the MCP connect: one grant, balance 100', async () => {
    const e = 'maps-first@example.com';
    expect((await grant(e)).granted).toBe(100);   // registration (Maps/App)
    expect((await grant(e)).granted).toBe(0);     // later MCP OAuth
    expect(await signupRows(e)).toBe(1);
    expect(await balance(e)).toBe(100);
  });

  it('MCP first, then registration seam: one grant', async () => {
    const e = 'mcp-first@example.com';
    expect((await grant(e)).granted).toBe(100);
    expect((await grant(e)).granted).toBe(0);
    expect(await balance(e)).toBe(100);
  });

  it('email case and spacing do not create a second grant', async () => {
    const e = 'Case@Example.com';
    await grant(e);
    expect((await grant(' case@example.com ')).granted).toBe(0);
    expect(await signupRows('case@example.com')).toBe(1);
  });

  it('concurrent claims: exactly one wins', async () => {
    const e = 'race@example.com';
    const rs = await Promise.all([grant(e), grant(e), grant(e), grant(e)]);
    expect(rs.filter((r) => r.granted === 100)).toHaveLength(1);
    expect(await balance(e)).toBe(100);
    expect(await signupRows(e)).toBe(1);
  });

  it('an existing purchased balance is preserved and topped up once', async () => {
    const e = 'buyer@example.com';
    await db.query(`INSERT INTO mcp_credit_balance(user_email, balance) VALUES ($1, 2000)`, [e]);
    expect((await grant(e)).granted).toBe(100);
    expect((await grant(e)).granted).toBe(0);
    expect(await balance(e)).toBe(2100);
  });

  it('an account that already received the grant keeps its balance untouched', async () => {
    const e = 'spent@example.com';
    await grant(e);
    await db.query(`UPDATE mcp_credit_balance SET balance = 7 WHERE user_email = $1`, [e]);
    expect((await grant(e)).granted).toBe(0);
    expect(await balance(e)).toBe(7);
  });
});
