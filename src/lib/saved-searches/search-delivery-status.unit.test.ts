import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/app/workspace', () => ({ getAppSupabase: () => ({}) }));

import { composeSearchAlertStatus, type FilterReachResult } from './search-delivery-status';
import type { SavedSearchDeliveryReadiness } from './delivery-readiness';
import type { SavedSearchRow } from './types';

const NOW = new Date('2026-10-05T23:20:13Z');

const job = (over: Partial<SavedSearchDeliveryReadiness> = {}): SavedSearchDeliveryReadiness => ({
  job: 'saved-search-alerts',
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
  last_alert_provider_accepted_at: '2026-10-05T11:01:41Z',
  inbox_delivery: 'not_observable',
  latest_run_started_at: '2026-10-05T11:00:29Z',
  latest_run_in_window: true,
  latest_run_failures: 'unexpected_schedule_error=1,recipient_suppressed=3',
  latest_run_processing_failures: { unexpected_schedule_error: 1 },
  suppression_action_items: { recipient_suppressed: 3 },
  latest_run_alerts_provider_accepted: 48,
  latest_run_searches_evaluated: 134,
  job_status_reason: 'saved-search alerts: partial failure: unexpected_schedule_error=1 failed; the rest ran (evaluated 134 searches, 48 alerts accepted by the email provider)',
  execution_health: 'partial_failure',
  delivery_state: 'delivery_partial',
  job_status: 'partial_failure',
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
const reach = (r: FilterReachResult['reach']): FilterReachResult => ({ reach: r, detail: null });

describe('composeSearchAlertStatus — this search first, the job labelled', () => {
  it("Denise's Marine Corps watch (with #1840): supported, matched historically, no open matches, not yet tested", () => {
    const r = composeSearchAlertStatus(search({ filters: { naics: '541611', setAside: 'WOSB', subAgency: 'Marine Corps' } }), job(), clean, reach('matched_historically'), NOW);
    expect(r.filter_support).toBe('supported');
    expect(r.filter_limitations).toEqual([]);
    expect(r.filter_reach).toBe('matched_historically');
    expect(r.headline).toBe('awaiting_first_check');
    expect(r.search_delivery).toBe('not_yet_evaluated');
    expect(r.next_evaluation_at).toBe('2026-10-06T11:00:00.000Z');
    expect(r.summary).toMatch(/^This saved search is saved and valid\. Delivery is not yet tested\. Its first scheduled check records current matches without emailing; after that, an alert email is sent only if a later check finds a new matching notice and the send succeeds\./);
    expect(r.summary).toContain('Its filters have matched past notices; none are open right now.');
    expect(r.summary).toContain('Saved-search alerts: the latest run had failures in other saved searches; this one is not affected.');
    expect(r.summary).not.toMatch(/not representable|cannot run|unsupported|never/i);
  });

  it('a supported filter with no records is "no matches in available data", not unsupported', () => {
    const r = composeSearchAlertStatus(search(), job(), clean, reach('no_matches_in_available_data'), NOW);
    expect(r.filter_support).toBe('supported');
    expect(r.summary).toContain("No notice in Mindy's data has matched these filters yet; that alone does not make the search invalid.");
    expect(r.summary).not.toMatch(/will alert|you will (be emailed|receive)/i);
  });

  it('Marine Corps with forecasts on: Open supported, Forecast disclosed as a limitation (partially supported)', () => {
    const r = composeSearchAlertStatus(search({ filters: { subAgency: 'Marine Corps', horizons: { open: true, forecast: true } } }), job(), clean, reach('matches_open_now'), NOW);
    expect(r.filter_support).toBe('partially_supported');
    expect(r.filter_limitations.map((l) => l.horizon)).toEqual(['forecast']);
    expect(r.summary).toMatch(/cannot be filtered on agency forecasts.*not broadened to Navy/);
  });

  it('one invalid search → THIS search blocked; nothing about the job', () => {
    const r = composeSearchAlertStatus(search({ filters: { naics: '541511', sapBuyer: true as unknown as string }, created_at: '2026-10-01T00:00:00Z' }), job(), clean, reach('unknown'), NOW);
    expect(r.search_delivery).toBe('blocked_invalid_filters');
    expect(r.summary).toMatch(/^This saved search is blocked: .*your other searches are unaffected\./);
  });

  it('every NAICS unknown → blocked; some unknown → evaluated and the bad codes named', () => {
    expect(composeSearchAlertStatus(search({ filters: { naics: '541510' } }), job(), clean, reach('unknown'), NOW).search_delivery).toBe('blocked_invalid_filters');
    const r = composeSearchAlertStatus(search({ filters: { naics: '541510,541512' } }), job(), clean, reach('matches_open_now'), NOW);
    expect(r.search_delivery).toBe('not_yet_evaluated');
    expect(r.invalid_naics).toEqual(['541510']);
  });

  it('confirmed suppressed recipient → action item, explicitly not an outage', () => {
    const r = composeSearchAlertStatus(search(), job({ job_status: 'healthy' }), { suppressed: 'hard_bounce', lastAlertAt: null }, reach('matches_open_now'), NOW);
    expect(r.search_delivery).toBe('blocked_recipient_suppressed');
    expect(r.summary).toMatch(/held: the account email is on the suppression list \(hard_bounce\)\. Action needed .* not a system outage/);
  });

  it('a failed suppression LOOKUP is unknown (processing error), never "suppressed"', () => {
    const r = composeSearchAlertStatus(search(), job(), { suppressed: undefined, lastAlertAt: undefined }, reach('matches_open_now'), NOW);
    expect(r.search_delivery).toBe('unknown');
    expect(r.summary).not.toMatch(/suppression list/);
    expect(r.summary).toMatch(/processing error/);
  });

  it('checked, no alert sent: reported from recorded facts only — never a timing guess about baseline vs no new match', () => {
    // Same recorded facts (checked once, 0 alerts), very different ages: the answer must not change.
    const recent = composeSearchAlertStatus(search({ created_at: '2026-10-04T20:00:00Z', last_alerted_at: '2026-10-05T11:00:40Z' }), job(), clean, reach('matches_open_now'), NOW);
    const old = composeSearchAlertStatus(search({ created_at: '2026-06-01T00:00:00Z', last_alerted_at: '2026-10-05T11:00:40Z' }), job(), clean, reach('matches_open_now'), NOW);
    for (const r of [recent, old]) {
      expect(r.search_delivery).toBe('checked_no_alert_sent');
      expect(r.baseline).toBe('established');
      expect(r.summary).toMatch(/^This saved search has been checked, but no alert has been sent for it yet\. Mindy records that it was checked, not whether that was only its first check .* or a later check that found no new match\./);
    }
    expect(recent.summary).toBe(old.summary);
    const never = composeSearchAlertStatus(search(), job(), clean, reach('matches_open_now'), NOW);
    expect(never.search_delivery).toBe('not_yet_evaluated');
  });

  it('due in the latest processing run but not evaluated → this search is failing', () => {
    const r = composeSearchAlertStatus(search({ created_at: '2026-09-01T00:00:00Z', last_alerted_at: '2026-10-02T11:00:40Z', total_alerts_sent: 3 }), job(), { suppressed: null, lastAlertAt: '2026-10-02T11:00:41Z' }, reach('matches_open_now'), NOW);
    expect(r.headline).toBe('search_failing');
    expect(r.summary).toContain('Saved-search alerts: partial failure: unexpected_schedule_error=1 failed');
  });

  it('another customer\'s failure never becomes this search\'s failure; delivery is provider acceptance, not inbox', () => {
    const r = composeSearchAlertStatus(
      search({ created_at: '2026-09-01T00:00:00Z', last_alerted_at: '2026-10-05T11:00:40Z', total_alerts_sent: 12 }),
      job(), { suppressed: null, lastAlertAt: '2026-10-05T11:00:41Z' }, reach('matches_open_now'), NOW,
    );
    expect(r.headline).toBe('delivering');
    expect(r.summary).toMatch(/our email provider last accepted one for this account at 2026-10-05 11:00 UTC \(inbox delivery is not tracked\)/);
    expect(r.summary).toContain('this one is not affected');
  });

  it('a confirmed job failure is said plainly, labelled as the saved-search alerts job', () => {
    const r = composeSearchAlertStatus(search(), job({ job_status: 'job_failure', job_status_reason: "saved-search alerts: the job did not run in today's window", delivery_ready: false }), clean, reach('matches_open_now'), NOW);
    expect(r.headline).toBe('job_failure');
    expect(r.summary).toMatch(/^This saved search is saved and valid\./);
    expect(r.summary).toContain("Saved-search alerts: the job did not run in today's window. No saved-search alert emails can be expected until it recovers.");
    expect(r.summary).not.toMatch(/Mindy email|all email/i);
  });

  it('paused is a choice, not a failure', () => {
    const r = composeSearchAlertStatus(search({ alerts_enabled: false }), job({ job_status: 'job_failure' }), clean, reach('matches_open_now'), NOW);
    expect(r.headline).toBe('paused');
    expect(r.next_evaluation_at).toBeNull();
  });
});
