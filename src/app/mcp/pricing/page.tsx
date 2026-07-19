'use client';

/**
 * getmindy.ai/mcp/pricing — the PUBLIC pricing page for the MCP CREDIT PRODUCT.
 *
 * Two-product model (GOS Decisions #008/#015/#016): the Mindy APP (Free / Pro $149 /
 * Team $499) is a SEPARATE product sold elsewhere; this page sells only the metered MCP
 * credit product. Ladder:
 *   • Free trial — signup credits, public-data tools only.
 *   • Entry $99 / Mid $249 / Agency $999 — self-serve monthly credit subscriptions.
 *   • One-time $119 top-up — the "ran out mid-month" valve.
 *   • Enterprise / API — INQUIRY-ONLY (feed licensing, high-volume API, SSO/SLA); no price.
 *
 * App Pro/Team buyers get a small MCP credit "taste" (250 / 750) — surfaced as a note that
 * links to app pricing, NOT sold here. Numbers come from the public /api/mcp/catalog (no
 * auth); the static fallback below MUST stay in sync with SUBSCRIPTION_PLANS in packages.ts.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Catalog, SubPlan, Pkg, McpNav, workupCostFrom, workups, toolCr, exampleCost } from '../catalog-ui';

const APP_PRICING_URL = '/pricing'; // where the App Free/Pro/Team tiers live
const ENTERPRISE_MAILTO = 'mailto:hello@getmindy.ai?subject=Mindy%20Enterprise%20%2F%20API%20inquiry';

// App-tier MCP "taste" (GOS #015) — shown as a cross-sell note, not sold on this page.
const PRO_APP_USD = 149, PRO_APP_CREDITS = 250;
const TEAM_APP_USD = 499, TEAM_APP_CREDITS = 750;

/** Per-plan "who it's for" blurb — the only thing that differs plan to plan (capabilities are identical). */
const PACK_BLURB: Record<string, string> = {
  entry: 'The on-ramp — a fixed monthly allowance for steady, project-based federal BD.',
  mid: 'The daily-driver — enough credits to work opportunities every day, all month.',
  agency: 'The agency plan — high volume for a shop running many pursuits at once.',
};

/** Per-tier visual theme for the 2×2 grid (full literal Tailwind strings so the JIT scanner sees them). */
interface PlanTheme { tag: string; accent: string; card: string; badge: string; box: string; boxText: string; check: string; cta: string }
const PLAN_THEME: Record<string, PlanTheme> = {
  entry: {
    tag: 'Popular', accent: 'text-emerald-300', card: 'border-emerald-400/40 bg-emerald-400/[0.05] shadow-[0_0_0_1px_rgba(16,185,129,0.15)]',
    badge: 'bg-emerald-500 text-[#06120c]', box: 'border-emerald-400/15 bg-emerald-400/[0.04]', boxText: 'text-emerald-100',
    check: 'text-emerald-400', cta: 'bg-emerald-500 text-[#06120c] hover:bg-emerald-400',
  },
  mid: {
    tag: 'Best for daily use', accent: 'text-indigo-300', card: 'border-indigo-400/40 bg-indigo-400/[0.06] shadow-[0_0_0_1px_rgba(99,102,241,0.15)]',
    badge: 'bg-indigo-500 text-white', box: 'border-indigo-400/15 bg-indigo-400/[0.05]', boxText: 'text-indigo-100',
    check: 'text-indigo-300', cta: 'bg-indigo-500 text-white hover:bg-indigo-400',
  },
  agency: {
    tag: 'For agencies · high volume', accent: 'text-purple-300', card: 'border-purple-400/40 bg-purple-400/[0.06]',
    badge: 'bg-purple-500 text-white', box: 'border-purple-400/15 bg-purple-400/[0.05]', boxText: 'text-purple-100',
    check: 'text-purple-300', cta: 'bg-purple-500 text-white hover:bg-purple-400',
  },
};
const FALLBACK_THEME: PlanTheme = PLAN_THEME.entry;

/**
 * Static fallback so the cards render even if the public /api/mcp/catalog fetch is
 * unavailable (bot-gated, SSR). MUST stay in sync with SUBSCRIPTION_PLANS in
 * src/lib/mcp/packages.ts — the live catalog wins when present. Monthly-only (annual
 * deferred, GOS #015). Live Stripe price ids + payment links (created 2026-07-19).
 */
const PLANS_FALLBACK: SubPlan[] = [
  { id: 'entry',  label: 'Entry',  creditsPerMonth: 500,  monthly: { priceId: 'price_1TuxApK5zyiZ50PB8iMg8WqG', usd: 99,  credits: 500,  checkoutUrl: 'https://buy.stripe.com/bJe5kEff8erw20R0CsfnO0Y' } },
  { id: 'mid',    label: 'Mid',    creditsPerMonth: 1500, monthly: { priceId: 'price_1TuxApK5zyiZ50PBPV40eCvG', usd: 249, credits: 1500, checkoutUrl: 'https://buy.stripe.com/8x29AUgjcfvA5d30CsfnO0Z' } },
  { id: 'agency', label: 'Agency', creditsPerMonth: 8000, monthly: { priceId: 'price_1TuxAqK5zyiZ50PBJUdzoobH', usd: 999, credits: 8000, checkoutUrl: 'https://buy.stripe.com/8x2eVe1oi6Z434VdpefnO10' } },
];
const TOPUP_FALLBACK: Pkg = { id: 'refill', credits: 500, usd: 119, label: 'Top-up — 500 credits', checkoutUrl: 'https://buy.stripe.com/cNiaEYff8bfk8pfetifnO11' };

/**
 * The proprietary "moat" tools — Mindy's un-copyable layer. Included with ANY paid
 * plan (not the free trial, which runs the public-data tools). All live today.
 */
const MOAT_LIST = 'Winning playbook · Podcast lessons · Curated contact rosters (SBLO · OSBP) · Agency angles · Proposal tools';

/** Plan-finder activities — each a real BD workflow, priced per opportunity from the live catalog. */
const ACTIVITIES: { id: string; label: string; note: string; tools: string[] }[] = [
  { id: 'find', label: 'Find & filter opportunities', note: 'live SAM search across your NAICS + keywords', tools: ['search_sam_opportunities'] },
  { id: 'incumbent', label: 'Vet the incumbent', note: 'SEC financials + full contractor profile', tools: ['get_incumbent_financials', 'get_contractor_profile'] },
  { id: 'price', label: 'Price the bid', note: 'GSA labor rates + regulatory demand signal', tools: ['get_pricing_intel', 'get_regulatory_demand'] },
  { id: 'playbook', label: 'Draft a win strategy', note: 'proprietary winning playbook', tools: ['get_winning_playbook'] },
  { id: 'teaming', label: 'Build a teaming shortlist', note: 'who-can-win scan + deep-profile top partners', tools: ['find_capable_contractors', 'get_contractor_profile', 'get_contractor_profile'] },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'How do credits work?', a: 'Every tool your agent calls costs a set number of credits — priced by what it costs us to run. You are debited only when a call succeeds; a failed or empty call costs nothing, and repeat/cached reads are free.' },
  { q: 'Entry, Mid, or Agency — which do I need?', a: 'Entry ($99, 500 credits/mo) suits project or occasional use. Mid ($249, 1,500/mo) is the daily driver for an agent working opportunities every day. Agency ($999, 8,000/mo) is for a shop running many pursuits at once. Every tier has the same tools — including the moat — they differ only in monthly allowance. Use the plan finder below to size it against your real workflow.' },
  { q: 'What is the "moat," and why is it paid-only?', a: 'The moat is Mindy’s un-copyable layer: the winning playbook, curated teaming/OSBP contacts, agency angles, and podcast lessons — built from an 8-year teaching corpus, not scraped from public APIs. The free trial runs the public-data tools (SAM, USASpending, EDGAR, GSA, forecasts); any paid plan unlocks the moat.' },
  { q: 'I already pay for the Mindy app (Pro or Team). Do I get MCP credits?', a: `Yes — Pro ($149/mo) includes ${PRO_APP_CREDITS} MCP credits every month and Team ($499/mo) includes ${TEAM_APP_CREDITS}, at no extra cost. Connect with the same account and they’re already there. It’s a taste — if your agent runs heavier, add one of the credit plans on this page.` },
  { q: 'What is the one-time top-up for?', a: `The top-up (500 credits / $119) is the “ran out mid-month” valve — a one-time refill that doesn’t change your plan. It’s also the pack auto-recharge draws from if you switch that on. It’s priced per-credit above the subscriptions on purpose, so subscribing is always the better deal for steady use.` },
  { q: 'Do you have an Enterprise / API option?', a: 'Yes — for primes, agencies, funds, lenders, and partners who need a data/feed license, high-volume programmatic API access, SSO/SAML, a dedicated success manager, or an SLA. Pricing is bespoke (volume-based, annual invoicing). Email hello@getmindy.ai and we’ll scope it with you.' },
  { q: 'Do I need a credit card to start?', a: 'No. You get signup credits free on your first connect — sign in through your browser, point your MCP client at Mindy, and start calling tools. Add a plan only when you want more.' },
  { q: 'What happens when I run out of credits?', a: 'The next tool call is declined with a top-up message before it runs — you are never charged into a negative balance. Add a top-up, upgrade your plan, or wait for your renewal.' },
];

export default function McpPricing() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(['find', 'incumbent', 'playbook']));
  const [oppsPerMonth, setOppsPerMonth] = useState(5);

  useEffect(() => {
    fetch('/api/mcp/catalog')
      .then((r) => r.json())
      .then((j) => { if (j?.success) setCat({ tools: j.tools || [], packages: j.packages || [], subscriptionPlans: j.subscriptionPlans || [], signupCredits: j.signupCredits ?? 100, proMonthlyCredits: j.proMonthlyCredits ?? PRO_APP_CREDITS }); })
      .catch(() => { /* falls back to static copy */ });
  }, []);

  const tools = cat?.tools ?? [];
  const plans = cat?.subscriptionPlans?.length ? cat.subscriptionPlans : PLANS_FALLBACK;
  const topup = cat?.packages?.find((p) => p.id === 'refill') ?? TOPUP_FALLBACK;
  const trial = cat?.signupCredits ?? 100;
  const workupCost = tools.length ? workupCostFrom(tools) : 30;
  const toolCount = tools.filter((t) => t.credits > 0).length || 33;
  const searchCost = toolCr(tools, 'search_sam_opportunities', 1);
  const playbookCost = toolCr(tools, 'get_winning_playbook', 2);
  // The flagship deliverable (a proposal draft / full market report) — the high-value unit
  // that actually constrains a serious user. Live-priced from the catalog (100 cr today).
  const flagshipCost = toolCr(tools, 'generate_market_report', 100);

  /** Turn an abstract credit balance into concrete BD outcomes (the Higgsfield move, our way). */
  const outcomes = (n: number) => [
    `≈ ${workups(n, workupCost)} full opportunity work-ups`,
    `${Math.max(1, Math.floor(n / flagshipCost)).toLocaleString()} proposals or market reports`,
    `${Math.floor(n / playbookCost).toLocaleString()} win playbooks`,
    `${Math.floor(n / searchCost).toLocaleString()} opportunity searches`,
  ];

  const planRows = plans.map((p) => ({
    id: p.id,
    name: p.label,
    tag: p.id === 'mid' ? 'Popular' : null,
    highlight: p.id === 'mid',
    creditsPerMonth: p.creditsPerMonth,
    perMo: p.monthly.usd,
    href: p.monthly.checkoutUrl,
  }));

  // ---- Plan finder ----
  const perOppCost = ACTIVITIES.filter((a) => picked.has(a.id)).reduce((s, a) => s + exampleCost(tools, a.tools), 0);
  const monthlyNeed = perOppCost * oppsPerMonth;
  const rec = ((): { tier: string; cap: number | null; cta: string; href: string; accent: 'slate' | 'emerald' | 'amber'; sub: string } | null => {
    if (!picked.size || monthlyNeed <= 0) return null;
    if (monthlyNeed <= trial) return { tier: 'Free trial', cap: trial, cta: 'Start free', href: '/app', accent: 'slate', sub: `Your ${trial} signup credits cover a first month at this pace.` };
    const plan = plans.find((p) => p.creditsPerMonth >= monthlyNeed);
    if (!plan) {
      const biggest = plans[plans.length - 1];
      return { tier: 'Enterprise / API', cap: null, cta: 'Contact sales', href: ENTERPRISE_MAILTO, accent: 'amber', sub: `At ~${monthlyNeed.toLocaleString()} credits/mo you’re past the ${biggest.label} plan (${biggest.creditsPerMonth.toLocaleString()}/mo) — a custom pool is the right fit.` };
    }
    return { tier: `${plan.label} plan`, cap: plan.creditsPerMonth, cta: `Get ${plan.label} — $${plan.monthly.usd}/mo`, href: plan.monthly.checkoutUrl, accent: 'emerald', sub: `$${plan.monthly.usd}/mo — ${plan.creditsPerMonth.toLocaleString()} credits every month, all tools + the moat.` };
  })();
  const usePct = rec && rec.cap ? Math.min(100, Math.round((monthlyNeed / rec.cap) * 100)) : 0;

  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });

  return (
    <main className="min-h-dvh bg-[#0a0f1e] text-slate-100 [color-scheme:dark]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <McpNav active="pricing" />

        {/* Hero */}
        <section className="mt-12 text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">Start free. Pay as you grow.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-sm text-slate-400 sm:text-[15px]">
            Metered federal-contracting credits for any AI agent. Start with a free trial, then pick a monthly plan — every tool is charged per successful call, so you never pay for a miss. {tools.length ? `${toolCount} tools live today.` : 'Dozens of tools live today.'}
          </p>
        </section>

        {/* Wayfinding to the plan finder */}
        <div className="mt-8 flex justify-center">
          <a href="#find-plan" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-[13px] font-medium text-slate-300 hover:border-white/20 hover:text-slate-100">
            <span className="text-slate-500">⤳</span> Not sure which plan? <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">Size it</span>
          </a>
        </div>

        {/* The plans — the loved Higgsfield 2×2: Entry · Mid (top) / Agency · Enterprise (bottom).
            No Free card here on purpose — free lives in the hero + Sign in. */}
        <section className="mt-6 grid items-stretch gap-4 md:grid-cols-2">
          {/* Entry · Mid · Agency — metered credit plans, each in its own color */}
          {planRows.map((p) => {
            const t = PLAN_THEME[p.id] ?? FALLBACK_THEME;
            return (
              <div key={p.id} className={`relative flex flex-col rounded-2xl border p-6 ${t.card}`}>
                <span className={`absolute -top-2.5 left-6 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${t.badge}`}>{t.tag}</span>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[12px] font-semibold uppercase tracking-wide ${t.accent}`}>{p.name}</span>
                  <span className="text-[11px] text-slate-500">credits plan</span>
                </div>
                <div className="mt-1 min-h-[2.75rem] text-[13px] leading-relaxed text-slate-400">{PACK_BLURB[p.id] ?? 'Every tool, including the moat.'}</div>
                <div className={`mt-2 rounded-xl border p-3 ${t.box}`}>
                  <div className={`flex items-baseline gap-1.5 ${t.boxText}`}>
                    <span aria-hidden>✦</span>
                    <b className="font-mono text-[15px] font-semibold tabular-nums">{p.creditsPerMonth.toLocaleString()}</b>
                    <span className="text-[13px] font-semibold">credits/mo</span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-[12px] text-slate-300">
                    {outcomes(p.creditsPerMonth).map((o) => <li key={o} className="tabular-nums">· {o} <span className="text-slate-500">/mo</span></li>)}
                  </ul>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="font-mono text-4xl font-bold tabular-nums">${p.perMo}</span>
                  <span className="text-[13px] text-slate-400">billed monthly</span>
                </div>
                <ul className="mt-4 flex-1 space-y-2 border-t border-white/[0.06] pt-4 text-[12.5px]">
                  <li className="flex gap-2"><span className={t.check}>✓</span> <span><b className="font-semibold text-slate-200">All {toolCount} metered tools</b> + the proprietary moat</span></li>
                  <li className="flex gap-2"><span className={t.check}>✓</span> <span>Charged on success only · {p.creditsPerMonth.toLocaleString()} credits every month</span></li>
                  <li className="flex gap-2"><span className={t.check}>✓</span> <span>Top up any time · optional auto-recharge</span></li>
                  <li className="flex gap-2"><span className={t.check}>✓</span> <span>Keyless connect — sign in through your browser</span></li>
                </ul>
                <a href={p.href} className={`mt-5 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold ${t.cta}`}>Get {p.name}</a>
              </div>
            );
          })}

          {/* Enterprise / API — the 4th card in the 2×2 (inquiry-only, moat-doc feed buyers) */}
          <div className="relative flex flex-col rounded-2xl border border-amber-300/30 bg-amber-300/[0.04] p-6">
            <span className="absolute -top-2.5 left-6 rounded-full border border-amber-300/40 bg-[#0a0f1e] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">For primes · funds · partners</span>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-amber-200">Enterprise / API</span>
              <span className="text-[11px] text-slate-500">custom</span>
            </div>
            <div className="mt-1 min-h-[2.75rem] text-[13px] leading-relaxed text-slate-400">For primes, agencies, funds, lenders &amp; partners who need the <b className="font-semibold text-slate-200">data as a feed or high-volume API</b> — not a seat.</div>
            <div className="mt-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3">
              <div className="flex items-baseline gap-1.5 text-amber-100">
                <span aria-hidden>✦</span>
                <b className="font-mono text-[15px] font-semibold">Custom</b>
                <span className="text-[13px] font-semibold">credit pool</span>
              </div>
              <ul className="mt-1.5 space-y-0.5 text-[12px] text-slate-300">
                <li>· Sized to your team &amp; volume</li>
                <li>· Feed license / high-volume API</li>
                <li>· Pooled across every seat</li>
              </ul>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-bold">Let&apos;s talk</span>
            </div>
            <div className="mt-1 text-[12px] text-amber-200/80">Volume pricing · annual invoicing</div>
            <ul className="mt-4 flex-1 space-y-2 border-t border-amber-300/15 pt-4 text-[12.5px]">
              <li className="flex gap-2"><span className="text-amber-300">◆</span> <span>High-volume programmatic API access</span></li>
              <li className="flex gap-2"><span className="text-amber-300">◆</span> <span>SSO / SAML · dedicated success manager · SLA</span></li>
              <li className="flex gap-2"><span className="text-amber-300">◆</span> <span>Custom integrations · a data / feed license</span></li>
            </ul>
            <a href={ENTERPRISE_MAILTO} className="mt-5 inline-flex items-center justify-center rounded-lg border border-amber-300/40 px-4 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-300/10">Contact sales</a>
          </div>
        </section>

        {/* One-time top-up — slim full-width strip below the 2×2 */}
        <section className="mt-4 flex flex-col items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-4 sm:flex-row">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-300">One-time top-up</span>
            <span className="font-mono text-2xl font-bold tabular-nums">${topup.usd}</span>
            <span className="text-[13px] text-emerald-300">{topup.credits.toLocaleString()} credits</span>
            <span className="text-[12px] text-slate-500">· ran out mid-month? a refill, no plan change · powers auto-recharge</span>
          </div>
          <a href={topup.checkoutUrl} className="inline-flex shrink-0 items-center justify-center rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5">Buy top-up</a>
        </section>

        {/* App cross-sell note (taste) */}
        <div className="mt-4 flex justify-center">
          <div className="max-w-2xl rounded-xl border border-indigo-400/25 bg-indigo-400/[0.05] px-5 py-3 text-center text-[13px] text-slate-300">
            Already on the <b className="font-semibold text-indigo-200">Mindy app</b>? Pro (${PRO_APP_USD}/mo) includes <b className="font-semibold text-white">{PRO_APP_CREDITS} MCP credits/mo</b> and Team (${TEAM_APP_USD}/mo) includes <b className="font-semibold text-white">{TEAM_APP_CREDITS}</b> — connect the same account.{' '}
            <Link href={APP_PRICING_URL} className="font-semibold text-indigo-300 underline underline-offset-2 hover:text-indigo-200">See app plans →</Link>
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-[12px] leading-relaxed text-slate-500">
          The <b className="font-medium text-slate-300">moat</b> is Mindy&apos;s un-copyable layer — {MOAT_LIST} — included with every paid plan. The free trial runs public-data tools only. Every metered tool is charged on success.
        </p>
        <p className="mx-auto mt-2 max-w-2xl text-center text-[12px] leading-relaxed text-slate-500">
          A <span className="text-slate-400">work-up</span> ≈ search one opportunity, pull the incumbent&apos;s financials, run a who-can-win scan, and generate a win playbook (~{workupCost} credits). Lighter lookups cost far less.
        </p>

        {/* Plan finder */}
        <section id="find-plan" className="mt-16 scroll-mt-8">
          <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">Find your plan</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-[13px] text-slate-400">Tell us what your agent will do. We&apos;ll price it against the live catalog and point you at the right tier.</p>
          <div className="mx-auto mt-6 max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="grid gap-0 sm:grid-cols-5">
              {/* Inputs */}
              <div className="border-b border-white/10 p-5 sm:col-span-3 sm:border-b-0 sm:border-r">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">For each opportunity, my agent will…</div>
                <div className="mt-3 space-y-2">
                  {ACTIVITIES.map((a) => {
                    const on = picked.has(a.id);
                    const cost = exampleCost(tools, a.tools);
                    return (
                      <button key={a.id} type="button" onClick={() => toggle(a.id)} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${on ? 'border-emerald-400/40 bg-emerald-400/[0.06]' : 'border-white/10 bg-white/[0.02] hover:border-white/20'}`}>
                        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${on ? 'border-emerald-400 bg-emerald-500 text-[#06120c]' : 'border-white/25 text-transparent'}`}>✓</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-slate-100">{a.label}</span>
                          <span className="block truncate text-[11.5px] text-slate-500">{a.note}</span>
                        </span>
                        <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-slate-400">{cost} cr</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5">
                  <div className="flex items-center justify-between text-[12px] text-slate-400">
                    <span>Opportunities worked per month</span>
                    <span className="font-mono text-[15px] font-semibold tabular-nums text-slate-100">{oppsPerMonth}</span>
                  </div>
                  <input type="range" min={1} max={50} value={oppsPerMonth} onChange={(e) => setOppsPerMonth(Number(e.target.value))} className="mt-2 w-full accent-emerald-500" aria-label="Opportunities per month" />
                  <div className="mt-1 flex justify-between text-[10px] text-slate-600"><span>1</span><span>50</span></div>
                </div>
              </div>
              {/* Result */}
              <div className="flex flex-col justify-center p-5 sm:col-span-2">
                {rec ? (
                  <>
                    <div className="text-[12px] uppercase tracking-wide text-slate-500">We recommend</div>
                    <div className={`mt-1 text-2xl font-bold ${rec.accent === 'amber' ? 'text-amber-200' : rec.accent === 'emerald' ? 'text-emerald-300' : 'text-slate-100'}`}>{rec.tier}</div>
                    <div className="mt-3 text-[13px] text-slate-300">
                      <span className="font-mono font-semibold tabular-nums text-slate-100">~{monthlyNeed.toLocaleString()}</span> credits/month
                      <span className="text-slate-500"> — {perOppCost} cr × {oppsPerMonth} opps</span>
                    </div>
                    {rec.cap && (
                      <div className="mt-3">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${usePct}%` }} />
                        </div>
                        <div className="mt-1 text-[11px] tabular-nums text-slate-500">{monthlyNeed.toLocaleString()} of {rec.cap.toLocaleString()} credits</div>
                      </div>
                    )}
                    <p className="mt-3 text-[12px] leading-relaxed text-slate-400">{rec.sub}</p>
                    <a href={rec.href} className={`mt-4 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-[13px] font-semibold ${rec.accent === 'amber' ? 'border border-amber-300/40 text-amber-100 hover:bg-amber-300/10' : 'bg-emerald-500 text-[#06120c] hover:bg-emerald-400'}`}>{rec.cta}</a>
                  </>
                ) : (
                  <div className="text-center text-[13px] text-slate-500">Pick at least one workflow to see your recommendation.</div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Compare */}
        <section className="mt-16">
          <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">Compare every plan</h2>
          <div className="mx-auto mt-6 max-w-3xl overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
            <table className="w-full min-w-[680px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="p-4 font-medium text-slate-400">Feature</th>
                  <th className="p-4 text-center font-semibold text-slate-300">Free</th>
                  <th className="p-4 text-center font-semibold text-emerald-300">Entry</th>
                  <th className="p-4 text-center font-semibold text-emerald-300">Mid</th>
                  <th className="p-4 text-center font-semibold text-emerald-300">Agency</th>
                  <th className="p-4 text-center font-semibold text-amber-200">Enterprise</th>
                </tr>
              </thead>
              <tbody className="[&_td]:p-4 [&_td:not(:first-child)]:text-center [&_tr]:border-t [&_tr]:border-white/[0.06]">
                <CompareRow label="Monthly credit allowance" free={`${trial} once`} entry="500/mo" mid="1,500/mo" agency="8,000/mo" ent="custom" />
                <CompareRow label="Public-data tools (SAM · USASpending · EDGAR · GSA)" free="yes" entry="yes" mid="yes" agency="yes" ent="yes" />
                <CompareRow label="Proprietary moat (playbook · contacts · angles · lessons)" free="no" entry="yes" mid="yes" agency="yes" ent="yes" />
                <CompareRow label="Charged on success only" free="yes" entry="yes" mid="yes" agency="yes" ent="yes" />
                <CompareRow label="One-time top-ups · auto-recharge" free="no" entry="yes" mid="yes" agency="yes" ent="yes" />
                <CompareRow label="Proposal drafting (metered)" free="no" entry="yes" mid="yes" agency="yes" ent="yes" />
                <CompareRow label="Data feed / high-volume API" free="no" entry="no" mid="no" agency="no" ent="yes" />
                <CompareRow label="SSO / SAML · dedicated CSM · SLA" free="no" entry="no" mid="no" agency="no" ent="yes" />
                <CompareRow label="Best for" free="try it" entry="project / occasional" mid="daily BD" agency="high volume" ent="primes · funds · partners" />
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-16">
          <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">Questions</h2>
          <div className="mx-auto mt-6 max-w-2xl divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[14px] font-semibold text-slate-200 marker:hidden">
                  {f.q}
                  <span className="shrink-0 text-slate-500 transition group-open:rotate-45">＋</span>
                </summary>
                <p className="pb-4 text-[13px] leading-relaxed text-slate-400">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mt-16 rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-400/[0.08] to-indigo-500/[0.06] p-8 text-center">
          <h2 className="text-balance text-xl font-bold sm:text-2xl">Point your agent at Mindy in five minutes.</h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-slate-400">Start with {trial} free credits — no card. Add a plan when you&apos;re ready.</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <a href="/app" className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">Start free with {trial} credits</a>
            <Link href="/mcp" className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5">See it in action →</Link>
          </div>
        </section>
      </div>
    </main>
  );
}

/** One row of the compare matrix. Semantic cells: yes → colored check, no/— → muted, text → verbatim. */
function CompareRow({ label, free, entry, mid, agency, ent }: { label: string; free: string; entry: string; mid: string; agency: string; ent: string }) {
  const cell = (v: string, accent: 'slate' | 'emerald' | 'amber') => {
    if (v === 'yes') return <span className={accent === 'amber' ? 'text-amber-300' : accent === 'slate' ? 'text-slate-300' : 'text-emerald-400'}>✓</span>;
    if (v === 'no') return <span className="text-slate-600">–</span>;
    return <span className="text-[12px] tabular-nums text-slate-300">{v}</span>;
  };
  return (
    <tr>
      <td className="text-slate-300">{label}</td>
      <td>{cell(free, 'slate')}</td>
      <td>{cell(entry, 'emerald')}</td>
      <td>{cell(mid, 'emerald')}</td>
      <td>{cell(agency, 'emerald')}</td>
      <td>{cell(ent, 'amber')}</td>
    </tr>
  );
}
