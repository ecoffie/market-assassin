import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  computeTotals,
  countUpstreamPublishers,
  inventoryViolations,
  mapSourceState,
  nextCronRun,
  registryDebt,
  scheduleTruth,
  STATIC_FILE_AS_OF,
  timestampState,
  worstState,
  type InventoryDataset,
} from './inventory-model';

function ds(p: Partial<InventoryDataset> & Pick<InventoryDataset, 'key' | 'kind'>): InventoryDataset {
  return {
    label: p.key, stored: 0, unit: 'rows', uniqueContribution: 0, upstreams: [], provenance: '',
    freshness: { state: 'CURRENT', asOf: null, basis: 'test' },
    surface: { state: 'customer_readable', tools: [] },
    ...p,
  };
}

describe('computeTotals — the unique-underlying-record headline', () => {
  const sam = ds({ key: 'sam', kind: 'source_corpus', stored: 224_158, uniqueContribution: 224_158 });
  const index = ds({ key: 'idx', kind: 'derived_index', stored: 148_433, uniqueContribution: 0 });
  const contacts = ds({ key: 'contacts', kind: 'derived_intelligence', stored: 302_151, uniqueContribution: 0 });
  const pain = ds({ key: 'pain', kind: 'static_manual', stored: 3_036, uniqueContribution: 0 });
  const calc = ds({ key: 'calc', kind: 'passthrough', stored: null, uniqueContribution: null,
    freshness: { state: 'PASSTHROUGH', asOf: null, basis: 'x' }, surface: { state: 'passthrough', tools: [] } });

  it('only source corpora enter the headline — the semantic index is never added again', () => {
    const t = computeTotals([sam, index, contacts, pain, calc]);
    expect(t.uniqueSourceRecords).toBe(224_158);
    expect(t.indexedRepresentations).toBe(148_433);
    expect(t.derivedRecords).toBe(302_151);
    expect(t.staticRecords).toBe(3_036);
    expect(t.passthroughCapabilities).toBe(1);
  });

  it('a mis-declared index contribution still cannot enter the headline', () => {
    const cheating = { ...index, uniqueContribution: 148_433 };
    expect(computeTotals([sam, cheating]).uniqueSourceRecords).toBe(224_158);
    expect(inventoryViolations([sam, cheating])).toEqual([
      'idx: derived_index may not contribute to the unique-record headline',
    ]);
  });

  it('an unmeasured source makes the headline a floor, and says which', () => {
    const unknown = ds({ key: 'leg', kind: 'source_corpus', stored: null, uniqueContribution: null });
    const t = computeTotals([sam, unknown]);
    expect(t.uniqueSourceRecords).toBe(224_158);
    expect(t.unmeasuredSources).toEqual(['leg']);
  });

  it('passthrough may never report a persisted count', () => {
    expect(inventoryViolations([{ ...calc, stored: 240_000 }]))
      .toContain('calc: passthrough must not report a stored count');
  });

  it('a withheld dataset cannot advertise customer tools', () => {
    const hist = ds({ key: 'hist', kind: 'source_corpus', stored: 445, uniqueContribution: 445,
      surface: { state: 'withheld', tools: ['get_agency_intel'] } });
    expect(inventoryViolations([hist])).toContain('hist: a withheld dataset cannot list customer tools');
  });
});

describe('countUpstreamPublishers — a source is a publisher, not a label', () => {
  it('counts one publisher once across datasets, skips empty and passthrough and internal', () => {
    const u = countUpstreamPublishers([
      ds({ key: 'sam', kind: 'source_corpus', stored: 10, upstreams: ['sam_gov'] }),
      ds({ key: 'contacts', kind: 'derived_intelligence', stored: 10, upstreams: ['sam_gov'] }),
      ds({ key: 'idx', kind: 'derived_index', stored: 10, upstreams: ['sam_gov'] }),
      ds({ key: 'nsf', kind: 'source_corpus', stored: 0, upstreams: ['nsf_sbir'] }),
      ds({ key: 'calc', kind: 'passthrough', stored: null, upstreams: ['gsa_calc'] }),
      ds({ key: 'kb', kind: 'source_corpus', stored: 5, upstreams: ['govcon_giants'] }),
    ], ['HHS', 'NAVY', 'HHS']);
    expect(u.persisted).toEqual(['sam_gov']);
    expect(u.forecastIssuers).toEqual(['HHS', 'NAVY']);
    expect(u.passthroughOnly).toEqual(['gsa_calc']);
    expect(u.internal).toEqual(['govcon_giants']);
    expect(u.total).toBe(3);
  });
});

describe('freshness', () => {
  it('maps control-plane states and never defaults an unknown state to CURRENT', () => {
    expect(mapSourceState('current')).toBe('CURRENT');
    expect(mapSourceState('upstream_quiet')).toBe('CURRENT');
    expect(mapSourceState('content_stale')).toBe('STALE');
    expect(mapSourceState('unreachable')).toBe('UNREACHABLE');
    expect(mapSourceState('unmeasured')).toBe('UNKNOWN');
    expect(mapSourceState(null)).toBe('UNKNOWN');
  });

  it('a multi-feed dataset is as fresh as its worst feed', () => {
    expect(worstState(['CURRENT', 'STALE', 'CURRENT'])).toBe('STALE');
    expect(worstState(['CURRENT', 'UNREACHABLE', 'STALE'])).toBe('UNREACHABLE');
    expect(worstState(['CURRENT'])).toBe('CURRENT');
  });

  it('judges a timestamp only when the cadence is known', () => {
    const now = new Date('2026-09-26T18:00:00Z');
    expect(timestampState('2026-09-26T13:00:00Z', 24, now)).toBe('CURRENT');
    expect(timestampState('2026-09-20T13:00:00Z', 24, now)).toBe('STALE');
    expect(timestampState('2026-09-26T13:00:00Z', null, now)).toBe('UNKNOWN');
    expect(timestampState(null, 24, now)).toBe('UNKNOWN');
  });

  it('computes the next weekly/daily fire and refuses to guess other shapes', () => {
    const sat = new Date('2026-09-26T18:00:00Z'); // a Saturday
    expect(nextCronRun('40 13 * * 0', sat)).toBe('2026-09-27T13:40:00.000Z');
    expect(nextCronRun('20 12 * * *', sat)).toBe('2026-09-27T12:20:00.000Z');
    expect(nextCronRun('0 */2 * * *', sat)).toBeNull();
    expect(nextCronRun(null, sat)).toBeNull();
  });
});

describe('scheduleTruth — a manual refresh does not prove the schedule', () => {
  const now = new Date('2026-09-26T18:00:00Z');
  const base = { job: 'institute-legislation-sync', cron: '40 13 * * 0', enabled: true, now };

  it('legislation before Sep 27: scheduled Sep 20, manual Sep 23 → NOT YET RE-PROVEN', () => {
    const s = scheduleTruth({
      ...base,
      lastScheduledRun: { at: '2026-09-20T13:58:27Z', status: 'success', httpStatus: null },
      lastPoll: '2026-09-23T01:29:17Z',
    });
    expect(s.lastManualRefresh).toBe('2026-09-23T01:29:17Z');
    expect(s.recurrence).toBe('not_yet_reproven');
    expect(s.nextScheduled).toBe('2026-09-27T13:40:00.000Z');
  });

  it('after a successful scheduled run with HTTP 2xx → proven', () => {
    const s = scheduleTruth({
      ...base, now: new Date('2026-09-27T15:00:00Z'),
      lastScheduledRun: { at: '2026-09-27T13:40:30Z', status: 'success', httpStatus: 200 },
      lastPoll: '2026-09-27T13:41:00Z',
    });
    expect(s.lastManualRefresh).toBeNull();
    expect(s.recurrence).toBe('proven');
  });

  it('a success with no recorded HTTP status is not called proven (#1593)', () => {
    const s = scheduleTruth({
      ...base,
      lastScheduledRun: { at: '2026-09-27T13:40:30Z', status: 'success', httpStatus: null },
      lastPoll: '2026-09-27T13:41:00Z',
    });
    expect(s.recurrence).toBe('ran_status_unrecorded');
  });

  it('a failed scheduled run is failed', () => {
    const s = scheduleTruth({ ...base, lastScheduledRun: { at: '2026-09-27T13:40:30Z', status: 'failed', httpStatus: 500 }, lastPoll: null });
    expect(s.recurrence).toBe('failed');
  });

  it('a disabled job has no next scheduled run', () => {
    const s = scheduleTruth({ ...base, enabled: false, lastScheduledRun: null, lastPoll: null });
    expect(s.nextScheduled).toBeNull();
  });
});

describe('registryDebt', () => {
  it('reports disagreement beyond 1% and never skips a real passthrough claim', () => {
    expect(registryDebt([
      { where: 'a', claimed: 123_255, measured: 224_158 },
      { where: 'b', claimed: 100, measured: 100 },
      { where: 'c', claimed: null, measured: 5 },
      { where: 'calc', claimed: 240_000, measured: 0 },
    ]).map((d) => d.where)).toEqual(['a', 'calc']);
  });
});

describe('STATIC_FILE_AS_OF matches git', () => {
  // Skips on a shallow clone (CI checkouts), where `git log` cannot see file history.
  let shallow = true;
  try {
    shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true';
  } catch { shallow = true; }

  it.skipIf(shallow)('each static file date is its last commit date', () => {
    for (const [file, asOf] of Object.entries(STATIC_FILE_AS_OF)) {
      const d = execFileSync('git', ['log', '-1', '--format=%ad', '--date=short', '--', file], { encoding: 'utf8' }).trim();
      // A working-tree edit not yet committed would make git's date older, never newer.
      expect(d, file).toBe(asOf);
    }
  });
});
