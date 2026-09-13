import { describe, it, expect } from 'vitest';
import {
  classifyForecastSource, rollupForecastSources,
  type ForecastSourceEvidence,
} from './forecast-source-advancement';

const NOW = '2026-09-13T13:00:00Z';
const src = (o: Partial<ForecastSourceEvidence> = {}): ForecastSourceEvidence => ({
  agency: 'NAVY', sourceType: 'lrae_xlsx', rows: 8821,
  lastWriteAt: '2026-08-01T16:55:35Z', scheduled: false, ...o,
});

/**
 * THE MASKING FAILURE — the reason this control exists.
 *
 * Measured live 2026-09-13: 30 source pairs, 2 wrote today, 28 frozen 30+ days,
 * and NAVY (8,821 rows — the largest source) silent since 2026-08-01. The dataset
 * aggregate still read 2026-09-13.
 */
describe('aggregate MAX() masking — demonstrated, then exposed', () => {
  const REAL = [
    src({ agency: 'DHS', sourceType: 'api', rows: 1634, lastWriteAt: '2026-09-13T13:00:32Z', scheduled: true, populationChanged: true }),
    src({ agency: 'DOE', sourceType: 'osdbu_xlsx', rows: 870, lastWriteAt: '2026-09-13T13:00:33Z', scheduled: true, populationChanged: false }),
    src({ agency: 'NAVY', sourceType: 'lrae_xlsx', rows: 8821, lastWriteAt: '2026-08-01T16:55:35Z', scheduled: false }),
    src({ agency: 'HHS', sourceType: 'sbcx_api', rows: 3643, lastWriteAt: '2026-08-01T20:27:45Z', scheduled: false }),
    src({ agency: 'SSA', sourceType: 'excel', rows: 60, lastWriteAt: '2026-04-06T10:48:16Z', scheduled: false }),
  ];

  it('THE OLD MODEL LIES: MAX() over all sources reads fresh while NAVY is 43d silent', () => {
    const aggregateMax = REAL.map((s) => s.lastWriteAt!).sort().at(-1)!;
    expect(aggregateMax.slice(0, 10)).toBe('2026-09-13');          // dataset looks current…
    const navy = REAL.find((s) => s.agency === 'NAVY')!;
    expect(navy.lastWriteAt!.slice(0, 10)).toBe('2026-08-01');      // …while its LARGEST source is frozen
  });

  it('THE NEW MODEL EXPOSES IT: every frozen source is named individually', () => {
    const results = REAL.map((s) => classifyForecastSource(s, NOW));
    const navy = results.find((r) => r.key.startsWith('NAVY'))!;
    expect(navy.status).not.toBe('advancing');
    expect(navy.writeAgeDays).toBeGreaterThan(40);
    // and the dataset can no longer be called healthy
    expect(rollupForecastSources(results).status).not.toBe('healthy');
  });

  it('the rollup NAMES the sources needing attention rather than averaging them away', () => {
    const roll = rollupForecastSources(REAL.map((s) => classifyForecastSource(s, NOW)));
    expect(roll.attention.length).toBeGreaterThan(0);
    expect(roll.attention.join(' ')).toContain('NAVY');
  });
});

describe('frozen is not automatically broken', () => {
  it('an UNSCHEDULED source is NOT_POLLED, never ingest_broken', () => {
    // sync-forecasts deliberately runs only DHS+DOE; the rest are login-gated,
    // WAF-blocked or rotted and were left unscheduled ON PURPOSE.
    const r = classifyForecastSource(src({ scheduled: false }), NOW);
    expect(r.status).toBe('not_polled');
    expect(r.status).not.toBe('ingest_broken');
    expect(r.detail).toContain('no scheduled collector');
  });

  it('a SCHEDULED source silent past the budget IS ingest_broken', () => {
    const r = classifyForecastSource(src({ scheduled: true, lastWriteAt: '2026-08-01T00:00:00Z' }), NOW);
    expect(r.status).toBe('ingest_broken');
  });

  it('a failed attempt is ingest_broken regardless of age', () => {
    expect(classifyForecastSource(src({ scheduled: true, lastAttemptFailed: true }), NOW).status).toBe('ingest_broken');
  });

  it('scheduled but never written is UNMEASURED, not quiet', () => {
    const r = classifyForecastSource(src({ scheduled: true, lastWriteAt: null }), NOW);
    expect(r.status).toBe('unmeasured');
  });
});

describe('zero rows is a measured population, not a diagnosis', () => {
  it('a zero-row UNSCHEDULED source is not_polled, not broken', () => {
    expect(classifyForecastSource(src({ rows: 0, scheduled: false }), NOW).status).toBe('not_polled');
  });

  it('a zero-row SCHEDULED source that wrote recently is quiet, not broken', () => {
    const r = classifyForecastSource(src({ rows: 0, scheduled: true, lastWriteAt: '2026-09-13T12:00:00Z', populationChanged: false }), NOW);
    expect(r.status).toBe('upstream_quiet');
  });
});

describe('write time is never presented as an upstream watermark', () => {
  it('sourceAdvanceAgeDays is ALWAYS null — no forecast source exposes a publication clock', () => {
    for (const s of [src(), src({ scheduled: true, lastWriteAt: '2026-09-13T13:00:00Z' })]) {
      expect(classifyForecastSource(s, NOW).sourceAdvanceAgeDays).toBeNull();
    }
  });
});

describe('rollup semantics — no average, no percentage, no max timestamp', () => {
  const ok = (agency: string) => classifyForecastSource(
    src({ agency, scheduled: true, lastWriteAt: '2026-09-13T12:00:00Z', populationChanged: true }), NOW);

  it('any ingest_broken makes the dataset DEGRADED', () => {
    const r = rollupForecastSources([ok('DHS'),
      classifyForecastSource(src({ agency: 'X', scheduled: true, lastWriteAt: '2026-07-01T00:00:00Z' }), NOW)]);
    expect(r.status).toBe('degraded');
  });

  it('unmeasured/not_polled makes the dataset INCOMPLETE, never healthy', () => {
    const r = rollupForecastSources([ok('DHS'), classifyForecastSource(src({ scheduled: false }), NOW)]);
    expect(r.status).toBe('incomplete');
  });

  it('all polled and accounted for is healthy', () => {
    expect(rollupForecastSources([ok('DHS'), ok('DOE')]).status).toBe('healthy');
  });

  it('one healthy source can NEVER make the dataset healthy on its own', () => {
    const r = rollupForecastSources([ok('DHS'), classifyForecastSource(src({ agency: 'NAVY', scheduled: false }), NOW)]);
    expect(r.status).not.toBe('healthy');
  });
});
