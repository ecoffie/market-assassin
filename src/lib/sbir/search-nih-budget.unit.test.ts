/**
 * The NIH budget is ONE deadline for the whole operation — first attempt, backoff, retry and the
 * response-body read — not a per-attempt timeout. Real timers, small budgets, and callees that
 * deliberately IGNORE the abort signal (the worst case: a stuck body stream or an injected fetch).
 */
import { describe, it, expect, vi } from 'vitest';
import { searchSbir, type SbirDeps } from './search';

const BUDGET = 400;
const SLACK = 150; // scheduling jitter on a loaded CI box

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const never = <T>() => new Promise<T>(() => {}); // ignores every signal
const res = (status: number, json: () => Promise<unknown>) =>
  ({ ok: status >= 200 && status < 300, status, json }) as unknown as Response;

function deps(over: Partial<SbirDeps>): SbirDeps {
  return {
    fetch: vi.fn() as unknown as typeof fetch,
    db: {
      multisite: async () => ({ data: [], error: null }),
      dodTopics: async () => ({ data: [], error: null }),
      dodOpenCount: async () => ({ count: 0, error: null }),
    },
    now: () => new Date('2026-09-26T12:00:00Z'),
    sleep: (ms) => wait(ms),
    nihTimeoutMs: BUDGET,
    nihRetryDelayMs: 50,
    nihMinAttemptMs: 0,
    dbTimeoutMs: 2_000,
    ...over,
  };
}
async function timed(d: SbirDeps) {
  const t0 = Date.now();
  const r = await searchSbir({ keyword: 'cybersecurity', source: 'nih' }, d);
  return { r, ms: Date.now() - t0, nih: r.sources[0] };
}

describe('NIH budget covers the ENTIRE operation', () => {
  it('slow 429 + backoff + a retry that hangs → ends at the single budget, not 2× it', async () => {
    const f = vi.fn()
      .mockImplementationOnce(async () => { await wait(150); return res(429, async () => ({})); })
      .mockImplementationOnce(() => never<Response>());
    const { ms, nih } = await timed(deps({ fetch: f as unknown as typeof fetch }));
    expect(f).toHaveBeenCalledTimes(2);
    expect(nih).toMatchObject({ status: 'timeout', attempts: 2, budget_ms: BUDGET });
    expect(nih.detail).toMatch(/last: HTTP 429/);
    expect(ms).toBeGreaterThanOrEqual(BUDGET - 20);
    expect(ms).toBeLessThan(BUDGET + SLACK);
  });

  it('headers arrive, the body read never finishes → timeout at the budget', async () => {
    const f = vi.fn(async () => res(200, () => never()));
    const { ms, nih } = await timed(deps({ fetch: f as unknown as typeof fetch }));
    expect(nih).toMatchObject({ status: 'timeout', attempts: 1 });
    expect(ms).toBeLessThan(BUDGET + SLACK);
  });

  it('a backoff that never returns is bounded too', async () => {
    const f = vi.fn(async () => res(503, async () => ({})));
    const { ms, nih } = await timed(deps({ fetch: f as unknown as typeof fetch, sleep: () => never() }));
    expect(f).toHaveBeenCalledTimes(1);
    expect(nih.status).toBe('timeout');
    expect(ms).toBeLessThan(BUDGET + SLACK);
  });

  it('no retry when backoff + a useful attempt no longer fit in what is left', async () => {
    const f = vi.fn(async () => { await wait(300); return res(429, async () => ({})); });
    const { ms, nih } = await timed(deps({ fetch: f as unknown as typeof fetch, nihRetryDelayMs: 150 }));
    expect(f).toHaveBeenCalledTimes(1);
    expect(nih).toMatchObject({ status: 'error', detail: 'HTTP 429', attempts: 1 });
    expect(ms).toBeLessThan(BUDGET);
  });

  it('first attempt + backoff + retry + body read all count against the SAME clock', async () => {
    // 150 + 50 + 150 + 150 = 500 > 400: each piece alone is well under the budget, the sum is not.
    const f = vi.fn()
      .mockImplementationOnce(async () => { await wait(150); return res(429, async () => ({})); })
      .mockImplementationOnce(async () => { await wait(150); return res(200, async () => { await wait(150); return { results: [] }; }); });
    const { ms, nih } = await timed(deps({ fetch: f as unknown as typeof fetch }));
    expect(f).toHaveBeenCalledTimes(2);
    expect(nih.status).toBe('timeout');
    expect(ms).toBeLessThan(BUDGET + SLACK);
  });

  it('a slow but complete operation inside the budget succeeds', async () => {
    const f = vi.fn(async () => { await wait(100); return res(200, async () => { await wait(100); return { results: [] }; }); });
    const { nih } = await timed(deps({ fetch: f as unknown as typeof fetch }));
    expect(nih).toMatchObject({ status: 'empty', attempts: 1 });
  });

  it('every attempt receives the SAME operation-wide signal, and it is aborted when the budget ends', async () => {
    const signals: AbortSignal[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      if (signals.length === 1) return res(429, async () => ({}));
      return never<Response>();
    });
    await timed(deps({ fetch: f as unknown as typeof fetch }));
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[0].aborted).toBe(true);
  });
});
