import { NextRequest, NextResponse } from 'next/server';
import { getPlannerSupabaseAdmin } from '@/lib/supabase/planner-client';
import { getTaskDetails, getPhases, getPhaseSeedTasks } from '@/lib/supabase/planner';
import { BADGE_DEFINITIONS } from '@/lib/supabase/gamification';
import { sendWeeklyDigestEmail } from '@/lib/planner-email';

export async function GET(request: NextRequest) {
  // Verify this is called by Vercel Cron (or manual with auth)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getPlannerSupabaseAdmin();

  if (!supabase) {
    return NextResponse.json(
      { error: 'Planner admin Supabase not configured' },
      { status: 500 }
    );
  }

  try {
    // List all users
    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();

    if (usersError) {
      console.error('Error listing users:', usersError);
      return NextResponse.json({ error: 'Failed to list users' }, { status: 500 });
    }

    const users = usersData?.users || [];
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString();

    // Build a map of all seed task titles for quick lookup
    const taskTitleMap = new Map<string, string>();
    const phases = getPhases();
    for (const phase of phases) {
      const seedTasks = getPhaseSeedTasks(phase.id);
      for (const t of seedTasks) {
        taskTitleMap.set(t.id, t.title);
      }
    }

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const user of users) {
      if (!user.email) {
        skipped++;
        continue;
      }

      try {
        // Get all user tasks
        const { data: userTasks } = await supabase
          .from('user_plans')
          .select('*')
          .eq('user_id', user.id);

        if (!userTasks || userTasks.length === 0) {
          skipped++;
          continue;
        }

        // Calculate progress
        const totalTasks = userTasks.length;
        const completedTasks = userTasks.filter((t: any) => t.completed).length;
        const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        // Tasks completed in the last 7 days
        const recentlyCompleted = userTasks.filter(
          (t: any) => t.completed && t.updated_at && t.updated_at >= sevenDaysAgoStr
        );
        const tasksThisWeek = recentlyCompleted.map((t: any) => {
          // Use custom title if available, otherwise look up from seed data
          if (t.title) return t.title;
          return taskTitleMap.get(t.task_id) || t.task_id;
        });

        // Get gamification data
        const { data: gamData } = await supabase
          .from('planner_gamification')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        const currentStreak = gamData?.current_streak || 0;
        const userBadges: { icon: string; name: string }[] = (gamData?.badges || []).map((b: any) => ({
          icon: b.icon || BADGE_DEFINITIONS.find(bd => bd.id === b.id)?.icon || '',
          name: b.name || BADGE_DEFINITIONS.find(bd => bd.id === b.id)?.name || '',
        }));

        // Find next 3 incomplete tasks from earliest incomplete phase
        const incompleteTasks = userTasks
          .filter((t: any) => !t.completed)
          .sort((a: any, b: any) => {
            if (a.phase_id !== b.phase_id) return a.phase_id - b.phase_id;
            return (a.sort_order ?? 0) - (b.sort_order ?? 0);
          });

        const nextTasks = incompleteTasks.slice(0, 3).map((t: any) => {
          if (t.title) return t.title;
          return taskTitleMap.get(t.task_id) || t.task_id;
        });

        const success = await sendWeeklyDigestEmail({
          email: user.email,
          overallProgress,
          completedTasks,
          totalTasks,
          tasksThisWeek,
          currentStreak,
          badges: userBadges,
          nextTasks,
        });

        if (success) {
          sent++;
        } else {
          errors.push(`Failed to send to ${user.email}`);
        }
      } catch (userError) {
        console.error(`Error processing user ${user.email}:`, userError);
        errors.push(`Error for ${user.email}: ${String(userError)}`);
      }
    }

    return NextResponse.json({
      success: true,
      totalUsers: users.length,
      sent,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Weekly digest error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
