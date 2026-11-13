/**
 * Atomic rebuild of the award lookup tables (2026-11-13).
 *
 * /awards/[id] reads `award_detail_lookup`; /contracts/[piid] reads `piid_lookup`. Both are derived
 * from `awards` and were rebuilt by hand with build-lookup-tables.sh, which DROPs each table before
 * re-creating it — every lookup fails for the duration — and nothing ran it after the weekly
 * ingest. Measured 2026-11-13: lookups last built 2026-06-02 (newest action 2026-04-23) against a
 * warehouse at 2026-11-04, so every award since late April read as "not found".
 *
 * This rebuild:
 *   1. takes a BigQuery-native lock (CREATE TABLE fails if it exists; expires after 3h)
 *   2. prices every build query with a dry run and refuses past the budget
 *   3. builds into STAGING tables (production untouched), with maximumBytesBilled
 *   4. validates staging: rows == distinct source keys, keys unique, freshness == source,
 *      no large shrink vs production, and representative newest awards resolve through the
 *      app's EXACT lookup predicate
 *   5. backs production up to `<table>__prev` (copy job: free)
 *   6. publishes with a copy job, WRITE_TRUNCATE — atomic: readers see the old table or the new
 *   7. re-verifies production
 * Any failure before step 6 leaves production exactly as it was. Negative award lookups are
 * versioned by the table's lastModifiedTime (#1996), so publishing invalidates them.
 *
 * The CREATE statements are copied from build-lookup-tables.sh (the canonical definitions in
 * build-derived.sql §6/§7) with only the target table name parameterized.
 */
export const PROJECT = 'market-assasin';
export const DATASET = 'usaspending';
export const fq = (t: string) => `\`${PROJECT}.${DATASET}.${t}\``;

export const LOOKUPS = ['award_detail_lookup', 'piid_lookup'] as const;
export type LookupTable = (typeof LOOKUPS)[number];
export const stagingName = (t: LookupTable) => `${t}__staging`;
export const backupName = (t: LookupTable) => `${t}__prev`;
export const LOCK_TABLE = '_award_lookup_rebuild_lock';

/** Budget: the June 2026 build scanned ~34 GB + ~6.5 GB. Refuse well before anything runaway. */
export const BUDGET = {
  maxBytesPerBuild: 60 * 1024 ** 3,
  maxBytesTotal: 100 * 1024 ** 3,
  /** Staging may not be smaller than production by more than this fraction. */
  maxShrink: 0.01,
  probeCount: 20,
};

export function buildSql(t: LookupTable, target: string): string {
  if (t === 'piid_lookup') {
    return `
CREATE TABLE ${fq(target)}
PARTITION BY RANGE_BUCKET(bucket, GENERATE_ARRAY(0, 1024, 1))
CLUSTER BY piid_upper AS
WITH per_award AS (
  SELECT
    UPPER(TRIM(piid)) AS piid_upper,
    ARRAY_AGG(piid ORDER BY action_date DESC LIMIT 1)[OFFSET(0)] AS piid,
    award_id,
    ARRAY_AGG(recipient_name ORDER BY obligation_amount DESC NULLS LAST, action_date DESC LIMIT 1)[OFFSET(0)] AS recipient_name,
    SUM(obligation_amount) AS total_obligation,
    MAX(obligation_amount) AS max_obligation,
    MAX(action_date) AS latest_action_date
  FROM ${fq('awards')}
  WHERE piid IS NOT NULL AND TRIM(piid) != ""
  GROUP BY piid_upper, award_id
)
SELECT
  MOD(MOD(FARM_FINGERPRINT(piid_upper), 1024) + 1024, 1024) AS bucket,
  piid_upper, winner.piid AS piid, winner.award_id AS award_id, winner.recipient_name AS recipient_name
FROM (
  SELECT piid_upper,
    ARRAY_AGG(STRUCT(piid, award_id, recipient_name)
      ORDER BY total_obligation DESC NULLS LAST, max_obligation DESC NULLS LAST, latest_action_date DESC NULLS LAST
      LIMIT 1)[OFFSET(0)] AS winner
  FROM per_award GROUP BY piid_upper
)`;
  }
  return `
CREATE TABLE ${fq(target)}
PARTITION BY RANGE_BUCKET(bucket, GENERATE_ARRAY(0, 1024, 1))
CLUSTER BY award_id AS
SELECT
  MOD(MOD(FARM_FINGERPRINT(award_id), 1024) + 1024, 1024) AS bucket,
  award_id, latest.piid, latest.recipient_uei, latest.recipient_name, latest.parent_uei,
  latest.parent_name, latest.cage_code, latest.recipient_city, latest.recipient_state,
  latest.awarding_agency, latest.awarding_sub_agency, latest.awarding_office, latest.funding_agency,
  latest.funding_office, latest.naics_code, latest.naics_description, latest.psc_code,
  latest.psc_description, latest.contract_pricing_type, latest.set_aside,
  total_obligation AS obligation_amount, latest.action_date, latest.pop_start_date,
  latest.pop_end_date, latest.pop_state, latest.pop_city, latest.pop_country,
  latest.fiscal_year, latest.description
FROM (
  SELECT award_id, SUM(obligation_amount) AS total_obligation,
    ARRAY_AGG(STRUCT(piid, recipient_uei, recipient_name, parent_uei, parent_name, cage_code,
      recipient_city, recipient_state, awarding_agency, awarding_sub_agency, awarding_office,
      funding_agency, funding_office, naics_code, naics_description, psc_code, psc_description,
      contract_pricing_type, set_aside, action_date, pop_start_date, pop_end_date, pop_state,
      pop_city, pop_country, fiscal_year, description)
      ORDER BY action_date DESC LIMIT 1)[OFFSET(0)] AS latest
  FROM ${fq('awards')}
  WHERE award_id IS NOT NULL GROUP BY award_id
)`;
}

/** The SELECT body of a build — everything after the CREATE … CLUSTER BY <key> AS header. */
export function selectSql(t: LookupTable): string {
  const sql = buildSql(t, stagingName(t));
  const m = sql.match(/CLUSTER BY \w+ AS\s/);
  if (!m || m.index === undefined) throw new Error(`cannot locate SELECT body for ${t}`);
  return sql.slice(m.index + m[0].length);
}

/** The app's exact award lookup predicate (src/lib/bigquery/awards.ts getAwardLookup). */
export const APP_AWARD_PREDICATE = 'bucket = MOD(MOD(FARM_FINGERPRINT(@id), 1024) + 1024, 1024) AND award_id = @id';

export interface Stats { rows: number; distinctKeys: number; maxActionDate: string | null }

export interface ValidationInput {
  table: LookupTable;
  staging: Stats;
  sourceDistinctKeys: number;
  sourceMaxActionDate: string | null;
  productionRows: number | null;
  probesTotal: number;
  probesResolved: number;
}

/** Pure: every reason staging must NOT be published. Empty = publishable. */
export function validateStaging(v: ValidationInput): string[] {
  const bad: string[] = [];
  if (v.staging.rows === 0) bad.push('staging is empty');
  if (v.staging.rows !== v.staging.distinctKeys) bad.push(`keys not unique (${v.staging.rows} rows, ${v.staging.distinctKeys} distinct)`);
  if (v.staging.distinctKeys !== v.sourceDistinctKeys) bad.push(`row count ${v.staging.distinctKeys} != source distinct keys ${v.sourceDistinctKeys}`);
  if (v.table === 'award_detail_lookup' && v.staging.maxActionDate !== v.sourceMaxActionDate) {
    bad.push(`freshness ${v.staging.maxActionDate} != source ${v.sourceMaxActionDate}`);
  }
  if (v.productionRows != null && v.staging.rows < v.productionRows * (1 - BUDGET.maxShrink)) {
    bad.push(`shrinks production ${v.productionRows} -> ${v.staging.rows} (> ${BUDGET.maxShrink * 100}%)`);
  }
  if (v.probesTotal > 0 && v.probesResolved !== v.probesTotal) bad.push(`representative lookups: ${v.probesResolved}/${v.probesTotal} resolved`);
  return bad;
}

/** What the orchestrator needs from BigQuery. The script wires the real client. */
export interface RebuildBq {
  query<T = Record<string, unknown>>(sql: string, opts?: { params?: Record<string, unknown>; maximumBytesBilled?: number }): Promise<T[]>;
  dryRunBytes(sql: string): Promise<number>;
  copy(src: string, dst: string): Promise<void>; // WRITE_TRUNCATE, atomic
  tableRows(t: string): Promise<number | null>; // null = table does not exist
}

export interface RebuildResult {
  ok: boolean;
  published: LookupTable[];
  stage: string;
  reasons: string[];
  sourceMaxActionDate: string | null;
  rows: Partial<Record<LookupTable, number>>;
  estimatedBytes: number;
}

export async function rebuildLookups(
  bq: RebuildBq,
  opts: { go: boolean; probeIds?: string[]; skipIfCurrent?: boolean; log?: (m: string) => void },
): Promise<RebuildResult> {
  const log = opts.log ?? (() => {});
  const res: RebuildResult = { ok: false, published: [], stage: 'start', reasons: [], sourceMaxActionDate: null, rows: {}, estimatedBytes: 0 };

  // 1. Lock (only when executing). CREATE TABLE fails if another run holds it; auto-expires.
  if (opts.go) {
    res.stage = 'lock';
    try {
      await bq.query(`CREATE TABLE ${fq(LOCK_TABLE)} (started_at TIMESTAMP)
        OPTIONS (expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 3 HOUR))`);
    } catch (err) {
      res.reasons.push(`another rebuild holds the lock (or lock failed): ${err instanceof Error ? err.message : err}`);
      return res;
    }
  }
  try {
    // 2. Source facts + budget.
    res.stage = 'source';
    const [src] = await bq.query<{ mx: { value: string } | string | null; awards: number; piids: number }>(
      `SELECT CAST(MAX(action_date) AS STRING) AS mx,
              COUNT(DISTINCT award_id) AS awards,
              COUNT(DISTINCT IF(piid IS NOT NULL AND TRIM(piid) != "", UPPER(TRIM(piid)), NULL)) AS piids
       FROM ${fq('awards')}`,
      { maximumBytesBilled: 20 * 1024 ** 3 },
    );
    res.sourceMaxActionDate = typeof src.mx === 'object' && src.mx ? src.mx.value : (src.mx as string | null);
    const sourceKeys: Record<LookupTable, number> = { award_detail_lookup: Number(src.awards), piid_lookup: Number(src.piids) };
    log(`source: max action ${res.sourceMaxActionDate}, ${sourceKeys.award_detail_lookup} awards, ${sourceKeys.piid_lookup} piids`);

    // Already current? A successful weekly import that brought nothing new must not re-scan ~43 GB.
    // Current = production has the source's newest action date AND one row per source award.
    if (opts.skipIfCurrent) {
      res.stage = 'currency';
      const [p] = await bq.query<{ mx: { value: string } | string | null }>(
        `SELECT CAST(MAX(action_date) AS STRING) AS mx FROM ${fq('award_detail_lookup')}`,
        { maximumBytesBilled: 2 * 1024 ** 3 },
      );
      const prodMax = typeof p?.mx === 'object' && p?.mx ? p.mx.value : (p?.mx as string | null);
      const prodRows = await bq.tableRows('award_detail_lookup');
      if (prodMax === res.sourceMaxActionDate && prodRows === sourceKeys.award_detail_lookup) {
        log(`lookups already current (max ${prodMax}, ${prodRows} rows) — nothing to rebuild`);
        res.stage = 'up-to-date';
        res.ok = true;
        return res;
      }
      log(`lookups behind source (prod max ${prodMax}, ${prodRows} rows) — rebuilding`);
    }

    res.stage = 'budget';
    for (const t of LOOKUPS) {
      // Price the SELECT body, which is what scans: a dry run of CREATE TABLE fails when the staging
      // table is left over from an earlier run (found on the first production run, 2026-11-13).
      const b = await bq.dryRunBytes(selectSql(t));
      if (b > BUDGET.maxBytesPerBuild) res.reasons.push(`${t} build would scan ${(b / 1e9).toFixed(1)} GB (> per-build cap)`);
      res.estimatedBytes += b;
    }
    if (res.estimatedBytes > BUDGET.maxBytesTotal) res.reasons.push(`total ${(res.estimatedBytes / 1e9).toFixed(1)} GB > total cap`);
    log(`estimated build scan: ${(res.estimatedBytes / 1e9).toFixed(1)} GB`);
    if (res.reasons.length || !opts.go) { res.ok = res.reasons.length === 0; return res; }

    // 3. Build staging (production untouched).
    for (const t of LOOKUPS) {
      res.stage = `build ${t}`;
      await bq.query(`DROP TABLE IF EXISTS ${fq(stagingName(t))}`);
      await bq.query(buildSql(t, stagingName(t)), { maximumBytesBilled: BUDGET.maxBytesPerBuild });
      log(`built ${stagingName(t)}`);
    }

    // 4. Validate staging.
    res.stage = 'validate';
    const probes = await representativeProbes(bq, opts.probeIds ?? []);
    const stats = async (table: string, key: string, withDate: boolean): Promise<Stats> => {
      const [r] = await bq.query<{ n: number; d: number; mx: { value: string } | string | null }>(
        `SELECT COUNT(*) AS n, COUNT(DISTINCT ${key}) AS d, ${withDate ? 'CAST(MAX(action_date) AS STRING)' : 'NULL'} AS mx FROM ${fq(table)}`,
        { maximumBytesBilled: 10 * 1024 ** 3 },
      );
      return { rows: Number(r.n), distinctKeys: Number(r.d), maxActionDate: typeof r.mx === 'object' && r.mx ? r.mx.value : (r.mx as string | null) };
    };
    for (const t of LOOKUPS) {
      const s = await stats(stagingName(t), t === 'piid_lookup' ? 'piid_upper' : 'award_id', t === 'award_detail_lookup');
      let resolved = 0;
      if (t === 'award_detail_lookup') {
        for (const id of probes) {
          const hit = await bq.query(`SELECT award_id FROM ${fq(stagingName(t))} WHERE ${APP_AWARD_PREDICATE} LIMIT 1`, { params: { id }, maximumBytesBilled: 200 * 1024 ** 2 });
          if (hit.length === 1) resolved++;
        }
      }
      const bad = validateStaging({
        table: t, staging: s, sourceDistinctKeys: sourceKeys[t], sourceMaxActionDate: res.sourceMaxActionDate,
        productionRows: await bq.tableRows(t),
        probesTotal: t === 'award_detail_lookup' ? probes.length : 0, probesResolved: resolved,
      });
      res.rows[t] = s.rows;
      log(`validate ${t}: ${s.rows} rows, max ${s.maxActionDate ?? '-'}, probes ${resolved}/${t === 'award_detail_lookup' ? probes.length : 0}${bad.length ? ' — FAIL: ' + bad.join('; ') : ' — ok'}`);
      res.reasons.push(...bad.map((b) => `${t}: ${b}`));
    }
    if (res.reasons.length) return res; // production untouched

    // 5-6. Back up, then publish atomically. award_detail_lookup first (the public 404 fix).
    for (const t of LOOKUPS) {
      res.stage = `publish ${t}`;
      if ((await bq.tableRows(t)) != null) await bq.copy(t, backupName(t));
      await bq.copy(stagingName(t), t);
      res.published.push(t);
      log(`published ${t} (previous kept as ${backupName(t)})`);
    }

    // 7. Verify production.
    res.stage = 'verify';
    const prod = await stats('award_detail_lookup', 'award_id', true);
    if (prod.maxActionDate !== res.sourceMaxActionDate) res.reasons.push(`post-publish freshness ${prod.maxActionDate} != source`);
    for (const id of probes) {
      const hit = await bq.query(`SELECT award_id FROM ${fq('award_detail_lookup')} WHERE ${APP_AWARD_PREDICATE} LIMIT 1`, { params: { id }, maximumBytesBilled: 200 * 1024 ** 2 });
      if (hit.length !== 1) res.reasons.push(`post-publish probe missing: ${id}`);
    }
    for (const t of LOOKUPS) await bq.query(`DROP TABLE IF EXISTS ${fq(stagingName(t))}`);
    res.stage = 'done';
    res.ok = res.reasons.length === 0;
    return res;
  } catch (err) {
    res.reasons.push(`${res.stage}: ${err instanceof Error ? err.message : String(err)}`);
    return res;
  } finally {
    if (opts.go) {
      try { await bq.query(`DROP TABLE IF EXISTS ${fq(LOCK_TABLE)}`); } catch { /* expires on its own */ }
    }
  }
}

/** Newest awards in the source (what users miss first) plus any explicit probe IDs. */
async function representativeProbes(bq: RebuildBq, extra: string[]): Promise<string[]> {
  const rows = await bq.query<{ award_id: string }>(
    `SELECT award_id FROM ${fq('awards')}
     WHERE fiscal_year >= EXTRACT(YEAR FROM CURRENT_DATE()) - 1 AND award_id IS NOT NULL
     QUALIFY ROW_NUMBER() OVER (PARTITION BY award_id ORDER BY action_date DESC) = 1
     ORDER BY action_date DESC, award_id LIMIT ${BUDGET.probeCount}`,
    { maximumBytesBilled: 5 * 1024 ** 3 },
  );
  return [...new Set([...rows.map((r) => r.award_id), ...extra])];
}
