/**
 * Three-horizon completeness for a CURRENT_FIND answer (F1, 2026-11-15).
 *
 * The contract asks the answer model for Open now / Coming back / Coming soon. In the side-by-side parity
 * run, terra once stopped after "Open now" on the same data that produced a full answer the run before, so
 * the prompt alone cannot guarantee check (a) of Eric's bar ("all three horizons present: grounded, empty
 * or unavailable, never zero"). After the answer, any horizon the answer did not cover is appended from the
 * tool's OWN summary: status and counts only, never rows, never invented. Unavailable is said as such.
 */
export interface FindSummary {
  open_now?: { status?: string; matched_count?: number | null };
  coming_back?: { status?: string; matched_count?: number | null; direct_match?: number | null; related_market_candidate?: number | null };
  coming_soon?: { status?: string; matched_count?: number | null };
}

const HEADINGS: Array<[keyof FindSummary, RegExp, string]> = [
  ['open_now', /\bopen now\b/i, 'Open now'],
  ['coming_back', /\bcoming back\b/i, 'Coming back'],
  ['coming_soon', /\bcoming soon\b/i, 'Coming soon'],
];

function line(key: keyof FindSummary, s: FindSummary): string {
  const h = s[key] || {};
  const status = String(h.status || '');
  const n = typeof h.matched_count === 'number' ? h.matched_count : null;
  if (status === 'unavailable' || status === 'failed' || status === 'degraded') return 'could not be checked this time (not a zero).';
  if (status === 'empty' || n === 0) {
    return key === 'open_now' ? 'no matching open solicitations.' : key === 'coming_back' ? 'no matching expiring contracts.' : 'no matching agency forecasts.';
  }
  if (n == null) return key === 'coming_back' ? 'expiring contracts were found; ask me to list them.' : 'results were found; ask me to list them.';
  if (key === 'open_now') return `${n} open notice${n === 1 ? '' : 's'} matched the search; ask me to list them.`;
  if (key === 'coming_soon') return `${n} agency forecast${n === 1 ? '' : 's'} matched (planned buys, not yet on SAM); ask me to list them.`;
  const cb = s.coming_back || {};
  const parts: string[] = [];
  if (typeof cb.direct_match === 'number') parts.push(`${cb.direct_match} direct`);
  if (typeof cb.related_market_candidate === 'number' && cb.related_market_candidate > 0) parts.push(`${cb.related_market_candidate} related-market, not confirmed`);
  return `${n} expiring contract${n === 1 ? '' : 's'} matched${parts.length ? ` (${parts.join(', ')})` : ''}; these are not open solicitations. Ask me to list them.`;
}

/** The text to append so every horizon is covered, or '' when the answer already covers all three. */
export function missingHorizonFooter(answer: string, summary: FindSummary | null | undefined): string {
  if (!summary || typeof summary !== 'object') return '';
  const text = String(answer || '');
  const missing = HEADINGS.filter(([key, re]) => summary[key] && !re.test(text));
  if (!missing.length) return '';
  return '\n\n' + missing.map(([key, , label]) => `**${label}:** ${line(key, summary)}`).join('\n\n');
}

/** The parts of a find_opportunities result the completeness footer reads. */
export interface FindResultLite {
  summary?: FindSummary;
  query_summary?: { query?: string | null; location?: string | null };
}

/* ───────────────────────── Coming back rows, deterministically (quality round, 2026-11-16) ─────────────────────────
 * The answer model sometimes compresses Coming back to one counts line ("80 expiring contracts matched … Ask me to
 * list them") on the same data that produced a full table the run before (Agent 5, prod a6d61a73). Claude + MCP lists
 * the top rows. So when the answer does not name the top direct rows, the table is appended from the tool's OWN
 * items: DIRECT_MATCH rows only (buy-side evidence; related / holder-name rows are never added back), exact holder,
 * value, end date, competition label and USASpending link. Nothing is invented and nothing is re-ranked by guesswork:
 * competed and not-established rows first (by value), then rows whose current award was not competed.
 */
export interface ComingBackItemLite {
  evidence_class?: string;
  incumbent_name?: string | null;
  description?: string | null;
  value_label?: string | null;
  potential_total_value?: number | string | null;
  current_end?: string | null;
  location_label?: string | null;
  contract_id?: string | null;
  source_url?: string | null;
  competition?: { class?: string; label?: string } | null;
}

const COMING_BACK_TABLE_ROWS = 10;
const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'in', 'at', 'to', 'a']);

function titleCase(s: string, acronyms = true): string {
  // Federal records are ALL CAPS. Readable case, but short tokens keep their capitals (VIP, SMA, KRA-CRJ, JV, DC, GA)
  // because they are usually acronyms; a few common short words are the exception.
  const KEEP_LOWER = new Set(['inc', 'co', 'of', 'and', 'the', 'for', 'in', 'at', 'to', 'a', 'on', 'by']);
  const word = (w: string, first: boolean): string => {
    const bare = w.replace(/[^a-z0-9]/gi, '');
    if (!bare) return w;
    if (acronyms && bare.length <= 3 && !KEEP_LOWER.has(bare.toLowerCase()) && /[a-z]/i.test(bare)) return w.toUpperCase();
    if (!/[aeiouy]/i.test(bare) && /[a-z]{2,}/i.test(bare)) return w.toUpperCase(); // HCC, SFD, MRG
    const lw = w.toLowerCase();
    if (!first && SMALL_WORDS.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  };
  return s.split(/\s+/).filter(Boolean).map((w, i) => w.split('-').map((part, j) => word(part, i === 0 && j === 0)).join('-')).join(' ');
}
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max).replace(/[\s,;:.-]+\S*$/, '');
  return (cut || s.slice(0, max)) + '…';
}
const cell = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['inc', 'llc', 'corp', 'the', 'and', 'industries', 'services', 'group', 'company'].includes(w)).slice(0, 2).join(' ');

function fmtDate(iso: string | null | undefined): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  const mon = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'][Number(m[2]) - 1];
  return `${mon} ${Number(m[3])}, ${m[1]}`;
}

/** Direct rows in presentation order: competed / not established first (value desc), then not competed. */
export function prioritizedComingBack(items: ComingBackItemLite[]): ComingBackItemLite[] {
  const direct = items.filter((i) => i.evidence_class === 'DIRECT_MATCH');
  const value = (i: ComingBackItemLite) => Number(i.potential_total_value) || 0;
  const restricted = (i: ComingBackItemLite) => (i.competition?.class === 'not_competed' ? 1 : 0);
  return [...direct].sort((a, b) => restricted(a) - restricted(b) || value(b) - value(a));
}

/** True when the answer already names most of the top direct holders (so no table is appended). */
export function answerNamesTopComingBack(answer: string, items: ComingBackItemLite[]): boolean {
  const top = prioritizedComingBack(items).slice(0, 5).map((i) => nameKey(String(i.incumbent_name || ''))).filter(Boolean);
  if (top.length < 3) return true; // too few rows to need a table
  // The answer already carries its own table of 5+ rows: never append a second one.
  const tableRows = answer.split('\n').filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).length;
  if (tableRows >= 6) return true; // header + 5 rows
  const a = answer.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ');
  return top.filter((k) => a.includes(k)).length >= Math.min(3, top.length);
}

/** Narrow-panel table (4 columns) of the top direct Coming back rows. '' when there are none. */
export function comingBackTable(items: ComingBackItemLite[], max = COMING_BACK_TABLE_ROWS): string {
  const rows = prioritizedComingBack(items).slice(0, max);
  if (!rows.length) return '';
  const lines = rows.map((i) => {
    const holder = titleCase(String(i.incumbent_name || 'Holder not reported'));
    const url = i.source_url || (i.contract_id ? `https://www.usaspending.gov/award/${encodeURIComponent(i.contract_id)}` : '');
    const link = url ? `[${cell(holder)}](${url})` : cell(holder);
    const work = i.description ? ` — ${cell(clip(titleCase(String(i.description), false), 56))}` : '';
    return `| ${link}${work} | ${cell(i.value_label || '—')} | ${fmtDate(i.current_end)} | ${cell(i.competition?.label || 'Not established')} |`;
  });
  return ['| Holder — work | Value | Ends | Last award |', '|---|---:|---|---|', ...lines].join('\n');
}

export interface FindResultWithItems extends FindResultLite {
  horizons?: { coming_back?: { status?: string; items?: ComingBackItemLite[] } };
}

/**
 * Everything the answer must carry that it left out: missing horizons (counts) and, when the answer did not
 * name the top Coming back rows, those rows as a table from the tool's own data.
 */
export function findCompletionFooter(answer: string, find: FindResultWithItems | null | undefined): { text: string; addedTable: boolean } {
  if (!find || typeof find !== 'object') return { text: '', addedTable: false };
  const text = String(answer || '');
  const items = find.horizons?.coming_back?.status === 'grounded' ? find.horizons.coming_back.items || [] : [];
  const needTable = items.length > 0 && !answerNamesTopComingBack(text, items);
  const table = needTable ? comingBackTable(items) : '';
  // When the table is added, Coming back is no longer "missing": drop its counts-only line, keep the others.
  const summary = table && find.summary ? { ...find.summary, coming_back: undefined } : find.summary;
  let out = missingHorizonFooter(text, summary);
  if (table) {
    const cb = find.summary?.coming_back;
    const counts = typeof cb?.matched_count === 'number'
      ? ` ${cb.matched_count} matched${typeof cb.direct_match === 'number' ? ` (${cb.direct_match} direct${typeof cb.related_market_candidate === 'number' && cb.related_market_candidate > 0 ? `, ${cb.related_market_candidate} related, not confirmed` : ''})` : ''}.`
      : '';
    out += `\n\n**Coming back — top direct matches** (expiring contracts, not open solicitations).${counts} "Last award" is how the current contract was made, from its USASpending record.\n\n${table}`;
  }
  return { text: out, addedTable: !!table };
}
