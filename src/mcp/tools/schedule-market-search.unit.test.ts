import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMcpTool, creditsFor, listMcpTools } from '@/lib/mcp/tool-registry';
import {
  scheduleMarketSearch,
  deleteMarketSchedule,
} from './schedule-market-search';

vi.mock('@/lib/saved-searches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/saved-searches')>();
  return {
    ...actual,
    createSavedSearch: vi.fn(),
    listSavedSearches: vi.fn(),
    updateSavedSearch: vi.fn(),
    deleteSavedSearch: vi.fn(),
    listSavedSearches: vi.fn(),
    getSavedSearchDeliveryReadiness: vi.fn(),
    readRecipientEvidence: vi.fn(),
    probeFilterReach: vi.fn(),
  };
});

import {
  createSavedSearch,
  deleteSavedSearch,
  getSavedSearchDeliveryReadiness,
  listSavedSearches,
  probeFilterReach,
  readRecipientEvidence,
  type SavedSearchDeliveryReadiness,
} from '@/lib/saved-searches';
import { listMarketSchedules } from './schedule-market-search';

const mockCreate = vi.mocked(createSavedSearch);
const mockDelete = vi.mocked(deleteSavedSearch);
const mockDelivery = vi.mocked(getSavedSearchDeliveryReadiness);
const mockList = vi.mocked(listSavedSearches);
const mockRecipient = vi.mocked(readRecipientEvidence);
const mockReach = vi.mocked(probeFilterReach);

const deliveryReady: SavedSearchDeliveryReadiness = {
  storage_ready: true,
  cron_registered: true,
  cron_enabled: true,
  cron_schedule_daily: true,
  cron_job_name: 'saved-search-alerts',
  cron_route: '/api/cron/saved-search-alerts?limit=50',
  cron_expr: '0 11 * * *',
  last_run_at: '2026-08-30T11:01:00Z',
  last_run_status: 'success',
  job: 'saved-search-alerts',
  last_clean_run_at: '2026-08-30T11:01:00Z',
  last_alert_provider_accepted_at: '2026-08-30T11:01:10Z',
  inbox_delivery: 'not_observable',
  latest_run_started_at: '2026-08-30T11:01:00Z',
  latest_run_in_window: true,
  latest_run_failures: null,
  latest_run_processing_failures: {},
  suppression_action_items: {},
  latest_run_alerts_provider_accepted: 7,
  latest_run_searches_evaluated: 40,
  job_status_reason: 'saved-search alerts: latest run completed (evaluated 40 searches, 7 alerts accepted by the email provider)',
  execution_health: 'recent_success',
  delivery_state: 'delivery_ready',
  job_status: 'healthy',
  delivery_ready: true,
};

describe('schedule_market_search MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDelivery.mockResolvedValue(deliveryReady);
    mockRecipient.mockResolvedValue({ suppressed: null, lastAlertAt: null });
    mockReach.mockResolvedValue({ reach: 'matches_open_now', detail: null });
  });

  it('is registered with 0-credit scheduling config pricing', () => {
    expect(isMcpTool('schedule_market_search')).toBe(true);
    expect(isMcpTool('list_market_schedules')).toBe(true);
    expect(isMcpTool('update_market_schedule')).toBe(true);
    expect(isMcpTool('delete_market_schedule')).toBe(true);
    expect(creditsFor('schedule_market_search')).toBe(0);
    expect(creditsFor('update_market_schedule')).toBe(0);
    expect(creditsFor('delete_market_schedule')).toBe(0);
    expect(creditsFor('list_market_schedules')).toBe(0);
    const names = listMcpTools().map((t) => (t.function as { name: string }).name);
    expect(names).toContain('schedule_market_search');
  });

  it('scheduler unavailable → grounded=false, degraded=true, schedule_saved=false', async () => {
    mockCreate.mockResolvedValue({
      ok: false,
      code: 'scheduler_unavailable',
      message: 'Saved searches are not available yet — run the saved_searches migration.',
    });

    const r = await scheduleMarketSearch({
      userEmail: 'agent@example.com',
      name: 'Test',
      filters: { naics: '541512' },
    });

    expect(r._meta.grounded).toBe(false);
    expect(r._meta.degraded).toBe(true);
    expect(r._meta.schedule_saved).toBe(false);
    expect(r._meta.delivery_state).toBe('scheduler_unavailable');
    expect(r.schedule_id).toBe('');
    expect(r.message).not.toMatch(/will be emailed/i);
  });

  it('rejects broad filters without scheduling', async () => {
    mockCreate.mockResolvedValue({
      ok: false,
      code: 'invalid_filters',
      message: 'At least one narrowing filter is required',
    });

    const r = await scheduleMarketSearch({
      userEmail: 'user@getmindy.ai',
      name: 'Everything',
      filters: {},
    });
    expect(r._meta.schedule_saved).toBe(false);
    expect(r._meta.grounded).toBe(false);
  });

  it('success with delivery_ready does not use scheduler_available', async () => {
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        idempotent: false,
        bbox_omitted: true,
        search: {
          id: 'sched-uuid',
          user_email: 'secret@getmindy.ai',
          name: 'DOD Cloud',
          mode: 'open',
          filters: { naics: '541512', agency: 'DEFENSE' },
          bbox: null,
          alerts_enabled: true,
          alert_frequency: 'daily',
          last_alerted_at: null,
          last_seen_notice_ids: [],
          total_alerts_sent: 0,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      },
    });

    const r = await scheduleMarketSearch({
      userEmail: 'secret@getmindy.ai',
      name: 'DOD Cloud',
      filters: { naics: '541512', agency: 'DEFENSE' },
    });
    expect(r._meta.grounded).toBe(true);
    expect(r._meta.schedule_saved).toBe(true);
    expect(r._meta.delivery_ready).toBe(true);
    expect(r._meta.bbox_omitted).toBe(true);
    expect(r._meta.bbox_restored).toBe(false);
    expect(r.schedule_id).toBe('sched-uuid');
    expect(r.map_url).toContain('ss=sched-uuid');
    expect(r.alert_destination).toBe('account_email');
    expect(JSON.stringify(r)).not.toContain('secret@getmindy.ai');
    expect(JSON.stringify(r)).not.toContain('scheduler_available');
    expect(r.message).toMatch(/viewport.*not stored/i);
  });

  it('delivery_configured never promises email without recent success evidence', async () => {
    mockDelivery.mockResolvedValue({
      ...deliveryReady,
      last_run_status: 'dispatched',
      last_clean_run_at: null,
      execution_health: 'not_observed',
      delivery_state: 'delivery_configured',
      job_status: 'not_observed',
      delivery_ready: false,
    });
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        idempotent: true,
        bbox_omitted: true,
        search: {
          id: 'sched-uuid',
          user_email: 'user@getmindy.ai',
          name: 'DOD',
          mode: 'open',
          filters: { naics: '541512' },
          bbox: null,
          alerts_enabled: true,
          alert_frequency: 'daily',
          last_alerted_at: null,
          last_seen_notice_ids: [],
          total_alerts_sent: 0,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      },
    });

    const r = await scheduleMarketSearch({
      userEmail: 'user@getmindy.ai',
      name: 'DOD',
      filters: { naics: '541512' },
    });
    expect(r._meta.delivery_state).toBe('delivery_configured');
    expect(r._meta.delivery_ready).toBe(false);
    expect(r._meta.degraded).toBe(false);
    expect(r.message).not.toMatch(/will email|will be emailed/i);
  });

  it('delivery_degraded does not promise email when alerts on', async () => {
    mockDelivery.mockResolvedValue({
      ...deliveryReady,
      delivery_ready: false,
      delivery_state: 'delivery_degraded',
      cron_enabled: false,
      execution_health: 'not_observed',
      job_status: 'job_failure',
      job_status_reason: 'saved-search alerts: the job is disabled',
    });
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        idempotent: false,
        bbox_omitted: false,
        search: {
          id: 'sched-uuid',
          user_email: 'user@getmindy.ai',
          name: 'DOD',
          mode: 'open',
          filters: { naics: '541512' },
          bbox: { w: 1, s: 2, e: 3, n: 4 },
          alerts_enabled: true,
          alert_frequency: 'daily',
          last_alerted_at: null,
          last_seen_notice_ids: [],
          total_alerts_sent: 0,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      },
    });

    const r = await scheduleMarketSearch({
      userEmail: 'user@getmindy.ai',
      name: 'DOD',
      filters: { naics: '541512' },
      bbox: { w: 1, s: 2, e: 3, n: 4 },
    });
    expect(r._meta.schedule_saved).toBe(true);
    expect(r._meta.delivery_ready).toBe(false);
    expect(r._meta.degraded).toBe(true);
    expect(r.message).not.toMatch(/will be emailed/i);
    expect(r.message).toContain('Saved-search alerts: the job is disabled. No saved-search alert emails can be expected until it recovers.');
    expect(r.alert_status?.headline).toBe('job_failure');
  });

  it('delete without confirm is rejected', async () => {
    mockDelete.mockResolvedValue({
      ok: false,
      code: 'confirmation_required',
      message: 'confirm required',
    });

    const r = await deleteMarketSchedule({ userEmail: 'user@getmindy.ai', schedule_id: 'x' });
    expect(r.deleted).toBe(false);
    expect(r._meta.grounded).toBe(false);
  });

  it('does not import sendEmail or live spend clients (no email send, no spend probe)', () => {
    const src = readFileSync(join(process.cwd(), 'src/mcp/tools/schedule-market-search.ts'), 'utf8');
    expect(src).not.toMatch(/sendEmail/);
    expect(src).not.toMatch(/from '@\/lib\/usaspending/);
    expect(src).not.toMatch(/runMcpTool/);
  });

  it('schedule_market_search identity comes from ctx.userEmail in registry dispatch', () => {
    const reg = readFileSync(join(process.cwd(), 'src/lib/mcp/tool-registry.ts'), 'utf8');
    const block = reg.match(/if \(name === 'schedule_market_search'\) \{[\s\S]*?return \{ result, credits \};\s*\}/);
    expect(block?.[0]).toContain('userEmail: ctx.userEmail');
    expect(block?.[0]).not.toMatch(/recipient/);
  });

  it('registers all four lifecycle tools on the stdio transport too', () => {
    const server = readFileSync(join(process.cwd(), 'src/mcp/server.ts'), 'utf8');
    for (const name of [
      'schedule_market_search',
      'list_market_schedules',
      'update_market_schedule',
      'delete_market_schedule',
    ]) {
      expect(server).toContain(`server.registerTool(\n  '${name}'`);
    }
    const deleteBlock = server.slice(server.indexOf("'delete_market_schedule'"));
    expect(deleteBlock.slice(0, 700)).toContain('destructiveHint: true');
    expect(deleteBlock.slice(0, 700)).toContain('z.literal(true)');
  });

  /** What a partial run must never be turned into: a claim that ALL delivery stopped. */
  const FALSE_TOTAL_OUTAGE =
    /2026-09-29|Sept|September|unreliable|not currently guaranteed|no saved-search alert emails can be expected|stopped|won't arrive|will not arrive|no (successful )?(sends|emails)|Mindy email|all email/i;

  it('a confirmed total outage still says so (the warning is preserved, not suppressed)', async () => {
    mockDelivery.mockResolvedValue({ ...deliveryReady, job_status: 'job_failure', job_status_reason: "saved-search alerts: the job did not run in today's window", delivery_ready: false, delivery_state: 'delivery_degraded' });
    mockCreate.mockResolvedValue({
      ok: true,
      data: { idempotent: false, bbox_omitted: false, search: {
        id: 'x', user_email: 'u@example.com', name: 'n', mode: 'open', filters: { naics: '541611' }, bbox: null,
        alerts_enabled: true, alert_frequency: 'daily', last_alerted_at: null, last_seen_notice_ids: [],
        total_alerts_sent: 0, created_at: '2026-10-05T23:20:18Z', updated_at: '2026-10-05T23:20:18Z',
      } },
    });
    const r = await scheduleMarketSearch({ userEmail: 'u@example.com', name: 'n', filters: { naics: '541611' } });
    expect(r._meta.degraded).toBe(true);
    expect(r.message).toMatch(/^This saved search is saved and valid\. .*Saved-search alerts: the job did not run in today's window\. No saved-search alert emails can be expected until it recovers\.$/);
  });

  describe('alert-health status for the 2026-10-05 Marine Corps WOSB 541611 watches', () => {
    // Exact production state when the watches were saved (2026-10-05 23:20 UTC): every run since
    // 2026-09-30 reported `error` because three suppressed internal addresses were rejected and one
    // other customer's search threw — while the same runs delivered ~46-48 alerts a day.
    const partialProd: SavedSearchDeliveryReadiness = {
      ...deliveryReady,
      last_run_at: '2026-10-05T11:00:29Z',
      last_run_status: 'error',
      last_clean_run_at: '2026-09-29T11:00:28Z',
      last_alert_provider_accepted_at: '2026-10-05T11:01:41Z',
      latest_run_started_at: '2026-10-05T11:00:29Z',
      latest_run_in_window: true,
      latest_run_failures: 'unexpected_schedule_error=1,email_send_rejected=3',
      latest_run_processing_failures: { unexpected_schedule_error: 1, email_send_rejected: 3 },
      latest_run_alerts_provider_accepted: 48,
      latest_run_searches_evaluated: 134,
      job_status_reason: 'saved-search alerts: partial failure: unexpected_schedule_error=1, email_send_rejected=3 failed; the rest ran (evaluated 134 searches, 48 alerts accepted by the email provider)',
      execution_health: 'partial_failure',
      delivery_state: 'delivery_partial',
      job_status: 'partial_failure',
      delivery_ready: true,
    };
    const marineWatch = {
      id: 'ce296369-625f-4c20-a9dc-29aa3c43e879',
      user_email: 'customer@example.com',
      name: 'Marine Corps WOSB 541611',
      mode: 'open' as const,
      filters: { naics: '541611', setAside: 'WOSB', subAgency: 'Marine Corps' },
      bbox: null,
      alerts_enabled: true,
      alert_frequency: 'daily' as const,
      last_alerted_at: null,
      last_seen_notice_ids: [],
      total_alerts_sent: 0,
      created_at: '2026-10-05T23:20:18Z',
      updated_at: '2026-10-05T23:20:18Z',
    };

    it('a partially failed job with successful deliveries never reports "no successful sends since Sept 29"', async () => {
      mockDelivery.mockResolvedValue(partialProd);
      mockReach.mockResolvedValue({ reach: 'matched_historically', detail: null });
      mockCreate.mockResolvedValue({ ok: true, data: { idempotent: false, bbox_omitted: false, search: marineWatch } });

      const r = await scheduleMarketSearch({ userEmail: 'customer@example.com', name: marineWatch.name, filters: marineWatch.filters });

      expect(r._meta.schedule_saved).toBe(true);
      expect(r._meta.degraded).toBe(false);
      expect(r._meta.delivery_ready).toBe(true);
      expect(r._meta.saved_search_alerts_job_status).toBe('partial_failure');
      expect(r._meta.delivery_last_alert_provider_accepted_at).toBe('2026-10-05T11:01:41Z');
      expect(r._meta.inbox_delivery).toBe('not_observable');
      // the job-run time stays available, under a name that cannot be read as an email send
      expect(r._meta.delivery_last_clean_run_at).toBe('2026-09-29T11:00:28Z');
      expect(r._meta).not.toHaveProperty('delivery_last_success_at');
      expect(r.alert_status?.headline).toBe('awaiting_first_check');
      expect(r.alert_status?.search_delivery).toBe('not_yet_evaluated');
      expect(r.alert_status?.baseline).toBe('pending');
      expect(r.alert_status?.filter_support).toBe('supported');
      // This search first; the job's partial failure is named and labelled, never a claim that delivery stopped.
      expect(r.message).toMatch(/^This saved search is saved and valid\. Delivery is not yet tested/);
      expect(r.message).toContain('Its filters have matched past notices; none are open right now.');
      expect(r.message).toContain('Saved-search alerts: the latest run had failures in other saved searches; this one is not affected.');
      expect(r.message).not.toMatch(FALSE_TOTAL_OUTAGE);
      expect(r.message).not.toMatch(/will be emailed|will email/i);
    });

    it('still warns when the same partial run comes with THIS recipient suppressed', async () => {
      mockDelivery.mockResolvedValue(partialProd);
      mockRecipient.mockResolvedValue({ suppressed: 'hard_bounce', lastAlertAt: null });
      mockCreate.mockResolvedValue({ ok: true, data: { idempotent: false, bbox_omitted: false, search: marineWatch } });

      const r = await scheduleMarketSearch({ userEmail: 'customer@example.com', name: marineWatch.name, filters: marineWatch.filters });
      expect(r._meta.degraded).toBe(true);
      expect(r.alert_status?.headline).toBe('search_blocked_recipient');
      expect(r.message).toMatch(/held: the account email is on the suppression list \(hard_bounce\)\. Action needed on the account email; this is not a system outage/);
    });

    it('Marine Corps with forecasts on: the Forecast limitation is disclosed, the watch stays on Open', async () => {
      mockDelivery.mockResolvedValue(partialProd);
      const withForecast = { ...marineWatch, filters: { ...marineWatch.filters, horizons: { open: true, forecast: true } } };
      mockCreate.mockResolvedValue({ ok: true, data: { idempotent: false, bbox_omitted: false, search: withForecast } });

      const r = await scheduleMarketSearch({ userEmail: 'customer@example.com', name: marineWatch.name, filters: withForecast.filters });
      expect(r.alert_status?.filter_support).toBe('partially_supported');
      expect(r.alert_status?.filter_limitations.map((l) => l.horizon)).toEqual(['forecast']);
      expect(r.message).toMatch(/U\.S\. Marine Corps cannot be filtered on agency forecasts.*not broadened to Navy/);
      expect(r._meta.degraded).toBe(false);
    });

    it('zero matches in the available data is NOT reported as a dead watch', async () => {
      mockDelivery.mockResolvedValue(partialProd);
      mockReach.mockResolvedValue({ reach: 'no_matches_in_available_data', detail: null });
      mockCreate.mockResolvedValue({ ok: true, data: { idempotent: false, bbox_omitted: false, search: marineWatch } });

      const r = await scheduleMarketSearch({ userEmail: 'customer@example.com', name: marineWatch.name, filters: marineWatch.filters });
      expect(r.alert_status?.headline).toBe('awaiting_first_check');
      expect(r.alert_status?.filter_support).toBe('supported');
      expect(r.message).toMatch(/a matching notice posted later will alert/i);
      expect(r.message).not.toMatch(/never|cannot|will not alert/i);
    });

    it('list reports each watch on its own evidence, reading recipient evidence once', async () => {
      mockDelivery.mockResolvedValue(partialProd);
      mockReach
        .mockResolvedValueOnce({ reach: 'matched_historically', detail: null })
        .mockResolvedValueOnce({ reach: 'no_matches_in_available_data', detail: null });
      mockList.mockResolvedValue({
        ok: true,
        data: { searches: [marineWatch, { ...marineWatch, id: 'dai', name: 'DAI follow-on', filters: { q: 'DAI', naics: '541611', setAside: 'WOSB' } }] },
      } as never);

      const r = await listMarketSchedules({ userEmail: 'customer@example.com' });
      expect(mockRecipient).toHaveBeenCalledTimes(1);
      expect(r.schedules.map((x) => [x.alert_status?.headline, x.alert_status?.filter_support, x.alert_status?.filter_reach])).toEqual([
        ['awaiting_first_check', 'supported', 'matched_historically'],
        ['awaiting_first_check', 'supported', 'no_matches_in_available_data'],
      ]);
      expect(r._meta.saved_search_alerts_job_status).toBe('partial_failure');
    });
  });
});
