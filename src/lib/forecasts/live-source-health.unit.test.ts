import { describe, it, expect } from 'vitest';
import {
  evaluateLiveSource, rollupLiveForecastHealth,
  type LiveSourceEvidence,
} from './live-source-health';

const NOW = '2026-09-13T13:00:00Z';
const src = (o: Partial<LiveSourceEvidence> = {}): LiveSourceEvidence => ({
  agency: 'DHS', sourceType: 'api', rows: 1634,
  lastWriteAt: '2026-09-13T13:00:32Z', disposition: 'living', ...o,
});

/**
 * THE STALE-AUTHORITY REGRESSIONS.
 *
 * `forecast_sources` (the abandoned CONFIG table, measured 2026-09-13) says:
 *   total_records = 0 on ALL 11 rows   … against 33,687 real rows
 *   DHS is_active = false              … while DHS writes daily
 *   DOE last_sync_at = 2026-04-06      … while DOE wrote today
 * Each test below pins that those specific lies can no longer reach health output,
 * because health is now derived from agency_forecasts itself.
 */
describe('stale config can no longer drive forecast health', () => {
  it('DHS cannot be reported inactive/critical from the stale row — live writes decide', () => {
    // The config row says is_active:false. The DATA says it wrote today.
    const r = evaluateLiveSource(src({ agency: 'DHS', lastWriteAt: '2026-09-13T13:00:32Z' }), NOW);
    expect(r.status).toBe('healthy');
    expect(r.lastWriteDaysAgo).toBe(0);
  });

  it('DOE cannot inherit the April clock — its real write is today', () => {
    // forecast_sources.last_sync_at = 2026-04-06 would be 160 days -> critical.
    const r = evaluateLiveSource(src({ agency: 'DOE', sourceType: 'osdbu_xlsx', rows: 870,
      lastWriteAt: '2026-09-13T13:00:33Z' }), NOW);
    expect(r.status).toBe('healthy');
    expect(r.lastWriteDaysAgo).toBeLessThan(1);
  });

  it('33,687 real rows can never be reported as 0', () => {
    const REAL = [
      evaluateLiveSource(src({ agency: 'DHS', rows: 1634 }), NOW),
      evaluateLiveSource(src({ agency: 'DOE', sourceType: 'osdbu_xlsx', rows: 870 }), NOW),
      evaluateLiveSource(src({ agency: 'NAVY', sourceType: 'lrae_xlsx', rows: 8821,
        lastWriteAt: '2026-08-01T16:55:35Z', disposition: 'ready_to_activate' }), NOW),
    ];
    const total = rollupLiveForecastHealth(REAL).totalRows;
    expect(total).toBe(1634 + 870 + 8821);
    expect(total).not.toBe(0);       // the config table's answer for every source
  });
});

/**
 * DISPOSITION IS NOT FAILURE. Potato 2C dispositioned 21 sources as blocked/
 * superseded/retired. Reporting them critical would be 21 false alarms.
 */
describe('dispositioned sources are not reported as ingest failures', () => {
  it.each(['blocked', 'superseded', 'retired', 'ready_to_activate', 'repair_required'] as const)(
    '%s is not_applicable, never critical — even when frozen for months',
    (disposition) => {
      const r = evaluateLiveSource(src({ disposition, lastWriteAt: '2026-04-06T10:48:16Z' }), NOW);
      expect(r.status).toBe('not_applicable');
      expect(r.status).not.toBe('critical');
      expect(r.reasons[0]).toContain(disposition);
    },
  );

  it('a dispositioned source never drags the dataset down', () => {
    const roll = rollupLiveForecastHealth([
      evaluateLiveSource(src(), NOW),
      evaluateLiveSource(src({ agency: 'NAVY', disposition: 'blocked', lastWriteAt: '2026-04-06T00:00:00Z' }), NOW),
    ]);
    expect(roll.status).toBe('healthy');
    expect(roll.dispositionedCount).toBe(1);
  });

  it('source-level dispositions stay visible in the output', () => {
    const roll = rollupLiveForecastHealth([
      evaluateLiveSource(src({ agency: 'NAVY', disposition: 'ready_to_activate', rows: 8821 }), NOW),
    ]);
    expect(roll.sources[0].disposition).toBe('ready_to_activate');
    expect(roll.sources[0].rows).toBe(8821);
  });
});

describe('a LIVING source that stops IS caught', () => {
  it('critical past the budget', () => {
    expect(evaluateLiveSource(src({ lastWriteAt: '2026-09-01T00:00:00Z' }), NOW).status).toBe('critical');
  });

  it('warning in the middle band', () => {
    expect(evaluateLiveSource(src({ lastWriteAt: '2026-09-08T00:00:00Z' }), NOW).status).toBe('warning');
  });

  it('a living source holding ZERO rows is flagged — rows come from the data', () => {
    expect(evaluateLiveSource(src({ rows: 0 }), NOW).status).toBe('warning');
  });

  it('a living source that never wrote is critical', () => {
    expect(evaluateLiveSource(src({ lastWriteAt: null }), NOW).status).toBe('critical');
  });

  it('one healthy source cannot mask a broken living source', () => {
    const roll = rollupLiveForecastHealth([
      evaluateLiveSource(src({ agency: 'DHS' }), NOW),
      evaluateLiveSource(src({ agency: 'DOE', lastWriteAt: '2026-08-01T00:00:00Z' }), NOW),
    ]);
    expect(roll.status).toBe('critical');
    expect(roll.detail).toContain('DOE');
  });
});
