/**
 * /chatgpt/mcp — the ChatGPT profile edge, exercised through the real route handler
 * (mcp-handler + withMcpAuth + the MCP SDK), with only the billing seam, the signup
 * grant and the auto-recharge engine mocked so we can prove what is and is NOT called.
 *
 * Owner decisions under test (tasks/chatgpt-plugin-path-a.md):
 *   · exactly 15 tools; any other name is unknown and never dispatched/billed
 *   · ChatGPT-audience tokens only (full-endpoint tokens + API keys → 401)
 *   · no credit footer, no _meta.credits, projection on content AND structuredContent
 *   · neutral refusals; no signup grant; no auto-recharge even when the balance is low
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.MCP_OAUTH_SIGNING_SECRET = 'test-signing-secret-chatgpt';
process.env.MCP_OAUTH_ENABLED = 'true';

const runMeteredTool = vi.fn();
vi.mock('@/lib/mcp/metered', () => ({ runMeteredTool: (...a: unknown[]) => runMeteredTool(...a) }));
const grantSignupCreditsIfFirst = vi.fn(async () => 100);
vi.mock('@/lib/mcp/credits', () => ({ grantSignupCreditsIfFirst: (...a: unknown[]) => grantSignupCreditsIfFirst(...(a as [])) }));
const maybeAutoRecharge = vi.fn(async () => ({ charged: false }));
vi.mock('@/lib/mcp/autorecharge', () => ({
  maybeAutoRecharge: (...a: unknown[]) => maybeAutoRecharge(...(a as [])),
  AUTORECHARGE_SIGNAL_FLOOR: 20,
}));
const verifyApiKey = vi.fn(async (raw?: string | null) =>
  raw === 'mcp_live_good' ? { keyId: 'key_1', userEmail: 'buyer@example.com', scopes: [] } : null,
);
vi.mock('@/lib/mcp/api-keys', () => ({ verifyApiKey: (r?: string | null) => verifyApiKey(r) }));

const { POST } = await import('../route');
const { POST: CLAUDE_POST } = await import('@/app/mcp/[transport]/route');
const { issueAccessToken, OAUTH_RESOURCE, OAUTH_RESOURCE_CHATGPT } = await import('@/lib/mcp/oauth/tokens');
const { listMcpTools } = await import('@/lib/mcp/tool-registry');

const chatgptToken = () => issueAccessToken('buyer@example.com', 'mcpc_chatgpt', 'mcp', OAUTH_RESOURCE_CHATGPT).token;
const claudeToken = () => issueAccessToken('buyer@example.com', 'mcpc_claude').token;

function rpc(body: unknown, auth?: string): NextRequest {
  return new NextRequest('https://mcp.getmindy.ai/chatgpt/mcp', {
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

/** Parse a JSON-RPC response that may come back as JSON or as one SSE `data:` frame. */
async function rpcResult(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const data = text.trim().startsWith('{')
    ? text
    : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop() ?? '';
  return JSON.parse(data) as Record<string, unknown>;
}

const listTools = (auth: string) => rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, auth);
const callTool = (auth: string, name: string, args: Record<string, unknown> = {}) =>
  rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, auth);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('/chatgpt/mcp — auth + resource binding', () => {
  it('401 with a resource_metadata challenge pointing at the ChatGPT document', async () => {
    const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://mcp.getmindy.ai/.well-known/oauth-protected-resource/chatgpt/mcp"',
    );
  });

  it('rejects a full-endpoint (Claude) token', async () => {
    expect(OAUTH_RESOURCE).toBe('https://mcp.getmindy.ai/mcp');
    const res = await POST(listTools(claudeToken()));
    expect(res.status).toBe(401);
  });

  it('rejects an mcp_live_ API key (OAuth-only surface)', async () => {
    const res = await POST(listTools('mcp_live_good'));
    expect(res.status).toBe(401);
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it('accepts a ChatGPT-audience token', async () => {
    const res = await POST(listTools(chatgptToken()));
    expect(res.status).toBe(200);
  });
});

describe('/chatgpt/mcp — tools/list', () => {
  it('lists exactly the 15 allowlisted tools with ChatGPT copy + annotations', async () => {
    const body = await rpcResult(await POST(listTools(chatgptToken())));
    const tools = (body.result as { tools: Record<string, unknown>[] }).tools;
    expect(tools).toHaveLength(15);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'assess_market_depth', 'capability_market_match', 'find_capable_contractors', 'find_opportunities',
      'get_agency_intel', 'get_contractor_profile', 'get_expiring_contracts', 'get_keyword_coverage',
      'get_legislation_status', 'get_solicitation_documents', 'get_solicitation_incumbent', 'lookup_sam_entity',
      'lookup_solicitation', 'search_grants', 'search_past_contracts',
    ]);
    for (const t of tools) {
      expect(String(t.description)).not.toMatch(/Credits:|Mindy Pro|\$/);
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
  });
});

/** Every `description` in a JSON schema, at any depth (properties, items, records, unions). */
function schemaDescriptions(s: unknown, path = '', out: [string, string][] = []): [string, string][] {
  if (!s || typeof s !== 'object') return out;
  const o = s as Record<string, unknown>;
  if (typeof o.description === 'string') out.push([path, o.description]);
  for (const [k, v] of Object.entries((o.properties as Record<string, unknown>) ?? {})) schemaDescriptions(v, path ? `${path}.${k}` : k, out);
  if (o.items) schemaDescriptions(o.items, `${path}[]`, out);
  if (o.additionalProperties && typeof o.additionalProperties === 'object') schemaDescriptions(o.additionalProperties, `${path}{}`, out);
  for (const key of ['anyOf', 'oneOf', 'allOf']) ((o[key] as unknown[]) ?? []).forEach((x, i) => schemaDescriptions(x, `${path}|${i}`, out));
  return out;
}
function withoutDescriptions(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutDescriptions);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'description').map(([k, x]) => [k, withoutDescriptions(x)]));
}

/** Commerce + internal-label terms banned from every ChatGPT PARAMETER description (owner decision 2). */
const PARAM_BANNED: RegExp[] = [
  /\bcredits?\b/i, /\bprices?\b/i, /\bpricing\b/i, /\$/, /\bfree\b/i, /\bcosts?\b/i, /\bPro\b/, /\bupgrad/i,
  /\bsubscri/i, /\bbuy\b/i, /\bpurchas/i, /\bcheckout\b/i, /\btop[ -]?up\b/i,
  // internal labels / constants / table + field names / journey jargon found in the 2026-10-02 inventory
  /company_registered_/, /\bNOT_ELIGIBLE\b/, /\bELIGIBLE\b/, /\bUNKNOWN\b/, /MATCHED_CANDIDATE/, /\bFIND\b/,
  /generated_internal_id/, /query_summary/, /_meta\b/, /local table/i, /cached index/i, /client-side/i,
  /normalization/i, /first value/i, /current truth/i, /power-user/i, /\bper-call\b/i, /VCALENDAR/,
  /sam_opportunities|recompete_opportunities|agency_forecasts|BigQuery/,
];

describe('/chatgpt/mcp — parameter descriptions (owner decision 2)', () => {
  const listBoth = async () => {
    const mine = (await rpcResult(await POST(listTools(chatgptToken())))).result as { tools: Record<string, unknown>[] };
    const claudeReq = new NextRequest('https://mcp.getmindy.ai/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${claudeToken()}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const claude = (await rpcResult(await CLAUDE_POST(claudeReq))).result as { tools: Record<string, unknown>[] };
    return { mine: mine.tools, claude: new Map(claude.tools.map((t) => [String(t.name), t])) };
  };

  it('no emitted parameter description (any depth) carries commerce or internal labels', async () => {
    const { mine } = await listBoth();
    const hits: string[] = [];
    let n = 0;
    for (const t of mine) {
      for (const [path, d] of schemaDescriptions(t.inputSchema)) {
        n++;
        for (const re of PARAM_BANNED) if (re.test(d)) hits.push(`${t.name}.${path}: ${re}`);
      }
    }
    expect(n).toBeGreaterThan(50); // the walk really saw the parameters
    expect(hits).toEqual([]);
  });

  it('no ChatGPT-facing string on the wire names a tool outside the 15', async () => {
    const { mine } = await listBoth();
    const allowed = new Set(mine.map((t) => String(t.name)));
    const registry = listMcpTools().map((t) => (t as { function: { name: string } }).function.name);
    const foreign = registry.filter((n) => !allowed.has(n));
    expect(foreign.length).toBeGreaterThan(40);
    const init = await rpcResult(await POST(rpc({
      jsonrpc: '2.0', id: 9, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    }, chatgptToken())));
    const initResult = init.result as { instructions?: string; serverInfo?: Record<string, unknown> };
    expect(initResult.instructions).toBeTruthy();
    const strings: [string, string][] = [
      ['instructions', String(initResult.instructions)],
      ['serverInfo', JSON.stringify(initResult.serverInfo ?? {})],
    ];
    for (const t of mine) {
      strings.push([`${t.name}.title`, String(t.title)], [`${t.name}.description`, String(t.description)]);
      for (const [path, d] of schemaDescriptions(t.inputSchema)) strings.push([`${t.name}.${path}`, d]);
    }
    const hits = strings.flatMap(([where, text]) => foreign.filter((n) => new RegExp(`\\b${n}\\b`).test(text)).map((n) => `${where}: ${n}`));
    expect(hits).toEqual([]);
  });

  it('schema shape is identical to the Claude endpoint apart from description text', async () => {
    const { mine, claude } = await listBoth();
    for (const t of mine) {
      const c = claude.get(String(t.name))!;
      expect(c, String(t.name)).toBeDefined();
      expect(withoutDescriptions(t.inputSchema), String(t.name)).toEqual(withoutDescriptions(c.inputSchema));
    }
  });

  it('the overrides really reach the wire (and the Claude endpoint keeps the registry text)', async () => {
    const { mine, claude } = await listBoth();
    const prop = (tools: Record<string, unknown> | undefined, p: string) =>
      ((tools!.inputSchema as { properties: Record<string, { description?: string }> }).properties[p]).description;
    const myLimit = prop(mine.find((t) => t.name === 'get_expiring_contracts'), 'limit');
    const theirLimit = prop(claude.get('get_expiring_contracts'), 'limit');
    expect(myLimit).toBe('Maximum results (default 50, max 200).');
    expect(theirLimit).toMatch(/no per-call cost/);
    expect(prop(claude.get('find_opportunities'), 'uei')).toMatch(/company_registered_psc/);
    expect(prop(mine.find((t) => t.name === 'find_opportunities'), 'uei')).not.toMatch(/company_registered_psc/);
  });
});

describe('/chatgpt/mcp — tools/call', () => {
  it('an unknown / non-allowlisted tool is rejected and NEVER dispatched or billed', async () => {
    // includes the three tools dropped from the final 15 — public on Claude, unknown here
    for (const name of ['search_contractors', 'search_federal_events', 'get_award_detail', 'get_balance', 'draft_proposal', 'add_contacts_to_crm', 'totally_unknown']) {
      const body = await rpcResult(await POST(callTool(chatgptToken(), name)));
      const result = body.result as { isError?: boolean } | undefined;
      // SDK answers unknown tools either as a JSON-RPC error or an isError tool result.
      expect(Boolean(body.error) || result?.isError === true).toBe(true);
    }
    expect(runMeteredTool).not.toHaveBeenCalled();
  });

  it('success: one projection on content + structuredContent, no footer, no credits, no recharge, no grant', async () => {
    runMeteredTool.mockResolvedValue({
      ok: true,
      result: {
        query_summary: { query: 'cyber', interpreted_as: { open_now: 'Canonical discovery v2' } },
        horizons: {},
        _next: [{ prompt: 'Watch?', tool: 'schedule_market_search', credits: 0 }],
        _meta: { grounded: true, degraded: false, composition: 'opportunity_map_horizons_v1', discovery: { plan_version: 2 } },
      },
      creditsCharged: 10,
      balance: 3,
      needsRecharge: true, // low balance: the Claude edge would fire auto-recharge here
    });
    const body = await rpcResult(await POST(callTool(chatgptToken(), 'find_opportunities', { query: 'cyber' })));
    const result = body.result as { content: { text: string }[]; structuredContent: Record<string, unknown> };
    expect(result.content).toHaveLength(1); // no credit footer block
    const fromText = JSON.parse(result.content[0].text);
    expect(fromText).toEqual(result.structuredContent);
    expect(result.structuredContent._meta).toEqual({ grounded: true, degraded: false });
    expect((result.structuredContent.query_summary as Record<string, unknown>).interpreted_as).toBeUndefined();
    expect(result.structuredContent._next).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/credits|getmindy\.ai\/mcp|Top up/i);

    expect(runMeteredTool).toHaveBeenCalledWith('find_opportunities', { query: 'cyber' }, {
      userEmail: 'buyer@example.com', apiKeyId: null, channel: 'chatgpt',
    });
    expect(maybeAutoRecharge).not.toHaveBeenCalled();
    expect(grantSignupCreditsIfFirst).not.toHaveBeenCalled();
  });

  it('insufficient credits: neutral, non-error, no link/price/continue_url, nothing granted', async () => {
    runMeteredTool.mockResolvedValue({
      ok: false,
      creditsCharged: 0,
      balance: 45,
      error: {
        code: 'insufficient_credits',
        message: 'This request needs 50 credits and the account has 45. Nothing was charged. Account credits are managed outside this chat.',
        commercial: { error_code: 'INSUFFICIENT_CREDITS', required_credits: 50, available_credits: 45, credits_needed: 5, retryable: false, continuation_available: false, continue_url: null, tool_name: 'capability_market_match', message: 'x' },
      },
    });
    const body = await rpcResult(await POST(callTool(chatgptToken(), 'capability_market_match', { description: 'drones' })));
    const result = body.result as { isError?: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> };
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe(
      'This request needs 50 credits and the account has 45. Nothing was charged. Account credits are managed outside this chat.',
    );
    expect(result.structuredContent).not.toHaveProperty('continue_url');
    expect(JSON.stringify(result)).not.toMatch(/\$|price|buy|purchase|top up|upgrade|subscribe|checkout|stripe|getmindy\.ai\/mcp|continue/i);
    expect(grantSignupCreditsIfFirst).not.toHaveBeenCalled();
    expect(maybeAutoRecharge).not.toHaveBeenCalled();
  });

  it('pool insufficient: neutral, no "ask your owner" sales framing', async () => {
    runMeteredTool.mockResolvedValue({
      ok: false, creditsCharged: 0, balance: 3,
      error: { code: 'team_pool_insufficient_credits', message: "Your team's shared credits are too low… ask your team owner about adding credits." },
    });
    const body = await rpcResult(await POST(callTool(chatgptToken(), 'search_grants', { keyword: 'x' })));
    const text = JSON.stringify(body.result);
    expect(text).toMatch(/needs 5 credits and the team's shared credit pool has 3/);
    expect(text).not.toMatch(/owner|adding credits/i);
  });
});
