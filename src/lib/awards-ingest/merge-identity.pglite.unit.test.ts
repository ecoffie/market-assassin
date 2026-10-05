/**
 * MERGE identity — executes the REAL generated ingest SQL in an in-process Postgres (PGlite) against
 * the real 58-column `awards` shape, and proves one canonical row per transaction (A1, 2026-10-04).
 *
 * THE DEFECT. The weekly MERGE matched `T.txn_id = S.txn_id AND T.action_date >= start − 2d`. When
 * USASpending re-dated an existing transaction INTO the pull window, the existing row (old date,
 * before the bound) did not match, so the MERGE INSERTED a second copy. A1 left 126 such stale rows
 * ($17.23M, 9 fiscal years); A1b deleted them by hand. The identity is now `txn_id` within the
 * fiscal_year partitions that actually hold the staged keys (located just before), inside a
 * transaction whose ASSERT rolls the MERGE back if any staged key gains a row.
 *
 * RED/GREEN on the same scenarios. `AWARDS_MERGE_UNDER_TEST=legacy-golden` runs them through the
 * statement main's scheduled ingest executed (the committed #1658 golden, byte-equal to main's
 * builder output with IDV on — see awards-schema-parity.unit.test.ts), with only the window date
 * substituted. The A1 scenarios FAIL there and pass on the default (current) path.
 *
 * Dialect shim (BigQuery → Postgres) is deliberately narrow: names, CAST/SAFE_CAST, DATE_SUB,
 * COUNTIF, IGNORE NULLS, the transaction keywords and ASSERT. The identity logic under test — the ON
 * clause, UPDATE/INSERT lists, the locate aggregates and the ASSERT predicate — is executed as
 * generated, never re-typed here. Never touches a real database.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { AWARDS_COLUMNS, type AwardsColumnType } from './awards-schema';
import {
  buildAwardsMergeScript,
  buildMergeLocateSql,
  MERGE_IDENTITY_ASSERT_MESSAGE,
  planMergeIdentity,
  type MergeIdentityPlan,
  type MergeLocateRow,
} from './merge-sql';

const AWARDS = '`market-assasin.usaspending.awards`';
const STAGING = 'market-assasin.usaspending.awards_ingest_staging';
const UNDER_TEST = process.env.AWARDS_MERGE_UNDER_TEST === 'legacy-golden' ? 'legacy-golden' : 'current';
const LEGACY_GOLDEN = readFileSync(join(__dirname, '__fixtures__', 'merge-sql-pre-schema-idv.golden.sql'), 'utf8');

const PG_TYPE: Record<AwardsColumnType, string> = { STRING: 'text', INT64: 'bigint', FLOAT64: 'double precision', DATE: 'date' };

/** BigQuery → Postgres, for exactly the constructs the ingest SQL uses. */
function toPg(sql: string): string {
  let s = sql
    .replaceAll(`\`${STAGING}\``, 'staging')
    .replaceAll(AWARDS, 'awards')
    .replace(/MERGE awards T\b/, 'MERGE INTO awards AS T')
    .replace(/SAFE_CAST\((.+?) AS (INT64|DATE|FLOAT64)\)/g, (_m, e: string, t: string) =>
      `${t === 'INT64' ? 'safe_int8' : t === 'DATE' ? 'safe_date' : 'safe_float8'}(${e})`)
    .replace(/ AS STRING\)/g, ' AS text)')
    .replace(/DATE_SUB\(DATE\('(\d{4}-\d{2}-\d{2})'\), INTERVAL (\d+) DAY\)/g, `(DATE '$1' - $2)`)
    .replace(/ IGNORE NULLS/g, '')
    .replace(/BEGIN TRANSACTION;/, 'BEGIN;')
    .replace(/COMMIT TRANSACTION;/, 'COMMIT;');
  s = s.replace(/ASSERT \(([\s\S]*)\)\s*\n\s*AS '([^']*)';/, (_m, cond: string, msg: string) =>
    `DO $assert$ BEGIN IF NOT (${cond}) THEN RAISE EXCEPTION '${msg}'; END IF; END $assert$;`);
  if (/SAFE_CAST|STRING\)|`|INTERVAL \d+ DAY|ASSERT|TRANSACTION/.test(s)) throw new Error(`shim left BigQuery syntax:\n${s}`);
  return s;
}

const db = new PGlite();
const STAGING_SOURCES = [...new Set(AWARDS_COLUMNS.map((c) => c.source))];

beforeAll(async () => {
  await db.exec(`
    CREATE FUNCTION safe_int8(v text) RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN v::bigint; EXCEPTION WHEN others THEN RETURN NULL; END $$;
    CREATE FUNCTION safe_date(v text) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN v::date; EXCEPTION WHEN others THEN RETURN NULL; END $$;
    CREATE FUNCTION safe_float8(v text) RETURNS double precision LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN v::double precision; EXCEPTION WHEN others THEN RETURN NULL; END $$;
    CREATE FUNCTION countif_sf(acc bigint, b boolean) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT acc + CASE WHEN b THEN 1 ELSE 0 END $$;
    CREATE AGGREGATE countif(boolean) (SFUNC = countif_sf, STYPE = bigint, INITCOND = '0');
    CREATE TABLE awards (${AWARDS_COLUMNS.map((c) => `${c.target} ${PG_TYPE[c.type]}`).join(', ')});
    CREATE TABLE staging (${STAGING_SOURCES.map((c) => `${c} text`).join(', ')});
  `);
});

beforeEach(async () => {
  await db.exec('TRUNCATE awards; TRUNCATE staging;');
});

interface Txn { txn: string; fy: number | null; date: string; amount: number; flag?: string | null }

async function seedAwards(rows: Txn[]): Promise<void> {
  for (const r of rows) {
    await db.query(
      `INSERT INTO awards (txn_id, award_id, fiscal_year, action_date, obligation_amount, award_or_idv_flag, awarding_agency_code)
       VALUES ($1, $1, $2, $3, $4, $5, '097')`,
      [r.txn, r.fy, r.date, r.amount, r.flag ?? null],
    );
  }
}

async function stage(rows: Txn[]): Promise<void> {
  for (const r of rows) {
    await db.query(
      `INSERT INTO staging (contract_transaction_unique_key, contract_award_unique_key, action_date_fiscal_year, action_date,
         federal_action_obligation, award_or_idv_flag, awarding_agency_code)
       VALUES ($1, $1, $2, $3, $4, $5, '097')`,
      [r.txn, r.fy === null ? '' : String(r.fy), r.date, String(r.amount), r.flag ?? 'AWARD'],
    );
  }
}

/** The ingest's write path. `current` = locate → plan → transactional MERGE; `legacy-golden` = main's statement. */
async function ingestMerge(windowStart: string): Promise<MergeIdentityPlan | null> {
  if (UNDER_TEST === 'legacy-golden') {
    const sql = LEGACY_GOLDEN.replace(/DATE\('2026-06-06'\)/, `DATE('${windowStart}')`);
    await db.exec(toPg(sql));
    return null;
  }
  const locate = (await db.query<MergeLocateRow>(toPg(buildMergeLocateSql({ awardsTable: AWARDS, stagingFq: STAGING })))).rows;
  expect(locate).toHaveLength(1);
  const plan = planMergeIdentity(locate[0]);
  await db.exec(toPg(buildAwardsMergeScript({ awardsTable: AWARDS, stagingFq: STAGING, plan, idvIdentityColumns: true })));
  return plan;
}

async function rowsFor(txn: string) {
  return (await db.query<{ fiscal_year: number | null; action_date: string; obligation_amount: number; award_or_idv_flag: string | null }>(
    `SELECT fiscal_year, to_char(action_date, 'YYYY-MM-DD') AS action_date, obligation_amount, award_or_idv_flag
     FROM awards WHERE txn_id = $1 ORDER BY fiscal_year NULLS FIRST, action_date`, [txn])).rows;
}
async function total(): Promise<number> {
  return Number((await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM awards')).rows[0].n);
}

describe(`awards MERGE identity [${UNDER_TEST}] — one canonical row per transaction`, () => {
  it('THE A1 CASE: an existing txn re-dated INTO the window is updated, never inserted twice', async () => {
    // Window 1 of A1 started 2026-01-20. The warehouse held X dated 2025-12-15 (before the bound).
    await seedAwards([{ txn: 'X', fy: 2026, date: '2025-12-15', amount: 100, flag: null }]);
    await stage([{ txn: 'X', fy: 2026, date: '2026-02-10', amount: 150 }]);
    await ingestMerge('2026-01-20');
    expect(await rowsFor('X')).toEqual([{ fiscal_year: 2026, action_date: '2026-02-10', obligation_amount: 150, award_or_idv_flag: 'AWARD' }]);
    expect(await total()).toBe(1);
  });

  it('A1 across fiscal years: an FY2025 row re-dated into FY2026 moves partitions, still one row', async () => {
    await seedAwards([{ txn: 'X', fy: 2025, date: '2025-09-20', amount: 100, flag: null }]);
    await stage([{ txn: 'X', fy: 2026, date: '2025-10-05', amount: 175 }]);
    await ingestMerge('2025-10-01');
    expect(await rowsFor('X')).toEqual([{ fiscal_year: 2026, action_date: '2025-10-05', obligation_amount: 175, award_or_idv_flag: 'AWARD' }]);
  });

  it('inverse movement: a txn re-dated EARLIER (still inside the window) is updated in place', async () => {
    await seedAwards([{ txn: 'X', fy: 2026, date: '2026-03-10', amount: 100 }]);
    await stage([{ txn: 'X', fy: 2026, date: '2026-01-25', amount: 90 }]);
    await ingestMerge('2026-01-20');
    expect(await rowsFor('X')).toEqual([{ fiscal_year: 2026, action_date: '2026-01-25', obligation_amount: 90, award_or_idv_flag: 'AWARD' }]);
  });

  it('inverse across fiscal years: an FY2026 row re-dated back into FY2025 moves partitions, one row', async () => {
    await seedAwards([{ txn: 'X', fy: 2026, date: '2025-10-03', amount: 100 }]);
    await stage([{ txn: 'X', fy: 2025, date: '2025-09-28', amount: 80 }]);
    await ingestMerge('2025-09-01');
    expect(await rowsFor('X')).toEqual([{ fiscal_year: 2025, action_date: '2025-09-28', obligation_amount: 80, award_or_idv_flag: 'AWARD' }]);
  });

  it('normal incremental ingest is unchanged: new txn inserted, in-window correction updated, others untouched', async () => {
    await seedAwards([
      { txn: 'Z', fy: 2026, date: '2026-07-01', amount: 100 },
      { txn: 'W', fy: 2024, date: '2024-03-01', amount: 7 },
    ]);
    await stage([
      { txn: 'Z', fy: 2026, date: '2026-07-01', amount: 120 },
      { txn: 'Y', fy: 2026, date: '2026-07-02', amount: 50 },
    ]);
    await ingestMerge('2026-06-26');
    expect(await rowsFor('Z')).toEqual([{ fiscal_year: 2026, action_date: '2026-07-01', obligation_amount: 120, award_or_idv_flag: 'AWARD' }]);
    expect(await rowsFor('Y')).toEqual([{ fiscal_year: 2026, action_date: '2026-07-02', obligation_amount: 50, award_or_idv_flag: 'AWARD' }]);
    expect(await rowsFor('W')).toEqual([{ fiscal_year: 2024, action_date: '2024-03-01', obligation_amount: 7, award_or_idv_flag: null }]);
    expect(await total()).toBe(3);
  });

  it('existing duplicate baseline is not worsened: both pre-existing copies are corrected, none added', async () => {
    // Production carries 140 txn_ids with 2 rows (21 of them span two fiscal years).
    await seedAwards([
      { txn: 'D', fy: 2025, date: '2025-09-30', amount: 10, flag: null },
      { txn: 'D', fy: 2026, date: '2026-07-01', amount: 10, flag: null },
    ]);
    await stage([{ txn: 'D', fy: 2026, date: '2026-07-01', amount: 12 }]);
    await ingestMerge('2026-06-26');
    const d = await rowsFor('D');
    expect(d).toHaveLength(2);
    expect(d.every((r) => r.obligation_amount === 12 && r.award_or_idv_flag === 'AWARD')).toBe(true);
  });
});

describe.runIf(UNDER_TEST === 'current')('identity plan + transactional guard', () => {
  it('the plan names exactly the partitions that hold the staged keys (the prune list)', async () => {
    await seedAwards([
      { txn: 'A', fy: 2019, date: '2019-05-01', amount: 1 },
      { txn: 'B', fy: 2026, date: '2026-07-01', amount: 1 },
      { txn: 'C', fy: 2023, date: '2023-01-01', amount: 1 }, // not staged: its partition is not read
    ]);
    await stage([
      { txn: 'A', fy: 2026, date: '2026-07-03', amount: 2 },
      { txn: 'B', fy: 2026, date: '2026-07-01', amount: 2 },
      { txn: 'N', fy: 2026, date: '2026-07-04', amount: 2 },
    ]);
    const plan = await ingestMerge('2026-06-26');
    expect(plan!.identity).toEqual({ kind: 'located', fiscalYears: [2019, 2026] });
    expect(plan!.expectedRowsAfter).toBe(3);
    expect(await total()).toBe(4);
  });

  it('nothing staged exists yet → ON FALSE: every staged row inserts, no partition is matched', async () => {
    await stage([{ txn: 'N1', fy: 2026, date: '2026-07-01', amount: 1 }, { txn: 'N2', fy: 2026, date: '2026-07-02', amount: 1 }]);
    const plan = await ingestMerge('2026-06-26');
    expect(plan!.identity).toEqual({ kind: 'located', fiscalYears: [] });
    expect(await total()).toBe(2);
  });

  it('an existing match with a NULL fiscal_year falls back to the unbounded identity — still one row', async () => {
    await seedAwards([{ txn: 'X', fy: null, date: '2026-02-01', amount: 1 }]);
    await stage([{ txn: 'X', fy: 2026, date: '2026-02-01', amount: 3 }]);
    const plan = await ingestMerge('2026-01-20');
    expect(plan!.identity).toEqual({ kind: 'unbounded' });
    expect(await rowsFor('X')).toEqual([{ fiscal_year: 2026, action_date: '2026-02-01', obligation_amount: 3, award_or_idv_flag: 'AWARD' }]);
  });

  it('a staging table with the same transaction key twice is refused before anything is written', async () => {
    await seedAwards([{ txn: 'Q', fy: 2026, date: '2026-07-01', amount: 1 }]);
    await stage([{ txn: 'K', fy: 2026, date: '2026-07-01', amount: 1 }, { txn: 'K', fy: 2026, date: '2026-07-01', amount: 2 }]);
    await expect(ingestMerge('2026-06-26')).rejects.toThrow(/staging holds 2 rows for 1 transaction keys/);
    expect(await total()).toBe(1);
  });

  it('the ASSERT rolls the whole MERGE back if a staged key gains a row (stale plan / concurrent writer)', async () => {
    await seedAwards([{ txn: 'Z', fy: 2026, date: '2026-07-01', amount: 100 }]);
    await stage([
      { txn: 'Z', fy: 2026, date: '2026-07-01', amount: 999 },
      { txn: 'X', fy: 2026, date: '2026-07-02', amount: 5 },
    ]);
    const locate = (await db.query<MergeLocateRow>(toPg(buildMergeLocateSql({ awardsTable: AWARDS, stagingFq: STAGING })))).rows[0];
    const plan = planMergeIdentity(locate);
    // A writer lands X in FY2024 between locate and MERGE: the plan never looks there, so the MERGE inserts a
    // 2nd X in FY2026. The ASSERT counts across the whole table, so it sees both copies.
    await seedAwards([{ txn: 'X', fy: 2024, date: '2024-01-01', amount: 1 }]);
    const script = toPg(buildAwardsMergeScript({ awardsTable: AWARDS, stagingFq: STAGING, plan, idvIdentityColumns: true }));
    await expect(db.exec(script)).rejects.toThrow(MERGE_IDENTITY_ASSERT_MESSAGE);
    await db.exec('ROLLBACK');
    expect(await rowsFor('Z')).toEqual([{ fiscal_year: 2026, action_date: '2026-07-01', obligation_amount: 100, award_or_idv_flag: null }]);
    expect(await rowsFor('X')).toHaveLength(1);
    expect(await total()).toBe(2);
  });

  it('the generated MERGE matches on txn_id + literal fiscal_year constants only (prunable, no source-mutable column)', () => {
    const sql = buildAwardsMergeScript({
      awardsTable: AWARDS, stagingFq: STAGING, idvIdentityColumns: true,
      plan: planMergeIdentity({ staged_rows: 2, staged_keys: 2, staged_null_fy: 0, staged_fys: ['2026'], located_rows: 1, located_keys: 1, located_null_fy: 0, located_fys: ['2025'] }),
    });
    expect(sql).toMatch(/\n\s*ON T\.txn_id = S\.txn_id AND T\.fiscal_year IN \(2025\)\n/);
    expect(sql).not.toMatch(/ON [^\n]*action_date/);
    expect(sql).toMatch(/BEGIN TRANSACTION;[\s\S]*MERGE[\s\S]*ASSERT[\s\S]*= 2\)[\s\S]*COMMIT TRANSACTION;/);
    // The guard counts staged keys across the WHOLE table — no partition filter it could share blind spots with.
    expect(sql).toMatch(/ASSERT \(\(\s*SELECT COUNT\(\*\) FROM `market-assasin\.usaspending\.awards` T\s*WHERE T\.txn_id IN \(/);
  });

  it('refuses a fiscal_year that is not a plausible integer (never rendered into SQL)', () => {
    expect(() => planMergeIdentity({ staged_rows: 1, staged_keys: 1, staged_null_fy: 0, staged_fys: ['2026'], located_rows: 1, located_keys: 1, located_null_fy: 0, located_fys: ['2026); DROP TABLE awards; --'] }))
      .toThrow(/not a count|refusing fiscal_year literal/);
  });
});
