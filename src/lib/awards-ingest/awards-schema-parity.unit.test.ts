/**
 * Awards schema PARITY — every writer of `usaspending.awards` agrees with awards-schema.ts.
 *
 * Hermetic: reads the SQL files from the repo and builds the MERGE in memory. No BigQuery.
 *
 * Why: `build-derived.sql` step 1 is `CREATE OR REPLACE TABLE awards AS SELECT …`. A column the
 * DDL adds but the rebuild does not select is silently DROPPED (with its data) the next time the
 * rebuild runs. These assertions make every writer derive from ONE list, so adding a column to
 * one place without the others fails CI instead of erasing production data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AWARDS_COLUMNS,
  AWARDS_LEGACY_COLUMNS,
  classifyAwardsSchema,
  IDV_IDENTITY_COLUMNS,
  IDV_IDENTITY_REQUIRED,
  idvIdentitySelectExpr,
  MERGE_EXEMPT,
  mergeColumns,
  rebuildSelectExpr,
} from './awards-schema';
import { buildAwardsMergeSql, resolveIdvIdentityColumnsMode } from './merge-sql';

const ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const BUILD_DERIVED = 'scripts/usaspending-ingest/build-derived.sql';
const DDL_01 = 'tasks/idv-vehicle-foundation/01-ddl-add-columns.sql';
const BACKFILL_02 = 'tasks/idv-vehicle-foundation/02-backfill-from-current-staging.sql';
const ROLLBACK_99 = 'tasks/idv-vehicle-foundation/99-rollback.sql';

const targets = (cols: readonly { target: string }[]) => cols.map((c) => c.target);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const IDV = targets(IDV_IDENTITY_COLUMNS);
const ALL = targets(AWARDS_COLUMNS);
const MERGE_ALL = ALL.filter((c) => !MERGE_EXEMPT.has(c));

const mergeBase = {
  awardsTable: '`market-assasin.usaspending.awards`',
  stagingFq: 'market-assasin.usaspending.awards_ingest_staging',
  startDate: '2026-06-06',
};

/** Step-1 SELECT of build-derived.sql → [{ alias, expr (as written, trimmed, no trailing comma) }]. */
function rebuildProjection(sql: string): Array<{ alias: string; expr: string; raw: string }> {
  const start = sql.indexOf('CREATE OR REPLACE TABLE `market-assasin.usaspending.awards`');
  expect(start, 'build-derived.sql step 1 (CREATE OR REPLACE TABLE awards) not found').toBeGreaterThan(-1);
  const selectAt = sql.indexOf('\nSELECT\n', start);
  const fromAt = sql.indexOf('\nFROM `market-assasin.usaspending.awards_raw`', selectAt);
  expect(selectAt).toBeGreaterThan(start);
  expect(fromAt).toBeGreaterThan(selectAt);
  return sql
    .slice(selectAt + '\nSELECT\n'.length, fromAt)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--'))
    .map((l) => l.replace(/,$/, ''))
    .map((raw) => {
      const m = raw.match(/^(.*\S)\s+AS\s+(\w+)$/);
      expect(m, `unparseable projection line: ${raw}`).not.toBeNull();
      return { alias: m![2], expr: `${norm(m![1])} AS ${m![2]}`, raw };
    });
}

/** The ASSERT NOT EXISTS … NOT IN (…) list at the top of build-derived.sql. */
function rebuildGuardList(sql: string): string[] {
  const m = sql.match(/ASSERT NOT EXISTS \([\s\S]*?INFORMATION_SCHEMA\.COLUMNS`[\s\S]*?table_name = 'awards'[\s\S]*?column_name NOT IN \(([\s\S]*?)\)\s*\)\s*AS '/);
  expect(m, 'destructive-rebuild guard (ASSERT NOT EXISTS … NOT IN) not found in build-derived.sql').not.toBeNull();
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function mergeParts(sql: string) {
  const sel = sql.slice(sql.indexOf('SELECT'), sql.indexOf('FROM `'));
  const selectAliases = [...sel.matchAll(/ AS (\w+)(?:,|\s*$)/g)].map((m) => m[1]);
  const upd = sql.slice(sql.indexOf('UPDATE SET'), sql.indexOf('WHEN NOT MATCHED'));
  const updateTargets = [...upd.matchAll(/(\w+)=S\.(\w+)/g)].map((m) => {
    expect(m[1]).toBe(m[2]);
    return m[1];
  });
  const ins = sql.match(/INSERT \(([\s\S]*?)\) VALUES \(([\s\S]*?)\)\s*$/);
  expect(ins).not.toBeNull();
  const insertCols = ins![1].split(',').map((s) => s.trim());
  const insertVals = ins![2].split(',').map((s) => s.trim());
  return { selectAliases, updateTargets, insertCols, insertVals, selectText: sel };
}

describe('canonical awards schema', () => {
  it('is 51 live legacy columns + 7 IDV identity columns = 58, no duplicates', () => {
    expect(AWARDS_LEGACY_COLUMNS).toHaveLength(51);
    expect(IDV_IDENTITY_COLUMNS).toHaveLength(7);
    expect(AWARDS_COLUMNS).toHaveLength(58);
    expect(new Set(ALL).size).toBe(58);
    expect(targets(AWARDS_COLUMNS.slice(51))).toEqual(IDV);
    // ordering_period_end_date is the one DATE among the identity columns.
    expect(IDV_IDENTITY_COLUMNS.find((c) => c.target === 'ordering_period_end_date')?.type).toBe('DATE');
  });

  it('the 51 legacy columns == the recorded LIVE schema (names, order, data types)', () => {
    const live = JSON.parse(read('tasks/awards-schema-protection/live-schema-2026-09-23.json')) as {
      column_count: number; partition_by: string; cluster_by: string;
      columns: Array<{ ordinal_position: number; name: string; data_type: string }>;
    };
    expect(live.column_count).toBe(51);
    expect(live.columns.map((c) => [c.name, c.data_type]))
      .toEqual(AWARDS_LEGACY_COLUMNS.map((c) => [c.target, c.type]));
    expect(live.columns.map((c) => c.ordinal_position)).toEqual(AWARDS_LEGACY_COLUMNS.map((_, i) => i + 1));
    expect(live.partition_by).toBe('PARTITION BY RANGE_BUCKET(fiscal_year, GENERATE_ARRAY(2015, 2030, 1))');
    expect(live.cluster_by).toBe('CLUSTER BY recipient_uei, recipient_name');
  });

  it('MERGE_EXEMPT is exactly the 10 FFATA exec_* columns (absent from the bulk CSV)', () => {
    expect([...MERGE_EXEMPT].sort()).toEqual(ALL.filter((c) => c.startsWith('exec_')).sort());
    expect(MERGE_EXEMPT.size).toBe(10);
  });

  it('IDV_IDENTITY_REQUIRED is false until the production DDL lands (flip in the NEXT commit)', () => {
    expect(IDV_IDENTITY_REQUIRED).toBe(false);
  });
});

describe('build-derived.sql (full rebuild) == AWARDS_COLUMNS', () => {
  const sql = read(BUILD_DERIVED);
  const proj = rebuildProjection(sql);

  it('step-1 aliases are AWARDS_COLUMNS, in order', () => {
    expect(proj.map((p) => p.alias)).toEqual(ALL);
  });

  it('each legacy projection types exactly as awards-schema.ts says', () => {
    for (const col of AWARDS_LEGACY_COLUMNS) {
      const p = proj.find((x) => x.alias === col.target)!;
      expect(p.expr, col.target).toBe(norm(rebuildSelectExpr(col)));
    }
  });

  it('the 7 IDV projections are BYTE-EQUAL to the MERGE idvIdentitySelectExpr()', () => {
    for (const col of IDV_IDENTITY_COLUMNS) {
      const p = proj.find((x) => x.alias === col.target)!;
      expect(p.raw).toBe(idvIdentitySelectExpr(col));
    }
  });

  it('the destructive-rebuild guard NOT IN list == AWARDS_COLUMNS (and runs before the CREATE)', () => {
    expect(rebuildGuardList(sql)).toEqual(ALL);
    const marker = sql.indexOf('-- awards-schema-guard: v1');
    const guard = sql.indexOf('ASSERT NOT EXISTS');
    const create = sql.indexOf('CREATE OR REPLACE TABLE `market-assasin.usaspending.awards`');
    expect(marker).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(marker);
    expect(create).toBeGreaterThan(guard);
  });

  it('the stale-archive guard refuses an awards_raw older than awards, before the CREATE', () => {
    const stale = sql.indexOf('SELECT MAX(action_date) FROM `market-assasin.usaspending.awards`');
    const raw = sql.indexOf("SELECT MAX(SAFE.PARSE_DATE('%Y-%m-%d', action_date))");
    const create = sql.indexOf('CREATE OR REPLACE TABLE `market-assasin.usaspending.awards`');
    expect(stale).toBeGreaterThan(-1);
    expect(raw).toBeGreaterThan(stale);
    expect(create).toBeGreaterThan(raw);
    expect(sql.slice(stale, raw)).toMatch(/\)\s*<=\s*\(\s*$/);
  });

  it('partitioning/clustering in the rebuild match the live table (fiscal_year, not action_date)', () => {
    expect(sql).toContain('PARTITION BY RANGE_BUCKET(fiscal_year, GENERATE_ARRAY(2015, 2030, 1))');
    expect(sql).toContain('CLUSTER BY recipient_uei, recipient_name');
  });
});

describe('weekly MERGE == AWARDS_COLUMNS − MERGE_EXEMPT', () => {
  it('with IDV on: SELECT and INSERT == all 58 − exec_*, UPDATE SET == same − txn_id', () => {
    const m = mergeParts(buildAwardsMergeSql({ ...mergeBase, idvIdentityColumns: true }));
    expect(m.selectAliases).toEqual(MERGE_ALL);
    expect(m.insertCols).toEqual(MERGE_ALL);
    expect(m.insertVals).toEqual(MERGE_ALL.map((c) => `S.${c}`));
    expect(m.updateTargets).toEqual(MERGE_ALL.filter((c) => c !== 'txn_id'));
    for (const col of IDV_IDENTITY_COLUMNS) expect(m.selectText).toContain(idvIdentitySelectExpr(col));
    expect(targets(mergeColumns({ idvIdentityColumns: true }))).toEqual(MERGE_ALL);
  });

  it('with IDV off: the legacy 41 columns (51 − exec_*), no IDV column anywhere', () => {
    const sql = buildAwardsMergeSql(mergeBase);
    const legacy41 = targets(AWARDS_LEGACY_COLUMNS).filter((c) => !MERGE_EXEMPT.has(c));
    expect(legacy41).toHaveLength(41);
    const m = mergeParts(sql);
    expect(m.selectAliases).toEqual(legacy41);
    expect(m.insertCols).toEqual(legacy41);
    expect(m.updateTargets).toEqual(legacy41.filter((c) => c !== 'txn_id'));
    for (const c of IDV) expect(sql).not.toContain(c);
  });

  it('deriving the MERGE from the schema changed nothing: BYTE-equal to both pre-refactor statements', () => {
    const golden = (f: string) => read(`src/lib/awards-ingest/__fixtures__/${f}`);
    // The statement the scheduled weekly ingest runs today (captured by #1658 from origin/main 45e3cfba).
    expect(buildAwardsMergeSql({ ...mergeBase, startDate: '2026-06-07' })).toBe(golden('merge-sql-pre-1658.golden.sql'));
    // #1658's IDV-on statement, captured from its hand-written merge-sql.ts before this refactor.
    expect(buildAwardsMergeSql({ ...mergeBase, idvIdentityColumns: true })).toBe(golden('merge-sql-pre-schema-idv.golden.sql'));
  });
});

describe('IDV DDL / backfill / rollback == IDV_IDENTITY_COLUMNS', () => {
  it('01-ddl ADD COLUMN names + types == IDV_IDENTITY_COLUMNS, in order', () => {
    const adds = [...read(DDL_01).matchAll(/ADD COLUMN IF NOT EXISTS (\w+) (\w+)/g)].map((m) => ({ target: m[1], type: m[2] }));
    expect(adds).toEqual(IDV_IDENTITY_COLUMNS.map((c) => ({ target: c.target, type: c.type })));
  });

  it('02-backfill SET list == IDV cols, and its projections are byte-equal to idvIdentitySelectExpr()', () => {
    const sql = read(BACKFILL_02);
    const set = sql.slice(sql.indexOf('UPDATE awards T'), sql.indexOf('\nFROM ('));
    const names = [...set.matchAll(/^\s*(\w+)\s*=\s*S\.(\w+),?\s*$/gm)].map((m) => {
      expect(m[1]).toBe(m[2]);
      return m[1];
    });
    expect(names).toEqual(IDV);
    for (const col of IDV_IDENTITY_COLUMNS) expect(sql).toContain(idvIdentitySelectExpr(col));
  });

  it('99-rollback §A DROP list == IDV cols, and EVERY line of the file is commented out', () => {
    const sql = read(ROLLBACK_99);
    const a = sql.slice(sql.indexOf('§A'), sql.indexOf('§B'));
    const drops = [...a.matchAll(/DROP COLUMN IF EXISTS (\w+)/g)].map((m) => m[1]);
    expect(drops).toEqual(IDV);
    const live = sql.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--'));
    expect(live).toEqual([]);
  });
});

describe('live-schema gate: fail closed, check TYPES not just names', () => {
  const legacy = AWARDS_LEGACY_COLUMNS.map((c) => ({ name: c.target, dataType: c.type }));
  const idv = IDV_IDENTITY_COLUMNS.map((c) => ({ name: c.target, dataType: c.type }));

  it('today (not required): 51 legacy → absent (legacy MERGE); 58 → present', () => {
    expect(resolveIdvIdentityColumnsMode(legacy)).toBe('absent');
    expect(resolveIdvIdentityColumnsMode([...legacy, ...idv])).toBe('present');
  });

  it('required + absent → THROWS (never silently falls back to 41 columns)', () => {
    expect(() => resolveIdvIdentityColumnsMode(legacy, { required: true })).toThrow(/REQUIRED .* but absent/);
    expect(resolveIdvIdentityColumnsMode([...legacy, ...idv], { required: true })).toBe('present');
  });

  it('partial → throws, required or not', () => {
    expect(() => resolveIdvIdentityColumnsMode([...legacy, ...idv.slice(0, 3)])).toThrow(/PARTIAL/);
    expect(() => resolveIdvIdentityColumnsMode([...legacy, ...idv.slice(0, 3)], { required: true })).toThrow(/PARTIAL/);
  });

  it('a STRING ordering_period_end_date is refused (type, not just name)', () => {
    const wrong = [...legacy, ...idv.map((c) => (c.name === 'ordering_period_end_date' ? { ...c, dataType: 'STRING' } : c))];
    expect(() => resolveIdvIdentityColumnsMode(wrong)).toThrow(/ordering_period_end_date: live STRING ≠ expected DATE/);
  });

  it('a legacy type drift or a missing legacy column is refused too', () => {
    const drift = legacy.map((c) => (c.name === 'action_date' ? { ...c, dataType: 'STRING' } : c));
    expect(() => resolveIdvIdentityColumnsMode(drift)).toThrow(/action_date: live STRING ≠ expected DATE/);
    expect(() => resolveIdvIdentityColumnsMode(legacy.filter((c) => c.name !== 'naics_code'))).toThrow(/missing legacy column\(s\): naics_code/);
  });

  it('an unknown live column is REPORTED (a rebuild would drop it) but does not block the MERGE', () => {
    const state = classifyAwardsSchema([...legacy, { name: 'surprise_col', dataType: 'STRING' }]);
    expect(state.unknownColumns).toEqual(['surprise_col']);
    expect(state.ok).toBe(true);
  });
});
