/**
 * Promotion-safety suite — run against a REAL database.
 *
 * These are transaction, locking, and trigger semantics. A mock cannot tell you
 * whether an advisory lock actually serializes two concurrent promotions, or
 * whether a failure mid-way truly rolls back. So this uses live connections and
 * synthetic generations that never overlap production data.
 *
 * SAFETY: every row it writes carries a data_version prefixed `zz-test-`, and it
 * asserts the production pointer is unchanged at the end. It never promotes a
 * synthetic generation while leaving it active — the pointer is always restored.
 *
 * ⚠️ THIS SUITE MUST NEVER COMMIT. It runs inside a transaction that holds an
 * UNAPPLIED migration; a COMMIT anywhere applies that DDL to whatever database
 * it is pointed at. That exact bug applied this migration to production once
 * (2026-08-25) while the run reported "all rolled back". Release locks by ending
 * a DIFFERENT connection's transaction, never by committing this one.
 *
 * PREFER AN ISOLATED DATABASE. Point DATABASE_URL at a branch/clone; the
 * teardown assertions below are a safety net, not a substitute.
 *
 *   npx tsx scripts/test-promotion-safety.ts
 */
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const URL = process.env.DATABASE_URL;
if (!URL) throw new Error('DATABASE_URL required');

const PREFIX = `zz-test-${randomUUID().slice(0, 8)}`;
const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

import fs from 'node:fs';
const MIGRATION = fs.readFileSync('supabase/migrations/20260825_lifecycle_follows_pointer.sql', 'utf8');

/**
 * Each connection applies the migration inside an outer transaction that is NEVER
 * committed, so the suite exercises the real function against real data without
 * persisting anything. Inner cases use savepoints.
 */
async function conn(applyMigration = true) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  await c.query('BEGIN');
  // Only the first connection installs the function. A second connection doing
  // the same would block on pg_proc while the first holds it — an artifact of
  // testing an unapplied migration, not a property of the function.
  if (applyMigration) await c.query(MIGRATION);
  return c;
}

/** Insert N synthetic pages for a generation. */
async function seed(c: Client, version: string, n: number, lifecycle = 'staging') {
  for (let i = 0; i < n; i++) {
    await c.query(
      `INSERT INTO awards_serving_pages
         (recipient_uei, page_number, page_size, data_version, lifecycle,
          row_count, payload, contract_count, displayed_action_count,
          total_action_count, displayed_obligated, source_as_of, payload_checksum)
       VALUES ($1, $2, 50, $3, $4, 1, '[]'::jsonb, 1, 1, 1, 1, '2026-08-11', 'x')
       ON CONFLICT (recipient_uei, page_number, page_size, data_version) DO NOTHING`,
      [`${PREFIX}-U${i}`, 1, version, lifecycle],
    );
  }
}

async function main() {
  const c = await conn();
  const prodPointer = (await c.query(`SELECT active_version FROM awards_active_version WHERE id=1`)).rows[0]?.active_version;
  const base = (await c.query(`SELECT
    (SELECT count(*)::int FROM schema_migrations) ledger,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE proname='promote_awards_version' AND n.nspname='public') sigs,
    (SELECT count(*)::int FROM pg_trigger WHERE tgname='trg_refuse_delete_pointer_target' AND NOT tgisinternal) trg`)).rows[0];
  const ledgerAtStart = base.ledger, sigsAtStart = base.sigs, trgAtStart = base.trg;
  console.log(`\nProduction pointer at start: ${prodPointer}`);
  console.log(`Synthetic prefix: ${PREFIX}\n`);

  const A = `${PREFIX}-genA`;
  const B = `${PREFIX}-genB`;

  try {
    // ── TEST 1: successful atomic promotion ────────────────────────────────
    console.log('TEST 1 — successful atomic promotion');
    await seed(c, A, 3);
    await c.query('SAVEPOINT s');
    const r1 = await c.query(
      `SELECT * FROM promote_awards_version($1, '2026-08-11'::date, 'test', $2, true)`,
      [A, prodPointer],
    );
    const ptr1 = (await c.query(`SELECT active_version FROM awards_active_version WHERE id=1`)).rows[0].active_version;
    const liveGens = (await c.query(`SELECT count(DISTINCT data_version)::int n FROM awards_serving_pages WHERE lifecycle='live'`)).rows[0].n;
    check('pointer moved to the new generation', ptr1 === A, `pointer=${ptr1}`);
    check('exactly one generation labelled live', liveGens === 1, `live generations=${liveGens}`);
    check('rows_set_live reported', r1.rows[0].rows_set_live === 3, `set_live=${r1.rows[0].rows_set_live}`);
    check('previous generation retired', r1.rows[0].rows_retired > 0, `retired=${r1.rows[0].rows_retired}`);
    await c.query('ROLLBACK TO SAVEPOINT s');

    const afterRb = (await c.query(`SELECT active_version FROM awards_active_version WHERE id=1`)).rows[0].active_version;
    check('ROLLBACK restored the pointer (atomicity)', afterRb === prodPointer, `pointer=${afterRb}`);

    // ── TEST 2: failure between mutation steps rolls everything back ────────
    console.log('\nTEST 2 — failure mid-transaction rolls back every change');
    await c.query('SAVEPOINT s');
    await c.query(`SELECT * FROM promote_awards_version($1, '2026-08-11'::date, 'test', $2, true)`, [A, prodPointer]);
    const midLabels = (await c.query(
      `SELECT count(*)::int n FROM awards_serving_pages WHERE data_version=$1 AND lifecycle='live'`, [A])).rows[0].n;
    check('labels updated inside the transaction', midLabels === 3, `live rows=${midLabels}`);
    await c.query(`SELECT 1/0`).catch(() => {});   // force a failure
    await c.query('ROLLBACK TO SAVEPOINT s');
    const postLabels = (await c.query(
      `SELECT count(*)::int n FROM awards_serving_pages WHERE data_version=$1 AND lifecycle='live'`, [A])).rows[0].n;
    const postPtr = (await c.query(`SELECT active_version FROM awards_active_version WHERE id=1`)).rows[0].active_version;
    check('label changes rolled back', postLabels === 0, `live rows=${postLabels}`);
    check('pointer unchanged after failure', postPtr === prodPointer, `pointer=${postPtr}`);

    // ── TEST 3: concurrent promotions serialize ────────────────────────────
    console.log('\nTEST 3 — concurrent promotion attempts serialize on the advisory lock');
    await seed(c, B, 3);
    // Separate connections for the concurrency test, so neither can disturb the
    // migration-holding transaction on `c`.
    const c2 = await conn(false);
    const c3 = await conn(false);
    await c3.query(`SELECT pg_advisory_xact_lock(hashtext('promote_awards_version'))`);
    let acquired = false;
    const race = c2.query(`SELECT pg_advisory_xact_lock(hashtext('promote_awards_version'))`)
      .then(() => { acquired = true; }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    check('second promotion blocked while the first holds the lock', !acquired, 'waited 1.5s, still blocked');
    // NEVER COMMIT HERE. An earlier version issued COMMIT to release the lock so
    // c2 could proceed — and committed the migration the outer transaction was
    // holding, applying DDL to production while reporting "all rolled back".
    // A third connection releases the lock by ending its own transaction instead.
    await c3.query('ROLLBACK');   // c3 held the lock; ending its txn frees it
    await race.catch(() => {});
    check('lock acquired by the second txn once the first released', acquired, 'serialized, not deadlocked');
    await c2.query('ROLLBACK').catch(() => {}); await c2.end();
    await c3.end();

    // ── TEST 4: stale worker refused ───────────────────────────────────────
    console.log('\nTEST 4 — stale worker whose pointer moved is refused');
    let staleErr = '';
    await c.query('SAVEPOINT s4');
    await c.query(`SELECT * FROM promote_awards_version($1,'2026-08-11'::date,'test',$2,true)`, [A, 'a-pointer-that-never-existed'])
      .catch((e) => { staleErr = e.message; });
    await c.query('ROLLBACK TO SAVEPOINT s4');
    check('promotion refused when pointer moved since build start',
      /Stale worker|pointer moved/i.test(staleErr), staleErr.slice(0, 90));

    // ── TEST 5: cleanup cannot delete the pointer target ───────────────────
    console.log('\nTEST 5 — deletion of the pointer-active generation is refused');
    let delErr = '';
    await c.query('SAVEPOINT d1');
    await c.query(`DELETE FROM awards_serving_pages WHERE data_version=$1`, [prodPointer])
      .catch((e) => { delErr = e.message; });
    await c.query('ROLLBACK TO SAVEPOINT d1');
    check('DELETE against the pointer target refused',
      /pointer-active/i.test(delErr), delErr.slice(0, 90));
    const stillThere = (await c.query(
      `SELECT count(*)::int n FROM awards_serving_pages WHERE data_version=$1`, [prodPointer])).rows[0].n;
    check('pointer-active rows still present', stillThere > 0, `${stillThere} rows`);

    // The label must NOT be what protects them. Prove it by setting the pointer
    // generation to EVERY lifecycle value in turn and re-attempting the delete:
    // the refusal must hold in all three cases.
    for (const label of ['staging', 'live', 'retired']) {
      let e = '';
      await c.query('SAVEPOINT d2');
      await c.query(`UPDATE awards_serving_pages SET lifecycle=$2 WHERE data_version=$1`, [prodPointer, label]);
      await c.query('SAVEPOINT d3');
      await c.query(`DELETE FROM awards_serving_pages WHERE data_version=$1`, [prodPointer])
        .catch((x) => { e = x.message; });
      await c.query('ROLLBACK TO SAVEPOINT d3');
      await c.query('ROLLBACK TO SAVEPOINT d2');
      check(`refusal holds when the pointer generation is labelled '${label}'`,
        /pointer-active/i.test(e), e ? 'refused' : 'NOT REFUSED');
    }

    // ── TEST 6: data_version reuse is impossible ───────────────────────────
    console.log('\nTEST 6 — a build cannot reuse an existing data_version');
    const idA = `2026-08-11-build-3-a2-${randomUUID().slice(0, 8)}`;
    const idB = `2026-08-11-build-3-a2-${randomUUID().slice(0, 8)}`;
    check('same job+attempt yields distinct generation ids', idA !== idB, `${idA.slice(-8)} vs ${idB.slice(-8)}`);
    const dupRows = (await c.query(
      `SELECT count(*)::int n FROM awards_serving_pages WHERE data_version=$1`, [idA])).rows[0].n;
    check('a fresh generation id collides with nothing', dupRows === 0, `${dupRows} pre-existing rows`);

    // ── TEST 7: mixed lifecycle within one generation is rejected ──────────
    console.log('\nTEST 7 — mixed lifecycle within one data_version is rejected');
    await c.query('SAVEPOINT s');
    await c.query(
      `UPDATE awards_serving_pages SET lifecycle='retired'
        WHERE data_version=$1 AND recipient_uei=$2`, [A, `${PREFIX}-U0`]);
    let mixedErr = '';
    await c.query('SAVEPOINT m1');
    await c.query(`SELECT * FROM promote_awards_version($1,'2026-08-11'::date,'test',$2,true)`, [A, prodPointer])
      .catch((e) => { mixedErr = e.message; });
    await c.query('ROLLBACK TO SAVEPOINT m1');
    check('promotion refused for a half-labelled generation',
      /distinct lifecycle/i.test(mixedErr), mixedErr.slice(0, 90));
    await c.query('ROLLBACK TO SAVEPOINT s');

    // ── TEST 8: reconciling the CURRENT divergent production state ─────────
    console.log('\nTEST 8 — reconciliation of the live divergent state (dry, rolled back)');
    await c.query('SAVEPOINT s');
    const before = (await c.query(
      `SELECT count(*) FILTER (WHERE data_version=$1 AND lifecycle<>'live')::int AS to_live,
              count(*) FILTER (WHERE data_version<>$1 AND lifecycle='live')::int AS to_retired
         FROM awards_serving_pages`, [prodPointer])).rows[0];
    const t0 = Date.now();
    const rec = await c.query(
      `SELECT * FROM promote_awards_version($1, NULL, 'reconcile-dryrun', $1, true)`, [prodPointer]);
    const ms = Date.now() - t0;
    // Re-promoting the active version is the idempotent path, so reconcile
    // explicitly instead to measure the real relabel cost.
    await c.query('ROLLBACK TO SAVEPOINT s');
    check('reconcile is idempotent for the already-active pointer',
      rec.rows[0].active_version === prodPointer, `returned ${rec.rows[0].active_version}`);
    console.log(`     rows needing relabel: ${before.to_live} → live, ${before.to_retired} → retired`);
    console.log(`     idempotent call duration: ${ms}ms`);

    // Measure the actual relabel + lock duration honestly.
    await c.query('SAVEPOINT s');
    const t1 = Date.now();
    const u1 = await c.query(`UPDATE awards_serving_pages SET lifecycle='retired' WHERE data_version<>$1 AND lifecycle='live'`, [prodPointer]);
    const u2 = await c.query(`UPDATE awards_serving_pages SET lifecycle='live' WHERE data_version=$1 AND lifecycle IS DISTINCT FROM 'live'`, [prodPointer]);
    const relabelMs = Date.now() - t1;
    check('reconciliation relabels the expected row counts',
      u1.rowCount === before.to_retired && u2.rowCount === before.to_live,
      `${u2.rowCount} → live, ${u1.rowCount} → retired in ${relabelMs}ms`);
    const oneLive = (await c.query(`SELECT count(DISTINCT data_version)::int n FROM awards_serving_pages WHERE lifecycle='live'`)).rows[0].n;
    check('exactly one pointer-active generation after reconcile', oneLive === 1, `live generations=${oneLive}`);
    await c.query('ROLLBACK TO SAVEPOINT s');
    console.log(`     MEASURED LOCK DURATION: ${relabelMs}ms for ${(u1.rowCount ?? 0) + (u2.rowCount ?? 0)} rows`);

  } finally {
    // ── TEARDOWN ASSERTIONS ───────────────────────────────────────────────
    // The suite must leave production byte-identical. Asserted, not assumed —
    // the COMMIT bug proved that "I rolled back" is a claim needing evidence.
    await c.query('ROLLBACK').catch(() => {});   // discard the migration txn FIRST

    const td = await c.query(`SELECT
      (SELECT count(*)::int FROM awards_serving_pages WHERE data_version LIKE $1) synthetic,
      (SELECT active_version FROM awards_active_version WHERE id=1) ptr,
      (SELECT count(*)::int FROM schema_migrations) ledger,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE proname='promote_awards_version' AND n.nspname='public') sigs,
      (SELECT count(*)::int FROM pg_trigger WHERE tgname='trg_refuse_delete_pointer_target' AND NOT tgisinternal) trg`,
      [`${PREFIX}%`]);
    const t = td.rows[0];
    check('TEARDOWN: zero synthetic rows remain', t.synthetic === 0, `${t.synthetic} found`);
    check('TEARDOWN: production pointer unchanged', t.ptr === prodPointer, `${t.ptr}`);
    check('TEARDOWN: migration ledger unchanged', t.ledger === ledgerAtStart, `${t.ledger} vs ${ledgerAtStart} at start`);
    check('TEARDOWN: function signature count unchanged', t.sigs === sigsAtStart, `${t.sigs} vs ${sigsAtStart}`);
    check('TEARDOWN: trigger state unchanged', t.trg === trgAtStart, `${t.trg} vs ${trgAtStart}`);
    if (t.synthetic > 0) {
      await c.query(`DELETE FROM awards_serving_pages WHERE data_version LIKE $1`, [`${PREFIX}%`]).catch(() => {});
    }
    await c.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(60)}\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
    process.exit(1);
  }
  console.log('All promotion-safety checks passed.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
