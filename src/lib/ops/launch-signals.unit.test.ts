import { describe, it, expect, vi } from 'vitest';
import {
  isDueToday,
  hasTargeting,
  classifyCount,
  decideTransition,
  checkDailyAlertPending,
  checkBillingErrors,
  checkAlertToolErrors,
  runLaunchSignals,
  buildMessage,
  type StoredState,
  type SignalResult,
} from './launch-signals';

// ─── mock Supabase ───────────────────────────────────────────────────────────
// tables[name] = { rows?, count?, error? }. Thenable builder; .range() pages rows.
type TableSpec = { rows?: Record<string, unknown>[]; count?: number | null; error?: { message: string } | null };
function mockSb(tables: Record<string, TableSpec>) {
  const calls: Array<{ table: string; ops: string[] }> = [];
  return {
    calls,
    from(table: string) {
      const spec = tables[table] ?? {};
      const rec = { table, ops: [] as string[] };
      calls.push(rec);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'gte', 'order']) {
        b[m] = (...args: unknown[]) => { rec.ops.push(`${m}:${JSON.stringify(args)}`); return b; };
      }
      b.range = async (from: number, to: number) => {
        if (spec.error) return { data: null, error: spec.error };
        return { data: (spec.rows ?? []).slice(from, to + 1), error: null };
      };
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ count: spec.error ? null : spec.count === undefined ? null : spec.count, error: spec.error ?? null });
      return b;
    },
  };
}

// 2026-11-10 is a Tuesday.
const TUE_16 = new Date('2026-11-10T16:00:00Z');
const TUE_10 = new Date('2026-11-10T10:00:00Z');

describe('isDueToday', () => {
  it('applies the daily-alerts day rules', () => {
    // Sun..Sat
    const days = [0, 1, 2, 3, 4, 5, 6];
    expect(days.map((d) => isDueToday('daily', d))).toEqual([true, true, true, true, true, true, true]);
    expect(days.map((d) => isDueToday('weekdays', d))).toEqual([false, true, true, true, true, true, false]);
    expect(days.map((d) => isDueToday('weekends', d))).toEqual([true, false, false, false, false, false, true]);
    expect(days.map((d) => isDueToday('mwf', d))).toEqual([false, true, false, true, false, true, false]);
    expect(days.map((d) => isDueToday('tth', d))).toEqual([false, false, true, false, true, false, false]);
    expect(isDueToday('weekly', 2)).toBe(false);
    expect(isDueToday(null, 2)).toBe(false);
  });
});

describe('hasTargeting', () => {
  it('requires a non-empty naics_codes or keywords', () => {
    expect(hasTargeting({ naics_codes: ['541512'], keywords: null })).toBe(true);
    expect(hasTargeting({ naics_codes: [], keywords: ['cyber'] })).toBe(true);
    expect(hasTargeting({ naics_codes: [], keywords: [] })).toBe(false);
    expect(hasTargeting({ naics_codes: [''], keywords: ['  '] })).toBe(false);
    expect(hasTargeting({ naics_codes: null, keywords: null })).toBe(false);
  });
});

describe('classifyCount — null is UNKNOWN, never 0', () => {
  it('maps counts', () => {
    expect(classifyCount(0)).toBe('ok');
    expect(classifyCount(3)).toBe('alert');
    expect(classifyCount(null)).toBe('unknown');
    expect(classifyCount(undefined)).toBe('unknown');
  });
});

describe('decideTransition (dedupe)', () => {
  it('alerts once, stays silent while sustained, recovers on clear', () => {
    expect(decideTransition('ok', 'alert')).toEqual({ action: 'alert', next: 'alert' });
    expect(decideTransition('alert', 'alert')).toEqual({ action: 'none', next: 'alert' });
    expect(decideTransition('alert', 'ok')).toEqual({ action: 'recover', next: 'ok' });
    expect(decideTransition('ok', 'ok')).toEqual({ action: 'none', next: 'ok' });
    expect(decideTransition('ok', 'unknown')).toEqual({ action: 'unknown', next: 'unknown' });
    expect(decideTransition('unknown', 'unknown')).toEqual({ action: 'none', next: 'unknown' });
    expect(decideTransition('unknown', 'ok')).toEqual({ action: 'recover', next: 'ok' });
    expect(decideTransition('alert', 'skipped')).toEqual({ action: 'none', next: 'alert' });
  });
});

describe('checkDailyAlertPending', () => {
  const users = [
    { user_email: 'a@x.com', alert_frequency: 'daily', naics_codes: ['541512'], keywords: [] },
    { user_email: 'B@x.com', alert_frequency: 'tth', naics_codes: [], keywords: ['cyber'] }, // due Tue
    { user_email: 'c@x.com', alert_frequency: 'mwf', naics_codes: ['1'], keywords: [] },     // not due Tue
    { user_email: 'd@x.com', alert_frequency: 'daily', naics_codes: [], keywords: [] },      // no targeting
    { user_email: 'e@x.com', alert_frequency: 'weekdays', naics_codes: ['1'], keywords: [] },
  ];

  it('is skipped before 15:00 UTC', async () => {
    const r = await checkDailyAlertPending(mockSb({}), TUE_10);
    expect(r.status).toBe('skipped');
    expect(r.count).toBeNull();
  });

  it('counts due + targeted users with no alert_log row (case-insensitive)', async () => {
    const sb = mockSb({
      user_notification_settings: { rows: users },
      alert_log: { rows: [{ user_email: 'b@x.com' }] },
    });
    const r = await checkDailyAlertPending(sb, TUE_16);
    expect(r.count).toBe(2); // a, e
    expect(r.status).toBe('alert');
    expect(r.stateScope).toBe('2026-11-10');
    const al = sb.calls.find((c) => c.table === 'alert_log')!;
    expect(al.ops).toContain('eq:["alert_date","2026-11-10"]');
    expect(al.ops).toContain('eq:["alert_type","daily"]');
  });

  it('pages past the 1,000-row cap', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({
      user_email: `u${i}@x.com`, alert_frequency: 'daily', naics_codes: ['541512'], keywords: [],
    }));
    const logged = many.slice(0, 2400).map((u) => ({ user_email: u.user_email }));
    const r = await checkDailyAlertPending(
      mockSb({ user_notification_settings: { rows: many }, alert_log: { rows: logged } }),
      TUE_16,
    );
    expect(r.count).toBe(100);
  });

  it('reports ok when everyone due has a row', async () => {
    const sb = mockSb({
      user_notification_settings: { rows: users.slice(0, 1) },
      alert_log: { rows: [{ user_email: 'a@x.com' }] },
    });
    expect((await checkDailyAlertPending(sb, TUE_16)).status).toBe('ok');
  });

  it('a query error is UNKNOWN, never 0', async () => {
    const r = await checkDailyAlertPending(
      mockSb({ user_notification_settings: { rows: users }, alert_log: { error: { message: 'statement timeout' } } }),
      TUE_16,
    );
    expect(r.status).toBe('unknown');
    expect(r.count).toBeNull();
    expect(r.detail).toContain('pending check failed');
  });
});

describe('count checks — the naive `count ?? 0` regression', () => {
  it('billing: error → unknown with null count (not 0, not ok)', async () => {
    const r = await checkBillingErrors(mockSb({ mcp_call_log: { error: { message: 'boom' } } }), TUE_16);
    expect(r.status).toBe('unknown');
    expect(r.count).toBeNull();
  });
  it('billing: null count with no error (missing relation) → unknown', async () => {
    const r = await checkBillingErrors(mockSb({ mcp_call_log: { count: null } }), TUE_16);
    expect(r.status).toBe('unknown');
    expect(r.count).toBeNull();
  });
  it('billing: filters on error_code + 60-min window, alerts on > 0', async () => {
    const sb = mockSb({ mcp_call_log: { count: 4 } });
    const r = await checkBillingErrors(sb, TUE_16);
    expect(r).toMatchObject({ status: 'alert', count: 4 });
    const ops = sb.calls[0].ops;
    expect(ops).toContain('in:["error_code",["billing_unavailable","debit_failed"]]');
    expect(ops).toContain('gte:["created_at","2026-11-10T15:00:00.000Z"]');
  });
  it('billing: 0 → ok', async () => {
    expect((await checkBillingErrors(mockSb({ mcp_call_log: { count: 0 } }), TUE_16)).status).toBe('ok');
  });
  it('tool errors: filters on daily_alerts, error → unknown', async () => {
    const sb = mockSb({ tool_errors: { count: 2 } });
    const r = await checkAlertToolErrors(sb, TUE_16);
    expect(r).toMatchObject({ status: 'alert', count: 2 });
    expect(sb.calls[0].ops).toContain('eq:["tool_name","daily_alerts"]');
    const bad = await checkAlertToolErrors(mockSb({ tool_errors: { error: { message: 'x' } } }), TUE_16);
    expect(bad).toMatchObject({ status: 'unknown', count: null });
  });
});

describe('runLaunchSignals', () => {
  function deps(initial: Record<string, StoredState> = {}) {
    const store = { ...initial };
    const sent: string[] = [];
    return {
      store,
      sent,
      d: {
        kvGet: async (k: string) => store[k] ?? null,
        kvSet: async (k: string, v: StoredState) => { store[k] = v; },
        send: vi.fn(async (m: { subject: string }) => { sent.push(m.subject); return { ok: true }; }),
      },
    };
  }
  const fixed = (r: Partial<SignalResult> & Pick<SignalResult, 'key' | 'status'>) =>
    ({ key: r.key, run: async () => ({ count: null, detail: 'd', ...r }) as SignalResult });

  it('alerts once on a sustained condition, then recovers', async () => {
    const { d, sent, store } = deps();
    const alert = [fixed({ key: 'billing_errors', status: 'alert', count: 3 })];
    await runLaunchSignals({}, d, TUE_16, alert);
    await runLaunchSignals({}, d, TUE_16, alert);
    expect(sent).toEqual(['[Mindy launch] MCP billing errors: 3']);
    await runLaunchSignals({}, d, TUE_16, [fixed({ key: 'billing_errors', status: 'ok', count: 0 })]);
    expect(sent[1]).toBe('[Mindy launch] MCP billing errors: recovered');
    expect(store['launchsignal:billing_errors']).toBe('ok');
  });

  it('isolates failures: a throwing check becomes unknown and others still run', async () => {
    const { d, sent } = deps();
    const out = await runLaunchSignals({}, d, TUE_16, [
      { key: 'billing_errors', run: async () => { throw new Error('kaboom'); } },
      fixed({ key: 'alert_tool_errors', status: 'alert', count: 1 }),
    ]);
    expect(out.map((o) => o.status)).toEqual(['unknown', 'alert']);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('check failed (UNKNOWN, not zero)');
  });

  it('does not persist state when Slack fails, so it retries next run', async () => {
    const { d, store } = deps();
    d.send.mockResolvedValueOnce({ ok: false, error: 'no slack target' } as never);
    await runLaunchSignals({}, d, TUE_16, [fixed({ key: 'billing_errors', status: 'alert', count: 1 })]);
    expect(store['launchsignal:billing_errors']).toBeUndefined();
  });

  it('daily state is scoped per UTC day', async () => {
    const { d, store } = deps();
    await runLaunchSignals({}, d, TUE_16, [fixed({ key: 'daily_alert_pending', status: 'alert', count: 5, stateScope: '2026-11-10' })]);
    expect(store['launchsignal:daily_alert_pending:2026-11-10']).toBe('alert');
  });

  it('message wording', () => {
    const r: SignalResult = { key: 'daily_alert_pending', status: 'alert', count: 7, detail: 'x' };
    expect(buildMessage(r, 'alert').subject).toBe('[Mindy launch] Daily alerts pending: 7');
  });
});
