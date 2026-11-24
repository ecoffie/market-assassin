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
  | 'set_aside_not_small'
  | 'set_aside_cert_not_held'
  | 'set_aside_cert_unconfirmed'
  | 'customer_is_incumbent'
  | 'last_award_not_competed'
  | 'capture_window_passed'
  | 'deadline_passed'
  | 'deadline_this_week'
  | 'market_research_notice'
  | 'related_market_unconfirmed';

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
  /** 'open' = a live SAM notice; 'forecast' = an agency's planned purchase; default = a contract coming back. */
  kind?: 'open' | 'recompete' | 'forecast';
  title?: string | null;
  /** Open notices: "City, ST" (place of performance, else the buying office). */
  location_label?: string | null;
  response_deadline?: string | null;
  notice_type?: string | null;
  /** find_opportunities evidence class: DIRECT_MATCH, RELATED_MARKET_CANDIDATE, HOLDER_SIGNAL. */
  evidence_class?: string | null;
  incumbent_uei?: string | null;
}

export interface MarketScope {
  /** Requested two-letter state, when the customer named one. */
  state?: string | null;
  /** Several requested states ("VA, MD and DC"). Takes precedence over `state`. */
  states?: string[] | null;
  /** What the market actually buys: PSC codes with their share of market dollars (0..1). */
  pscShares?: Array<{ code: string; pct: number }>;
  /** What the market buys by NAICS share (0..1). */
  naicsShares?: Array<{ code: string; pct: number }>;
  /** The customer's work as codes (resolveWorkCodes). When set, these define the work instead of share. */
  workPsc?: string[];
  workNaics?: string[];
}

const GENERIC_WORK_WORDS = new Set(['and', 'or', 'of', 'the', 'for', 'to', 'in', 'a', 'an', 'services', 'service', 'construction', 'support', 'management', 'general', 'other', 'heavy', 'civil', 'work', 'works', 'solutions', 'products', 'product', 'contracts', 'contract', 'federal', 'government', 'misc', 'miscellaneous', 'facilities', 'facility']);
const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ies)$/, 'y').replace(/(es|s)$/, '');

/** Distinctive words of the customer's work phrase ("bridge and highway heavy civil construction" -> bridge, highway). */
export function distinctiveWords(phrase: string): string[] {
  return [...new Set(String(phrase || '').split(/[^A-Za-z0-9]+/).map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !GENERIC_WORK_WORDS.has(w)).map(stem))];
}

/**
 * The customer's work as codes. A market code counts when its official NAME contains a distinctive word the
 * customer used (Y1LB "CONSTRUCTION OF HIGHWAYS, ROADS, STREETS, BRIDGES" for "bridge and highway ..."). Share is
 * only the fallback when no name matches: a long phrase's market sprawls (66% commercial building for the
 * bridge-and-highway phrase), so share alone excluded the customer's real work.
 */
export function resolveWorkCodes(
  work: string,
  psc: Array<{ code: string; name?: string; pct: number }>,
  naics: Array<{ code: string; name?: string; pct: number }>,
): { psc: string[]; naics: string[]; basis: 'name' | 'share' } {
  const words = distinctiveWords(work);
  const byName = (list: Array<{ code: string; name?: string }>) =>
    list.filter((c) => {
      const nameWords = new Set(String(c.name || '').split(/[^A-Za-z0-9]+/).map(stem));
      return words.some((w) => nameWords.has(w));
    }).map((c) => String(c.code).toUpperCase());
  const p = byName(psc);
  const n = byName(naics);
  if (p.length || n.length) return { psc: p, naics: n, basis: 'name' };
  const share = (list: Array<{ code: string; pct: number }>) => list.filter((c) => c.pct >= WORK_PSC_MIN_SHARE).map((c) => String(c.code).toUpperCase());
  return { psc: share(psc), naics: share(naics), basis: 'share' };
}

export interface CustomerEligibility {
  /** Certifications the customer HOLDS, from the profile. null/undefined = not known. */
  certifications?: string[] | null;
  /** Small-business status from the profile. null/undefined = not known. */
  smallBusiness?: boolean | null;
  /** The customer's SAM UEI (from the Vault profile). Identity is established ONLY by UEI, never by name. */
  uei?: string | null;
  /** SAM self-represented size per NAICS: Y small, N not small, E exception. Absent = not established. */
  sizeByNaics?: Record<string, 'Y' | 'N' | 'E'> | null;
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

type SetAsideKind = '8a' | 'edwosb' | 'wosb' | 'sdvosb' | 'vosb' | 'hubzone' | 'indian' | 'sb';
const CERT_KINDS: Record<Exclude<SetAsideKind, '8a' | 'sb'>, { label: string; match: RegExp }> = {
  edwosb: { label: 'economically disadvantaged women-owned (EDWOSB)', match: /edwosb|economically disadvantaged wom/i },
  wosb: { label: 'women-owned (WOSB)', match: /wosb|women[- ]owned/i },
  sdvosb: { label: 'service-disabled veteran-owned (SDVOSB)', match: /sdvosb|service[- ]disabled/i },
  vosb: { label: 'veteran-owned (VOSB)', match: /\bvosb\b|sdvosb|veteran[- ]owned|service[- ]disabled/i },
  hubzone: { label: 'HUBZone', match: /hub\s*zone/i },
  indian: { label: 'Indian-owned (ISBEE / Buy Indian)', match: /indian|isbee|tribal|native american/i },
};

/** One kind per set-aside, from recompete codes or SAM notice wording. Order matters (EDWOSB before WOSB, SDVOSB before VOSB). */
export function setAsideKind(raw: string | null | undefined): SetAsideKind | null {
  const s = String(raw || '');
  if (!s.trim() || /full\s*(&|and)\s*open|unrestricted|no set[- ]aside|^none$/i.test(s)) return null;
  if (/8\s*\(\s*a\s*\)|\b8A[NS]?\b/i.test(s)) return '8a';
  if (/edwosb|economically disadvantaged wom/i.test(s)) return 'edwosb';
  if (/wosb|women[- ]owned/i.test(s)) return 'wosb';
  if (/sdvosb|service[- ]disabled/i.test(s)) return 'sdvosb';
  if (/\bvosb\b|veteran[- ]owned/i.test(s)) return 'vosb';
  if (/hub\s*zone|\bHZ[CS]\b/i.test(s)) return 'hubzone';
  if (/indian|isbee|buy indian/i.test(s)) return 'indian';
  if (/\bSB(-total|-partial|A|P)?\b|small business|total small/i.test(s)) return 'sb';
  return null;
}

export function checkRecord(
  rec: CandidateRecord,
  scope: MarketScope,
  elig: CustomerEligibility | undefined,
  competition: CompetitionFacts | undefined,
  nowMs: number = Date.now(),
): RecordCheck {
  const exclusions: CheckReason[] = [];
  const barriers: CheckReason[] = [];
  const actions: CheckReason[] = [];
  const wantSet = new Set((scope.states?.length ? scope.states : scope.state ? [scope.state] : []).map((x) => x.toUpperCase()));
  const want = wantSet.size ? [...wantSet].join(', ') : null;
  const desc = String(rec.description || '').trim();

  // 1. Relevant: location.
  if (want) {
    const recState = rec.place_of_performance_state ? String(rec.place_of_performance_state).toUpperCase() : null;
    const named = [...new Set([...statesNamedInDescription(desc), ...statesNamedInDescription(rec.location_label)])].filter((s) => !wantSet.has(s));
    if (recState && !wantSet.has(recState)) {
      exclusions.push({ code: 'out_of_state', detail: `Place of performance is ${recState}, not ${want}.` });
    } else if (named.length) {
      exclusions.push({
        code: 'location_conflict',
        detail: `The record ${recState ? `lists ${recState}` : 'lists no state'}, but it names ${named.join(', ')} ("${(rec.location_label || desc).slice(0, 90)}").`,
      });
    }
  }

  // 1. Relevant: the work. Either code establishes it (PSC = what was bought, NAICS = the industry): "Access Road
  // Repair" is PSC Z2LB but NAICS 237310. Excluded only when the record carries a code and neither matches.
  const workPsc = new Set((scope.workPsc ?? (scope.pscShares || []).filter((x) => x.pct >= WORK_PSC_MIN_SHARE).map((x) => x.code)).map((c) => String(c).toUpperCase()));
  const workNaics = new Set((scope.workNaics ?? (scope.naicsShares || []).filter((x) => x.pct >= WORK_PSC_MIN_SHARE).map((x) => x.code)).map((c) => String(c)));
  const recPsc = rec.psc_code ? String(rec.psc_code).toUpperCase() : null;
  const recNaics = rec.naics_code ? String(rec.naics_code) : null;
  const pscKnown = !!recPsc && workPsc.size > 0;
  const naicsKnown = !!recNaics && workNaics.size > 0;
  if ((pscKnown || naicsKnown) && !(pscKnown && workPsc.has(recPsc!)) && !(naicsKnown && workNaics.has(recNaics!))) {
    const theirs = [recPsc ? `PSC ${recPsc}` : '', recNaics ? `NAICS ${recNaics}` : ''].filter(Boolean).join(', ');
    const ours = [workPsc.size ? `PSC ${[...workPsc].join('/')}` : '', workNaics.size ? `NAICS ${[...workNaics].join('/')}` : ''].filter(Boolean).join(' or ');
    exclusions.push({ code: 'work_mismatch', detail: `It is ${theirs}; this work is ${ours}.` });
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

  // 2. Pursuable: set-aside versus what the customer holds. Recompete codes (SB-Total, SDVOSB, Indian-SB...) and SAM
  // notice wording ("Service-Disabled Veteran-Owned Small Business (SDVOSB) Set Aside") both map to one kind.
  const sa = String(rec.set_aside_type || '');
  const kind = setAsideKind(sa);
  if (kind === '8a') {
    const has8a = holds(elig, /8\s*\(?\s*a\s*\)?/i);
    if (has8a === false) exclusions.push({ code: 'set_aside_8a_not_held', detail: 'The last award was set aside for 8(a) firms, and your profile does not list 8(a).' });
    else if (has8a === null) barriers.push({ code: 'set_aside_8a_unconfirmed', detail: 'The last award was set aside for 8(a) firms. 8(a) certification is not established in your profile.' });
  } else if (kind && kind !== 'sb') {
    const cert = CERT_KINDS[kind];
    const has = holds(elig, cert.match);
    if (has === false) exclusions.push({ code: 'set_aside_cert_not_held', detail: `The last award was set aside for ${cert.label} firms, and your profile does not list ${cert.label}.` });
    else if (has === null) barriers.push({ code: 'set_aside_cert_unconfirmed', detail: `The last award was set aside for ${cert.label} firms. That certification is not established in your profile.` });
  } else if (kind === 'sb') {
    const naics = rec.naics_code ? String(rec.naics_code) : '';
    const size = naics && elig?.sizeByNaics ? elig.sizeByNaics[naics] : undefined;
    if (size === 'N') {
      exclusions.push({ code: 'set_aside_not_small', detail: `It was set aside for small businesses, and your SAM registration says you are not small under NAICS ${naics}.` });
    } else if (size !== 'Y' && elig?.smallBusiness !== true) {
      barriers.push({
        code: 'set_aside_small_business_unconfirmed',
        detail: elig?.sizeByNaics
          ? `The last award was a small-business set-aside. Your SAM registration does not state your size under NAICS ${naics || '(not stated)'}.`
          : 'The last award was a small-business set-aside. Your small-business status for this NAICS is not established in your profile.',
      });
    }
  }

  // Identity by UEI only: the customer holds this contract now.
  if (elig?.uei && rec.incumbent_uei && String(elig.uei).toUpperCase() === String(rec.incumbent_uei).toUpperCase()) {
    actions.push({ code: 'customer_is_incumbent', detail: `Your company (UEI ${String(elig.uei).toUpperCase()}) holds this contract now. Defending it is usually your strongest move: talk to the contracting officer about the follow-on before it is written.` });
  }

  if (competition?.class === 'not_competed' && competition.abilityone_holder !== true) {
    barriers.push({ code: 'last_award_not_competed', detail: `The last award was not competed${competition.sole_source_reason ? ` (${competition.sole_source_reason})` : ''}. The next one may also go to one source.` });
  }

  // Open notices: the find engine's own evidence class, the deadline, and what kind of notice it is.
  if (rec.kind === 'open') {
    if (rec.evidence_class && rec.evidence_class !== 'DIRECT_MATCH') {
      // Uncertain, not a confirmed mismatch (Eric 2026-11-24): a barrier with its reason, never an exclusion.
      barriers.push({ code: 'related_market_unconfirmed', detail: `The search matched it as related market work (${rec.evidence_class}), not confirmed demand for this work. Read the notice before deciding.` });
    }
    const due = rec.response_deadline ? Date.parse(rec.response_deadline) : NaN;
    if (Number.isFinite(due) && due < nowMs) {
      exclusions.push({ code: 'deadline_passed', detail: `The response deadline (${rec.response_deadline!.slice(0, 10)}) has passed.` });
    } else if (Number.isFinite(due) && due - nowMs <= 7 * 86400000) {
      actions.push({ code: 'deadline_this_week', detail: `Responses are due ${rec.response_deadline!.slice(0, 10)}, within a week. Decide now and pull the full notice from SAM.gov today.` });
    }
    if (/sources sought|request for information|\brfi\b|presolicitation|special notice/i.test(String(rec.notice_type || ''))) {
      actions.push({ code: 'market_research_notice', detail: `This is a ${rec.notice_type} notice, not the bid itself. Responding${rec.response_deadline ? ` by ${rec.response_deadline.slice(0, 10)}` : ''} puts you in front of the buyer before the solicitation is written and can help keep it set aside for small businesses.` });
    }
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
  nowMs: number = Date.now(),
): RecordCheck[] {
  return records.map((r) => checkRecord(r, scope, elig, competition.get(r.contract_id), nowMs));
}
