/**
 * GATE 4 — register the Institute LEGISLATION source.
 *
 * Registration only. This script writes NO legislative content and creates NO cron.
 *
 * ── TWO REGISTRIES, AND THEY ARE NOT INTERCHANGEABLE ─────────────────────────
 * `data_sources`          human/catalog row. The legislation ROUTE reads+writes this
 *                         one (SOURCE_KEY='institute_legislation'): it owns
 *                         `last_built` and the notes sentinels that carry the
 *                         legislation clocks and the discovery cursor.
 * `data_source_instances` the control plane. GAO's row says the notes sentinel is
 *                         "legacy/compat only" and names this table as authority.
 *
 * ⚠️ WE REGISTER BOTH, BUT WE DO NOT COPY GAO'S SEMANTICS WHOLESALE.
 * Differences that are deliberate, not oversights:
 *   • watch_cadence_days = 7, not GAO's 1. Congress does not publish daily, and the
 *     legislation clocks are recess-tolerant (45-day quiet threshold vs GAO's 14).
 *   • discovery_url is the API collection this source actually polls, not an RSS feed.
 *   • ingest_mode stays 'automated' — the collector is automated even though its cron
 *     is deliberately not enabled yet (Gate 5).
 *
 * ── THE INITIALIZATION RULE (the whole point of this gate) ───────────────────
 * The registration MUST reflect the corpus Gate 3 already persisted. A row that
 * implies "never ingested" would make the system believe the 29 documents still need
 * inserting. So every initialized value is DERIVED FROM MEASURED STATE, never
 * invented:
 *   held_population       = live COUNT of legislative institute_sources rows
 *   last_verified_ingest  = MAX(discovered_at) of those rows  (a real ingest happened)
 *   last_data_advance     = MAX(updated_at)   of those rows  (data really changed then)
 *   last_source_advance   = MAX(publication_date) of those rows — GOVERNMENT time,
 *                           never Mindy time (the GAO rule, and it is right)
 *   last_poll / last_successful_check = the proven complete run's timestamp
 *
 * ⚠️ WE DO NOT FABRICATE THE DISCOVERY CURSOR. `data_sources.notes` owns the
 * legislation clocks + discovery cursor, and the ROUTE writes them on a complete
 * pass. Seeding a cursor here would assert coverage this script never performed.
 * The row is created WITHOUT a cursor; the next complete run stamps the real one.
 *
 * DRY RUN BY DEFAULT.
 *   npx tsx scripts/seed-institute-legislation-source.ts        # preview
 *   npx tsx scripts/seed-institute-legislation-source.ts --go   # write
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const GO = process.argv.includes('--go');
const SOURCE_KEY = 'institute_legislation';
const LEGISLATIVE_TYPES = ['introduced_bill', 'enacted_law', 'committee_report'];

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // ── MEASURE the corpus this registration must reflect ─────────────────────
  const { count: heldPopulation, error: countErr } = await db
    .from('institute_sources')
    .select('id', { count: 'exact', head: true })
    .in('source_type', LEGISLATIVE_TYPES);
  // A null count is UNKNOWN, never zero (Bug Prevention Rule #11). Registering 0
  // held documents would tell the system the corpus needs re-inserting.
  if (countErr || heldPopulation === null || heldPopulation === undefined) {
    console.error('[seed] cannot measure held population — refusing to register:', countErr?.message ?? 'null count');
    process.exit(1);
  }

  const { data: clocks, error: clockErr } = await db
    .from('institute_sources')
    // unranged-ok: aggregates via order+limit(1) below; corpus is small and bounded.
    .select('discovered_at, updated_at, publication_date')
    .in('source_type', LEGISLATIVE_TYPES)
    .order('discovered_at', { ascending: false })
    .limit(1000);
  if (clockErr) {
    console.error('[seed] cannot read corpus clocks — refusing to register:', clockErr.message);
    process.exit(1);
  }
  const rows = clocks ?? [];
  const maxOf = (f: (r: Record<string, unknown>) => string | null) =>
    rows.map(f).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;

  const lastVerifiedIngest = maxOf((r) => (r.discovered_at as string) ?? null);
  const lastDataAdvance = maxOf((r) => (r.updated_at as string) ?? null);
  const lastSourceAdvance = maxOf((r) => (r.publication_date as string) ?? null);

  if (heldPopulation > 0 && !lastVerifiedIngest) {
    console.error('[seed] corpus holds rows but no ingest timestamp — refusing to guess.');
    process.exit(1);
  }

  const catalogRow = {
    key: SOURCE_KEY,
    name: 'Mindy Institute — Federal Legislation',
    category: 'built_curated',
    built_from: 'api.congress.gov (bill list + text versions + committee reports)',
    refresh_cadence: 'weekly',
    is_active: true,
    // last_built reflects the REAL last complete ingest, not today's date.
    last_built: lastVerifiedIngest ? lastVerifiedIngest.slice(0, 10) : null,
    notes:
      'Mindy Institute — federal legislative corpus (NDAA and future authorization/appropriation measures).\n'
      + 'Source: https://api.congress.gov/v3 (api.data.gov key; distinct from govinfo.gov).\n\n'
      + 'Discovery is DYNAMIC + WATERMARKED: /bill/{congress} is scanned over a fromDateTime-bounded window and\n'
      + "completeness is MEASURED against the API's own pagination.count. A page/time ceiling yields coverage=partial\n"
      + 'and the cursor does NOT advance. Known measures are additionally tracked BY IDENTITY, so a bill stays tracked\n'
      + 'after thousands of unrelated bills push it out of the recent-update window.\n\n'
      + 'ONE INSTITUTE ROW PER LEGISLATIVE VERSION — House introduced/reported/engrossed, Senate versions, committee\n'
      + 'reports (incl. errata as their own identity), conference text and enacted law never collapse into one record.\n\n'
      + '[control-plane] Authority: data_source_instances.source_key=institute_legislation (dataset strategic_intelligence).\n'
      + 'Notes sentinels (legislation-ingest-clocks / legislation-discovery-cursor) are written by\n'
      + '/api/cron/institute-legislation-sync on a COMPLETE pass. Not seeded here — seeding a cursor would assert\n'
      + 'coverage this script never performed.\n\n'
      + 'Cron: /api/cron/institute-legislation-sync — NOT YET ENABLED (Gate 5).',
  };

  const instanceRow = {
    dataset_key: 'strategic_intelligence',
    source_key: SOURCE_KEY,
    name: 'Congress API → Institute legislative sources (versions + committee reports)',
    discovery_url: 'https://api.congress.gov/v3/bill',
    ingest_mode: 'automated',
    owner: 'data-core',
    // Congress is not a daily publisher; the clocks are recess-tolerant by design.
    watch_cadence_days: 7,
    last_poll: lastVerifiedIngest,
    last_successful_check: lastVerifiedIngest,
    last_verified_ingest: lastVerifiedIngest,
    last_data_advance: lastDataAdvance,
    // GOVERNMENT time — the newest publication date we actually hold, never now().
    last_source_advance: lastSourceAdvance,
    held_population: heldPopulation,
    upstream_population: null,      // not asserted: we never counted the upstream universe
    source_state: 'current',
    intervention_state: 'none_required',
    runbook_path: 'docs/runbooks/institute-legislation.md',
  };

  console.log('=== MEASURED corpus state (what the registration must reflect) ===');
  console.log(`  held_population      : ${heldPopulation}`);
  console.log(`  last_verified_ingest : ${lastVerifiedIngest}`);
  console.log(`  last_data_advance    : ${lastDataAdvance}`);
  console.log(`  last_source_advance  : ${lastSourceAdvance}  (government publication date)`);
  console.log('\n=== data_sources row ===');
  console.log(JSON.stringify({ ...catalogRow, notes: '<see script>' }, null, 2));
  console.log('\n=== data_source_instances row ===');
  console.log(JSON.stringify(instanceRow, null, 2));

  const { data: existingCatalog } = await db.from('data_sources')
    // unranged-ok: single row by unique key.
    .select('key').eq('key', SOURCE_KEY).maybeSingle();
  const { data: existingInstance } = await db.from('data_source_instances')
    // unranged-ok: single row by unique key.
    .select('source_key').eq('source_key', SOURCE_KEY).maybeSingle();

  console.log(`\n  data_sources row exists          : ${Boolean(existingCatalog)}`);
  console.log(`  data_source_instances row exists : ${Boolean(existingInstance)}`);

  if (!GO) {
    console.log('\n[seed] DRY RUN — nothing written. Re-run with --go to apply.');
    return;
  }

  if (!existingCatalog) {
    const { error } = await db.from('data_sources').insert(catalogRow);
    if (error) { console.error('[seed] data_sources insert failed:', error.message); process.exit(1); }
    console.log('[seed] inserted data_sources[institute_legislation]');
  } else {
    console.log('[seed] data_sources row already present — left untouched (it owns the clocks).');
  }

  if (!existingInstance) {
    const { error } = await db.from('data_source_instances').insert(instanceRow);
    if (error) { console.error('[seed] data_source_instances insert failed:', error.message); process.exit(1); }
    console.log('[seed] inserted data_source_instances[institute_legislation]');
  } else {
    console.log('[seed] data_source_instances row already present — left untouched.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
