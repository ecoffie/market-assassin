/**
 * /chatgpt/mcp billing chain, end to end: route → runMeteredTool → debitResolvedPayer →
 * debitCredits → rpc(...). metered.ts, payer.ts (debit) and credits.ts (debit) are the
 * REAL modules; only the database client, the payer RESOLUTION, the balance read, the
 * call log and the tool body are mocked. The assertion is on the RPC arguments, the last
 * point in TypeScript before Postgres (#1778's SQL is proven separately by the PGlite suite
 * autorecharge-chatgpt-attribution.pglite.unit.test.ts).
 *
 *   · ChatGPT personal debit  → mcp_debit_credits WITH p_channel='chatgpt'
 *                               (ledger channel='chatgpt', chatgpt_spend_since_recharge += cost)
 *   · Claude/general debit    → mcp_debit_credits with NO p_channel key (channel NULL, S unchanged)
 *   · ChatGPT pooled debit    → mcp_debit_pool only, no p_channel, no personal debit (S unchanged)
 *   · the ChatGPT route never calls maybeAutoRecharge, even at a balance that signals it
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.MCP_OAUTH_SIGNING_SECRET = 'test-signing-secret-chatgpt-chain';
process.env.MCP_OAUTH_ENABLED = 'true';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({ rpc: (...a: unknown[]) => rpcMock(...a), from: () => ({}) }),
  getReadClient: () => ({ from: () => ({}) }),
}));

const resolvePayer = vi.fn();
vi.mock('@/lib/mcp/payer', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/payer')>()),
  resolvePayer: (...a: unknown[]) => resolvePayer(...a),
  getPoolBalance: vi.fn(async () => 500),
}));

const getBalance = vi.fn(async () => 100);
const logCall = vi.fn(async () => undefined);
const grantSignupCreditsIfFirst = vi.fn(async () => 100);
vi.mock('@/lib/mcp/credits', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/credits')>()),
  getBalance: (...a: unknown[]) => getBalance(...(a as [])),
  logCall: (...a: unknown[]) => logCall(...(a as [])),
  grantSignupCreditsIfFirst: (...a: unknown[]) => grantSignupCreditsIfFirst(...(a as [])),
}));

const runMcpTool = vi.fn();
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/tool-registry')>()),
  runMcpTool: (...a: unknown[]) => runMcpTool(...a),
}));

const maybeAutoRecharge = vi.fn(async () => ({ charged: false }));
vi.mock('@/lib/mcp/autorecharge', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/autorecharge')>()),
  maybeAutoRecharge: (...a: unknown[]) => maybeAutoRecharge(...(a as [])),
}));
const recordPaywallAttempt = vi.fn(async () => 'attempt-x');
vi.mock('@/lib/mcp/paywall', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/paywall')>()),
  recordPaywallAttempt: (...a: unknown[]) => recordPaywallAttempt(...(a as [])),
}));
vi.mock('@/lib/mcp/entitlements', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/entitlements')>()),
  isProTool: vi.fn(() => false),
  isProForMcp: vi.fn(async () => true),
}));
vi.mock('@/lib/search-history', () => ({ recordSearchAxes: vi.fn() }));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { enforceTiers: false, extractionGuard: false, extractionEnforce: false, oauth: true, aiHint: false } }));

const { POST } = await import('../route');
const { runMeteredTool } = await import('@/lib/mcp/metered');
const { issueAccessToken, OAUTH_RESOURCE_CHATGPT } = await import('@/lib/mcp/oauth/tokens');
const { creditsFor } = await import('@/lib/mcp/tool-registry');

const chatgptToken = () => issueAccessToken('buyer@example.com', 'mcpc_chatgpt', 'mcp', OAUTH_RESOURCE_CHATGPT).token;

function callTool(name: string, args: Record<string, unknown>): NextRequest {
  return new NextRequest('https://mcp.getmindy.ai/chatgpt/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      authorization: `Bearer ${chatgptToken()}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
}

const TOOL = 'search_grants';

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: [{ ok: true, new_balance: 3 }], error: null }); // low → needsRecharge signal
  runMcpTool.mockResolvedValue({ result: { items: [{ id: 'g1' }], _meta: { grounded: true, degraded: false } }, credits: creditsFor(TOOL) });
});

describe('/chatgpt/mcp → metered → payer → credits → RPC', () => {
  it('ChatGPT personal debit sends p_channel=chatgpt to mcp_debit_credits', async () => {
    resolvePayer.mockResolvedValue({ kind: 'personal' });
    const res = await POST(callTool(TOOL, { keyword: 'water' }));
    expect(res.status).toBe(200);
    await res.text();

    const debits = rpcMock.mock.calls.filter((c) => c[0] === 'mcp_debit_credits');
    expect(debits).toHaveLength(1);
    expect(debits[0][1]).toEqual({
      p_user: 'buyer@example.com',
      p_amount: creditsFor(TOOL),
      p_reason: 'tool_call',
      p_tool: TOOL,
      p_api_key_id: null,
      p_channel: 'chatgpt',
    });
    expect(rpcMock.mock.calls.some((c) => c[0] === 'mcp_debit_pool')).toBe(false);
    // balance 3 would trigger in-request auto-recharge on the Claude edge; never here
    expect(maybeAutoRecharge).not.toHaveBeenCalled();
    expect(grantSignupCreditsIfFirst).not.toHaveBeenCalled();
    expect(logCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', outcome: expect.objectContaining({ outcome: 'grounded' }) }));
  });

  it('ChatGPT pooled debit goes to mcp_debit_pool only (no p_channel, no personal debit)', async () => {
    resolvePayer.mockResolvedValue({ kind: 'pool', poolId: 'pool-1', orgId: 'org-1', orgName: 'Acme' });
    rpcMock.mockResolvedValue({ data: [{ ok: true, new_balance: 2 }], error: null });
    const res = await POST(callTool(TOOL, { keyword: 'water' }));
    await res.text();

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe('mcp_debit_pool');
    expect(Object.keys(rpcMock.mock.calls[0][1])).not.toContain('p_channel');
    expect(rpcMock.mock.calls.some((c) => c[0] === 'mcp_debit_credits')).toBe(false);
    expect(maybeAutoRecharge).not.toHaveBeenCalled();
  });

  it('an insufficient-balance ChatGPT refusal never saves a purchase retry and never debits', async () => {
    resolvePayer.mockResolvedValue({ kind: 'personal' });
    getBalance.mockResolvedValueOnce(0);
    const res = await POST(callTool(TOOL, { keyword: 'water' }));
    await res.text();
    expect(recordPaywallAttempt).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(logCall).toHaveBeenCalledWith(expect.objectContaining({
      status: 'rejected_no_credits',
      outcome: expect.objectContaining({ outcome: 'blocked', errorCode: 'insufficient_credits' }),
    }));
  });

  it('Claude/general (no channel) personal debit sends NO p_channel key (channel NULL, S unchanged)', async () => {
    resolvePayer.mockResolvedValue({ kind: 'personal' });
    await runMeteredTool(TOOL, { keyword: 'water' }, { userEmail: 'buyer@example.com', apiKeyId: 'key_1' });
    const debits = rpcMock.mock.calls.filter((c) => c[0] === 'mcp_debit_credits');
    expect(debits).toHaveLength(1);
    expect(debits[0][1]).toEqual({
      p_user: 'buyer@example.com',
      p_amount: creditsFor(TOOL),
      p_reason: 'tool_call',
      p_tool: TOOL,
      p_api_key_id: 'key_1',
    });
    expect(Object.keys(debits[0][1])).not.toContain('p_channel');
  });
});
