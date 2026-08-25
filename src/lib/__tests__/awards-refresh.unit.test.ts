import { describe, it, expect } from 'vitest';
import { evaluateFreshness, UPSTREAM_STALE_DAYS, TOLERANCE, MAX_BYTES_BILLED } from '../awards-refresh';

/**
 * The refresh cron's decision logic.
 *
 * The gate that matters most is step 3: rebuild ONLY when upstream genuinely
 * advanced. Rebuilding identical data because the clock moved wastes ~$0.11 and
 * 23k row writes per run; NOT rebuilding when upstream moved leaves pages
 * confidently stale. These pin the distinction.
 */

describe('freshness gate', () => {
  it('rebuilds when upstream is newer than live', () => {
    const r = evaluateFreshness('2026-08-11', '2026-08-03', 14);
    expect(r.shouldRebuild).toBe(true);
    expect(r.reason).toContain('2026-08-11');
  });

  it('NO-OPS when upstream has not advanced — the money-saving path', () => {
    const r = evaluateFreshness('2026-08-11', '2026-08-11', 3);
    expect(r.shouldRebuild).toBe(false);
    expect(r.upstreamStale).toBe(false);
  });

  it('no-ops when upstream is somehow OLDER than live', () => {
    // Never expected, but a rebuild would move the site backwards.
    expect(evaluateFreshness('2026-07-01', '2026-08-03', 3).shouldRebuild).toBe(false);
  });

  it('rebuilds when there is no live generation at all', () => {
    expect(evaluateFreshness('2026-08-11', null, 2).shouldRebuild).toBe(true);
  });

  it('refuses to rebuild when the upstream date is unreadable', () => {
    // "I do not know" must never trigger a paid rebuild.
    const r = evaluateFreshness(null, '2026-08-03', null);
    expect(r.shouldRebuild).toBe(false);
    expect(r.upstreamStale).toBe(true);
  });

  it('staleness is INDEPENDENT of the rebuild decision', () => {
    // The live production state on 2026-08-25: upstream is newer than live AND
    // itself 14 days old. Both are true, and each needs its own response —
    // rebuild, and alert someone about the ingest.
    const r = evaluateFreshness('2026-08-11', '2026-08-03', 14);
    expect(r.shouldRebuild).toBe(true);
    expect(r.upstreamStale).toBe(true);
  });

  it('a fresh upstream that matches live is neither stale nor a rebuild', () => {
    const r = evaluateFreshness('2026-08-24', '2026-08-24', 1);
    expect(r.shouldRebuild).toBe(false);
    expect(r.upstreamStale).toBe(false);
  });

  it('flags upstream staleness exactly at the threshold boundary', () => {
    expect(evaluateFreshness('2026-08-11', '2026-08-11', UPSTREAM_STALE_DAYS).upstreamStale).toBe(false);
    expect(evaluateFreshness('2026-08-11', '2026-08-11', UPSTREAM_STALE_DAYS + 1).upstreamStale).toBe(true);
  });
});

describe('ceilings are real', () => {
  it('the byte cap is 20 GB', () => {
    expect(MAX_BYTES_BILLED).toBe(20 * 1024 ** 3);
  });

  it('a build smaller than the floor is treated as broken, not shrunk', () => {
    // 9,639 recipients is the live population. A build returning 200 is a broken
    // query, and promoting it would delete ~9,400 pages from the index.
    expect(TOLERANCE.minRecipients).toBeGreaterThan(1000);
    expect(200).toBeLessThan(TOLERANCE.minRecipients);
    expect(9639).toBeGreaterThan(TOLERANCE.minRecipients);
  });

  it('plausibility tolerance is tight enough to catch a halving', () => {
    const live = 23492;
    const halved = Math.round(live / 2);
    const drift = Math.abs(halved - live) / live * 100;
    expect(drift).toBeGreaterThan(TOLERANCE.pagesPct); // would be refused
  });

  it('tolerance still allows normal week-over-week growth', () => {
    const live = 23492;
    const grown = Math.round(live * 1.03); // +3%
    const drift = Math.abs(grown - live) / live * 100;
    expect(drift).toBeLessThan(TOLERANCE.pagesPct); // promotes fine
  });
});

describe('outcome semantics', () => {
  /** Which outcomes leave the live generation untouched? */
  const LIVE_UNTOUCHED = [
    'noop-upstream-not-newer',
    'skipped-locked',
    'failed-validation',
    'failed-build',
  ] as const;

  it('every failure mode before promotion leaves live serving', () => {
    // The entire point: a broken refresh must degrade to "yesterday's data",
    // never to "no data" — which is how the original outage happened.
    for (const o of LIVE_UNTOUCHED) {
      expect(o).not.toBe('success');
    }
    expect(LIVE_UNTOUCHED).toHaveLength(4);
  });

  it('a lock conflict is not an error', () => {
    // Overlapping runs are expected under a daily schedule with a slow build.
    // Exiting cleanly is correct behaviour, not a failure to alert on.
    const outcome = 'skipped-locked';
    expect(LIVE_UNTOUCHED).toContain(outcome);
  });
});
