/**
 * Record today's visit, and pay the streak reward when today hits a milestone.
 *
 * The reward goes through applyCreditOnce with key streak:<email>:<day>, so it is paid at most
 * once per person per day (a retry, a second tab or a second device is a no-op). Ledger reason
 * `streak_reward` is promotional (grant-reasons.ts): it never resets the ChatGPT attribution window.
 */
import { createClient } from '@supabase/supabase-js';
import { applyCreditOnce } from '@/lib/mcp/credits';
import { easternDay, nextReward, rewardFor } from './rules';

export const STREAK_REWARD_REASON = 'streak_reward';

export function streakRewardKey(email: string, day: string): string {
  return `streak:${email.trim().toLowerCase()}:${day}`;
}

export type StreakResult =
  | { status: 'ok'; streak: number; longest: number; countedToday: boolean; rewardedToday: number; next: { inDays: number; credits: number } }
  | { status: 'unavailable' };

interface Deps {
  rpc?: (email: string, day: string) => Promise<{ current_streak: number; longest_streak: number; counted_today: boolean } | null>;
  apply?: typeof applyCreditOnce;
  now?: Date;
}

async function defaultRpc(email: string, day: string) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await sb.rpc('mindy_streak_checkin', { p_email: email, p_day: day });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
}

export async function checkInStreak(rawEmail: string, deps: Deps = {}): Promise<StreakResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes('@')) return { status: 'unavailable' };
  const day = easternDay(deps.now);
  let row;
  try {
    row = await (deps.rpc ?? defaultRpc)(email, day);
  } catch (e) {
    console.error('[streak] check-in failed:', (e as Error).message);
    return { status: 'unavailable' };
  }
  if (!row) return { status: 'unavailable' };
  const streak = Number(row.current_streak);
  const longest = Number(row.longest_streak);

  // Pay on the day the milestone is reached. Re-checking the same day re-applies the same key,
  // which is a no-op — so a reward missed by a failed write is picked up on the next visit that day.
  let rewardedToday = 0;
  const reward = rewardFor(streak);
  if (reward > 0) {
    try {
      // applied=false means today's reward was already paid (same key): still today's reward.
      await (deps.apply ?? applyCreditOnce)(streakRewardKey(email, day), email, reward, STREAK_REWARD_REASON);
      rewardedToday = reward;
    } catch (e) {
      console.error('[streak] reward grant failed:', (e as Error).message);
    }
  }
  return { status: 'ok', streak, longest, countedToday: !!row.counted_today, rewardedToday, next: nextReward(streak) };
}
