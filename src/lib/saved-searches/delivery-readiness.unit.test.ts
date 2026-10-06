import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSavedSearchDeliveryReadiness } from './delivery-readiness';

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

let tables: Record<string, ReturnType<typeof chain>> = {};
const mockFrom = vi.fn((table: string) => {
  const t = tables[table];
  if (!t) throw new Error(`unexpected table ${table}`);
  return t;
});
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/app/workspace', () => ({
  getAppSupabase: () => mockSupabase,
}));

function setup(opts: {
  storageError?: unknown;
  cron?: unknown[];
  cronError?: unknown;
  runs?: unknown[];
  runsError?: unknown;
  lastSentAt?: string | null;
  sendsDuringRun?: number | null;
  sendsError?: unknown;
}) {
  tables = {
    saved_searches: chain({ error: opts.storageError ?? null }),
    cron_jobs: chain({ data: opts.cron ?? [], error: opts.cronError ?? null }),
    cron_job_runs: chain({ data: opts.runs ?? [], error: opts.runsError ?? null }),
    email_provider_sends: chain(({ head }) => head
      ? { count: opts.sendsDuringRun ?? null, error: opts.sendsError ?? null }
      : { data: opts.lastSentAt ? [{ sent_at: opts.lastSentAt }] : [], error: opts.sendsError ?? null }),
  };
}

const NOW = new Date('2026-08-30T17:38:00Z');
const enabledCron = {
  job_name: 'saved-search-alerts',
  route: '/api/cron/saved-search-alerts?limit=50',
  enabled: true,
  cron_expr: '0 11 * * *',
  last_run_at: '2026-08-30T11:01:00Z',
  last_status: 'success',
};

describe('getSavedSearchDeliveryReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scheduler_unavailable when saved_searches table missing', async () => {
    setup({ storageError: { code: '42P01', message: 'saved_searches' } });

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.storage_ready).toBe(false);
    expect(r.delivery_state).toBe('scheduler_unavailable');
    expect(r.execution_health).toBe('service_unavailable');
    expect(r.delivery_ready).toBe(false);
    expect(r.system_status).toBe('system_failure');
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('delivery_degraded when cron row missing', async () => {
    setup({ cron: [] });

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.storage_ready).toBe(true);
    expect(r.cron_registered).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
    expect(r.delivery_ready).toBe(false);
  });

  it('delivery_configured when enabled but no completed execution is observed', async () => {
    setup({
      cron: [{ ...enabledCron, last_status: 'dispatched' }],
      runs: [{ started_at: '2026-08-30T11:01:00Z', status: 'dispatched', http_status: null }],
    });

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(false);
    expect(r.delivery_state).toBe('delivery_configured');
    expect(r.execution_health).toBe('not_observed');
  });

  it('delivery_ready only after a recent successful 2xx run', async () => {
    setup({
      cron: [enabledCron],
      runs: [{ started_at: '2026-08-30T11:01:00Z', status: 'success', http_status: 200 }],
    });

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(true);
    expect(r.delivery_state).toBe('delivery_ready');
    expect(r.execution_health).toBe('recent_success');
    expect(r.cron_job_name).toBe('saved-search-alerts');
  });

  it('accepts a recent route-self-reported success with null dispatcher HTTP status', async () => {
    setup({
      cron: [{ ...enabledCron, last_status: 'success' }],
      runs: [{ started_at: '2026-08-30T11:01:00Z', status: 'success', http_status: null }],
    });

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(true);
    expect(r.delivery_state).toBe('delivery_ready');
    expect(r.execution_health).toBe('recent_success');
  });

  it('delivery_degraded when cron disabled', async () => {
    setup({ cron: [{ ...enabledCron, enabled: false }] });

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.cron_registered).toBe(true);
    expect(r.cron_enabled).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
  });

  it('delivery_degraded when the latest success is stale', async () => {
    setup({
      cron: [{ ...enabledCron, last_status: 'dispatched' }],
      runs: [
        { started_at: '2026-08-30T11:01:00Z', status: 'dispatched', http_status: null },
        { started_at: '2026-08-12T11:00:00Z', status: 'success', http_status: 200 },
      ],
    });

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
    expect(r.execution_health).toBe('stale_success');
  });

  it('delivery_degraded when the latest run is a capacity-exhausted partial', async () => {
    setup({
      cron: [{ ...enabledCron, last_status: 'partial' }],
      runs: [{ started_at: '2026-08-30T11:01:00Z', status: 'partial', http_status: null }],
      sendsDuringRun: 0,
    });

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
    expect(r.execution_health).toBe('latest_failed');
  });

  it('delivery_degraded when a newer failure supersedes a recent success', async () => {
    setup({
      cron: [{ ...enabledCron, last_status: 'error' }],
      runs: [
        { started_at: '2026-08-30T11:02:00Z', status: 'error', http_status: 500 },
        { started_at: '2026-08-30T11:01:00Z', status: 'success', http_status: 200 },
      ],
      sendsDuringRun: 0,
    });

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
    expect(r.execution_health).toBe('latest_failed');
  });

  it('delivery_degraded when registration is not a daily schedule', async () => {
    setup({ cron: [{ ...enabledCron, cron_expr: '0 11 * * 1' }] });

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.cron_schedule_daily).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
    expect(r.execution_health).toBe('invalid_daily_schedule');
  });

  describe('a run that fails for SOME searches is not a delivery outage', () => {
    // Production, replayed exactly: saved-search-alerts reported `error` every day from 2026-09-30
    // (3 suppressed internal recipients rejected + 1 other customer's search threw) while the same
    // runs delivered 46-48 alerts a day. The probe used to answer "last success 2026-09-29".
    const SAVE_TIME = new Date('2026-10-05T23:20:13Z');
    const failures = 'unexpected_schedule_error=1,email_send_rejected=3';
    const prodRuns = [
      { started_at: '2026-10-05T11:00:29.934Z', finished_at: '2026-10-05T11:01:49.080Z', status: 'error', http_status: null, error: failures },
      { started_at: '2026-10-04T11:00:28.413Z', finished_at: '2026-10-04T11:01:42.085Z', status: 'error', http_status: null, error: failures },
      { started_at: '2026-10-03T11:00:27.793Z', finished_at: '2026-10-03T11:01:38.306Z', status: 'error', http_status: null, error: failures },
      { started_at: '2026-10-02T11:00:28.305Z', finished_at: '2026-10-02T11:01:53.117Z', status: 'error', http_status: null, error: failures },
      { started_at: '2026-10-01T11:00:27.980Z', finished_at: '2026-10-01T11:01:46.301Z', status: 'error', http_status: null, error: failures },
      { started_at: '2026-09-30T11:00:28.304Z', finished_at: '2026-09-30T11:01:54.133Z', status: 'error', http_status: null, error: 'email_send_rejected=3' },
      { started_at: '2026-09-29T11:00:28.490Z', finished_at: '2026-09-29T11:01:43.892Z', status: 'success', http_status: null, error: null },
    ];
    const prodCron = { ...enabledCron, cron_expr: '0 11 * * *', last_run_at: '2026-10-05T11:00:29Z', last_status: 'error' };

    it('partially failed job with successful deliveries → partial_degradation, last send = Oct 5, not Sept 29', async () => {
      setup({ cron: [prodCron], runs: prodRuns, lastSentAt: '2026-10-05T11:01:41.561Z', sendsDuringRun: 48 });

      const r = await getSavedSearchDeliveryReadiness(SAVE_TIME);
      expect(r.system_status).toBe('partial_degradation');
      expect(r.execution_health).toBe('partial_failure');
      expect(r.delivery_state).toBe('delivery_partial');
      expect(r.delivery_ready).toBe(true);
      expect(r.latest_run_alerts_sent).toBe(48);
      expect(r.latest_run_failures).toBe(failures);
      expect(r.latest_run_processing_failures).toEqual({ unexpected_schedule_error: 1, email_send_rejected: 3 });
      expect(r.suppression_action_items).toEqual({});
      expect(r.last_alert_sent_at).toBe('2026-10-05T11:01:41.561Z');
      // the job-run fact is preserved, but only under a name that says what it is
      expect(r.last_clean_run_at).toBe('2026-09-29T11:00:28.490Z');
      expect(r).not.toHaveProperty('last_success_at');
    });

    it('the same failed run with ZERO provider sends is not called healthy (degraded_unconfirmed)', async () => {
      setup({ cron: [prodCron], runs: prodRuns, lastSentAt: '2026-10-04T11:01:41Z', sendsDuringRun: 0 });

      const r = await getSavedSearchDeliveryReadiness(SAVE_TIME);
      expect(r.system_status).toBe('degraded_unconfirmed');
      expect(r.delivery_ready).toBe(false);
      expect(r.latest_run_alerts_sent).toBe(0);
    });

    it('an unreadable send ledger is unknown, never a zero and never healthy', async () => {
      setup({ cron: [prodCron], runs: prodRuns, sendsError: { message: 'boom' } });

      const r = await getSavedSearchDeliveryReadiness(SAVE_TIME);
      expect(r.latest_run_alerts_sent).toBeNull();
      expect(r.last_alert_sent_at).toBeNull();
      expect(r.system_status).toBe('degraded_unconfirmed');
      expect(r.delivery_ready).toBe(false);
    });

    it('no run at all in today\'s window is a confirmed system failure', async () => {
      setup({ cron: [prodCron], runs: prodRuns.slice(1), lastSentAt: '2026-10-04T11:01:41Z', sendsDuringRun: 46 });

      const r = await getSavedSearchDeliveryReadiness(SAVE_TIME);
      expect(r.system_status).toBe('system_failure');
      expect(r.delivery_ready).toBe(false);
    });

    it('a probe read error is unknown, not a system failure', async () => {
      setup({ cron: [prodCron], runsError: { message: 'timeout' } });

      const r = await getSavedSearchDeliveryReadiness(SAVE_TIME);
      expect(r.system_status).toBe('unknown');
      expect(r.delivery_ready).toBe(false);
    });
  });

  describe('confirmed recipient suppression is an action item, not an outage (#1834/#1836 classes)', () => {
    const T = new Date('2026-10-05T23:20:13Z');
    const cron = { ...enabledCron, cron_expr: '0 11 * * *' };
    const prior = { started_at: '2026-10-04T11:00:28Z', status: 'success', http_status: null, error: null };

    it('a run whose ONLY failures are recipient_suppressed is healthy, with the suppression listed', async () => {
      setup({
        cron: [cron],
        runs: [{ started_at: '2026-10-05T11:00:29Z', finished_at: '2026-10-05T11:01:49Z', status: 'error', http_status: null, error: 'recipient_suppressed=3' }, prior],
        lastSentAt: '2026-10-05T11:01:41Z',
      });
      const r = await getSavedSearchDeliveryReadiness(T);
      expect(r.system_status).toBe('healthy');
      expect(r.delivery_ready).toBe(true);
      expect(r.suppression_action_items).toEqual({ recipient_suppressed: 3 });
      expect(r.latest_run_processing_failures).toEqual({});
      expect(r.last_clean_run_at).toBe('2026-10-05T11:00:29Z');
    });

    it('suppression alongside a processing failure is still partial degradation, suppression kept separate', async () => {
      setup({
        cron: [cron],
        runs: [{ started_at: '2026-10-05T11:00:29Z', finished_at: '2026-10-05T11:01:49Z', status: 'error', http_status: null, error: 'unexpected_schedule_error=1,recipient_suppressed=3' }, prior],
        lastSentAt: '2026-10-05T11:01:41Z',
        sendsDuringRun: 48,
      });
      const r = await getSavedSearchDeliveryReadiness(T);
      expect(r.system_status).toBe('partial_degradation');
      expect(r.latest_run_processing_failures).toEqual({ unexpected_schedule_error: 1 });
      expect(r.suppression_action_items).toEqual({ recipient_suppressed: 3 });
    });

    it('legacy email_send_rejected stays a processing failure (it cannot prove suppression)', async () => {
      setup({
        cron: [cron],
        runs: [{ started_at: '2026-10-05T11:00:29Z', finished_at: '2026-10-05T11:01:49Z', status: 'error', http_status: null, error: 'email_send_rejected=3' }, prior],
        sendsDuringRun: 0,
      });
      const r = await getSavedSearchDeliveryReadiness(T);
      expect(r.system_status).toBe('degraded_unconfirmed');
      expect(r.suppression_action_items).toEqual({});
    });
  });
});
