'use client';

/**
 * Today's 3 (owner, 2026-11-19, from the betting-app gamification mockups: "build Today's 3 first").
 *
 * The first three opportunities of the user's NEWEST daily briefing, each with its M-Win fit score (the
 * score from /api/app/win-probability — the same model everywhere, shown only when it is
 * grounded in the user's profile; never a made-up number) and two buttons:
 *   Pursue → the panel's existing "track in pipeline" action
 *   Pass   → the panel's existing dismiss action (tracked as an engagement event)
 * Decisions are remembered for the day in this browser so the card shows "Done for today".
 *
 * Presentational + its own odds fetch. DashboardPanel owns the briefing, the pipeline and dismiss.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';

export interface TodaysPick {
  id: string;
  title: string;
  buyer: string;
  noticeType?: string;
  setAside?: string;
  naics?: string;
  deadline?: string;
  amount?: string;
}

type Decision = 'pursue' | 'pass';

/** Local date (the user's day), YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function storageKey(email: string, day: string): string {
  return `mindy_todays3:${email.toLowerCase()}:${day}`;
}

function readDecisions(key: string): Record<string, Decision> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, Decision> : {};
  } catch {
    return {};
  }
}

/** A win score is shown only when the server says it is grounded in the user's profile. */
export function oddsLabel(r: { grounded?: boolean; probability?: number; score?: number } | null | undefined): string | null {
  if (!r || r.grounded !== true) return null;
  const n = typeof r.probability === 'number' ? r.probability : r.score;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return `M-Win ${Math.round(n)}%`;
}

export default function TodaysThree({
  email, picks, alreadyPursued, getAuthHeaders, onPursue, onPass,
}: {
  email: string;
  picks: TodaysPick[];
  /** Ids already in the user's pipeline (counted as Pursued). */
  alreadyPursued: (id: string) => boolean;
  getAuthHeaders: (init?: HeadersInit) => HeadersInit;
  onPursue: (id: string) => void;
  onPass: (id: string) => void;
}) {
  const three = useMemo(() => picks.slice(0, 3), [picks]);
  const key = storageKey(email, todayKey());
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [odds, setOdds] = useState<Record<string, string | null>>({});

  useEffect(() => { setDecisions(readDecisions(key)); }, [key]);

  // Win odds for the three picks (Pro only server-side; signed-out / no profile → no number).
  const pickIds = three.map(p => p.id).join('|');
  useEffect(() => {
    let live = true;
    for (const p of three) {
      const q = new URLSearchParams();
      if (p.naics) q.set('naics', p.naics);
      if (p.setAside) q.set('setAside', p.setAside);
      if (p.buyer) q.set('agency', p.buyer);
      q.set('title', p.title);
      fetch(`/api/app/win-probability?${q.toString()}`, { headers: getAuthHeaders() })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (live) setOdds(prev => ({ ...prev, [p.id]: oddsLabel(d) })); })
        .catch(() => {});
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the picks change
  }, [pickIds]);

  if (three.length === 0) return null;

  const decide = (id: string, d: Decision) => {
    const next = { ...decisions, [id]: d };
    setDecisions(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode */ }
    if (d === 'pursue') onPursue(id); else onPass(id);
  };

  const stateOf = (id: string): Decision | null => decisions[id] || (alreadyPursued(id) ? 'pursue' : null);
  const decided = three.filter(p => stateOf(p.id)).length;
  const allDone = decided === three.length;

  return (
    <section aria-label="Today's 3" data-testid="todays-three" className="rounded-xl border border-surface bg-ground p-4 md:p-5 mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-lg font-semibold text-white">
          Today&apos;s {three.length}
          <span className="ml-2 text-sm font-normal text-muted">from your daily briefing · {decided} of {three.length} decided</span>
        </h2>
        <span className="text-xs text-muted">New picks tomorrow</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {three.map(p => {
          const st = stateOf(p.id);
          const o = odds[p.id];
          return (
            <article key={p.id} className={`rounded-lg border border-surface p-4 flex flex-col gap-3 ${st ? 'opacity-80' : ''}`} data-testid="todays-three-card">
              <div className="flex items-center justify-between gap-2 min-h-6">
                <span className="text-xs font-medium text-muted truncate">{[p.setAside, p.noticeType].filter(Boolean).join(' · ')}</span>
                {o && <span className="shrink-0 rounded-full bg-[#006aff]/10 px-2.5 py-0.5 text-xs font-bold text-[#006aff]">{o}</span>}
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-snug text-white line-clamp-2">{p.title}</p>
                {p.buyer && <p className="mt-1 text-xs text-muted truncate">{p.buyer}</p>}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
                {p.amount && <span>{p.amount}</span>}
                {p.deadline && <span>Due {p.deadline}</span>}
              </div>
              {st ? (
                <p className={`mt-auto h-11 rounded-lg flex items-center justify-center gap-1.5 text-sm font-semibold ${st === 'pursue' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-surface text-muted'}`}>
                  {st === 'pursue' ? <><Check className="h-4 w-4" />In My Pursuits</> : 'Passed'}
                </p>
              ) : (
                <div className="mt-auto grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => decide(p.id, 'pursue')} className="h-11 rounded-lg bg-[#006aff] hover:bg-[#0057d1] text-white text-sm font-semibold">Pursue</button>
                  <button type="button" onClick={() => decide(p.id, 'pass')} className="h-11 rounded-lg border border-surface bg-ground hover:bg-surface text-sm font-semibold text-white">Pass</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {allDone && (
        <p className="mt-3 rounded-lg bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-500" data-testid="todays-three-done">
          Done for today. Mindy will have new picks for you tomorrow.
        </p>
      )}
    </section>
  );
}
