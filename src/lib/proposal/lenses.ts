/**
 * Per-section content lenses — mirrors Content Reaper's lens system.
 *
 * Why this exists: without lenses, every Past Performance draft for
 * every RFP comes out the same shape. Content Reaper solved this for
 * LinkedIn posts by sampling from 20+ framings per call. Same trick
 * applied here per section type so two runs on the same RFP produce
 * meaningfully different drafts.
 *
 * Per-section because what makes an Executive Summary lens valuable
 * (lead-with-outcome vs. lead-with-pain vs. lead-with-team) is
 * completely different from what makes a Technical Approach lens
 * valuable (WBS-first vs. risk-first vs. agile-ceremonies-first).
 */

import type { LensOption, SectionType } from './types';

export const SECTION_LENSES: Record<SectionType, LensOption[]> = {
  // ---- RFP sections ----------------------------------------------
  exec_summary: [
    { id: 'lead-with-outcome', framing: 'Open with the specific outcome the agency will get on day-90, then how you\'ll deliver it. The pain comes second.' },
    { id: 'lead-with-pain', framing: 'Open by naming the agency\'s most acute pain point from the RFP (or from current agency context), then the bidder\'s solution.' },
    { id: 'lead-with-mission', framing: 'Open with the agency\'s mission language verbatim — frame the bidder as the means to that mission, not vice versa.' },
    { id: 'lead-with-team', framing: 'Open by introducing the team and why their combined experience is uniquely matched to the scope.' },
    { id: 'lead-with-recompete', framing: 'Open by acknowledging the incumbent context and the agency\'s transition risk, then position the bidder as the lower-risk continuation.' },
  ],
  technical: [
    { id: 'wbs-first', framing: 'Open with the work breakdown structure (3-5 major tasks), then approach by task. The how comes after the what.' },
    { id: 'risk-first', framing: 'Open with the top 3 program risks (technical, schedule, integration), then your mitigation, then the WBS.' },
    { id: 'standards-first', framing: 'Lead with the named standards / frameworks the RFP cites (NIST, FedRAMP, CMMC, Agile, EVM) and how your method satisfies each.' },
    { id: 'team-rituals-first', framing: 'Open with delivery cadence (sprints, releases, ceremonies) so the agency sees how work flows day-to-day.' },
    { id: 'transition-first', framing: 'Open with the 30/60/90 transition or onboarding plan — agencies feel transition risk most acutely.' },
  ],
  management: [
    { id: 'people-first', framing: 'Lead with the program manager + key personnel, anchor everything else to their authority.' },
    { id: 'comms-first', framing: 'Lead with communication cadence and stakeholder map — many evaluators score this heavily.' },
    { id: 'risk-first', framing: 'Lead with risk and issue management, then PM structure, then transition.' },
    { id: 'startup-first', framing: 'Lead with transition / startup approach — first 30/60/90 days — then steady-state structure.' },
  ],
  past_performance: [
    { id: 'pattern-first', framing: 'Open by naming the pattern of relevance (e.g. "All three contracts involved cybersecurity modernization for civilian agencies"), then cite each contract.' },
    { id: 'mission-match-first', framing: 'Open by mapping each past contract\'s mission to the current RFP\'s mission. Relevance comes first, contract details second.' },
    { id: 'scale-first', framing: 'Open by establishing scale of similar work delivered (total $, # of contracts, # of agencies), then specific citations.' },
    { id: 'agency-match-first', framing: 'Open by highlighting prior work with this same agency (or its parent), then expand to similar agencies.' },
  ],
  pricing: [
    { id: 'value-first', framing: 'Open with the value proposition — what the agency gets per dollar — before the cost methodology.' },
    { id: 'risk-first', framing: 'Open with the cost risks (labor mix, ODCs, technology refresh) and how your pricing structure mitigates them.' },
    { id: 'transparency-first', framing: 'Open with the basis of estimate — exactly how rates and labor categories were chosen — to signal honesty.' },
  ],

  // ---- Capability statement sections -----------------------------
  company_overview: [
    { id: 'cert-first', framing: 'Lead with the bidder\'s set-aside certifications + UEI, then what they do, then agency alignment.' },
    { id: 'specialty-first', framing: 'Lead with what makes this firm a SPECIALIST in their NAICS (not generic capabilities), then certifications.' },
    { id: 'agency-match-first', framing: 'Lead with why the bidder\'s focus directly maps to THIS agency\'s mission, then capabilities + certs.' },
  ],
  cap_past_performance: [
    { id: 'most-relevant-first', framing: 'Cite the single MOST relevant contract first (highest mission/scope match), then 2-3 supporting.' },
    { id: 'agency-match-first', framing: 'If any past contracts are with this same agency, cite those first. Then similar agencies.' },
    { id: 'scope-pattern-first', framing: 'Group citations by the scope pattern they share (e.g. "Cybersecurity for civilian agencies"), 2-3 per group.' },
  ],
  capabilities: [
    { id: 'scope-mirror', framing: 'Bullets mirror the language the source document uses for the scope. Capability names match the RFP\'s phrasing.' },
    { id: 'evidence-heavy', framing: 'Each capability bullet leads with a concrete piece of evidence (tool, cert, project count), then the capability name.' },
    { id: 'team-anchored', framing: 'Each capability is anchored to a named team role or certification the bidder has on staff.' },
  ],
  differentiators: [
    { id: 'evidence-only', framing: 'Each differentiator MUST be backed by a number or a name. No abstract claims. e.g. "Held 4 prior Navy SeaPort-NxG awards" not "Deep Navy expertise."' },
    { id: 'incumbent-aware', framing: 'Differentiators positioned against the likely incumbent or typical competitor — explicit comparison.' },
    { id: 'agency-specific', framing: 'Differentiators tied directly to THIS agency\'s known pain points or priorities, not generic.' },
  ],
  poc: [
    { id: 'mechanical', framing: 'Pure structured contact block. No prose. No softening language.' },
  ],
};

/**
 * Pick a random lens for the section. Returns null only for sections
 * with no lenses configured.
 */
export function pickLens(section: SectionType, seed?: number): LensOption | null {
  const options = SECTION_LENSES[section];
  if (!options || options.length === 0) return null;
  // Allow seed override for deterministic testing (e.g. A/B harness)
  const idx = seed !== undefined ? seed % options.length : Math.floor(Math.random() * options.length);
  return options[idx];
}
