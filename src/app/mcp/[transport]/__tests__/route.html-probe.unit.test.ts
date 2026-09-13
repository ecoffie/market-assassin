import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mcp/api-keys', () => ({
  verifyApiKey: vi.fn(async () => null),
}));
vi.mock('@/lib/mcp/metered', () => ({
  runMeteredTool: vi.fn(async () => ({ ok: true, result: {}, creditsCharged: 0, balance: 0 })),
}));

const { GET, POST } = await import('../route');

describe('mcp.getmindy.ai/mcp browser probe', () => {
  it('returns a human HTML page for Accept: text/html with no Bearer', async () => {
    const req = new Request('https://mcp.getmindy.ai/mcp', {
      method: 'GET',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    const res = await GET(req, { params: Promise.resolve({ transport: 'mcp' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') || '').toContain('text/html');
    const body = await res.text();
    expect(body).toContain('https://getmindy.ai/mcp');
    expect(body).toContain('API endpoint');
    expect(body.trim().startsWith('{')).toBe(false);
  });

  it('does not change POST tool dispatch for MCP clients (still 401 without Bearer)', async () => {
    const req = new Request('https://mcp.getmindy.ai/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
