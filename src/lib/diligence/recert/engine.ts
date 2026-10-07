/**
 * Recertification review ENGINE. Pure: register rows + deal facts + policy + as_of → review.
 *
 * Three layers, never merged:
 *   FEDERAL FACT     — what the FPDS/USASpending record shows for the instrument
 *   REGULATORY FACT  — what the rule says (policy.ts), with the citation in force at as_of
 *   REVIEW FLAG      — FLAG / NO_FLAG / NEEDS_REVIEW (+ DEPENDS_ON) / INFORMATIONAL / NOT_IN_EFFECT
 *
 * Hard rules (each one has a test):
 *  - a fact is used only when ESTABLISHED with a source; anything else is unknown
 *  - informational facts (announcement date, a reported quarter window) are never read by a rule —
 *    the closing date is never inferred from an announcement
 *  - acquirer size is per MAC NAICS and never assumed; an 8(a) waiver is never assumed either way
 *  - a rule with no branch for a situation returns NEEDS_REVIEW; the engine never improvises
 *  - knowable mode: a fact established AFTER as_of is treated as unknown
 *  - every emitted string passes the prohibited-wording guard
 */
import type { RegisterRow } from '../register';
import {
  G_THRESHOLD, POLICY_VERSION, PROHIBITED_WORDING, RULES,
  type Branch, type Citation, type FactId, type InstrumentClass, type RuleDef,
} from './policy';

// ---------------- deal facts ----------------
export type DealFact<T> =
  | { status: 'established'; value: T; source: string; known_as_of: string }
  | { status: 'unknown'; note?: string };

export interface DealFacts {
  target_uei: string;
  acquirer_name?: string;
  change_of_controlling_interest?: DealFact<boolean>;
  /** The date the merger, acquisition or sale OCCURRED. Never an announcement date. */
  transaction_date?: DealFact<string>;
  /** Keyed by NAICS code: the acquiring entity's size under that code's standard. */
  acquirer_size_by_naics?: Record<string, DealFact<'small' | 'other_than_small'>>;
  /** Keyed by award key: the post-transaction recertification outcome for that award. */
  recertification_outcome_by_award?: Record<string, DealFact<'qualifying' | 'disqualifying'>>;
  eight_a_ownership_or_control_relinquished?: DealFact<boolean>;
  eight_a_waiver_status?: DealFact<'granted' | 'denied' | 'pending' | 'not_requested'>;
  partial_portion_by_award?: Record<string, DealFact<'reserved_portion' | 'unrestricted_portion'>>;
  g2_option_conditions_by_award?: Record<string, DealFact<'met' | 'not_met'>>;
  pending_offers?: DealFact<'none' | 'present'>;
  /** Context only. NO rule reads this object. */
  informational?: Record<string, unknown>;
}

export type FactMode = 'knowable_at_as_of' | 'all_established';

// ---------------- federal facts per instrument ----------------
export interface FederalFact {
  award_key: string;
  piid: string;
  kind: 'award' | 'idv';
  class: InstrumentClass;
  instrument: string | null;
  awarding_agency: string | null;
  naics: string | null;
  set_aside_on_award: string | null;
  parent_piid: string | null;
  parent_in_register: boolean;
  parent_set_aside: string | null;
  /** NAICS of the MAC that governs future orders (the vehicle itself, or the parent vehicle). */
  mac_naics: string | null;
  co_business_size: string | null;
  eight_a_basis: boolean;
  program_codes: string[];
  long_term: boolean | null;
  status_as_of: string;
  ordering_period_end: string | null;
  pop_current_end: string | null;
  values: {
    obligated: number | null;
    ceiling_base_and_all_options: number | null;
    base_and_exercised_options: number | null;
    ceiling_not_yet_obligated: number | null;
    unexercised_options: number | null;
    /** Vehicle ceilings are program-wide and never attributable to the holder. */
    attributable: boolean;
  };
  source_url: string;
}

export type ReviewStatus = 'FLAG' | 'NO_FLAG' | 'NEEDS_REVIEW' | 'INFORMATIONAL' | 'NOT_IN_EFFECT';

export interface RuleReview {
  rule_id: string;
  title: string;
  regulatory_fact: { text: string; citations: Citation[]; effective: RuleDef['effective'] };
  review: {
    status: ReviewStatus;
    review_flag: string | null;
    citation: string | null;
    /** NEEDS_REVIEW only: the outcomes still possible under the policy, and what decides between them. */
    possible_outcomes: Array<{ status: Branch['status']; review_flag: string; citation: string; requires: Partial<Record<FactId, string>> }>;
    depends_on: FactId[];
    facts_established: Array<{ fact: FactId; value: string; source: string }>;
    facts_missing: FactId[];
    note?: string;
  };
}

export interface InstrumentReview {
  federal_fact: FederalFact;
  rules: RuleReview[];
}

export interface DiligenceRequest {
  fact: FactId;
  request: string;
  documents: string[];
  scope_detail: string[];
  rules: string[];
  instruments: string[];
  instrument_count: number;
  public_obligated_attributable: number;
  public_ceiling_attributable: number;
}

export interface RecertReview {
  policy_version: string;
  as_of: string;
  fact_mode: FactMode;
  target_uei: string;
  boundary: string;
  deal_rules: RuleReview[];
  instruments: InstrumentReview[];
  summary: Array<{ rule_id: string; title: string; status: ReviewStatus; instruments: number; awards: number; vehicles: number; public_obligated: number; public_ceiling: number; ceiling_not_yet_obligated: number }>;
  diligence_requests: DiligenceRequest[];
  informational_context: Record<string, unknown>;
}

const BOUNDARY = 'Public federal prime award record only. Ceiling (base + all options) is a contract ceiling, never a forecast of work. No economic or price figure is computed. Review flags state what a rule provides on stated facts; they are not legal determinations.';

// ---------------- classification ----------------
const isSetAside = (s: string | null) => !!s && !/NO SET ASIDE USED|^NONE$/i.test(s.trim());
const is8a = (s: string | null) => !!s && /8\s*\(?A\)?/i.test(s);
const program = (s: string | null): string[] => {
  if (!s) return [];
  const out: string[] = [];
  if (is8a(s)) out.push('8(a)');
  if (/WOMEN|WOSB/i.test(s)) out.push('WOSB/EDWOSB');
  if (/HUBZONE/i.test(s)) out.push('HUBZone');
  if (/SERVICE[- ]DISABLED|SDVO/i.test(s)) out.push('SDVOSB');
  return out;
};

function yearsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return (Date.parse(b) - Date.parse(a)) / (365.25 * 86400000);
}

export function classify(row: RegisterRow, vehicles: Map<string, RegisterRow>): FederalFact {
  const ownSA = row.set_aside_latest ?? row.set_aside_base;
  const parent = row.parent_piid ? vehicles.get(row.parent_piid) ?? null : null;
  const parentSA = parent ? parent.set_aside_latest ?? parent.set_aside_base : null;
  let cls: InstrumentClass;
  let macNaics: string | null = null;
  if (row.kind === 'idv') {
    const multi = /multiple/i.test(row.instrument ?? '');
    cls = multi ? (isSetAside(ownSA) ? 'vehicle_set_aside_mac' : 'vehicle_unrestricted_mac') : (isSetAside(ownSA) ? 'vehicle_set_aside_single' : 'vehicle_unrestricted_single');
    macNaics = multi ? row.naics : null;
  } else if (!row.parent_piid) {
    cls = isSetAside(ownSA) ? 'award_set_aside_standalone' : 'award_unrestricted_standalone';
  } else {
    const multi = ['GWAC', 'FSS'].includes(row.parent_award_type ?? '') || /multiple/i.test(row.parent_single_or_multiple ?? '');
    const single = /single/i.test(row.parent_single_or_multiple ?? '');
    if (single) cls = isSetAside(ownSA) || isSetAside(parentSA) ? 'order_under_single_award_set_aside' : 'order_under_single_award_unrestricted';
    else if (!multi || !parent) cls = 'order_parent_not_established'; // cannot tell restricted from unrestricted
    else if (isSetAside(parentSA)) cls = 'order_under_set_aside_mac';
    else cls = isSetAside(ownSA) ? 'set_aside_order_under_unrestricted_mac' : 'unrestricted_order_under_unrestricted_mac';
    if (parent) macNaics = parent.naics;
  }
  const attributable = row.kind === 'award';
  const ceiling = row.base_and_all_options.value;
  const exercised = row.base_and_exercised_options.value;
  const obligated = row.obligated.value;
  const yrs = yearsBetween(row.pop_start, row.pop_potential_end);
  return {
    award_key: row.award_key,
    piid: row.piid,
    kind: row.kind,
    class: cls,
    instrument: row.instrument,
    awarding_agency: row.awarding_agency,
    naics: row.naics,
    set_aside_on_award: ownSA,
    parent_piid: row.parent_piid,
    parent_in_register: !!parent,
    parent_set_aside: parentSA,
    mac_naics: macNaics,
    co_business_size: row.co_business_size_latest,
    eight_a_basis: is8a(ownSA) || is8a(parentSA),
    program_codes: [...new Set([...program(ownSA), ...program(parentSA)])],
    long_term: yrs === null ? null : yrs > 5,
    status_as_of: row.status_as_of,
    ordering_period_end: row.ordering_period_end,
    pop_current_end: row.pop_current_end,
    values: {
      obligated,
      ceiling_base_and_all_options: ceiling,
      base_and_exercised_options: exercised,
      ceiling_not_yet_obligated: ceiling !== null && obligated !== null ? round2(ceiling - obligated) : null,
      unexercised_options: ceiling !== null && exercised !== null ? round2(ceiling - exercised) : null,
      attributable,
    },
    source_url: row.source_url,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------- fact resolution ----------------
type Resolved = { value: string; source: string } | null;

function use<T>(f: DealFact<T> | undefined, asOf: string, mode: FactMode, map: (v: T) => string): Resolved {
  if (!f || f.status !== 'established') return null;
  if (mode === 'knowable_at_as_of' && f.known_as_of > asOf) return null;
  return { value: map(f.value), source: f.source };
}

export function resolveFact(fact: FactId, ff: FederalFact | null, d: DealFacts, asOf: string, mode: FactMode): Resolved {
  switch (fact) {
    case 'T1_change_of_controlling_interest':
      return use(d.change_of_controlling_interest, asOf, mode, (v) => (v ? 'yes' : 'no'));
    case 'T2_transaction_date':
      return use(d.transaction_date, asOf, mode, (v) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`transaction_date must be YYYY-MM-DD, got ${v}`);
        return v < G_THRESHOLD ? 'before_threshold' : 'on_or_after_threshold';
      });
    case 'T3_acquirer_size_under_naics': {
      const naics = ff?.mac_naics;
      if (!naics) return null; // no MAC NAICS → the size question cannot even be posed
      return use(d.acquirer_size_by_naics?.[naics], asOf, mode, (v) => v);
    }
    case 'T4_recertification_outcome':
      return ff ? use(d.recertification_outcome_by_award?.[ff.award_key], asOf, mode, (v) => v) : null;
    case 'T5a_8a_ownership_or_control_relinquished':
      return use(d.eight_a_ownership_or_control_relinquished, asOf, mode, (v) => (v ? 'yes' : 'no'));
    case 'T5b_8a_waiver_status':
      return use(d.eight_a_waiver_status, asOf, mode, (v) => v);
    case 'F_partial_set_aside_portion':
      return ff ? use(d.partial_portion_by_award?.[ff.award_key], asOf, mode, (v) => v) : null;
    case 'F_g2_option_conditions':
      return ff ? use(d.g2_option_conditions_by_award?.[ff.award_key], asOf, mode, (v) => v) : null;
    case 'F_pending_offers':
      return use(d.pending_offers, asOf, mode, (v) => v);
    // Interpretations are policy changes, not deal facts: they can only be resolved by a new
    // POLICY_VERSION that adds a branch. They are never "established" from deal data.
    case 'I_options_on_existing_orders':
    case 'I_g1_scope_unrestricted_mac':
      return null;
  }
}

// ---------------- applicability ----------------
function applies(rule: RuleDef, ff: FederalFact): boolean {
  if (rule.applies_to === 'deal') return false;
  if (rule.applies_to !== 'all' && !rule.applies_to.includes(ff.class)) return false;
  switch (rule.id) {
    case 'R1':
      return ff.co_business_size === 'SMALL BUSINESS' || isSetAside(ff.set_aside_on_award);
    case 'R2':
      return ff.kind === 'award';
    case 'R7':
      return (ff.values.unexercised_options ?? 0) > 0.5;
    case 'R9':
      return /PARTIAL/i.test(ff.set_aside_on_award ?? '');
    case 'R11':
      return ff.long_term === true;
    case 'R13':
      return ff.eight_a_basis;
    case 'R15':
      return ff.program_codes.length > 0;
    default:
      return true;
  }
}

// ---------------- evaluation ----------------
export function evaluateRule(rule: RuleDef, ff: FederalFact | null, d: DealFacts, asOf: string, mode: FactMode): RuleReview {
  const regulatory_fact = { text: rule.regulatory_fact, citations: rule.citations(asOf), effective: rule.effective };
  const base = { rule_id: rule.id, title: rule.title, regulatory_fact };
  if (asOf < rule.effective.from || (rule.effective.to && asOf > rule.effective.to)) {
    return {
      ...base,
      review: {
        status: 'NOT_IN_EFFECT', review_flag: null, citation: null, possible_outcomes: [], depends_on: [], facts_established: [], facts_missing: [],
        note: `This policy version models the text in force from ${rule.effective.from}. The rule in force on ${asOf} is not modeled; review against the text then in force.`,
      },
    };
  }

  const established: RuleReview['review']['facts_established'] = [];
  const missing: FactId[] = [];
  const val = new Map<FactId, string | null>();
  for (const f of rule.required_facts) {
    const r = resolveFact(f, ff, d, asOf, mode);
    val.set(f, r ? r.value : null);
    if (r) established.push({ fact: f, value: r.value, source: r.source });
    else missing.push(f);
  }

  if (rule.branches.length === 0) {
    if (rule.required_facts.length > 0) {
      return { ...base, review: { status: 'NEEDS_REVIEW', review_flag: rule.permitted_wording[0] ?? null, citation: regulatory_fact.citations[0]?.cite ?? null, possible_outcomes: [], depends_on: missing, facts_established: established, facts_missing: missing, note: 'The governing text does not establish the treatment; no outcome is offered.' } };
    }
    return { ...base, review: { status: 'INFORMATIONAL', review_flag: rule.permitted_wording[0] ?? null, citation: regulatory_fact.citations[0]?.cite ?? null, possible_outcomes: [], depends_on: [], facts_established: established, facts_missing: [] } };
  }

  const live = rule.branches.filter((b) => Object.entries(b.when).every(([f, want]) => {
    const have = val.get(f as FactId);
    return have === null || have === undefined ? true : have === want;
  }));
  const decided = live.filter((b) => Object.keys(b.when).every((f) => val.get(f as FactId) != null));

  if (live.length === 0) {
    return { ...base, review: { status: 'NEEDS_REVIEW', review_flag: 'No branch of this policy version covers the established facts.', citation: null, possible_outcomes: [], depends_on: missing, facts_established: established, facts_missing: missing, note: 'Policy gap: fail closed.' } };
  }
  if (decided.length > 1) throw new Error(`policy error: ${rule.id} has ${decided.length} branches satisfied at once`);
  if (decided.length === 1 && live.length === 1) {
    const b = decided[0];
    return { ...base, review: { status: b.status, review_flag: b.review_flag, citation: b.citation, possible_outcomes: [], depends_on: [], facts_established: established, facts_missing: missing } };
  }
  const dependsOn = [...new Set(live.flatMap((b) => Object.keys(b.when).filter((f) => val.get(f as FactId) == null)))] as FactId[];
  return {
    ...base,
    review: {
      status: 'NEEDS_REVIEW',
      review_flag: null,
      citation: null,
      possible_outcomes: live.map((b) => ({ status: b.status, review_flag: b.review_flag, citation: b.citation, requires: b.when })),
      depends_on: dependsOn,
      facts_established: established,
      facts_missing: missing,
    },
  };
}

// ---------------- diligence requests ----------------
const REQUESTS: Record<FactId, { request: string; documents: string[] }> = {
  T1_change_of_controlling_interest: {
    request: 'Establish whether the transaction changed the controlling interest of the awardee entity, and which legal entity.',
    documents: ['Executed purchase agreement (stock or asset) and closing deliverables', 'Pre- and post-transaction ownership charts for the awardee entity (by UEI) and its parent', 'Any FAR 42.12 novation or change-of-name agreements'],
  },
  T2_transaction_date: {
    request: 'Establish the date the merger, acquisition or sale occurred (compared against the 2026-01-17 threshold in 125.12(g)).',
    documents: ['Closing certificate or closing memorandum showing the consummation date', 'Acquirer SEC filing or 8-K stating the acquisition date, if any'],
  },
  T3_acquirer_size_under_naics: {
    request: 'Establish whether the acquiring entity, with affiliates, qualifies as small under the NAICS code assigned to each MAC listed.',
    documents: ['SBA size determination, or the acquirer\'s size analysis with affiliates under 13 CFR 121.103, for each listed NAICS code', 'Acquirer SAM size representations for the listed NAICS codes'],
  },
  T4_recertification_outcome: {
    request: 'Establish the post-transaction recertification filed for each listed award, and whether it was qualifying or disqualifying.',
    documents: ['SAM rerepresentations and FAR 52.219-28 notices filed after the transaction', 'Contracting officer acknowledgments and the contract modifications recording the rerepresentation'],
  },
  T5a_8a_ownership_or_control_relinquished: {
    request: 'Establish whether the individuals on whom 8(a) eligibility was based relinquished ownership or control (13 CFR 124.515(a)(1)).',
    documents: ['Post-transaction ownership and management/control documents', 'Notice to SBA of the agreement under 124.515(g)'],
  },
  T5b_8a_waiver_status: {
    request: 'Establish whether a 124.515 waiver was requested before the change, on what ground, and SBA\'s decision.',
    documents: ['Written waiver request to the AA/BD under 124.515(c)', 'SBA decision letter, and any OHA petition under 124.515(i)', 'Any procuring-agency certifications under 124.515(b)(4)'],
  },
  F_partial_set_aside_portion: {
    request: 'Establish which portion (reserved or unrestricted) of each listed partial set-aside MAC the holder occupies.',
    documents: ['MAC award document and pool/portion designation for the holder'],
  },
  F_g2_option_conditions: {
    request: 'Establish, for each listed MAC, whether a disqualifying recertification occurred before the end of the fifth year of a long-term contract and which options were exercised before 2026-01-17 (125.12(g)(2)).',
    documents: ['MAC option schedule and option-exercise modifications with dates', 'Date of the year-five recertification, if any'],
  },
  F_pending_offers: {
    request: 'List offers pending at the triggering event, each with offer date, solicitation number and set-aside type (125.12(e)(2)(i) 180-day rule).',
    documents: ['Proposal log of offers submitted in the 180 days before the transaction and still unawarded'],
  },
  I_options_on_existing_orders: {
    request: 'Obtain a legal determination: does 125.12(e)(2)(iii)(B) reach options on orders already awarded under a set-aside MAC? The rule text does not establish this.',
    documents: ['Counsel memorandum or SBA guidance addressing options on existing orders'],
  },
  I_g1_scope_unrestricted_mac: {
    request: 'Obtain a legal determination: does 125.12(g)(1) ("underlying small business multiple award contract") reach set-aside orders under an unrestricted MAC?',
    documents: ['Counsel memorandum or SBA guidance on the scope of 125.12(g)(1)'],
  },
};

function buildRequests(instruments: InstrumentReview[], deal: RuleReview[]): DiligenceRequest[] {
  const by = new Map<FactId, { rules: Set<string>; inst: Map<string, FederalFact>; detail: Set<string> }>();
  const touch = (f: FactId, rule: string, ff: FederalFact | null) => {
    const e = by.get(f) ?? { rules: new Set(), inst: new Map(), detail: new Set() };
    e.rules.add(rule);
    if (ff) {
      e.inst.set(ff.award_key, ff);
      if (f === 'T3_acquirer_size_under_naics' && ff.mac_naics) e.detail.add(`NAICS ${ff.mac_naics}`);
      if (['T4_recertification_outcome', 'F_partial_set_aside_portion', 'F_g2_option_conditions'].includes(f)) e.detail.add(ff.piid);
    }
    by.set(f, e);
  };
  for (const i of instruments) for (const r of i.rules) if (r.review.status === 'NEEDS_REVIEW') for (const f of r.review.depends_on) touch(f, r.rule_id, i.federal_fact);
  for (const r of deal) if (r.review.status === 'NEEDS_REVIEW') for (const f of r.review.depends_on) touch(f, r.rule_id, null);
  const order = Object.keys(REQUESTS) as FactId[];
  return [...by.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([fact, e]) => {
      const inst = [...e.inst.values()];
      const att = inst.filter((x) => x.values.attributable);
      return {
        fact,
        request: REQUESTS[fact].request,
        documents: REQUESTS[fact].documents,
        scope_detail: [...e.detail].sort(),
        rules: [...e.rules].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
        instruments: inst.map((x) => x.piid).sort(),
        instrument_count: inst.length,
        public_obligated_attributable: round2(att.reduce((s, x) => s + (x.values.obligated ?? 0), 0)),
        public_ceiling_attributable: round2(att.reduce((s, x) => s + (x.values.ceiling_base_and_all_options ?? 0), 0)),
      };
    });
}

// ---------------- wording guard ----------------
export function assertPermittedWording(review: RecertReview): void {
  const strings: string[] = [];
  const walk = (v: unknown, key = '') => {
    if (key === 'boundary' || key === 'informational_context' || key === 'source_url' || key === 'url') return;
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(review);
  for (const s of strings) for (const p of PROHIBITED_WORDING) {
    if (p.pattern.test(s)) throw new Error(`prohibited wording (${p.why}): "${s.slice(0, 160)}"`);
  }
}

// ---------------- entry point ----------------
export function reviewRecertification(input: { rows: RegisterRow[]; facts: DealFacts; asOf: string; mode?: FactMode }): RecertReview {
  const { facts, asOf } = input;
  const mode = input.mode ?? 'knowable_at_as_of';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`asOf must be YYYY-MM-DD, got ${asOf}`);
  const target = input.rows.filter((r) => r.recipient_uei === facts.target_uei);
  const vehicles = new Map(target.filter((r) => r.kind === 'idv').map((r) => [r.piid, r]));
  const inScope = target.filter((r) => (r.kind === 'award'
    ? r.status_as_of !== 'ended'
    : !(r.ordering_period_end && r.ordering_period_end < asOf)));

  const instruments: InstrumentReview[] = inScope.map((row) => {
    const ff = classify(row, vehicles);
    return { federal_fact: ff, rules: RULES.filter((r) => applies(r, ff)).map((r) => evaluateRule(r, ff, facts, asOf, mode)) };
  });
  const deal_rules = RULES.filter((r) => r.applies_to === 'deal').map((r) => evaluateRule(r, null, facts, asOf, mode));

  const summary: RecertReview['summary'] = [];
  for (const rule of RULES) {
    const hits = instruments.map((i) => ({ i, r: i.rules.find((x) => x.rule_id === rule.id) })).filter((x) => x.r);
    const statuses = [...new Set(hits.map((h) => h.r!.review.status))];
    for (const st of statuses) {
      const xs = hits.filter((h) => h.r!.review.status === st).map((h) => h.i.federal_fact);
      const att = xs.filter((x) => x.values.attributable);
      summary.push({
        rule_id: rule.id, title: rule.title, status: st, instruments: xs.length,
        awards: att.length, vehicles: xs.length - att.length,
        public_obligated: round2(att.reduce((s, x) => s + (x.values.obligated ?? 0), 0)),
        public_ceiling: round2(att.reduce((s, x) => s + (x.values.ceiling_base_and_all_options ?? 0), 0)),
        ceiling_not_yet_obligated: round2(att.reduce((s, x) => s + (x.values.ceiling_not_yet_obligated ?? 0), 0)),
      });
    }
  }

  const review: RecertReview = {
    policy_version: POLICY_VERSION,
    as_of: asOf,
    fact_mode: mode,
    target_uei: facts.target_uei,
    boundary: BOUNDARY,
    deal_rules,
    instruments,
    summary,
    diligence_requests: buildRequests(instruments, deal_rules),
    informational_context: facts.informational ?? {},
  };
  assertPermittedWording(review);
  return review;
}
