/**
 * The anonymous-visitor call to action on /opportunity/[slug] (the SEO page family).
 *
 * There is no free plan for new users since 2026-11-12 (src/proxy.ts sends /app/signup to
 * /pricing; /pricing offers Pro/Team with a 14-day free trial). So this CTA must never promise
 * "free" tracking or "free" alerts, and must never point at /app/signup (a redirect) or the /app
 * sign-in wall.
 *
 *  - Open notice   → the public Opportunity Map, opened on THIS notice's drawer
 *                    (`/opportunity-map?opp=<noticeId>`, no login), plus the trial for drafting.
 *  - Closed/awarded → alerts for the buyer's next notice, which come with a paid plan: the trial.
 */
export const TRIAL_HREF = '/pricing';

export interface OpportunityCta {
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string | null;
  secondaryLabel: string | null;
  /** Closing sentence for the closed-notice alerts paragraph (null for open notices). */
  offerLine: string | null;
}

export function opportunityMapHref(noticeId: string): string {
  return `/opportunity-map?opp=${encodeURIComponent(noticeId)}`;
}

export function opportunityCta(opp: { noticeId: string }, isOpen: boolean): OpportunityCta {
  if (isOpen) {
    return {
      primaryHref: opportunityMapHref(opp.noticeId),
      primaryLabel: 'See this notice on the opportunity map →',
      secondaryHref: TRIAL_HREF,
      secondaryLabel: 'Start a 14-day free trial to track it and draft your response →',
      offerLine: null,
    };
  }
  return {
    primaryHref: TRIAL_HREF,
    primaryLabel: 'Start your 14-day free trial →',
    secondaryHref: null,
    secondaryLabel: null,
    offerLine: 'Daily alerts come with Mindy Pro, which starts with a 14-day free trial.',
  };
}
