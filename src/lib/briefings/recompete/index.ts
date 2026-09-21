/**
 * Recompete Briefing Module
 *
 * Generates Daily Displacement Intel briefings in Eric's format.
 */

export * from './types';
export { generateRecompeteBriefing, getUserProfile } from './generator';
export { aggregateRecompeteData, formatContractValue, getAgencyAcronym } from './data-aggregator';
export {
  transformToOpportunities,
  generateTeamingPlays,
  generateMarketIntel,
  generatePriorityScorecard,
} from './ai-generator';
export { generateFullBriefingEmail, generateCondensedBriefingEmail } from './email-templates';
