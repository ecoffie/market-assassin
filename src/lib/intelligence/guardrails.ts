/**
 * Intelligence Guardrails - Protect against runaway failures
 *
 * Features:
 * - GuardrailMonitor: Track failures during cron execution
 * - CircuitBreaker: Auto-pause if failure rate too high
 * - Pre-send validation: Check before sending batch
 * - Post-send validation: Alert on issues after sending
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-loaded Supabase client to avoid build-time errors
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

// Configuration
const GUARDRAIL_CONFIG = {
  // Stop if too many failures
  maxConsecutiveFailures: 5,
  maxTotalFailures: 50,

  // Stop if API is down
  maxApiErrors: 10,

  // Stop if taking too long
  maxDurationMinutes: 30,

  // Circuit breaker settings
  failureRateThreshold: 0.2, // 20% failure rate trips breaker
  windowSize: 100, // Last 100 attempts
  cooldownMinutes: 30, // How long to pause
};

export interface GuardrailCheckResult {
  continue: boolean;
  reason?: string;
  severity: 'ok' | 'warning' | 'critical';
}

/**
 * GuardrailMonitor - Track failures during a single cron run
 */
export class GuardrailMonitor {
  private cronName: string;
  private failures = 0;
  private consecutiveFailures = 0;
  private apiErrors = 0;
  private warnings: string[] = [];
  private startTime = Date.now();

  constructor(cronName: string) {
    this.cronName = cronName;
  }

  check(): GuardrailCheckResult {
    // Check consecutive failures
    if (this.consecutiveFailures >= GUARDRAIL_CONFIG.maxConsecutiveFailures) {
      return {
        continue: false,
        reason: `Too many consecutive failures (${this.consecutiveFailures})`,
        severity: 'critical',
      };
    }

    // Check total failures
    if (this.failures >= GUARDRAIL_CONFIG.maxTotalFailures) {
      return {
        continue: false,
        reason: `Too many total failures (${this.failures})`,
        severity: 'critical',
      };
    }

    // Check API errors
    if (this.apiErrors >= GUARDRAIL_CONFIG.maxApiErrors) {
      return {
        continue: false,
        reason: `API appears to be down (${this.apiErrors} errors)`,
        severity: 'critical',
      };
    }

    // Check duration
    const durationMinutes = (Date.now() - this.startTime) / 60000;
    if (durationMinutes >= GUARDRAIL_CONFIG.maxDurationMinutes) {
      return {
        continue: false,
        reason: `Execution taking too long (${durationMinutes.toFixed(1)} minutes)`,
        severity: 'critical',
      };
    }

    // Warning level checks
    if (this.failures > 10 || this.apiErrors > 3) {
      return {
        continue: true,
        reason: `Elevated failures (${this.failures}) or API errors (${this.apiErrors})`,
        severity: 'warning',
      };
    }

    return { continue: true, severity: 'ok' };
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
  }

  recordFailure(reason?: string) {
    this.failures++;
    this.consecutiveFailures++;
    if (reason) {
      this.warnings.push(reason);
    }
  }

  recordApiError(endpoint?: string) {
    this.apiErrors++;
    if (endpoint) {
      this.warnings.push(`API error: ${endpoint}`);
    }
  }

  getStats() {
    return {
      failures: this.failures,
      consecutiveFailures: this.consecutiveFailures,
      apiErrors: this.apiErrors,
      durationMs: Date.now() - this.startTime,
      warnings: this.warnings,
    };
  }

  // Log guardrail event to database
  async logEvent(eventType: 'warning' | 'trip' | 'reset', reason: string): Promise<void> {
    try {
      const sb = getSupabase();
      if (!sb) return;
      await sb.from('guardrail_events').insert({
        event_type: eventType,
        cron_name: this.cronName,
        reason,
        failure_rate: this.failures / Math.max(this.failures + 1, 1), // Rough estimate
        consecutive_failures: this.consecutiveFailures,
        total_failures: this.failures,
      });
    } catch (err) {
      console.error('[Guardrail] Failed to log event:', err);
    }
  }
}

/**
 * CircuitBreaker - Auto-pause intelligence delivery if failure rate too high
 * Persists state in database so it survives across cron runs
 */
export class CircuitBreaker {
  private cronName: string;
  private static cache: Map<string, { trippedAt: Date | null; attempts: boolean[] }> = new Map();

  constructor(cronName: string) {
    this.cronName = cronName;
  }

  private getState() {
    if (!CircuitBreaker.cache.has(this.cronName)) {
      CircuitBreaker.cache.set(this.cronName, { trippedAt: null, attempts: [] });
    }
    return CircuitBreaker.cache.get(this.cronName)!;
  }

  async isOpen(): Promise<boolean> {
    // Check in-memory cache first
    const state = this.getState();
    if (state.trippedAt) {
      const cooldownExpired =
        Date.now() - state.trippedAt.getTime() > GUARDRAIL_CONFIG.cooldownMinutes * 60000;
      if (cooldownExpired) {
        state.trippedAt = null;
        await this.logReset();
        return false;
      }
      return true;
    }

    // Also check database for persisted state
    const sb = getSupabase();
    if (!sb) return false;
    const { data } = await sb
      .from('guardrail_events')
      .select('created_at')
      .eq('cron_name', this.cronName)
      .eq('event_type', 'trip')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      const trippedAt = new Date(data.created_at);
      const cooldownExpired =
        Date.now() - trippedAt.getTime() > GUARDRAIL_CONFIG.cooldownMinutes * 60000;
      if (!cooldownExpired) {
        state.trippedAt = trippedAt;
        return true;
      } else {
        // Mark as resolved
        await this.logReset();
      }
    }

    return false;
  }

  record(success: boolean) {
    const state = this.getState();
    state.attempts.push(success);
    if (state.attempts.length > GUARDRAIL_CONFIG.windowSize) {
      state.attempts.shift();
    }

    // Check if we should trip
    if (state.attempts.length >= 10) {
      const failures = state.attempts.filter((a) => !a).length;
      const failureRate = failures / state.attempts.length;

      if (failureRate >= GUARDRAIL_CONFIG.failureRateThreshold) {
        this.trip(failureRate);
      }
    }
  }

  private async trip(failureRate: number) {
    const state = this.getState();
    state.trippedAt = new Date();

    console.error(`[CircuitBreaker] TRIPPED for ${this.cronName} - ${(failureRate * 100).toFixed(1)}% failure rate`);

    // Log to database
    const sb = getSupabase();
    if (sb) {
      await sb.from('guardrail_events').insert({
        event_type: 'trip',
        cron_name: this.cronName,
        reason: `Failure rate ${(failureRate * 100).toFixed(1)}% exceeded threshold ${GUARDRAIL_CONFIG.failureRateThreshold * 100}%`,
        failure_rate: failureRate,
      });
    }

    // Alert ops (could integrate with Slack/email)
    console.error(`[ALERT] Circuit breaker tripped for ${this.cronName}. Paused for ${GUARDRAIL_CONFIG.cooldownMinutes} minutes.`);
  }

  private async logReset() {
    console.log(`[CircuitBreaker] Reset for ${this.cronName}`);

    // Mark previous trip as resolved
    const sb = getSupabase();
    if (!sb) return;
    await sb
      .from('guardrail_events')
      .update({ resolved_at: new Date().toISOString(), resolved_by: 'auto' })
      .eq('cron_name', this.cronName)
      .eq('event_type', 'trip')
      .is('resolved_at', null);
  }

  // Manual override to reset circuit breaker
  async manualReset(adminEmail: string): Promise<void> {
    const state = this.getState();
    state.trippedAt = null;
    state.attempts = [];

    const sb = getSupabase();
    if (sb) {
      await sb
        .from('guardrail_events')
        .update({ resolved_at: new Date().toISOString(), resolved_by: adminEmail })
        .eq('cron_name', this.cronName)
        .eq('event_type', 'trip')
        .is('resolved_at', null);
    }

    console.log(`[CircuitBreaker] Manually reset by ${adminEmail}`);
  }
}

/**
 * Pre-send validation - Check before sending batch
 */
export interface EmailBatch {
  recipients: string[];
  emails: Array<{
    recipient: string;
    opportunities?: any[];
  }>;
  chunked?: boolean;
  chunkSize?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  canProceed: boolean;
}

export async function validateBeforeSend(
  batch: EmailBatch,
  expectedMaxUsers?: number
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Volume guardrail
  const expectedMax = expectedMaxUsers || 1000;
  if (batch.recipients.length > expectedMax * 1.1) {
    errors.push(`Batch size ${batch.recipients.length} exceeds expected max ${expectedMax}`);
  }

  // 2. Content guardrail
  let emptyCount = 0;
  let overloadedCount = 0;
  for (const email of batch.emails) {
    if (!email.opportunities || email.opportunities.length === 0) {
      emptyCount++;
    }
    if (email.opportunities && email.opportunities.length > 50) {
      overloadedCount++;
    }
  }
  if (emptyCount > batch.emails.length * 0.5) {
    warnings.push(`${emptyCount} emails have no opportunities (${((emptyCount / batch.emails.length) * 100).toFixed(0)}%)`);
  }
  if (overloadedCount > 0) {
    warnings.push(`${overloadedCount} emails have >50 opportunities`);
  }

  // 3. Rate limit guardrail
  const smtpLimit = 500; // per hour
  if (batch.recipients.length > smtpLimit) {
    batch.chunked = true;
    batch.chunkSize = Math.floor(smtpLimit * 0.9);
    warnings.push(`Batch will be chunked into ${Math.ceil(batch.recipients.length / batch.chunkSize)} parts`);
  }

  // 4. Time guardrail
  const hour = new Date().getUTCHours();
  if (hour < 10 || hour > 22) {
    warnings.push('Sending outside normal hours (10:00-22:00 UTC)');
  }

  // 5. Duplicate check
  const uniqueRecipients = new Set(batch.recipients);
  if (uniqueRecipients.size < batch.recipients.length) {
    errors.push(`${batch.recipients.length - uniqueRecipients.size} duplicate recipients detected`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    canProceed: errors.length === 0 && warnings.length < 10,
  };
}

/**
 * Post-send validation - Check after batch completes
 */
export interface SendResults {
  attempted: number;
  sent: number;
  failed: number;
  failedRecipients: string[];
  duration: number;
}

export async function postSendValidation(
  cronName: string,
  results: SendResults
): Promise<void> {
  const failureRate = results.failed / Math.max(results.attempted, 1);

  const sb = getSupabase();

  // Alert on high failure rate
  if (failureRate > 0.1) {
    console.warn(`[PostSend] High failure rate for ${cronName}: ${(failureRate * 100).toFixed(1)}%`);

    if (sb) {
      await sb.from('guardrail_events').insert({
        event_type: 'warning',
        cron_name: cronName,
        reason: `High failure rate: ${(failureRate * 100).toFixed(1)}%`,
        failure_rate: failureRate,
        total_failures: results.failed,
      });
    }
  }

  // Critical: Zero emails sent
  if (results.sent === 0 && results.attempted > 0) {
    console.error(`[PostSend] CRITICAL: Zero emails sent for ${cronName} despite ${results.attempted} attempts`);

    if (sb) {
      await sb.from('guardrail_events').insert({
        event_type: 'warning',
        cron_name: cronName,
        reason: `Zero emails sent despite ${results.attempted} attempts`,
        failure_rate: 1.0,
        total_failures: results.failed,
      });
    }
  }

  console.log(`[PostSend] ${cronName}: ${results.sent}/${results.attempted} sent (${results.failed} failed) in ${results.duration}ms`);
}

/**
 * Get current guardrail status for dashboard
 */
export async function getGuardrailStatus(): Promise<{
  circuitBreakers: Array<{ cronName: string; isOpen: boolean; trippedAt?: string }>;
  recentEvents: any[];
  activeWarnings: number;
}> {
  const sb = getSupabase();
  if (!sb) {
    return { circuitBreakers: [], recentEvents: [], activeWarnings: 0 };
  }

  // Get recent events
  const { data: events } = await sb
    .from('guardrail_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  // Get open circuit breakers
  const { data: openBreakers } = await sb
    .from('guardrail_events')
    .select('cron_name, created_at')
    .eq('event_type', 'trip')
    .is('resolved_at', null);

  // Count active warnings (last 24h)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const { count } = await sb
    .from('guardrail_events')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'warning')
    .gte('created_at', yesterday.toISOString());

  return {
    circuitBreakers: (openBreakers || []).map((b) => ({
      cronName: b.cron_name,
      isOpen: true,
      trippedAt: b.created_at,
    })),
    recentEvents: events || [],
    activeWarnings: count || 0,
  };
}
