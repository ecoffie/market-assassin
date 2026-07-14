'use client';

/**
 * getmindy.ai/mcp/pricing — standalone PUBLIC pricing page. Three ways to pay:
 *   1. Free trial — signup credits, public-data tools only.
 *   2. Pay-as-you-go CREDITS (metered — every tool, incl. the moat, pay per success).
 *   3. PRO subscription ($149/mo or $1,490/yr) — monthly credit allowance + the gated
 *      moat + Proposal Assist 2.0 + the full Mindy app.
 *
 * Packaging rule (see the catalog artifact): meter everything by default; gate only
 * for the four reasons — differentiation, build-cost, capability depth, security.
 * Numbers come from the public /api/mcp/catalog (no auth). Credit → outcome math is
 * priced from the LIVE catalog, never hardcoded, so the page can't over-promise.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Catalog, McpNav, workupCostFrom, workups, toolCr, exampleCost } from '../catalog-ui';

const PRO_MONTHLY = 149;
const PRO_ANNUAL = 1490; // 2 months free
const PRO_MONTHLY_URL = 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C';
const PRO_ANNUAL_URL = 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D';
const ANNUAL_SAVE = PRO_MONTHLY * 12 - PRO_ANNUAL; // $298
const ANNUAL_PER_MO = Math.round(PRO_ANNUAL / 12); // $124

/**
 * The proprietary "moat" tools — Mindy's un-copyable layer. Included with ANY paid
 * credits (not the free trial, which runs the public-data tools). All live today.
 */
const MOAT_TOOLS: { label: string; note: string }[] = [
  { label: 'Winning playbook', note: 'coaching from the 8-yr teaching corpus' },
  { label: 'Podcast lessons', note: 'real win stories from contractor/agency guests' },
  { label: 'Curated contact rosters', note: 'SBLO teaming · buying-office POCs · OSBP' },
  { label: 'Agency angles', note: 'component spending · budget trends · pain points' },
  { label: 'Proposal tools', note: 'pre-submit compliance scan · bid / no-bid framework' },
];

/** What the Pro subscription adds beyond the metered credit catalog. */
const PRO_INCLUDES: { label: string; note: string; status: 'live' | 'soon' }[] = [
  { label: 'Proposal Assist 2.0', note: 'RFP → compliance matrix → multi-section draft → .docx', status: 'soon' },
  { label: 'Full Mindy app', note: 'alerts, pipeline, forecasts, CRM at getmindy.ai/app', status: 'live' },
];

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
  { q: 'Do credits expire?', a: 'Prepaid credit-pack credits never expire — use them whenever. Pro includes a fresh monthly allowance that renews each cycle (it does not roll over), so heavy daily users never have to think about topping up.' },
  { q: 'What is the "moat," and why is it paid-only?', a: 'The moat is Mindy’s un-copyable layer: the winning playbook, curated teaming/OSBP contacts, agency angles, and podcast lessons — built from an 8-year teaching corpus, not scraped from public APIs. The free trial runs the public-data tools (SAM, USASpending, EDGAR, GSA, forecasts); any credit pack or Pro unlocks the moat.' },
  { q: 'Credits or Pro — which do I need?', a: 'Credit packs suit project or occasional use — pay only for what you run, no subscription. Pro is the best value if your agent works federal opportunities daily: a monthly credit allowance, plus Proposal Assist 2.0 and the full Mindy app.' },
  { q: 'Do I need a credit card to start?', a: 'No. You get signup credits free on your first connect — sign in through your browser, point your MCP client at Mindy, and start calling tools. Add a pack or go Pro only when you want more.' },
  { q: 'I already pay for Mindy Pro. Do I get MCP credits?', a: 'Yes — your $149/mo Pro plan includes a monthly MCP credit allowance at no extra cost. Connect with the same account and the credits are already there.' },
  { q: 'What happens when I run out of credits?', a: 'The next tool call is declined with a top-up message before it runs — you are never charged into a negative balance. Add a pack or wait for your Pro allowance to renew.' },
];

export default function McpPricing() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [annual, setAnnual] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(['find', 'incumbent', 'playbook']));
  const [oppsPerMonth, setOppsPerMonth] = useState(5);

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
  const workupCost = tools.length ? workupCostFrom(tools) : 30;
  const searchCost = toolCr(tools, 'search_sam_opportunities', 1);
  const playbookCost = toolCr(tools, 'get_winning_playbook', 2);
  const popularId = packs.length >= 2 ? packs[1].id : undefined;
  const popularPack = packs.find((p) => p.id === popularId);
  const creditsAnchor = popularPack?.credits ?? 800;

  /** Turn an abstract credit balance into concrete BD outcomes (the Higgsfield move, our way). */
  const outcomes = (n: number) => [
    `≈ ${workups(n, workupCost)} full opportunity work-ups`,
    `${Math.floor(n / playbookCost).toLocaleString()} win playbooks`,
    `${Math.floor(n / searchCost).toLocaleString()} opportunity searches`,
  ];

  const packRows = packs.map((p) => ({
    id: p.id,
    name: p.label.split('—')[0].trim(),
    tag: p.id === popularId ? 'Popular' : p.id === 'scale' ? 'Best rate' : null,
    highlight: p.id === popularId,
    price: `$${p.usd}`,
    credits: p.credits,
  }));

  // ---- Plan finder ----
  const perOppCost = ACTIVITIES.filter((a) => picked.has(a.id)).reduce((s, a) => s + exampleCost(tools, a.tools), 0);
  const monthlyNeed = perOppCost * oppsPerMonth;
  const rec = ((): { tier: string; cap: number; cta: string; href: string; accent: 'slate' | 'emerald' | 'indigo'; sub: string } | null => {
    if (!picked.size || monthlyNeed <= 0) return null;
    if (monthlyNeed <= trial) return { tier: 'Free trial', cap: trial, cta: 'Start free', href: '/app', accent: 'slate', sub: `Your ${trial} signup credits cover a first month at this pace.` };
    if (monthlyNeed >= proCredits * 0.7) return { tier: 'Pro', cap: proCredits, cta: 'Go Pro', href: annual ? PRO_ANNUAL_URL : PRO_MONTHLY_URL, accent: 'indigo', sub: `At this volume a monthly allowance is the best value — ${proCredits.toLocaleString()} credits every cycle.` };
    const pack = packs.find((p) => p.credits >= monthlyNeed) ?? packs[packs.length - 1];
    return pack ? { tier: `${pack.label.split('—')[0].trim()} pack`, cap: pack.credits, cta: `Get ${pack.credits.toLocaleString()} credits — $${pack.usd}`, href: '/app', accent: 'emerald', sub: `Prepaid, no subscription — refill whenever you like.` } : null;
  })();
  const usePct = rec ? Math.min(100, Math.round((monthlyNeed / rec.cap) * 100)) : 0;

  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });

  const proPrice = annual ? `$${PRO_ANNUAL.toLocaleString()}` : `$${PRO_MONTHLY}`;
  const proUnit = annual ? '/yr' : '/mo';
  const proHref = annual ? PRO_ANNUAL_URL : PRO_MONTHLY_URL;

  return (
    <main className="min-h-dvh bg-[#0a0f1e] text-slate-100 [color-scheme:dark]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <McpNav active="pricing" />

        {/* Hero */}
        <section className="mt-12 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[12px] font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {trial} free credits on your first connect — no card
          </span>
          <h1 className="mt-5 text-balance text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">Start free. Pay as you grow.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-sm text-slate-400 sm:text-[15px]">
            Federal contracting intel for any AI agent. A one-time free trial, pay-as-you-go credits, or Pro — every tool is metered, so you pay per successful call and never for a miss. {tools.length ? `${tools.filter((t) => t.credits > 0).length} tools live today.` : 'Dozens of tools live today.'}
          </p>
        </section>

        {/* Billing toggle + plan-finder wayfinding */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a href="#find-plan" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-[13px] font-medium text-slate-300 hover:border-white/20 hover:text-slate-100">
            <span className="text-slate-500">⤳</span> Not sure which plan? <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-300">Sizer</span>
          </a>
          <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] p-1 text-[13px]">
            <button type="button" onClick={() => setAnnual(false)} className={`rounded-lg px-4 py-1.5 font-semibold transition ${!annual ? 'bg-white/[0.08] text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>Monthly</button>
            <button type="button" onClick={() => setAnnual(true)} className={`flex items-center gap-2 rounded-lg px-4 py-1.5 font-semibold transition ${annual ? 'bg-white/[0.08] text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>
              Annual <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-[#06120c]">2 mo free</span>
            </button>
          </div>
        </div>

        {/* Three tiers */}
        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          {/* Free trial */}
          <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-300">Free trial</div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-4xl font-bold tabular-nums">$0</span>
              <span className="text-[13px] text-slate-500">one-time</span>
            </div>
            <div className="mt-1 text-[13px] text-slate-400">Kick the tires — no card needed.</div>
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="text-[12px] text-slate-400"><b className="font-mono text-[15px] tabular-nums text-slate-100">{trial}</b> signup credits get you</div>
              <ul className="mt-1.5 space-y-0.5 text-[12px] text-slate-400">
                {outcomes(trial).map((o) => <li key={o} className="tabular-nums">· {o}</li>)}
              </ul>
            </div>
            <ul className="mt-5 flex-1 space-y-2 border-t border-white/[0.06] pt-5 text-[13px]">
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> <span><b className="font-semibold">Public-data tools</b> — SAM, USASpending, EDGAR, GSA pricing, forecasts, recompetes, contractor scans</span></li>
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> <span>Keyless connect — sign in through your browser</span></li>
              <li className="flex gap-2 text-slate-500"><span>–</span> <span>Proprietary moat needs a credit pack</span></li>
            </ul>
            <a href="/app" className="mt-6 inline-flex items-center justify-center rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5">Start free</a>
          </div>

          {/* Credits */}
          <div className="relative flex flex-col rounded-2xl border border-emerald-400/40 bg-emerald-400/[0.05] p-6 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]">
            <span className="absolute -top-2.5 left-6 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#06120c]">Most popular</span>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-emerald-300">Credits</div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-4xl font-bold tabular-nums">from $5</span>
              <span className="text-[13px] text-slate-500">pay-as-you-go</span>
            </div>
            <div className="mt-1 text-[13px] text-slate-400">Every tool, including the moat. No subscription.</div>
            <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3">
              <div className="text-[12px] text-emerald-200/80"><b className="font-mono text-[15px] tabular-nums text-emerald-100">{creditsAnchor.toLocaleString()}</b> credits (Plus pack) gets you</div>
              <ul className="mt-1.5 space-y-0.5 text-[12px] text-slate-300">
                {outcomes(creditsAnchor).map((o) => <li key={o} className="tabular-nums">· {o}</li>)}
              </ul>
            </div>
            <ul className="mt-5 flex-1 space-y-1.5 border-t border-emerald-400/15 pt-5 text-[13px]">
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> <span>Everything in the trial, <b className="font-semibold">plus the proprietary moat:</b></span></li>
              {MOAT_TOOLS.map((m) => (
                <li key={m.label} className="flex items-start gap-2 pl-4">
                  <span className="mt-px text-emerald-300">◆</span>
                  <span><b className="font-semibold">{m.label}</b> <span className="text-slate-500">— {m.note}</span></span>
                </li>
              ))}
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> <span>Charged on success only · credits never expire</span></li>
            </ul>
            <a href="#packs" className="mt-6 inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">See credit packs</a>
          </div>

          {/* Pro */}
          <div className="relative flex flex-col rounded-2xl border border-indigo-400/40 bg-indigo-400/[0.06] p-6">
            <span className="absolute -top-2.5 left-6 rounded-full bg-indigo-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Best for daily use</span>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-indigo-300">Pro</div>
            <div className="mt-3 flex items-baseline gap-2">
              {annual && <span className="font-mono text-xl font-semibold tabular-nums text-slate-500 line-through">${PRO_MONTHLY}</span>}
              <span className="font-mono text-4xl font-bold tabular-nums">${annual ? ANNUAL_PER_MO : PRO_MONTHLY}</span>
              <span className="text-[13px] text-slate-400">/mo</span>
            </div>
            <div className="mt-1 h-4 text-[12px] text-emerald-300">
              {annual ? `billed annually ($${PRO_ANNUAL.toLocaleString()}/yr) · save $${ANNUAL_SAVE}` : ''}
            </div>
            <div className="mt-1 text-[13px] text-slate-400">The whole platform, credits included.</div>
            <div className="mt-4 rounded-xl border border-indigo-400/15 bg-indigo-400/[0.05] p-3">
              <div className="text-[12px] text-indigo-200/80"><b className="font-mono text-[15px] tabular-nums text-indigo-100">{proCredits.toLocaleString()}</b> credits every month gets you</div>
              <ul className="mt-1.5 space-y-0.5 text-[12px] text-slate-300">
                {outcomes(proCredits).map((o) => <li key={o} className="tabular-nums">· {o}</li>)}
              </ul>
            </div>
            <ul className="mt-5 flex-1 space-y-1.5 border-t border-indigo-400/15 pt-5 text-[13px]">
              <li className="flex gap-2"><span className="text-indigo-300">◆</span> <span>Everything credits unlock, <b className="font-semibold">included</b></span></li>
              <li className="flex gap-2"><span className="text-indigo-300">◆</span> <span><b className="font-semibold">{proCredits.toLocaleString()} credits / month</b> <span className="text-slate-500">— renews automatically</span></span></li>
              {PRO_INCLUDES.map((u) => (
                <li key={u.label} className="flex items-start gap-2">
                  <span className="mt-px text-indigo-300">◆</span>
                  <span>
                    <b className="font-semibold">{u.label}</b> <span className="text-slate-500">— {u.note}</span>{' '}
                    {u.status === 'soon' && <span className="ml-0.5 rounded-full border border-white/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-400">rolling out</span>}
                  </span>
                </li>
              ))}
            </ul>
            <a href={proHref} className="mt-6 inline-flex items-center justify-center rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400">Go Pro {annual ? 'annually' : 'monthly'}</a>
            <div className="mt-2 h-4 text-center text-[11.5px] text-slate-500">{annual ? <><b className="font-semibold text-emerald-300">Save ${ANNUAL_SAVE}</b> compared to monthly</> : 'Switch to annual for 2 months free'}</div>
          </div>
        </section>
        <p className="mx-auto mt-4 max-w-2xl text-center text-[12px] leading-relaxed text-slate-500">
          The <b className="font-medium text-slate-300">moat</b> — winning playbook, curated contacts, podcast lessons, agency angles — is Mindy&apos;s un-copyable layer, included with <b className="font-medium text-slate-300">any credit pack</b>. The free trial runs the public-data tools. Every metered tool is charged on success only.
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
                    <div className={`mt-1 text-2xl font-bold ${rec.accent === 'indigo' ? 'text-indigo-300' : rec.accent === 'emerald' ? 'text-emerald-300' : 'text-slate-100'}`}>{rec.tier}</div>
                    <div className="mt-3 text-[13px] text-slate-300">
                      <span className="font-mono font-semibold tabular-nums text-slate-100">~{monthlyNeed.toLocaleString()}</span> credits/month
                      <span className="text-slate-500"> — {perOppCost} cr × {oppsPerMonth} opps</span>
                    </div>
                    <div className="mt-3">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                        <div className={`h-full rounded-full ${rec.accent === 'indigo' ? 'bg-indigo-400' : 'bg-emerald-400'}`} style={{ width: `${usePct}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] tabular-nums text-slate-500">{monthlyNeed.toLocaleString()} of {rec.cap.toLocaleString()} credits</div>
                    </div>
                    <p className="mt-3 text-[12px] leading-relaxed text-slate-400">{rec.sub}</p>
                    <a href={rec.href} className={`mt-4 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-[13px] font-semibold ${rec.accent === 'indigo' ? 'bg-indigo-500 text-white hover:bg-indigo-400' : 'bg-emerald-500 text-[#06120c] hover:bg-emerald-400'}`}>{rec.cta}</a>
                  </>
                ) : (
                  <div className="text-center text-[13px] text-slate-500">Pick at least one workflow to see your recommendation.</div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Credit packs */}
        <section id="packs" className="mt-16 scroll-mt-8">
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
                <div className="tabular-nums"><span className="text-[15px] font-semibold text-slate-100">{t.price}</span><span className="ml-1.5 text-[11px] text-slate-500 sm:ml-0 sm:block">prepaid</span></div>
                <div className="text-[13px] text-slate-400"><span className="font-medium tabular-nums text-slate-200">{t.credits.toLocaleString()} credits</span><span className="text-slate-600"> · </span>~{workups(t.credits, workupCost)} work-ups</div>
                <a href="/app" className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-[13px] font-semibold sm:justify-self-end ${t.highlight ? 'bg-emerald-500 text-[#06120c] hover:bg-emerald-400' : 'border border-white/15 text-slate-200 hover:bg-white/5'}`}>Get credits</a>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-3 max-w-2xl text-center text-[12px] leading-relaxed text-slate-500">
            A <span className="text-slate-400">work-up</span> ≈ search one opportunity, pull the incumbent&apos;s financials, run a who-can-win scan, and generate a win playbook (~{workupCost} credits). Lighter lookups cost far less.
          </p>
        </section>

        {/* Compare features */}
        <section className="mt-16">
          <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">Compare every plan</h2>
          <div className="mx-auto mt-6 max-w-3xl overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="p-4 font-medium text-slate-400">Feature</th>
                  <th className="p-4 text-center font-semibold text-slate-200">Free trial</th>
                  <th className="p-4 text-center font-semibold text-emerald-300">Credits</th>
                  <th className="p-4 text-center font-semibold text-indigo-300">Pro</th>
                </tr>
              </thead>
              <tbody className="[&_td]:p-4 [&_td:not(:first-child)]:text-center [&_tr]:border-t [&_tr]:border-white/[0.06]">
                <CompareRow label="Public-data tools (SAM · USASpending · EDGAR · GSA · forecasts)" free="yes" credits="yes" pro="yes" />
                <CompareRow label="Proprietary moat (playbook · contacts · agency angles · lessons)" free="no" credits="yes" pro="yes" />
                <CompareRow label="Charged on success only" free="yes" credits="yes" pro="yes" />
                <CompareRow label="Signup credits" free={`${trial}`} credits="—" pro="—" />
                <CompareRow label="Pay-as-you-go credit packs" free="no" credits="yes" pro="yes" />
                <CompareRow label="Monthly credit allowance" free="—" credits="—" pro={`${proCredits.toLocaleString()}/mo`} />
                <CompareRow label="Credits expire" free="never" credits="never" pro="renews monthly" />
                <CompareRow label="Proposal Assist 1.0 (metered drafts)" free="no" credits="yes" pro="yes" />
                <CompareRow label="Proposal Assist 2.0 (full RFP suite)" free="no" credits="no" pro="soon" />
                <CompareRow label="Full Mindy app (alerts · pipeline · CRM)" free="no" credits="no" pro="yes" />
                <CompareRow label="Best for" free="kicking the tires" credits="project / occasional" pro="daily BD" />
              </tbody>
            </table>
          </div>
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
        <section className="mt-16 rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/[0.08] to-emerald-400/[0.06] p-8 text-center">
          <h2 className="text-balance text-xl font-bold sm:text-2xl">Point your agent at Mindy in five minutes.</h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-slate-400">Start with {trial} free credits — no card. Add a pack or go Pro when you&apos;re ready.</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <a href="/app" className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">Start free with {trial} credits</a>
            <a href={proHref} className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400">Go Pro — {proPrice}{proUnit}</a>
          </div>
          <p className="mt-3 text-[12px] text-slate-500"><Link href="/mcp" className="underline underline-offset-2 hover:text-slate-300">See it in action →</Link></p>
        </section>
      </div>
    </main>
  );
}

/** One row of the compare matrix. Semantic cells: yes → emerald check, no/— → muted, text → verbatim. */
function CompareRow({ label, free, credits, pro }: { label: string; free: string; credits: string; pro: string }) {
  const cell = (v: string, accent: 'emerald' | 'indigo' | 'slate') => {
    if (v === 'yes') return <span className={accent === 'indigo' ? 'text-indigo-300' : 'text-emerald-400'}>✓</span>;
    if (v === 'no') return <span className="text-slate-600">–</span>;
    if (v === 'soon') return <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">soon</span>;
    return <span className="text-[12px] tabular-nums text-slate-300">{v}</span>;
  };
  return (
    <tr>
      <td className="text-slate-300">{label}</td>
      <td>{cell(free, 'slate')}</td>
      <td>{cell(credits, 'emerald')}</td>
      <td>{cell(pro, 'indigo')}</td>
    </tr>
  );
}
