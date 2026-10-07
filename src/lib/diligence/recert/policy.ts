/**
 * Recertification review POLICY — versioned, data-only description of the rules.
 *
 * Every rule states: authoritative citation · effective period · applicable instrument ·
 * required facts · possible outcomes (branches) · permitted wording · prohibited wording.
 * The engine (engine.ts) evaluates these against federal facts + deal facts; it adds no
 * legal reasoning of its own. If a branch is not written here, the engine cannot reach it.
 *
 * Sources verified 2026-10-07 from primary text only:
 *   13 CFR 125.12 — eCFR versions 2025-01-16 and 2025-06-04 (no later version through 2026-10-01)
 *   89 FR 102448 (2024-12-17) DATES: "This rule is effective on January 16, 2025."
 *   90 FR 23609 (2025-06-04) Correction: redesignated 125.12(g)(i),(ii) as (g)(1),(2). No other change.
 *   13 CFR 124.515 — current text since eCFR version 2023-05-30
 *   13 CFR 121.404, 124.105, 126.619, 127.504, 128.401 — current text since 2025-01-16
 *   FAR 52.219-28 (JAN 2025); FAR 19.301-2 (FAC 2026-01) — supporting only
 *
 * This file states rules; it never states conclusions about a company.
 */

export const POLICY_VERSION = 'recert-policy/2026-10-07.1';

/** The 125.12(g) transaction-date threshold. A TRANSACTION date test — not an effective date. */
export const G_THRESHOLD = '2026-01-17';
export const RULE_125_12_EFFECTIVE = '2025-01-16';
export const G_RENUMBERED = '2025-06-04';

export type FactId =
  | 'T1_change_of_controlling_interest'
  | 'T2_transaction_date'
  | 'T3_acquirer_size_under_naics'
  | 'T4_recertification_outcome'
  | 'T5a_8a_ownership_or_control_relinquished'
  | 'T5b_8a_waiver_status'
  | 'F_partial_set_aside_portion'
  | 'F_g2_option_conditions'
  | 'F_pending_offers'
  | 'I_options_on_existing_orders'
  | 'I_g1_scope_unrestricted_mac';

/** Discrete values a fact can resolve to, per instrument. `unknown` is always possible. */
export type FactValue =
  | { fact: 'T1_change_of_controlling_interest'; v: 'yes' | 'no' }
  | { fact: 'T2_transaction_date'; v: 'before_threshold' | 'on_or_after_threshold' }
  | { fact: 'T3_acquirer_size_under_naics'; v: 'small' | 'other_than_small' }
  | { fact: 'T4_recertification_outcome'; v: 'qualifying' | 'disqualifying' }
  | { fact: 'T5a_8a_ownership_or_control_relinquished'; v: 'yes' | 'no' }
  | { fact: 'T5b_8a_waiver_status'; v: 'granted' | 'denied' | 'pending' | 'not_requested' }
  | { fact: 'F_partial_set_aside_portion'; v: 'reserved_portion' | 'unrestricted_portion' }
  | { fact: 'F_g2_option_conditions'; v: 'met' | 'not_met' }
  | { fact: 'F_pending_offers'; v: 'none' | 'present' }
  | { fact: 'I_options_on_existing_orders'; v: 'resolved' }
  | { fact: 'I_g1_scope_unrestricted_mac'; v: 'resolved' };

export type InstrumentClass =
  | 'vehicle_set_aside_mac'
  | 'vehicle_unrestricted_mac'
  | 'vehicle_set_aside_single'
  | 'vehicle_unrestricted_single'
  | 'award_set_aside_standalone'
  | 'award_unrestricted_standalone'
  | 'order_under_single_award_set_aside'
  | 'order_under_single_award_unrestricted'
  | 'order_under_set_aside_mac'
  | 'set_aside_order_under_unrestricted_mac'
  | 'unrestricted_order_under_unrestricted_mac'
  | 'order_parent_not_established';

export interface Citation {
  cite: string;
  url: string;
}

export interface Branch {
  /** Every condition must hold. A fact absent from `when` is irrelevant to this branch. */
  when: Partial<Record<FactId, string>>;
  status: 'FLAG' | 'NO_FLAG' | 'NEEDS_REVIEW';
  review_flag: string;
  citation: string;
}

export interface RuleDef {
  id: string;
  title: string;
  citations: (asOf: string) => Citation[];
  effective: { from: string; to: string | null; basis: string };
  applies_to: InstrumentClass[] | 'deal' | 'all';
  /** Extra federal-fact predicate on the instrument (e.g. 8(a) code present). */
  applies_when?: string;
  required_facts: FactId[];
  regulatory_fact: string;
  /** Empty when the rule is informational (no branches). */
  branches: Branch[];
  permitted_wording: string[];
  prohibited_wording: string[];
}

const ECFR = (s: string) => `https://www.ecfr.gov/current/title-13/section-${s}`;
const c125 = (p: string): Citation => ({ cite: `13 CFR 125.12${p}`, url: ECFR('125.12') });
/** 125.12(g) paragraphs were (g)(i)/(g)(ii) until 90 FR 23609 (2025-06-04). Cite what was in force at as_of. */
export function gCite(asOf: string, n: 1 | 2): string {
  return asOf < G_RENUMBERED ? `13 CFR 125.12(g)(${n === 1 ? 'i' : 'ii'})` : `13 CFR 125.12(g)(${n})`;
}

const E125 = { from: RULE_125_12_EFFECTIVE, to: null, basis: '89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01' };
const E124515 = { from: '2023-05-30', to: null, basis: 'eCFR version date of the current 124.515 text (last amended 88 FR 26208)' };

/** Applies to every output string the engine emits from this policy. */
export const PROHIBITED_WORDING: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bbacklog\b/i, why: 'ceiling and obligations are not backlog' },
  { pattern: /\brevenue\b/i, why: 'public award values are not revenue' },
  { pattern: /\b(lost|loses|loss|losing)\b/i, why: 'no economic loss is computed' },
  { pattern: /\bdies?\b|\bdead\b/i, why: 'rule text says ineligible, not dies' },
  { pattern: /will be terminated/i, why: '124.515 states a requirement; it does not report an event' },
  { pattern: /purchase[- ]price|valuation|discount|haircut/i, why: 'no price or valuation output' },
  { pattern: /\bclosed on\b|\bclosing date (is|was)\b/i, why: 'closing date is never inferred' },
];

export const RULES: RuleDef[] = [
  {
    id: 'R1',
    title: 'Recertification trigger after a merger, acquisition or sale',
    citations: () => [c125('(a)'), c125('(a)(1)'), { cite: 'FAR 52.219-28(b)(1)-(2) (JAN 2025)', url: 'https://www.acquisition.gov/far/52.219-28' }],
    effective: E125,
    applies_to: 'all',
    applies_when: 'award received as a small business or program participant (CO size = SMALL BUSINESS, or a set-aside code on the award)',
    required_facts: ['T1_change_of_controlling_interest'],
    regulatory_fact: 'Recertification of size and small business program status is required within 30 calendar days of a merger, acquisition, or sale of or by a concern or an affiliate of the concern, which results in a change in controlling interest.',
    branches: [
      { when: { T1_change_of_controlling_interest: 'yes' }, status: 'FLAG', review_flag: 'Recertification within 30 calendar days is required by 125.12(a).', citation: '13 CFR 125.12(a)' },
      { when: { T1_change_of_controlling_interest: 'no' }, status: 'NO_FLAG', review_flag: 'No change in controlling interest established; 125.12(a) trigger not met.', citation: '13 CFR 125.12(a)' },
    ],
    permitted_wording: ['Recertification within 30 calendar days is required by 125.12(a).'],
    prohibited_wording: ['must recertify (stated as a finding without T1 established)'],
  },
  {
    id: 'R2',
    title: 'Existing award terms after recertification',
    citations: () => [c125('(a)(3)')],
    effective: E125,
    applies_to: 'all',
    required_facts: [],
    regulatory_fact: 'Recertification does not change the terms and conditions of the award. Limitations on subcontracting, non-manufacturer and subcontracting plan requirements in effect at award remain in effect.',
    branches: [],
    permitted_wording: ['Existing award terms are unchanged by recertification (125.12(a)(3)).'],
    prohibited_wording: ['the award ends', 'the award is cancelled'],
  },
  {
    id: 'R3',
    title: 'Single-award small business set-aside or reserve (and orders under it)',
    citations: () => [c125('(e)(2)(ii)(B)(1)'), c125('(e)(2)(iii)(A)')],
    effective: E125,
    applies_to: ['award_set_aside_standalone', 'order_under_single_award_set_aside', 'vehicle_set_aside_single'],
    required_facts: ['T1_change_of_controlling_interest', 'T4_recertification_outcome'],
    regulatory_fact: 'After a disqualifying recertification the concern remains eligible for orders issued under a single award small business contract and remains eligible to receive options; the agency cannot count the order or option period toward small business goals.',
    branches: [
      { when: { T1_change_of_controlling_interest: 'no' }, status: 'NO_FLAG', review_flag: 'No recertification trigger established.', citation: '13 CFR 125.12(a)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'qualifying' }, status: 'NO_FLAG', review_flag: 'Qualifying recertification: eligibility continues (125.12(e)(1)).', citation: '13 CFR 125.12(e)(1)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'disqualifying' }, status: 'FLAG', review_flag: 'Eligibility for orders and options is retained under the rule; the agency cannot count them toward small business goals.', citation: '13 CFR 125.12(e)(2)(ii)(B)(1); (e)(2)(iii)(A)' },
    ],
    permitted_wording: ['Eligibility for orders and options is retained under the rule; the agency cannot count them toward small business goals.'],
    prohibited_wording: ['value at risk', 'lost'],
  },
  {
    id: 'R4',
    title: 'Unrestricted awards and orders',
    citations: () => [c125('(e)(2)(ii)(B)(1)'), c125('(e)(2)(iii)(A)')],
    effective: E125,
    applies_to: ['vehicle_unrestricted_mac', 'vehicle_unrestricted_single', 'award_unrestricted_standalone', 'order_under_single_award_unrestricted', 'unrestricted_order_under_unrestricted_mac'],
    required_facts: [],
    regulatory_fact: 'The concern remains eligible for unrestricted awards under a multiple award contract; for any unrestricted award a concern with a disqualifying recertification remains eligible to receive options.',
    branches: [],
    permitted_wording: ['No eligibility flag under 125.12 for unrestricted awards.'],
    prohibited_wording: [],
  },
  {
    id: 'R5',
    title: 'Set-aside or reserved MAC — future set-aside or reserved orders',
    citations: (asOf) => [c125('(e)(2)(ii)(B)(1)'), c125('(e)(2)(ii)(B)(2)'), { cite: gCite(asOf, 1), url: ECFR('125.12') }],
    effective: E125,
    applies_to: ['vehicle_set_aside_mac'],
    required_facts: ['T1_change_of_controlling_interest', 'T2_transaction_date', 'T3_acquirer_size_under_naics', 'T4_recertification_outcome'],
    regulatory_fact: 'Other-than-small acquiring entity under the MAC NAICS: ineligible to submit an offer for a set aside or reserved award after the triggering event. Small acquiring concern: remains eligible for set-aside or reserved orders, not counted toward goals. Transaction before January 17, 2026: remains eligible for orders under the underlying small business MAC, not counted toward goals.',
    branches: [
      { when: { T1_change_of_controlling_interest: 'no' }, status: 'NO_FLAG', review_flag: 'No recertification trigger established.', citation: '13 CFR 125.12(a)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'qualifying' }, status: 'NO_FLAG', review_flag: 'Qualifying recertification: eligibility continues.', citation: '13 CFR 125.12(e)(1)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'disqualifying', T2_transaction_date: 'before_threshold' }, status: 'FLAG', review_flag: 'Transaction before January 17, 2026: remains eligible for orders under this MAC; new or pending orders cannot be counted toward goals.', citation: '13 CFR 125.12(g)(1)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'disqualifying', T2_transaction_date: 'on_or_after_threshold', T3_acquirer_size_under_naics: 'other_than_small' }, status: 'FLAG', review_flag: 'Ineligible to submit an offer for a set aside or reserved award under this MAC after the triggering event.', citation: '13 CFR 125.12(e)(2)(ii)(B)(1)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'disqualifying', T2_transaction_date: 'on_or_after_threshold', T3_acquirer_size_under_naics: 'small' }, status: 'FLAG', review_flag: 'Remains eligible for set-aside or reserved orders under this MAC; the agency cannot count them toward goals.', citation: '13 CFR 125.12(e)(2)(ii)(B)(2)' },
    ],
    permitted_wording: ['Ineligible to submit an offer for a set aside or reserved award under this MAC after the triggering event.'],
    prohibited_wording: ['future orders are lost', 'dollar value of future orders'],
  },
  {
    id: 'R6',
    title: 'Set-aside or reserved MAC — options on the MAC',
    citations: (asOf) => [c125('(e)(2)(iii)(B)'), c125('(e)(2)(iii)(C)'), { cite: gCite(asOf, 2), url: ECFR('125.12') }],
    effective: E125,
    applies_to: ['vehicle_set_aside_mac'],
    required_facts: ['T1_change_of_controlling_interest', 'T3_acquirer_size_under_naics', 'T4_recertification_outcome', 'F_g2_option_conditions'],
    regulatory_fact: 'Other-than-small acquiring entity: ineligible to receive options on the set-aside MAC. Small acquiring concern: remains eligible to receive options, not counted toward goals. A firm with a disqualifying recertification prior to the end of the fifth year of a long-term contract remains eligible for options exercised prior to January 17, 2026, not counted toward goals.',
    branches: [
      { when: { T1_change_of_controlling_interest: 'no' }, status: 'NO_FLAG', review_flag: 'No recertification trigger established.', citation: '13 CFR 125.12(a)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'qualifying' }, status: 'NO_FLAG', review_flag: 'Qualifying recertification: option eligibility continues.', citation: '13 CFR 125.12(e)(1)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'disqualifying', F_g2_option_conditions: 'met' }, status: 'FLAG', review_flag: 'Remains eligible for MAC options exercised prior to January 17, 2026; those options cannot be counted toward goals.', citation: '13 CFR 125.12(g)(2)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'disqualifying', F_g2_option_conditions: 'not_met', T3_acquirer_size_under_naics: 'other_than_small' }, status: 'FLAG', review_flag: 'Ineligible to receive options on this set-aside MAC.', citation: '13 CFR 125.12(e)(2)(iii)(B)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'disqualifying', F_g2_option_conditions: 'not_met', T3_acquirer_size_under_naics: 'small' }, status: 'FLAG', review_flag: 'Remains eligible to receive options on this MAC; the option periods cannot be counted toward goals.', citation: '13 CFR 125.12(e)(2)(iii)(C)' },
    ],
    permitted_wording: ['Ineligible to receive options on this set-aside MAC.'],
    prohibited_wording: ['option value lost'],
  },
  {
    id: 'R7',
    title: 'Options on orders already awarded under a set-aside MAC',
    citations: () => [c125('(a)(3)'), c125('(e)(2)(iii)(B)')],
    effective: E125,
    applies_to: ['order_under_set_aside_mac'],
    applies_when: 'the order carries option value not yet exercised (base+all options > base+exercised options)',
    required_facts: ['I_options_on_existing_orders'],
    regulatory_fact: 'Existing award terms are unchanged by recertification (125.12(a)(3)). The text of 125.12(e)(2)(iii)(B) addresses options on a multiple award contract that is set-aside; it does not expressly state its treatment of options on an order already awarded under such a contract.',
    // Deliberately no branch can resolve this: the governing text does not establish the treatment.
    branches: [],
    permitted_wording: ['Option treatment of this existing order is not established by the rule text; requires determination.'],
    prohibited_wording: ['options on this order are lost', 'options on this order are retained'],
  },
  {
    id: 'R8',
    title: 'Set-aside order under an unrestricted MAC (including GSA Schedule)',
    citations: () => [c125('(e)(2)(ii)(B)(1)'), c125('(e)(2)(ii)(B)(2)'), c125('(a)(3)'), { cite: '13 CFR 121.404(c)(4)(i); 121.404(i)', url: ECFR('121.404') }, { cite: 'FAR 52.219-28(c)(4) (JAN 2025)', url: 'https://www.acquisition.gov/far/52.219-28' }],
    effective: E125,
    applies_to: ['set_aside_order_under_unrestricted_mac'],
    required_facts: ['T1_change_of_controlling_interest', 'T2_transaction_date', 'T3_acquirer_size_under_naics', 'T4_recertification_outcome', 'I_g1_scope_unrestricted_mac'],
    regulatory_fact: 'Future: an other-than-small acquiring entity makes the concern ineligible to submit an offer for a set aside award after the triggering event; a small acquiring concern remains eligible for set-aside orders under a MAC, not counted toward goals. The FSS MAS is a multiple award schedule (121.404(c)(4)(i)); the (c)(4) exceptions do not affect 125.12 (121.404(i)). 125.12(g)(1) addresses an "underlying small business multiple award contract"; its application to set-aside orders under an unrestricted MAC is not stated. The existing order is unchanged (125.12(a)(3)).',
    branches: [
      { when: { T1_change_of_controlling_interest: 'no' }, status: 'NO_FLAG', review_flag: 'No recertification trigger established.', citation: '13 CFR 125.12(a)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'qualifying' }, status: 'NO_FLAG', review_flag: 'Qualifying recertification: eligibility continues.', citation: '13 CFR 125.12(e)(1)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'disqualifying', T2_transaction_date: 'on_or_after_threshold', T3_acquirer_size_under_naics: 'other_than_small' }, status: 'FLAG', review_flag: 'Ineligible to submit an offer for further set-aside orders on this vehicle after the triggering event; the existing order is unchanged.', citation: '13 CFR 125.12(e)(2)(ii)(B)(1); (a)(3)' },
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'disqualifying', T3_acquirer_size_under_naics: 'small' }, status: 'FLAG', review_flag: 'Remains eligible for set-aside orders under this MAC; the agency cannot count them toward goals.', citation: '13 CFR 125.12(e)(2)(ii)(B)(2)' },
      // I_g1 is an interpretation, never established from deal data, so this branch can only ever be
      // reported as possible — exactly what the text supports.
      { when: { T1_change_of_controlling_interest: 'yes', T4_recertification_outcome: 'disqualifying', T2_transaction_date: 'before_threshold', T3_acquirer_size_under_naics: 'other_than_small', I_g1_scope_unrestricted_mac: 'resolved' }, status: 'NEEDS_REVIEW', review_flag: 'Transaction before January 17, 2026 on an unrestricted MAC: whether 125.12(g)(1) reaches this vehicle is not stated in the rule text; requires determination.', citation: '13 CFR 125.12(g)(1)' },
    ],
    permitted_wording: ['Ineligible to submit an offer for further set-aside orders on this vehicle after the triggering event; the existing order is unchanged.'],
    prohibited_wording: ['no grandfathering on Schedules'],
  },
  {
    id: 'R9',
    title: 'Partial set-aside or reserved MAC — which portion the holder is on',
    citations: (asOf) => [{ cite: gCite(asOf, 1), url: ECFR('125.12') }, c125('(e)(2)(ii)(B)')],
    effective: E125,
    applies_to: ['vehicle_set_aside_mac'],
    applies_when: 'the vehicle set-aside code is a PARTIAL set-aside',
    required_facts: ['F_partial_set_aside_portion'],
    regulatory_fact: '125.12(g)(1) expressly includes "set-asides, partial set-asides, and reserves". FPDS does not record which portion of a partial set-aside the holder occupies.',
    branches: [
      { when: { F_partial_set_aside_portion: 'reserved_portion' }, status: 'FLAG', review_flag: 'Holder is on the reserved portion: R5 and R6 apply as to a set-aside MAC.', citation: '13 CFR 125.12(e)(2)(ii)(B); (g)(1)' },
      { when: { F_partial_set_aside_portion: 'unrestricted_portion' }, status: 'NO_FLAG', review_flag: 'Holder is on the unrestricted portion: treat as unrestricted (R4).', citation: '13 CFR 125.12(e)(2)(ii)(B)(1)' },
    ],
    permitted_wording: ['Which portion of the partial set-aside the holder occupies must be established.'],
    prohibited_wording: [],
  },
  {
    id: 'R10',
    title: 'Pending offers at the triggering event',
    citations: () => [c125('(e)(2)(i)')],
    effective: E125,
    applies_to: 'deal',
    required_facts: ['F_pending_offers'],
    regulatory_fact: 'Triggering events within 180 days after an offer but before award: ineligible for the pending small business set-aside or reserved award. More than 180 days: eligible for a pending single award or reserve, but ineligible where the underlying award is a multiple award small business set-aside or reserve.',
    branches: [
      { when: { F_pending_offers: 'none' }, status: 'NO_FLAG', review_flag: 'No pending offers established at the triggering event.', citation: '13 CFR 125.12(e)(2)(i)' },
      { when: { F_pending_offers: 'present' }, status: 'NEEDS_REVIEW', review_flag: 'Pending offers exist: each must be tested against the 180-day rule with its offer date and set-aside type.', citation: '13 CFR 125.12(e)(2)(i)' },
    ],
    permitted_wording: ['Pending offers cannot be assessed from public award data.'],
    prohibited_wording: [],
  },
  {
    id: 'R11',
    title: 'Long-term contract recertification point',
    citations: () => [c125('(b)'), { cite: 'FAR 52.219-28(b)(3) (JAN 2025)', url: 'https://www.acquisition.gov/far/52.219-28' }],
    effective: E125,
    applies_to: 'all',
    applies_when: 'period of performance including options exceeds five years (POP start to potential end)',
    required_facts: [],
    regulatory_fact: 'For contracts and orders longer than five years including options, recertify no more than 120 days before the end of the fifth year and before each later option. FAR 52.219-28(b)(3) states a 60-to-120-day window.',
    branches: [{ when: {}, status: 'FLAG', review_flag: 'A 125.12(b) long-term recertification point applies to this instrument, independent of the transaction.', citation: '13 CFR 125.12(b)' }],
    permitted_wording: ['A 125.12(b) long-term recertification point applies to this instrument, independent of the transaction.'],
    prohibited_wording: [],
  },
  {
    id: 'R12',
    title: 'Contracting-officer-requested recertification for a specific order',
    citations: () => [c125('(c)'), c125('(e)(2)(ii)(A)')],
    effective: E125,
    applies_to: 'deal',
    required_facts: [],
    regulatory_fact: 'A disqualifying recertification requested for a specific order or agreement makes the concern ineligible for that order only; it remains eligible for other set-aside, reserved and unrestricted awards.',
    branches: [],
    permitted_wording: [],
    prohibited_wording: [],
  },
  {
    id: 'R13',
    title: '8(a) contract or order: performance after change of ownership or control',
    citations: () => [
      { cite: '13 CFR 124.515(a), (a)(1)', url: ECFR('124.515') },
      { cite: '13 CFR 124.515(b), (c), (g)', url: ECFR('124.515') },
      { cite: '13 CFR 124.105(i)(1)', url: ECFR('124.105') },
    ],
    effective: E124515,
    applies_to: 'all',
    applies_when: 'an 8(a) set-aside code (8(A) SOLE SOURCE or 8A COMPETED) on the award or its parent vehicle',
    required_facts: ['T5a_8a_ownership_or_control_relinquished', 'T5b_8a_waiver_status'],
    regulatory_fact: 'An 8(a) contract or order must be performed by the Participant that initially received it unless a waiver is granted. It must be terminated for the convenience of the Government if the individuals upon whom eligibility was based relinquish ownership or control such that the concern would no longer be at least 51% owned or controlled by disadvantaged individuals. Waiver grounds are listed in 124.515(b); the request must be made in writing prior to the change (124.515(c)). 124.105(i)(1) addresses a Participant or former Participant performing 8(a) contracts.',
    branches: [
      { when: { T5a_8a_ownership_or_control_relinquished: 'no' }, status: 'NO_FLAG', review_flag: 'No relinquishment of ownership or control established; 124.515(a)(1) not triggered.', citation: '13 CFR 124.515(a)(1)' },
      { when: { T5a_8a_ownership_or_control_relinquished: 'yes', T5b_8a_waiver_status: 'granted' }, status: 'NO_FLAG', review_flag: 'Waiver granted under 124.515(b).', citation: '13 CFR 124.515(b)' },
      { when: { T5a_8a_ownership_or_control_relinquished: 'yes', T5b_8a_waiver_status: 'pending' }, status: 'NEEDS_REVIEW', review_flag: 'Waiver request pending; outcome not established.', citation: '13 CFR 124.515(c)(4)' },
      { when: { T5a_8a_ownership_or_control_relinquished: 'yes', T5b_8a_waiver_status: 'denied' }, status: 'FLAG', review_flag: 'The 124.515(a)(1) termination-for-convenience requirement applies to this 8(a) award (waiver denied; appeal right under 124.515(i)).', citation: '13 CFR 124.515(a)(1); (i)' },
      { when: { T5a_8a_ownership_or_control_relinquished: 'yes', T5b_8a_waiver_status: 'not_requested' }, status: 'FLAG', review_flag: 'The 124.515(a)(1) termination-for-convenience requirement applies to this 8(a) award (no waiver requested).', citation: '13 CFR 124.515(a)(1); (c)' },
    ],
    permitted_wording: ['The 124.515(a)(1) termination-for-convenience requirement applies to this 8(a) award (no waiver requested).'],
    prohibited_wording: ['will be terminated', 'a waiver exists', 'no waiver exists (without the fact)'],
  },
  {
    id: 'R14',
    title: 'Goaling wording differs between SBA rule and FAR',
    citations: () => [c125('(e)'), { cite: 'FAR 19.301-2(d)(1) (FAC 2026-01)', url: 'https://www.acquisition.gov/far/19.301-2' }],
    effective: E125,
    applies_to: 'deal',
    required_facts: [],
    regulatory_fact: '125.12(e) and (g) say the agency "cannot count" the specified orders or options; FAR 19.301-2(d)(1) says the agency "may no longer include" them. The engine cites 125.12 for SBA goaling and notes the difference.',
    branches: [],
    permitted_wording: [],
    prohibited_wording: [],
  },
  {
    id: 'R15',
    title: 'Socioeconomic program status recertification',
    citations: () => [
      c125('(a)'),
      { cite: '13 CFR 126.619 (HUBZone); 127.504 (WOSB/EDWOSB); 128.401 (SDVOSB)', url: ECFR('127.504') },
    ],
    effective: E125,
    applies_to: 'all',
    applies_when: 'a program set-aside code (8(a), WOSB/EDWOSB, HUBZone, SDVOSB) on the award or its parent vehicle',
    required_facts: [],
    regulatory_fact: 'Status recertification (8(a), HUBZone, WOSB/EDWOSB, SDVOSB) is governed by 125.12(a), cross-referenced in 126.619, 127.504 and 128.401. R1–R8 apply to status as they apply to size.',
    branches: [],
    permitted_wording: [],
    prohibited_wording: [],
  },
];
