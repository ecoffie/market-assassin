/**
 * Channel plumbing for ChatGPT-attributed auto-recharge suppression:
 * metered → payer → credits → rpc('mcp_debit_credits', { …, p_channel }).
 * p_channel is sent ONLY for the ChatGPT channel; the Claude path sends the original
 * 5 args (so it works before AND after the migration), and pool debits never carry it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({ rpc: (...a: unknown[]) => rpc(...a), from: () => ({}) }),
  getReadClient: () => ({ from: () => ({}) }),
}));

const { debitCredits } = await import('./credits');
const { debitResolvedPayer } = await import('./payer');

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [{ ok: true, new_balance: 5 }], error: null });
});

const FIVE_ARGS = { p_user: 'u@x.com', p_amount: 3, p_reason: 'tool_call', p_tool: 't', p_api_key_id: null };

describe('debitCredits', () => {
  it('Claude/default: exactly the original 5 named args (no p_channel key at all)', async () => {
    await debitCredits('U@x.com', 3, { reason: 'tool_call', toolName: 't' });
    expect(rpc).toHaveBeenCalledWith('mcp_debit_credits', FIVE_ARGS);
    expect(Object.keys(rpc.mock.calls[0][1])).not.toContain('p_channel');
  });

  it('chatgpt: adds p_channel=chatgpt', async () => {
    await debitCredits('u@x.com', 3, { reason: 'tool_call', toolName: 't', channel: 'chatgpt' });
    expect(rpc).toHaveBeenCalledWith('mcp_debit_credits', { ...FIVE_ARGS, p_channel: 'chatgpt' });
  });
});

describe('debitResolvedPayer', () => {
  it('personal + chatgpt → p_channel reaches mcp_debit_credits', async () => {
    await debitResolvedPayer('u@x.com', 3, { reason: 'tool_call', toolName: 't', channel: 'chatgpt' }, { kind: 'personal' });
    expect(rpc).toHaveBeenCalledWith('mcp_debit_credits', { ...FIVE_ARGS, p_channel: 'chatgpt' });
  });

  it('pool + chatgpt → mcp_debit_pool with NO channel (pool debits never move S)', async () => {
    await debitResolvedPayer('u@x.com', 3, { reason: 'tool_call', toolName: 't', channel: 'chatgpt' },
      { kind: 'pool', poolId: 'p1', orgId: 'o1', orgName: 'Acme' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('mcp_debit_pool');
    expect(Object.keys(rpc.mock.calls[0][1])).not.toContain('p_channel');
  });
});
