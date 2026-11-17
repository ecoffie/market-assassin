/**
 * 20261117_vault_doc_class.sql + its rollback, against the EXACT production shape of
 * user_boilerplate_docs (captured read-only from information_schema / pg_indexes / pg_constraint /
 * pg_policies on 2026-11-17: 17 columns, pkey + 2 indexes, RLS forced, 2 service-role policies,
 * 85 rows, migration not in the ledger). Runs in a disposable in-process Postgres (PGlite) and never
 * touches a real database.
 *
 * Proves:
 *   - forward applies on the live shape and re-applies (idempotent); the 85 existing rows are
 *     byte-identical on their original columns and NULL in every new column (no backfill)
 *   - pre-migration inserts and new-shape inserts both work; the new constraints hold
 *   - RLS and policies are unchanged
 *   - the rollback REFUSES while reference/generated rows exist (they would silently become company
 *     material) and then changes NOTHING — columns, data and ledger row all intact
 *   - after those rows are dealt with, the rollback restores the original 17 columns in order,
 *     the original indexes and constraints, keeps every original row byte-identical, deletes the
 *     ledger row, is safe to run twice, and the forward migration re-applies afterwards
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const FORWARD = readFileSync(join(process.cwd(), 'supabase/migrations/20261117_vault_doc_class.sql'), 'utf8');
const ROLLBACK = readFileSync(join(process.cwd(), 'supabase/rollbacks/20261117_vault_doc_class.down.sql'), 'utf8');
const LEDGER_VERSION = '20261117_vault_doc_class.sql';

// Live production DDL (2026-11-17): column order, types, defaults, nullability, indexes, RLS, policies.
const LIVE_SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.mindy_chat_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.user_boilerplate_docs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  doc_type text NOT NULL,
  original_filename text NOT NULL,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  extracted_text text,
  page_count integer,
  parsed_sections jsonb,
  parse_status text DEFAULT 'pending'::text,
  parse_error text,
  extracted_to_vault_at timestamptz,
  extracted_row_counts jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT user_boilerplate_docs_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_boilerplate_user ON public.user_boilerplate_docs USING btree (user_email, archived_at);
CREATE INDEX idx_boilerplate_type ON public.user_boilerplate_docs USING btree (user_email, doc_type, archived_at);
ALTER TABLE public.user_boilerplate_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_boilerplate_docs FORCE ROW LEVEL SECURITY;
CREATE POLICY service_role_full_access ON public.user_boilerplate_docs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY vault_service_role_only ON public.user_boilerplate_docs FOR ALL TO service_role USING (true) WITH CHECK (true);
`;

const ORIGINAL_COLS = [
  'id', 'user_email', 'doc_type', 'original_filename', 'mime_type', 'size_bytes', 'storage_path',
  'extracted_text', 'page_count', 'parsed_sections', 'parse_status', 'parse_error',
  'extracted_to_vault_at', 'extracted_row_counts', 'created_at', 'updated_at', 'archived_at',
];
const NEW_COLS = ['doc_class', 'source', 'chat_session_id', 'notice_id', 'parent_id', 'version', 'doc_model', 'source_doc_ids'];
const ORIGINAL_INDEXES = ['idx_boilerplate_type', 'idx_boilerplate_user', 'user_boilerplate_docs_pkey'];
const NEW_INDEXES = ['idx_boilerplate_class', 'idx_boilerplate_session', 'uq_boilerplate_parent_version'];
const NEW_CONSTRAINTS = [
  'user_boilerplate_docs_chat_session_fk', 'user_boilerplate_docs_doc_class_check', 'user_boilerplate_docs_parent_fk',
  'user_boilerplate_docs_source_check', 'user_boilerplate_docs_version_check',
];

const db = new PGlite();
const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const columns = async () =>
  (await rows<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'user_boilerplate_docs' ORDER BY ordinal_position`)).map((r) => r.column_name);
const indexes = async () =>
  (await rows<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename = 'user_boilerplate_docs' ORDER BY indexname`)).map((r) => r.indexname);
const constraints = async () =>
  // contype 'n' = NOT NULL, which Postgres 17 (PGlite) records in pg_constraint and production's version does not.
  (await rows<{ conname: string }>(`SELECT conname FROM pg_constraint WHERE conrelid = 'public.user_boilerplate_docs'::regclass AND contype <> 'n' ORDER BY conname`)).map((r) => r.conname);
const policies = async () =>
  JSON.stringify(await rows(`SELECT policyname, roles::text, cmd, qual, with_check FROM pg_policies WHERE tablename = 'user_boilerplate_docs' ORDER BY policyname`));
const rls = async () => JSON.stringify(await rows(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.user_boilerplate_docs'::regclass`));
/** md5 over the 85 seeded rows, original columns only. */
const seedFingerprint = async () =>
  (await rows<{ h: string }>(`SELECT md5(string_agg(row_to_json(t)::text, '|' ORDER BY id)) AS h FROM (SELECT ${ORIGINAL_COLS.join(',')} FROM public.user_boilerplate_docs WHERE user_email LIKE 'seed%') t`))[0].h;
const count = async (where = 'true') => (await rows<{ n: number }>(`SELECT count(*)::int AS n FROM public.user_boilerplate_docs WHERE ${where}`))[0].n;
const ledger = async () => (await rows<{ version: string }>(`SELECT version FROM public.schema_migrations`)).map((r) => r.version);
/** Like the SQL editor: the whole file as one request. A failure leaves the transaction aborted. */
const runFile = async (sql: string) => {
  try { await db.exec(sql); } catch (e) { await db.exec('ROLLBACK').catch(() => {}); throw e; }
};

/**
 * Like `psql -f` with default settings: one statement at a time, and an error does NOT stop the run.
 * This is why the rollback is one transaction — without it, the statements after a refusal would run.
 */
const splitStatements = (sql: string) => {
  const out: string[] = [];
  let cur = '';
  let inDollar = false;
  for (const line of sql.split('\n')) {
    if (/^\s*--/.test(line) && !inDollar) continue;
    cur += line + '\n';
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && /;\s*$/.test(line)) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const runPsqlStyle = async (sql: string) => {
  const errors: string[] = [];
  for (const stmt of splitStatements(sql)) {
    try { await db.exec(stmt); } catch (e) { errors.push((e as Error).message); }
  }
  await db.exec('ROLLBACK').catch(() => {}); // leave no open transaction behind for the next test
  return errors;
};

let before: { fp: string; policies: string; rls: string };

beforeAll(async () => {
  await db.exec(LIVE_SCHEMA);
  // 85 rows shaped like production: mixed doc types, parse states, archived, nulls, jsonb.
  await db.exec(`
    INSERT INTO public.user_boilerplate_docs
      (user_email, doc_type, original_filename, mime_type, size_bytes, storage_path, extracted_text, page_count,
       parsed_sections, parse_status, parse_error, extracted_to_vault_at, extracted_row_counts, created_at, updated_at, archived_at)
    SELECT
      'seed' || (g % 23) || '@example.com',
      (ARRAY['cap_stmt','company_overview','cover_letter','past_perf_table','pricing_template','other'])[1 + g % 6],
      'file-' || g || '.pdf',
      CASE WHEN g % 7 = 0 THEN NULL ELSE 'application/pdf' END,
      CASE WHEN g % 5 = 0 THEN NULL ELSE 1000 * g END,
      'vault-assets/seed/' || g,
      CASE WHEN g % 4 = 0 THEN NULL ELSE repeat('text ', g) END,
      CASE WHEN g % 3 = 0 THEN NULL ELSE g % 12 + 1 END,
      CASE WHEN g % 2 = 0 THEN jsonb_build_object('company_overview', 'Overview ' || g, 'capabilities', jsonb_build_array('a', 'b')) END,
      (ARRAY['pending','parsed','failed','edited'])[1 + g % 4],
      CASE WHEN g % 4 = 2 THEN 'parse failed ' || g END,
      CASE WHEN g % 6 = 0 THEN timestamptz '2026-06-01' + g * interval '1 day' END,
      CASE WHEN g % 6 = 0 THEN jsonb_build_object('past_performance', g % 4) END,
      timestamptz '2026-05-26' + g * interval '1 hour',
      timestamptz '2026-05-27' + g * interval '1 hour',
      CASE WHEN g % 9 = 0 THEN timestamptz '2026-10-01' END
    FROM generate_series(1, 85) g;
  `);
  before = { fp: await seedFingerprint(), policies: await policies(), rls: await rls() };
});

describe('20261117_vault_doc_class on the production shape', () => {
  it('starts as production: 17 columns, 3 indexes, pkey only, 85 rows', async () => {
    expect(await columns()).toEqual(ORIGINAL_COLS);
    expect(await indexes()).toEqual(ORIGINAL_INDEXES);
    expect(await constraints()).toEqual(['user_boilerplate_docs_pkey']);
    expect(await count()).toBe(85);
  });

  it('forward applies, then re-applies (idempotent)', async () => {
    await runFile(FORWARD);
    await runFile(FORWARD);
    await db.exec(`INSERT INTO public.schema_migrations (version) VALUES ('${LEDGER_VERSION}')`); // what the runner records
    expect(await columns()).toEqual([...ORIGINAL_COLS, ...NEW_COLS]);
    expect(await indexes()).toEqual([...ORIGINAL_INDEXES, ...NEW_INDEXES].sort());
    expect(await constraints()).toEqual([...NEW_CONSTRAINTS, 'user_boilerplate_docs_pkey'].sort());
  });

  it('existing rows are byte-identical on their original columns, NULL in every new column (no backfill)', async () => {
    expect(await seedFingerprint()).toBe(before.fp);
    expect(await count(NEW_COLS.map((c) => `${c} IS NOT NULL`).join(' OR '))).toBe(0);
  });

  it('RLS and policies are unchanged', async () => {
    expect(await policies()).toBe(before.policies);
    expect(await rls()).toBe(before.rls);
  });

  it('a pre-migration insert (old code shape) still works', async () => {
    await db.exec(`INSERT INTO public.user_boilerplate_docs (user_email, doc_type, original_filename) VALUES ('old@example.com', 'cap_stmt', 'old.pdf')`);
    expect(await count(`user_email = 'old@example.com' AND doc_class IS NULL`)).toBe(1);
  });

  it('new-shape inserts work: reference with a chat session, generated v1 → v2 chain', async () => {
    await db.exec(`
      INSERT INTO public.mindy_chat_sessions (id, user_email) VALUES ('00000000-0000-0000-0000-00000000000a', 'new@example.com');
      INSERT INTO public.user_boilerplate_docs (id, user_email, doc_type, original_filename, doc_class, source, chat_session_id, notice_id)
        VALUES ('00000000-0000-0000-0000-000000000001', 'new@example.com', 'other', 'rfp.pdf', 'reference', 'ask_mindy', '00000000-0000-0000-0000-00000000000a', 'abc123');
      INSERT INTO public.user_boilerplate_docs (id, user_email, doc_type, original_filename, doc_class, source, version, doc_model, source_doc_ids)
        VALUES ('00000000-0000-0000-0000-000000000002', 'new@example.com', 'other', 'report-v1.pdf', 'generated', 'ask_mindy', 1, '{"schema":"mindy.doc/1"}', ARRAY['00000000-0000-0000-0000-000000000001'::uuid]);
      INSERT INTO public.user_boilerplate_docs (id, user_email, doc_type, original_filename, doc_class, source, parent_id, version)
        VALUES ('00000000-0000-0000-0000-000000000003', 'new@example.com', 'other', 'report-v2.pdf', 'generated', 'ask_mindy', '00000000-0000-0000-0000-000000000002', 2);
      INSERT INTO public.user_boilerplate_docs (user_email, doc_type, original_filename, doc_class, source)
        VALUES ('co@example.com', 'cap_stmt', 'cap.pdf', 'company', 'vault');
    `);
    expect(await count(`doc_class IS NOT NULL`)).toBe(4);
  });

  it('the new constraints hold: class, source, version >= 1, one version per parent', async () => {
    const bad = async (sql: string) => expect(db.exec(sql)).rejects.toThrow();
    await bad(`INSERT INTO public.user_boilerplate_docs (user_email, doc_type, original_filename, doc_class) VALUES ('x@e.com', 'other', 'x', 'secret')`);
    await bad(`INSERT INTO public.user_boilerplate_docs (user_email, doc_type, original_filename, source) VALUES ('x@e.com', 'other', 'x', 'email')`);
    await bad(`INSERT INTO public.user_boilerplate_docs (user_email, doc_type, original_filename, version) VALUES ('x@e.com', 'other', 'x', 0)`);
    await bad(`INSERT INTO public.user_boilerplate_docs (user_email, doc_type, original_filename, parent_id, version) VALUES ('x@e.com', 'other', 'dup', '00000000-0000-0000-0000-000000000002', 2)`);
    await bad(`INSERT INTO public.user_boilerplate_docs (user_email, doc_type, original_filename, chat_session_id) VALUES ('x@e.com', 'other', 'x', '00000000-0000-0000-0000-0000000000ff')`);
  });

  it('deleting the chat session keeps the document (ON DELETE SET NULL)', async () => {
    await db.exec(`DELETE FROM public.mindy_chat_sessions WHERE id = '00000000-0000-0000-0000-00000000000a'`);
    expect(await count(`id = '00000000-0000-0000-0000-000000000001' AND chat_session_id IS NULL`)).toBe(1);
  });
});

describe('20261117_vault_doc_class.down.sql', () => {
  it('REFUSES while reference/generated rows exist — and then changes nothing', async () => {
    await expect(runFile(ROLLBACK)).rejects.toThrow(/rollback refused: 3 user_boilerplate_docs row\(s\) have doc_class reference\/generated/);
    expect(await columns()).toEqual([...ORIGINAL_COLS, ...NEW_COLS]);
    expect(await indexes()).toEqual([...ORIGINAL_INDEXES, ...NEW_INDEXES].sort());
    expect(await count(`doc_class IN ('reference', 'generated')`)).toBe(3);
    expect(await ledger()).toEqual([LEDGER_VERSION]);
    expect(await seedFingerprint()).toBe(before.fp);
  });

  it('psql-style run (continues past errors): the refusal still drops NOTHING, because it is one transaction', async () => {
    const errors = await runPsqlStyle(ROLLBACK);
    expect(errors[0]).toMatch(/rollback refused/);
    expect(await columns()).toEqual([...ORIGINAL_COLS, ...NEW_COLS]);
    expect(await indexes()).toEqual([...ORIGINAL_INDEXES, ...NEW_INDEXES].sort());
    expect(await count(`doc_class IN ('reference', 'generated')`)).toBe(3);
    expect(await ledger()).toEqual([LEDGER_VERSION]);
  });

  it('once those rows are dealt with, restores the original shape and keeps every original row', async () => {
    await db.exec(`DELETE FROM public.user_boilerplate_docs WHERE doc_class IN ('reference', 'generated')`);
    await runFile(ROLLBACK); // a remaining doc_class 'company' row does not block it
    expect(await columns()).toEqual(ORIGINAL_COLS);
    expect(await indexes()).toEqual(ORIGINAL_INDEXES);
    expect(await constraints()).toEqual(['user_boilerplate_docs_pkey']);
    expect(await seedFingerprint()).toBe(before.fp);
    expect(await count(`user_email LIKE 'seed%'`)).toBe(85);
    expect(await count(`user_email IN ('old@example.com', 'co@example.com')`)).toBe(2);
    expect(await policies()).toBe(before.policies);
    expect(await rls()).toBe(before.rls);
  });

  it('deletes the ledger row, so the runner sees the migration as pending again', async () => {
    expect(await ledger()).toEqual([]);
  });

  it('is safe to run twice', async () => {
    await runFile(ROLLBACK);
    expect(await columns()).toEqual(ORIGINAL_COLS);
    expect(await seedFingerprint()).toBe(before.fp);
  });

  it('the forward migration re-applies after a rollback', async () => {
    await runFile(FORWARD);
    expect(await columns()).toEqual([...ORIGINAL_COLS, ...NEW_COLS]);
    expect(await indexes()).toEqual([...ORIGINAL_INDEXES, ...NEW_INDEXES].sort());
    expect(await seedFingerprint()).toBe(before.fp);
  });
});
