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
  return (
    <div data-testid="trial-offer-banner" className="mx-4 md:mx-6 mt-4 rounded-xl border border-[#cfe1ff] bg-[#eff5ff] px-4 py-3 flex flex-wrap items-center gap-3">
      <span className="h-9 w-9 shrink-0 rounded-lg bg-[#006aff] text-white inline-flex items-center justify-center" aria-hidden><Sparkles className="h-5 w-5" /></span>
      <div className="min-w-[220px] flex-1">
        <p className="text-[15px] font-semibold text-[#111c26]">Try Mindy Pro free for 14 days</p>
        <p className="text-sm text-[#3a4654]">AI briefings, recompetes 12 months out, full market research and the proposal editor. $0 today, cancel anytime.</p>
      </div>
      <a href={trialBannerHref(email)} className="h-10 px-4 rounded-lg bg-[#006aff] hover:bg-[#0057d1] text-white text-sm font-semibold inline-flex items-center">Start free trial</a>
      <button type="button" onClick={dismiss} aria-label="Hide this for now" className="h-10 w-10 rounded-lg inline-flex items-center justify-center text-[#5a6675] hover:bg-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
