'use client';

import { useRef, useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

// Public pricing (anchor price)
const CHECKOUT_MONTHLY = 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C'; // $149/mo
const CHECKOUT_ANNUAL = 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D';  // $1,490/yr

// Private loyalty pricing (for email campaigns to past customers only - NOT shown on public page)
// const CHECKOUT_LOYALTY_MONTHLY = 'https://buy.stripe.com/00wfZigjc97ceND3OEfnO0z'; // $49/mo
// const CHECKOUT_LOYALTY_ANNUAL = 'https://buy.stripe.com/aFa6oI6ICdns0WN5WMfnO0A';  // $497/yr

const FREE_SIGNUP_URL = '/alerts/signup'; // MI Free tier setup flow (alerts only)

function MarketIntelligenceContent() {
  const searchParams = useSearchParams();
  const emailRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const [verifyingInvite, setVerifyingInvite] = useState(false);

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

          // Store email for briefings dashboard
          localStorage.setItem('briefings_access_email', email);

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
        localStorage.setItem('briefings_access_email', email);
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

      setSuccess('Secure link sent. Check your email to open Market Intelligence.');
    } catch {
      setError('Could not send secure link. Please try again.');
    } finally {
      setSendingLink(false);
    }
  };

  // Show loading state when verifying invite token
  if (verifyingInvite || (searchParams.get('invite') && !error)) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-500/30">
            <span className="text-white font-bold text-2xl">MI</span>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            {redirecting ? 'Access Granted!' : 'Verifying Your Invitation...'}
          </h2>
          <p className="text-slate-400">
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
    <div className="min-h-screen bg-slate-950">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <span className="text-white font-bold text-2xl">MI</span>
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Market Intelligence
          </h1>
          <p className="text-xl text-purple-200 mb-2">
            Know what matters before your competitors do.
          </p>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Daily briefs that prioritize your opportunities. Weekly deep dives on market movement.
            Pursuit briefs that turn targets into capture plans.
          </p>

          {/* Free Tier CTA */}
          <div className="mt-8 inline-flex items-center gap-4 bg-slate-800/50 border border-slate-700 rounded-xl px-6 py-4">
            <div className="text-left">
              <p className="text-white font-semibold">Start Free — No Credit Card Required</p>
              <p className="text-slate-400 text-sm">Market Research (4 reports, 5/mo) + Daily Alerts</p>
            </div>
            <a
              href={FREE_SIGNUP_URL}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold whitespace-nowrap transition-colors"
            >
              Start Free →
            </a>
          </div>
        </div>
      </div>

      {/* Access Check Section */}
      <div className="max-w-4xl mx-auto px-4 -mt-8">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-xl">
          <p className="text-slate-300 text-center mb-4">Already have access? Enter your email:</p>
          <form onSubmit={handleVerifyAccess} className="flex gap-2 max-w-xl mx-auto">
            <input
              ref={emailRef}
              type="email"
              placeholder="Enter your purchase email"
              className="flex-1 px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold disabled:opacity-50 transition-all"
            >
              {loading ? '...' : 'Access'}
            </button>
          </form>
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={handleSendSecureLink}
              disabled={sendingLink}
              className="text-sm text-purple-400 hover:text-purple-300 disabled:opacity-50"
            >
              {sendingLink ? 'Sending secure link...' : 'Email me a secure access link'}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm mt-3 text-center">{error}</p>}
          {success && <p className="text-green-400 text-sm mt-3 text-center">{success}</p>}
          {redirecting && <p className="text-green-400 text-sm mt-3 text-center">Access verified! Redirecting...</p>}
        </div>
      </div>

      {/* What's Included - Three Tier Cards */}
      <div className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-white text-center mb-4">Choose Your Plan</h2>
        <p className="text-slate-400 text-center mb-10">Start free, upgrade when you need AI-powered intelligence</p>

        <div className="grid md:grid-cols-3 gap-6">
          {/* MI Free Card */}
          <div className="bg-slate-800/50 border-2 border-slate-600/50 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-slate-500/20 rounded-xl flex items-center justify-center">
                <span className="text-xl">🆓</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Mindy Free</h3>
                <p className="text-slate-400 font-semibold">$0/month</p>
              </div>
            </div>

            <div className="space-y-2 mb-6 text-sm">
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span><strong>4 Market Research</strong> reports</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span><strong>Daily Alerts</strong> — simple list</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span>5 reports/month limit</span>
              </div>
              <div className="flex items-start gap-2 text-slate-500">
                <span className="mt-0.5">—</span>
                <span>No AI briefings</span>
              </div>
            </div>

            <a
              href={FREE_SIGNUP_URL}
              className="block w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-center rounded-lg font-semibold transition-colors text-sm"
            >
              Start Free →
            </a>
          </div>

          {/* MI Pro Card - Most Popular */}
          <div className="bg-slate-800/50 border-2 border-purple-500 rounded-2xl p-6 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-purple-500 to-purple-600 text-white text-xs font-bold px-3 py-1 rounded-full">
              MOST POPULAR
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center">
                <span className="text-xl">🚀</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Mindy Pro</h3>
                <p className="text-purple-400 font-semibold text-xl">$149/mo</p>
              </div>
            </div>

            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-3 py-1.5 mb-4 text-center">
              <p className="text-purple-400 text-xs font-medium">+ FHC training included</p>
            </div>

            <div className="space-y-2 mb-6 text-sm">
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span><strong>All 10 reports</strong> unlimited</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span><strong>AI Briefings</strong> — Daily + Weekly + Pursuit</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span>Forecasts, SBIR, Grants</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span>Pipeline + CRM + Content</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span>1 user seat</span>
              </div>
            </div>

            <a
              href={CHECKOUT_MONTHLY}
              className="block w-full py-2.5 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white text-center rounded-lg font-semibold transition-all shadow-lg shadow-purple-500/25 text-sm"
            >
              Get Pro — $149/mo
            </a>
          </div>

          {/* MI Team Card */}
          <div className="bg-slate-800/50 border-2 border-blue-500/50 rounded-2xl p-6 relative">
            <div className="absolute -top-3 right-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
              MID-SIZE FIRMS
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center">
                <span className="text-xl">👥</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Mindy Team</h3>
                <p className="text-blue-400 font-semibold text-xl">$499/mo</p>
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-1.5 mb-4 text-center">
              <p className="text-blue-400 text-xs font-medium">5 team members included</p>
            </div>

            <div className="space-y-2 mb-6 text-sm">
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span><strong>Everything in Pro</strong></span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span><strong>5 user seats</strong></span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span>Shared pipeline & CRM</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span>Team admin dashboard</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span>Priority support</span>
              </div>
            </div>

            <a
              href="mailto:service@govcongiants.com?subject=MI%20Team%20Inquiry"
              className="block w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-center rounded-lg font-semibold transition-colors text-sm"
            >
              Contact Sales →
            </a>
          </div>
        </div>

        {/* Enterprise Callout */}
        <div className="mt-8 bg-gradient-to-r from-amber-900/30 to-amber-800/20 border border-amber-500/30 rounded-xl p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center">
                <span className="text-2xl">🏢</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">MI Enterprise</h3>
                <p className="text-amber-400 text-sm">Custom solutions for large contractors</p>
              </div>
            </div>
            <div className="text-center md:text-right">
              <p className="text-slate-400 text-sm mb-2">Unlimited seats • SSO • Dedicated support • Custom integrations</p>
              <a
                href="mailto:service@govcongiants.com?subject=MI%20Enterprise%20Inquiry"
                className="inline-block px-6 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold transition-colors text-sm"
              >
                Talk to Sales →
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Tier Comparison Table */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-white text-center mb-4">Compare Plans</h2>
        <p className="text-slate-400 text-center mb-10 max-w-2xl mx-auto">
          Start free and upgrade when you need AI-powered intelligence. Save $700+/month vs. Deltek GovWin.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="text-left py-3 px-3 text-slate-400 font-medium border-b border-slate-700">Feature</th>
                <th className="py-3 px-3 text-center border-b border-slate-700">
                  <div className="text-white font-bold">Free</div>
                  <div className="text-slate-400 text-xs">$0/mo</div>
                </th>
                <th className="py-3 px-3 text-center border-b border-slate-700 bg-purple-900/20">
                  <div className="text-white font-bold">Pro</div>
                  <div className="text-purple-400 text-xs">$149/mo</div>
                </th>
                <th className="py-3 px-3 text-center border-b border-slate-700 bg-blue-900/20">
                  <div className="text-white font-bold">Team</div>
                  <div className="text-blue-400 text-xs">$499/mo</div>
                </th>
                <th className="py-3 px-3 text-center border-b border-slate-700 bg-amber-900/20">
                  <div className="text-white font-bold">Enterprise</div>
                  <div className="text-amber-400 text-xs">Custom</div>
                </th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {/* User Seats */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">User Seats</td>
                <td className="py-2.5 px-3 text-center text-slate-400">1</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">1</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">5</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">Unlimited</td>
              </tr>
              {/* Market Research */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">Market Research Reports</td>
                <td className="py-2.5 px-3 text-center text-emerald-400">4 • 5/mo</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">10 • Unlimited</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">10 • Unlimited</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">10 • Unlimited</td>
              </tr>
              {/* Daily Alerts */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">Daily Alerts</td>
                <td className="py-2.5 px-3 text-center text-emerald-400">✓ Basic</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓ + AI</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓ + AI</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓ + AI</td>
              </tr>
              {/* AI Briefings */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">AI Briefings</td>
                <td className="py-2.5 px-3 text-center text-slate-600">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* Forecasts + SBIR + Grants */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">Forecasts, SBIR, Grants</td>
                <td className="py-2.5 px-3 text-center text-slate-600">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* Pipeline & CRM */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">Pipeline + CRM</td>
                <td className="py-2.5 px-3 text-center text-slate-600">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓ Shared</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓ Shared</td>
              </tr>
              {/* Content Reaper */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">Content Reaper</td>
                <td className="py-2.5 px-3 text-center text-slate-600">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* FHC Training */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">FHC Training</td>
                <td className="py-2.5 px-3 text-center text-slate-600">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓ All seats</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓ All seats</td>
              </tr>
              {/* Team Admin */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">Team Admin Dashboard</td>
                <td className="py-2.5 px-3 text-center text-slate-600">—</td>
                <td className="py-2.5 px-3 text-center text-slate-600 bg-purple-900/10">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">✓</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* SSO */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">SSO / SAML</td>
                <td className="py-2.5 px-3 text-center text-slate-600">—</td>
                <td className="py-2.5 px-3 text-center text-slate-600 bg-purple-900/10">—</td>
                <td className="py-2.5 px-3 text-center text-slate-600 bg-blue-900/10">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* Custom Integrations */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">Custom Integrations</td>
                <td className="py-2.5 px-3 text-center text-slate-600">—</td>
                <td className="py-2.5 px-3 text-center text-slate-600 bg-purple-900/10">—</td>
                <td className="py-2.5 px-3 text-center text-slate-600 bg-blue-900/10">—</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">✓</td>
              </tr>
              {/* Support */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-300">Support</td>
                <td className="py-2.5 px-3 text-center text-slate-400">Email</td>
                <td className="py-2.5 px-3 text-center text-slate-300 bg-purple-900/10">Email</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-blue-900/10">Priority</td>
                <td className="py-2.5 px-3 text-center text-emerald-400 bg-amber-900/10">Dedicated</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="py-4 px-3"></td>
                <td className="py-4 px-3 text-center">
                  <a
                    href={FREE_SIGNUP_URL}
                    className="inline-block px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-colors text-xs"
                  >
                    Start Free
                  </a>
                </td>
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
                    href="mailto:service@govcongiants.com?subject=MI%20Team%20Inquiry"
                    className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors text-xs"
                  >
                    Contact Sales
                  </a>
                </td>
                <td className="py-4 px-3 text-center bg-amber-900/10">
                  <a
                    href="mailto:service@govcongiants.com?subject=MI%20Enterprise%20Inquiry"
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
        <div className="mt-10 bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">💡</span>
            <h3 className="text-lg font-bold text-white">Why Mindy Pro vs. Deltek GovWin?</h3>
          </div>
          <div className="grid md:grid-cols-3 gap-6 text-sm">
            <div>
              <p className="text-purple-400 font-semibold mb-1">Mindy Pro: $149/mo</p>
              <p className="text-slate-400">AI-powered briefings, personalized by your NAICS + geography. Daily, weekly, and pursuit briefs with win probability scoring. Includes FHC training access.</p>
            </div>
            <div>
              <p className="text-slate-500 font-semibold mb-1">Deltek GovWin: $800-1,200/mo</p>
              <p className="text-slate-500">Enterprise platform with extensive data. Overkill for small businesses. Requires training.</p>
            </div>
            <div>
              <p className="text-emerald-400 font-semibold mb-1">Your Savings: 85%+</p>
              <p className="text-slate-400">Get the intelligence you need at a fraction of the cost. Built for small GovCon firms, not enterprise.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Section */}
      <div className="max-w-4xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-white text-center mb-10">Choose Your Plan</h2>
        <div className="grid md:grid-cols-2 gap-6">
          {/* Monthly */}
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 hover:border-purple-500/50 transition-colors">
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold text-white mb-2">Monthly</h3>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-4xl font-bold text-white">$149</span>
                <span className="text-slate-400">/mo</span>
              </div>
              <p className="text-slate-500 text-sm mt-1">Includes FHC training access</p>
            </div>
            <ul className="space-y-3 mb-8">
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> Daily market intelligence brief
              </li>
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> Weekly deep dive analysis
              </li>
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> Pursuit briefs with capture guidance
              </li>
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> Full dashboard access
              </li>
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> FHC live training sessions
              </li>
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> Cancel anytime
              </li>
            </ul>
            <a
              href={CHECKOUT_MONTHLY}
              className="block w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-center transition-colors"
            >
              Start Monthly →
            </a>
          </div>

          {/* Annual */}
          <div className="bg-gradient-to-br from-purple-900/50 to-slate-800 border-2 border-purple-500 rounded-2xl p-8 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="bg-purple-500 text-white text-xs font-bold px-4 py-1 rounded-full">BEST VALUE</span>
            </div>
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold text-white mb-2">Annual</h3>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-4xl font-bold text-white">$1,490</span>
                <span className="text-slate-400">/yr</span>
              </div>
              <p className="text-green-400 text-sm mt-1 font-medium">Save $298 vs monthly (2 months free)</p>
            </div>
            <ul className="space-y-3 mb-8">
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> Everything in Monthly
              </li>
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> 2 months free
              </li>
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> Priority support
              </li>
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> Locked-in pricing
              </li>
              <li className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-green-500">✓</span> Best for serious capture teams
              </li>
            </ul>
            <a
              href={CHECKOUT_ANNUAL}
              className="block w-full py-3 bg-white hover:bg-slate-100 text-purple-700 font-semibold rounded-xl text-center transition-colors"
            >
              Start Annual →
            </a>
          </div>
        </div>

        {/* Ultimate Bundle Callout */}
        <div className="mt-8 bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm mb-2">Planning to go all-in?</p>
          <p className="text-white font-medium mb-3">
            The <span className="text-purple-400">Ultimate Bundle ($1,497)</span> includes lifetime Market Intelligence access.
          </p>
          <Link
            href="/bundles/ultimate"
            className="text-purple-400 hover:text-purple-300 text-sm font-medium"
          >
            Compare with Ultimate →
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-800 py-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-slate-500 text-sm">
            <Link href="/" className="text-slate-400 hover:text-white">
              ← Back to Tools
            </Link>
            <span className="mx-4">•</span>
            <Link href="/briefings" className="text-slate-400 hover:text-white">
              View Dashboard
            </Link>
            <span className="mx-4">•</span>
            <a href="mailto:service@govcongiants.com" className="text-slate-400 hover:text-white">
              Support
            </a>
          </p>
          <p className="text-slate-600 text-xs mt-4">
            © {new Date().getFullYear()} GovCon Giants • mi.govcongiants.com
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
        <div className="text-slate-400">Loading...</div>
      </div>
    }>
      <MarketIntelligenceContent />
    </Suspense>
  );
}
