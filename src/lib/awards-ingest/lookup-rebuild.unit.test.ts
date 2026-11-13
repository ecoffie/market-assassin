/** Atomic award lookup rebuild (2026-11-13): production is only ever replaced by a validated copy. */
import { describe, expect, it } from 'vitest';
import { rebuildLookups, validateStaging, buildSql, selectSql, BUDGET, type RebuildBq } from './lookup-rebuild';

type Opts = Partial<{
  sourceMax: string; stagingMax: string; awards: number; piids: number;
  stagingRows: number; stagingDistinct: number; prodRows: number | null;
  probeMisses: number; dryBytes: number; lockHeld: boolean; failBuild: boolean;
}>;

function fakeBq(o: Opts = {}) {
  const log: string[] = [];
  const copies: Array<[string, string]> = [];
  const cfg = { sourceMax: '2026-11-04', stagingMax: '2026-11-04', awards: 100, piids: 80, stagingRows: undefined as number | undefined, stagingDistinct: undefined as number | undefined, prodRows: 90 as number | null, probeMisses: 0, dryBytes: 30e9, lockHeld: false, failBuild: false, ...o };
  let probeCalls = 0;
  const bq: RebuildBq = {
    async query(sql: string) {
      const s = sql.replace(/\s+/g, ' ').trim();
      log.push(s.slice(0, 200));
      if (s.startsWith('CREATE TABLE') && s.includes('_award_lookup_rebuild_lock')) { if (cfg.lockHeld) throw new Error('Already Exists'); return []; }
      if (s.startsWith('CREATE TABLE') && cfg.failBuild) throw new Error('Quota exceeded');
      if (s.includes('COUNT(DISTINCT award_id) AS awards')) return [{ mx: cfg.sourceMax, awards: cfg.awards, piids: cfg.piids }] as never;
      if (s.includes('QUALIFY ROW_NUMBER()')) return [{ award_id: 'P1' }, { award_id: 'P2' }] as never;
      if (s.includes('COUNT(*) AS n,')) {
        const piid = s.includes('piid_upper');
        const n = piid ? cfg.piids : cfg.awards;
        return [{ n: cfg.stagingRows ?? n, d: cfg.stagingDistinct ?? n, mx: piid ? null : cfg.stagingMax }] as never;
      }
      if (s.includes('WHERE bucket = MOD')) { probeCalls++; return (probeCalls <= cfg.probeMisses ? [] : [{ award_id: 'x' }]) as never; }
      return [];
    },
    async dryRunBytes() { return cfg.dryBytes; },
    async copy(src, dst) { copies.push([src, dst]); },
    async tableRows(t) { return t.includes('piid') ? (cfg.prodRows == null ? null : Math.round(cfg.prodRows * 0.8)) : cfg.prodRows; },
  };
  return { bq, log, copies };
}
const prodWrites = (c: Array<[string, string]>) => c.filter(([, dst]) => dst === 'award_detail_lookup' || dst === 'piid_lookup');

describe('success path', () => {
  it('locks, builds staging, validates, backs up, publishes atomically, verifies, unlocks', async () => {
    const { bq, log, copies } = fakeBq();
    const r = await rebuildLookups(bq, { go: true });
    expect(r.ok).toBe(true);
    expect(r.published).toEqual(['award_detail_lookup', 'piid_lookup']);
    expect(copies).toEqual([
      ['award_detail_lookup', 'award_detail_lookup__prev'], ['award_detail_lookup__staging', 'award_detail_lookup'],
      ['piid_lookup', 'piid_lookup__prev'], ['piid_lookup__staging', 'piid_lookup'],
    ]);
    expect(log[0]).toContain('_award_lookup_rebuild_lock');
    expect(log.at(-1)).toContain('DROP TABLE IF EXISTS `market-assasin.usaspending._award_lookup_rebuild_lock`');
    // never DROPs a production table
    expect(log.some((l) => /DROP TABLE IF EXISTS `market-assasin\.usaspending\.(award_detail_lookup|piid_lookup)`/.test(l))).toBe(false);
  });
  it('prices the SELECT body, not the CREATE (a leftover staging table must not break pricing)', () => {
    for (const t of ['award_detail_lookup', 'piid_lookup'] as const) {
      const q = selectSql(t);
      expect(q).not.toMatch(/CREATE TABLE/);
      expect(q.trimStart()).toMatch(/^(SELECT|WITH)/);
    }
  });
  it('builds into staging names only', () => {
    expect(buildSql('award_detail_lookup', 'award_detail_lookup__staging')).toContain('CREATE TABLE `market-assasin.usaspending.award_detail_lookup__staging`');
  });
});

describe('production is untouched on any failure', () => {
  const cases: Array<[string, Opts]> = [
    ['stale staging (freshness)', { stagingMax: '2026-04-23' }],
    ['row count != distinct source awards', { stagingRows: 99, stagingDistinct: 99 }],
    ['duplicate keys', { stagingRows: 101, stagingDistinct: 100 }],
    ['large shrink vs production', { prodRows: 200 }],
    ['representative award missing', { probeMisses: 1 }],
    ['build query fails (quota)', { failBuild: true }],
  ];
  it.each(cases)('%s', async (_n, o) => {
    const { bq, copies, log } = fakeBq(o);
    const r = await rebuildLookups(bq, { go: true });
    expect(r.ok).toBe(false);
    expect(prodWrites(copies)).toEqual([]);
    expect(log.at(-1)).toContain('_award_lookup_rebuild_lock'); // lock released
  });
});

describe('weekly no-op', () => {
  it('skip-if-current: lookups already match the source → no lock-held build, no copy', async () => {
    const { bq, copies, log } = fakeBq({ prodRows: 100 }); // prod rows == source distinct awards (100)
    const orig = bq.query.bind(bq);
    bq.query = (async (sql: string, o?: unknown) => (sql.includes('FROM `market-assasin.usaspending.award_detail_lookup`') && sql.includes('MAX(action_date)') && !sql.includes('COUNT')
      ? [{ mx: '2026-11-04' }] : orig(sql, o as never))) as never;
    const r = await rebuildLookups(bq, { go: true, skipIfCurrent: true });
    expect(r).toMatchObject({ ok: true, stage: 'up-to-date' });
    expect(copies).toEqual([]);
    expect(log.some((l) => l.includes('__staging'))).toBe(false);
    expect(log.at(-1)).toContain('_award_lookup_rebuild_lock');
  });
  it('skip-if-current: lookups behind → full rebuild', async () => {
    const { bq, copies } = fakeBq({ prodRows: 90 });
    const r = await rebuildLookups(bq, { go: true, skipIfCurrent: true });
    expect(r.ok).toBe(true);
    expect(copies.length).toBe(4);
  });
});

describe('guards', () => {
  it('does not run when another rebuild holds the lock', async () => {
    const { bq, copies, log } = fakeBq({ lockHeld: true });
    const r = await rebuildLookups(bq, { go: true });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/lock/);
    expect(copies).toEqual([]);
    expect(log.some((l) => l.includes('__staging'))).toBe(false);
  });
  it('refuses before building when the priced scan exceeds the budget', async () => {
    const { bq, log } = fakeBq({ dryBytes: BUDGET.maxBytesPerBuild + 1 });
    const r = await rebuildLookups(bq, { go: true });
    expect(r.ok).toBe(false);
    expect(log.some((l) => l.startsWith('CREATE TABLE `market-assasin.usaspending.award_detail_lookup__staging'))).toBe(false);
  });
  it('dry run prices the build and writes nothing (no lock, no build, no copy)', async () => {
    const { bq, log, copies } = fakeBq();
    const r = await rebuildLookups(bq, { go: false });
    expect(r.ok).toBe(true);
    expect(r.estimatedBytes).toBe(60e9);
    expect(copies).toEqual([]);
    expect(log.some((l) => l.startsWith('CREATE') || l.startsWith('DROP'))).toBe(false);
  });
});

it('never aliases a column to a BigQuery reserved word (the first production run failed on `AS rows`)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./lookup-rebuild.ts', import.meta.url), 'utf8');
  expect(src).not.toMatch(/\bAS (rows|range|window|groups|lookup)\b/i);
});

describe('validateStaging', () => {
  const base = { table: 'award_detail_lookup' as const, staging: { rows: 100, distinctKeys: 100, maxActionDate: '2026-11-04' }, sourceDistinctKeys: 100, sourceMaxActionDate: '2026-11-04', productionRows: 90, probesTotal: 2, probesResolved: 2 };
  it('passes a complete, fresh, unique build', () => expect(validateStaging(base)).toEqual([]));
  it('flags an empty table', () => expect(validateStaging({ ...base, staging: { rows: 0, distinctKeys: 0, maxActionDate: null } }).length).toBeGreaterThan(0));
  it('allows growth and a first-ever build (no production table)', () => {
    expect(validateStaging({ ...base, productionRows: null })).toEqual([]);
  });
});
