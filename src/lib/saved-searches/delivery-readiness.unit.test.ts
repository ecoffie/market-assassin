import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSavedSearchDeliveryReadiness } from './delivery-readiness';

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/app/workspace', () => ({
  getAppSupabase: () => mockSupabase,
}));

function storageProbe(error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ error }),
    }),
  };
}

function cronProbe(rows: unknown[], error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      ilike: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: rows, error }),
      }),
    }),
  };
}

function runsProbe(rows: unknown[], error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: rows, error }),
        }),
      }),
    }),
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
    mockFrom.mockReturnValueOnce(storageProbe({ code: '42P01', message: 'saved_searches' }));

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.storage_ready).toBe(false);
    expect(r.delivery_state).toBe('scheduler_unavailable');
    expect(r.execution_health).toBe('service_unavailable');
    expect(r.delivery_ready).toBe(false);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('delivery_degraded when cron row missing', async () => {
    mockFrom
      .mockReturnValueOnce(storageProbe(null))
      .mockReturnValueOnce(cronProbe([]));

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.storage_ready).toBe(true);
    expect(r.cron_registered).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
    expect(r.delivery_ready).toBe(false);
  });

  it('delivery_configured when enabled but no completed execution is observed', async () => {
    mockFrom
      .mockReturnValueOnce(storageProbe(null))
      .mockReturnValueOnce(cronProbe([{ ...enabledCron, last_status: 'dispatched' }]))
      .mockReturnValueOnce(runsProbe([
        { started_at: '2026-08-30T11:01:00Z', status: 'dispatched', http_status: null },
      ]));

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(false);
    expect(r.delivery_state).toBe('delivery_configured');
    expect(r.execution_health).toBe('not_observed');
  });

  it('delivery_ready only after a recent successful 2xx run', async () => {
    mockFrom
      .mockReturnValueOnce(storageProbe(null))
      .mockReturnValueOnce(cronProbe([enabledCron]))
      .mockReturnValueOnce(runsProbe([
        { started_at: '2026-08-30T11:01:00Z', status: 'success', http_status: 200 },
      ]));

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(true);
    expect(r.delivery_state).toBe('delivery_ready');
    expect(r.execution_health).toBe('recent_success');
    expect(r.cron_job_name).toBe('saved-search-alerts');
  });

  it('accepts a recent route-self-reported success with null dispatcher HTTP status', async () => {
    mockFrom
      .mockReturnValueOnce(storageProbe(null))
      .mockReturnValueOnce(cronProbe([{ ...enabledCron, last_status: 'success' }]))
      .mockReturnValueOnce(runsProbe([
        { started_at: '2026-08-30T11:01:00Z', status: 'success', http_status: null },
      ]));

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(true);
    expect(r.delivery_state).toBe('delivery_ready');
    expect(r.execution_health).toBe('recent_success');
  });

  it('delivery_degraded when cron disabled', async () => {
    mockFrom
      .mockReturnValueOnce(storageProbe(null))
      .mockReturnValueOnce(
        cronProbe([
          {
            ...enabledCron,
            enabled: false,
          },
        ]),
      );

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.cron_registered).toBe(true);
    expect(r.cron_enabled).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
  });

  it('delivery_degraded when the latest success is stale', async () => {
    mockFrom
      .mockReturnValueOnce(storageProbe(null))
      .mockReturnValueOnce(cronProbe([{ ...enabledCron, last_status: 'dispatched' }]))
      .mockReturnValueOnce(runsProbe([
        { started_at: '2026-08-30T11:01:00Z', status: 'dispatched', http_status: null },
        { started_at: '2026-08-12T11:00:00Z', status: 'success', http_status: 200 },
      ]));

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
    expect(r.execution_health).toBe('stale_success');
  });

  it('delivery_degraded when the latest run is a capacity-exhausted partial', async () => {
    mockFrom
      .mockReturnValueOnce(storageProbe(null))
      .mockReturnValueOnce(cronProbe([{ ...enabledCron, last_status: 'partial' }]))
      .mockReturnValueOnce(runsProbe([
        { started_at: '2026-08-30T11:01:00Z', status: 'partial', http_status: null },
      ]));

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
    expect(r.execution_health).toBe('latest_failed');
  });

  it('delivery_degraded when a newer failure supersedes a recent success', async () => {
    mockFrom
      .mockReturnValueOnce(storageProbe(null))
      .mockReturnValueOnce(cronProbe([{ ...enabledCron, last_status: 'error' }]))
      .mockReturnValueOnce(runsProbe([
        { started_at: '2026-08-30T11:02:00Z', status: 'error', http_status: 500 },
        { started_at: '2026-08-30T11:01:00Z', status: 'success', http_status: 200 },
      ]));

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.delivery_ready).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
    expect(r.execution_health).toBe('latest_failed');
  });

  it('delivery_degraded when registration is not a daily schedule', async () => {
    mockFrom
      .mockReturnValueOnce(storageProbe(null))
      .mockReturnValueOnce(cronProbe([{ ...enabledCron, cron_expr: '0 11 * * 1' }]));

    const r = await getSavedSearchDeliveryReadiness(NOW);
    expect(r.cron_schedule_daily).toBe(false);
    expect(r.delivery_state).toBe('delivery_degraded');
    expect(r.execution_health).toBe('invalid_daily_schedule');
  });
});
