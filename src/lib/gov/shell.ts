/**
 * Shared shell for the APEX / government marketing pages (/gov, /institute, /pilot).
 *
 * POSITIONING ONLY — agency-facing marketing. No app/auth/DB coupling.
 *
 * Visual system: the Mindy public site (src/lib/public-site). These pages used to carry their
 * own civic identity (Newsreader + oxide teal, data-URI fonts, automatic dark mode); since
 * 2026-10-03 they render inside the shared shell — same header, footer, self-hosted fonts and
 * `--mp-*` roles as every other public page. The "Mindy for Government" bar below the shared
 * header keeps the gov family's own navigation and wording.
 *
 * Every statistic on these pages is real and sourced in the footer — no modeled or projected
 * figures.
 */
import { mpRawBodyClose, mpRawBodyOpen, mpRawHeadHtml } from '@/lib/public-site/html';

/**
 * Gov-family rules, written ONLY in the public-site roles (`--mp-*`, src/lib/public-site/tokens.ts).
 * The canvas, fonts, header and footer come from the shared shell (src/lib/public-site/html.ts).
 * No automatic dark mode: public government pages are always the paper system.
 *
 * Role map from the retired civic palette, for the route files' own rules:
 *   paper → --mp-paper · paper-2 → --mp-wash · ink → --mp-ink · ink-soft → --mp-body
 *   line → --mp-line · hair → --mp-hair · muted → --mp-muted
 *   teal / teal-deep → --mp-navy · teal-wash → --mp-navy-wash
 *   red (editorial "the problem" emphasis) → --mp-accent · gold (status) → --mp-warn
 *   Newsreader → --mp-font-serif (Libre Baskerville) · mono → --mp-font-mono (IBM Plex Mono)
 */
export const GOV_CSS = `
  html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
  @media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  body{margin:0;line-height:1.6;font-size:17px}
  :where(.mp-main) :is(h1,h2,h3){font-family:var(--mp-font-serif);font-weight:700;line-height:1.18;text-wrap:balance;letter-spacing:-.01em;margin:0;color:var(--mp-ink)}
  :where(.mp-main) p{margin:0}
  :where(.mp-main) a{color:var(--mp-navy);text-decoration-thickness:1px;text-underline-offset:2px}
  :where(.mp-main) img{max-width:100%}
  .wrap{max-width:var(--mp-content-max);margin:0 auto;padding:0 var(--mp-gutter)}
  .eyebrow{font-family:var(--mp-font-sans);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--mp-accent);font-weight:700}

  /* gov section bar (sits under the shared header) */
  .top{background:var(--mp-surface);border-bottom:1px solid var(--mp-line)}
  .top .wrap{display:flex;align-items:center;justify-content:space-between;min-height:54px;gap:16px}
  .brand{display:flex;align-items:center;gap:9px;font-family:var(--mp-font-serif);font-size:17px;font-weight:700;color:var(--mp-ink);text-decoration:none;letter-spacing:-.01em}
  .brand .mk{width:24px;height:24px;border-radius:0;background:var(--mp-navy);color:var(--mp-surface);display:grid;place-items:center;font-family:var(--mp-font-sans);font-weight:700;font-size:12px}
  .brand .gov{font-family:var(--mp-font-sans);font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--mp-muted);border-left:1px solid var(--mp-line);padding-left:9px;margin-left:2px}
  .topnav{display:flex;align-items:center;gap:22px}
  .topnav a.lnk{font-family:var(--mp-font-sans);font-weight:500;font-size:14px;color:var(--mp-body);text-decoration:none}
  .topnav a.lnk:hover,.topnav a.lnk[aria-current="page"]{color:var(--mp-navy)}
  .topnav a.lnk[aria-current="page"]{font-weight:600}
  a.topcta{font-family:var(--mp-font-sans);font-weight:600;font-size:14px;color:var(--mp-surface);background:var(--mp-navy);padding:9px 16px;border-radius:0;text-decoration:none;white-space:nowrap}
  a.topcta:hover{background:var(--mp-navy-hover)}
  @media (max-width:900px){.topnav a.lnk{display:none}}

  /* buttons: square, like every homepage CTA */
  .btn{font-family:var(--mp-font-sans);font-weight:600;font-size:15px;padding:13px 22px;border-radius:0;text-decoration:none;display:inline-flex;align-items:center;gap:8px;border:1px solid transparent;transition:background .12s,border-color .12s,color .12s;cursor:pointer}
  .btn.primary{background:var(--mp-navy);color:var(--mp-surface)}
  .btn.primary:hover{background:var(--mp-navy-hover)}
  .btn.ghost{background:var(--mp-surface);color:var(--mp-ink);border-color:var(--mp-line)}
  .btn.ghost:hover{border-color:var(--mp-ink);background:var(--mp-wash)}
  .cta-row{display:flex;flex-wrap:wrap;gap:12px}

  /* generic sections */
  .kicker{display:inline-flex;align-items:center;gap:8px;font-family:var(--mp-font-sans);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--mp-accent);font-weight:700;padding:0;background:none;border:0}

  /* gov sources block (above the shared footer) */
  footer.gov{border-top:1px solid var(--mp-line);margin-top:56px;padding:40px 0 8px;color:var(--mp-muted);font-size:13.5px}
  footer.gov .wrap{display:flex;flex-wrap:wrap;gap:24px;justify-content:space-between;align-items:flex-start}
  footer.gov .fnav a{color:var(--mp-body);text-decoration:none;margin-right:18px;font-weight:500}
  footer.gov .fnav a:hover{color:var(--mp-navy);text-decoration:underline}
  footer.gov .sources{max-width:52ch;line-height:1.7}
  footer.gov .sources b{color:var(--mp-ink);display:block;font-family:var(--mp-font-sans);font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px}
`;

/** Brand lockup. `size` controls the mark; used in the top bar + footer. */
export type GovNavActive = 'gov' | 'institute' | 'pilot' | 'partners' | 'research';

export function govBrand(active?: GovNavActive): string {
  void active;
  return `<a class="brand" href="/gov"><span class="mk">M</span> Mindy <span class="gov">for Government</span></a>`;
}

/** Sticky top bar with cross-links + the demo CTA. */
export function govTop(active: GovNavActive): string {
  const link = (href: string, label: string, key: string) =>
    `<a class="lnk"${key === active ? ' aria-current="page"' : ''} href="${href}">${label}</a>`;
  return `<div class="top"><div class="wrap">${govBrand(active)}
    <nav class="topnav">
      ${link('/gov', 'Overview', 'gov')}
      ${link('/research', 'The Institute', 'research')}
      ${link('/institute', 'Research Backlog', 'institute')}
      ${link('/pilot', 'Pilot Program', 'pilot')}
      ${link('/gov/apex', 'For APEX Accelerators', 'partners')}
      <a class="topcta" href="/pilot">Apply for Pilot</a>
    </nav></div></div>`;
}

/** Shared footer with the cross-links + the single authoritative sources block. */
export function govFooter(): string {
  return `<footer class="gov"><div class="wrap">
    <div>
      <a class="brand" href="/gov" style="font-size:16px"><span class="mk" style="width:22px;height:22px;font-size:11px">M</span> Mindy <span class="gov">for Government</span></a>
      <div class="fnav" style="margin-top:14px"><a href="/gov">Overview</a><a href="/research">The Institute</a><a href="/institute">Research Backlog</a><a href="/pilot">Pilot Program</a><a href="/partners">For APEX Accelerators</a><a href="mailto:hello@getmindy.ai">Contact</a></div>
      <p style="margin-top:14px;color:var(--mp-muted)">A program of GovCon Giants AI.</p>
    </div>
    <div class="sources"><b>Sources</b>
      Small-business supplier &amp; new-entrant decline: Bipartisan Policy Center, <em>Supporting Small Business and Strengthening the Economy Through Procurement Reform</em> (2021), drawing on CSIS and SBA data. DoD vendor counts: GAO&#8209;22&#8209;104621. FY2023 small-business share: U.S. SBA Small Business Procurement Scorecard. Supplier-base priority: OMB M&#8209;23&#8209;11, <em>Creating a More Diverse and Resilient Federal Marketplace</em>. Figures are cited as published; no data is modeled or projected.
    </div>
  </div></footer>`;
}

/** Wrap page-body HTML in the full document: shared head + shared header, gov bar, body, gov sources, shared footer. */
/**
 * `canonical` is an absolute self-referencing URL for this page.
 *
 * These are ROUTE HANDLERS, so Next's `metadata`/`alternates` never applies to
 * them — the head is whatever this template emits. Measured on production
 * 2026-09-21 by crawling all 36,070 sitemap URLs: /research, /research/about
 * and /research/how-we-publish emitted NO canonical at all. Optional, so every
 * existing caller keeps its current behaviour until it opts in.
 */
export function govPage(opts: {
  title: string;
  description: string;
  active: GovNavActive;
  body: string;
  canonical?: string;
}): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<meta name="description" content="${opts.description}">
${opts.canonical ? `<link rel="canonical" href="${opts.canonical}">` : ''}
<meta property="og:title" content="${opts.title}">
<meta property="og:description" content="${opts.description}">
${mpRawHeadHtml()}
<style>${GOV_CSS}</style>
</head><body>
${mpRawBodyOpen()}
${govTop(opts.active)}
${opts.body}
${govFooter()}
${mpRawBodyClose()}
</body></html>`;
}
