import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * logCall must never lose the CALL because the TELEMETRY columns failed.
 * supabase-js returns `{ error }` (it does not throw), so the old try/catch-only version
 * dropped rejected rows silently.
 */
const insert = vi.fn();
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({ from: () => ({ insert }) }),
}));
vi.mock('./credit-emails', () => ({ sendCreditWelcomeEmail: vi.fn() }));

import { logCall } from './credits';

const base = { userEmail: 'U@X.com', toolName: 't', status: 'success' as const, creditsCharged: 5, latencyMs: 12, apiKeyId: null };
const outcome = { outcome: 'grounded' as const, grounded: true, degraded: false, billingOutcome: 'billable_success' as const, errorCode: null };

beforeEach(() => {
  insert.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('logCall', () => {
  it('writes the outcome columns alongside the legacy ones', async () => {
    insert.mockResolvedValue({ error: null });
    await logCall({ ...base, outcome });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      user_email: 'u@x.com', tool_name: 't', status: 'success', credits_charged: 5,
      outcome: 'grounded', grounded: true, degraded: false, billing_outcome: 'billable_success', error_code: null,
    });
  });

  it('retries in the legacy shape when the outcome insert is rejected (migration not applied)', async () => {
    insert
      .mockResolvedValueOnce({ error: { message: 'column "outcome" of relation "mcp_call_log" does not exist' } })
      .mockResolvedValueOnce({ error: null });
    await logCall({ ...base, outcome });
    expect(insert).toHaveBeenCalledTimes(2);
    const retry = insert.mock.calls[1][0];
    expect(retry).toMatchObject({ user_email: 'u@x.com', status: 'success', credits_charged: 5 });
    expect(retry).not.toHaveProperty('outcome');
  });

  it('surfaces a rejected insert instead of swallowing it', async () => {
    insert.mockResolvedValue({ error: { message: 'boom' } });
    await logCall({ ...base });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('rejected'), 'boom');
    expect(insert).toHaveBeenCalledTimes(1); // no outcome → nothing different to retry
  });

  it('writes channel=chatgpt only for a ChatGPT call; Claude rows carry no channel key (NULL)', async () => {
    insert.mockResolvedValue({ error: null });
    await logCall({ ...base, outcome, channel: 'chatgpt' });
    await logCall({ ...base, outcome });
    expect(insert.mock.calls[0][0]).toMatchObject({ channel: 'chatgpt', outcome: 'grounded' });
    expect(insert.mock.calls[1][0]).not.toHaveProperty('channel');
  });

  it('writes channel even when the call has no outcome (a ChatGPT call is still measurable)', async () => {
    insert.mockResolvedValue({ error: null });
    await logCall({ ...base, channel: 'chatgpt' });
    expect(insert.mock.calls[0][0]).toMatchObject({ user_email: 'u@x.com', channel: 'chatgpt' });
    expect(insert.mock.calls[0][0]).not.toHaveProperty('outcome');
  });

  it('a rejected channel insert retries in the legacy shape (column missing never loses the call)', async () => {
    insert
      .mockResolvedValueOnce({ error: { message: 'column "channel" of relation "mcp_call_log" does not exist' } })
      .mockResolvedValueOnce({ error: null });
    await logCall({ ...base, outcome, channel: 'chatgpt' });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0]).not.toHaveProperty('channel');
    expect(insert.mock.calls[1][0]).not.toHaveProperty('outcome');
  });

  it('never throws', async () => {
    insert.mockRejectedValue(new Error('network'));
    await expect(logCall({ ...base, outcome })).resolves.toBeUndefined();
  });
  it('writes channel=app_chat and the execution trace columns for an Ask Mindy call', async () => {
    insert.mockResolvedValue({ error: null });
    await logCall({
      ...base, creditsCharged: 0, channel: 'app_chat',
      trace: { executionId: 'e1', chatSessionId: 's1', model: 'gpt-4o', provider: 'openai', argsRedacted: { naics: '561320' }, creditPrice: 10, resourceIds: null, errorCategory: null },
    });
    expect(insert.mock.calls[0][0]).toMatchObject({
      channel: 'app_chat', credits_charged: 0, execution_id: 'e1', chat_session_id: 's1', model: 'gpt-4o', provider: 'openai',
      args_redacted: { naics: '561320' }, credit_price: 10,
    });
  });

  it('MCP rows (no trace) carry none of the new trace columns', async () => {
    insert.mockResolvedValue({ error: null });
    await logCall({ ...base, outcome });
    for (const k of ['execution_id', 'chat_session_id', 'model', 'provider', 'args_redacted', 'credit_price', 'resource_ids', 'error_category']) {
      expect(insert.mock.calls[0][0]).not.toHaveProperty(k);
    }
  });

  it('if the trace columns are missing, retries WITH outcome and channel (not the bare legacy shape)', async () => {
    insert
      .mockResolvedValueOnce({ error: { message: 'column "execution_id" of relation "mcp_call_log" does not exist' } })
      .mockResolvedValueOnce({ error: null });
    await logCall({ ...base, outcome, channel: 'app_chat', trace: { executionId: 'e1' } });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0]).not.toHaveProperty('execution_id');
    expect(insert.mock.calls[1][0]).toMatchObject({ user_email: 'u@x.com', tool_name: 't', channel: 'app_chat', outcome: 'grounded' });
  });

  it('never writes an app_chat call without its channel (it would look like a Claude MCP call)', async () => {
    insert.mockResolvedValue({ error: { message: 'boom' } });
    await logCall({ ...base, outcome, channel: 'app_chat', trace: { executionId: 'e1' } });
    for (const call of insert.mock.calls) expect(call[0]).toHaveProperty('channel', 'app_chat');
  });

  it('a Claude MCP call still falls back to the bare legacy shape (unchanged behavior)', async () => {
    insert
      .mockResolvedValueOnce({ error: { message: 'column "outcome" does not exist' } })
      .mockResolvedValueOnce({ error: null });
    await logCall({ ...base, outcome });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0]).not.toHaveProperty('outcome');
    expect(insert.mock.calls[1][0]).not.toHaveProperty('channel');
  });
});
