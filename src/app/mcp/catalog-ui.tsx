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

/**
 * A tool as served by the PUBLIC /api/mcp/catalog. `tier` has always been in the
 * response (it drives the pricing page's live/gated split) but was missing from this
 * interface, so consumers couldn't read it without a cast. Optional because a cached
 * or older response may omit it — treat absent as 'metered'.
 */
export interface Tool { name: string; description: string; credits: number; tier?: 'metered' | 'pro' }
export interface Pkg { id: string; credits: number; usd: number; label: string; checkoutUrl?: string }
/** Credit subscription (the /mcp/pricing acquisition plans) — monthly + annual price. */
export interface SubPlanPrice { priceId: string; usd: number; credits: number; checkoutUrl: string }
export interface SubPlan {
  id: string;
  label: string;
  creditsPerMonth: number;
  monthly: SubPlanPrice;
  /** Annual price — OPTIONAL: annual MCP variants are deferred (GOS #015, monthly-only for now). */
  annual?: SubPlanPrice & { usdPerMonth: number };
}
/** One app tier's bundled MCP allowance, as served by /api/mcp/catalog `tierCredits`. */
export interface TierCredit { credits: number; recurring: boolean; note: string }

// `tierCredits` is the single source for app-tier allowances — read it instead of
// hardcoding, so a page can never advertise an amount the grant cron does not pay.
// Optional because an older cached deploy may not serve it yet; callers fall back.
export interface Catalog { tools: Tool[]; packages: Pkg[]; subscriptionPlans: SubPlan[]; signupCredits: number; proMonthlyCredits: number; tierCredits?: { free: TierCredit; pro: TierCredit; teams: TierCredit } }

/**
 * The connector URL users paste into Claude. Single source of truth — it feeds the
 * `claude mcp add` command, both copy-to-clipboard blocks, and the endpoint line.
 *
 * MUST stay byte-identical to MCP_OAUTH_RESOURCE (Vercel env, and the `resource`
 * field served at /.well-known/oauth-protected-resource). Anthropic's connector
 * docs require the metadata `resource` to match the server URL "exactly as the user
 * enters it in Claude, including any path component" — so if this page tells someone
 * a URL that doesn't match the metadata, their OAuth flow fails on a mismatch.
 *
 * Was https://getmindy.ai/mcp/mcp until 2026-07-17. The apex still answers but now
 * advertises this subdomain, so the old URL is a mismatch — don't put it back.
 */
export const MCP_URL = 'https://mcp.getmindy.ai/mcp';

/**
 * Surface ramp for the /mcp console (Linear/Vercel dark).
 *
 * The account area previously painted every card `bg-white/[0.015]` — a 1.5% overlay on a
 * near-black page, which is visually indistinguishable from the background. Everything
 * looked flat, so the layout read as an unstyled prototype no matter how good the content
 * was. A dark UI needs a REAL elevation ramp: each step must be a perceptible lift, not a
 * hairline border doing all the work.
 *
 * Three steps, and nothing invents a fourth:
 *   SURFACE_1  cards sitting on the page
 *   SURFACE_2  things nested inside a card (chart wells, table headers, inputs)
 *   SURFACE_3  hover / active states
 *
 * ACCENT DISCIPLINE: emerald means ACTION (a button you can press). It is deliberately NOT
 * used for data bars or status text any more — when one hue means brand, data, state and
 * action at once, none of them carry meaning. Data viz uses the neutral ramp; status uses
 * its own semantic colours.
 */
// Light "maps page" system (getmindy.ai/opportunity-map): white ground, ink text,
// hairline borders, blue primary (#2563eb), green accent used sparingly. Replaces the
// old flat dark navy + wall-to-wall emerald.
export const SURFACE_1 = 'border border-[#e6eaef] bg-white';
export const SURFACE_2 = 'border border-[#e6eaef] bg-[#f7f9fb]';
export const SURFACE_3 = 'bg-[#f2f5f8]';

/** Card shell — the default container for a block of content in the console. */
export const CARD = `rounded-xl ${SURFACE_1}`;

/** Section eyebrow (the small uppercase label above a group). */
export const EYEBROW = 'text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500';

// ---- Credit / work-up math (priced from the LIVE catalog, never hardcoded) -----
export const toolCr = (tools: Tool[], name: string, fallback: number) =>
  tools.find((t) => t.name === name)?.credits ?? fallback;

/** An "opportunity work-up" = search one opp + incumbent financials + who-can-win scan + win playbook. */
export const workupCostFrom = (tools: Tool[]) =>
  toolCr(tools, 'search_sam_opportunities', 1) +
  toolCr(tools, 'get_incumbent_financials', 2) +
  toolCr(tools, 'find_capable_contractors', 25);

export const workups = (credits: number, workupCost: number) => Math.max(1, Math.floor(credits / workupCost));

/** Concrete BD "recipes" — cheap → rich, so a prospect sees credits go a long way. */
export const EXAMPLES: { title: string; desc: string; tools: string[] }[] = [
  { title: 'Check today’s new opportunities', desc: 'One live SAM search across your NAICS and keywords.', tools: ['search_sam_opportunities'] },
  { title: 'Price your bid', desc: 'GSA labor-rate intel plus regulatory demand signals.', tools: ['get_pricing_intel', 'get_regulatory_demand'] },
  { title: 'Vet an incumbent', desc: 'Pull their SEC financials and a full contractor profile.', tools: ['get_incumbent_financials', 'get_contractor_profile'] },
  { title: 'Full opportunity work-up', desc: 'Search it, read the incumbent, then scan who can win.', tools: ['search_sam_opportunities', 'get_incumbent_financials', 'find_capable_contractors'] },
  { title: 'Build a teaming shortlist', desc: 'A who-can-win scan, then deep-profile your top three partners.', tools: ['find_capable_contractors', 'get_contractor_profile', 'get_contractor_profile', 'get_contractor_profile'] },
];
export const exampleCost = (tools: Tool[], names: string[]) => names.reduce((s, n) => s + toolCr(tools, n, 1), 0);

// ---- Cross-page nav ------------------------------------------------------------
export function McpNav({ active, signedIn, balance }: { active: 'about' | 'connect' | 'pricing' | 'account'; signedIn?: boolean; balance?: number | null }) {
  const link = 'rounded-lg px-3 py-1.5 font-medium transition';
  const on = 'bg-[#eef2f7] text-[#111c26]';
  const off = 'text-[#6b7787] hover:text-[#111c26]';
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[#e6eaef] pb-4">
      <Link href="/mcp" className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#111c26] text-sm font-bold text-white">M</div>
        <div className="hidden sm:block">
          <div className="text-[15px] font-semibold leading-tight text-[#111c26]">Mindy MCP</div>
          <div className="text-xs text-[#6b7787]">Federal contracting intel for any AI agent</div>
        </div>
      </Link>
      <nav className="flex items-center gap-1 text-[13px]">
        <Link href="/mcp/about" className={`${link} ${active === 'about' ? on : off}`}>Overview</Link>
        <Link href="/mcp" className={`${link} ${active === 'connect' ? on : off}`}>Connect</Link>
        <Link href="/mcp/pricing" className={`${link} ${active === 'pricing' ? on : off}`}>Pricing</Link>
        {signedIn ? (
          <Link href="/mcp/account" className={`ml-1 flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium ${active === 'account' ? on : off}`}>
            {typeof balance === 'number' && (
              <span className="rounded-full border border-[#bfe0cd] bg-[#e7f4ed] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#137a41]">{balance.toLocaleString()} cr</span>
            )}
            Account
          </Link>
        ) : (
          <a href="/app" className="ml-1 rounded-lg bg-[#2563eb] px-3 py-1.5 font-semibold text-white hover:bg-[#1d4fd7]">Sign in</a>
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
