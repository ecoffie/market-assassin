import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SR-002 — LOST EXECUTION PROVENANCE.
 *
 * ingestDibbs computes `attempts[]` (every path entered, its outcome, its error), the
 * cost-guard decision, the vendor build and the Apify quota. The cron discarded all of it and
 * stored `STARVED: fetched 1`.
 *
 * MEASURED 2026-08-24. Four business-day failures could not be attributed:
 *
 *   Thu 08-20  success   last real ingest, 04:01
 *   Fri 08-21  STARVED
 *   Sat 08-22  "success" weekend — no-data-window rule, correctly
 *   Sun 08-23  "success" weekend
 *   Mon 08-24  STARVED
 *
 * As a run sequence that reads intermittent. Against BUSINESS DAYS it is 2 of 2 failed —
 * continuous, with the weekend passes masking it. Corpus: 0 rows in 48h, 3,867 of 28,214
 * RFQs still open.
 *
 * Distinct from SR-001 (silent vendor under-delivery), where the vendor shipped a broken
 * build and `source` defaulted to 'apify', sending the postmortem to the wrong path. Here the
 * routing and the starvation detection were both CORRECT — only the evidence was thrown away.
 *
 * These assert the evidence is PERSISTED. Behaviour is deliberately unchanged: this is an
 * observability fix, and changing the fetcher in the same commit would destroy the before/after.
 */
const ROUTE = readFileSync(
  join(process.cwd(), 'src/app/api/cron/sync-dibbs/route.ts'), 'utf8',
);
const INGEST = readFileSync(join(process.cwd(), 'src/lib/dibbs/ingest.ts'), 'utf8');

describe('SR-002 — the postmortem trail reaches the postmortem', () => {
  it('persists every path entered into the STORED error, not just the Slack alert', () => {
    // An alert is read once; cron_job_runs is what a postmortem four days later queries.
    expect(ROUTE).toMatch(/reportCronOutcome\([\s\S]{0,200}path: \$\{provenance\}/);
  });

  it('builds the provenance string from attempts[], including the error', () => {
    expect(ROUTE).toContain('result.attempts ?? []');
    expect(ROUTE).toMatch(/a\.path.*a\.outcome.*a\.records.*a\.ms/);
    expect(ROUTE).toContain('a.error');
  });

  it('says NO PATH ENTERED rather than implying one ran', () => {
    // The SR-001 mistake in miniature: a default that names a path nothing entered.
    expect(ROUTE).toContain('NO PATH ENTERED');
  });

  it('carries the cost-guard decision alongside the paths', () => {
    expect(ROUTE).toMatch(/guard: \$\{result\.costGuard\}/);
  });
});

describe('the operator is sent to the right system', () => {
  it('does not say "check Apify billing" when Apify was never reached', () => {
    // At maxItems=2500 the cost guard routes to the free direct fetcher, so billing cannot be
    // the cause. The old message said CHECK BILLING FIRST unconditionally.
    expect(ROUTE).toContain('apifyWasReached');
    expect(ROUTE).toContain('APIFY WAS NOT REACHED');
    expect(ROUTE).not.toMatch(/CHECK BILLING FIRST:<\/b>/);
  });

  it('still says check billing when Apify DID run', () => {
    // The advice is not wrong — it was unconditional. Keep it on the path where it applies.
    expect(ROUTE).toMatch(/apifyWasReached\s*\?[\s\S]{0,160}billing\/current-period/);
  });
});

describe('a weekend pass is "not expected", not "healthy"', () => {
  it('measures corpus staleness on the no-data-window path', () => {
    expect(ROUTE).toContain('lastSyncAgeHours');
    expect(ROUTE).toMatch(/weekend pass is NOT health/);
  });

  it('never fails a healthy run because the freshness read failed', () => {
    expect(ROUTE).toMatch(/catch \{ \/\* best-effort/);
  });
});

describe('fetch behaviour is unchanged — this is observability only', () => {
  it('keeps the cost-guard threshold and its direct-first routing', () => {
    expect(INGEST).toContain('APIFY_MAX_ITEMS_BEFORE_DIRECT');
    expect(INGEST).toContain('const useDirectFirst = overBudget');
  });

  it('keeps the pinned vendor build', () => {
    // SR-001's fix. Unpinning here would confound the rerun this commit exists to enable.
    expect(INGEST).toContain("process.env.APIFY_DIBBS_BUILD || '1.0.40'");
  });
});
