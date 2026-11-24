/**
 * Unknown is never zero: a failed alert_log count must make the type `unknown`, never a 0
 * that fires a false regression (recent window) or quietly drags the baseline down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { distinctSentCount, judgeThroughput, windowSum, type CountClient } from './throughput';

type Resp = { count: number | null; error: { message: string } | null };
/** Fake HEAD-count client: answer(alertType, date) decides each count. */
function fakeClient(answer: (type: string, date: string) => Resp | 'throw'): CountClient {
  return {
    from: () => ({
      select: () => {
        const f: Record<string, string> = {};
        const q = {
          eq: (c: string, v: string) => { f[c] = v; return q; },
          then: (res: (v: Resp) => unknown, rej: (e: unknown) => unknown) => {
            const a = answer(f.alert_type, f.alert_date);
            return (a === 'throw' ? Promise.reject(new Error('fetch failed')) : Promise.resolve(a)).then(res, rej);
          },
        };
        return q;
      },
    }),
  } as unknown as CountClient;
}

describe('distinctSentCount', () => {
  it('returns the exact count on success', async () => {
    expect(await distinctSentCount(fakeClient(() => ({ count: 1468, error: null })), 'daily', '2026-11-22'))
      .toEqual({ count: 1468, error: null });
  });
  it('returns null (not 0) with the error when the query fails', async () => {
    const r = await distinctSentCount(fakeClient(() => ({ count: null, error: { message: 'canceling statement due to statement timeout' } })), 'daily', '2026-11-22');
    expect(r.count).toBeNull();
    expect(r.error).toContain('statement timeout');
  });
  it('returns null when the client throws or returns no count', async () => {
    expect((await distinctSentCount(fakeClient(() => 'throw'), 'daily', '2026-11-22')).count).toBeNull();
    expect((await distinctSentCount(fakeClient(() => ({ count: null, error: null })), 'daily', '2026-11-22')).count).toBeNull();
  });
  it('keeps a real zero as zero', async () => {
    expect(await distinctSentCount(fakeClient(() => ({ count: 0, error: null })), 'weekly', '2026-11-22'))
      .toEqual({ count: 0, error: null });
  });
});

describe('windowSum', () => {
  const now = new Date('2026-11-23T14:00:00Z');
  it('sums a fully readable window', async () => {
    expect(await windowSum(fakeClient(() => ({ count: 10, error: null })), 'weekly', now, 1, 7)).toEqual({ total: 70, errors: [] });
  });
  it('one unreadable day makes the whole window unknown', async () => {
    const c = fakeClient((_t, d) => (d === '2026-11-20' ? { count: null, error: { message: 'boom' } } : { count: 10, error: null }));
    const r = await windowSum(c, 'weekly', now, 1, 7);
    expect(r.total).toBeNull();
    expect(r.errors).toEqual(['weekly 2026-11-20: boom']);
  });
});

describe('judgeThroughput', () => {
  const base = { dropThreshold: 0.5, minBaseline: 50 };
  it('unknown recent window → unknown, not a warning', () => {
    expect(judgeThroughput({ ...base, recent: null, baselineCounts: [900, 900, 900] })).toEqual({ status: 'unknown', ratio: null, baselineMean: null });
  });
  it('unknown baseline day → unknown (no ratio over partial data)', () => {
    expect(judgeThroughput({ ...base, recent: 400, baselineCounts: [900, null, 900] }).status).toBe('unknown');
  });
  it('a real collapse still warns', () => {
    expect(judgeThroughput({ ...base, recent: 1, baselineCounts: [919, 920, 918] })).toMatchObject({ status: 'warning', ratio: 0 });
  });
  it('healthy and no-baseline unchanged', () => {
    expect(judgeThroughput({ ...base, recent: 900, baselineCounts: [900, 900] })).toMatchObject({ status: 'healthy', ratio: 1 });
    expect(judgeThroughput({ ...base, recent: 0, baselineCounts: [10, 10] }).status).toBe('no-baseline');
  });
});

// ── Route wiring: a failed count reports `unknown` and never a regression alert ──
const sent: { subject: string; html: string }[] = [];
vi.mock('@/lib/ops-alert', () => ({
  sendOpsAlert: vi.fn(async (m: { subject: string; html: string }) => { sent.push(m); return { ok: true }; }),
}));
let answer: (type: string, date: string) => Resp | 'throw' = () => ({ count: 0, error: null });
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient((t, d) => answer(t, d)) }));

describe('check-alert-throughput route', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'pw';
    sent.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T14:00:00Z'));
  });
  const call = async () => {
    const { GET } = await import('./route');
    return (await GET(new NextRequest('http://localhost/api/cron/check-alert-throughput?password=pw'))).json();
  };

  it('daily count failure for yesterday → daily unknown, no regression warning, admin told it could not run', async () => {
    answer = (t, d) => (t === 'daily' && d === '2026-11-22'
      ? { count: null, error: { message: 'connection terminated' } }
      : { count: t === 'weekly' ? (d === '2026-11-16' || d === '2026-11-09' || d === '2026-11-02' || d === '2026-10-26' || d === '2026-10-19' ? 430 : 0) : 900, error: null });
    const body = await call();
    const daily = body.reports.find((r: { alertType: string }) => r.alertType === 'daily');
    expect(daily.status).toBe('unknown');
    expect(daily.yesterday).toBeNull();
    expect(daily.ratio).toBeNull();
    expect(daily.errors[0]).toContain('connection terminated');
    expect(body.alerts).toBe(0);
    expect(body.unknown).toEqual(['daily']);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('UNKNOWN (count read failed) — daily');
    expect(sent[0].subject).not.toContain('regression');
  });

  it('all counts readable and healthy → no email', async () => {
    answer = () => ({ count: 900, error: null });
    const body = await call();
    expect(body.unknown).toEqual([]);
    expect(body.reports.every((r: { status: string }) => r.status === 'healthy')).toBe(true);
    expect(sent).toHaveLength(0);
  });
});
