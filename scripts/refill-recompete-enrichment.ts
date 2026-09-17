/**
 * MINDY-007 Phase 2 — refill currently-null/blank PSC + description from BQ
 * award_detail_lookup. UPDATE existing recompete_opportunities rows only.
 *
 * Never INSERT. Never overwrite a stored non-null. BQ-unavailable rows are
 * not written. Stamp repair is a separate step after the fill reconciles.
 *
 *   npx tsx --env-file=.env.local scripts/refill-recompete-enrichment.ts
 *   npx tsx --env-file=.env.local scripts/refill-recompete-enrichment.ts --go
 *   npx tsx --env-file=.env.local scripts/refill-recompete-enrichment.ts --stamp-repair --go
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { bqQuery, BQ_TABLES, bqJobOptions } from '../src/lib/bigquery/client';
import { stripNul } from '../src/lib/recompete/detail-enrich';

const GO = process.argv.includes('--go');
const STAMP_ONLY = process.argv.includes('--stamp-repair');

const BASELINE = {
  recoverableBoth: 98487,
  pscOnly: 5,
  descOnlyMixed: 16,
  attempted: 98508,
  unavailable: 38002,
  total: 140879,
} as const;

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
const INSERT_CHUNK = 500;
const BQ_LABELS = bqJobOptions({
  feature: 'recompete',
  tool: 'refill-recompete-enrichment',
  queryFamily: 'mindy007_refill',
});

function present(value: string | null | undefined): string | null {
  return stripNul(value);
}

function fail(msg: string): never {
  console.error('REFILL FAILED:', msg);
  process.exit(1);
}

async function countOrThrow(
  label: string,
  q: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await q;
  if (error) fail(`${label} count failed: ${error.message}`);
  if (count == null) fail(`${label} count is unknown (null) — not zero`);
  return count;
}

const base = () =>
  sb.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true }).is('quality_flag', null);

async function snapshotCounts() {
  const total = await countOrThrow('total', base());
  const pscNull = await countOrThrow('psc-null', base().is('psc_code', null));
  const descNull = await countOrThrow('desc-null', base().is('description', null));
  const bothNull = await countOrThrow('both-null', base().is('psc_code', null).is('description', null));
  const pscPresent = await countOrThrow('psc-present', base().not('psc_code', 'is', null));
  const descPresent = await countOrThrow('desc-present', base().not('description', 'is', null));
  const mixedDescNull = await countOrThrow(
    'mixed-desc-null',
    base().is('description', null).not('psc_code', 'is', null),
  );
  const stampedBothNull = await countOrThrow(
    'stamped-both-null',
    base().not('detail_checked_at', 'is', null).is('psc_code', null).is('description', null),
  );
  const unstampedBothNull = await countOrThrow(
    'unstamped-both-null',
    base().is('detail_checked_at', null).is('psc_code', null).is('description', null),
  );
  return {
    total,
    pscNull,
    descNull,
    bothNull,
    pscPresent,
    descPresent,
    mixedDescNull,
    stampedBothNull,
    unstampedBothNull,
  };
}

type Candidate = { contract_id: string; piid: string | null; storedPsc: boolean; storedDesc: boolean };

async function pageCandidates(): Promise<Candidate[]> {
  const rows: Candidate[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('recompete_opportunities')
      .select('contract_id,piid,psc_code,description')
      .is('quality_flag', null)
      .or('psc_code.is.null,description.is.null')
      .not('contract_id', 'is', null)
      .order('contract_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) fail(`candidate page at ${from} failed: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      rows.push({
        contract_id: String(r.contract_id),
        piid: r.piid ? String(r.piid) : null,
        storedPsc: present(r.psc_code as string | null) != null,
        storedDesc: present(r.description as string | null) != null,
      });
    }
    if (data.length < PAGE) break;
  }
  return rows;
}

async function pageEnrichedSnapshot(): Promise<Map<string, { psc: string | null; desc: string | null }>> {
  const out = new Map<string, { psc: string | null; desc: string | null }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('recompete_opportunities')
      .select('contract_id,psc_code,description')
      .is('quality_flag', null)
      .or('psc_code.not.is.null,description.not.is.null')
      .order('contract_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) fail(`enriched snapshot page at ${from} failed: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      out.set(String(r.contract_id), {
        psc: present(r.psc_code as string | null),
        desc: present(r.description as string | null),
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
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

type Planned = {
  contract_id: string;
  psc_code: string | null;
  description: string | null;
  kind: 'both' | 'psc-only' | 'desc-only';
};

async function planWrites(candidates: Candidate[]): Promise<{
  planned: Planned[];
  recoverableBoth: number;
  pscOnly: number;
  descOnly: number;
  unavailable: number;
  duplicates: number;
}> {
  const byId = new Map(candidates.map((r) => [r.contract_id, r]));
  const ids = candidates.map((r) => r.contract_id);
  console.log(`Hashing ${ids.length} candidate contract_ids…`);
  const idBuckets = await bucketsFor(ids);
  const hits = new Map<string, { psc: string | null; desc: string | null }>();
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
  const missPiids = misses
    .map((id) => (byId.get(id)?.piid || '').trim().toUpperCase())
    .filter((p) => p.length >= 3 && p.length <= 40 && /^[A-Z0-9_-]+$/.test(p));
  const uniquePiids = [...new Set(missPiids)];
  if (uniquePiids.length) {
    console.log(`PIID fallback for ${uniquePiids.length} unique PIIDs…`);
    const piidBuckets = await bucketsFor(uniquePiids);
    const piidToAward = new Map<string, string>();
    await mapPool([...piidBuckets.entries()], BUCKET_CONCURRENCY, async ([bucket, piids]) => {
      const rows = await lookupPiidAwardIds(piids, bucket);
      for (const row of rows) piidToAward.set(row.piid_upper, row.award_id);
    });
    const resolvedAwardIds = [...new Set([...piidToAward.values()])];
    if (resolvedAwardIds.length) {
      const awardBuckets = await bucketsFor(resolvedAwardIds);
      const awardHits = new Map<string, { psc: string | null; desc: string | null }>();
      await mapPool([...awardBuckets.entries()], BUCKET_CONCURRENCY, async ([bucket, awardIds]) => {
        const rows = await lookupDetail(awardIds, bucket);
        for (const row of rows) {
          awardHits.set(row.contract_id, { psc: present(row.psc_code), desc: present(row.description) });
        }
      });
      for (const id of misses) {
        const piid = (byId.get(id)?.piid || '').trim().toUpperCase();
        const awardId = piidToAward.get(piid);
        if (!awardId) continue;
        const hit = awardHits.get(awardId);
        if (!hit) continue;
        const existing = hits.get(id) ?? { psc: null, desc: null };
        hits.set(id, { psc: existing.psc ?? hit.psc, desc: existing.desc ?? hit.desc });
      }
    }
  }

  const planned: Planned[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let recoverableBoth = 0;
  let pscOnly = 0;
  let descOnly = 0;
  let unavailable = 0;

  for (const row of candidates) {
    const hit = hits.get(row.contract_id) ?? { psc: null, desc: null };
    const fillPsc = !row.storedPsc && hit.psc != null;
    const fillDesc = !row.storedDesc && hit.desc != null;
    if (!fillPsc && !fillDesc) {
      if (!row.storedPsc && !row.storedDesc && !hit.psc && !hit.desc) unavailable++;
      continue;
    }
    if (seen.has(row.contract_id)) {
      duplicates++;
      continue;
    }
    seen.add(row.contract_id);
    let kind: Planned['kind'];
    if (fillPsc && fillDesc) {
      kind = 'both';
      recoverableBoth++;
    } else if (fillPsc) {
      kind = 'psc-only';
      pscOnly++;
    } else {
      kind = 'desc-only';
      descOnly++;
    }
    planned.push({
      contract_id: row.contract_id,
      psc_code: fillPsc ? hit.psc : null,
      description: fillDesc ? hit.desc : null,
      kind,
    });
  }

  return { planned, recoverableBoth, pscOnly, descOnly, unavailable, duplicates };
}

async function applyUpdates(planned: Planned[]): Promise<{
  updated: number;
  failedIds: string[];
  total: number;
  pscPresent: number;
  descPresent: number;
  bothNull: number;
}> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail('Missing DATABASE_URL');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const empty = { total: 0, pscPresent: 0, descPresent: 0, bothNull: 0 };
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15min'");
    await client.query("SET LOCAL lock_timeout = '2min'");
    await client.query('LOCK TABLE recompete_opportunities IN SHARE ROW EXCLUSIVE MODE');
    await client.query(`
      CREATE TEMP TABLE refill_batch (
        contract_id text PRIMARY KEY,
        psc_code text,
        description text
      ) ON COMMIT DROP
    `);
    for (let i = 0; i < planned.length; i += INSERT_CHUNK) {
      const chunk = planned.slice(i, i + INSERT_CHUNK);
      const ids = chunk.map((r) => r.contract_id);
      const pscs = chunk.map((r) => r.psc_code);
      const descs = chunk.map((r) => r.description);
      await client.query(
        `INSERT INTO refill_batch (contract_id, psc_code, description)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])`,
        [ids, pscs, descs],
      );
    }
    const updated = await client.query<{ contract_id: string }>(`
      UPDATE recompete_opportunities r
      SET
        psc_code = CASE
          WHEN (r.psc_code IS NULL OR btrim(r.psc_code) = '')
           AND NULLIF(btrim(COALESCE(b.psc_code, '')), '') IS NOT NULL
          THEN b.psc_code
          ELSE r.psc_code
        END,
        description = CASE
          WHEN (r.description IS NULL OR btrim(r.description) = '')
           AND NULLIF(btrim(COALESCE(b.description, '')), '') IS NOT NULL
          THEN b.description
          ELSE r.description
        END
      FROM refill_batch b
      WHERE r.contract_id = b.contract_id
        AND r.quality_flag IS NULL
        AND (
          ((r.psc_code IS NULL OR btrim(r.psc_code) = '')
            AND NULLIF(btrim(COALESCE(b.psc_code, '')), '') IS NOT NULL)
          OR
          ((r.description IS NULL OR btrim(r.description) = '')
            AND NULLIF(btrim(COALESCE(b.description, '')), '') IS NOT NULL)
        )
      RETURNING r.contract_id
    `);
    const updatedIds = new Set(updated.rows.map((r) => r.contract_id));
    const failedIds = planned.map((p) => p.contract_id).filter((id) => !updatedIds.has(id));
    if (failedIds.length) {
      await client.query('ROLLBACK');
      return { updated: updated.rowCount ?? 0, failedIds, ...empty };
    }
    const counts = await client.query<{
      total: string;
      psc_present: string;
      desc_present: string;
      both_null: string;
    }>(`
      SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE psc_code IS NOT NULL)::text AS psc_present,
        count(*) FILTER (WHERE description IS NOT NULL)::text AS desc_present,
        count(*) FILTER (WHERE psc_code IS NULL AND description IS NULL)::text AS both_null
      FROM recompete_opportunities
      WHERE quality_flag IS NULL
    `);
    const row = counts.rows[0];
    await client.query('COMMIT');
    return {
      updated: updated.rowCount ?? updatedIds.size,
      failedIds: [],
      total: Number(row.total),
      pscPresent: Number(row.psc_present),
      descPresent: Number(row.desc_present),
      bothNull: Number(row.both_null),
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

async function stampRepair(): Promise<{ cleared: number }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail('Missing DATABASE_URL');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const res = await client.query(`
      UPDATE recompete_opportunities
      SET detail_checked_at = NULL
      WHERE quality_flag IS NULL
        AND psc_code IS NULL
        AND description IS NULL
        AND detail_checked_at IS NOT NULL
    `);
    return { cleared: res.rowCount ?? 0 };
  } finally {
    await client.end();
  }
}

async function assertNoOverwrite(before: Map<string, { psc: string | null; desc: string | null }>): Promise<number> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail('Missing DATABASE_URL');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let overwritten = 0;
  try {
    const ids = [...before.keys()];
    for (let i = 0; i < ids.length; i += PAGE) {
      const slice = ids.slice(i, i + PAGE);
      const { rows } = await client.query<{ contract_id: string; psc_code: string | null; description: string | null }>(
        `SELECT contract_id, psc_code, description
         FROM recompete_opportunities
         WHERE contract_id = ANY($1::text[])`,
        [slice],
      );
      const got = new Map(rows.map((r) => [r.contract_id, r]));
      for (const id of slice) {
        const prev = before.get(id)!;
        const row = got.get(id);
        if (!row) fail(`enriched row disappeared: ${id}`);
        const nowPsc = present(row.psc_code);
        const nowDesc = present(row.description);
        if (prev.psc != null && nowPsc !== prev.psc) {
          console.error(`OVERWRITE psc ${id}: ${prev.psc} → ${nowPsc}`);
          overwritten++;
        }
        if (prev.desc != null && nowDesc !== prev.desc) {
          console.error(`OVERWRITE desc ${id}: ${prev.desc.slice(0, 40)} → ${String(nowDesc).slice(0, 40)}`);
          overwritten++;
        }
      }
    }
  } finally {
    await client.end();
  }
  return overwritten;
}

async function main() {
  if (STAMP_ONLY) {
    if (!GO) {
      const c = await snapshotCounts();
      console.log('stamp-repair dry run — would clear detail_checked_at on stamped both-null rows', c);
      return;
    }
    const before = await snapshotCounts();
    const { cleared } = await stampRepair();
    const after = await snapshotCounts();
    console.log('stamp-repair', { cleared, before, after });
    return;
  }

  const before = await snapshotCounts();
  console.log('pre-write snapshot', before);
  const totalDelta = before.total - BASELINE.total;
  const bothNullDelta = before.bothNull - (BASELINE.unavailable + BASELINE.recoverableBoth + BASELINE.pscOnly);
  console.log('drift vs Sep 17 census', {
    total: `${BASELINE.total} → ${before.total} (${totalDelta >= 0 ? '+' : ''}${totalDelta})`,
    bothNull: `${BASELINE.unavailable + BASELINE.recoverableBoth + BASELINE.pscOnly} → ${before.bothNull} (${bothNullDelta >= 0 ? '+' : ''}${bothNullDelta})`,
    pscPresent: before.pscPresent,
    descPresent: before.descPresent,
    mixedDescNull: before.mixedDescNull,
    unstampedBothNull: before.unstampedBothNull,
  });
  if (before.pscPresent < 4385 || before.descPresent < 4369) {
    fail('existing non-null enrichment shrank before write — stopping');
  }
  if (before.mixedDescNull !== BASELINE.descOnlyMixed) {
    fail(`mixed desc-null ${before.mixedDescNull} != baseline ${BASELINE.descOnlyMixed}`);
  }
  if (Math.abs(totalDelta) > 50) {
    fail(`table total drift ${totalDelta} is larger than an hourly-sync trickle — stopping`);
  }

  const candidates = await pageCandidates();
  const bothNullCandidates = candidates.filter((c) => !c.storedPsc && !c.storedDesc);
  const mixedDesc = candidates.filter((c) => c.storedPsc && !c.storedDesc);
  console.log(`candidates: ${candidates.length} (both-null ${bothNullCandidates.length}, mixed-desc ${mixedDesc.length})`);
  if (Math.abs(bothNullCandidates.length - before.bothNull) > 50) {
    fail(`paged both-null ${bothNullCandidates.length} drifted from count ${before.bothNull}`);
  }
  if (mixedDesc.length !== before.mixedDescNull) {
    fail(`paged mixed ${mixedDesc.length} != count ${before.mixedDescNull}`);
  }

  const plan = await planWrites(candidates);
  console.log('write plan', {
    recoverableBoth: plan.recoverableBoth,
    pscOnly: plan.pscOnly,
    descOnly: plan.descOnly,
    unavailable: plan.unavailable,
    planned: plan.planned.length,
    duplicates: plan.duplicates,
  });

  if (plan.duplicates !== 0) fail(`duplicate contract_ids in plan: ${plan.duplicates}`);
  if (plan.recoverableBoth < BASELINE.recoverableBoth) {
    fail(`recoverable both shrank ${plan.recoverableBoth} < baseline ${BASELINE.recoverableBoth}`);
  }
  if (plan.pscOnly < BASELINE.pscOnly) {
    fail(`psc-only shrank ${plan.pscOnly} < baseline ${BASELINE.pscOnly}`);
  }
  if (plan.descOnly !== BASELINE.descOnlyMixed) {
    fail(`desc-only ${plan.descOnly} != baseline mixed ${BASELINE.descOnlyMixed}`);
  }
  const extraBoth = plan.recoverableBoth - BASELINE.recoverableBoth;
  const extraPscOnly = plan.pscOnly - BASELINE.pscOnly;
  const extraUnavailable = plan.unavailable - BASELINE.unavailable;
  console.log('plan vs Sep 17 baseline (new hourly-sync rows may add to the write set)', {
    extraBoth,
    extraPscOnly,
    extraUnavailable,
    attempted: plan.planned.length,
  });

  if (!GO) {
    console.log('DRY RUN. Pass --go to UPDATE existing rows. No writes.');
    return;
  }

  const enrichedBefore = await pageEnrichedSnapshot();
  console.log(`enriched snapshot: ${enrichedBefore.size} rows with any non-null PSC/description`);

  const applied = await applyUpdates(plan.planned);
  if (applied.failedIds.length) {
    console.error(`failed ids (first 20): ${applied.failedIds.slice(0, 20).join(', ')}`);
    fail(`zero-failure contract: ${applied.failedIds.length} planned rows did not UPDATE. Rolled back.`);
  }
  const { updated, failedIds } = applied;

  const after = await snapshotCounts();
  const overwritten = await assertNoOverwrite(enrichedBefore);
  const newRowsFromThisWrite = 0;

  console.log('\n════════════════════════════════════════');
  console.log('MINDY-007 REFILL RECONCILE');
  console.log('════════════════════════════════════════');
  console.log(`attempted                 : ${plan.planned.length}`);
  console.log(`updated                   : ${updated}`);
  console.log(`failed                    : ${failedIds.length}`);
  console.log(`PSC present               : ${before.pscPresent} → ${applied.pscPresent} (post-commit ${after.pscPresent})`);
  console.log(`description present       : ${before.descPresent} → ${applied.descPresent} (post-commit ${after.descPresent})`);
  console.log(`both-null                 : ${before.bothNull} → ${applied.bothNull} (post-commit ${after.bothNull})`);
  console.log(`table rows                : ${before.total} → ${applied.total} (post-commit ${after.total})`);
  console.log(`duplicates                : ${plan.duplicates}`);
  console.log(`non-null overwritten      : ${overwritten}`);
  console.log(`new rows from this write  : ${newRowsFromThisWrite}`);

  if (applied.total < before.total) fail(`table row count fell ${before.total} → ${applied.total}`);
  if (overwritten !== 0) fail(`${overwritten} existing non-null values overwritten`);
  if (updated !== plan.planned.length) fail(`updated ${updated} != attempted ${plan.planned.length}`);

  const expectedPsc = before.pscPresent + plan.recoverableBoth + plan.pscOnly;
  const expectedDesc = before.descPresent + plan.recoverableBoth + plan.descOnly;
  if (applied.pscPresent < expectedPsc) fail(`psc present ${applied.pscPresent} < expected ${expectedPsc}`);
  if (applied.descPresent < expectedDesc) fail(`desc present ${applied.descPresent} < expected ${expectedDesc}`);
  if (applied.bothNull > before.bothNull - plan.recoverableBoth - plan.pscOnly) {
    fail(`both-null ${applied.bothNull} did not drop by the filled both-null count`);
  }

  console.log('\nFill reconciled. Running stamp repair…');
  const { cleared } = await stampRepair();
  const afterStamp = await snapshotCounts();
  console.log('stamp repair', {
    cleared,
    remainingBothNull: afterStamp.bothNull,
    stampedBothNull: afterStamp.stampedBothNull,
    usaspendingQueue: afterStamp.unstampedBothNull,
  });
  if (afterStamp.stampedBothNull !== 0) {
    fail(`stamped both-null remaining ${afterStamp.stampedBothNull} — expected 0 after clear`);
  }
  if (afterStamp.unstampedBothNull !== afterStamp.bothNull) {
    fail(`queue ${afterStamp.unstampedBothNull} != remaining both-null ${afterStamp.bothNull}`);
  }
  console.log(`✓ stamps cleared on remaining both-null; never-stamped rows left as-is (queue=${afterStamp.unstampedBothNull})`);
}

main().catch((e) => {
  console.error('REFILL FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
