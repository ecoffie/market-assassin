import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => ({}), getReadClient: () => ({}) }));
import { bucketForRecord, buildParentQuery, getVehicleSpendMix, heuristicBucket, resolveAgency, type ParentTypeRecord } from './vehicle-spend-mix';
import type { ScopedAggregateDeps } from '@/lib/bigquery/scoped-aggregate';
import { annotateResultContract } from '@/lib/mcp/result-contract';
import { toolParameters } from '@/lib/mcp/tool-registry';

const NOW = new Date('2026-11-14T00:00:00Z');

const PARENT_ROWS = [
  { parent_piid: '36C10X24D0008', obligated: 400, award_count: 10, as_of: { value: '2026-09-30' } }, // VA IDIQ (verified)
  { parent_piid: '36F79722D0185', obligated: 300, award_count: 20, as_of: null }, // VA FSS (verified)
  { parent_piid: null, obligated: 150, award_count: 30, as_of: null }, // standalone
  { parent_piid: '47QREA21D001D', obligated: 60, award_count: 5, as_of: null }, // GSA FSS (verified)
  { parent_piid: '36C26223A0002', obligated: 40, award_count: 4, as_of: null }, // VA BPA (verified)
  { parent_piid: 'GS07F0165W', obligated: 30, award_count: 3, as_of: null }, // unverified -> heuristic GSA schedule
  { parent_piid: '2033H625A00014', obligated: 15, award_count: 2, as_of: null }, // unverified -> heuristic other BPA
  { parent_piid: '75H70623D00038', obligated: 10, award_count: 1, as_of: null }, // unverified, D = ambiguous -> unresolved
  { parent_piid: '36C26018G0029', obligated: -5, award_count: 1, as_of: null }, // unverified -> heuristic BOA (negative)
];

const TYPES: Record<string, ParentTypeRecord[]> = {
  '36C10X24D0008': [{ type: 'INDEFINITE DELIVERY / INDEFINITE QUANTITY', agency: 'Department of Veterans Affairs' }],
  '36F79722D0185': [{ type: 'FSS', agency: 'Department of Veterans Affairs' }],
  '47QREA21D001D': [{ type: 'FSS', agency: 'General Services Administration' }],
  '36C26223A0002': [{ type: 'BPA', agency: 'Department of Veterans Affairs' }],
};

function bqDeps(opts: { bytes?: number; fail?: boolean; rows?: unknown[] } = {}): { d: ScopedAggregateDeps; calls: Array<{ query: string; params: Record<string, unknown> }> } {
  const calls: Array<{ query: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    d: {
      dryRun: vi.fn(async () => ({ bytesProcessed: opts.bytes ?? 1024 ** 3 })),
      run: vi.fn(async (o: { query: string; params: Record<string, unknown> }) => {
        calls.push(o);
        if (opts.fail) return { rows: [], state: 'failed' as const };
        return { rows: (opts.rows ?? PARENT_ROWS) as never[], state: 'hit' as const };
      }) as ScopedAggregateDeps['run'],
    },
  };
}

/** Verifies only the four largest parents, like a lookup budget that ran out. */
const lookup = vi.fn(async (piids: string[]) => {
  const m = new Map<string, ParentTypeRecord[]>();
  for (const p of piids) if (TYPES[p]) m.set(p, TYPES[p]);
  return m;
});

describe('get_vehicle_spend_mix', () => {
  it('splits the market into vehicle buckets that sum to the direct total', async () => {
    const { d } = bqDeps();
    const r = await getVehicleSpendMix({ naics: '561320' }, { bq: d, lookupParentTypes: lookup }, NOW);
    const direct = PARENT_ROWS.reduce((s, x) => s + x.obligated, 0);
    expect(r.total_obligated).toBe(direct);
    expect(r.buckets.reduce((s, b) => s + b.obligated, 0)).toBeCloseTo(direct, 6);
    expect(r.buckets.reduce((s, b) => s + b.share_pct, 0)).toBeCloseTo(100, 0);
    const by = Object.fromEntries(r.buckets.map((b) => [b.bucket, b]));
    expect(by.agency_idiq).toMatchObject({ obligated: 400, verified_obligated: 400, heuristic_obligated: 0 });
    expect(by.va_schedule).toMatchObject({ obligated: 300, verified_obligated: 300 });
    expect(by.gsa_schedule).toMatchObject({ obligated: 90, verified_obligated: 60, heuristic_obligated: 30 });
    expect(by.va_bpa).toMatchObject({ obligated: 40, verified_obligated: 40 });
    expect(by.other_bpa).toMatchObject({ obligated: 15, heuristic_obligated: 15 });
    expect(by.standalone).toMatchObject({ obligated: 150, parent_count: 0, award_count: 30 });
    expect(by.unresolved).toMatchObject({ obligated: 10 });
    expect(by.boa.obligated).toBe(-5);
    for (const b of r.buckets) expect(b.rule.length).toBeGreaterThan(20);
    expect(r.rollups.all_schedules.obligated).toBe(390);
    expect(r.rollups.all_bpas.obligated).toBe(55);
    expect(r.classification).toMatchObject({ parent_count: 8, parents_verified: 4, verification_failed: false });
    expect(r._meta).toMatchObject({ grounded: true, degraded: false, as_of: '2026-09-30' });
    expect(r._meta.applied_filters).toMatchObject({ naics: ['561320'], fiscal_year_from: 2024, fiscal_year_to: 2026 });
  });

  it('never types a parent the lookup reported ambiguously (two agencies, two types)', async () => {
    const { d } = bqDeps({ rows: [{ parent_piid: '36C10X24D0008', obligated: 10, award_count: 1, as_of: null }] });
    const ambiguous = vi.fn(async () => new Map([['36C10X24D0008', [
      { type: 'FSS', agency: 'Department of Veterans Affairs' },
      { type: 'BPA', agency: 'Department of Veterans Affairs' },
    ]]]));
    const r = await getVehicleSpendMix({ naics: '561320' }, { bq: d, lookupParentTypes: ambiguous }, NOW);
    expect(r.buckets.map((b) => b.bucket)).toEqual(['unresolved']);
  });

  it('a failed lookup falls back to heuristic/unresolved, still sums, and says so', async () => {
    const { d } = bqDeps();
    const failing = vi.fn(async () => { throw new Error('USASpending 503'); });
    const r = await getVehicleSpendMix({ naics: '561320' }, { bq: d, lookupParentTypes: failing }, NOW);
    expect(r.classification.verification_failed).toBe(true);
    expect(r._meta.incomplete_reason).toMatch(/lookups failed/);
    expect(r.buckets.reduce((s, b) => s + b.obligated, 0)).toBeCloseTo(r.total_obligated, 6);
    const annotated = annotateResultContract(r, { naics: '561320' }, toolParameters('get_vehicle_spend_mix'));
    expect(annotated._meta.result_state).toBe('partial');
  });

  it('refuses an over-budget scan as unavailable, never a zero', async () => {
    const { d } = bqDeps({ bytes: 20 * 1024 ** 3 });
    const r = await getVehicleSpendMix({ naics: '5' + '6' }, { bq: d, lookupParentTypes: lookup }, NOW);
    expect(r._meta).toMatchObject({ result_state: 'unavailable', degraded: true, incomplete_reason: 'scope_too_broad' });
  });

  it('a BigQuery failure is degraded', async () => {
    const { d } = bqDeps({ fail: true });
    const r = await getVehicleSpendMix({ naics: '561320' }, { bq: d, lookupParentTypes: lookup }, NOW);
    expect(r._meta).toMatchObject({ result_state: 'unavailable', degraded: true });
  });

  it('requires naics (non-billable validation error)', async () => {
    const { d } = bqDeps();
    const r = await getVehicleSpendMix({}, { bq: d, lookupParentTypes: lookup }, NOW);
    expect(r._meta.validation_error).toBeTruthy();
    expect(d.dryRun).not.toHaveBeenCalled();
  });

  it('applies agency and state inside the query, agency by exact name (never substring)', async () => {
    const { d, calls } = bqDeps();
    await getVehicleSpendMix({ naics: '561320', agency: 'VA', state: 'Tennessee' }, { bq: d, lookupParentTypes: lookup }, NOW);
    expect(calls[0].params).toMatchObject({ agency: 'Department of Veterans Affairs', state: 'TN' });
    const q = buildParentQuery({ hasState: true, hasAgency: true, windowSql: 'fiscal_year BETWEEN @fyFrom AND @fyTo' });
    expect(q).toContain('LOWER(awarding_agency) = LOWER(@agency)');
    expect(q).not.toMatch(/STRPOS\([^)]*agency/i);
  });
});

describe('classification rules', () => {
  it('maps USASpending contract award types', () => {
    expect(bucketForRecord({ type: 'FSS', agency: 'General Services Administration' })).toBe('gsa_schedule');
    expect(bucketForRecord({ type: 'FSS', agency: 'Department of Veterans Affairs' })).toBe('va_schedule');
    expect(bucketForRecord({ type: 'BPA', agency: 'Department of the Treasury' })).toBe('other_bpa');
    expect(bucketForRecord({ type: 'GWAC', agency: 'General Services Administration' })).toBe('gwac');
    expect(bucketForRecord({ type: 'INDEFINITE DELIVERY / REQUIREMENTS', agency: 'Department of Defense' })).toBe('agency_idiq');
    expect(bucketForRecord({ type: 'INDEFINITE DELIVERY / INDEFINITE QUANTITY', agency: 'General Services Administration' })).toBe('gsa_idiq');
    expect(bucketForRecord({ type: 'something else', agency: null })).toBeNull();
  });

  it('PIID heuristic only fires on unambiguous patterns', () => {
    expect(heuristicBucket('GS-07F-0165W')).toBe('gsa_schedule');
    expect(heuristicBucket('V797D50442')).toBe('va_schedule');
    expect(heuristicBucket('36C24919A0012')).toBe('va_bpa');
    expect(heuristicBucket('2033H625A00014')).toBe('other_bpa');
    expect(heuristicBucket('N0017322G2001')).toBe('boa');
    // D is both a schedule (VA FSS 36F797..D..) and an IDIQ: never guessed.
    expect(heuristicBucket('75H70623D00038')).toBeNull();
    expect(heuristicBucket('47QRAA20D001H')).toBeNull();
  });

  it('resolves agency abbreviations to the warehouse name', () => {
    expect(resolveAgency('VA').name).toBe('Department of Veterans Affairs');
    expect(resolveAgency('Department of the Navy').name).toBe('Department of the Navy');
  });
});
