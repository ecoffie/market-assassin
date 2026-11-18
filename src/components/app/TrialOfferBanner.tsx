'use client';

/**
 * "Try Pro free for 14 days" — the first thing on /app for FREE members only (owner, 2026-11-17).
 * Free users used to see the trial only after hitting a locked feature. The page decides who is
 * free (tier resolved from /api/access/check); this component only renders.
 * The whole strip is one link and it cannot be dismissed (owner: "completely clickable",
 * "don't allow them to x out of it"). Solid brand blue + white text: the strongest thing on the page.
 */
import { Sparkles } from 'lucide-react';

/**
 * The existing Pro trial checkout hop (/checkout/<product> records first-party attribution and
 * redirects to the 14-day-trial payment link). The utm tags mark the banner as the source.
 */
export const TRIAL_BANNER_HREF = '/checkout/mindy-pro-monthly?utm_source=mindy_app&utm_medium=banner&utm_campaign=free_member_trial';

export default function TrialOfferBanner() {
  return (
    <a
      href={TRIAL_BANNER_HREF}
      data-testid="trial-offer-banner"
      className="group shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 md:px-6 py-3 bg-[#006aff] hover:bg-[#0057d1] text-white shadow-[0_2px_8px_rgba(0,106,255,.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white transition-colors"
    >
      <span className="h-9 w-9 shrink-0 rounded-lg bg-white/15 inline-flex items-center justify-center" aria-hidden><Sparkles className="h-5 w-5" /></span>
      <span className="min-w-[220px] flex-1">
        <span className="block text-base font-bold leading-snug">Try Mindy Pro free for 14 days</span>
        <span className="block text-sm text-white">Daily briefings, recompetes 12 months out, full market research and the proposal editor. $0 today, cancel anytime.</span>
      </span>
      <span className="h-10 px-5 rounded-lg bg-white text-[#005ee0] text-sm font-bold inline-flex items-center gap-1.5 shadow-sm group-hover:bg-[#eff5ff]">
        Start free trial <span aria-hidden>→</span>
      </span>
    </a>
  );
}
