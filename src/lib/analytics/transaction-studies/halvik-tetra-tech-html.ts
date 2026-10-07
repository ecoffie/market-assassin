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
 * Registered as RES-004 in research-publications.ts; version, publish date and corrections are read from
 * there. /research/halvik-tetra-tech serves only while that entry's status is 'published'.
 */
import data from './halvik-tetra-tech.data.json';
import { TRANSACTION, HISTORY, RECONCILIATION, STUDY_META, KIND_LABEL, type StatementKind } from './halvik-tetra-tech.facts';
import { PUBLICATIONS, RESEARCH_STANDARD } from '@/lib/analytics/research-publications';
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


function kindTag(k: StatementKind): string {
  return `<span class="kind">${esc(KIND_LABEL[k])}</span>`;
}

/** Version, dates and corrections come from the publications registry, so the page cannot disagree with it. */
function registryEntry() {
  const pub = PUBLICATIONS.find((p) => p.slug === HALVIK_STUDY_SLUG);
  if (!pub) throw new Error('Transaction Study 001 is missing from the publications registry');
  return pub;
}

function knowBox(): string {
  const can = STUDY_META.canEstablish.map(([c, st]) => `<li>${esc(c)}<span class="st">${esc(st)}</span></li>`).join('');
  const cannot = STUDY_META.cannotEstablish.map((c) => `<li>${esc(c)}</li>`).join('');
  return `<section class="know" aria-label="What the public record can and cannot establish">
    <div class="can"><h3>What the public record can establish</h3><ul>${can}</ul></div>
    <div class="cannot-box"><h3>What the public record cannot establish</h3><ul>${cannot}</ul></div>
  </section>`;
}

export function renderHalvikStudyHtml(opts: { canonical: string; draft: boolean }): string {
  const { canonical, draft } = opts;
  const d = data;
  const pub = registryEntry();
  const version = pub.version ?? 'v1.0';
  const published = draft ? 'not yet published' : (pub.publishedDate ?? 'not yet published');
  const corrections = pub.corrections ?? [];
  const smallShare = 1 - (d.set_aside_family.find((r) => r.family === 'No set-aside')?.share ?? 0) - (d.set_aside_family.find((r) => r.family === 'Not recorded')?.share ?? 0);
  const fy17 = d.annual_obligations.find((r) => r.fy === 2017)!.obligations;
  const fy25 = d.annual_obligations.find((r) => r.fy === 2025)!.obligations;
  const desc = STUDY_META.description;
  const citation = `The Federal Portfolio Behind a $210 Million Acquisition: Halvik / Tetra Tech. Mindy Institute Transaction Study 001, ${version}, published ${published}; historical cutoff January 21, 2026. ${canonical}`;

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
  .ts .kind{display:inline-block;font:600 10.5px/1.4 var(--mp-font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--mp-navy);border:1px solid var(--mp-line);background:var(--mp-surface);padding:1px 6px;margin-right:6px;vertical-align:1px;white-space:nowrap}
  .ts .seckind{margin:-2px 0 8px}
  .ts .legend{font-size:13px;color:var(--mp-muted)}
  .ts .know{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--mp-line);margin:22px 0 8px}
  .ts .know > div{padding:16px 18px}
  .ts .know .can{background:var(--mp-surface)}
  .ts .know .cannot-box{background:var(--mp-wash);border-left:1px solid var(--mp-line)}
  .ts .know h3{font:700 11px var(--mp-font-sans);letter-spacing:.14em;text-transform:uppercase;color:var(--mp-ink);margin:0 0 8px}
  .ts .know ul{margin:0;padding-left:18px}
  .ts .know li{font-size:14px;margin:7px 0}
  .ts .know .st{display:block;font:500 11.5px/1.4 var(--mp-font-mono);color:var(--mp-muted)}
  .ts .meth h3{font:700 15px var(--mp-font-sans);margin:22px 0 2px;color:var(--mp-ink)}
  .ts .meth p{margin:6px 0 10px}
  .ts .srckind{font:600 11px var(--mp-font-mono);color:var(--mp-muted);text-transform:uppercase;letter-spacing:.05em;margin-right:6px}
  @media (max-width:600px){ .ts .know{grid-template-columns:1fr} .ts .know .cannot-box{border-left:0;border-top:1px solid var(--mp-line)} }
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
      <span class="chip">${esc(version)}</span>
      <span class="chip">${draft ? 'Not yet published' : `Published ${esc(published)}`}</span>
      <span class="chip">Historical cutoff ${esc(d.as_of)}</span>
      <span class="chip">Measured ${esc(STUDY_META.measuredOn)}</span>
      <a class="chip" href="${RESEARCH_STANDARD.url}">Research Standard ${esc(RESEARCH_STANDARD.version)}</a>
    </div>
  </section>

  <div class="headline">
    <div><div class="big">${d.counts.awards_admissible}</div><div class="lab">prime awards and contract vehicles in the federal record by ${esc(d.as_of)}</div></div>
    <div><div class="big">${usdM(d.obligations_through_cutoff)}</div><div class="lab">cumulative public federal obligations, FY2014 to cutoff</div></div>
    <div><div class="big">${pct(smallShare)}</div><div class="lab">of those obligations associated with awards recorded under small-business, 8(a) or WOSB set-aside classifications</div></div>
    <div><div class="big">${usdM(d.ttm.obligations)}</div><div class="lab">obligations in the 12 months before the cutoff</div></div>
  </div>

  ${knowBox()}

  <h2><span class="n">1</span>Executive finding</h2>
  <div class="finding">
    <p>${STUDY_META.executive}</p>
    <ol>${STUDY_META.findings.map((f) => `<li>${kindTag(f.kind)}${f.html}</li>`).join('')}</ol>
  </div>
  <p class="legend">Labels follow <a href="${RESEARCH_STANDARD.url}#p6">Research Standard principle 6</a>. A <b>federal fact</b> is what a public record says. A <b>derived measure</b> is a number this study computed from those records, using the method in section 9. An <b>interpretation</b> is what we think it may mean. A <b>company filing</b> is what a company disclosed about itself.</p>
  <p>This study measures the <b>public federal prime-contract record</b>. It does not measure revenue, backlog, profit or value, and it does not determine what the acquisition means for any contract's eligibility.</p>

  <h2><span class="n">2</span>The transaction</h2>
  <p class="seckind">${kindTag('filing')}</p>
  ${TRANSACTION.prose}
  <div class="later"><span class="tag">Subsequently reported — not used in the reconstruction</span>${TRANSACTION.subsequent}</div>

  <h2><span class="n">3</span>Halvik's federal trajectory</h2>
  <p class="seckind">${kindTag('fact')}${kindTag('derived')}</p>
  ${HISTORY.prose}
  <p>Public obligations to Halvik rose from ${usdM(fy17)} in FY2017 to ${usdM(fy25)} in FY2025. The first prime action in the record is dated ${esc(d.counts.first_action_date)}. Obligations are the amounts the government committed on Halvik's prime awards in each year. They are <b>not</b> Halvik's revenue: revenue is recognized as work is performed, and it also includes subcontract and any commercial work.</p>
  ${annualChart()}
  ${annualTable()}

  <h2><span class="n">4</span>The portfolio at the cutoff</h2>
  <p class="seckind">${kindTag('derived')}</p>
  <p>By ${esc(d.as_of)} the record holds <b>${d.counts.awards_admissible} Halvik prime awards</b>: ${d.counts.contracts_admissible} contracts and task orders, and ${d.counts.vehicles_admissible} contract vehicles (IDIQs, BPAs, GWACs and GSA Schedules) under which orders can be placed. ${d.active.count} contracts and orders had a recorded period of performance running past the cutoff. Together they carried ${usdM(d.active.obligated)} obligated against a ${usdM(d.active.ceiling)} ceiling. Ceiling is the maximum the government had authorized; it is not backlog.</p>
  <p><b>Buyers.</b> Of cumulative obligations (${usd(d.obligations_through_cutoff)}), four departments account for ${pct(d.agencies_lifetime.slice(0, 4).reduce((s, r) => s + r.share, 0))}. Of obligations in the twelve months before the cutoff (${usd(d.ttm.obligations)}), the mix was Defense ${pct(d.ttm.agencies[0].share)}, Transportation ${pct(d.ttm.agencies[1].share)}, NASA ${pct(d.ttm.agencies[2].share)} and Commerce ${pct(d.ttm.agencies[3].share)}.</p>
  ${agencyFigure()}
  <p><b>Channels.</b> Most obligations were on orders under a few vehicles. Orders under the five largest vehicles carried ${pct(d.vehicles_top.filter((v) => !v.vehicle.startsWith('(')).slice(0, 5).reduce((s, r) => s + r.share, 0))} of cumulative obligations.</p>
  ${vehicleTable()}
  <p><b>Concentration.</b> The single largest award, NASA's IT Support Services order, holds ${pct(d.concentration.top1)} of cumulative obligations. The five largest awards hold ${pct(d.concentration.top5)} and the ten largest ${pct(d.concentration.top10)}.</p>
  ${topAwardsTable()}
  <p><b>Set-aside classifications.</b> ${pct(smallShare)} of Halvik's cumulative public federal obligations through the cutoff were associated with awards recorded under small-business, 8(a) or WOSB set-aside classifications. ${pct(d.set_aside_family.find((r) => r.family === 'No set-aside')!.share)} were associated with awards recorded with no set-aside.</p>
  ${setAsideFigure()}

  <h2><span class="n">5</span>What Halvik said, and what the federal record shows</h2>
  <p class="seckind">${kindTag('fact')}</p>
  <p>We compiled the vehicles and awards that Halvik, its customers and the press named in public, and checked each against the record as it stood at the cutoff. "Found" means the named instrument is held by Halvik's UEI. It does not validate any dollar figure the claim attached.</p>
  ${reconciliationTable()}
  <p class="src">Unresolved stays unresolved. Where a claim names no contract number and the record holds more than one plausible award, we do not pick one.</p>

  <h2><span class="n">6</span>What the public record flags for diligence</h2>
  <p class="seckind">${kindTag('derived')}</p>
  <p>These are observations a diligence team would want explained. None is a conclusion about value, risk or eligibility.</p>
  <ul>${STUDY_META.flags.map((f) => `<li>${f}</li>`).join('')}</ul>
  <p><b>Recertification.</b> The public record identifies instruments whose treatment following an acquisition may require transaction-specific recertification analysis. This study does not determine those consequences. They depend on facts the public award record does not contain, including the legal structure of the transaction, the acquirer's size under each award's NAICS code, any recertifications filed, and SBA decisions.</p>

  <h2><span class="n">7</span>What the public record cannot establish</h2>
  <p>Public award data does not establish any of the following. Treat every figure in this study as silent on them.</p>
  <ul class="cannot">${STUDY_META.cannotEstablish.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  <p>Only ${d.counts.subawards_as_sub_by_cutoff} prime-reported subawards to Halvik or SP Systems appear in the record by the cutoff, and subaward reporting is incomplete by nature.</p>

  <h2><span class="n">8</span>Why this case matters</h2>
  <p class="seckind">${kindTag('interpretation')}</p>
  ${STUDY_META.whyItMatters}

  <h2><span class="n">9</span>Methodology</h2>
  <div class="meth">
    <p>This study follows the <a href="${RESEARCH_STANDARD.url}">Mindy Institute Research Standard ${esc(RESEARCH_STANDARD.version)}</a>.</p>
    <h3>Entity resolution</h3>
    <p>The target is HALVIK, LLC, UEI ${esc(d.uei)}, CAGE ${esc(d.cage)}. The names "Halvik Corp" (used in Tetra Tech's filings), "Halvik" and "HALVIK, LLC", and the CAGE code, each resolve to this single UEI. Every federal action in this study is recorded against it.</p>
    <h3>Historical cutoff</h3>
    <p>January 21, 2026, the day before the public announcement (see section 2). The study reconstructs what the public federal record showed immediately before an outside observer learned of the deal.</p>
    <h3>Inclusion and report-date rules</h3>
    <p>${esc(d.admissibility)} Of ${d.counts.actions_total} Halvik actions, ${d.counts.actions_included} are included. Excluded: ${d.counts.actions_after_cutoff} actions dated after the cutoff, including the whole of ${d.counts.awards_entirely_after_cutoff} awards that begin after it, and ${d.counts.actions_reported_after_cutoff} action dated before the cutoff but first reported after it. An award is in the register if at least one of its actions is included. The award listing returned ${d.counts.awards_listed} awards (223 contracts, 30 vehicles), and the transaction download contained every one of them.</p>
    <h3>Affiliate handling</h3>
    <p>SP Systems, Inc. (UEI ${esc(d.affiliate_sp_systems.uei)}), which Halvik acquired in 2016, reports Halvik as its parent on 110 actions between 2016-08-04 and 2025-05-14. Its ${d.affiliate_sp_systems.awards} awards (${usdM(d.affiliate_sp_systems.obligations_through_cutoff)} obligated through the cutoff, most of it before 2016) are <b>not</b> included in any Halvik figure. They are reported here separately.</p>
    <h3>Vehicle handling</h3>
    <p>The ${d.counts.vehicles_admissible} vehicles (IDIQs, BPAs, GWACs and GSA Schedules) are counted as awards but carry almost no obligations themselves. Orders under them are counted as contracts and attributed to their parent vehicle. Vehicle ceilings are program-wide, shared by every holder, so they are not attributed to Halvik and no vehicle ceiling appears in any figure.</p>
    <h3>Obligation calculation</h3>
    <p>Obligations are the sum of the federal action obligation on each included action, net of de-obligations, grouped by the federal fiscal year of the action date. Department shares use the department of the awarding agency on each action. Every share in this study has the same denominator: cumulative obligations through the cutoff (${usd(d.obligations_through_cutoff)}), or the twelve-month total where stated. ${usd(d.vehicle_level_obligations.amount)} was obligated directly on the OASIS+ vehicle rather than on an order. It is included in the total but not in the set-aside breakdown, which covers the ${d.counts.contracts_admissible} contracts and orders.</p>
    <h3>Ceiling reconstruction</h3>
    <p>A contract's ceiling is the sum of the change in "base and all options value" recorded on each included action, so it reflects the ceiling as of the cutoff. We do not use USASpending's award-level "potential total value" column. It is a current-state snapshot that differs from row to row within the same award on 78 Halvik awards, so it cannot represent a past date. Where a ceiling cannot be reconstructed from the actions, it is UNKNOWN; no snapshot value is substituted.</p>
    <h3>Set-aside classification</h3>
    <p>The set-aside recorded on the contract or order itself. When that field is blank, which is common on orders, we use the set-aside recorded on its parent vehicle; this applied to 138 of 215 awards. A classification describes how an award was competed or placed. It does not describe eligibility after the acquisition.</p>
    <h3>Public assertion reconciliation</h3>
    <p>Each assertion was matched to the record by contract number where the claim named one, and by vehicle identity otherwise. A dollar claim with no contract number and more than one plausible award is reported as UNRESOLVED; we do not choose a candidate.</p>
    <h3>Source hierarchy</h3>
    <p>The federal record is primary for every federal figure. Company and agency filings and releases are primary for what those organizations said. Press and third-party profiles are secondary and are used only as labeled context. Anything published after the cutoff appears only in the "subsequently reported" section.</p>
    <h3>Limitations</h3>
    <p>The study measures prime contracts only. Subawards are incomplete by nature. Federal data can be corrected after the fact, so a later re-download may differ slightly; this study is computed from the stored download dated 2026-10-07. Section 7 lists what the record cannot establish.</p>
    <h3>Verification</h3>
    <p>Every figure was recomputed independently from the raw download file (SHA-256 <span class="id">${esc(d.source.csv_sha256.slice(0, 16))}…</span>), separately from Mindy's diligence pipeline, and the two agree to the cent. Mindy, the Institute's data engine, assembled the register; the evidence is the federal record and the filings cited, not the software.</p>
  </div>

  <h2><span class="n">10</span>Sources</h2>
  <ol class="sources">${STUDY_META.sources.map((s) => `<li><span class="srckind">${esc(s.kind)}</span>${s.html}</li>`).join('')}</ol>

  <h2><span class="n">11</span>Version and corrections</h2>
  <p>${esc(version)}, published ${esc(published)}. Measured ${esc(STUDY_META.measuredOn)}; historical cutoff ${esc(d.as_of)}.</p>
  <p>${corrections.length === 0 ? 'No corrections.' : ''}</p>
  ${corrections.map((c) => `<p><b>${esc(c.date)} · ${esc(c.version)}.</b> ${esc(c.note)}</p>`).join('')}
  <p class="src">Corrections are published at this address with the date, what changed and why. Original text is not silently replaced.</p>

  <footer>
    <p>Published by <b>The Mindy Institute</b>: independent research and measurement of the public procurement economy. The Institute is operated by GovCon Giants AI, which also makes Mindy, the data engine used for this analysis. Permanent URL: <a href="${esc(canonical)}">${esc(canonical)}</a></p>
    <p>To cite: "${esc(citation)}"</p>
  </footer>
</article>
${mpRawBodyClose()}
</body>
</html>`;
}
