/**
 * User Engagement Tracking Library
 *
 * Tracks user activity for analytics, health scoring, and churn prediction.
 * Events are logged to Supabase `user_engagement` table.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

// Database types for engagement tables
interface UserEngagementRow {
  id: string;
  user_email: string;
  event_type: string;
  event_source: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface EmailTrackingTokenRow {
  id: string;
  token: string;
  user_email: string;
  email_type: string;
  email_date: string;
  opens: number;
  clicks: number;
  first_open_at: string | null;
  last_open_at: string | null;
  created_at: string;
  expires_at: string;
}

interface UserEngagementScoreRow {
  id: string;
  user_email: string;
  engagement_score: number;
  emails_opened_30d: number;
  emails_sent_30d: number;
  links_clicked_30d: number;
  page_views_30d: number;
  logins_30d: number;
  reports_generated_30d: number;
  profile_completeness: number;
  days_since_last_activity: number | null;
  last_activity_at: string | null;
  churn_risk: string;
  computed_at: string;
  created_at: string;
  updated_at: string;
}

// Lazy init Supabase
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: SupabaseClient<any> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// Event types
export const EventTypes = {
  EMAIL_OPEN: 'email_open',
  LINK_CLICK: 'link_click',
  PAGE_VIEW: 'page_view',
  REPORT_GENERATE: 'report_generate',
  EXPORT: 'export',
  LOGIN: 'login',
  TOOL_USE: 'tool_use',
  PROFILE_UPDATE: 'profile_update',
  ONBOARDING_STEP: 'onboarding_step',
  FEEDBACK: 'feedback',
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];

// Event sources
export const EventSources = {
  DAILY_ALERT: 'daily_alert',
  WEEKLY_BRIEFING: 'weekly_briefing',
  PURSUIT_BRIEF: 'pursuit_brief',
  MARKET_ASSASSIN: 'market_assassin',
  CONTENT_REAPER: 'content_reaper',
  CONTRACTOR_DB: 'contractor_db',
  RECOMPETE_TRACKER: 'recompete_tracker',
  OPPORTUNITY_HUNTER: 'opportunity_hunter',
  FORECASTS: 'forecasts',
  BD_ASSIST: 'bd_assist',
  MARKET_SCANNER: 'market_scanner',
  SBIR_SEARCH: 'sbir_search',
  GRANTS_SEARCH: 'grants_search',
  SETTINGS: 'settings',
  ONBOARDING: 'onboarding',
} as const;

export type EventSource = typeof EventSources[keyof typeof EventSources];

// Engagement event interface
export interface EngagementEvent {
  userEmail: string;
  eventType: EventType;
  eventSource?: EventSource | string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log a user engagement event
 */
export async function logEngagement(event: EngagementEvent): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('user_engagement')
      .insert({
        user_email: event.userEmail.toLowerCase().trim(),
        event_type: event.eventType,
        event_source: event.eventSource || null,
        metadata: event.metadata || {},
        ip_address: event.ipAddress || null,
        user_agent: event.userAgent || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[engagement] Failed to log event:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err) {
    console.error('[engagement] Error logging event:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Log email open event (fire-and-forget)
 */
export function logEmailOpen(
  userEmail: string,
  emailType: EventSource,
  metadata?: { briefing_id?: string; briefing_date?: string; subject_line?: string }
): void {
  logEngagement({
    userEmail,
    eventType: EventTypes.EMAIL_OPEN,
    eventSource: emailType,
    metadata,
  }).catch(() => {}); // Fire and forget
}

/**
 * Log link click event (fire-and-forget)
 */
export function logLinkClick(
  userEmail: string,
  emailType: EventSource,
  metadata: { url: string; link_text?: string; position?: number; briefing_id?: string }
): void {
  logEngagement({
    userEmail,
    eventType: EventTypes.LINK_CLICK,
    eventSource: emailType,
    metadata,
  }).catch(() => {}); // Fire and forget
}

/**
 * Log page view event (fire-and-forget)
 */
export function logPageView(
  userEmail: string,
  metadata: { path: string; referrer?: string; session_id?: string }
): void {
  logEngagement({
    userEmail,
    eventType: EventTypes.PAGE_VIEW,
    metadata,
  }).catch(() => {}); // Fire and forget
}

/**
 * Log report generation event (fire-and-forget)
 */
export function logReportGeneration(
  userEmail: string,
  eventSource: EventSource,
  metadata: { report_type: string; inputs?: Record<string, unknown> }
): void {
  logEngagement({
    userEmail,
    eventType: EventTypes.REPORT_GENERATE,
    eventSource,
    metadata,
  }).catch(() => {}); // Fire and forget
}

/**
 * Log tool usage event (fire-and-forget)
 */
export function logToolUse(
  userEmail: string,
  eventSource: EventSource,
  metadata: { action: string; duration_ms?: number; details?: Record<string, unknown> }
): void {
  logEngagement({
    userEmail,
    eventType: EventTypes.TOOL_USE,
    eventSource,
    metadata,
  }).catch(() => {}); // Fire and forget
}

// ============================================================
// Email Tracking Pixel Generation
// ============================================================

/**
 * Generate tracking pixel HTML for emails
 * Insert before </body> in email templates
 */
export function generateTrackingPixel(token: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tools.govcongiants.org';
  return `<img src="${baseUrl}/api/track?t=${token}" width="1" height="1" style="display:none;width:1px;height:1px;border:0;" alt="" />`;
}

/**
 * Generate click-tracked URL for email links
 * Wraps the destination URL with tracking redirect
 */
export function generateTrackedLink(token: string, url: string, linkText?: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tools.govcongiants.org';
  const encodedUrl = encodeURIComponent(url);
  const label = linkText ? `&l=${encodeURIComponent(linkText)}` : '';
  return `${baseUrl}/api/track?t=${token}&a=click&url=${encodedUrl}${label}`;
}

export function appendEmailUtm(
  url: string,
  {
    campaign,
    content,
    source = 'resend',
    medium = 'email',
  }: {
    campaign: string;
    content: string;
    source?: string;
    medium?: string;
  }
): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('utm_source', source);
    parsed.searchParams.set('utm_medium', medium);
    parsed.searchParams.set('utm_campaign', campaign);
    parsed.searchParams.set('utm_content', content);
    return parsed.toString();
  } catch {
    return url;
  }
}

// ============================================================
// Email Tracking Token Management
// ============================================================

/**
 * Create a tracking token for an email
 */
export async function createEmailTrackingToken(
  userEmail: string,
  emailType: string,
  emailDate: string
): Promise<{ token: string } | null> {
  try {
    const supabase = getSupabase();
    const token = nanoid(16); // Short unique token

    const { error } = await supabase
      .from('email_tracking_tokens')
      .insert({
        token,
        user_email: userEmail.toLowerCase().trim(),
        email_type: emailType,
        email_date: emailDate,
      });

    if (error) {
      console.error('[engagement] Failed to create tracking token:', error.message);
      return null;
    }

    return { token };
  } catch (err) {
    console.error('[engagement] Error creating token:', err);
    return null;
  }
}

/**
 * Record an email open via tracking token
 */
export async function recordEmailOpen(token: string): Promise<{ success: boolean; userEmail?: string }> {
  try {
    const supabase = getSupabase();

    // Get token data
    const { data: tokenData, error: fetchError } = await supabase
      .from('email_tracking_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (fetchError || !tokenData) {
      return { success: false };
    }

    // Update token stats
    const isFirstOpen = !tokenData.first_open_at;
    await supabase
      .from('email_tracking_tokens')
      .update({
        opens: (tokenData.opens || 0) + 1,
        first_open_at: isFirstOpen ? new Date().toISOString() : tokenData.first_open_at,
        last_open_at: new Date().toISOString(),
      })
      .eq('token', token);

    // Log engagement event
    logEmailOpen(tokenData.user_email, tokenData.email_type as EventSource, {
      briefing_date: tokenData.email_date,
    });

    return { success: true, userEmail: tokenData.user_email };
  } catch (err) {
    console.error('[engagement] Error recording open:', err);
    return { success: false };
  }
}

/**
 * Record a link click via tracking token
 */
export async function recordLinkClick(
  token: string,
  url: string,
  linkText?: string
): Promise<{ success: boolean; userEmail?: string }> {
  try {
    const supabase = getSupabase();

    // Get token data
    const { data: tokenData, error: fetchError } = await supabase
      .from('email_tracking_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (fetchError || !tokenData) {
      return { success: false };
    }

    // Update token stats
    await supabase
      .from('email_tracking_tokens')
      .update({
        clicks: (tokenData.clicks || 0) + 1,
      })
      .eq('token', token);

    // Log engagement event
    logLinkClick(tokenData.user_email, tokenData.email_type as EventSource, {
      url,
      link_text: linkText,
      briefing_id: tokenData.email_date,
    });

    return { success: true, userEmail: tokenData.user_email };
  } catch (err) {
    console.error('[engagement] Error recording click:', err);
    return { success: false };
  }
}

// ============================================================
// Engagement Metrics & Stats
// ============================================================

/**
 * Get engagement stats for a user
 */
export async function getUserEngagementStats(
  userEmail: string,
  days: number = 30
): Promise<{
  emailsOpened: number;
  linksClicked: number;
  pageViews: number;
  reportsGenerated: number;
  lastActivityAt: string | null;
} | null> {
  try {
    const supabase = getSupabase();
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('user_engagement')
      .select('event_type, created_at')
      .eq('user_email', userEmail.toLowerCase())
      .gte('created_at', sinceDate)
      .order('created_at', { ascending: false });

    if (error || !data) {
      return null;
    }

    const stats = {
      emailsOpened: 0,
      linksClicked: 0,
      pageViews: 0,
      reportsGenerated: 0,
      lastActivityAt: data.length > 0 ? data[0].created_at : null,
    };

    for (const event of data) {
      switch (event.event_type) {
        case EventTypes.EMAIL_OPEN:
          stats.emailsOpened++;
          break;
        case EventTypes.LINK_CLICK:
          stats.linksClicked++;
          break;
        case EventTypes.PAGE_VIEW:
          stats.pageViews++;
          break;
        case EventTypes.REPORT_GENERATE:
          stats.reportsGenerated++;
          break;
      }
    }

    return stats;
  } catch (err) {
    console.error('[engagement] Error fetching stats:', err);
    return null;
  }
}

/**
 * Get daily engagement stats for admin dashboard
 */
export async function getDailyEngagementStats(
  days: number = 7
): Promise<{
  date: string;
  emailsOpened: number;
  linksClicked: number;
  uniqueUsers: number;
}[]> {
  try {
    const supabase = getSupabase();
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('user_engagement')
      .select('user_email, event_type, created_at')
      .gte('created_at', sinceDate)
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    // Group by date
    const byDate: Record<string, { opens: number; clicks: number; users: Set<string> }> = {};

    for (const event of data) {
      const date = event.created_at.split('T')[0];
      if (!byDate[date]) {
        byDate[date] = { opens: 0, clicks: 0, users: new Set() };
      }

      byDate[date].users.add(event.user_email);

      if (event.event_type === EventTypes.EMAIL_OPEN) {
        byDate[date].opens++;
      } else if (event.event_type === EventTypes.LINK_CLICK) {
        byDate[date].clicks++;
      }
    }

    return Object.entries(byDate)
      .map(([date, stats]) => ({
        date,
        emailsOpened: stats.opens,
        linksClicked: stats.clicks,
        uniqueUsers: stats.users.size,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (err) {
    console.error('[engagement] Error fetching daily stats:', err);
    return [];
  }
}

/**
 * Get high-risk churn users
 */
export async function getChurnRiskUsers(
  riskLevel: 'critical' | 'high' | 'medium' = 'high',
  limit: number = 50
): Promise<{
  user_email: string;
  engagement_score: number;
  days_since_last_activity: number;
  churn_risk: string;
}[]> {
  try {
    const supabase = getSupabase();

    const riskLevels = riskLevel === 'critical'
      ? ['critical']
      : riskLevel === 'high'
        ? ['critical', 'high']
        : ['critical', 'high', 'medium'];

    const { data, error } = await supabase
      .from('user_engagement_scores')
      .select('user_email, engagement_score, days_since_last_activity, churn_risk')
      .in('churn_risk', riskLevels)
      .order('engagement_score', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[engagement] Error fetching churn risk users:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[engagement] Error:', err);
    return [];
  }
}
