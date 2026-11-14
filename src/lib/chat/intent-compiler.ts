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
}

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

export function compileIntent(text: string, now: Date = new Date()): CompiledIntent {
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
  };
}

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

  if (toolName === 'search_sam_opportunities' && intent.explicitStates.length) {
    const have = listOf(a.state).map((s) => normalizeStateCode(s)).filter((x): x is string => !!x);
    const missing = intent.explicitStates.filter((s) => !have.includes(s));
    if (missing.length) { a.state = Array.from(new Set([...have, ...intent.explicitStates])).join(','); applied.push(`states ${intent.explicitStates.join(', ')} from your request`); }
  }

  if (office && !['search_past_contracts', 'get_buying_offices', 'find_opportunities'].includes(toolName) && a.agency !== undefined && String(a.agency) !== office) {
    unapplied.push(`office "${office}" (this lookup filters by agency only)`);
  }
  return { args: JSON.stringify(a), applied, unapplied };
}
