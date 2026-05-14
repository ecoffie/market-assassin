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

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Event types
export enum SignupEventType {
  SIGNUP_STARTED = 'signup_started',
  STEP_STARTED = 'step_started',
  STEP_COMPLETED = 'step_completed',
  SIGNUP_COMPLETED = 'signup_completed',
  SIGNUP_FAILED = 'signup_failed',
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

// Event status
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
