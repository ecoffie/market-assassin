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
  TN: 'Tennessee', MS: 'Mississippi', AR: 'Arkansas', VA: 'Virginia', KY: 'Kentucky', AL: 'Alabama', GA: 'Georgia',
  MO: 'Missouri', LA: 'Louisiana', TX: 'Texas', FL: 'Florida', NC: 'North Carolina', SC: 'South Carolina', OH: 'Ohio',
  MD: 'Maryland', DC: 'District of Columbia', CA: 'California', NY: 'New York', PA: 'Pennsylvania',
};

const NONE_CLAIM = /\b(no|none|couldn'?t find|could not find|did not find|didn'?t find|unable to find|there are no|there is no|no recorded)\b[^.\n]{0,90}\b(contracts?|awards?|records?|results?|orders?|opportunit\w*|vehicles?|solicitations?)\b/i;
const DISCLOSURE = /\b(only|not|didn'?t|did not|couldn'?t|could not|cannot|can'?t|unable|limited|excluded|excluding|without|outside|separately|next)\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const lc = (s: string) => s.toLowerCase();
const has = (hay: string, needle: string) => lc(hay).includes(lc(needle));

function evidenceText(ev: ToolEvidence[]): string {
  return ev.map((e) => `${e.tool} ${JSON.stringify(e.args ?? {})} ${e.result_excerpt ?? ''}`).join('\n');
}

function argValues(ev: ToolEvidence[], keys: string[]): string[] {
  const out: string[] = [];
  for (const e of ev) {
    for (const k of keys) {
      const v = e.args?.[k];
      const push = (x: unknown) => { if (typeof x === 'string') out.push(...x.split(',').map((s) => s.trim()).filter(Boolean)); };
      if (Array.isArray(v)) v.forEach(push); else push(v);
    }
  }
  return out;
}

function disclosed(answer: string, value: string, name?: string): boolean {
  const terms = [value, name].filter(Boolean) as string[];
  for (const sentence of answer.split(/(?<=[.!?\n])\s+/)) {
    if (terms.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sentence)) && DISCLOSURE.test(sentence)) return true;
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

/** Contract-identifier-like tokens: 10–20 chars, letters AND digits (PIIDs, notice ids). */
export function extractIds(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10,20}\b/g)].map((m) => m[0]))];
}

/** Exact dollar amounts ≥ $1,000 written with digits (e.g. $1,302,252.96). */
export function extractAmounts(text: string): string[] {
  return [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)(?!\s*(?:[KMB]|million|billion|thousand)\b)/gi)].map((m) => m[1].replace(/,/g, ''));
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

  // 1. "None" claims that contradict the evidence or the answer itself.
  const noneClaim = NONE_CLAIM.test(answer);
  if (noneClaim) {
    const inEvidence = (s.qualifying_records ?? []).filter((r) => has(evText, r));
    const inAnswer = (s.qualifying_records ?? []).filter((r) => has(answer, r));
    if (inEvidence.length || inAnswer.length) failures.push(`none_claim_contradicts_records:${[...new Set([...inAnswer, ...inEvidence])].join('|')}`);
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

  // 4. Filters the user never asked for, added without saying so.
  for (const f of s.unrequested_filters ?? []) {
    const keys = f === 'state' ? ['state', 'states'] : f === 'naics' ? ['naics', 'naics_code', 'naics_codes'] : ['agency'];
    for (const v of new Set(argValues(evidence, keys))) {
      if (!has(answer, v) && !(f === 'state' && STATE_NAMES[v.toUpperCase()] && has(answer, STATE_NAMES[v.toUpperCase()]))) {
        failures.push(`unrequested_filter_not_disclosed:${f}=${v}`);
      }
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
  const truncated = evidence.some((e) => e.truncated);
  const unsupported = (label: string) => (truncated ? partials.push(`unverifiable_evidence_truncated:${label}`) : failures.push(`unsupported_${label}`));
  for (const id of extractIds(answer)) if (!has(evText, id)) unsupported(`identifier:${id}`);
  const evDigits = evText.replace(/,/g, '');
  for (const amt of extractAmounts(answer)) {
    const whole = amt.split('.')[0];
    if (!evDigits.includes(amt) && !evDigits.includes(whole)) unsupported(`amount:$${amt}`);
  }
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
