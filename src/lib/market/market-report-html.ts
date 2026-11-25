/**
 * Renders a one-shot market report (generate_market_report) into a self-contained,
 * Mindy-branded, client-ready HTML document. Light/printable theme (this is handed to
 * a CLIENT), Mindy navy→purple accents, "Powered by Mindy" footer (subtle distribution).
 *
 * Pure string builder — no imports of the tool types to avoid a cycle; it reads the
 * plain result object defensively. Kept separate from the tool so the hosted
 * /reports/[id] page (follow-on PR) can reuse the exact same renderer.
 */

import { INTER_LATIN_FONT_FACE } from '@/lib/fonts/inter-latin-embedded';

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? '' : String(v));
function esc(v: unknown): string {
  return s(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function money(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  // Transaction obligations are NET of de-obligations, so a bucket can be negative. Say so; never "$-1,188,272".
  if (n < 0) return `−${money(-n)} net`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
/**
 * A share that is ALREADY in percent units (agency-spending-detail pct()). Never ×100, never clamped.
 * Unavailable when the value is missing, or when the bucket's net amount is ≤ 0 (a net de-obligation
 * has no meaningful share of awards).
 */
function percentShare(pct: unknown, amount: unknown): string {
  // A FAILED lookup carries null (agency-spending-detail): unknown, never "net de-obligation" (Number(null) = 0).
  if (amount === null || amount === undefined || pct === null || pct === undefined || pct === '') return 'unavailable';
  const a = typeof amount === 'number' ? amount : Number(amount);
  if (Number.isFinite(a) && a <= 0) return 'n/a (net de-obligation)';
  if (pct === null || pct === undefined || pct === '') return 'unavailable';
  const p = typeof pct === 'number' ? pct : Number(pct);
  if (!Number.isFinite(p)) return 'unavailable';
  if (p > 0 && p < 0.1) return '<0.1%';
  return `${p.toFixed(1)}%`;
}
/** A short value that must never split across lines (a code, amount, date, label). Already-escaped HTML in. */
function nw(html: string): string {
  return `<span class="nw">${html}</span>`;
}
/**
 * Display casing for the report title only: capitalise words typed all in lower case ("janitorial services"
 * → "Janitorial Services"), keep anything the user cased themselves ("VA IT", "eDiscovery") and keep short
 * joining words lower case after the first word. The stored subject, file name and quoted search phrase are
 * unchanged.
 */
export function displayTitle(subject: unknown): string {
  const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
  return s(subject).split(/(\s+)/).map((w, i) =>
    /^[a-z][a-z'-]*$/.test(w) && !(i > 0 && SMALL.has(w)) ? w[0].toUpperCase() + w.slice(1) : w,
  ).join('');
}
function num(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}
/**
 * Forecast VALUE display. agency_forecasts.estimated_value_range is FREE TEXT in wildly
 * inconsistent formats: some already human ("$3B - $3.9B", "> $250M - < $1B", "$1,000,000,000 to
 * $1,250,000,000") and some BARE DIGIT STRINGS ("3000000000", "600000000") that render unreadable
 * (Eric 2026-08-02: "some of the numbers are not comma delimited"). Normalize:
 *   - empty → the numeric value_max, abbreviated ($3.0B).
 *   - a bare number (only digits/spaces) → abbreviate it the same way.
 *   - otherwise (human text) → comma-format any bare 7+ digit run left inside it, keep the rest.
 */
export function prettyRange(rangeText: unknown, valueMax: unknown, valueMin: unknown): string {
  const raw = (typeof rangeText === 'string' ? rangeText : '').trim();
  if (!raw) return money(valueMax ?? valueMin);
  // Pure number (optionally with separators/spaces) → abbreviate via money().
  const bare = raw.replace(/[\s,]/g, '');
  if (/^\$?\d{4,}$/.test(bare)) return money(Number(bare.replace(/\$/, '')));
  // Human text: comma-format any bare 7+ digit run that isn't already delimited.
  return raw.replace(/\d{7,}/g, (d) => Number(d).toLocaleString());
}

/** Minimal report shape (kept loose to avoid a type import cycle with the tool). */
/** Ask Mindy's checked decision (intelligence gate). When present, the report leads with it. */
export interface ReportDecision {
  headline: string;
  pursuits: Array<{ contract_id: string; title: string; why: string[]; barrier: string | null; next_move: string }>;
  also_consider?: string[];
  ruled_out: string;
  gaps: string[];
}

/** The executive brief: the decision first, the market figures after it. */
export function renderDecisionBrief(d: ReportDecision): string {
  const pursuits = d.pursuits.length
    ? `<ol class="brief-pursuits">${d.pursuits.map((p) => `<li><h3>${esc(p.title)}</h3>
        <ul>${p.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
        ${p.barrier ? `<p class="note"><b>What stands in the way:</b> ${esc(p.barrier)}</p>` : ''}
        <p><b>Next move:</b> ${esc(p.next_move)}</p></li>`).join('')}</ol>`
    : '<p class="note">No contract in this market is a pursuit you can act on yet. See what would change that below.</p>';
  return `<section class="sec brief"><h2>What to pursue</h2><p class="lead">${esc(d.headline)}</p>${pursuits}
    ${d.also_consider?.length ? `<p class="sub"><b>Also worth a look:</b></p><ul>${d.also_consider.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${d.ruled_out ? `<p class="sub"><b>Ruled out:</b> ${esc(d.ruled_out)}</p>` : ''}
    ${d.gaps.length ? `<p class="sub"><b>Not yet established:</b></p><ul>${d.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

interface ReportLike {
  /** Ask Mindy's checked decision; the brief renders first when present. */
  decision?: ReportDecision | null;
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
    /** RC-5 provenance — see MarketReportSummary in market-report.ts. */
    total_market_basis?: {
      source?: string;
      window?: string | null;
      state_scoped?: boolean;
      requested_state?: string | null;
      agency_scoped?: boolean;
      requested_agency?: string | null;
      identity_resolved_via?: string[] | null;
    } | null;
    size_tiers?: {
      basis: 'named' | 'term_of_art' | 'code_total';
      label: string;
      amount: number | null;
      method: string;
      inputs: string[];
      role?: 'sections_basis' | 'floor';
      note?: string | null;
    }[] | null;
    undercount_note?: string | null;
    naics_count: number | null;
    top_psc: { code: string; name: string } | null;
    buying_agencies: number;
    top_contractors: number;
    recompetes: number;
    forecasts: number;
    contacts?: number;
    recompetes_total?: number | null;
    forecasts_total?: number | null;
    forecasts_duplicates_removed?: number;
  };
  sections: {
    market_size: unknown;
    top_agencies: Array<{ name: string; amount: number }>;
    top_agencies_total?: number;
    competition: { contractors: unknown[] };
    recompetes: { contracts: unknown[] };
    forecasts: { forecasts: unknown[] };
    contacts?: {
      agency: string;
      office: string | null;
      people: Array<{ name: string; role: string; email: string; office: string | null }>;
      total: number;
      basis?: 'market_awarding_offices' | 'department_roster';
      office_codes?: string[];
    } | null;
    agency_detail: unknown;
    set_aside_gap: unknown;
  };
  _meta: {
    degraded: boolean; sections_grounded: number; sections_total: number;
    /** Per-section outcome (section-outcome.ts). 'failed' = UNKNOWN, never zero; 'withheld_no_subject' = not attempted. */
    section_status?: { name: string; status: string; required?: boolean }[];
  };
}

/**
 * COUNT — a KPI for a table-backed section. The table shows `shown` rows; `total` is
 * the population they were drawn from when the source states one. The card used to
 * print the 15-row display cap as the market's count, above a table that rendered 12.
 */
function countValue(shown: number, total: number | null | undefined): { value: string; sub?: string } {
  if (total != null && total > shown) return { value: num(total), sub: `${num(shown)} shown below` };
  return { value: num(shown) };
}

// A KPI card. `value` is the big number/code (kept SHORT); `sub` is an optional smaller line
// underneath for a name/detail that would otherwise blow up the card height (Eric 2026-08-02:
// the "Top product (PSC)" value was the full PSC label and wrapped to ~10 lines, dragging the
// whole grid row uneven). The sub line is clamped to 2 lines in CSS.
function statCard(label: string, value: string, sub?: string): string {
  return `<div class="stat"><div class="stat-v">${esc(value)}</div>`
    + (sub ? `<div class="stat-sub" title="${esc(sub)}">${esc(sub)}</div>` : '')
    + `<div class="stat-l">${esc(label)}</div></div>`;
}

/**
 * Why a section has no rows. Only 'empty' (the query succeeded and found nothing) may read as none;
 * a failed lookup is UNKNOWN and a withheld one was not attempted — both used to print the same
 * "No rows available" and a 0 KPI, which read as an established absence.
 */
const EMPTY_TEXT: Record<string, string> = {
  failed: 'Unknown — this lookup failed, so no rows here is not evidence that there are none.',
  withheld_no_subject: 'Not attempted — no defensible market boundary to search within, so this is not a count of zero.',
};
function emptyText(status: string | undefined): string {
  return (status && EMPTY_TEXT[status]) || 'No rows available for this section.';
}
/** A KPI value that is only a number when its section's lookup actually answered. */
function kpi(status: string | undefined, n: unknown): string {
  if (status === 'failed') return 'Unknown';
  if (status === 'withheld_no_subject') return 'Not attempted';
  return num(n);
}

/**
 * DATA AND SOURCES — when and where each section's figures come from, built ONLY from metadata the stored report
 * already carries (Design & Output, Track C3). Nothing is inferred: a section with no stated source or date is left
 * out of the table, never filled in. Known source keys get their public name; an unknown key is not shown.
 */
const SOURCE_NAMES: Record<string, string> = {
  bigquery_usaspending_awards: 'USASpending.gov award records',
};
/** "September 30, 2026" from an ISO date or timestamp; '' when it is not a real date. */
function longDate(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return '';
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
function hostOf(v: unknown): string {
  try { return typeof v === 'string' && /^https?:\/\//.test(v) ? new URL(v).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
}
/** Earliest and latest of a set of ISO dates, as "A" or "A to B"; '' when there are none. */
function dateSpan(values: unknown[]): string {
  const days = [...new Set(values.map((v) => (typeof v === 'string' ? v.slice(0, 10) : '')).filter((d) => longDate(d)))].sort();
  if (!days.length) return '';
  return days.length === 1 || days[0] === days[days.length - 1] ? longDate(days[0]) : `${longDate(days[0])} to ${longDate(days[days.length - 1])}`;
}

export interface ProvenanceRow { section: string; source: string; window: string }

export function provenanceRows(report: Pick<ReportLike, 'summary' | 'sections'>): ProvenanceRow[] {
  const rows: ProvenanceRow[] = [];
  const ms = (report.sections.market_size ?? null) as { source?: unknown; windowLabel?: unknown; sourceMaxActionDate?: unknown } | null;
  if (ms) {
    const source = typeof ms.source === 'string' ? SOURCE_NAMES[ms.source] ?? '' : '';
    const through = longDate(ms.sourceMaxActionDate);
    const window = [typeof ms.windowLabel === 'string' ? ms.windowLabel : '', through ? `awards through ${through}` : ''].filter(Boolean).join('; ');
    if (source || window) rows.push({ section: 'Total market and market composition', source, window });
  }
  const basisTier = (report.summary.size_tiers ?? []).find((t) => t.role === 'sections_basis');
  if (basisTier?.method) rows.push({ section: 'Who is buying · Competitive landscape', source: '', window: basisTier.method });
  const contacts = report.sections.contacts as { source_label?: unknown; as_of?: unknown; as_of_label?: unknown; people?: unknown[] } | null | undefined;
  if (contacts && contacts.people?.length) {
    const asOf = longDate(contacts.as_of);
    const source = typeof contacts.source_label === 'string' ? contacts.source_label : '';
    const label = typeof contacts.as_of_label === 'string' ? contacts.as_of_label : 'as of';
    if (source || asOf) rows.push({ section: 'Who to call', source, window: asOf ? `${label}: ${asOf}` : '' });
  }
  // Recompetes: each row's own provenance (Data Core #2399); a stored report from before it has only last_synced_at.
  const recompetes = report.sections.recompetes as { contracts: unknown[]; sources?: Array<{ label?: unknown; count?: unknown }> };
  const recRows = recompetes.contracts as Row[];
  const recSources = (recompetes.sources ?? [])
    .filter((x) => typeof x.label === 'string' && typeof x.count === 'number' && x.count > 0)
    .map((x) => (x.label === 'not_stated' ? `not stated (${x.count})` : `${String(x.label)} (${x.count})`));
  const recompeteSync = dateSpan(recRows.map((c) => (c.provenance as { as_of?: unknown } | undefined)?.as_of ?? c.last_synced_at));
  if (recSources.length || recompeteSync) {
    rows.push({ section: 'Recompetes on the horizon', source: recSources.join(', '), window: recompeteSync ? `records last synced ${recompeteSync}` : '' });
  }
  const forecasts = report.sections.forecasts.forecasts as Row[];
  const hosts = [...new Set(forecasts.map((f) => hostOf(f.source_url)).filter(Boolean))];
  const asOf = dateSpan(forecasts.map((f) => f.as_of));
  if (hosts.length || asOf) rows.push({ section: 'Upcoming forecasts', source: hosts.join(', '), window: asOf ? `records as of ${asOf}` : '' });
  return rows;
}

const FOOTER_HTML = 'Powered by <b>Mindy</b> · getmindy.ai — federal contracting intelligence.<br>\n  '
  + 'Figures are federal contract obligations over the reporting window (USASpending/SAM), not budget authority.';

/**
 * In the PDF the page footer is printed INSIDE the last section, so it travels with that section's final
 * rows; as a separate block after the section it could land alone on an extra page (Claude Local,
 * 2026-11-22: page 9 held only the footer). The screen keeps the page-level footer.
 */
function withPrintFooter(body: string): string {
  const at = body.lastIndexOf('</section>');
  if (at < 0) return body;
  return `${body.slice(0, at)}<div class="rp rp-print">${FOOTER_HTML}</div>${body.slice(at)}`;
}

/**
 * Wraps code-like tokens in already-escaped text (letters/digits joined by hyphens with at least one digit,
 * such as a project number "561A4-26-510") so the PDF never splits them at a hyphen. Ordinary hyphenated
 * words ("Service-Disabled") are left to wrap like prose.
 */
function keepCodesWhole(escaped: string): string {
  return escaped.replace(/(^|[\s(])((?=[A-Za-z0-9-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)(?=$|[\s),.;:])/g, '$1<span class="code">$2</span>');
}

/**
 * `textCols`: columns (besides the first, which is always the lead) that hold long prose, such as an agency name
 * or a set-aside. In the PDF only those and the lead wrap, and only between words; every other cell (money,
 * codes, dates, short labels) and every header stays whole (Claude Local, 2026-11-22: "$1.6B" printed as
 * "$1." / "6B" and "AMOUNT" as AM/OU/NT).
 */
function table(headers: string[], rows: string[][], whenEmpty?: string, textCols: number[] = []): string {
  if (!rows.length) return `<p class="empty">${esc(whenEmpty || emptyText(undefined))}</p>`;
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const cls = (i: number) => (i === 0 ? ' class="lead"' : textCols.includes(i) ? ' class="txt"' : '');
  const body = rows
    .map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${c}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="tw"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function section(title: string, sub: string, inner: string): string {
  return `<section class="sec"><h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}${inner}</section>`;
}

/**
 * opts.pdfUrl: where a real PDF of THIS report can be downloaded (the hosted /reports/<id> page passes
 * /reports/<id>/pdf). With it the header button is a download link; without it (MCP's inline HTML, which
 * has no stored copy to render) it stays the browser's print dialog.
 */
export function renderMarketReportHtml(report: ReportLike, opts: { date?: string; pdfUrl?: string } = {}): string {
  const { subject, summary, sections, generated_for } = report;
  const statusByName = new Map((report._meta.section_status ?? []).map((x) => [x.name, x.status]));
  const st = (name: string) => statusByName.get(name);
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
  // Every row the KPI counts is rendered (no silent 15→12 cut). The category endpoint
  // carries no location or award count, so those always-blank columns are gone; the
  // UEI stays, because two registrations can share one legal name (drones: NORTHROP
  // GRUMMAN SYSTEMS CORPORATION twice, two UEIs) and without it they read as a dup.
  const vendorRows = (sections.competition.contractors as Row[]).map((c) => [
    esc(c.recipient_name),
    esc(c.recipient_uei || '—'),
    money(c.total_obligated),
  ]);

  // ---- Recompetes ----
  // The contract number + a line of its description are what tell two awards to the
  // same incumbent apart (Heritage-M2C1 holds FA500425F0093 AND FA500425F0094 — two
  // contracts, not one row printed twice).
  const recompeteRows = (sections.recompetes.contracts as Row[]).map((c) => [
    `${esc(c.incumbent_name || '—')}<div class="rowsub">${c.piid ? `<span class="code">${esc(c.piid)}</span>` : ''}${
      c.description ? ` · ${keepCodesWhole(esc(s(c.description).slice(0, 90)))}${s(c.description).length > 90 ? '…' : ''}` : ''
    }</div>`,
    esc(c.awarding_sub_agency || c.awarding_agency || '—'),
    nw(esc(c.naics_code || '—')),
    nw(money(c.potential_total_value ?? c.total_obligation)),
    nw(esc(s(c.period_of_performance_current_end).slice(0, 10) || '—')),
    // words: may wrap between words (break-word never splits one); one-time construction reads "One-time project"
    esc(c.recompete_likelihood === 'not_recurring' ? 'One-time project' : (c.recompete_likelihood || '—')),
  ]);

  // ---- Forecasts ----
  // Same title ≠ same procurement: Navy's three "OPF-L Delivery Order #3" rows name
  // three different incumbents. Show the incumbent so the reader can see that.
  const forecastRows = (sections.forecasts.forecasts as Row[]).map((f) => [
    esc(f.title) + (f.incumbent_name ? `<div class="rowsub">Incumbent: ${esc(f.incumbent_name)}</div>` : ''),
    esc(f.agency || f.department || '—'),
    nw(esc(f.naics_code || '—')),
    esc(prettyRange(f.value_range, f.value_max, f.value_min)),
    esc([f.fiscal_year, f.quarter].filter(Boolean).join(' ') || '—'),
    // Normalized upstream; null = the source did not state a category.
    esc(f.set_aside_type || 'Not stated'),
  ]);

  // ---- Agency deep-dive (optional) ----
  // agency_detail comes from getAgencySpendingDetail (USASpending spending_by_category): the WHOLE agency,
  // all NAICS, one fiscal year, contract obligations net of de-obligations. Its pct_of_total and
  // small_business_share are already PERCENT units (9.4 = 9.4%) — multiplying by 100 printed 940%.
  const ad = sections.agency_detail as { total_obligated?: number; small_business_share?: number | null; fiscal_year?: number; agency?: string; sub_agencies?: Row[] | null; sub_agency_structure?: string; sub_agency_note?: string; set_aside_breakdown?: Row[]; set_aside_note?: string } | null;
  let agencyDetailHtml = '';
  if (ad && ad.total_obligated) {
    const share = (r: Row) => percentShare(r.pct_of_total, r.amount);
    const subRows = (ad.sub_agencies || []).slice(0, 8).map((r) => [esc(r.name), money(r.amount), share(r)]);
    const saRows = (ad.set_aside_breakdown || []).slice(0, 8).map((r) => [esc(r.label), r.amount === null ? 'unavailable' : money(r.amount), share(r)]);
    const fy = Number.isFinite(Number(ad.fiscal_year)) && ad.fiscal_year ? `FY${ad.fiscal_year}` : 'one fiscal year';
    const sb = percentShare(ad.small_business_share, 1);
    agencyDetailHtml = section(
      'Agency deep-dive',
      `${esc(ad.agency || 'Agency')}-wide, all NAICS, ${fy} — not limited to this market. `
        + `Total contract obligations ${money(ad.total_obligated)} (net of de-obligations) · set-aside-code share ${sb} `
        + `(dollars awarded under small-business set-aside codes; not the SBA goaling figure — small firms also win full-and-open work)`,
      `<div class="two"><div><h3>Top sub-agencies</h3>${
          // A department that files every award under one self-named sub-agency (VA) or a failed lookup gets a
          // plain sentence (sub_agency_note), never an unexplained "No rows" next to a $90B total.
          subRows.length || !ad.sub_agency_note
            ? table(['Sub-agency', 'Obligated', 'Share of agency total'], subRows)
            : `<p class="empty">${esc(ad.sub_agency_note)}</p>`
        }</div>` +
        // VA's distinct VOSB (VA only) row is explained in one factual sentence from the tool (set_aside_note).
        `<div><h3>Set-aside breakdown</h3>${table(['Set-aside', 'Obligated (net)', 'Share of agency total'], saRows)}${
          ad.set_aside_note ? `<p class="empty">${esc(ad.set_aside_note)}</p>` : ''
        }</div></div>`
    );
  }


  // WHO TO CALL — the market's #1 buyer's office + real, emailable POCs. Only rendered
  // when the roster returned people (grounded); the email is a live mailto.
  const contacts = sections.contacts;
  const contactsHtml = contacts && contacts.people.length
    ? section(
        'Who to call',
        (contacts.basis === 'market_awarding_offices'
          ? `Contracting staff at the offices that awarded this market's expiring contracts (office ${esc((contacts.office_codes || []).join(', '))}) — the people who post those offices' solicitations`
          : contacts.basis === 'department_roster'
            ? `General contacts at ${esc(contacts.agency)} — <strong>not specific to this market or location</strong>: no in-scope contract identified a contracting office to anchor on`
            : `Real points of contact at ${esc(contacts.agency)}${contacts.office ? ` · ${esc(contacts.office)}` : ''} — the buyer's small-business and contracting people`)
          + (contacts.total > contacts.people.length ? `. Showing ${contacts.people.length} of ${num(contacts.total)}.` : '.'),
        // The Office column is shown only when at least one person has an office: a column of dashes
        // tells the reader nothing (the section subtitle already names the offices).
        (() => {
          const withOffice = contacts.people.some((p) => p.office);
          return table(
            withOffice ? ['Name', 'Role', 'Office', 'Email'] : ['Name', 'Role', 'Email'],
            contacts.people.map((p) => [
              esc(p.name),
              esc(p.role || '—'),
              ...(withOffice ? [esc(p.office || '—')] : []),
              p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '—',
            ]),
          );
        })()
      )
    : '';

  // RC-5 — when the headline and the sections measure different scopes, SAY SO.
  // Presenting both figures unlabelled is what read as a contradiction.
  const tmb = summary.total_market_basis;
  const headlineNational = Boolean(tmb?.requested_state && !tmb.state_scoped);
  const headlineAllAgencies = Boolean(tmb?.requested_agency && !tmb.agency_scoped);
  const stateNote = headlineNational
    ? `<p class="note">“Total market” is the <strong>national</strong> figure for this market${
        tmb!.window ? ` (${esc(tmb!.window)})` : ''
      }. Every section below is scoped to <strong>${esc(
        tmb!.requested_state,
      )}</strong> — the agency and contractor dollars cover FY23-25 in that state, and the recompetes and forecasts are that state's rows — so those figures are smaller by design; they answer a different question.</p>`
    : '';
  // The headline is never agency-scoped either: with an agency requested it still covers EVERY federal buyer,
  // and the agency deep-dive is that agency's whole spend (all NAICS). Say both, so $1.6B vs $90.6B reads as
  // two different questions rather than a contradiction (VA report 2026-11-22).
  const agencyNote = headlineAllAgencies
    ? `<p class="note">“Total market” covers <strong>all federal buyers</strong>, not only ${esc(tmb!.requested_agency)}. `
      + `The agency deep-dive is ${esc(tmb!.requested_agency)}'s total contract spend across every industry and the whole country — neither figure is ${esc(tmb!.requested_agency)}'s spend in this market.</p>`
    : '';
  const scopeNote = stateNote + agencyNote;

  /**
   * EXPLAIN — every market figure on the page, side by side, each with what it
   * measured. The headline is a row here too: it is a DIFFERENT measurement from the
   * tiers (1 fiscal year, description-matched) and presenting them apart is what let
   * drones read "$90.0M total market" above "$11.0B — this is the market the report
   * measures", and construction carry a "$0" reading beside a $919.7M headline.
   */
  const tiers = summary.size_tiers || [];
  const tb = summary.total_market_basis;
  // A single tier is only worth a section when it cannot stand unexplained: a $0 or
  // unknown reading, or a headline that was resolved through other words. A lone
  // literal tier that agrees with the headline gets no table (nothing to bridge).
  const tiersNeedExplaining = tiers.length > 1
    || tiers.some((t) => t.amount == null || t.amount === 0)
    || !!tb?.identity_resolved_via?.length;
  const measurementHtml = tiers.length && tiersNeedExplaining
    ? section(
        'How this market was measured',
        'Each figure below answers a different question. None of them contradicts another — read the "What it means" column before comparing them.',
        table(
          ['Reading', 'Amount', 'What it means'],
          [
            [
              'Total market (headline)',
              money(summary.total_market),
              esc(`${tb?.window || 'Latest complete fiscal year'} — contract obligations for awards matching this market.`)
                + (tb?.identity_resolved_via?.length
                  ? `<div class="tier-terms">Measured through: ${esc(tb.identity_resolved_via.join(', '))}</div>`
                  : '')
                + '<div class="tier-terms">Basis of Market composition and the NAICS reconciliation.</div>',
            ],
            ...tiers.map((t) => [
              esc(t.label) + (t.role === 'sections_basis' ? ' <span class="tier-tag">← basis of the agency &amp; contractor tables</span>' : ''),
              t.amount == null ? 'Unknown' : t.amount === 0 ? '$0' : money(t.amount),
              // Derivation first (auditable), then what the figure means next to the others.
              esc(t.method)
                + (t.note ? `<div class="tier-note">${esc(t.note)}</div>` : '')
                + (t.inputs.length > 1 ? `<div class="tier-terms">Terms: ${esc(t.inputs.join(', '))}</div>` : ''),
            ]),
          ],
          undefined,
          [2],
        ),
      )
    : '';

  /** An empty ranked table explains itself when the phrase it ranked on measured $0. */
  const sectionsBasisTier = tiers.find((t) => t.role === 'sections_basis');
  // The agency and contractor tables are ranked on a different reading (and window) than the headline. With
  // several readings "How this market was measured" explains it; with ONE that table is not rendered, and the
  // reader saw $1.6B for the Army under a $426.3M headline with nothing saying why. Show the tier's own note.
  const sectionsBasisNote = !measurementHtml && sectionsBasisTier?.note ? `<p class="note">${esc(sectionsBasisTier.note)}</p>` : '';
  const phraseEmptyNote = sectionsBasisTier && sectionsBasisTier.amount === 0
    ? `<p class="note">No contract award text contains the exact phrase this table is ranked on, so it is empty for that phrase. That is not a statement that no one buys this work — the market total above was measured ${
        tb?.identity_resolved_via?.length ? `through: ${esc(tb.identity_resolved_via.join(', '))}` : 'differently (see How this market was measured)'
      }.</p>`
    : '';

  const body = [
    // Executive brief: the decision first (Ask Mindy intelligence gate). Absent = unchanged report.
    report.decision ? renderDecisionBrief(report.decision) : '',
    // Summary band
    `<section class="summary">
      ${statCard(
        // RC-5: name WHAT this measures. A national 1-FY headline beside
        // state-scoped 3-FY sections is not a contradiction once it is labelled.
        headlineNational && headlineAllAgencies
          ? 'Total market (national, all agencies)'
          : headlineNational
            ? 'Total market (national)'
            : headlineAllAgencies
              ? 'Total market (all agencies)'
              : 'Total market',
        money(summary.total_market),
        summary.total_market_basis?.window ?? undefined,
      )}
      ${summary.naics_count != null ? statCard('Buying NAICS', num(summary.naics_count)) : ''}
      ${summary.top_psc ? statCard('Top product (PSC)', summary.top_psc.code, summary.top_psc.name) : ''}
      ${statCard('Top agencies', kpi(st('top_agencies'), summary.buying_agencies))}
      ${statCard('Leading contractors', kpi(st('competition'), summary.top_contractors))}
      ${(() => { const c = countValue(summary.recompetes, summary.recompetes_total); return statCard('Recompetes', c.value, c.sub); })()}
      ${(() => { const c = countValue(summary.forecasts, summary.forecasts_total); return statCard(c.sub ? 'Forecast records' : 'Forecasts', c.value, c.sub); })()}
      ${summary.contacts ? statCard('Contacts to call', num(summary.contacts)) : ''}
    </section>`,
    scopeNote,
    sectionsBasisNote,
    // THE BRIDGE — how the headline was derived, shown so a client can audit it.
    // A single unlabeled number is what made a $46.3B hypersonics headline
    // indefensible: nobody could see which awards it was built from.
    measurementHtml,
    summary.undercount_note
      ? section(
          'Read this total as a floor',
          'The words buyers use here are not the words you searched.',
          `<p>${esc(summary.undercount_note)}</p>`,
        )
      : '',
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
      `Top federal buying sub-agencies by obligated dollars${basisNote}. Showing the top ${sections.top_agencies.length}${
        sections.top_agencies_total && sections.top_agencies_total > sections.top_agencies.length
          ? ` of ${sections.top_agencies_total} with spend`
          : ''
      }. Share is of the shown agencies, not of the whole market.`,
      (agencyRows.length ? '' : phraseEmptyNote) + table(['Buying sub-agency', 'Obligated', 'Share of shown'], agencyRows, emptyText(st('top_agencies')))
    ),
    contactsHtml,
    section('Competitive landscape', `Leading contractors by obligated dollars${basisNote} — the incumbents you would be up against. Showing the top ${vendorRows.length}.`,
      (vendorRows.length ? '' : phraseEmptyNote) + table(['Contractor', 'UEI', 'Obligated'], vendorRows, emptyText(st('competition')))),
    section('Recompetes on the horizon',
      `Contracts whose current period of performance ends soonest — soonest first. "Ends" is the period-of-performance end date.${
        summary.recompetes_total != null && summary.recompetes_total > recompeteRows.length
          ? ` Showing ${num(recompeteRows.length)} of ${num(summary.recompetes_total)} found.`
          : ''
      }`,
      table(['Incumbent / contract', 'Agency', 'NAICS', 'Value', 'Ends', 'Likelihood'], recompeteRows, emptyText(st('recompetes')), [1, 5])),
    section('Upcoming forecasts',
      `Planned procurements agencies have published.${
        summary.forecasts_total != null && summary.forecasts_total > forecastRows.length
          ? ` Showing ${num(forecastRows.length)} of ${num(summary.forecasts_total)} matching forecast records.`
          : ''
      }${
        summary.forecasts_duplicates_removed
          ? ` ${num(summary.forecasts_duplicates_removed)} duplicate listing${summary.forecasts_duplicates_removed === 1 ? '' : 's'} (the same listing received from two sources) removed.`
          : ''
      }`,
      table(['Title', 'Agency', 'NAICS', 'Value', 'FY', 'Set-aside'], forecastRows, emptyText(st('forecasts')), [1, 5])),
    agencyDetailHtml,
    (() => {
      const prov = provenanceRows(report);
      return prov.length
        ? section('Data and sources', 'Where each section\u2019s figures come from and how current they are, as recorded in this report\u2019s data. Sections without a stated source or date are not listed.',
            `<div class="prov">${table(['Section', 'Source', 'Window / as of'], prov.map((r) => [esc(r.section), esc(r.source || '—'), esc(r.window || '—')]), undefined, [1, 2])}</div>`)
        : '';
    })(),
  ].join('\n');

  const degradedNote = report._meta.degraded
    ? `<p class="note">Some sections could not be loaded at generation time and may be incomplete.</p>`
    : '';

  // The second @media print block is PDF-only: a page is a fixed width, so nothing may rely on horizontal
  // scrolling or truncation (screen layout unchanged). Before it, the recompetes / forecasts tables were
  // ~1,150-1,290px wide in a 626px column and the PDF cut their right side off (Claude Local, 2026-11-22).
  // The NAICS / PSC columns (.two > div) may continue on the next page: kept whole, a tall pair jumped to a
  // new page and left the page before it with one line (full report fixture: page 2 = 58 characters). Rows,
  // KPI tiles, subtitles and notes still never split.
  // In print the page wrapper keeps no bottom padding: 56px of trailing padding after the closing note started a
  // blank last page (only the running footer on it) whenever the report ended near the foot of a page.
  // The report embeds its own font (Inter latin subset, data: URI): the PDF renders with JavaScript and network
  // off, so without it the page used whatever the machine had (Open Sans on production, DejaVu/Liberation on CI).
  // No comments inside the emitted HTML/CSS: client HTML carries no engineering notes (tested).
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Market Report — ${esc(displayTitle(subject))}</title>
<style>
  ${INTER_LATIN_FONT_FACE}
  :root { --navy:#1e3a8a; --purple:#7c3aed; --ink:#1e2230; --muted:#6b7280; --line:#e5e7eb; --bg:#f7f7fb; --card:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 'Mindy Report Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:1000px; margin:0 auto; padding:32px 24px 56px; }
  header.rp { background:linear-gradient(135deg,var(--navy),var(--purple)); color:#fff; border-radius:16px; padding:28px 30px; }
  header.rp .kick { font-size:12px; letter-spacing:.12em; text-transform:uppercase; opacity:.85; font-weight:700; }
  header.rp h1 { margin:6px 0 2px; font-size:30px; line-height:1.15; }
  header.rp .meta { font-size:13px; opacity:.9; margin-top:6px; }
  .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:22px 0 8px; align-items:start; }
  .nw { white-space:nowrap; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; min-width:0; }
  .stat-v { font-size:20px; font-weight:800; color:var(--navy); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .stat-sub { font-size:11.5px; font-weight:600; color:var(--ink,#334155); line-height:1.35; margin-top:3px;
    display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
  .stat-l { font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-top:6px; }
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
  .tier-tag { font-weight:400; color:var(--muted); font-size:.85em; }
  .tier-terms { color:var(--muted); margin-top:4px; font-size:.9em; }
  .tier-note { margin-top:4px; font-size:.92em; }
  .prov td { white-space:normal; }
  .rowsub { color:var(--muted); font-weight:400; font-size:.88em; margin-top:2px; white-space:normal; }
  .note { color:#b45309; font-size:12.5px; }
  .brief .lead { font-size:16px; font-weight:600; line-height:1.45; color:var(--ink,#0f172a); margin:8px 0 14px; }
  .brief-pursuits { margin:0 0 6px; padding-left:22px; }
  .brief-pursuits > li { padding:12px 0 4px; border-top:1px solid var(--line); }
  .brief-pursuits > li:first-child { border-top:0; padding-top:4px; }
  .brief-pursuits > li::marker { font-weight:800; color:var(--navy); }
  .brief .brief-pursuits h3 { font-size:15px; text-transform:none; letter-spacing:0; color:var(--navy); margin:0 0 6px; }
  .brief ul { margin:4px 0 8px; padding-left:20px; }
  .brief li li { margin:2px 0; }
  .brief .note { font-size:13.5px; }
  .brief p { margin:6px 0; }
  .brief .sub { margin:12px 0 4px; }
  .rec { border-color:#c7b7f5; background:linear-gradient(180deg,#faf8ff,#fff); }
  .rec h2 { color:var(--purple); }
  footer.rp { margin-top:28px; text-align:center; color:var(--muted); font-size:12px; }
  footer.rp b { color:var(--purple); }
  .rp-print { display:none; }
  .pdfbtn { position:absolute; top:22px; right:22px; background:rgba(255,255,255,.16); color:#fff; border:1px solid rgba(255,255,255,.5);
            border-radius:8px; padding:7px 13px; font:600 12.5px/1 inherit; cursor:pointer; text-decoration:none; }
  .pdfbtn:hover { background:rgba(255,255,255,.28); }
  @media (max-width:560px){ button.pdfbtn { display:none; } a.pdfbtn { position:static; display:inline-block; margin-top:12px; } }
  @media print { body { background:#fff; } .sec,.stat { break-inside:avoid; } .pdfbtn { display:none; } }
  @media print {
    .tw { overflow: visible; }
    table { width: 100%; table-layout: auto; }
    th, td:not(.lead):not(.txt) { white-space: nowrap; }
    td.lead, td.txt { white-space: normal; overflow-wrap: break-word; word-break: normal; }
    .code { white-space: nowrap; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    .sec { break-inside: auto; }
    .sec h2, .sec h3, .sec .sub { break-after: avoid; }
    .stat, .sub, .note { break-inside: avoid; }
    .two > div { break-inside: auto; }
    .brief-pursuits > li { break-inside: avoid; }
    .brief .lead { break-after: avoid; }
    .wrap { padding-bottom: 0; }
    footer.rp { display: none; }
    .rp-print { display: block; margin-top: 14px; text-align: center; color: var(--muted); font-size: 12px; break-before: avoid; break-inside: avoid; }
    .rp-print b { color: var(--purple); }
    .stat-v { white-space: normal; overflow: visible; text-overflow: clip; }
    .stat-sub { display: block; -webkit-line-clamp: unset; overflow: visible; }
  }
</style></head>
<body><div class="wrap">
  <header class="rp" style="position:relative">
    <div class="kick">Federal Market Report</div>
    <h1>${esc(displayTitle(subject))}</h1>
    <div class="meta">${generated_for ? `Prepared for ${esc(generated_for)} · ` : ''}${esc(date)}${(() => {
      const through = longDate((sections.market_size as { sourceMaxActionDate?: unknown } | null)?.sourceMaxActionDate);
      return through ? ` · Award data through ${esc(through)}` : '';
    })()}</div>
    ${opts.pdfUrl
      ? `<a class="pdfbtn" href="${esc(opts.pdfUrl)}" download>Download PDF</a>`
      : '<button class="pdfbtn" onclick="window.print()">Save as PDF</button>'}
  </header>
  ${degradedNote}
  ${withPrintFooter(body)}
  <footer class="rp">${FOOTER_HTML}</footer>
</div></body></html>`;
}
