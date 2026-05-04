'use client';

import { useRef, useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const CHECKOUT_MONTHLY = 'https://buy.stripe.com/00wfZigjc97ceND3OEfnO0z';
const CHECKOUT_ANNUAL = 'https://buy.stripe.com/aFa6oI6ICdns0WN5WMfnO0A';
const FREE_SIGNUP_URL = '/briefings?setup=free'; // Free tier setup flow

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
              <p className="text-slate-400 text-sm">Get daily opportunity alerts + market research tools</p>
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

      {/* What's Included */}
      <div className="max-w-4xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-white text-center mb-10">What&apos;s Included</h2>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center mb-4">
              <span className="text-2xl">📋</span>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Daily Brief</h3>
            <p className="text-slate-400 text-sm">
              Ranked opportunities with urgency indicators, agency signals, and recommended next actions.
              Delivered every morning by email.
            </p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center mb-4">
              <span className="text-2xl">📊</span>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Weekly Deep Dive</h3>
            <p className="text-slate-400 text-sm">
              Strategic analysis of market movement, teaming opportunities, and emerging agency priorities.
              Delivered every Sunday.
            </p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center mb-4">
              <span className="text-2xl">🎯</span>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Pursuit Brief</h3>
            <p className="text-slate-400 text-sm">
              Capture-focused guidance for your top targets. Incumbent analysis, win themes, and next-step actions.
              Delivered every Monday.
            </p>
          </div>
        </div>

        {/* Additional Features */}
        <div className="mt-10 grid md:grid-cols-2 gap-4">
          <div className="flex items-start gap-3 text-slate-300">
            <span className="w-6 h-6 rounded-full bg-purple-600/30 flex items-center justify-center text-purple-400 text-sm flex-shrink-0 mt-0.5">✓</span>
            <span>Personalized by your NAICS codes, agencies, and geography</span>
          </div>
          <div className="flex items-start gap-3 text-slate-300">
            <span className="w-6 h-6 rounded-full bg-purple-600/30 flex items-center justify-center text-purple-400 text-sm flex-shrink-0 mt-0.5">✓</span>
            <span>Dashboard access with search, filters, and CSV export</span>
          </div>
          <div className="flex items-start gap-3 text-slate-300">
            <span className="w-6 h-6 rounded-full bg-purple-600/30 flex items-center justify-center text-purple-400 text-sm flex-shrink-0 mt-0.5">✓</span>
            <span>Access to Forecasts, SBIR, and Grants tabs</span>
          </div>
          <div className="flex items-start gap-3 text-slate-300">
            <span className="w-6 h-6 rounded-full bg-purple-600/30 flex items-center justify-center text-purple-400 text-sm flex-shrink-0 mt-0.5">✓</span>
            <span>30-day briefing history with full archive</span>
          </div>
        </div>
      </div>

      {/* Tier Comparison Table */}
      <div className="max-w-5xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-white text-center mb-4">Compare Plans</h2>
        <p className="text-slate-400 text-center mb-10 max-w-2xl mx-auto">
          Start free and upgrade when you need AI-powered intelligence. Save $700+/month vs. Deltek GovWin.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left py-4 px-4 text-slate-400 font-medium border-b border-slate-700">Feature</th>
                <th className="py-4 px-4 text-center border-b border-slate-700">
                  <div className="text-white font-bold">MI Free</div>
                  <div className="text-emerald-400 text-sm font-semibold">$0/mo</div>
                </th>
                <th className="py-4 px-4 text-center border-b border-slate-700 bg-purple-900/20">
                  <div className="text-white font-bold">MI Pro</div>
                  <div className="text-purple-400 text-sm font-semibold">$149/mo</div>
                </th>
                <th className="py-4 px-4 text-center border-b border-slate-700">
                  <div className="text-white font-bold">MI Team</div>
                  <div className="text-blue-400 text-sm font-semibold">$499/mo</div>
                </th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {/* Daily Alerts */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Daily Opportunity Alerts</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
              </tr>
              {/* Opportunity Hunter */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Opportunity Hunter (Market Research)</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
              </tr>
              {/* Alert Type */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Alert Type</td>
                <td className="py-3 px-4 text-center text-slate-400">Simple list</td>
                <td className="py-3 px-4 text-center text-purple-400 bg-purple-900/10 font-medium">AI-ranked with win probability</td>
                <td className="py-3 px-4 text-center text-purple-400 font-medium">AI-ranked with win probability</td>
              </tr>
              {/* Daily Brief */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Daily AI Brief (Prioritized + Analysis)</td>
                <td className="py-3 px-4 text-center text-slate-600">—</td>
                <td className="py-3 px-4 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
              </tr>
              {/* Weekly Deep Dive */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Weekly Deep Dive (Market Movement)</td>
                <td className="py-3 px-4 text-center text-slate-600">—</td>
                <td className="py-3 px-4 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
              </tr>
              {/* Pursuit Brief */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Pursuit Brief (Capture Guidance)</td>
                <td className="py-3 px-4 text-center text-slate-600">—</td>
                <td className="py-3 px-4 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
              </tr>
              {/* Dashboard */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Full Dashboard (Search, Export, Archive)</td>
                <td className="py-3 px-4 text-center text-slate-600">—</td>
                <td className="py-3 px-4 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
              </tr>
              {/* Forecasts */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Forecasts (7,700+ Upcoming)</td>
                <td className="py-3 px-4 text-center text-slate-600">—</td>
                <td className="py-3 px-4 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
              </tr>
              {/* SBIR/STTR */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">SBIR/STTR R&D Opportunities</td>
                <td className="py-3 px-4 text-center text-slate-600">—</td>
                <td className="py-3 px-4 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
              </tr>
              {/* Grants */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Grants.gov Integration ($700B+)</td>
                <td className="py-3 px-4 text-center text-slate-600">—</td>
                <td className="py-3 px-4 text-center text-emerald-400 bg-purple-900/10">✓</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
              </tr>
              {/* Team Seats */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Team Seats</td>
                <td className="py-3 px-4 text-center text-slate-400">1</td>
                <td className="py-3 px-4 text-center text-slate-400 bg-purple-900/10">1</td>
                <td className="py-3 px-4 text-center text-blue-400 font-medium">5 seats</td>
              </tr>
              {/* Shared Pipeline */}
              <tr className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-3 px-4 text-slate-300">Shared Pipeline & CRM</td>
                <td className="py-3 px-4 text-center text-slate-600">—</td>
                <td className="py-3 px-4 text-center text-slate-600 bg-purple-900/10">—</td>
                <td className="py-3 px-4 text-center text-emerald-400">✓</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="py-6 px-4"></td>
                <td className="py-6 px-4 text-center">
                  <a
                    href={FREE_SIGNUP_URL}
                    className="inline-block px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-colors"
                  >
                    Start Free
                  </a>
                </td>
                <td className="py-6 px-4 text-center bg-purple-900/10">
                  <a
                    href={CHECKOUT_MONTHLY}
                    className="inline-block px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition-colors"
                  >
                    Get Pro →
                  </a>
                </td>
                <td className="py-6 px-4 text-center">
                  <a
                    href="mailto:service@govcongiants.com?subject=MI%20Team%20Plan"
                    className="inline-block px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors"
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
            <h3 className="text-lg font-bold text-white">Why MI Pro vs. Deltek GovWin?</h3>
          </div>
          <div className="grid md:grid-cols-3 gap-6 text-sm">
            <div>
              <p className="text-purple-400 font-semibold mb-1">MI Pro: $149/mo</p>
              <p className="text-slate-400">AI-powered briefings, personalized by your NAICS + geography. Daily, weekly, and pursuit briefs with win probability scoring.</p>
            </div>
            <div>
              <p className="text-slate-500 font-semibold mb-1">Deltek GovWin: $800-1,200/mo</p>
              <p className="text-slate-500">Enterprise platform with extensive data. Overkill for small businesses. Requires training.</p>
            </div>
            <div>
              <p className="text-emerald-400 font-semibold mb-1">Your Savings: $700+/mo</p>
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
              <p className="text-slate-500 text-sm mt-1 line-through">$299/mo value</p>
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
          <a
            href="/pricing"
            className="text-purple-400 hover:text-purple-300 text-sm font-medium"
          >
            Compare with Ultimate →
          </a>
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
