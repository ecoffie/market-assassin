import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeDb } from './fake-postgrest.test-helper';

/**
 * Layer B (rolling proprietary-tool caps) must count MCP usage only. Ask Mindy rows
 * (channel 'app_chat') share mcp_call_log but must never consume an MCP allowance; legacy
 * NULL-channel rows and ChatGPT rows must keep counting exactly as before.
 */
let db: ReturnType<typeof fakeDb>;
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => db }));
vi.mock('./payer', () => ({ resolvePayer: async () => ({ kind: 'personal' }) }));

import { evaluateExtractionGuard, PROPRIETARY_CAP_DAY } from './extraction-guard';

const USER = 'payer@example.com';
const PROPRIETARY = ['get_sblo_contact', 'lookup_federal_osbp'];
const now = new Date().toISOString();
const call = (channel: string | null, tool = 'get_sblo_contact', status = 'success') => ({
  user_email: USER, tool_name: tool, status, channel, created_at: now,
});
const paidLedger = [{ user_email: USER, delta: 500, reason: 'stripe_topup' }];

function seed(callRows: Array<Record<string, unknown>>) {
  db = fakeDb({ mcp_credit_ledger: paidLedger, mcp_call_log: callRows });
}

beforeEach(() => { process.env.MCP_CAP_PAID_ACCOUNTS = 'true'; vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { delete process.env.MCP_CAP_PAID_ACCOUNTS; });

describe('extraction guard counts MCP usage only', () => {
  it('cap boundary with legacy NULL-channel rows: cap-1 allowed, cap throttled (unchanged behavior)', async () => {
    seed(Array.from({ length: PROPRIETARY_CAP_DAY - 1 }, () => call(null)));
    expect(await evaluateExtractionGuard(USER, PROPRIETARY)).toBeNull();
    seed(Array.from({ length: PROPRIETARY_CAP_DAY }, () => call(null)));
    expect((await evaluateExtractionGuard(USER, PROPRIETARY))?.status).toBe('throttled');
  });

  it('ChatGPT MCP calls still count toward the cap', async () => {
    seed([...Array.from({ length: PROPRIETARY_CAP_DAY - 1 }, () => call(null)), call('chatgpt')]);
    expect((await evaluateExtractionGuard(USER, PROPRIETARY))?.status).toBe('throttled');
  });

  it('Ask Mindy (app_chat) calls never consume the MCP allowance', async () => {
    seed([
      ...Array.from({ length: PROPRIETARY_CAP_DAY - 1 }, () => call(null)),
      ...Array.from({ length: 25 }, () => call('app_chat')),
    ]);
    expect(await evaluateExtractionGuard(USER, PROPRIETARY)).toBeNull();
  });

  it('an account with only Ask Mindy activity is never throttled', async () => {
    seed(Array.from({ length: PROPRIETARY_CAP_DAY * 3 }, () => call('app_chat')));
    expect(await evaluateExtractionGuard(USER, PROPRIETARY)).toBeNull();
  });

  it('applies the filter to the call-log count query', async () => {
    seed([call(null)]);
    await evaluateExtractionGuard(USER, PROPRIETARY);
    expect(db.orCalls.filter((c) => c.table === 'mcp_call_log').map((c) => c.expr)).toContain('channel.is.null,channel.neq.app_chat');
  });
});
