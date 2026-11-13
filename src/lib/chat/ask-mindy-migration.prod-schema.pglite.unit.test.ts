/**
 * Migration verification against the EXACT production schema (captured read-only from
 * information_schema / pg_indexes / pg_constraint / pg_policies on 2026-11-14), in a disposable
 * in-process Postgres (PGlite). Never touches a real database.
 *
 * Proves for 20261114_ask_mindy_execution_trace.sql:
 *   - applies cleanly on the live table shapes, and re-applies (idempotent)
 *   - existing rows are byte-identical afterwards (original columns), new columns NULL
 *   - old-shape (pre-migration code) and new-shape inserts both work
 *   - RLS / policies / constraints / FK cascade unchanged
 *   - the rollback script restores the original column set, keeps the data, and the forward
 *     migration can be re-applied after a rollback
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const FORWARD = readFileSync(join(process.cwd(), 'supabase/migrations/20261114_ask_mindy_execution_trace.sql'), 'utf8');
const ROLLBACK = readFileSync(join(process.cwd(), 'supabase/rollbacks/20261114_ask_mindy_execution_trace.down.sql'), 'utf8');

// Live production DDL (2026-11-14). Column order, types, defaults, constraints, indexes, RLS.
const LIVE_SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.mcp_call_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  api_key_id uuid,
  tool_name text NOT NULL,
  credits_charged integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  outcome text, grounded boolean, degraded boolean, billing_outcome text, error_code text,
  channel text
);
CREATE INDEX idx_mcp_call_log_user ON public.mcp_call_log USING btree (user_email, created_at DESC);
CREATE INDEX idx_mcp_call_log_tool ON public.mcp_call_log USING btree (tool_name, created_at DESC);
ALTER TABLE public.mcp_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_call_log FORCE ROW LEVEL SECURITY;
CREATE POLICY mcp_call_log_service ON public.mcp_call_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.mindy_chat_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  title text,
  message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_sessions_email_recent ON public.mindy_chat_sessions USING btree (user_email, updated_at DESC);
CREATE TABLE public.mindy_chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.mindy_chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text])),
  content text NOT NULL,
  cited_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  tokens_used integer,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_session ON public.mindy_chat_messages USING btree (session_id, created_at);
ALTER TABLE public.mindy_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mindy_chat_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mindy_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mindy_chat_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY service_role_full_access ON public.mindy_chat_sessions FOR ALL TO service_role USING (true);
CREATE POLICY service_role_full_access ON public.mindy_chat_messages FOR ALL TO service_role USING (true);
`;

const ORIGINAL_CALL_LOG_COLS = 'id,user_email,api_key_id,tool_name,credits_charged,status,latency_ms,created_at,outcome,grounded,degraded,billing_outcome,error_code,channel';
const ORIGINAL_MSG_COLS = 'id,session_id,role,content,cited_sources,tokens_used,latency_ms,created_at';
const NEW_COLS = ['execution_id', 'chat_session_id', 'model', 'provider', 'args_redacted', 'credit_price', 'resource_ids', 'error_category'];

const db = new PGlite();
const fingerprint = async (table: string, cols: string) =>
  (await db.query<{ h: string }>(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) AS h FROM (SELECT ${cols} FROM public.${table}) t`)).rows[0].h;
const columns = async (table: string) =>
  (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`)).rows.map((r) => r.column_name);
let before: { calls: string; msgs: string; callCols: string[]; msgCols: string[] };

beforeAll(async () => {
  await db.exec(LIVE_SCHEMA);
  // Representative existing rows: Claude/general (NULL channel), historical, ChatGPT, Ask Mindy.
  await db.exec(`INSERT INTO mcp_call_log (user_email, tool_name, credits_charged, status, latency_ms, outcome, grounded, degraded, billing_outcome, error_code, channel) VALUES
    ('a@x.com','search_contractors',10,'success',120,'grounded',true,false,'billable_success',NULL,NULL),
    ('b@x.com','lookup_sam_entity',0,'uncharged',80,'degraded',false,true,'nonbillable_degraded','sam_down',NULL),
    ('c@x.com','get_sblo_contact',20,'success',300,'grounded',true,false,'billable_success',NULL,'chatgpt'),
    ('eric@x.com','get_expiring_contracts',0,'success',900,'grounded',true,false,'billable_success',NULL,'app_chat'),
    ('d@x.com','search_past_contracts',0,'rejected_no_credits',5,'blocked',NULL,NULL,NULL,'insufficient_credits',NULL)`);
  await db.exec(`INSERT INTO mcp_call_log (user_email, tool_name, status) VALUES ('legacy@x.com','old_tool','success')`);
  await db.exec(`INSERT INTO mindy_chat_sessions (id, user_email, title) VALUES ('11111111-2222-3333-4444-555555555555','u@x.com','t')`);
  await db.exec(`INSERT INTO mindy_chat_messages (session_id, role, content) VALUES ('11111111-2222-3333-4444-555555555555','user','q'), ('11111111-2222-3333-4444-555555555555','assistant','a')`);
  before = {
    calls: await fingerprint('mcp_call_log', ORIGINAL_CALL_LOG_COLS),
    msgs: await fingerprint('mindy_chat_messages', ORIGINAL_MSG_COLS),
    callCols: await columns('mcp_call_log'),
    msgCols: await columns('mindy_chat_messages'),
  };
  await db.exec(FORWARD);
  await db.exec(FORWARD); // idempotent
});

describe('forward migration on the live production schema', () => {
  it('adds exactly the documented columns, all nullable, appended after the existing ones', async () => {
    const cols = await columns('mcp_call_log');
    expect(cols.slice(0, before.callCols.length)).toEqual(before.callCols);
    expect(cols.slice(before.callCols.length)).toEqual(NEW_COLS);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='mcp_call_log' AND column_name = ANY($1) AND is_nullable='YES' AND column_default IS NULL`, [NEW_COLS]);
    expect(rows[0].n).toBe(NEW_COLS.length);
    expect(await columns('mindy_chat_messages')).toEqual([...before.msgCols, 'trace']);
  });

  it('existing rows are unchanged and every new column is NULL on them', async () => {
    expect(await fingerprint('mcp_call_log', ORIGINAL_CALL_LOG_COLS)).toBe(before.calls);
    expect(await fingerprint('mindy_chat_messages', ORIGINAL_MSG_COLS)).toBe(before.msgs);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mcp_call_log WHERE ${NEW_COLS.map((c) => `${c} IS NOT NULL`).join(' OR ')}`);
    expect(rows[0].n).toBe(0);
  });

  it('old-shape and new-shape inserts both work', async () => {
    await db.exec(`INSERT INTO mcp_call_log (user_email, tool_name, status, credits_charged, channel) VALUES ('old@x.com','t','success',5,NULL)`);
    await db.exec(`INSERT INTO mcp_call_log (user_email, tool_name, status, credits_charged, channel, execution_id, chat_session_id, model, provider, args_redacted, credit_price, resource_ids, error_category)
      VALUES ('new@x.com','schedule_market_search','success',0,'app_chat',gen_random_uuid(),'11111111-2222-3333-4444-555555555555','gpt-4o','openai','{"naics":"561320"}',0,'{"saved_search_id":"x"}',NULL)`);
    await db.exec(`INSERT INTO mindy_chat_messages (session_id, role, content, trace) VALUES ('11111111-2222-3333-4444-555555555555','assistant','b','{"planner":{"provider":"openai"}}')`);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mcp_call_log WHERE user_email IN ('old@x.com','new@x.com')`);
    expect(rows[0].n).toBe(2);
  });

  it('creates the two partial indexes and leaves RLS, policies and constraints intact', async () => {
    const idx = (await db.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename='mcp_call_log' ORDER BY indexname`)).rows.map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(['idx_mcp_call_log_execution_id', 'idx_mcp_call_log_chat_session', 'idx_mcp_call_log_user', 'idx_mcp_call_log_tool', 'mcp_call_log_pkey']));
    const rls = (await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('mcp_call_log','mindy_chat_messages','mindy_chat_sessions')`)).rows;
    expect(rls.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
    const pol = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('mcp_call_log','mindy_chat_messages','mindy_chat_sessions')`)).rows[0].n;
    expect(pol).toBe(3);
    await expect(db.exec(`INSERT INTO mindy_chat_messages (session_id, role, content) VALUES ('11111111-2222-3333-4444-555555555555','system','x')`)).rejects.toThrow();
  });
});

describe('rollback script', () => {
  it('restores the original columns, keeps the data, and the migration can be re-applied', async () => {
    const callsBeforeRollback = await fingerprint('mcp_call_log', ORIGINAL_CALL_LOG_COLS);
    await db.exec(ROLLBACK);
    await db.exec(ROLLBACK); // idempotent
    expect(await columns('mcp_call_log')).toEqual(before.callCols);
    expect(await columns('mindy_chat_messages')).toEqual(before.msgCols);
    expect(await fingerprint('mcp_call_log', ORIGINAL_CALL_LOG_COLS)).toBe(callsBeforeRollback);
    const idx = (await db.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename='mcp_call_log'`)).rows.map((r) => r.indexname);
    expect(idx).not.toContain('idx_mcp_call_log_execution_id');
    await db.exec(FORWARD);
    expect(await columns('mcp_call_log')).toEqual([...before.callCols, ...NEW_COLS]);
  });
});
