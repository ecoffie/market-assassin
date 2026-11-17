'use client';

/**
 * Mindy's trial checkout (2026-11-17): plan summary on the left, a short card form on the right.
 *
 * The card fields are Stripe's Payment Element (an iframe served by Stripe), mounted on a Checkout
 * Session made by /api/billing/trial-checkout. Mindy never sees the card number. If the session
 * cannot be made or Stripe.js fails to load, the buyer gets a button to the plan's hosted Stripe page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { loadStripe, type Stripe as StripeJs, type StripeCheckout } from '@stripe/stripe-js';
import { Check, Lock, Loader2, ShieldCheck, CalendarClock, CreditCard } from 'lucide-react';

type Plan = 'pro' | 'team';
type Cycle = 'monthly' | 'annual';

interface Props {
  publishableKey: string;
  initialPlan: Plan;
  initialCycle: Cycle;
  source: string | null;
  prefillEmail: string | null;
  prices: Record<Plan, { monthly: number; annual: number; credits: number }>;
  fallbacks: Record<string, string>;
}

const FEATURES: Record<Plan, string[]> = {
  pro: [
    'Opportunities matched to you, with daily alerts and briefings',
    'Recompetes 12 months out, with the incumbent',
    'Market research: who buys, who wins, what they spend',
    'Proposal editor with Ask Mindy',
    'Mindy inside Claude, ChatGPT or Cursor',
  ],
  team: [
    'Everything in Pro',
    'Up to 5 users on one plan',
    'Shared pipeline, roles and team dashboard',
    'Onboarding call to set up your markets',
  ],
};

const TRIAL_DAYS_DEFAULT = 14;
const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function chargeDateLabel(trialDays: number, from = new Date()): string {
  const d = new Date(from.getTime() + trialDays * 86400000);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

let stripePromise: Promise<StripeJs | null> | null = null;

export default function TrialCheckout({ publishableKey, initialPlan, initialCycle, source, prefillEmail, prices, fallbacks }: Props) {
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [cycle, setCycle] = useState<Cycle>(initialCycle);
  const [email, setEmail] = useState(prefillEmail || '');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [trialDays, setTrialDays] = useState<number>(TRIAL_DAYS_DEFAULT);

  const mountRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<StripeCheckout | null>(null);
  const actionsRef = useRef<Awaited<ReturnType<StripeCheckout['loadActions']>> | null>(null);
  const runRef = useRef(0);

  const fallbackUrl = fallbacks[`${plan}:${cycle}`];
  const price = cycle === 'annual' ? prices[plan].annual : prices[plan].monthly;
  const perMonth = cycle === 'annual' ? Math.round((prices[plan].annual / 12) * 100) / 100 : prices[plan].monthly;
  const savePct = Math.round((1 - prices[plan].annual / (prices[plan].monthly * 12)) * 100);
  const chargeOn = useMemo(() => chargeDateLabel(trialDays), [trialDays]);
  const planName = plan === 'team' ? 'Mindy Team' : 'Mindy Pro';

  const start = useCallback(async () => {
    const run = ++runRef.current;
    setLoading(true); setReady(false); setError(null); setUnavailable(false);
    try { checkoutRef.current?.getPaymentElement()?.destroy(); } catch { /* already gone */ }
    checkoutRef.current = null; actionsRef.current = null;
    try {
      const res = await fetch('/api/billing/trial-checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, cycle, source }),
      });
      const data = await res.json().catch(() => null);
      if (run !== runRef.current) return;
      if (!res.ok || !data?.clientSecret) { setUnavailable(true); setLoading(false); return; }
      if (typeof data.summary?.trialDays === 'number' && data.summary.trialDays > 0) setTrialDays(data.summary.trialDays);
      stripePromise = stripePromise || loadStripe(publishableKey);
      const stripe = await stripePromise;
      if (!stripe || run !== runRef.current) { if (!stripe) { setUnavailable(true); setLoading(false); } return; }
      const checkout = stripe.initCheckout({
        clientSecret: data.clientSecret,
        elementsOptions: {
          fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap' }],
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: '#006aff', colorText: '#111c26', colorTextSecondary: '#5a6675', colorDanger: '#b42318',
              colorBackground: '#ffffff', fontFamily: 'Inter, system-ui, sans-serif', fontSizeBase: '15px',
              borderRadius: '10px', spacingUnit: '4px',
            },
            rules: {
              '.Input': { border: '1px solid #d4dae2', boxShadow: 'none', padding: '12px' },
              '.Input:focus': { border: '1px solid #006aff', boxShadow: '0 0 0 3px rgba(0,106,255,.15)' },
              '.Label': { fontWeight: '600', color: '#111c26' },
            },
          },
        },
      });
      checkoutRef.current = checkout;
      const el = checkout.createPaymentElement({ layout: { type: 'tabs' } });
      if (mountRef.current) el.mount(mountRef.current);
      el.on('ready', () => { if (run === runRef.current) { setReady(true); setLoading(false); } });
      const loaded = await checkout.loadActions();
      if (run !== runRef.current) return;
      if (loaded.type === 'error') { setUnavailable(true); setLoading(false); return; }
      actionsRef.current = loaded;
    } catch (e) {
      console.error('[TrialCheckout] init failed', e);
      if (run === runRef.current) { setUnavailable(true); setLoading(false); }
    }
  }, [plan, cycle, source, publishableKey]);

  useEffect(() => { void start(); }, [start]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const loaded = actionsRef.current;
    if (!loaded || loaded.type !== 'success') return;
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setError('Enter the email you want to use for Mindy.'); return; }
    setSubmitting(true); setError(null);
    try {
      const upd = await loaded.actions.updateEmail(value);
      if (upd.type === 'error') { setError(upd.error.message || 'Check your email address.'); return; }
      const result = await loaded.actions.confirm();
      // On success Stripe redirects to the return URL; we only get here on an error.
      if (result.type === 'error') setError(result.error.message || 'Your card could not be saved. Check the details and try again.');
    } catch {
      setError('Something went wrong. Try again, or use the secure Stripe page below.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f9fb] text-[#111c26]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header className="bg-white border-b border-[#e6eaef]">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" aria-label="Mindy home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mindy-logo-icon.svg" alt="" width={30} height={30} />
            <span className="text-xl font-bold" style={{ fontFamily: '"Space Grotesk", Inter, sans-serif' }}>Mindy</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 text-sm text-[#5a6675]"><Lock className="h-4 w-4" aria-hidden />Secure checkout</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 md:py-12 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] items-start">
        {/* Summary */}
        <section aria-labelledby="summary-title" className="bg-white border border-[#e6eaef] rounded-2xl p-6 md:p-8 order-2 md:order-1">
          <div className="flex gap-2 p-1 bg-[#f0f3f7] rounded-xl" role="radiogroup" aria-label="Plan">
            {(['pro', 'team'] as Plan[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={plan === p} onClick={() => setPlan(p)}
                className={`flex-1 h-10 rounded-lg text-sm font-semibold ${plan === p ? 'bg-white shadow-sm text-[#111c26]' : 'text-[#5a6675] hover:text-[#111c26]'}`}>
                {p === 'pro' ? 'Pro' : 'Team'}
              </button>
            ))}
          </div>

          <h1 id="summary-title" className="mt-6 text-2xl font-bold" style={{ fontFamily: '"Space Grotesk", Inter, sans-serif' }}>Try {planName} free for {trialDays} days</h1>
          <div className="mt-4 flex items-end gap-2">
            <span className="text-4xl font-bold tracking-tight">$0</span>
            <span className="pb-1.5 text-[#5a6675]">due today</span>
          </div>
          <p className="mt-1 text-[15px] text-[#3a4654]">
            Then {fmtUsd(price)}/{cycle === 'annual' ? 'year' : 'month'}{cycle === 'annual' ? ` (${fmtUsd(perMonth)}/mo)` : ''} starting {chargeOn}.
          </p>

          <fieldset className="mt-5">
            <legend className="sr-only">Billing</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['monthly', 'annual'] as Cycle[]).map((c) => (
                <label key={c} className={`cursor-pointer rounded-xl border px-3 py-2.5 ${cycle === c ? 'border-[#006aff] bg-[#eff5ff]' : 'border-[#d4dae2] bg-white'}`}>
                  <input type="radio" name="cycle" value={c} checked={cycle === c} onChange={() => setCycle(c)} className="sr-only" />
                  <span className="block text-sm font-semibold">{c === 'monthly' ? 'Monthly' : 'Yearly'}</span>
                  <span className="block text-xs text-[#5a6675]">
                    {c === 'monthly' ? `${fmtUsd(prices[plan].monthly)}/mo` : <>{fmtUsd(Math.round(prices[plan].annual / 12))}/mo · <span className="text-[#137a4e] font-semibold">save {savePct}%</span></>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <ul className="mt-6 space-y-2.5">
            {FEATURES[plan].map((f) => (
              <li key={f} className="flex gap-2.5 text-[15px]"><Check className="h-5 w-5 shrink-0 text-[#006aff]" aria-hidden />{f}</li>
            ))}
            <li className="flex gap-2.5 text-[15px]"><Check className="h-5 w-5 shrink-0 text-[#006aff]" aria-hidden />{prices[plan].credits.toLocaleString()} Mindy credits a month{plan === 'team' ? ', shared' : ''}</li>
          </ul>

          <div className="mt-6 border-t border-[#e6eaef] pt-5 space-y-3 text-sm text-[#3a4654]">
            <p className="flex gap-2.5"><CalendarClock className="h-5 w-5 shrink-0 text-[#5a6675]" aria-hidden />We email you a reminder before your trial ends.</p>
            <p className="flex gap-2.5"><ShieldCheck className="h-5 w-5 shrink-0 text-[#5a6675]" aria-hidden />Cancel anytime in Settings › Billing before {chargeOn} and you pay nothing.</p>
          </div>
        </section>

        {/* Payment */}
        <section aria-labelledby="pay-title" className="bg-white border border-[#e6eaef] rounded-2xl p-6 md:p-8 shadow-[0_8px_24px_rgba(17,28,38,.06)] order-1 md:order-2">
          <h2 id="pay-title" className="text-lg font-bold" style={{ fontFamily: '"Space Grotesk", Inter, sans-serif' }}>Start your free trial</h2>
          <p className="mt-1 text-sm text-[#5a6675]">Takes about a minute. No charge today.</p>

          {unavailable ? (
            <div className="mt-6 rounded-xl border border-[#e6eaef] bg-[#f7f9fb] p-5">
              <p className="text-[15px]">This page couldn&apos;t load the card form. You can finish on Stripe&apos;s secure page instead; the trial and price are the same.</p>
              <a href={fallbackUrl} className="mt-4 inline-flex h-12 items-center justify-center rounded-xl bg-[#006aff] hover:bg-[#0057d1] px-5 text-white font-semibold">Continue to secure checkout</a>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
              <div>
                <label htmlFor="tc-email" className="block text-[15px] font-semibold mb-1.5">Email</label>
                <input id="tc-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full h-12 rounded-[10px] border border-[#d4dae2] px-3 text-[15px] outline-none focus:border-[#006aff] focus:ring-[3px] focus:ring-[#006aff]/15" />
                <p className="mt-1.5 text-xs text-[#5a6675]">Use the email you&apos;ll sign in to Mindy with.</p>
              </div>

              <div>
                <p className="flex items-center gap-2 text-[15px] font-semibold mb-1.5"><CreditCard className="h-4 w-4" aria-hidden />Payment details</p>
                <div ref={mountRef} className={loading ? 'min-h-[180px]' : ''} />
                {loading && (
                  <p className="-mt-[180px] h-[180px] flex items-center justify-center gap-2 text-sm text-[#5a6675]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading secure card form…</p>
                )}
              </div>

              {error && <p role="alert" className="rounded-lg bg-[#fef3f2] border border-[#fecdca] px-3 py-2 text-sm text-[#b42318]">{error}</p>}

              <button type="submit" disabled={!ready || submitting}
                className="w-full h-12 rounded-xl bg-[#006aff] hover:bg-[#0057d1] text-white text-base font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
                {submitting ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden />Starting your trial…</> : `Start my ${trialDays}-day free trial`}
              </button>

              <p className="text-xs leading-relaxed text-[#5a6675] text-center">
                You won&apos;t be charged today. After {trialDays} days your card is charged {fmtUsd(price)} per {cycle === 'annual' ? 'year' : 'month'} until you cancel.
                All sales final, no refunds. By starting the trial you agree to the <a href="/terms" className="underline">Terms of Service</a>.
              </p>
              <p className="flex items-center justify-center gap-1.5 text-xs text-[#5a6675]">
                <Lock className="h-3.5 w-3.5" aria-hidden />Card details are handled by Stripe. Mindy never sees or stores your card number.
              </p>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
