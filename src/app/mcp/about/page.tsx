/**
 * getmindy.ai/mcp/about — the MCP OVERVIEW / explainer page.
 *
 * The "what is this and why do I want it" page that /mcp (connect) and /mcp/pricing
 * both assumed. Answers: what MCP is in plain terms, why a GovCon user wants Mindy
 * inside their AI agent, what it unlocks (the four tool layers, grounded in the real
 * catalog), the no-fabrication contract (the trust moat), who it's for → CTAs to
 * Connect (/mcp) and See pricing (/mcp/pricing). Copy sourced from
 * docs/marketing/MCP-WHITEPAPER.md; tool names are the real, live ones.
 *
 * Server component (no interactivity) — matches the /mcp dark design system so it
 * reads as a native sibling, not a bolt-on. McpNav 'about' tab is highlighted.
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { McpNav } from '../catalog-ui';
import { listMcpTools } from '@/lib/mcp/tool-registry';

export const metadata: Metadata = {
  title: 'What is Mindy MCP? — Federal contracting intelligence for your AI agent',
  description:
    'Plug real federal-contracting intelligence into Claude, Cursor, ChatGPT, or any agent you build — grounded in SAM.gov, USASpending, SEC EDGAR, GSA CALC, and 8 years of proprietary GovCon data, with a contract that never fabricates.',
};

// The four tool layers — the marketing distillation of the 53-tool catalog. Each row's tools are
// REAL, live tool names (audit-tool-catalog-drift --list). We show a representative few per layer,
// not all 53 — the full catalog + per-call pricing lives on /mcp/pricing.
const LAYERS: { k: string; title: string; blurb: string; accent: string; tools: { n: string; d: string }[] }[] = [
  {
    k: '01',
    title: 'Public data & search',
    accent: 'from-sky-400/80 to-sky-500/80',
    blurb: 'The commodity layer — genuinely useful, and where most agents start. Open solicitations, forecasts, expiring recompetes, the vehicles work flows through.',
    tools: [
      { n: 'search_sam_opportunities', d: 'Open solicitations by keyword / NAICS / set-aside' },
      { n: 'get_expiring_contracts', d: 'Contracts expiring soon — your recompete targets' },
      { n: 'get_agency_forecasts', d: 'Planned buys 6–18 months before they hit SAM' },
      { n: 'extract_statement_of_work', d: 'The SOW/PWS pulled out as clean text' },
    ],
  },
  {
    k: '02',
    title: 'Competitive intelligence',
    accent: 'from-violet-400/80 to-violet-500/80',
    blurb: 'Who you’re up against and who to team with — the incumbent, the capable firms, the price-to-win, the teaming front door.',
    tools: [
      { n: 'get_incumbent_financials', d: 'SEC-EDGAR financials of a public incumbent' },
      { n: 'get_pricing_intel', d: 'GSA CALC price-to-win labor rates (p25/p50/p75)' },
      { n: 'find_capable_contractors', d: '"Who can actually win this" — capable-firm scan' },
      { n: 'get_sblo_contact', d: 'The Small Business Liaison at a prime — the teaming door' },
    ],
  },
  {
    k: '03',
    title: 'Agency & award intelligence',
    accent: 'from-amber-400/80 to-amber-500/80',
    blurb: 'The buyer beneath the department label — the specific buying office, its budget trend, its set-aside behavior, and the named people who actually buy.',
    tools: [
      { n: 'search_federal_contacts', d: 'Named POCs at a specific buying office (~167K rows)' },
      { n: 'get_sba_goaling_share', d: 'Small-business goals vs. actual set-aside obligations' },
      { n: 'search_agency_opps_by_office', d: 'Opportunities anchored to one buying office' },
      { n: 'get_regulatory_demand', d: 'Federal Register signals — demand before SAM' },
    ],
  },
  {
    k: '04',
    title: 'Proprietary & proposal',
    accent: 'from-emerald-400/80 to-emerald-500/80',
    blurb: 'The moat — 8 years of GovCon coaching no public API holds, plus a full stateless bid loop: bid/no-bid → compliance matrix → outline → draft → independent referee.',
    tools: [
      { n: 'get_winning_playbook', d: 'Grounded "how to win this" coaching — the moat' },
      { n: 'evaluate_bid_decision', d: 'The 5-gate / 10-factor bid/no-bid, scored' },
      { n: 'extract_compliance_matrix', d: 'Every shall/must + Section L/M/C requirement' },
      { n: 'referee_proposal_compliance', d: 'An independent model reviews the draft vs. the matrix' },
    ],
  },
];

// The three "flying blind" failures a general agent makes — the hook.
const BLIND: { q: string; guess: string }[] = [
  { q: '"Who’s the incumbent on this VA cybersecurity recompete, and when does it expire?"', guess: 'invents a plausible company and a made-up date' },
  { q: '"What’s the fair GSA labor rate for a Senior Software Engineer?"', guess: 'produces a number with no source' },
  { q: '"Who at the Army Corps LA District actually buys this?"', guess: 'returns a generic contracting.officer@army.mil that doesn’t exist' },
];

export default function McpAboutPage() {
  /**
   * Live count, never transcribed. This heading read a hardcoded "53 tools" while the
   * repo README said 54 and /mcp/pricing derived its own from the catalog — three
   * public surfaces disagreeing about our own product. Same bug the pricing page
   * already carries a comment about; it just hadn't been fixed here.
   *
   * Server component, so this is read at render time from the same registry that
   * feeds /mcp/tools and /api/mcp/catalog. Add a tool and every surface updates.
   */
  const toolCount = listMcpTools().length;
  return (
    <main className="min-h-dvh bg-[#0a0f1e] text-slate-100 [color-scheme:dark]">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
        <McpNav active="about" />

        {/* HERO */}
        <section className="mt-14 text-center">
          <span className="inline-block rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
            Model Context Protocol
          </span>
          <h1 className="mx-auto mt-5 max-w-2xl text-balance text-3xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Give your AI agent the federal contracting intelligence it&apos;s{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-emerald-300 bg-clip-text text-transparent">missing</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-balance text-sm leading-relaxed text-slate-400 sm:text-[15px]">
            Mindy MCP is a hosted server that hands Claude, Cursor, ChatGPT, or any agent you build a catalog of grounded
            GovCon tools — so the answers come from real federal data, not the model&apos;s imagination.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/mcp" className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] transition hover:bg-emerald-400">
              Connect free — 100 credits
            </Link>
            <Link href="/mcp/pricing" className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.06]">
              See pricing
            </Link>
          </div>
          <p className="mx-auto mt-3 text-[12px] text-slate-500">No API key — you sign in through your browser. No card.</p>
        </section>

        {/* THE PROBLEM — flying blind */}
        <section className="mt-20">
          <h2 className="text-center text-xl font-semibold tracking-tight sm:text-2xl">Your agent is smart. On federal contracting, it&apos;s guessing.</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-[13px] leading-relaxed text-slate-400">
            Ask a general-purpose agent a GovCon question and it invents a plausible answer. The intelligence isn&apos;t in the
            model — it&apos;s in SAM.gov, USASpending, SEC EDGAR, GSA CALC, and eight years of proprietary GovCon work.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {BLIND.map((b) => (
              <div key={b.q} className="rounded-xl border border-white/[0.07] bg-[#101728] p-4">
                <p className="text-[13px] font-medium leading-snug text-slate-200">{b.q}</p>
                <p className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-snug text-rose-300/90">
                  <span aria-hidden className="mt-px">✗</span>
                  <span>The model {b.guess}.</span>
                </p>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-6 max-w-xl text-center text-[13px] leading-relaxed text-slate-300">
            <span className="font-semibold text-white">Mindy MCP is the bridge</span> — grounded tools that return the real
            company, the real date, the real person who buys.
          </p>
        </section>

        {/* THE COMMODITY TRAP — the moat */}
        <section className="mt-20 rounded-2xl border border-white/[0.07] bg-[#101728] p-6 sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Wrapping SAM.gov is the price of entry. Not the moat.</h2>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-slate-400">
            SAM.gov and USASpending are free public APIs — anyone can wrap them in a weekend. Mindy leads with those because
            they&apos;re genuinely useful, but the reason an agent stays is the layer competitors <span className="text-slate-200">cannot</span> copy:
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ['The winning-playbook corpus', '8 years of course, proposal-template & podcast content that answers "how do I actually win this" — no public API has it.'],
              ['Office-level buying contacts', 'The named contracting officers & small-business POCs at a specific buying office — not the whole-department firehose.'],
              ['A curated SBLO teaming roster', 'The Small Business Liaison at 200 primes, re-researched and verified — so an agent knows who to call to team.'],
              ['The podcast lesson corpus', 'Real lessons from real contractor & agency guests, matched by topic, agency, or set-aside.'],
            ].map(([t, d]) => (
              <li key={t} className="rounded-xl border border-white/[0.06] bg-[#0b1120] p-4">
                <div className="text-[13.5px] font-semibold text-emerald-300">{t}</div>
                <div className="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">{d}</div>
              </li>
            ))}
          </ul>
        </section>

        {/* WHAT IT UNLOCKS — the four layers */}
        <section className="mt-20">
          <h2 className="text-center text-xl font-semibold tracking-tight sm:text-2xl">{toolCount} tools, across four layers</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-[13px] text-slate-400">
            From open-opportunity search to a full stateless proposal loop. A few from each layer — the full catalog and
            per-call pricing live on the <Link href="/mcp/pricing" className="text-emerald-300 underline-offset-2 hover:underline">pricing page</Link>.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {LAYERS.map((L) => (
              <div key={L.k} className="rounded-2xl border border-white/[0.07] bg-[#101728] p-5">
                <div className="flex items-baseline gap-3">
                  <span className={`bg-gradient-to-r ${L.accent} bg-clip-text font-mono text-sm font-bold text-transparent`}>{L.k}</span>
                  <h3 className="text-[15px] font-semibold text-slate-100">{L.title}</h3>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-slate-400">{L.blurb}</p>
                <ul className="mt-4 space-y-2.5">
                  {L.tools.map((t) => (
                    <li key={t.n} className="text-[12.5px] leading-snug">
                      <code className="font-mono text-[12px] text-slate-200">{t.n}</code>
                      <span className="ml-2 text-slate-500">{t.d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* THE CONTRACT — trust */}
        <section className="mt-20 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-6 sm:p-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-400/15 text-emerald-300" aria-hidden>✓</span>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">The no-fabrication contract</h2>
          </div>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-slate-300">
            Grounding <span className="font-semibold text-white">is</span> the product. Every tool returns a machine-readable
            signal for whether the answer is real: <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[12px] text-emerald-200">grounded</code> means
            at least one real record backs it; a genuine miss says so plainly instead of inventing one. An agent knows when to
            trust the answer — and Mindy never maps a record to a NAICS, set-aside, or financial the source doesn&apos;t carry.
          </p>
        </section>

        {/* WHO IT'S FOR + CTA */}
        <section className="mt-20 text-center">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Built for the agent you already use</h2>
          <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-slate-400">
            Claude · Claude Code · Cursor · ChatGPT · Copilot · or your own. Add one endpoint, sign in through the browser, and
            your agent can run a real BD task — find the opportunity, size the market, vet the incumbent, draft the response.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/mcp" className="rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-[#06120c] transition hover:bg-emerald-400">
              Connect your agent — free
            </Link>
            <Link href="/mcp/pricing" className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-6 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/[0.06]">
              See pricing
            </Link>
          </div>
          <p className="mx-auto mt-4 text-[12px] text-slate-500">100 free credits on your first connect — no card required.</p>
          {/*
            Developers vetting a dependency check the source before they adopt it. This
            page is where that vetting happens, so the repo link belongs here as well as
            on /mcp. rel="noopener" only — noreferrer would strip the attribution that
            shows the site is what drives repo traffic.
          */}
          <p className="mx-auto mt-2 text-[12px] text-slate-500">
            Docs and example agents:{' '}
            <a
              href="https://github.com/getmindy/mindy-mcp"
              target="_blank"
              rel="noopener"
              className="text-emerald-300 underline-offset-2 hover:underline"
            >
              github.com/getmindy/mindy-mcp
            </a>
          </p>
        </section>

        <footer className="mt-20 border-t border-white/[0.06] pt-6 text-center text-[11px] text-slate-600">
          Mindy MCP · grounded in SAM.gov, USASpending, SEC EDGAR, GSA CALC, Federal Register + 8 years of GovCon Giants data · GovCon Giants AI
        </footer>
      </div>
    </main>
  );
}
