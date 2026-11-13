import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logToolError, sendOpsAlert } = vi.hoisted(() => ({
  logToolError: vi.fn(async () => null),
  sendOpsAlert: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/tool-errors', async (orig) => ({ ...(await orig<typeof import('@/lib/tool-errors')>()), logToolError }));
vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert }));

import { recordProviderEvent, __resetProviderEventCooldown } from './provider-events';

beforeEach(() => { logToolError.mockClear(); sendOpsAlert.mockClear(); __resetProviderEventCooldown(); });

describe('provider events', () => {
  it('a configuration block (planner_unavailable) writes one row per cooldown, not one per turn', async () => {
    for (let i = 0; i < 25; i++) {
      await recordProviderEvent({ kind: 'planner_unavailable', provider: 'anthropic', model: 'claude-sonnet-5', detail: 'not on approved list' });
    }
    expect(logToolError).toHaveBeenCalledTimes(1);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('real provider failures are always recorded (alerts stay throttled)', async () => {
    for (let i = 0; i < 3; i++) {
      await recordProviderEvent({ kind: 'planner_failure', provider: 'openai', model: 'gpt-4o', status: 500, detail: 'upstream error' });
    }
    expect(logToolError).toHaveBeenCalledTimes(3);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('different providers are tracked separately', async () => {
    await recordProviderEvent({ kind: 'planner_unavailable', provider: 'anthropic', model: 'a', detail: 'x' });
    await recordProviderEvent({ kind: 'planner_unavailable', provider: 'openai', model: 'b', detail: 'x' });
    expect(logToolError).toHaveBeenCalledTimes(2);
  });

  it('never throws even when logging and alerting fail', async () => {
    logToolError.mockRejectedValueOnce(new Error('db down'));
    sendOpsAlert.mockRejectedValueOnce(new Error('slack down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordProviderEvent({ kind: 'answer_failure', provider: 'openai', model: 'gpt-4o', detail: 'x' })).resolves.toBeUndefined();
  });
});
