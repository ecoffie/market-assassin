'use client';

/**
 * getmindy.ai/mcp/pricing — standalone PUBLIC pricing page. Two axes:
 *   1. Pay-as-you-go CREDITS (metered — every tool works, pay per successful call).
 *   2. PRO subscription ($149/mo) — monthly credit allowance + the gated moat
 *      (winning playbook, curated contacts, agency angles) + Proposal Assist 2.0.
 *
 * Packaging rule (see the catalog artifact): meter everything by default; gate only
 * for the four reasons — differentiation, build-cost, capability depth, security.
 * Numbers come from the public /api/mcp/catalog (no auth). Gated items marked
 * live/soon so the page never advertises a lock ahead of enforcement.
 */
import { useEffect, useMemo, useState } from 'react';
import { Catalog, McpNav, workupCostFrom, workups } from '../catalog-ui';

/** The Pro-gated moat set — what a subscription unlocks beyond the metered catalog. */
const PRO_UNLOCKS: { label: string; note: string; status: 'live' | 'soon' }[] = [
  { label: 'Winning playbook', note: 'coaching from the 8-yr teaching corpus', status: 'live' },
  { label: 'Teaching + podcast search', note: '12,369 chunks · real win stories', status: 'soon' },
  { label: 'Curated contact rosters', note: 'SBLO · DoDAAC offices · OSBP', status: 'soon' },
  { label: 'Agency angles', note: 'pain points · SAT friendliness', status: 'soon' },
  { label: 'Proposal Assist 2.0', note: 'RFP → compliance matrix → export', status: 'soon' },
];

export default function McpPricing() {
  const [cat, setCat] = useState<Catalog | null>(null);

  useEffect(() => {
    fetch('/api/mcp/catalog')
      .then((r) => r.json())
      .then((j) => { if (j?.success) setCat({ tools: j.tools || [], packages: j.packages || [], signupCredits: j.signupCredits ?? 100, proMonthlyCredits: j.proMonthlyCredits ?? 1000 }); })
      .catch(() => { /* falls back to static copy */ });
  }, []);

  const tools = cat?.tools ?? [];
  const packs = cat?.packages ?? [];
  const trial = cat?.signupCredits ?? 100;
  const proCredits = cat?.proMonthlyCredits ?? 1000;
  const workupCost = useMemo(() => (tools.length ? workupCostFrom(tools) : 30), [tools]);
  const popularId = packs.length >= 2 ? packs[1].id : undefined;

  const packRows = [
    { id: 'free', name: 'Free trial', tag: 'one-time', highlight: false, price: '$0', priceSub: 'on first connect', credits: trial },
    ...packs.map((p) => ({
      id: p.id,
      name: p.label.split('—')[0].trim(),
      tag: p.id === popularId ? 'Popular' : p.id === 'scale' ? 'Best rate' : null,
      highlight: p.id === popularId,
      price: `$${p.usd}`,
      priceSub: 'prepaid',
      credits: p.credits,
    })),
  ];

  return (
    <main className="min-h-dvh bg-[#0a0f1e] text-slate-100 [color-scheme:dark]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <McpNav active="pricing" />

        {/* Title */}
        <section className="mt-10 text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Two ways to pay: credits or Pro</h1>
          <p className="mx-auto mt-3 max-w-2xl text-balance text-sm text-slate-400 sm:text-[15px]">
            Every tool is metered — buy credits and pay per successful call, nothing gated. Go Pro for a monthly credit allowance plus the premium layer: the winning playbook, curated contacts, and Proposal Assist 2.0.
          </p>
        </section>

        {/* Two axes — the primary decision */}
        <section className="mt-10 grid gap-4 lg:grid-cols-2">
          {/* Pay-as-you-go */}
          <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-emerald-300">Pay-as-you-go</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold tabular-nums">Credits</span>
              <span className="text-[13px] text-slate-500">from $5</span>
            </div>
            <div className="mt-1 text-[13px] text-slate-400">No subscription. Best for occasional use.</div>
            <ul className="mt-5 flex-1 space-y-2 border-t border-white/[0.06] pt-5 text-[13px]">
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> <span><b className="font-semibold">Every metered tool</b> — SAM, USASpending, EDGAR, GSA pricing, forecasts, recompetes, contractor scans</span></li>
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> <span>Charged on success only · credits never expire</span></li>
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> <span><b className="font-semibold">{trial} free credits</b> on your first connect</span></li>
              <li className="flex gap-2 text-slate-500"><span>–</span> <span>Premium layer (playbook, contacts, Proposal&nbsp;2.0) is Pro</span></li>
            </ul>
            <a href="#packs" className="mt-6 inline-flex items-center justify-center rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5">See credit packs</a>
          </div>

          {/* Pro */}
          <div className="relative flex flex-col rounded-2xl border border-indigo-400/40 bg-indigo-400/[0.06] p-6">
            <span className="absolute -top-2.5 left-6 rounded-full bg-indigo-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0a0f1e]">Full access</span>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-indigo-300">Pro</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold tabular-nums">$149</span>
              <span className="text-[13px] text-slate-400">/mo · {proCredits.toLocaleString()} credits/mo</span>
            </div>
            <div className="mt-1 text-[13px] text-slate-400">Best value for daily use — the moat is here.</div>
            <ul className="mt-5 flex-1 space-y-2 border-t border-indigo-400/15 pt-5 text-[13px]">
              <li className="flex gap-2"><span className="text-indigo-300">◆</span> <span>Everything in Pay-as-you-go, plus <b className="font-semibold">{proCredits.toLocaleString()} credits every month</b></span></li>
              {PRO_UNLOCKS.map((u) => (
                <li key={u.label} className="flex items-start gap-2">
                  <span className="mt-px text-indigo-300">◆</span>
                  <span>
                    <b className="font-semibold">{u.label}</b> <span className="text-slate-500">— {u.note}</span>{' '}
                    <span className={`ml-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${u.status === 'live' ? 'bg-emerald-400/15 text-emerald-300' : 'border border-white/15 text-slate-400'}`}>{u.status === 'live' ? 'live' : 'rolling out'}</span>
                  </span>
                </li>
              ))}
            </ul>
            <a href="/app" className="mt-6 inline-flex items-center justify-center rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400">Go Pro</a>
          </div>
        </section>
        <p className="mx-auto mt-4 max-w-2xl text-center text-[12px] leading-relaxed text-slate-500">
          Why both? <span className="text-slate-400">Credits meter usage so you only pay for calls that succeed; Pro adds a monthly allowance and unlocks the un-copyable layer — Mindy's teaching corpus, curated human contacts, and the Proposal Assist 2.0 build. Metered tools work on either.</span>
        </p>

        {/* Credit packs */}
        <section id="packs" className="mt-14 scroll-mt-8">
          <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">Credit packs</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-[13px] text-slate-400">Top up anytime. Bigger packs add bonus credits; every pack unlocks the same metered tools.</p>
          <div className="mx-auto mt-6 max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="hidden grid-cols-[1.5fr_0.7fr_1.4fr_auto] items-center gap-4 border-b border-white/10 px-5 py-2.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:grid">
              <div>Pack</div><div>Price</div><div>What it gets you</div><div className="text-right" />
            </div>
            {packRows.map((t, i) => (
              <div key={t.id} className={`grid grid-cols-1 items-center gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[1.5fr_0.7fr_1.4fr_auto] ${i > 0 ? 'border-t border-white/10' : ''} ${t.highlight ? 'bg-emerald-400/[0.05]' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold text-slate-100">{t.name}</span>
                  {t.tag && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t.highlight ? 'bg-emerald-500 text-[#06120c]' : 'border border-white/15 text-slate-400'}`}>{t.tag}</span>}
                </div>
                <div className="tabular-nums"><span className="text-[15px] font-semibold text-slate-100">{t.price}</span><span className="ml-1.5 text-[11px] text-slate-500 sm:ml-0 sm:block">{t.priceSub}</span></div>
                <div className="text-[13px] text-slate-400"><span className="font-medium tabular-nums text-slate-200">{t.credits.toLocaleString()} credits</span><span className="text-slate-600"> · </span>~{workups(t.credits, workupCost)} opportunity work-ups</div>
                <a href="/app" className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-[13px] font-semibold sm:justify-self-end ${t.highlight ? 'bg-emerald-500 text-[#06120c] hover:bg-emerald-400' : 'border border-white/15 text-slate-200 hover:bg-white/5'}`}>{t.id === 'free' ? 'Start free' : 'Get credits'}</a>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-3 max-w-2xl text-center text-[12px] leading-relaxed text-slate-500">
            A <span className="text-slate-400">work-up</span> ≈ search one opportunity, pull the incumbent&apos;s financials, run a who-can-win scan, and generate a win playbook (~{workupCost} credits). Lighter lookups cost far less.
          </p>
        </section>

        {/* Proposal Assist ladder */}
        <section className="mt-16">
          <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">Proposal Assist · the version ladder</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-[13px] text-slate-400">1.0 is metered — a taste of drafting inside Mindy. 2.0 is the full RFP-to-export suite, included with Pro.</p>
          <div className="mx-auto mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-baseline gap-2"><span className="font-mono text-2xl font-bold text-slate-100">1.0</span><span className="text-[13px] text-slate-400">Draft starter</span></div>
              <div className="mt-1 text-[12px] text-emerald-300">Metered · a few credits per draft</div>
              <ul className="mt-4 flex-1 space-y-2 border-t border-white/[0.06] pt-4 text-[12.5px]">
                <li className="flex gap-2"><span className="text-emerald-400">✓</span> Single-section drafts from your source text</li>
                <li className="flex gap-2"><span className="text-emerald-400">✓</span> Grounded in your bidder profile + Vault</li>
                <li className="flex gap-2"><span className="text-emerald-400">✓</span> Teaching-corpus style references</li>
              </ul>
            </div>
            <div className="flex flex-col rounded-2xl border border-indigo-400/40 bg-indigo-400/[0.06] p-5">
              <div className="flex items-baseline gap-2"><span className="font-mono text-2xl font-bold text-indigo-300">2.0</span><span className="text-[13px] text-slate-400">Full suite</span></div>
              <div className="mt-1 text-[12px] text-indigo-300">Included with Pro · <span className="text-slate-500">rolling out</span></div>
              <ul className="mt-4 flex-1 space-y-2 border-t border-indigo-400/15 pt-4 text-[12.5px]">
                <li className="flex gap-2"><span className="text-indigo-300">◆</span> RFP → auto-extracted compliance matrix (Section L/M)</li>
                <li className="flex gap-2"><span className="text-indigo-300">◆</span> Multi-section, multi-pass drafting with per-section voices</li>
                <li className="flex gap-2"><span className="text-indigo-300">◆</span> Agency-context framing + humanization pass</li>
                <li className="flex gap-2"><span className="text-indigo-300">◆</span> Full package export to .docx</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Full per-call rate list */}
        {tools.length > 0 && (
          <section className="mt-16">
            <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">Metered tools · cost per call</h2>
            <p className="mx-auto mt-2 max-w-lg text-center text-[13px] text-slate-400">Live today. Every tool your agent can call, priced by what it costs to run.</p>
            <div className="mx-auto mt-5 max-w-2xl overflow-hidden rounded-2xl border border-white/10">
              {tools.filter((t) => t.credits > 0).map((t, i) => (
                <div key={t.name} className={`flex items-center justify-between gap-4 px-4 py-3 text-sm ${i % 2 ? 'bg-white/[0.015]' : ''}`}>
                  <div className="min-w-0">
                    <code className="font-mono text-[13px] text-slate-100">{t.name}</code>
                    <div className="mt-0.5 truncate text-[12px] text-slate-500">{t.description}</div>
                  </div>
                  <div className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-emerald-300">{t.credits} {t.credits === 1 ? 'credit' : 'credits'}</div>
                </div>
              ))}
            </div>
            <p className="mx-auto mt-3 max-w-2xl text-center text-[12px] text-slate-500">Debited only when a call succeeds. Repeat/cached reads are free. More tools roll out from the 60+ capabilities in the platform.</p>
          </section>
        )}

        {/* CTA */}
        <section className="mt-16 text-center">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a href="/app" className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">Start free with {trial} credits</a>
            <a href="/app" className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400">Go Pro</a>
          </div>
          <p className="mt-3 text-[12px] text-slate-500">No card required to start. <a href="/mcp" className="underline underline-offset-2 hover:text-slate-300">See it in action →</a></p>
        </section>
      </div>
    </main>
  );
}
