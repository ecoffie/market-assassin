/**
 * /mindy-intelligence — "How Mindy Works" public landing page.
 *
 * Marketing collateral for the dual-moat architecture:
 *   Layer 1 — Profile Vault (your data)
 *   Layer 2 — GovCon Giants curriculum (curated 8-year corpus)
 *   Fused at every output.
 *
 * Audience targets:
 *   - GovCon practitioner skimming "why is this better"
 *   - Sophisticated buyer / acquirer evaluating moat
 *
 * Brand discipline (per exit-strategy memory rule):
 *   - All attribution to "Mindy" or "GovCon Giants" (the company)
 *   - No personal-name attribution in product context
 *   - Numbers + tables for credibility, no fluff
 */

import Link from 'next/link';

const TOTALS = {
  documents: 593,
  chunks: 3450,
  characters: '9.4M',
  capStatementTemplates: 2,
  proposalTemplates: 17,
  pastPerformanceExamples: 3,
  courseMaterial: 124,
  slideDecks: 103,
  webinarResources: 31,
  qaDatasets: 9,
  yearsOfTeaching: 8,
};

const DASHBOARD_URL = '/app';
const FREE_SIGNUP_URL = '/signup';

export default function MindyIntelligencePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': 'https://getmindy.ai/mindy-intelligence/#article',
        headline: "Mindy's Living Intelligence Layer",
        description: 'How Mindy combines your business profile with a curated GovCon knowledge corpus.',
        author: { '@type': 'Organization', name: 'GovCon Giants' },
        publisher: { '@type': 'Organization', name: 'Mindy', logo: 'https://getmindy.ai/icon.png' },
      },
    ],
  };

  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* ───── HERO ───── */}
      <section className="py-20 px-4 bg-(--mp-wash)">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center justify-center mb-8">
            <div className="w-20 h-20 rounded-none flex items-center justify-center bg-(--mp-navy)">
              <span className="text-white font-bold text-4xl">M</span>
            </div>
          </div>
          <p className="inline-block text-xs uppercase tracking-[0.2em] text-(--mp-navy) mb-4 px-3 py-1 rounded-[6px] bg-(--mp-navy-wash) border border-(--mp-line)">
            How Mindy Works
          </p>
          <h1 className="text-4xl md:text-6xl font-bold text-(--mp-ink) mb-6 leading-tight font-(family-name:--mp-font-serif)">
            The Living Intelligence Layer for federal contractors.
          </h1>
          <p className="text-xl text-(--mp-body) max-w-2xl mx-auto mb-10">
            Most AI tools start from scratch on every prompt. Mindy doesn&apos;t.
            It fuses your business profile with a curated GovCon knowledge corpus
            at every output — so drafts, briefings, and insights sound like a
            seasoned capture writer wrote them, not a generic LLM.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href={FREE_SIGNUP_URL}
              className="px-6 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white rounded-none font-semibold transition-colors"
            >
              Try Mindy free
            </Link>
            <Link
              href={DASHBOARD_URL}
              className="px-6 py-3 bg-(--mp-surface) hover:bg-(--mp-surface) text-(--mp-ink) rounded-none font-semibold border border-(--mp-line) transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ───── THE PROBLEM ───── */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-(--mp-navy) mb-3">The Problem</p>
          <h2 className="text-3xl md:text-4xl font-bold text-(--mp-ink) mb-6 font-(family-name:--mp-font-serif)">
            Why generic AI tools fail in federal contracting
          </h2>
          <p className="text-lg text-(--mp-body) mb-10 max-w-3xl">
            Every contractor has tried ChatGPT or Claude for proposal drafts. They&apos;ve also been
            burned by the same three failures:
          </p>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                title: 'Placeholder soup',
                body: '"Our firm has world-class capabilities in [INSERT CAPABILITY]" — the AI doesn\'t know your real past performance, UEI, or team. It fills gaps with brackets.',
              },
              {
                title: 'No GovCon context',
                body: 'Generic AI can\'t tell a Sources Sought from an RFP. Doesn\'t understand evaluation factors. Doesn\'t know what compliant federal language looks like.',
              },
              {
                title: 'Marketing fluff',
                body: '"Cutting-edge", "synergistic", "best-in-class" — the kind of corporate noise that gets proposals down-scored in federal evaluations.',
              },
            ].map((card) => (
              <div key={card.title} className="rounded-none border border-(--mp-line) bg-(--mp-surface) p-6">
                <h3 className="font-(family-name:--mp-font-serif) text-(--mp-ink) font-semibold text-lg mb-2">❌ {card.title}</h3>
                <p className="text-(--mp-body) text-sm leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── ARCHITECTURE ───── */}
      <section className="py-20 px-4 border-y border-(--mp-line) bg-(--mp-wash)">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-(--mp-navy) mb-3">The Architecture</p>
          <h2 className="text-3xl md:text-4xl font-bold text-(--mp-ink) mb-3 font-(family-name:--mp-font-serif)">
            Two layers, fused at every output
          </h2>
          <p className="text-lg text-(--mp-body) mb-12 max-w-3xl">
            Mindy isn&apos;t a feature wrapped around GPT. It&apos;s an intelligence
            <em className="text-(--mp-navy)"> architecture</em> — your private business profile
            on one side, a curated federal contracting knowledge corpus on the other,
            combined at every draft, briefing, and insight.
          </p>

          {/* Layer 1 */}
          <div className="rounded-none border border-(--mp-line) bg-(--mp-navy-wash) p-6 md:p-8 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs px-2 py-1 rounded-[6px] bg-(--mp-surface) border border-(--mp-line) text-(--mp-navy) font-(family-name:--mp-font-mono)">LAYER 1</span>
              <h3 className="text-2xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">Your Profile Vault</h3>
            </div>
            <p className="text-(--mp-body) mb-6">
              A private library that grows with your business. Every entry teaches Mindy more
              about you, and every output gets sharper.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-(--mp-navy) uppercase tracking-wider">
                  <tr className="border-b border-(--mp-line)">
                    <th className="text-left py-2 pr-4">Vault component</th>
                    <th className="text-left py-2 pr-4">What it holds</th>
                    <th className="text-left py-2">What it powers</th>
                  </tr>
                </thead>
                <tbody className="text-(--mp-body)">
                  {[
                    ['Identity', 'UEI · CAGE · certifications · NAICS · one-liner · vehicles', 'Every section, every cap statement'],
                    ['Past Performance', 'Real contracts won — agency, period, value, scope, outcomes', 'Cite YOUR contracts instead of [placeholders]'],
                    ['Capabilities', 'Tagged capability blurbs in your voice + NAICS associations', 'Capabilities sections, weaved by relevance'],
                    ['Team', 'Personnel with title, clearance, certifications, bio, resume', 'Management Plan + Key Personnel sections'],
                    ['Boilerplate', 'Uploaded cap statements + overviews, AI-parsed', 'Reusable building blocks'],
                  ].map((row) => (
                    <tr key={row[0]} className="border-b border-(--mp-line)">
                      <td className="py-3 pr-4 font-medium text-(--mp-ink) whitespace-nowrap">{row[0]}</td>
                      <td className="py-3 pr-4 text-(--mp-muted)">{row[1]}</td>
                      <td className="py-3 text-(--mp-muted)">{row[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Layer 2 */}
          <div className="rounded-none border border-(--mp-line) bg-(--mp-wash) p-6 md:p-8 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs px-2 py-1 rounded-[6px] bg-(--mp-surface) border border-(--mp-line) text-(--mp-accent) font-(family-name:--mp-font-mono)">LAYER 2</span>
              <h3 className="text-2xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">The GovCon Giants Curriculum</h3>
            </div>
            <p className="text-(--mp-body) mb-6">
              A proprietary 9.4-million-character corpus of federal contracting expertise — refined
              over {TOTALS.yearsOfTeaching} years of teaching small business contractors how to
              compete and win. Indexed into Mindy so every output is grounded in proven patterns.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                { v: TOTALS.documents.toLocaleString(), l: 'Indexed documents' },
                { v: TOTALS.chunks.toLocaleString(), l: 'Searchable knowledge chunks' },
                { v: TOTALS.characters, l: 'Characters of curated content' },
                { v: TOTALS.yearsOfTeaching + ' yrs', l: 'Of GovCon teaching' },
              ].map((stat) => (
                <div key={stat.l} className="rounded-none bg-(--mp-surface) border border-(--mp-line) p-4 text-center">
                  <div className="text-2xl font-bold text-(--mp-ink)">{stat.v}</div>
                  <div className="text-xs text-(--mp-muted) mt-1">{stat.l}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-(--mp-muted) uppercase tracking-wider">
                  <tr className="border-b border-(--mp-line)">
                    <th className="text-left py-2 pr-4">Asset type</th>
                    <th className="text-right py-2">Indexed</th>
                  </tr>
                </thead>
                <tbody className="text-(--mp-body)">
                  {[
                    ['Course material', TOTALS.courseMaterial],
                    ['Slide decks', TOTALS.slideDecks],
                    ['Webinar resources', TOTALS.webinarResources],
                    ['Proposal templates', TOTALS.proposalTemplates],
                    ['Q&A datasets', TOTALS.qaDatasets],
                    ['Capability statement templates', TOTALS.capStatementTemplates],
                    ['Past performance examples', TOTALS.pastPerformanceExamples],
                  ].map((row) => (
                    <tr key={row[0] as string} className="border-b border-(--mp-line)">
                      <td className="py-2.5 pr-4 text-(--mp-ink)">{row[0]}</td>
                      <td className="py-2.5 text-right text-(--mp-muted) font-(family-name:--mp-font-mono)">{row[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-sm text-(--mp-muted) italic max-w-3xl">
            Why this matters: when Mindy drafts a proposal section, it doesn&apos;t generate from
            scratch. It retrieves the most relevant teaching passages, treats them as
            <strong className="text-(--mp-ink)"> style references</strong>, and adapts the framing
            to your specific business context. This is the part competitors can&apos;t replicate
            by spinning up another LLM wrapper.
          </p>
        </div>
      </section>

      {/* ───── WORKED EXAMPLE ───── */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-(--mp-navy) mb-3">A Worked Example</p>
          <h2 className="text-3xl md:text-4xl font-bold text-(--mp-ink) mb-6 font-(family-name:--mp-font-serif)">
            Sources Sought arrives. You click <span className="text-(--mp-navy)">Past Performance</span>.
          </h2>
          <p className="text-lg text-(--mp-body) mb-8 max-w-3xl">
            Behind the scenes, in one parallel operation Mindy assembles a prompt that
            generic tools simply cannot construct:
          </p>
          <ol className="space-y-4 mb-10">
            {[
              { n: '1', t: 'Load your Vault.', b: 'Identity, your 10 most recent past performance entries, any capability statements you\'ve uploaded.' },
              { n: '2', t: 'Query the GovCon corpus.', b: 'Section type + first 1,000 characters of the notice. Postgres full-text search with relevance weighting by document type (proposal templates and past performance examples ranked highest).' },
              { n: '3', t: 'Retrieve the top 4 teaching passages.', b: 'Capped at 3,500 characters. De-duplicated across source documents for breadth of perspective.' },
              { n: '4', t: 'Generate the draft.', b: 'Vault data treated as FACTUAL (cite verbatim). Teaching passages treated as STYLE references (adapt framing, don\'t copy). Result: a draft that cites your actual contracts, in federal capture voice.' },
            ].map((step) => (
              <li key={step.n} className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-none bg-(--mp-navy-wash) border border-(--mp-line) flex items-center justify-center text-(--mp-navy) font-bold">
                  {step.n}
                </div>
                <div>
                  <p className="text-(--mp-ink) font-semibold mb-1">{step.t}</p>
                  <p className="text-(--mp-muted) text-sm">{step.b}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* Before / after */}
          <div className="grid md:grid-cols-2 gap-5">
            <div className="rounded-none border border-(--mp-warn-line) bg-(--mp-warn-bg) p-6">
              <p className="text-xs uppercase tracking-wider text-(--mp-crit) mb-2">❌ Generic AI tool</p>
              <p className="text-(--mp-body) text-sm italic leading-relaxed">
                &ldquo;Our firm has substantial experience supporting federal cybersecurity efforts.
                <span className="text-(--mp-crit)">[Contract title]</span> with
                <span className="text-(--mp-crit)">[Agency]</span> from
                <span className="text-(--mp-crit)">[Period]</span> valued at
                <span className="text-(--mp-crit)">[Value]</span> demonstrated our capability…&rdquo;
              </p>
            </div>
            <div className="rounded-none border border-(--mp-ok-line) bg-(--mp-ok-bg) p-6">
              <p className="text-xs uppercase tracking-wider text-(--mp-ok) mb-2">✅ Mindy</p>
              <p className="text-(--mp-body) text-sm italic leading-relaxed">
                &ldquo;Our firm has supported federal cybersecurity efforts since 2018.
                <strong className="text-(--mp-ink)"> Federal Penetration Testing for Department of the Navy</strong>{' '}
                (#W912PL19C0015, $2.5M, 2023-2024) demonstrated our capability to deliver
                NIST 800-53 implementation under tight timelines, with a 100% compliance
                audit pass rate…&rdquo;
              </p>
              <p className="text-xs text-(--mp-ok) mt-3">
                ↑ Real contracts from your Vault + framing patterns from the GovCon corpus.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ───── COMPARISON TABLE ───── */}
      <section className="py-20 px-4 border-y border-(--mp-line) bg-(--mp-wash)">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-(--mp-navy) mb-3">Mindy vs Generic AI</p>
          <h2 className="text-3xl md:text-4xl font-bold text-(--mp-ink) mb-10 font-(family-name:--mp-font-serif)">
            At a glance
          </h2>
          <div className="overflow-x-auto rounded-none border border-(--mp-line)">
            <table className="w-full text-sm">
              <thead className="bg-(--mp-surface)">
                <tr>
                  <th className="text-left p-4 text-(--mp-muted) uppercase text-xs tracking-wider">Capability</th>
                  <th className="text-left p-4 text-(--mp-crit) uppercase text-xs tracking-wider">Generic AI tool</th>
                  <th className="text-left p-4 text-(--mp-navy) uppercase text-xs tracking-wider">Mindy</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Prompt construction', 'One-shot generic LLM call', 'Two-layer retrieval pipeline'],
                  ['Past performance citations', 'Bracketed [placeholders]', 'Real contracts from your vault'],
                  ['Voice', 'Marketing fluff defaults', 'Federal capture voice'],
                  ['Personalization', 'Same output for everyone', 'Per-user identity + history'],
                  ['Expertise built in', 'None — relies on user prompting', 'GovCon Giants curriculum (9.4M chars)'],
                  ['Memory across sessions', 'None', 'Vault persists; each draft gets smarter'],
                  ['Notice-type awareness', 'No', 'Sources Sought / RFP / RFQ / Pre-Sol handled differently'],
                  ['Compounding flywheel', 'Day 100 = day 1', 'Day 100 reads like the user wrote it'],
                ].map((row, i) => (
                  <tr key={row[0]} className={i % 2 === 0 ? 'bg-(--mp-surface)' : ''}>
                    <td className="p-4 text-(--mp-ink) font-medium border-t border-(--mp-line)">{row[0]}</td>
                    <td className="p-4 text-(--mp-muted) border-t border-(--mp-line)">{row[1]}</td>
                    <td className="p-4 text-(--mp-body) border-t border-(--mp-line)">{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ───── PLAIN ENGLISH ───── */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-(--mp-navy) mb-3">What It Means For You</p>
          <h2 className="text-3xl md:text-4xl font-bold text-(--mp-ink) mb-10 font-(family-name:--mp-font-serif)">
            In plain English
          </h2>
          <div className="space-y-6">
            {[
              {
                t: 'You don\'t have to be a proposal writer.',
                b: 'Mindy already knows how to frame a Past Performance citation, write a Differentiators bullet, map your technical approach to evaluation factors. Just upload the notice. Mindy handles the pattern.',
              },
              {
                t: 'Your data makes Mindy smarter.',
                b: 'The more contracts you log, the more capabilities you tag, the more team bios you add — the better every draft gets. Most tools stay the same on day 100 as day 1. Mindy gets sharper.',
              },
              {
                t: 'You never start from scratch again.',
                b: 'Cap statement at 9 PM? Mindy already has your one-liner, your past performance, your differentiators, your point of contact. Draft in front of you in 30 seconds — grounded in your real business.',
              },
              {
                t: 'Federal voice, not corporate fluff.',
                b: 'Mindy is trained on real federal contracting teaching — not on generic internet copy. The output reads like an experienced capture writer drafted it.',
              },
            ].map((row) => (
              <div key={row.t} className="rounded-none border border-(--mp-line) bg-(--mp-surface) p-6 hover:border-(--mp-navy) transition">
                <h3 className="text-xl font-semibold text-(--mp-ink) mb-2 font-(family-name:--mp-font-serif)">{row.t}</h3>
                <p className="text-(--mp-body)">{row.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── ROADMAP ───── */}
      <section className="py-20 px-4 border-y border-(--mp-line) bg-(--mp-wash)">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-(--mp-navy) mb-3">What&apos;s Coming Next</p>
          <h2 className="text-3xl md:text-4xl font-bold text-(--mp-ink) mb-10 font-(family-name:--mp-font-serif)">
            The Living Intelligence layer is expanding
          </h2>
          <div className="grid md:grid-cols-2 gap-5">
            {[
              {
                t: 'Mindy Insights in your inbox',
                b: 'Every morning, each opportunity in your alert email comes with a Mindy Insight — a relevant excerpt from the knowledge corpus matched to the notice type. Compounding daily exposure to federal contracting expertise.',
              },
              {
                t: 'Voice of Customer intelligence',
                b: 'Hundreds of recorded customer conversations being transcribed and indexed so Mindy answers the questions users actually ask, in the vocabulary they actually use.',
              },
              {
                t: 'Per-user fine-tuning',
                b: 'As vaults grow, Mindy will eventually train per-user models so drafts read in each bidder\'s specific voice — not a generic platform voice.',
              },
              {
                t: 'Cross-tool intelligence',
                b: 'Same retrieval infrastructure will plug into Cap Statement Builder, Content Reaper, recompete intelligence — every output sharpened by Vault + corpus.',
              },
            ].map((row) => (
              <div key={row.t} className="rounded-none border border-(--mp-line) bg-(--mp-surface) p-6">
                <h3 className="font-(family-name:--mp-font-serif) text-lg font-semibold text-(--mp-ink) mb-2">{row.t}</h3>
                <p className="text-(--mp-body) text-sm leading-relaxed">{row.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── BOTTOM LINE + CTA ───── */}
      <section className="py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-(--mp-ink) mb-6 leading-tight font-(family-name:--mp-font-serif)">
            Mindy is not an &ldquo;AI tool for federal contracting.&rdquo;
          </h2>
          <p className="text-xl text-(--mp-body) mb-10">
            It&apos;s a <strong className="text-(--mp-navy)">Living Intelligence Layer</strong> —
            your business profile fused with a curated GovCon knowledge corpus,
            producing federal-grade work no generic LLM can match.
          </p>
          <div className="grid md:grid-cols-3 gap-4 max-w-xl mx-auto mb-10 text-left">
            {[
              ['Day 1', 'Federal-voice drafts grounded in your identity'],
              ['Day 100', 'Drafts that read like you wrote them'],
              ['Year 1', 'A moat of structured business intelligence'],
            ].map((row) => (
              <div key={row[0]} className="rounded-none bg-(--mp-surface) border border-(--mp-line) p-4">
                <div className="text-xs text-(--mp-navy) font-(family-name:--mp-font-mono) uppercase tracking-wider mb-1">{row[0]}</div>
                <div className="text-sm text-(--mp-body)">{row[1]}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href={FREE_SIGNUP_URL}
              className="px-6 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white rounded-none font-semibold transition-colors"
            >
              Try Mindy free
            </Link>
            <Link
              href={DASHBOARD_URL}
              className="px-6 py-3 bg-(--mp-surface) hover:bg-(--mp-surface) text-(--mp-ink) rounded-none font-semibold border border-(--mp-line) transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ───── FOOTER ───── */}
      <footer className="border-t border-(--mp-line) py-8 px-4">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-4 text-sm text-(--mp-muted)">
          <div>
            <span className="text-(--mp-ink) font-semibold">Mindy</span> · a product of GovCon Giants
          </div>
          <div className="flex gap-5">
            <Link href="/" className="hover:text-(--mp-ink) transition-colors">Home</Link>
            <Link href="/mindy-landing" className="hover:text-(--mp-ink) transition-colors">Pricing</Link>
            <a href="mailto:hello@getmindy.ai" className="hover:text-(--mp-ink) transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
