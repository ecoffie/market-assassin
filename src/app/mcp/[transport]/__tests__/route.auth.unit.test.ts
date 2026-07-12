/**
 * Auth-boundary tests for the hosted MCP HTTP edge (mcp.getmindy.ai).
 *
 * Proves the withMcpAuth wiring WITHOUT a live server or Supabase env:
 *   - no Authorization header            → 401 (edge is required:true)
 *   - Bearer key that verifyApiKey denies → 401
 *   - Bearer key that verifyApiKey allows → passes auth (not 401), reaches transport
 *
 * verifyApiKey and the tool logic are mocked, so this exercises only transport +
 * auth — the part this route file actually owns.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth resolver: 'good-key' is a valid Mindy key, everything else is not.
vi.mock('@/lib/mcp/api-keys', () => ({
  verifyApiKey: vi.fn(async (raw?: string | null) =>
    raw === 'mcp_live_good'
      ? { keyId: 'key_1', userEmail: 'buyer@example.com', scopes: [] }
      : null,
  ),
}));

// Mock the tool so the happy path never touches Supabase/RAG.
vi.mock('@/mcp/tools/winning-playbook', () => ({
  getWinningPlaybook: vi.fn(async () => ({
    topic: 't',
    guidance: [],
    _meta: { grounded: false },
  })),
}));

// Import AFTER mocks are registered.
const { POST } = await import('../route');

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'vitest', version: '1.0.0' },
  },
});

function mcpRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest('https://mcp.getmindy.ai/mcp/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: INITIALIZE,
  });
}

describe('MCP HTTP edge — auth boundary', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('rejects a request with no Authorization header (401)', async () => {
    const res = await POST(mcpRequest({}));
    expect(res.status).toBe(401);
  });

  it('rejects a Bearer key that verifyApiKey does not recognize (401)', async () => {
    const res = await POST(mcpRequest({ authorization: 'Bearer mcp_live_bogus' }));
    expect(res.status).toBe(401);
  });

  it('lets a valid Bearer key through auth (not 401)', async () => {
    const res = await POST(mcpRequest({ authorization: 'Bearer mcp_live_good' }));
    // Past the auth gate: the transport handles it (200/202/session response),
    // never 401. That is the contract this route owns.
    expect(res.status).not.toBe(401);
  });
});
