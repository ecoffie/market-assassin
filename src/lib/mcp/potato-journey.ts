/**
 * Potato v1 — finish the existing customer journey by orchestration.
 * No new intelligence products, datasets, or MCP tools.
 */

export const POTATO_JOURNEY_INSTRUCTIONS = [
  'Potato v1 journey (naive customers — they will not say SAM, NAICS, CSO, OT, PAE, set-aside, recompete, forecast):',
  'When someone wants to sell to a buyer, find work, or says "help me", guide this sequence. Do not require jargon to advance.',
  '1. FIND — find_opportunities. "Here\'s where the money is." Three independent horizons. An empty Open result is not a market-wide zero. Never a SAM-only market conclusion. An unavailable horizon is not zero demand.',
  '2. UNDERSTAND — after a specific open hit, understand_customer. "What does this customer care about?" Use presentation.sections titles and provenance_label. Curated research is not government fact.',
  '3. CURRENT INTELLIGENCE — get_current_acquisition_intelligence. "What changed about how they\'re buying?" Record evidence is not future certainty.',
  '4. PATHWAY FIT — match_company_to_pathways. Ask for company name in plain English (a 12-character entity ID is optional). Two-sided doors only. no_proven_door === true is a complete successful result — do not manufacture a pathway, restart FIND, or offer a research menu.',
  '5. TALENT THIN — from the PATHWAY FIT result only: show stranger-verifiable proof, name the SINGLE most important missing proof, ask at most the result\'s one `_next` question. The customer\'s answer is OWNER_ASSERTED and must stay labeled — it does not become PUBLIC_VERIFIED. No giant questionnaire. Full Talent (what broke, attributable savings, vouches, complete vehicle portfolio) is not in v1.',
  '6. POSITION — after the talent answer (or if they skip), draft from THIS journey\'s evidence only. Ask in customer language and produce the one they pick (capability statement if they just say yes):',
  '   • "Want the right language and keywords for your capability statement?" → headline, buyer language, capabilities to emphasize, proof to lead with, evidence-backed differentiators, claims to avoid, short buyer-specific paragraph.',
  '   • "Want me to help you respond to this opportunity?" → THE OPPORTUNITY SAYS / BROADER CUSTOMER RESEARCH SHOWS / YOUR PROOF / WHAT THAT SUGGESTS YOU EMPHASIZE, then draft. Never turn broader research into solicitation fact.',
  '   • "Want me to prepare you for a conversation with this customer?" → what they appear to care about, what changed, buying behavior, what to say, proof to mention, questions to ask, claims to avoid, one recommended meeting objective.',
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
