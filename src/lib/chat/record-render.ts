/**
 * Ask Mindy Phase 1 (PR E): deterministic rendering of verified records.
 *
 * Why: with complete tool results in hand (26 in-window records for a three-state staffing search),
 * GPT-4o still listed only some of them and presented the subset as the answer, even with an
 * explicit "list every record" rule. Facts must come from data, not from a model reconstructing a
 * long JSON payload. So the server renders the record list itself and the model only analyzes it.
 *
 * Output is plain text (the chat panel shows answers as plain text, not rendered markdown).
 * Rules enforced here:
 *   - every requested filter is shown as applied; anything not applied is disclosed;
 *   - one line per record, de-duplicated by contract_id, soonest end date first (ties by number);
 *   - the full count and the displayed range are always stated separately;
 *   - a list that does not show every matching record says so and gives an explicit continuation;
 *   - a capped retrieval (more rows matched than were retrieved) is never presented as complete.
 */

export const EXPIRING_TOOL = 'get_expiring_contracts';
export const DISPLAY_PAGE = 20;
/** Chat always fetches the whole matched set (local table, up to the tool max) so pages are exact. */
export const CHAT_FETCH_LIMIT = 200;

type Rec = Record<string, unknown>;

export interface RenderedRecords {
  tool: string;
  text: string;
  /** Records matching the filters (from the tool's count). */
  total: number;
  /** Records actually retrieved (may be < total when capped). */
  retrieved: number;
  /** 1-based display range; 0..0 when nothing is shown. */
  from: number;
  to: number;
  shown: number;
  /** True only when every matching record is displayed in this block. */
  exhaustive: boolean;
  /** Identifiers displayed, in order. */
  ids: string[];
  /** Numbers a summary may legitimately state as a count. */
  allowedCounts: number[];
  standalone: number;
  orders: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function money(v: unknown): string {
  const n = num(v);
  if (n == null) return '';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

function title(s: string): string {
  // USASpending names arrive upper-case; keep acronyms (LLC, INC) readable without guessing.
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Llc|Inc|Lp|Llp|Pllc|Usa|Us)\b/g, (m) => m.toUpperCase());
}

/** All records in one list: standalone contracts, in-window orders, and orders with no recorded parent. */
export function collectExpiringRecords(result: Rec): Array<Rec & { _kind: 'contract' | 'order' | 'order_unresolved' }> {
  const seen = new Set<string>();
  const out: Array<Rec & { _kind: 'contract' | 'order' | 'order_unresolved' }> = [];
  const add = (rows: unknown, kind: 'contract' | 'order' | 'order_unresolved') => {
    if (!Array.isArray(rows)) return;
    for (const r of rows as Rec[]) {
      const key = str(r.contract_id) || `${str(r.piid)}|${str(r.period_of_performance_current_end)}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...r, _kind: kind });
    }
  };
  add(result.contracts, 'contract');
  add(result.expiring_orders_in_window, 'order');
  add(result.unresolved_orders, 'order_unresolved');
  out.sort((a, b) => {
    const ea = str(a.period_of_performance_current_end) || '9999-12-31';
    const eb = str(b.period_of_performance_current_end) || '9999-12-31';
    if (ea !== eb) return ea < eb ? -1 : 1;
    const pa = str(a.piid) || str(a.contract_id);
    const pb = str(b.piid) || str(b.contract_id);
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  return out;
}

function filterLine(meta: Rec): string {
  const af = (meta.applied_filters && typeof meta.applied_filters === 'object' ? meta.applied_filters : {}) as Rec;
  const parts: string[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean).join(', ') : str(v));
  if (af.naics) parts.push(`NAICS ${list(af.naics)}`);
  if (af.state) parts.push(`place of performance ${list(af.state)}`);
  if (af.agency) parts.push(`agency "${str(af.agency)}"`);
  if (af.likelihood) parts.push(`recompete likelihood ${str(af.likelihood)}`);
  if (af.min_value != null) parts.push(`obligated at least ${money(af.min_value)}`);
  if (af.max_value != null) parts.push(`obligated at most ${money(af.max_value)}`);
  if (af.eligible_set_asides) parts.push(`set-asides ${list(af.eligible_set_asides)} (or unknown)`);
  const w = (meta.window && typeof meta.window === 'object' ? meta.window : null) as Rec | null;
  if (w) parts.push(`ending after ${str(w.after)} through ${str(w.through)}`);
  return parts.length ? parts.join(' · ') : 'no filters';
}

function ignoredLine(meta: Rec): string | null {
  const ig = Array.isArray(meta.ignored_args) ? (meta.ignored_args as Rec[]) : [];
  if (!ig.length) return null;
  const items = ig.map((i) => `${str(i.arg)} "${str(i.value)}"${i.detail ? ` (${str(i.detail)})` : ''}`);
  return `Not applied: ${items.join('; ')}. Results do not reflect ${ig.length === 1 ? 'that filter' : 'those filters'}.`;
}

function recordLine(n: number, r: Rec & { _kind: string }): string {
  const id = str(r.piid) || str(r.contract_id) || 'number not recorded';
  const who = title(str(r.incumbent_name)) || 'incumbent not recorded';
  const agency = [title(str(r.awarding_agency)), title(str(r.awarding_sub_agency))].filter(Boolean).join(' / ') || 'agency not recorded';
  const city = title(str(r.place_of_performance_city));
  const st = str(r.place_of_performance_state);
  const place = st ? (city ? `${city}, ${st}` : st) : 'place of performance not reported';
  const end = str(r.period_of_performance_current_end) || 'end date not recorded';
  const kind = r._kind === 'contract'
    ? 'contract'
    : r._kind === 'order'
      ? `task/delivery order under ${str(r.parent_vehicle_piid) || 'its parent vehicle'}`
      : 'task/delivery order (parent vehicle not recorded)';
  const desc = clip(str(r.description), 70);
  const value = money(r.total_obligation);
  return `${n}. ${id} · ${who} · ${agency} · ${place} · ends ${end} · ${kind}${value ? ` · obligated ${value}` : ''}${desc ? ` · ${desc}` : ''}`;
}

/**
 * Render a get_expiring_contracts result. `offset` is the 0-based index of the first record to
 * display (continuations). Returns null when the result is not renderable (no _meta).
 */
export function renderExpiringRecords(result: Rec, opts: { offset?: number; pageSize?: number } = {}): RenderedRecords | null {
  const meta = (result?._meta && typeof result._meta === 'object' ? result._meta : null) as Rec | null;
  if (!meta) return null;
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? DISPLAY_PAGE, 50));
  const records = collectExpiringRecords(result);
  const retrieved = records.length;
  const reportedTotal = num(meta.total);
  // The tool's total counts matching rows; never show a total smaller than what was retrieved.
  const total = Math.max(reportedTotal ?? retrieved, retrieved);
  const state = str(meta.result_state);
  const offset = Math.max(0, Math.min(Math.floor(opts.offset ?? 0), Math.max(retrieved - 1, 0)));
  const page = records.slice(offset, offset + pageSize);
  const from = page.length ? offset + 1 : 0;
  const to = page.length ? offset + page.length : 0;
  const standalone = records.filter((r) => r._kind === 'contract').length;
  const orders = records.length - standalone;
  const lines: string[] = [];
  const filters = filterLine(meta);
  const ignored = ignoredLine(meta);

  if (state === 'unavailable' || meta.degraded === true) {
    lines.push(`Expiring-contract lookup failed (${filters}). This is not a zero: the data could not be retrieved. Try again.`);
  } else if (state === 'filter_not_applied' && retrieved === 0) {
    lines.push(`Expiring-contract search was not run as asked (${filters}).`);
  } else if (retrieved === 0) {
    lines.push(`No expiring contracts or task orders match (${filters}). Source: Mindy recompete data (USASpending).`);
  } else {
    lines.push(`${total} expiring record${total === 1 ? '' : 's'} match (${filters}). Source: Mindy recompete data (USASpending)${meta.window && (meta.window as Rec).as_of ? `, as of ${str((meta.window as Rec).as_of)}` : ''}.`);
    lines.push(`${standalone} standalone contract${standalone === 1 ? '' : 's'} and ${orders} task/delivery order${orders === 1 ? '' : 's'} were retrieved.`);
    const exhaustiveNow = from === 1 && to === total && retrieved === total;
    lines.push(exhaustiveNow
      ? `Showing all ${total}, soonest end date first.`
      : `Showing ${from}–${to} of ${total}, soonest end date first.`);
  }
  if (ignored) lines.push(ignored);
  if (page.length) {
    lines.push('');
    page.forEach((r, i) => lines.push(recordLine(offset + i + 1, r)));
  }
  const exhaustive = retrieved > 0 && from === 1 && to === total && retrieved === total;
  if (retrieved > 0 && !exhaustive) {
    lines.push('');
    if (to < retrieved) {
      const nextTo = Math.min(to + pageSize, retrieved);
      lines.push(`This is not the full list. Ask "show expiring records ${to + 1} to ${nextTo}" to continue.`);
    }
    if (retrieved < total) {
      lines.push(`Mindy retrieved ${retrieved} of the ${total} matching records; narrow the filters (for example by agency or a shorter window) to see the rest.`);
    }
  }
  const ids = page.map((r) => str(r.piid) || str(r.contract_id));
  const allowedCounts = Array.from(new Set([total, retrieved, page.length, standalone, orders, from, to].filter((n) => n >= 0)));
  return { tool: EXPIRING_TOOL, text: lines.join('\n'), total, retrieved, from, to, shown: page.length, exhaustive, ids, allowedCounts, standalone, orders };
}

/**
 * Chat-side argument preparation for list tools. Fetches the whole matched set (so every page is
 * exact) and removes the chat-only `display_offset` (0-based first record to display when the
 * customer continues a long list), which the MCP tool itself does not take.
 */
export function prepareChatToolArgs(name: string, rawArgs: string): { args: string; displayOffset: number } {
  if (name !== EXPIRING_TOOL) return { args: rawArgs, displayOffset: 0 };
  try {
    const a = JSON.parse(rawArgs || '{}');
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      const off = Number(a.display_offset);
      delete a.display_offset;
      a.limit = CHAT_FETCH_LIMIT;
      return { args: JSON.stringify(a), displayOffset: Number.isFinite(off) && off > 0 ? Math.floor(off) : 0 };
    }
  } catch { /* leave unparseable args for the executor to refuse */ }
  return { args: rawArgs, displayOffset: 0 };
}

const COUNT_NOUN = '(?:expiring\\s+|standalone\\s+|federal\\s+|matching\\s+)?(?:contracts?|records?|task\\s+orders?|delivery\\s+orders?|orders?|results?|awards?)';
const NUM = '(\\d[\\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/**
 * TOTAL claims only: "found 3 contracts", "there are 3 records", "3 records match", "a total of 3".
 * Subset analysis ("5 of the orders are VA", "3 contracts are with DOE") is legitimate and is not
 * checked; a false correction would itself be an accuracy defect.
 */
const TOTAL_CLAIMS: RegExp[] = [
  new RegExp(`\\b(?:found|identified|returned|retrieved|there (?:are|were)|i see|we have|lists?|shows?)\\s+(?:a total of\\s+|only\\s+|just\\s+)?${NUM}\\s+${COUNT_NOUN}\\b`, 'gi'),
  new RegExp(`\\b${NUM}\\s+${COUNT_NOUN}\\s+(?:match|matched|in total|total|were found|are expiring|expire)\\b`, 'gi'),
  new RegExp(`\\ba total of\\s+${NUM}\\b`, 'gi'),
];
const NONE_CLAIM = /\b(?:found no|did not find any|didn't find any|no (?:expiring\s+)?(?:contracts?|records?|orders?|results?) (?:match(?:ed)?|were found|found|are expiring))\b|\bthere are no (?:expiring\s+)?(?:contracts?|records?|orders?)(?=[.!]|\s*$)/i;

/**
 * Deterministic check of the model's analysis against the rendered records. Returns the problems
 * found (empty when consistent): a TOTAL count that matches none of the verified numbers, or an
 * unqualified "none" claim when records exist.
 */
export function checkSummaryAgainstRecords(summary: string, rendered: RenderedRecords[]): string[] {
  const problems: string[] = [];
  if (!summary || !rendered.length) return problems;
  const allowed = new Set(rendered.flatMap((r) => r.allowedCounts));
  const anyRecords = rendered.some((r) => r.retrieved > 0);
  const reported = new Set<number>();
  for (const re of TOTAL_CLAIMS) {
    for (const m of summary.matchAll(re)) {
      const raw = m[1].toLowerCase();
      const n = WORD_NUM[raw] ?? Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(n) || (n >= 1900 && n <= 2100) || allowed.has(n) || reported.has(n)) continue;
      reported.add(n);
      problems.push(`stated "${m[0].trim()}" but the verified counts are ${[...allowed].sort((a, b) => a - b).join(', ')}`);
    }
  }
  if (anyRecords && NONE_CLAIM.test(summary)) problems.push('claimed there were none while verified records exist');
  return problems;
}

export const PAST_CONTRACTS_TOOL = 'search_past_contracts';

function successorText(succ: unknown): string {
  const s = (succ && typeof succ === 'object' ? succ : null) as Rec | null;
  if (!s) return 'successor not checked';
  const state = str(s.state);
  if (state === 'candidates') {
    const cands = (Array.isArray(s.candidates) ? s.candidates : []) as Rec[];
    const items = cands.slice(0, 3).map((c) => {
      const ev = (c.evidence && typeof c.evidence === 'object' ? c.evidence : {}) as Rec;
      const label = str(c.confidence) || str(c.likelihood);
      const office = str(ev.same_piid_office_prefix);
      return `${str(c.awardId) || str(c.award_id)} · ${title(str(c.recipientName))}${c.description ? ` · ${clip(str(c.description), 60)}` : ''}${c.startDate ? ` · started ${str(c.startDate)}` : ''}${office ? ` · same office ${office}` : ''}${label ? ` (${label})` : ''}`;
    });
    return `possible successor${cands.length === 1 ? '' : 's'} found: ${items.join('; ')}`;
  }
  if (state === 'none_found') return `successor checked, none found${s.note ? ` (${clip(str(s.note), 120)})` : ''}`;
  if (state === 'unavailable') return 'successor check unavailable (source error, not a none)';
  return 'successor not checked (award still active or not near its end)';
}

/**
 * Render search_past_contracts results that carry status_checks ("is it still active / who replaced
 * it"): every checked award with its status, end date and successor result, plus the count of
 * matches that were not checked. Returns null when the result has no status_checks.
 */
export function renderStatusChecks(result: Rec): RenderedRecords | null {
  const checks = Array.isArray(result?.status_checks) ? (result.status_checks as Rec[]) : null;
  const meta = (result?._meta && typeof result._meta === 'object' ? result._meta : {}) as Rec;
  if (!checks) return null;
  const awards = (Array.isArray(result.awards) ? result.awards : []) as Rec[];
  const byId = new Map(awards.map((a) => [str(a.awardId), a]));
  const total = Math.max(num(meta.total) ?? awards.length, awards.length);
  const af = (meta.applied_filters && typeof meta.applied_filters === 'object' ? meta.applied_filters : {}) as Rec;
  const fparts: string[] = [];
  const val = (v: unknown) => (v && typeof v === 'object' ? str((v as Rec).value ?? (v as Rec).name) : str(v));
  if (af.keyword) fparts.push(`keyword "${val(af.keyword)}"`);
  if (af.piid_prefix) fparts.push(`number starting ${val(af.piid_prefix)}`);
  if (af.agency) fparts.push(`agency ${val(af.agency)}`);
  if (af.state) fparts.push(`place of performance ${val(af.state)}`);
  if (af.naics) fparts.push(`NAICS ${val(af.naics)}`);
  const lines: string[] = [];
  lines.push(`${total} award${total === 1 ? '' : 's'} match (${fparts.join(' · ') || 'no filters'}). Source: USASpending. Status checked for ${checks.length}:`);
  lines.push('');
  checks.forEach((c, i) => {
    const a = byId.get(str(c.award_id)) ?? {};
    const st = str(c.status);
    const days = num(c.days_until_end);
    const end = str(c.end_date) || 'end date not reported';
    const statusText = st === 'expired'
      ? `EXPIRED: ended ${end}${days != null ? ` (${Math.abs(days)} days ago)` : ''}`
      : st === 'active'
        ? `ACTIVE: ends ${end}${days != null ? ` (${days} days left)` : ''}`
        : st === 'not_started' ? `not started yet (ends ${end})` : `status unknown${c.error ? ` (${clip(str(c.error), 60)})` : ''}`;
    lines.push(`${i + 1}. ${str(c.award_id)} · ${title(str(a.recipientName)) || 'recipient not reported'}${a.description ? ` · ${clip(str(a.description), 70)}` : ''} · ${statusText} · ${successorText(c.successor)}`);
  });
  if (total > checks.length) {
    lines.push('');
    lines.push(`${total - checks.length} more matching award${total - checks.length === 1 ? ' was' : 's were'} not status-checked; this is not the full list.`);
  }
  if (meta.lag_note) lines.push(str(meta.lag_note));
  const ids = checks.map((c) => str(c.award_id));
  return {
    tool: PAST_CONTRACTS_TOOL, text: lines.join('\n'), total, retrieved: awards.length, from: checks.length ? 1 : 0, to: checks.length,
    shown: checks.length, exhaustive: total === checks.length, ids, allowedCounts: Array.from(new Set([total, awards.length, checks.length])), standalone: checks.length, orders: 0,
  };
}

export const BUYING_OFFICES_TOOL = 'get_buying_offices';

/**
 * Render get_buying_offices: each office with its code, agency, exact obligated dollars and share,
 * the customers (funding offices) behind it, and where the work was performed. Amounts are shown
 * exactly as returned (no rounding by a model). Returns null when there are no offices to show.
 */
export function renderBuyingOffices(result: Rec): RenderedRecords | null {
  const offices = Array.isArray(result?.offices) ? (result.offices as Rec[]) : null;
  const meta = (result?._meta && typeof result._meta === 'object' ? result._meta : {}) as Rec;
  if (!offices) return null;
  const scope = (result.scope && typeof result.scope === 'object' ? result.scope : {}) as Rec;
  const totals = (result.totals && typeof result.totals === 'object' ? result.totals : null) as Rec | null;
  const af = (meta.applied_filters && typeof meta.applied_filters === 'object' ? meta.applied_filters : {}) as Rec;
  const metro = (af.metro && typeof af.metro === 'object' ? af.metro : null) as Rec | null;
  const parts: string[] = [];
  if (Array.isArray(scope.naics) && scope.naics.length) parts.push(`NAICS ${(scope.naics as unknown[]).map(str).join(', ')}`);
  if (scope.state) parts.push(`work performed in ${str(scope.state)}`);
  if (metro) parts.push(`${title(str(metro.core_city))} metro (cities within ${str(metro.radius_miles)} miles)`);
  else if (Array.isArray(scope.cities) && scope.cities.length) parts.push(`cities ${(scope.cities as unknown[]).map((c) => title(str(c))).join(', ')}`);
  if (scope.window) parts.push(str(scope.window));
  const lines: string[] = [];
  if (!offices.length) {
    lines.push(`No buying offices found (${parts.join(' · ') || 'no filters'}). Source: USASpending prime awards.`);
  } else {
    const officeCount = num(totals?.office_count) ?? offices.length;
    lines.push(`${officeCount} buying office${officeCount === 1 ? '' : 's'} bought this work (${parts.join(' · ')}), ${money(totals?.obligated)} obligated across ${num(totals?.award_count) ?? '?'} awards. Source: USASpending prime awards; location is where the work was performed, not where the office sits.`);
    lines.push(offices.length < officeCount ? `Showing the top ${offices.length} of ${officeCount} by obligated dollars.` : `Showing all ${officeCount}, by obligated dollars.`);
    lines.push('');
    offices.forEach((o, i) => {
      const customers = (Array.isArray(o.top_funding_offices) ? (o.top_funding_offices as Rec[]) : []).slice(0, 3).map((f) => `${title(str(f.name))} ${money(f.obligated)}`).filter((x) => x.trim());
      const places = (Array.isArray(o.top_places) ? (o.top_places as Rec[]) : []).slice(0, 3).map((p) => [title(str(p.city)), str(p.state)].filter(Boolean).join(', ')).filter(Boolean);
      lines.push(`${i + 1}. ${str(o.office_name) || 'office name not reported'}${o.office_code ? ` (${str(o.office_code)})` : ''} · ${[title(str(o.agency)), title(str(o.sub_agency))].filter(Boolean).join(' / ')} · ${money(o.obligated)} (${str(o.share_pct)}%) · ${num(o.award_count) ?? 0} awards${customers.length ? ` · customers: ${customers.join('; ')}` : ''}${places.length ? ` · work performed in ${places.join('; ')}` : ''}`);
    });
  }
  const notes = Array.isArray(result.notes) ? (result.notes as unknown[]).map(str).filter(Boolean) : [];
  if (notes.length) { lines.push(''); notes.slice(0, 3).forEach((n) => lines.push(n)); }
  const total = num(totals?.office_count) ?? offices.length;
  return {
    tool: BUYING_OFFICES_TOOL, text: lines.join('\n'), total, retrieved: offices.length, from: offices.length ? 1 : 0, to: offices.length,
    shown: offices.length, exhaustive: offices.length === total, ids: offices.map((o) => str(o.office_code) || str(o.office_name)),
    allowedCounts: Array.from(new Set([total, offices.length, num(totals?.award_count) ?? -1].filter((n) => n >= 0))), standalone: offices.length, orders: 0,
  };
}
