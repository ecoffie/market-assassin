/**
 * Mindy Institute — Transaction Study 001: Halvik / Tetra Tech (DRAFT, not registered as published).
 *
 * A FROZEN historical study, not a live benchmark. Every federal figure comes from
 * `halvik-tetra-tech.data.json`, built once from a USASpending custom award download and frozen at the
 * as-of date 2026-01-21 (the day before Tetra Tech announced the acquisition). It must NEVER regenerate
 * from live data: a live query would pull in actions dated after the cutoff and silently rewrite history.
 *
 * Rules this renderer is held to (asserted by halvik-tetra-tech-html.unit.test.ts):
 *  - obligations are PUBLIC FEDERAL OBLIGATIONS, never revenue;
 *  - ceiling is ceiling, never backlog;
 *  - SP Systems (affiliate) is reported separately, never added to Halvik's totals;
 *  - anything Tetra Tech disclosed after the cutoff sits in a "Subsequently reported" block and is never
 *    used in the reconstruction;
 *  - no eligibility / legal consequence is stated.
 *
 * Publication = add a registry entry (research-publications.ts) with status 'published' and this slug.
 * Until then /research/halvik-tetra-tech returns 404 (publishedBySlug gates it).
 */
import data from './halvik-tetra-tech.data.json';
import { TRANSACTION, HISTORY, RECONCILIATION, STUDY_META } from './halvik-tetra-tech.facts';
import { mpRawBodyClose, mpRawBodyOpen, mpRawHeadHtml } from '@/lib/public-site/html';

export const HALVIK_STUDY_SLUG = 'halvik-tetra-tech';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** $724.7M style, for prose and tiles. */
export function usdM(n: number, digits = 1): string {
  return `$${(n / 1e6).toFixed(digits)}M`;
}
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (s: number) => `${(s * 100).toFixed(1)}%`;

const AGENCY_SHORT: Record<string, string> = {
  'Department of Defense': 'Defense',
  'Department of Transportation': 'Transportation',
  'Department of Commerce': 'Commerce',
  'National Aeronautics and Space Administration': 'NASA',
  'Department of the Treasury': 'Treasury',
  'Federal Communications Commission': 'FCC',
};

const VEHICLE_NAME: Record<string, string> = {
  '693JJ319A000013': 'DOT SWES BPA',
  '47QRAD20D8115': 'GSA OASIS SB Pool 1 — 8(a) subpool',
  W52P1J18DA078: 'Army ITES-3S',
  '1333BJ21D00280002': 'USPTO IDIQ (partial small-business set-aside)',
  '47QRAD20D1046': 'GSA OASIS SB Pool 1',
  '(standalone)': 'Standalone contracts (no parent vehicle)',
  N0017819D7751: 'Navy SeaPort-NxG',
  GS35F328BA: 'GSA Schedule 70 / MAS',
};

/** One horizontal single-series bar row (magnitude). Values are direct-labeled; a table follows each chart. */
function hbar(label: string, value: number, max: number, valueLabel: string, title: string): string {
  const w = max > 0 ? Math.max(0.5, (Math.max(0, value) / max) * 100) : 0;
  return `<div class="hb" title="${esc(title)}"><span class="hb-l">${esc(label)}</span><span class="hb-t"><span class="hb-f" style="width:${w.toFixed(2)}%"></span></span><span class="hb-v">${esc(valueLabel)}</span></div>`;
}

/** Vertical single-series column chart of annual obligations (one axis, one hue). */
function annualChart(): string {
  const rows = data.annual_obligations;
  const max = Math.max(...rows.map((r) => r.obligations));
  const cols = rows
    .map((r) => {
      const h = Math.max(0.6, (r.obligations / max) * 100);
      const lab = r.obligations >= 1e6 ? `${(r.obligations / 1e6).toFixed(0)}` : `${(r.obligations / 1e6).toFixed(1)}`;
      return `<div class="col${r.partial ? ' partial' : ''}" title="FY${r.fy}${r.partial ? ' (Oct 1, 2025 – Jan 21, 2026 only)' : ''}: ${usd(r.obligations)}">
        <span class="col-v">${lab}</span><span class="col-b" style="height:${h.toFixed(2)}%"></span><span class="col-x">${String(r.fy).slice(2)}</span></div>`;
    })
    .join('');
  return `<figure class="fig">
    <figcaption><b>Figure 1. Halvik's public federal obligations by fiscal year ($ millions).</b> Prime contract obligations only; net of de-obligations. FY2026 is partial (Oct 1, 2025 – Jan 21, 2026) and is shaded lighter.</figcaption>
    <div class="cols" role="img" aria-label="Annual public federal obligations to Halvik, FY2014 to FY2026 partial">${cols}</div>
    <p class="src">Source: USASpending.gov prime award transactions for UEI VMRTJLWMQRH7, retrieved ${esc(data.source.retrieved)}; actions dated and reported on or before ${esc(data.as_of)}. Measurement: sum of federal action obligations by federal fiscal year of the action date. Not revenue.</p>
  </figure>`;
}

function annualTable(): string {
  const body = data.annual_obligations
    .map((r) => `<tr><td>FY${r.fy}${r.partial ? ' (partial)' : ''}</td><td class="num">${usd(r.obligations)}</td></tr>`)
    .join('');
  return `<details class="tbl"><summary>Table view — annual obligations</summary><div class="tablewrap"><table><thead><tr><th>Fiscal year</th><th class="num">Public federal obligations</th></tr></thead><tbody>${body}</tbody></table></div></details>`;
}

function agencyFigure(): string {
  const rows = data.agencies_lifetime.slice(0, 6);
  const max = rows[0].obligations;
  const other = data.obligations_through_cutoff - rows.reduce((s, r) => s + r.obligations, 0);
  const bars = rows
    .map((r) => hbar(AGENCY_SHORT[r.agency] ?? r.agency, r.obligations, max, `${usdM(r.obligations)} · ${pct(r.share)}`, `${r.agency}: ${usd(r.obligations)}`))
    .join('');
  const ttm = data.ttm.agencies
    .map((r) => `<tr><td>${esc(r.agency)}</td><td class="num">${usd(r.obligations)}</td><td class="num">${pct(r.share)}</td></tr>`)
    .join('');
  return `<figure class="fig">
    <figcaption><b>Figure 2. Obligations by awarding department, FY2014 through ${esc(data.as_of)}.</b> Top six shown; ${data.agencies_lifetime.length - 6} other departments together account for ${usdM(other)}.</figcaption>
    <div class="hbars">${bars}</div>
    <p class="src">Source and as-of: as Figure 1. Definition: department of the awarding agency on each action.</p>
  </figure>
  <details class="tbl"><summary>Table view — trailing twelve months (${esc(data.ttm.window.replace('..', ' to '))}): ${usd(data.ttm.obligations)}</summary><div class="tablewrap"><table><thead><tr><th>Department</th><th class="num">Obligations</th><th class="num">Share</th></tr></thead><tbody>${ttm}</tbody></table></div></details>`;
}

function setAsideFigure(): string {
  const rows = data.set_aside_family;
  const max = rows[0].obligations;
  const bars = rows
    .map((r) => hbar(r.family, r.obligations, max, `${usdM(r.obligations)} · ${pct(r.share)}`, `${r.family}: ${r.contracts} contracts and orders, ${usd(r.obligations)}`))
    .join('');
  const tbl = rows
    .map((r) => `<tr><td>${esc(r.family)}</td><td class="num">${r.contracts}</td><td class="num">${usd(r.obligations)}</td><td class="num">${pct(r.share)}</td></tr>`)
    .join('');
  return `<figure class="fig">
    <figcaption><b>Figure 3. Obligations by set-aside basis of the award, FY2014 through ${esc(data.as_of)}.</b> ${data.counts.contracts_admissible} contracts and orders. A further ${usd(data.vehicle_level_obligations.amount)} was obligated directly on the OASIS+ vehicle rather than on an order.</figcaption>
    <div class="hbars">${bars}</div>
    <p class="src">Definition: the set-aside recorded on the contract or order itself; when that field is blank (common on orders), the set-aside recorded on its parent vehicle. A set-aside basis describes how the award was competed. It says nothing about eligibility after the acquisition.</p>
  </figure>
  <details class="tbl"><summary>Table view — set-aside basis</summary><div class="tablewrap"><table><thead><tr><th>Basis</th><th class="num">Awards</th><th class="num">Obligations</th><th class="num">Share</th></tr></thead><tbody>${tbl}</tbody></table></div></details>`;
}

function vehicleTable(): string {
  const body = data.vehicles_top
    .map((v) => `<tr><td>${esc(VEHICLE_NAME[v.vehicle] ?? v.vehicle)}${v.vehicle.startsWith('(') ? '' : ` <span class="id">${esc(v.vehicle)}</span>`}</td><td class="num">${v.orders}</td><td class="num">${usd(v.obligations)}</td><td class="num">${pct(v.share)}</td></tr>`)
    .join('');
  return `<div class="tablewrap"><table><thead><tr><th>Vehicle (parent award)</th><th class="num">Orders</th><th class="num">Obligations</th><th class="num">Share</th></tr></thead><tbody>${body}</tbody></table></div>
  <p class="src">Eight largest channels by obligations through ${esc(data.as_of)}. Vehicle ceilings are program-wide and are not attributable to Halvik, so none is shown.</p>`;
}

function topAwardsTable(): string {
  const body = data.top_awards
    .slice(0, 5)
    .map((a) => `<tr><td><span class="id">${esc(a.piid)}</span></td><td>${esc(a.sub)}</td><td class="num">${usd(a.obligated)}</td><td class="num">${usd(a.ceiling)}</td><td>${esc(a.pop_current_end ?? 'not reported')}</td></tr>`)
    .join('');
  return `<div class="tablewrap"><table><thead><tr><th>Award</th><th>Buyer</th><th class="num">Obligated to cutoff</th><th class="num">Ceiling to cutoff</th><th>Current end at cutoff</th></tr></thead><tbody>${body}</tbody></table></div>
  <p class="src">Ceiling = base plus all options, summed from the option value recorded on each action dated and reported by the cutoff. Ceiling is the maximum the government had authorized; it is not backlog and not expected revenue.</p>`;
}

function reconciliationTable(): string {
  const body = RECONCILIATION.map(
    (r) => `<tr><td>${esc(r.claim)}</td><td>${esc(r.source)}</td><td>${esc(r.record)}</td><td class="res res-${r.status}">${esc(r.result)}</td></tr>`,
  ).join('');
  return `<div class="tablewrap"><table class="recon"><thead><tr><th>Public assertion</th><th>Source</th><th>Federal record at cutoff</th><th>Result</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderHalvikStudyHtml(opts: { canonical: string; draft: boolean }): string {
  const { canonical, draft } = opts;
  const d = data;
  const smallShare = 1 - (d.set_aside_family.find((r) => r.family === 'No set-aside')?.share ?? 0) - (d.set_aside_family.find((r) => r.family === 'Not recorded')?.share ?? 0);
  const fy17 = d.annual_obligations.find((r) => r.fy === 2017)!.obligations;
  const fy25 = d.annual_obligations.find((r) => r.fy === 2025)!.obligations;
  const desc = STUDY_META.description;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(STUDY_META.title)} — The Mindy Institute</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(STUDY_META.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="robots" content="${draft ? 'noindex,nofollow' : 'index,follow'}">
${mpRawHeadHtml()}
<style>
  html{-webkit-text-size-adjust:100%}
  body{margin:0;line-height:1.6;font-size:16px}
  .ts.wrap{max-width:860px;margin:0 auto;padding:0 18px 24px;color:var(--mp-ink)}
  .ts header.masthead{border-bottom:1px solid var(--mp-line);padding:22px 0 18px}
  .ts .inst{display:flex;align-items:center;gap:9px;font-family:var(--mp-font-serif);font-weight:700;color:var(--mp-ink)}
  .ts .inst .dot{width:9px;height:9px;background:var(--mp-accent)}
  .ts .inst .sub{font-family:var(--mp-font-sans);font-weight:600;color:var(--mp-muted);font-size:12px;letter-spacing:.12em;text-transform:uppercase}
  .ts .draftbar{margin:14px 0 0;padding:10px 14px;border:1px solid var(--mp-line);border-left:3px solid var(--mp-accent);background:var(--mp-wash);font-size:13.5px;color:var(--mp-body)}
  .ts .hero{padding:30px 0 6px}
  .ts .kicker{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--mp-accent)}
  .ts h1{font:700 34px/1.18 var(--mp-font-serif);margin:10px 0 8px;letter-spacing:-.012em;text-wrap:balance}
  .ts .subhead{font:400 19px/1.5 var(--mp-font-serif);color:var(--mp-body);margin:0}
  .ts .meta{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 4px}
  .ts .chip{font-size:12px;color:var(--mp-body);background:var(--mp-wash);border:1px solid var(--mp-line);border-radius:var(--mp-radius-chip);padding:3px 9px;font-weight:600}
  .ts .headline{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:18px;margin:24px 0 6px;padding:18px 20px;border:1px solid var(--mp-line);background:var(--mp-surface)}
  .ts .headline .big{font:600 27px/1.1 var(--mp-font-mono);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
  .ts .headline .lab{font-size:12.5px;color:var(--mp-muted);margin-top:4px}
  .ts h2{font:700 22px/1.3 var(--mp-font-serif);margin:44px 0 10px;color:var(--mp-ink)}
  .ts h2 .n{font-family:var(--mp-font-mono);font-size:13px;color:var(--mp-muted);margin-right:8px;font-weight:500}
  .ts p{margin:12px 0;color:var(--mp-body)}
  .ts p b,.ts li b{color:var(--mp-ink)}
  .ts ul,.ts ol{color:var(--mp-body);padding-left:22px}
  .ts li{margin:6px 0}
  .ts .finding{border-left:3px solid var(--mp-navy);background:var(--mp-wash);padding:14px 18px;margin:16px 0}
  .ts .finding ol{margin:6px 0 0}
  .ts .later{border:1px dashed var(--mp-line);padding:14px 18px;margin:18px 0;background:var(--mp-surface)}
  .ts .later .tag{font-family:var(--mp-font-mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mp-muted)}
  .ts .fig{margin:22px 0 8px;padding:0}
  .ts figcaption{font-size:14px;color:var(--mp-body);margin-bottom:12px}
  .ts .src{font-size:12.5px;color:var(--mp-muted);margin:8px 0 0}
  .ts .cols{display:flex;align-items:flex-end;gap:4px;height:220px;border-bottom:1px solid var(--mp-line);padding-top:18px}
  .ts .col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
  .ts .col-b{width:100%;max-width:38px;background:var(--mp-navy);border-radius:4px 4px 0 0}
  .ts .col.partial .col-b{opacity:.45}
  .ts .col-v{font:500 11px var(--mp-font-mono);color:var(--mp-body);margin-bottom:4px;font-variant-numeric:tabular-nums}
  .ts .col-x{font:500 11px var(--mp-font-mono);color:var(--mp-muted);margin-top:6px;position:relative;top:22px;height:0}
  .ts .cols + .src{margin-top:38px}
  .ts .hbars{display:flex;flex-direction:column;gap:8px}
  .ts .hb{display:grid;grid-template-columns:minmax(110px,190px) 1fr auto;gap:10px;align-items:center;font-size:14px}
  .ts .hb-l{color:var(--mp-ink);font-weight:600}
  .ts .hb-t{height:12px;background:var(--mp-hair);position:relative}
  .ts .hb-f{display:block;height:100%;background:var(--mp-navy);border-radius:0 4px 4px 0}
  .ts .hb-v{font:500 12.5px var(--mp-font-mono);color:var(--mp-body);font-variant-numeric:tabular-nums;white-space:nowrap}
  .ts .tablewrap{overflow-x:auto;border:1px solid var(--mp-line);background:var(--mp-surface);margin-top:10px}
  .ts table{border-collapse:collapse;width:100%;min-width:560px}
  .ts table.recon{min-width:720px}
  .ts th,.ts td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--mp-hair);font-size:13.5px;vertical-align:top}
  .ts th{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--mp-muted);font-weight:600;background:var(--mp-wash)}
  .ts td.num,.ts th.num{text-align:right;font-family:var(--mp-font-mono);font-variant-numeric:tabular-nums;white-space:nowrap}
  .ts .id{font-family:var(--mp-font-mono);font-size:12px;color:var(--mp-muted)}
  .ts td.res{font-weight:600;color:var(--mp-ink)}
  .ts details.tbl{margin:10px 0 0;font-size:14px}
  .ts details.tbl summary{cursor:pointer;color:var(--mp-navy);font-weight:600}
  .ts .cannot{columns:2;column-gap:28px}
  .ts .cannot li{break-inside:avoid}
  .ts footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--mp-line);font-size:12.5px;color:var(--mp-muted)}
  .ts footer a{color:var(--mp-navy);word-break:break-all}
  .ts .sources li{font-size:13.5px;word-break:break-word}
  @media (max-width:600px){ .ts h1{font-size:27px} .ts .cannot{columns:1} .ts .hb{grid-template-columns:1fr auto} .ts .hb-t{grid-column:1 / -1;grid-row:2} .ts .col-v{font-size:9px} }
  @media print{ [data-mp-chrome]{display:none!important} .ts .tablewrap{overflow:visible} .ts details.tbl{display:block} .ts .col-b,.ts .hb-f{-webkit-print-color-adjust:exact;print-color-adjust:exact} }
</style>
</head>
<body>
${mpRawBodyOpen()}
<article class="ts wrap">
  <header class="masthead">
    <div class="inst"><span class="dot"></span>The Mindy Institute<span class="sub">· Transaction Studies</span></div>
    ${draft ? '<div class="draftbar"><b>Draft for internal review.</b> Not published. Figures are final as computed; wording is pending sign-off.</div>' : ''}
  </header>

  <section class="hero">
    <div class="kicker">${esc(STUDY_META.kicker)}</div>
    <h1>${esc(STUDY_META.title)}</h1>
    <p class="subhead">${esc(STUDY_META.subhead)}</p>
    <div class="meta">
      <span class="chip">Historical cutoff ${esc(d.as_of)}</span>
      <span class="chip">${esc(STUDY_META.version)}</span>
      <span class="chip">Published ${esc(STUDY_META.publishedDate)}</span>
      <span class="chip">Data retrieved ${esc(d.source.retrieved)}</span>
    </div>
  </section>

  <div class="headline">
    <div><div class="big">${d.counts.awards_admissible}</div><div class="lab">prime awards and vehicles in the federal record by ${esc(d.as_of)}</div></div>
    <div><div class="big">${usdM(d.obligations_through_cutoff)}</div><div class="lab">cumulative public federal obligations, FY2014 to cutoff</div></div>
    <div><div class="big">${pct(smallShare)}</div><div class="lab">of those obligations ran through small-business or 8(a) set-aside awards</div></div>
    <div><div class="big">${usdM(d.ttm.obligations)}</div><div class="lab">obligations in the 12 months before the announcement</div></div>
  </div>

  <h2><span class="n">1</span>Executive finding</h2>
  <div class="finding">
    <p>${STUDY_META.executive}</p>
    <ol>${STUDY_META.findings.map((f) => `<li>${f}</li>`).join('')}</ol>
  </div>
  <p>This study measures the <b>public federal prime-contract record</b>. It does not measure revenue, backlog, profit or value, and it does not say what the acquisition means for any contract's eligibility. Section 7 lists what the public record cannot establish.</p>

  <h2><span class="n">2</span>The transaction</h2>
  ${TRANSACTION.prose}
  <div class="later"><span class="tag">Subsequently reported — not used in the reconstruction</span>${TRANSACTION.subsequent}</div>

  <h2><span class="n">3</span>Halvik's federal trajectory</h2>
  ${HISTORY.prose}
  <p>Public obligations to Halvik rose from ${usdM(fy17)} in FY2017 to ${usdM(fy25)} in FY2025. The first prime action in the record is dated ${esc(d.counts.first_action_date)}. Obligations are amounts the government committed on Halvik's prime awards in each year. They are <b>not</b> Halvik's revenue: revenue is recognized as work is performed and also includes subcontract and any commercial work.</p>
  ${annualChart()}
  ${annualTable()}

  <h2><span class="n">4</span>The portfolio at acquisition</h2>
  <p>By ${esc(d.as_of)} the record holds <b>${d.counts.awards_admissible} Halvik prime awards</b>: ${d.counts.contracts_admissible} contracts and task orders, and ${d.counts.vehicles_admissible} contract vehicles (IDIQs, BPAs, GWACs and GSA Schedules) under which orders can be placed. ${d.active.count} contracts and orders had a recorded period of performance running past the cutoff. Together they carried ${usdM(d.active.obligated)} obligated against a ${usdM(d.active.ceiling)} ceiling.</p>
  <p><b>Buyers.</b> Four departments account for ${pct(d.agencies_lifetime.slice(0, 4).reduce((s, r) => s + r.share, 0))} of cumulative obligations. In the trailing twelve months the mix was Defense ${pct(d.ttm.agencies[0].share)}, Transportation ${pct(d.ttm.agencies[1].share)}, NASA ${pct(d.ttm.agencies[2].share)} and Commerce ${pct(d.ttm.agencies[3].share)}.</p>
  ${agencyFigure()}
  <p><b>Channels.</b> Most of the money came through a few vehicles. The five largest channels carried ${pct(d.vehicles_top.slice(0, 5).reduce((s, r) => s + r.share, 0))} of obligations.</p>
  ${vehicleTable()}
  <p><b>Concentration.</b> The single largest award, NASA's IT Support Services order, holds ${pct(d.concentration.top1)} of cumulative obligations. The five largest hold ${pct(d.concentration.top5)} and the ten largest ${pct(d.concentration.top10)}.</p>
  ${topAwardsTable()}
  <p><b>Set-aside history.</b> ${pct(smallShare)} of obligations flowed through awards competed or placed under a small-business, 8(a) or women-owned small-business set-aside. ${pct(d.set_aside_family.find((r) => r.family === 'No set-aside')!.share)} came through awards recorded with no set-aside.</p>
  ${setAsideFigure()}

  <h2><span class="n">5</span>What Halvik said, and what the federal record shows</h2>
  <p>We compiled the vehicles and awards Halvik, its customers and the press named in public, and checked each against the record as it stood at the cutoff. A match means the named instrument is held by Halvik's UEI. It does not validate any dollar figure the claim attached.</p>
  ${reconciliationTable()}
  <p class="src">Unresolved stays unresolved. Where a claim names no contract number and the record holds more than one plausible award, we do not pick one.</p>

  <h2><span class="n">6</span>What the public record flags for diligence</h2>
  <p>These are observations a diligence team would want explained. None is a conclusion about value, risk or eligibility.</p>
  <ul>${STUDY_META.flags.map((f) => `<li>${f}</li>`).join('')}</ul>
  <p><b>Set-aside exposure.</b> The record shows which awards were competed or placed under a set-aside, and which carry an 8(a) basis. This study identifies that exposure but does not determine the post-acquisition eligibility consequence. That depends on facts the public record does not contain: the closing date, the legal structure, the acquirer's size under each award's NAICS code, any recertifications, and SBA decisions.</p>

  <h2><span class="n">7</span>What we cannot know from public data</h2>
  <p>Public award data does not establish any of the following. Treat any figure in this study as silent on them.</p>
  <ul class="cannot">
    <li>Recognized revenue</li><li>Financial backlog or funded/unfunded backlog</li><li>Profitability, margins or EBITDA</li><li>Commercial or non-federal revenue</li>
    <li>Complete subcontract revenue (only ${d.counts.subawards_as_sub_by_cutoff} prime-reported subawards to Halvik or SP Systems appear, and subaward reporting is incomplete by nature)</li>
    <li>Past-performance ratings (CPARS)</li><li>Indirect rates or cost structure</li><li>Classified work</li><li>Employee counts or retention</li>
    <li>Pending proposals and win rates</li><li>Why Tetra Tech paid what it paid</li>
  </ul>

  <h2><span class="n">8</span>Why this case matters</h2>
  <p class="src" style="font-size:13px;margin-top:0">Interpretation — separate from the measurements above.</p>
  ${STUDY_META.whyItMatters}

  <h2><span class="n">9</span>Methodology</h2>
  <p><b>Entity.</b> HALVIK, LLC, UEI ${esc(d.uei)}, CAGE ${esc(d.cage)}. The names "Halvik Corp", "Halvik" and "HALVIK, LLC" and the CAGE code each resolve to this single UEI. SP Systems, Inc. (UEI ${esc(d.affiliate_sp_systems.uei)}), which Halvik acquired in 2016, reports Halvik as its parent on 110 actions between 2016-08-04 and 2025-05-14. Its ${d.affiliate_sp_systems.awards} awards (${usdM(d.affiliate_sp_systems.obligations_through_cutoff)} obligated through the cutoff, most of it before 2016) are reported here separately and are <b>not</b> included in any Halvik figure.</p>
  <p><b>Source.</b> ${esc(d.source.name)}, file ${esc(d.source.file)}, retrieved ${esc(d.source.retrieved)}. The award listing returned ${d.counts.awards_listed} awards (223 contracts, 30 vehicles) and the transaction download contained every one of them.</p>
  <p><b>Historical cutoff.</b> ${esc(d.admissibility)} ${d.counts.actions_after_cutoff} later actions, including ${d.counts.awards_entirely_after_cutoff} awards that begin after the cutoff, and ${d.counts.actions_reported_after_cutoff} action reported after it, are excluded. Of ${d.counts.actions_total} Halvik actions, ${d.counts.actions_included} are included.</p>
  <p><b>Obligations</b> are the sum of the federal action obligation on each included action, net of de-obligations. <b>Ceiling</b> is the sum of the change in "base and all options value" on each included action. We do not use USASpending's award-level "potential total value" column: it is a snapshot that differs from row to row within the same award on 78 Halvik awards, so it cannot represent the value as of a past date. <b>Active</b> means the latest period-of-performance end date recorded by the cutoff is on or after the cutoff. <b>Set-aside basis</b> is the award's own set-aside field, or its parent vehicle's when blank (138 of 215 awards). <b>Fiscal year</b> is the federal fiscal year of the action date.</p>
  <p><b>Verification.</b> All figures were recomputed independently from the raw download file (SHA-256 <span class="id">${esc(d.source.csv_sha256.slice(0, 16))}…</span>) and agree to the cent with the register produced by Mindy's diligence pipeline. Federal data can be corrected after the fact; a re-download on a later date may differ slightly.</p>

  <h2><span class="n">10</span>Sources</h2>
  <ol class="sources">${STUDY_META.sources.map((s) => `<li>${s}</li>`).join('')}</ol>

  <h2><span class="n">11</span>Corrections and version</h2>
  <p>${esc(STUDY_META.version)}, published ${esc(STUDY_META.publishedDate)}. If a figure here is wrong, the correction will be published at this address with the date, the original statement and the corrected one. Corrections never remove the original text.</p>

  <footer>
    <p>Published by <b>The Mindy Institute</b>, the research arm of Mindy, operated by GovCon Giants AI. Mindy's diligence pipeline assembled the contract register; the analysis and every judgment in it are the Institute's. Permanent URL: <a href="${esc(canonical)}">${esc(canonical)}</a></p>
    <p>To cite: "${esc(STUDY_META.citation)}"</p>
  </footer>
</article>
${mpRawBodyClose()}
</body>
</html>`;
}
