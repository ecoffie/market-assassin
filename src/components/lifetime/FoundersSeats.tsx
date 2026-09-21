'use client';

import { useEffect, useState } from 'react';

/**
 * Live Founders seat counter for the /lifetime landing page.
 * Reads the KV-cached count via /api/founders-seats (recomputed by cron).
 * "Founders" = actual Mindy lifetime purchases + Ultimate Giant owners.
 */
interface Seats { cap: number; taken: number; remaining: number }

export default function FoundersSeats() {
  const [seats, setSeats] = useState<Seats | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/founders-seats')
      .then((r) => r.json())
      .then((d) => { if (alive && typeof d?.remaining === 'number') setSeats(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!seats) return null;

  const pct = Math.min(100, Math.round((seats.taken / seats.cap) * 100));
  const low = seats.remaining <= 20;

  return (
    <div className="max-w-md mx-auto mb-8">
      <div className="flex items-baseline justify-center gap-2 mb-2">
        <span className={`text-3xl font-black ${low ? 'text-amber-400' : 'text-emerald-400'}`}>
          {seats.remaining}
        </span>
        <span className="text-slate-300 text-sm">of {seats.cap} founding seats remaining</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${low ? 'bg-amber-400' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-center text-slate-500 text-xs mt-2">{seats.taken} founders claimed{low ? ' — closing soon' : ''}</p>
    </div>
  );
}
