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

/**
 * PAIR BINDINGS — one canonical source may govern many physical pairs.
 * Without these, health asks "does this agency have an instance?" and reports a
 * fully-dispositioned ONR/NRL as UNREGISTERED — which tempts inventing fake
 * instances purely to make a number go green.
 */
describe('pair bindings', () => {
  const P = (a: string, t: string, rows: number) => ({ agency: a, sourceType: t, rows, lastWriteAt: NOW });
  const BND = (a: string, t: string, d: string, k: string | null) =>
    ({ agency: a, sourceType: t, disposition: d as never, sourceKey: k, evidence: null });
  const GW = inst({ sourceKey: 'forecast_gsa_gateway', agency: 'GSA', ingestMode: 'manual',
                    sourceState: 'unmeasured', interventionState: 'required' });

  it('B. historical_only with NO instance is CONTROLLED, not unregistered', () => {
    const d = rollupForecastDomain([P('ONR','excel',48)], [], NOW, [BND('ONR','excel','historical_only',null)]);
    expect(d.pairs[0].registered).toBe(true);
    expect(d.pairs[0].state).toBe('HISTORICAL_ONLY');
    expect(d.uncontrolledAgencies).toBe(0);
    expect(d.undispositionedPairs).toBe(0);
    expect(d.rowsOutsideControlPlane).toBe(0);
    expect(d.instanceBackedAgencies).toBe(0);        // controlled WITHOUT a fake instance
  });

  it('C+D. seven pairs under ONE Gateway source count as ONE canonical source', () => {
    const pairs = [P('DOI','gsa_gateway_csv',3033), P('USDA','gsa_gateway_csv',2519),
                   P('NSF','api',37), P('DOI','api',3131)];
    const b = [BND('DOI','gsa_gateway_csv','canonical_active','forecast_gsa_gateway'),
               BND('USDA','gsa_gateway_csv','canonical_active','forecast_gsa_gateway'),
               BND('NSF','api','canonical_controlled','forecast_gsa_gateway'),
               BND('DOI','api','duplicate_ingest_path','forecast_gsa_gateway')];
    const d = rollupForecastDomain(pairs, [GW], NOW, b);
    expect(d.canonicalSourceInstances).toBe(1);      // not 4
    expect(d.dispositionedPairs).toBe(4);
    expect(d.rowsOutsideControlPlane).toBe(0);
    // A duplicate path is retained and controlled, never a second "current" source.
    const dup = d.pairs.find(p => p.agency === 'DOI' && p.sourceType === 'api')!;
    expect(dup.state).toBe('HISTORICAL_ONLY');
    expect(dup.operationalConcern).toBe(false);
  });

  it('F+G. duplicate/superseded/historical rows all count as controlled', () => {
    const d = rollupForecastDomain(
      [P('DOE','osdbu_xlsx',870), P('DOE','excel',431), P('NRL','excel',12)],
      [inst({ sourceKey:'forecast_doe_osbp', agency:'DOE' })], NOW,
      [BND('DOE','osdbu_xlsx','canonical_active','forecast_doe_osbp'),
       BND('DOE','excel','superseded','forecast_doe_osbp'),
       BND('NRL','excel','historical_only',null)]);
    expect(d.rowsUnderControlPlane).toBe(870 + 431 + 12);
    expect(d.rowsOutsideControlPlane).toBe(0);
    expect(d.pairs.find(p=>p.sourceType==='excel' && p.agency==='DOE')!.state).toBe('SUPERSEDED');
  });

  it('H. a pair with NO binding is still uncontrolled', () => {
    const d = rollupForecastDomain([P('DOI','gsa_gateway_csv',3033), P('GSA','api',336)], [GW], NOW,
      [BND('DOI','gsa_gateway_csv','canonical_active','forecast_gsa_gateway')]);
    expect(d.undispositionedPairs).toBe(1);
    expect(d.rowsOutsideControlPlane).toBe(336);
    expect(d.domainTodos.join(' ')).toMatch(/undispositioned/);
  });

  it('control comes from the BINDING, never from a shared agency name', () => {
    // An instance for the same agency that the binding does NOT name must not govern.
    const other = inst({ sourceKey: 'forecast_unrelated', agency: 'DOI' });
    const d = rollupForecastDomain([P('DOI','api',3131)], [other], NOW,
      [BND('DOI','api','duplicate_ingest_path','forecast_gsa_gateway')]);
    expect(d.pairs[0].sourceKey).not.toBe('forecast_unrelated');
  });
});
