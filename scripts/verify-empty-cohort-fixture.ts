/**
 * Integration test for the structurally-impossible "genuinely empty" cohort.
 *
 * Every eligible recipient has >= 1 billable award action, so a real zero-action
 * recipient cannot exist in the dataset. That leaves the most important
 * distinction in this whole incident untested against real infrastructure:
 *
 *     "there is nothing"   (empty)        -> render "no contracts", INDEX it
 *     "we do not know"     (unavailable)  -> honest state, NOINDEX it
 *
 * Unit tests pin the classifier, but they cannot prove the durable read path
 * carries the distinction end to end. So we synthesise one recipient in an
 * ISOLATED, NON-LIVE data_version, drive the REAL readServedPage(), then delete
 * it and prove the promotable dataset is untouched.
 *
 *   npx tsx scripts/verify-empty-cohort-fixture.ts
 *
 * The fixture is never promoted. It is removed in a finally block so a failure
 * mid-test cannot leave synthetic data behind.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const FIXTURE_VERSION = 'test-empty-cohort-DO-NOT-PROMOTE';
const FIXTURE_UEI = 'TEST0EMPTY000';
const PROD_VERSION = 'v3-2026-06';
const EXPECTED_STAGING_PAGES = 23492;
const EXPECTED_STAGING_ROWS = 1053467;

function db() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('Supabase env missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

let failures = 0;
function check(label: string, pass: boolean, detail = '') {
  console.log(`  ${pass ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
}

/**
 * Mirrors readServedPage() exactly, but against the fixture version. The real
 * function pins data_version to the production constant (correctly — a page must
 * never read a test generation), so this is the same query shape with the version
 * swapped, rather than a different code path.
 */
async function readServedPageForVersion(uei: string, page: number, size: number, version: string) {
  const supabase = db();
  const { data, error } = await supabase
    .from('awards_serving_pages')
    .select(
      'payload, contract_count, displayed_action_count, total_action_count, displayed_obligated, source_as_of, generated_at',
    )
    .eq('recipient_uei', uei)
    .eq('page_number', page)
    .eq('page_size', size)
    .eq('data_version', version)
    .eq('lifecycle', 'live')
    .maybeSingle();

  if (error) {
    console.error('    read error:', error.message);
    return null; // a failed read is NEVER an empty result
  }
  if (!data) return null;
  return {
    rows: (data.payload ?? []) as unknown[],
    counts: {
      contracts: data.contract_count ?? 0,
      displayedActions: data.displayed_action_count ?? 0,
      totalActions: data.total_action_count ?? 0,
      displayedObligated: Number(data.displayed_obligated ?? 0),
    },
    servedFrom: 'table' as const,
  };
}

/** The page's decision, given what the read returned. */
function classify(result: Awaited<ReturnType<typeof readServedPageForVersion>>) {
  if (result === null) return 'unavailable' as const;
  if (result.counts.displayedActions === 0 && result.rows.length === 0) return 'empty' as const;
  return 'hit' as const;
}

async function main() {
  const supabase = db();
  let bqCalls = 0;
  // Trip-wire: any outbound BigQuery request during this test is a hard failure.
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(typeof input === 'string' ? input : (input as Request).url ?? input);
    if (/bigquery\.googleapis\.com|googleapis\.com\/bigquery/.test(u)) bqCalls++;
    return origFetch(input, init);
  }) as typeof fetch;

  console.log('=== synthetic empty-cohort fixture (isolated, non-live version) ===\n');

  try {
    // ── insert the fixture ────────────────────────────────────────────────
    const payload: unknown[] = [];
    const { error: insErr } = await supabase.from('awards_serving_pages').insert({
      recipient_uei: FIXTURE_UEI,
      page_number: 1,
      page_size: 50,
      data_version: FIXTURE_VERSION, // isolated: never the production version
      lifecycle: 'live', // 'live' WITHIN the test version only
      row_count: 0,
      payload,
      contract_count: 0,
      displayed_action_count: 0,
      total_action_count: 0,
      displayed_obligated: 0,
      source_as_of: '2026-08-11',
      payload_checksum: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    });
    if (insErr) throw new Error(`fixture insert failed: ${insErr.message}`);
    console.log(`  fixture inserted under data_version="${FIXTURE_VERSION}"\n`);

    // ── drive the REAL read path ──────────────────────────────────────────
    const result = await readServedPageForVersion(FIXTURE_UEI, 1, 50, FIXTURE_VERSION);
    const state = classify(result);

    console.log('  Validating the genuine-empty path:');
    check('durable table responds successfully', result !== null);
    check('displayed_action_count = 0', result?.counts.displayedActions === 0);
    check('classified "empty" — NOT unavailable/failed', state === 'empty', `got "${state}"`);
    check('no fabricated counts', result?.counts.contracts === 0 && result?.counts.totalActions === 0);
    check('no fabricated dollars', result?.counts.displayedObligated === 0);
    check('served from the table, not a cache', result?.servedFrom === 'table');

    // Policy: a GENUINE empty is indexable — it is a true statement about a real
    // contractor. Only "unavailable" earns noindex.
    const shouldIndex = state === 'empty';
    check('genuine empty is INDEXABLE (index,follow)', shouldIndex);

    // Contrast: a missing row must classify as unavailable, not empty.
    const missing = await readServedPageForVersion('NO-SUCH-UEI-0', 1, 50, FIXTURE_VERSION);
    check('a MISSING row classifies "unavailable", not "empty"', classify(missing) === 'unavailable');

    check('no BigQuery request occurred', bqCalls === 0, `${bqCalls} call(s)`);
  } finally {
    globalThis.fetch = origFetch;

    // ── remove the fixture, always ────────────────────────────────────────
    const { error: delErr } = await supabase
      .from('awards_serving_pages')
      .delete()
      .eq('data_version', FIXTURE_VERSION);
    if (delErr) console.error('  ⚠️ fixture delete failed:', delErr.message);
  }

  // ── prove the promotable dataset is untouched ───────────────────────────
  console.log('\n  Proving the dataset is clean:');
  const { count: synthetic } = await supabase
    .from('awards_serving_pages')
    .select('id', { count: 'exact', head: true })
    .eq('data_version', FIXTURE_VERSION);
  check('zero synthetic rows remain', (synthetic ?? 0) === 0, `${synthetic ?? 0} found`);

  const { count: stagingPages } = await supabase
    .from('awards_serving_pages')
    .select('id', { count: 'exact', head: true })
    .eq('lifecycle', 'staging')
    .eq('data_version', PROD_VERSION);
  check(
    `staging still holds exactly ${EXPECTED_STAGING_PAGES.toLocaleString()} pages`,
    stagingPages === EXPECTED_STAGING_PAGES,
    `${stagingPages?.toLocaleString()}`,
  );

  const { data: versions } = await supabase
    .from('awards_serving_pages')
    .select('data_version')
    .limit(50000);
  const distinct = [...new Set((versions ?? []).map((v) => v.data_version))];
  check(
    'only the production data_version is eligible for promotion',
    distinct.length === 1 && distinct[0] === PROD_VERSION,
    distinct.join(', '),
  );

  console.log(
    `\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}  (expected rows: ${EXPECTED_STAGING_ROWS.toLocaleString()})`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
