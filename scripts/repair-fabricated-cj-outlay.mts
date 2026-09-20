/**
 * P0 repair — remove the fabricated government-wide "Congressional justification
 * outlay" claim from source records and every customer-reachable cache.
 *
 * WHY THE CLAIM IS DELETED, NOT CORRECTED
 * `current_total_budget_authority_amount` is a GOVERNMENT-WIDE CONSTANT (one
 * distinct value across all 111 agencies). No agency-specific source supports the
 * claim at any value, so the correct replacement is NO CLAIM. The sibling
 * "Total obligated" figure in the same sentence is `budget_authority_amount`
 * mislabeled as obligations, so the whole derived sentence goes. Re-deriving a
 * "better" number from today's API would be a fresh claim invented during a
 * repair — explicitly out of scope.
 *
 * WHY THE CACHE IS REPAIRED SEPARATELY (the Potato-0C lesson)
 * `api/app/opportunity-detail` short-circuits on `intel_computed_at` and serves
 * the stored blob; `cron/precompute-opp-intel` only processes rows where that
 * stamp IS NULL. Fixing the source alone leaves every stamped opportunity serving
 * the old text forever — and 375 of the 549 are historical, which the cron will
 * never revisit at all.
 *
 * SCOPE IS FROZEN BEFORE THE WRITE. Target ids are selected once, up front, and
 * the mutation runs against that captured list — never a fresh match at write time.
 *
 * Idempotent. Dry-run by default; `--go` writes. Read-only until `--go`.
 */
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '.env.local', quiet: true });

const GO = process.argv.includes('--go');
const CJ = /congressional\s+justification\s+outlay/i;
const BILLIONS = /\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*B\b/gi;
const CEILING_B = 5000;

function isUnsupported(text: string | null | undefined): boolean {
  if (!text) return false;
  if (CJ.test(text)) return true;
  BILLIONS.lastIndex = 0;
  for (let m = BILLIONS.exec(text); m !== null; m = BILLIONS.exec(text)) {
    if (Number.parseFloat(m[1].replace(/,/g, '')) >= CEILING_B) return true;
  }
  return false;
}

type IntelAgency = { painPoints?: unknown; priorities?: unknown; citations?: unknown } | null;

/** Remove unsupported claims from an intel_agency blob. Returns null when unchanged. */
function cleanBlob(blob: IntelAgency): IntelAgency | null {
  if (!blob || typeof blob !== 'object') return null;
  let changed = false;
  const out: Record<string, unknown> = { ...blob };
  for (const field of ['painPoints', 'priorities'] as const) {
    const arr = (blob as Record<string, unknown>)[field];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((c) => !(typeof c === 'string' && isUnsupported(c)));
    if (kept.length !== arr.length) { changed = true; out[field] = kept; }
  }
  return changed ? (out as IntelAgency) : null;
}

async function main() {
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
  });
  await c.connect();

  // ── SCOPE FREEZE ───────────────────────────────────────────────────────────
  const src = await c.query<{ id: string; agency_name: string; description: string }>(
    `select id, agency_name, description from agency_intelligence
     where description ~* 'congressional\\s+justification\\s+outlay' order by agency_name`,
  );
  const cache = await c.query<{ notice_id: string; active: boolean; intel_agency: IntelAgency }>(
    `select notice_id, active, intel_agency from sam_opportunities
     where intel_agency::text ~* 'congressional\\s+justification\\s+outlay' order by notice_id`,
  );

  const srcIds = src.rows.map((r) => r.id);
  const planned = cache.rows
    .map((r) => ({ ...r, cleaned: cleanBlob(r.intel_agency) }))
    .filter((r) => r.cleaned !== null);

  const text = (b: IntelAgency) => JSON.stringify(b ?? {});
  const has = (b: IntelAgency, v: string) => text(b).includes(v);
  const activeN = cache.rows.filter((r) => r.active).length;
  const oldOnly = cache.rows.filter((r) => has(r.intel_agency, '13541.1B') && !has(r.intel_agency, '16047.1B')).length;
  const newOnly = cache.rows.filter((r) => has(r.intel_agency, '16047.1B') && !has(r.intel_agency, '13541.1B')).length;
  const both = cache.rows.filter((r) => has(r.intel_agency, '13541.1B') && has(r.intel_agency, '16047.1B')).length;
  const labeled = cache.rows.filter((r) => has(r.intel_agency, 'LEGACY_MANUAL')).length;

  console.log('── PRE-REPAIR COUNTS (frozen scope) ──');
  console.log(`  agency_intelligence contaminated rows : ${srcIds.length}`);
  console.log(`  opportunities contaminated            : ${cache.rows.length}`);
  console.log(`    ACTIVE                              : ${activeN}`);
  console.log(`    historical                          : ${cache.rows.length - activeN}`);
  console.log(`    old-value-only ($13,541.1B)         : ${oldOnly}`);
  console.log(`    new-value-only ($16,047.1B)         : ${newOnly}`);
  console.log(`    BOTH vintages                       : ${both}`);
  console.log(`    carrying any provenance label       : ${labeled}`);
  console.log(`  blobs the cleaner will rewrite        : ${planned.length}`);

  // Every contaminated blob must be repairable — a gap means a shape the cleaner misses.
  const unrepairable = cache.rows.length - planned.length;
  if (unrepairable !== 0) {
    console.error(`\n✗ ABORT — ${unrepairable} contaminated blob(s) the cleaner would NOT change.`);
    await c.end();
    process.exit(1);
  }

  if (!GO) {
    console.log('\nDRY RUN — nothing written. Re-run with --go to apply.');
    await c.end();
    return;
  }

  // ── WRITE ──────────────────────────────────────────────────────────────────
  await c.query('BEGIN');
  try {
    // 1. SOURCE: drop the unsupported derived sentence. The row, its agency, title,
    //    fiscal year, source_name and source_url are PRESERVED — only the claim goes.
    const s = await c.query(
      `update agency_intelligence set description = null, updated_at = now()
       where id = any($1::uuid[])`, [srcIds],
    );
    console.log(`  agency_intelligence.description nulled : ${s.rowCount}`);

    // 2. CACHE: deterministic per-row rewrite from the frozen list.
    let n = 0;
    for (const row of planned) {
      const r = await c.query(
        `update sam_opportunities set intel_agency = $2::jsonb where notice_id = $1`,
        [row.notice_id, JSON.stringify(row.cleaned)],
      );
      n += r.rowCount ?? 0;
    }
    console.log(`  intel_agency blobs repaired            : ${n}`);

    await c.query('COMMIT');
    console.log('\n✓ committed');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('✗ rolled back:', (e as Error).message);
    await c.end();
    process.exit(1);
  }

  // ── POST-REPAIR PROOF (re-measured, not assumed) ───────────────────────────
  const post = await c.query<{ src: string; opps: string; act: string; v1: string; v2: string }>(
    `select
       (select count(*) from agency_intelligence where description ~* 'congressional\\s+justification\\s+outlay')::text src,
       (select count(*) from sam_opportunities where intel_agency::text ~* 'congressional\\s+justification\\s+outlay')::text opps,
       (select count(*) from sam_opportunities where active and intel_agency::text ~* 'congressional\\s+justification\\s+outlay')::text act,
       (select count(*) from sam_opportunities where intel_agency::text like '%13541.1B%')::text v1,
       (select count(*) from sam_opportunities where intel_agency::text like '%16047.1B%')::text v2`,
  );
  const p = post.rows[0];
  console.log('\n── POST-REPAIR ──');
  console.log(`  agency_intelligence bad claims : ${p.src}`);
  console.log(`  opportunities (any)            : ${p.opps}`);
  console.log(`  opportunities ACTIVE           : ${p.act}`);
  console.log(`  $13,541.1B remaining           : ${p.v1}`);
  console.log(`  $16,047.1B remaining           : ${p.v2}`);
  await c.end();
  if (Number(p.src) || Number(p.opps) || Number(p.v1) || Number(p.v2)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
