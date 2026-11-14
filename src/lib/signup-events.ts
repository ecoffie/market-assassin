/**
 * Signup Event Logging
 *
 * Enterprise-grade signup funnel tracking for health monitoring.
 *
 * Usage:
 *   import { logSignupEvent, SignupEventType, SignupStep } from '@/lib/signup-events';
 *
 *   await logSignupEvent({
 *     eventType: SignupEventType.SIGNUP_STARTED,
 *     source: 'free-signup',
 *     userEmail: email,
 *   });
 */

import { after } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Event types
export enum SignupEventType {
  SIGNUP_STARTED = 'signup_started',
  STEP_STARTED = 'step_started',
  STEP_COMPLETED = 'step_completed',
  SIGNUP_COMPLETED = 'signup_completed',
  SIGNUP_FAILED = 'signup_failed',
  /**
   * The account's FIRST verified sign-in (any door: email setup-password, password, Google, Microsoft,
   * magic link). Recorded once per account (partial unique index, migration 20261114_signup_events_account_verified).
   * This is the registration count the activation dashboard uses: signup_completed only means a setup
   * email was sent or an alert profile was saved, and neither proves a person reached the product.
   */
  ACCOUNT_VERIFIED = 'account_verified',
}

// Wizard steps
export enum SignupStep {
  EMAIL = 'email',
  BUSINESS_DESCRIPTION = 'business_description',
  INDUSTRIES = 'industries',
  AGENCIES = 'agencies',
  GEOGRAPHY = 'geography',
  DELIVERY = 'delivery',
}

// Error types for categorization
export enum SignupErrorType {
  AUTH_FAILED = 'auth_failed',
  VALIDATION_FAILED = 'validation_failed',
  API_ERROR = 'api_error',
  TIMEOUT = 'timeout',
  NETWORK_ERROR = 'network_error',
  DATABASE_ERROR = 'database_error',
  UNKNOWN = 'unknown',
}

// Event status. 'skipped' = not a signup at all (for example an EXISTING account re-saving its alert
// profile without signing in). It is excluded from the failure rate, which counts status = 'failed'.
export type SignupEventStatus = 'success' | 'failed' | 'skipped';

// Event interface
export interface SignupEvent {
  eventType: SignupEventType;
  step?: SignupStep | string;
  status?: SignupEventStatus;
  sessionId?: string;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  errorType?: SignupErrorType | string;
  errorMessage?: string;
  source?: string;
  referrer?: string;
  metadata?: Record<string, unknown>;
}

// Singleton Supabase client for events
let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return supabase;
}

/**
 * Log a signup event to the database
 *
 * This is non-blocking and won't throw errors - it logs failures silently
 * to avoid disrupting the user experience.
 */
export async function logSignupEvent(event: SignupEvent): Promise<string | null> {
  try {
    const db = getSupabase();

    const { data, error } = await db
      .from('signup_events')
      .insert({
        event_type: event.eventType,
        step: event.step || null,
        status: event.status || 'success',
        session_id: event.sessionId || null,
        user_email: event.userEmail?.toLowerCase() || null,
        ip_address: event.ipAddress || null,
        user_agent: event.userAgent || null,
        error_type: event.errorType || null,
        error_message: event.errorMessage || null,
        source: event.source || null,
        referrer: event.referrer || null,
        metadata: event.metadata || {},
      })
      .select('id')
      .single();

    if (error) {
      // Log but don't throw - monitoring shouldn't break signup
      console.error('[SignupEvent] Failed to log event:', error.message);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    // Silently fail - don't break signup for monitoring
    console.error('[SignupEvent] Exception:', err);
    return null;
  }
}

/**
 * Classify an error into a SignupErrorType
 */
export function classifySignupError(error: Error | unknown): SignupErrorType {
  if (!error) return SignupErrorType.UNKNOWN;

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes('unauthorized') || message.includes('auth') || message.includes('401')) {
    return SignupErrorType.AUTH_FAILED;
  }
  if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
    return SignupErrorType.VALIDATION_FAILED;
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return SignupErrorType.TIMEOUT;
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
    return SignupErrorType.NETWORK_ERROR;
  }
  if (message.includes('database') || message.includes('supabase') || message.includes('postgres')) {
    return SignupErrorType.DATABASE_ERROR;
  }
  if (message.includes('api') || message.includes('500') || message.includes('502') || message.includes('503')) {
    return SignupErrorType.API_ERROR;
  }

  return SignupErrorType.UNKNOWN;
}

/**
 * Extract IP address from request headers
 */
export function extractIpAddress(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  return undefined;
}

/**
 * Extract user agent from request
 */
export function extractUserAgent(request: Request): string | undefined {
  return request.headers.get('user-agent') || undefined;
}

/**
 * Helper: Log signup started event
 */
export async function logSignupStarted(
  source: string,
  email?: string,
  request?: Request
): Promise<string | null> {
  return logSignupEvent({
    eventType: SignupEventType.SIGNUP_STARTED,
    source,
    userEmail: email,
    ipAddress: request ? extractIpAddress(request) : undefined,
    userAgent: request ? extractUserAgent(request) : undefined,
  });
}

/**
 * Helper: Log signup completed event
 */
export async function logSignupCompleted(
  source: string,
  email: string,
  metadata?: Record<string, unknown>
): Promise<string | null> {
  return logSignupEvent({
    eventType: SignupEventType.SIGNUP_COMPLETED,
    status: 'success',
    source,
    userEmail: email,
    metadata,
  });
}

/**
 * Helper: Log signup failed event
 */
export async function logSignupFailed(
  source: string,
  error: Error | unknown,
  email?: string,
  step?: SignupStep | string
): Promise<string | null> {
  const errorType = classifySignupError(error);
  const errorMessage = error instanceof Error ? error.message : String(error);

  return logSignupEvent({
    eventType: SignupEventType.SIGNUP_FAILED,
    status: 'failed',
    step,
    source,
    userEmail: email,
    errorType,
    errorMessage: errorMessage.substring(0, 500), // Truncate long messages
  });
}

/**
 * Helper: Log step completion
 */
export async function logStepCompleted(
  step: SignupStep | string,
  source: string,
  email?: string
): Promise<string | null> {
  return logSignupEvent({
    eventType: SignupEventType.STEP_COMPLETED,
    step,
    status: 'success',
    source,
    userEmail: email,
  });
}

/**
 * An existing account reached a signup form while signed out. That is a redirect to sign-in, not a failed
 * signup: logging it as 'failed' made October/November look like 87% of signups failing (2026-11-14 audit:
 * all 135 failures since 2026-10-01 were sign_in_required from accounts that already existed).
 */
export async function logExistingAccountRedirect(source: string, email?: string): Promise<string | null> {
  return logSignupEvent({
    eventType: SignupEventType.SIGNUP_FAILED,
    status: 'skipped',
    source,
    userEmail: email,
    errorType: 'existing_account',
    errorMessage: 'sign_in_required',
  });
}

// ── Verified registration ────────────────────────────────────────────────────────────────────────

/** Only accounts created this recently are recorded, so a session refresh months later never writes. */
export const ACCOUNT_VERIFIED_WINDOW_DAYS = 30;

export type AccountVerifiedDecision = 'record' | 'invalid_email' | 'unknown_created_at' | 'outside_window';

export function accountVerifiedDecision(
  email: string | null | undefined,
  accountCreatedAt: string | null | undefined,
  now: Date = new Date(),
): AccountVerifiedDecision {
  const e = String(email || '').trim().toLowerCase();
  if (!e.includes('@') || e.startsWith('anon:')) return 'invalid_email';
  const created = Date.parse(String(accountCreatedAt || ''));
  // Unknown creation time: never assume the account is new.
  if (!Number.isFinite(created)) return 'unknown_created_at';
  if (now.getTime() - created > ACCOUNT_VERIFIED_WINDOW_DAYS * 86_400_000) return 'outside_window';
  return 'record';
}

export type AccountVerifiedOutcome = AccountVerifiedDecision | 'recorded' | 'already_recorded' | 'error';

/**
 * Record the account's first verified sign-in. Idempotent: a prior row short-circuits, and the partial unique
 * index makes a concurrent duplicate fail with 23505, which is treated as already recorded. Never throws.
 */
export async function recordAccountVerified(
  p: { email: string; accountCreatedAt: string | null | undefined; channel: string },
  opts: { db?: SupabaseClient; now?: Date } = {},
): Promise<AccountVerifiedOutcome> {
  const decision = accountVerifiedDecision(p.email, p.accountCreatedAt, opts.now);
  if (decision !== 'record') return decision;
  const email = p.email.trim().toLowerCase();
  try {
    const db = opts.db ?? getSupabase();
    const { data: prior, error: priorErr } = await db
      .from('signup_events')
      .select('id')
      .eq('event_type', SignupEventType.ACCOUNT_VERIFIED)
      .eq('user_email', email)
      .limit(1);
    if (priorErr) {
      console.error('[SignupEvent] account_verified lookup failed:', priorErr.message);
      return 'error';
    }
    if (prior && prior.length > 0) return 'already_recorded';
    const { error } = await db.from('signup_events').insert({
      event_type: SignupEventType.ACCOUNT_VERIFIED,
      status: 'success',
      user_email: email,
      source: p.channel,
      metadata: { channel: p.channel, account_created_at: p.accountCreatedAt },
    });
    if (error) {
      if ((error as { code?: string }).code === '23505') return 'already_recorded';
      console.error('[SignupEvent] account_verified insert failed:', error.message);
      return 'error';
    }
    return 'recorded';
  } catch (err) {
    console.error('[SignupEvent] account_verified exception:', (err as Error)?.message);
    return 'error';
  }
}

/** Fire-and-forget beside sign-in (after() keeps it alive past the response, like the registration grant). */
export function scheduleAccountVerified(email: string, accountCreatedAt: string | null | undefined, channel: string): void {
  if (accountVerifiedDecision(email, accountCreatedAt) !== 'record') return;
  const run = () => recordAccountVerified({ email, accountCreatedAt, channel }).then(() => undefined);
  try { after(run); } catch { void run(); }
}
