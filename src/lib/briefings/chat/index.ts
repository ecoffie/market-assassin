/**
 * Briefing Chat Core
 *
 * Reusable chat engine for the briefing chatbot.
 * Resolves user identity, fetches personalized context, calls LLM.
 * Used by SMS webhook, Slack bot, and future channels.
 */

export { generateChatResponse } from './engine';
export { resolveUserByPhone, linkPhoneToEmail, verifyPhoneLink } from './identity';
export type { ChatMessage, ChatResponse, ChatContext } from './types';
