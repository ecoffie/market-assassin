'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { X, Check, Sparkles } from 'lucide-react';

/**
 * UpgradeModal — the free→paid conversion moment.
 *
 * Opens when a FREE user clicks a Pro-locked feature in the sidebar (the highest-
 * intent signal there is — they're reaching for the thing they'd pay for). Instead
 * of a silent disabled button, we show what that feature does + the Pro value + a
 * direct checkout CTA. Feature-aware: the headline names what they just clicked.
 *
 * Routes through /checkout/mindy-pro-monthly so purchase attribution is captured.
 */

// What each locked panel unlocks — the one-line pitch shown when a free user
// clicks it. Keyed by the sidebar item id.
const FEATURE_PITCH: Record<string, { title: string; line: string }> = {
  dashboard: { title: "Today's Intel", line: 'Your AI-prioritized daily brief — the opportunities that actually fit, ranked and explained.' },
  chat: { title: 'Mindy Chat', line: 'Ask Mindy anything about opportunities, agencies, or competitors and get a straight answer.' },
  pipeline: { title: 'My Pursuits', line: 'Track every opportunity you’re chasing, with amendment alerts so you never miss a change.' },
  forecasts: { title: 'Upcoming Buys', line: '7,800+ agency forecasts — see what’s coming 6–18 months before it hits SAM.gov.' },
  recompetes: { title: 'Expiring Contracts', line: 'Find contracts about to re-compete so you can position before the RFP drops.' },
  grants: { title: 'Federal Grants', line: '$700B+ in federal grant funding, searchable by your profile.' },
  contractors: { title: 'Contractors Database', line: 'Look up any of 317K contractors — their awards, agencies, and teaming fit.' },
  'decision-makers': { title: 'Decision Makers', line: 'The buying-office contacts who actually award the work in your space.' },
  pricing: { title: 'Pricing Intel', line: 'What the government actually paid — so you bid to win, not to guess.' },
  proposals: { title: 'Proposal Assist', line: 'Turn an RFP into a compliance matrix and drafted sections in minutes.' },
  'target-list': { title: 'My Target List', line: 'Save and track the agencies and offices you’re going after.' },
  library: { title: 'My Library', line: 'Your saved opportunities, docs, and research in one place.' },
};

const PRO_BENEFITS = [
  'AI daily briefings — ranked & explained',
  'Forecasts, recompetes, grants & pricing intel',
  'Mindy Chat — your 24/7 analyst',
  'Pipeline tracking + proposal assist',
  'Full contractor & decision-maker database',
];

export function UpgradeModal({ featureId, onClose }: { featureId: string | null; onClose: () => void }) {
  // Close on Escape.
  useEffect(() => {
    if (!featureId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [featureId, onClose]);

  if (!featureId) return null;
  const pitch = FEATURE_PITCH[featureId] || { title: 'Mindy Pro', line: 'Unlock the full Mindy workspace.' };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-purple-950/40 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <X className="h-5 w-5" strokeWidth={1.75} />
        </button>

        <div className="p-6">
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-purple-500/15 px-2.5 py-1 text-xs font-semibold text-purple-300">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} /> Mindy Pro
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">Unlock {pitch.title}</h2>
          <p className="mt-2 text-sm text-slate-300">{pitch.line}</p>

          <ul className="mt-5 space-y-2">
            {PRO_BENEFITS.map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm text-slate-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" strokeWidth={2.5} />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-3xl font-black text-white">$149</span>
            <span className="text-sm text-slate-400">/mo — cancel anytime</span>
          </div>

          <Link
            href="/checkout/mindy-pro-monthly"
            className="mt-4 block w-full rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 py-3 text-center font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:scale-[1.02] hover:from-purple-500 hover:to-blue-500"
          >
            Go Pro — unlock everything →
          </Link>
          <Link
            href="/market-intelligence"
            className="mt-2 block w-full text-center text-sm text-slate-400 hover:text-slate-200"
          >
            See full pricing & annual plans
          </Link>
        </div>
      </div>
    </div>
  );
}
