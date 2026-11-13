# Runbook: 20261114_ask_mindy_execution_trace.sql

Status: verified in a disposable database, NOT applied anywhere. Applying to production requires explicit approval.

## What it does
Additive only. Adds nullable columns, no defaults, no backfill:
- `mcp_call_log`: `execution_id uuid`, `chat_session_id uuid`, `model text`, `provider text`, `args_redacted jsonb`, `credit_price integer`, `resource_ids jsonb`, `error_category text`
- two partial indexes: `idx_mcp_call_log_execution_id (execution_id) WHERE execution_id IS NOT NULL`, `idx_mcp_call_log_chat_session (chat_session_id, created_at) WHERE chat_session_id IS NOT NULL`
- `mindy_chat_messages`: `trace jsonb`

## Why there is no staging database
Preview, local `.env.local` and production all point to the same Supabase project (`krpyelfrbicmvsmwovti`, verified 2026-11-14). The migration was therefore verified in PGlite against the **exact production DDL** of the three tables (columns, defaults, constraints, indexes, RLS, policies), captured read-only from `information_schema`, `pg_indexes`, `pg_constraint`, `pg_policies`:
- `src/lib/chat/ask-mindy-migration.prod-schema.pglite.unit.test.ts` (exact live DDL, data fingerprints, rollback, re-apply)
- `src/lib/chat/ask-mindy-schema.pglite.unit.test.ts` (real migration chain, channel predicate, session cascade)

## Do not edit the migration file
The runner checksums file contents (`scripts/migrate.ts`). Any edit after it is applied shows as drift. The file is frozen as of the release commit.

## Pre-migration checks (read-only)
1. Ledger and pending set:
   ```
   npm run migrate:status
   ```
   Expect `20261114_ask_mindy_execution_trace.sql` pending. Four unrelated files are also pending (`20260924_saved_search_forecast_watermark.sql`, `20261108_contractor_job_postings.sql`, `20261108_contractor_jobs_cron.sql`, `20261113_trial_onboarding_cron.sql`). They must NOT be applied with this change.
2. None of the new columns exist yet:
   ```sql
   SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema='public' AND (
     (table_name='mcp_call_log' AND column_name IN ('execution_id','chat_session_id','model','provider','args_redacted','credit_price','resource_ids','error_category'))
     OR (table_name='mindy_chat_messages' AND column_name='trace'));
   ```
   Expect 0 rows. (`ADD COLUMN IF NOT EXISTS` would silently skip a same-named column of a different type, so a non-empty result is a stop.)
3. No dependent views or triggers (expect 0 / none), table sizes (expect small: about 19K / 1K rows):
   ```sql
   SELECT count(*) FROM information_schema.view_table_usage WHERE table_name IN ('mcp_call_log','mindy_chat_messages');
   SELECT event_object_table, trigger_name FROM information_schema.triggers WHERE event_object_table IN ('mcp_call_log','mindy_chat_messages');
   SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE relname IN ('mcp_call_log','mindy_chat_messages');
   ```
4. Baseline counts for the post-check:
   ```sql
   SELECT count(*), count(*) FILTER (WHERE channel IS NULL), count(*) FILTER (WHERE channel='chatgpt'), count(*) FILTER (WHERE channel='app_chat') FROM mcp_call_log;
   SELECT count(*) FROM mindy_chat_messages;
   ```

## Exact command
Dry run first, then apply ONLY this file:
```
npm run migrate -- --only 20261114_ask_mindy_execution_trace.sql
npm run migrate -- --go --only 20261114_ask_mindy_execution_trace.sql
```

## Post-migration verification
1. Columns exist:
   ```
   npm run db:check -- mcp_call_log execution_id
   npm run db:check -- mcp_call_log args_redacted
   npm run db:check -- mindy_chat_messages trace
   ```
2. Ledger shows it applied, others still pending: `npm run migrate:status`.
3. Existing records unchanged: repeat the baseline counts (identical) and
   ```sql
   SELECT count(*) FROM mcp_call_log WHERE execution_id IS NOT NULL OR args_redacted IS NOT NULL OR credit_price IS NOT NULL;
   ```
   Expect 0 until the new code writes Ask Mindy rows.
4. Indexes present:
   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename='mcp_call_log' AND indexname IN ('idx_mcp_call_log_execution_id','idx_mcp_call_log_chat_session');
   ```
5. After the code deploys: the first Ask Mindy tool call writes one `mcp_call_log` row with `channel='app_chat'`, `credits_charged=0`, a non-null `execution_id`, `credit_price`, `model`, `provider`, and `args_redacted` containing only validated filter values.

## Rollback
`supabase/rollbacks/20261114_ask_mindy_execution_trace.down.sql` (outside `supabase/migrations`, so the runner never applies it). Run it manually, then remove the ledger row:
```sql
-- contents of supabase/rollbacks/20261114_ask_mindy_execution_trace.down.sql
DELETE FROM schema_migrations WHERE version = '20261114_ask_mindy_execution_trace.sql';
```
Effects: drops the two indexes and nine columns; data in them (redacted args, traces) is lost; all other data is untouched. The code keeps working without the columns (logCall and persistExchange fall back to the pre-migration row shape, preserving `channel`). The rollback and re-apply are both covered by the PGlite test.

## Expected effects on existing records
- No existing row is modified; new columns are NULL on every existing row (verified by data fingerprint in PGlite).
- MCP writes (`runMeteredTool`) are unchanged and leave the new columns NULL.
- `ALTER TABLE ... ADD COLUMN` (nullable, no default) is a metadata-only change; the two partial indexes build over ~19K rows. Expect a brief lock, well under a second.

## Ordering with the code deploy
Either order is safe. Applying the migration first means the first Ask Mindy calls after deploy carry full traces; deploying first means those calls log without trace columns until the migration runs (channel is still recorded).
