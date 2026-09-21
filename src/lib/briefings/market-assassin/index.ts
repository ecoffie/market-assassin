/**
 * Market Assassin Briefing Module
 *
 * Exports all MA briefing functionality
 */

export * from './types';
export { generateMABriefing, getMAUserProfile } from './generator';
export { aggregateMABriefingData } from './data-aggregator';
export { generateMABriefingEmail, generateCondensedMABriefingEmail } from './email-templates';
