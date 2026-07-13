'use client';

/**
 * getmindy.ai/mcp/pricing — the standalone PUBLIC pricing page (separate from the
 * /mcp connect/landing page). Pricing cards with a per-pack included/not-included
 * checklist + the full per-call rate list + Pro cross-sell. All numbers come from
 * the public /api/mcp/catalog (no auth, no PII). The demo videos live on /mcp.
 */
import { useEffect, useMemo, useState } from 'react';
import { Catalog, McpNav, workupCostFrom, workups } from '../catalog-ui';

/** Honest per-pack checklist. Every pack unlocks ALL tools — the ladder is volume +
 *  bonus credits + $/credit, so only those rows flip ✓/✗ across tiers. */
function checklist(packId: string): { label: string; ok: boolean }[] {
  const bonus = packId === 'plus' ? '+7% bonus credits' : packId === 'scale' ? '+20% bonus credits' : null;
  return [
    { label: 'All 9 intelligence tools', ok: true },
    { label: 'Keyless connect + API keys', ok: true },
    { label: 'Credits never expire', ok: true },
    { label: 'Charged on success only', ok: true },
    { label: bonus ?? 'Bonus credits', ok: !!bonus },
    { label: 'Best price per credit', ok: packId === 'scale' },
  ];
}

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

  const cards = [
    { id: 'free', name: 'Free trial', tag: 'one-time', highlight: false, price: '$0', priceSub: 'on first connect', credits: trial, cta: 'Start free' },
    ...packs.map((p) => ({
      id: p.id,
      name: p.label.split('—')[0].trim(),
      tag: p.id === popularId ? 'Recommended' : p.id === 'scale' ? 'Best rate' : null,
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
            Buy credits, spend them per call — on success only. No subscription, no seats, no expiry. Every pack unlocks all 9 tools; bigger packs just add bonus credits. Start with {trial} free.
          </p>
        </section>

        {/* Pricing cards with per-pack checklist */}
        <section className="mt-10">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c) => (
              <div key={c.id} className={`relative flex flex-col rounded-2xl border p-5 ${c.highlight ? 'border-emerald-400/40 bg-emerald-400/[0.04]' : 'border-white/10 bg-white/[0.02]'}`}>
                {c.tag && (
                  <span className={`absolute -top-2.5 left-5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${c.highlight ? 'bg-emerald-500 text-[#06120c]' : 'border border-white/15 bg-[#0a0f1e] text-slate-400'}`}>{c.tag}</span>
                )}
                <div className="text-[13px] font-semibold uppercase tracking-wide text-slate-200">{c.name}</div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tabular-nums">{c.price}</span>
                  <span className="text-[12px] text-slate-500">{c.priceSub}</span>
                </div>
                <div className="mt-2 text-[13px] text-slate-400">
                  <span className="font-medium tabular-nums text-slate-200">{c.credits.toLocaleString()} credits</span>
                  <span className="block text-[12px] text-slate-500">~{workups(c.credits, workupCost)} opportunity work-ups</span>
                </div>
                <ul className="mt-4 flex-1 space-y-1.5 border-t border-white/[0.06] pt-4">
                  {checklist(c.id).map((item) => (
                    <li key={item.label} className={`flex items-start gap-2 text-[12px] ${item.ok ? 'text-slate-300' : 'text-slate-600'}`}>
                      <span className={`mt-px shrink-0 ${item.ok ? 'text-emerald-400' : 'text-slate-600'}`}>{item.ok ? '✓' : '✕'}</span>
                      <span className={item.ok ? '' : 'line-through decoration-slate-700'}>{item.label}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="/app"
                  className={`mt-5 inline-flex items-center justify-center rounded-lg px-3 py-2 text-[13px] font-semibold ${c.highlight ? 'bg-emerald-500 text-[#06120c] hover:bg-emerald-400' : 'border border-white/15 text-slate-200 hover:bg-white/5'}`}
                >
                  {c.cta}
                </a>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-4 max-w-2xl text-center text-[12px] leading-relaxed text-slate-500">
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
          <p className="mt-3 text-[12px] text-slate-500">Free to start — {trial} credits on your first connect. No card required. <a href="/mcp" className="underline underline-offset-2 hover:text-slate-300">See it in action →</a></p>
        </section>
      </div>
    </main>
  );
}
