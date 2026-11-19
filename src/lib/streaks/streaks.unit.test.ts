/** Login streaks (owner 2026-11-19): +25 every 7 days in a row, +100 every 30, once per person per day. */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/mcp/credits', () => ({ applyCreditOnce: vi.fn() }));
const { rewardFor, nextReward, easternDay } = await import('./rules');
const { checkInStreak, streakRewardKey, STREAK_REWARD_REASON } = await import('./checkin');

describe('streak rules', () => {
  it('pays 25 on every 7th day and 100 on every 30th (100 wins when both)', () => {
    expect([1, 6, 7, 8, 14, 21, 28, 29, 30, 35, 60, 210].map(rewardFor)).toEqual([0, 0, 25, 0, 25, 25, 25, 0, 100, 25, 100, 100]);
    expect(rewardFor(0)).toBe(0);
    expect(rewardFor(-3)).toBe(0);
  });

  it('says how far the next reward is', () => {
    expect(nextReward(0)).toEqual({ inDays: 7, credits: 25 });
    expect(nextReward(6)).toEqual({ inDays: 1, credits: 25 });
    expect(nextReward(28)).toEqual({ inDays: 2, credits: 100 });
  });

  it('the day is the New York calendar day', () => {
    expect(easternDay(new Date('2026-11-20T03:00:00Z'))).toBe('2026-11-19'); // 10 PM ET
    expect(easternDay(new Date('2026-11-20T06:00:00Z'))).toBe('2026-11-20');
  });
});

describe('checkInStreak', () => {
  const now = new Date('2026-11-19T15:00:00Z');
  it('pays the milestone once with a per-day key', async () => {
    const apply = vi.fn(async () => ({ applied: true, newBalance: 125 }));
    const r = await checkInStreak('A@x.com', { now, isPro: async () => true, apply: apply as never, rpc: async () => ({ current_streak: 7, longest_streak: 7, counted_today: true }) });
    expect(r).toMatchObject({ status: 'ok', streak: 7, rewardedToday: 25, next: { inDays: 7, credits: 25 } });
    expect(apply).toHaveBeenCalledWith(streakRewardKey('a@x.com', '2026-11-19'), 'a@x.com', 25, STREAK_REWARD_REASON);
    expect(streakRewardKey(' A@X.com ', '2026-11-19')).toBe('streak:a@x.com:2026-11-19');
  });

  it('no reward on an ordinary day', async () => {
    const apply = vi.fn();
    const r = await checkInStreak('a@x.com', { now, isPro: async () => true, apply: apply as never, rpc: async () => ({ current_streak: 3, longest_streak: 9, counted_today: true }) });
    expect(r).toMatchObject({ status: 'ok', streak: 3, longest: 9, rewardedToday: 0 });
    expect(apply).not.toHaveBeenCalled();
  });

  it('free members keep a streak but are never paid credits', async () => {
    const apply = vi.fn();
    const r = await checkInStreak('a@x.com', { now, isPro: async () => false, apply: apply as never, rpc: async () => ({ current_streak: 7, longest_streak: 7, counted_today: true }) });
    expect(r).toMatchObject({ status: 'ok', streak: 7, rewardedToday: 0, creditsEligible: false });
    expect(apply).not.toHaveBeenCalled();
  });

  it('a failed Pro check pays nothing', async () => {
    const apply = vi.fn();
    const r = await checkInStreak('a@x.com', { now, isPro: async () => { throw new Error('down'); }, apply: apply as never, rpc: async () => ({ current_streak: 30, longest_streak: 30, counted_today: true }) });
    expect(r).toMatchObject({ rewardedToday: 0, creditsEligible: false });
    expect(apply).not.toHaveBeenCalled();
  });

  it('a missing table or failed call is unavailable, never a 0-day streak', async () => {
    const r = await checkInStreak('a@x.com', { now, rpc: async () => { throw new Error('relation does not exist'); } });
    expect(r).toEqual({ status: 'unavailable' });
  });

  it('a failed reward write does not break the check-in', async () => {
    const apply = vi.fn(async () => { throw new Error('db down'); });
    const r = await checkInStreak('a@x.com', { now, isPro: async () => true, apply: apply as never, rpc: async () => ({ current_streak: 30, longest_streak: 30, counted_today: true }) });
    expect(r).toMatchObject({ status: 'ok', streak: 30, rewardedToday: 0 });
  });
});

describe('migration', () => {
  const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20261119_login_streaks.sql'), 'utf8');
  it('is additive and idempotent, and only the service role can call the function', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.user_login_streaks');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.mindy_streak_checkin');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.mindy_streak_checkin(TEXT, DATE) TO service_role');
    expect(sql).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\b/);
  });
});
