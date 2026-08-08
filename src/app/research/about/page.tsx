/**
 * The Mindy Institute — manifesto / declaration (/research/about).
 *
 * "Why the Mindy Institute Exists." PUBLIC, SEO-indexed. This is the editorial voice behind the
 * research surface — a philosophy, not marketing.
 *
 * ⚠️ It practices what the whole Institute preaches: bold mission, HONEST present. The current-state
 * line is computed from LIVE registry counts (instituteState) so it never overstates — when a metric
 * reaches Production or RES-001 ships, the numbers update themselves. Attribution is "the research arm
 * of Mindy, operated by GovCon Giants AI" — NOT "independent" (it measures the market GCG sells into;
 * "independent" is a claim a skeptic would test and we would lose).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { instituteState } from '@/lib/analytics/research-publications';

export const metadata: Metadata = {
  title: 'Why the Mindy Institute Exists — Measuring the Federal Procurement Market',
  description:
    'The Mindy Institute develops transparent, repeatable, evidence-based measures of how the public procurement market behaves. We publish only what the Observatory can support.',
  alternates: { canonical: 'https://getmindy.ai/research/about' },
  openGraph: {
    type: 'article',
    title: 'Why the Mindy Institute Exists',
    description: 'Transparent, repeatable, evidence-based measurement of the public procurement market.',
    url: 'https://getmindy.ai/research/about',
  },
};

export default function InstituteManifesto() {
  const s = instituteState();
  // Honest present, in plain language — pluralized off live counts so it never drifts.
  const metricsPhrase = `${s.productionMetrics} production ${s.productionMetrics === 1 ? 'measure' : 'measures'}`;
  const pubPhrase =
    s.published === 0
      ? 'our first benchmark is being prepared'
      : `${s.published} published ${s.published === 1 ? 'benchmark' : 'publications'}`;

  return (
    <main className="im-main">
      <style>{CSS}</style>

      <header className="im-mast">
        <div className="im-wrap im-mastrow">
          <Link href="/research" className="im-inst"><span className="im-dot" />The Mindy Institute</Link>
          <Link href="/research" className="im-back">← All research</Link>
        </div>
      </header>

      <article className="im-wrap im-article">
        <div className="im-kicker">Declaration</div>
        <h1>Why the Mindy Institute Exists</h1>

        <p className="im-lead">Public procurement has never lacked data. It has lacked shared measurement.</p>

        <p>Every day, thousands of public agencies publish opportunities while millions of businesses
          decide where to compete. Yet there are few common standards for understanding how that market
          actually behaves — who buys, how competition really works, and where small business has room
          to win. Numbers exist everywhere; agreed-upon measures do not.</p>

        <p>The Mindy Institute exists to change that. Our mission is to develop transparent, repeatable,
          evidence-based measures that help agencies, suppliers, researchers, and policymakers better
          understand public procurement — and to publish them openly.</p>

        <h2>What we believe</h2>

        <p><strong>We publish only what we can measure.</strong> Today that means {metricsPhrase} in the
          Observatory and {pubPhrase}; the rest of our research agenda is public and forthcoming. Each
          finding ships only when the underlying measurement is ready to stand behind — not before. The
          gap between our ambition and what we can prove today is not something we hide. It is the
          discipline that makes the published work worth trusting.</p>

        <p><strong>We distinguish between levels of evidence.</strong> A measure moves through defined
          stages — from early research, to collecting evidence, to a validated beta, to a production
          standard. We say plainly where each one sits, and we do not present a maturing measure as a
          settled fact.</p>

        <p><strong>Every published finding links to its methodology.</strong> Each measure carries a
          permanent identifier and a standing methodology record — its definition, how it is computed in
          plain language, its data sources, and its limitations. A published number can always be traced
          back to how it was made.</p>

        <p><strong>We disclose what we exclude.</strong> When a figure would be misleading — a percentage
          computed on too little data, an agency below a meaningful volume — we leave it out and say so.
          Excluded is not the same as hidden.</p>

        <h2>Why it matters</h2>

        <p>Better measurement leads to better decisions. Better decisions lead to healthier procurement
          markets — ones where suppliers can find the work they are suited for, and agencies can reach
          the businesses they are trying to serve. That is the outcome the Institute is built to move
          toward: not more data, but shared, trustworthy measures the whole market can reason from.</p>

        <div className="im-cta">
          <Link href="/research" className="im-cta-link">See the published research →</Link>
        </div>

        <footer className="im-foot">
          <p><strong>The Mindy Institute</strong><br />
            The research arm of <a href="https://getmindy.ai">Mindy</a>, operated by GovCon Giants AI.
            Every finding is powered by the Mindy Observatory and grounded in live federal data.</p>
        </footer>
      </article>
    </main>
  );
}

const CSS = `
.im-main{--navy:#0b1f3a;--ink:#1d2939;--muted:#667085;--line:#e4e7ec;--accent:#7c3aed;
  background:#fff;color:var(--ink);min-height:100vh;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.7}
.im-wrap{max-width:680px;margin:0 auto;padding:0 22px}
.im-mast{border-bottom:1px solid var(--line);padding:18px 0}
.im-mastrow{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:680px}
.im-inst{display:flex;align-items:center;gap:9px;font-weight:800;letter-spacing:.02em;color:var(--navy);text-decoration:none}
.im-dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
.im-back{font-size:13px;color:var(--muted);text-decoration:none}
.im-back:hover{color:var(--navy)}
.im-article{padding:48px 22px 40px}
.im-kicker{font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
.im-article h1{font-size:38px;line-height:1.15;margin:10px 0 26px;letter-spacing:-.015em;color:var(--navy);text-wrap:balance}
.im-lead{font-size:21px;line-height:1.5;color:var(--navy);font-weight:600;margin:0 0 24px}
.im-article p{font-size:17px;margin:0 0 20px;color:#344054}
.im-article strong{color:var(--ink)}
.im-article h2{font-size:15px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:38px 0 14px}
.im-cta{margin:38px 0 8px}
.im-cta-link{display:inline-block;font-size:15px;font-weight:700;color:#fff;background:var(--accent);border-radius:10px;padding:11px 20px;text-decoration:none}
.im-cta-link:hover{background:#6d28d9}
.im-foot{margin-top:40px;border-top:1px solid var(--line);padding-top:22px}
.im-foot p{font-size:13.5px;color:var(--muted);line-height:1.6;margin:0}
.im-foot a{color:var(--accent);text-decoration:none}
@media (max-width:560px){.im-article h1{font-size:30px}.im-lead{font-size:19px}.im-article p{font-size:16px}}
`;
