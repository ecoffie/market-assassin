import { describe, it, expect, vi } from 'vitest';
import { retryFailedDailyAlerts, retryPreflight, type FailedAlertRow, type RetryUserRow } from './retry-failed-daily';

/**
 * Minimal Supabase double: alert_log holds the failed rows; user_notification_settings
 * holds users. Reads resolve by table; updates are recorded per row id.
 */
function fakeSupabase(failed: FailedAlertRow[], users: RetryUserRow[]) {
  const updates: Record<string, Record<string, unknown>> = {};
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: chain, lt: chain, gte: chain,
      eq: (col: string, val: unknown) => { filters[col] = val; return builder; },
      update: (p: Record<string, unknown>) => { patch = p; return builder; },
      maybeSingle: async () => ({
        data: users.find((u) => u.user_email === filters.user_email) || null,
        error: null,
      }),
      then: (resolve: (v: unknown) => void) => {
        if (patch) {
          updates[String(filters.id)] = { ...(updates[String(filters.id)] || {}), ...patch };
          return resolve({ data: null, error: null });
        }
        if (table === 'alert_log') return resolve({ data: failed, error: null });
        return resolve({ data: [], error: null });
      },
    });
    return builder;
  };
  return { supabase: { from }, updates };
}

const payload = [{ noticeId: 'abc', title: 'Janitorial services' }];
const failedRow = (id: string, email: string): FailedAlertRow => ({ id, user_email: email, retry_count: 0, opportunities_data: payload });
const user = (email: string, over: Partial<RetryUserRow> = {}): RetryUserRow => ({
  user_email: email, alerts_enabled: true, is_active: true, ...over,
});

describe('retryPreflight (pure)', () => {
  it('refuses disabled, inactive, missing-user and empty-payload rows', () => {
    const a = failedRow('1', 'a@x.com');
    expect(retryPreflight(a, null)).toEqual({ send: false, reason: 'no_user' });
    expect(retryPreflight(a, user('a@x.com', { alerts_enabled: false }))).toEqual({ send: false, reason: 'alerts_disabled' });
    expect(retryPreflight(a, user('a@x.com', { alerts_enabled: null }))).toEqual({ send: false, reason: 'alerts_disabled' });
    expect(retryPreflight(a, user('a@x.com', { is_active: false }))).toEqual({ send: false, reason: 'inactive' });
    expect(retryPreflight({ ...a, opportunities_data: [] }, user('a@x.com'))).toEqual({ send: false, reason: 'no_payload' });
  });
  it('targets the real recipient (coach-mode alert_recipient_email wins)', () => {
    expect(retryPreflight(failedRow('1', 'ws@clients.getmindy.ai'), user('ws@clients.getmindy.ai', { alert_recipient_email: 'Client@Real.com' })))
      .toEqual({ send: true, recipient: 'client@real.com' });
  });
});

describe('retryFailedDailyAlerts — a retry never resurrects a recipient', () => {
  const today = '2026-09-23';

  it('disabled recipient generates ZERO send attempts through the retry path', async () => {
    const { supabase, updates } = fakeSupabase([failedRow('1', 'off@x.com')], [user('off@x.com', { alerts_enabled: false })]);
    const send = vi.fn(async () => true);
    const r = await retryFailedDailyAlerts({ supabase, send, isSuppressed: async () => false, today });
    expect(send).not.toHaveBeenCalled();
    expect(r).toMatchObject({ succeeded: 0, skipped: 1 });
    expect(updates['1']).toMatchObject({ delivery_status: 'skipped', error_message: 'retry_skipped:alerts_disabled' });
  });

  it('suppressed recipient generates ZERO send attempts through the retry path', async () => {
    const { supabase, updates } = fakeSupabase([failedRow('1', 'dead@x.com')], [user('dead@x.com')]);
    const send = vi.fn(async () => true);
    const isSuppressed = vi.fn(async (r: string) => r === 'dead@x.com');
    await retryFailedDailyAlerts({ supabase, send, isSuppressed, today });
    expect(isSuppressed).toHaveBeenCalledWith('dead@x.com');
    expect(send).not.toHaveBeenCalled();
    expect(updates['1']).toMatchObject({ delivery_status: 'skipped', error_message: 'retry_skipped:suppressed' });
  });

  it('a guard-blocked send is recorded as skipped, never stamped sent', async () => {
    const { supabase, updates } = fakeSupabase([failedRow('1', 'a@x.com')], [user('a@x.com')]);
    const r = await retryFailedDailyAlerts({ supabase, send: async () => false, isSuppressed: async () => false, today });
    expect(r.succeeded).toBe(0);
    expect(updates['1']).toMatchObject({ delivery_status: 'skipped', error_message: 'retry_skipped:send_guard_blocked' });
  });

  it('a legitimate deliverable recipient is still retried and marked sent', async () => {
    const { supabase, updates } = fakeSupabase([failedRow('1', 'ok@x.com')], [user('ok@x.com')]);
    const send = vi.fn(async () => true);
    const r = await retryFailedDailyAlerts({ supabase, send, isSuppressed: async () => false, today });
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.succeeded).toBe(1);
    expect(updates['1']).toMatchObject({ delivery_status: 'sent', error_message: null });
  });

  it('a thrown send increments retry_count (transient failure stays retryable)', async () => {
    const { supabase, updates } = fakeSupabase([failedRow('1', 'ok@x.com')], [user('ok@x.com')]);
    await retryFailedDailyAlerts({ supabase, send: async () => { throw new Error('provider 503'); }, isSuppressed: async () => false, today });
    expect(updates['1']).toMatchObject({ retry_count: 1, error_message: 'provider 503' });
  });

  it('a failed OPEN SEARCH row is left alone: not re-sent, not retired, its reason kept', async () => {
    // match-health audit 2026-10-06: a statement timeout is recorded failed /
    // open_search_failed:<code> with no payload. This loop re-SENDS stored payloads, so it
    // has nothing to send; retiring the row as retry_skipped:no_payload would overwrite the
    // real reason. Tomorrow's normal run searches the user again.
    const row: FailedAlertRow = {
      id: '9', user_email: 'kw@x.com', retry_count: 2, opportunities_data: [],
      error_message: 'open_search_failed:57014 canceling statement due to statement timeout',
    } as FailedAlertRow;
    const { supabase, updates } = fakeSupabase([row], [user('kw@x.com')]);
    const send = vi.fn(async () => true);
    const r = await retryFailedDailyAlerts({ supabase, send, isSuppressed: async () => false, today });
    expect(send).not.toHaveBeenCalled();
    expect(updates['9']).toBeUndefined();
    expect(r).toMatchObject({ retried: 0, skipped: 0, succeeded: 0 });
  });
});

describe('retryFailedDailyAlerts — a PARTIAL send (Open unavailable) is never re-sent', () => {
  // A fake that HONOURS the delivery_status filter, so the test exercises the real query shape.
  function filteringSupabase(rows: Array<FailedAlertRow & { delivery_status: string }>) {
    const sends: string[] = [];
    const from = () => {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      Object.assign(builder, {
        select: chain, lt: chain, gte: chain, update: chain,
        eq: (col: string, val: unknown) => { filters[col] = val; return builder; },
        maybeSingle: async () => ({ data: user(String(filters.user_email)), error: null }),
        then: (resolve: (v: unknown) => void) => resolve({
          data: rows.filter((r) => !filters.delivery_status || r.delivery_status === filters.delivery_status),
          error: null,
        }),
      });
      return builder;
    };
    return { supabase: { from }, sends };
  }

  it('a sent row marked open_unavailable_partial with a payload generates ZERO send attempts', async () => {
    const partial = {
      ...failedRow('p1', 'partial@x.com'),
      delivery_status: 'sent',
      error_message: 'open_unavailable_partial:57014 canceling statement due to statement timeout [sections=grants attempts=3]',
    };
    const { supabase } = filteringSupabase([partial]);
    const send = vi.fn(async () => true);
    const r = await retryFailedDailyAlerts({ supabase, send, isSuppressed: async () => false, today: '2026-10-07' });
    expect(send).not.toHaveBeenCalled();
    expect(r.retried).toBe(0);
  });

  it('second line of defence: even a FAILED-status row carrying the partial note is not re-sent', async () => {
    const odd = {
      ...failedRow('p2', 'partial@x.com'),
      delivery_status: 'failed',
      error_message: 'open_unavailable_partial:57014 x [sections=grants attempts=3]',
    };
    const { supabase } = filteringSupabase([odd]);
    const send = vi.fn(async () => true);
    await retryFailedDailyAlerts({ supabase, send, isSuppressed: async () => false, today: '2026-10-07' });
    expect(send).not.toHaveBeenCalled();
  });
});
