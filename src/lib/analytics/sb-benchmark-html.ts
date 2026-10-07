/**
 * Public HTML render for RES-003 — the Small-Business Participation Benchmark.
 *
 * This emits a COMPLETE, self-contained, Mindy-Institute-branded <!doctype html> document (the same
 * pattern as /reports/[id] — the route handler just returns this string). It is a PUBLIC research
 * artifact: SEO-indexed, citable, permanent URL. So the bar on honesty is absolute —
 *  - every number is the exact head-count the engine returned (no rounding of counts, one-decimal %),
 *  - the minimum-volume floor + the count of excluded agencies is DISCLOSED, not hidden,
 *  - the methodology (what was measured, over what, its limits) is stated plainly,
 *  - it CITES OBS-001 by its permanent Observatory id (it computes only OBS-001 — corrected v1.1),
 *  - it says plainly that it is LIVE (recomputed per request), not a frozen edition,
 *  - the edition + version + generated date are shown (the URL is permanent; the edition evolves).
 *
 * Visual system: the Mindy public site (src/lib/public-site) — shared header/footer, self-hosted
 * fonts (no CDN) and the `--mp-*` roles. Print hides the shared chrome so the report prints alone.
 */
import type { Benchmark, AgencyRow } from './sb-participation-benchmark';
import type { Correction } from './research-publications';
import { mpRawBodyClose, mpRawBodyOpen, mpRawHeadHtml } from '@/lib/public-site/html';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Title-case a SCREAMING department name ("VETERANS AFFAIRS, DEPARTMENT OF" → "Veterans Affairs, Department Of").
function titleCase(dept: string): string {
  return dept.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

const fmt = (n: number) => n.toLocaleString('en-US');

function row(r: AgencyRow, rank: number, maxPct: number): string {
  const barW = maxPct > 0 ? Math.round((r.pct / maxPct) * 100) : 0;
  return `<tr>
    <td class="rank">${rank}</td>
    <td class="dept">${esc(titleCase(r.department))}</td>
    <td class="num">${fmt(r.active)}</td>
    <td class="num">${fmt(r.withSetAside)}</td>
    <td class="pct">
      <div class="pctwrap"><div class="bar" style="width:${barW}%"></div><span class="pctval">${r.pct.toFixed(1)}%</span></div>
    </td>
  </tr>`;
}

export function renderSbBenchmarkHtml(b: Benchmark, opts: { edition: string; version: string; generatedDate: string; canonical: string; corrections?: Correction[] }): string {
  const { edition, version, generatedDate, canonical } = opts;
  const corrections = opts.corrections ?? [];
  const maxPct = b.rows.reduce((m, r) => Math.max(m, r.pct), 0);
  const rowsHtml = b.rows.map((r, i) => row(r, i + 1, maxPct)).join('\n');
  const fleetPct = b.fleetPct == null ? 'unknown' : `${b.fleetPct.toFixed(1)}%`;

  const desc = `A per-agency benchmark ranking federal buyers by small-business set-aside participation on active solicitations. Edition ${edition}. Published by the Mindy Institute.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Small-Business Participation Benchmark ${esc(edition)} — The Mindy Institute</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="Small-Business Participation Benchmark ${esc(edition)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="robots" content="index,follow">
${mpRawHeadHtml()}
<style>
  html{-webkit-text-size-adjust:100%}
  body{margin:0;line-height:1.55;font-size:16px}
  .sbb.wrap{max-width:920px;margin:0 auto;padding:0 22px 24px;color:var(--mp-ink)}
  .sbb header.masthead{border-bottom:1px solid var(--mp-line);padding:22px 0 18px;margin-bottom:8px}
  .sbb .inst{display:flex;align-items:center;gap:9px;font-family:var(--mp-font-serif);font-weight:700;letter-spacing:.01em;color:var(--mp-ink)}
  .sbb .inst .dot{width:9px;height:9px;border-radius:0;background:var(--mp-accent)}
  .sbb .inst .sub{font-family:var(--mp-font-sans);font-weight:600;color:var(--mp-muted);font-size:12px;letter-spacing:.12em;text-transform:uppercase}
  .sbb .hero{padding:34px 0 10px}
  .sbb .kicker{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--mp-accent)}
  .sbb h1{font:700 34px/1.18 var(--mp-font-serif);margin:10px 0 8px;letter-spacing:-.012em;color:var(--mp-ink);text-wrap:balance}
  .sbb .lede{font:400 17px/1.6 var(--mp-font-serif);color:var(--mp-body);max-width:680px;margin:6px 0 0}
  .sbb .lede b{color:var(--mp-ink)}
  .sbb .meta{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 4px}
  .sbb .chip{font-size:12px;color:var(--mp-body);background:var(--mp-wash);border:1px solid var(--mp-line);border-radius:var(--mp-radius-chip);padding:3px 9px;font-weight:600}
  .sbb .chip.cite{background:var(--mp-navy-wash);border-color:var(--mp-line);color:var(--mp-navy);font-family:var(--mp-font-mono);font-weight:500}
  .sbb .headline{display:flex;gap:26px;flex-wrap:wrap;margin:26px 0 6px;padding:18px 20px;border:1px solid var(--mp-line);border-radius:0;background:var(--mp-surface)}
  .sbb .headline .stat{min-width:140px}
  .sbb .headline .big{font:600 30px/1.1 var(--mp-font-mono);letter-spacing:-.03em;color:var(--mp-ink);font-variant-numeric:tabular-nums}
  .sbb .headline .lab{font-size:12.5px;color:var(--mp-muted);margin-top:4px}
  .sbb h2{font:700 11px var(--mp-font-sans);letter-spacing:.18em;text-transform:uppercase;color:var(--mp-muted);margin:38px 0 12px}
  .sbb .tablewrap{overflow-x:auto;border:1px solid var(--mp-line);border-radius:0;background:var(--mp-surface)}
  .sbb table{border-collapse:collapse;width:100%;min-width:640px}
  .sbb th,.sbb td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--mp-hair);font-size:14.5px}
  .sbb th{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--mp-muted);font-weight:600;background:var(--mp-wash);border-bottom-color:var(--mp-line)}
  .sbb tr:last-child td{border-bottom:none}
  .sbb td.rank{color:var(--mp-muted);width:34px;font-family:var(--mp-font-mono);font-variant-numeric:tabular-nums}
  .sbb td.dept{font-weight:600;color:var(--mp-ink)}
  .sbb td.num{text-align:right;font-family:var(--mp-font-mono);font-variant-numeric:tabular-nums;color:var(--mp-body);width:120px}
  .sbb th.num{text-align:right}
  .sbb td.pct{width:220px}
  .sbb .pctwrap{position:relative;display:flex;align-items:center;gap:10px}
  .sbb .pctwrap .bar{height:9px;border-radius:0;background:var(--mp-navy);min-width:2px}
  .sbb .pctval{font-family:var(--mp-font-mono);font-weight:600;font-variant-numeric:tabular-nums;color:var(--mp-ink);white-space:nowrap}
  .sbb .method{margin-top:14px;font-size:14.5px;color:var(--mp-body)}
  .sbb .method p{margin:10px 0}
  .sbb .method b{color:var(--mp-ink)}
  .sbb .disclose{margin-top:16px;padding:14px 16px;border-left:3px solid var(--mp-navy);background:var(--mp-wash);border-radius:0;font-size:14px;color:var(--mp-body)}
  .sbb .disclose b{color:var(--mp-ink)}
  .sbb footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--mp-line);font-size:12.5px;color:var(--mp-muted)}
  .sbb footer b{color:var(--mp-body)}
  .sbb footer a{color:var(--mp-navy);text-decoration:underline;text-underline-offset:2px;word-break:break-all}
  @media (max-width:560px){ .sbb h1{font-size:27px} .sbb .headline{gap:16px} }
  @media print{
    [data-mp-chrome]{display:none!important}
    .mp-site,html body{background:#fff}
    .sbb .tablewrap{overflow:visible}
    .sbb .pctwrap .bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style>
</head>
<body>
${mpRawBodyOpen()}
<div class="sbb wrap">
  <header class="masthead">
    <div class="inst"><span class="dot"></span>The Mindy Institute<span class="sub">· Procurement Observatory</span></div>
  </header>

  <section class="hero">
    <div class="kicker">Research · Benchmark</div>
    <h1>Small-Business Participation Benchmark</h1>
    <p class="lede">Which federal buyers actually set aside their work for small business? This benchmark ranks agencies by the share of their <b>active</b> solicitations that carry a small-business set-aside — every figure an exact head-count.</p>
    <div class="meta">
      <span class="chip">Edition ${esc(edition)}</span>
      <span class="chip">${esc(version)}</span>
      <span class="chip">Live · computed ${esc(generatedDate)}</span>
      <span class="chip cite">Cites OBS-001</span>
    </div>
  </section>

  <div class="headline">
    <div class="stat"><div class="big">${fleetPct}</div><div class="lab">Government-wide participation</div></div>
    <div class="stat"><div class="big">${fmt(b.fleetActive)}</div><div class="lab">Active solicitations</div></div>
    <div class="stat"><div class="big">${fmt(b.fleetWithSetAside)}</div><div class="lab">Carry a set-aside</div></div>
    <div class="stat"><div class="big">${fmt(b.agenciesRanked)}</div><div class="lab">Agencies ranked (≥${b.minActive} active)</div></div>
  </div>

  <div class="disclose">
    <b>A live benchmark, not a frozen edition.</b> Every figure on this page is recomputed from current SAM.gov solicitation data each time the page loads, so the numbers change as solicitations open and close. The Institute has not yet built the stored snapshot that would make a fixed, reproducible edition. When citing a figure, cite the computed date shown above.
  </div>

  <h2>Ranked by active-solicitation volume</h2>
  <div class="tablewrap">
    <table>
      <thead><tr>
        <th class="rank">#</th><th>Buyer (department)</th>
        <th class="num">Active</th><th class="num">Set-aside</th><th>Participation</th>
      </tr></thead>
      <tbody>
${rowsHtml}
      </tbody>
    </table>
  </div>

  <div class="disclose">
    <b>Minimum-volume floor.</b> ${fmt(b.agenciesExcluded)} ${b.agenciesExcluded === 1 ? 'department is' : 'departments are'} excluded from this ranking for having fewer than ${b.minActive} active solicitations — a participation percentage computed on a handful of notices is statistical noise, not a signal, so it is left out rather than shown alongside the large buyers. Excluded ≠ hidden: they are simply below the threshold at which a rate is meaningful.
  </div>

  <h2>Methodology</h2>
  <div class="method">
    <p><b>What this measures.</b> For each federal department, the share of its currently-active SAM.gov solicitations that carry a small-business set-aside (any 8(a), HUBZone, SDVOSB, WOSB, or total/partial small-business designation). This is a measure of <b>opportunity set aside for small business</b>, not of dollars ultimately awarded.</p>
    <p><b>How it is computed.</b> Exact head-counts — for every department we count all active solicitations and, of those, how many carry a set-aside code. The percentage is that ratio. No sampling, no estimation. Departments are ranked by active-solicitation volume (market size), so the largest buyers anchor the list and a tiny high-percentage office cannot top it.</p>
    <p><b>Cited Observatory metric.</b> This benchmark is derived directly from one production metric in the Mindy Procurement Observatory: <b>OBS-001</b> (Small-business participation). A publication can only be as credible as the metrics it rests on; OBS-001 is at Production maturity.</p>
    <p><b>Limitations.</b> "Active" is a point-in-time snapshot of open solicitations as of the generated date — it is not a fiscal-year total and it is not award dollars. A set-aside on a solicitation is an intent to reserve, not a completed award. Agencies below the minimum-volume floor are excluded (see above).</p>
  </div>

  <h2>Corrections</h2>
  <div class="method">
    ${corrections.length === 0 ? '<p>No corrections.</p>' : corrections.map((c) => `<p><b>${esc(c.date)} · ${esc(c.version)}.</b> ${esc(c.note)}</p>`).join('')}
  </div>

  <footer>
    <p>Published by <b>The Mindy Institute</b>: independent research and measurement of the public procurement economy. The Institute is operated by GovCon Giants AI, which also makes Mindy, the data engine that computes this benchmark. It follows the <a href="/research/standard">Mindy Institute Research Standard v1</a>. Figures are grounded in live federal solicitation data; this page regenerates from the current data each time it is loaded. Permanent URL: <a href="${esc(canonical)}">${esc(canonical)}</a></p>
    <p>Edition ${esc(edition)} · ${esc(version)} · computed ${esc(generatedDate)}. To cite: "Small-Business Participation Benchmark, Edition ${esc(edition)}, The Mindy Institute (OBS-001), computed ${esc(generatedDate)}."</p>
  </footer>
</div>
${mpRawBodyClose()}
</body>
</html>`;
}
