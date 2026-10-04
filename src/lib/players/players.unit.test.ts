import { describe, it, expect } from 'vitest';
import { classifyPlayersResult, combinePlayersStatuses, mayRenderZero } from './truth';
import { buildPlayersQuery, cityScopeSql } from './query';
import { buildPlayersDatasetSql, buildPlayersTruthSql } from './dataset';
import { resolvePlayersGeoScope, stateGeoScope } from './geography';
import { reconciles, selectSampleCells, evaluateCells, datasetMismatchRate, PLAYERS_REGRESSION_FIXTURES } from './reconcile';
import { decidePlayersRebuild, encodePlayersBuildRecord, decodePlayersBuildRecord, type PlayersBuildRecord } from './rebuild';
import { playersHeaderText } from './copy';
import { playersSourceMode } from './source';
import { playersTelemetryRow, PLAYERS_TELEMETRY_SENTINEL, playersTelemetryEnabled } from './telemetry';

describe('truth states — 0 is only one of four outcomes', () => {
  it('a failed or cold query is unavailable, never zero', () => {
    expect(classifyPlayersResult({ rowCount: 0, bqState: 'failed', source: 'players_canonical' })).toBe('unavailable');
    expect(classifyPlayersResult({ rowCount: 0, bqState: 'unavailable', source: 'players_canonical' })).toBe('unavailable');
  });
  it('the national top-50 rollup is always coverage_incomplete — even a zero', () => {
    expect(classifyPlayersResult({ rowCount: 0, bqState: 'empty', source: 'top50_rollup' })).toBe('coverage_incomplete');
    expect(classifyPlayersResult({ rowCount: 34, bqState: 'hit', source: 'top50_rollup' })).toBe('coverage_incomplete');
  });
  it('only a complete population yields success_zero', () => {
    expect(classifyPlayersResult({ rowCount: 0, bqState: 'empty', source: 'players_canonical' })).toBe('success_zero');
    expect(classifyPlayersResult({ rowCount: 5, bqState: 'hit', source: 'players_canonical' })).toBe('success_nonzero');
    expect(classifyPlayersResult({ rowCount: 5, bqState: 'hit', source: 'players_canonical', postCapFilter: true })).toBe('coverage_incomplete');
  });
  it('combining: an unknown part makes the answer unknown, or a floor if others found rows', () => {
    expect(combinePlayersStatuses([{ status: 'unavailable', rowCount: 0 }, { status: 'success_zero', rowCount: 0 }])).toBe('unavailable');
    expect(combinePlayersStatuses([{ status: 'unavailable', rowCount: 0 }, { status: 'success_nonzero', rowCount: 3 }])).toBe('coverage_incomplete');
    expect(combinePlayersStatuses([{ status: 'success_zero', rowCount: 0 }, { status: 'success_nonzero', rowCount: 3 }])).toBe('success_nonzero');
    expect(mayRenderZero('coverage_incomplete')).toBe(false);
    expect(mayRenderZero('success_zero')).toBe(true);
  });
});

describe('canonical query — FILTER, then RANK', () => {
  const q = buildPlayersQuery('`p.d.players`', { naicsCodes: ['541512', '236'], state: 'TX', cities: ['AUSTIN'], search: 'acme', sortBy: 'total_obligated', limit: 300, offset: 0 });
  it('every scope is a WHERE predicate before GROUP BY / ORDER BY / LIMIT', () => {
    const where = q.sql.indexOf('WHERE');
    for (const pred of ['naics_code = @n0', 'STARTS_WITH(naics_code, @n1)', 'state = @state', 'IN UNNEST(@cities)', 'LIKE @search']) {
      const i = q.sql.indexOf(pred);
      expect(i, pred).toBeGreaterThan(where);
      expect(i, pred).toBeLessThan(q.sql.indexOf('GROUP BY'));
    }
    expect(q.sql.indexOf('ORDER BY')).toBeGreaterThan(q.sql.indexOf('GROUP BY'));
    expect(q.sql.indexOf('LIMIT @limit')).toBeGreaterThan(q.sql.indexOf('ORDER BY'));
  });
  it('has no rank cap and counts the full filtered population', () => {
    expect(q.sql).not.toMatch(/rank\s*<=|ROW_NUMBER/i);
    expect(q.sql).toContain('COUNT(*) OVER() AS total_rows');
  });
  it('the cache key changes with the visible geography', () => {
    const other = buildPlayersQuery('`t`', { naicsCodes: ['541512'], state: 'TX', cities: ['DALLAS'], sortBy: 'total_obligated', limit: 300, offset: 0 });
    const same = buildPlayersQuery('`t`', { naicsCodes: ['541512'], state: 'TX', cities: ['AUSTIN'], sortBy: 'total_obligated', limit: 300, offset: 0 });
    expect(other.cacheKey).not.toBe(same.cacheKey);
  });
  it('ungeocoded firms are kept only when asked (state centroid in view)', () => {
    const p: Record<string, unknown> = {};
    expect(cityScopeSql('city', { cities: ['A'], includeUngeocodedCities: true, knownCities: ['A', 'B'] }, p)).toContain('NOT IN UNNEST(@knownCities)');
    expect(cityScopeSql('city', {}, {})).toBeNull();
  });
});

describe('dataset — full population, independent truth', () => {
  const ddl = buildPlayersDatasetSql({ awards: '`a`', recipients: '`r`', target: '`t`' });
  it('no rank cap, clustered for NAICS + state reads, carries its watermark', () => {
    expect(ddl).not.toMatch(/rank\s*<=|ROW_NUMBER|LIMIT/i);
    expect(ddl).toContain('CLUSTER BY naics_code, state');
    expect(ddl).toContain('source_action_max');
    expect(ddl).toContain('GROUP BY naics_code, recipient_uei');
  });
  it('truth never reads the Players table', () => {
    expect(buildPlayersTruthSql({ awards: '`a`', recipients: '`r`' })).not.toContain('players_naics_recipients');
    expect(buildPlayersTruthSql({ awards: '`a`', recipients: '`r`' }, 'all')).not.toContain('@naics');
  });
});

describe('geography resolves BEFORE the query', () => {
  it('explicit state is state-wide', () => {
    expect(resolvePlayersGeoScope([-125, 24, -66, 50], 'TX')).toEqual({ states: [{ state: 'TX' }], droppedStates: [] });
  });
  it('a part-of-state viewport restricts to the visible cities', () => {
    const austin = stateGeoScope('TX', [-98.0, 30.1, -97.5, 30.5]);
    expect(austin.cities).toContain('AUSTIN');
    expect(austin.cities).not.toContain('HOUSTON');
    expect(austin.includeUngeocodedCities).toBe(false);
  });
  it('a viewport covering the whole state needs no city filter', () => {
    expect(stateGeoScope('RI', [-75, 40, -69, 43]).cities).toBeUndefined();
  });
  it('states beyond the fan-out cap are reported, not silently dropped', () => {
    const g = resolvePlayersGeoScope([-125, 24, -66, 50]);
    expect(g.states.length).toBe(6);
    expect(g.droppedStates.length).toBeGreaterThan(0);
  });
});

describe('reconciliation', () => {
  it('tolerance is 1% or one firm', () => {
    expect(reconciles(327, 327)).toBe(true);
    expect(reconciles(0, 327)).toBe(false);
    expect(reconciles(null, 0)).toBe(false);
    expect(reconciles(2340, 2349)).toBe(true);
  });
  it('the sample includes every regression fixture plus large/median/small states per NAICS', () => {
    const truth = [
      { naics_code: '541330', state: 'VA', proven_players: 3000 },
      { naics_code: '541330', state: 'OH', proven_players: 300 },
      { naics_code: '541330', state: 'WY', proven_players: 3 },
    ];
    const cells = selectSampleCells(truth, ['541330']);
    for (const f of PLAYERS_REGRESSION_FIXTURES) expect(cells).toContainEqual(f);
    expect(cells).toEqual(expect.arrayContaining([{ naics: '541330', state: 'VA' }, { naics: '541330', state: 'OH' }, { naics: '541330', state: 'WY' }]));
  });
  it('a matching number from a partial source still FAILS', () => {
    const { failed } = evaluateCells([{ naics: '1', state: 'TX' }], [{ naics_code: '1', state: 'TX', proven_players: 5 }],
      new Map([['1|TX', { total: 5, status: 'coverage_incomplete' }]]));
    expect(failed).toHaveLength(1);
  });
  it('dataset mismatch counts missing cells', () => {
    const d = datasetMismatchRate([{ naics_code: '1', state: 'TX', proven_players: 5 }], []);
    expect(d.mismatched).toBe(1);
  });
});

describe('rebuild gate + record', () => {
  it('refuses unless the awards warehouse is complete — no override', () => {
    expect(decidePlayersRebuild({ status: 'incomplete', judged: 16, holes: [], months: [] }).allowed).toBe(false);
    expect(decidePlayersRebuild({ status: 'unmeasured', reason: 'x' }).allowed).toBe(false);
    expect(decidePlayersRebuild({ status: 'complete', judged: 16, months: [] }).allowed).toBe(true);
  });
  it('record round-trips and preserves other notes', () => {
    const rec: PlayersBuildRecord = { status: 'built_unreconciled', sourceActionMax: '2026-09-25', playersSourceActionMax: '2026-09-25', playersBuiltAt: 'x', rows: 1, reconciledAt: null, detail: 'd', attemptedAt: 'a' };
    const once = encodePlayersBuildRecord('human note', rec);
    const twice = encodePlayersBuildRecord(once, { ...rec, status: 'reconciled' });
    expect(twice.startsWith('human note')).toBe(true);
    expect(twice.match(/players-build:v1/g)).toHaveLength(1);
    expect(decodePlayersBuildRecord(twice)?.status).toBe('reconciled');
  });
});

describe('copy', () => {
  it('unavailable is never a zero', () => {
    expect(playersHeaderText({ status: 'unavailable', total: null, shown: 0 }).count).toBe('Unavailable');
  });
  it('a partial list says "Top N shown", never "N companies exist"', () => {
    const h = playersHeaderText({ status: 'coverage_incomplete', total: 34, shown: 34 });
    expect(h.count).toBe('Top 34');
    expect(h.detail).toContain('partial list');
    expect(playersHeaderText({ status: 'coverage_incomplete', total: 0, shown: 0 }).detail).toContain('not evidence that none exist');
  });
  it('a complete count names the population and discloses the shown subset', () => {
    const h = playersHeaderText({ status: 'success_nonzero', total: 2349, shown: 400 });
    expect(h.count).toBe('2,349');
    expect(h.detail).toBe('companies with federal award history in this market · top 400 shown');
  });
});

describe('source flag + telemetry', () => {
  it('only the literal "canonical" turns the canonical source on', () => {
    expect(playersSourceMode({})).toBe('legacy');
    expect(playersSourceMode({ PLAYERS_SOURCE: 'true' })).toBe('legacy');
    expect(playersSourceMode({ PLAYERS_SOURCE: 'canonical' })).toBe('canonical');
  });
  it('telemetry writes only from a production deployment', () => {
    expect(playersTelemetryEnabled({})).toBe(false);
    expect(playersTelemetryEnabled({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(playersTelemetryEnabled({ VERCEL_ENV: 'production' })).toBe(true);
  });
  it('telemetry carries the diagnostic dimensions and no user identity or search text', () => {
    const row = playersTelemetryRow({ type: 'companies', naics: '541512', geoLevel: 'state', states: ['TX'], droppedStates: 0, explicitState: false,
      hasSearch: true, searchLen: 4, setAside: '', hasAgency: false, total: null, shown: 0, status: 'unavailable', source: 'players_canonical', sourceActionMax: null, ms: 12 });
    expect(row.user_email).toBe(PLAYERS_TELEMETRY_SENTINEL);
    expect(row.event_source).toBe('players_api');
    expect(JSON.stringify(row)).not.toMatch(/@/);
    expect(row.metadata).toMatchObject({ action: 'players_result', naics: '541512', states: ['TX'], status: 'unavailable', total: null });
  });
});
