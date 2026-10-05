/**
 * Production awards completeness gate — fixtures are MEASURED numbers (read-only, 2026-10-04):
 * warehouse counts from the pre-repair clone `awards_clone_pre_idv_20261004_1406` (the incident) and
 * the live repaired table, source counts from USASpending spending_by_transaction_count.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyCompletenessGate,
  formatCompletenessGate,
  settledCohortMonths,
  type WarehouseMonthRow,
} from './completeness-gate';
import { classifyFreshness } from './clocks';
import { classifyCohortCompleteness } from './cohort-completeness';
import { sourceCohortCounts, type FetchLike } from './source-counts';
import { verifyPostApply, type AwardsIngestSanitizedSnapshot } from './post-apply-verify';

// month → [dod, civilian, malformed] (warehouse) and [dod, civilian] (USASpending), 2024-10 .. 2026-09.
const W = (rows: Record<string, [number, number, number]>): WarehouseMonthRow[] =>
  Object.entries(rows).map(([month, [dod, civilian, malformed]]) => ({ month, dod, civilian, malformed }));

const HISTORY: Record<string, [number, number, number]> = {
  '2024-10': [369229, 138290, 0], '2024-11': [321636, 140995, 0], '2024-12': [310023, 147164, 0],
  '2025-01': [365120, 165192, 0], '2025-02': [369956, 162496, 0], '2025-03': [409480, 183514, 0],
  '2025-04': [414849, 198751, 0], '2025-05': [403579, 180418, 0], '2025-06': [316465, 168829, 0],
  '2025-07': [346671, 200309, 0], '2025-08': [393802, 205809, 0], '2025-09': [468330, 254144, 0],
  '2025-10': [307380, 81728, 0], '2025-11': [282077, 87672, 0], '2025-12': [336673, 167154, 0],
};
/** The incident: the pre-repair clone (2026-10-04 14:06, before A1's re-pulls). */
const INCIDENT = W({
  ...HISTORY,
  '2026-01': [276954, 166883, 0], '2026-02': [71, 160502, 0], '2026-03': [74, 180434, 0],
  '2026-04': [50, 139873, 165274], '2026-05': [345020, 160168, 26541], '2026-06': [302749, 177361, 78],
  '2026-07': [127, 195362, 101], '2026-08': [72, 189817, 29], '2026-09': [636, 181069, 0],
});
/** Live after A1 + A1b (repaired). */
const REPAIRED = W({
  ...HISTORY,
  '2026-01': [370682, 167221, 0], '2026-02': [355111, 166742, 0], '2026-03': [403246, 181521, 0],
  '2026-04': [398864, 195090, 1], '2026-05': [359359, 172820, 55], '2026-06': [302749, 177361, 78],
  '2026-07': [127, 195362, 101], '2026-08': [72, 189817, 29], '2026-09': [636, 181069, 0],
});
const SOURCE: Record<string, [number, number]> = {
  '2025-10': [309662, 81894], '2025-11': [282282, 87836], '2025-12': [337196, 167588],
  '2026-01': [370756, 167465], '2026-02': [355113, 166637], '2026-03': [403258, 181421],
  '2026-04': [398896, 194984], '2026-05': [359660, 172985], '2026-06': [336697, 177464],
  '2026-07': [27871, 195537], '2026-08': [72, 190550], '2026-09': [648, 236454],
};
function sourceMap(asOf: string, over: Partial<Record<string, number | null>> = {}): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const { cohort, month } of settledCohortMonths(asOf)) {
    const s = SOURCE[month];
    m.set(`${cohort}|${month}`, s ? (cohort === 'dod' ? s[0] : s[1]) : null);
  }
  for (const [k, v] of Object.entries(over)) m.set(k, v ?? null);
  return m;
}
const ASOF = '2026-10-04';

describe('production completeness gate — the A1 incident and its controls', () => {
  it('THE INCIDENT (Feb–Apr DoD ≈ empty, MAX(action_date) current) → WAREHOUSE_HOLE → FAIL', () => {
    const r = classifyCompletenessGate({ asOf: ASOF, warehouse: INCIDENT, source: sourceMap(ASOF), stagedMalformed: 0 });
    expect(r.verdict).toBe('fail');
    expect(r.holes.map((h) => `${h.cohort} ${h.month} ${h.warehouse_count}/${h.source_count}`)).toEqual([
      'dod 2026-02 71/355113', 'dod 2026-03 74/403258', 'dod 2026-04 50/398896',
    ]);
    // Jan (74.7% of source) is drift, not a hole — the threshold is catastrophic-only.
    expect(r.months.find((m) => m.cohort === 'dod' && m.month === '2026-01')!.status).toBe('OK');
    const log = formatCompletenessGate(r).join('\n');
    expect(log).toContain('completeness cohort=dod month=2026-02 source_count=355113 warehouse_count=71 status=WAREHOUSE_HOLE');
    expect(log).toContain('completeness verdict=FAIL');
  });

  it('the malformed "97" DoD rows are never counted as civilian (April civilian is not inflated by 165,274)', () => {
    const r = classifyCompletenessGate({ asOf: ASOF, warehouse: INCIDENT, source: sourceMap(ASOF), stagedMalformed: 0 });
    expect(r.months.find((m) => m.cohort === 'civilian' && m.month === '2026-04')!.warehouse_count).toBe(139873);
    expect(r.warehouseMalformed).toBe(192023);
  });

  it('OLD BEHAVIOUR: the same incident state passes main\'s production checks (fresh MAX(action_date) = healthy)', () => {
    // What main's ingest + post-apply verify decide on this state: MAX(action_date) advanced, row count
    // grew, clocks stamped → ok. Nothing on that path looks at historical months.
    const snap = (max: string, rows: number): AwardsIngestSanitizedSnapshot => ({
      awardsMaxActionDate: max, awardsRowCount: rows, recipientsMaxLastActionDate: max,
      recipientsRollupMergedMaxLastActionDate: max, dataSourcesLastBuilt: '2026-09-27', hasV1ClockBlock: true,
      mergedAt: '2026-09-27T17:00:00Z', recipientsRebuiltAt: '2026-09-27T17:30:00Z', freshnessStatus: 'healthy',
      freshnessLegacyUnmeasured: false,
    });
    const v = verifyPostApply(snap('2026-09-18', 64_000_000), snap('2026-09-25', 65_174_036));
    expect(v.ok).toBe(true);
    const fresh = classifyFreshness({
      clocks: { sourceActionMax: '2026-09-25', acquiredAt: '2026-09-27T16:00:00Z', mergedAt: '2026-09-27T17:00:00Z', recipientsRebuiltAt: '2026-09-27T17:30:00Z' },
      now: '2026-09-28T00:00:00Z',
    });
    expect(fresh.status).toBe('healthy');
  });

  it('fresh MAX(action_date) does not rescue a historical hole (newer DoD + civilian rows present)', () => {
    const fresher = INCIDENT.map((r) => (r.month === '2026-09' ? { ...r, dod: 50_000, civilian: 240_000 } : r));
    const r = classifyCompletenessGate({ asOf: ASOF, warehouse: fresher, source: sourceMap(ASOF), stagedMalformed: 0 });
    expect(r.verdict).toBe('fail');
    expect(r.holes).toHaveLength(3);
  });

  it('the REPAIRED Jan–Apr population → no hole (passes, with the known malformed-row debt as a warning)', () => {
    const r = classifyCompletenessGate({ asOf: ASOF, warehouse: REPAIRED, source: sourceMap(ASOF), stagedMalformed: 0 });
    expect(r.holes).toEqual([]);
    expect(r.failures).toEqual([]);
    expect(r.verdict).toBe('warn');
    expect(r.warnings).toEqual(['integrity debt: 264 warehouse row(s) in the last 24 months carry a malformed awarding_agency_code (not cleaned here)']);
  });

  it('legitimate DoD source lag (Aug 2026: 72 in the warehouse, 72 at USASpending) → SOURCE_LAG, not a hole', () => {
    // Judge August once settled for DoD (Aug 31 + 120 days). The old oracle calls this a HOLE
    // (72 vs 393,802 a year earlier); the source shows the warehouse is complete.
    const asOf = '2027-01-05';
    const warehouse = W({
      ...HISTORY, '2025-09': [468330, 254144, 0],
      '2026-01': [370682, 167221, 0], '2026-02': [355111, 166742, 0], '2026-03': [403246, 181521, 0],
      '2026-04': [398864, 195090, 0], '2026-05': [359359, 172820, 0], '2026-06': [336600, 177361, 0],
      '2026-07': [27800, 195362, 0], '2026-08': [72, 189817, 0], '2026-09': [648, 236000, 0],
      '2026-10': [300000, 150000, 0], '2026-11': [280000, 140000, 0], '2026-12': [10, 10, 0],
    });
    const src = sourceMap(asOf, { 'dod|2026-10': null, 'civilian|2026-10': 150100, 'civilian|2026-11': 140100 });
    const r = classifyCompletenessGate({ asOf, warehouse, source: src, stagedMalformed: 0 });
    const aug = r.months.find((m) => m.cohort === 'dod' && m.month === '2026-08')!;
    expect(aug.status).toBe('SOURCE_LAG');
    expect(r.months.find((m) => m.cohort === 'dod' && m.month === '2026-07')!.status).toBe('SOURCE_LAG');
    expect(r.holes).toEqual([]);
    expect(r.verdict).toBe('warn');
    expect(formatCompletenessGate(r).join('\n')).toContain('completeness cohort=dod month=2026-08 source_count=72 warehouse_count=72 status=SOURCE_LAG');
    // The old warehouse-only oracle calls the same months HOLES — the false alarm this gate removes.
    const old = classifyCohortCompleteness(
      warehouse.flatMap((w) => [{ cohort: 'dod' as const, month: w.month, n: w.dod }, { cohort: 'civilian' as const, month: w.month, n: w.civilian }]), asOf);
    expect(old.status).toBe('incomplete');
    expect(old.status === 'incomplete' && old.holes.map((h) => `${h.cohort} ${h.month}`)).toEqual(['dod 2026-07', 'dod 2026-08']);
  });

  it('recent DoD months inside the publication lag are NOT_SETTLED and never fail (Jul 2026: 127 vs 27,871 today)', () => {
    const r = classifyCompletenessGate({ asOf: ASOF, warehouse: REPAIRED, source: sourceMap(ASOF), stagedMalformed: 0 });
    for (const m of ['2026-06', '2026-07', '2026-08', '2026-09']) {
      expect(r.months.find((x) => x.cohort === 'dod' && x.month === m)!.status).toBe('NOT_SETTLED');
    }
  });

  it('a healthy civilian cohort → OK on every settled month', () => {
    const r = classifyCompletenessGate({ asOf: ASOF, warehouse: REPAIRED, source: sourceMap(ASOF), stagedMalformed: 0 });
    const civ = r.months.filter((m) => m.cohort === 'civilian' && m.status !== 'NOT_SETTLED');
    expect(civ.length).toBeGreaterThan(5);
    expect(civ.every((m) => m.status === 'OK')).toBe(true);
  });

  it('a malformed agency code in THIS run\'s staged rows is an integrity FAILURE', () => {
    const r = classifyCompletenessGate({ asOf: ASOF, warehouse: REPAIRED, source: sourceMap(ASOF), stagedMalformed: 3 });
    expect(r.verdict).toBe('fail');
    expect(r.failures).toEqual(['INTEGRITY: 3 staged row(s) carry a malformed awarding_agency_code (valid = 3 or 4 digits)']);
    expect(classifyCompletenessGate({ asOf: ASOF, warehouse: REPAIRED, source: sourceMap(ASOF), stagedMalformed: null }).verdict).toBe('fail');
  });

  it('source API unavailable → never healthy: settled months are UNMEASURED and the gate fails closed', () => {
    const r = classifyCompletenessGate({ asOf: ASOF, warehouse: REPAIRED, source: new Map(), stagedMalformed: 0 });
    expect(r.verdict).toBe('fail');
    expect(r.holes).toEqual([]);
    expect(r.unmeasured.length).toBe(settledCohortMonths(ASOF).length);
    expect(r.failures[0]).toMatch(/^verification unavailable for \d+ settled cohort-month\(s\)/);
  });

  it('the source adapter returns null (never 0) when USASpending is unreachable or answers without a count', async () => {
    const down: FetchLike = async () => { throw new Error('ECONNRESET'); };
    expect(await sourceCohortCounts('2026-02', down, 0)).toEqual({ dod: null, civilian: null });
    const empty: FetchLike = async () => ({ ok: true, json: async () => ({}) });
    expect(await sourceCohortCounts('2026-02', empty, 0)).toEqual({ dod: null, civilian: null });
    const ok: FetchLike = async (_u, init) => ({ ok: true, json: async () => ({ results: JSON.parse(init.body).filters.agencies ? { contracts: 355000, idvs: 113 } : { contracts: 521000, idvs: 750 } }) });
    expect(await sourceCohortCounts('2026-02', ok, 0)).toEqual({ dod: 355113, civilian: 166637 });
  });
});

describe('the gate is ON the production publication path', () => {
  const script = readFileSync(join(process.cwd(), 'scripts/ingest-usaspending-awards.ts'), 'utf8');
  it('runs after the recipients rebuild and BEFORE the freshness/clock stamp, and fails the run on fail', () => {
    const rebuild = script.indexOf("failedAt: 'rebuild_recipients'");
    const gate = script.indexOf('await runCompletenessGate(');
    const stamp = script.indexOf(".from('data_sources')");
    expect(rebuild).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(rebuild);
    expect(stamp).toBeGreaterThan(gate);
    expect(script).toMatch(/if \(gate\.verdict === 'fail'\)[\s\S]{0,400}throw new Error/);
  });
});
