import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCohortMonthlyCountsSql,
  classifyCohortCompleteness,
  describeCohortHoles,
  type CohortMonthRow,
} from './cohort-completeness';
import { resolveDenseFrontier, resolveIngestWindowStart, LAGGARD_CONTINUITY_SLACK_DAYS } from './ingest-window';
import { buildAwardsMergeSql, IDV_IDENTITY_COLUMNS, resolveIdvIdentityColumnsMode } from './merge-sql';
import { AWARDS_LEGACY_COLUMNS } from './awards-schema';

/**
 * MEASURED 2026-09-23 (read-only BigQuery, 0.126 GiB): transactions per month in
 * `market-assasin.usaspending.awards`, DoD (awarding_agency_code 097) vs everyone else.
 * MAX(action_date) on this state was 2026-09-18 — the freshness oracle printed healthy.
 */
const MEASURED_2026_09_23: Array<[CohortMonthRow['cohort'], string, number]> = [
  ['civilian', '2024-10', 138291], ['civilian', '2024-11', 140995], ['civilian', '2024-12', 147165],
  ['civilian', '2025-01', 165195], ['civilian', '2025-02', 162501], ['civilian', '2025-03', 183516],
  ['civilian', '2025-04', 198752], ['civilian', '2025-05', 180418], ['civilian', '2025-06', 168829],
  ['civilian', '2025-07', 200311], ['civilian', '2025-08', 205813], ['civilian', '2025-09', 254153],
  ['civilian', '2025-10', 81729], ['civilian', '2025-11', 87676], ['civilian', '2025-12', 167159],
  ['civilian', '2026-01', 166883], ['civilian', '2026-02', 160502], ['civilian', '2026-03', 180434],
  ['civilian', '2026-04', 305147], ['civilian', '2026-05', 186709], ['civilian', '2026-06', 177356],
  ['civilian', '2026-07', 195205], ['civilian', '2026-08', 188769], ['civilian', '2026-09', 114278],
  ['dod', '2024-10', 369229], ['dod', '2024-11', 321637], ['dod', '2024-12', 310024],
  ['dod', '2025-01', 365121], ['dod', '2025-02', 369957], ['dod', '2025-03', 409484],
  ['dod', '2025-04', 414853], ['dod', '2025-05', 403580], ['dod', '2025-06', 316465],
  ['dod', '2025-07', 346676], ['dod', '2025-08', 393806], ['dod', '2025-09', 468336],
  ['dod', '2025-10', 307382], ['dod', '2025-11', 282078], ['dod', '2025-12', 336678],
  ['dod', '2026-01', 276954], ['dod', '2026-02', 71], ['dod', '2026-03', 74],
  ['dod', '2026-04', 50], ['dod', '2026-05', 345020], ['dod', '2026-06', 227065],
  ['dod', '2026-07', 127], ['dod', '2026-08', 72], ['dod', '2026-09', 619],
];
const rows = (data: typeof MEASURED_2026_09_23): CohortMonthRow[] =>
  data.map(([cohort, month, n]) => ({ cohort, month, n }));

describe('cohort completeness — the second derivation the freshness oracle lacked', () => {
  it('FAILS on the measured 2026-09-23 warehouse: DoD Feb/Mar/Apr 2026 are holes', () => {
    const r = classifyCohortCompleteness(rows(MEASURED_2026_09_23), '2026-09-23');
    expect(r.status).toBe('incomplete');
    if (r.status !== 'incomplete') throw new Error('unreachable');
    expect(r.holes.map((h) => `${h.cohort} ${h.month}`)).toEqual(['dod 2026-02', 'dod 2026-03', 'dod 2026-04']);
    expect(describeCohortHoles(r)).toContain('dod 2026-03 74 vs 409,484');
  });

  it('does not judge months inside the cohort publication lag (DoD Jun–Sep 2026 are not_settled)', () => {
    const r = classifyCohortCompleteness(rows(MEASURED_2026_09_23), '2026-09-23');
    if (r.status === 'unmeasured') throw new Error('unreachable');
    const dod = r.months.filter((m) => m.cohort === 'dod');
    for (const m of ['2026-06', '2026-07', '2026-08', '2026-09']) {
      expect(dod.find((x) => x.month === m)?.verdict).toBe('not_settled');
    }
  });

  it('tolerates real volume events: the Oct–Nov 2025 shutdown (civilian 0.59/0.62) is not a hole', () => {
    const r = classifyCohortCompleteness(rows(MEASURED_2026_09_23), '2026-09-23');
    if (r.status === 'unmeasured') throw new Error('unreachable');
    const civ = r.months.filter((m) => m.cohort === 'civilian' && (m.month === '2025-10' || m.month === '2025-11'));
    expect(civ.every((m) => m.verdict === 'ok')).toBe(true);
  });

  it('PASSES once the DoD hole is backfilled (same data, Feb–Apr at prior-year scale)', () => {
    const repaired = MEASURED_2026_09_23.map(([c, m, n]) =>
      (c === 'dod' && ['2026-02', '2026-03', '2026-04'].includes(m) ? [c, m, 380_000] : [c, m, n]) as typeof MEASURED_2026_09_23[number]);
    const r = classifyCohortCompleteness(rows(repaired), '2026-09-23');
    expect(r.status).toBe('complete');
  });

  it('a month with NO rows at all is a hole (counted as 0), not skipped', () => {
    const missing = MEASURED_2026_09_23.filter(([c, m]) => !(c === 'civilian' && m === '2026-03'));
    const r = classifyCohortCompleteness(rows(missing), '2026-09-23');
    if (r.status !== 'incomplete') throw new Error(`expected incomplete, got ${r.status}`);
    expect(r.holes.some((h) => h.cohort === 'civilian' && h.month === '2026-03' && h.current === 0)).toBe(true);
  });

  it('no data → unmeasured (never a pass by default)', () => {
    expect(classifyCohortCompleteness([], '2026-09-23').status).toBe('unmeasured');
  });

  it('SQL scopes by the partition column and splits DoD by agency code 097', () => {
    const sql = buildCohortMonthlyCountsSql('`p.d.awards`', '2026-09-23');
    expect(sql).toMatch(/awarding_agency_code = '097'/);
    expect(sql).toMatch(/WHERE action_date BETWEEN/);
    expect(sql).toMatch(/INTERVAL 24 MONTH/);
  });
});

describe('ingest window — anchored on the laggard cohort, not only the global max', () => {
  it('today\'s state: DoD dense frontier 2026-06-21 pulls the start 3 days earlier than the global rule', () => {
    const w = resolveIngestWindowStart({
      globalMax: '2026-09-18', laggardMaxes: { '097': '2026-06-21' },
      correctionDays: 100, laggardSlackDays: LAGGARD_CONTINUITY_SLACK_DAYS,
    });
    expect(w).toEqual({ startDate: '2026-06-07', anchor: 'laggard:097', unmeasuredLaggards: [], cappedLaggards: [] });
  });

  it('a DoD frontier stuck far back (2026-01-25) is CAPPED in the weekly path and reported for a manual backfill', () => {
    // State after the 2026-04-23 snapshot: civilian fresh, DoD dense data ending 2026-01-24.
    // The weekly run must stay inside its acquisition budget, so it does NOT re-pull 7 months;
    // it keeps the global start and names the cohort (repair = the one-time --from backfill).
    const w = resolveIngestWindowStart({
      globalMax: '2026-08-01', laggardMaxes: { '097': '2026-01-25' },
      correctionDays: 100, laggardSlackDays: LAGGARD_CONTINUITY_SLACK_DAYS,
    });
    expect(w).toEqual({ startDate: '2026-04-23', anchor: 'global', unmeasuredLaggards: [], cappedLaggards: ['097'] });
    // An explicit, larger cap (a deliberate backfill) reaches it.
    const wide = resolveIngestWindowStart({
      globalMax: '2026-08-01', laggardMaxes: { '097': '2026-01-25' },
      correctionDays: 100, laggardSlackDays: LAGGARD_CONTINUITY_SLACK_DAYS, maxLaggardExtensionDays: 365,
    });
    expect(wide.startDate).toBe('2026-01-11');
    expect(wide.anchor).toBe('laggard:097');
    // The legacy rule (global − 100) started at 2026-04-23 and never reached the hole.
    expect(resolveIngestWindowStart({ globalMax: '2026-08-01', laggardMaxes: {}, correctionDays: 100, laggardSlackDays: 14 }).startDate)
      .toBe('2026-04-23');
  });

  it('a laggard with no measurable frontier is reported, not silently treated as current', () => {
    const w = resolveIngestWindowStart({ globalMax: '2026-09-18', laggardMaxes: { '097': null }, correctionDays: 100, laggardSlackDays: 14 });
    expect(w.anchor).toBe('global');
    expect(w.unmeasuredLaggards).toEqual(['097']);
  });

  it('Sunday 2026-09-27 (no writes before it): 2026-06-07 → today, 3 days earlier than the legacy 2026-06-10', () => {
    const legacy = resolveIngestWindowStart({ globalMax: '2026-09-18', laggardMaxes: {}, correctionDays: 100, laggardSlackDays: 14 });
    const next = resolveIngestWindowStart({ globalMax: '2026-09-18', laggardMaxes: { '097': '2026-06-21' }, correctionDays: 100, laggardSlackDays: 14 });
    expect(legacy.startDate).toBe('2026-06-10');
    expect(next.startDate).toBe('2026-06-07');
    expect(next.cappedLaggards).toEqual([]);
  });
});

describe('MERGE retains IDV vehicle identity (additive, schema-gated)', () => {
  const base = { awardsTable: '`market-assasin.usaspending.awards`', stagingFq: 'market-assasin.usaspending.awards_ingest_staging', startDate: '2026-06-07' };

  it('GOLDEN: without the DDL the MERGE is byte-identical to the pre-#1658 statement (origin/main 45e3cfba)', () => {
    // Generated from origin/main's merge-sql.ts (unchanged since #1396) with these exact inputs —
    // the statement the scheduled weekly ingest runs today against the 51-column table.
    const golden = readFileSync(join(__dirname, '__fixtures__', 'merge-sql-pre-1658.golden.sql'), 'utf8');
    expect(buildAwardsMergeSql(base)).toBe(golden);
    expect(buildAwardsMergeSql({ ...base, idvIdentityColumns: false })).toBe(golden);
  });

  it('without the DDL the MERGE is byte-for-byte the legacy 41-column statement', () => {
    const legacy = buildAwardsMergeSql(base);
    expect(buildAwardsMergeSql({ ...base, idvIdentityColumns: false })).toBe(legacy);
    for (const c of IDV_IDENTITY_COLUMNS) expect(legacy).not.toContain(c.target);
  });

  it('with the DDL it projects, updates and inserts every identity column', () => {
    const sql = buildAwardsMergeSql({ ...base, idvIdentityColumns: true });
    expect(sql).toContain(`SAFE_CAST(NULLIF(ordering_period_end_date, '') AS DATE) AS ordering_period_end_date`);
    expect(sql).toContain(`CAST(NULLIF(solicitation_identifier, '') AS STRING) AS solicitation_identifier`);
    for (const c of IDV_IDENTITY_COLUMNS) {
      expect(sql).toContain(`${c.target}=S.${c.target}`);
      expect(sql).toContain(`, S.${c.target}`);
    }
    // Same MERGE key + partition bound as before.
    expect(sql).toContain(`ON T.txn_id = S.txn_id AND T.action_date >= DATE_SUB(DATE('2026-06-07'), INTERVAL 2 DAY)`);
  });

  it('schema gate: none → absent, all → present, partial → refuses', () => {
    const legacyCols = AWARDS_LEGACY_COLUMNS.map((c) => ({ name: c.target, dataType: c.type }));
    const idvCols = IDV_IDENTITY_COLUMNS.map((c) => ({ name: c.target, dataType: c.type }));
    expect(resolveIdvIdentityColumnsMode(legacyCols, { required: false })).toBe('absent');
    expect(resolveIdvIdentityColumnsMode([...legacyCols, ...idvCols], { required: false })).toBe('present');
    expect(() => resolveIdvIdentityColumnsMode([...legacyCols, idvCols[0]], { required: false })).toThrow(/PARTIAL/);
  });
});

describe('DoD dense frontier — MAX(action_date) is not where DoD data ends', () => {
  /** MEASURED 2026-09-23 (0.126 GiB): DoD (097) transactions per Monday-week, trailing 392 days. */
  const DOD_WEEKS: Array<[string, number]> = [['2025-08-25', 57843], ['2025-09-01', 90406], ['2025-09-08', 114202], ['2025-09-15', 115117], ['2025-09-22', 114766], ['2025-09-29', 73692], ['2025-10-06', 57857], ['2025-10-13', 60080], ['2025-10-20', 72744], ['2025-10-27', 78581], ['2025-11-03', 79181], ['2025-11-10', 67371], ['2025-11-17', 84001], ['2025-11-24', 49798], ['2025-12-01', 92929], ['2025-12-08', 97109], ['2025-12-15', 87001], ['2025-12-22', 28822], ['2025-12-29', 39183], ['2026-01-05', 88245], ['2026-01-12', 96369], ['2026-01-19', 83949], ['2026-01-26', 25], ['2026-02-02', 10], ['2026-02-09', 18], ['2026-02-16', 23], ['2026-02-23', 21], ['2026-03-02', 20], ['2026-03-09', 20], ['2026-03-16', 13], ['2026-03-23', 15], ['2026-03-30', 10], ['2026-04-06', 10], ['2026-04-13', 22], ['2026-04-20', 13], ['2026-04-27', 837], ['2026-05-04', 94977], ['2026-05-11', 93774], ['2026-05-18', 81657], ['2026-05-25', 73775], ['2026-06-01', 82703], ['2026-06-08', 80992], ['2026-06-15', 63355], ['2026-06-22', 8], ['2026-06-29', 10], ['2026-07-06', 37], ['2026-07-13', 38], ['2026-07-20', 30], ['2026-07-27', 19], ['2026-08-03', 17], ['2026-08-10', 23], ['2026-08-17', 15], ['2026-08-24', 16], ['2026-08-31', 300], ['2026-09-07', 16], ['2026-09-14', 304]];
  const weeks = DOD_WEEKS.map(([week, n]) => ({ week, n }));

  it('MAX would say 2026-09-18 (a 304-row trickle); the dense frontier is 2026-06-21', () => {
    expect(resolveDenseFrontier(weeks, '2026-09-23')).toBe('2026-06-21');
  });

  it('the baseline survives the hole it is looking for (13 near-empty settled weeks)', () => {
    const settledHoleWeeks = DOD_WEEKS.filter(([w, n]) => w >= '2026-01-26' && w <= '2026-04-27' && n < 1000).length;
    expect(settledHoleWeeks).toBeGreaterThanOrEqual(13);
    expect(resolveDenseFrontier(weeks, '2026-09-23')).not.toBe('2026-09-20');
  });

  it('as the snapshot left it (data to 2026-01-24, then a trickle) → frontier 2026-01-25', () => {
    const afterSnapshot = weeks.filter((w) => w.week <= '2026-04-20');
    expect(resolveDenseFrontier(afterSnapshot, '2026-08-01')).toBe('2026-01-25');
  });

  it('too little settled history → null (unmeasured), never "current"', () => {
    expect(resolveDenseFrontier(weeks.slice(-6), '2026-09-23')).toBeNull();
  });
});
