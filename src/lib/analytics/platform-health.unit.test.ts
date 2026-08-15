/**
 * GUARD — Platform Health must never report a status it did not measure.
 *
 * This is the governance rule the module exists to enforce (Eric 2026-08-15, after I reported data
 * as stale without measuring it): an unverifiable check is `unknown` + a blocker, NOT `healthy`
 * (a swallowed error that reads green) and NOT `degraded`/`failed` (asserting a problem we never
 * observed). Rule 4: *"Never say 'the data is stale.' Say 'freshness verification is currently
 * unavailable because…'"*
 *
 * Source-level, no network: the judging logic is pure, and these assertions pin the exact
 * distinctions that were collapsed the first time.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/lib/analytics/platform-health.ts'), 'utf8');

describe('Platform Health — the never-infer rule', () => {
  it('read the real module (a vacuous pass would hide every assertion below)', () => {
    expect(SRC.length).toBeGreaterThan(2000);
    expect(SRC).toContain('getPlatformHealth');
  });

  it("treats a BigQuery QUOTA failure as UNMEASURED, never as stale data", () => {
    // The exact conflation that caused the original wrong claim: quota blocks VERIFICATION,
    // which is not evidence about the data's age.
    expect(SRC).toMatch(/quota/i);
    expect(SRC).toContain('It does not mean the data is stale');
    // The quota branch must push to `unmeasured`, not fabricate a dataset status.
    const catchBlock = SRC.slice(SRC.indexOf('} catch (err) {'));
    expect(catchBlock).toContain('unmeasured.push');
    expect(catchBlock).not.toContain("status: 'degraded'");
  });

  it('has `unknown` as a first-class status, with a blocker field to explain it', () => {
    expect(SRC).toContain("'unknown'");
    expect(SRC).toContain('blockedBy');
  });

  it('does NOT report a never-stamped source as stale (null ≠ old)', () => {
    // A source with no last_built has never been measured — that is unknown, not degraded.
    const branch = SRC.slice(SRC.indexOf('if (!row.last_built)'), SRC.indexOf('const limit ='));
    expect(branch).toContain("status: 'unknown'");
    expect(branch).not.toContain("status: 'degraded'");
  });

  it('does NOT report a live API as stale (nothing builds it)', () => {
    const branch = SRC.slice(SRC.indexOf("row.category === 'live_api'"));
    expect(branch.slice(0, 300)).toContain("status: 'healthy'");
  });

  it("treats a 'dispatched' job as UNKNOWN, not success", () => {
    // Long jobs are ack'd early, so dispatched-forever and dead look identical. Claiming success
    // would be inferring an outcome we never observed.
    const branch = SRC.slice(SRC.indexOf("=== 'dispatched'"));
    expect(branch.slice(0, 260)).toContain("status: 'unknown'");
  });

  it('judges each dataset against its OWN cadence, not one global threshold', () => {
    expect(SRC).toContain('CADENCE_DAYS');
    expect(SRC).toMatch(/quarterly:\s*\d+/);
    expect(SRC).toMatch(/weekly:\s*\d+/);
    // 'as-published' has no schedule to be late against.
    expect(SRC).toContain("'as-published': Infinity");
  });

  it('surfaces a failed block as unmeasured rather than an empty green list', () => {
    expect(SRC).toContain('data_sources read failed');
    expect(SRC).toContain('cron_jobs read failed');
  });
});
