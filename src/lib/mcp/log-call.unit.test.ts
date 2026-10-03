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
});
