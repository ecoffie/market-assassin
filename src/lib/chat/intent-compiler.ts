/**
 * Intent compiler (Verified Intelligence Engine, Phase A).
 *
 * Compiles the customer's ORIGINAL request into typed constraints and enforces them on the model's
 * tool arguments before execution. The model may suggest arguments; it may not drop or override a
 * constraint the customer stated. Root cause it closes (independent reviews, 2026-11-14): the planner
 * chose different scopes for the same question on different runs (R3: "USACE Memphis District" passed
 * as "USACE" alone, so an Army-wide list was presented as the district's; an unrequested state added;
 * codes and windows dropped in R1/R2).
 *
 * Rules: constraints come only from the customer's words (never guessed); a constraint the tool cannot
 * take is reported as unapplied; nothing is silently broadened or narrowed.
 */
import { interpretCapabilityNaics } from '@/lib/market/capability-naics';
import { impliedStates } from '@/lib/chat/stated-filters';
import { normalizeStateCode, US_STATE_NAMES } from '@/lib/utils/us-states';
import { federalToday } from '@/lib/dates/federal-day';

export interface CompiledIntent {
  requestTime: string;
  federalDate: string;
  /** States the customer named (name or capitalized code). */
  explicitStates: string[];
  /** States implied only by a city or metro the customer named. */
  impliedStates: string[];
  /** Named buying offices, e.g. "USACE Memphis District". */
  officePhrases: string[];
  /** "since 2019" -> 2019-01-01. */
  sinceDate: string | null;
  /** "next 18 months" -> 18; "next year" -> 12. */
  windowMonths: number | null;
  capabilityCodes: string[];
  capabilityLabels: string[];
  /** The customer asked for all / every / a complete list. */
  completeness: boolean;
  /** Agencies the customer named without an office ("the Navy ... contract"). */
  agencyPhrases: string[];
  /** The customer's own words for this turn (free-text tool inputs must come from these). */
  requestText: string;
  /** Everything the customer wrote in this conversation (pasted descriptions or past performance count). */
  customerText: string;
}

/** Agency names a customer uses. Matched case-sensitively for acronyms so "va" in prose never counts. */
const AGENCY_RE = /\b(Army Corps of Engineers|Corps of Engineers|USACE|Department of Defense|DoD|Navy|NAVSUP|NAVFAC|Army|Air Force|Marine Corps|Space Force|Coast Guard|Defense Logistics Agency|DLA|General Services Administration|GSA|NASA|Department of Homeland Security|DHS|FEMA|Department of Veterans Affairs|Veterans Affairs|VA|Health and Human Services|HHS|Department of Energy|DOE|State Department|Department of State|Department of the Treasury|IRS|USDA|Department of Justice|DOJ|FBI|NIH|CDC|EPA|Department of Transportation|FAA|SBA|Department of the Interior)\b/g;

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

const OFFICE_RE = /\b((?:USACE|U\.?S\.?\s+Army\s+Corps\s+of\s+Engineers|Army\s+Corps\s+of\s+Engineers|Corps\s+of\s+Engineers|NAVSUP(?:\s+FLC)?|NAVFAC|VA|Navy|Army|Air\s+Force|DLA|GSA|FAA|NASA|IRS|DHS|FEMA)\s+(?:[A-Z][A-Za-z.'-]+\s+){1,3}(?:District|Office|Center|Command|Division|Region|Medical\s+Center))\b/g;

/** Codes that are also common acronyms (ID card, VA = Veterans Affairs, PA, OR, IN...). */
const AMBIGUOUS_CODES = new Set(['ID', 'VA', 'OR', 'IN', 'ME', 'OK', 'DE', 'PA', 'HI', 'CO', 'LA', 'MA', 'AL', 'MS', 'MO', 'OH', 'GA', 'SC', 'NE', 'AS', 'GU', 'MP']);

/**
 * States the customer explicitly named: a full state name, or a 2-letter code in a location context
 * ("in TN", "TN, MS or AR", "Memphis, TN"). An ambiguous code (ID, VA, PA...) counts only with that
 * context, because these constraints are ADDED to searches and a wrong one narrows the result.
 */
function explicitStatesIn(text: string): string[] {
  const out: string[] = [];
  for (const [code, name] of Object.entries(US_STATE_NAMES as Record<string, string>)) {
    const byName = new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text);
    const inContext = new RegExp(`(?:\\bin\\s+|,\\s*|\\bor\\s+|\\band\\s+|/)${code}(?=[\\s,.;)?!]|$)`).test(text);
    const bare = new RegExp(`(^|[^A-Za-z])${code}([^A-Za-z]|$)`).test(text);
    if (byName || inContext || (bare && !AMBIGUOUS_CODES.has(code))) out.push(code);
  }
  return out;
}

export function compileIntent(text: string, now: Date = new Date(), customerText: string = text): CompiledIntent {
  const src = String(text || '');
  const explicit = explicitStatesIn(src);
  const implied = [...impliedStates(src)].filter((s) => !explicit.includes(s));
  const offices = Array.from(new Set([...src.matchAll(OFFICE_RE)].map((m) => m[1].replace(/\s+/g, ' ').trim())));
  let sinceDate: string | null = null;
  const sinceMonth = src.match(/\bsince\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
  const sinceYear = src.match(/\bsince\s+(?:FY\s*)?(\d{4})\b/i);
  if (sinceMonth) sinceDate = `${sinceMonth[2]}-${String(MONTHS[sinceMonth[1].toLowerCase()]).padStart(2, '0')}-01`;
  else if (sinceYear) sinceDate = `${sinceYear[1]}-01-01`;
  let windowMonths: number | null = null;
  const nm = src.match(/\b(?:next|coming|within(?:\s+the)?(?:\s+next)?)\s+(\d{1,2})\s+months?\b/i);
  if (nm) windowMonths = Number(nm[1]);
  else if (/\b(?:next|coming)\s+(?:year|12\s+months)\b/i.test(src)) windowMonths = 12;
  else if (/\b(?:next|coming)\s+two\s+years\b/i.test(src)) windowMonths = 24;
  const cap = interpretCapabilityNaics(src);
  return {
    requestTime: now.toISOString(),
    federalDate: federalToday(now),
    explicitStates: explicit,
    impliedStates: implied,
    officePhrases: offices,
    sinceDate,
    windowMonths,
    capabilityCodes: cap.typedCodes.length ? cap.typedCodes : cap.codes,
    capabilityLabels: cap.items.map((i) => i.label),
    completeness: /\b(all|every|complete\s+list|full\s+list)\b/i.test(src),
    agencyPhrases: offices.length ? [] : Array.from(new Set([...src.matchAll(AGENCY_RE)].map((m) => m[1]))),
    requestText: src.trim(),
    customerText: String(customerText || src).trim(),
  };
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface Enforcement { args: string; applied: string[]; unapplied: string[] }

const listOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v]).flatMap((x) => String(x ?? '').split(/\s*[,;/&]\s*|\s+(?:or|and)\s+/i)).map((t) => t.trim()).filter(Boolean);

/**
 * Enforce compiled constraints on one tool call's JSON arguments. Returns the enforced arguments and
 * human-readable notes of what was applied from the request and what could not be applied.
 */
export function enforceIntent(toolName: string, rawArgs: string, intent: CompiledIntent): Enforcement {
  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || '{}'); } catch { return { args: rawArgs, applied: [], unapplied: [] }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, applied: [], unapplied: [] };
  const applied: string[] = [];
  const unapplied: string[] = [];
  const office = intent.officePhrases[0];

  if (toolName === 'search_past_contracts') {
    if (office) {
      const agency = String(a.agency ?? '');
      const place = office.split(/\s+/).find((w) => /^[A-Z][a-z]/.test(w) && !/^(Army|Navy|Air|Force|Corps|Engineers|District|Office|Center|Command|Division|Region|Medical)$/.test(w));
      if (!agency || (place && !agency.toLowerCase().includes(place.toLowerCase()))) { a.agency = office; applied.push(`office "${office}" from your request`); }
      // The named office is the scope: a state implied only by a city is not added on top of it.
      if (!intent.explicitStates.length && (a.state != null || a.state_scope != null)) {
        delete a.state; delete a.state_scope; applied.push('no state filter (the named office is the scope)');
      }
    }
    // A named agency the planner left off the search is applied (R10: "Navy" dropped, so a
    // government-wide list was presented as the answer). One named agency only; never replaces one the
    // planner chose, which may be the same agency in other words.
    if (!office && intent.agencyPhrases.length === 1 && !String(a.agency ?? '').trim() && !String(a.piid_prefix ?? '').trim()) {
      a.agency = intent.agencyPhrases[0]; applied.push(`agency "${intent.agencyPhrases[0]}" from your request`);
    } else if (!office && intent.agencyPhrases.length > 1 && !String(a.agency ?? '').trim()) {
      unapplied.push(`agencies ${intent.agencyPhrases.join(', ')} (this search takes one agency; none was applied)`);
    }
    if (intent.sinceDate && a.date_from !== intent.sinceDate) { a.date_from = intent.sinceDate; applied.push(`awards with activity since ${intent.sinceDate} (from "since")`); }
  }

  if (toolName === 'get_expiring_contracts') {
    if (intent.windowMonths && a.months_window !== intent.windowMonths) {
      if (intent.windowMonths <= 60) { a.months_window = intent.windowMonths; applied.push(`${intent.windowMonths}-month window from your request`); }
      else unapplied.push(`a ${intent.windowMonths}-month window (the tool's maximum is 60)`);
    }
    if (intent.explicitStates.length) {
      const have = listOf(a.state).map((s) => normalizeStateCode(s)).filter((x): x is string => !!x);
      const missing = intent.explicitStates.filter((s) => !have.includes(s));
      if (missing.length) { a.state = Array.from(new Set([...have, ...intent.explicitStates])).join(','); applied.push(`states ${intent.explicitStates.join(', ')} from your request`); }
    }
    if (intent.capabilityCodes.length) {
      const have = listOf(a.naics);
      const covered = (c: string) => have.some((h) => /^\d+$/.test(h) && (c.startsWith(h) || h.startsWith(c)));
      const missing = intent.capabilityCodes.filter((c) => !covered(c));
      if (missing.length) { a.naics = [...have, ...missing].join(','); applied.push(`industry codes ${missing.join(', ')} for the work you named`); }
    }
  }

  // Keyword derivation describes the CUSTOMER's business: its free text must be the customer's words,
  // never a description or past performance the planner wrote (R6: keywords credited as "your
  // description" came from planner-invented text).
  if (toolName === 'derive_company_keywords' && intent.requestText) {
    const said = norm(intent.customerText || intent.requestText);
    const custom = (v: unknown) => { const items = listOf(v); return items.length > 0 && items.every((t) => said.includes(norm(t))); };
    if (a.description != null && !custom(a.description)) { a.description = intent.requestText; applied.push('your own words as the company description'); }
    for (const k of ['past_performance', 'capabilities']) {
      if (a[k] != null && !custom(a[k])) { delete a[k]; applied.push(`no ${k.replace('_', ' ')} (you did not provide any)`); }
    }
  }

  if (toolName === 'search_sam_opportunities' && intent.explicitStates.length) {
    const have = listOf(a.state).map((s) => normalizeStateCode(s)).filter((x): x is string => !!x);
    const missing = intent.explicitStates.filter((s) => !have.includes(s));
    if (missing.length) { a.state = Array.from(new Set([...have, ...intent.explicitStates])).join(','); applied.push(`states ${intent.explicitStates.join(', ')} from your request`); }
  }

  // A city or metro the customer named, searched through its state on a tool with no city filter:
  // say the search covers the whole state (acc4 R5: "Millington" shown only as "place of performance TN").
  if (['search_past_contracts', 'get_expiring_contracts', 'search_sam_opportunities'].includes(toolName) && intent.impliedStates.length && !office) {
    const st = listOf(a.state).map((x) => normalizeStateCode(x)).filter((x): x is string => !!x);
    const viaCity = st.filter((x) => intent.impliedStates.includes(x));
    if (viaCity.length && a.city == null && a.cities == null) unapplied.push(`the city or area you named (this search covers all of ${viaCity.join(', ')}; it cannot filter to a city)`);
  }

  if (office && !['search_past_contracts', 'get_buying_offices', 'find_opportunities'].includes(toolName) && a.agency !== undefined && String(a.agency) !== office) {
    unapplied.push(`office "${office}" (this lookup filters by agency only)`);
  }
  return { args: JSON.stringify(a), applied, unapplied };
}

/**
 * Drop duplicate tool calls in one planning round. The planner sometimes splits one question into
 * several calls of the same tool (one per code or per city); after constraint enforcement they can be
 * identical, and the customer would see the same list several times. A call is a duplicate when the
 * same tool has identical arguments, or its NAICS set is a subset of another call's with every other
 * argument equal. `city` and `cities` are compared as one set of places.
 */
export function dedupeToolCalls<T extends { id: string; name: string; args: string }>(calls: T[]): { keep: T[]; duplicates: Array<{ id: string; of: string }> } {
  type Norm = { naics: Set<string>; rest: string };
  const norm = (c: T): Norm => {
    let a: Record<string, unknown> = {};
    try { a = JSON.parse(c.args || '{}'); } catch { /* compare raw */ return { naics: new Set(), rest: c.args }; }
    const naics = new Set(listOf(a.naics));
    const places = Array.from(new Set([...listOf(a.city), ...listOf(a.cities)].map((x) => x.toUpperCase()))).sort();
    const rest: Record<string, unknown> = {};
    for (const k of Object.keys(a).sort()) {
      if (['naics', 'city', 'cities'].includes(k)) continue;
      // State lists compare as sets: "TN,MS,AR" and "MS,TN,AR" are the same search (acc6c R1).
      rest[k] = ['state', 'states'].includes(k) ? listOf(a[k]).map((x) => normalizeStateCode(x) ?? x.toUpperCase()).sort().join(',') : a[k];
    }
    if (places.length) rest.__places = places;
    return { naics, rest: JSON.stringify(rest) };
  };
  const normed = calls.map((c) => ({ c, n: norm(c) }));
  const keep: T[] = [];
  const duplicates: Array<{ id: string; of: string }> = [];
  normed.forEach(({ c, n }, i) => {
    const covering = normed.find(({ c: o, n: on }, j) => j !== i && o.name === c.name && on.rest === n.rest
      && [...n.naics].every((x) => on.naics.has(x))
      && (on.naics.size > n.naics.size || (on.naics.size === n.naics.size && j < i)));
    if (covering) duplicates.push({ id: c.id, of: covering.c.id });
    else keep.push(c);
  });
  return { keep, duplicates };
}
