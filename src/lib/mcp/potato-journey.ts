/**
 * Potato journey orchestration.
 * P2 changes first-turn sequencing (value before qualification).
 * v1 evidence invariants stay locked — no new intelligence products, datasets, or MCP tools.
 */

/** First-turn contract — must lead initialize instructions. */
export const P2_FIRST_TURN_INSTRUCTIONS = [
  'Solicitation intent (BEFORE Potato P2 FIND-first). Classify, then call ONE tool. Do not call FIND first and then lookup.',
  'KNOWN_ID — a notice UUID or solicitation identifier (isSolicitationIdentifier): call lookup_solicitation with that token. Do NOT call find_opportunities.',
  'HISTORICAL — submitted / bid / proposal / worked on / what happened / previous / old / recently / last month / "the solicitation we" / "the bid we" / a named program in a retrospective context: call lookup_solicitation ONCE with the user\'s words. Closed ≠ gone. Do NOT call find_opportunities first.',
  'CURRENT_FIND — sell / opportunities / available / where\'s the money / want to work with, without retrospective/past-work intent: Potato P2 below.',
  '',
  'Potato P2 — VALUE BEFORE QUALIFICATION (first turn).',
  'Broad intent: "I sell X and want to sell to Y", "help me", "where do I start".',
  'The host MUST:',
  '1. Call find_opportunities ONCE using the user\'s words (query = what they sell; agency = the buyer if named). Do not wait for qualification.',
  '2. Present that result immediately. Obey find_opportunities presentation.host_rules and presentation.sections.',
  '3. First-value contract — HERE\'S WHERE I SEE THE MONEY: Open now, Coming back, Coming soon, each as grounded result or unavailable/coverage gap. Never turn unavailable into zero. Then WHERE I WOULD START (one evidence-supported point from returned items), WHY (1–3 reasons from that evidence), WHAT I CAN\'T ESTABLISH YET (one limitation if material).',
  '4. Ask at most ONE plain-English refinement question. Then WAIT.',
  '5. BEFORE first value do NOT: ask company identity, UEI, CAGE, certifications, clearance, FCL, set-aside, vehicle access, or desired deliverable; ask the user to choose a GovCon workflow; expose NAICS, PSC, ATO, CNO, CEMA, CSO, OT, PAE, or FCL unless the user already used that word; call FIND a second time; fan out parallel FIND variants; auto-call understand_customer; auto-call get_current_acquisition_intelligence; web-search; create an artifact.',
  'Refinement (after first value, beginner language). Example after cybersecurity FIND: "Which sounds closest to what you sell?" — Cybersecurity services / Security monitoring or managed defense / Cybersecurity software or products / Both / I\'m not sure. Do not use RMF, ATO, CNO, CEMA, NAICS, CSO, SBIR, SOFWERX in that question. If Coming back includes RELATED_MARKET_CANDIDATE rows, say in plain English that those are this buyer\'s broader IT contracts, not confirmed cybersecurity demand.',
  'Clearance: do not ask merely because the buyer is SOCOM. Ask only when grounded evidence from a selected opportunity or pathway makes clearance decision-changing. Do not say clearance is "the hard gate on most SOCOM cyber work" without measured evidence in this result.',
  'POSITION / deep dive: do not ask market map vs access-path plan vs capability statement before diagnosis. Recommend the next useful output from evidence. A full research artifact is an opt-in payoff AFTER first value + refine — not onboarding.',
].join('\n');

export const POTATO_JOURNEY_INSTRUCTIONS = [
  P2_FIRST_TURN_INSTRUCTIONS,
  '',
  'Potato v1 journey AFTER first value (naive customers — they will not say SAM, NAICS, CSO, OT, PAE, set-aside, recompete, forecast):',
  'Do not treat this list as first-turn intake. Do not collect company, clearance, or deliverable choice before first value. Later steps are progressive. Do not require jargon to advance.',
  '1. FIND — find_opportunities (one call on the first turn). "Here\'s where the money is." Three independent horizons. An empty Open result is not a market-wide zero. Never a SAM-only market conclusion. An unavailable horizon is not zero demand. Present first, then one plain-English refine, then WAIT.',
  '2. UNDERSTAND — after first value + refine (or the user asks to continue), when `_next` offers it. understand_customer. Confirmation-gated — do not auto-call on the FIND turn. "What does this customer care about?" Use presentation.sections titles and provenance_label. Curated research is not government fact.',
  '3. CURRENT INTELLIGENCE — get_current_acquisition_intelligence after UNDERSTAND (or when they ask what changed). "What changed about how they\'re buying?" Record evidence is not future certainty. Do not auto-call on the FIND turn.',
  '4. PATHWAY FIT — match_company_to_pathways. Company identity is asked HERE, not on first turn: "Which company should I match against what I found?" Options: My company / A company I\'m helping / Keep this market-level for now. Resolve UEI/CAGE/SAM internally. Do not ask the user for a UEI unless identity resolution actually requires clarification. Two-sided doors only. no_proven_door === true is a complete successful result — do not manufacture a pathway, restart FIND, or offer a research menu.',
  '5. TALENT THIN — from the PATHWAY FIT result only: show stranger-verifiable proof, name the SINGLE most important missing proof, ask at most the result\'s one `_next` question. The customer\'s answer is OWNER_ASSERTED and must stay labeled — it does not become PUBLIC_VERIFIED. No giant questionnaire. Full Talent (what broke, attributable savings, vouches, complete vehicle portfolio) is not in v1.',
  '6. POSITION — after the talent answer (or if they skip), recommend the most useful output from THIS journey\'s evidence. Do not ask the beginner to choose among market map / access-path plan / capability statement before diagnosis. If a draft is the right next output, produce one of: capability statement / response to this opportunity / conversation brief — recommended by you, not a first-turn menu:',
  '   • capability statement → headline, buyer language, capabilities to emphasize, proof to lead with, evidence-backed differentiators, claims to avoid, short buyer-specific paragraph.',
  '   • response → THE OPPORTUNITY SAYS / BROADER CUSTOMER RESEARCH SHOWS / YOUR PROOF / WHAT THAT SUGGESTS YOU EMPHASIZE. Never turn broader research into solicitation fact.',
  '   • conversation → what they appear to care about, what changed, buying behavior, what to say, proof to mention, questions to ask, claims to avoid, one recommended meeting objective.',
  '   Positioning claims must not outrun evidence. Owner-asserted stays labeled.',
  '7. ACT — ONE concrete next action grounded in this journey (respond to this notice, approach a vehicle holder, prepare a demo, verify access, gather the missing proof, contact this office). Not a generic GovCon checklist. Do not auto-run paid or write tools.',
  '8. MONITOR — "Want me to watch this for you?" Coverage today: Open now + Coming soon only. Coming back / recompetes are not emailed. Confirm before calling schedule_market_search. Never auto-create a watch.',
  'Do not skip to MONITOR after FIND. Do not restart FIND after PATHWAY FIT. Do not invent datasets or new acquisition-pathway research. If something useful is missing, say so and keep moving.',
].join('\n');

export const HOST_RULES_TALENT_THIN = [
  'TALENT THIN uses only PATHWAY FIT proof_to_lead_with + proof_missing — no new lookup required.',
  'Show what public records already verify (award, customer, work, value, dates, NAICS/PSC, cert provenance).',
  'Name the SINGLE most important missing proof. Ask at most one question. No questionnaire.',
  'Customer-supplied answers are OWNER_ASSERTED. Never relabel them PUBLIC_VERIFIED. They do not upgrade pathway determinations.',
  'Full Talent (outcomes, delivery speed, vouches, vehicle portfolio, demonstrable readiness as verified fact) is not in Potato v1.',
] as const;

export const HOST_RULES_POSITION = [
  'Draft POSITION from FIND + UNDERSTAND + CURRENT INTELLIGENCE + PATHWAY FIT + labeled owner-asserted context only.',
  'Never turn curated agency research into solicitation fact. Never turn historical pathway usage into future certainty.',
  'Set-aside is not the automatic strategy. Do not claim win, vehicle bid rights, or a prototype without public evidence.',
  'Owner-asserted proof stays labeled owner-asserted in the draft.',
  'Recommend the next useful output from evidence. Do not first-turn menu market map vs access-path plan vs capability statement.',
] as const;

export const HOST_RULES_ACT = [
  'Recommend ONE primary next action grounded in this journey\'s evidence.',
  'No generic GovCon checklist. No auto-running paid or write tools.',
] as const;

export const HOST_RULES_MONITOR = [
  'Ask "Want me to watch this for you?" only after ACT, and wait for confirmation.',
  'Disclose: Open now + Coming soon can be watched by email; Coming back / recompetes are not emailed yet.',
  'Do not call schedule_market_search until the user confirms.',
] as const;

export type PotatoActSource = 'safe_next_action' | 'missing_proof' | 'honest_miss_stop';

/** One ACT line from an existing PATHWAY FIT result — no new engine. */
export function composeActFromPathwayFit(input: {
  no_proven_door: boolean;
  next_prompt?: string | null;
  top_safe_next_action?: string | null;
}): { primary: string; source: PotatoActSource } {
  if (input.no_proven_door && !input.next_prompt) {
    return {
      primary:
        'Stop here on doors — I cannot responsibly recommend a pursuit action until a public acquisition path is established.',
      source: 'honest_miss_stop',
    };
  }
  if (input.top_safe_next_action) {
    return { primary: input.top_safe_next_action, source: 'safe_next_action' };
  }
  if (input.next_prompt) {
    return {
      primary: `Gather this missing proof before you pitch: ${input.next_prompt}`,
      source: 'missing_proof',
    };
  }
  return {
    primary:
      'Stop here on doors — I cannot responsibly recommend a pursuit action until a public acquisition path is established.',
    source: 'honest_miss_stop',
  };
}

export type PositionKind = 'capability_statement' | 'response' | 'meeting';

/** Section shells the host must fill from journey evidence — never from invention. */
export function positionSectionTitles(kind: PositionKind): string[] {
  if (kind === 'capability_statement') {
    return [
      'headline',
      'buyer language to use',
      'capabilities to emphasize',
      'proof to lead with',
      'differentiators supported by evidence',
      'language/claims to avoid',
      'short buyer-specific paragraph',
    ];
  }
  if (kind === 'response') {
    return [
      'THE OPPORTUNITY SAYS',
      'BROADER CUSTOMER RESEARCH SHOWS',
      'YOUR PROOF',
      'WHAT THAT SUGGESTS YOU EMPHASIZE',
    ];
  }
  return [
    'what they appear to care about',
    'what changed',
    'relevant buying behavior',
    'what to say',
    'proof to mention',
    'questions to ask',
    'claims to avoid',
    'one recommended objective for the meeting',
  ];
}
