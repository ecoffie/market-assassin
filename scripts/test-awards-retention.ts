/**
 * Retention-policy suite — real database, ROLLBACK ONLY.
 *
 * ⚠️ NEVER COMMIT from this suite. It runs inside a transaction holding an
 * unapplied migration; a COMMIT applies that DDL. That exact bug applied a
 * migration to production once (2026-08-25) while reporting "all rolled back".
 * Release locks by ending a DIFFERENT connection's transaction.
 */
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const URL = process.env.DATABASE_URL;
if (!URL) throw new Error('DATABASE_URL required');
const MIGRATION = fs.readFileSync('supabase/migrations/20260825_awards_retention.sql', 'utf8');
const P = `zz-ret-${randomUUID().slice(0, 8)}`;
const results: { n: string; ok: boolean; d: string }[] = [];
const check = (n: string, ok: boolean, d = '') => { results.push({ n, ok, d }); console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); };

async function conn(applyMigration = true) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  await c.query('BEGIN');
  if (applyMigration) await c.query(MIGRATION);
  return c;
}

/** Seed a generation with a controllable age. */
async function seed(c: Client, version: string, n: number, lifecycle: string, ageDays: number) {
  for (let i = 0; i < n; i++) {
    await c.query(
      `INSERT INTO awards_serving_pages
        (recipient_uei,page_number,page_size,data_version,lifecycle,row_count,payload,
         contract_count,displayed_action_count,total_action_count,displayed_obligated,
         source_as_of,payload_checksum,generated_at)
       VALUES ($1,$2,50,$3,$4,1,'[]'::jsonb,1,1,1,1,'2026-08-11','x', now() - make_interval(days=>$5))`,
      [`${P}-U${i}`, i + 1, version, lifecycle, ageDays],
    );
  }
}

async function main() {
  const c = await conn();
  const ptr = (await c.query(`SELECT active_version, previous_version FROM awards_active_version WHERE id=1`)).rows[0];
  const base = (await c.query(`SELECT count(*)::int n FROM awards_serving_pages`)).rows[0].n;
  console.log(`\npointer=${ptr.active_version}\nprevious=${ptr.previous_version}\nprefix=${P}\n`);

  const OLD = `${P}-old`, YOUNG = `${P}-young`;

  try {
    console.log('TEST 1 — the current pointer generation can never be deleted');
    const r1 = await c.query(`SELECT * FROM awards_prune_batch($1, 100, 'test')`, [ptr.active_version]);
    check('prune refuses the pointer target', /current pointer/i.test(r1.rows[0].aborted_reason ?? ''), r1.rows[0].aborted_reason ?? 'NOT REFUSED');
    check('no rows deleted from the pointer generation', r1.rows[0].deleted === 0, `deleted=${r1.rows[0].deleted}`);
    const stillLive = (await c.query(`SELECT count(*)::int n FROM awards_serving_pages WHERE data_version=$1`, [ptr.active_version])).rows[0].n;
    check('pointer generation intact', stillLive === 23492, `${stillLive} pages`);

    console.log('\nTEST 2 — the recorded previous generation is retained');
    const r2 = await c.query(`SELECT * FROM awards_prune_batch($1, 100, 'test')`, [ptr.previous_version]);
    check('prune refuses the previous generation', /previous generation/i.test(r2.rows[0].aborted_reason ?? ''), r2.rows[0].aborted_reason ?? 'NOT REFUSED');
    const cands0 = await c.query(`SELECT data_version FROM awards_prune_candidates(7)`);
    check('previous generation is not even a candidate',
      !cands0.rows.some((x: { data_version: string }) => x.data_version === ptr.previous_version), `${cands0.rows.length} candidate(s)`);

    console.log('\nTEST 3 — a young retired generation is retained');
    await seed(c, YOUNG, 4, 'retired', 2);           // 2 days old, inside the window
    const cands1 = await c.query(`SELECT data_version FROM awards_prune_candidates(7)`);
    check('2-day-old retired generation is NOT a candidate',
      !cands1.rows.some((x: { data_version: string }) => x.data_version === YOUNG), 'inside the 7-day rollback window');

    console.log('\nTEST 4 — an old retired generation IS pruned');
    await seed(c, OLD, 5, 'retired', 30);            // 30 days old
    const cands2 = await c.query(`SELECT data_version, pages, payload_bytes FROM awards_prune_candidates(7)`);
    const hit = cands2.rows.find((x: { data_version: string }) => x.data_version === OLD);
    check('30-day-old retired generation IS a candidate', !!hit, hit ? `${hit.pages} pages` : 'MISSING');
    const before = (await c.query(`SELECT count(*)::int n FROM awards_serving_pages WHERE data_version=$1`, [OLD])).rows[0].n;
    const r4 = await c.query(`SELECT * FROM awards_prune_batch($1, 2000, 'test')`, [OLD]);
    check('deleted count matches the dry-run count', r4.rows[0].deleted === before, `expected ${before}, deleted ${r4.rows[0].deleted}`);
    check('generation fully removed', r4.rows[0].remaining === '0' || Number(r4.rows[0].remaining) === 0, `remaining=${r4.rows[0].remaining}`);

    console.log('\nTEST 4b — audit metadata survives the prune');
    const a = (await c.query(`SELECT * FROM awards_generation_audit WHERE data_version=$1`, [OLD])).rows[0];
    check('audit row exists after payloads are gone', !!a, a ? `pages=${a.pages} recipients=${a.recipients}` : 'MISSING');
    check('pruned_at stamped', !!a?.pruned_at, a?.pruned_at ? 'stamped' : 'null');
    check('checksum + counts preserved', !!a?.payload_checksum && a.pages === 5, `checksum=${String(a?.payload_checksum).slice(0, 12)}… pages=${a?.pages}`);

    console.log('\nTEST 5 — a concurrent promotion stops pruning safely');
    // c1's transaction already holds the advisory lock (xact-scoped, taken by the
    // prune calls above) and cannot release it without committing — which this
    // suite must never do. So the contention is demonstrated the other way round:
    // c2 attempts the lock while c1 holds it, which is the same mutual exclusion
    // that makes a concurrent promotion wait for an in-flight prune.
    const c2 = new Client({ connectionString: URL });
    await c2.connect();
    await c2.query('BEGIN');
    await c2.query(`SET LOCAL lock_timeout = '1200ms'`);
    let promoBlocked = false;
    try {
      await c2.query(`SELECT pg_advisory_xact_lock(hashtext('promote_awards_version'))`);
    } catch (e: any) {
      promoBlocked = /lock timeout|canceling statement/i.test(e.message);
    }
    await c2.query('ROLLBACK').catch(() => {});
    await c2.end();
    check('a concurrent promotion cannot proceed while a prune holds the lock',
      promoBlocked, promoBlocked ? 'blocked for 1.2s then timed out' : 'NOT BLOCKED');

    console.log('\nTEST 6 — pruning is idempotent');
    const again = await c.query(`SELECT * FROM awards_prune_batch($1, 2000, 'test')`, [OLD]);
    check('re-pruning an already-pruned generation deletes 0', again.rows[0].deleted === 0, `deleted=${again.rows[0].deleted}`);
    const cands3 = await c.query(`SELECT data_version FROM awards_prune_candidates(7)`);
    check('pruned generation is no longer a candidate',
      !cands3.rows.some((x: { data_version: string }) => x.data_version === OLD), `${cands3.rows.length} candidate(s) remain`);

    console.log('\nTEST 7 — today\'s real production state prunes NOTHING');
    const real = await c.query(
      `SELECT data_version FROM awards_prune_candidates(7) WHERE data_version NOT LIKE $1`, [`${P}%`]);
    check('no real generation is eligible today (all < 7 days old)', real.rows.length === 0,
      real.rows.length ? real.rows.map((r: { data_version: string }) => r.data_version).join(', ') : 'correct — nothing to prune');
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    const td = (await c.query(`SELECT
      (SELECT count(*)::int FROM awards_serving_pages) rows,
      (SELECT active_version FROM awards_active_version WHERE id=1) ptr,
      (SELECT count(*)::int FROM awards_serving_pages WHERE data_version LIKE $1) synth,
      (SELECT to_regclass('public.awards_generation_audit') IS NOT NULL) audit_exists`, [`${P}%`])).rows[0];
    check('TEARDOWN: row count unchanged', td.rows === base, `${td.rows} vs ${base}`);
    check('TEARDOWN: pointer unchanged', td.ptr === ptr.active_version, td.ptr);
    check('TEARDOWN: zero synthetic rows', td.synth === 0, `${td.synth}`);
    check('TEARDOWN: audit table not persisted (migration rolled back)', td.audit_exists === false, `exists=${td.audit_exists}`);
    await c.end();
  }

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(58)}\n${results.length - bad.length}/${results.length} passed`);
  if (bad.length) { console.log('\nFAILED:'); for (const b of bad) console.log(`  ✗ ${b.n} — ${b.d}`); process.exit(1); }
  console.log('All retention checks passed.\n');
}
main().catch((e) => { console.error(e); process.exit(1); });
