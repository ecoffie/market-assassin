/**
 * Renders a one-shot market report (generate_market_report) into a self-contained,
 * Mindy-branded, client-ready HTML document. Light/printable theme (this is handed to
 * a CLIENT), Mindy navy→purple accents, "Powered by Mindy" footer (subtle distribution).
 *
 * Pure string builder — no imports of the tool types to avoid a cycle; it reads the
 * plain result object defensively. Kept separate from the tool so the hosted
 * /reports/[id] page (follow-on PR) can reuse the exact same renderer.
 */

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? '' : String(v));
function esc(v: unknown): string {
  return s(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function money(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
function num(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

/** Minimal report shape (kept loose to avoid a type import cycle with the tool). */
interface ReportLike {
  subject: string;
  generated_for: string | null;
  basis?: {
    scope: string;
    label: string;
    ranked_by_dominant_naics: boolean;
    naics_sections_code: string | null;
  } | null;
  reconciliation?: {
    single_naics: string;
    single_naics_name: string;
    single_naics_amount: number;
    single_naics_pct: number;
    total_market: number;
    naics_count: number;
    missed_pct: number;
  } | null;
  summary: {
    total_market: number | null;
    naics_count: number | null;
    top_psc: { code: string; name: string } | null;
    buying_agencies: number;
    top_contractors: number;
    recompetes: number;
    forecasts: number;
  };
  sections: {
    market_size: unknown;
    top_agencies: Array<{ name: string; amount: number }>;
    competition: { contractors: unknown[] };
    recompetes: { contracts: unknown[] };
    forecasts: { forecasts: unknown[] };
    agency_detail: unknown;
    set_aside_gap: unknown;
  };
  _meta: { degraded: boolean; sections_grounded: number; sections_total: number };
}

function statCard(label: string, value: string): string {
  return `<div class="stat"><div class="stat-v">${esc(value)}</div><div class="stat-l">${esc(label)}</div></div>`;
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return `<p class="empty">No rows available for this section.</p>`;
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="lead"' : ''}>${c}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="tw"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function section(title: string, sub: string, inner: string): string {
  return `<section class="sec"><h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}${inner}</section>`;
}

export function renderMarketReportHtml(report: ReportLike, opts: { date?: string } = {}): string {
  const { subject, summary, sections, generated_for } = report;
  const date = opts.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Every section states WHAT IT MEASURED. An unlabelled figure loses the "your data is
  // wrong" argument even when it's the more accurate one.
  const basisNote = report.basis?.label ? ` — ranked by ${report.basis.label}` : '';

  /**
   * "How to reconcile this with a NAICS-based tool." Show THEIR number on OUR page and
   * explain it, so a competitor's figure becomes evidence for us instead of an
   * objection. Rendered only when there's genuinely something to reconcile.
   */
  const rec = report.reconciliation;
  const reconcileHtml = rec
    ? `<section class="sec rec">
        <h2>How to reconcile this with a NAICS-based tool</h2>
        <p class="sub">Other platforms search a single NAICS code. Here is exactly what that returns for
        &ldquo;${esc(subject)}&rdquo;, and what it leaves out — so you can compare like for like.</p>
        <div class="tw"><table><tbody>
          <tr><td class="lead">Searching ${esc(rec.single_naics)} <span class="muted">${esc(rec.single_naics_name)}</span> alone</td>
              <td>${money(rec.single_naics_amount)}</td><td>${Math.round(rec.single_naics_pct * 100)}% of the market</td></tr>
          <tr><td class="lead">This report — ${num(rec.naics_count)} buying NAICS</td>
              <td>${money(rec.total_market)}</td><td>100%</td></tr>
        </tbody></table></div>
        <p class="note">A single-code search misses <b>${Math.round(rec.missed_pct * 100)}%</b> of this market.
        Both figures are real federal contract obligations over the same window — they differ only in how much of the market each one looks at.</p>
      </section>`
    : '';

  // ---- Market composition (keyword-coverage view) ----
  const cov = sections.market_size as { allNaics?: Array<Row>; topPscList?: Array<Row>; coveragePct?: number; topCodePct?: number } | null;
  const naicsRows = (cov?.allNaics || []).slice(0, 10).map((r) => [
    `${esc(r.code)} <span class="muted">${esc(r.name)}</span>`,
    money(r.amount),
    `${Math.round(Number(r.pct || 0) * 100)}%`,
  ]);
  const pscRows = (cov?.topPscList || []).slice(0, 8).map((r) => [
    `${esc(r.code)} <span class="muted">${esc(r.name)}</span>`,
    money(r.amount),
    `${Math.round(Number(r.pct || 0) * 100)}%`,
  ]);

  // ---- Top buying agencies ----
  // spending_by_category returns dollars, not contract/vendor counts — show what we
  // actually have. Share is of the agencies SHOWN (top 10), stated as such below.
  const agencyShown = sections.top_agencies.reduce((t, a) => t + (a.amount || 0), 0);
  const agencyRows = sections.top_agencies.map((a) => [
    esc(a.name),
    money(a.amount),
    agencyShown > 0 ? `${Math.round((a.amount / agencyShown) * 100)}%` : '—',
  ]);

  // ---- Competitive landscape ----
  const vendorRows = (sections.competition.contractors as Row[]).slice(0, 12).map((c) => [
    esc(c.recipient_name),
    esc([c.city, c.state].filter(Boolean).join(', ')),
    money(c.total_obligated),
    num(c.award_count),
  ]);

  // ---- Recompetes ----
  const recompeteRows = (sections.recompetes.contracts as Row[]).slice(0, 12).map((c) => [
    esc(c.incumbent_name || '—'),
    esc(c.awarding_agency || c.awarding_sub_agency || '—'),
    esc(c.naics_code || '—'),
    money(c.potential_total_value ?? c.total_obligation),
    esc(s(c.period_of_performance_current_end).slice(0, 10) || '—'),
    esc(c.recompete_likelihood || '—'),
  ]);

  // ---- Forecasts ----
  const forecastRows = (sections.forecasts.forecasts as Row[]).slice(0, 12).map((f) => [
    esc(f.title),
    esc(f.agency || f.department || '—'),
    esc(f.naics_code || '—'),
    esc(f.value_range || money(f.value_max ?? f.value_min)),
    esc([f.fiscal_year, f.quarter].filter(Boolean).join(' ') || '—'),
    esc(f.set_aside_type || '—'),
  ]);

  // ---- Agency deep-dive (optional) ----
  const ad = sections.agency_detail as { total_obligated?: number; small_business_share?: number; sub_agencies?: Row[]; set_aside_breakdown?: Row[] } | null;
  let agencyDetailHtml = '';
  if (ad && ad.total_obligated) {
    const subRows = (ad.sub_agencies || []).slice(0, 8).map((r) => [esc(r.name), money(r.amount), `${Math.round(Number(r.pct_of_total || 0) * 100)}%`]);
    const saRows = (ad.set_aside_breakdown || []).slice(0, 8).map((r) => [esc(r.label), money(r.amount), `${Math.round(Number(r.pct_of_total || 0) * 100)}%`]);
    agencyDetailHtml = section(
      'Agency deep-dive',
      `Total obligated ${money(ad.total_obligated)} · small-business share ${Math.round(Number(ad.small_business_share || 0) * 100)}%`,
      `<div class="two"><div><h3>Top sub-agencies</h3>${table(['Sub-agency', 'Obligated', 'Share'], subRows)}</div>` +
        `<div><h3>Set-aside breakdown</h3>${table(['Set-aside', 'Obligated', 'Share'], saRows)}</div></div>`
    );
  }

  const topPscLine = summary.top_psc ? `${summary.top_psc.code} — ${summary.top_psc.name}` : '—';

  const body = [
    // Summary band
    `<section class="summary">
      ${statCard('Total market', money(summary.total_market))}
      ${statCard('Buying NAICS', summary.naics_count != null ? num(summary.naics_count) : '—')}
      ${statCard('Top product (PSC)', topPscLine)}
      ${statCard('Top agencies', num(summary.buying_agencies))}
      ${statCard('Leading contractors', num(summary.top_contractors))}
      ${statCard('Recompetes', num(summary.recompetes))}
      ${statCard('Forecasts', num(summary.forecasts))}
    </section>`,
    (naicsRows.length || pscRows.length)
      ? section(
          'Market composition',
          `Where the money is — the NAICS a keyword sprawls across, and what was actually BOUGHT (PSC). The single biggest NAICS is only ${cov?.topCodePct != null ? Math.round(Number(cov.topCodePct) * 100) + '%' : 'a fraction'} of the market.`,
          `<div class="two"><div><h3>Buying NAICS (top 10)</h3>${table(['NAICS', 'Obligated', 'Share'], naicsRows)}</div>` +
            `<div><h3>What was bought (top PSC)</h3>${table(['PSC', 'Obligated', 'Share'], pscRows)}</div></div>`
        )
      : '',
    reconcileHtml,
    section(
      'Who is buying',
      `Top federal buying sub-agencies by obligated dollars${basisNote}. Share is of the top ${sections.top_agencies.length} shown, not of the whole market.`,
      table(['Buying sub-agency', 'Obligated', 'Share of shown'], agencyRows)
    ),
    section('Competitive landscape', 'Leading contractors by obligated dollars — the incumbents you would be up against.', table(['Contractor', 'Location', 'Obligated', 'Awards'], vendorRows)),
    section('Recompetes on the horizon', 'Expiring contracts likely to come back out for bid.', table(['Incumbent', 'Agency', 'NAICS', 'Value', 'Ends', 'Likelihood'], recompeteRows)),
    section('Upcoming forecasts', 'Planned procurements 6–18 months out.', table(['Title', 'Agency', 'NAICS', 'Value', 'FY', 'Set-aside'], forecastRows)),
    agencyDetailHtml,
  ].join('\n');

  const degradedNote = report._meta.degraded
    ? `<p class="note">Some sections could not be loaded at generation time and may be incomplete.</p>`
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Market Report — ${esc(subject)}</title>
<style>
  :root { --navy:#1e3a8a; --purple:#7c3aed; --ink:#1e2230; --muted:#6b7280; --line:#e5e7eb; --bg:#f7f7fb; --card:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:1000px; margin:0 auto; padding:32px 24px 56px; }
  header.rp { background:linear-gradient(135deg,var(--navy),var(--purple)); color:#fff; border-radius:16px; padding:28px 30px; }
  header.rp .kick { font-size:12px; letter-spacing:.12em; text-transform:uppercase; opacity:.85; font-weight:700; }
  header.rp h1 { margin:6px 0 2px; font-size:30px; line-height:1.15; }
  header.rp .meta { font-size:13px; opacity:.9; margin-top:6px; }
  .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin:22px 0 8px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .stat-v { font-size:20px; font-weight:800; color:var(--navy); }
  .stat-l { font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-top:2px; }
  .sec { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px 22px; margin-top:18px; }
  .sec h2 { margin:0 0 2px; font-size:18px; color:var(--navy); }
  .sec h3 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:0 0 8px; }
  .sub { margin:0 0 14px; color:var(--muted); font-size:13.5px; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:22px; }
  @media (max-width:720px){ .two { grid-template-columns:1fr; } }
  .tw { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); padding:8px 10px; border-bottom:2px solid var(--line); white-space:nowrap; }
  td { padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  td.lead { font-weight:600; }
  td:not(.lead) { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .muted { color:var(--muted); font-weight:400; }
  .empty { color:var(--muted); font-size:13px; font-style:italic; }
  .note { color:#b45309; font-size:12.5px; }
  .rec { border-color:#c7b7f5; background:linear-gradient(180deg,#faf8ff,#fff); }
  .rec h2 { color:var(--purple); }
  footer.rp { margin-top:28px; text-align:center; color:var(--muted); font-size:12px; }
  footer.rp b { color:var(--purple); }
  .pdfbtn { position:absolute; top:22px; right:22px; background:rgba(255,255,255,.16); color:#fff; border:1px solid rgba(255,255,255,.5);
            border-radius:8px; padding:7px 13px; font:600 12.5px/1 inherit; cursor:pointer; }
  .pdfbtn:hover { background:rgba(255,255,255,.28); }
  @media (max-width:560px){ .pdfbtn { display:none; } }
  /* Print = the PDF path (server-side HTML→PDF needs Chromium, which isn't in the lambda). */
  @media print { body { background:#fff; } .sec,.stat { break-inside:avoid; } .pdfbtn { display:none; } }
</style></head>
<body><div class="wrap">
  <header class="rp" style="position:relative">
    <div class="kick">Federal Market Report</div>
    <h1>${esc(subject)}</h1>
    <div class="meta">${generated_for ? `Prepared for ${esc(generated_for)} · ` : ''}${esc(date)}</div>
    <button class="pdfbtn" onclick="window.print()">Save as PDF</button>
  </header>
  ${degradedNote}
  ${body}
  <footer class="rp">Powered by <b>Mindy</b> · getmindy.ai — federal contracting intelligence.<br>
  Figures are federal contract obligations over the reporting window (USASpending/SAM), not budget authority.</footer>
</div></body></html>`;
}
