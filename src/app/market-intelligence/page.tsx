'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { PRODUCTS } from '@/lib/products';

export default function MarketIntelligencePage() {
  const emailRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');

  const monthlyTier = PRODUCTS.DAILY_BRIEFINGS.tiers.briefings;
  const annualTier = PRODUCTS.DAILY_BRIEFINGS.tiers.briefings_annual;
  const annualSavings = monthlyTier.price * 12 - annualTier.price;

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

      setError('No access found for this email. Choose a plan below.');
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-5">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-5xl w-full shadow-2xl">
        <div className="text-center mb-8">
          <div className="mb-4 flex items-center justify-center gap-2">
            <span className="text-2xl font-bold text-blue-400">GovCon</span>
            <span className="text-2xl font-bold text-amber-400">Giants</span>
          </div>
          <h1 className="text-slate-100 mb-3 text-3xl font-bold">
            Market Intelligence
          </h1>
          <p className="text-slate-400 text-base leading-relaxed max-w-2xl mx-auto">
            Access daily briefs, weekly deep dives, and pursuit briefs personalized to your NAICS,
            target agencies, and capture priorities.
          </p>
        </div>

        {/* Video Demo */}
        <div className="mb-8 rounded-xl overflow-hidden border border-slate-700 bg-slate-900/50">
          <div className="aspect-video">
            <iframe
              src="https://player.vimeo.com/video/1181569155?badge=0&autopause=0&player_id=0&app_id=58479&title=0&byline=0&portrait=0"
              className="w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
              title="Market Intelligence Brief Settings"
            />
          </div>
          <div className="p-3 text-center border-t border-slate-700">
            <p className="text-sm text-slate-400">See how to configure your personalized briefings in under a minute</p>
          </div>
        </div>

        <div className="border border-slate-700 rounded-xl p-4 mb-8 bg-slate-900/50">
          <p className="text-slate-400 text-sm mb-3 text-center">Already purchased? Enter your email to access:</p>
          <form onSubmit={handleVerifyAccess} className="flex gap-2">
            <input
              ref={emailRef}
              type="email"
              placeholder="Enter your purchase email"
              className="flex-1 px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-slate-950 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? '...' : 'Access'}
            </button>
          </form>
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={handleSendSecureLink}
              disabled={sendingLink}
              className="text-sm text-cyan-300 hover:text-cyan-200 disabled:opacity-50"
            >
              {sendingLink ? 'Sending secure link...' : 'Email me a secure access link'}
            </button>
          </div>
          {error ? <p className="text-red-400 text-sm mt-3 text-center">{error}</p> : null}
          {success ? <p className="text-green-400 text-sm mt-3 text-center">{success}</p> : null}
          {redirecting ? <p className="text-green-400 text-sm mt-3 text-center">Access verified! Redirecting...</p> : null}
        </div>

        <div className="mb-8 rounded-2xl border border-amber-400/35 bg-gradient-to-r from-amber-500/15 to-orange-500/10 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Ultimate Shortcut</p>
              <p className="mt-1 text-lg font-semibold text-white">
                Ultimate Bundle includes lifetime Market Intelligence access
              </p>
              <p className="mt-1 text-sm text-slate-300">
                Planning to buy Ultimate? Skip this subscription and get Market Intelligence included for life.
              </p>
            </div>
            <div className="shrink-0">
              <Link
                href="/bundles/ultimate"
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 text-sm font-bold text-slate-950 transition hover:from-amber-400 hover:to-orange-400"
              >
                Compare with Ultimate →
              </Link>
            </div>
          </div>
        </div>

        <div className="max-w-sm mx-auto mb-6 inline-flex w-full justify-center rounded-full border border-slate-700 bg-slate-900/70 p-1 text-sm">
          <button
            type="button"
            onClick={() => setBilling('monthly')}
            className={`rounded-full px-4 py-2 transition ${billing === 'monthly' ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'}`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBilling('annual')}
            className={`rounded-full px-4 py-2 transition ${billing === 'annual' ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'}`}
          >
            Annual
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className={`border rounded-xl p-6 card-hover ${billing === 'monthly' ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-700 bg-slate-900/50'}`}>
            <div className="text-center mb-4">
              <span className="px-3 py-1 bg-cyan-500/20 text-cyan-300 text-sm font-bold rounded-full border border-cyan-500/30">Monthly</span>
              <div className="mt-3">
                <span className="text-4xl font-bold text-slate-100">${monthlyTier.price}</span>
                <span className="text-slate-400 ml-2">/ month</span>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-slate-300 mb-6">
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Daily opportunity brief</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Weekly deep dive analysis</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Weekly pursuit briefs</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Personalized by NAICS, agencies, and geography</li>
            </ul>
            <a
              href={monthlyTier.stripeUrl}
              className="block w-full text-center bg-cyan-500 hover:bg-cyan-600 text-slate-950 py-3 px-6 rounded-lg font-bold transition-all"
            >
              Start Monthly
            </a>
          </div>

          <div className={`border rounded-xl p-6 relative card-hover ${billing === 'annual' ? 'border-amber-500/60 bg-gradient-to-br from-amber-500/10 to-orange-500/10' : 'border-slate-700 bg-slate-900/50'}`}>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-full">
                BEST VALUE
              </span>
            </div>
            <div className="text-center mb-4 mt-1">
              <span className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold rounded-full">Annual</span>
              <div className="mt-3">
                <span className="text-4xl font-bold text-slate-100">${annualTier.price}</span>
                <span className="text-slate-400 ml-2">/ year</span>
              </div>
              <p className="mt-2 text-sm text-emerald-300">Save ${annualSavings} vs monthly</p>
            </div>
            <ul className="space-y-2 text-sm text-slate-300 mb-6">
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Everything in monthly access</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Lower annual effective rate</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Ideal for capture teams using the full program</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Direct access after Stripe purchase</li>
            </ul>
            <a
              href={annualTier.stripeUrl}
              className="block w-full text-center bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 py-3 px-6 rounded-lg font-bold transition-all"
            >
              Start Annual
            </a>
          </div>
        </div>

        <p className="text-slate-500 text-xs mt-6 text-center">
          <Link href="/" className="text-blue-400 hover:text-blue-300">
            ← Back to Tools
          </Link>
        </p>
      </div>
    </div>
  );
}
