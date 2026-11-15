/**
 * Opportunity Hunter search: search_completed is attributed only to a VERIFIED session (2026-11-14). It used to
 * record the body-supplied userEmail, so anyone could attribute searches to any account.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const logEngagement = vi.fn<(e: unknown) => Promise<{ success: boolean }>>(async () => ({ success: true }));
const resolveMcpEmail = vi.fn<(r: unknown) => Promise<string | null>>(async () => null);
vi.mock('@/lib/engagement', () => ({
  logEngagement: (e: unknown) => logEngagement(e),
  EventTypes: { TOOL_USE: 'tool_use' },
}));
vi.mock('@/lib/mcp/session-identity', () => ({ resolveMcpEmail: (r: unknown) => resolveMcpEmail(r) }));

import { POST } from './route';

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('https://getmindy.ai/api/government-contracts/search', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

describe('POST /api/government-contracts/search attribution', () => {
  beforeEach(() => {
    logEngagement.mockClear(); resolveMcpEmail.mockReset(); resolveMcpEmail.mockResolvedValue(null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // USASpending: one award (no network). SAM office lookups get the same stub and find nothing useful.
    const award = { 'Award ID': 'A1', 'Recipient Name': 'X', 'Award Amount': 1000, 'Awarding Agency': 'Department of Defense',
      'Awarding Sub Agency': 'Department of the Army', 'Awarding Agency Code': '097', 'Awarding Sub Agency Code': '2100',
      'Awarding Office': 'W912PL', 'NAICS Code': '541512', 'Set-Aside Type': null, 'Number of Offers Received': 2 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [award], page_metadata: { hasNext: false } }), { status: 200 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('a body-supplied userEmail without a session records nothing, and the search is still served', async () => {
    const res = await POST(req({ naicsCode: '541512', userEmail: 'victim@acme.io' }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(logEngagement).not.toHaveBeenCalled();
  });

  it('a verified session records search_completed under the SESSION email', async () => {
    resolveMcpEmail.mockResolvedValue('owner@acme.io');
    const res = await POST(req({ naicsCode: '541512', userEmail: 'victim@acme.io' }, { 'x-mi-auth-token': 'tok' }));
    expect(res.status).toBe(200);
    expect(logEngagement).toHaveBeenCalledTimes(1);
    const e = logEngagement.mock.calls[0][0] as { userEmail: string; metadata: { action: string } };
    expect(e.userEmail).toBe('owner@acme.io');
    expect(e.metadata.action).toBe('search_completed');
  });
});
