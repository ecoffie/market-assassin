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

/**
 * Workstream B — the rest of the enabled long jobs.
 *
 * Measured on production `cron_job_runs` for the 30 days to 2026-09-21: 88 enabled jobs
 * whose timeout_ms exceeds the dispatcher's 55s await cap ran 67,478 times, and 6,911 of
 * those runs (10.2%) ended as `dispatched` with http_status NULL — no terminal evidence
 * at all. TWENTY-ONE of those jobs were 100% blind: every run, every day.
 *
 * Worst offenders (unconfirmed / total runs): sow-catalog 965/2,633 · daily-alerts
 * 815/2,042 · sync-recompete-contracts 719/719 · backfill-recipient-certs 709/709 ·
 * enrich-recompete-detail 709/709 · enrich-opportunity-seo 628/628 · pursuit-changes
 * 221/221 · embed-sow-corpus 219/2,863 · tag-cta 212/628 · backfill-descriptions
 * 202/4,106 · backfill-descriptions-inactive 196/4,253.
 *
 * Each entry asserts the route imports the shared module and names the job it speaks for.
 */
const ROUTES_B: Array<[string, string]> = [
  ['src/app/api/cron/sync-recompete-contracts/route.ts', 'sync-recompete-contracts'],
  ['src/app/api/cron/backfill-recipient-certs/route.ts', 'backfill-recipient-certs'],
  ['src/app/api/cron/enrich-recompete-detail/route.ts', 'enrich-recompete-detail'],
  ['src/app/api/cron/enrich-opportunity-seo/route.ts', 'enrich-opportunity-seo'],
  ['src/app/api/cron/pursuit-changes/route.ts', 'pursuit-changes'],
  ['src/app/api/cron/backfill-sam-attachments/route.ts', 'backfill-sam-attachments'],
  ['src/app/api/cron/aggregate-profiles/route.ts', 'aggregate-profiles'],
  ['src/app/api/cron/data-invariants-watch/route.ts', 'data-invariants-watch'],
  ['src/app/api/cron/snapshot-watchlist/route.ts', 'snapshot-watchlist'],
  ['src/app/api/cron/upgrade-drip/route.ts', 'upgrade-drip'],
  ['src/app/api/cron/sow-catalog/route.ts', 'sow-catalog'],
  ['src/app/api/cron/tag-cta/route.ts', 'tag-cta'],
  ['src/app/api/cron/embed-sow-corpus/route.ts', 'embed-sow-corpus'],
  ['src/app/api/cron/refresh-bq-rollups/route.ts', 'refresh-bq-rollups'],
  ['src/app/api/cron/refresh-dodaac-directory/route.ts', 'refresh-dodaac-directory'],
  ['src/app/api/cron/fco-roster-watch/route.ts', 'fco-roster-watch'],
  ['src/app/api/cron/precompute-weekly-briefings/route.ts', 'precompute-weekly-briefings'],
  ['src/app/api/cron/health-check/route.ts', 'health-check-email'],
];

/** Routes reached by MORE THAN ONE cron_jobs row — the job name must come from the header. */
const SHARED_ROUTES: string[] = [
  'src/app/api/cron/daily-alerts/route.ts',            // daily-alerts + daily-alerts-10
  'src/app/api/cron/weekly-alerts/route.ts',           // weekly-alerts + weekly-alerts-mon
  'src/app/api/cron/send-briefings-fast/route.ts',     // send-briefings-fast + -fast-8
  'src/app/api/cron/sync-sam-opportunities/route.ts',  // -full + -delta + -resume
  'src/app/api/cron/backfill-descriptions/route.ts',   // + -inactive
  'src/app/api/admin/send-profile-reminders/route.ts', // profile-completion-reminders
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


describe('Workstream B — every remaining enabled long job reports its own outcome', () => {
  for (const [path, jobName] of ROUTES_B) {
    it(`${path.split('/').slice(-2)[0]} imports reportCronOutcome and names ${jobName}`, () => {
      const src = strip(read(path));
      expect(src).toContain("from '@/lib/cron-self-report'");
      expect(src).toMatch(/reportCronOutcome\(/);
      expect(src).toContain(jobName);
    });
  }

  it('none of them introduces a second observability system', () => {
    for (const [path] of ROUTES_B) {
      const src = strip(read(path));
      expect(src).not.toMatch(/create table/i);
      expect(src).not.toMatch(/cron_completions|job_completions/i);
    }
  });
});

describe('a route shared by several cron_jobs rows must not guess which one fired', () => {
  // reportCronOutcome writes BY JOB NAME. `/api/cron/daily-alerts` is the target of BOTH
  // `daily-alerts` and `daily-alerts-10` with an IDENTICAL query string, so a hardcoded
  // constant would stamp a terminal status on a job that never ran — worse than leaving
  // the run unconfirmed. The dispatcher declares the claimed row in `x-cron-job`.
  for (const path of SHARED_ROUTES) {
    it(`${path.split('/').slice(-2)[0]} resolves the job name from the dispatcher header`, () => {
      const src = strip(read(path));
      expect(src).toContain("from '@/lib/cron-self-report'");
      expect(src).toMatch(/dispatchedJobName\(/);
      // Gated on a real dispatcher fire, so a manual curl reports nothing.
      expect(src).toContain('x-cron-dispatch');
    });
  }

  it('the dispatcher actually sends the job name', () => {
    const src = strip(read('src/app/api/cron/dispatch/route.ts'));
    expect(src).toMatch(/'x-cron-job': job\.job_name/);
  });

  it('dispatchedJobName refuses anything that is not a cron_jobs-shaped name', async () => {
    const { dispatchedJobName } = await import('./cron-self-report');
    const h = (v: string | null) => ({ get: (n: string) => (n === 'x-cron-job' ? v : null) });
    expect(dispatchedJobName(h('daily-alerts-10'))).toBe('daily-alerts-10');
    expect(dispatchedJobName(h('  sync-recompete-contracts  '))).toBe('sync-recompete-contracts');
    expect(dispatchedJobName(h(null))).toBeNull();
    expect(dispatchedJobName(h(''))).toBeNull();
    // A stray header must not be able to address an arbitrary row.
    expect(dispatchedJobName(h('../../etc/passwd'))).toBeNull();
    expect(dispatchedJobName(h('job name with spaces'))).toBeNull();
    expect(dispatchedJobName(h('a'.repeat(200)))).toBeNull();
  });
});

describe('EXECUTION COMPLETION and DATA ADVANCEMENT are never conflated', () => {
  // The scar: DARPA/NSF logged 30/30 `success` + HTTP 200 while writing zero rows. So a
  // route that finished cleanly but moved nothing must NOT report success.
  const advancementGuards: Array<[string, RegExp]> = [
    // every queued SAM lookup failed → the cert cache did not advance
    ['src/app/api/cron/backfill-recipient-certs/route.ts', /deadKey \? 'error'/],
    // claimed rows, wrote no summaries (generateOppSummary swallows provider failures)
    ['src/app/api/cron/enrich-opportunity-seo/route.ts', /result\.written === 0 \? 'partial'/],
    // claimed rows, stamped none (USASpending detail throttling)
    ['src/app/api/cron/enrich-recompete-detail/route.ts', /stamped === 0 \? 'partial'/],
    // claimed NAICS, wrote no rows
    ['src/app/api/cron/sync-recompete-contracts/route.ts', /rowsWritten === 0/],
    // every SAM key 429'd → queue did not move
    ['src/app/api/cron/sow-catalog/route.ts', /allKeysExhausted/],
    // SAM daily quota spent, rows deliberately not burned
    ['src/app/api/cron/backfill-descriptions/route.ts', /rateLimited/],
    // embedded nothing at all (OpenAI down) while claiming rows
    ['src/app/api/cron/embed-sow-corpus/route.ts', /embedded === 0 && skipped === 0/],
    // computed snapshots but the table is missing → 0 written
    ['src/app/api/cron/snapshot-watchlist/route.ts', /daily_saved_search_snapshots missing/],
    // SAM.gov upstream down: a soft 200, but the corpus did not advance
    ['src/app/api/cron/sync-sam-opportunities/route.ts', /'partial', `SAM\.gov upstream unavailable/],
  ];

  for (const [path, re] of advancementGuards) {
    it(`${path.split('/').slice(-2)[0]} does not call a zero-advancement run a success`, () => {
      expect(strip(read(path))).toMatch(re);
    });
  }

  it('a WATCH reports on whether it looked, not on what it found', () => {
    // A breached invariant / a failing health probe is the watch WORKING. What makes the
    // job unhealthy is establishing nothing — an unevaluable probe, or no probe at all.
    const inv = strip(read('src/app/api/cron/data-invariants-watch/route.ts'));
    expect(inv).toMatch(/probeErrors\.length === results\.length/);
    expect(inv).not.toMatch(/breached\.length[^)]*\? 'error'/);
    const hc = strip(read('src/app/api/cron/health-check/route.ts'));
    expect(hc).toMatch(/results\.length === 0 \? 'error' : 'success'/);
  });
});

describe('a rehearsal or a preview must not speak for the scheduled job', () => {
  const rehearsals: Array<[string, RegExp]> = [
    ['src/app/api/cron/backfill-recipient-certs/route.ts', /if \(mode === 'execute'\) await reportCronOutcome/],
    ['src/app/api/cron/enrich-recompete-detail/route.ts', /if \(mode === 'execute'\)/],
    ['src/app/api/cron/pursuit-changes/route.ts', /if \(!testEmail\)/],
    ['src/app/api/cron/data-invariants-watch/route.ts', /if \(!dryRun\)/],
    ['src/app/api/cron/fco-roster-watch/route.ts', /if \(!dry\)/],
    ['src/app/api/cron/refresh-dodaac-directory/route.ts', /if \(!dryRun\)/],
    ['src/app/api/cron/precompute-weekly-briefings/route.ts', /if \(!isTest\)/],
  ];
  for (const [path, re] of rehearsals) {
    it(`${path.split('/').slice(-2)[0]} gates its report on the real scheduled shape`, () => {
      expect(strip(read(path))).toMatch(re);
    });
  }

  it('the single-user test paths on the shared send routes report nothing', () => {
    expect(strip(read('src/app/api/cron/weekly-alerts/route.ts')))
      .toMatch(/jobName: isTest && email \? null : claimedJob\(request\)/);
    expect(strip(read('src/app/api/cron/send-briefings-fast/route.ts')))
      .toMatch(/testEmail && isTest \? null : claimedJob\(request\)/);
  });
});

describe('a publicly reachable cron route must not let a passer-by stamp a job status', () => {
  // `sow-catalog` and `enrich-opportunity-seo` have NO auth guard at all (pre-existing,
  // and deliberately NOT fixed here). Their terminal report is therefore gated on the
  // dispatcher's own `x-cron-dispatch` header, so an anonymous GET cannot write a
  // terminal status onto a scheduled job it never ran.
  for (const path of [
    'src/app/api/cron/sow-catalog/route.ts',
    'src/app/api/cron/enrich-opportunity-seo/route.ts',
  ]) {
    it(`${path.split('/').slice(-2)[0]} only reports on a dispatcher fire`, () => {
      const src = strip(read(path));
      expect(src).toMatch(/function isDispatcherFire\(request: NextRequest\): boolean/);
      expect(src).toMatch(/x-cron-dispatch/);
      // EVERY reportCronOutcome call site in these two routes sits behind the gate.
      // Checked over a window rather than one line, because the guard can legitimately
      // be an enclosing `if (...) {` a line or two above the call.
      const sites: number[] = [];
      const re = /reportCronOutcome\(/g;
      for (let m = re.exec(src); m; m = re.exec(src)) sites.push(m.index);
      expect(sites.length).toBeGreaterThan(0);
      for (const at of sites) {
        const window = src.slice(Math.max(0, at - 200), at);
        expect(window).toMatch(/isDispatcherFire\(request\)/);
      }
    });
  }
});
