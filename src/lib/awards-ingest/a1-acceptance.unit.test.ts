import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  A1_MERGE_REACH_FROM,
  A1_REPAIR_TO,
  assertCloneTableId,
  assertReadOnlySql,
  checkAmountWithin,
  checkDuplicatesNotIncreased,
  checkMechElec,
  checkMonthsWithinTolerance,
  checkNotNearZero,
  checkPreservation,
  checkRecipientsReconcile,
  checkRollupFreshness,
  checkZero,
  duplicateTxnSql,
  lockheedSql,
  lostTxnSql,
  malformedCodeSql,
  mechElecSql,
  monthlyCountsSql,
  overallVerdict,
  preservationSignatureSql,
  recipientsReconcileSql,
  verdictExitCode,
  VALID_AGENCY_CODE_SQL,
} from './a1-acceptance';
import { AWARDS_LEGACY_COLUMNS } from './awards-schema';

const T = '`market-assasin.usaspending.awards`';
const C = '`market-assasin.usaspending.awards_clone_pre_idv_20261005_1200`';

describe('SQL builders are single read-only SELECTs', () => {
  const all = [
    monthlyCountsSql(T), malformedCodeSql(T), preservationSignatureSql(T), lostTxnSql(T, C),
    duplicateTxnSql(T), mechElecSql(T), lockheedSql(T), recipientsReconcileSql(T, '`x.y.recipients`'),
  ];
  it('every builder passes assertReadOnlySql and contains no write keyword', () => {
    for (const sql of all) {
      expect(() => assertReadOnlySql(sql)).not.toThrow();
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE)\b/i);
    }
  });
  it('the guard refuses writes and multi-statement text', () => {
    expect(() => assertReadOnlySql('MERGE awards T USING s ON 1=1')).toThrow(/single SELECT/);
    expect(() => assertReadOnlySql('UPDATE awards SET x=1')).toThrow(/single SELECT/);
    expect(() => assertReadOnlySql('SELECT 1; DROP TABLE awards')).toThrow(/single statement/);
    expect(() => assertReadOnlySql('-- note\nSELECT 1')).not.toThrow();
  });
  it('the preservation signature excludes exactly the MERGE reach and fingerprints all 51 legacy columns', () => {
    const sql = preservationSignatureSql(T);
    expect(sql).toContain(`NOT (t.fiscal_year = 2026 AND t.action_date BETWEEN '${A1_MERGE_REACH_FROM}' AND '${A1_REPAIR_TO}')`);
    for (const c of AWARDS_LEGACY_COLUMNS) expect(sql).toContain(`t.${c.target}`);
    // SUM, not BIT_XOR: duplicate rows must not cancel each other out.
    expect(sql).toMatch(/SUM\(CAST\(FARM_FINGERPRINT/);
    expect(sql).not.toMatch(/BIT_XOR/);
    expect(sql).toMatch(/BIGNUMERIC\)\) AS STRING\) AS obligation_total/);
  });
  it('the MERGE reach starts 2 days before the first window (the MERGE target bound)', () => {
    expect(A1_MERGE_REACH_FROM).toBe('2026-01-18');
    expect(A1_REPAIR_TO).toBe('2026-05-03');
  });
});

describe('agency-code validity', () => {
  it('3- and 4-digit codes are valid; a stripped leading zero is not', () => {
    const re = /^[0-9]{3,4}$/; // mirrors VALID_AGENCY_CODE_SQL
    for (const ok of ['097', '047', '1601', '3300']) expect(re.test(ok)).toBe(true);
    for (const bad of ['97', '47', '12', '', '0097X']) expect(re.test(bad)).toBe(false);
    expect(VALID_AGENCY_CODE_SQL()).toBe("REGEXP_CONTAINS(awarding_agency_code, r'^[0-9]{3,4}$')");
  });
  it('the civilian control counts 4-digit agencies (Labor 1601 etc.)', () => {
    expect(monthlyCountsSql(T)).toContain(`awarding_agency_code != '097' AND ${VALID_AGENCY_CODE_SQL()}`);
    expect(monthlyCountsSql(T)).not.toMatch(/LENGTH\(awarding_agency_code\) = 3/);
  });
});

describe('clone table id', () => {
  it('accepts only the workflow clone naming', () => {
    expect(assertCloneTableId('awards_clone_pre_idv_20261005_1200')).toBe('awards_clone_pre_idv_20261005_1200');
    for (const bad of ['awards', 'awards_clone_pre_idv_2026', 'x; DROP TABLE awards', 'awards_clone_pre_idv_20261005_1200`']) {
      expect(() => assertCloneTableId(bad)).toThrow(/refused/);
    }
  });
});

describe('month checks', () => {
  it('±0.5% passes; just outside fails; missing data is unmeasured, never zero', () => {
    expect(checkMonthsWithinTolerance('m', [{ month: '2026-02', warehouse: 355_100, source: 355_113 }], 0.005).status).toBe('pass');
    expect(checkMonthsWithinTolerance('m', [{ month: '2026-02', warehouse: 353_000, source: 355_113 }], 0.005).status).toBe('fail');
    expect(checkMonthsWithinTolerance('m', [{ month: '2026-02', warehouse: null, source: 355_113 }], 0.005).status).toBe('unmeasured');
  });
  it('today\'s incident state fails both month checks', () => {
    const today = [
      { month: '2026-02', warehouse: 71, source: 355_113 },
      { month: '2026-03', warehouse: 74, source: 403_258 },
      { month: '2026-04', warehouse: 50, source: 398_896 },
    ];
    expect(checkMonthsWithinTolerance('m', today, 0.005).status).toBe('fail');
    expect(checkNotNearZero(today).status).toBe('fail');
  });
  it('a repaired month passes the near-zero check', () => {
    expect(checkNotNearZero([{ month: '2026-03', warehouse: 403_000, source: 403_258 }]).status).toBe('pass');
  });
});

describe('preservation is about CONTENT, not counts', () => {
  const sig = (fy: number, rows: number, obl: string, content: string) => ({ fiscal_year: fy, row_count: rows, obligation_total: obl, content_sum: content });
  it('identical signatures pass', () => {
    const s = [sig(2025, 6_635_107, '100.00', '123'), sig(2026, 2_000_000, '50.00', '456')];
    expect(checkPreservation(s, s.map((x) => ({ ...x }))).status).toBe('pass');
  });
  it('same row count + same obligations but changed content FAILS (an UPDATE keeps the count)', () => {
    const r = checkPreservation([sig(2025, 10, '100.00', '123')], [sig(2025, 10, '100.00', '999')]);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/content CHANGED/);
  });
  it('a fiscal year missing or new in live fails', () => {
    expect(checkPreservation([sig(2024, 1, '1', '1'), sig(2025, 1, '1', '1')], [sig(2025, 1, '1', '1')]).status).toBe('fail');
    expect(checkPreservation([sig(2025, 1, '1', '1')], [sig(2025, 1, '1', '1'), sig(2016, 1, '1', '1')]).status).toBe('fail');
  });
  it('no signatures is unmeasured', () => {
    expect(checkPreservation([], []).status).toBe('unmeasured');
  });
});

describe('named records', () => {
  it('Mech-Elec II needs exactly 31 orders and obligations within 0.5% of $17,001,286', () => {
    expect(checkMechElec(31, 17_001_286).status).toBe('pass');
    expect(checkMechElec(26, 8_655_978).status).toBe('fail'); // today's state
    expect(checkMechElec(31, 16_000_000).status).toBe('fail');
    expect(checkMechElec(null, null).status).toBe('unmeasured');
  });
  it('Lockheed against the live source', () => {
    expect(checkAmountWithin('l', 8_786_000_000, 8_786_400_000, 0.005).status).toBe('pass');
    expect(checkAmountWithin('l', 48_000_000, 8_786_400_000, 0.005).status).toBe('fail');
    expect(checkAmountWithin('l', 1, null, 0.005).status).toBe('unmeasured');
  });
});

describe('integrity checks', () => {
  it('zero checks: 0 passes, anything else fails, null is unmeasured', () => {
    expect(checkZero('z', 0, 'x').status).toBe('pass');
    expect(checkZero('z', 192_023, 'x').status).toBe('fail');
    expect(checkZero('z', null, 'x').status).toBe('unmeasured');
  });
  it('duplicate txn_ids may not increase', () => {
    expect(checkDuplicatesNotIncreased(130, 130).status).toBe('pass');
    expect(checkDuplicatesNotIncreased(130, 131).status).toBe('fail');
  });
  it('recipients must be rebuilt after the last awards write and reconcile within $1', () => {
    const rows = [{ uei: 'A', awards_total: '100.00', recipients_total: '100.40' }];
    expect(checkRecipientsReconcile(rows, true).status).toBe('pass');
    expect(checkRecipientsReconcile(rows, false).status).toBe('fail');
    expect(checkRecipientsReconcile([{ uei: 'A', awards_total: '100', recipients_total: '50' }], true).status).toBe('fail');
    expect(checkRecipientsReconcile([{ uei: 'A', awards_total: '100', recipients_total: null }], true).status).toBe('fail');
  });
  it('rollups built before the last awards write are STALE (pending step D), never a silent pass', () => {
    expect(checkRollupFreshness([{ table: 'top_contractors_by_dimension', lastModifiedMs: 1 }], 2).status).toBe('stale');
    expect(checkRollupFreshness([{ table: 'top_contractors_by_dimension', lastModifiedMs: 3 }], 2).status).toBe('pass');
  });
});

describe('verdict', () => {
  const r = (status: 'pass' | 'fail' | 'stale' | 'unmeasured') => ({ id: status, status, detail: '' });
  it('any fail rejects; unmeasured is never accepted; stale is pending derivatives', () => {
    expect(overallVerdict([r('pass'), r('fail'), r('stale')])).toBe('REJECTED');
    expect(overallVerdict([r('pass'), r('unmeasured')])).toBe('UNMEASURED');
    expect(overallVerdict([r('pass'), r('stale')])).toBe('ACCEPTED_PENDING_DERIVATIVES');
    expect(overallVerdict([r('pass')])).toBe('ACCEPTED');
  });
  it('only ACCEPTED exits 0', () => {
    expect(verdictExitCode('ACCEPTED')).toBe(0);
    expect(verdictExitCode('ACCEPTED_PENDING_DERIVATIVES')).toBe(2);
    expect(verdictExitCode('REJECTED')).toBe(1);
    expect(verdictExitCode('UNMEASURED')).toBe(1);
  });
});

describe('runner wiring', () => {
  const runner = readFileSync(join(process.cwd(), 'scripts/bq-awards-a1-acceptance.ts'), 'utf8');
  it('asserts read-only SQL, dry-runs every query and caps bytes billed', () => {
    expect(runner).toContain('assertReadOnlySql(sql)');
    expect(runner).toMatch(/dryRun: true/);
    expect(runner).toMatch(/maximumBytesBilled:/);
    const code = runner.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/createTable|\.insert\(|\bMERGE\b|DELETE FROM|UPDATE `/);
  });
  it('requires the pre-repair clone and never prints the credential', () => {
    expect(runner).toContain("assertCloneTableId(arg('pre-clone')");
    expect(runner).not.toMatch(/console\.(log|error)\([^)]*GCP_SA_JSON\b(?!\s*(missing|is not))/);
  });
});
