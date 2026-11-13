import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakeDb } from '@/lib/mcp/fake-postgrest.test-helper';

/** The customer-facing MCP Usage/Activity panels show MCP calls only. */
let db: ReturnType<typeof fakeDb>;
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => db }));
vi.mock('@/lib/mcp/session-identity', () => ({ resolveMcpEmail: async () => 'u@example.com' }));
vi.mock('@/lib/mcp/credits', () => ({ getBalance: async () => 120 }));
vi.mock('@/lib/mcp/public-catalog', () => ({ listPublicMcpTools: () => [] }));

import { GET } from './route';

const at = new Date().toISOString();
const row = (channel: string | null, credits: number, tool = 'search_contractors', status = 'success') => ({
  user_email: 'u@example.com', tool_name: tool, status, credits_charged: credits, created_at: at, channel,
});

describe('/api/mcp/account usage totals', () => {
  it('counts legacy NULL-channel and ChatGPT calls, excludes Ask Mindy calls', async () => {
    db = fakeDb({
      mcp_call_log: [
        row(null, 10),                       // Claude/general MCP
        row(null, 5, 'lookup_sam_entity'),   // legacy
        row('chatgpt', 10),                  // ChatGPT MCP
        row('app_chat', 0),                  // Ask Mindy
        row('app_chat', 0, 'add_contacts_to_crm', 'blocked_policy'),
      ],
    });
    const res = await GET(new NextRequest('http://localhost/api/mcp/account'));
    const body = await res.json();
    expect(body.usage.totalCalls).toBe(3);
    expect(body.usage.totalCredits).toBe(25);
    expect(body.recentCalls.map((r: { tool_name: string }) => r.tool_name)).not.toContain('add_contacts_to_crm');
  });

  it('is identical to before for an account with no Ask Mindy activity', async () => {
    db = fakeDb({ mcp_call_log: [row(null, 10), row('chatgpt', 5)] });
    const body = await (await GET(new NextRequest('http://localhost/api/mcp/account'))).json();
    expect(body.usage).toMatchObject({ totalCalls: 2, totalCredits: 15 });
  });
});
