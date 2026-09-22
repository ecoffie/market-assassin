/**
 * Workstream C — long-job completion reporting.
 *
 * The dispatcher fire-and-forgets any job whose timeout_ms exceeds its 55s await
 * cap: it waits LONG_JOB_ACK_MS (12s), aborts the client fetch and records
 * `dispatched` with http_status NULL — a status the watchdog deliberately
 * IGNORES, because a false `timeout` would alert on every healthy long job.
 *
 * That timing is CORRECT. The gap is that slow routes had no way to speak after
 * the dispatcher stopped listening. `reportCronOutcome` (already shipped) is how
 * they speak; it was wired into only 4 routes.
 *
 * Measured unconfirmed runs in 30 days: sync-recompete-contracts 719,
 * backfill-recipient-certs 709, enrich-recompete-detail 709,
 * enrich-opportunity-seo 627, sync-decision-makers 71.
 *
 * These assert the WIRING, so a route cannot silently stop reporting.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ROUTES: Array<[string, string]> = [
  ['src/app/api/cron/sync-gov-buyer-data/route.ts', 'sync-decision-makers'],
  ['src/app/api/cron/institute-legislation-sync/route.ts', 'institute-legislation-sync'],
  ['src/app/api/cron/precompute-opp-intel/route.ts', 'precompute-opp-intel'],
  ['src/app/api/cron/snapshot-multisite/route.ts', 'snapshot-multisite-nih'],
];

describe('every newly wired long route reports its own outcome', () => {
  for (const [path, jobName] of ROUTES) {
    it(`${path.split('/').slice(-2)[0]} imports and calls reportCronOutcome`, () => {
      const src = strip(read(path));
      expect(src).toContain("from '@/lib/cron-self-report'");
      expect(src).toMatch(/reportCronOutcome\(/);
      expect(src).toContain(jobName);
    });
  }
});

describe('reuse, not a second observability system', () => {
  it('no new completion table or status column is introduced', () => {
    for (const [path] of ROUTES) {
      const src = strip(read(path));
      expect(src).not.toMatch(/create table/i);
      expect(src).not.toMatch(/cron_completions|job_completions/i);
    }
  });

  it('the existing self-report module is unchanged', () => {
    const src = read('src/lib/cron-self-report.ts');
    expect(src).toContain('export async function reportCronOutcome');
    expect(src).toMatch(/export type CronOutcome = 'success' \| 'error' \| 'partial'/);
  });
});

describe('dispatch truth and completion truth stay separate', () => {
  it("`dispatched` is never overwritten to mean success by the DISPATCHER", () => {
    const src = strip(read('src/app/api/cron/dispatch/route.ts'));
    // The dispatcher still records 'dispatched' for a long job — that fact is
    // the handoff record and must survive. Completion is reported by the CALLEE.
    expect(src).toMatch(/status = isLongJob \? 'dispatched' : 'timeout'/);
  });

  it('a route that scraped nothing reports partial, never success', () => {
    const src = strip(read('src/app/api/cron/snapshot-multisite/route.ts'));
    expect(src).toMatch(/reportCronOutcome\(\s*jobName,\s*'partial'/);
  });

  it('a run where every item failed is not a success', () => {
    const src = strip(read('src/app/api/cron/precompute-opp-intel/route.ts'));
    expect(src).toMatch(/failed >= done \? 'partial' : 'success'/);
  });
});

describe('a shared route cannot report for the wrong job', () => {
  it('multisite maps source -> job name explicitly and reports only a single-source run', () => {
    const src = strip(read('src/app/api/cron/snapshot-multisite/route.ts'));
    expect(src).toMatch(/CRON_JOB_BY_SOURCE/);
    expect(src).toMatch(/sourcesToScrape\.length === 1/);
    for (const j of ['snapshot-multisite-nih', 'snapshot-multisite-nsf', 'snapshot-multisite-darpa']) {
      expect(src).toContain(j);
    }
  });

  it('the route/job name mismatch is stated, not inferred from the path', () => {
    const src = read('src/app/api/cron/sync-gov-buyer-data/route.ts');
    expect(src).toMatch(/const CRON_JOB_NAME = 'sync-decision-makers'/);
  });
});

describe('a rehearsal must not speak for the scheduled job', () => {
  it('dry runs do not report an outcome', () => {
    const src = strip(read('src/app/api/cron/sync-gov-buyer-data/route.ts'));
    expect(src).toMatch(/if \(!dry\) await reportCronOutcome/);
  });
  it('multisite dry runs do not report either', () => {
    const src = strip(read('src/app/api/cron/snapshot-multisite/route.ts'));
    expect(src).toMatch(/if \(!dryRun && sourcesToScrape\.length === 1\)/);
  });
});
