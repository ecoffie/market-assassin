import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/app/workspace', () => ({ getAppSupabase: () => ({}) }));

import { composeSearchAlertStatus } from './search-delivery-status';
import type { SavedSearchDeliveryReadiness } from './delivery-readiness';
import type { SavedSearchRow } from './types';

const NOW = new Date('2026-10-05T23:20:13Z');

const system = (over: Partial<SavedSearchDeliveryReadiness> = {}): SavedSearchDeliveryReadiness => ({
  storage_ready: true,
  cron_registered: true,
  cron_enabled: true,
  cron_schedule_daily: true,
  cron_job_name: 'saved-search-alerts',
  cron_route: '/api/cron/saved-search-alerts',
  cron_expr: '0 11 * * *',
  last_run_at: '2026-10-05T11:00:29Z',
  last_run_status: 'error',
  last_clean_run_at: '2026-09-29T11:00:28Z',
  last_alert_sent_at: '2026-10-05T11:01:41Z',
  latest_run_started_at: '2026-10-05T11:00:29Z',
  latest_run_in_window: true,
  latest_run_failures: 'unexpected_schedule_error=1,email_send_rejected=3',
  latest_run_alerts_sent: 48,
  execution_health: 'partial_failure',
  delivery_state: 'delivery_partial',
  system_status: 'partial_degradation',
  delivery_ready: true,
  ...over,
});

const search = (over: Partial<SavedSearchRow> = {}): SavedSearchRow => ({
  id: 's1',
  user_email: 'customer@example.com',
  name: 'Watch',
  mode: 'open',
  filters: { naics: '541611', setAside: 'WOSB' },
  bbox: null,
  alerts_enabled: true,
  alert_frequency: 'daily',
  last_alerted_at: null,
  last_seen_notice_ids: [],
  total_alerts_sent: 0,
  created_at: '2026-10-05T23:20:18Z',
  updated_at: '2026-10-05T23:20:18Z',
  ...over,
});

const clean = { suppressed: null, lastAlertAt: null };

describe('composeSearchAlertStatus', () => {
  it('new search during a partial run: saved+validated, delivery not yet tested, baseline pending, next check tomorrow', () => {
    const r = composeSearchAlertStatus(search(), system(), clean, 'matched_historically', NOW);
    expect(r.saved).toBe(true);
    expect(r.validated).toBe(true);
    expect(r.search_delivery).toBe('not_yet_tested');
    expect(r.baseline).toBe('pending');
    expect(r.headline).toBe('delivery_not_yet_tested');
    expect(r.next_evaluation_at).toBe('2026-10-06T11:00:00.000Z');
    expect(r.summary).toMatch(/other saved searches/i);
    expect(r.summary).not.toMatch(/unreliable|won't arrive|will not arrive|down/i);
  });

  it('another customer\'s failure never becomes this search\'s failure', () => {
    // same partial run; this search was evaluated in it and has delivered before
    const r = composeSearchAlertStatus(
      search({ created_at: '2026-09-01T00:00:00Z', last_alerted_at: '2026-10-05T11:00:40Z', total_alerts_sent: 12 }),
      system(),
      { suppressed: null, lastAlertAt: '2026-10-05T11:00:41Z' },
      'matches_open_now',
      NOW,
    );
    expect(r.search_delivery).toBe('delivered');
    expect(r.headline).toBe('delivering');
    expect(r.summary).toMatch(/unaffected/i);
  });

  it('this recipient suppressed → blocked, even when the system is healthy', () => {
    const r = composeSearchAlertStatus(search(), system({ system_status: 'healthy' }), { suppressed: 'hard_bounce', lastAlertAt: null }, 'matches_open_now', NOW);
    expect(r.search_delivery).toBe('blocked');
    expect(r.headline).toBe('search_delivery_blocked');
    expect(r.summary).toMatch(/hard_bounce/);
  });

  it('due in the latest delivering run but not evaluated → this search is failing', () => {
    const r = composeSearchAlertStatus(
      search({ created_at: '2026-09-01T00:00:00Z', last_alerted_at: '2026-10-02T11:00:40Z', total_alerts_sent: 3 }),
      system(),
      { suppressed: null, lastAlertAt: '2026-10-02T11:00:41Z' },
      'matches_open_now',
      NOW,
    );
    expect(r.search_delivery).toBe('failing');
    expect(r.headline).toBe('search_delivery_failing');
  });

  it('an un-delivering run does not convict one search (that is the system status)', () => {
    const r = composeSearchAlertStatus(
      search({ created_at: '2026-09-01T00:00:00Z', last_alerted_at: '2026-10-02T11:00:40Z' }),
      system({ system_status: 'degraded_unconfirmed', delivery_ready: false, latest_run_alerts_sent: 0 }),
      clean,
      'matches_open_now',
      NOW,
    );
    expect(r.search_delivery).not.toBe('failing');
  });

  it('confirmed system failure outranks everything for an active search', () => {
    const r = composeSearchAlertStatus(search(), system({ system_status: 'system_failure', delivery_ready: false }), clean, 'matches_open_now', NOW);
    expect(r.headline).toBe('system_delivery_failure');
    expect(r.summary).toMatch(/down for all saved searches/i);
  });

  it('filters that never matched are surfaced, not reported as a working watch', () => {
    const r = composeSearchAlertStatus(search({ filters: { subAgency: 'Marine Corps' } }), system(), clean, 'never_matched', NOW);
    expect(r.headline).toBe('search_never_matches');
  });

  it('paused is a choice, not a failure', () => {
    const r = composeSearchAlertStatus(search({ alerts_enabled: false }), system({ system_status: 'system_failure' }), clean, 'matches_open_now', NOW);
    expect(r.search_delivery).toBe('paused');
    expect(r.headline).toBe('paused');
    expect(r.next_evaluation_at).toBeNull();
  });

  it('unreadable recipient evidence is unknown, never delivered', () => {
    const r = composeSearchAlertStatus(search({ total_alerts_sent: 4 }), system(), { suppressed: undefined, lastAlertAt: undefined }, 'unknown', NOW);
    expect(r.search_delivery).toBe('unknown');
    expect(r.headline).toBe('delivery_not_yet_tested');
  });

  it('weekly cadence: next check is the next Monday run', () => {
    const r = composeSearchAlertStatus(search({ alert_frequency: 'weekly' }), system(), clean, 'matches_open_now', NOW);
    expect(r.next_evaluation_at).toBe('2026-10-12T11:00:00.000Z');
  });
});
