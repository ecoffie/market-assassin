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
 * reads as a native sibling, not a bolt-on. McpPublicNav 'about' tab is highlighted.
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { McpPublicNav } from '../public-ui';
import { listPublicMcpTools } from '@/lib/mcp/public-catalog';

export const metadata: Metadata = {
  title: 'What is Mindy MCP? — Federal contracting intelligence for your AI agent',
  description:
    'Plug real federal-contracting intelligence into Claude, Cursor, ChatGPT, or any agent you build — grounded in SAM.gov, USASpending, SEC EDGAR, GSA CALC, and 8 years of proprietary GovCon data, with a contract that never fabricates.',
};

// The four tool layers — the marketing distillation of the 53-tool catalog. Each row's tools are
// REAL, live tool names (audit-tool-catalog-drift --list). We show a representative few per layer,
// not all 53 — the full catalog + per-call pricing lives on /mcp/pricing.
const LAYERS: { k: string; title: string; blurb: string; tools: { n: string; d: string }[] }[] = [
  {
    k: '01',
    title: 'Public data & search',
    blurb: 'The commodity layer — genuinely useful, and where most agents start. Open solicitations, forecasts, expiring recompetes, the vehicles work flows through.',
    tools: [
      { n: 'search_sam_opportunities', d: 'Open solicitations by keyword / NAICS / set-aside' },
      { n: 'get_expiring_contracts', d: 'Contracts expiring soon — your recompete targets' },
      { n: 'get_agency_forecasts', d: 'Planned buys 6–18 months before they hit SAM' },
      { n: 'get_solicitation_documents', d: 'The full RFP — SOW/PWS and attachments as text' },
    ],
  },
  {
    k: '02',
    title: 'Competitive intelligence',
    blurb: 'Who you’re up against and who to team with — the incumbent, the capable firms, the price-to-win, the teaming front door.',
    tools: [
      { n: 'get_solicitation_incumbent', d: 'Who holds this contract now — the likely incumbent' },
      { n: 'get_pricing_intel', d: 'GSA CALC price-to-win labor rates (p25/p50/p75)' },
      { n: 'find_capable_contractors', d: '"Who can actually win this" — capable-firm scan' },
      { n: 'get_sblo_contact', d: 'The Small Business Liaison at a prime — the teaming door' },
    ],
  },
  {
    k: '03',
    title: 'Agency & award intelligence',
    blurb: 'The buyer beneath the department label — the specific buying office, its budget trend, its set-aside behavior, and the named people who actually buy.',
    tools: [
      { n: 'search_federal_contacts', d: 'Named POCs at a specific buying office (~167K rows)' },
      { n: 'get_sba_goaling_share', d: 'Small-business goals vs. actual set-aside obligations' },
      { n: 'search_agency_opps_by_office', d: 'Opportunities anchored to one buying office' },
      { n: 'get_agency_intel', d: 'The buyer brief — priorities, spend and angles' },
    ],
  },
  {
    k: '04',
    title: 'Proprietary & proposal',
    blurb: 'The moat — 8 years of GovCon coaching no public API holds, plus a full stateless bid loop: bid/no-bid → compliance matrix → draft → independent referee.',
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
  const toolCount = listPublicMcpTools().length;
  return (
    <main className="min-h-dvh bg-(--mp-paper) text-(--mp-ink)">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
        <McpPublicNav active="about" />

        {/* HERO */}
        <section className="mt-14 text-center">
          <span className="inline-block rounded-none border border-(--mp-line) bg-(--mp-surface) px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-(--mp-muted)">
            Model Context Protocol
          </span>
          <h1 className="mx-auto mt-5 max-w-2xl text-balance text-3xl font-bold leading-[1.05] tracking-tight sm:text-5xl font-(family-name:--mp-font-serif)">
            Give your AI agent the federal contracting intelligence it&apos;s{' '}
            <span className="text-(--mp-accent)">missing</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-balance text-sm leading-relaxed text-(--mp-muted) sm:text-[15px]">
            Mindy MCP is a hosted server that hands Claude, Cursor, ChatGPT, or any agent you build a catalog of grounded
            GovCon tools — so the answers come from real federal data, not the model&apos;s imagination.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/mcp" className="rounded-none bg-(--mp-navy) px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-(--mp-navy-hover)">
              Connect free — 100 credits
            </Link>
            <Link href="/mcp/pricing" className="rounded-none border border-(--mp-line) bg-(--mp-surface) px-5 py-2.5 text-sm font-medium text-(--mp-ink) transition hover:bg-(--mp-wash)">
              See pricing
            </Link>
          </div>
          <p className="mx-auto mt-3 text-[12px] text-(--mp-muted)">No API key — you sign in through your browser. No card.</p>
        </section>

        {/* THE PROBLEM — flying blind */}
        <section className="mt-20">
          <h2 className="text-center text-xl font-semibold tracking-tight sm:text-2xl font-(family-name:--mp-font-serif)">Your agent is smart. On federal contracting, it&apos;s guessing.</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-[13px] leading-relaxed text-(--mp-muted)">
            Ask a general-purpose agent a GovCon question and it invents a plausible answer. The intelligence isn&apos;t in the
            model — it&apos;s in SAM.gov, USASpending, SEC EDGAR, GSA CALC, and eight years of proprietary GovCon work.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {BLIND.map((b) => (
              <div key={b.q} className="rounded-none border border-(--mp-line) bg-(--mp-surface) p-4">
                <p className="text-[13px] font-medium leading-snug text-(--mp-ink)">{b.q}</p>
                <p className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-snug text-(--mp-crit)">
                  <span aria-hidden className="mt-px">✗</span>
                  <span>The model {b.guess}.</span>
                </p>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-6 max-w-xl text-center text-[13px] leading-relaxed text-(--mp-body)">
            <span className="font-semibold text-(--mp-ink)">Mindy MCP is the bridge</span> — grounded tools that return the real
            company, the real date, the real person who buys.
          </p>
        </section>

        {/* THE COMMODITY TRAP — the moat */}
        <section className="mt-20 rounded-none border border-(--mp-line) bg-(--mp-surface) p-6 sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl font-(family-name:--mp-font-serif)">Wrapping SAM.gov is the price of entry. Not the moat.</h2>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-(--mp-muted)">
            SAM.gov and USASpending are free public APIs — anyone can wrap them in a weekend. Mindy leads with those because
            they&apos;re genuinely useful, but the reason an agent stays is the layer competitors <span className="text-(--mp-ink)">cannot</span> copy:
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ['The winning-playbook corpus', '8 years of course, proposal-template & podcast content that answers "how do I actually win this" — no public API has it.'],
              ['Office-level buying contacts', 'The named contracting officers & small-business POCs at a specific buying office — not the whole-department firehose.'],
              ['A curated SBLO teaming roster', 'The Small Business Liaison at 200 primes, re-researched and verified — so an agent knows who to call to team.'],
              ['The podcast lesson corpus', 'Real lessons from real contractor & agency guests, matched by topic, agency, or set-aside.'],
            ].map(([t, d]) => (
              <li key={t} className="rounded-none border border-(--mp-line) bg-(--mp-wash) p-4">
                <div className="text-[13.5px] font-semibold text-(--mp-navy)">{t}</div>
                <div className="mt-1.5 text-[12.5px] leading-relaxed text-(--mp-muted)">{d}</div>
              </li>
            ))}
          </ul>
        </section>

        {/* WHAT IT UNLOCKS — the four layers */}
        <section className="mt-20">
          <h2 className="text-center text-xl font-semibold tracking-tight sm:text-2xl font-(family-name:--mp-font-serif)">{toolCount} tools, across four layers</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-[13px] text-(--mp-muted)">
            From open-opportunity search to a full stateless proposal loop. A few from each layer — the full catalog and
            per-call pricing live on the <Link href="/mcp/pricing" className="text-(--mp-navy) underline-offset-2 hover:underline">pricing page</Link>.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {LAYERS.map((L) => (
              <div key={L.k} className="rounded-none border border-(--mp-line) bg-(--mp-surface) p-5">
                <div className="flex items-baseline gap-3">
                  <span className="font-(family-name:--mp-font-mono) text-sm font-semibold text-(--mp-accent)">{L.k}</span>
                  <h3 className="text-[15px] font-semibold text-(--mp-ink)">{L.title}</h3>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-(--mp-muted)">{L.blurb}</p>
                <ul className="mt-4 space-y-2.5">
                  {L.tools.map((t) => (
                    <li key={t.n} className="text-[12.5px] leading-snug">
                      <code className="font-(family-name:--mp-font-mono) text-[12px] text-(--mp-ink)">{t.n}</code>
                      <span className="ml-2 text-(--mp-muted)">{t.d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* THE CONTRACT — trust */}
        <section className="mt-20 rounded-none border border-(--mp-navy) bg-(--mp-navy-wash) p-6 sm:p-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-none bg-(--mp-navy-wash) text-(--mp-navy)" aria-hidden>✓</span>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl font-(family-name:--mp-font-serif)">The no-fabrication contract</h2>
          </div>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-(--mp-body)">
            Grounding <span className="font-semibold text-(--mp-ink)">is</span> the product. Every tool returns a machine-readable
            signal for whether the answer is real: <code className="rounded bg-(--mp-surface) px-1.5 py-0.5 font-(family-name:--mp-font-mono) text-[12px] text-(--mp-navy)">grounded</code> means
            at least one real record backs it; a genuine miss says so plainly instead of inventing one. An agent knows when to
            trust the answer — and Mindy never maps a record to a NAICS, set-aside, or financial the source doesn&apos;t carry.
          </p>
        </section>

        {/* WHO IT'S FOR + CTA */}
        <section className="mt-20 text-center">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl font-(family-name:--mp-font-serif)">Built for the agent you already use</h2>
          <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-(--mp-muted)">
            Claude · Claude Code · Cursor · ChatGPT · Copilot · or your own. Add one endpoint, sign in through the browser, and
            your agent can run a real BD task — find the opportunity, size the market, vet the incumbent, draft the response.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/mcp" className="rounded-none bg-(--mp-navy) px-6 py-3 text-sm font-semibold text-white transition hover:bg-(--mp-navy-hover)">
              Connect your agent — free
            </Link>
            <Link href="/mcp/pricing" className="rounded-none border border-(--mp-line) bg-(--mp-surface) px-6 py-3 text-sm font-medium text-(--mp-ink) transition hover:bg-(--mp-wash)">
              See pricing
            </Link>
          </div>
          <p className="mx-auto mt-4 text-[12px] text-(--mp-muted)">100 free credits on your first connect — no card required.</p>
          {/*
            Developers vetting a dependency check the source before they adopt it. This
            page is where that vetting happens, so the repo link belongs here as well as
            on /mcp. rel="noopener" only — noreferrer would strip the attribution that
            shows the site is what drives repo traffic.
          */}
          <p className="mx-auto mt-2 text-[12px] text-(--mp-muted)">
            Docs and example agents:{' '}
            <a
              href="https://github.com/getmindy/mindy-mcp"
              target="_blank"
              rel="noopener"
              className="text-(--mp-navy) underline-offset-2 hover:underline"
            >
              github.com/getmindy/mindy-mcp
            </a>
          </p>
        </section>

        <footer className="mt-20 border-t border-(--mp-line) pt-6 text-center text-[11px] text-(--mp-muted)">
          Mindy MCP · grounded in SAM.gov, USASpending, SEC EDGAR, GSA CALC, Federal Register + 8 years of GovCon Giants data · GovCon Giants AI
        </footer>
      </div>
    </main>
  );
}
