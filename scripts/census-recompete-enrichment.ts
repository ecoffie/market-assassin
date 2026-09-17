/**
 * MINDY-007 read-only census: currently-null recompete enrichment vs BQ award_detail_lookup.
 *
 * Exact join. Does NOT extrapolate a sample. Does NOT write recompete_opportunities.
 *
 * Population: quality_flag IS NULL AND psc_code IS NULL AND description IS NULL.
 * (The wiped set from the hourly spending_by_award upsert — both fields go null together.)
 *
 * Join: hash-bucket prune on award_detail_lookup (bucket = FARM_FINGERPRINT(award_id) mod 1024).
 * Misses retry via piid_lookup → award_id, then the same partitioned detail table.
 *
 *   npx tsx --env-file=.env.local scripts/census-recompete-enrichment.ts
 *
 * Refuses --apply / --go / any write flag. After this printout: STOP and ask before bulk refill.
 *
 * detail_checked_at: a stamp on a currently-null row is NOT "source empty." The hourly sync
 * left the stamp in place while overwriting the fills. Do not reset the stamp in this script.
 * Reset/reinterpret only as part of an approved refill (BQ fill for recoverable rows;
 * stamp-clear on remaining stamped-null so enrich-recompete-detail can re-ask USASpending).
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import { bqQuery, BQ_TABLES, bqJobOptions } from '../src/lib/bigquery/client';

const WRITE_FLAGS = ['--apply', '--go', '--write', '--execute', '--refill'];
if (process.argv.some((a) => WRITE_FLAGS.includes(a))) {
  console.error('CENSUS IS READ-ONLY. Refusing write flags. Stop and request approval for any refill.');
  process.exit(2);
}

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/\\n$/, '').trim();
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key);

const PAGE = 1000;
const HASH_CHUNK = 5000;
const BUCKET_CONCURRENCY = 16;
const BQ_LABELS = bqJobOptions({
  feature: 'recompete',
  tool: 'census-recompete-enrichment',
  queryFamily: 'mindy007_census',
});

function present(value: string | null | undefined): boolean {
  return String(value || '').trim().length > 0;
}

async function countOrThrow(
  label: string,
  q: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await q;
  if (error) throw new Error(`${label} count failed: ${error.message}`);
  if (count == null) throw new Error(`${label} count is unknown (null) — not zero`);
  return count;
}

async function pageNullRows(): Promise<{ contract_id: string; piid: string | null }[]> {
  const rows: { contract_id: string; piid: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('recompete_opportunities')
      .select('contract_id,piid')
      .is('quality_flag', null)
      .is('psc_code', null)
      .is('description', null)
      .not('contract_id', 'is', null)
      .order('contract_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`null-row page at ${from} failed: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      rows.push({ contract_id: String(r.contract_id), piid: r.piid ? String(r.piid) : null });
    }
    if (data.length < PAGE) break;
  }
  return rows;
}

async function bucketsFor(ids: string[]): Promise<Map<number, string[]>> {
  const byBucket = new Map<number, string[]>();
  for (let i = 0; i < ids.length; i += HASH_CHUNK) {
    const slice = ids.slice(i, i + HASH_CHUNK);
    const hashed = await bqQuery<{ contract_id: string; bucket: number }>({
      query: `
        SELECT contract_id, MOD(MOD(FARM_FINGERPRINT(contract_id), 1024) + 1024, 1024) AS bucket
        FROM UNNEST(@ids) AS contract_id
      `,
      params: { ids: slice },
      ...BQ_LABELS,
      maximumBytesBilled: String(32 * 1024 * 1024),
    });
    for (const row of hashed) {
      const bucket = Number(row.bucket);
      const list = byBucket.get(bucket) ?? [];
      list.push(row.contract_id);
      byBucket.set(bucket, list);
    }
  }
  return byBucket;
}

type DetailHit = { contract_id: string; psc_code: string | null; description: string | null };

async function lookupDetail(ids: string[], bucket: number): Promise<DetailHit[]> {
  if (!ids.length) return [];
  return bqQuery<DetailHit>({
    query: `
      SELECT
        i AS contract_id,
        d.psc_code,
        d.description
      FROM UNNEST(@ids) AS i
      LEFT JOIN ${BQ_TABLES.awardDetailLookup} d
        ON d.award_id = i
       AND d.bucket = @bucket
    `,
    params: { ids, bucket },
    ...BQ_LABELS,
    // One partition of award_detail_lookup is ~10–25 MB; 100 MiB is the same
    // ceiling the per-id lookup uses. A prune miss would trip this instead of
    // scanning 27 GB.
    maximumBytesBilled: String(100 * 1024 * 1024),
  });
}

async function lookupPiidAwardIds(piids: string[], bucket: number): Promise<{ piid_upper: string; award_id: string }[]> {
  if (!piids.length) return [];
  return bqQuery<{ piid_upper: string; award_id: string }>({
    query: `
      SELECT p.piid_upper, p.award_id
      FROM UNNEST(@piids) AS piid
      JOIN ${BQ_TABLES.piidLookup} p
        ON p.piid_upper = piid
       AND p.bucket = @bucket
    `,
    params: { piids, bucket },
    ...BQ_LABELS,
    maximumBytesBilled: String(100 * 1024 * 1024),
  });
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

async function main() {
  console.log('MINDY-007 census — READ ONLY. No recompete_opportunities writes.\n');

  const base = () =>
    sb.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true }).is('quality_flag', null);

  const total = await countOrThrow('total', base());
  const pscNull = await countOrThrow('psc-null', base().is('psc_code', null));
  const descNull = await countOrThrow('desc-null', base().is('description', null));
  const bothNull = await countOrThrow('both-null', base().is('psc_code', null).is('description', null));
  const pscNullDescPresent = await countOrThrow(
    'psc-null-desc-present',
    base().is('psc_code', null).not('description', 'is', null),
  );
  const descNullPscPresent = await countOrThrow(
    'desc-null-psc-present',
    base().is('description', null).not('psc_code', 'is', null),
  );
  const stamped = await countOrThrow('stamped', base().not('detail_checked_at', 'is', null));
  const stampedBothNull = await countOrThrow(
    'stamped-both-null',
    base().not('detail_checked_at', 'is', null).is('psc_code', null).is('description', null),
  );
  const stampedPscNull = await countOrThrow(
    'stamped-psc-null',
    base().not('detail_checked_at', 'is', null).is('psc_code', null),
  );
  const stampedDescNull = await countOrThrow(
    'stamped-desc-null',
    base().not('detail_checked_at', 'is', null).is('description', null),
  );

  if (pscNull !== bothNull + pscNullDescPresent) {
    throw new Error(
      `psc-null arithmetic failed: pscNull=${pscNull} both=${bothNull} psc-only-null=${pscNullDescPresent}`,
    );
  }
  if (descNull !== bothNull + descNullPscPresent) {
    throw new Error(
      `desc-null arithmetic failed: descNull=${descNull} both=${bothNull} desc-only-null=${descNullPscPresent}`,
    );
  }

  console.log('Supabase recompete_opportunities (quality_flag IS NULL)');
  console.log(`  total rows              : ${total}`);
  console.log(`  psc_code NULL           : ${pscNull}`);
  console.log(`  description NULL        : ${descNull}`);
  console.log(`  both NULL (census pop.) : ${bothNull}`);
  console.log(`  PSC null, desc present  : ${pscNullDescPresent}`);
  console.log(`  desc null, PSC present  : ${descNullPscPresent}`);
  console.log(`  detail_checked_at set   : ${stamped}`);
  console.log(`  stamped AND both NULL   : ${stampedBothNull}`);
  console.log(`  stamped AND psc NULL    : ${stampedPscNull}`);
  console.log(`  stamped AND desc NULL   : ${stampedDescNull}`);
  console.log('');

  if (bothNull !== stampedBothNull) {
    console.log(
      `  note: ${bothNull - stampedBothNull} both-null rows have no stamp (enrich queue still sees them).`,
    );
  }

  console.log('Paging census population (both NULL)…');
  const nullRows = await pageNullRows();
  if (nullRows.length !== bothNull) {
    throw new Error(
      `paged ${nullRows.length} both-null rows but count was ${bothNull} — refusing to census a truncated set`,
    );
  }
  const byId = new Map(nullRows.map((r) => [r.contract_id, r.piid]));
  const ids = nullRows.map((r) => r.contract_id);
  console.log(`  paged ${ids.length} contract_id values\n`);

  console.log('Hashing award_id buckets (BQ FARM_FINGERPRINT, no detail-table scan)…');
  const idBuckets = await bucketsFor(ids);
  console.log(`  ${idBuckets.size} occupied buckets of 1024\n`);

  const hits = new Map<string, { psc: boolean; desc: boolean }>();
  const bucketList = [...idBuckets.entries()];
  let doneBuckets = 0;
  await mapPool(bucketList, BUCKET_CONCURRENCY, async ([bucket, bucketIds]) => {
    const rows = await lookupDetail(bucketIds, bucket);
    for (const row of rows) {
      hits.set(row.contract_id, { psc: present(row.psc_code), desc: present(row.description) });
    }
    doneBuckets++;
    if (doneBuckets % 64 === 0 || doneBuckets === bucketList.length) {
      console.log(`  award_id lookup ${doneBuckets}/${bucketList.length} buckets`);
    }
  });

  const misses = ids.filter((id) => {
    const hit = hits.get(id);
    return !hit || (!hit.psc && !hit.desc);
  });
  console.log(`\n  award_id misses (no PSC and no description, including no row): ${misses.length}`);

  // PIID fallback only for genuine award_id misses. Exact, not sampled.
  const missPiids = misses
    .map((id) => (byId.get(id) || '').trim().toUpperCase())
    .filter((p) => p.length >= 3 && p.length <= 40 && /^[A-Z0-9_-]+$/.test(p));
  const uniquePiids = [...new Set(missPiids)];
  if (uniquePiids.length) {
    console.log(`\nPIID fallback for ${uniquePiids.length} unique PIIDs on award_id misses…`);
    const piidBuckets = await bucketsFor(uniquePiids);
    const piidToAward = new Map<string, string>();
    await mapPool([...piidBuckets.entries()], BUCKET_CONCURRENCY, async ([bucket, piids]) => {
      const rows = await lookupPiidAwardIds(piids, bucket);
      for (const row of rows) piidToAward.set(row.piid_upper, row.award_id);
    });
    const resolvedAwardIds = [...new Set([...piidToAward.values()])];
    console.log(`  piid_lookup resolved ${piidToAward.size} PIIDs → ${resolvedAwardIds.length} award_ids`);
    if (resolvedAwardIds.length) {
      const awardBuckets = await bucketsFor(resolvedAwardIds);
      const awardHits = new Map<string, { psc: boolean; desc: boolean }>();
      await mapPool([...awardBuckets.entries()], BUCKET_CONCURRENCY, async ([bucket, awardIds]) => {
        const rows = await lookupDetail(awardIds, bucket);
        for (const row of rows) {
          awardHits.set(row.contract_id, { psc: present(row.psc_code), desc: present(row.description) });
        }
      });
      for (const id of misses) {
        const piid = (byId.get(id) || '').trim().toUpperCase();
        const awardId = piidToAward.get(piid);
        if (!awardId) continue;
        const hit = awardHits.get(awardId);
        if (!hit) continue;
        const existing = hits.get(id) ?? { psc: false, desc: false };
        hits.set(id, { psc: existing.psc || hit.psc, desc: existing.desc || hit.desc });
      }
    }
  }

  let recoverablePsc = 0;
  let recoverableDesc = 0;
  let recoverableBoth = 0;
  let genuinelyUnavailable = 0;
  for (const id of ids) {
    const hit = hits.get(id) ?? { psc: false, desc: false };
    if (hit.psc) recoverablePsc++;
    if (hit.desc) recoverableDesc++;
    if (hit.psc && hit.desc) recoverableBoth++;
    if (!hit.psc && !hit.desc) genuinelyUnavailable++;
  }

  const pscOnly = recoverablePsc - recoverableBoth;
  const descOnly = recoverableDesc - recoverableBoth;
  const partitioned = pscOnly + descOnly + recoverableBoth + genuinelyUnavailable;
  if (partitioned !== ids.length) {
    throw new Error(
      `census arithmetic failed: pscOnly=${pscOnly} descOnly=${descOnly} both=${recoverableBoth} none=${genuinelyUnavailable} sum=${partitioned} pop=${ids.length}`,
    );
  }

  console.log('\n════════════════════════════════════════');
  console.log('MINDY-007 CENSUS (exact, not a sample)');
  console.log('════════════════════════════════════════');
  console.log(`null rows (both PSC+description NULL) : ${ids.length}`);
  console.log(`BQ recoverable PSC                    : ${recoverablePsc}`);
  console.log(`BQ recoverable description            : ${recoverableDesc}`);
  console.log(`BQ recoverable both                   : ${recoverableBoth}`);
  console.log(`genuinely unavailable in BQ lookup    : ${genuinelyUnavailable}`);
  console.log('────────────────────────────────────────');
  console.log(`psc-only (no description)             : ${pscOnly}`);
  console.log(`description-only (no PSC)             : ${descOnly}`);

  // Mixed rows (description NULL, PSC already present) are outside the both-null
  // universe. Census them exactly — do not extrapolate.
  let mixedDescRecoverable = 0;
  if (descNullPscPresent > 0) {
    const mixed: { contract_id: string; piid: string | null }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from('recompete_opportunities')
        .select('contract_id,piid')
        .is('quality_flag', null)
        .is('description', null)
        .not('psc_code', 'is', null)
        .order('contract_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`mixed-row page at ${from} failed: ${error.message}`);
      if (!data?.length) break;
      for (const r of data) {
        mixed.push({ contract_id: String(r.contract_id), piid: r.piid ? String(r.piid) : null });
      }
      if (data.length < PAGE) break;
    }
    if (mixed.length !== descNullPscPresent) {
      throw new Error(`paged ${mixed.length} mixed rows but count was ${descNullPscPresent}`);
    }
    const mixedBuckets = await bucketsFor(mixed.map((r) => r.contract_id));
    await mapPool([...mixedBuckets.entries()], BUCKET_CONCURRENCY, async ([bucket, bucketIds]) => {
      const rows = await lookupDetail(bucketIds, bucket);
      for (const row of rows) {
        if (present(row.description)) mixedDescRecoverable++;
      }
    });
    console.log('────────────────────────────────────────');
    console.log(`mixed (desc NULL, PSC present)        : ${descNullPscPresent}`);
    console.log(`BQ recoverable description (mixed)    : ${mixedDescRecoverable}`);
  }

  console.log('\nSTOP. No bulk write. Request approval before refill.');
  console.log(
    'detail_checked_at: do not reset in isolation. On approved refill, fill BQ-recoverable rows and clear the stamp only on remaining stamped-null so enrich can re-ask USASpending detail. A stamp on a null row is not an authoritative empty.',
  );
}

main().catch((e) => {
  console.error('CENSUS FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
