'use client';

/**
 * getmindy.ai/mcp/pricing — the standalone PUBLIC pricing page (separate from the
 * /mcp connect/landing page). Rate card + "what you can do with credits" examples
 * (with placeholder demo videos until the real clips exist) + per-call rate list +
 * Pro cross-sell. All numbers come from the public /api/mcp/catalog (no auth, no PII).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Catalog,
  McpNav,
  EXAMPLES,
  exampleCost,
  workupCostFrom,
  workups,
} from '../catalog-ui';

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
  const bonusOf = (label: string) => label.match(/\(([^)]*bonus)\)/i)?.[1] ?? null;

  const tierRows = [
    { id: 'free', name: 'Free trial', tag: 'one-time', highlight: false, price: '$0', priceSub: 'on first connect', credits: trial, cta: 'Start free' },
    ...packs.map((p) => ({
      id: p.id,
      name: p.label.split('—')[0].trim(),
      tag: p.id === popularId ? 'Recommended' : bonusOf(p.label),
      highlight: p.id === popularId,
      price: `$${p.usd}`,
      priceSub: 'prepaid',
      credits: p.credits,
      cta: 'Get credits',
    })),
  ];

  return (
    <main className="min-h-dvh bg-[#0a0f1e] text-slate-100 [color-scheme:dark]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <McpNav active="pricing" />

        {/* Title */}
        <section className="mt-10 text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Simple, prepaid pricing</h1>
          <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-slate-400 sm:text-[15px]">
            Buy credits, spend them per call — on success only. No subscription, no seats, no expiry. Start with {trial} free.
          </p>
        </section>

        {/* Rate card */}
        <section className="mt-10">
          <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="hidden grid-cols-[1.5fr_0.7fr_1.4fr_auto] items-center gap-4 border-b border-white/10 px-5 py-2.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:grid">
              <div>Pack</div>
              <div>Price</div>
              <div>What it gets you</div>
              <div className="text-right" />
            </div>
            {tierRows.map((t, i) => (
              <div
                key={t.id}
                className={`grid grid-cols-1 items-center gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[1.5fr_0.7fr_1.4fr_auto] ${i > 0 ? 'border-t border-white/10' : ''} ${t.highlight ? 'bg-emerald-400/[0.05]' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold text-slate-100">{t.name}</span>
                  {t.tag && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t.highlight ? 'bg-emerald-500 text-[#06120c]' : 'border border-white/15 text-slate-400'}`}>{t.tag}</span>
                  )}
                </div>
                <div className="tabular-nums">
                  <span className="text-[15px] font-semibold text-slate-100">{t.price}</span>
                  <span className="ml-1.5 text-[11px] text-slate-500 sm:ml-0 sm:block">{t.priceSub}</span>
                </div>
                <div className="text-[13px] text-slate-400">
                  <span className="font-medium tabular-nums text-slate-200">{t.credits.toLocaleString()} credits</span>
                  <span className="text-slate-600"> · </span>~{workups(t.credits, workupCost)} opportunity work-ups
                </div>
                <a
                  href="/app"
                  className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-[13px] font-semibold sm:justify-self-end ${t.highlight ? 'bg-emerald-500 text-[#06120c] hover:bg-emerald-400' : 'border border-white/15 text-slate-200 hover:bg-white/5'}`}
                >
                  {t.cta}
                </a>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-3 max-w-2xl text-center text-[12px] leading-relaxed text-slate-500">
            A <span className="text-slate-400">work-up</span> ≈ search one opportunity, pull the incumbent&apos;s financials, run a who-can-win scan, and generate a win playbook (~{workupCost} credits). Lighter lookups cost far less — see the full rate list below.
          </p>
        </section>

        {/* Pro cross-sell */}
        <section className="mt-6">
          <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-indigo-400/20 bg-indigo-400/[0.05] px-5 py-4 sm:flex-row">
            <p className="text-center text-[13px] text-slate-300 sm:text-left">
              <span className="font-semibold text-indigo-200">Already a Mindy Pro member?</span> Your $149/mo plan includes <span className="font-semibold tabular-nums">{proCredits.toLocaleString()} MCP credits every month</span> — the best value if you use the agent daily.
            </p>
            <a href="/premium" className="shrink-0 rounded-lg border border-indigo-400/30 px-3 py-2 text-[13px] font-medium text-indigo-100 hover:bg-indigo-400/10">See Pro</a>
          </div>
        </section>

        {/* Example runs — with placeholder demo videos */}
        {tools.length > 0 && (
          <section className="mt-14">
            <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">What you can do with credits</h2>
            <p className="mx-auto mt-2 max-w-lg text-center text-[13px] text-slate-400">Each call is priced on its own — chain a few and you&apos;ve run a real BD task. Watch each one in action:</p>
            <div className="mx-auto mt-6 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {EXAMPLES.map((ex) => {
                const cost = exampleCost(tools, ex.tools);
                return (
                  <div key={ex.title} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
                    {/* Placeholder demo — swap the div for a <video>/<iframe> when clips exist */}
                    <div className="relative grid aspect-video place-items-center border-b border-white/10 bg-[#070b16]">
                      <div className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-slate-300 ring-1 ring-white/10">
                        <span className="ml-0.5 text-lg">▶</span>
                      </div>
                      <span className="absolute left-2 top-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-300">{cost} cr</span>
                      <span className="absolute bottom-2 right-2 text-[10px] uppercase tracking-wide text-slate-600">demo soon</span>
                    </div>
                    <div className="p-4">
                      <div className="text-[14px] font-semibold text-slate-100">{ex.title}</div>
                      <div className="mt-1 text-[12px] leading-relaxed text-slate-400">{ex.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mx-auto mt-4 max-w-2xl text-center text-[12px] text-slate-500">
              Your {trial} free credits alone cover ~{workups(trial, workupCost)} full work-ups — or dozens of quick lookups. Credits never expire.
            </p>
          </section>
        )}

        {/* Full per-call rate list — real tool names (how the agent calls them) */}
        {tools.length > 0 && (
          <section className="mt-14">
            <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">Full rate list</h2>
            <p className="mx-auto mt-2 max-w-lg text-center text-[13px] text-slate-400">Every tool your agent can call, and what each call costs.</p>
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
            <p className="mx-auto mt-3 max-w-2xl text-center text-[12px] text-slate-500">Credits are debited only when a call succeeds. Repeat/cached reads are free.</p>
          </section>
        )}

        {/* CTA */}
        <section className="mt-14 text-center">
          <a href="/app" className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">
            Sign in to connect
          </a>
          <p className="mt-3 text-[12px] text-slate-500">Free to start — {trial} credits on your first connect. No card required. <a href="/mcp" className="underline underline-offset-2 hover:text-slate-300">Back to connect →</a></p>
        </section>
      </div>
    </main>
  );
}
