/**
 * Gamification stats — REAL XP / streaks / ranks / leaderboard computed from the
 * `user_engagement` event log (Decision #012: real data, never invented). The mechanics
 * reward exactly the activation behaviors from Decision #011 — depth of tool use + the
 * value moment + daily return.
 *
 * XP weights + rank thresholds are a tunable GAME-DESIGN config (a mechanic, not a business
 * number). Anonymized codenames (Decision #012 privacy): a stable pseudonym per email, no PII.
 */
import { getReadClient } from '@/lib/supabase/server-clients';

// Tunable game-design weights (not business numbers). Reward tool depth + the value moment.
const XP_WEIGHTS: Record<string, number> = {
  tool_use: 10,
  report_generate: 50, // the value moment (rare, high signal)
  export: 30,
  onboarding_step: 15,
  page_view: 2,
};
const XP_DEFAULT = 5;
const DAY_ACTIVE_BONUS = 25; // per active day — rewards the streak (the retention driver)

export const RANKS = [
  { name: 'Recruit', min: 0 },
  { name: 'Hunter', min: 500 },
  { name: 'Closer', min: 2000 },
  { name: 'Prime', min: 5000 },
] as const;

const xpFor = (type: string | null | undefined): number => XP_WEIGHTS[type || ''] ?? XP_DEFAULT;
const dayKey = (iso: string): string => iso.slice(0, 10);

function levelFor(xp: number) {
  let cur: (typeof RANKS)[number] = RANKS[0];
  for (const r of RANKS) if (xp >= r.min) cur = r;
  const idx = RANKS.findIndex((r) => r.name === cur.name);
  const next = RANKS[idx + 1] ?? null;
  return { name: cur.name, level: idx + 1, nextAt: next?.min ?? null, nextName: next?.name ?? null };
}

// Stable, anonymous codename from an email (no PII). Deterministic — same email → same handle.
const ADJ = ['Stealth', 'Rapid', 'Iron', 'Silent', 'Apex', 'Bold', 'Cobra', 'Granite', 'Titan', 'Vector', 'Onyx', 'Falcon'];
const NOUN = ['Falcon', 'Talon', 'Vanguard', 'Ranger', 'Hawk', 'Sentinel', 'Anvil', 'Raptor', 'Scout', 'Pioneer', 'Forge', 'Trident'];
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function codename(email: string): string {
  const h = hash((email || '').toLowerCase());
  return `${ADJ[h % ADJ.length]} ${NOUN[(h >>> 8) % NOUN.length]}`;
}

function computeStreak(daysSet: Set<string>): number {
  if (!daysSet.size) return 0;
  const d = new Date();
  if (!daysSet.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1); // 1-day grace
  let streak = 0;
  while (daysSet.has(d.toISOString().slice(0, 10))) { streak++; d.setUTCDate(d.getUTCDate() - 1); }
  return streak;
}

export interface GameStats {
  xp: number; weekXp: number; streak: number; level: number;
  rankName: string; nextAt: number | null; nextName: string | null; codename: string;
  toolUseWeek: number; activeDaysWeek: number;
}

/** One user's real game stats from their engagement history. */
export async function getGameStats(email: string): Promise<GameStats> {
  const e = (email || '').toLowerCase().trim();
  const { data, error } = await getReadClient()
    .from('user_engagement')
    .select('event_type,created_at')
    .eq('user_email', e)
    .order('created_at', { ascending: true })
    .limit(5000);
  if (error) throw new Error(`getGameStats: ${error.message}`);
  const ev = data || [];
  const weekAgo = Date.now() - 7 * 864e5;
  const days = new Set<string>();
  const weekDays = new Set<string>();
  let xp = 0, weekXp = 0, toolUseWeek = 0;
  for (const r of ev) {
    const x = xpFor(r.event_type);
    xp += x; days.add(dayKey(r.created_at));
    if (new Date(r.created_at).getTime() >= weekAgo) {
      weekXp += x; weekDays.add(dayKey(r.created_at));
      if (r.event_type === 'tool_use') toolUseWeek++;
    }
  }
  xp += days.size * DAY_ACTIVE_BONUS;
  weekXp += weekDays.size * DAY_ACTIVE_BONUS;
  const lv = levelFor(xp);
  return {
    xp, weekXp, streak: computeStreak(days), level: lv.level, rankName: lv.name,
    nextAt: lv.nextAt, nextName: lv.nextName, codename: codename(e),
    toolUseWeek, activeDaysWeek: weekDays.size,
  };
}

export interface LeaderRow { handle: string; weekXp: number; rank: number; isYou: boolean; }

/** The weekly leaderboard (real, by last-7-day XP), anonymized. Returns top N + the user's own rank. */
export async function getLeaderboard(email: string, limit = 10): Promise<{ rows: LeaderRow[]; you: LeaderRow | null; total: number }> {
  const e = (email || '').toLowerCase().trim();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const byUser: Record<string, number> = {};
  let from = 0;
  for (;;) {
    const { data, error } = await getReadClient()
      .from('user_engagement').select('user_email,event_type').gte('created_at', weekAgo).range(from, from + 999);
    if (error) throw new Error(`getLeaderboard: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) { const u = (r.user_email || '').toLowerCase(); if (!u) continue; byUser[u] = (byUser[u] || 0) + xpFor(r.event_type); }
    from += 1000; if (data.length < 1000) break;
  }
  const sorted = Object.entries(byUser).map(([em, xp]) => ({ em, xp })).sort((a, b) => b.xp - a.xp);
  const rows: LeaderRow[] = sorted.slice(0, limit).map((r, i) => ({ handle: codename(r.em), weekXp: r.xp, rank: i + 1, isYou: r.em === e }));
  const youIdx = sorted.findIndex((r) => r.em === e);
  const you: LeaderRow | null = youIdx >= 0
    ? { handle: codename(e), weekXp: sorted[youIdx].xp, rank: youIdx + 1, isYou: true }
    : null;
  return { rows, you, total: sorted.length };
}
