/**
 * Ask Mindy safety release — DATABASE half, executed against the REAL migration chain in an
 * in-process Postgres (PGlite). Never touches a real database.
 *
 * Proves:
 *   1. 20261114_ask_mindy_execution_trace.sql applies on top of the existing call-log and chat
 *      schema, is idempotent, and leaves old-shape inserts working (backward compatible).
 *   2. The MCP-only channel predicate keeps historical NULL-channel rows and ChatGPT rows and
 *      drops only Ask Mindy rows (the NULL trap: a bare <> would drop history).
 *   3. Deleting a chat session (what account deletion does via USER_EMAIL_TABLES) removes its
 *      messages, including the new trace column, through the existing ON DELETE CASCADE.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { MCP_CHANNEL_SQL } from '@/lib/mcp/channel-filter';

const mig = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8');
const db = new PGlite();

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;`);
  for (const f of [
    '20260527_mindy_chat.sql',
    '20260712_mcp_credit_ledger.sql',
    '20261002_mcp_call_log_outcome.sql',
    '20261003_mcp_call_log_channel.sql',
  ]) {
    await db.exec(mig(f));
  }
  // A historical MCP row written BEFORE the new migration (old shape).
  await db.exec(`INSERT INTO mcp_call_log (user_email, tool_name, status, credits_charged) VALUES ('legacy@x.com', 'search_contractors', 'success', 10)`);
  await db.exec(mig('20261114_ask_mindy_execution_trace.sql'));
  await db.exec(mig('20261114_ask_mindy_execution_trace.sql')); // idempotent re-apply
});

describe('20261114_ask_mindy_execution_trace', () => {
  it('adds the trace columns, all nullable', async () => {
    const { rows } = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'mcp_call_log'
         AND column_name IN ('execution_id','chat_session_id','model','provider','args_redacted','credit_price','resource_ids','error_category')`,
    );
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.is_nullable === 'YES')).toBe(true);
    const t = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'mindy_chat_messages' AND column_name = 'trace'`);
    expect(t.rows).toHaveLength(1);
  });

  it('old-shape MCP inserts still work after the migration (backward compatible)', async () => {
    await db.exec(`INSERT INTO mcp_call_log (user_email, tool_name, status, credits_charged) VALUES ('claude@x.com', 'lookup_sam_entity', 'success', 5)`);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mcp_call_log WHERE execution_id IS NULL`);
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });
});

describe('MCP-only channel predicate on the real table', () => {
  it('keeps NULL-channel (historical + Claude) and chatgpt rows; drops app_chat only', async () => {
    await db.exec(`DELETE FROM mcp_call_log`);
    await db.exec(`INSERT INTO mcp_call_log (user_email, tool_name, status, credits_charged, channel) VALUES
      ('a@x.com','t','success',10,NULL), ('b@x.com','t','success',10,NULL),
      ('c@x.com','t','success',10,'chatgpt'),
      ('d@x.com','t','success',0,'app_chat'), ('d@x.com','t','blocked_policy',0,'app_chat')`);
    const mcp = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mcp_call_log WHERE ${MCP_CHANNEL_SQL}`);
    const naive = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mcp_call_log WHERE channel <> 'app_chat'`);
    expect(mcp.rows[0].n).toBe(3);
    expect(naive.rows[0].n).toBe(1); // the NULL trap the shared predicate avoids
  });
});

describe('account deletion reaches Ask Mindy traces', () => {
  it('deleting a session cascades to its messages (and their trace)', async () => {
    const sid = '11111111-2222-3333-4444-555555555555';
    await db.exec(`INSERT INTO mindy_chat_sessions (id, user_email, title) VALUES ('${sid}', 'gone@x.com', 't')`);
    await db.exec(`INSERT INTO mindy_chat_messages (session_id, role, content, trace) VALUES
      ('${sid}', 'user', 'q', NULL), ('${sid}', 'assistant', 'a', '{"planner":{"provider":"openai"}}')`);
    await db.exec(`DELETE FROM mindy_chat_sessions WHERE user_email = 'gone@x.com'`);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mindy_chat_messages WHERE session_id = '${sid}'`);
    expect(rows[0].n).toBe(0);
  });
});
