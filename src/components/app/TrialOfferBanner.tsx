'use client';

/**
 * "Try Pro free for 14 days" — shown inside /app to FREE members only (owner, 2026-11-17).
 * Free users used to see the trial only after hitting a locked feature. The page decides who is
 * free (tier resolved from /api/access/check); this component only renders and remembers a
 * dismissal for 7 days in this browser.
 */
import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { trialCheckoutHref } from '@/components/public-site/pricing/app-plan-links';

const KEY = 'mindy_trial_banner_dismissed_at';
const HIDE_MS = 7 * 24 * 60 * 60 * 1000;

export function trialBannerHref(email: string | null): string {
  const base = trialCheckoutHref('pro', 'monthly', 'app_banner');
  return email ? `${base}&email=${encodeURIComponent(email)}` : base;
}

export default function TrialOfferBanner({ email }: { email: string | null }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = 0;
    try { dismissed = Number(localStorage.getItem(KEY) || 0); } catch { /* storage blocked: show it */ }
    setShow(!dismissed || Date.now() - dismissed > HIDE_MS);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  };
  // The WHOLE strip is one link (owner: "completely clickable"); the hide button sits beside it, not
  // inside it, so it stays a real button. Solid brand blue + white text: the strongest thing on the page.
  return (
    <div data-testid="trial-offer-banner" className="shrink-0 flex items-stretch bg-[#006aff] text-white shadow-[0_2px_8px_rgba(0,106,255,.35)]">
      <a
        href={trialBannerHref(email)}
        className="group flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 md:px-6 py-3 hover:bg-[#0057d1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white transition-colors"
      >
        <span className="h-9 w-9 shrink-0 rounded-lg bg-white/15 inline-flex items-center justify-center" aria-hidden><Sparkles className="h-5 w-5" /></span>
        <span className="min-w-[220px] flex-1">
          <span className="block text-base font-bold leading-snug">Try Mindy Pro free for 14 days</span>
          <span className="block text-sm text-white">AI briefings, recompetes 12 months out, full market research and the proposal editor. $0 today, cancel anytime.</span>
        </span>
        <span className="h-10 px-5 rounded-lg bg-white text-[#005ee0] text-sm font-bold inline-flex items-center gap-1.5 shadow-sm group-hover:bg-[#eff5ff]">
          Start free trial <span aria-hidden>→</span>
        </span>
      </a>
      <button type="button" onClick={dismiss} aria-label="Hide this for now" className="w-12 shrink-0 inline-flex items-center justify-center text-white/80 hover:text-white hover:bg-[#0057d1] border-l border-white/20">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
