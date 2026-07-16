/**
 * Shared building blocks for the two public MCP pages:
 *   /mcp          — the Connect / landing page (page.tsx, logged-out state)
 *   /mcp/pricing  — the standalone pricing page (pricing/page.tsx)
 *
 * Types + the public catalog shape, the cross-page nav, the app-icon cluster, and
 * the credit/work-up math live here so the two pages stay in sync. No auth, no PII.
 */
import React from 'react';
import Link from 'next/link';

export interface Tool { name: string; description: string; credits: number }
export interface Pkg { id: string; credits: number; usd: number; label: string; checkoutUrl?: string }
/** Credit subscription (the /mcp/pricing acquisition plans) — monthly + annual price. */
export interface SubPlanPrice { priceId: string; usd: number; credits: number; checkoutUrl: string }
export interface SubPlan {
  id: string;
  label: string;
  creditsPerMonth: number;
  monthly: SubPlanPrice;
  annual: SubPlanPrice & { usdPerMonth: number };
}
export interface Catalog { tools: Tool[]; packages: Pkg[]; subscriptionPlans: SubPlan[]; signupCredits: number; proMonthlyCredits: number }

export const MCP_URL = 'https://getmindy.ai/mcp/mcp';

// ---- Credit / work-up math (priced from the LIVE catalog, never hardcoded) -----
export const toolCr = (tools: Tool[], name: string, fallback: number) =>
  tools.find((t) => t.name === name)?.credits ?? fallback;

/** An "opportunity work-up" = search one opp + incumbent financials + who-can-win scan + win playbook. */
export const workupCostFrom = (tools: Tool[]) =>
  toolCr(tools, 'search_sam_opportunities', 1) +
  toolCr(tools, 'get_incumbent_financials', 2) +
  toolCr(tools, 'find_capable_contractors', 25) +
  toolCr(tools, 'get_winning_playbook', 2);

export const workups = (credits: number, workupCost: number) => Math.max(1, Math.floor(credits / workupCost));

/** Concrete BD "recipes" — cheap → rich, so a prospect sees credits go a long way. */
export const EXAMPLES: { title: string; desc: string; tools: string[] }[] = [
  { title: 'Check today’s new opportunities', desc: 'One live SAM search across your NAICS and keywords.', tools: ['search_sam_opportunities'] },
  { title: 'Draft a win strategy', desc: 'Generate a proprietary win playbook for an opportunity.', tools: ['get_winning_playbook'] },
  { title: 'Price your bid', desc: 'GSA labor-rate intel plus regulatory demand signals.', tools: ['get_pricing_intel', 'get_regulatory_demand'] },
  { title: 'Vet an incumbent', desc: 'Pull their SEC financials and a full contractor profile.', tools: ['get_incumbent_financials', 'get_contractor_profile'] },
  { title: 'Full opportunity work-up', desc: 'Search it, read the incumbent, scan who can win, get the playbook.', tools: ['search_sam_opportunities', 'get_incumbent_financials', 'find_capable_contractors', 'get_winning_playbook'] },
  { title: 'Build a teaming shortlist', desc: 'A who-can-win scan, then deep-profile your top three partners.', tools: ['find_capable_contractors', 'get_contractor_profile', 'get_contractor_profile', 'get_contractor_profile'] },
];
export const exampleCost = (tools: Tool[], names: string[]) => names.reduce((s, n) => s + toolCr(tools, n, 1), 0);

// ---- Cross-page nav ------------------------------------------------------------
export function McpNav({ active, signedIn, balance }: { active: 'connect' | 'pricing' | 'account'; signedIn?: boolean; balance?: number | null }) {
  const link = 'rounded-lg px-3 py-1.5 font-medium transition';
  const on = 'bg-white/[0.06] text-slate-100';
  const off = 'text-slate-400 hover:text-slate-200';
  return (
    <header className="flex items-center justify-between gap-4">
      <Link href="/mcp" className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-400 text-sm font-bold text-[#0a0f1e]">M</div>
        <div className="hidden sm:block">
          <div className="text-[15px] font-semibold leading-tight">Mindy MCP</div>
          <div className="text-xs text-slate-400">Federal contracting intel for any AI agent</div>
        </div>
      </Link>
      <nav className="flex items-center gap-1 text-[13px]">
        <Link href="/mcp" className={`${link} ${active === 'connect' ? on : off}`}>Connect</Link>
        <Link href="/mcp/pricing" className={`${link} ${active === 'pricing' ? on : off}`}>Pricing</Link>
        {signedIn ? (
          <Link href="/mcp/account" className={`ml-1 flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium ${active === 'account' ? on : off}`}>
            {typeof balance === 'number' && (
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-300">{balance.toLocaleString()} cr</span>
            )}
            Account
          </Link>
        ) : (
          <a href="/app" className="ml-1 rounded-lg bg-emerald-500 px-3 py-1.5 font-semibold text-[#06120c] hover:bg-emerald-400">Sign in</a>
        )}
      </nav>
    </header>
  );
}

// ---- App-icon cluster (Mindy centered, flanked by the AI clients) --------------
// Glyph tiles, not real logos (CSP blocks external images and the marks are
// trademarked). The "Plug into…" caption under the hero names the clients plainly.
export function AppCluster() {
  const flank = (list: { t: string; c: string }[], side: 'l' | 'r') =>
    list.map((x, i) => (
      <div
        key={side + i}
        className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${x.c} text-lg font-semibold text-[#0a0f1e] ring-4 ring-[#0a0f1e]`}
      >
        {x.t}
      </div>
    ));
  return (
    <div className="flex items-center justify-center -space-x-3">
      {flank(
        [
          { t: '◍', c: 'from-slate-200 to-slate-400' },
          { t: '✦', c: 'from-violet-300 to-indigo-400' },
          { t: '❖', c: 'from-sky-300 to-cyan-400' },
        ],
        'l',
      )}
      <div className="z-10 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-400 text-2xl font-bold text-[#0a0f1e] shadow-lg ring-4 ring-[#0a0f1e]">
        M
      </div>
      {flank(
        [
          { t: '✳', c: 'from-orange-300 to-rose-400' },
          { t: '⌘', c: 'from-emerald-200 to-teal-400' },
          { t: '≋', c: 'from-fuchsia-300 to-pink-400' },
        ],
        'r',
      )}
    </div>
  );
}
