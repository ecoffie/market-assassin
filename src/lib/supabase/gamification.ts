import { getPlannerSupabase as getSupabase } from './planner-client';

// Badge definitions
export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedAt?: string;
}

export interface GamificationData {
  currentStreak: number;
  longestStreak: number;
  lastCompletionDate: string | null;
  badges: Badge[];
}

export const BADGE_DEFINITIONS: Omit<Badge, 'earnedAt'>[] = [
  { id: 'first_step', name: 'First Step', description: 'Completed your first task', icon: '🎯' },
  { id: 'momentum', name: 'Momentum Builder', description: 'Completed 5 tasks', icon: '🔥' },
  { id: 'dedicated', name: 'Dedicated', description: 'Completed 10 tasks', icon: '💪' },
  { id: 'phase_champion', name: 'Phase Champion', description: 'Completed an entire phase', icon: '🏆' },
  { id: 'govcon_giant', name: 'GovCon Giant', description: 'Completed all tasks', icon: '👑' },
  { id: 'three_day_streak', name: 'Three-Day Streak', description: '3 consecutive days of progress', icon: '⚡' },
  { id: 'week_warrior', name: 'Week Warrior', description: '7 consecutive days of progress', icon: '🗓️' },
  { id: 'unstoppable', name: 'Unstoppable', description: '14 consecutive days of progress', icon: '🚀' },
];

/**
 * Get gamification data for a user
 */
export async function getGamificationData(userId: string): Promise<GamificationData> {
  const supabase = getSupabase();

  if (!supabase) {
    return { currentStreak: 0, longestStreak: 0, lastCompletionDate: null, badges: [] };
  }

  try {
    const { data, error } = await supabase
      .from('planner_gamification')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return { currentStreak: 0, longestStreak: 0, lastCompletionDate: null, badges: [] };
    }

    return {
      currentStreak: data.current_streak || 0,
      longestStreak: data.longest_streak || 0,
      lastCompletionDate: data.last_completion_date,
      badges: data.badges || [],
    };
  } catch (error) {
    console.error('Error fetching gamification data:', error);
    return { currentStreak: 0, longestStreak: 0, lastCompletionDate: null, badges: [] };
  }
}

/**
 * Update streak based on task completion
 * Returns the updated streak count
 */
export async function updateStreak(userId: string): Promise<number> {
  const supabase = getSupabase();

  if (!supabase) return 0;

  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Get current gamification data
    const { data: existing } = await supabase
      .from('planner_gamification')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) {
      // Create initial record
      const { error } = await supabase
        .from('planner_gamification')
        .insert({
          user_id: userId,
          current_streak: 1,
          longest_streak: 1,
          last_completion_date: today,
          badges: [],
        });
      if (error) throw error;
      return 1;
    }

    const lastDate = existing.last_completion_date;

    // If already completed today, no change
    if (lastDate === today) {
      return existing.current_streak;
    }

    // Check if yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let newStreak: number;
    if (lastDate === yesterdayStr) {
      // Consecutive day - increment streak
      newStreak = (existing.current_streak || 0) + 1;
    } else {
      // Streak broken - reset to 1
      newStreak = 1;
    }

    const newLongest = Math.max(newStreak, existing.longest_streak || 0);

    const { error } = await supabase
      .from('planner_gamification')
      .update({
        current_streak: newStreak,
        longest_streak: newLongest,
        last_completion_date: today,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) throw error;
    return newStreak;
  } catch (error) {
    console.error('Error updating streak:', error);
    return 0;
  }
}

/**
 * Check and award badges based on current progress
 * Returns array of newly earned badge IDs
 */
export async function checkAndAwardBadges(
  userId: string,
  completedCount: number,
  currentStreak: number,
  phaseComplete: boolean,
  allComplete: boolean
): Promise<Badge[]> {
  const supabase = getSupabase();

  if (!supabase) return [];

  try {
    const { data: existing } = await supabase
      .from('planner_gamification')
      .select('badges')
      .eq('user_id', userId)
      .maybeSingle();

    const currentBadges: Badge[] = existing?.badges || [];
    const earnedIds = new Set(currentBadges.map(b => b.id));
    const newBadges: Badge[] = [];
    const now = new Date().toISOString();

    // Check each badge condition
    if (completedCount >= 1 && !earnedIds.has('first_step')) {
      newBadges.push({ ...BADGE_DEFINITIONS[0], earnedAt: now });
    }
    if (completedCount >= 5 && !earnedIds.has('momentum')) {
      newBadges.push({ ...BADGE_DEFINITIONS[1], earnedAt: now });
    }
    if (completedCount >= 10 && !earnedIds.has('dedicated')) {
      newBadges.push({ ...BADGE_DEFINITIONS[2], earnedAt: now });
    }
    if (phaseComplete && !earnedIds.has('phase_champion')) {
      newBadges.push({ ...BADGE_DEFINITIONS[3], earnedAt: now });
    }
    if (allComplete && !earnedIds.has('govcon_giant')) {
      newBadges.push({ ...BADGE_DEFINITIONS[4], earnedAt: now });
    }
    if (currentStreak >= 3 && !earnedIds.has('three_day_streak')) {
      newBadges.push({ ...BADGE_DEFINITIONS[5], earnedAt: now });
    }
    if (currentStreak >= 7 && !earnedIds.has('week_warrior')) {
      newBadges.push({ ...BADGE_DEFINITIONS[6], earnedAt: now });
    }
    if (currentStreak >= 14 && !earnedIds.has('unstoppable')) {
      newBadges.push({ ...BADGE_DEFINITIONS[7], earnedAt: now });
    }

    if (newBadges.length > 0) {
      const allBadges = [...currentBadges, ...newBadges];

      if (existing) {
        const { error } = await supabase
          .from('planner_gamification')
          .update({ badges: allBadges, updated_at: now })
          .eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('planner_gamification')
          .insert({
            user_id: userId,
            current_streak: currentStreak,
            longest_streak: currentStreak,
            last_completion_date: new Date().toISOString().split('T')[0],
            badges: allBadges,
          });
        if (error) throw error;
      }
    }

    return newBadges;
  } catch (error) {
    console.error('Error checking badges:', error);
    return [];
  }
}
