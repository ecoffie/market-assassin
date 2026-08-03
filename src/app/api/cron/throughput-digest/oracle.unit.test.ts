import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');

/**
 * These pin the QUERY SHAPE, not arithmetic. The failure mode this route exists to
 * survive is a check that silently reads the wrong column and reports a cheerful
 * 100%/"unknown" forever — which is exactly how the seven pre-existing health crons
 * missed a six-day outage. Verified live 2026-08-03 against known-true values:
 *   SAM 4% (1000/23192)  ·  alerts 1000/1594  ·  guard 4 (24h)  ·  orphaned 594
 */
describe('throughput digest — query shape', () => {
  it('reads the real SAM columns, not a phantom field', () => {
    expect(src).toContain("from('sam_sync_runs')");
    expect(src).toMatch(/total_fetched.*total_available/s);
    expect(src).toContain("eq('sync_type', 'full')");
  });

  it('measures the send guard over 24 HOURS, not an open-ended window', () => {
    // The oracle initially expected 48 — that was the 14-day total. A guard count
    // that silently widens its window stops being a daily signal.
    expect(src).toMatch(/24 \* 60 \* 60 \* 1000/);
    expect(src).toContain("eq('error_message', 'send_guard_blocked')");
  });

  it('compares briefings_enabled against the table the CRON actually reads', () => {
    // customer_classifications is the audience source (fetchBriefingEntitlements),
    // NOT user_profiles.access_briefings — checking the wrong one reports 0 orphans.
    expect(src).toContain("from('customer_classifications')");
    expect(src).toMatch(/'lifetime', '1_year', '6_month', 'subscription', 'beta_preview'/);
  });

  it('counts DISTINCT users for alert coverage, not raw rows', () => {
    // A user can have several alert_log rows in a day; counting rows would inflate
    // coverage past 100% and hide a shortfall.
    expect(src).toMatch(/new Set\(\(rows \|\| \[\]\)\.map/);
  });

  it('surfaces query errors instead of reporting a healthy default', () => {
    // A failed query must read 'unknown' + ok:false, never a silent pass.
    expect(src).toMatch(/query failed/);
    expect(src).toMatch(/value: 'unknown', ok: false/);
  });

  it('posts every day, healthy or not', () => {
    // Silence is indistinguishable from a broken monitor — the exact failure of the
    // seven existing health crons. No early return before sendOpsAlert.
    const guard = src.slice(src.indexOf('const failing'), src.indexOf('sendOpsAlert'));
    expect(guard).not.toMatch(/return NextResponse/);
  });
});
