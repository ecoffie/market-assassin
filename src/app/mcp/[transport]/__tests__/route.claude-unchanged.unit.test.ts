/**
 * REGRESSION GUARD — the Claude/general MCP endpoint is UNCHANGED by the ChatGPT profile.
 *
 * Owner decision 1 (tasks/chatgpt-plugin-path-a.md): commerce cleanup is /chatgpt/mcp
 * ONLY. mcp.getmindy.ai/mcp (and getmindy.ai/mcp/mcp) must keep exactly main's behaviour:
 * the PUBLIC catalog (mcpRegistrationList → listPublicMcpTools, #1777; 53 of the 64
 * registered tools on 2026-10-03, but asserted against main's own list, never a hardcoded
 * count) with their registry copy, the credit footer, `_meta.credits`, the signup grant,
 * in-request auto-recharge, the commercial paywall refusal — and must keep rejecting
 * tokens minted for any other audience (now including the ChatGPT one).
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.MCP_OAUTH_SIGNING_SECRET = 'test-signing-secret-claude';

const runMeteredTool = vi.fn();
vi.mock('@/lib/mcp/metered', () => ({ runMeteredTool: (...a: unknown[]) => runMeteredTool(...a) }));
const grantSignupCreditsIfFirst = vi.fn(async () => 0);
vi.mock('@/lib/mcp/credits', () => ({ grantSignupCreditsIfFirst: (...a: unknown[]) => grantSignupCreditsIfFirst(...(a as [])) }));
const maybeAutoRecharge = vi.fn(async () => ({ charged: false }));
vi.mock('@/lib/mcp/autorecharge', () => ({
  maybeAutoRecharge: (...a: unknown[]) => maybeAutoRecharge(...(a as [])),
  AUTORECHARGE_SIGNAL_FLOOR: 20,
}));
vi.mock('@/lib/mcp/api-keys', () => ({ verifyApiKey: vi.fn(async () => null) }));
// after() needs a Next request scope; run the callback inline so we can observe it.
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { void fn(); },
}));

const { POST } = await import('../route');
const { issueAccessToken, OAUTH_RESOURCE_CHATGPT } = await import('@/lib/mcp/oauth/tokens');
const { mcpRegistrationList } = await import('@/lib/mcp/tool-schemas');
const { listMcpTools } = await import('@/lib/mcp/tool-registry');
const { listPublicMcpTools } = await import('@/lib/mcp/public-catalog');

const claudeToken = () => issueAccessToken('buyer@example.com', 'mcpc_claude').token;
const chatgptToken = () => issueAccessToken('buyer@example.com', 'mcpc_chatgpt', 'mcp', OAUTH_RESOURCE_CHATGPT).token;

function rpc(body: unknown, auth?: string, path = '/mcp'): NextRequest {
  return new NextRequest(`https://mcp.getmindy.ai${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function rpcResult(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const data = text.trim().startsWith('{')
    ? text
    : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop() ?? '';
  return JSON.parse(data) as Record<string, unknown>;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('Claude/general MCP endpoint — unchanged', () => {
  it('lists exactly main\'s public catalog with the registry titles, descriptions and annotations', async () => {
    const body = await rpcResult(await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, claudeToken())));
    const tools = (body.result as { tools: Record<string, unknown>[] }).tools;
    const reg = new Map(mcpRegistrationList().map((e) => [e.name, e]));
    // exactly what main lists — same names, same order — whatever that count is
    expect(tools.map((t) => t.name)).toEqual(mcpRegistrationList().map((e) => e.name));
    expect(tools.map((t) => t.name)).toEqual(listPublicMcpTools().map((t) => (t as { function: { name: string } }).function.name));
    // the three tools dropped from the ChatGPT 15 are still public here
    for (const n of ['search_contractors', 'search_federal_events', 'get_award_detail']) expect(reg.has(n), n).toBe(true);
    for (const t of tools) {
      const e = reg.get(String(t.name))!;
      expect(t.title).toBe(e.title);
      expect(t.description).toBe(e.description);
      expect(t.annotations).toEqual(e.annotations);
    }
    // registry copy still carries its credit pricing language — untouched by the profile
    expect(tools.some((t) => /Credits: \d+/.test(String(t.description)))).toBe(true);
  });

  it('param descriptions are byte-identical to the registry for every listed tool, before and after the ChatGPT profile is built', async () => {
    const list = async () =>
      ((await rpcResult(await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, claudeToken())))).result as { tools: Record<string, unknown>[] }).tools;
    const before = JSON.stringify((await list()).map((t) => [t.name, t.inputSchema]));
    // Build the ChatGPT registration (applies CHATGPT_PARAM_COPY) — must not leak into the full endpoint.
    const { chatgptRegistrationList } = await import('@/lib/mcp/chatgpt-profile');
    expect(chatgptRegistrationList()).toHaveLength(15);
    const tools = await list();
    expect(JSON.stringify(tools.map((t) => [t.name, t.inputSchema]))).toBe(before);

    const raw = new Map(listMcpTools().map((r) => {
      const fn = (r as { function: { name: string; parameters?: { properties?: Record<string, { description?: string }> } } }).function;
      return [fn.name, fn.parameters?.properties ?? {}] as const;
    }));
    let checked = 0;
    for (const t of tools) {
      const props = (t.inputSchema as { properties?: Record<string, { description?: string }> }).properties ?? {};
      for (const [p, rp] of Object.entries(raw.get(String(t.name)) ?? {})) {
        expect(props[p]?.description, `${t.name}.${p}`).toBe(rp.description);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    // the exact registry strings the ChatGPT profile overrides are still served here
    const limit = (tools.find((t) => t.name === 'find_capable_contractors')!.inputSchema as { properties: Record<string, { description: string }> }).properties.limit;
    expect(limit.description).toMatch(/no per-call cost/);
  });

  it('works on the apex/preview direct path too (/mcp/mcp)', async () => {
    const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, claudeToken(), '/mcp/mcp'));
    expect(res.status).toBe(200);
  });

  it('rejects a ChatGPT-audience token (one audience per handler)', async () => {
    const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, chatgptToken()));
    expect(res.status).toBe(401);
    // and its challenge still points at the default metadata document
    expect(res.headers.get('www-authenticate') ?? '').not.toContain('/chatgpt/mcp');
  });

  it('a priced call still gets the footer, _meta.credits, the signup grant and in-request auto-recharge', async () => {
    runMeteredTool.mockResolvedValue({
      ok: true, result: { a: 1, _meta: { grounded: true } }, creditsCharged: 5, balance: 12, needsRecharge: true,
    });
    const body = await rpcResult(await POST(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_grants', arguments: { keyword: 'x' } } }, claudeToken())));
    const result = body.result as { content: { text: string }[]; structuredContent: Record<string, unknown> };
    expect(result.content).toHaveLength(2);
    expect(result.content[1].text).toBe('⚠️ Mindy credits: 12 left · this call used 5 credits — running low. Top up → getmindy.ai/mcp');
    expect(result.structuredContent._meta).toEqual({ grounded: true, credits: { charged: 5, remaining: 12 } });
    expect(grantSignupCreditsIfFirst).toHaveBeenCalledWith('buyer@example.com');
    expect(maybeAutoRecharge).toHaveBeenCalledWith('buyer@example.com');
    // dispatched with NO channel — the default (Claude) billing behaviour
    expect(runMeteredTool).toHaveBeenCalledWith('search_grants', { keyword: 'x' }, { userEmail: 'buyer@example.com', apiKeyId: null });
  });

  it('the commercial paywall refusal passes through verbatim (link + continue_url intact)', async () => {
    const commercial = {
      error_code: 'INSUFFICIENT_CREDITS', required_credits: 50, available_credits: 45, credits_needed: 5, retryable: false,
      continuation_available: true, continue_url: 'https://getmindy.ai/mcp/continue?attempt=abc', tool_name: 'capability_market_match',
      message: 'You need 50 credits… https://getmindy.ai/mcp/continue?attempt=abc',
    };
    runMeteredTool.mockResolvedValue({ ok: false, creditsCharged: 0, balance: 45, error: { code: 'insufficient_credits', message: commercial.message, commercial } });
    const body = await rpcResult(await POST(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'capability_market_match', arguments: { description: 'x' } } }, claudeToken())));
    const result = body.result as { content: { text: string }[]; structuredContent: Record<string, unknown> };
    expect(result.content[0].text).toBe(commercial.message);
    expect(result.structuredContent).toEqual(commercial);
  });
});
