/**
 * Briefing Chat Types
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatContext {
  userEmail: string;
  userName?: string;
  // From user_briefing_profile
  naicsCodes: string[];
  agencies: string[];
  keywords: string[];
  watchedCompanies: string[];
  // Recent briefing items (last 7 days)
  recentBriefings: BriefingSnapshot[];
}

export interface BriefingSnapshot {
  date: string;
  itemCount: number;
  urgentCount: number;
  items: BriefingItemSummary[];
}

export interface BriefingItemSummary {
  category: string;
  title: string;
  description: string;
  amount?: string;
  deadline?: string;
  agency?: string;
  urgency?: string;
}

export interface ChatResponse {
  message: string;
  tokensUsed?: number;
  model?: string;
}

export interface PhoneLinkRequest {
  phone: string;
  email: string;
  code?: string;
}

export interface PhoneLinkRecord {
  phone: string;
  email: string;
  verificationCode: string;
  verified: boolean;
  createdAt: string;
  verifiedAt?: string;
}
