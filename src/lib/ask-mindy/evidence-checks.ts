/**
 * Intelligence gate, record checks (evaluator checks 1 and 2): is each candidate RELEVANT and is it
 * realistically PURSUABLE by this customer? Software checks against the records, before any answer or
 * report is written. Plan: docs/ask-mindy/INTELLIGENCE-GATE-PLAN-2026-11-24.md.
 *
 * Rules (from the Florida janitorial case, 2026-11-24, where 1 of 7 "recompetes" was a real pursuit):
 *  - POSITIVE EVIDENCE ONLY. A flag needs a field or a phrase in the record that proves it. A missing field
 *    is "not established", never a pass or a fail. (Name-guessing flags created false positives before.)
 *  - The record's place_of_performance_state is not enough on its own: in the FL case every row said FL,
 *    including "...RETIREMENT HOME LOCATED IN GULFPORT, MS" and "...WASHINGTON DC CAMPUS". A location the
 *    description NAMES in another state is a conflict and the row is out of scope until resolved.
 *  - AbilityOne is stated only from the award record's recipient flag (competition-facts.ts), never a name.
 *  - Every exclusion keeps its reason. Nothing is silently dropped.
 */
import { normalizeStateCode } from '@/lib/utils/us-states';
import type { CompetitionFacts } from '@/lib/opportunities/competition-facts';

export type CheckCode =
  | 'out_of_state'
  | 'location_conflict'
  | 'work_mismatch'
  | 'mandatory_source_abilityone'
  | 'incumbent_abilityone_competed'
  | 'set_aside_8a_not_held'
  | 'set_aside_8a_unconfirmed'
  | 'set_aside_small_business_unconfirmed'
  | 'last_award_not_competed'
  | 'capture_window_passed';

export type Verdict = 'pursue' | 'blocked' | 'out_of_scope';

export interface CheckReason {
  code: CheckCode;
  /** One plain-English sentence with the record facts behind it. */
  detail: string;
}

export interface RecordCheck {
  contract_id: string;
  verdict: Verdict;
  /** Why it was excluded (out_of_scope / blocked). Empty for a pursue. */
  exclusions: CheckReason[];
  /** What stands in the way but does not exclude it (eligibility to confirm, last award not competed). */
  barriers: CheckReason[];
  /** Time-critical moves the record itself implies. */
  actions: CheckReason[];
}

export interface CandidateRecord {
  contract_id: string;
  description?: string | null;
  incumbent_name?: string | null;
  psc_code?: string | null;
  naics_code?: string | null;
  set_aside_type?: string | null;
  place_of_performance_state?: string | null;
  period_of_performance_current_end?: string | null;
  capture_start_passed?: boolean | string | null;
}

export interface MarketScope {
  /** Requested two-letter state, when the customer named one. */
  state?: string | null;
  /** What the market actually buys: PSC codes with their share of market dollars (0..1). */
  pscShares?: Array<{ code: string; pct: number }>;
}

export interface CustomerEligibility {
  /** Certifications the customer HOLDS, from the profile. null/undefined = not known. */
  certifications?: string[] | null;
  /** Small-business status from the profile. null/undefined = not known. */
  smallBusiness?: boolean | null;
}

/** A PSC counts as this market's work when it carries at least this share of market dollars. */
export const WORK_PSC_MIN_SHARE = 0.1;

/** "GULFPORT, MS" / "Tampa, FL" style city-state pairs named in a description. */
const CITY_STATE = /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}),\s*([A-Z]{2})\b/g;
/** State codes that are also English words in an all-caps description. */
const WORDLIKE_CODES = new Set(['IN', 'OR', 'ME', 'OK', 'HI', 'DE', 'PA', 'MA', 'AL', 'OH', 'CO', 'LA', 'ID', 'MO', 'AS', 'GA', 'MD', 'MS', 'WA', 'VA', 'NE', 'AR', 'MT', 'UT', 'WI', 'SC', 'NC']);
const WASHINGTON_DC = /\bWASHINGTON,?\s*D\.?\s?C\.?\b|\bWASHINGTON DC\b|\bDC CAMPUS\b/i;

/** States the description itself names (positive evidence only). */
export function statesNamedInDescription(description: string | null | undefined): string[] {
  const text = String(description || '');
  const found = new Set<string>();
  const upper = text.toUpperCase();
  for (const m of upper.matchAll(CITY_STATE)) {
    const code = m[2];
    if (normalizeStateCode(code) !== code) continue;
    if (WORDLIKE_CODES.has(code)) {
      // "SERVICES, IN ACCORDANCE" is not Indiana: a word-like code counts only when it ends the phrase.
      const after = upper.slice((m.index ?? 0) + m[0].length);
      if (!/^\s*(?:$|[.;:,)\]]|\d{5})/.test(after)) continue;
    }
    found.add(code);
  }
  if (WASHINGTON_DC.test(text)) found.add('DC');
  return [...found];
}

function truthy(v: unknown): boolean {
  return v === true || String(v).toLowerCase() === 'true';
}

function holds(elig: CustomerEligibility | undefined, cert: RegExp): boolean | null {
  const list = elig?.certifications;
  if (!Array.isArray(list)) return null;
  return list.some((c) => cert.test(String(c)));
}

export function checkRecord(
  rec: CandidateRecord,
  scope: MarketScope,
  elig: CustomerEligibility | undefined,
  competition: CompetitionFacts | undefined,
): RecordCheck {
  const exclusions: CheckReason[] = [];
  const barriers: CheckReason[] = [];
  const actions: CheckReason[] = [];
  const want = scope.state ? scope.state.toUpperCase() : null;
  const desc = String(rec.description || '').trim();

  // 1. Relevant: location.
  if (want) {
    const recState = rec.place_of_performance_state ? String(rec.place_of_performance_state).toUpperCase() : null;
    const named = statesNamedInDescription(desc).filter((s) => s !== want);
    if (recState && recState !== want) {
      exclusions.push({ code: 'out_of_state', detail: `Place of performance is ${recState}, not ${want}.` });
    } else if (named.length) {
      exclusions.push({
        code: 'location_conflict',
        detail: `The record lists ${recState ?? 'no state'}, but its description names ${named.join(', ')} ("${desc.slice(0, 90)}").`,
      });
    }
  }

  // 1. Relevant: the work. PSC = what was bought.
  const shares = scope.pscShares || [];
  if (rec.psc_code && shares.length) {
    const workCodes = new Set(shares.filter((s) => s.pct >= WORK_PSC_MIN_SHARE).map((s) => s.code.toUpperCase()));
    if (workCodes.size && !workCodes.has(String(rec.psc_code).toUpperCase())) {
      exclusions.push({
        code: 'work_mismatch',
        detail: `It buys PSC ${rec.psc_code}; this market's work is ${[...workCodes].join(', ')}.`,
      });
    }
  }

  // 2. Pursuable: mandatory source. AbilityOne Procurement List buys are NOT competed (FAR subpart 8.7), so the
  // block needs both facts from the award record: an AbilityOne holder AND a not-competed award. An AbilityOne
  // holder that WON A COMPETITION is a strong incumbent, not a mandatory source.
  if (competition?.abilityone_holder === true && competition.class === 'not_competed') {
    exclusions.push({
      code: 'mandatory_source_abilityone',
      detail: `The holder${rec.incumbent_name ? ` (${rec.incumbent_name})` : ''} is an AbilityOne Program participant and the award was not competed. Requirements on the AbilityOne Procurement List must be bought from the designated nonprofit (FAR subpart 8.7), so a small business cannot compete for it while it stays on the list.`,
    });
  } else if (competition?.abilityone_holder === true) {
    barriers.push({
      code: 'incumbent_abilityone_competed',
      detail: `The incumbent${rec.incumbent_name ? ` (${rec.incumbent_name})` : ''} is an AbilityOne nonprofit, but the last award was competed, so it does not appear to be a Procurement List requirement. Confirm before bidding.`,
    });
  }

  // 2. Pursuable: set-aside versus what the customer holds.
  const sa = String(rec.set_aside_type || '');
  if (/8\s*\(\s*a\s*\)/i.test(sa)) {
    const has8a = holds(elig, /8\s*\(?\s*a\s*\)?/i);
    if (has8a === false) exclusions.push({ code: 'set_aside_8a_not_held', detail: 'The last award was set aside for 8(a) firms, and your profile does not list 8(a).' });
    else if (has8a === null) barriers.push({ code: 'set_aside_8a_unconfirmed', detail: 'The last award was set aside for 8(a) firms. 8(a) certification is not established in your profile.' });
  } else if (/\bSB\b|small business|total small/i.test(sa)) {
    if (elig?.smallBusiness == null) barriers.push({ code: 'set_aside_small_business_unconfirmed', detail: 'The last award was a small-business set-aside. Your small-business status for this NAICS is not established in your profile.' });
  }

  if (competition?.class === 'not_competed' && competition.abilityone_holder !== true) {
    barriers.push({ code: 'last_award_not_competed', detail: `The last award was not competed${competition.sole_source_reason ? ` (${competition.sole_source_reason})` : ''}. The next one may also go to one source.` });
  }

  // Time-critical move implied by the record.
  if (truthy(rec.capture_start_passed)) {
    actions.push({
      code: 'capture_window_passed',
      detail: `The usual capture window has passed${rec.period_of_performance_current_end ? ` (current period ends ${rec.period_of_performance_current_end})` : ''}. Check SAM.gov now for the follow-on solicitation or a bridge extension.`,
    });
  }

  const verdict: Verdict = exclusions.some((e) => e.code === 'out_of_state' || e.code === 'location_conflict' || e.code === 'work_mismatch')
    ? 'out_of_scope'
    : exclusions.length
      ? 'blocked'
      : 'pursue';
  return { contract_id: rec.contract_id, verdict, exclusions, barriers, actions };
}

export function checkRecords(
  records: CandidateRecord[],
  scope: MarketScope,
  elig: CustomerEligibility | undefined,
  competition: Map<string, CompetitionFacts>,
): RecordCheck[] {
  return records.map((r) => checkRecord(r, scope, elig, competition.get(r.contract_id)));
}
