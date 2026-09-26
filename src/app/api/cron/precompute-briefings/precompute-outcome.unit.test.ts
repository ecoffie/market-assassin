/**
 * precompute-briefings must report FAILURE when every generation attempt fails — measured in
 * production: 88 consecutive days of 0 templates (every LLM provider 404 model_not_found) reported as
 * 200 `success: true`. Drives the REAL route handler; only I/O is faked (Supabase, the generator,
 * tool_errors, fetch). Fake timers run the route's real 1s inter-profile delay and 4s start budget.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { precomputeVerdict, shouldSelfChain, summarizeErrors } from '@/lib/briefings/precompute-outcome';

const state = {
  users: [] as { user_email: string; naics_codes: string[] }[],
  existingHashes: [] as string[],
  upserts: [] as { table: string; row: Record<string, unknown> }[],
};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.upsert = async (row: Record<string, unknown>) => { state.upserts.push({ table, row }); return { error: null }; };
  b.then = (res: (v: unknown) => void) =>
    res(table === 'briefing_templates'
      ? { data: state.existingHashes.map((h) => ({ naics_profile_hash: h })), error: null }
      : { data: [], error: null });
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/supabase/server-clients', () => ({
  getReadClient: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: state.users, error: null }) }) }) }),
}));
const generate = vi.fn();
vi.mock('@/lib/briefings/delivery/ai-briefing-generator', () => ({ generateAIBriefing: (...a: unknown[]) => generate(...a) }));
const logToolError = vi.fn(async () => {});
vi.mock('@/lib/tool-errors', async (orig) => ({ ...(await orig<object>()), logToolError: (...a: unknown[]) => logToolError(...a) }));

const PROVIDER_404 =
  'All LLM providers failed for daily: openai/claude-sonnet-4-20250514: OpenAI 404: {"error":{"code":"model_not_found"}} | groq/llama-3.3-70b-versatile: Groq 404 | anthropic/claude-3-5-haiku-latest: Anthropic 404';
const BRIEFING = { opportunities: [{}], teamingPlays: [], processingTimeMs: 1 };

function users(n: number) {
  return Array.from({ length: n }, (_, i) => ({ user_email: `u${i}@x.test`, naics_codes: [String(541510 + i)] }));
}

let fetchSpy: ReturnType<typeof vi.fn>;
async function run() {
  const { GET } = await import('./route');
  const p = GET(new NextRequest('https://mindy.test/api/cron/precompute-briefings', { headers: { authorization: 'Bearer s' } }));
  await vi.runAllTimersAsync();
  const res = await p;
  return { status: res.status, body: await res.json() };
}
const chainCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).includes('chain='));
const runRow = () => state.upserts.filter((u) => u.table === 'briefing_precompute_runs').at(-1)?.row as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-26T02:00:30Z') });
  process.env.CRON_SECRET = 's';
  state.users = []; state.existingHashes = []; state.upserts = [];
  generate.mockReset(); logToolError.mockClear();
  fetchSpy = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('precompute-briefings — reporting', () => {
  it('ALL attempts fail → 502, success:false, counts, provider error, logged, NO self-chain', async () => {
    state.users = users(10);
    generate.mockRejectedValue(new Error(`AI Briefing generation failed: ${PROVIDER_404}`));
    const { status, body } = await run();

    expect(status).toBe(502);
    expect(body).toMatchObject({ success: false, verdict: 'all_failed', succeeded: 0, chained: false });
    expect(body.attempted).toBeGreaterThan(0);
    expect(body.failed).toBe(body.attempted);
    expect(body.errors[0]).toMatch(/model_not_found/);
    expect(chainCalls()).toHaveLength(0); // the retry storm is gone
    expect(logToolError).toHaveBeenCalledTimes(1);
    const row = runRow();
    expect(row.completed_at).toBeTruthy();
    expect((row.error_messages as string[])[0]).toBe(`VERDICT all_failed: attempted=${body.attempted} succeeded=0 failed=${body.failed}`);
  });

  it('all attempts succeed → 200, verdict ok, and it still chains while work remains', async () => {
    state.users = users(10);
    generate.mockResolvedValue(BRIEFING);
    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, verdict: 'ok', failed: 0, stoppedEarly: true, chained: true });
    expect(body.succeeded).toBe(body.attempted);
    expect(chainCalls()).toHaveLength(1);
    expect(logToolError).not.toHaveBeenCalled();
  });

  it('partial (some succeed, some fail) → 200 with partial:true, counts and errors', async () => {
    state.users = users(3);
    generate.mockResolvedValueOnce(BRIEFING).mockRejectedValueOnce(new Error(PROVIDER_404)).mockResolvedValueOnce(BRIEFING);
    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, verdict: 'partial', partial: true, attempted: 3, succeeded: 2, failed: 1 });
    expect(body.errors).toHaveLength(1);
    expect(logToolError).not.toHaveBeenCalled();
  });

  it('nothing to do (every template already exists) → 200, not a failure', async () => {
    const { hashNaicsProfile } = await import('@/lib/briefings/naics-profile-hash');
    state.users = users(2);
    state.existingHashes = state.users.map((u) => hashNaicsProfile(u.naics_codes));
    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('precompute-outcome — verdict table', () => {
  it('maps attempts to verdicts', () => {
    expect(precomputeVerdict({ pending: 0, attempted: 0, succeeded: 0, failed: 0 })).toBe('nothing_to_do');
    expect(precomputeVerdict({ pending: 5, attempted: 0, succeeded: 0, failed: 0 })).toBe('deferred');
    expect(precomputeVerdict({ pending: 5, attempted: 2, succeeded: 0, failed: 2 })).toBe('all_failed');
    expect(precomputeVerdict({ pending: 5, attempted: 2, succeeded: 1, failed: 1 })).toBe('partial');
    expect(precomputeVerdict({ pending: 5, attempted: 2, succeeded: 2, failed: 0 })).toBe('ok');
  });
  it('never chains an all-failed invocation; deferred may chain', () => {
    expect(shouldSelfChain({ stoppedEarly: true, remaining: 9, verdict: 'all_failed' })).toBe(false);
    expect(shouldSelfChain({ stoppedEarly: true, remaining: 9, verdict: 'deferred' })).toBe(true);
    expect(shouldSelfChain({ stoppedEarly: false, remaining: 9, verdict: 'ok' })).toBe(false);
  });
  it('bounds provider error text', () => {
    const out = summarizeErrors(Array.from({ length: 9 }, () => 'x'.repeat(1000)));
    expect(out).toHaveLength(5);
    expect(out[0].length).toBe(401);
  });
});
