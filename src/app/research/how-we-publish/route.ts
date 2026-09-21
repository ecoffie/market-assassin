/**
 * GET /research/how-we-publish — Why some research isn’t published yet.
 *
 * Same civic shell as /gov + /research. Maturity ladder is live from the Observatory registry.
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';
import { maturityLadder, type LadderTier } from '@/lib/analytics/observatory-methodology';
import { publicationsForDisplay, resolveCitations } from '@/lib/analytics/research-publications';

export const dynamic = 'force-static';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tierLabel(lc: string): string {
  return ({ production: 'Production', beta: 'Beta', collecting: 'Collecting', research: 'Research' } as Record<string, string>)[lc] ?? lc;
}

const PAGE_CSS = `
  .article{padding:64px 0 40px;max-width:800px;margin:0 auto}
  .article .wrap{max-width:800px}
  .back{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:500;color:var(--muted);text-decoration:none;margin-bottom:28px}
  .back:hover{color:var(--teal-deep)}
  .article h1{font-size:clamp(30px,4.6vw,42px);margin:18px 0 0;max-width:18ch}
  .lead{font-family:var(--serif);font-size:clamp(19px,2.4vw,23px);line-height:1.4;color:var(--ink);margin:24px 0 0;font-weight:500}
  .prose{margin-top:26px}
  .prose p{color:var(--ink-soft);font-size:17px;line-height:1.65;margin:0 0 18px}
  .prose b,.prose strong{color:var(--ink);font-weight:600}
  .prose em{font-style:italic}
  .prose h2{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--teal-deep);font-weight:700;margin:40px 0 16px}
  .ladder{display:flex;flex-direction:column;gap:14px}
  .tier{border:1px solid var(--line);border-radius:14px;padding:20px 22px;border-left-width:3px;background:var(--paper)}
  .tier--production{border-left-color:var(--teal)}
  .tier--beta{border-left-color:var(--gold)}
  .tier--collecting{border-left-color:#c4a035}
  .tier--research{border-left-color:var(--red)}
  .tier-head{display:flex;align-items:center;gap:10px}
  .tier-label{font-family:var(--serif);font-size:18px;font-weight:500;color:var(--ink)}
  .tier-count{margin-left:auto;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--muted);background:var(--paper-2);border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-variant-numeric:tabular-nums}
  .tier-blurb{font-size:14.5px;color:var(--ink-soft);margin:8px 0 12px;line-height:1.5}
  .tier-empty{font-size:14px;color:var(--muted);font-style:italic;margin:0}
  .metrics{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
  .metric{border-top:1px solid var(--hair);padding-top:12px}
  .metric:first-child{border-top:none;padding-top:0}
  .metric-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  .metric-id{font-family:var(--mono);font-size:11.5px;font-weight:700;color:var(--teal-deep);background:var(--teal-wash);border-radius:5px;padding:2px 8px}
  .metric-name{font-size:15.5px;font-weight:600;color:var(--ink)}
  .metric-def{font-size:14px;color:var(--ink-soft);margin:6px 0 0;line-height:1.5}
  .metric-reason{font-size:13.5px;color:var(--muted);margin:6px 0 0;line-height:1.5}
  .metric-reason .why{font-weight:600;color:var(--ink-soft)}
  .cta-row{margin-top:36px}
`;

function tierBlock(tier: LadderTier): string {
  const metrics = tier.metrics.length === 0
    ? `<p class="tier-empty">No measures at this stage right now.</p>`
    : `<ul class="metrics">${tier.metrics.map((m) => `<li class="metric">
        <div class="metric-head"><span class="metric-id">${esc(m.id)}</span><span class="metric-name">${esc(m.name)}</span></div>
        <p class="metric-def">${esc(m.definition)}</p>
        ${m.reason ? `<p class="metric-reason"><span class="why">Why not further along:</span> ${esc(m.reason)}</p>` : ''}
      </li>`).join('')}</ul>`;

  return `<section class="tier tier--${esc(tier.lifecycle)}">
    <div class="tier-head">
      <span aria-hidden="true">${esc(tier.dot)}</span>
      <span class="tier-label">${esc(tier.label)}</span>
      <span class="tier-count">${tier.metrics.length}</span>
    </div>
    <p class="tier-blurb">${esc(tier.blurb)}</p>
    ${metrics}
  </section>`;
}

function buildBody(): string {
  const ladder = maturityLadder();
  const order: Record<string, number> = { research: 0, collecting: 1, beta: 2, production: 3 };
  let blockedExample: { title: string; metricId: string; metricName: string; lifecycle: string } | null = null;
  for (const p of publicationsForDisplay()) {
    if (p.status === 'published') continue;
    const cited = resolveCitations(p)
      .map((c) => c.standard)
      .filter((s): s is NonNullable<typeof s> => !!s && s.lifecycle !== 'production')
      .sort((a, b) => order[a.lifecycle] - order[b.lifecycle]);
    if (cited.length) {
      blockedExample = { title: p.title, metricId: cited[0].id, metricName: cited[0].name, lifecycle: cited[0].lifecycle };
      break;
    }
  }
  const published = publicationsForDisplay().filter((p) => p.status === 'published').length;

  const exampleHtml = blockedExample
    ? `<p><b>A worked example.</b> Our forthcoming paper <em>“${esc(blockedExample.title)}”</em> rests, in part, on <b>${esc(blockedExample.metricId)} · ${esc(blockedExample.metricName)}</b>, which is currently at the <b>${esc(tierLabel(blockedExample.lifecycle))}</b> stage. Until that measure matures, the paper’s central claim can’t be fully defended — so it stays forthcoming, not published. When the measure graduates, the paper becomes publishable. Not before.</p>`
    : `<p>Every forthcoming publication is gated the same way: it ships only once each measure it rests on is mature enough to defend.</p>`;

  const shelfHtml = published === 0
    ? 'That is why our published shelf is deliberately short today. Each item on it can be defended to a procurement official, an academic, or a journalist, line by line — and that is the only shelf worth building.'
    : 'That is why our published shelf grows slowly. Each item on it can be defended to a procurement official, an academic, or a journalist, line by line.';

  return `<style>${PAGE_CSS}</style>
<article class="article"><div class="wrap">
  <a class="back" href="/research">← All research</a>
  <span class="kicker">How we publish</span>
  <h1>Why some research isn’t published yet</h1>
  <p class="lead">Most organizations publish first and defend later. We do it the other way around.</p>
  <div class="prose">
    <p>The Mindy Institute publishes a finding only after the Observatory measures it rests on reach sufficient maturity. When we don’t have enough evidence to defend a claim, we say so — and we don’t publish it. That restraint is not a limitation of the work. It <em>is</em> the work.</p>
    <p>To make that concrete, here is the full ladder — every measure we track, what tier it sits at, and the honest reason it’s there. Nothing is hidden; the not-yet-ready measures are listed right alongside the ready ones.</p>

    <h2>The maturity ladder</h2>
    <div class="ladder">${ladder.map(tierBlock).join('')}</div>

    <h2>What this means in practice</h2>
    ${exampleHtml}
    <p>${shelfHtml}</p>
    <div class="cta-row"><a class="btn primary" href="/research">See what we’ve published →</a></div>
  </div>
</div></article>`;
}

const HTML = govPage({
  title: 'Why Some Research Isn’t Published Yet — The Mindy Institute',
  description:
    'The Mindy Institute publishes findings only after the supporting Observatory measures reach sufficient maturity. Here is exactly what we can and cannot yet stand behind.',
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
