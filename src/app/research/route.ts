/**
 * GET /research — The Mindy Institute front door (Class A, public + indexable).
 *
 * Uses the same civic shell as /gov and /institute (paper + teal + Newsreader) so the
 * Institute reads as one brand family with the government marketing surface — not the
 * contractor app purple. Content is the publications registry (Standards → Benchmarks →
 * Research) plus the research-agenda concepts awaiting Observatory standards.
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';
import { publicationsByClass, type Publication, type PubKind } from '@/lib/analytics/research-publications';

export const dynamic = 'force-static';

const KIND_LABEL: Record<PubKind, string> = {
  annual: 'Annual Report',
  white_paper: 'White Paper',
  press: 'Press',
  index: 'Benchmark',
  dataset: 'Dataset',
};

const AGENDA: { slug: string; title: string; claim: string; awaits: string | null }[] = [
  { slug: 'competition-gap', title: 'The Competition Gap', awaits: 'Awaiting OBS-008',
    claim: 'A shrinking supplier base is quietly reducing competition on federal awards.' },
  { slug: 'bidder-pool-shrinking', title: 'The Bidder Pool Is Shrinking', awaits: 'Awaiting OBS-009',
    claim: 'Bidder outreach correlates with lower project cost, yet most states rarely do it.' },
  { slug: 'who-isnt-bidding', title: "Who Isn't Bidding on Your City's Contracts", awaits: 'Awaiting OBS-004',
    claim: 'The top reason firms don’t bid is that they never knew the opportunity existed.' },
  { slug: 'mls-problem', title: 'The MLS Problem in Public Procurement', awaits: null,
    claim: 'Public notices are free by law, but the path to them runs through paid intermediaries.' },
  { slug: '90887-front-doors', title: '90,887 Front Doors', awaits: null,
    claim: 'State and local buying is fragmented across 90,887 entities with no common front door.' },
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function publishedCard(p: Publication): string {
  const kind = KIND_LABEL[p.kind];
  const ed = p.edition
    ? `<span class="meta">Edition ${esc(p.edition)}${p.version ? ` · ${esc(p.version)}` : ''}</span>`
    : '';
  return `<a class="pub live" href="/research/${esc(p.slug!)}">
    <div class="toprow"><span class="tag">${esc(kind)}</span>${ed}</div>
    <h3>${esc(p.title)}</h3>
    <p>${esc(p.summary)}</p>
    <span class="read">Read the ${esc(kind.toLowerCase())} →</span>
  </a>`;
}

function forthcomingCard(p: Publication): string {
  const kind = KIND_LABEL[p.kind];
  const soon = `In development${p.edition ? ` · ${esc(p.edition)}` : ''}`;
  return `<div class="pub soon">
    <div class="toprow"><span class="tag">${esc(kind)}</span><span class="pill">${soon}</span></div>
    <h3>${esc(p.title)}</h3>
    <p>${esc(p.summary)}</p>
  </div>`;
}

const PAGE_CSS = `
  .rhero{padding:72px 0 28px;position:relative;overflow:hidden}
  .rhero .wrap{position:relative;z-index:1}
  .rhero h1{font-size:clamp(36px,5.8vw,60px);margin:22px 0 0;max-width:16ch}
  .rhero .sub{font-size:clamp(17px,2.2vw,21px);color:var(--ink-soft);max-width:58ch;margin:22px 0 0;line-height:1.5}
  .rhero .cta-row{margin-top:28px}
  .hero-bg{position:absolute;inset:0;z-index:0;opacity:.45;pointer-events:none}

  .intro{padding:8px 0 8px}
  .intro p{color:var(--ink-soft);font-size:17px;max-width:62ch;line-height:1.6}
  .intro b{color:var(--ink);font-weight:600}

  .sec{padding:48px 0 8px;border-top:1px solid var(--hair);margin-top:40px}
  .sec:first-of-type{border-top:0;margin-top:24px}
  .classhead{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:18px}
  .classhead h2{font-size:clamp(24px,3.2vw,32px)}
  .classhead .blurb{font-size:14.5px;color:var(--muted)}

  .empty{color:var(--muted);font-size:15.5px;margin:8px 0 0}
  .pubs{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden}
  .pub{background:var(--paper);padding:28px 26px;display:flex;flex-direction:column;text-decoration:none;color:inherit;transition:background .15s ease}
  .pub.live:hover{background:var(--teal-wash)}
  .pub.soon{background:var(--paper-2)}
  .pub .toprow{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .pub .tag{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--teal-deep)}
  .pub .meta{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
  .pub .pill{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;color:var(--muted);background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:3px 10px}
  .pub h3{font-size:20px;margin:14px 0 0;line-height:1.25;color:var(--ink)}
  .pub p{margin-top:10px;color:var(--ink-soft);font-size:15px;line-height:1.55}
  .pub .read{margin-top:auto;padding-top:18px;font-size:14px;font-weight:600;color:var(--teal-deep)}
  .pub.live:hover .read{color:var(--teal)}

  .subnote{font-size:15px;color:var(--ink-soft);max-width:58ch;margin:0 0 22px;line-height:1.55}
  .subnote b{color:var(--ink);font-weight:600}
  .subnote a{color:var(--teal-deep);font-weight:600;text-decoration:none}
  .subnote a:hover{text-decoration:underline}

  .agenda{display:flex;flex-direction:column;gap:2px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--line)}
  .arow{display:grid;grid-template-columns:160px 1fr 24px;gap:18px;align-items:center;padding:18px 22px;background:var(--paper);text-decoration:none;color:inherit;transition:background .15s ease}
  .arow:hover{background:var(--teal-wash)}
  .arow .await{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
  .arow .body{display:flex;flex-direction:column;gap:4px;min-width:0}
  .arow .body b{font-family:var(--serif);font-size:17px;font-weight:500;color:var(--ink);letter-spacing:-.01em}
  .arow .claim{font-size:14.5px;color:var(--ink-soft);line-height:1.45}
  .arow .arrow{color:var(--muted);font-weight:700;text-align:right}

  @media (max-width:720px){
    .pubs{grid-template-columns:1fr}
    .arow{grid-template-columns:1fr 24px}
    .arow .await{grid-column:1/-1}
    .rhero{padding:52px 0 16px}
  }
`;

function buildBody(): string {
  const groups = publicationsByClass();
  const sections = groups.map((g) => {
    const cards = g.publications.length === 0
      ? `<p class="empty">No ${esc(g.label.toLowerCase())} published yet.</p>`
      : `<div class="pubs">${g.publications.map((p) =>
          p.status === 'published' && p.slug ? publishedCard(p) : forthcomingCard(p)
        ).join('')}</div>`;
    return `<section class="sec"><div class="wrap">
      <div class="classhead"><h2>${esc(g.label)}</h2><span class="blurb">${esc(g.blurb)}</span></div>
      ${cards}
    </div></section>`;
  }).join('');

  const agenda = AGENDA.map((a) => `<a class="arow" href="/institute/${esc(a.slug)}">
    <span class="await">${esc(a.awaits ?? 'Standard not yet defined')}</span>
    <span class="body"><b>${esc(a.title)}</b><span class="claim">${esc(a.claim)}</span></span>
    <span class="arrow">→</span>
  </a>`).join('');

  return `<style>${PAGE_CSS}</style>

<header class="rhero">
  <svg class="hero-bg" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="var(--hair)" stroke-width="1"/></pattern></defs>
    <rect width="1200" height="400" fill="url(#grid)"/>
  </svg>
  <div class="wrap">
    <span class="kicker">The Mindy Institute</span>
    <h1>How the federal procurement market actually behaves.</h1>
    <p class="sub">Grounded research on the public procurement market — who buys, how competition really works, and where small business has room to win. Every figure is derived from live federal data, not estimated.</p>
    <div class="cta-row">
      <a class="btn ghost" href="/research/about">Why the Institute exists →</a>
      <a class="btn ghost" href="/research/how-we-publish">Why some research isn’t published yet →</a>
    </div>
  </div>
</header>

<section class="intro"><div class="wrap">
  <p>Our work is built in layers. <b>Standards</b> define a measure; <b>Benchmarks</b> apply one to the real market; <b>Research</b> interprets several to make an argument. Research sits on top of standards — so every finding traces back to a measure we can defend.</p>
</div></section>

${sections}

<section class="sec"><div class="wrap">
  <div class="classhead"><h2>Research agenda</h2><span class="blurb">Concepts we’re working toward — each waiting on a standard.</span></div>
  <p class="subnote">These are <b>research concepts</b>, not publications. Each states a claim we believe the evidence will support and names the Observatory standard it depends on. When that standard reaches publication maturity, the concept graduates into a publication above. <a href="/research/how-we-publish">See why some research isn’t published yet →</a></p>
  <div class="agenda">${agenda}</div>
</div></section>
`;
}

const HTML = govPage({
  title: 'The Mindy Institute — Research on the Federal Procurement Market',
  description:
    'The Mindy Institute publishes grounded research on how the public procurement market actually behaves — benchmarks, white papers, and an annual report, each derived from live federal data.',
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
