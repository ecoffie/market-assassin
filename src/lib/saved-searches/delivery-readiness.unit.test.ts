import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSavedSearchDeliveryReadiness, classifyRunFailures } from './delivery-readiness';
import { SUPPRESSION_CLASSES } from '@/lib/cron/watchdog-incidents';

type Result = { data?: unknown; error?: unknown; count?: number | null };

/** Chainable PostgREST fake: every builder method returns itself; awaiting resolves `result`. */
function chain(result: Result | ((ctx: { head: boolean }) => Result)) {
  const ctx = { head: false };
  const target: Record<string, unknown> = {};
  const proxy: Record<string, unknown> = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        const r = typeof result === 'function' ? result(ctx) : result;
        return (resolve: (v: unknown) => void) => resolve({ data: null, error: null, count: null, ...r });
      }
      return (...args: unknown[]) => {
        if (prop === 'select' && (args[1] as { head?: boolean } | undefined)?.head) ctx.head = true;
        return proxy;
      };
    },
  });
  return proxy;
}

let tables: Record<string, () => ReturnType<typeof chain>> = {};
const mockFrom = vi.fn((table: string) => {
  const t = tables[table];
  if (!t) throw new Error(`unexpected table ${table}`);
  return t();
});
vi.mock('@/lib/app/workspace', () => ({ getAppSupabase: () => ({ from: mockFrom }) }));

function setup(opts: {
  storageError?: unknown;
  cron?: unknown[];
  cronError?: unknown;
  runs?: unknown[];
  runsError?: unknown;
  lastAcceptedAt?: string | null;
  acceptedDuringRun?: number | null;
  sendsError?: unknown;
  evaluatedDuringRun?: number | null;
  evaluatedError?: unknown;
}) {
  tables = {
    saved_searches: () => chain(({ head }) => head
      ? { count: opts.evaluatedDuringRun ?? null, error: opts.evaluatedError ?? null }
      : { error: opts.storageError ?? null }),
    cron_jobs: () => chain({ data: opts.cron ?? [], error: opts.cronError ?? null }),
    cron_job_runs: () => chain({ data: opts.runs ?? [], error: opts.runsError ?? null }),
    email_provider_sends: () => chain(({ head }) => head
      ? { count: opts.acceptedDuringRun ?? null, error: opts.sendsError ?? null }
      : { data: opts.lastAcceptedAt ? [{ sent_at: opts.lastAcceptedAt }] : [], error: opts.sendsError ?? null }),
  };
}

const NOW = new Date('2026-08-30T17:38:00Z');
const cron = {
  job_name: 'saved-search-alerts',
  route: '/api/cron/saved-search-alerts?limit=50',
  enabled: true,
  cron_expr: '0 11 * * *',
  last_run_at: '2026-08-30T11:01:00Z',
  last_status: 'success',
};
const run = (status: string, error: string | null = null, at = '2026-08-30T11:01:00Z', http_status: number | null = null) =>
  ({ started_at: at, finished_at: null, status, http_status, error });

beforeEach(() => vi.clearAllMocks());

describe('classifyRunFailures — the watchdog classifier is the single source', () => {
  it('splits processing from confirmed suppression exactly as SUPPRESSION_CLASSES says', () => {
    const c = classifyRunFailures('error', 'unexpected_schedule_error=1,recipient_suppressed=3,suppression_lookup_failed=2');
    expect(c.processing).toEqual({ unexpected_schedule_error: 1, suppression_lookup_failed: 2 });
    expect(c.suppression).toEqual({ recipient_suppressed: 3 });
    expect([...SUPPRESSION_CLASSES]).toEqual(['recipient_suppressed']);
  });
  it('moves with the watchdog, never apart: a class added there changes the result here', () => {
    SUPPRESSION_CLASSES.add('suppression_lookup_failed');
    try {
      expect(classifyRunFailures('error', 'suppression_lookup_failed=1').suppressionOnly).toBe(true);
    } finally {
      SUPPRESSION_CLASSES.delete('suppression_lookup_failed');
    }
    expect(classifyRunFailures('error', 'suppression_lookup_failed=1').suppressionOnly).toBe(false);
  });
});

describe('job status — the named saved-search alerts job', () => {
  it('storage missing → job_failure (confirmed)', async () => {
    setup({ storageError: { code: '42P01', message: 'saved_searches' } });
    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.job_status).toBe('job_failure');
    expect(r.delivery_state).toBe('scheduler_unavailable');
    expect(r.job_status_reason).toMatch(/^saved-search alerts: /);
  });

  it('a probe read error is unknown, never failure or healthy', async () => {
    setup({ cron: [cron], runsError: { message: 'timeout' } });
    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.job_status).toBe('unknown');
    expect(r.delivery_ready).toBe(false);
  });

  it('job missing / disabled / non-daily → job_failure', async () => {
    for (const c of [[], [{ ...cron, enabled: false }], [{ ...cron, cron_expr: '0 11 * * 1' }]]) {
      setup({ cron: c });
      expect((await getSavedSearchDeliveryReadiness(NOW)).job_status).toBe('job_failure');
    }
  });

  it('clean run in window → healthy, with provider acceptance (not inbox) reported', async () => {
    setup({ cron: [cron], runs: [run('success')], lastAcceptedAt: '2026-08-30T11:01:09Z', acceptedDuringRun: 12, evaluatedDuringRun: 40 });
    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.job_status).toBe('healthy');
    expect(r.delivery_ready).toBe(true);
    expect(r.last_alert_provider_accepted_at).toBe('2026-08-30T11:01:09Z');
    expect(r.inbox_delivery).toBe('not_observable');
    expect(r).not.toHaveProperty('last_success_at');
  });

  it('suppression-only failures → healthy with an action item, not a failure', async () => {
    setup({ cron: [cron], runs: [run('error', 'recipient_suppressed=3')], acceptedDuringRun: 5, evaluatedDuringRun: 9 });
    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.job_status).toBe('healthy');
    expect(r.suppression_action_items).toEqual({ recipient_suppressed: 3 });
    expect(r.job_status_reason).toMatch(/action item: recipient_suppressed=3/);
  });

  it('failed suppression LOOKUP is a processing error → partial failure, never suppression', async () => {
    setup({ cron: [cron], runs: [run('error', 'suppression_lookup_failed=1')], acceptedDuringRun: 4, evaluatedDuringRun: 9 });
    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.job_status).toBe('partial_failure');
    expect(r.latest_run_processing_failures).toEqual({ suppression_lookup_failed: 1 });
    expect(r.suppression_action_items).toEqual({});
  });

  it('ZERO sends alone is not an outage: per-search failures + searches evaluated → partial failure', async () => {
    setup({ cron: [cron], runs: [run('error', 'invalid_saved_filters=1')], acceptedDuringRun: 0, evaluatedDuringRun: 30 });
    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.job_status).toBe('partial_failure');
    expect(r.latest_run_alerts_provider_accepted).toBe(0);
  });

  it('per-search failures with nothing evaluated and nothing sent → job_failure', async () => {
    setup({ cron: [cron], runs: [run('error', 'invalid_saved_filters=1')], acceptedDuringRun: 0, evaluatedDuringRun: 0 });
    expect((await getSavedSearchDeliveryReadiness(NOW)).job_status).toBe('job_failure');
  });

  it('unreadable evidence for a failed run → unknown, never zero, never healthy', async () => {
    setup({ cron: [cron], runs: [run('error', 'invalid_saved_filters=1')], sendsError: { message: 'boom' }, evaluatedDuringRun: 30 });
    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.job_status).toBe('unknown');
    expect(r.latest_run_alerts_provider_accepted).toBeNull();
    expect(r.last_alert_provider_accepted_at).toBeNull();
  });

  it('run-level failures are the job failing as a whole', async () => {
    for (const r0 of [run('error', 'saved_search_query_failed=1'), run('timeout'), run('error', 'This operation was aborted'), run('error', null), run('success', null, undefined, 500)]) {
      setup({ cron: [cron], runs: [r0], acceptedDuringRun: 3, evaluatedDuringRun: 3 });
      expect((await getSavedSearchDeliveryReadiness(NOW)).job_status).toBe('job_failure');
    }
  });

  it('a capacity backlog (status partial) with work done → partial failure', async () => {
    setup({ cron: [cron], runs: [run('partial', 'backlog=40')], acceptedDuringRun: 20, evaluatedDuringRun: 400 });
    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.job_status).toBe('partial_failure');
    expect(r.job_status_reason).toMatch(/backlog/);
  });

  it("no run in today's window → job_failure; today's run dispatched but unreported → unknown; never ran → not_observed", async () => {
    setup({ cron: [cron], runs: [run('success', null, '2026-08-12T11:00:00Z')] });
    expect((await getSavedSearchDeliveryReadiness(NOW)).job_status).toBe('job_failure');
    setup({ cron: [cron], runs: [run('dispatched'), run('success', null, '2026-08-29T09:00:00Z')] });
    expect((await getSavedSearchDeliveryReadiness(NOW)).job_status).toBe('unknown');
    setup({ cron: [cron], runs: [] });
    expect((await getSavedSearchDeliveryReadiness(NOW)).job_status).toBe('not_observed');
  });

  it("today's run that finished inside its grace period is judged, not yesterday's", async () => {
    setup({ cron: [cron], runs: [run('success', null, '2026-08-30T11:00:30Z'), run('error', 'saved_search_query_failed=1', '2026-08-29T11:00:30Z')], acceptedDuringRun: 2, evaluatedDuringRun: 5 });
    const r = await getSavedSearchDeliveryReadiness(new Date('2026-08-30T12:00:00Z'));
    expect(r.job_status).toBe('healthy');
    expect(r.latest_run_started_at).toBe('2026-08-30T11:00:30Z');
  });
});

describe('production replay: one failing search must not read as "no successful sends since Sept 29"', () => {
  // saved-search-alerts reported `error` every day from 2026-09-30 (3 searches on one suppressed internal
  // address rejected under the legacy class + 1 malformed customer search) while each run delivered 46-48.
  const SAVE_TIME = new Date('2026-10-05T23:20:13Z');
  const failures = 'unexpected_schedule_error=1,email_send_rejected=3';
  const prodRuns = [
    { started_at: '2026-10-05T11:00:29.934Z', finished_at: '2026-10-05T11:01:49.080Z', status: 'error', http_status: null, error: failures },
    { started_at: '2026-10-04T11:00:28.413Z', finished_at: '2026-10-04T11:01:42.085Z', status: 'error', http_status: null, error: failures },
    { started_at: '2026-09-30T11:00:28.304Z', finished_at: '2026-09-30T11:01:54.133Z', status: 'error', http_status: null, error: 'email_send_rejected=3' },
    { started_at: '2026-09-29T11:00:28.490Z', finished_at: '2026-09-29T11:01:43.892Z', status: 'success', http_status: null, error: null },
  ];

  it('→ partial failure of the saved-search alerts job, 48 provider-accepted, 134 evaluated, last accepted Oct 5', async () => {
    setup({ cron: [cron], runs: prodRuns, lastAcceptedAt: '2026-10-05T11:01:48.549Z', acceptedDuringRun: 48, evaluatedDuringRun: 134 });
    const r = await getSavedSearchDeliveryReadiness(SAVE_TIME);
    expect(r.job_status).toBe('partial_failure');
    expect(r.delivery_ready).toBe(true);
    expect(r.latest_run_alerts_provider_accepted).toBe(48);
    expect(r.latest_run_searches_evaluated).toBe(134);
    expect(r.last_alert_provider_accepted_at).toBe('2026-10-05T11:01:48.549Z');
    expect(r.last_clean_run_at).toBe('2026-09-29T11:00:28.490Z');
    expect(r.job_status_reason).toBe('saved-search alerts: partial failure: unexpected_schedule_error=1, email_send_rejected=3 failed; the rest ran (evaluated 134 searches, 48 alerts accepted by the email provider)');
    expect(r.job_status_reason).not.toMatch(/2026-09-29|no successful/);
  });

  it('after #1834 the same rejects classify as recipient_suppressed → action item; still a partial failure (the malformed search)', async () => {
    setup({ cron: [cron], runs: [{ ...prodRuns[0], error: 'unexpected_schedule_error=1,recipient_suppressed=3' }], acceptedDuringRun: 48, evaluatedDuringRun: 134 });
    const r = await getSavedSearchDeliveryReadiness(SAVE_TIME);
    expect(r.job_status).toBe('partial_failure');
    expect(r.latest_run_processing_failures).toEqual({ unexpected_schedule_error: 1 });
    expect(r.suppression_action_items).toEqual({ recipient_suppressed: 3 });
  });
});
