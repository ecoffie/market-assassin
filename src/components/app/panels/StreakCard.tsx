'use client';

/**
 * Login streak on For you (owner, 2026-11-19): "win extra credits for being inside and logging into
 * Mindy everyday". Opening the page records today's visit (POST /api/app/streak); the card shows
 * the streak, today's reward when one was paid, and how far the next reward is. Hidden when the
 * streak can't be read — never a made-up "0-day streak".
 */
import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';

export type StreakData =
  | { status: 'ok'; streak: number; longest: number; countedToday: boolean; rewardedToday: number; creditsEligible?: boolean; next: { inDays: number; credits: number } }
  | { status: 'unavailable' };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function StreakView({ data }: { data: StreakData | null }) {
  if (!data || data.status !== 'ok') return null;
  const { streak, rewardedToday, next } = data;
  const eligible = data.creditsEligible !== false;
  return (
    <section aria-label="Login streak" data-testid="streak-card" className="rounded-xl border border-surface bg-ground px-4 py-3 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-500">
        <Flame className="h-4 w-4" aria-hidden />
        {plural(streak, 'day')} in a row
      </span>
      {!eligible ? (
        <span className="text-sm text-muted" data-testid="streak-pro-only">Pro members earn <span className="font-semibold text-white">+25 credits</span> every 7 days in a row</span>
      ) : rewardedToday > 0 ? (
        <span className="text-sm font-semibold text-emerald-500" data-testid="streak-reward">+{rewardedToday} credits added for your {streak}-day streak</span>
      ) : (
        <span className="text-sm text-muted">
          {next.inDays === 1 ? 'Come back tomorrow' : `${plural(next.inDays, 'more day')}`} for <span className="font-semibold text-white">+{next.credits} credits</span>
        </span>
      )}
      {eligible && <span className="ml-auto text-xs text-muted">+25 every 7 days · +100 every 30</span>}
    </section>
  );
}

export default function StreakCard({ getAuthHeaders }: { getAuthHeaders: (init?: HeadersInit) => HeadersInit }) {
  const [data, setData] = useState<StreakData | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/app/streak', { method: 'POST', headers: getAuthHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) setData(d && d.status ? d as StreakData : { status: 'unavailable' }); })
      .catch(() => { if (live) setData({ status: 'unavailable' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page load
  }, []);
  return <StreakView data={data} />;
}
