import { describe, it, expect } from 'vitest';
import { evaluatePair, rollupForecastDomain, type PhysicalPair, type InstanceEvidence } from '@/lib/forecasts/domain-health';

const NOW = '2026-09-14T12:00:00.000Z';
const pair = (agency: string, sourceType: string, rows: number, lastWriteAt: string | null): PhysicalPair =>
  ({ agency, sourceType, rows, lastWriteAt });

const inst = (o: Partial<InstanceEvidence> & { sourceKey: string; agency: string }): InstanceEvidence => ({
  sourceTypes: undefined, ingestMode: 'automated', sourceState: 'current', interventionState: 'none_required',
  heldPopulation: null, upstreamPopulation: null, upstreamFingerprint: null, lastPoll: null,
  lastSuccessfulCheck: null, lastSourceAdvance: null, lastVerifiedIngest: NOW, lastDataAdvance: null,
  runbookPath: 'docs/runbooks/x.md', hasScheduledJob: true, ...o,
});

describe('forecast domain health authority', () => {
  it('A. agency with rows + current instance → AUTOMATED_CURRENT, no concern', () => {
    const r = evaluatePair(pair('HHS','sbcx_api',5504,'2026-09-13T17:00:00Z'),
      inst({ sourceKey:'forecast_hhs_sbcx', agency:'HHS' }), NOW);
    expect(r.state).toBe('AUTOMATED_CURRENT');
    expect(r.registered).toBe(true);
    expect(r.operationalConcern).toBe(false);
  });

  it('B. agency with rows and NO instance → UNREGISTERED, never omitted, never an outage', () => {
    const r = evaluatePair(pair('GSA','api',336,'2026-06-25T00:00:00Z'), null, NOW);
    expect(r.state).toBe('UNREGISTERED');
    expect(r.registered).toBe(false);
    // The false-critical bug: a missing control plane must NOT read as a failing source.
    expect(r.operationalConcern).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/not yet dispositioned/);
  });

  it('C. blocked source with a SUCCESSFUL watcher stays BLOCKED_CONTROLLED', () => {
    const r = evaluatePair(pair('EPA','apex_forecast_db',50,'2026-08-01T22:39:00Z'),
      inst({ sourceKey:'forecast_epa_apex', agency:'EPA', ingestMode:'manual',
             sourceState:'unreachable', interventionState:'required', hasScheduledJob:true }), NOW);
    expect(r.state).toBe('BLOCKED_CONTROLLED');
    expect(r.operationalConcern).toBe(false);          // controlled, not broken
    expect(r.reasons.join(' ')).toMatch(/watch success is NOT source currentness/);
  });

  it('D. an unchanged ingest is NOT stale merely because last_data_advance is old', () => {
    const r = evaluatePair(pair('NASA','naf_xlsx',147,'2026-09-13T19:00:00Z'),
      inst({ sourceKey:'forecast_nasa_naf', agency:'NASA',
             lastDataAdvance:'2026-08-04T18:03:05Z', lastVerifiedIngest:'2026-09-13T19:00:00Z' }), NOW);
    expect(r.state).toBe('AUTOMATED_CURRENT');
    expect(r.operationalConcern).toBe(false);
  });

  it('E. last_poll is not mistaken for source advancement', () => {
    // Blocked source: poll is fresh, every data clock is old/NULL. Still blocked.
    const r = evaluatePair(pair('SSA','excel',170,'2026-09-14T01:12:00Z'),
      inst({ sourceKey:'forecast_ssa_osdbu', agency:'SSA', ingestMode:'manual',
             sourceState:'unreachable', interventionState:'required',
             lastPoll: NOW, lastSourceAdvance:'2026-07-01T17:19:36Z', upstreamPopulation:125 }), NOW);
    expect(r.state).toBe('BLOCKED_CONTROLLED');
    expect(r.operationalConcern).toBe(false);
  });

  it('F. exact counts survive well past 1,000 rows', () => {
    const r = evaluatePair(pair('NAVY','lrae_xlsx',8821,'2026-08-01T00:00:00Z'),
      inst({ sourceKey:'forecast_navy_lrae', agency:'NAVY', ingestMode:'manual',
             sourceState:'content_stale', interventionState:'required' }), NOW);
    expect(r.rows).toBe(8821);
    expect(r.state).toBe('MANUAL_CONTROLLED');
  });

  it('F2. an unmeasurable count is UNKNOWN (-1), never coerced to zero', () => {
    const r = evaluatePair(pair('DOI','api',-1,null), null, NOW);
    expect(r.rows).toBe(-1);
    expect(r.reasons.join(' ')).toMatch(/COULD NOT BE MEASURED \(unknown, not zero\)/);
  });

  it('G+H. neither forecast_sources nor FORECAST_SOURCE_POLICY can affect the result', async () => {
    const src = await import('node:fs').then(fs =>
      fs.readFileSync('src/lib/forecasts/domain-health.ts','utf8')
      + fs.readFileSync('src/lib/forecasts/domain-health-read.ts','utf8'));
    const code = src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    expect(code).not.toMatch(/forecast_sources/);
    expect(code).not.toMatch(/FORECAST_SOURCE_POLICY/);
  });

  it('I. rollup reconciles rows exactly and reports the control-plane gap', () => {
    const pairs = [
      pair('HHS','sbcx_api',5504,'2026-09-13T17:00:00Z'),
      pair('GSA','api',336,'2026-06-25T00:00:00Z'),
      pair('GSA','gsa_gateway_csv',178,'2026-08-01T00:00:00Z'),
      pair('EPA','apex_forecast_db',50,'2026-08-01T22:39:00Z'),
    ];
    const instances = [
      inst({ sourceKey:'forecast_hhs_sbcx', agency:'HHS', sourceTypes:['sbcx_api'] }),
      inst({ sourceKey:'forecast_epa_apex', agency:'EPA', sourceTypes:['apex_forecast_db'],
             ingestMode:'manual', sourceState:'unreachable', interventionState:'required' }),
    ];
    const d = rollupForecastDomain(pairs, instances, NOW);
    expect(d.physicalRows).toBe(5504 + 336 + 178 + 50);
    expect(d.representedAgencies).toBe(3);
    expect(d.registeredAgencies).toBe(2);
    expect(d.unregisteredAgencies).toBe(1);          // GSA
    expect(d.physicalPairs).toBe(4);
    expect(d.undispositionedPairs).toBe(2);          // both GSA pairs
    expect(d.rowsUnderControlPlane).toBe(5504 + 50);
    expect(d.rowsOutsideControlPlane).toBe(336 + 178);
    expect(d.byState.UNREGISTERED).toBe(2);
    expect(d.byState.BLOCKED_CONTROLLED).toBe(1);
    // GSA must appear as a TODO, never as an outage.
    expect(d.domainTodos.join(' ')).toMatch(/GSA/);
    expect(d.operationalConcerns.join(' ')).not.toMatch(/GSA/);
  });

  it('exposes no composite score or percentage', () => {
    const d = rollupForecastDomain([pair('HHS','sbcx_api',10,NOW)], [], NOW);
    const keys = Object.keys(d).join(' ');
    expect(keys).not.toMatch(/score|percent|pct|grade|rating/i);
  });

  it('a blocked source with NO watch is a domain TODO', () => {
    const d = rollupForecastDomain([pair('EPA','apex_forecast_db',50,null)],
      [inst({ sourceKey:'forecast_epa_apex', agency:'EPA', ingestMode:'manual',
              sourceState:'unreachable', interventionState:'required', hasScheduledJob:false })], NOW);
    expect(d.domainTodos.join(' ')).toMatch(/blocked with no access watch/);
  });
});
