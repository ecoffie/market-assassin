/**
 * Briefing Delivery Types
 */

export interface BriefingConfig {
  userId: string;
  userEmail: string;
  deliveryMethod: 'email' | 'sms' | 'both';
  phoneNumber?: string;
  timezone: string;
  frequency: 'daily' | 'weekly';
  preferredTime: string; // HH:MM format
  includeWebIntel: boolean;
  maxItemsPerBriefing: number;
}

export interface GeneratedBriefing {
  id: string;
  userId: string;
  generatedAt: string;
  briefingDate: string;

  // Content sections
  summary: BriefingSummary;
  topItems: BriefingSection[];
  categorizedItems: Record<string, BriefingSection>;

  // Metadata
  totalItems: number;
  sourcesIncluded: string[];
  processingTimeMs: number;
}

export interface BriefingSummary {
  headline: string;
  subheadline: string;
  quickStats: QuickStat[];
  urgentAlerts: number;
}

export interface QuickStat {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
}

export interface BriefingSection {
  title: string;
  items: BriefingItemFormatted[];
}

export interface BriefingItemFormatted {
  id: string;
  rank: number;
  category: string;
  categoryIcon: string;
  title: string;
  subtitle: string;
  description: string;
  urgencyBadge?: string;
  amount?: string;
  deadline?: string;
  actionUrl: string;
  actionLabel: string;
  signals: string[];
  // Win probability scoring
  winProbability?: number; // 0-100
  winTier?: 'excellent' | 'good' | 'moderate' | 'low' | 'poor';
  winSummary?: string;
}

export interface EmailTemplate {
  subject: string;
  preheader: string;
  htmlBody: string;
  textBody: string;
}

export interface SMSMessage {
  body: string;
  truncated: boolean;
}

export interface DeliveryResult {
  success: boolean;
  method: 'email' | 'sms';
  messageId?: string;
  error?: string;
  deliveredAt?: string;
}

export interface BriefingDeliveryRecord {
  id: string;
  userId: string;
  briefingId: string;
  deliveryMethod: 'email' | 'sms';
  status: 'pending' | 'sent' | 'failed' | 'bounced';
  messageId?: string;
  sentAt?: string;
  error?: string;
}
