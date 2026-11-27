/** /api/mcp/continue never runs (or charges for) a tool that is no longer in the public catalog. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  attempt: null as null | Record<string, unknown>,
  run: vi.fn(async () => ({ ok: true, result: { ok: true }, creditsCharged: 5 })),
  stamp: vi.fn(async () => {}),
}));
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.attempt, error: null }) }) }) }) }) }));
vi.mock('@/lib/mcp/metered', () => ({ runMeteredTool: h.run }));
vi.mock('@/lib/mcp/paywall', () => ({ stampAttempt: h.stamp, markOfferPageOpened: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp/credits', () => ({ getBalance: vi.fn(async () => 100) }));
vi.mock('@/lib/mcp/session-identity', () => ({ resolveMcpEmail: vi.fn(async () => 'a@example.com') }));

const post = async () => {
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await POST(new Request('http://x/api/mcp/continue', { method: 'POST', body: JSON.stringify({ attempt: 'att-1' }) }) as any);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => { h.run.mockClear(); h.stamp.mockClear(); });

describe('POST /api/mcp/continue', () => {
  it('a saved attempt for an unlisted tool (search_podcast_lessons) is refused: not run, not charged, not stamped', async () => {
    h.attempt = { id: 'att-1', user_email: 'a@example.com', tool_name: 'search_podcast_lessons', args: { query: 'x' }, consumed_at: null };
    expect(await post()).toMatchObject({ status: 410, body: { ok: false, error: 'not_available' } });
    expect(h.run).not.toHaveBeenCalled();
    expect(h.stamp).not.toHaveBeenCalled();
  });
  it('a saved get_winning_playbook attempt (unlisted 2026-11-27) is refused the same way', async () => {
    h.attempt = { id: 'att-1', user_email: 'a@example.com', tool_name: 'get_winning_playbook', args: { topic: 'x' }, consumed_at: null };
    expect(await post()).toMatchObject({ status: 410, body: { ok: false, error: 'not_available' } });
    expect(h.run).not.toHaveBeenCalled();
  });
  it('a public tool still resumes as before', async () => {
    h.attempt = { id: 'att-1', user_email: 'a@example.com', tool_name: 'find_opportunities', args: { query: 'x' }, consumed_at: null };
    expect(await post()).toMatchObject({ status: 200, body: { ok: true, creditsCharged: 5 } });
    expect(h.run).toHaveBeenCalledTimes(1);
  });
});
