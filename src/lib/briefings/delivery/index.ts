/**
 * Briefing Delivery System
 *
 * Unified exports for briefing generation and delivery.
 */

// Re-export types
export * from './types';

// Re-export modules - Original (data-driven)
export { generateBriefing, formatItem, formatAmount, truncate } from './generator';
export { generateEmailTemplate } from './email-template';
export {
  sendBriefingEmail,
  sendBriefingSMS,
  generateSMSMessage,
  deliverBriefing,
} from './sender';

// Re-export modules - AI-powered (displacement intel)
// Daily Brief: Top 10 + 3 Plays + Must Watch
export { generateAIBriefing } from './ai-briefing-generator';
export type { AIGeneratedBriefing, AIBriefingOpportunity, AIBriefingTeamingPlay } from './ai-briefing-generator';
export { generateAIEmailTemplate } from './ai-email-template';
export type { AIEmailTemplate } from './ai-email-template';

// Weekly Deep Dive: Full analysis per opportunity
export { generateWeeklyBriefing } from './weekly-briefing-generator';
export type {
  WeeklyBriefing,
  WeeklyOpportunityAnalysis,
  WeeklyTeamingPlay,
  WeeklyMarketSignal,
  WeeklyCalendarItem,
} from './weekly-briefing-generator';

// Pursuit Brief: 1-page deep dive on single opportunity
export { generatePursuitBrief } from './pursuit-brief-generator';
export type {
  PursuitBrief,
  PursuitOutreachTarget,
  PursuitActionItem,
  PursuitRisk,
} from './pursuit-brief-generator';
