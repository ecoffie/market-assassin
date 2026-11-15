import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { assertEmittedRegex, compileOps, requestOpenSnapshotRebuild, __setOpenSnapshotForTests, REBUILD_MIN_INTERVAL_MS, VERIFY_CONCURRENCY, cachedOpenRetrieval, type OpenSnapshot } from './open-cache';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MAPS_POLICY, MCP_POLICY } from '@/lib/discovery/policy';
import { parseLogicList } from '@/lib/discovery/sql';

/** Agent 5's cache architecture review (2026-11-15), findings #1, #4, #5. Development only; the flag stays off. */
const CTX = { today: '2026-11-15', fiscalYear: 2027 };
const PHRASINGS = [
  'We clean commercial office buildings.', 'We provide nurses and medical staffing.', 'We maintain HVAC systems.', 'We provide security guards.',
  'We erect steel buildings and install metal roofing.', 'We do asphalt paving and site work.', 'We supply industrial and defense replacement parts.',
  'We supply fasteners like bolts, screws and nuts.', 'We supply electrical and electronic components.', 'We supply industrial valves.',
  'We supply medical, dental and laboratory supplies.', 'We sell computer hardware and IT equipment.',
  'We are a paving and site work contractor. We mill and pave asphalt, repair parking lots and roads, pour concrete curbs and sidewalks, stripe pavement and do grading and drainage.',
  'We are an IT hardware reseller. We sell laptops, desktops, servers, monitors, networking equipment, storage and peripherals, including installation and warranty support.',
  '"snow removal"', 'NSN 4820-01-249-1348', 'MS27183-10', 'HVAC/R maintenance', 'A&E services',
];

describe('#5 closed regex grammar: every emitted pattern is accepted; anything else makes the plan uncacheable', () => {
  it('accepts every imatch/match pattern the planner emits for the benchmark phrasings (both policies)', () => {
    let n = 0;
    for (const q of PHRASINGS) for (const pol of [MAPS_POLICY, MCP_POLICY]) {
      for (const o of buildDiscoveryPlan({ query: q }, pol, CTX).horizons.open.ops) {
        if (o.op !== 'or') continue;
        const walk = (x: any): void => { if ('lg' in x) return x.items.forEach(walk); if (x.op === 'imatch' || x.op === 'match') { n++; expect(() => assertEmittedRegex(x.val)).not.toThrow(); } }; // eslint-disable-line @typescript-eslint/no-explicit-any
        parseLogicList(o.expr).forEach(walk);
      }
    }
    expect(n).toBeGreaterThan(100);
  });
  it('rejects constructs Postgres and JS read differently', () => {
    for (const bad of ['\\mclean.\\M', '\\d+', '[[:alpha:]]+', '\\mcafé\\M', 'a{2}', '^janitorial', 'x*', '\\yword\\y']) expect(() => assertEmittedRegex(bad), bad).toThrow(/planner grammar/);
  });
  it('compileOps refuses a plan containing such a pattern (caller falls back to SQL)', () => {
    expect(() => compileOps([{ op: 'or', expr: 'title.imatch.\\mclean.\\M' } as never])).toThrow(/planner grammar/);
  });
});

/** Fake client: counts in-flight requests; every query resolves to an empty page / zero count. */
function trackingClient() {
  const st = { inFlight: 0, max: 0, builds: 0 };
  const client = {
    from() {
      const q: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'gt', 'gte', 'lte', 'lt', 'or', 'in', 'order', 'limit', 'range', 'is', 'not', 'ilike', 'like', 'neq', 'filter']) q[k] = () => q;
      q.then = (res: (v: unknown) => void) => { st.inFlight++; st.max = Math.max(st.max, st.inFlight); setTimeout(() => { st.inFlight--; res({ data: [], count: 0, error: null }); }, 2); };
      return q;
    },
  };
  return { client, st };
}

describe('#4 verification concurrency is capped', () => {
  beforeEach(() => __setOpenSnapshotForTests(null));
  it(`a broad plan (3,000 candidates → 20 id chunks) never has more than ${VERIFY_CONCURRENCY} verify requests in flight`, async () => {
    const { client, st } = trackingClient();
    const rows = Array.from({ length: 3000 }, (_, i) => ({ notice_id: `n${i}`, title: 'Custodial services', description: '', sow_text: null, department: '', sub_tier: '', solicitation_number: `S${i}`, naics_code: '561720', psc_code: 'S201', set_aside_code: null, set_aside_description: null, response_deadline: '2026-12-01' }));
    const snap: OpenSnapshot = { builtAt: '2026-11-15T11:00:00Z', rows: rows as never, count: rows.length };
    const r = await cachedOpenRetrieval({ client, plan: buildDiscoveryPlan({ query: 'janitorial services' }, MAPS_POLICY, CTX), snapshot: snap, select: '*', windowLimit: 500, now: new Date('2026-11-15T12:00:00Z') });
    expect(r.status).toBe('ok');
    expect(st.max).toBeLessThanOrEqual(VERIFY_CONCURRENCY);
  });
});

describe('#1 an overflow requests a rebuild: single-flight and rate-limited', () => {
  beforeEach(() => __setOpenSnapshotForTests(null));
  it('the first overflow starts a build; a second within the interval does not; after the interval it may', () => {
    const { client } = trackingClient();
    const t0 = new Date('2026-11-15T09:05:00Z');
    expect(requestOpenSnapshotRebuild(client, t0)).toBe(true);
    expect(requestOpenSnapshotRebuild(client, new Date(t0.getTime() + 60_000))).toBe(false);
    __setOpenSnapshotForTests(null);
    expect(requestOpenSnapshotRebuild(client, new Date(t0.getTime() + REBUILD_MIN_INTERVAL_MS + 1))).toBe(true);
  });
  it('the module documents the measured cause (guard against silently dropping the fix)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'open-cache.ts'), 'utf8');
    expect(src).toMatch(/requestOpenSnapshotRebuild\(client, now\); return sql\(/);
  });
});

describe('#2 change marker: legacy writer stamps by default; the DB-stamped column only when selected', () => {
  it('defaults to the four writer stamps; OPEN_SNAPSHOT_CHANGE_MARKER=snapshot_changed_at selects the trigger column', async () => {
    const { changeCols, CHANGE_COLS } = await import('./open-cache');
    const prev = process.env.OPEN_SNAPSHOT_CHANGE_MARKER;
    delete process.env.OPEN_SNAPSHOT_CHANGE_MARKER;
    expect(changeCols()).toEqual(CHANGE_COLS);
    process.env.OPEN_SNAPSHOT_CHANGE_MARKER = 'snapshot_changed_at';
    expect(changeCols()).toEqual(['snapshot_changed_at']);
    if (prev === undefined) delete process.env.OPEN_SNAPSHOT_CHANGE_MARKER; else process.env.OPEN_SNAPSHOT_CHANGE_MARKER = prev;
  });
  it('the draft trigger covers every snapshot column plus active (a row entering the open set is a change)', async () => {
    const { SNAPSHOT_COLS } = await import('./open-cache');
    const sql = fs.readFileSync(path.join(__dirname, '../../../tasks/search-stabilization-2026-11-14/migration-draft/snapshot_changed_at.up.sql'), 'utf8');
    for (const c of SNAPSHOT_COLS.filter((c) => c !== 'notice_id')) expect(sql, c).toMatch(new RegExp(`NEW\\.${c} IS DISTINCT FROM OLD\\.${c}`));
    expect(sql).toMatch(/NEW\.active IS DISTINCT FROM OLD\.active/);
    expect(fs.existsSync(path.join(__dirname, '../../../supabase/migrations'))).toBe(true);
    expect(fs.readdirSync(path.join(__dirname, '../../../supabase/migrations')).some((f) => f.includes('snapshot_changed_at'))).toBe(false); // never auto-applied
  });
});

describe('cut-over: with the DB change marker, a snapshot built before the trigger install is refused', () => {
  it('refuses pre-install snapshots, and every snapshot while the install time is unset', async () => {
    const { snapshotPredatesMarker } = await import('./open-cache');
    const env = { m: process.env.OPEN_SNAPSHOT_CHANGE_MARKER, s: process.env.OPEN_SNAPSHOT_MARKER_SINCE };
    const snap = (builtAt: string) => ({ builtAt, rows: [], count: 0 });
    delete process.env.OPEN_SNAPSHOT_CHANGE_MARKER; delete process.env.OPEN_SNAPSHOT_MARKER_SINCE;
    expect(snapshotPredatesMarker(snap('2026-11-15T08:00:00Z'))).toBeNull(); // legacy markers: no cut-over
    process.env.OPEN_SNAPSHOT_CHANGE_MARKER = 'snapshot_changed_at';
    expect(snapshotPredatesMarker(snap('2026-11-15T08:00:00Z'))).toMatch(/not set/);
    process.env.OPEN_SNAPSHOT_MARKER_SINCE = '2026-11-15T10:00:00Z';
    expect(snapshotPredatesMarker(snap('2026-11-15T09:59:00Z'))).toMatch(/before the change trigger/);
    expect(snapshotPredatesMarker(snap('2026-11-15T10:01:00Z'))).toBeNull();
    const r = await cachedOpenRetrieval({ client: trackingClient().client, plan: buildDiscoveryPlan({ query: 'janitorial services' }, MAPS_POLICY, CTX), snapshot: snap('2026-11-15T09:59:00Z') as never, select: '*', windowLimit: 500, now: new Date('2026-11-15T11:00:00Z') });
    expect(r).toMatchObject({ status: 'cache_unavailable' });
    for (const [k, v] of [['OPEN_SNAPSHOT_CHANGE_MARKER', env.m], ['OPEN_SNAPSHOT_MARKER_SINCE', env.s]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  it('the draft revokes EXECUTE on the trigger function from PUBLIC, anon and authenticated', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../tasks/search-stabilization-2026-11-14/migration-draft/snapshot_changed_at.up.sql'), 'utf8');
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.sam_opportunities_stamp_snapshot_change\(\) FROM PUBLIC, anon, authenticated;/);
  });
});
