/**
 * GET /research/standard — The Mindy Institute Research Standard (v1).
 *
 * Same civic shell as /research, /research/about and /research/how-we-publish. Static: the Standard is
 * versioned data (src/lib/analytics/research-standard.ts), not live figures.
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';
import { RESEARCH_STANDARD_V1 } from '@/lib/analytics/research-standard';

export const dynamic = 'force-static';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PAGE_CSS = `
  .article{padding:64px 0 40px;max-width:720px;margin:0 auto}
  .article .wrap{max-width:720px}
  .back{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:500;color:var(--mp-muted);text-decoration:none;margin-bottom:28px}
  .back:hover{color:var(--mp-navy)}
  .article h1{font-size:clamp(32px,4.8vw,44px);margin:18px 0 0;max-width:18ch}
  .lead{font-family:var(--mp-font-serif);font-size:clamp(19px,2.4vw,22px);line-height:1.45;color:var(--mp-ink);margin:24px 0 0;font-weight:400}
  .meta{margin-top:18px;font-family:var(--mp-font-mono);font-size:12px;letter-spacing:.04em;color:var(--mp-muted)}
  .prose{margin-top:28px}
  .prose p,.prose li{color:var(--mp-body);font-size:16.5px;line-height:1.6}
  .prose p{margin:0 0 16px}
  .prose b{color:var(--mp-ink);font-weight:600}
  .prose h2{font-family:var(--mp-font-sans);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--mp-accent);font-weight:700;margin:40px 0 14px}
  .prose a{color:var(--mp-navy);font-weight:600}
  .roles{margin:0;padding:0;list-style:none;border-top:1px solid var(--mp-line)}
  .roles li{padding:12px 0;border-bottom:1px solid var(--mp-hair)}
  .principles{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:18px}
  .principles li{display:grid;grid-template-columns:34px 1fr;gap:12px;align-items:start}
  .principles .n{font-family:var(--mp-font-mono);font-size:13px;font-weight:600;color:var(--mp-navy);padding-top:2px}
  .principles .t{display:block;color:var(--mp-ink);font-weight:600;margin-bottom:2px}
`;

function buildBody(): string {
  const s = RESEARCH_STANDARD_V1;
  const principles = s.principles
    .map((p) => `<li id="p${p.n}"><span class="n">${p.n}.</span><div><span class="t">${esc(p.title)}</span>${esc(p.rule)}</div></li>`)
    .join('');
  const history = s.history.map((h) => `<li><b>${esc(h.version)}</b> · ${esc(h.date)} — ${esc(h.note)}</li>`).join('');

  return `<style>${PAGE_CSS}</style>
<article class="article"><div class="wrap">
  <a class="back" href="/research">← All research</a>
  <span class="kicker">Research Standard ${esc(s.version)}</span>
  <h1>The rules every publication follows</h1>
  <p class="lead">The Mindy Institute publishes independent research and measurement of the public procurement economy. This Standard is how a reader can check that work.</p>
  <p class="meta">Version ${esc(s.version)} · adopted ${esc(s.adopted)}</p>
  <div class="prose">
    <h2>Who does what</h2>
    <ul class="roles">
      <li><b>The Mindy Institute</b> is the research institution. It publishes the research and owns this Standard.</li>
      <li><b>Mindy</b> is the data and evidence engine the Institute uses to assemble and compute its measurements.</li>
      <li><b>GovCon Giants</b> is practitioner media, education and advisory. It explains and distributes Institute research; it is not the source of Institute figures.</li>
      <li><b>Eric Coffie</b> presents and interprets the research in public.</li>
      <li><b>Mindy for Government</b> (getmindy.ai/gov) applies Mindy's research and technology for government buyers.</li>
    </ul>
    <p style="margin-top:16px">The Institute is operated by GovCon Giants AI, which also sells Mindy. Principle 13 exists because of that relationship.</p>

    <h2>The principles</h2>
    <ol class="principles">${principles}</ol>

    <h2>In practice</h2>
    <p>Every publication shows its version, publish date, measurement date and, for a historical study, its cutoff. It has a methodology section, a limitations section and a dated corrections log. Where a publication's figures are recomputed live, it says so on the page.</p>
    <p>For how measures mature before we publish findings built on them, see <a href="/research/how-we-publish">why some research isn’t published yet</a>.</p>

    <h2>Version history</h2>
    <ul>${history}</ul>
  </div>
</div></article>`;
}

const HTML = govPage({
  canonical: 'https://getmindy.ai/research/standard',
  title: 'Research Standard v1 — The Mindy Institute',
  description:
    'The rules every Mindy Institute publication follows: measurement and as-of dates, provenance, completeness, terminology, separation of fact from interpretation, corrections and limitations.',
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
