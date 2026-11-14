/**
 * Evidence-based grader for Ask Mindy regression scenarios.
 *
 * Replaces phrase-only checks, which passed two answers that said "no expiring contracts" while
 * the tool evidence held qualifying records (baseline 2026-11-13). Every assertion here is
 * checked against the TOOL EVIDENCE of the turn (tool names, redacted args, result excerpts),
 * not just the wording of the answer.
 *
 * Verdicts: 'pass' | 'partial' | 'fail'. A partial is NOT a success and never counts toward the
 * pass score.
 */
export interface ToolEvidence {
  tool: string;
  status: string;
  error_category?: string | null;
  args?: Record<string, unknown> | null;
  result_excerpt?: string;
  /** True when result_excerpt is shorter than the full tool result (evidence incomplete). */
  truncated?: boolean;
}

export interface Scenario {
  id: string;
  prompt: string;
  /** No tool call → fail. */
  require_tool?: boolean;
  /** Each group needs ≥1 term present in the ANSWER (case-insensitive). */
  required_groups?: string[][];
  /** Terms that, when they appear in the answer, must also appear in the evidence. */
  must_be_in_evidence_if_stated?: string[];
  /** Answer must contain at least `min` of `terms`. */
  min_matches?: { terms: string[]; min: number };
  /** Any of these in the answer → fail. */
  forbid?: string[];
  /** Any of these inside a numbered/bulleted list item → fail. */
  list_items_forbid?: string[];
  /** Requested filters: each value must be searched (tool args) or explicitly disclosed. */
  expected_filters?: { state?: string[]; naics_prefix?: string[] };
  /** Arg names the user did NOT ask for; using them without disclosure → fail. */
  unrequested_filters?: Array<'state' | 'naics' | 'agency'>;
  /** Known qualifying records: a "none" claim while any is in the answer or evidence → fail. */
  qualifying_records?: string[];
  /** Date window the question asked about (months from today). */
  window_months?: number;
  /** Price-point ordering check (aggressive < competitive <= median < premium). */
  price_order?: boolean;
  /** If every required group is satisfied except these, the verdict is partial, not fail. */
  partial_if_only?: string[][];
}

export interface GradeResult {
  verdict: 'pass' | 'partial' | 'fail';
  failures: string[];
  partials: string[];
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands',
};

const RECORD_WORDS = '(contracts?|awards?|records?|results?|orders?|opportunit\\w*|vehicles?|solicitations?|matches)';
// A "none" claim is a NEGATION applied directly to the records (≤ 2–3 intervening words), so hedges
// such as "no incumbent listed for these contracts" or "could not confirm whether any of these
// contracts…" are NOT read as claims that no contracts exist.
const NONE_CLAIMS: RegExp[] = [
  new RegExp(`\\b(no|there are no|there is no|there were no|no matching|no recorded)\\s+(\\w+\\s+){0,2}${RECORD_WORDS}\\b`, 'i'),
  new RegExp(`\\b(couldn'?t|could not|did not|didn'?t|was unable to|were unable to|unable to)\\s+(find|locate|identify|see)\\s+(any\\s+)?(\\w+\\s+){0,3}${RECORD_WORDS}\\b`, 'i'),
  new RegExp(`\\b(0|zero)\\s+(\\w+\\s+){0,3}${RECORD_WORDS}\\b`, 'i'),
  new RegExp(`\\b(found|returned|shows?|showed|turned up|came back)\\s+(nothing|none|zero|0|empty)\\b`, 'i'),
  new RegExp(`\\bnothing\\s+(qualifies|qualified|matches|matched|was found|is expiring|expires|came up)\\b`, 'i'),
  new RegExp(`\\bnone\\s+(were|was)?\\s*(found|listed|available|expiring)\\b`, 'i'),
  new RegExp(`\\b(search|results?|lookup)\\s+(came back|returned|was|were)\\s+(empty|blank)\\b`, 'i'),
];
const isNoneClaim = (answer: string) => NONE_CLAIMS.some((r) => r.test(answer));
/** An explicit statement that a value was NOT searched/included, or that ONLY others were. */
const DISCLOSURE = /\b(not|n't|never|unable to|cannot|can't)\s+(\w+\s+){0,2}(search|check|includ|cover|quer|filter)\w*|\bonly\s+(search|check|cover|includ|filter)\w*|\b(excluded|excluding|left out|omitted|outside (the |my )?(search|scope))\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const lc = (s: string) => s.toLowerCase();
const has = (hay: string, needle: string) => lc(hay).includes(lc(needle));
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word, case-insensitive match (so "VA" is not found inside "available"). */
const hasWord = (hay: string, word: string) => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(word)}([^A-Za-z0-9]|$)`, 'i').test(hay);

function evidenceText(ev: ToolEvidence[]): string {
  return ev.map((e) => `${e.tool} ${JSON.stringify(e.args ?? {})} ${e.result_excerpt ?? ''}`).join('\n');
}

/** Values for `keys` from top-level args AND the structured containers (filters, advanced). */
function argValues(ev: ToolEvidence[], keys: string[]): string[] {
  const out: string[] = [];
  const push = (x: unknown) => { if (typeof x === 'string') out.push(...x.split(',').map((s) => s.trim()).filter(Boolean)); };
  for (const e of ev) {
    const scopes = [e.args, e.args?.filters, e.args?.advanced].filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
    for (const scope of scopes) {
      for (const k of keys) {
        const v = scope[k];
        if (Array.isArray(v)) v.forEach(push); else push(v);
      }
    }
  }
  return out;
}

function disclosed(answer: string, value: string, name?: string): boolean {
  const terms = [value, name].filter(Boolean) as string[];
  for (const sentence of answer.split(/(?<=[.!?;\n])\s+/)) {
    if (terms.some((t) => hasWord(sentence, t)) && DISCLOSURE.test(sentence)) return true;
  }
  return false;
}

/** Dates written as "Mar 31, 2027", "March 31, 2027" or "2027-03-31". */
export function extractDates(text: string): Date[] {
  const out: Date[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi)) {
    out.push(new Date(Date.UTC(+m[3], MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), +m[2])));
  }
  return out;
}

/**
 * Identifier-like tokens, matched against evidence with hyphens removed:
 *   - UUIDs and 32-hex SAM notice ids (bare or inside a sam.gov link)
 *   - uppercase PIID / solicitation forms (≥ 10 chars without hyphens, ≥ 3 digits, ≥ 1 letter)
 *   - lowercase compact forms (no hyphen, ≥ 5 digits), e.g. a PIID typed in lowercase
 * Ordinary prose shapes are excluded: FY2026-FY2027, ISO-9001-2015, CMMC-L2-2025, NAICS-541512,
 * Q3-2026-update, HUBZone-2024, B2B-2025-pilot.
 * Known limitation: ids shorter than 10 characters (e.g. a 6-character DoDAAC) are not checked.
 */
const PROSE_PREFIX = /^(FY|ISO|CMMC|NAICS|PSC|NIST|SOC|Q[1-4]|SP|AS|ITAR|EAR)\d*-?/;
export function extractIds(text: string): string[] {
  const ids = new Set<string>();
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  for (const m of text.matchAll(uuid)) ids.add(m[0]);
  let rest = text.replace(uuid, ' ');
  for (const m of rest.matchAll(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi)) {
    if (/[a-f]/i.test(m[0]) && /\d/.test(m[0])) ids.add(m[0]);
  }
  rest = rest.replace(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi, ' ');
  for (const m of rest.matchAll(/(?<![A-Za-z0-9])[A-Z0-9]+(?:-[A-Z0-9]+)*(?![A-Za-z0-9])/g)) {
    const t = m[0];
    const compact = t.replace(/-/g, '');
    if (compact.length >= 10 && compact.length <= 26 && /[A-Z]/.test(t) && (t.match(/\d/g) ?? []).length >= 3 && !PROSE_PREFIX.test(t)) ids.add(t);
  }
  for (const m of rest.matchAll(/(?<![A-Za-z0-9-])[a-z0-9]{10,20}(?![A-Za-z0-9-])/g)) {
    const t = m[0];
    if (/[a-z]/.test(t) && (t.match(/\d/g) ?? []).length >= 5) ids.add(t);
  }
  return [...ids];
}
const idInEvidence = (evText: string, id: string) => lc(evText).replace(/-/g, '').includes(lc(id).replace(/-/g, ''));

/** Exact dollar amounts ≥ $1,000 written with digits (e.g. $1,302,252.96). */
export function extractAmounts(text: string): string[] {
  // The sign is part of the amount: "-$6,047" (a net deobligation) is -6047, not 6047. Accepts a hyphen,
  // a Unicode minus or an en dash before or right after "$". Positive amounts are unchanged.
  return [...text.matchAll(/([-\u2212\u2013])?\$\s?([-\u2212\u2013])?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)(?!\s*(?:[KMB]|million|billion|thousand)\b)/gi)]
    .map((m) => `${m[1] || m[2] ? '-' : ''}${m[3].replace(/,/g, '')}`);
}

/**
 * An amount is supported when the evidence holds a money value within $1 of it (rounded amounts
 * allowed): any value of a money-like field (key may contain digits, e.g. "fy2025_obligations"),
 * any "$"-prefixed number in a non-JSON excerpt, or the exact decimal anywhere. A bare unrelated
 * number (e.g. "limit": 1000) does not support "$1,000".
 */
function evidenceMoney(evText: string): number[] {
  const flat = evText.replace(/(\d),(?=\d{3})/g, '$1');
  const out: number[] = [];
  for (const m of flat.matchAll(/"[A-Za-z0-9 _]*(amount|obligat|value|price|ceiling|total|spend|dollar|rate|cost)[A-Za-z0-9 _]*"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/gi)) out.push(Number(m[2]));
  for (const m of flat.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)) out.push(Number(m[1]));
  return out;
}
function amountInEvidence(evText: string, amt: string): boolean {
  const flat = evText.replace(/(\d),(?=\d{3})/g, '$1');
  // Exact-decimal match keeps the sign: "-6047.22" never matches a positive "6047.22" and vice versa.
  if (amt.includes('.') && new RegExp(amt.startsWith('-') ? `(^|[^0-9.])${escapeRe(amt)}([^0-9]|$)` : `(^|[^0-9.-])${escapeRe(amt)}([^0-9]|$)`).test(flat)) return true;
  const n = Number(amt);
  return evidenceMoney(evText).some((x) => Math.abs(x - n) < 1);
}

function pricePoints(answer: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const label of ['aggressive', 'competitive', 'median', 'premium']) {
    const m = answer.match(new RegExp(`${label}[^$\\n]{0,40}\\$\\s?(\\d+(?:\\.\\d+)?)`, 'i'));
    if (m) out[label] = Number(m[1]);
  }
  return out;
}

export function grade(s: Scenario, answer: string, evidence: ToolEvidence[], today = new Date()): GradeResult {
  const failures: string[] = [];
  const partials: string[] = [];
  const evText = evidenceText(evidence);
  const ran = evidence.filter((e) => e.status === 'success');

  if (s.require_tool && ran.length === 0) failures.push('no_tool_result');

  const truncated = evidence.some((e) => e.truncated);

  // 1. "None" claims that contradict the evidence or the answer itself.
  const noneClaim = isNoneClaim(answer);
  if (noneClaim) {
    const inEvidence = (s.qualifying_records ?? []).filter((r) => has(evText, r));
    const inAnswer = (s.qualifying_records ?? []).filter((r) => has(answer, r));
    if (inEvidence.length || inAnswer.length) failures.push(`none_claim_contradicts_records:${[...new Set([...inAnswer, ...inEvidence])].join('|')}`);
    else if (truncated && (s.qualifying_records ?? []).length) partials.push('unverifiable_none_claim_evidence_truncated');
    if (s.window_months) {
      const end = new Date(today); end.setUTCMonth(end.getUTCMonth() + s.window_months);
      const inWindow = extractDates(answer).filter((d) => d >= today && d <= end);
      if (inWindow.length) failures.push(`none_claim_but_lists_dates_in_window:${inWindow.map((d) => d.toISOString().slice(0, 10)).join('|')}`);
    }
  }

  // 2. Dates called "outside/beyond" the asked window that are inside it.
  if (s.window_months && /\b(beyond|outside|after|extend(s|ing)? (past|beyond)|later than)\b[^.\n]{0,80}\b(\d+\s*months?|window|period)\b/i.test(answer)) {
    const end = new Date(today); end.setUTCMonth(end.getUTCMonth() + s.window_months);
    const inside = extractDates(answer).filter((d) => d >= today && d <= end);
    if (inside.length) failures.push(`date_called_outside_window_but_inside:${inside.map((d) => d.toISOString().slice(0, 10)).join('|')}`);
  }

  // 3. Requested filters must be applied or disclosed.
  const searchedStates = new Set(argValues(evidence, ['state', 'states']).map((x) => x.toUpperCase()));
  for (const st of s.expected_filters?.state ?? []) {
    if (!searchedStates.has(st) && !disclosed(answer, st, STATE_NAMES[st])) failures.push(`silently_dropped_state:${st}`);
  }
  const searchedNaics = argValues(evidence, ['naics', 'naics_code', 'naics_codes']);
  for (const p of s.expected_filters?.naics_prefix ?? []) {
    const covered = searchedNaics.some((c) => c.startsWith(p) || p.startsWith(c));
    if (!covered && !disclosed(answer, p)) failures.push(`silently_dropped_naics:${p}`);
  }

  // 4. Filters the user never asked for, added without saying so. A state counts as disclosed
  // only by its full name (two-letter codes are ambiguous: "VA" is also Veterans Affairs).
  for (const f of s.unrequested_filters ?? []) {
    const keys = f === 'state' ? ['state', 'states'] : f === 'naics' ? ['naics', 'naics_code', 'naics_codes'] : ['agency'];
    for (const v of new Set(argValues(evidence, keys))) {
      const ok = f === 'state' ? !!STATE_NAMES[v.toUpperCase()] && hasWord(answer, STATE_NAMES[v.toUpperCase()]) : hasWord(answer, v);
      if (!ok) failures.push(`unrequested_filter_not_disclosed:${f}=${v}`);
    }
  }

  // 5. Required records / content.
  const missingGroups = (s.required_groups ?? []).filter((g) => !g.some((t) => has(answer, t)));
  if (missingGroups.length) {
    const onlyPartial = s.partial_if_only && missingGroups.every((g) => s.partial_if_only!.some((p) => p.join('|') === g.join('|')));
    if (onlyPartial) partials.push(...missingGroups.map((g) => `missing:${g[0]}`));
    else failures.push(...missingGroups.map((g) => `missing_required:${g.join(' | ')}`));
  }
  if (s.min_matches) {
    const n = s.min_matches.terms.filter((t) => has(answer, t)).length;
    if (n < s.min_matches.min) failures.push(`too_few_matches:${n}/${s.min_matches.min}`);
  }
  for (const t of s.forbid ?? []) if (has(answer, t)) failures.push(`forbidden:${t}`);
  if (s.list_items_forbid?.length) {
    const items = answer.split('\n').filter((l) => /^\s*(\d+[.)]|[-*•])\s+/.test(l));
    for (const t of s.list_items_forbid) if (items.some((l) => has(l, t))) failures.push(`list_item_forbidden:${t}`);
  }

  // 6. Every identifier, exact amount and named record the answer states must be in the evidence.
  // If the captured evidence was truncated, a value we cannot find is UNVERIFIABLE (partial), not
  // a fabrication: never a pass, never a false fail.
  const unsupported = (label: string) => (truncated ? partials.push(`unverifiable_evidence_truncated:${label}`) : failures.push(`unsupported_${label}`));
  for (const id of extractIds(answer)) if (!idInEvidence(evText, id)) unsupported(`identifier:${id}`);
  for (const amt of extractAmounts(answer)) if (!amountInEvidence(evText, amt)) unsupported(`amount:$${amt}`);
  for (const t of s.must_be_in_evidence_if_stated ?? []) if (has(answer, t) && !has(evText, t)) failures.push(`stated_but_not_in_evidence:${t}`);

  // 7. Price-point ordering.
  if (s.price_order) {
    const p = pricePoints(answer);
    const need = ['aggressive', 'competitive', 'median'];
    if (!need.every((k) => k in p)) partials.push('price_points_not_all_stated');
    else if (!(p.aggressive < p.competitive && p.competitive <= p.median && (p.premium === undefined || p.median < p.premium))) {
      failures.push(`price_order_violated:${JSON.stringify(p)}`);
    }
  }

  return { verdict: failures.length ? 'fail' : partials.length ? 'partial' : 'pass', failures, partials };
}
