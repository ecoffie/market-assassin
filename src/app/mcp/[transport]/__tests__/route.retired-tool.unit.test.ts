/**
 * Retired tools on the REAL hosted MCP edge (mcp-handler + the SDK, mocked auth + dispatch):
 *   - tools/list does not advertise search_sbir, and still lists the unrelated tools;
 *   - a stale tools/call for search_sbir gets a clear "retired, 0 credits" result, is logged as
 *     'retired', and NEVER reaches runMeteredTool (so it cannot run or debit);
 *   - an unrelated tool still dispatches through runMeteredTool as before;
 *   - an unauthenticated stale call is still refused 401 (the retired answer is not a bypass).
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mcp/api-keys', () => ({
  verifyApiKey: vi.fn(async (raw?: string | null) =>
    raw === 'mcp_live_good' ? { keyId: 'key_1', userEmail: 'buyer@example.com', scopes: [] } : null,
  ),
}));
vi.mock('@/lib/mcp/metered', () => ({
  runMeteredTool: vi.fn(async () => ({ ok: true, result: { balance: 42, _meta: { grounded: true } }, creditsCharged: 0, balance: null })),
}));
vi.mock('@/lib/mcp/credits', async (orig) => ({
  ...(await orig<object>()),
  logCall: vi.fn(async () => undefined),
  grantSignupCreditsIfFirst: vi.fn(async () => 0),
}));

const { POST } = await import('../route');
const { runMeteredTool } = await import('@/lib/mcp/metered');
const { logCall } = await import('@/lib/mcp/credits');

function rpc(body: unknown, auth = 'Bearer mcp_live_good'): NextRequest {
  return new NextRequest('https://mcp.getmindy.ai/mcp/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}
/** Streamable HTTP may answer as JSON or as an SSE frame — read either. */
async function readRpc(res: Response): Promise<{ id?: unknown; result?: Record<string, unknown>; error?: { message: string } }> {
  const text = await res.text();
  const data = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: ')) ?? '').slice(6);
  return JSON.parse(data);
}

beforeEach(() => vi.clearAllMocks());

describe('retired tool: search_sbir', () => {
  it('is absent from tools/list, while unrelated tools are still listed', async () => {
    const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
    expect(res.status).toBe(200);
    const names = ((await readRpc(res)).result?.tools as { name: string }[]).map((t) => t.name);
    expect(names).not.toContain('search_sbir');
    for (const n of ['find_opportunities', 'search_grants', 'get_balance', 'get_winning_playbook']) expect(names).toContain(n);
    expect(names.length).toBeGreaterThan(50);
  });

  it('a stale tools/call gets a clear retired result, is logged uncharged, and never dispatches', async () => {
    const res = await POST(rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'search_sbir', arguments: { keyword: 'zero trust' } } }));
    expect(res.status).toBe(200);
    const body = await readRpc(res);
    expect(body.id).toBe(7);
    const result = body.result as { isError: boolean; content: { text: string }[]; structuredContent: { error: Record<string, unknown> } };
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toMatch(/search_sbir was retired on 2026-09-26/);
    expect(result.content[0].text).toMatch(/No credits were charged/);
    expect(result.structuredContent.error).toMatchObject({ code: 'tool_retired', tool: 'search_sbir', credits_charged: 0 });
    expect(runMeteredTool).not.toHaveBeenCalled();
    expect(logCall).toHaveBeenCalledWith(expect.objectContaining({ userEmail: 'buyer@example.com', toolName: 'search_sbir', status: 'retired', creditsCharged: 0 }));
  });

  it('an unrelated tool still dispatches through runMeteredTool', async () => {
    const res = await POST(rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_balance', arguments: {} } }));
    expect(res.status).toBe(200);
    const body = await readRpc(res);
    expect(body.error).toBeUndefined();
    expect(runMeteredTool).toHaveBeenCalledWith('get_balance', {}, expect.objectContaining({ userEmail: 'buyer@example.com' }));
  });

  it('an unauthenticated stale call is still refused (401), not answered', async () => {
    const res = await POST(rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'search_sbir', arguments: {} } }, ''));
    expect(res.status).toBe(401);
    expect(logCall).not.toHaveBeenCalled();
  });

  it('a JSON-RPC batch containing the retired name falls to the SDK and still never dispatches it', async () => {
    const res = await POST(rpc([{ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'search_sbir', arguments: {} } }]));
    expect(runMeteredTool).not.toHaveBeenCalled();
    expect(res.status).toBeLessThan(500);
  });
});
