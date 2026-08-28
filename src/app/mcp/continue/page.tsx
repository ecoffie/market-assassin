/**
 * /mcp/continue — where a paywalled request goes to be finished.
 *
 * The user hit the limit mid-conversation and clicked through. They see the exact request
 * we saved, the plan that unlocks it, and one button. Nothing runs until they press it.
 *
 * ⚠️ THE PAGE MUST BRANCH ON AFFORDABILITY. It used to show a single "Run it" button to
 * everyone, including users with a zero balance — the exact people the paywall sent here.
 * Pressing it answered "Your upgrade has not landed yet" for an upgrade they had never
 * started, and the only way to buy was a small link below the button. Measured over the
 * first six days: 40 paywall attempts from 15 users, 1 ever reached this page. The demand
 * was real and the page did not sell to it.
 *
 * So: when the saved request costs more than the balance, the PURCHASE OPTIONS are the
 * page, and Run appears only once it can actually succeed. Plans/prices are imported from
 * packages.ts (the server-trusted source) so this page can never drift from what Stripe
 * charges — a hardcoded price here would be a number the product states and cannot defend.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SUBSCRIPTION_PLANS, CREDIT_PACKAGES } from '@/lib/mcp/packages';

/** The cheapest recurring plan — the default recommendation at the wall. */
const ENTRY_PLAN = SUBSCRIPTION_PLANS.find((p) => p.id === 'entry') ?? SUBSCRIPTION_PLANS[0];
/** The one-time valve for people who will not take a subscription. */
const TOPUP = CREDIT_PACKAGES[0];

const TOOL_LABEL: Record<string, string> = {
  generate_market_report: 'Market Report',
  capability_market_match: 'Capability Match',
  build_pursuit_dossier: 'Pursuit Dossier',
};

/** Render saved args as the human phrase they represent: "NAICS 541512 · Virginia". */
function describeArgs(args: Record<string, unknown>): string {
  const bits: string[] = [];
  const naics = args.naics ?? args.naics_code ?? args.naicsCode;
  const state = args.state ?? args.geography ?? args.location;
  const kw = args.keyword ?? args.keywords ?? args.capability;
  if (naics) bits.push(`NAICS ${String(naics)}`);
  if (state) bits.push(String(state));
  if (!naics && kw) bits.push(String(kw));
  return bits.length ? bits.join(' · ') : 'your saved request';
}

type Attempt = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  creditsRequired: number | null;
  alreadyRun: boolean;
  /** null = we could not read it. Unknown is NOT zero — show the offer, claim nothing. */
  balance: number | null;
};

export default function ContinuePage() {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'running' | 'done' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('attempt');
    if (!id) {
      setState('error');
      setMessage('No saved request in this link.');
      return;
    }
    fetch(`/api/mcp/continue?attempt=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then((d: Attempt) => {
        setAttempt(d);
        setState('ready');
      })
      .catch(() => {
        setState('error');
        setMessage('We could not find that saved request.');
      });
  }, []);

  async function run() {
    if (!attempt) return;
    setState('running');
    const res = await fetch('/api/mcp/continue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attempt: attempt.id }),
    });
    if (res.ok) {
      setState('done');
      return;
    }
    const body = await res.json().catch(() => ({}));
    setState('ready');
    setMessage(
      res.status === 402
        ? 'Your upgrade has not landed yet. Give it a moment and try again.'
        : (body?.error?.message ?? 'That did not run. Try again in a moment.'),
    );
  }

  const label = attempt ? (TOOL_LABEL[attempt.toolName] ?? 'analysis') : 'analysis';
  const cost = attempt?.creditsRequired ?? 0;
  // Affordable only when we KNOW the balance covers it. A null balance means we could not
  // read it — show the offer rather than assert they can run (and never claim "you have 0",
  // which would be fabricating a number we do not have).
  const canAfford = attempt?.balance != null && attempt.balance >= cost;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      {state === 'loading' && <p className="text-slate-400">Finding your saved request…</p>}

      {state === 'error' && (
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Nothing to continue</h1>
          <p className="mt-3 text-slate-400">{message}</p>
          <Link href="/mcp/pricing" className="mt-6 inline-block text-emerald-400 underline">
            See plans
          </Link>
        </div>
      )}

      {attempt && (state === 'ready' || state === 'running') && (
        <div>
          <h1 className="text-3xl font-bold leading-tight text-slate-100">
            Your {label} is ready to run.
          </h1>

          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
              Saved request
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-100">
              {describeArgs(attempt.args)}
            </div>
          </div>

          {attempt.alreadyRun ? (
            <p className="mt-6 text-slate-400">This one has already been run.</p>
          ) : canAfford ? (
            <>
              <button
                onClick={run}
                disabled={state === 'running'}
                className="mt-6 w-full rounded-xl bg-emerald-500 px-5 py-3.5 text-[15px] font-bold text-[#06120c] hover:bg-emerald-400 disabled:opacity-60"
              >
                {state === 'running' ? 'Running…' : `Run ${label} →`}
              </button>
              <p className="mt-4 text-center text-sm text-slate-500">
                {cost} credits · {attempt.balance} available
              </p>
            </>
          ) : (
            <>
              <div className="mt-6 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-5 py-4">
                <p className="text-[15px] text-amber-100">
                  This {label.toLowerCase()} costs <strong>{cost} credits</strong>.
                  {attempt.balance === null
                    ? ' Add credits below and it runs immediately.'
                    : ` You have ${attempt.balance}.`}
                </p>
              </div>

              <div className="mt-5 space-y-3">
                <a
                  href={ENTRY_PLAN.monthly.checkoutUrl}
                  className="block rounded-xl bg-emerald-500 px-5 py-4 text-[#06120c] transition hover:bg-emerald-400"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-bold">
                      {ENTRY_PLAN.label} — ${ENTRY_PLAN.monthly.usd}/mo
                    </span>
                    <span className="text-sm font-semibold opacity-80">
                      {ENTRY_PLAN.creditsPerMonth.toLocaleString()} credits/mo
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] opacity-75">
                    Best value — about {Math.floor(ENTRY_PLAN.creditsPerMonth / Math.max(cost, 1))}{' '}
                    more {label.toLowerCase()}s every month.
                  </div>
                </a>

                <a
                  href={TOPUP.checkoutUrl}
                  className="block rounded-xl border border-white/15 px-5 py-4 transition hover:bg-white/5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-semibold text-slate-100">
                      One-time top-up — ${TOPUP.usd}
                    </span>
                    <span className="text-sm text-slate-400">
                      {TOPUP.credits.toLocaleString()} credits
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] text-slate-400">
                    No subscription. Credits do not expire.
                  </div>
                </a>
              </div>

              <p className="mt-4 text-center text-sm text-slate-500">
                Your request stays saved — it runs the moment your credits land.
              </p>
              <p className="mt-3 text-center text-sm">
                <Link href="/mcp/pricing" className="text-slate-400 underline hover:text-slate-300">
                  Compare all plans
                </Link>
              </p>

              <button
                onClick={run}
                disabled={state === 'running'}
                className="mt-5 w-full rounded-lg border border-white/10 px-5 py-2.5 text-sm text-slate-400 transition hover:bg-white/5 disabled:opacity-60"
              >
                {state === 'running' ? 'Checking…' : 'Already purchased? Run it now'}
              </button>
            </>
          )}

          {message && <p className="mt-4 text-center text-sm text-amber-300">{message}</p>}
        </div>
      )}

      {state === 'done' && (
        <div>
          <h1 className="text-3xl font-bold text-slate-100">Done — it is running now.</h1>
          <p className="mt-3 text-slate-400">
            Your {label} for {attempt ? describeArgs(attempt.args) : 'your market'} is complete. Ask
            Mindy for it in your assistant, or open it in the app.
          </p>
          <Link href="/app" className="mt-6 inline-block text-emerald-400 underline">
            Open Mindy
          </Link>
        </div>
      )}
    </main>
  );
}
