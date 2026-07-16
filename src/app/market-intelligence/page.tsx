'use client';

import { useRef, useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { persistAccessEmail } from '@/lib/access-cookie';

// Public pricing — anchor prices for the upgrade page.
//
// Pro tier ($149/mo or $1,490/yr) is the default selection because
// most upgrades are single-seat. Team tier ($499/mo or $4,990/yr,
// 5 seats included) ships as a toggle option for small BD teams.
const CHECKOUT_MONTHLY      = 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C'; // Pro $149/mo
const CHECKOUT_ANNUAL       = 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D'; // Pro $1,490/yr
const CHECKOUT_TEAM_MONTHLY = 'https://buy.stripe.com/9B63cw0ke8388pfclafnO0E'; // Team $499/mo
const CHECKOUT_TEAM_ANNUAL  = 'https://buy.stripe.com/4gM14oc2W97c20R3OEfnO0F'; // Team $4,990/yr

// Private loyalty pricing (for email campaigns to past customers only - NOT shown on public page)
// const CHECKOUT_LOYALTY_MONTHLY = 'https://buy.stripe.com/00wfZigjc97ceND3OEfnO0z'; // $49/mo
// const CHECKOUT_LOYALTY_ANNUAL = 'https://buy.stripe.com/aFa6oI6ICdns0WN5WMfnO0A';  // $497/yr

// Free signup URL removed May 2026 — this is now an upgrade page,
// not an entry page. Sign-up CTAs live on the marketing pages.

function MarketIntelligenceContent() {
  const searchParams = useSearchParams();
  const emailRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const [verifyingInvite, setVerifyingInvite] = useState(false);
  // Pricing toggle — Annual is default so users see the cheaper
  // per-month rate first ($124/mo billed annually vs. $149/mo).
  // Pattern: Stripe, Linear, Notion all default-open to annual
  // to anchor on the lower number. Monthly is one click away.
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('annual');
  // Tier toggle — Solo (Pro, default) vs Team. Solo is default
  // because single-seat is the larger purchase population; Team
  // (5 seats) is the upsell for small BD departments.
  const [tier, setTier] = useState<'pro' | 'team'>('pro');

  // Handle invite token on mount
  useEffect(() => {
    const inviteToken = searchParams.get('invite');
    if (!inviteToken) return;

    const verifyInviteToken = async () => {
      setVerifyingInvite(true);
      setError('');

      try {
        // Verify the invite token
        const res = await fetch(`/api/invitations/verify?token=${encodeURIComponent(inviteToken)}`);
        const data = await res.json();

        if (!data.valid) {
          setError('This invitation link is invalid or has expired. Please contact support.');
          setVerifyingInvite(false);
          return;
        }

        // Token is valid - grant briefings access and redirect
        const email = data.email?.toLowerCase().trim();
        if (email) {
          // Save profile with briefings access
          await fetch('/api/alerts/save-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              naicsCodes: [], // Will be set up in onboarding
              alertsEnabled: true,
              briefingsEnabled: true,
              source: 'paid_existing',
              stripeCustomerId: data.customerId || undefined,
              isActive: true,
            }),
          });

          // Mark invite as used
          await fetch('/api/invitations/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: inviteToken }),
          });

          // Store email + auth cookie for briefings dashboard
          persistAccessEmail(email);

          // Redirect to briefings with setup flag
          setRedirecting(true);
          window.location.href = '/briefings?setup=true';
        }
      } catch {
        setError('Failed to verify invitation. Please try again or contact support.');
        setVerifyingInvite(false);
      }
    };

    verifyInviteToken();
  }, [searchParams]);

  const handleVerifyAccess = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const email = emailRef.current?.value?.trim().toLowerCase() || '';
    if (!email) {
      setError('Please enter your email');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/briefings/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.hasAccess) {
        persistAccessEmail(email);
        setRedirecting(true);
        await new Promise((resolve) => setTimeout(resolve, 120));
        window.location.href = '/briefings';
        return;
      }

      setError('No access found for this email. Choose a plan below to get started.');
    } catch {
      setError('Failed to verify access. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendSecureLink = async () => {
    const email = emailRef.current?.value?.trim().toLowerCase() || '';
    if (!email) {
      setError('Enter your email first so we know where to send the secure link.');
      return;
    }

    setSendingLink(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/access-links/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, destination: 'briefings' }),
      });
      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Could not send secure link.');
        return;
      }

      setSuccess('Secure link sent. Check your email to open Mindy AI.');
    } catch {
      setError('Could not send secure link. Please try again.');
    } finally {
      setSendingLink(false);
    }
  };

  // Show loading state when verifying invite token
  if (verifyingInvite || (searchParams.get('invite') && !error)) {
    return (
      <div className="min-h-screen bg-ground-deep flex items-center justify-center">
        <div className="text-center">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-500/30">
            <span className="text-white font-bold text-2xl">MI</span>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            {redirecting ? 'Access Granted!' : 'Verifying Your Invitation...'}
          </h2>
          <p className="text-muted">
            {redirecting ? 'Redirecting to your dashboard...' : 'Just a moment while we verify your access.'}
          </p>
          {!redirecting && (
            <div className="mt-4 flex justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-500 border-t-transparent"></div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ground-deep">
      {/* Hero section removed May 22, 2026 per user: "do we need
          a hero section". Right call — users hitting this page
          from the in-app upgrade CTA already know what Mindy AI
          is and that they're upgrading. The hero was selling them
          on something they're already convinced of, costing them
          the ability to see the price + CTA without scrolling.
          A slim brand bar replaces it. */}
      <div className="bg-gradient-to-r from-purple-900/40 to-slate-900 border-b border-purple-500/20 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow shadow-purple-500/30">
            <span className="text-white font-bold text-sm">M</span>
          </div>
          <span className="text-white font-semibold text-lg">Mindy AI</span>
        </div>
      </div>

      {/* Access-check block above the fold removed May 22, 2026.
          User: "this is an upgrade plan there is no need for
          enter your email if they need access". Users hitting
          this page from the in-app upgrade CTA are already
          signed in. A quieter version of the access form lives
          at the bottom of the page (search "Already a Mindy Pro
          customer") for existing customers who land here from
          a search engine or old email link. */}

      {/* PRICING-TOGGLE — first thing the user sees after the hero.
          User flagged: "This is an upgrade page, choose your plan
          should be first thing they see. Annual shown as monthly
          equivalent, not total." Built as a single card + toggle
          (Stripe / Linear / Notion pattern) rather than two
          side-by-side cards. */}
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-6">
        <h2 className="text-2xl font-bold text-white text-center mb-1">
          {tier === 'pro' ? 'Upgrade to Pro' : 'Upgrade to Team'}
        </h2>
        <p className="text-muted text-center text-sm mb-4">
          {tier === 'pro'
            ? 'Full Mindy AI workspace + AI briefings + FHC training.'
            : '5 seats · shared pipeline · team admin dashboard · priority support.'}
        </p>

        {/* Solo / Team toggle — picks which tier the price card
            renders. Solo (Pro) is the default since single-seat
            is the larger purchase population. Team upgrades for
            small BD departments who need 5 seats. */}
        <div className="flex justify-center mb-3">
          <div className="inline-flex bg-ground border border-hairline rounded-full p-1">
            <button
              type="button"
              onClick={() => setTier('pro')}
              className={`px-5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                tier === 'pro'
                  ? 'bg-input text-white shadow-sm'
                  : 'text-muted hover:text-slate-200'
              }`}
            >
              Solo
            </button>
            <button
              type="button"
              onClick={() => setTier('team')}
              className={`px-5 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-2 ${
                tier === 'team'
                  ? 'bg-input text-white shadow-sm'
                  : 'text-muted hover:text-slate-200'
              }`}
            >
              Team
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                tier === 'team' ? 'bg-blue-500 text-white' : 'bg-blue-500/20 text-blue-300'
              }`}>5 SEATS</span>
            </button>
          </div>
        </div>

        {/* Monthly / Annual toggle. Annual is highlighted because
            it's the cheaper-per-month option + we want to nudge
            toward longer commitment. */}
        <div className="flex justify-center mb-5">
          <div className="inline-flex bg-surface border border-hairline rounded-full p-1">
            <button
              type="button"
              onClick={() => setBillingPeriod('monthly')}
              className={`px-6 py-2 rounded-full text-sm font-semibold transition-colors ${
                billingPeriod === 'monthly'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-muted hover:text-slate-200'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingPeriod('annual')}
              className={`px-6 py-2 rounded-full text-sm font-semibold transition-colors flex items-center gap-2 ${
                billingPeriod === 'annual'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-muted hover:text-slate-200'
              }`}
            >
              Annual
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                billingPeriod === 'annual' ? 'bg-emerald-500 text-white' : 'bg-emerald-500/20 text-emerald-300'
              }`}>SAVE 17%</span>
            </button>
          </div>
        </div>

        {/* Single price card whose price + CTA + footnote change
            based on BOTH toggles. Annual rows show the monthly-
            equivalent number (e.g. $124/mo for Pro, $416/mo for
            Team) per Eric's spec, with "billed annually as $X" as
            the secondary line. Team card uses a blue accent ring
            instead of purple to differentiate visually. */}
        <div className={`bg-gradient-to-br ${
          tier === 'pro' ? 'from-purple-900/40 to-slate-800 border-purple-500' : 'from-blue-900/40 to-slate-800 border-blue-500'
        } border-2 rounded-2xl p-5 shadow-2xl ${
          tier === 'pro' ? 'shadow-purple-500/10' : 'shadow-blue-500/10'
        }`}>
          <div className="text-center mb-4">
            {(() => {
              // Pricing table — single source of truth so future
              // price tweaks only touch this object.
              const prices = {
                pro:  { monthly: { headline: '$149', sub: 'Cancel anytime · Includes FHC training' },
                        annual:  { headline: '$124', sub: 'Billed annually as $1,490 — 2 months free' } },
                team: { monthly: { headline: '$499', sub: '5 seats · Cancel anytime · Includes FHC training' },
                        annual:  { headline: '$416', sub: 'Billed annually as $4,990 — 2 months free' } },
              } as const;
              const p = prices[tier][billingPeriod];
              return (
                <>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-4xl font-bold text-white">{p.headline}</span>
                    <span className="text-muted">/mo</span>
                  </div>
                  <p className={`text-xs mt-1 ${billingPeriod === 'annual' ? 'text-emerald-400 font-medium' : 'text-faint'}`}>
                    {p.sub}
                  </p>
                </>
              );
            })()}
          </div>

          {/* Tighter 2-col feature grid replaces vertical list \—
              shows more features in less vertical space so the
              CTA button stays above the fold. Team rows highlight
              the seat-related features. */}
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mb-5">
            {tier === 'team' && (
              <li className="flex items-center gap-1.5 text-blue-300 text-xs font-medium sm:col-span-2">
                <span className="text-blue-400">★</span> 5 user seats included
              </li>
            )}
            <li className="flex items-center gap-1.5 text-ink-soft text-xs">
              <span className="text-green-500">✓</span> Daily market briefs
            </li>
            <li className="flex items-center gap-1.5 text-ink-soft text-xs">
              <span className="text-green-500">✓</span> Weekly deep dives
            </li>
            <li className="flex items-center gap-1.5 text-ink-soft text-xs">
              <span className="text-green-500">✓</span> Pursuit briefs
            </li>
            <li className="flex items-center gap-1.5 text-ink-soft text-xs">
              <span className="text-green-500">✓</span> {tier === 'team' ? 'Shared pipeline + CRM' : 'Saved target list + outreach log'}
            </li>
            <li className="flex items-center gap-1.5 text-ink-soft text-xs">
              <span className="text-green-500">✓</span> Mindy Says AI narrative
            </li>
            <li className="flex items-center gap-1.5 text-ink-soft text-xs">
              <span className="text-green-500">✓</span> {tier === 'team' ? 'Team admin dashboard' : 'FHC live training'}
            </li>
            {tier === 'team' && (
              <li className="flex items-center gap-1.5 text-blue-300 text-xs font-medium">
                <span className="text-blue-400">★</span> Priority support
              </li>
            )}
            {tier === 'pro' && billingPeriod === 'annual' && (
              <>
                <li className="flex items-center gap-1.5 text-emerald-300 text-xs font-medium">
                  <span className="text-emerald-400">★</span> Priority support
                </li>
                <li className="flex items-center gap-1.5 text-emerald-300 text-xs font-medium">
                  <span className="text-emerald-400">★</span> Locked-in pricing
                </li>
              </>
            )}
            {tier === 'team' && billingPeriod === 'annual' && (
              <li className="flex items-center gap-1.5 text-emerald-300 text-xs font-medium">
                <span className="text-emerald-400">★</span> Locked-in pricing
              </li>
            )}
          </ul>

          <a
            href={
              tier === 'pro'
                ? (billingPeriod === 'monthly' ? CHECKOUT_MONTHLY : CHECKOUT_ANNUAL)
                : (billingPeriod === 'monthly' ? CHECKOUT_TEAM_MONTHLY : CHECKOUT_TEAM_ANNUAL)
            }
            className={`block w-full py-3 ${
              tier === 'pro'
                ? 'bg-purple-600 hover:bg-purple-500'
                : 'bg-blue-600 hover:bg-blue-500'
            } text-white font-bold text-base rounded-xl text-center transition-colors shadow-lg`}
          >
            {tier === 'pro'
              ? (billingPeriod === 'monthly' ? 'Upgrade to Pro — Monthly →' : 'Upgrade to Pro — Annual →')
              : (billingPeriod === 'monthly' ? 'Start Team — Monthly →' : 'Start Team — Annual →')}
          </a>
          <p className="text-center text-xs text-faint mt-2">
            Secure checkout via Stripe · Cancel anytime
          </p>
        </div>

        {/* Ultimate Bundle callout — keeps the existing copy
            but moves it under the new pricing card. */}
        <div className="mt-6 bg-surface/50 border border-hairline rounded-xl p-4 text-center">
          <p className="text-muted text-xs mb-1">Planning to go all-in?</p>
          <p className="text-white text-sm mb-2">
            The <span className="text-purple-400 font-medium">Ultimate Bundle ($1,497)</span> includes lifetime Mindy AI access.
          </p>
          <Link
            href="/bundles/ultimate"
            className="text-purple-400 hover:text-purple-300 text-xs font-medium"
          >
            Compare with Ultimate →
          </Link>
        </div>
      </div>

      {/* Pro vs. Team vs. Enterprise tier-card section removed
          May 22, 2026 per user. It duplicated the pricing toggle
          (Mindy Pro $149/mo) directly above and the Compare Plans
          table directly below — two pricing surfaces for the
          same tier created decision fatigue. Compare Plans table
          handles Pro / Team / Enterprise comparison; the toggle
          handles the Pro monthly/annual choice. Cleaner. */}

      {/* Tier Comparison Table */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-white text-center mb-4">Compare Plans</h2>
        <p className="text-muted text-center mb-10 max-w-2xl mx-auto">
          Pick the tier that fits your team. Save $700+/month vs. Deltek GovWin at every tier.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="text-left py-3 px-3 text-muted font-medium border-b border-hairline">Feature</th>
                <th className="py-3 px-3 text-center border-b border-hairline bg-purple-900/20">
                  <div className="text-white font-bold">Pro</div>
                  <div className="text-purple-400 text-xs">$149/mo</div>
                </th>
                <th className="py-3 px-3 text-center border-b border-hairline bg-blue-900/20">
                  <div className="text-white font-bold">Team</div>
                  <div className="text-blue-400 text-xs">$499/mo</div>
                </th>
                <th className="py-3 px-3 text-center border-b border-hairline bg-amber-900/20">
                  <div className="text-white font-bold">Enterprise</div>
                  <div className="text-amber-400 text-xs">Custom</div>
                </th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {/* User Seats */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">User Seats</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">1</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">5</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">Unlimited</td>
              </tr>
              {/* Market Research */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">Market Research Reports</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">10 • Unlimited</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">10 • Unlimited</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">10 • Unlimited</td>
              </tr>
              {/* Daily Alerts */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">Daily Alerts</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓ + AI</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓ + AI</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓ + AI</td>
              </tr>
              {/* AI Briefings */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">AI Briefings</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* Forecasts + SBIR + Grants */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">Forecasts, SBIR, Grants</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* Pipeline & CRM */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">Pipeline + CRM</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓ Shared</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓ Shared</td>
              </tr>
              {/* Content Reaper */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">Content Reaper</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* FHC Training */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">FHC Training</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓ All seats</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓ All seats</td>
              </tr>
              {/* Team Admin */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">Team Admin Dashboard</td>
                <td className="py-2.5 px-3 text-center text-slate-600 bg-purple-900/10">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* SSO */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">SSO / SAML</td>
                <td className="py-2.5 px-3 text-center text-slate-600 bg-purple-900/10">—</td>
                <td className="py-2.5 px-3 text-center text-slate-600 bg-blue-900/10">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* Custom Integrations */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">Custom Integrations</td>
                <td className="py-2.5 px-3 text-center text-slate-600 bg-purple-900/10">—</td>
                <td className="py-2.5 px-3 text-center text-slate-600 bg-blue-900/10">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* Support */}
              <tr className="border-b border-surface hover:bg-surface/30">
                <td className="py-2.5 px-3 text-ink-soft">Support</td>
                <td className="py-2.5 px-3 text-center text-ink-soft bg-purple-900/10">Email</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">Priority</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">Dedicated</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="py-4 px-3"></td>
                <td className="py-4 px-3 text-center bg-purple-900/10">
                  <a
                    href={CHECKOUT_MONTHLY}
                    className="inline-block px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition-colors text-xs"
                  >
                    Get Pro →
                  </a>
                </td>
                <td className="py-4 px-3 text-center bg-blue-900/10">
                  <a
                    href={CHECKOUT_TEAM_MONTHLY}
                    className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors text-xs"
                  >
                    Start Team →
                  </a>
                </td>
                <td className="py-4 px-3 text-center bg-amber-900/10">
                  <a
                    href="mailto:hello@getmindy.ai?subject=MI%20Enterprise%20Inquiry"
                    className="inline-block px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold transition-colors text-xs"
                  >
                    Contact Sales
                  </a>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Competitor Comparison */}
        <div className="mt-10 bg-surface/30 border border-hairline rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">💡</span>
            <h3 className="text-lg font-bold text-white">Why Mindy Pro vs. Deltek GovWin?</h3>
          </div>
          <div className="grid md:grid-cols-3 gap-6 text-sm">
            <div>
              <p className="text-purple-400 font-semibold mb-1">Mindy Pro: $149/mo</p>
              <p className="text-muted">AI-powered briefings, personalized by your NAICS + geography. Daily, weekly, and pursuit briefs with win probability scoring. Includes FHC training access.</p>
            </div>
            <div>
              <p className="text-faint font-semibold mb-1">Deltek GovWin: $800-1,200/mo</p>
              <p className="text-faint">Enterprise platform with extensive data. Overkill for small businesses. Requires training.</p>
            </div>
            <div>
              <p className="text-emerald-400 font-semibold mb-1">Your Savings: 85%+</p>
              <p className="text-muted">Get the intelligence you need at a fraction of the cost. Built for small GovCon firms, not enterprise.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing block moved above the comparison table —
          search "PRICING-TOGGLE" below the hero. This is the
          old footer, kept empty so the rest of the page flow
          isn't disturbed. */}

      {/* "Already have access" footer block — quieter version
          of the hero access form we removed. Existing customers
          who land here from a search engine or old email link
          still need a path to sign in; this puts that path at
          the bottom so it doesn't dilute the upgrade pitch. */}
      <div className="border-t border-surface bg-ground/30">
        <div className="max-w-3xl mx-auto px-4 py-10">
          <div className="bg-surface/50 border border-hairline rounded-xl p-5">
            <p className="text-ink-soft text-center text-sm mb-3">
              Already a Mindy Pro customer? Enter your purchase email to access your account.
            </p>
            <form onSubmit={handleVerifyAccess} className="flex gap-2 max-w-md mx-auto">
              <input
                ref={emailRef}
                type="email"
                placeholder="you@example.com"
                className="flex-1 px-3 py-2 bg-ground border border-hairline rounded-lg text-slate-200 placeholder-faint text-sm focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
              />
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-input hover:bg-slate-600 text-white rounded-lg font-semibold disabled:opacity-50 text-sm transition-colors"
              >
                {loading ? '...' : 'Access'}
              </button>
            </form>
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={handleSendSecureLink}
                disabled={sendingLink}
                className="text-xs text-purple-400 hover:text-purple-300 disabled:opacity-50"
              >
                {sendingLink ? 'Sending secure link...' : 'Email me a secure access link instead'}
              </button>
            </div>
            {error && <p className="text-red-400 text-xs mt-2 text-center">{error}</p>}
            {success && <p className="text-green-400 text-xs mt-2 text-center">{success}</p>}
            {redirecting && <p className="text-green-400 text-xs mt-2 text-center">Access verified! Redirecting...</p>}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-surface py-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-faint text-sm">
            <Link href="/" className="text-muted hover:text-white">
              ← Back to Tools
            </Link>
            <span className="mx-4">•</span>
            <Link href="/briefings" className="text-muted hover:text-white">
              View Dashboard
            </Link>
            <span className="mx-4">•</span>
            <a href="mailto:hello@getmindy.ai" className="text-muted hover:text-white">
              Support
            </a>
          </p>
          <p className="text-slate-600 text-xs mt-4">
            © {new Date().getFullYear()} GovCon Giants • getmindy.ai
          </p>
        </div>
      </div>
    </div>
  );
}

export default function MarketIntelligencePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950/20 to-slate-950 flex items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    }>
      <MarketIntelligenceContent />
    </Suspense>
  );
}
