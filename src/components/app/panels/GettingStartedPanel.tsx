'use client';
/**
 * Getting Started — the guided-journey panel that answers "I signed up, then what?"
 *
 * Three task-based journeys (profile → find customers → first bid), each with a
 * Loom-on-Vimeo walkthrough, the steps, and a "Do it now →" button that deep-links
 * to the real tool. Progress persists via /api/app/journeys. Value-first: the
 * journeys are free; Pro reveals itself at the ceiling inside each tool.
 * (Plan: docs/PLAN-mindy-guided-journeys.md)
 */
import { useEffect, useState, useCallback } from 'react';
import { Check } from 'lucide-react';
import { authedFetch } from '../authHeaders';
import { JOURNEYS, journeysCompletedCount, type JourneyKey, type JourneyProgress } from '@/lib/journeys/definitions';

export default function GettingStartedPanel({
  email,
  onPanelChange,
}: {
  email?: string;
  onPanelChange?: (panel: string) => void;
}) {
  const [progress, setProgress] = useState<JourneyProgress | null>(null);
  const [open, setOpen] = useState<JourneyKey | null>('profile'); // first one expanded

  useEffect(() => {
    if (!email) return;
    authedFetch(`/api/app/journeys?email=${encodeURIComponent(email)}`, email)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.success) setProgress(d.progress); })
      .catch(() => {});
  }, [email]);

  const markDone = useCallback((journey: JourneyKey) => {
    setProgress((p) => (p ? { ...p, [JOURNEYS.find(j => j.key === journey)!.doneField]: true } : p));
    if (!email) return;
    authedFetch(`/api/app/journeys?email=${encodeURIComponent(email)}`, email, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ journey, done: true }),
    }).catch(() => {});
  }, [email]);

  const isDone = (j: JourneyKey) => {
    const f = JOURNEYS.find((x) => x.key === j)!.doneField;
    return !!progress?.[f];
  };
  const completed = journeysCompletedCount(progress);

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Getting Started</p>
        <h1 className="text-xl font-semibold text-white">Win your first contract with Mindy</h1>
        <p className="text-sm text-muted mt-1">
          Three short steps — set up your market, find who buys your work, and build your first bid.
          Each one ends with something real you can use.
        </p>
        {/* Progress bar */}
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 rounded-full bg-surface overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(completed / JOURNEYS.length) * 100}%` }} />
          </div>
          <span className="text-xs text-muted shrink-0">{completed} of {JOURNEYS.length} done</span>
        </div>
      </div>

      <div className="space-y-3">
        {JOURNEYS.map((j) => {
          const done = isDone(j.key);
          const expanded = open === j.key;
          return (
            <div key={j.key} className={`rounded-xl border ${done ? 'border-emerald-500/30 bg-emerald-500/[0.03]' : 'border-surface bg-ground'}`}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : j.key)}
                className="w-full flex items-start gap-3 p-4 text-left"
              >
                <span className={`shrink-0 mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${done ? 'bg-emerald-600 text-white' : 'bg-surface text-ink-soft'}`}>
                  {done ? <Check className="h-4 w-4" strokeWidth={3} /> : j.num}
                </span>
                <span className="flex-1">
                  <span className="text-white font-medium">{j.title}</span>
                  <span className="block text-xs text-muted mt-0.5">{j.why}</span>
                </span>
                <span className="text-faint text-sm shrink-0">{expanded ? '▲' : '▼'}</span>
              </button>

              {expanded && (
                <div className="px-4 pb-4 pt-0 pl-14">
                  {/* Vimeo walkthrough (empty until recorded) */}
                  {j.vimeoUrl ? (
                    <div className="mb-3 aspect-video w-full overflow-hidden rounded-lg border border-surface">
                      <iframe src={j.vimeoUrl} className="h-full w-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title={j.title} />
                    </div>
                  ) : (
                    <div className="mb-3 flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-hairline bg-ground-deep/50 text-xs text-faint">
                      Walkthrough video coming soon
                    </div>
                  )}

                  <ol className="space-y-1.5 mb-3">
                    {j.steps.map((s, i) => (
                      <li key={i} className="text-sm text-ink-soft">
                        <span className="text-faint mr-1.5">{i + 1}.</span>
                        <span className="font-medium">{s.label}</span>
                        <span className="block text-xs text-muted ml-5">{s.detail}</span>
                      </li>
                    ))}
                  </ol>

                  <p className="text-xs text-emerald-300/80 mb-3">You'll end with: {j.artifact}</p>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onPanelChange?.(j.panel)}
                      className="rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-semibold text-white"
                    >
                      {j.ctaLabel}
                    </button>
                    {!done && (
                      <button
                        type="button"
                        onClick={() => markDone(j.key)}
                        className="rounded-lg border border-hairline bg-surface px-3 py-2 text-xs text-ink-soft hover:text-white"
                      >
                        Mark done
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {completed === JOURNEYS.length && (
        <p className="mt-4 text-sm text-emerald-400">🎉 You've completed Getting Started — you're set up to win. Mindy Pro unlocks AI briefings, unlimited research, and full pipeline tracking when you're ready.</p>
      )}
    </div>
  );
}
