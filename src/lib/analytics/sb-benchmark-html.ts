/**
 * Public HTML render for RES-003 — the Small-Business Participation Benchmark.
 *
 * This emits a COMPLETE, self-contained, Mindy-Institute-branded <!doctype html> document (the same
 * pattern as /reports/[id] — the route handler just returns this string). It is a PUBLIC research
 * artifact: SEO-indexed, citable, permanent URL. So the bar on honesty is absolute —
 *  - every number is the exact head-count the engine returned (no rounding of counts, one-decimal %),
 *  - the minimum-volume floor + the count of excluded agencies is DISCLOSED, not hidden,
 *  - the methodology (what was measured, over what, its limits) is stated plainly,
 *  - it CITES OBS-001 / OBS-002 by their permanent Observatory ids,
 *  - the edition + version + generated date are shown (the URL is permanent; the edition evolves).
 *
 * No external assets (CSP-clean): inline CSS, system fonts, no webfonts/CDN.
 */
import type { Benchmark, AgencyRow } from './sb-participation-benchmark';

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

export function renderSbBenchmarkHtml(b: Benchmark, opts: { edition: string; version: string; generatedDate: string; canonical: string }): string {
  const { edition, version, generatedDate, canonical } = opts;
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
<style>
  :root{
    --navy:#0b1f3a; --ink:#101828; --muted:#667085; --line:#e4e7ec; --bg:#ffffff;
    --accent:#7c3aed; --green:#059669; --chip:#f2f4f7; --track:#eef2f6;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    line-height:1.55;font-size:16px}
  .wrap{max-width:920px;margin:0 auto;padding:0 22px 80px}
  header.masthead{border-bottom:1px solid var(--line);padding:22px 0 18px;margin-bottom:8px}
  .inst{display:flex;align-items:center;gap:9px;font-weight:800;letter-spacing:.02em;color:var(--navy)}
  .inst .dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
  .inst .sub{font-weight:600;color:var(--muted);font-size:12.5px;letter-spacing:.06em;text-transform:uppercase}
  .hero{padding:34px 0 10px}
  .kicker{font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
  h1{font-size:34px;line-height:1.15;margin:8px 0 6px;letter-spacing:-.01em;color:var(--navy);text-wrap:balance}
  .lede{font-size:17px;color:#344054;max-width:680px;margin:6px 0 0}
  .meta{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 4px}
  .chip{font-size:12px;color:#344054;background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:3px 11px;font-weight:600}
  .chip.cite{background:#f5f0ff;border-color:#e6dbff;color:#5b2bb8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .headline{display:flex;gap:26px;flex-wrap:wrap;margin:26px 0 6px;padding:18px 20px;border:1px solid var(--line);border-radius:14px;background:#fafafb}
  .headline .stat{min-width:140px}
  .headline .big{font-size:30px;font-weight:800;color:var(--navy);font-variant-numeric:tabular-nums}
  .headline .lab{font-size:12.5px;color:var(--muted);margin-top:2px}
  h2{font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:38px 0 12px;font-weight:700}
  .tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px}
  table{border-collapse:collapse;width:100%;min-width:640px}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);font-size:14.5px}
  th{font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:700;background:#fcfcfd}
  tr:last-child td{border-bottom:none}
  td.rank{color:var(--muted);width:34px;font-variant-numeric:tabular-nums}
  td.dept{font-weight:600;color:var(--ink)}
  td.num{text-align:right;font-variant-numeric:tabular-nums;color:#344054;width:120px}
  th.num{text-align:right}
  td.pct{width:220px}
  .pctwrap{position:relative;display:flex;align-items:center;gap:10px}
  .pctwrap .bar{height:9px;border-radius:5px;background:linear-gradient(90deg,#7c3aed,#059669);min-width:2px}
  .pctval{font-weight:700;font-variant-numeric:tabular-nums;color:var(--navy);white-space:nowrap}
  .method{margin-top:14px;font-size:14.5px;color:#475467}
  .method p{margin:10px 0}
  .method b{color:var(--ink)}
  .disclose{margin-top:16px;padding:14px 16px;border-left:3px solid var(--accent);background:#faf8ff;border-radius:0 10px 10px 0;font-size:14px;color:#475467}
  footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}
  footer a{color:var(--accent);text-decoration:none}
  @media (max-width:560px){ h1{font-size:27px} .headline{gap:16px} }
</style>
</head>
<body>
<div class="wrap">
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
      <span class="chip">Generated ${esc(generatedDate)}</span>
      <span class="chip cite">Cites OBS-001</span>
      <span class="chip cite">Cites OBS-002</span>
    </div>
  </section>

  <div class="headline">
    <div class="stat"><div class="big">${fleetPct}</div><div class="lab">Government-wide participation</div></div>
    <div class="stat"><div class="big">${fmt(b.fleetActive)}</div><div class="lab">Active solicitations</div></div>
    <div class="stat"><div class="big">${fmt(b.fleetWithSetAside)}</div><div class="lab">Carry a set-aside</div></div>
    <div class="stat"><div class="big">${fmt(b.agenciesRanked)}</div><div class="lab">Agencies ranked (≥${b.minActive} active)</div></div>
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
    <p><b>Cited Observatory metrics.</b> This benchmark is derived directly from two production metrics in the Mindy Procurement Observatory: <b>OBS-001</b> (Small-business participation) and <b>OBS-002</b> (Awarded set-aside mix). A publication can only be as credible as the metrics it rests on; both are at Production maturity.</p>
    <p><b>Limitations.</b> "Active" is a point-in-time snapshot of open solicitations as of the generated date — it is not a fiscal-year total and it is not award dollars. A set-aside on a solicitation is an intent to reserve, not a completed award. Agencies below the minimum-volume floor are excluded (see above).</p>
  </div>

  <footer>
    <p>Published by <b>The Mindy Institute</b> — the research arm of Mindy, operated by GovCon Giants AI. Figures are grounded in live federal solicitation data; this page regenerates from the current data each time it is loaded. Permanent URL: <a href="${esc(canonical)}">${esc(canonical)}</a></p>
    <p>Edition ${esc(edition)} · ${esc(version)} · generated ${esc(generatedDate)}. To cite: "Small-Business Participation Benchmark, Edition ${esc(edition)}, The Mindy Institute (OBS-001, OBS-002)."</p>
  </footer>
</div>
</body>
</html>`;
}
