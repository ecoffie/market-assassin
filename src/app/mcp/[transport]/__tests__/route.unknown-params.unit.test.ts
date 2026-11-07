/**
 * Real MCP requests through the real SDK validation and the real runMeteredTool, on both
 * edges. Pure-function tests cannot prove this: the bug is that the SDK's zod parse removed
 * the unknown key before any of our code saw it.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.MCP_OAUTH_SIGNING_SECRET = 'test-signing-secret-unknown-params';
process.env.MCP_OAUTH_ENABLED = 'true';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({ rpc: (...a: unknown[]) => rpcMock(...a), from: () => ({}) }),
  getReadClient: () => ({ from: () => ({}) }),
}));
vi.mock('@/lib/mcp/payer', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/payer')>()),
  resolvePayer: vi.fn(async () => ({ kind: 'personal' })),
}));
const logCall = vi.fn(async () => undefined);
vi.mock('@/lib/mcp/credits', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/credits')>()),
  getBalance: vi.fn(async () => 100),
  logCall: (...a: unknown[]) => logCall(...(a as [])),
  grantSignupCreditsIfFirst: vi.fn(async () => 0),
}));
const runMcpTool = vi.fn();
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/tool-registry')>()),
  runMcpTool: (...a: unknown[]) => runMcpTool(...a),
}));
vi.mock('@/lib/mcp/autorecharge', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/autorecharge')>()),
  maybeAutoRecharge: vi.fn(async () => ({ charged: false })),
}));
vi.mock('@/lib/search-history', () => ({ recordSearchAxes: vi.fn() }));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { enforceTiers: false, extractionGuard: false, extractionEnforce: false, oauth: true, aiHint: false } }));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { void fn(); },
}));

const { POST: claudePOST } = await import('../route');
const { POST: chatgptPOST } = await import('@/app/chatgpt/mcp/route');
const { issueAccessToken, OAUTH_RESOURCE_CHATGPT } = await import('@/lib/mcp/oauth/tokens');

function req(path: string, token: string, method: string, params?: unknown): NextRequest {
  return new NextRequest(`https://mcp.getmindy.ai${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}
async function body(res: Response): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const text = await res.text();
  const data = text.trim().startsWith('{')
    ? text
    : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop() ?? '';
  return JSON.parse(data);
}
const claude = (name: string, args: Record<string, unknown>) => claudePOST(
  req('/mcp', issueAccessToken('buyer@example.com', 'mcpc_claude').token, 'tools/call', { name, arguments: args }),
);
const chatgpt = (name: string, args: Record<string, unknown>) => chatgptPOST(
  req('/chatgpt/mcp', issueAccessToken('buyer@example.com', 'mcpc_chatgpt', 'mcp', OAUTH_RESOURCE_CHATGPT).token, 'tools/call', { name, arguments: args }),
);
const debits = () => rpcMock.mock.calls.filter((c) => String(c[0]).startsWith('mcp_debit'));

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: [{ ok: true, new_balance: 90 }], error: null });
  runMcpTool.mockResolvedValue({ result: { rows: [1], _meta: { grounded: true, degraded: false } }, credits: 5 });
});

describe('the reported call: company_name on get_contractor_award_history', () => {
  it('Claude edge: refused free, names the wrong key and the right one, tool never runs', async () => {
    const { result } = await body(await claude('get_contractor_award_history', { company_name: 'Excell Construction' }));
    const text = (result!.content as { text: string }[])[0].text;
    expect(text).toContain('Unrecognized parameter company_name. Did you mean company?');
    expect(text).toMatch(/nothing was charged/i);
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(debits()).toHaveLength(0);
    expect(logCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected_invalid_input', creditsCharged: 0 }));
  });

  it('the correct key runs and bills as before', async () => {
    await body(await claude('get_contractor_award_history', { company: 'Excell Construction' }));
    expect(runMcpTool).toHaveBeenCalledWith('get_contractor_award_history', { company: 'Excell Construction' }, expect.anything());
    expect(debits()).toHaveLength(1);
  });
});

describe('an unknown key beside valid input', () => {
  it('Claude edge: the tool receives only declared keys and the result reports the ignored one', async () => {
    const { result } = await body(await claude('search_grants', { keyword: 'water', agncy: 'EPA' }));
    expect(runMcpTool.mock.calls[0][1]).toEqual({ keyword: 'water' });
    const structured = result!.structuredContent as { _meta: Record<string, unknown> };
    expect(structured._meta.ignored_parameters).toEqual([{ name: 'agncy', did_you_mean: 'agency' }]);
    expect((result!.content as { text: string }[])[0].text).toContain('ignored_parameters');
  });

  it('a clean call reports nothing extra', async () => {
    const { result } = await body(await claude('search_grants', { keyword: 'water' }));
    expect((result!.structuredContent as { _meta: Record<string, unknown> })._meta).not.toHaveProperty('ignored_parameters');
  });

  it('ChatGPT edge: same split, and the notice survives the _meta allowlist', async () => {
    const { result } = await body(await chatgpt('search_grants', { keyword: 'water', agncy: 'EPA' }));
    expect(runMcpTool.mock.calls[0][1]).toEqual({ keyword: 'water' });
    expect((result!.structuredContent as { _meta: Record<string, unknown> })._meta.ignored_parameters)
      .toEqual([{ name: 'agncy', did_you_mean: 'agency' }]);
  });

  it('ChatGPT edge: a refusal names the key and charges nothing', async () => {
    const { result } = await body(await chatgpt('lookup_sam_entity', { company: 'Excell' }));
    expect((result!.content as { text: string }[])[0].text).toContain('Unrecognized parameter company.');
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(debits()).toHaveLength(0);
  });
});

it('a wrong TYPE on a declared key is still rejected by the SDK', async () => {
  const { result } = await body(await claude('get_contractor_award_history', { company: 123 }));
  expect(result!.isError).toBe(true);
  expect(runMcpTool).not.toHaveBeenCalled();
});

it('tools/list still advertises every declared property', async () => {
  const { result } = await body(await claudePOST(req('/mcp', issueAccessToken('buyer@example.com', 'mcpc_claude').token, 'tools/list')));
  const tool = (result!.tools as { name: string; inputSchema: { properties: Record<string, unknown> } }[])
    .find((t) => t.name === 'get_contractor_award_history')!;
  expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(['award_limit', 'company', 'uei']);
});
