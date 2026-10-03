/**
 * Pursuit Brief is RETIRED (2026-10-03). A retired feature must never block cohort
 * rotation: before this, isMemberComplete required pursuitBriefsSent >= 2 (min 1), so
 * re-enabling `rollout` mode would have produced a cohort that could never complete.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    del: vi.fn(async (k: string) => { store.delete(k); }),
    mget: vi.fn(async (...ks: string[]) => ks.map((k) => store.get(k) ?? null)),
  },
}));

beforeEach(() => store.clear());

describe('rollout without Pursuit Brief', () => {
  it('a member with the daily + weekly program done is complete, with zero pursuit briefs', async () => {
    const { isMemberComplete, getBriefingRolloutConfig } = await import('./rollout');
    // A config persisted before retirement still carries the old requirement.
    store.set('briefings:rollout:config', { mode: 'rollout', requiredDailyBriefs: 2, requiredWeeklyDeepDives: 2, requiredPursuitBriefs: 2 });
    const config = await getBriefingRolloutConfig();
    expect(config).not.toHaveProperty('requiredPursuitBriefs');
    // A progress row written before retirement still carries pursuitBriefsSent: 0.
    const legacyRow = { dailyBriefsSent: 2, weeklyDeepDivesSent: 2, pursuitBriefsSent: 0 } as never;
    expect(isMemberComplete(legacyRow, config)).toBe(true);
    expect(isMemberComplete({ dailyBriefsSent: 2, weeklyDeepDivesSent: 1 }, config)).toBe(false);
  });

  it('saving the config never re-persists requiredPursuitBriefs', async () => {
    const { saveBriefingRolloutConfig } = await import('./rollout');
    store.set('briefings:rollout:config', { mode: 'beta_all', requiredPursuitBriefs: 2 });
    const saved = await saveBriefingRolloutConfig({ requiredPursuitBriefs: 5 } as never);
    expect(saved).not.toHaveProperty('requiredPursuitBriefs');
    expect(store.get('briefings:rollout:config')).not.toHaveProperty('requiredPursuitBriefs');
  });
});
