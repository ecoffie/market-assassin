import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { fakeDb } from '@/lib/mcp/fake-postgrest.test-helper';

/** MCP cohort analytics count MCP users only; historical NULL-channel rows still count. */
let db: ReturnType<typeof fakeDb>;
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }));

import { GET } from './route';

const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const call = (email: string, channel: string | null, daysAgo: number) => ({
  user_email: email, created_at: day(daysAgo), tool_name: 'search_contractors', status: 'success', credits_charged: 10, channel,
});

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'pw';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
});

describe('/api/admin/mcp-cohorts', () => {
  it('chat-only users are not MCP accounts; legacy and ChatGPT users are', async () => {
    db = fakeDb({
      mcp_call_log: [
        call('legacy@example.com', null, 40),   // historical row, no channel
        call('claude@example.com', null, 3),
        call('gpt@example.com', 'chatgpt', 2),
        call('chatonly@example.com', 'app_chat', 1),
        call('claude@example.com', 'app_chat', 1), // also chats: still one MCP account
      ],
    });
    const res = await GET(new NextRequest('http://localhost/api/admin/mcp-cohorts?password=pw'));
    const body = await res.json();
    expect(body.totals.external_accounts_all_time).toBe(3);
  });

  it('without any Ask Mindy rows the totals are unchanged', async () => {
    db = fakeDb({ mcp_call_log: [call('a@example.com', null, 5), call('b@example.com', 'chatgpt', 4)] });
    const body = await (await GET(new NextRequest('http://localhost/api/admin/mcp-cohorts?password=pw'))).json();
    expect(body.totals.external_accounts_all_time).toBe(2);
  });
});
