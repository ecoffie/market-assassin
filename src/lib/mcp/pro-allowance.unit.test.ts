/**
 * Team supersedes Pro for the monthly MCP allowance: a Pro allowance is granted only
 * when the recipient's calls bill personally. Anyone in a team billing context would
 * receive credits they can never spend.
 */
import { describe, it, expect, vi } from 'vitest';

const payer = vi.hoisted(() => ({ next: { kind: 'personal' } as Record<string, unknown> }));
vi.mock('./payer', () => ({ resolvePayer: async () => payer.next }));

import { proAllowanceDecision } from './pro-allowance';

describe('proAllowanceDecision', () => {
  it('grants when calls bill personally', async () => {
    payer.next = { kind: 'personal' };
    expect(await proAllowanceDecision('p@x.com')).toEqual({ grant: true });
  });

  it('withholds when calls bill a team pool (the migrated Pro+Team customer)', async () => {
    payer.next = { kind: 'pool', poolId: 'p1', orgId: 'o1', orgName: 'T' };
    expect(await proAllowanceDecision('m@x.com')).toMatchObject({ grant: false, reason: 'team_pool_supersedes_pro', orgId: 'o1' });
  });

  it.each(['pool_unavailable', 'selection_required'])('withholds in a team context that never bills personally (%s)', async (kind) => {
    payer.next = { kind };
    expect(await proAllowanceDecision('m@x.com')).toMatchObject({ grant: false, reason: 'team_pool_supersedes_pro' });
  });

  it('defers (grants nothing this run) when the billing context is unknown — never guesses', async () => {
    payer.next = { kind: 'unavailable', reason: 'subscriptions_query_failed' };
    expect(await proAllowanceDecision('m@x.com')).toMatchObject({ grant: false, reason: 'payer_unresolved', detail: 'subscriptions_query_failed' });
  });
});
