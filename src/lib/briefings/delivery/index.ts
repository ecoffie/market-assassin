/**
 * Briefing Delivery System
 *
 * Unified exports for briefing generation and delivery.
 */

// Re-export types
export * from './types';

// Re-export modules
export { generateBriefing, formatItem, formatAmount, truncate } from './generator';
export { generateEmailTemplate } from './email-template';
export {
  sendBriefingEmail,
  sendBriefingSMS,
  generateSMSMessage,
  deliverBriefing,
} from './sender';
