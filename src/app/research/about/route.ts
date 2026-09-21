/**
 * GET /research/about — Why the Mindy Institute Exists (manifesto).
 *
 * Same civic shell as /gov + /research so the Institute family shares one visual identity.
 * Honest present is computed live from instituteState().
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';
import { instituteState } from '@/lib/analytics/research-publications';

export const dynamic = 'force-static';

const PAGE_CSS = `
  .article{padding:64px 0 40px;max-width:720px;margin:0 auto}
  .article .wrap{max-width:720px}
  .back{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:500;color:var(--muted);text-decoration:none;margin-bottom:28px}
  .back:hover{color:var(--teal-deep)}
  .article h1{font-size:clamp(32px,4.8vw,44px);margin:18px 0 0;max-width:18ch}
  .lead{font-family:var(--serif);font-size:clamp(20px,2.6vw,24px);line-height:1.4;color:var(--ink);margin:26px 0 0;font-weight:500}
  .prose{margin-top:28px}
  .prose p{color:var(--ink-soft);font-size:17.5px;line-height:1.65;margin:0 0 18px}
  .prose strong{color:var(--ink);font-weight:600}
  .prose h2{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--teal-deep);font-weight:700;margin:40px 0 14px}
  .charter{margin:36px 0 8px;background:var(--paper-2);border:1px solid var(--line);border-left:3px solid var(--teal);border-radius:14px;padding:28px 28px}
  .charter .ce{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:var(--teal-deep);margin-bottom:10px}
  .charter .cl{font-size:16.5px;color:var(--ink);font-weight:600;margin:0 0 16px;line-height:1.45}
  .charter ol{margin:0;padding:0;list-style:none;counter-reset:charter;display:flex;flex-direction:column;gap:14px}
  .charter li{position:relative;padding-left:40px;font-size:15.5px;color:var(--ink-soft);line-height:1.55}
  .charter li b{color:var(--ink)}
  .charter li::before{counter-increment:charter;content:counter(charter);position:absolute;left:0;top:0;width:26px;height:26px;border-radius:50%;background:var(--ink);color:var(--paper);font-family:var(--sans);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
  .charter a{color:var(--teal-deep);font-weight:600;text-decoration:none}
  .cta-row{margin-top:36px}
  .note{margin-top:22px;font-size:15px;color:var(--ink-soft)}
  .note a{color:var(--teal-deep);font-weight:600;text-decoration:none}
`;

function buildBody(): string {
  const s = instituteState();
  const metricsPhrase = `${s.productionMetrics} production ${s.productionMetrics === 1 ? 'measure' : 'measures'}`;
  const pubPhrase =
    s.published === 0
      ? 'our first benchmark is being prepared'
      : `${s.published} published ${s.published === 1 ? 'benchmark' : 'publications'}`;

  return `<style>${PAGE_CSS}</style>
<article class="article"><div class="wrap">
  <a class="back" href="/research">← All research</a>
  <span class="kicker">Declaration</span>
  <h1>Why the Mindy Institute Exists</h1>
  <p class="lead">Public procurement has never lacked data. It has lacked shared measurement.</p>
  <div class="prose">
    <p>Every day, thousands of public agencies publish opportunities while millions of businesses decide where to compete. Yet there are few common standards for understanding how that market actually behaves — who buys, how competition really works, and where small business has room to win. Numbers exist everywhere; agreed-upon measures do not.</p>
    <p>The Mindy Institute exists to change that. Our mission is to develop transparent, repeatable, evidence-based measures that help agencies, suppliers, researchers, and policymakers better understand public procurement — and to publish them openly.</p>

    <h2>What we believe</h2>
    <p><strong>We publish only what we can measure.</strong> Today that means ${metricsPhrase} in the Observatory and ${pubPhrase}; the rest of our research agenda is public and forthcoming. Each finding ships only when the underlying measurement is ready to stand behind — not before. The gap between our ambition and what we can prove today is not something we hide. It is the discipline that makes the published work worth trusting.</p>
    <p><strong>We distinguish between levels of evidence.</strong> A measure moves through defined stages — from early research, to collecting evidence, to a validated beta, to a production standard. We say plainly where each one sits, and we do not present a maturing measure as a settled fact.</p>
    <p><strong>Every published finding links to its methodology.</strong> Each measure carries a permanent identifier and a standing methodology record — its definition, how it is computed in plain language, its data sources, and its limitations. A published number can always be traced back to how it was made.</p>
    <p><strong>We disclose what we exclude.</strong> When a figure would be misleading — a percentage computed on too little data, an agency below a meaningful volume — we leave it out and say so. Excluded is not the same as hidden.</p>

    <section class="charter" aria-label="Editorial charter">
      <div class="ce">The editorial charter</div>
      <p class="cl">The Mindy Institute publishes findings only when the supporting Observatory standards meet the Institute’s publication criteria. Three rules hold that line:</p>
      <ol>
        <li><b>Every published claim traces to one or more Observatory standards.</b> No finding rests on a number we can’t point back to a defined measure.</li>
        <li><b>Every standard has a permanent OBS identifier and public methodology.</b> Its definition, how it’s computed, its sources, and its limits are on the record.</li>
        <li><b>If the evidence isn’t mature enough, the Institute does not publish the conclusion.</b> The claim waits in the <a href="/institute">research backlog</a> until its standard is ready.</li>
      </ol>
    </section>

    <h2>Why it matters</h2>
    <p>Better measurement leads to better decisions. Better decisions lead to healthier procurement markets — ones where suppliers can find the work they are suited for, and agencies can reach the businesses they are trying to serve. That is the outcome the Institute is built to move toward: not more data, but shared, trustworthy measures the whole market can reason from.</p>

    <p class="note">Curious what we can and can’t yet stand behind? <a href="/research/how-we-publish">See why some research isn’t published yet →</a></p>
    <div class="cta-row"><a class="btn primary" href="/research">See the published research →</a></div>
  </div>
</div></article>`;
}

const HTML = govPage({
  title: 'Why the Mindy Institute Exists — Measuring the Federal Procurement Market',
  description:
    'The Mindy Institute develops transparent, repeatable, evidence-based measures of how the public procurement market behaves. We publish only what the Observatory can support.',
  active: 'research',
  body: buildBody(),
});

export function GET() {
  return new NextResponse(HTML, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
