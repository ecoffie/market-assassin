/**
 * /mcp/continue — where a paywalled request goes to be finished.
 *
 * The user hit the limit mid-conversation and clicked through. They see the exact request
 * we saved, the plan that unlocks it, and one button. Nothing runs until they press it.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const CHECKOUT_ENTRY = 'https://buy.stripe.com/bJe5kEff8erw20R0CsfnO0Y';

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
          ) : (
            <>
              <button
                onClick={run}
                disabled={state === 'running'}
                className="mt-6 w-full rounded-xl bg-emerald-500 px-5 py-3.5 text-[15px] font-bold text-[#06120c] hover:bg-emerald-400 disabled:opacity-60"
              >
                {state === 'running' ? 'Running…' : `Run ${label} →`}
              </button>
              <p className="mt-4 text-center text-sm text-slate-500">
                Not upgraded yet?{' '}
                <a href={CHECKOUT_ENTRY} className="text-emerald-400 underline">
                  Upgrade first
                </a>{' '}
                — we will keep this request waiting.
              </p>
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
