'use client';

import Link from 'next/link';
import { useState } from 'react';
import { signInWithGoogle, signInWithMicrosoft } from '@/lib/supabase/auth';

// Send Mindy users into the new app experience.
const CHECKOUT_MONTHLY = 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C'; // $149/mo
const CHECKOUT_ANNUAL = 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D';  // $1,490/yr
const FREE_SIGNUP_URL = '/signup';
const DASHBOARD_URL = '/app';

export default function MindyLandingPage() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [oauthLoading, setOauthLoading] = useState<'google' | 'microsoft' | null>(null);

  async function handleGoogleSignup() {
    setOauthLoading('google');
    setError('');
    const result = await signInWithGoogle();
    if (!result.success) {
      setError(result.error || 'Could not connect with Google');
      setOauthLoading(null);
    }
    // Success path: Supabase redirects the browser to Google. No further work here.
  }

  async function handleMicrosoftSignup() {
    setOauthLoading('microsoft');
    setError('');
    const result = await signInWithMicrosoft();
    if (!result.success) {
      setError(result.error || 'Could not connect with Microsoft');
      setOauthLoading(null);
    }
  }

  // Handle free signup inline
  async function handleFreeSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!email || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/auth/mindy-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (data.success) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          {/* Mindy Logo/Icon */}
          <div className="inline-flex items-center gap-4 mb-8">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-xl shadow-purple-500/30">
              <span className="text-white font-bold text-4xl">M</span>
            </div>
          </div>

          <h1 className="text-5xl md:text-6xl font-bold text-white mb-4">
            Meet Mindy.
          </h1>
          <h2 className="text-2xl md:text-3xl text-purple-200 mb-6">
            Your 24/7 Federal Market Intelligence Analyst.
          </h2>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            While you sleep, Mindy scans 24,000+ federal opportunities, tracks your competitors,
            and delivers a personalized briefing before your first coffee.
          </p>

          {/* Inline Signup Form */}
          {!submitted ? (
            <div className="max-w-md mx-auto mb-8 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6 sm:p-8 shadow-2xl shadow-purple-900/20">
              {/* OAuth — faster path for new users with Google or Microsoft accounts */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleGoogleSignup}
                  disabled={oauthLoading !== null || isSubmitting}
                  className="w-full inline-flex items-center justify-center gap-3 px-5 py-3.5 bg-white hover:bg-slate-50 text-slate-800 rounded-xl font-medium text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  {oauthLoading === 'google' ? (
                    <span className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                  )}
                  Continue with Google
                </button>
                <button
                  type="button"
                  onClick={handleMicrosoftSignup}
                  disabled={oauthLoading !== null || isSubmitting}
                  className="w-full inline-flex items-center justify-center gap-3 px-5 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700"
                >
                  {oauthLoading === 'microsoft' ? (
                    <span className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 21 21">
                      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                    </svg>
                  )}
                  Continue with Microsoft
                </button>
              </div>

              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 bg-transparent text-slate-500 text-xs">or</span>
                </div>
              </div>

              <form onSubmit={handleFreeSignup} className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  aria-label="Email address"
                  className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500/50 text-base"
                />
                <button
                  type="submit"
                  disabled={isSubmitting || oauthLoading !== null}
                  className="w-full px-5 py-3.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold text-base shadow-lg shadow-purple-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Creating your briefing…' : 'Get Your First Briefing Free'}
                </button>
                {error && (
                  <p className="text-red-400 text-sm pt-1">{error}</p>
                )}
                <p className="text-slate-500 text-xs text-center pt-2">
                  Free forever · No credit card required
                </p>
              </form>
            </div>
          ) : (
            <div className="max-w-md mx-auto mb-8 bg-emerald-500/20 border border-emerald-500/50 rounded-xl p-6">
              <p className="text-emerald-400 font-semibold text-lg mb-2">Check your inbox!</p>
              <p className="text-slate-300">We sent a link to set up your password.</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <Link
              href={CHECKOUT_MONTHLY}
              className="px-8 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
            >
              Go Pro — $149/mo
            </Link>
            <span className="text-slate-500 hidden sm:inline">or</span>
            <Link
              href={CHECKOUT_ANNUAL}
              className="text-purple-400 hover:text-purple-300 font-semibold"
            >
              Save $298/yr with annual →
            </Link>
          </div>

          <p className="text-slate-400 text-sm">
            Trusted by 500+ small businesses chasing federal contracts
          </p>

          {/* Already have access link */}
          <div className="mt-8">
            <Link
              href={DASHBOARD_URL}
              className="text-purple-400 hover:text-purple-300 text-sm"
            >
              Already have access? Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="max-w-4xl mx-auto px-4 py-20">
        <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-6">
          The Big Contractors Have Armies.<br />
          <span className="text-purple-400">You Have... Spreadsheets.</span>
        </h2>

        <div className="grid md:grid-cols-3 gap-6 mt-10">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-purple-400 mb-2">47</div>
            <p className="text-slate-300">People in Lockheed&apos;s BD department</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-purple-400 mb-2">$2M</div>
            <p className="text-slate-300">Booz Allen spends on market intel tools</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-purple-400 mb-2">You?</div>
            <p className="text-slate-300">Scrolling SAM.gov on Sunday nights</p>
          </div>
        </div>

        <div className="mt-10 bg-slate-800/30 border border-slate-700 rounded-xl p-8">
          <h3 className="text-xl font-bold text-white mb-4">The math doesn&apos;t work:</h3>
          <ul className="space-y-3 text-slate-300">
            <li className="flex items-center gap-3">
              <span className="text-red-400">•</span>
              <span><strong>1,500+</strong> new opportunities posted daily</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="text-red-400">•</span>
              <span><strong>15+</strong> government websites to monitor</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="text-red-400">•</span>
              <span><strong>$750 billion</strong> in annual federal spending</span>
            </li>
          </ul>
          <p className="mt-6 text-xl text-white font-semibold">
            No human can track it all. <span className="text-purple-400">But Mindy can.</span>
          </p>
        </div>
      </section>

      {/* What Mindy Does */}
      <section className="bg-slate-900/50 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Everything a $150K Capture Manager Does.
          </h2>
          <p className="text-xl text-purple-400 text-center mb-12">
            For less than your coffee budget.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🔍</span>
                <h3 className="text-lg font-bold text-white">Find Opportunities</h3>
              </div>
              <p className="text-slate-300">
                Scans SAM.gov, Grants.gov, agency forecasts, and 10+ sources — every single day.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">📅</span>
                <h3 className="text-lg font-bold text-white">Know What&apos;s Coming</h3>
              </div>
              <p className="text-slate-300">
                Tracks 7,600+ forecasts so you&apos;re ready before it posts.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🏆</span>
                <h3 className="text-lg font-bold text-white">Track Competitors</h3>
              </div>
              <p className="text-slate-300">
                Shows who&apos;s winning in your space and when their contracts expire.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🎯</span>
                <h3 className="text-lg font-bold text-white">Never Miss Deadlines</h3>
              </div>
              <p className="text-slate-300">
                Personalized alerts based on YOUR NAICS codes and capabilities.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 md:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">📊</span>
                <h3 className="text-lg font-bold text-white">Understand the Market</h3>
              </div>
              <p className="text-slate-300">
                Weekly deep dives on spending patterns, set-asides, and trends in your space.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-4xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-white text-center mb-12">
          From Signup to Briefing in 3 Minutes
        </h2>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-purple-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-white">1</div>
            <h3 className="text-lg font-bold text-white mb-2">Tell Mindy About Your Business</h3>
            <p className="text-slate-400">Your NAICS codes, target agencies, set-aside status. Takes 2 minutes.</p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-purple-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-white">2</div>
            <h3 className="text-lg font-bold text-white mb-2">Wake Up to Intelligence</h3>
            <p className="text-slate-400">Every morning, Mindy delivers opportunities matched to YOUR profile.</p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-purple-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-white">3</div>
            <h3 className="text-lg font-bold text-white mb-2">Go Win Contracts</h3>
            <p className="text-slate-400">Spend your time on proposals, not searching. Mindy handles the hunting.</p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="bg-slate-900/50 py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">
            Finally, Enterprise Intelligence at Small Business Prices
          </h2>
          <p className="text-slate-400 text-center mb-12">
            The tagline says it all: The big contractors have armies. You have Mindy.
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Free */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8">
              <h3 className="text-xl font-bold text-white mb-2">Free</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold text-white">$0</span>
                <span className="text-slate-400">/mo</span>
              </div>
              <p className="text-slate-400 text-sm mb-6">Start finding opportunities today</p>

              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Daily opportunity digest</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>5 NAICS codes</span>
                </li>
                <li className="flex items-start gap-2 text-slate-500 text-sm">
                  <span className="mt-0.5">—</span>
                  <span>No AI analysis</span>
                </li>
              </ul>

              <Link
                href={FREE_SIGNUP_URL}
                className="block w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl text-center transition-colors"
              >
                Start Free
              </Link>
            </div>

            {/* Pro - Most Popular */}
            <div className="bg-gradient-to-br from-purple-900/50 to-slate-800 border-2 border-purple-500 rounded-2xl p-8 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-purple-500 text-white text-xs font-bold px-4 py-1 rounded-full">MOST POPULAR</span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Pro</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold text-white">$149</span>
                <span className="text-slate-400">/mo</span>
              </div>
              <p className="text-purple-300 text-sm mb-6">The $150K capture manager in your pocket</p>

              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Full daily briefings with AI analysis</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Unlimited NAICS codes</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Competitor tracking</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Recompete alerts</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Weekly deep dives</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Pursuit briefs</span>
                </li>
              </ul>

              <Link
                href={CHECKOUT_MONTHLY}
                className="block w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-center transition-colors shadow-lg shadow-purple-500/25"
              >
                Get Mindy Pro
              </Link>
            </div>

            {/* Teams */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8">
              <h3 className="text-xl font-bold text-white mb-2">Teams</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold text-white">$499</span>
                <span className="text-slate-400">/mo</span>
              </div>
              <p className="text-slate-400 text-sm mb-6">For growing contractors with BD teams</p>

              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Everything in Pro</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Multiple users</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Shared pipeline</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Team dashboard</span>
                </li>
              </ul>

              <Link
                href="mailto:hello@getmindy.ai?subject=Mindy%20Teams%20Inquiry"
                className="block w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl text-center transition-colors"
              >
                Contact Sales
              </Link>
            </div>
          </div>

          {/* Annual Option */}
          <div className="mt-8 bg-slate-800/50 border border-purple-500/30 rounded-xl p-6 text-center">
            <p className="text-white font-medium mb-2">
              <span className="text-purple-400">Save $298</span> with annual billing
            </p>
            <p className="text-slate-400 text-sm mb-4">
              Pay $1,490/year instead of $1,788 (2 months free)
            </p>
            <Link
              href={CHECKOUT_ANNUAL}
              className="inline-block px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition-colors"
            >
              Get Annual Plan
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="max-w-3xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-white text-center mb-12">
          Questions? Mindy Has Answers.
        </h2>

        <div className="space-y-6">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">How is this different from SAM.gov alerts?</h3>
            <p className="text-slate-300">
              SAM.gov sends you everything that matches a keyword. Mindy learns your business and sends you
              what actually matters — with context on competition, incumbents, and why this opportunity fits you.
            </p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">I already have a BD person. Why do I need Mindy?</h3>
            <p className="text-slate-300">
              Mindy doesn&apos;t replace your BD team — she supercharges them. She handles the 20 hours/week
              of searching so your people can focus on relationships and proposals.
            </p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">What if I&apos;m brand new to federal contracting?</h3>
            <p className="text-slate-300">
              Perfect. Mindy explains opportunities in plain English and tells you exactly what you
              need to compete. She&apos;s like having a mentor who never sleeps.
            </p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">Can Mindy help me write proposals?</h3>
            <p className="text-slate-300">
              Not yet — but she&apos;ll tell you which opportunities are worth writing proposals for.
              That&apos;s half the battle.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            The Big Contractors Won&apos;t Share Their Secrets.
            <span className="text-purple-400 block mt-2">Mindy Will.</span>
          </h2>
          <p className="text-xl text-slate-300 mb-8">
            Every day you&apos;re searching manually is a day you&apos;re falling behind.
            The contractors winning federal work aren&apos;t smarter than you — they just have better intelligence.
          </p>
          <p className="text-2xl text-white font-semibold mb-8">
            Now you do too.
          </p>

          <Link
            href={FREE_SIGNUP_URL}
            className="inline-block px-10 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
          >
            Meet Mindy — Get Your First Briefing Free
          </Link>
        </div>
      </section>

      {/* Footer - Clean Mindy branding */}
      <footer className="border-t border-slate-800 py-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="text-white font-semibold">Mindy</span>
          </div>
          <p className="text-slate-500 text-sm mb-4">
            <a href="tel:7864770477" className="text-slate-400 hover:text-white transition">786-477-0477</a>
            <span className="mx-4">•</span>
            <a href="mailto:hello@getmindy.ai" className="text-slate-400 hover:text-white transition">hello@getmindy.ai</a>
            <span className="mx-4">•</span>
            <Link href="/privacy-policy" className="text-slate-400 hover:text-white transition">Privacy</Link>
            <span className="mx-4">•</span>
            <Link href="/terms" className="text-slate-400 hover:text-white transition">Terms</Link>
          </p>
          <p className="text-slate-600 text-xs">
            © 2026 Mindy AI
          </p>
          <p className="text-slate-700 text-xs mt-2 italic">
            &quot;The big contractors have armies. You have Mindy.&quot;
          </p>
        </div>
      </footer>
    </main>
  );
}
