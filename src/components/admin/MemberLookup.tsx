'use client';

import { useState } from 'react';

/**
 * Member Lookup — Command Center panel for inbound inquiries.
 * Staff type an email → see live-Stripe lifetime spend, Ultimate Giant ownership
 * (the minimum requirement), current access, and a recommended offer. View-only.
 */

interface LookupResult {
  success: boolean;
  message?: string;
  email: string;
  found: boolean;
  company: string | null;
  paid: { lifetimeUsd: number; chargeCount: number; lastCharge: string | null; products: string[]; stripeCustomers: number };
  ultimateGiant: { owns: boolean; signals: string[] };
  access: {
    appPro: boolean; appProSource: string; briefingsExpiry: string | null;
    briefingEligible: boolean; entitlementTier: string | null; classification: string | null;
    isActive: boolean; briefingsEnabled: boolean;
  };
  account: { invitationSource: string | null; trialSource: string | null; joined: string | null };
  flags: { advocate: boolean; comp: boolean; internal: boolean; test: boolean };
  offer: { tier: string; label: string; action: string };
}

const OFFER_TONE: Record<string, string> = {
  founders: 'border-emerald-500/40 bg-emerald-900/20 text-emerald-200',
  discount: 'border-amber-500/40 bg-amber-900/20 text-amber-200',
  discount_zero: 'border-slate-500/40 bg-surface/40 text-ink-soft',
  advocate: 'border-purple-500/40 bg-purple-900/20 text-purple-200',
  comp: 'border-purple-500/40 bg-purple-900/20 text-purple-200',
  internal_test: 'border-slate-600/40 bg-surface/40 text-muted',
};

export default function MemberLookup({ password }: { password: string }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);

  async function lookup(e?: React.FormEvent) {
    e?.preventDefault();
    const q = email.trim().toLowerCase();
    if (!q || !q.includes('@')) { setError('Enter a valid email'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch(`/api/admin/member-lookup?password=${encodeURIComponent(password)}&email=${encodeURIComponent(q)}`);
      const d = await res.json();
      if (!d.success) { setError(d.message || 'Lookup failed'); }
      else setResult(d);
    } catch {
      setError('Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-surface bg-ground p-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm uppercase tracking-[0.2em] text-blue-300">🔎 Member Lookup</p>
        <h2 className="text-2xl font-bold text-white">Founders inquiry — what did they pay, what do we offer?</h2>
        <p className="text-sm text-muted">For inbound questions from old lifetime members. Live Stripe spend + Ultimate Giant ownership (the minimum requirement) + a recommended offer. Read-only — you decide case-by-case.</p>
      </div>

      <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-900/15 px-4 py-3 text-sm text-amber-200">
        <span className="font-semibold">⚠️ Heads up:</span> this matches by the member&apos;s <span className="font-semibold">login email</span>. If someone paid under a <span className="font-semibold">different email</span>, they&apos;ll show <span className="font-semibold">$0 / no Ultimate</span> here even if they really bought it. When the spend looks wrong, search their other email(s) or check Stripe directly before deciding — don&apos;t deny access on a $0 alone.
      </div>

      <form onSubmit={lookup} className="mt-4 flex gap-2">
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="member@email.com"
          className="flex-1 rounded-lg border border-hairline bg-ground-deep px-4 py-2.5 text-white placeholder-faint focus:border-blue-500 focus:outline-none"
        />
        <button type="submit" disabled={loading}
          className="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
          {loading ? 'Looking…' : 'Look up'}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {result && (
        <div className="mt-5 space-y-4">
          {!result.found && (
            <p className="rounded-lg border border-hairline bg-surface/40 px-4 py-3 text-sm text-ink-soft">
              No record found for <span className="font-mono">{result.email}</span> (no Stripe customer, profile, or beta row). They may have paid under a different email.
            </p>
          )}

          {/* Headline: spend + Ultimate ownership side by side */}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-hairline bg-ground-deep p-4">
              <p className="text-xs uppercase tracking-wide text-faint">Lifetime paid (live Stripe)</p>
              <p className="mt-1 text-3xl font-bold text-white">${result.paid.lifetimeUsd.toLocaleString()}</p>
              <p className="mt-1 text-xs text-muted">{result.paid.chargeCount} charge(s){result.paid.lastCharge ? ` · last ${result.paid.lastCharge}` : ''}</p>
            </div>
            <div className={`rounded-xl border p-4 ${result.ultimateGiant.owns ? 'border-emerald-500/40 bg-emerald-900/20' : 'border-red-500/30 bg-red-900/10'}`}>
              <p className="text-xs uppercase tracking-wide text-muted">Ultimate Giant bundle <span className="text-faint">(min. requirement)</span></p>
              <p className={`mt-1 text-2xl font-bold ${result.ultimateGiant.owns ? 'text-emerald-300' : 'text-red-300'}`}>
                {result.ultimateGiant.owns ? '✓ Owns it' : '✗ Not found'}
              </p>
              <p className="mt-1 text-xs text-muted">{result.ultimateGiant.owns ? result.ultimateGiant.signals.join(', ') : 'no Ultimate purchase on record'}</p>
            </div>
            <div className="rounded-xl border border-hairline bg-ground-deep p-4">
              <p className="text-xs uppercase tracking-wide text-faint">Current access</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {result.access.appPro ? `Pro (${result.access.appProSource})` : 'Not Pro'}
              </p>
              <p className="mt-1 text-xs text-muted">
                tier: {result.access.entitlementTier || '—'}{result.access.briefingEligible ? ' · briefing-eligible' : ''}
                {result.access.briefingsExpiry ? ` · expires ${result.access.briefingsExpiry.slice(0, 10)}` : ''}
              </p>
            </div>
          </div>

          {/* Recommended offer (spend-based) */}
          <div className={`rounded-xl border p-4 ${OFFER_TONE[result.offer.tier] || 'border-hairline bg-ground-deep text-slate-200'}`}>
            <p className="text-xs uppercase tracking-wide opacity-80">Recommended offer · Founders = Ultimate Giant <span className="opacity-70">OR</span> paid ≥ $4,997</p>
            <p className="mt-1 text-lg font-bold">{result.offer.label}</p>
            <p className="mt-1 text-sm">{result.offer.action}</p>
            {(result.offer.tier === 'discount' || result.offer.tier === 'discount_zero') && (
              <p className="mt-2 text-xs text-amber-300/90">Does not meet the Founders bar (no Ultimate Giant bundle and under $4,997 paid) → offer Founders Lifetime ($4,997). The $2,997 discount is discontinued. If they may have paid under another email, verify first.</p>
            )}
          </div>

          {/* Context line */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
            <span>Email: <span className="font-mono text-ink-soft">{result.email}</span></span>
            {result.company && <span>Company: <span className="text-ink-soft">{result.company}</span></span>}
            {result.account.joined && <span>Joined: {result.account.joined}</span>}
            {result.account.invitationSource && <span>Source: {result.account.invitationSource}</span>}
            {result.flags.advocate && <span className="text-purple-300">Advocate</span>}
            {result.flags.comp && <span className="text-purple-300">Comp/testimonial</span>}
            {result.flags.internal && <span className="text-muted">Internal</span>}
            {result.flags.test && <span className="text-muted">Test account</span>}
            {result.paid.products.length > 0 && <span>Bought: <span className="text-ink-soft">{result.paid.products.slice(0, 4).join(', ')}</span></span>}
          </div>
        </div>
      )}
    </section>
  );
}
