'use client';
/**
 * The research steps of one Ask Mindy turn. While it runs: a ticking timer, the current step, how many steps so
 * far, and a "still working" line after a quiet stretch. Once the answer is in it collapses to one summary line;
 * "Show steps" opens the list either way.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import {
  currentLine, formatElapsed, stepCountLabel, summaryLine, STILL_WORKING_MS, STILL_WORKING_TEXT, type ResearchProgress,
} from '@/lib/chat/research-progress';

export function ResearchProgressView({ progress, running, finishedAt, tag }: { progress: ResearchProgress; running: boolean; finishedAt?: number; tag?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  // Collapsing closes an open steps list, so the answer is not pushed down.
  useEffect(() => { if (!running) setOpen(false); }, [running]);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const quiet = running && now - progress.lastEventAt >= STILL_WORKING_MS;
  const list = progress.steps.length > 0 && (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="research-steps-toggle"
        className="inline-flex items-center gap-1 text-[11.5px] text-faint hover:text-slate-200"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {open ? 'Hide steps' : 'Show steps'}
      </button>
      {open && (
        <ol className="mt-1 space-y-0.5 border-l border-hairline pl-3" data-testid="research-steps">
          {progress.steps.map((s) => (
            <li key={s.text} className="text-[12px] text-muted">
              {s.text}{s.count > 1 ? <span className="text-faint"> ×{s.count}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  if (!running) {
    if (!progress.total) return null;
    return (
      <div className="mb-2 text-[12px] text-faint" data-testid="research-summary">
        {summaryLine(progress, finishedAt ?? progress.lastEventAt)}
        {list}
      </div>
    );
  }
  return (
    <div className="mb-1 rounded-lg border border-hairline bg-ground/60 px-3 py-2" role="status" aria-live="polite" data-testid="research-progress">
      <div className="flex items-center gap-2 text-[12.5px] text-slate-200">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-purple-400" aria-hidden />
        <span className="font-medium">Researching</span>
        {tag && <span data-testid="research-progress-tag" className="rounded-full border border-purple-400/40 bg-purple-500/10 px-1.5 py-px text-[10px] font-medium text-purple-200">{tag}</span>}
        <span className="tabular-nums text-faint" data-testid="research-elapsed">{formatElapsed(now - progress.startedAt)}</span>
        {progress.total > 0 && <span className="text-faint">· {stepCountLabel(progress.total)}</span>}
      </div>
      <div className="mt-1 text-[12.5px] text-muted" data-testid="research-current">{currentLine(progress)}</div>
      {quiet && <div className="mt-1 text-[11.5px] text-faint" data-testid="research-still">{STILL_WORKING_TEXT}</div>}
      {list}
    </div>
  );
}
