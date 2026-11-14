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

import { US_STATE_NAMES } from '@/lib/utils/us-states';
import { interpretCapabilityNaics } from '@/lib/market/capability-naics';
/** A state named in a record's own description that differs from its reported place of performance. */
export function describedStateConflict(description: string, popState: string): string | null {
  if (!description || !popState) return null;
  for (const [code, name] of Object.entries(US_STATE_NAMES as Record<string, string>)) {
    if (code === popState) continue;
    const popName = (US_STATE_NAMES as Record<string, string>)[popState] ?? '';
    if (popName && popName.toLowerCase().includes(name.toLowerCase())) continue; // "West Virginia" contains "Virginia"
    if (new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i').test(description) || new RegExp(`\\(${code}\\)`).test(description)) return name;
  }
  return null;
}

import cityCoordsForPlaces from '@/data/us-city-coords.json';
let CITY_STATE_MAP: Map<string, Set<string>> | null = null;
function cityStateMap(): Map<string, Set<string>> {
  if (!CITY_STATE_MAP) {
    CITY_STATE_MAP = new Map();
    for (const k of Object.keys(cityCoordsForPlaces as Record<string, unknown>)) {
      const [c, st] = k.split('|');
      if (!c || !st) continue;
      const set = CITY_STATE_MAP.get(c) ?? new Set<string>();
      set.add(st);
      CITY_STATE_MAP.set(c, set);
    }
  }
  return CITY_STATE_MAP;
}
/**
 * A place named in the description with a place cue ("in the Phoenix area", "at Portsmouth
 * International Airport", "Curlew Job Corps Center") that is a known US city but has no city of that
 * name in the reported place-of-performance state. Unknown names are never flagged.
 */
export function describedPlaceConflict(description: string, popState: string): string | null {
  const stateHit = describedStateConflict(description, popState);
  if (stateHit) return stateHit;
  if (!description || !popState) return null;
  const up = description.toUpperCase();
  const cues = [
    /\b(?:IN THE|IN|AT|NEAR|AROUND)\s+([A-Z][A-Z.' -]{2,28}?)\s+(?:AREA|METRO|METROPOLITAN|REGION|INTERNATIONAL AIRPORT|AIRPORT|AIR BASE|COUNTY)\b/g,
    /\b([A-Z][A-Z.' -]{2,28}?)\s+(?:INTERNATIONAL AIRPORT|JOB CORPS(?: CENTER)?)\b/g,
  ];
  const scope = up.match(/\b(NATIONWIDE|NATION-WIDE|CONUS|THROUGHOUT THE (?:SOUTHERN|NORTHERN) BORDER|MULTIPLE STATES|ALL STATES|THROUGHOUT THE UNITED STATES)\b/);
  // A border region that includes the reported state is not a conflict (R11: a San Antonio guard
  // award "throughout the southern border" was wrongly marked).
  const BORDER: Record<string, string[]> = {
    'THROUGHOUT THE SOUTHERN BORDER': ['CA', 'AZ', 'NM', 'TX'],
    'THROUGHOUT THE NORTHERN BORDER': ['WA', 'ID', 'MT', 'ND', 'MN', 'WI', 'MI', 'OH', 'PA', 'NY', 'VT', 'NH', 'ME', 'AK'],
  };
  if (scope && !(BORDER[scope[1]]?.includes(popState.toUpperCase()))) return `${scope[1].toLowerCase()} (work beyond one state)`;
  const map = cityStateMap();
  for (const re of cues) {
    for (const m of up.matchAll(re)) {
      const words = m[1].trim().split(/\s+/);
      for (let n = Math.min(3, words.length); n >= 1; n--) {
        const name = words.slice(words.length - n).join(' ');
        const states = map.get(name);
        if (states) {
          if (!states.has(popState)) return name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
          break;
        }
      }
    }
  }
  return null;
}

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
  /** Records marked CHECK (expiring lists). */
  flaggedIds?: string[];
  /** Buying offices: each office's example award numbers (for cross-checking against CHECK records). */
  officeExamples?: Array<{ office: string; ids: string[] }>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function money(v: unknown): string {
  const n = num(v);
  if (n == null) return '';
  const r = Math.round(n);
  return r < 0 ? `-$${Math.abs(r).toLocaleString('en-US')}` : `$${r.toLocaleString('en-US')}`;
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

/** Stems of the customer's capability words; a record whose description has none was matched by code only. */
export function relevanceStems(phrases: string[]): string[] {
  const STOP = new Set(['services', 'service', 'work', 'support', 'contracts', 'contract', 'federal', 'and', 'the', 'for']);
  const out = new Set<string>();
  for (const p of phrases) for (const w of p.toLowerCase().split(/[^a-z]+/)) if (w.length >= 4 && !STOP.has(w)) out.add(w.slice(0, 5));
  return [...out];
}

let RELEVANCE_STEMS: string[] = [];
let REQUESTED_LABELS: string[] = [];

/** The requested capability the record's OWN description names (semantic relevance, positive evidence). */
export function describedRequestedWork(description: string, requestedLabels: string[]): string | null {
  if (!description || !requestedLabels.length) return null;
  const labels = interpretCapabilityNaics(description.replace(/_/g, ' ')).items.map((it) => it.label);
  return labels.find((l) => requestedLabels.includes(l)) ?? null;
}

/** A different capability the record's OWN description names (positive evidence only, from Mindy's lexicon). */
export function describedOtherWork(description: string, requestedLabels: string[]): string | null {
  if (!description || !requestedLabels.length) return null;
  const labels = interpretCapabilityNaics(description.replace(/_/g, ' ')).items.map((it) => it.label);
  if (!labels.length || labels.some((l) => requestedLabels.includes(l))) return null;
  return labels[0];
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
      ? `order under ${str(r.parent_vehicle_piid) || 'its parent vehicle'}`
      : 'order (parent vehicle not recorded)';
  const desc = clip(str(r.description), 180);
  const value = money(r.total_obligation);
  const conflict = describedPlaceConflict(str(r.description), st);
  const otherWork = describedOtherWork(str(r.description), REQUESTED_LABELS);
  const confirms = describedRequestedWork(str(r.description), REQUESTED_LABELS);
  const basis = confirms ? ` · description confirms: ${confirms}` : '';

  return `${n}. ${id} · ${who} · ${agency} · ${place} · ends ${end} · ${kind}${value ? ` · obligated ${value}` : ''}${desc ? ` · ${desc}` : ''}${conflict ? ` · CHECK: the description names ${conflict}, which is not in the reported place-of-performance state ${st}; this record may not belong to the requested place` : ''}${basis}${otherWork ? ` · CHECK: the description describes ${otherWork} work, not the work requested` : ''}`;
}

/**
 * Render a get_expiring_contracts result. `offset` is the 0-based index of the first record to
 * display (continuations). Returns null when the result is not renderable (no _meta).
 */
export function renderExpiringRecords(result: Rec, opts: { offset?: number; pageSize?: number; relevancePhrases?: string[]; requestedLabels?: string[] } = {}): RenderedRecords | null {
  RELEVANCE_STEMS = relevanceStems(opts.relevancePhrases ?? []);
  REQUESTED_LABELS = opts.requestedLabels ?? [];
  let flaggedIdsOut: string[] = [];
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
    lines.push(`${standalone} standalone contract${standalone === 1 ? '' : 's'} and ${orders} order${orders === 1 ? '' : 's'} under a vehicle (task orders, delivery orders or BPA calls) were retrieved.`);
    const af0 = (meta.applied_filters && typeof meta.applied_filters === 'object' ? meta.applied_filters : {}) as Rec;
    if (af0.naics) lines.push('Matched by industry (NAICS) code: the code is how the agency classified each contract and can include other work than the words you used, so check each description. Place of performance is as USASpending reports it.');
    const byAgency = new Map<string, number>();
    for (const r of records) { const a = title(str(r.awarding_agency)) || 'agency not recorded'; byAgency.set(a, (byAgency.get(a) ?? 0) + 1); }
    lines.push(`By awarding agency: ${[...byAgency.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([a, n]) => `${a} ${n}`).join('; ')}.`);
    if (REQUESTED_LABELS.length) {
      lines.push('Records tagged "description confirms" name the requested work in their own description (Mindy\'s term match). Untagged records match by industry code; the term match did not confirm their work, which does not mean the work differs.');
    }
    const flaggedRecs = records.filter((r) => describedPlaceConflict(str(r.description), str(r.place_of_performance_state)) || describedOtherWork(str(r.description), REQUESTED_LABELS));
    const flagged = flaggedRecs.length;
    flaggedIdsOut = flaggedRecs.map((r) => str(r.piid) || str(r.contract_id));
    if (flagged) lines.push(`Mindy marked ${flagged} record${flagged === 1 ? '' : 's'} CHECK because the description names a place outside the reported state or describes different work. This check only catches wording it recognizes, so an unmarked record can still describe other work; the count above includes every record as reported by USASpending.`);
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
  const pageIds = new Set(page.map((r) => str(r.contract_id) || str(r.piid)));
  const offPage = records
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !pageIds.has(str(r.contract_id) || str(r.piid)))
    .filter(({ r }) => describedPlaceConflict(str(r.description), str(r.place_of_performance_state)) || describedOtherWork(str(r.description), REQUESTED_LABELS));
  if (offPage.length) {
    lines.push('');
    lines.push(`Also marked CHECK (outside the rows shown above):`);
    offPage.forEach(({ r, i }) => lines.push(recordLine(i + 1, r)));
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
  const ids = [...page, ...offPage.map((x) => x.r)].map((r) => str(r.piid) || str(r.contract_id));
  const allowedCounts = Array.from(new Set([total, retrieved, page.length, standalone, orders, from, to].filter((n) => n >= 0)));
  return { tool: EXPIRING_TOOL, text: lines.join('\n'), total, retrieved, from, to, shown: page.length, exhaustive, ids, allowedCounts, standalone, orders, flaggedIds: flaggedIdsOut };
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
  const checked = (s.checked && typeof s.checked === 'object' ? s.checked : {}) as Rec;
  const limit = checked.truncated === true ? ' (the successor search hit its row limit; a smaller follow-on could be missed)' : '';
  return successorCore(s) + limit;
}

function successorCore(s: Rec): string {
  const state = str(s.state);
  if (state === 'candidates') {
    const cands = (Array.isArray(s.candidates) ? s.candidates : []) as Rec[];
    const items = cands.slice(0, 3).map((c) => {
      const ev = (c.evidence && typeof c.evidence === 'object' ? c.evidence : {}) as Rec;
      const label = str(c.strength) || str(c.confidence) || str(c.likelihood);
      const office = str(ev.same_piid_office_prefix);
      return `${str(c.awardId) || str(c.award_id)} · ${title(str(c.recipientName))}${c.description ? ` · ${clip(str(c.description), 60)}` : ''}${c.startDate ? ` · started ${str(c.startDate)}` : ''}${office ? ` · same office ${office}` : ''}${label ? ` (${label})` : ''}`;
    });
    return `candidate successor${cands.length === 1 ? '' : 's'} (unconfirmed; USASpending does not link follow-ons): ${items.join('; ')}`;
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
  // An empty search inside the publication-lag window is not a verified zero: state the tool's own
  // freshness note verbatim (a model paraphrase can lose the date it is current through).
  const awardsList = Array.isArray(result?.awards) ? (result.awards as Rec[]) : [];
  if (!checks && !awardsList.length && !meta.lag_note && Array.isArray(result?.awards) && !meta.degraded) {
    // acc6 R5: an empty result without a lag note was left to the model, which wrote "there are no
    // current awards". An empty search is reported with its filters and never as proof of none.
    const searched = awardFilterParts((meta.applied_filters && typeof meta.applied_filters === 'object' ? meta.applied_filters : {}) as Rec);
    const text = `No awards matched this search${searched.length ? ` (${searched.join(' · ')})` : ''}. This is NOT proof that no such contract exists: a keyword search matches only those words in award records, and an award described differently, recorded under another agency or location, or not yet published would not appear.${meta.auto_widened ? ' The search was also retried with the widest location scope.' : ''}`;
    return { tool: PAST_CONTRACTS_TOOL, text, total: 0, retrieved: 0, from: 0, to: 0, shown: 0, exhaustive: false, ids: [], allowedCounts: [0], standalone: 0, orders: 0 };
  }
  if (!checks && !awardsList.length && meta.lag_note) {
    const searched = awardFilterParts((meta.applied_filters && typeof meta.applied_filters === 'object' ? meta.applied_filters : {}) as Rec);
    const text = `No awards were found for this search${searched.length ? ` (${searched.join(' · ')})` : ' in the requested window'}, and that is NOT a verified zero.${meta.auto_widened ? ' The search was also retried with the widest location scope and still found nothing.' : ''} ${freshnessSentence(meta)}`;
    return { tool: PAST_CONTRACTS_TOOL, text, total: 0, retrieved: 0, from: 0, to: 0, shown: 0, exhaustive: false, ids: [], allowedCounts: [0], standalone: 0, orders: 0 };
  }
  if (!checks) return renderAwardList(result);
  const awards = (Array.isArray(result.awards) ? result.awards : []) as Rec[];
  const byId = new Map(awards.map((a) => [str(a.awardId), a]));
  const total = Math.max(num(meta.total) ?? awards.length, awards.length);
  const af = (meta.applied_filters && typeof meta.applied_filters === 'object' ? meta.applied_filters : {}) as Rec;
  const fparts = awardFilterParts(af);
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
  lines.push('Status is as reported to USASpending: a recent extension, option exercise or follow-on award may not appear yet.');
  if (meta.lag_note) lines.push(freshnessSentence(meta));
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
  if (metro) parts.push(`${title(str(metro.core_city))} metro (cities within ${str(metro.radius_miles)} miles${scope.state ? `, in ${str(scope.state)} only` : ''})`);
  else if (Array.isArray(scope.cities) && scope.cities.length) parts.push(`cities ${(scope.cities as unknown[]).map((c) => title(str(c))).join(', ')}`);
  const toolNotes = Array.isArray(result.notes) ? (result.notes as unknown[]).map(str) : [];
  const defaultedWindow = toolNotes.some((n) => /no window given|defaulted/i.test(n));
  if (scope.window) parts.push(`${str(scope.window)}${defaultedWindow ? ' (default window; none was given)' : ''}`);
  const lines: string[] = [];
  if (!offices.length) {
    lines.push(`No buying offices found (${parts.join(' · ') || 'no filters'}). Source: USASpending prime awards.`);
  } else {
    const officeCount = num(totals?.office_count) ?? offices.length;
    lines.push(`${officeCount} contracting office${officeCount === 1 ? '' : 's'} recorded award actions for this work (${parts.join(' · ')}), ${money(totals?.obligated)} net obligated (after deobligations) across ${num(totals?.award_count) ?? '?'} awards. Source: USASpending prime awards; location is where the work was performed, not where the office sits.`);
    lines.push('These are federal government contracting offices (buyers), not companies. Office totals are net of deobligations.');
    const positive = offices.filter((o) => (num(o.obligated) ?? 0) > 0).length;
    lines.push(`${offices.length < officeCount ? `Showing the top ${offices.length} of ${officeCount}` : `Showing all ${officeCount}`} by net obligations: ${positive} with positive net obligations are listed below${offices.length - positive ? `, and ${offices.length - positive} with zero or negative net obligations are listed separately` : ''}.`);
    lines.push('Ranked by obligations under the industry (NAICS) codes shown; a code can include other work than the words you used, so check the example awards listed for each office.');
    if (meta.as_of || meta.lag_note) lines.push(`Data freshness: ${meta.as_of ? `latest action loaded ${str(meta.as_of)}` : ''}${meta.as_of && meta.lag_note ? '; ' : ''}${meta.lag_note ? str(meta.lag_note) : ''}.`.replace(/\.\.$/, '.'));
    lines.push('');
    const buyers = offices.filter((o) => (num(o.obligated) ?? 0) > 0);
    const nonBuyers = offices.filter((o) => (num(o.obligated) ?? 0) <= 0);
    buyers.forEach((o, i) => {
      const customers = (Array.isArray(o.top_funding_offices) ? (o.top_funding_offices as Rec[]) : []).slice(0, 3).map((f) => `${title(str(f.name))} ${money(f.obligated)}`).filter((x) => x.trim());
      const places = (Array.isArray(o.top_places) ? (o.top_places as Rec[]) : []).slice(0, 3).map((p) => [title(str(p.city)), str(p.state)].filter(Boolean).join(', ')).filter(Boolean);
      const examples = (Array.isArray(o.example_awards) ? (o.example_awards as Rec[]) : []).slice(0, 2).map((e) => `${str(e.piid) || str(e.award_id)} ${money(e.obligated)}`).filter((x) => x.trim());
      lines.push(`${i + 1}. ${str(o.office_name) || 'office name not reported'}${o.office_code ? ` (${str(o.office_code)})` : ''} · ${[title(str(o.agency)), title(str(o.sub_agency))].filter(Boolean).join(' / ')} · ${money(o.obligated)} (${str(o.share_pct)}%) · ${num(o.award_count) ?? 0} awards${customers.length ? ` · customers: ${customers.join('; ')}` : ''}${places.length ? ` · work performed in ${places.join('; ')}` : ''}${examples.length ? ` · example awards (obligations in this window): ${examples.join('; ')}` : ''}`);
    });
    if (nonBuyers.length) {
      lines.push('');
      lines.push(`Also returned, with zero or negative net obligations in this window (deobligations, so not evidence of buying): ${nonBuyers.map((o) => `${str(o.office_name)}${o.office_code ? ` (${str(o.office_code)})` : ''} ${money(o.obligated)}`).join('; ')}.`);
    }
  }

  const total = num(totals?.office_count) ?? offices.length;
  return {
    tool: BUYING_OFFICES_TOOL, text: lines.join('\n'), total, retrieved: offices.length, from: offices.length ? 1 : 0, to: offices.length,
    shown: offices.length, exhaustive: offices.length === total, ids: offices.map((o) => str(o.office_code) || str(o.office_name)),
    officeExamples: offices.map((o) => ({ office: `${str(o.office_name)}${o.office_code ? ` (${str(o.office_code)})` : ''}`, ids: (Array.isArray(o.example_awards) ? (o.example_awards as Rec[]) : []).map((e) => str(e.piid) || str(e.award_id)).filter(Boolean) })),
    allowedCounts: Array.from(new Set([total, offices.length, num(totals?.award_count) ?? -1].filter((n) => n >= 0))), standalone: offices.length, orders: 0,
  };
}

export const PRICING_TOOL = 'get_pricing_intel';
export const KEYWORDS_TOOL = 'derive_company_keywords';

/** Render get_pricing_intel rate_summary: one line per rate (label then figure), with population and n. */
export function renderPricing(result: Rec): RenderedRecords | null {
  const rs = (result?.rate_summary && typeof result.rate_summary === 'object' ? result.rate_summary : null) as Rec | null;
  if (!rs) return null;
  const rates = (Array.isArray(rs.rates) ? rs.rates : []) as Rec[];
  if (!rates.length) return null;
  const pop = (rs.population && typeof rs.population === 'object' ? rs.population : {}) as Rec;
  const lines: string[] = [];
  lines.push(`GSA CALC+ labor rates (${str(rs.unit) || 'USD per hour'}), ${str(pop.description) || 'CALC records'}, n=${str(pop.n)}:`);
  for (const r of rates) {
    const lbl = str(r.label);
    const name = lbl ? lbl[0].toUpperCase() + lbl.slice(1) : 'Rate';
    const also = r.also_called ? ` (${str(r.also_called)})` : '';
    const median = str(r.also_called).toLowerCase().includes('median') ? `\nMedian: $${Number(r.hourly).toFixed(2)}/hr (same figure as the competitive rate: 50th percentile, n=${str(r.n)})` : '';
    lines.push(`${name}: $${Number(r.hourly).toFixed(2)}/hr${also} · ${str(r.percentile)}th percentile · n=${str(r.n)}${median}`);
  }
  if (rs.ordering) lines.push(`Ordering: ${str(rs.ordering)}${rs.ordering_holds === false ? ' (NOT satisfied by this data)' : ''}.`);
  const n = num(pop.n) ?? 0;
  return { tool: PRICING_TOOL, text: lines.join('\n'), total: n, retrieved: n, from: 0, to: 0, shown: rates.length, exhaustive: true, ids: [], allowedCounts: [n], standalone: 0, orders: 0 };
}

/** Render derive_company_keywords: every keyword and occupational title with its sources; excluded terms. */
export function renderKeywords(result: Rec): RenderedRecords | null {
  const kws = (Array.isArray(result?.keyword_sources) ? result.keyword_sources : null) as Rec[] | null;
  if (!kws) return null;
  const occ = (Array.isArray(result.occupational_titles) ? result.occupational_titles : []) as Rec[];
  const src = (k: Rec) => ((Array.isArray(k.sources) ? k.sources : []) as Rec[])
    .map((x) => `${str(x.type).replace(/_/g, ' ')}${x.n != null ? ` n=${str(x.n)}` : ''}`).join('; ');
  const lines: string[] = [];
  lines.push(`Keywords (${kws.length}), each with where it came from:`);
  kws.forEach((k, i) => lines.push(`${i + 1}. ${str(k.keyword)} · ${src(k) || 'source not reported'}`));
  const kwSet = new Set(kws.map((k) => str(k.keyword).toLowerCase()));
  const extraOcc = occ.filter((o) => !kwSet.has(str(o.keyword).toLowerCase()));
  if (extraOcc.length) {
    lines.push('');
    lines.push(`Related job titles (${extraOcc.length} more). Each line shows its source: "calc labor category" titles are GSA CALC labor categories found by a word from your description; "solicitation text" titles appeared in SAM solicitations under the industry codes for this work. Mindy has not confirmed that each title is this kind of work:`);
    extraOcc.forEach((o, i) => lines.push(`${kws.length + i + 1}. ${str(o.keyword)} · ${src(o) || 'source not reported'}`));
  }
  const ex = (result.excluded_terms && typeof result.excluded_terms === 'object' ? result.excluded_terms : null) as Rec | null;
  if (ex) {
    const terms = Array.from(new Set(Object.values(ex).filter((v) => Array.isArray(v)).flatMap((v) => (v as unknown[]).map(str)).filter(Boolean)));
    if (terms.length) { lines.push(''); lines.push(`Left out on purpose (company names and places are not search terms): ${terms.join(', ')}.`); }
  }
  const total = kws.length + extraOcc.length;
  return { tool: KEYWORDS_TOOL, text: lines.join('\n'), total, retrieved: total, from: total ? 1 : 0, to: total, shown: total, exhaustive: true, ids: [], allowedCounts: [total, kws.length, extraOcc.length], standalone: total, orders: 0 };
}


/**
 * Customer-facing freshness sentence. The tool's lag_note is written for the model ("Treat an empty
 * result as ... NOT as 'no award was made'") and must not be shown verbatim; only its facts are.
 */
export function freshnessSentence(meta: Rec): string {
  const note = str(meta.lag_note);
  const through = note.match(/current through (?:about )?(\d{4}-\d{2}-\d{2})/i)?.[1];
  const delay = note.match(/~?(\d+)-day delay/i)?.[1];
  const loaded = str(meta.as_of) || note.match(/last loaded (\d{4}-\d{2}-\d{2})/i)?.[1] || '';
  if (!through) return note ? 'Recent awards may not be published yet, so this list may be incomplete.' : '';
  // Name whose actions are delayed from the note itself, never "this agency" (R10: a DoD delay
  // sentence over a list with no DoD awards read as applying to the list's agencies).
  const afA = (meta.applied_filters && typeof meta.applied_filters === 'object' ? (meta.applied_filters as Rec).agency : null) as Rec | string | null;
  const agencyName = afA && typeof afA === 'object' ? str(afA.name) : str(afA);
  const who = /\bDoD\b|Defense/i.test(note) ? 'Defense (DoD, including Navy, Army and Air Force) contract actions reach'
    : agencyName && /by this agency/i.test(note) ? `${agencyName} contract actions reach` : 'Contract actions for this search reach';
  return `${who} USASpending with about a ${delay || '90'}-day delay, so that data is reliably current through about ${through} only${loaded ? ` (last loaded ${loaded})` : ''}; awards made after that may not appear yet. For newer awards, check SAM.gov award notices or the agency's announcements.`;
}


/** The filters a search_past_contracts call actually applied, in customer words (from _meta.applied_filters). */
function awardFilterParts(af: Rec): string[] {
  const val = (v: unknown) => (v && typeof v === 'object' ? str((v as Rec).value ?? (v as Rec).name ?? (v as Rec).code) : Array.isArray(v) ? (v as unknown[]).map(str).join(', ') : str(v));
  const parts: string[] = [];
  const retry = (af.keyword_retry && typeof af.keyword_retry === 'object' ? af.keyword_retry : null) as Rec | null;
  if (retry) parts.push(`keyword "${str(retry.used)}" (your wording "${str(retry.requested)}" matched nothing, so Mindy searched without the agency words and with abbreviations spelled out)`);
  else if (af.keyword) parts.push(`keyword "${val(af.keyword)}"`);
  if (af.office && typeof af.office === 'object') parts.push(`office ${str((af.office as Rec).code)} ${str((af.office as Rec).name)}`);
  else if (af.piid_prefix) parts.push(`number starting ${val(af.piid_prefix)}`);
  if (af.agency) parts.push(`agency ${val(af.agency)}`);
  if (af.naics) parts.push(`NAICS ${val(af.naics)}`);
  if (af.psc) parts.push(`PSC ${val(af.psc)}`);
  if (af.state) parts.push(`state ${val(af.state)}${(af.state as Rec)?.scope ? ` (${str((af.state as Rec).scope) === 'pop' ? 'place of performance' : str((af.state as Rec).scope)})` : ''}`);
  if (af.date_from || af.date_to) parts.push(`activity ${str(af.date_from) || '...'} to ${str(af.date_to) || 'today'}`);
  return parts;
}

export const SBLO_TOOL = 'get_sblo_contact';

/**
 * Render get_sblo_contact: a named small business liaison only when the record has one; otherwise the
 * firm's registered SAM points of contact WITH the tool's own label that they are not a designated
 * small business liaison (acc6c R8: the free-text answer dropped that label and presented general
 * contacts as the liaison the customer asked for). Email/phone are never invented.
 */
export function renderSbloContact(result: Rec): RenderedRecords | null {
  const c = (result?.contact && typeof result.contact === 'object' ? result.contact : null) as Rec | null;
  const poc = (result?.registered_points_of_contact && typeof result.registered_points_of_contact === 'object' ? result.registered_points_of_contact : null) as Rec | null;
  const meta = (result?._meta && typeof result._meta === 'object' ? result._meta : {}) as Rec;
  if (!c && !poc) return null;
  const company = title(str(c?.company) || str(poc?.company)) || 'this company';
  const lines: string[] = [];
  if (c && str(c.sblo_name)) {
    lines.push(`Designated small business liaison for ${company}: ${str(c.sblo_name)}${str(c.title) ? `, ${str(c.title)}` : ''}${str(c.email) ? ` · ${str(c.email)}` : ''}${str(c.phone) ? ` · ${str(c.phone)}` : ''}. Source: ${str(c.source) || 'not reported'}.`);
  } else {
    lines.push(`No designated small business liaison is on record for ${company}${str(c?.uei) || str(poc?.uei) ? ` (UEI ${str(c?.uei) || str(poc?.uei)})` : ''}.`);
  }
  const people = (Array.isArray(poc?.contacts) ? poc!.contacts : []) as Rec[];
  if (people.length) {
    lines.push('');
    lines.push(`Registered SAM.gov points of contact (${people.length}), labeled by the source as "${str(poc!.label) || 'registered SAM point of contact'}"${str(poc!.as_of) ? `, as of ${str(poc!.as_of).slice(0, 10)}` : ''}:`);
    people.forEach((p, i) => {
      const roles = (Array.isArray(p.roles) ? p.roles : []).map(str).filter(Boolean);
      lines.push(`${i + 1}. ${str(p.name) || 'name not reported'}${str(p.title) ? `, ${str(p.title)}` : ''}${roles.length ? ` · ${roles.join(', ')}` : ''}`);
    });
    lines.push('SAM.gov withholds these contacts\' email and phone on its public data, so none is shown; reach them through the firm\'s website or a channel listed on its SAM registration.');
  }
  if (!people.length && !(c && str(c.sblo_name))) lines.push('No registered SAM.gov point of contact was found either; that is not proof the firm has none.');
  return { tool: SBLO_TOOL, text: lines.join('\n'), total: people.length, retrieved: people.length, from: people.length ? 1 : 0, to: people.length, shown: people.length, exhaustive: true, ids: [], allowedCounts: [people.length], standalone: 0, orders: 0 };
}

export const VEHICLE_MIX_TOOL = 'get_vehicle_spend_mix';

/** search_past_contracts WITHOUT status checks: every returned award with dates and amount, count vs total, filters, date-filter meaning, lag. */
export function renderAwardList(result: Rec): RenderedRecords | null {
  const awards = Array.isArray(result?.awards) ? (result.awards as Rec[]) : null;
  if (!awards || !awards.length) return null;
  const meta = (result._meta && typeof result._meta === 'object' ? result._meta : {}) as Rec;
  const basis = (result.basis && typeof result.basis === 'object' ? result.basis : {}) as Rec;
  const af = (meta.applied_filters && typeof meta.applied_filters === 'object' ? meta.applied_filters : {}) as Rec;
  const parts = awardFilterParts(af);
  const total = Math.max(num(meta.total) ?? awards.length, awards.length);
  const lines: string[] = [];
  lines.push(`${total} award${total === 1 ? '' : 's'} match (${parts.join(' · ') || 'no filters'}). Source: USASpending prime awards.`);
  lines.push(awards.length < total ? `Showing ${awards.length} of ${total} (largest first); this is not the full list.` : `Showing all ${total}.`);
  if (basis.date_filter) lines.push(`Date filter: ${str(basis.date_filter)}`);
  const from = str(af.date_from);
  if (from) {
    const before = awards.filter((a) => str(a.startDate) && str(a.startDate) < from);
    if (before.length) lines.push(`${before.length} of the awards shown started before ${from} (${before.map((a) => `${str(a.awardId)} started ${str(a.startDate)}`).join('; ')}); they appear because they had activity in the window.`);
  }
  const latest = [...awards].filter((a) => str(a.startDate)).sort((x, y) => (str(y.startDate) < str(x.startDate) ? -1 : 1))[0];
  if (latest) lines.push(`Latest start date shown: ${str(latest.startDate)} (${str(latest.awardId)}, ${title(str(latest.recipientName))}).`);
  const byRecipient = new Map<string, number>();
  for (const a of awards) { const k = title(str(a.recipientName)) || 'recipient not reported'; byRecipient.set(k, (byRecipient.get(k) ?? 0) + 1); }
  lines.push(`By recipient (awards shown): ${[...byRecipient.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([k, n]) => `${k} ${n}`).join('; ')}.`);
  const office = (af.office && typeof af.office === 'object' ? af.office : null) as Rec | null;
  const cands = office && Array.isArray(office.candidates) ? (office.candidates as unknown[]).map(str) : [];
  const others = cands.filter((c) => !c.startsWith(`${str(office?.code)} `));
  if (others.length) lines.push(`Other office codes matching "${str(office?.requested)}" were found but not searched: ${others.join('; ')}.`);
  lines.push('');
  awards.forEach((a, i) => {
    lines.push(`${i + 1}. ${str(a.awardId)} · ${title(str(a.recipientName)) || 'recipient not reported'}${a.description ? ` · ${clip(str(a.description), 180)}` : ''} · ${str(a.startDate) || '?'} to ${str(a.endDate) || '?'} · ${money(a.awardAmount)} lifetime${a.popState ? ` · performed in ${str(a.popState)}` : ''}`);
  });
  const ig = ignoredLine(meta);
  if (ig) { lines.push(''); lines.push(ig); }
  if (meta.lag_note || str(meta.result_state) === 'partial') { lines.push(''); lines.push(`Data status: ${str(meta.result_state) === 'partial' ? 'may be incomplete' : str(meta.result_state) || 'may be incomplete'}.${meta.lag_note ? ` ${freshnessSentence(meta)}` : ''}`); }
  return { tool: PAST_CONTRACTS_TOOL, text: lines.join('\n'), total, retrieved: awards.length, from: 1, to: awards.length, shown: awards.length, exhaustive: awards.length === total, ids: awards.map((a) => str(a.awardId)), allowedCounts: Array.from(new Set([total, awards.length])), standalone: awards.length, orders: 0 };
}

/** get_vehicle_spend_mix: every bucket with dollars, share and award count; rollups; classification quality. */
export function renderVehicleMix(result: Rec): RenderedRecords | null {
  const buckets = Array.isArray(result?.buckets) ? (result.buckets as Rec[]) : null;
  if (!buckets) return null;
  const scope = (result.scope && typeof result.scope === 'object' ? result.scope : {}) as Rec;
  const cls = (result.classification && typeof result.classification === 'object' ? result.classification : {}) as Rec;
  const roll = (result.rollups && typeof result.rollups === 'object' ? result.rollups : {}) as Rec;
  const lines: string[] = [];
  lines.push(`Spending by contract vehicle (NAICS ${(Array.isArray(scope.naics) ? scope.naics as unknown[] : []).map(str).join(', ')}${scope.agency ? ` · ${str(scope.agency)}` : ''}${scope.state ? ` · ${str(scope.state)}` : ''} · ${str(scope.window)}): ${money(result.total_obligated)} obligated across ${num(result.total_award_count) ?? '?'} awards. Every bucket is listed; shares are of that total.`);
  lines.push('');
  buckets.filter((b) => (num(b.obligated) ?? 0) !== 0 || (num(b.award_count) ?? 0) > 0).forEach((b, i) => {
    lines.push(`${i + 1}. ${str(b.label)}: ${money(b.obligated)} (${str(b.share_pct)}%) · ${num(b.award_count) ?? 0} awards`);
  });
  const r = (k: string) => (roll[k] && typeof roll[k] === 'object' ? roll[k] as Rec : null);
  const rl = [['all schedules', r('all_schedules')], ['all BPAs', r('all_bpas')], ['all IDIQs and GWACs', r('all_idiqs_and_gwacs')]].filter(([, v]) => v).map(([k, v]) => `${k} ${money((v as Rec).obligated)} (${str((v as Rec).share_pct)}%)`);
  if (rl.length) { lines.push(''); lines.push(`Rollups: ${rl.join('; ')}.`); }
  const vmeta = (result._meta && typeof result._meta === 'object' ? result._meta : {}) as Rec;
  if (vmeta.as_of || vmeta.lag_note) lines.push(`Data freshness: ${vmeta.as_of ? `latest action loaded ${str(vmeta.as_of)}` : ''}${vmeta.as_of && vmeta.lag_note ? '; ' : ''}${vmeta.lag_note ? str(vmeta.lag_note) : ''}.`.replace(/\.\.$/, '.'));
  lines.push(`Classification: of the dollars linked to a vehicle, ${str(cls.verified_share_of_parented_pct)}% were verified from USASpending vehicle records. Of all dollars, ${str(cls.heuristic_share_of_total_pct)}% were typed from contract-number patterns and ${str(cls.unresolved_share_of_total_pct)}% could not be classified.`);
  const n = buckets.length;
  return { tool: VEHICLE_MIX_TOOL, text: lines.join('\n'), total: n, retrieved: n, from: 1, to: n, shown: n, exhaustive: true, ids: [], allowedCounts: [n, num(result.total_award_count) ?? 0], standalone: 0, orders: 0 };
}

const MAGNITUDE_RE = /\b(substantial(ly)?|significant(ly)?|major|minor|slight(ly)?|frequent(ly)?|prevalent|dominant|dominat\w*|primarily|predominantly|mostly|most of|the bulk|largest share|key player|heavily|considerabl[ey]|notabl[ey] large|large(ly)?|small(er)? share|a lot of|many of|numerous|common(ly)?|typical(ly)?|often|rarely|popular|majority|minority|half|bulk)\b/i;
const IMPERATIVE_RE = /^(review|check|open|ask|contact|compare|look|visit|search|verify|confirm|request|read|use|reach|track|save|monitor)\b/i;
const SUPERLATIVE_RE = /\b(most|least|latest|newest|oldest|earliest|recent|largest|biggest|smallest|highest|lowest|top|leading|prominent|notabl[ey]|key|main|primary|first|only|all of|every)\b/i;
const APPROX_MONEY_RE = /\b(approximately|approx\.?|about|around|roughly|nearly|almost|over|under|more than|less than|some)\s+\$/i;

/**
 * Deterministic check of the model's analysis when a verified list was rendered. Drops sentences that
 * use a magnitude/frequency word with no number in the same sentence, or approximate a dollar figure
 * (the list shows the exact one). Returns the kept text and what was dropped (for the trace).
 */
export function lintAnalysis(text: string, fallback = 'Review each record and its CHECK lines above before pursuing it.'): { text: string; dropped: string[] } {
  const src = String(text || '').trim();
  if (!src) return { text: '', dropped: [] };
  const sentences = src.split(/(?<=[.!?])\s+|\n+/);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim().replace(/^(?:next|then|also),?\s+/i, (m) => m);
    if (!s) continue;
    // Next-step guidance is imperative. A declarative sentence ("You have...", "These offices...",
    // "If you're interested...") summarizes or characterizes the records, which is the list's job.
    const core = s.replace(/^(?:next|then|also),?\s+/i, '');
    if (!IMPERATIVE_RE.test(core)) { dropped.push(s); continue; }
    const hasNumber = /\d/.test(s);
    if (hasNumber || /\$/.test(s) || MAGNITUDE_RE.test(s) || SUPERLATIVE_RE.test(s) || APPROX_MONEY_RE.test(s)) { dropped.push(s); continue; }
    kept.push(s);
  }
  const out = kept.join(' ').replace(/\s+\n/g, '\n').trim();
  return { text: out || fallback, dropped };
}

/** Cross-check within one answer: an office whose example award is a CHECK record says so. */
export function crossCheckOffices(rendered: RenderedRecords[]): void {
  const flagged = new Set(rendered.flatMap((r) => r.flaggedIds ?? []));
  const shown = new Set(rendered.flatMap((r) => r.ids));
  if (!flagged.size) return;
  for (const r of rendered) {
    if (!r.officeExamples) continue;
    const notes = r.officeExamples
      .map((o) => {
        const code = (o.office.match(/\(([A-Z0-9]{5,6})\)\s*$/) ?? [])[1] ?? '';
        const byExample = o.ids.filter((id) => flagged.has(id));
        const byPrefix = code ? [...flagged].filter((id) => id.toUpperCase().startsWith(code) && !byExample.includes(id)) : [];
        return { office: o.office, hits: [...byExample, ...byPrefix] };
      })
      .filter((o) => o.hits.length)
      .map((o) => `${o.office}: its award${o.hits.length === 1 ? '' : 's'} ${o.hits.join(', ')} ${o.hits.length === 1 ? 'is' : 'are'} marked CHECK in the expiring list (different work or place), so this office's total may include work that is not what you asked for`);
    if (notes.length) r.text += `\n\nCHECK: ${notes.join('; ')}.`;
  }
}
