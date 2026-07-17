/**
 * Migration runner — applies supabase/migrations/*.sql against the live database
 * and keeps a ledger of what actually ran.
 *
 *   npm run migrate:status              # what's applied / pending / drifted (read-only)
 *   npm run migrate:baseline -- --go    # ONE TIME: adopt existing history, runs nothing
 *   npm run migrate                     # dry-run: show what WOULD apply
 *   npm run migrate -- --go             # apply pending migrations
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Until now the protocol was: Claude writes a migration, copies it to the
 * clipboard, Eric pastes it into the Supabase SQL editor, and reports back
 * "Success. No rows returned". That string is the ONLY record that anything
 * ran, and it proves very little.
 *
 * It has already failed at least once, silently. supabase/migrations/
 * 20260403_cron_logs.sql creates cron_logs. No later migration drops or renames
 * it. The table is not in the database. A file was authored, committed, and
 * never applied -- and nothing anywhere noticed for three months, because there
 * was no ledger to notice with.
 *
 * ---------------------------------------------------------------------------
 * THE DANGEROUS PART, AND HOW BASELINE HANDLES IT
 *
 * There are 138 migrations on disk and no record of which ones ran. Replaying
 * them against a live database is not an option -- these are not all idempotent,
 * and several are destructive.
 *
 * So the first run MUST be `migrate:baseline`, which creates the ledger and
 * marks every CURRENT file as applied WITHOUT EXECUTING ANY OF THEM. It adopts
 * history rather than replaying it. From that point on, only genuinely new files
 * run, and they run exactly once.
 *
 * Baseline is deliberately a separate, explicit command. It is not something
 * `migrate` will ever do on its own, because "the ledger is missing, so I'll
 * just assume everything is applied" is precisely the silent assumption that
 * produced the cron_logs gap.
 *
 * Baseline does NOT retroactively apply anything. If cron_logs was truly never
 * applied, baseline marks it applied-as-history and it stays missing. That gap
 * is real, it predates this tool, and it needs a NEW migration to fix -- which
 * is the correct way to repair drift. `migrate:status` reports the ledger; it
 * cannot diff your schema against 138 files, so don't read a clean status as
 * proof the schema is complete.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const GO = process.argv.includes('--go');
const cmd = process.argv[2] === 'status' || process.argv[2] === 'baseline' ? process.argv[2] : 'apply';

/**
 * Statements Postgres refuses to run inside a transaction block. We wrap every
 * migration in BEGIN/COMMIT by default (matching the Supabase SQL editor, so the
 * failure mode stays the one Eric already has a mental model for: a failure means
 * NOTHING applied). These need an explicit opt-out.
 *
 * One file on disk genuinely needs it -- 20260703_sam_opportunities_fts.sql,
 * which builds its FTS index CONCURRENTLY -- so this is load-bearing, not
 * defensive coding.
 */
const NON_TX_PATTERN =
  /\b(CREATE|DROP)\s+INDEX\s+CONCURRENTLY\b|(?:^|;)\s*VACUUM\b|\bALTER\s+TYPE\s+\S+\s+ADD\s+VALUE\b/i;
const NO_TX_DIRECTIVE = /^--\s*migrate:no-transaction\s*$/im;

/**
 * Strip comments and string literals before scanning for non-transactional DDL.
 *
 * Required, not tidiness. 20260716_db_health_stats_client_backends_only.sql
 * discusses the vacuum horizon in two prose comments and contains no VACUUM
 * statement at all. Scanning the raw text flagged it and would have blocked a
 * transaction-safe migration with an error telling Eric to add a directive it
 * does not need -- a false alarm on the one file whose comments talk about the
 * very hazard being detected.
 *
 * Order matters: line comments before block comments, so a `--` inside a `/* *\/`
 * doesn't truncate wrongly. This is a heuristic gate in front of an explicit
 * directive, not a SQL parser -- it only has to avoid crying wolf.
 */
function stripNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, ' ');
}

type Migration = { version: string; sql: string; checksum: string; noTx: boolean };
type LedgerRow = { version: string; checksum: string; applied_at: string; baselined: boolean };

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    // Filenames are date-prefixed (20260403_...), so lexical sort IS chronological
    // order. This is the only thing establishing apply order -- keep the prefix.
    .sort()
    .map((version) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, version), 'utf8');
      return {
        version,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
        noTx: NO_TX_DIRECTIVE.test(sql),
      };
    });
}

/**
 * Resolve the connection string.
 *
 * DATABASE_URL is the ESTABLISHED name in this repo -- scripts/lib/db-url.js
 * already resolves it for the one-off migration scripts, and it's already set in
 * Vercel. Don't invent a second name for the same thing; SUPABASE_DB_URL is
 * accepted only as an alias so nobody who guessed it gets a confusing failure.
 *
 * NEVER hardcode this value. Per scripts/lib/db-url.js: on 2026-07-09 a plaintext
 * prod password was found committed and had to be rotated.
 */
function connString(): { url: string; pooled: boolean } {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(`
✗ No database connection string.

  This runner needs a real Postgres connection -- the service-role key only
  reaches PostgREST, which cannot run DDL.

  Add ONE line to .env.local (gitignored -- never commit it):

    DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-us-west-2.pooler.supabase.com:5432/postgres"

  Get it from: Supabase dashboard -> Connect -> Connection string -> URI.
  This project's ref is krpyelfrbicmvsmwovti (region us-west-2).

  Port 5432 (session pooler) is PREFERRED -- it supports the advisory lock that
  stops two runners from racing. Port 6543 (transaction pooler) also works; the
  lock is skipped and you'll see a warning.

  Same variable scripts/lib/db-url.js already uses, so setting it once also fixes
  the other migration scripts.
`);
    process.exit(1);
  }
  // Transaction pooler: sessions aren't pinned to a backend, so a session-scoped
  // advisory lock could be acquired on one connection and released on another.
  // Degrade to no lock rather than pretend we're serialized.
  return { url, pooled: url.includes(':6543') };
}

async function ensureLedger(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_by  TEXT NOT NULL DEFAULT CURRENT_USER,
      -- TRUE = adopted by baseline, never actually executed by this runner.
      -- Distinguishing these matters: a baselined row is a claim about history,
      -- not evidence the SQL ran.
      baselined   BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
}

async function ledger(client: Client): Promise<Map<string, LedgerRow>> {
  const { rows } = await client.query<LedgerRow>(
    'SELECT version, checksum, applied_at, baselined FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.version, r]));
}

async function ledgerExists(client: Client): Promise<boolean> {
  const { rows } = await client.query(`SELECT to_regclass('public.schema_migrations') AS t`);
  return rows[0].t !== null;
}

function classify(files: Migration[], applied: Map<string, LedgerRow>) {
  const pending: Migration[] = [];
  const drifted: Migration[] = [];
  for (const m of files) {
    const row = applied.get(m.version);
    if (!row) pending.push(m);
    else if (row.checksum !== m.checksum) drifted.push(m);
  }
  // A version in the ledger with no file on disk: someone deleted an applied
  // migration. Report it -- never delete the ledger row, that's the audit trail.
  const orphaned = [...applied.keys()].filter((v) => !files.some((f) => f.version === v));
  return { pending, drifted, orphaned };
}

async function cmdStatus(client: Client) {
  const files = loadMigrations();
  if (!(await ledgerExists(client))) {
    console.log(`\n⚠ No ledger yet — schema_migrations does not exist.`);
    console.log(`  ${files.length} migration files on disk, NONE tracked.\n`);
    console.log(`  Run the one-time adoption first:\n`);
    console.log(`      npm run migrate:baseline -- --go\n`);
    console.log(`  It marks all ${files.length} as applied WITHOUT running them.`);
    console.log(`  It does NOT execute any SQL.\n`);
    return;
  }
  const applied = await ledger(client);
  const { pending, drifted, orphaned } = classify(files, applied);

  console.log(`\n=== migration status ===`);
  console.log(`  on disk:  ${files.length}`);
  console.log(`  applied:  ${applied.size}  (${[...applied.values()].filter((r) => r.baselined).length} baselined)`);
  console.log(`  pending:  ${pending.length}`);

  if (pending.length) {
    console.log(`\n  PENDING — would run, in this order:`);
    for (const m of pending) console.log(`    • ${m.version}${m.noTx ? '  [no-transaction]' : ''}`);
  }
  if (drifted.length) {
    // Loud on purpose. The file changed after it was applied, so the DB no longer
    // matches the repo and re-running is NOT the fix (it already ran).
    console.log(`\n  ⚠ DRIFTED — applied, then EDITED on disk (${drifted.length}):`);
    for (const m of drifted) console.log(`    • ${m.version}`);
    console.log(`    The database reflects the OLD text. Editing an applied migration`);
    console.log(`    does not change the database — write a NEW migration instead.`);
  }
  if (orphaned.length) {
    console.log(`\n  ⚠ ORPHANED — in ledger, file deleted (${orphaned.length}):`);
    for (const v of orphaned) console.log(`    • ${v}`);
  }
  if (!pending.length && !drifted.length && !orphaned.length) console.log(`\n  ✓ Up to date.`);
  console.log(`\n  NOTE: a clean status means the LEDGER is consistent. It does not prove`);
  console.log(`  the schema is complete — anything missed before baseline stays missed.\n`);
}

async function cmdBaseline(client: Client) {
  const files = loadMigrations();
  if (await ledgerExists(client)) {
    const applied = await ledger(client);
    console.error(`\n✗ Already baselined — schema_migrations exists with ${applied.size} rows.`);
    console.error(`  Baseline is a ONE-TIME adoption. Use 'npm run migrate:status'.\n`);
    process.exit(1);
  }
  console.log(`\n=== baseline — adopt existing history ===`);
  console.log(`  ${files.length} files would be marked applied WITHOUT being executed.`);
  console.log(`  NO SQL from any migration will run. Nothing in your schema changes.\n`);
  if (!GO) {
    console.log(`  Dry run. Nothing written. To adopt:\n`);
    console.log(`      npm run migrate:baseline -- --go\n`);
    return;
  }
  await ensureLedger(client);
  await client.query('BEGIN');
  try {
    for (const m of files) {
      await client.query(
        `INSERT INTO schema_migrations (version, checksum, baselined) VALUES ($1, $2, TRUE)
         ON CONFLICT (version) DO NOTHING`,
        [m.version, m.checksum],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
  console.log(`  ✓ Adopted ${files.length} migrations as history. Zero SQL executed.`);
  console.log(`  From here, 'npm run migrate' runs only NEW files.\n`);
}

async function cmdApply(client: Client, pooled: boolean) {
  const files = loadMigrations();
  if (!(await ledgerExists(client))) {
    // Refuse rather than guess. Auto-baselining here would silently bless 138
    // unverified files; auto-applying them would be destructive.
    console.error(`\n✗ No ledger — refusing to run.`);
    console.error(`  ${files.length} files on disk and no record of what's applied.`);
    console.error(`  Running them blindly could be destructive; assuming they're applied`);
    console.error(`  could hide a real gap. Decide explicitly:\n`);
    console.error(`      npm run migrate:baseline -- --go\n`);
    process.exit(1);
  }

  const applied = await ledger(client);
  const { pending, drifted } = classify(files, applied);

  if (drifted.length) {
    console.log(`\n⚠ ${drifted.length} applied migration(s) were edited on disk:`);
    for (const m of drifted) console.log(`    • ${m.version}`);
    console.log(`  These will NOT be re-run — they already ran. Write a new migration.\n`);
  }
  if (!pending.length) {
    console.log(`\n✓ Nothing pending. ${applied.size} applied, ${files.length} on disk.\n`);
    return;
  }

  console.log(`\n=== migrate — ${pending.length} pending ===`);
  for (const m of pending) console.log(`  • ${m.version}${m.noTx ? '  [no-transaction]' : ''}`);
  if (!GO) {
    console.log(`\n  DRY RUN — nothing executed. To apply:\n`);
    console.log(`      npm run migrate -- --go\n`);
    return;
  }

  // Serialize runners. Two concurrent applies would race on the ledger and could
  // run the same DDL twice. Session-scoped, so it releases if this process dies.
  // Unavailable through the transaction pooler (see connString) -- say so out
  // loud rather than take a lock that silently doesn't hold.
  if (pooled) {
    console.log(`\n  ⚠ Connected via the transaction pooler (6543) — advisory lock SKIPPED.`);
    console.log(`    Concurrent runs are not serialized. Don't run two at once.`);
    console.log(`    Use the session pooler (5432) to get the lock.`);
  } else {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['ma:migrate']);
  }
  try {
    for (const m of pending) {
      // Auto-detect the transaction hazard even when the directive is absent --
      // otherwise CREATE INDEX CONCURRENTLY fails deep inside a BEGIN block with
      // an error that reads like a SQL bug rather than a runner bug.
      if (!m.noTx && NON_TX_PATTERN.test(stripNoise(m.sql))) {
        console.error(`\n✗ ${m.version} contains a statement that cannot run in a transaction`);
        console.error(`  (CONCURRENTLY / VACUUM / ALTER TYPE ADD VALUE).`);
        console.error(`  Add this as the first line of the file, then re-run:\n`);
        console.error(`      -- migrate:no-transaction\n`);
        console.error(`  Stopping. ${m.version} and everything after it were NOT applied.`);
        process.exit(1);
      }

      process.stdout.write(`  ▶ ${m.version} ... `);
      const t0 = Date.now();
      try {
        if (m.noTx) {
          // No BEGIN/COMMIT: a failure part-way leaves a PARTIAL apply. Recorded
          // in the ledger only on success, so a retry re-runs the whole file --
          // which is why these files must be written idempotently.
          await client.query(m.sql);
        } else {
          await client.query('BEGIN');
          await client.query(m.sql);
          // Ledger insert rides INSIDE the same transaction. If the migration
          // rolls back, so does its ledger row -- they can never disagree.
          await client.query(
            `INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`,
            [m.version, m.checksum],
          );
          await client.query('COMMIT');
        }
        if (m.noTx) {
          await client.query(`INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`, [
            m.version,
            m.checksum,
          ]);
        }
        console.log(`ok (${Date.now() - t0}ms)`);
      } catch (e) {
        if (!m.noTx) await client.query('ROLLBACK').catch(() => {});
        const err = e as Error & { code?: string; hint?: string; position?: string };
        console.log(`FAILED`);
        console.error(`\n✗ ${m.version} failed`);
        console.error(`  ${err.code ? err.code + ': ' : ''}${err.message}`);
        if (err.hint) console.error(`  hint: ${err.hint}`);
        console.error(
          m.noTx
            ? `\n  This file runs WITHOUT a transaction — it may be PARTIALLY applied.\n  Inspect the schema before retrying.`
            : `\n  Rolled back. Nothing from this file was applied.`,
        );
        console.error(`  Stopping — later migrations were NOT attempted.\n`);
        process.exit(1);
      }
    }
  } finally {
    if (!pooled) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['ma:migrate']).catch(() => {});
    }
  }
  console.log(`\n  ✓ Applied ${pending.length} migration(s).\n`);
}

async function main() {
  const { url, pooled } = connString();
  const client = new Client({
    connectionString: url,
    // Supabase requires TLS and its chain isn't in Node's default store. Matches
    // what scripts/lib/db-url.js consumers already do.
    ssl: { rejectUnauthorized: false },
    statement_timeout: 300_000,
  });
  await client.connect();
  try {
    if (cmd === 'status') await cmdStatus(client);
    else if (cmd === 'baseline') await cmdBaseline(client);
    else await cmdApply(client, pooled);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}\n`);
  process.exit(1);
});
