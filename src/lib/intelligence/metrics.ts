/**
 * Intelligence Metrics - Track KPIs for 30-day test
 *
 * Usage:
 *   const metrics = new IntelligenceMetrics('daily_alerts');
 *   metrics.recordEmailSent();
 *   metrics.recordOpportunityMatched(3);
 *   await metrics.save();
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type MetricType = 'daily_alerts' | 'weekly_alerts' | 'briefings' | 'unified';

export interface MetricsData {
  // Volume
  emails_attempted: number;
  emails_sent: number;
  emails_failed: number;
  users_eligible: number;
  users_skipped: number;

  // Opportunities
  opportunities_matched: number;
  opportunities_total: number;
  avg_match_score: number | null;

  // Performance
  cron_duration_ms: number;
  api_calls_made: number;
  api_errors: number;

  // Guardrails
  guardrail_warnings: number;
  circuit_breaker_tripped: boolean;
}

export class IntelligenceMetrics {
  private metricType: MetricType;
  private date: string;
  private startTime: number;
  private data: MetricsData;
  private matchScores: number[] = [];

  constructor(metricType: MetricType) {
    this.metricType = metricType;
    this.date = new Date().toISOString().split('T')[0];
    this.startTime = Date.now();
    this.data = {
      emails_attempted: 0,
      emails_sent: 0,
      emails_failed: 0,
      users_eligible: 0,
      users_skipped: 0,
      opportunities_matched: 0,
      opportunities_total: 0,
      avg_match_score: null,
      cron_duration_ms: 0,
      api_calls_made: 0,
      api_errors: 0,
      guardrail_warnings: 0,
      circuit_breaker_tripped: false,
    };
  }

  // Volume tracking
  recordEmailAttempted() {
    this.data.emails_attempted++;
  }

  recordEmailSent() {
    this.data.emails_sent++;
  }

  recordEmailFailed() {
    this.data.emails_failed++;
  }

  recordUserEligible() {
    this.data.users_eligible++;
  }

  recordUserSkipped() {
    this.data.users_skipped++;
  }

  // Opportunity tracking
  recordOpportunityMatched(count: number, matchScore?: number) {
    this.data.opportunities_matched += count;
    if (matchScore !== undefined) {
      this.matchScores.push(matchScore);
    }
  }

  recordOpportunitiesTotal(count: number) {
    this.data.opportunities_total += count;
  }

  // API tracking
  recordApiCall() {
    this.data.api_calls_made++;
  }

  recordApiError() {
    this.data.api_errors++;
  }

  // Guardrail tracking
  recordGuardrailWarning() {
    this.data.guardrail_warnings++;
  }

  recordCircuitBreakerTripped() {
    this.data.circuit_breaker_tripped = true;
  }

  // Calculate duration and averages
  private finalize() {
    this.data.cron_duration_ms = Date.now() - this.startTime;

    if (this.matchScores.length > 0) {
      this.data.avg_match_score =
        this.matchScores.reduce((a, b) => a + b, 0) / this.matchScores.length;
    }
  }

  // Save to database
  async save(): Promise<void> {
    this.finalize();

    try {
      const { error } = await supabase.rpc('upsert_intelligence_metrics', {
        p_date: this.date,
        p_metric_type: this.metricType,
        p_data: this.data,
      });

      if (error) {
        console.error('[Metrics] Failed to save:', error);
        // Fallback: direct upsert
        await this.saveDirectly();
      } else {
        console.log(`[Metrics] Saved ${this.metricType} metrics for ${this.date}`);
      }
    } catch (err) {
      console.error('[Metrics] Error saving metrics:', err);
      await this.saveDirectly();
    }
  }

  private async saveDirectly(): Promise<void> {
    const { error } = await supabase
      .from('intelligence_metrics')
      .upsert(
        {
          date: this.date,
          metric_type: this.metricType,
          ...this.data,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'date,metric_type' }
      );

    if (error) {
      console.error('[Metrics] Direct save failed:', error);
    }
  }

  // Get current metrics (for monitoring)
  getSnapshot(): MetricsData & { duration_ms: number } {
    return {
      ...this.data,
      duration_ms: Date.now() - this.startTime,
    };
  }
}

// Log individual delivery for tracking
export async function logIntelligenceDelivery(params: {
  userEmail: string;
  intelligenceType: string;
  deliveryStatus: 'sent' | 'failed' | 'bounced';
  itemsCount: number;
  itemIds?: string[];
  errorMessage?: string;
}): Promise<void> {
  try {
    const { error } = await supabase.from('intelligence_log').insert({
      user_email: params.userEmail,
      intelligence_type: params.intelligenceType,
      delivery_status: params.deliveryStatus,
      items_count: params.itemsCount,
      item_ids: params.itemIds || [],
      error_message: params.errorMessage,
    });

    if (error) {
      console.error('[IntelligenceLog] Failed to log delivery:', error);
    }
  } catch (err) {
    console.error('[IntelligenceLog] Error:', err);
  }
}

// Record user feedback
export async function recordUserFeedback(params: {
  userEmail: string;
  feedbackType: 'helpful' | 'not_helpful' | 'wrong_match' | 'spam' | 'feature_request';
  intelligenceType?: string;
  opportunityId?: string;
  rating?: number;
  comment?: string;
  source?: 'email' | 'dashboard' | 'survey';
}): Promise<void> {
  try {
    const isPositive = params.feedbackType === 'helpful' || (params.rating && params.rating >= 4);

    const { error } = await supabase.from('user_feedback').insert({
      user_email: params.userEmail,
      feedback_type: params.feedbackType,
      intelligence_type: params.intelligenceType,
      opportunity_id: params.opportunityId,
      rating: params.rating,
      is_positive: isPositive,
      comment: params.comment,
      feedback_source: params.source || 'email',
    });

    if (error) {
      console.error('[Feedback] Failed to record:', error);
    }

    // Update daily metrics
    const today = new Date().toISOString().split('T')[0];
    const field = isPositive ? 'user_feedback_positive' : 'user_feedback_negative';

    await supabase.rpc('upsert_intelligence_metrics', {
      p_date: today,
      p_metric_type: params.intelligenceType || 'daily_alerts',
      p_data: { [field]: 1 },
    });
  } catch (err) {
    console.error('[Feedback] Error:', err);
  }
}

// Get metrics for dashboard
export async function getMetricsDashboard(days: number = 7): Promise<{
  daily: any[];
  summary: {
    totalSent: number;
    avgDeliveryRate: number;
    avgOpenRate: number;
    avgClickRate: number;
    feedbackPositiveRate: number;
  };
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: metrics, error } = await supabase
    .from('intelligence_metrics')
    .select('*')
    .gte('date', startDate.toISOString().split('T')[0])
    .order('date', { ascending: false });

  if (error) {
    console.error('[Dashboard] Failed to fetch metrics:', error);
    return { daily: [], summary: { totalSent: 0, avgDeliveryRate: 0, avgOpenRate: 0, avgClickRate: 0, feedbackPositiveRate: 0 } };
  }

  // Calculate summary
  const totalSent = metrics.reduce((sum, m) => sum + (m.emails_sent || 0), 0);
  const totalAttempted = metrics.reduce((sum, m) => sum + (m.emails_attempted || 0), 0);
  const totalOpened = metrics.reduce((sum, m) => sum + (m.emails_opened || 0), 0);
  const totalClicked = metrics.reduce((sum, m) => sum + (m.emails_clicked || 0), 0);
  const totalPositive = metrics.reduce((sum, m) => sum + (m.user_feedback_positive || 0), 0);
  const totalNegative = metrics.reduce((sum, m) => sum + (m.user_feedback_negative || 0), 0);

  return {
    daily: metrics,
    summary: {
      totalSent,
      avgDeliveryRate: totalAttempted > 0 ? (totalSent / totalAttempted) * 100 : 0,
      avgOpenRate: totalSent > 0 ? (totalOpened / totalSent) * 100 : 0,
      avgClickRate: totalSent > 0 ? (totalClicked / totalSent) * 100 : 0,
      feedbackPositiveRate: (totalPositive + totalNegative) > 0
        ? (totalPositive / (totalPositive + totalNegative)) * 100
        : 0,
    },
  };
}
