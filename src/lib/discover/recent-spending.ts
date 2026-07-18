/**
 * Recent Big Awards — read helper for the /spending "This Week in Government Spending" feed.
 * Every row is a real USASpending award (real amount, real award_id → /awards/[id] proof).
 * Built weekly by /api/cron/build-recent-spending; the page reads cheap from Supabase.
 */
import { getReadClient } from '@/lib/supabase/server-clients';

export interface RecentAward {
  award_id: string;
  piid: string | null;
  recipient_name: string | null;
  awarding_agency: string | null;
  obligation_amount: number;
  description: string | null;
  naics_description: string | null;
  action_date: string | null;
  recipient_state: string | null;
}

export async function getRecentBigAwards(limit = 40): Promise<RecentAward[]> {
  const { data, error } = await getReadClient()
    .from('recent_big_awards')
    .select('award_id, piid, recipient_name, awarding_agency, obligation_amount, description, naics_description, action_date, recipient_state')
    .order('obligation_amount', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentBigAwards: ${error.message}`);
  return (data ?? []) as RecentAward[];
}
