'use client';
/**
 * AgencyEventsStrip — upcoming industry days + past-event BEHAVIOR signals for the agency a
 * market-research run is scoped to (Eric 2026-08-14: events were "nowhere in our opportunity
 * cards or market research").
 *
 * Market Research is an INTELLIGENCE surface, so it gets BOTH halves — unlike an opportunity
 * page, which is action-only and never shows an expired event:
 *   · upcoming  → "you can still attend this"
 *   · past      → named buyer-DNA signals ("Runs Industry Days — 7 in the past year"), which
 *                 describe how the buyer engages industry
 *
 * SELF-HIDING: renders null unless real evidence comes back. No dead "No events found" box —
 * 91 upcoming attendable events exist government-wide at any moment, so most markets legitimately
 * have none, and an empty box would read as a broken panel rather than an honest absence.
 */
import { useEffect, useState } from 'react';
import { CalendarDays, Users } from 'lucide-react';
import { authedFetch } from '../authHeaders';

type ScopedEvent = {
  title: string;
  event_type: string;
  event_date: string | null;
  location: string | null;
};
type DnaSignal = { key: string; label: string; detail: string };

function fmt(d: string | null): string {
  if (!d) return 'Date TBD';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export default function AgencyEventsStrip({ agency, email }: { agency: string; email: string }) {
  const [events, setEvents] = useState<ScopedEvent[]>([]);
  const [matchLabel, setMatchLabel] = useState('');
  const [signals, setSignals] = useState<DnaSignal[]>([]);

  useEffect(() => {
    const a = (agency || '').trim();
    if (!a) { setEvents([]); setSignals([]); return; }
    let cancelled = false;
    const q = `agency=${encodeURIComponent(a)}`;

    // Two independent calls: an upcoming list and the past-event DNA. Either can come back empty
    // without suppressing the other — they answer different questions.
    authedFetch(`/api/app/opportunity-events?${q}&limit=4`, email)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.success) return;
        setEvents(Array.isArray(d.events) ? d.events : []);
        setMatchLabel(String(d.matchLabel || ''));
      })
      .catch(() => { /* additive surface — never surface a fetch error here */ });

    authedFetch(`/api/app/opportunity-events?mode=dna&${q}`, email)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.success) return;
        setSignals(Array.isArray(d?.dna?.signals) ? d.dna.signals : []);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [agency, email]);

  // No evidence at all → render NOTHING (never an empty-state box).
  if (!events.length && !signals.length) return null;

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <CalendarDays className="h-4 w-4" strokeWidth={2} /> Industry engagement
        </h3>
        {matchLabel && events.length > 0 && (
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-slate-300">
            {matchLabel}
          </span>
        )}
      </div>

      {events.length > 0 && (
        <ul className="mb-3 space-y-2">
          {events.map((e, i) => (
            <li key={`${e.title}-${i}`} className="flex gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <span className="min-w-[76px] whitespace-nowrap font-mono text-xs font-semibold text-sky-300">{fmt(e.event_date)}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-snug text-white">{e.title}</span>
                <span className="mt-0.5 block text-xs capitalize text-slate-400">
                  {String(e.event_type || '').replace(/_/g, ' ')}{e.location ? ` · ${e.location}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {signals.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <Users className="h-3.5 w-3.5" strokeWidth={2} /> How this buyer engages industry
          </div>
          <div className="flex flex-wrap gap-2">
            {signals.map((s) => (
              <span key={s.key} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
                <span className="block text-xs font-semibold text-white">{s.label}</span>
                <span className="block text-[11px] text-slate-400">{s.detail}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
