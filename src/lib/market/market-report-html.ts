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
    /** RC-5 provenance — see MarketReportSummary in market-report.ts. */
    total_market_basis?: {
      source?: string;
      window?: string | null;
      state_scoped?: boolean;
      requested_state?: string | null;
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
    } | null;
    agency_detail: unknown;
    set_aside_gap: unknown;
  };
  _meta: { degraded: boolean; sections_grounded: number; sections_total: number };
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
    + (sub ? `<div class="stat-sub">${esc(sub)}</div>` : '')
    + `<div class="stat-l">${esc(label)}</div></div>`;
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
    `${esc(c.incumbent_name || '—')}<div class="rowsub">${esc(c.piid || '')}${
      c.description ? ` · ${esc(s(c.description).slice(0, 90))}${s(c.description).length > 90 ? '…' : ''}` : ''
    }</div>`,
    esc(c.awarding_sub_agency || c.awarding_agency || '—'),
    esc(c.naics_code || '—'),
    money(c.potential_total_value ?? c.total_obligation),
    esc(s(c.period_of_performance_current_end).slice(0, 10) || '—'),
    esc(c.recompete_likelihood || '—'),
  ]);

  // ---- Forecasts ----
  // Same title ≠ same procurement: Navy's three "OPF-L Delivery Order #3" rows name
  // three different incumbents. Show the incumbent so the reader can see that.
  const forecastRows = (sections.forecasts.forecasts as Row[]).map((f) => [
    esc(f.title) + (f.incumbent_name ? `<div class="rowsub">Incumbent: ${esc(f.incumbent_name)}</div>` : ''),
    esc(f.agency || f.department || '—'),
    esc(f.naics_code || '—'),
    esc(prettyRange(f.value_range, f.value_max, f.value_min)),
    esc([f.fiscal_year, f.quarter].filter(Boolean).join(' ') || '—'),
    // Normalized upstream; null = the source did not state a category.
    esc(f.set_aside_type || 'Not stated'),
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


  // WHO TO CALL — the market's #1 buyer's office + real, emailable POCs. Only rendered
  // when the roster returned people (grounded); the email is a live mailto.
  const contacts = sections.contacts;
  const contactsHtml = contacts && contacts.people.length
    ? section(
        'Who to call',
        `Real points of contact at ${esc(contacts.agency)}${contacts.office ? ` · ${esc(contacts.office)}` : ''} — the buyer's small-business and contracting people${
          contacts.total > contacts.people.length ? `. Showing ${contacts.people.length} of ${num(contacts.total)}.` : '.'
        }`,
        table(
          ['Name', 'Role', 'Office', 'Email'],
          contacts.people.map((p) => [
            esc(p.name),
            esc(p.role || '—'),
            esc(p.office || '—'),
            p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '—',
          ])
        )
      )
    : '';

  // RC-5 — when the headline and the sections measure different scopes, SAY SO.
  // Presenting both figures unlabelled is what read as a contradiction.
  const scopeNote = summary.total_market_basis?.requested_state && !summary.total_market_basis.state_scoped
    ? `<p class="note">“Total market” is the <strong>national</strong> figure for this market${
        summary.total_market_basis.window ? ` (${esc(summary.total_market_basis.window)})` : ''
      }. Every section below is scoped to <strong>${esc(
        summary.total_market_basis.requested_state,
      )}</strong> — the agency and contractor dollars cover FY23-25 in that state, and the recompetes and forecasts are that state's rows — so those figures are smaller by design; they answer a different question.</p>`
    : '';

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
        ),
      )
    : '';

  /** An empty ranked table explains itself when the phrase it ranked on measured $0. */
  const sectionsBasisTier = tiers.find((t) => t.role === 'sections_basis');
  const phraseEmptyNote = sectionsBasisTier && sectionsBasisTier.amount === 0
    ? `<p class="note">No contract award text contains the exact phrase this table is ranked on, so it is empty for that phrase. That is not a statement that no one buys this work — the market total above was measured ${
        tb?.identity_resolved_via?.length ? `through: ${esc(tb.identity_resolved_via.join(', '))}` : 'differently (see How this market was measured)'
      }.</p>`
    : '';

  const body = [
    // Summary band
    `<section class="summary">
      ${statCard(
        // RC-5: name WHAT this measures. A national 1-FY headline beside
        // state-scoped 3-FY sections is not a contradiction once it is labelled.
        summary.total_market_basis?.requested_state && !summary.total_market_basis.state_scoped
          ? 'Total market (national)'
          : 'Total market',
        money(summary.total_market),
        summary.total_market_basis?.window ?? undefined,
      )}
      ${summary.naics_count != null ? statCard('Buying NAICS', num(summary.naics_count)) : ''}
      ${summary.top_psc ? statCard('Top product (PSC)', summary.top_psc.code, summary.top_psc.name) : ''}
      ${statCard('Top agencies', num(summary.buying_agencies))}
      ${statCard('Leading contractors', num(summary.top_contractors))}
      ${(() => { const c = countValue(summary.recompetes, summary.recompetes_total); return statCard('Recompetes', c.value, c.sub); })()}
      ${(() => { const c = countValue(summary.forecasts, summary.forecasts_total); return statCard(c.sub ? 'Forecast records' : 'Forecasts', c.value, c.sub); })()}
      ${summary.contacts ? statCard('Contacts to call', num(summary.contacts)) : ''}
    </section>`,
    scopeNote,
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
      (agencyRows.length ? '' : phraseEmptyNote) + table(['Buying sub-agency', 'Obligated', 'Share of shown'], agencyRows)
    ),
    contactsHtml,
    section('Competitive landscape', `Leading contractors by obligated dollars${basisNote} — the incumbents you would be up against. Showing the top ${vendorRows.length}.`,
      (vendorRows.length ? '' : phraseEmptyNote) + table(['Contractor', 'UEI', 'Obligated'], vendorRows)),
    section('Recompetes on the horizon',
      `Contracts whose current period of performance ends soonest — soonest first. "Ends" is the period-of-performance end date.${
        summary.recompetes_total != null && summary.recompetes_total > recompeteRows.length
          ? ` Showing ${num(recompeteRows.length)} of ${num(summary.recompetes_total)} found.`
          : ''
      }`,
      table(['Incumbent / contract', 'Agency', 'NAICS', 'Value', 'Ends', 'Likelihood'], recompeteRows)),
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
      table(['Title', 'Agency', 'NAICS', 'Value', 'FY', 'Set-aside'], forecastRows)),
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
  .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:22px 0 8px; align-items:start; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; min-width:0; }
  .stat-v { font-size:20px; font-weight:800; color:var(--navy); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .stat-sub { font-size:11.5px; font-weight:600; color:var(--ink,#334155); line-height:1.35; margin-top:3px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
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
  .rowsub { color:var(--muted); font-weight:400; font-size:.88em; margin-top:2px; white-space:normal; }
  .note { color:#b45309; font-size:12.5px; }
  .rec { border-color:#c7b7f5; background:linear-gradient(180deg,#faf8ff,#fff); }
  .rec h2 { color:var(--purple); }
  footer.rp { margin-top:28px; text-align:center; color:var(--muted); font-size:12px; }
  footer.rp b { color:var(--purple); }
  .pdfbtn { position:absolute; top:22px; right:22px; background:rgba(255,255,255,.16); color:#fff; border:1px solid rgba(255,255,255,.5);
            border-radius:8px; padding:7px 13px; font:600 12.5px/1 inherit; cursor:pointer; }
  .pdfbtn:hover { background:rgba(255,255,255,.28); }
  @media (max-width:560px){ .pdfbtn { display:none; } }
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
