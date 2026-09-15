import { describe, expect, it } from 'vitest';
import {
  appendProbeSample,
  buildAlertHtml,
  buildAlertSubject,
  buildProbeTimingSample,
  parsePgStatsDetail,
  type ProbeResult,
} from './db-health-alert';

const probesElevated: ProbeResult[] = [
  { name: 'reachability', ok: true, ms: 3970 },
  { name: 'alert-count', ok: true, ms: 137, detail: 'active=10993' },
  {
    name: 'pg-stats',
    ok: true,
    ms: 144,
    detail: JSON.stringify({
      total_connections: 31,
      active_connections: 1,
      idle_in_txn: 0,
      max_connections: 160,
      longest_query_secs: 0,
      oldest_xmin_age: 0,
      db_size_mb: 12127,
    }),
  },
];

describe('db-health-alert copy', () => {
  it('degraded subject + title report data API latency, not DB DEGRADED', () => {
    const subject = buildAlertSubject('degraded', 'healthy', '2026-09-15T00:00:32.740Z');
    expect(subject).toContain('data API latency elevated');
    expect(subject).not.toMatch(/DEGRADED/i);

    const html = buildAlertHtml('degraded', 'healthy', probesElevated);
    expect(html).toContain('Mindy data API latency elevated');
    expect(html).not.toMatch(/Mindy DB health: DEGRADED/i);
  });

  it('degraded body includes measured fields and measured-only interpretation', () => {
    const html = buildAlertHtml('degraded', 'healthy', probesElevated);
    expect(html).toContain('First PostgREST / reachability');
    expect(html).toContain('3970ms');
    expect(html).toContain('137ms');
    expect(html).toContain('144ms');
    expect(html).toContain('31 / 160');
    expect(html).toMatch(/Active connections<\/td><td[^>]*><b>1<\/b>/);
    expect(html).toMatch(/Longest query<\/td><td[^>]*><b>0s<\/b>/);
    expect(html).toContain('DB reachable');
    expect(html).toContain('yes');
    expect(html).toContain(
      'Database remains reachable. Elevated latency was observed on the data API/reachability path.',
    );
    expect(html).toContain('Check API and database metrics before attributing the cause.');
  });

  it('degraded body does not claim unmeasured causes', () => {
    const html = buildAlertHtml('degraded', 'healthy', probesElevated);
    for (const banned of [
      'heavy ingest',
      'backfill',
      'memory headroom',
      'right-size',
      'outage',
      'DB is up but slow',
      'pooler',
    ]) {
      expect(html.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it('down state keeps critical DB language', () => {
    const failProbes: ProbeResult[] = [
      { name: 'reachability', ok: false, ms: 10000, detail: 'reachability timed out after 10000ms' },
      { name: 'alert-count', ok: false, ms: 0 },
      { name: 'pg-stats', ok: true, ms: 0, detail: 'skipped: n/a' },
    ];
    const subject = buildAlertSubject('down', 'healthy', '2026-09-15T00:00:00.000Z');
    expect(subject).toContain('DOWN');
    const html = buildAlertHtml('down', 'healthy', failProbes);
    expect(html).toContain('Mindy DB DOWN');
    expect(html).toContain('DB reachable');
    expect(html).toContain('no');
    expect(html).toContain('Reachability probe failed');
  });
});

describe('parsePgStatsDetail', () => {
  it('parses full stats JSON', () => {
    const s = parsePgStatsDetail(probesElevated[2].detail);
    expect(s?.total_connections).toBe(31);
    expect(s?.max_connections).toBe(160);
  });

  it('returns null for skipped detail', () => {
    expect(parsePgStatsDetail('skipped: function not found')).toBeNull();
  });
});

describe('probe timing samples', () => {
  it('builds the four timing fields', () => {
    const sample = buildProbeTimingSample({
      at: '2026-09-15T00:00:32.740Z',
      status: 'degraded',
      probes: probesElevated,
      overallMs: 4514,
    });
    expect(sample).toEqual({
      at: '2026-09-15T00:00:32.740Z',
      status: 'degraded',
      reachability_ms: 3970,
      alert_count_ms: 137,
      pg_stats_ms: 144,
      overall_ms: 4514,
      reachability_ok: true,
      alert_count_ok: true,
    });
  });

  it('ring-buffers samples at max', () => {
    const base = Array.from({ length: 3 }, (_, i) =>
      buildProbeTimingSample({
        at: `t${i}`,
        status: 'healthy',
        probes: probesElevated,
        overallMs: i,
      }),
    );
    const next = buildProbeTimingSample({
      at: 't3',
      status: 'degraded',
      probes: probesElevated,
      overallMs: 99,
    });
    const kept = appendProbeSample(base, next, 3);
    expect(kept).toHaveLength(3);
    expect(kept[0].at).toBe('t1');
    expect(kept[2].at).toBe('t3');
    expect(kept[2].overall_ms).toBe(99);
  });
});
